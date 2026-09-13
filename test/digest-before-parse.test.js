// @ts-check
/**
 * SHA-256 IS VERIFIED BEFORE UTF-8 PARSING — M8 acceptance clause 26, plan 6.2:2090-2091.
 *
 * **WHY THE OBVIOUS PROBE CANNOT PROVE THIS, AND WHY IT IS ALREADY IN THE TREE.**
 * `test/fetch-loader.test.js`'s "a wrong digest fails at DIGEST, before the body is parsed" serves a
 * body that is perfectly good JSON and observes stage `digest`. A loader that PARSED FIRST and
 * compared the digest afterwards passes that test completely: the parse succeeds, the comparison
 * still fires, and the stage reported is still `digest`. The probe reaches the digest branch without
 * discriminating the two candidate orderings — it is valid in exactly the way that defeats the test,
 * and clause 26 stayed NOT-PROVEN with it sitting green.
 *
 * **WHAT DISCRIMINATES: a body that fails BOTH the digest check AND a later stage, paired with a
 * BYTE-IDENTICAL control whose declared digest MATCHES those bytes.** Probe and control then differ
 * in exactly one manifest field — `files.fr.sha256` — so the reported `LoadFailure.stage` names which
 * check ran first, and the control MEASURES the later outcome instead of leaving it assumed. Plan
 * 6.2:1963-1970 makes `stage` a seven-member union and plan 6.2:2078-2079 says every later failure
 * "keeps its named stage", so the stage name is the observation channel this clause has.
 *
 * Three corrupted `fr` bodies, each the SAME 22 octets long as the catalog it corrupts, so the
 * declared `decodedBytes` still matches and the `limit` stage — which plan 6.2:2090 puts in the
 * STREAMING path, ahead of a digest taken over the assembled body (measured: an off-by-one body
 * reports `limit`, never `digest`) — cannot pre-empt any of them:
 *
 *   - one byte inside the value changed: still valid UTF-8, still a valid catalog (conjunct 26.1);
 *   - one byte replaced by `0x80`, a lone continuation byte: fatally undecodable (26.2);
 *   - the closing `}` replaced by `,`: decodes cleanly, `JSON.parse` refuses (26.3).
 *
 * **AND ONE INPUT NEITHER OF THOSE CAN REACH: a BOM (26.4).** Plan 6.1:1911-1913 names the
 * representation hashed — "the bytes exposed by the response body, after HTTP content coding but
 * before UTF-8 decoding or BOM removal" — while plan 4.1:1483 removes at most one leading BOM AT
 * DECODE. A catalog carrying a BOM is therefore the only input that separates "hashes the octets it
 * received" from "hashes what the decoder produced" while the decode and the parse BOTH SUCCEED. A
 * suite with no BOM'd catalog is structurally blind to a loader that normalizes before hashing, the
 * same shape as the `Zzzz` script placeholder and S6's already-sorted array.
 *
 * **THE TRAP THE ADVERSARIAL PASS FOUND IN 26.4, MEASURED HERE RATHER THAN ARGUED.**
 * `createStringsManifestFromDirectory` EMITS `decodedBytes` (plan 6.1:1825 leaves it optional;
 * `src/node/manifest-directory.js` emits it deliberately), and `readBoundedStream` enforces it while
 * streaming. So the inverse control — 25 BOM'd octets served against the 22-octet no-BOM manifest —
 * rejects at stage `limit`, never reaching the comparison at all: measured, and it is the landing
 * witness for the whole conjunct, so it would have made a landed ablation look like a failed one.
 * The declared length is therefore raised to 25 at the FIELD (transport-only and excluded from the
 * fingerprint per plan 6.1:1926-1928, so the manifest still validates) while the declared `sha256`
 * stays the no-BOM one — which is exactly the equality that makes it flip to success under a
 * strip-the-BOM-before-hashing ablation.
 *
 * **EVERY PROBE IS RUN ON THREE TRANSPORTS AND ASSERTED SEPARATELY.** Plan 6.2:2094-2100 gives the
 * two doors DIFFERENT digest mechanisms — the browser retains one bounded body and calls the one-shot
 * `SubtleCrypto.digest`, Node hashes incrementally from `onChunk` — so a green on one is not evidence
 * about the other. The incremental door is fed two chunks split after two octets, which puts the BOM
 * across a chunk boundary.
 *
 * **A MEASURED ASYMMETRY, RECORDED RATHER THAN RELIED ON.** Plan 6.1:1916-1918 requires BOTH doors
 * to refuse the other scheme before any catalog I/O. `FILE_TRANSPORT.preflight` does. The Fetch
 * door's preflight checks only WebCrypto and the fetch implementation — measured, `loadEntireManifest`
 * handed a `file:` manifest dereferences it through the injected fetch without complaint. That is a
 * finding about plan 6.1:1916-1918 and not about this clause, and it is exactly why the scheme each
 * door is handed is ASSERTED below rather than assumed to be enforced for us.
 *
 * **WHAT THIS FILE DOES NOT PROVE, said here so a green clause 26 is not over-read.** It pins the
 * order of DECISION, not of computation: a loader that decoded speculatively while streaming (which
 * plan 4.5:1569-1577's reader-character limit invites), retained the error and still reported the
 * digest mismatch first is indistinguishable through the public surface. It says nothing about the
 * digest's position relative to `validate`, nor about the aggregate byte budget. And this port never
 * emits stage `decode` at all — `run-plan.js:120-122` routes a fatal UTF-8 failure out of the parser
 * as `parse` on purpose — so 26.2's control asserts `!== "digest"` and membership in
 * `{decode, parse}` rather than pinning a name this clause does not own.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  StringsLoadingError, loadEntireManifest, loadStrings, validateStringsManifest,
} from "../src/load/index.js";
import {
  createStringsManifestFromDirectory, loadEntireManifestFromFiles, loadStringsFromFiles,
} from "../src/node/index.js";

const utf8 = new TextEncoder();

/** 20 octets. The resolved fallback locale, so it is the file plan 6.2:2082-2084 singles out. */
const EN_BYTES = utf8.encode('{"Greeting":"Hello"}');
/** Same shape, 20 octets, DIFFERENT digest: the fallback's own corruption for 26.5. */
const EN_VALID_ELSEWHERE = utf8.encode('{"Greeting":"Hallo"}');
/** 22 octets. Every `fr` corruption below is this, with ONE octet replaced IN PLACE. */
const FR_BYTES = utf8.encode('{"Greeting":"Bonjour"}');

/** @param {Uint8Array} bytes @param {number} index @param {number} value */
function withOctetAt(bytes, index, value) {
  const copy = new Uint8Array(bytes);
  copy[index] = value;
  return copy;
}

/** Valid UTF-8, valid JSON, a valid catalog — wrong digest. Only the comparison can see it. */
const FR_VALID_ELSEWHERE = utf8.encode('{"Greeting":"Bonjovr"}');
/** A lone UTF-8 continuation byte inside the value: fatal to `TextDecoder`, per plan 4.1:1483. */
const FR_UNDECODABLE = withOctetAt(FR_BYTES, 15, 0x80);
/** The closing brace replaced by a comma: decodes cleanly, `JSON.parse` refuses. */
const FR_UNPARSEABLE = withOctetAt(FR_BYTES, FR_BYTES.length - 1, 0x2c);
/** 25 octets: EF BB BF then the true catalog. Hashed WITH the BOM, decoded without it. */
const FR_WITH_BOM = new Uint8Array([0xef, 0xbb, 0xbf, ...FR_BYTES]);

const PUBLICATION_BASE = "https://catalogs.example/v1/";
const root = mkdtempSync(join(tmpdir(), "lokalized-digest-"));
after(() => rmSync(root, { recursive: true, force: true }));

/**
 * One directory of catalogs, and the TWO manifests generated from it.
 *
 * **NOTHING HERE IS HAND-EDITED.** The digests come from the real generator over the real bytes on
 * disk, so a fixture cannot bank a plausible-looking digest for a body that does not exist — the
 * shape S14 found when the oracle recorded a believable expectation for an absent path. Two
 * manifests rather than one because the Node door refuses a non-`file:` plan in PREFLIGHT, with a
 * `ConfigurationError` and no `stage` at all: a single https: manifest would be refused pre-I/O on
 * two of the three doors and "confirm" an ordering it never exercised. They are interchangeable as
 * identities — plan 6.1:1926-1928 excludes `baseUrl`, `url` and `decodedBytes` from the fingerprint —
 * which is asserted rather than assumed, below.
 *
 * @param {Record<string, Uint8Array>} catalogs
 */
async function fixture(catalogs) {
  const directory = mkdtempSync(join(root, "d-"));
  for (const [tag, bytes] of Object.entries(catalogs)) writeFileSync(join(directory, `${tag}.json`), bytes);
  const common = { catalogVersion: "clause-26", fallbackLocale: "en" };
  return {
    directory,
    "https:": await createStringsManifestFromDirectory(directory, { ...common, publicationBaseUrl: PUBLICATION_BASE }),
    "file:": await createStringsManifestFromDirectory(directory, common),
  };
}

/** The tag a planned URL is for: the generator emits one percent-encoded path segment. */
const tagOf = (/** @type {string} */ url) =>
  decodeURIComponent(/** @type {string} */ (url.split("/").pop())).replace(/\.json$/, "");

/**
 * The three transports, each recording every URL it is asked for.
 *
 * The recording is not decoration: several assertions below are about what did NOT happen, and
 * proving a read did not occur needs an instrument that would have noticed if it had.
 */
const DOORS = [
  {
    name: "fetch door",
    scheme: "https:",
    loadEntire: loadEntireManifest,
    loadLookup: loadStrings,
    /** @param {Record<string, Uint8Array>} bodies */
    open(bodies) {
      /** @type {string[]} */
      const urls = [];
      return {
        urls,
        options: {
          fetch: async (/** @type {string} */ url) => {
            urls.push(url);
            const chunks = [bodies[tagOf(url)]];
            let index = 0;
            return {
              ok: true, status: 200,
              body: { getReader: () => ({
                read: async () => (index >= chunks.length ? { done: true } : { done: false, value: chunks[index++] }),
                cancel: async () => {},
              }) },
            };
          },
        },
      };
    },
  },
  {
    name: "node door (buffered reader)",
    scheme: "file:",
    loadEntire: loadEntireManifestFromFiles,
    loadLookup: loadStringsFromFiles,
    /** @param {Record<string, Uint8Array>} bodies */
    open(bodies) {
      /** @type {string[]} */
      const urls = [];
      // Plan 6.2:2098-2100's "complete `Uint8Array`" answer: no stream, so the incremental hash is
      // fed exactly one chunk. A door that only ever saw streams would not exercise this.
      return { urls, options: { readFile: async (/** @type {string} */ url) => { urls.push(url); return bodies[tagOf(url)]; } } };
    },
  },
  {
    name: "node door (incremental reader)",
    scheme: "file:",
    loadEntire: loadEntireManifestFromFiles,
    loadLookup: loadStringsFromFiles,
    /** @param {Record<string, Uint8Array>} bodies */
    open(bodies) {
      /** @type {string[]} */
      const urls = [];
      return {
        urls,
        options: {
          readFile: async (/** @type {string} */ url) => {
            urls.push(url);
            const body = bodies[tagOf(url)];
            // SPLIT AFTER TWO OCTETS, chosen for the BOM: EF BB then BF and the rest, so an
            // incremental hasher meets a BOM cut across a chunk boundary rather than whole.
            return (async function* () { yield body.subarray(0, 2); yield body.subarray(2); })();
          },
        },
      };
    },
  },
];

/**
 * Run one load and report the outcome WITHOUT deciding what it should have been.
 *
 * @param {typeof DOORS[number]} door @param {any} fixtures @param {Record<string, Uint8Array>} bodies
 * @param {{ options?: any, lookupLocale?: string, manifest?: any }} [how]
 */
async function attempt(door, fixtures, bodies, how = {}) {
  const manifest = how.manifest ?? fixtures[door.scheme];
  const transport = door.open(bodies);
  const options = { ...transport.options, ...(how.options ?? {}) };
  const outcome = await (how.lookupLocale === undefined
    ? door.loadEntire(manifest, options)
    : door.loadLookup(manifest, how.lookupLocale, options)
  ).then((loaded) => ({ loaded: /** @type {any} */ (loaded), error: /** @type {any} */ (null) }),
    (error) => ({ loaded: /** @type {any} */ (null), error: /** @type {any} */ (error) }));
  return { ...outcome, manifest, urls: transport.urls };
}

/**
 * Everything a stage observation depends on, ASSERTED rather than inferred.
 *
 * The zh-123 guard, in the form this clause needs it: if the served body were the wrong length, or
 * the manifest carried the wrong scheme for this door, or the file were never requested at all, then
 * a red below would be `limit`, a pre-I/O `ConfigurationError`, or nothing — none of which is
 * evidence about the digest.
 *
 * @param {typeof DOORS[number]} door @param {any} manifest @param {string} tag
 * @param {Uint8Array} served @param {readonly string[]} urls
 * @param {{ digestMatches: boolean }} expectation
 */
function assertServed(door, manifest, tag, served, urls, expectation) {
  assert.equal(new URL(manifest.baseUrl).protocol, door.scheme,
    `this door must be handed the scheme plan 6.1:1916-1918 gives it; the Node door refuses the ` +
    `other one in preflight, and a pre-I/O refusal carries no stage to observe`);
  assert.ok(urls.some((url) => tagOf(url) === tag),
    `'${tag}' was never requested, so nothing below observed a per-file stage: ${JSON.stringify(urls)}`);
  // The declared length is compared to the SERVED length directly, not inferred from two bodies
  // being "the same size": `decodedBytes` is optional (plan 6.1:1825) and this generator emits it.
  assert.equal(manifest.files[tag].decodedBytes, served.length,
    `a declared/served length mismatch fails at stage 'limit' first (plan 6.2:2090)`);
  const declared = manifest.files[tag].sha256;
  const actual = createHash("sha256").update(served).digest("hex");
  if (expectation.digestMatches) assert.equal(actual, declared, "the fixture must declare these very bytes");
  else assert.notEqual(actual, declared, "the fixture must declare a DIFFERENT body, or nothing discriminates");
}

/**
 * The one failure recorded for `tag`, after proving this is a load failure and not a refusal.
 *
 * `instanceof StringsLoadingError` first, because the Node door's pre-I/O scheme refusal (plan
 * 6.1:1916-1918) is a `ConfigurationError` with no `failures` at all — reading `.stage` off one would
 * throw somewhere the message does not name the cause.
 *
 * @param {any} error @param {string} tag
 */
function soleFailure(error, tag) {
  assert.ok(error instanceof StringsLoadingError,
    `expected StringsLoadingError; got ${error && error.name}: ${error && error.message}`);
  assert.equal(error.code, "STRINGS_LOADING");
  const mine = error.failures.filter((/** @type {any} */ f) => f.locale === tag);
  assert.equal(mine.length, 1, `expected exactly one '${tag}' failure, got ${JSON.stringify(error.failures)}`);
  // Deliberately weaker than "no other failures at all": under the default policy a runner that
  // cancelled its siblings could legitimately record one at `fetch`/`read`. What it may never do is
  // report a digest failure for a file whose bytes are intact.
  assert.deepEqual(
    error.failures.filter((/** @type {any} */ f) => f.locale !== tag && f.stage === "digest"), [],
    "an intact sibling may not be blamed for a digest mismatch");
  return mine[0];
}

// =================================================================================================
// CONTROL A — the attribution control for every probe in this file. Without it a red anywhere below
// could be an upstream refusal wearing a digest costume.
// =================================================================================================

for (const door of DOORS) {
  test(`CONTROL A | a good catalog set loads end to end | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const { loaded, error, manifest, urls } = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_BYTES });

    assert.equal(error, null, `the control must load; got ${error && error.message}`);
    assertServed(door, manifest, "fr", FR_BYTES, urls, { digestMatches: true });

    // THE POSITIVE ALGORITHM IDENTITY, which every stage assertion in this file leaves open on its
    // own: they all compare a port-declared digest against a port-computed one. A generator and a
    // loader that agreed on some OTHER hash — truncated SHA-512, a length-salted digest — satisfy
    // every probe here. `node:crypto` is the independent witness that the algorithm is SHA-256, and
    // the load succeeding over these same digests carries it to the loader.
    assert.equal(manifest.files.fr.sha256, createHash("sha256").update(FR_BYTES).digest("hex"));
    assert.equal(manifest.files.en.sha256, createHash("sha256").update(EN_BYTES).digest("hex"));

    assert.equal(loaded.complete, true);
    assert.deepEqual([...loaded.failures], []);
    assert.deepEqual(loaded.catalogs.fr.strings[0], { key: "Greeting", translation: "Bonjour" });

    // Plan 6.1:1926-1928: the two manifests are the same IDENTITY over different transports, which
    // is what lets one directory serve both doors without a hand-written digest anywhere.
    assert.equal(fixtures["https:"].catalogFingerprint, fixtures["file:"].catalogFingerprint);
  });
}

// =================================================================================================
// 26.1 — the mismatch is DETECTED and is fatal. This is the half the existing probe already covers;
// it is kept and labelled, because the ordering conjuncts below need a witness that a comparison
// exists at all: under an ablation that DELETES the comparison this goes red, and under one that
// MOVES it this stays green.
// =================================================================================================

for (const door of DOORS) {
  test(`26.1 | a same-length VALID catalog with the wrong digest fails at stage digest | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const { loaded, error, manifest, urls } =
      await attempt(door, fixtures, { en: EN_BYTES, fr: FR_VALID_ELSEWHERE });

    assert.equal(loaded, null, "a digest mismatch is fatal under the default policy (plan 6.2:2074-2076)");
    assertServed(door, manifest, "fr", FR_VALID_ELSEWHERE, urls, { digestMatches: false });

    const failure = soleFailure(error, "fr");
    assert.equal(failure.stage, "digest");
    assert.equal(failure.url, new URL("fr.json", manifest.baseUrl).href);
  });

  test(`26.1 | allow-partial keeps the digest stage and returns the fallback | ${door.name}`, async () => {
    // The second observation channel for the same stage, plan 6.2:2082-2084. `fr` is not the
    // resolved fallback, so a partial result is legal here — and the stage has to survive into it.
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const { loaded, error, manifest, urls } = await attempt(
      door, fixtures, { en: EN_BYTES, fr: FR_VALID_ELSEWHERE }, { options: { partialFailure: "allow-partial" } });

    assert.equal(error, null, `allow-partial must resolve here; got ${error && error.message}`);
    assertServed(door, manifest, "fr", FR_VALID_ELSEWHERE, urls, { digestMatches: false });

    assert.equal(loaded.complete, false);
    assert.deepEqual(loaded.failures.map((/** @type {any} */ f) => [f.locale, f.stage]), [["fr", "digest"]]);
    assert.deepEqual(Object.keys(loaded.catalogs), ["en"]);
  });
}

// =================================================================================================
// 26.2 — verification precedes DECODING. Recorded as the STRONG reading of "before UTF-8 parsing":
// plan 6.2:2090-2091 says "parsing", and plan 4.5:1569-1577's reader-character limit positively
// invites a fatal streaming decode during acquisition, so a port that decoded first here would be a
// MAINTAINER question about which reading governs — not a defect and not a clause-26 red. A
// SUCCESSFUL load is a defect under either reading. Measured: this port reports `digest`, so clause
// 26 carries the decode-ordering evidence as well.
//
// THE CAVEAT THAT KEEPS THIS HONEST: this port names a fatal decode `parse` (`run-plan.js`'s own
// note), so a non-`digest` red HERE would not on its own separate a decode-first loader from a
// parse-first one. 26.3 does separate them — it is single-fault on the parse axis — and the two go
// red under different mutations, which is what makes them two conjuncts rather than one written
// twice.
// =================================================================================================

for (const door of DOORS) {
  test(`26.2 | a body that is digest-wrong AND undecodable reports digest | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const { error, manifest, urls } = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_UNDECODABLE });

    assertServed(door, manifest, "fr", FR_UNDECODABLE, urls, { digestMatches: false });
    assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(FR_UNDECODABLE),
      "the discriminating half: these octets must genuinely be undecodable");

    assert.equal(soleFailure(error, "fr").stage, "digest");
  });

  test(`26.2 CONTROL B | the same undecodable octets with a MATCHING digest reach decoding | ${door.name}`, async () => {
    // Byte-identical input to the probe above; one manifest field differs. This is what turns the
    // probe from an assumption into a measurement — without it, `digest` above could be the only
    // stage this port ever reports for a broken body.
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_UNDECODABLE });
    const { error, manifest, urls } = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_UNDECODABLE });

    assertServed(door, manifest, "fr", FR_UNDECODABLE, urls, { digestMatches: true });

    const failure = soleFailure(error, "fr");
    assert.notEqual(failure.stage, "digest", "the digest is correct here; blaming it would be wrong");
    // Not pinned tighter: plan 6.2:1963-1970 offers both names and the clause text does not choose.
    assert.ok(["decode", "parse"].includes(failure.stage), `unexpected stage '${failure.stage}'`);
  });
}

// =================================================================================================
// 26.3 — verification precedes PARSING, the clause exactly as written. Separately falsifiable from
// 26.2: a loader that decoded eagerly for the character limit but hashed before `JSON.parse`
// satisfies this and violates that one.
// =================================================================================================

for (const door of DOORS) {
  test(`26.3 | a body that is digest-wrong AND unparseable reports digest | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const { error, manifest, urls } = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_UNPARSEABLE });

    assertServed(door, manifest, "fr", FR_UNPARSEABLE, urls, { digestMatches: false });
    // SINGLE-FAULT ON THE PARSE AXIS. If these octets were also undecodable the probe would collapse
    // into 26.2 and stop being separately falsifiable, so the decode is asserted to SUCCEED.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(FR_UNPARSEABLE);
    assert.throws(() => JSON.parse(text), "these octets must genuinely be unparseable");

    assert.equal(soleFailure(error, "fr").stage, "digest");
  });

  test(`26.3 CONTROL B | the same unparseable octets with a MATCHING digest reach the parser | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_UNPARSEABLE });
    const { error, manifest, urls } = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_UNPARSEABLE });

    assertServed(door, manifest, "fr", FR_UNPARSEABLE, urls, { digestMatches: true });

    const failure = soleFailure(error, "fr");
    // Pinnable here, unlike 26.2's: the body decodes cleanly, so only JSON parsing can refuse it.
    assert.equal(failure.stage, "parse");
  });
}

// =================================================================================================
// 26.4 — the representation hashed is the ACQUIRED OCTETS, BOM included (plan 6.1:1911-1913), and
// the BOM is removed only at decode (plan 4.1:1483). The success-shaped probe and the failure-shaped
// inverse control flip in OPPOSITE directions under a strip-before-hashing ablation, so neither a
// lenient comparison nor a body "valid in the defeating way" can satisfy both.
// =================================================================================================

for (const door of DOORS) {
  test(`26.4 | a BOM'd catalog whose declared digest COVERS the BOM loads | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_WITH_BOM });
    const { loaded, error, manifest, urls } = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_WITH_BOM });

    assert.equal(error, null, `a BOM'd catalog is an ordinary load; got ${error && error.message}`);
    assert.deepEqual([...FR_WITH_BOM.subarray(0, 3)], [0xef, 0xbb, 0xbf], "the fixture must carry a real BOM");
    assertServed(door, manifest, "fr", FR_WITH_BOM, urls, { digestMatches: true });

    assert.equal(loaded.complete, true);
    // The BOM was removed AT DECODE and not before hashing: both halves in one assertion, since a
    // loader that stripped it before hashing could not have matched the digest above, and one that
    // did not strip it at decode would either refuse the document or carry U+FEFF into the first key.
    assert.deepEqual(loaded.catalogs.fr.strings[0], { key: "Greeting", translation: "Bonjour" });
  });

  test(`26.4 INVERSE | BOM'd octets against a no-BOM digest fail at digest | ${door.name}`, async () => {
    // The three BOM octets are INSIDE the hashed representation, not silently tolerated. See the
    // file header for why `decodedBytes` is raised to 25 here: unpatched, this rejects at `limit`
    // and never reaches the comparison — measured, and it is this conjunct's landing witness.
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const noBom = fixtures[door.scheme];
    const manifest = validateStringsManifest({
      ...noBom,
      files: { ...noBom.files, fr: { ...noBom.files.fr, decodedBytes: FR_WITH_BOM.length } },
    });
    assert.equal(manifest.files.fr.sha256, createHash("sha256").update(FR_BYTES).digest("hex"),
      "the declared digest must stay the NO-BOM one, or this control cannot flip");

    const outcome = await attempt(door, fixtures, { en: EN_BYTES, fr: FR_WITH_BOM }, { manifest });
    assertServed(door, manifest, "fr", FR_WITH_BOM, outcome.urls, { digestMatches: false });
    assert.equal(soleFailure(outcome.error, "fr").stage, "digest");
  });
}

// =================================================================================================
// 26.5 — "SHA-256 is verified" FOR EVERY PLANNED FILE, including the resolved fallback. Every
// conjunct above corrupts `fr`, a non-fallback catalog; an implementation that short-circuited
// verification for the one file every load must have would pass all of them unchanged.
// =================================================================================================

for (const door of DOORS) {
  test(`26.5 | the FALLBACK file's own digest is verified, and allow-partial cannot rescue it | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const bodies = { en: EN_VALID_ELSEWHERE, fr: FR_BYTES };

    const strict = await attempt(door, fixtures, bodies);
    assertServed(door, strict.manifest, "en", EN_VALID_ELSEWHERE, strict.urls, { digestMatches: false });
    assert.equal(soleFailure(strict.error, "en").stage, "digest");

    // Plan 6.2:2082-2084: "Fallback-file failure always rejects." Without this arm the test above
    // would pass over a loader that quietly downgraded the fallback's corruption to a partial result.
    const partial = await attempt(door, fixtures, bodies, { options: { partialFailure: "allow-partial" } });
    assert.equal(partial.loaded, null, "a corrupt fallback may never resolve, even under allow-partial");
    assert.equal(soleFailure(partial.error, "en").stage, "digest");
    assert.match(partial.error.message, /fallback-locale file is among them/);
  });
}

// =================================================================================================
// 26.6 — the SUBSET doors dereference their own plan, and `loadStrings` is M8's headline API. A
// comparison skipped or mis-wired in the subset planner is invisible to every whole-manifest probe
// above.
// =================================================================================================

for (const door of DOORS) {
  test(`26.6 | the lookup-SUBSET door verifies each planned file's digest too | ${door.name}`, async () => {
    const fixtures = await fixture({ en: EN_BYTES, fr: FR_BYTES });
    const { loaded, error, manifest, urls } = await attempt(
      door, fixtures, { en: EN_BYTES, fr: FR_VALID_ELSEWHERE }, { lookupLocale: "fr" });

    assert.equal(loaded, null);
    assertServed(door, manifest, "fr", FR_VALID_ELSEWHERE, urls, { digestMatches: false });
    assert.equal(soleFailure(error, "fr").stage, "digest");
  });
}

// =================================================================================================
// 26.7 — each failure keeps its OWN stage, in plan order. One load, two broken files, two different
// stages: a runner that computed the right stage per file but collapsed or reused one name across
// entries passes every single-corrupted-file probe in this file. Driven on one door deliberately —
// this is a property of the SHARED runner's failure assembly, not of a transport.
// =================================================================================================

test("26.7 | two files failing at DIFFERENT stages each keep their own, in plan order", async () => {
  // `de` holds the unparseable octets ON DISK, so its declared digest matches what is served and it
  // fails at `parse`; `fr` is served a valid catalog with the wrong digest and fails at `digest`.
  // Plan order is normalized-tag order (plan 6.2:2111), so `de` precedes `fr` whatever the transport
  // completes first.
  const door = DOORS[0];
  const fixtures = await fixture({ de: FR_UNPARSEABLE, en: EN_BYTES, fr: FR_BYTES });
  const { error, manifest, urls } = await attempt(
    door, fixtures, { de: FR_UNPARSEABLE, en: EN_BYTES, fr: FR_VALID_ELSEWHERE });

  assertServed(door, manifest, "de", FR_UNPARSEABLE, urls, { digestMatches: true });
  assertServed(door, manifest, "fr", FR_VALID_ELSEWHERE, urls, { digestMatches: false });

  assert.ok(error instanceof StringsLoadingError, `got ${error && error.name}`);
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => [f.locale, f.stage]),
    [["de", "parse"], ["fr", "digest"]]);
});
