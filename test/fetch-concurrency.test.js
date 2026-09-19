// @ts-check
/**
 * The concurrency cap and the ADMISSION ORDER of queued work — plan 6.2:2087, M8 acceptance
 * clause 20: "At most eight catalog reads are active at once; queued work retains fetch-plan order."
 *
 * **WHY THE OBVIOUS PROBE DOES NOT PROVE THIS, and it is already in the tree.**
 * `fetch-loader.test.js`'s "at most eight catalog reads are active at once" samples a peak counter
 * over a stub that resolves after a 5 ms timer and then asserts `peak <= 8 && peak > 1`. Three
 * separate holes, each of which this file closes:
 *
 *   1. **`<= 8` is blind to a cap that is too small, and `> 1` is not a lower bound.** A loader
 *      capped at two, four or six satisfies both halves while contradicting the sentence. The
 *      assertion here is `=== 8` — an equality, taken when a known number of reads are unfinished.
 *   2. **A SAMPLED peak over a fast transport measures the transport, not the cap.** If reads
 *      complete quickly the sampler can report a peak of 2 over a loader with no cap at all. Every
 *      count below is taken with every read STALLED and nothing able to finish, so the invocation
 *      count at quiescence is an exact quantity with no timing in it: it is how many reads the
 *      loader is WILLING to have outstanding, not how many happened to overlap.
 *   3. **It says nothing whatever about the second conjunct.** Nothing in the tree observed the
 *      order in which QUEUED entries are admitted. `failures`/`warnings` order (plan 6.2:2077,
 *      :2080-2081) is satisfied by a runner that sorts at the end — a stack, a striped pool or a
 *      LIFO refill all produce perfectly ordered output while admitting work in the wrong order —
 *      so an output-ordering test must never be cited as partial evidence for :2087. The
 *      discriminating input is a completion order UNCORRELATED with plan order, compared as a
 *      SEQUENCE and never as a set.
 *
 * **THE INPUT THAT CHOOSES BETWEEN A CORRECT RUNNER AND A STRIPED ONE.** Releasing the eight
 * in-flight reads in plan order is the control an author writes first, and it is green over a pool
 * of eight independent workers each taking `plan.filter((_, i) => i % 8 === s)`: releasing slot `s`
 * admits stripe `s`'s next item, which under in-order release IS P8..P15 in order. Only a
 * DERANGEMENT of the release order separates them — `[5,0,7,2,6,1,4,3]`, which has no fixed point —
 * and a striped runner then admits `[ja, fi, nl, hi, ko, fr, it, hu]`: the same SET as the correct
 * `[fi, fr, hi, hu, it, ja, ko, nl]`, differing at every one of the eight positions. Both release
 * schedules are run below, and the in-order one is kept as a CONTROL rather than as evidence.
 *
 * **WHY EVERY ROW RUNS BOTH DOORS.** The clause says "catalog reads" and names no transport. The
 * runner (`src/load/run-plan.js`) is shared by `lokalized/load`'s Fetch door and `lokalized/node`'s
 * `file:` door, which differ in how bytes arrive and how they are hashed — one-shot WebCrypto over
 * an assembled body, incremental `node:crypto` from the bounded reader's `onChunk`. Both are driven
 * here through their own injection surface.
 *
 * **THE SUBSET DOOR IS PROBED TOO, and its plan is derived by DIFFERENT code.** Every whole-manifest
 * row plans in plan 6.2:2111's normalized-tag order; `loadStrings`/`loadStringsFromFiles` plan from
 * `fetchSet`, which is plan 6.1:1890's "manifest-backed files, deduplicated in FIRST-USE order" —
 * an order that is neither sorted nor the manifest's key order. "Fetch-plan order" covers both, and
 * a dispatcher walking `Object.keys(files)` is only visible on the second.
 *
 * **NO WALL-CLOCK VALUE IS LOAD-BEARING FOR A PASS.** No probe ever awaits an unsettled load, so
 * there is no deadline to trip: quiescence is defined as "the invocation count has not moved for
 * twenty consecutive event-loop turns", and every release is followed by one.
 *
 * **WHAT THE FIXTURE DELIBERATELY SHUFFLES.** The manifest's `files` keys are inserted in a
 * permutation of plan order, and each file's `url` is a second, unrelated permutation; the catalog
 * bodies are padded to distinct byte lengths in a third. Plan 6.1:1927 excludes `baseUrl`, per-file
 * `url` and `decodedBytes` from the fingerprint, so none of that invalidates the manifest — and any
 * of the four orders standing in for plan order is then a visible, named failure rather than a
 * coincidence. S10 shipped exactly that defect: a plan computed in manifest-key order.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { fetchSet } from "../src/load/planning.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { loadEntireManifestFromFiles, loadStringsFromFiles } from "../src/node/file-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { validateStringsManifest } from "../src/load/manifest.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const utf8 = new TextEncoder();

/** Plan 6.2:2087's number, written once so a reader can see what every `8` below refers to. */
const CAP = 8;

/**
 * Twenty tags, ALREADY in normalized serialized form and already ASCII-ascending, so the
 * whole-manifest plan (plan 6.2:2111) is this array verbatim. Asserted, not assumed — see CONTROL-0.
 */
const PLAN_TAGS = Object.freeze([
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "fi", "fr",
  "hi", "hu", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv",
]);

/**
 * The release schedule that does the discriminating work: a derangement of the eight slot positions
 * with NO fixed point, so the slot that frees never equals the plan index that must be admitted
 * next, and never agrees with it mod eight either.
 */
const RELEASE_DERANGEMENT = Object.freeze([5, 0, 7, 2, 6, 1, 4, 3]);

/** The control schedule — the one an author writes first, and the one a striped pool survives. */
const RELEASE_IN_PLAN_ORDER = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);

/** A lookup-subset fixture: nineteen `en` catalogs plus `fr`, so `fetchSet` has a real queue. */
const SUBSET_REGIONS = Object.freeze([
  "en-GB", "en-US", "en-AU", "en-CA", "en-IE", "en-NZ", "en-ZA", "en-IN", "en-JM",
  "en-SG", "en-HK", "en-PH", "en-KE", "en-NG", "en-MT", "en-BZ", "en-TT", "en-ZW",
]);
const SUBSET_TAGS = Object.freeze(["en", ...SUBSET_REGIONS, "fr"]);

/**
 * `fetchSet(subset, "en-GB")`, written out as a LITERAL rather than recomputed.
 *
 * The verifier's point about self-comparison applies here as much as to the whole-manifest plan: an
 * admission sequence compared only against the loader's OWN reported plan moves with it if the plan
 * itself is computed wrongly. The literal is the independent side; `requestedFiles` is then compared
 * to the same literal as a second, separately-named assertion, so a red says which one moved.
 *
 * It is neither sorted (`en` would lead) nor the manifest's key order — that is what makes "the
 * first eight invocations are the first eight PLAN entries" discriminating rather than decorative.
 */
const SUBSET_PLAN = Object.freeze([
  "en-GB", "en", "en-US", "en-AU", "en-CA", "en-IE", "en-NZ", "en-ZA", "en-IN",
  "en-JM", "en-SG", "en-HK", "en-PH", "en-KE", "en-NG", "en-MT", "en-BZ", "en-TT", "en-ZW",
]);

/** A valid one-key catalog, padded to a length that is distinct per index and unrelated to it. */
const bodyFor = (/** @type {string} */ tag, /** @type {number} */ index) =>
  JSON.stringify({ [`Key.${tag}`]: `hello ${tag}${" ".repeat((13 * index + 5) % 20)}` });

/**
 * A manifest whose fingerprint is COMPUTED from its own contents — no expected value is authored.
 *
 * The two permutations are applied after the bytes are hashed and before the fingerprint is taken,
 * which plan 6.1:1927 licenses: the identity projection covers neither `baseUrl` nor per-file `url`,
 * and `computeCatalogIdentity` canonicalizes key order, so insertion order cannot reach it either.
 *
 * @param {readonly string[]} tags
 * @param {{ baseUrl: string, fallbackLocale?: string, tiebreakers?: Record<string, readonly string[]> }} options
 */
function fixture(tags, { baseUrl, fallbackLocale = "en", tiebreakers = {} }) {
  const count = tags.length;
  /** @type {Map<string, Uint8Array>} */
  const bytesByTag = new Map();
  /** @type {Map<string, string>} */
  const urlByTag = new Map();
  tags.forEach((tag, index) => {
    bytesByTag.set(tag, utf8.encode(bodyFor(tag, index)));
    // A second permutation: url lexicographic order is `c0, c1, c10, c11, …`, which is neither plan
    // order nor its reverse. 7 and the count are coprime, so this is a bijection.
    urlByTag.set(tag, `c${(7 * index + 3) % count}.json`);
  });

  /** @type {Record<string, { url: string, sha256: string }>} */
  const files = {};
  // A third permutation, this one in KEY INSERTION order, which is what an implementation reading
  // `Object.entries(files)` instead of the plan would follow. 11 is coprime with both counts used.
  for (let position = 0; position < count; position += 1) {
    const tag = /** @type {string} */ (tags[(11 * position + 4) % count]);
    files[tag] = {
      url: /** @type {string} */ (urlByTag.get(tag)),
      sha256: sha256Hex(/** @type {Uint8Array} */ (bytesByTag.get(tag))),
    };
  }

  const draft = {
    formatVersion: 1,
    catalogVersion: "clause-20",
    catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY,
    fallbackLocale,
    baseUrl,
    files,
    tiebreakers,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return { manifest: /** @type {any} */ (draft), bytesByTag };
}

/**
 * THE TRANSPORT STUB, one factory serving both doors.
 *
 * **IT RECORDS; IT NEVER THROWS AND NEVER ALTERS WHAT IT RETURNS.** An in-stub guard that threw the
 * moment a ninth read went active would contaminate its own ablation: a throw from a transport is
 * not a harness signal, it is an acquisition failure, so the loader would record a `LoadFailure`,
 * free the slot, admit the next entry and cascade — and the applier who was told to look for a
 * quiescent count of 16 under a widened cap would see 20 or an early rejection instead. So
 * `violations` and `maxOutstanding` are DATA the test asserts on, and the loader's control flow
 * under an ablation is identical to its control flow un-ablated.
 *
 * **`locale` IS DERIVED FROM THE MANIFEST, KEYED BY RESOLVED URL, never from the filename.** The
 * fixture deliberately shuffles urls, so a filename-derived label would mislabel every entry the
 * ordering assertions compare.
 *
 * Modes: `hold` stalls ACQUISITION (the transport call never settles); `body` settles acquisition at
 * once and stalls INSIDE the transfer, after the first chunk has been handed over. The pair is the
 * signature clause 20.c needs — a runner that released its slot at headers and consumed the body
 * outside the pool reads 8 in `hold` and 20 in `body`.
 *
 * @param {any} manifest @param {Map<string, Uint8Array>} bytesByTag
 * @param {{ mode?: "hold" | "body", failing?: readonly string[], open?: boolean }} [options]
 */
function transportStub(manifest, bytesByTag, { mode = "hold", failing = [], open = false } = {}) {
  /** @type {Map<string, string>} */
  const tagByUrl = new Map();
  for (const [tag, file] of Object.entries(manifest.files))
    tagByUrl.set(new URL(/** @type {any} */ (file).url, manifest.baseUrl).href, tag);

  const failingSet = new Set(failing);
  /** @type {{ n: number, locale: string, url: string }[]} */
  const calls = [];
  /** @type {{ n: number, locale: string, outstanding: number }[]} */
  const violations = [];
  /** @type {string[]} */
  const unknownUrls = [];
  /** @type {Map<string, { locale: string, pulls: number, stalledInBody: boolean, finished: boolean }>} */
  const bodies = new Map();
  /** @type {Map<string, { promise: Promise<void>, resolve: () => void }>} */
  const gates = new Map();
  let outstanding = 0;
  let maxOutstanding = 0;
  let openAll = open;

  const gateFor = (/** @type {string} */ locale) => {
    let gate = gates.get(locale);
    if (gate === undefined) {
      /** @type {() => void} */
      let resolve = () => {};
      const promise = /** @type {Promise<void>} */ (new Promise((r) => { resolve = () => r(undefined); }));
      gate = { promise, resolve };
      gates.set(locale, gate);
      if (openAll) gate.resolve();
    }
    return gate;
  };
  const held = (/** @type {string} */ locale) =>
    (openAll ? Promise.resolve() : gateFor(locale).promise);

  const bodyRecord = (/** @type {string} */ locale) => {
    let record = bodies.get(locale);
    if (record === undefined) {
      record = { locale, pulls: 0, stalledInBody: false, finished: false };
      bodies.set(locale, record);
    }
    return record;
  };

  /** Invocation, recorded SYNCHRONOUSLY on entry — before any await inside the transport. */
  const begin = (/** @type {string} */ url) => {
    const known = tagByUrl.get(url);
    if (known === undefined) unknownUrls.push(url);
    const locale = known ?? `UNKNOWN(${url})`;
    outstanding += 1;
    maxOutstanding = Math.max(maxOutstanding, outstanding);
    calls.push({ n: calls.length + 1, locale, url });
    if (outstanding > CAP) violations.push({ n: calls.length, locale, outstanding });
    return locale;
  };
  const end = (/** @type {string} */ locale) => {
    outstanding -= 1;
    bodyRecord(locale).finished = true;
  };

  /** The chunking: one chunk when acquisition is what stalls, two when the BODY is. */
  const chunksFor = (/** @type {string} */ locale) => {
    const whole = /** @type {Uint8Array} */ (bytesByTag.get(locale));
    return mode === "body" ? [whole.slice(0, 1), whole.slice(1)] : [whole];
  };
  /** In `body` mode the stall is entered on the SECOND pull, i.e. after a real chunk was delivered. */
  const stallAt = mode === "body" ? 1 : Number.POSITIVE_INFINITY;

  const responseOf = (/** @type {string} */ locale) => {
    const chunks = chunksFor(locale);
    const record = bodyRecord(locale);
    let index = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            record.pulls += 1;
            if (index === stallAt) { record.stalledInBody = true; await held(locale); }
            if (index >= chunks.length) { end(locale); return { done: true, value: undefined }; }
            return { done: false, value: chunks[index++] };
          },
          cancel: async () => {},
        }),
      },
    };
  };

  const iterableOf = (/** @type {string} */ locale) => {
    const chunks = chunksFor(locale);
    const record = bodyRecord(locale);
    return (async function* () {
      for (let index = 0; index < chunks.length; index += 1) {
        record.pulls += 1;
        if (index === stallAt) { record.stalledInBody = true; await held(locale); }
        yield /** @type {Uint8Array} */ (chunks[index]);
      }
      end(locale);
    })();
  };

  return {
    /** `lokalized/load`'s injection surface (plan 6.2:1950-1958). */
    fetch: async (/** @type {string} */ url) => {
      const locale = begin(url);
      if (mode === "hold") {
        await held(locale);
        if (failingSet.has(locale)) { end(locale); return { ok: false, status: 404 }; }
      }
      return responseOf(locale);
    },
    /** `lokalized/node`'s injection surface (plan 6.2:2001-2007), the AsyncIterable arm. */
    readFile: async (/** @type {string} */ url) => {
      const locale = begin(url);
      if (mode === "hold") {
        await held(locale);
        if (failingSet.has(locale)) { end(locale); throw new Error(`${locale}: injected read failure`); }
      }
      return iterableOf(locale);
    },
    calls,
    violations,
    unknownUrls,
    bodies,
    locales: () => calls.map((call) => call.locale),
    maxOutstanding: () => maxOutstanding,
    release: (/** @type {string} */ locale) => { gateFor(locale).resolve(); },
    releaseAll: () => { openAll = true; for (const gate of gates.values()) gate.resolve(); },
    /**
     * Run the event loop until the invocation count has been still for twenty consecutive turns.
     *
     * Adaptive rather than a fixed sleep, because a released read runs through an ASYNCHRONOUS
     * digest before its worker can claim the next index, and a fixed number of turns that happened
     * to be enough on one machine is the kind of number that fails in CI and nowhere else.
     */
    drain: async () => {
      let last = -1;
      let stable = 0;
      for (let turn = 0; turn < 600 && stable < 20; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (calls.length === last) stable += 1;
        else { last = calls.length; stable = 0; }
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

/** @typedef {ReturnType<typeof transportStub>} Stub */

/**
 * The two doors, driven through their own option surfaces.
 *
 * `stage` differs by door and is part of the public taxonomy (plan 6.2:2078), so the failure row
 * below asserts the door's own value rather than one literal for both.
 */
const DOORS = Object.freeze([
  Object.freeze({
    name: "lokalized/load (Fetch transport)",
    baseUrl: "https://catalogs.invalid/c/",
    stage: "fetch",
    options: (/** @type {Stub} */ stub) => ({ fetch: stub.fetch }),
    whole: (/** @type {any} */ m, /** @type {any} */ o) => loadEntireManifest(m, o),
    subset: (/** @type {any} */ m, /** @type {string} */ tag, /** @type {any} */ o) => loadStrings(m, tag, o),
  }),
  Object.freeze({
    name: "lokalized/node (file: transport)",
    baseUrl: "file:///lokalized/clause-20/",
    stage: "read",
    options: (/** @type {Stub} */ stub) => ({ readFile: stub.readFile }),
    whole: (/** @type {any} */ m, /** @type {any} */ o) => loadEntireManifestFromFiles(m, o),
    subset: (/** @type {any} */ m, /** @type {string} */ tag, /** @type {any} */ o) => loadStringsFromFiles(m, tag, o),
  }),
]);

/** Never await an unsettled load: capture its outcome instead, so no probe can hang. */
const started = (/** @type {Promise<any>} */ promise) =>
  promise.then((value) => ({ resolved: true, value, error: /** @type {any} */ (null) }),
    (error) => ({ resolved: false, value: /** @type {any} */ (null), error }));

/** Release named reads ONE AT A TIME, draining between each, so every admission is deterministic. */
async function releaseInTurn(/** @type {Stub} */ stub, /** @type {readonly string[]} */ locales) {
  for (const locale of locales) {
    stub.release(locale);
    await stub.drain();
  }
}

const slotsToTags = (/** @type {readonly number[]} */ slots) =>
  slots.map((slot) => /** @type {string} */ (PLAN_TAGS[slot]));

// -------------------------------------------------------------------------------------------
// CONTROL-0 and the fixture's own preconditions. Every count below is read as "the cap held" only
// because this row proves the same fixture loads end to end through the same stub: a quiescent
// count of 8 that was really an upstream ConfigurationError (plan 6.2:2072-2076 refuses before any
// per-file plan exists) would otherwise be indistinguishable from a held cap.
// -------------------------------------------------------------------------------------------

test("CONTROL-0: the twenty-file fixture loads completely through both doors", async () => {
  assert.equal(DOORS.length, 2, "both transports must be exercised; a one-door table proves half the clause");
  assert.equal(typeof globalThis.crypto?.subtle?.digest, "function",
    "the Fetch door fails CLOSED without WebCrypto, which would make every count below a zero");

  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    assert.doesNotThrow(() => validateStringsManifest(manifest), `${door.name}: the fixture must validate`);

    // THE DISCRIMINATING INPUT IS PROVEN PRESENT, not assumed: without more than eight planned files
    // there is no queue, and every ordering assertion below would be vacuously satisfied.
    assert.equal(Object.keys(manifest.files).length, 20, `${door.name}: twenty files`);
    assert.ok(20 > CAP, "the plan must exceed the cap or nothing is ever queued");

    // The four orders the fixture keeps apart. If any two coincided, an implementation following the
    // wrong one would pass the ordering rows by coincidence.
    const keyOrder = Object.keys(manifest.files);
    const urlOrder = [...PLAN_TAGS].sort((a, b) =>
      (manifest.files[a].url < manifest.files[b].url ? -1 : 1));
    const sizeOrder = [...PLAN_TAGS].sort((a, b) =>
      /** @type {Uint8Array} */ (bytesByTag.get(a)).length - /** @type {Uint8Array} */ (bytesByTag.get(b)).length);
    const planOrder = [...PLAN_TAGS];
    assert.deepEqual(planOrder, [...PLAN_TAGS].sort(),
      "PLAN_TAGS is written ASCII-ascending, which is what plan 6.2:2111 makes the whole-manifest plan");
    for (const [left, right, label] of /** @type {[string[], string[], string][]} */ ([
      [planOrder, keyOrder, "plan vs manifest key insertion order"],
      [planOrder, urlOrder, "plan vs url lexicographic order"],
      [planOrder, sizeOrder, "plan vs catalog byte-length order"],
      [keyOrder, urlOrder, "key order vs url order"],
      [keyOrder, sizeOrder, "key order vs size order"],
      [urlOrder, sizeOrder, "url order vs size order"],
    ])) assert.notDeepEqual(left, right, `${door.name}: ${label} must differ`);

    const stub = transportStub(manifest, bytesByTag, { open: true });
    const loaded = await door.whole(manifest, door.options(stub));

    assert.equal(loaded.complete, true, `${door.name}: the fixture must load end to end`);
    assert.equal(loaded.failures.length, 0, `${door.name}: no failures`);
    assert.equal(Object.keys(loaded.catalogs).length, 20, `${door.name}: twenty catalogs`);
    assert.equal(loaded.requestedFiles.length, 20, `${door.name}: twenty planned files`);
    assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ f) => f.locale), [...PLAN_TAGS],
      `${door.name}: plan 6.2:2111 — normalized-tag order, NOT the manifest's shuffled key order`);
    assert.equal(stub.unknownUrls.length, 0,
      `${door.name}: every requested url resolved to a manifest file: ${stub.unknownUrls.join(", ")}`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

// -------------------------------------------------------------------------------------------
// Conjunct 20.a — at most eight.
// -------------------------------------------------------------------------------------------

test("clause 20: twenty stalled reads produce exactly EIGHT transport invocations", async () => {
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { mode: "hold" });
    const outcome = started(door.whole(manifest, door.options(stub)));
    await stub.drain();

    // Not a sampled peak: nothing can finish, so this count is how many reads the loader is WILLING
    // to have outstanding. A cap of sixteen cannot hide behind fast completions here.
    assert.equal(stub.calls.length, CAP,
      `${door.name}: with every read stalled the loader invoked the transport ${stub.calls.length} times`);
    assert.deepEqual(stub.violations, [],
      `${door.name}: a ninth read went active — ${JSON.stringify(stub.violations)}`);
    assert.equal(stub.maxOutstanding(), CAP, `${door.name}: peak outstanding reads`);
    assert.deepEqual(stub.locales(), PLAN_TAGS.slice(0, CAP),
      `${door.name}: the first eight invocations are the first eight PLAN entries`);
    assert.equal(stub.unknownUrls.length, 0, `${door.name}: ${stub.unknownUrls.join(", ")}`);

    stub.releaseAll();
    await stub.drain();
    const settled = await outcome;
    assert.equal(settled.resolved, true, `${door.name}: releasing everything completes the load`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

// -------------------------------------------------------------------------------------------
// Conjunct 20.b — and not FEWER than eight. This is the row the shipped `peak <= 8 && peak > 1`
// gate cannot make: a loader capped at four satisfies both of its halves.
//
// CONTROL-8-CAPACITY lives here and its ablation behaviour is the OPPOSITE of a trap-2 guard's:
// under a cap narrowed to four it goes RED, and that red is the applier's confirmation that the cap
// literal moved. The trap-2 guard is the separate CONTROL-8-COMPLETES row below, which must stay
// green under every cap mutation.
// -------------------------------------------------------------------------------------------

test("clause 20: EIGHT is the cap, not an upper bound the fixture never reaches", async () => {
  const EIGHT_TAGS = PLAN_TAGS.slice(0, CAP);
  let doorsExercised = 0;
  for (const door of DOORS) {
    // CONTROL-8-CAPACITY: eight reads CAN be simultaneously active through this stub, so a low count
    // in the twenty-file run is a property of the loader and not a ceiling imposed by the harness.
    const eight = fixture(EIGHT_TAGS, { baseUrl: door.baseUrl });
    const eightStub = transportStub(eight.manifest, eight.bytesByTag, { mode: "hold" });
    const eightOutcome = started(door.whole(eight.manifest, door.options(eightStub)));
    await eightStub.drain();
    assert.equal(eightStub.calls.length, CAP,
      `${door.name}: CONTROL-8-CAPACITY — eight stalled files must all be in flight`);
    eightStub.releaseAll();
    await eightStub.drain();
    assert.equal((await eightOutcome).resolved, true, `${door.name}: the eight-file control completes`);

    // The lower bound itself, on a plan four times the size. `>= 1` and `<= 8` are separately
    // falsifiable and have OPPOSITE ablations; only an equality catches both.
    const twenty = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(twenty.manifest, twenty.bytesByTag, { mode: "hold" });
    const outcome = started(door.whole(twenty.manifest, door.options(stub)));
    await stub.drain();
    assert.equal(stub.calls.length, CAP,
      `${door.name}: twenty stalled files put ${stub.calls.length} reads in flight, not ${CAP}`);
    stub.releaseAll();
    await stub.drain();
    await outcome;
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

test("CONTROL-8-COMPLETES: an eight-file load resolves whatever the cap turns out to be", async () => {
  // The trap-2 guard for the row above, kept separate ON PURPOSE. A cap of four, or a fully serial
  // loader, still COMPLETES an eight-file load — so a red here means the fixture or the manifest is
  // broken and disqualifies the capacity observation rather than confirming it.
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS.slice(0, CAP), { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { open: true });
    const loaded = await door.whole(manifest, door.options(stub));
    assert.equal(loaded.complete, true, `${door.name}: the eight-file fixture loads`);
    assert.equal(Object.keys(loaded.catalogs).length, CAP, `${door.name}: eight catalogs`);
    assert.equal(stub.calls.length, CAP, `${door.name}: eight files were read`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

// -------------------------------------------------------------------------------------------
// Conjunct 20.c — a slot spans the BYTE TRANSFER, not merely the acquisition call.
//
// Plan 6.2:2095-2096 is what makes this load-bearing rather than pedantic: each active read retains
// one bounded body buffer plus a digest copy, so a cap that released at headers would budget for
// eight buffers and allocate twenty.
// -------------------------------------------------------------------------------------------

test("clause 20: eight reads stalled MID-BODY still hold the pool closed", async () => {
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });

    // Mode H first, on the identical fixture, so any H/B difference is attributable to the body
    // stage and to nothing else.
    const holding = transportStub(manifest, bytesByTag, { mode: "hold" });
    const holdOutcome = started(door.whole(manifest, door.options(holding)));
    await holding.drain();
    assert.equal(holding.calls.length, CAP, `${door.name}: Mode H invocations`);
    holding.releaseAll();
    await holding.drain();
    await holdOutcome;

    const stub = transportStub(manifest, bytesByTag, { mode: "body" });
    const outcome = started(door.whole(manifest, door.options(stub)));
    await stub.drain();

    // THE ANTI-VACUITY GATE, asserted BEFORE the count it qualifies. If the loader had handed the
    // eight responses to a stage that never began pulling, Mode B would be byte-for-byte the same
    // execution as Mode H and this row would report 8 having exercised only the dispatch it shares
    // with 20.a. A red HERE is "the body stage was never entered; Mode B degenerated to Mode H" —
    // NOT-PROVEN for a stated reason — and must not be read as the count failing.
    const stalled = [...stub.bodies.values()].filter((body) => body.stalledInBody);
    assert.equal(stalled.length, CAP,
      `${door.name}: ${stalled.length} bodies are stalled mid-transfer; the probe never entered the body stage`);
    assert.equal(stalled.filter((body) => body.pulls >= 1).length, CAP,
      `${door.name}: every stalled body must have delivered at least one chunk first`);
    assert.equal(stalled.filter((body) => body.finished).length, 0,
      `${door.name}: a stalled body has not finished`);

    assert.equal(stub.calls.length, CAP,
      `${door.name}: Mode B invocations — a slot released at headers reads 20 here while Mode H reads 8`);
    assert.equal(stub.maxOutstanding(), CAP,
      `${door.name}: a runner that released at headers and re-entered the pool for the body is caught here`);
    assert.deepEqual(stub.violations, [], `${door.name}: ${JSON.stringify(stub.violations)}`);

    stub.releaseAll();
    await stub.drain();
    assert.equal((await outcome).resolved, true, `${door.name}: released bodies complete the load`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

test("CONTROL-B: a body stalled mid-transfer and then released loads normally", async () => {
  // Without this, a red in the row above could be "a two-chunk body is itself a failure path".
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { mode: "body", open: true });
    const loaded = await door.whole(manifest, door.options(stub));
    assert.equal(loaded.complete, true, `${door.name}: a chunked body loads`);
    assert.equal(Object.keys(loaded.catalogs).length, 20, `${door.name}: twenty catalogs`);
    assert.equal(loaded.failures.length, 0, `${door.name}: the digest over reassembled chunks matches`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

// -------------------------------------------------------------------------------------------
// Conjunct 20.d — queued work retains fetch-plan order. The conjunct nothing in the tree probed.
// -------------------------------------------------------------------------------------------

test("clause 20: queued work is admitted in PLAN order when slots free out of order", async () => {
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { mode: "hold" });
    const outcome = started(door.whole(manifest, door.options(stub)));
    await stub.drain();
    assert.equal(stub.calls.length, CAP, `${door.name}: eight in flight before any release`);

    // Released one at a time, in a derangement of the slot positions, each followed by a drain — so
    // exactly one slot is free at a time and every admission is deterministic.
    await releaseInTurn(stub, slotsToTags(RELEASE_DERANGEMENT));

    assert.equal(stub.calls.length, 2 * CAP,
      `${door.name}: eight releases must admit eight queued entries`);
    assert.deepEqual(stub.locales().slice(CAP, 2 * CAP), PLAN_TAGS.slice(CAP, 2 * CAP),
      `${door.name}: admissions 9-16 are P8..P15 in plan order. A striped pool admits the SAME SET ` +
      `in the order [ja, fi, nl, hi, ko, fr, it, hu]; a set comparison is green over it`);

    // Drive the remaining four admissions the same way, so the FULL sequence stays deterministic
    // rather than depending on which of eight concurrent digests resolved first.
    await releaseInTurn(stub, PLAN_TAGS.slice(CAP, 2 * CAP));
    assert.equal(stub.calls.length, 20, `${door.name}: every planned file was eventually read`);
    assert.deepEqual(stub.locales(), [...PLAN_TAGS],
      `${door.name}: the whole invocation sequence is the plan, compared as a SEQUENCE`);

    // Asserted against the authored literal above AND, separately, against the loader's own reported
    // plan — so a divergence says whether the plan moved or the admission order did.
    stub.releaseAll();
    await stub.drain();
    const settled = await outcome;
    assert.equal(settled.resolved, true, `${door.name}: the load resolves`);
    assert.deepEqual(settled.value.requestedFiles.map((/** @type {any} */ f) => f.locale), [...PLAN_TAGS],
      `${door.name}: the loader's OWN plan agrees with the literal (plan 6.2:2111)`);

    // Steady state, not just initial fill: a runner pumping its queue from both a settle handler and
    // a separate poll leaves the first eight at eight and the sequence in perfect order while nine
    // reads are active. Only this counter sees it.
    assert.equal(stub.maxOutstanding(), CAP, `${door.name}: peak outstanding across the WHOLE run`);
    assert.deepEqual(stub.violations, [], `${door.name}: ${JSON.stringify(stub.violations)}`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

test("CONTROL-D: releasing in PLAN order admits the same sequence — the probe an author writes first", async () => {
  // Kept as a control, never as evidence. A striped worker pool passes this row by arithmetic:
  // releasing slot s admits stripe s's next item, which under in-order release is P8..P15 in order.
  // Its staying green while the derangement row goes red is what names the defect as an ADMISSION
  // ORDER defect rather than a dispatch one.
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { mode: "hold" });
    const outcome = started(door.whole(manifest, door.options(stub)));
    await stub.drain();
    await releaseInTurn(stub, slotsToTags(RELEASE_IN_PLAN_ORDER));
    assert.deepEqual(stub.locales().slice(CAP, 2 * CAP), PLAN_TAGS.slice(CAP, 2 * CAP),
      `${door.name}: in-order releases admit P8..P15`);
    stub.releaseAll();
    await stub.drain();
    assert.equal((await outcome).resolved, true, `${door.name}: the load resolves`);
    assert.equal(stub.maxOutstanding(), CAP, `${door.name}: peak outstanding across the whole run`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

// -------------------------------------------------------------------------------------------
// Conjunct 20.e — the FAILURE path is a second admission site.
//
// The failing entry is `cs` (P2) and never the fallback locale: plan 6.2:2082-2083 rejects the whole
// load outright when the resolved fallback-locale file fails, which would end the run before the
// queue was ever consulted. `en` (P6) is in the first eight and always succeeds, so allow-partial's
// precondition holds and a rejection cannot be mistaken for a queue that stopped draining.
// -------------------------------------------------------------------------------------------

test("clause 20: a FAILED read frees its slot and admits the next plan entry", async () => {
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { mode: "hold", failing: ["cs"] });
    const outcome = started(door.whole(manifest, { ...door.options(stub), partialFailure: "allow-partial" }));
    await stub.drain();
    assert.equal(stub.calls.length, CAP, `${door.name}: eight in flight`);

    // The failure first, then the seven survivors in the derangement with slot 2 HELD OUT — it has
    // already been released, as a failure.
    stub.release("cs");
    await stub.drain();
    assert.equal(stub.calls.length, CAP + 1,
      `${door.name}: the failed read's slot admitted the next entry; a runner that drains its queue ` +
      `only from the success path stops here at ${stub.calls.length}`);
    await releaseInTurn(stub, slotsToTags(RELEASE_DERANGEMENT.filter((slot) => slot !== 2)));

    assert.equal(stub.calls.length, 2 * CAP,
      `${door.name}: all eight slots were refilled, the failed one included`);
    assert.deepEqual(stub.locales().slice(CAP, 2 * CAP), PLAN_TAGS.slice(CAP, 2 * CAP),
      `${door.name}: the failure does not disturb admission order`);

    // The resolved result, reached by releasing everything that is still outstanding. Without this
    // terminal phase the assertions below would be made on a promise that never settles.
    await releaseInTurn(stub, PLAN_TAGS.slice(CAP, 2 * CAP));
    stub.releaseAll();
    await stub.drain();
    const settled = await outcome;

    assert.equal(settled.resolved, true,
      `${door.name}: allow-partial with a healthy fallback resolves: ${settled.error}`);
    assert.equal(settled.value.complete, false, `${door.name}: a partial result makes no parity claim`);
    assert.equal(settled.value.failures.length, 1, `${door.name}: exactly one failure`);
    assert.equal(settled.value.failures[0].locale, "cs", `${door.name}: the injected one`);
    assert.equal(settled.value.failures[0].stage, door.stage,
      `${door.name}: the stage is this door's own (plan 6.2:2078)`);
    assert.equal(Object.keys(settled.value.catalogs).length, 19, `${door.name}: nineteen catalogs`);
    // The lost read is caught in the RESOLVED result as well as at quiescence: under a runner that
    // drops a slot on failure, allow-partial returns a successful load that silently skipped a file
    // the caller asked for — the S11a scheme-boundary shape.
    assert.equal(stub.calls.length, 20, `${door.name}: every planned file was read exactly once`);
    assert.equal(stub.maxOutstanding(), CAP, `${door.name}: peak outstanding across the whole run`);
    assert.deepEqual(stub.violations, [], `${door.name}: ${JSON.stringify(stub.violations)}`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

test("CONTROL-E: with nothing failing, the same release schedule admits the same sequence", async () => {
  // The row above reaches both completion paths; this one reaches only the success path, which is
  // exactly why it is a control. It stays green over a runner that drains its queue from the success
  // branch alone — that contrast is what names the failure path as the site at fault.
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(PLAN_TAGS, { baseUrl: door.baseUrl });
    const stub = transportStub(manifest, bytesByTag, { mode: "hold" });
    const outcome = started(door.whole(manifest, { ...door.options(stub), partialFailure: "allow-partial" }));
    await stub.drain();
    await releaseInTurn(stub, ["cs", ...slotsToTags(RELEASE_DERANGEMENT.filter((slot) => slot !== 2))]);
    assert.equal(stub.calls.length, 2 * CAP, `${door.name}: eight releases, eight admissions`);
    assert.deepEqual(stub.locales().slice(CAP, 2 * CAP), PLAN_TAGS.slice(CAP, 2 * CAP),
      `${door.name}: the admission sequence is not an artefact of the failure`);
    stub.releaseAll();
    await stub.drain();
    const settled = await outcome;
    assert.equal(settled.resolved, true, `${door.name}: the load resolves`);
    assert.equal(settled.value.complete, true, `${door.name}: nothing failed`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});

// -------------------------------------------------------------------------------------------
// The LOOKUP-SUBSET door, whose plan is derived by different code entirely (plan 6.1:1890's
// first-use order through the candidate chain, not plan 6.2:2111's normalized-tag order).
// -------------------------------------------------------------------------------------------

test("clause 20: the cap and the admission order hold on a fetchSet-derived plan", async () => {
  let doorsExercised = 0;
  for (const door of DOORS) {
    const { manifest, bytesByTag } = fixture(SUBSET_TAGS, {
      baseUrl: door.baseUrl,
      fallbackLocale: "en",
      tiebreakers: { en: [...SUBSET_REGIONS, "en"] },
    });

    // The preconditions, each as its own named assertion. Without a plan longer than the cap there
    // is no queue; and if this plan happened to be sorted or to be the manifest's key order, the
    // sequence assertions below would be satisfied by an implementation following the wrong one.
    const plan = fetchSet(manifest, "en-GB").map((/** @type {any} */ entry) => entry.locale);
    assert.deepEqual(plan, [...SUBSET_PLAN], `${door.name}: the fetchSet plan, as authored`);
    assert.ok(plan.length > CAP, `${door.name}: ${plan.length} planned files must exceed the cap of ${CAP}`);
    assert.notDeepEqual(plan, [...plan].sort(), `${door.name}: first-use order is not sorted order`);
    assert.notDeepEqual(plan, Object.keys(manifest.files).filter((tag) => plan.includes(tag)),
      `${door.name}: first-use order is not the manifest's key order`);
    assert.equal(Object.keys(manifest.files).length, 20,
      `${door.name}: the manifest declares a file the plan does NOT include, so the plan is a subset`);

    const stub = transportStub(manifest, bytesByTag, { mode: "hold" });
    const outcome = started(door.subset(manifest, "en-GB", door.options(stub)));
    await stub.drain();
    assert.equal(stub.calls.length, CAP, `${door.name}: the cap holds on the subset door too`);
    assert.deepEqual(stub.locales(), plan.slice(0, CAP),
      `${door.name}: dispatch follows the PLAN, not the manifest's keys and not sorted order`);

    // The DERANGEMENT again, not plan order: releasing slot s in plan order is green over a striped
    // pool here for exactly the reason CONTROL-D is, and this row would then decorate rather than
    // discriminate.
    await releaseInTurn(stub, RELEASE_DERANGEMENT.map((slot) => /** @type {string} */ (plan[slot])));
    assert.deepEqual(stub.locales().slice(CAP, 2 * CAP), plan.slice(CAP, 2 * CAP),
      `${door.name}: queued admissions retain fetch-plan order`);

    stub.releaseAll();
    await stub.drain();
    const settled = await outcome;
    assert.equal(settled.resolved, true, `${door.name}: the subset load resolves: ${settled.error}`);
    assert.equal(settled.value.complete, true, `${door.name}: nothing failed`);
    assert.deepEqual(settled.value.requestedFiles.map((/** @type {any} */ f) => f.locale), [...SUBSET_PLAN],
      `${door.name}: the loader's own plan agrees with the literal`);
    assert.equal(stub.calls.length, plan.length, `${door.name}: every planned file was read once`);
    assert.equal(stub.maxOutstanding(), CAP, `${door.name}: peak outstanding across the whole run`);
    assert.deepEqual(stub.violations, [], `${door.name}: ${JSON.stringify(stub.violations)}`);
    doorsExercised += 1;
  }
  assert.equal(doorsExercised, DOORS.length, "both doors ran");
});
