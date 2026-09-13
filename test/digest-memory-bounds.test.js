// @ts-check
/**
 * M8 acceptance clause 25 — the LOADER half of plan 6.2:2094-2096: "Because `SubtleCrypto.digest` is
 * not streaming, the loader counts chunks against the 8 MiB cap, retains one bounded file body, then
 * digests it. Peak-memory benchmarks include that buffer and digest copy."
 *
 * **WHY THE OBVIOUS PROBE PROVES NOTHING, three times over.**
 *
 *   1. *One over-cap chunk.* The obvious fixture hands the loader a single body larger than the cap
 *      and asserts `stage === "limit"`. On that input the RUNNING TOTAL of streamed octets, the
 *      CURRENT chunk's length, the manifest's declared `decodedBytes` and the `Content-Length` header
 *      all agree, so every one of those four implementations is green. The discriminating input is a
 *      body that crosses the cap only in aggregate — cap+1 octets in 8 KiB chunks, with no declared
 *      length and a lying header — where the four quantities give different answers. The single-chunk
 *      case is kept below anyway, as the LANDING CHECK: it must stay green under a misplaced
 *      comparison and can only go red if the guard was deleted rather than moved.
 *   2. *Result-only assertions.* A loader that drains the whole body and measures the assembled
 *      length afterwards produces the same rejection, the same failure list, the same locale, the
 *      same URL and the same `limit` stage as one that stops at the crossing byte. Every verdict
 *      assertion in this file is invisible to that mutation — which is the mutation plan 6.2's
 *      sentence exists to rebut, since a loader that buffers 4 MiB before refusing has already blown
 *      the bound the clause establishes. The observation that separates them is how many chunks the
 *      transport was asked to DELIVER, counted at the source. That counter is what proves clause 25
 *      here; `cancels` is recorded but deliberately NOT gated (see the note on it below).
 *   3. *"Then digests it" is an ORDER,* and an order is only observable by catching the system
 *      between its steps. The only one of the three steps that leaves a trace at the public boundary
 *      is the digest, so the discriminating observation is its NON-OCCURRENCE on the one input that
 *      must never reach it — with a control that must record a call, because a zero-reading control
 *      would mean the spy is not where the loader looks and every non-invocation assertion below is
 *      vacuous rather than satisfied.
 *
 * **THE BOM IS THE SOLE DISCRIMINATOR FOR ONE ARM, and this file proves that rather than asserting
 * it.** A plausible implementation digests the DECODED text re-encoded (`TextEncoder().encode(text)`)
 * because the parser wants the text anyway. For any well-formed UTF-8 body that round trip is
 * byte-for-byte identical — non-ASCII included — so a fixture with accented text and no BOM is green
 * over that defect. The only octets it loses are a BOM's three (plan 6.1:1911-1913: the digest covers
 * the bytes "after HTTP content coding but before UTF-8 decoding or BOM removal"). The three-file
 * fixture below therefore carries an 8,193-octet non-ASCII body WITHOUT a BOM and a 20,000-octet one
 * WITH one, and asserts both round-trip facts before the load, so the claim is measured rather than
 * argued. That is the `Zzzz` lesson in this subsystem: covering "digest matched / did not match" is
 * not the same as spelling the one input that separates raw octets from decoded text.
 *
 * **WHAT THIS FILE DOES NOT CLAIM.**
 *
 *   - The BENCHMARK sentence ("peak-memory benchmarks include that buffer and digest copy") is not
 *     gated here and cannot be: `SubtleCrypto.digest`'s internal copy of its input is not reportable
 *     from JS and lives outside the JS heap, and the only scenario that would carry a network-load
 *     peak-memory number is 0b, which the maintainer cut to M-R rather than run against a stand-in.
 *     Its standing executable residue is the byte length handed to `crypto.subtle.digest`, which IS
 *     "that buffer" and is pinned exactly below — so a future 0b harness reporting a peak below that
 *     number would contradict a value a machine already checks.
 *   - `cancels` is RECORDED, not gated. "Counts chunks against the cap" says nothing about releasing
 *     the reader; a loader that stops pulling and returns without cancelling satisfies clause 25
 *     completely. Reader release is `fetch-loader.test.js`'s never-ending-body assertion and belongs
 *     to the abort/release proposition, not to this one. Gating it here would hand a future
 *     maintainer a red whose cheapest fix is deleting a counter this project already paid for once.
 *   - Whether the ONE retained body is the loader's own copy or a deferred concatenation of the
 *     transport's chunk views is NOT probed. It is measurably the latter today, the clause sentence
 *     does not settle which reading it requires, and the question is the maintainer's; see the
 *     findings reported with this file.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, loadStrings, StringsLoadingError } from "../src/load/fetch-loader.js";

const utf8 = new TextEncoder();
/** An oracle INDEPENDENT of the port's own synchronous SHA-256, so a fixture digest is never self-certified. */
const nodeSha256 = (/** @type {Uint8Array} */ bytes) => createHash("sha256").update(bytes).digest("hex");

const CAP = 65536;
const DEFAULT_CAP = 8 * 1024 * 1024;
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/**
 * A body of EXACTLY `octets` octets of valid JSON, `umlauts` of them spent on two-octet characters.
 *
 * The exactness is the fixture: every assertion about the cap is an assertion about one octet either
 * side of it, so a body "about the right size" would make the boundary untestable.
 *
 * @param {number} octets @param {string} [filler] @param {number} [umlauts]
 */
function bodyOf(octets, filler = "a", umlauts = 0) {
  const bytes = utf8.encode(JSON.stringify({ Greeting: "ü".repeat(umlauts) + filler.repeat(octets - 15 - 2 * umlauts) }));
  assert.equal(bytes.length, octets, `fixture must be exactly ${octets} octets, not ${bytes.length}`);
  return bytes;
}

/**
 * A manifest whose fingerprint matches its contents and whose digests are the TRUE ones.
 *
 * `decodedBytes` is omitted by default and asserted absent by the callers that depend on it: plan
 * 6.1:1927 excludes `baseUrl`, `url` and `decodedBytes` from the identity projection, so dropping it
 * cannot invalidate the fingerprint — and a loader charging the cap to a declared length then has
 * nothing to charge, which is the whole point of the fixture.
 *
 * @param {Record<string, Uint8Array>} bodies
 * @param {{ fallbackLocale?: string, decodedBytes?: Record<string, number> }} [options]
 */
function manifestFor(bodies, { fallbackLocale = "en", decodedBytes } = {}) {
  const files = Object.fromEntries(Object.entries(bodies).map(([tag, bytes]) => [tag, {
    url: `${tag}.json`,
    sha256: nodeSha256(bytes),
    ...(decodedBytes?.[tag] === undefined ? {} : { decodedBytes: decodedBytes[tag] }),
  }]));
  const draft = {
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale, baseUrl: "https://example.test/c/", files, tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/**
 * A 200 response delivering `bytes` in fixed-size chunks, counting what the SOURCE handed over.
 *
 * `enqueued` is counted on the enqueue itself rather than on `pull`, because a `ReadableStream` with
 * the default queuing strategy invokes `pull` once more than it takes chunks — and whether that
 * trailing invocation happens at all differs between implementations, so a pull count would turn an
 * engine detail into a false "the mutation did not land" report.
 *
 * @param {Uint8Array} bytes @param {number} chunkSize @param {Record<string, string>} [headers]
 */
function chunkedResponse(bytes, chunkSize, headers) {
  const state = { enqueued: 0, cancels: 0, /** @type {number[]} */ chunkSizes: [] };
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const piece = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
      offset += piece.length;
      state.enqueued += 1;
      state.chunkSizes.push(piece.length);
      controller.enqueue(piece);
    },
    cancel() { state.cancels += 1; },
  });
  return { state, response: { ok: true, status: 200, headers: new Headers(headers ?? {}), body } };
}

/**
 * A 200 response willing to deliver `available` chunks and no more — the finite stand-in for a body
 * that never ends.
 *
 * Finite on purpose: this project has measured that a non-terminating ablation surfaces in CI as a
 * job timeout rather than a named red (the FIFO case in S14). The counter catches the same defect
 * and always terminates, so the quantity is exact and has no timing in it.
 *
 * @param {number} chunkSize @param {number} available
 */
function throttledEndlessResponse(chunkSize, available) {
  const state = { enqueued: 0, cancels: 0, available };
  const body = new ReadableStream({
    pull(controller) {
      if (state.enqueued >= available) { controller.close(); return; }
      state.enqueued += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(0x20));
    },
    cancel() { state.cancels += 1; },
  });
  return { state, response: { ok: true, status: 200, headers: new Headers(), body } };
}

/** An injected fetch dispatching by the file name the plan resolved. @param {Record<string, any>} byTag */
function fetchOf(byTag) {
  return async (/** @type {string} */ url) => {
    const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
    const response = byTag[tag];
    assert.ok(response, `the fixture has no response for '${tag}' (${url})`);
    return response;
  };
}

/**
 * A spy on the digest source plan 6.2:2092 names — `globalThis.crypto?.subtle?.digest`, read per load
 * rather than captured at import, which clause 24's proven fail-closed gate already exercises.
 */
function installDigestSpy() {
  const realCrypto = globalThis.crypto;
  const realSubtle = realCrypto.subtle;
  /** @type {{ alg: string | undefined, byteLength: number }[]} */
  const calls = [];
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      subtle: {
        /** @param {any} algorithm @param {any} data */
        digest(algorithm, data) {
          calls.push({ alg: typeof algorithm === "string" ? algorithm : algorithm?.name, byteLength: data.byteLength });
          return realSubtle.digest(algorithm, data);
        },
      },
    },
  });
  return {
    calls,
    restore: () => Object.defineProperty(globalThis, "crypto", { configurable: true, value: realCrypto }),
  };
}

/** @param {Promise<any>} promise */
const rejection = (promise) => promise.then(() => null, (error) => error);

// ---------------------------------------------------------------------------------------------
// 25.a — the compared quantity is the running total of streamed octets
// ---------------------------------------------------------------------------------------------

test("the per-file cap is charged to the RUNNING TOTAL of streamed octets, not to one chunk or a header", async () => {
  const over = bodyOf(CAP + 1);
  const source = manifestFor({ en: over });

  // FIXTURE PRECONDITIONS, asserted rather than assumed, so a fixture slip cannot be read as a cap
  // result. The body is deliberately PERFECT except for its size — valid JSON, digest declared
  // correctly, no declared length — so "it failed" can only mean the cap fired.
  assert.equal(source.files.en.decodedBytes, undefined,
    "no declared length may exist, or a loader charging the cap to it would look correct");
  assert.equal(source.files.en.sha256, nodeSha256(over));
  assert.doesNotThrow(() => JSON.parse(new TextDecoder().decode(over)));

  for (const [label, headers] of /** @type {[string, Record<string, string> | undefined][]} */ ([
    ["no Content-Length", undefined],
    // Permitted by plan 6.1:1913-1914 — "Encoded HTTP `Content-Length` is never compared for equality
    // to `decodedBytes`" — so a loader that reads it at all is already outside the specification, and
    // a value this false makes that visible instead of merely unproven.
    ["a false Content-Length of 100", { "content-length": "100" }],
  ])) {
    const { state, response } = chunkedResponse(over, 8192, headers);
    const error = await rejection(loadStrings(source, "en", {
      fetch: fetchOf({ en: response }), limits: { maximumInputBytes: CAP },
    }));

    assert.ok(error instanceof StringsLoadingError, `${label}: expected StringsLoadingError, got ${error}`);
    assert.equal(error.failures.length, 1, label);
    assert.equal(error.failures[0].locale, "en", label);
    assert.equal(error.failures[0].url, "https://example.test/c/en.json", label);
    assert.equal(error.failures[0].stage, "limit", label);
    // ATTRIBUTED to the per-file cap. `LoadFailure` has ONE `limit` member for both the per-file and
    // the aggregate budget, so without this the red is equally consistent with some other bound.
    assert.match(String(error.failures[0].cause.message), /exceeds the maximum of 65536 bytes/, label);

    // The property that makes the input discriminate: no single chunk is over the cap, so a loader
    // comparing `chunk.byteLength` would have accepted every one of them.
    assert.ok(state.enqueued > 1, `${label}: the body must arrive in several chunks, or nothing is tested`);
    assert.ok(Math.max(...state.chunkSizes) < CAP,
      `${label}: every chunk must be smaller than the cap; largest was ${Math.max(...state.chunkSizes)}`);
  }
});

test("a body of EXACTLY maximumInputBytes loads end to end", async () => {
  // The zh-123 guard for every red above. Without this, the rejections could have come from manifest
  // validation, the fingerprint check, the runtime-data check or the parser, and would prove nothing
  // about the cap. It also pins the boundary from the other side, so a loader that simply refuses
  // large-ish bodies cannot satisfy the pair.
  const at = bodyOf(CAP);
  const source = manifestFor({ en: at });
  const { state, response } = chunkedResponse(at, 8192);

  const loaded = await loadStrings(source, "en", {
    fetch: fetchOf({ en: response }), limits: { maximumInputBytes: CAP },
  });

  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.equal(state.enqueued, 8, "65,536 octets in 8 KiB chunks is exactly 8 deliveries");
  assert.equal(loaded.loadingLimits.maximumInputBytes, CAP, "the snapshot reports the cap that was applied");
  assert.equal(createStrings({ loaded, locale: "en" }).get("Greeting").length, CAP - 15,
    "the at-cap body must survive all the way to a constructed instance");
});

test("with no limits given the cap is the 8 MiB default, and one octet over it is refused", async () => {
  // Plan 4.5:1572 — "Per-file input bytes | 8 MiB" — is the cap clause 25 names by number. The cheap
  // 65,536 cap everywhere else in this file is an override; this test is what ties the two together.
  const small = bodyOf(3000);
  const { response: smallResponse } = chunkedResponse(small, 4096);
  const control = await loadStrings(manifestFor({ en: small }), "en", { fetch: fetchOf({ en: smallResponse }) });
  assert.equal(control.complete, true, "the default-limits control must pass end to end");
  assert.equal(control.loadingLimits.maximumInputBytes, DEFAULT_CAP);

  const over = bodyOf(DEFAULT_CAP + 1);
  const source = manifestFor({ en: over });
  assert.equal(source.files.en.decodedBytes, undefined);
  assert.equal(source.files.en.sha256, nodeSha256(over), "the over-cap body's only defect is its size");

  const { state, response } = chunkedResponse(over, 65536);
  const error = await rejection(loadStrings(source, "en", { fetch: fetchOf({ en: response }) }));
  assert.ok(error instanceof StringsLoadingError, `expected StringsLoadingError, got ${error}`);
  assert.equal(error.failures[0].stage, "limit");
  assert.match(String(error.failures[0].cause.message), /exceeds the maximum of 8388608 bytes/);
  assert.ok(Math.max(...state.chunkSizes) < DEFAULT_CAP, "no single chunk reaches the default cap either");
});

test("a SINGLE over-cap chunk is still refused — the landing check for a misplaced comparison", async () => {
  // Deliberately the WEAK fixture, kept for exactly one reason: it is the liveness check for the
  // per-chunk mutation. Under a loader comparing the current chunk's length this stays GREEN, so a
  // red here means the guard was deleted rather than moved, and the multi-chunk result above is then
  // a vacuous ablation rather than evidence.
  const over = bodyOf(CAP + 1);
  const { state, response } = chunkedResponse(over, over.length);
  const error = await rejection(loadStrings(manifestFor({ en: over }), "en", {
    fetch: fetchOf({ en: response }), limits: { maximumInputBytes: CAP },
  }));
  assert.equal(state.enqueued, 1, "the fixture must deliver the whole body in one chunk");
  assert.ok(error instanceof StringsLoadingError, `expected StringsLoadingError, got ${error}`);
  assert.equal(error.failures[0].stage, "limit");
});

test("the cap fires for a body whose manifest ALSO declares the over-cap length", async () => {
  // The landing check for the declared-length mutation, and green under both readings by design: a
  // loader charging the cap to `decodedBytes` has a value to charge here, so a red means the guard
  // was removed rather than re-pointed. Plan 6.1:1927 permits the field's presence or absence without
  // touching the fingerprint, which is what lets one fixture differ from the other in this one way.
  const over = bodyOf(CAP + 1);
  const source = manifestFor({ en: over }, { decodedBytes: { en: CAP + 1 } });
  assert.equal(source.files.en.decodedBytes, CAP + 1);

  const { response } = chunkedResponse(over, 8192);
  const error = await rejection(loadStrings(source, "en", {
    fetch: fetchOf({ en: response }), limits: { maximumInputBytes: CAP },
  }));
  assert.ok(error instanceof StringsLoadingError, `expected StringsLoadingError, got ${error}`);
  assert.equal(error.failures[0].stage, "limit");
  // The CAP's wording, not the declared-length guard's — the two are different sentences in the same
  // stage, and only this distinguishes which one refused.
  assert.match(String(error.failures[0].cause.message), /exceeds the maximum of 65536 bytes/);
});

test("the byte cap is charged PER FILE: three files just under it all load", async () => {
  // "Counts chunks against the cap" is per FILE, and with up to eight reads in flight (plan
  // 6.2:2087) the counter's SCOPE is a live design choice that no single-file probe can see. Three
  // files of 65,535 octets against a 65,536 cap is legal by every reading; a counter hoisted into the
  // plan runner refuses the second and third, which would be a user-visible refusal of a perfectly
  // legal manifest.
  const bodies = { en: bodyOf(CAP - 1, "a"), fr: bodyOf(CAP - 1, "b"), de: bodyOf(CAP - 1, "c") };
  const responses = Object.fromEntries(Object.entries(bodies).map(([tag, bytes]) =>
    [tag, chunkedResponse(bytes, 8192).response]));

  const loaded = await loadEntireManifest(manifestFor(bodies), {
    fetch: fetchOf(responses), limits: { maximumInputBytes: CAP },
  });

  assert.equal(loaded.failures.length, 0, "no file is over the per-file cap, so none may fail");
  assert.equal(loaded.complete, true);
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["de", "en", "fr"]);
});

// ---------------------------------------------------------------------------------------------
// 25.b — the count is charged WHILE the body streams
// ---------------------------------------------------------------------------------------------

test("the loader stops pulling within a chunk of the cap instead of draining the body", async () => {
  // THE ONLY OBSERVATION IN THIS FILE THAT SEPARATES "charged while streaming" FROM "charged after
  // draining". Both arms reject, with the same class, the same failure list and the same `limit`
  // stage — plan 6.2:2090's "byte limits are enforced while streaming" is a statement about WHEN, and
  // a verdict cannot carry it. 512 chunks of 8 KiB is 4 MiB, 64x the cap: a loader that assembles
  // first has already blown the bound the clause exists to establish, whatever its verdict says.
  const { state, response } = throttledEndlessResponse(8192, 512);
  const over = bodyOf(CAP + 1);
  const error = await rejection(loadStrings(manifestFor({ en: over }), "en", {
    fetch: fetchOf({ en: response }), limits: { maximumInputBytes: CAP },
  }));

  assert.ok(error instanceof StringsLoadingError, `expected StringsLoadingError, got ${error}`);
  assert.equal(error.failures[0].stage, "limit");
  // The bound is an ORDER OF MAGNITUDE, not an exact count: 9 chunks reach the crossing byte and the
  // stream's default queuing strategy buffers one ahead, so 10 is what this engine delivers — but a
  // trailing prefetch is an implementation detail and pinning it exactly would convert an engine
  // difference into a false "the mutation did not land" report.
  assert.ok(state.enqueued <= 16,
    `expected the read to stop near the cap; it took ${state.enqueued} of ${state.available} available chunks`);
  assert.ok(state.enqueued * 16 < state.available,
    "the source must be able to deliver far more than the loader took, or the bound is untested");
  // RECORDED, NOT GATED — see the file header. A loader that stops pulling without cancelling still
  // satisfies clause 25; reader release is a different proposition with its own gate.
  assert.ok(state.cancels <= 1, `observed ${state.cancels} cancellations`);
});

test("an at-cap body through the same source is delivered in exactly 8 chunks", async () => {
  // The zh-123 guard for the counter above: without it a small `enqueued` is equally consistent with
  // a transport the loader refused outright, and the probe would be measuring its own fixture.
  const at = bodyOf(CAP);
  const { state, response } = chunkedResponse(at, 8192);
  const loaded = await loadStrings(manifestFor({ en: at }), "en", {
    fetch: fetchOf({ en: response }), limits: { maximumInputBytes: CAP },
  });
  assert.equal(loaded.complete, true, "the happy path must complete, or the small count above is an upstream refusal");
  assert.equal(state.enqueued, 8);
  assert.ok(state.cancels <= 1, `observed ${state.cancels} cancellations`);
});

// ---------------------------------------------------------------------------------------------
// 25.c — nothing is digested when the cap is exceeded
// ---------------------------------------------------------------------------------------------

test("an over-cap body is NEVER digested, measured as a delta against a control that is", async () => {
  // The observation is a DELTA and the baseline is asserted, not assumed. One spy, one array, the
  // control first: "the loader digested nothing" and "the spy is not where the loader looks" are the
  // same reading otherwise, and the second is instrument failure, never a green clause.
  const at = bodyOf(CAP);
  const over = bodyOf(CAP + 1);

  // MEASURED, not assumed: nothing in manifest construction may land in the spy's array, or the
  // control's nonzero baseline could be satisfied by fixture work while the loader digested nothing —
  // a green on the exact defect this test exists to catch. The port's identity projection uses the
  // load graph's own synchronous SHA-256 (plan 6.1:1924), which is why this reads zero.
  const bracket = installDigestSpy();
  let atManifest, overManifest;
  try {
    atManifest = manifestFor({ en: at });
    overManifest = manifestFor({ en: over });
  } finally { bracket.restore(); }
  assert.equal(bracket.calls.length, 0,
    "manifest construction must not reach globalThis.crypto.subtle, or this spy must be installed after it");

  const spy = installDigestSpy();
  try {
    assert.equal(spy.calls.length, 0, "the spy starts clean");

    const loaded = await loadStrings(atManifest, "en", {
      fetch: fetchOf({ en: chunkedResponse(at, 8192).response }), limits: { maximumInputBytes: CAP },
    });
    assert.equal(loaded.complete, true);
    assert.equal(spy.calls.length, 1, "INSTRUMENT CHECK: a successful load must digest exactly once");
    assert.equal(spy.calls[0]?.alg, "SHA-256");
    assert.equal(spy.calls[0]?.byteLength, CAP);

    const before = spy.calls.length;
    assert.ok(before >= 1, "the control must have run and recorded at least one call");

    const error = await rejection(loadStrings(overManifest, "en", {
      fetch: fetchOf({ en: chunkedResponse(over, 8192).response }), limits: { maximumInputBytes: CAP },
    }));
    assert.ok(error instanceof StringsLoadingError, `expected StringsLoadingError, got ${error}`);
    assert.equal(error.failures[0].stage, "limit");
    // The order, executable: a loader that assembles, hashes and THEN checks the size produces this
    // identical rejection while having materialized and hashed an over-cap body.
    assert.equal(spy.calls.length, before,
      `the over-cap body must never be digested; the spy recorded ${spy.calls.length - before} extra call(s)`);
  } finally { spy.restore(); }
});

// ---------------------------------------------------------------------------------------------
// 25.d — one digest per file, over the exact octets the body delivered
// ---------------------------------------------------------------------------------------------

/** en: 3,000 ASCII octets · fr: 8,193 octets with non-ASCII and NO BOM · de: 20,000 octets WITH a BOM. */
function threeFileFixture() {
  const en = bodyOf(3000);
  const fr = bodyOf(8193, "a", 12);
  const de = concat([BOM, bodyOf(20000 - BOM.length, "a", 10)]);
  return { en, fr, de };
}

test("each file is digested ONCE, over the exact octets delivered, BOM included", async () => {
  const { en, fr, de } = threeFileFixture();

  // THE FIXTURE'S DISCRIMINATING PROPERTY, MEASURED HERE rather than asserted in a comment. A
  // decode-then-re-encode digest loses the BOM's three octets and NOTHING ELSE, so the non-ASCII
  // body is the control that proves accented text alone does not discriminate — a later author who
  // keeps the umlauts and drops the BOM would leave that arm green over a live defect.
  const fatal = new TextDecoder("utf-8", { fatal: true });
  assert.deepEqual([...de.subarray(0, 3)], [0xef, 0xbb, 0xbf], "the de body must start with a UTF-8 BOM");
  assert.deepEqual([...utf8.encode(fatal.decode(fr))], [...fr],
    "a well-formed non-ASCII body round-trips byte-for-byte, so non-ASCII alone discriminates nothing");
  assert.equal(utf8.encode(fatal.decode(de)).length, de.length - 3,
    "the BOM is the only thing the round trip loses, and therefore the only discriminator");

  const source = manifestFor({ en, fr, de });
  for (const [tag, bytes] of Object.entries({ en, fr, de }))
    assert.equal(source.files[tag].sha256, nodeSha256(bytes),
      `${tag}: the declared digest must be node:crypto's over the RAW octets, BOM and all`);

  const stubs = Object.fromEntries(Object.entries({ en, fr, de }).map(([tag, bytes]) =>
    [tag, chunkedResponse(bytes, 4096)]));

  const spy = installDigestSpy();
  let loaded;
  try {
    loaded = await loadEntireManifest(source, { fetch: fetchOf(Object.fromEntries(
      Object.entries(stubs).map(([tag, stub]) => [tag, stub.response]))) });
  } finally { spy.restore(); }

  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  // ONE CALL PER FILE falsifies per-chunk and incremental schemes; the exact byte length falsifies
  // first-chunk and last-chunk schemes and pins the SIZE of the buffer the clause's peak-memory
  // sentence names — the buffer handed to `digest` IS "that buffer".
  assert.equal(spy.calls.length, 3, `expected one digest per file; got ${spy.calls.length}`);
  assert.deepEqual(spy.calls.map((call) => call.alg), ["SHA-256", "SHA-256", "SHA-256"]);
  assert.deepEqual(spy.calls.map((call) => call.byteLength).sort((a, b) => a - b), [3000, 8193, 20000],
    "the digested lengths are the raw body lengths, the BOM'd file's INCLUDING its three BOM octets");

  // Derived from the transport, never hardcoded: a later change of chunk size must move the expected
  // per-chunk count on its own rather than leave an applier guessing whether a mutation landed.
  const delivered = Object.fromEntries(Object.entries(stubs).map(([tag, stub]) => [tag, stub.state.enqueued]));
  const enqueuedTotal = Object.values(delivered).reduce((total, count) => total + count, 0);
  assert.ok(delivered.fr >= 2 && delivered.de >= 2,
    `the multi-chunk files must actually span chunks: ${JSON.stringify(delivered)}`);
  assert.ok(enqueuedTotal > spy.calls.length,
    `a per-chunk digest would record ${enqueuedTotal} calls, which must differ from the ${spy.calls.length} observed`);
});

test("the same three digests through a genuine Response — INFORMATIONAL, never confirmation", async () => {
  // A real `Response` may coalesce or re-chunk what the source enqueued, so it is the WEAKER
  // instrument: it can deliver a whole body as one chunk and go green over a first-chunk digest. It
  // is run because the gating probe above uses a duck-typed response and a property of an artificial
  // transport is worth little — but a green HERE over a digest-scope defect is INCONCLUSIVE and must
  // never be reported as agreement.
  const { en, fr, de } = threeFileFixture();
  const source = manifestFor({ en, fr, de });
  const responses = Object.fromEntries(Object.entries({ en, fr, de }).map(([tag, bytes]) =>
    [tag, new Response(chunkedResponse(bytes, 4096).response.body, { status: 200 })]));

  const spy = installDigestSpy();
  let loaded;
  try {
    loaded = await loadEntireManifest(source, { fetch: fetchOf(responses) });
  } finally { spy.restore(); }

  assert.equal(loaded.complete, true, "the loader must accept a genuine Response, or the duck-type proves little");
  assert.equal(spy.calls.length, 3);
  assert.deepEqual(spy.calls.map((call) => call.byteLength).sort((a, b) => a - b), [3000, 8193, 20000]);
});
