// @ts-check
/**
 * **`Error.cause` FOR LIBRARY-OWNED CAUSAL CHAINS, WITHOUT CAUSE TEXT IN REDACTED MESSAGES** —
 * M8 acceptance clause 76, scoped to `LoadFailure.cause` (plan 3.5:1127-1128, plan 6.2:1971).
 *
 * The clause is two independent propositions joined by "without", and they fail independently:
 * a loader can retain the caught error perfectly and still inline its text into the aggregate
 * message, or redact the message perfectly and hand back a flattened copy of the error. So every
 * arm below is written to leave the OTHER half green, and the ablation record says which.
 *
 * **WHY THE OBVIOUS PROBE FAILS, and this is the whole reason the file exists.** The natural
 * assertion for "the cause is retained" is `cause !== undefined`, or `cause instanceof Error`, or
 * `cause.message === "…"`. Every one of them is GREEN over the ablation a real implementer ships:
 *
 *     cause: error instanceof Error ? new Error(error.message, { cause: error }) : new Error(String(error))
 *
 * which normalizes the caught value, keeps it reachable through the options bag, and produces a
 * cause that is still an Error, still truthy, still named `Error`, and whose message is
 * CHARACTER-IDENTICAL to the original's. Only `===` separates the two arms. Plan 3.5:1142 is what
 * makes that the right instrument rather than a stylistic preference — "wrapper count and cause
 * identity are normative even though diagnostic message text is not" — so identity is the property
 * the clause actually pins, and the text is the property it forbids copying. This is the standing
 * `Zzzz` lesson in its local form: covering both arms of `cause != null` is not discriminating the
 * input that chooses between retaining and re-wrapping.
 *
 * **AND THE SECOND HALF NEEDS A TOKEN THE FIXTURE CHOOSES.** A probe that checks the aggregate
 * message against wording the test does not control goes red for the wrong reason the first time a
 * legitimate message names the failing URL. Every gated no-copy assertion here therefore hunts a
 * string the fixture injected — `ZQX…` sentinels for caught causes, the fixture's own SHA-256 hex
 * for the digest stage, an injected key name for the validation stage — spelled with Z/Q/X so it
 * cannot occur inside a lowercase-hex digest, a BCP-47 tag, a stage name, or a `file:`/`https:` URL
 * this fixture produces. Where no such token exists (the byte-count message at the `limit` stage,
 * the source-and-location message at the JSON-syntax stage) the row is OBSERVED and says so in the
 * table, rather than being silently dropped by a length filter.
 *
 * **WHAT IS RECORDED RATHER THAN GATED, and why.** The clause's first half is conditional — "when
 * there is a library-owned causal chain" — and at the `digest` and `limit` stages nothing was
 * thrown: the library DETECTED a mismatch and authored the finding itself. Whether that constitutes
 * such a chain is a maintainer question, so `cause instanceof Error` at those stages is pinned as a
 * DECLARED SHAPE that fails in either direction (see `DECLARED_LOAD_CAUSE_SHAPES`), not asserted as
 * a plan requirement. Plan 6.2:1971's `readonly cause: unknown` does not settle it: its siblings at
 * :821 and :993 are spelled `unknown | null`, which in TypeScript REDUCES TO `unknown`, so the
 * "contrast" that reading leans on does not exist.
 *
 * Each door is probed at BOTH of its acquisition catch sites, which are different code: a transport
 * that rejects before any byte arrives is caught at the call, while a body that fails mid-stream is
 * caught (Fetch: NOT caught — see below) further in. Measured here: the Fetch door's body-read loop
 * runs OUTSIDE `FETCH_TRANSPORT.read`'s try, so a mid-stream failure reaches the runner as a raw
 * thrown value and lands in `LoadFailure.cause` through `run-plan.js`'s `?? failure` fallback — a
 * different line from the one every other arm exercises.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { loadEntireManifest } from "../src/load/fetch-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";
import {
  createStringsManifestFromDirectory,
  loadEntireManifestFromFiles,
  readStringsManifest,
} from "../src/node/index.js";

const utf8 = new TextEncoder();

/**
 * An arbitrary floor, stated as a floor so nobody reads it as a property of the wording.
 *
 * It exists only so that "no cause text in the message" cannot be satisfied by emitting `""`:
 * plan 3.5:1128 says REDACTED, not absent, and plan 3.5:1123 puts the per-file detail on
 * `failures`, not nowhere. Eight characters is longer than any punctuation-only or single-word
 * message and shorter than anything this port emits; plan 6.2:2496 makes the text itself
 * non-normative, so no assertion here may depend on what it says.
 */
const MINIMUM_MESSAGE_LENGTH = 8;

const catalog = (/** @type {string} */ greeting) => JSON.stringify({ Greeting: greeting });

// Every published directory lives under ONE directory, removed when this file's tests finish. Until
// 2026-09-23 each was its own directory in the system temp folder and nothing removed it: 26,651
// `lokalized-cause-*` directories were counted there, forty-five per run.
const scratch = mkdtempSync(join(tmpdir(), "lokalized-cause-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Write a directory of catalogs and GENERATE the manifest from it.
 *
 * **NEVER HAND-WRITE A MANIFEST FOR THIS FILE.** Plan 6.2:2070-2071 rejects a schema, semantic,
 * fingerprint or runtime-data mismatch with `ConfigurationError` BEFORE a per-file plan exists, so a
 * hand-built manifest produces an error that carries no `failures` at all and every probe below
 * would be reporting on a path it never took — the zh-123 shape for this clause.
 *
 * The generator is HASH-ONLY (it enumerates and hashes; it does not parse), which is what makes a
 * single-fault `parse`-stage fixture possible: a manifest generated over deliberately broken bytes
 * records the digest OF those broken bytes, so the digest check PASSES and the stage under test is
 * the one that fires. It also emits `decodedBytes` — measured, not assumed — which is why the
 * digest fixture below is length-PRESERVING.
 *
 * @param {Record<string, string | Uint8Array>} files
 * @param {{ fallbackLocale?: string, publicationBaseUrl?: string }} [options]
 */
async function publish(files, options = {}) {
  const directory = mkdtempSync(join(scratch, "d-"));
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(directory, name), typeof body === "string" ? body : Buffer.from(body));
  const manifest = await createStringsManifestFromDirectory(directory, {
    catalogVersion: "1",
    fallbackLocale: options.fallbackLocale ?? "en-US",
    ...(options.publicationBaseUrl === undefined ? {} : { publicationBaseUrl: options.publicationBaseUrl }),
  });
  return { directory, manifest };
}

/** The bytes actually on disk, keyed by the last segment of either door's URL. */
const bytesFrom = (/** @type {string} */ directory) => (/** @type {string} */ url) =>
  new Uint8Array(readFileSync(join(directory, decodeURIComponent(/** @type {string} */ (url.split("/").pop())))));

/**
 * A `Response`-shaped stub whose body yields `chunks` and then either ends or THROWS.
 *
 * `cancelled` is counted because the Fetch door releases its reader in a `finally`; a no-op cancel
 * makes "the reader was released" indistinguishable from "the reader was abandoned open".
 *
 * @param {readonly Uint8Array[]} chunks @param {{ failWith?: unknown }} [behaviour]
 */
function response(chunks, behaviour = {}) {
  let index = 0;
  const state = { cancelled: 0 };
  return {
    ok: true,
    status: 200,
    cancelState: state,
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) return { done: false, value: chunks[index++] };
          if ("failWith" in behaviour) throw behaviour.failWith;
          return { done: true, value: undefined };
        },
        cancel: async () => { ++state.cancelled; },
      }),
    },
  };
}

/**
 * Run a load that MUST reject, and hand back the rejection.
 *
 * `await assert.rejects(p)` returns NOTHING and passes on ANY rejection, so assertions written
 * "after it" have no value to run against — failure shape 5 in its exact local form, and the reason
 * this helper exists rather than the idiom.
 *
 * @param {Promise<unknown>} promise @param {string} what
 */
async function rejection(promise, what) {
  try {
    await promise;
  } catch (error) {
    return /** @type {any} */ (error);
  }
  return assert.fail(`${what}: the load RESOLVED; expected a StringsLoadingError`);
}

/** Every assertion that follows a rejection first proves the rejection is the LOADER's, by name. */
function assertLoadingError(/** @type {any} */ error, /** @type {string} */ what) {
  // By `code`, not by `instanceof Error`: a `ConfigurationError` from manifest validation is also an
  // Error, and a fixture that never reached the runner would otherwise "pass" every probe here.
  assert.strictEqual(error?.code, "STRINGS_LOADING", `${what}: ${error?.name}: ${error?.message}`);
}

// ---------------------------------------------------------------------------------------------
// C1 — a CAUGHT cause is retained by object identity, at both catch sites of both doors.
// ---------------------------------------------------------------------------------------------

const SENTINEL_TEXT = "ZQX-PROBE-CAUSE-TEXT secretToken=ZQX-HUNTER";
const SENTINEL_TOKEN = "ZQX-PROBE-CAUSE-TEXT";

/** A fresh sentinel per arm, so an arm that reports another arm's object is visible as a mismatch. */
const sentinel = (/** @type {string} */ suffix) => new Error(`${SENTINEL_TEXT}-${suffix}`);

const TWO_CATALOGS = { "en-US.json": catalog("Hello"), "fr.json": catalog("Bonjour") };

test("Node door: a reader that rejects BEFORE any byte hands back the caught value itself", async () => {
  const { directory, manifest } = await publish(TWO_CATALOGS);
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("node-preread");

  // THE CONTROL FIRST. It is what proves this manifest survives schema, semantic, fingerprint,
  // runtime-data and preflight validation and then passes digest and parse for BOTH files — so the
  // single failure below is attributable to the injected throw and to nothing earlier.
  const clean = await loadEntireManifestFromFiles(manifest, { readFile: async (url) => real(url) });
  assert.strictEqual(clean.complete, true);
  assert.strictEqual(clean.failures.length, 0);
  assert.deepEqual(Object.keys(clean.catalogs).sort(), ["en-US", "fr"]);

  const error = await rejection(
    loadEntireManifestFromFiles(manifest, {
      readFile: async (url) => { if (url.endsWith("fr.json")) throw SENTINEL; return real(url); },
    }),
    "node pre-read",
  );
  assertLoadingError(error, "node pre-read");
  assert.strictEqual(error.failures.length, 1);
  assert.strictEqual(error.failures[0].locale, "fr");
  // Plan 6.2:2078-2079 — Node filesystem/injected-reader acquisition failures use stage `read`.
  assert.strictEqual(error.failures[0].stage, "read");
  // THE CLAIM. Everything above is green under the normalizing ablation; only this line is not.
  assert.strictEqual(error.failures[0].cause, SENTINEL);
});

test("Node door: a reader that throws MID-STREAM hands back the caught value itself", async () => {
  // A SECOND CATCH SITE, not a second spelling of the first. Plan 6.2:2003-2006 lets an injected
  // reader answer with a stream, and the Node transport hashes incrementally from the bounded
  // reader's chunks — so a promise that rejects before any byte arrives and a stream that errors
  // mid-read are handled by different code, and a defect in one is invisible from the other.
  const { directory, manifest } = await publish(TWO_CATALOGS);
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("node-midstream");

  // THE CHUNKED CONTROL, without which a red below could be the chunking rather than the identity.
  const clean = await loadEntireManifestFromFiles(manifest, {
    readFile: async (url) => {
      const bytes = real(url);
      return (async function* () { yield bytes.subarray(0, 5); yield bytes.subarray(5); })();
    },
  });
  assert.strictEqual(clean.complete, true);
  assert.deepEqual(Object.keys(clean.catalogs).sort(), ["en-US", "fr"]);

  const error = await rejection(
    loadEntireManifestFromFiles(manifest, {
      readFile: async (url) => {
        if (!url.endsWith("fr.json")) return real(url);
        const bytes = real(url);
        return (async function* () { yield bytes.subarray(0, 8); throw SENTINEL; })();
      },
    }),
    "node mid-stream",
  );
  assertLoadingError(error, "node mid-stream");
  assert.strictEqual(error.failures.length, 1);
  assert.strictEqual(error.failures[0].stage, "read");
  assert.strictEqual(error.failures[0].cause, SENTINEL);
});

test("Fetch door: a fetch that REJECTS hands back the caught value itself", async () => {
  const { directory, manifest } = await publish(TWO_CATALOGS, { publicationBaseUrl: "https://example.test/strings/" });
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("fetch-preread");

  const clean = await loadEntireManifest(manifest, { fetch: async (url) => response([real(url)]) });
  assert.strictEqual(clean.complete, true);
  assert.strictEqual(clean.failures.length, 0);
  assert.deepEqual(Object.keys(clean.catalogs).sort(), ["en-US", "fr"]);

  const error = await rejection(
    loadEntireManifest(manifest, {
      fetch: async (url) => { if (url.endsWith("fr.json")) throw SENTINEL; return response([real(url)]); },
    }),
    "fetch pre-read",
  );
  assertLoadingError(error, "fetch pre-read");
  assert.strictEqual(error.failures.length, 1);
  // Plan 6.2:2078 — Fetch acquisition/HTTP failures use stage `fetch`. NOT `read`: the two doors
  // have their own acquisition stage and there is no shared one to compare across them.
  assert.strictEqual(error.failures[0].stage, "fetch");
  assert.strictEqual(error.failures[0].cause, SENTINEL);
});

test("Fetch door: a body that throws MID-STREAM hands back the caught value itself", async () => {
  // **THE ARM THAT EXERCISES A DIFFERENT LINE OF THE RUNNER.** `FETCH_TRANSPORT.read` wraps only the
  // `fetchImpl(...)` call in its try; the bounded body read runs outside it. So this value reaches
  // `runPlan`'s catch as a RAW thrown Error with no `{stage, cause}` envelope, and lands in
  // `LoadFailure.cause` through the `?? failure` fallback rather than through `failure.cause`.
  // Ablating the transport's own catch leaves this arm green and turns the pre-read arm red, which
  // is the evidence that the two are not one probe written twice.
  const { directory, manifest } = await publish(TWO_CATALOGS, { publicationBaseUrl: "https://example.test/strings/" });
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("fetch-midstream");

  // THE CHUNKED CONTROL for this door: two chunks, then a clean end.
  const clean = await loadEntireManifest(manifest, {
    fetch: async (url) => { const b = real(url); return response([b.subarray(0, 5), b.subarray(5)]); },
  });
  assert.strictEqual(clean.complete, true);
  assert.deepEqual(Object.keys(clean.catalogs).sort(), ["en-US", "fr"]);

  let broken = /** @type {any} */ (null);
  const error = await rejection(
    loadEntireManifest(manifest, {
      fetch: async (url) => {
        if (!url.endsWith("fr.json")) return response([real(url)]);
        return (broken = response([real(url).subarray(0, 8)], { failWith: SENTINEL }));
      },
    }),
    "fetch mid-stream",
  );
  assertLoadingError(error, "fetch mid-stream");
  assert.strictEqual(error.failures.length, 1);
  assert.strictEqual(error.failures[0].stage, "fetch");
  assert.strictEqual(error.failures[0].cause, SENTINEL);
  // And the reader is released on the way out — on a real connection, a socket that is returned.
  assert.strictEqual(broken.cancelState.cancelled, 1);
});

// ---------------------------------------------------------------------------------------------
// C2 — a CAUGHT cause's text is never copied into the aggregate's redacted message.
//      Both doors, and at BOTH cardinalities: every aggregate-message implementation in the wild
//      branches on failure count, and a leak that lives only in the plural join is green on a
//      one-failure fixture.
// ---------------------------------------------------------------------------------------------

/**
 * @param {any} error @param {readonly Error[]} sentinels @param {string} what
 */
function assertNoCauseTextCopied(error, sentinels, what) {
  // ANTI-VACUITY FIRST: the token must actually be in the cause IN THIS RUN. Without it a typo in
  // the sentinel makes every absence assertion below pass with nothing behind it.
  for (const [index, expected] of sentinels.entries())
    assert.ok(
      String(error.failures[index].cause?.message).includes(SENTINEL_TOKEN),
      `${what}: failure ${index}'s cause does not carry the token; the absence checks would be vacuous`,
    );
  // NON-SILENCE: "no cause text" must not be satisfiable by emitting nothing.
  assert.ok(error.message.trim().length >= MINIMUM_MESSAGE_LENGTH,
    `${what}: the aggregate message is empty or near-empty: ${JSON.stringify(error.message)}`);
  // THE CLAIM, once per sentinel, printing the offending message so a red explains itself.
  for (const expected of sentinels) {
    assert.ok(!error.message.includes(expected.message),
      `${what}: the aggregate message copied a cause's text — ${JSON.stringify(error.message)}`);
    // A second, credential-shaped token, so a reader of the red sees the LEAK CLASS and not just a
    // string mismatch.
    const hunter = /** @type {RegExpMatchArray} */ (expected.message.match(/ZQX-HUNTER\S*/));
    assert.ok(!error.message.includes(hunter[0]),
      `${what}: the aggregate message carries a caller-supplied credential — ${JSON.stringify(error.message)}`);
  }
}

test("Node door: ONE caught cause's text is not copied into the aggregate message", async () => {
  const { directory, manifest } = await publish(TWO_CATALOGS);
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("node-single");

  const error = await rejection(
    loadEntireManifestFromFiles(manifest, {
      readFile: async (url) => { if (url.endsWith("fr.json")) throw SENTINEL; return real(url); },
    }),
    "node single",
  );
  assertLoadingError(error, "node single");
  assert.strictEqual(error.failures.length, 1);
  assertNoCauseTextCopied(error, [SENTINEL], "node single");

  // THE SECOND CONTROL, and it belongs to this conjunct specifically: the diagnostic detail a caller
  // needs IS available, on the channel plan 3.5:1123 designates. Without it this test could be read
  // as "the library tells you nothing", which is a different defect that would also pass above.
  assert.strictEqual(error.failures[0].stage, "read");
  assert.ok(error.failures[0].url.endsWith("fr.json"), error.failures[0].url);
  assert.strictEqual(error.failures[0].cause, SENTINEL);
});

test("Fetch door: ONE caught cause's text is not copied into the aggregate message", async () => {
  const { directory, manifest } = await publish(TWO_CATALOGS, { publicationBaseUrl: "https://example.test/strings/" });
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("fetch-single");

  const error = await rejection(
    loadEntireManifest(manifest, {
      fetch: async (url) => { if (url.endsWith("fr.json")) throw SENTINEL; return response([real(url)]); },
    }),
    "fetch single",
  );
  assertLoadingError(error, "fetch single");
  assert.strictEqual(error.failures.length, 1);
  assertNoCauseTextCopied(error, [SENTINEL], "fetch single");
  assert.strictEqual(error.failures[0].stage, "fetch");
  assert.ok(error.failures[0].url.endsWith("fr.json"), error.failures[0].url);
});

/** Three non-fallback catalogs, each broken by its OWN sentinel. Plan order is normalized-tag order. */
const THREE_BROKEN = {
  "de.json": catalog("Guten Tag"),
  "en-US.json": catalog("Hello"),
  "fr.json": catalog("Bonjour"),
  "it.json": catalog("Ciao"),
};

/** Plan 6.2:2114 plans a whole-manifest load in normalized-tag order, so the failing tags are these. */
const BROKEN_TAGS = /** @type {const} */ (["de", "fr", "it"]);

test("Node door: THREE caught causes' text is not copied into the aggregate message", async () => {
  // THE PLURAL BRANCH. The natural singular wording is `Failed to load catalog fr`; the natural
  // plural is `… : <cause>; <cause>; <cause>`, because a list is what invites a join. An
  // implementation that leaks only in the plural is GREEN on every one-failure fixture above.
  const { directory, manifest } = await publish(THREE_BROKEN);
  const real = bytesFrom(directory);
  const sentinels = BROKEN_TAGS.map((tag, index) => sentinel(`node-plural-${index + 1}-${tag}`));
  const byTag = new Map(BROKEN_TAGS.map((tag, index) => [tag, sentinels[index]]));

  const error = await rejection(
    loadEntireManifestFromFiles(manifest, {
      readFile: async (url) => {
        for (const [tag, thrown] of byTag) if (url.endsWith(`${tag}.json`)) throw thrown;
        return real(url);
      },
    }),
    "node plural",
  );
  assertLoadingError(error, "node plural");
  assert.strictEqual(error.failures.length, 3);
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => f.locale), [...BROKEN_TAGS]);
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => f.stage), ["read", "read", "read"]);
  // IDENTITY AT CARDINALITY > 1: a runner that assembled its failure list from an arrival log could
  // retain every object and still pair the wrong cause with the wrong locale.
  for (const [index, expected] of sentinels.entries())
    assert.strictEqual(error.failures[index].cause, expected, `failure ${index} carries the wrong object`);
  assertNoCauseTextCopied(error, sentinels, "node plural");
});

test("Fetch door: THREE caught causes' text is not copied into the aggregate message", async () => {
  const { directory, manifest } = await publish(THREE_BROKEN, { publicationBaseUrl: "https://example.test/strings/" });
  const real = bytesFrom(directory);
  const sentinels = BROKEN_TAGS.map((tag, index) => sentinel(`fetch-plural-${index + 1}-${tag}`));
  const byTag = new Map(BROKEN_TAGS.map((tag, index) => [tag, sentinels[index]]));

  const error = await rejection(
    loadEntireManifest(manifest, {
      fetch: async (url) => {
        for (const [tag, thrown] of byTag) if (url.endsWith(`${tag}.json`)) throw thrown;
        return response([real(url)]);
      },
    }),
    "fetch plural",
  );
  assertLoadingError(error, "fetch plural");
  assert.strictEqual(error.failures.length, 3);
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => f.locale), [...BROKEN_TAGS]);
  for (const [index, expected] of sentinels.entries())
    assert.strictEqual(error.failures[index].cause, expected, `failure ${index} carries the wrong object`);
  assertNoCauseTextCopied(error, sentinels, "fetch plural");
});

// ---------------------------------------------------------------------------------------------
// C3a — every stage the loader can REACH names itself, and the cause is never the runner's own
//       classification envelope. Single-fault fixtures, each on the reject surface AND the
//       allow-partial surface, which assemble their failure lists in different code.
// ---------------------------------------------------------------------------------------------

/**
 * A valid catalog, plus one non-fallback catalog broken exactly one way.
 *
 * Plan 6.2:2082 permits a partial result only if the resolved fallback-locale file loaded and
 * validated, so every fixture breaks a NON-fallback catalog and keeps `en-US` intact — otherwise the
 * allow-partial half would reject and the test would report on a path it never took.
 *
 * Each entry supplies its own `broken` and `valid` bodies so the CONTROL differs from the fixture in
 * exactly one file and nothing else.
 *
 * @type {readonly { id: string, stage: string, door: "node" | "fetch",
 *   broken: string | Uint8Array, options?: any, transport?: (real: (url: string) => Uint8Array) => any }[]}
 */
const STAGE_FIXTURES = [
  {
    id: "fetch (acquisition, Fetch door)",
    stage: "fetch",
    door: "fetch",
    broken: catalog("Bonjour"),
    transport: (real) => ({
      fetch: async (/** @type {string} */ url) => {
        if (url.endsWith("fr.json")) throw new TypeError("ZQX-FETCH-ACQUISITION failed");
        return response([real(url)]);
      },
    }),
  },
  {
    id: "read (acquisition, Node door)",
    stage: "read",
    door: "node",
    broken: catalog("Bonjour"),
    transport: (real) => ({
      readFile: async (/** @type {string} */ url) => {
        if (url.endsWith("fr.json")) throw new Error("ZQX-READ-ACQUISITION failed");
        return real(url);
      },
    }),
  },
  {
    id: "limit (a VALID catalog, over the per-file cap)",
    stage: "limit",
    door: "node",
    // Entirely valid: the digest matches and the JSON parses. Only the cap fires. `en-US` is 20
    // bytes, this is ~600, and the cap sits between them, so exactly one file can charge it.
    broken: catalog("H".repeat(600)),
    options: { limits: { maximumInputBytes: 200 } },
  },
  {
    id: "digest (a LENGTH-PRESERVING perturbation of the served bytes)",
    stage: "digest",
    door: "node",
    broken: catalog("Bonjour"),
    // **LENGTH-PRESERVING ON PURPOSE.** The generator emits `decodedBytes` (measured), and plan
    // 6.2:2090 enforces the exact declared length WHILE STREAMING — i.e. before the digest is
    // compared. Appending so much as a trailing space therefore fails at `limit` and this fixture
    // would "cover" a stage it never reached. Substituting one character inside a translation value
    // keeps the body valid UTF-8, valid JSON, a valid catalog and the same length, leaving the
    // digest as the only thing wrong. The equal-length assertion below keeps it that way.
    transport: (real) => ({
      readFile: async (/** @type {string} */ url) => {
        if (!url.endsWith("fr.json")) return real(url);
        const clean = real(url);
        const perturbed = utf8.encode(new TextDecoder().decode(clean).replace("Bonjour", "Bonjouq"));
        assert.strictEqual(perturbed.byteLength, clean.byteLength,
          "the digest fixture must not change the body's LENGTH, or it fails at `limit` instead");
        return perturbed;
      },
    }),
  },
  {
    id: "parse (invalid UTF-8: a lone 0x80 continuation byte)",
    stage: "parse",
    door: "node",
    broken: new Uint8Array([...utf8.encode('{"Greeting":"'), 0x80, ...utf8.encode('"}')]),
  },
  {
    id: "parse (valid UTF-8, invalid JSON)",
    stage: "parse",
    door: "node",
    broken: '{"Greeting":',
  },
  {
    id: "parse (valid JSON, invalid catalog)",
    stage: "parse",
    door: "node",
    broken: JSON.stringify({ ZQXVALIDATETOKEN: { translation: 42 } }),
  },
];

/**
 * @param {typeof STAGE_FIXTURES[number]} fixture
 * @param {{ broken: boolean, partial: boolean }} how
 */
async function runStageFixture(fixture, how) {
  const { directory, manifest } = await publish(
    { "en-US.json": catalog("Hello"), "fr.json": how.broken ? fixture.broken : catalog("Bonjour") },
    fixture.door === "fetch" ? { publicationBaseUrl: "https://example.test/strings/" } : {},
  );
  const real = bytesFrom(directory);
  // A control run replaces the MISBEHAVING transport with an honest one and changes nothing else:
  // the injected reader exists only to misbehave, so keeping it would make the control a different
  // test, and dropping the limits with it would make the `limit` control prove nothing.
  const honest = fixture.door === "fetch"
    ? { fetch: async (/** @type {string} */ url) => response([real(url)]) }
    : {};
  const options = {
    ...(fixture.options ?? {}),
    ...(how.broken ? fixture.transport?.(real) ?? honest : honest),
    ...(how.partial ? { partialFailure: "allow-partial" } : {}),
  };
  const load = fixture.door === "fetch"
    ? loadEntireManifest(manifest, options)
    : loadEntireManifestFromFiles(manifest, options);
  return { load, manifest };
}

test("C3a: reachable stages name themselves and never hand back the runner's classification envelope", async () => {
  for (const fixture of STAGE_FIXTURES)
    for (const partial of [false, true]) {
      const surface = partial ? "allow-partial" : "reject";
      const what = `${fixture.id} [${surface}]`;
      const { load } = await runStageFixture(fixture, { broken: true, partial });

      /** @type {any} */
      let failures;
      if (partial) {
        // The call must RESOLVE — that is the first half of proving the allow-partial path ran.
        const result = /** @type {any} */ (await load);
        assert.strictEqual(result.complete, false, what);
        failures = result.failures;
      } else {
        const error = await rejection(load, what);
        assertLoadingError(error, what);
        failures = error.failures;
      }

      // STAGE BY NAME, FIRST. This is the enforcement that the fixture reaches the stage it CLAIMS:
      // if the digest fixture's length ever drifts it reads `limit` here and goes red, instead of
      // silently reporting that the digest stage is covered.
      assert.strictEqual(failures.length, 1, `${what}: expected exactly one failure`);
      assert.strictEqual(failures[0].stage, fixture.stage, what);
      assert.strictEqual(failures[0].locale, "fr", what);

      // `"cause" in failure` is TRUE BY CONSTRUCTION — `run-plan.js` always writes the key — so it
      // is recorded here and is NOT the instrument; `DECLARED_LOAD_CAUSE_SHAPES` below is.
      assert.ok("cause" in failures[0], what);
      // THE FALSIFIABLE HALF: the cause must not be the runner's own `{stage, cause}` envelope
      // leaking through its `?? failure` fallback. A stage that authors a finding and attaches no
      // cause to it lands exactly there, and that is the shape this catches.
      const cause = failures[0].cause;
      assert.ok(
        !(cause && typeof cause === "object" && "stage" in cause),
        `${what}: the cause is the runner's classification envelope, not a causal chain: ${JSON.stringify(cause)}`,
      );
    }
});

test("C3a control: every stage fixture loads completely when its one fault is removed", async () => {
  // ONE CONTROL PER FIXTURE. This is the load-bearing half of C3a: it is what proves each fixture
  // reaches the stage it names rather than tripping an earlier guard, and that the manifest, the
  // limits and the injected transport are not themselves the reason anything failed.
  for (const fixture of STAGE_FIXTURES) {
    const { load } = await runStageFixture(fixture, { broken: false, partial: false });
    const result = /** @type {any} */ (await load);
    assert.strictEqual(result.complete, true, fixture.id);
    assert.strictEqual(result.failures.length, 0, fixture.id);
    assert.deepEqual(Object.keys(result.catalogs).sort(), ["en-US", "fr"], fixture.id);
  }
});

// ---------------------------------------------------------------------------------------------
// C3b — the DECLARED shape of `cause` at each stage. RECORDED, not derived from the plan.
// ---------------------------------------------------------------------------------------------

/**
 * What `LoadFailure.cause` actually holds, per stage, pinned in BOTH directions.
 *
 * **THIS IS A DECLARATION, NOT A PLAN REQUIREMENT, and the distinction is the whole point.** Plan
 * 3.5:1127's first half is conditional — `Error.cause` is used "when there is a library-owned causal
 * chain" — and at `digest` and `limit` nothing was thrown: the library measured a mismatch and
 * authored the finding itself. Asserting `cause instanceof Error` there as a requirement would be
 * inventing a rule nobody wrote, which is the over-declining mirror this project has already caught.
 * Plan 6.2:1971's `readonly cause: unknown` does not settle it either: the sibling declarations at
 * :821 and :993 are spelled `unknown | null`, which REDUCES to `unknown` in TypeScript, so the
 * "required and non-nullable versus optional" contrast that reading depends on does not exist.
 *
 * So the table records what the port does, in the `DECLARED_MESSAGE_DIVERGENCES` idiom: a change in
 * either direction fails the run. A string cause at `limit` goes red; an `Error` cause appearing
 * where `Object` is recorded goes red too, and the right response to THAT red is to update this
 * table, not to widen it.
 *
 * **MAINTAINER QUESTION, recorded rather than answered:** does a finding the library authored
 * (digest mismatch, byte cap exceeded) constitute a "library-owned causal chain" obliging a cause
 * object? Until that is answered, clause 76 cannot be called PROVEN on the strength of these rows.
 */
const DECLARED_LOAD_CAUSE_SHAPES = /** @type {const} */ ([
  ["fetch (acquisition, Fetch door)", "fetch", "TypeError", null],
  ["read (acquisition, Node door)", "read", "Error", null],
  ["limit (a VALID catalog, over the per-file cap)", "limit", "RangeError", null],
  ["digest (a LENGTH-PRESERVING perturbation of the served bytes)", "digest", "Error", null],
  ["parse (invalid UTF-8: a lone 0x80 continuation byte)", "parse", "StringsParseError", "STRINGS_PARSE"],
  ["parse (valid UTF-8, invalid JSON)", "parse", "StringsParseError", "STRINGS_PARSE"],
  ["parse (valid JSON, invalid catalog)", "parse", "StringsParseError", "STRINGS_PARSE"],
]);

test("C3b: the declared cause SHAPE at each reachable stage, pinned in both directions", async () => {
  /** @type {unknown[][]} */
  const observed = [];
  for (const fixture of STAGE_FIXTURES) {
    const { load } = await runStageFixture(fixture, { broken: true, partial: false });
    const error = await rejection(load, fixture.id);
    assertLoadingError(error, fixture.id);
    const cause = error.failures[0].cause;
    observed.push([fixture.id, error.failures[0].stage, cause?.constructor?.name ?? null, cause?.code ?? null]);
  }
  assert.deepEqual(observed, DECLARED_LOAD_CAUSE_SHAPES.map((row) => [...row]));
});

test("the stage vocabulary the port can actually emit — `decode` and `validate` are declared and never reached", () => {
  // **A RECORD, AND A STALENESS GATE ON IT.** Plan 6.2:1963-1969 declares a seven-member `stage`
  // union. Measured here and above: the port emits FIVE of them. `run-plan.js` reports every
  // decode, syntax and validation failure as `parse` — its own comment says so ("the parser owns the
  // decode/parse/validate distinction; a fatal UTF-8 failure surfaces from it as a parse error too")
  // — and three of the fixtures above prove it by producing three different kinds of `parse`.
  //
  // This assertion exists so that a design derived from the plan's seven-member union cannot be
  // written against this port without the divergence being visible: the day `decode` or `validate`
  // starts being emitted, this goes red and the record is corrected rather than quietly outgrown.
  const emitted = new Set(DECLARED_LOAD_CAUSE_SHAPES.map(([, stage]) => stage));
  assert.deepEqual([...emitted].sort(), ["digest", "fetch", "limit", "parse", "read"]);
  const declaredByPlan = ["fetch", "read", "limit", "digest", "decode", "parse", "validate"];
  assert.deepEqual(declaredByPlan.filter((stage) => !emitted.has(stage)), ["decode", "validate"]);
});

// ---------------------------------------------------------------------------------------------
// C4 — the no-copy rule holds for causes the LIBRARY AUTHORED, not only for caught ones.
// ---------------------------------------------------------------------------------------------

/**
 * Four non-fallback catalogs, each broken at a different library-authored stage, in ONE run.
 *
 * **C2 IS COMPLETELY GREEN UNDER THIS CONJUNCT'S ABLATION**, which is why it exists separately: a
 * message builder that inlines only the causes the library wrote — "a cause we authored contains no
 * caller data, so it is safe to show" — leaks four authored sentences into every load failure while
 * C2's caught-cause sentinels stay absent.
 *
 * **THE TIER COLUMN IS PART OF THE ASSERTION, not a comment.** Unlike C2 this test does not choose
 * the cause's wording, so a whole-message containment check would be comparing against text the
 * fixture does not control — a red to READ, not an automatic defect. Two of the four rows carry a
 * string the fixture DOES control (the SHA-256 hex it served, the key name it injected) and are
 * gated on it; the other two carry only a byte count and a source location, and are OBSERVED. The
 * tier is asserted alongside the stage so an ungated row is VISIBLE rather than silently skipped by
 * a length filter — which in the first draft of this design would have turned a terse authored
 * message into a false red.
 */
const AUTHORED_ROWS = /** @type {const} */ ([
  ["de", "digest", "gated: the two SHA-256 hex strings the fixture served and declared"],
  ["es", "limit", "OBSERVED ONLY: the message is a byte count; no token the fixture can inject"],
  ["fr", "parse", "OBSERVED ONLY: a syntax failure names the source and location, not the content"],
  ["it", "parse", "gated: the key name the fixture injected"],
]);

const AUTHORED_KEY_TOKEN = "ZQXVALIDATETOKEN";

/** @param {boolean} broken */
async function authoredFixture(broken) {
  const { directory, manifest } = await publish({
    "en-US.json": catalog("Hello"),
    "de.json": catalog("Guten Tag"),
    "es.json": broken ? catalog("H".repeat(600)) : catalog("Hola"),
    "fr.json": broken ? '{"Greeting":' : catalog("Bonjour"),
    "it.json": broken ? JSON.stringify({ [AUTHORED_KEY_TOKEN]: { translation: 42 } }) : catalog("Ciao"),
  });
  const real = bytesFrom(directory);
  const served = broken
    ? utf8.encode(catalog("Guten Tqg"))
    : null;
  const options = {
    limits: { maximumInputBytes: 300 },
    readFile: async (/** @type {string} */ url) =>
      broken && url.endsWith("de.json") ? /** @type {Uint8Array} */ (served) : real(url),
  };
  return { manifest, options, served };
}

test("C4: an AUTHORED cause's text is not copied into the aggregate message", async () => {
  const { manifest, options, served } = await authoredFixture(true);
  // The digest fixture is length-preserving here for the same reason it is in C3a.
  assert.strictEqual(/** @type {Uint8Array} */ (served).byteLength, manifest.files["de"]?.decodedBytes);

  const error = await rejection(loadEntireManifestFromFiles(manifest, options), "authored");
  assertLoadingError(error, "authored");

  // ANCHOR, ORDER-FREE. All four failures must be present, or the loop below runs too few times —
  // but fetch-plan ORDER is a different clause's property, and asserting it here would misattribute
  // an ordering regression to the redaction clause.
  assert.strictEqual(error.failures.length, 4);
  const byLocale = new Map(error.failures.map((/** @type {any} */ f) => [f.locale, f]));
  assert.deepEqual(
    [...byLocale.keys()].sort(),
    AUTHORED_ROWS.map(([locale]) => locale).slice().sort(),
  );
  assert.deepEqual(
    AUTHORED_ROWS.map(([locale, , tier]) => [locale, byLocale.get(locale).stage, tier]),
    AUTHORED_ROWS.map((row) => [...row]),
  );

  // NON-SILENCE, so the containment checks below are not passing because there is nothing to check.
  assert.ok(error.message.trim().length >= MINIMUM_MESSAGE_LENGTH, JSON.stringify(error.message));

  // Every row, gated or observed, must at least CARRY a message — otherwise "its text is absent" is
  // true of a cause that has no text.
  for (const [locale] of AUTHORED_ROWS) {
    const message = byLocale.get(locale).cause?.message;
    assert.ok(typeof message === "string" && message.length > 0,
      `${locale}: the authored cause carries no message, so nothing below is being checked`);
  }

  // GATED ROW 1 — `digest`. Both 64-hex strings are fixture-controlled and maximum entropy: neither
  // can appear in a redacted message except by being copied out of the cause.
  const declaredDigest = /** @type {string} */ (manifest.files["de"]?.sha256);
  const servedDigest = sha256Hex(/** @type {Uint8Array} */ (served));
  assert.notStrictEqual(declaredDigest, servedDigest, "the digest fixture must actually differ");
  const digestCause = String(byLocale.get("de").cause.message);
  assert.ok(digestCause.includes(declaredDigest) && digestCause.includes(servedDigest),
    `anti-vacuity: the digest cause names neither hex string — ${digestCause}`);
  assert.ok(!error.message.includes(declaredDigest), error.message);
  assert.ok(!error.message.includes(servedDigest), error.message);

  // GATED ROW 2 — the validation failure, whose message names the key the FIXTURE chose.
  const validateCause = String(byLocale.get("it").cause.message);
  assert.ok(validateCause.includes(AUTHORED_KEY_TOKEN),
    `anti-vacuity: the validation cause does not name the injected key — ${validateCause}`);
  assert.ok(!error.message.includes(AUTHORED_KEY_TOKEN), error.message);
});

test("C4 control: the same five-catalog directory with no faults loads completely", async () => {
  const { manifest, options } = await authoredFixture(false);
  const loaded = await loadEntireManifestFromFiles(manifest, options);
  assert.strictEqual(loaded.complete, true);
  assert.strictEqual(loaded.failures.length, 0);
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["de", "en-US", "es", "fr", "it"]);
});

// ---------------------------------------------------------------------------------------------
// C5 — retention by reference on the allow-partial RESULT surface, which is different code from
//      the thrown aggregate and is the surface nobody watches, because it is the success path.
// ---------------------------------------------------------------------------------------------

/**
 * @param {"node" | "fetch"} door
 */
async function partialRetention(door) {
  const { directory, manifest } = await publish(TWO_CATALOGS,
    door === "fetch" ? { publicationBaseUrl: "https://example.test/strings/" } : {});
  const real = bytesFrom(directory);
  const SENTINEL = sentinel(`${door}-partial`);
  const broken = door === "fetch"
    ? { fetch: async (/** @type {string} */ url) => { if (url.endsWith("fr.json")) throw SENTINEL; return response([real(url)]); } }
    : { readFile: async (/** @type {string} */ url) => { if (url.endsWith("fr.json")) throw SENTINEL; return real(url); } };
  const load = (/** @type {any} */ options) => door === "fetch"
    ? loadEntireManifest(manifest, options)
    : loadEntireManifestFromFiles(manifest, options);
  return { load, broken, real, SENTINEL, door };
}

for (const door of /** @type {const} */ (["node", "fetch"])) {
  test(`${door} door: allow-partial retains the caught cause BY IDENTITY on the result surface`, async () => {
    const { load, broken, real, SENTINEL } = await partialRetention(door);

    // THE CONTROL: neither the manifest nor `allow-partial` is itself the reason anything failed.
    const honest = door === "fetch"
      ? { fetch: async (/** @type {string} */ url) => response([real(url)]) }
      : { readFile: async (/** @type {string} */ url) => real(url) };
    const clean = /** @type {any} */ (await load({ ...honest, partialFailure: "allow-partial" }));
    assert.strictEqual(clean.complete, true);
    assert.strictEqual(clean.failures.length, 0);
    assert.deepEqual(Object.keys(clean.catalogs).sort(), ["en-US", "fr"]);

    // The call must RESOLVE, not reject — the first half of proving the partial path ran at all.
    const result = /** @type {any} */ (await load({ ...broken, partialFailure: "allow-partial" }));
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].stage, door === "fetch" ? "fetch" : "read");
    // Plan 6.2:2082 permits a partial result ONLY if the resolved fallback file loaded and
    // validated; asserting it here is what keeps this from reporting on a path it never took.
    assert.ok(Object.keys(result.catalogs).includes("en-US"));
    assert.ok(!Object.keys(result.catalogs).includes("fr"));

    // THE CLAIM. The predictable ablation on this surface is a SERIALIZABLE failure record —
    // `cause: { name, message }` — which someone reaches for the moment they notice that an Error
    // does not survive `JSON.stringify`, and `LoadedStrings` is exactly the object the SSR stamp
    // path hands across a realm boundary. Under it the cause is still truthy, still carries `name`
    // and `message`, and only `===` tells the two apart.
    assert.strictEqual(result.failures[0].cause, SENTINEL);

    // Plan 3.5:1123 freezes the aggregate's `failures`; the result surface freezes them too. The
    // pairing matters: a FROZEN record holding a COPY is indistinguishable from a frozen record
    // holding the caught object without the identity assertion above.
    assert.ok(Object.isFrozen(result.failures));
    assert.ok(Object.isFrozen(result.failures[0]));
  });
}

test("Node door: allow-partial retains a MID-STREAM cause by identity too", async () => {
  // The result assembler is transport-independent; the CATCH SITE is not. Without this arm the
  // partial surface is probed at one of the two sites C1 probes on the throw surface.
  const { directory, manifest } = await publish(TWO_CATALOGS);
  const real = bytesFrom(directory);
  const SENTINEL = sentinel("node-partial-midstream");

  const result = /** @type {any} */ (await loadEntireManifestFromFiles(manifest, {
    partialFailure: "allow-partial",
    readFile: async (url) => {
      if (!url.endsWith("fr.json")) return real(url);
      const bytes = real(url);
      return (async function* () { yield bytes.subarray(0, 8); throw SENTINEL; })();
    },
  }));
  assert.strictEqual(result.complete, false);
  assert.strictEqual(result.failures.length, 1);
  assert.strictEqual(result.failures[0].stage, "read");
  assert.strictEqual(result.failures[0].cause, SENTINEL);
});

// ---------------------------------------------------------------------------------------------
// The same proposition on two further code paths the load subsystem owns.
// ---------------------------------------------------------------------------------------------

test("REPORTED DEFECT, pinned: a mid-stream Fetch error carrying its OWN `Error.cause` is UNWRAPPED", async () => {
  // **THIS IS A FINDING, NOT A PROPERTY WORTH HAVING**, and it is pinned so that fixing it turns
  // this test red and forces the record to be corrected rather than quietly outgrown.
  //
  // `run-plan.js`'s catch reads `cause: failure?.cause ?? failure`, where `failure.cause` is meant to
  // be the `{stage, cause}` ENVELOPE's cause. A value that reaches the runner unenveloped — which on
  // the Fetch door is every body-stream failure, because the read loop runs outside
  // `FETCH_TRANSPORT.read`'s try — is read the same way. So an `Error` that legitimately carries its
  // own `Error.cause` has its OUTER error silently discarded and its INNER error recorded instead.
  //
  // The shape is not hypothetical: undici rejects a broken connection with
  // `TypeError("terminated", { cause: Error("other side closed") })`, and it is the outer error that
  // carries the classification. Clause 76 is about causal chains; this TRUNCATES one.
  //
  // THE ASYMMETRY IS THE PROOF IT IS A DEFECT RATHER THAN A DESIGN: the Node door's transport
  // envelopes the same value inside its own catch, so the identical error keeps its identity there.
  const { directory, manifest } = await publish(TWO_CATALOGS, { publicationBaseUrl: "https://example.test/strings/" });
  const fetchReal = bytesFrom(directory);
  const inner = new Error("ZQX-INNER other side closed");
  const outer = new TypeError("ZQX-OUTER terminated", { cause: inner });

  const fetchError = await rejection(
    loadEntireManifest(manifest, {
      fetch: async (url) => url.endsWith("fr.json")
        ? response([fetchReal(url).subarray(0, 8)], { failWith: outer })
        : response([fetchReal(url)]),
    }),
    "fetch unwrap",
  );
  assertLoadingError(fetchError, "fetch unwrap");
  assert.strictEqual(fetchError.failures[0].cause, inner,
    "DECLARED (reported defect): the Fetch door records the INNER error and drops the wrapper");
  assert.notStrictEqual(fetchError.failures[0].cause, outer);

  // The control that makes the above a defect rather than a taxonomy: the same error, same
  // mid-stream position, on the door whose transport envelopes it.
  const { directory: nodeDirectory, manifest: nodeManifest } = await publish(TWO_CATALOGS);
  const nodeReal = bytesFrom(nodeDirectory);
  const nodeError = await rejection(
    loadEntireManifestFromFiles(nodeManifest, {
      readFile: async (url) => {
        if (!url.endsWith("fr.json")) return nodeReal(url);
        const bytes = nodeReal(url);
        return (async function* () { yield bytes.subarray(0, 8); throw outer; })();
      },
    }),
    "node unwrap control",
  );
  assert.strictEqual(nodeError.failures[0].cause, outer,
    "the Node door keeps the wrapper, which is what the Fetch door should also do");
});

test("abort rejects with the CALLER's own reason object, by identity", async () => {
  // Plan 6.2:2088 — abort cancels outstanding work and rejects, and is never converted into partial
  // success. The reason is a caught, caller-supplied value on a third code path, so it is C1's
  // proposition again: `new Error("aborted")` in place of `signal.reason` is still an Error, still
  // truthy, and only `===` separates it from the object the caller aborted with.
  const { directory, manifest } = await publish(TWO_CATALOGS);
  const real = bytesFrom(directory);
  const controller = new AbortController();
  const REASON = new Error("ZQX-ABORT-REASON");

  // THE CONTROL: the same call with a signal that is never aborted must load cleanly, so a red
  // below is the abort path and not the signal being plumbed into the reader at all.
  const clean = await loadEntireManifestFromFiles(manifest, {
    signal: controller.signal, readFile: async (url) => real(url),
  });
  assert.strictEqual(clean.complete, true);

  const error = await rejection(
    loadEntireManifestFromFiles(manifest, {
      signal: controller.signal,
      readFile: async (url) => { controller.abort(REASON); return real(url); },
    }),
    "abort",
  );
  assert.strictEqual(error, REASON);
  // And it is NOT a partial result wearing an error's clothes: there is no `failures` channel here.
  assert.strictEqual(error.failures, undefined);
});

test("readStringsManifest wraps the decoder's failure as `cause` — and DOES copy its text", async () => {
  // **RECORDED, NOT GATED AS A PASS.** Plan 6.2:2071 routes raw manifest syntax failures through
  // `parseStringsManifest` as `StringsParseError`, which is the clearest library-owned causal chain
  // in the subsystem, and clause 76 governs it as much as it governs `LoadFailure`. Measured:
  //
  //   - the chain EXISTS — `cause` is the Error the bounded reader threw, and it is not the wrapper;
  //   - and the wrapper's message is its cause's message, CHARACTER FOR CHARACTER.
  //
  // `parse-diagnostics.js`'s `rethrowAsParseError` says why: the inner error "composes Java's
  // wording already, including the `<source>: ` prefix, so the message passes through untouched and
  // the original becomes `cause`". That is a deliberate port decision about a LIBRARY-AUTHORED
  // message, not a foreign-text leak — but it is literally the shape clause 76's second half
  // forbids, so it is pinned here in both directions rather than argued either way. A reviewer who
  // changes it should have to delete this assertion and say which reading won.
  const { directory, manifest } = await publish(TWO_CATALOGS);

  // THE CONTROL FIRST: the SAME door over a well-formed manifest reads it back, so a red below is
  // the syntax failure and not this door refusing everything handed to it.
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  const roundTrip = await readStringsManifest(join(directory, "manifest.json"));
  assert.strictEqual(roundTrip.catalogFingerprint, manifest.catalogFingerprint);

  writeFileSync(join(directory, "truncated.json"), '{"formatVersion":1,');
  const error = await rejection(readStringsManifest(join(directory, "truncated.json")), "manifest syntax");
  assert.strictEqual(error.name, "StringsParseError");
  assert.strictEqual(error.code, "STRINGS_PARSE");
  assert.ok(error.cause instanceof Error, "the causal chain is absent");
  assert.notStrictEqual(error.cause, error, "the error is its own cause");
  assert.strictEqual(error.message, error.cause.message,
    "DECLARED: the manifest parse wrapper passes its cause's message through untouched");
});
