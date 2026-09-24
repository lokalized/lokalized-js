// @ts-check
/**
 * The per-request Fetch init — plan 6.2:2088-2089, M8 acceptance clause 21:
 * "Fetch requests default to `{mode: "cors", credentials: "same-origin"}`; the bounded `request`
 * override is applied identically to every planned catalog request."
 *
 * **WHY THE OBVIOUS PROBE FAILS, and it fails three separate ways.**
 *
 * 1. **Two files is not "every".** `fetch-loader.test.js`'s existing "request defaults are applied
 *    identically to every planned request" drives a TWO-file manifest. Plan 6.2:2087 keeps eight
 *    catalog reads active at once, so every request in that fixture is in the FIRST dispatch window:
 *    an init that is built once per window, or once per worker slot, is indistinguishable from one
 *    built per request. The fixtures here plan TWELVE files and the window is OBSERVED (exactly eight
 *    calls at quiescence) rather than assumed from the cardinality, because "index 8 was in a later
 *    window" is otherwise a claim about the scheduler that the probe never made.
 *
 * 2. **The Fetch spec's own defaults are byte-identical to the plan's.** `new Request(url)` already
 *    has `mode: "cors"` and `credentials: "same-origin"`, so an assertion phrased over the raw `init`
 *    object (`init.mode === "cors"`) would go RED against a conforming loader that passed a `Request`,
 *    while one phrased over a `Request`'s getters would go GREEN over a loader that set nothing at
 *    all. Every assertion below therefore reads an EFFECTIVE init — the value `fetch` would actually
 *    use, resolved from `init`, then from a passed `Request`, then from the spec default. That is the
 *    correct reading of the clause (its observable content is the request, not the literal), and the
 *    half it cannot see is recorded at the bottom of this comment.
 *
 * 3. **One door proves nothing about the other.** `loadStrings` and `loadEntireManifest` are two
 *    entry points over one runner, and plan 6.2:2111-2113 defines "planned" differently for each. The
 *    four cells of {door} x {default, override} are each covered by a SEPARATELY failing assertion
 *    here; the design this file was written from covered three of them, and the missing cell — the
 *    lookup door with no override — is a single-fault defect that the other three are all blind to.
 *
 * **ANTI-VACUITY.** Every load below poisons `globalThis.fetch` so a loader that ignored
 * `options.fetch` would reject loudly rather than leave an empty `calls` array for the
 * "all observed inits are X" assertions to pass over. The one exception is the platform-transport
 * test, which installs the stub AS `globalThis.fetch` on purpose: without it, a loader that threaded
 * `request` through its injected branch only would be green everywhere.
 *
 * **WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, so nobody "strengthens" it later:**
 *   - **merge vs. replace of a partial override is not observable.** Because the plan's two defaults
 *     are the platform's two defaults, a loader that REPLACED them with `{credentials: "include"}`
 *     emits a request whose effective mode is `cors` — the required value. Both readings coincide.
 *     What IS falsifiable is that the unspecified field does not take some OTHER value, and the
 *     partial-override test proves that.
 *   - **whether the loader sets the fields explicitly.** `fetch(url)` and
 *     `fetch(url, {mode: "cors", credentials: "same-origin"})` produce identical requests. Any WRONG
 *     explicit value is caught here; the literal's shape is a source claim, and this project checks
 *     those with a graph test (`test/ssr-graph.test.js`), not with a behavioural assertion.
 *   - **preload reuse.** Plan 6.2:2184-2187 says the default pair exists so an anonymous
 *     `<link rel="preload" as="fetch" crossorigin>` is REUSED, and that M8 proves ONE network
 *     request. That is a property of a real browser's preload cache; Node has none. These probes
 *     prove the VALUES that make reuse possible, never the reuse.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCatalogIdentity, fetchSet, validateStringsManifest } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { parseStrings } from "../src/parse/index.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { wholeManifestPlan } from "../src/load/run-plan.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";
import { untilSettled } from "../tools/test-support/settle.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Greeting: `hello ${tag}` });

/**
 * A manifest whose declared fingerprint matches its own contents.
 *
 * The fingerprint is computed with the PORT's own `computeCatalogIdentity`, never hard-coded: a
 * hard-coded pair rots the next time pinned data moves, and every load in this file would then be
 * refused before any request — which is the zero-call arm, not a pass.
 *
 * @param {readonly string[]} tags
 * @param {{ fallbackLocale?: string, tiebreakers?: Record<string, readonly string[]>,
 *           strayOn?: string, declaredBytesOn?: string }} [shape]
 */
function manifest(tags, shape = {}) {
  const { fallbackLocale = "en", tiebreakers = {}, strayOn, declaredBytesOn } = shape;
  const files = Object.fromEntries(tags.map((tag) => {
    const bytes = utf8.encode(bodyFor(tag));
    return [tag, {
      url: `${tag}.json`,
      sha256: sha256Hex(bytes),
      ...(tag === declaredBytesOn ? { decodedBytes: bytes.length } : {}),
      // Init-shaped members on a FILE RECORD. Plan 6.1:1836-1841 bounds a planned entry to
      // {locale, url, sha256, expectedDecodedBytes?}; these exist so a planner that reuses the
      // record as the entry base has something observable to carry through.
      ...(tag === strayOn ? { mode: "no-cors", credentials: "include", headers: { "x-leak": "1" } } : {}),
    }];
  }));
  const draft = {
    formatVersion: 1, catalogVersion: "1", catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY,
    // https is mandatory: plan 6.1:1917-1918 makes the Fetch door refuse any other resolved scheme
    // before catalog I/O, and a `file:` fixture would land every test in the zero-call arm.
    fallbackLocale, baseUrl: "https://catalogs.example.test/v1/", files, tiebreakers,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/**
 * Twelve DISTINCT primary languages, which is what makes the fixture legal without tiebreakers:
 * plan 6.2:2103 refuses a manifest declaring two catalogs for one language and no order between
 * them. Twelve, not two, because plan 6.2:2087's window is eight.
 */
const TWELVE = ["en", "fr", "de", "es", "it", "pt", "nl", "sv", "da", "fi", "pl", "cs"];
const M12 = manifest(TWELVE);
/** Under the window on purpose — see the override test that uses it. */
const M4 = manifest(["en", "fr", "de", "es"]);
/** Plan 8.3's own seed row, so the lookup door plans more than one file. */
const MZH = manifest(["zh", "zh-Hant", "en"], { tiebreakers: { zh: ["zh", "zh-Hant"] } });
/** M12 with init-shaped stray members on one file record, and a declared size on another. */
const M12B = manifest(TWELVE, { strayOn: "de", declaredBytesOn: "fr" });

const BODIES = new Map(TWELVE.concat(["zh", "zh-Hant"]).map((tag) =>
  [`https://catalogs.example.test/v1/${tag}.json`, utf8.encode(bodyFor(tag))]));

/**
 * The EFFECTIVE `{mode, credentials}` of one call, which is what the clause is about.
 *
 * The trailing `?? "cors"` / `?? "same-origin"` are the Fetch spec's own defaults and they are
 * applied HERE, in the observer, deliberately: a loader calling `fetch(url)` with no init genuinely
 * produces a request with exactly those values, so green is the right answer for it. Any OTHER
 * value, arriving on `init` or on a passed `Request`, is read verbatim and reported.
 *
 * @param {any} input @param {any} [init]
 */
function effectiveInit(input, init) {
  const fromRequest = typeof Request === "function" && input instanceof Request
    ? { url: input.url, mode: /** @type {any} */ (input).mode, credentials: /** @type {any} */ (input).credentials }
    : { url: String(input?.url ?? input), mode: undefined, credentials: undefined };
  return {
    url: fromRequest.url,
    mode: init?.mode ?? fromRequest.mode ?? "cors",
    credentials: init?.credentials ?? fromRequest.credentials ?? "same-origin",
    rawInit: init,
  };
}

const fmt = (/** @type {{ mode: string, credentials: string }} */ call) => `${call.mode}|${call.credentials}`;

/** A 200 whose body is the catalog the URL names. Throws on a URL no plan contains. */
function responseFor(/** @type {string} */ url) {
  const bytes = BODIES.get(url);
  // A SECOND GUARD, not decoration: a loader that resolved `en.json` against the wrong base would
  // otherwise be served a plausible body and the URL assertions would be the only thing to notice.
  if (bytes === undefined) throw new Error(`the stub was asked for ${url}, which no plan contains`);
  let sent = false;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      cancel: async () => {},
    }) },
  };
}

/** A transport that records the effective init of every call and answers immediately. */
function recordingFetch(/** @type {(url: string) => any} */ respond = responseFor) {
  /** @type {ReturnType<typeof effectiveInit>[]} */
  const calls = [];
  return {
    calls,
    impl: async (/** @type {any} */ input, /** @type {any} */ init) => {
      const call = effectiveInit(input, init);
      calls.push(call);
      return respond(call.url);
    },
  };
}

/**
 * A transport that records calls and HOLDS every response until it is released.
 *
 * This is what turns "the fixture has twelve files" into "a second dispatch window was observed".
 * Releases are LIFO, so completion order inverts plan order inside each window — free hardening
 * against an init built from completion-indexed state.
 */
function gatedFetch() {
  /** @type {ReturnType<typeof effectiveInit>[]} */
  const calls = [];
  /** @type {(() => void)[]} */
  const gates = [];
  return {
    calls,
    impl: async (/** @type {any} */ input, /** @type {any} */ init) => {
      const call = effectiveInit(input, init);
      calls.push(call);
      return new Promise((resolve) => gates.push(() => resolve(responseFor(call.url))));
    },
    /** @returns {number} how many were held */
    releaseAll() {
      const wave = gates.splice(0);
      for (let index = wave.length - 1; index >= 0; index -= 1) /** @type {() => void} */ (wave[index])();
      return wave.length;
    },
  };
}

/**
 * Run with `globalThis.fetch` replaced by a thrower.
 *
 * Without this, an implementation that ignored `options.fetch` would issue its requests through the
 * real platform fetch, leave `calls` empty, and satisfy every "all twelve observed inits are X"
 * assertion vacuously — an empty array passes `Array(0)`-shaped comparisons and would only be caught
 * by the length assertions, which is one guard too few for the shape of defect this file exists for.
 *
 * @template T @param {() => Promise<T>} run @returns {Promise<T>}
 */
async function withPoisonedGlobalFetch(run) {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (() => {
    throw new Error("globalThis.fetch must not be used; the injected transport was ignored");
  });
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

/** Every control this file uses for a whole-manifest load, in one place. */
function assertWholeManifestLoaded(/** @type {any} */ loaded, /** @type {number} */ files) {
  assert.equal(loaded.complete, true);
  assert.deepEqual([...loaded.failures], []);
  assert.equal(Object.keys(loaded.catalogs).length, files);
  assert.equal(loaded.coverage.kind, "entire-manifest");
}

// ---------------------------------------------------------------------------------------------
// Preconditions. These run FIRST and assert their own conditions rather than guarding anything:
// a test whose assertions sit behind a condition that is false reports green having executed
// nothing, which this project shipped once already.
// ---------------------------------------------------------------------------------------------

test("fixture preconditions: every manifest validates and WebCrypto is present", () => {
  // If any of these fails, every load below lands in the zero-call arm — refused before I/O — and
  // the init assertions would be red for a reason that has nothing to do with clause 21.
  assert.doesNotThrow(() => validateStringsManifest(M12));
  assert.doesNotThrow(() => validateStringsManifest(M4));
  assert.doesNotThrow(() => validateStringsManifest(MZH));
  assert.doesNotThrow(() => validateStringsManifest(M12B));
  assert.doesNotThrow(() => parseStrings(utf8.encode(bodyFor("en")), { locale: "en" }));
  assert.equal(typeof globalThis.crypto?.subtle?.digest, "function",
    "plan 6.2:2092-2093 preflights WebCrypto before catalog I/O; without it no request is issued at all");
  assert.ok(Object.keys(M12.files).length > 8,
    "plan 6.2:2087 caps concurrent catalog reads at eight; a fixture at or under the cap cannot " +
    "distinguish 'applied to every request' from 'applied to the first window'");
});

test("planned entries carry nothing beyond plan 6.1's four members", () => {
  // THE LEAK AXIS, probed where it can actually be reached. A manifest file record is caller data;
  // if it survived validation and was reused as the planned entry's base, its members would be one
  // spread away from the request init — and `no-cors` is not cosmetic, it yields an opaque response
  // whose bytes cannot be digested. Probing this through the loader would be inert, because the
  // planner strips the record first: the observation has to be made where the stripping happens.
  const validated = validateStringsManifest(M12B);
  assert.deepEqual(Object.keys(validated.files.de), ["url", "sha256"]);
  assert.equal(/** @type {any} */ (validated.files.de).mode, undefined);
  assert.equal(/** @type {any} */ (validated.files.de).credentials, undefined);
  assert.equal(/** @type {any} */ (validated.files.de).headers, undefined);

  const permitted = ["locale", "url", "sha256", "expectedDecodedBytes"];
  const strayKeys = (/** @type {readonly any[]} */ entries) =>
    entries.map((entry) => Object.keys(entry).filter((key) => !permitted.includes(key)));

  // BOTH PLANNERS. The two doors plan separately (plan 6.2:2111-2113) and a leak in one is invisible
  // to the other. `fr` carries a declared size on purpose: without it, a planner that spread the
  // whole file record would add nothing that is not already there, and the ablation could not land.
  const lookupPlan = fetchSet(M12B, "fr");
  assert.ok(lookupPlan.length >= 2, "the lookup fixture must plan more than one file");
  assert.deepEqual(strayKeys(lookupPlan), lookupPlan.map(() => []));
  assert.ok(lookupPlan.some((entry) => entry.expectedDecodedBytes !== undefined),
    "one planned entry must carry a declared size, or the record-spread ablation is inert");

  const wholePlan = wholeManifestPlan(validated);
  assert.equal(wholePlan.length, TWELVE.length);
  assert.deepEqual(strayKeys(wholePlan), wholePlan.map(() => []));
});

// ---------------------------------------------------------------------------------------------
// The {door} x {default, override} matrix. Four cells, four separately failing assertions. The two
// default cells come first, which also matters for the leak test at the bottom of the file.
// ---------------------------------------------------------------------------------------------

test("with no request option, every whole-manifest request is cors|same-origin", async () => {
  // The `request` KEY IS ABSENT, not present-and-undefined: the arm under test is the one a caller
  // who has never heard of the option takes.
  const stub = recordingFetch();
  const loaded = await withPoisonedGlobalFetch(() => loadEntireManifest(M12, { fetch: stub.impl }));

  assert.equal(stub.calls.length, TWELVE.length);
  assert.equal(new Set(stub.calls.map((call) => call.url)).size, TWELVE.length,
    "twelve distinct planned URLs, each fetched once — a probe that passed on one URL fetched twelve " +
    "times would prove nothing about 'every planned request'");
  // deepEqual over an array rather than `.every()`, so a failure names the offending INDEX and its
  // value, which is what tells a wrong default apart from a later-window defect.
  assert.deepEqual(stub.calls.map(fmt), Array(TWELVE.length).fill("cors|same-origin"));
  // The control, and it is what separates a discriminating red from a zh-123 red: any upstream
  // refusal (bad fingerprint, stale pinned data, non-https URL, missing WebCrypto) reds THESE with
  // `calls.length === 0`, which is distinguishable at a glance from the init assertion firing.
  assertWholeManifestLoaded(loaded, TWELVE.length);
});

test("with no request option, every lookup-door request is cors|same-origin", async () => {
  // THE CELL THE DESIGN MISSED. Every other default assertion drives `loadEntireManifest`, so a
  // lookup door carrying its own drifted defaults table is a single-fault defect that all of them
  // are structurally blind to.
  const plan = fetchSet(MZH, "zh-TW");
  assert.ok(plan.length >= 2, "the lookup fixture must plan more than one file, or this cell is vacuous");

  const stub = recordingFetch();
  const loaded = await withPoisonedGlobalFetch(() => loadStrings(MZH, "zh-TW", { fetch: stub.impl }));

  assert.equal(stub.calls.length, plan.length);
  assert.deepEqual(stub.calls.map((call) => call.url).sort(), plan.map((entry) => entry.url).sort(),
    "the observed requests must BE the planned ones, not an accidental set that collapsed to the fallback");
  assert.deepEqual(stub.calls.map(fmt), Array(plan.length).fill("cors|same-origin"));
  assert.equal(loaded.coverage.kind, "lookup");
  assert.equal(/** @type {any} */ (loaded.coverage).lookupLocale, "zh-TW");
  assert.deepEqual([...loaded.failures], []);
  assert.equal(Object.keys(loaded.catalogs).length, plan.length);
});

test("a supplied request override reaches every whole-manifest request", async () => {
  // BOTH VALUES ARE THE OFF-DEFAULT MEMBER of their bounded enumeration (plan 6.2:1953-1955), so
  // neither can be produced by a loader that forwards nothing — this cell is immune to the
  // spec-default hazard that constrains the two default cells.
  //
  // FOUR FILES, DELIBERATELY UNDER THE WINDOW. This cell's job is "the override arrived at all";
  // "it arrived at requests dispatched after the first window" is the next test's, and keeping the
  // fixtures apart is what lets the two reds be told apart.
  const stub = recordingFetch();
  const loaded = await withPoisonedGlobalFetch(() =>
    loadEntireManifest(M4, { fetch: stub.impl, request: { mode: "same-origin", credentials: "include" } }));

  assert.equal(stub.calls.length, 4);
  assert.deepEqual(stub.calls.map(fmt), Array(4).fill("same-origin|include"));
  assertWholeManifestLoaded(loaded, 4);
});

test("requests dispatched after the first eight-request window carry the same override", async () => {
  const stub = gatedFetch();
  const running = withPoisonedGlobalFetch(async () => {
    const loaded = await loadEntireManifest(M12, {
      fetch: stub.impl, request: { mode: "same-origin", credentials: "include" },
    });
    return loaded;
  });

  // THE WINDOW IS OBSERVED, NOT ASSUMED. Nothing settles until it is released, so the call count at
  // quiescence is an exact quantity with no timing in it. Without this assertion the test would be
  // claiming an observation it never made — "index 8 was in a later window" would be an inference
  // from the fixture's cardinality, and a port that fired all twelve at once would satisfy it.
  await untilSettled();
  assert.equal(stub.calls.length, 8,
    "plan 6.2:2087 caps concurrent catalog reads at eight; this test needs a real second window");

  assert.equal(stub.releaseAll(), 8);
  await untilSettled();
  assert.equal(stub.calls.length, TWELVE.length, "draining the first window must admit the remaining four");

  // c3's OWN assertion line, over the slice the first window cannot contain. A suite whose only
  // override assertion covered all twelve indices would red here too, but it would red at index 0 in
  // the earlier test as well and the two defects would be indistinguishable.
  assert.deepEqual(stub.calls.slice(8).map(fmt), Array(TWELVE.length - 8).fill("same-origin|include"),
    "requests dispatched after the first window must carry the same override as those inside it");
  assert.deepEqual(stub.calls.slice(0, 8).map(fmt), Array(8).fill("same-origin|include"));

  stub.releaseAll();
  assertWholeManifestLoaded(await running, TWELVE.length);
});

test("a supplied request override reaches every lookup-door request", async () => {
  const plan = fetchSet(MZH, "zh-TW");
  const stub = recordingFetch();
  const loaded = await withPoisonedGlobalFetch(() =>
    loadStrings(MZH, "zh-TW", { fetch: stub.impl, request: { mode: "same-origin", credentials: "include" } }));

  assert.equal(stub.calls.length, plan.length);
  assert.deepEqual(stub.calls.map((call) => call.url).sort(), plan.map((entry) => entry.url).sort());
  assert.deepEqual(stub.calls.map(fmt), Array(plan.length).fill("same-origin|include"));
  assert.equal(loaded.coverage.kind, "lookup");
  assert.deepEqual([...loaded.failures], []);
  assert.equal(Object.keys(loaded.catalogs).length, plan.length);
});

// ---------------------------------------------------------------------------------------------
// The remaining axes: a partial override, the platform transport, a mixed outcome, and leakage
// between loads.
// ---------------------------------------------------------------------------------------------

test("a partial override leaves the unspecified field at its documented default", async () => {
  // TWO RUNS, one per field, because a run that varied both could not tell which field the defaults
  // table got wrong — and a single run would be satisfied by a loader that hardcoded the other field.
  // The two default cells above and the two override cells are this test's flanking controls.
  const runA = recordingFetch();
  assert.equal(runA.calls.length, 0);
  const loadedA = await withPoisonedGlobalFetch(() =>
    loadEntireManifest(M12, { fetch: runA.impl, request: { credentials: "include" } }));
  assert.equal(runA.calls.length, TWELVE.length);
  assert.deepEqual(runA.calls.map(fmt), Array(TWELVE.length).fill("cors|include"));
  assertWholeManifestLoaded(loadedA, TWELVE.length);

  // A FRESH recorder, so a forgotten reset cannot let run A's entries satisfy run B's length.
  const runB = recordingFetch();
  assert.equal(runB.calls.length, 0);
  const loadedB = await withPoisonedGlobalFetch(() =>
    loadEntireManifest(M12, { fetch: runB.impl, request: { mode: "same-origin" } }));
  assert.equal(runB.calls.length, TWELVE.length);
  assert.deepEqual(runB.calls.map(fmt), Array(TWELVE.length).fill("same-origin|same-origin"));
  assertWholeManifestLoaded(loadedB, TWELVE.length);
});

test("the platform fetch receives the same init as an injected one", async () => {
  // THE ONE RUN THAT CANNOT POISON THE GLOBAL, and it closes a hole every other test has: they all
  // inject `options.fetch`, so a loader that threaded `request` through its injected branch and
  // called `globalThis.fetch(url)` bare otherwise would be green across the whole file while
  // shipping exactly the defect the clause exists to prevent — plan 6.2:2184-2187's preload reuse is
  // what breaks when the values differ.
  const stub = recordingFetch();
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (stub.impl);
  try {
    const loaded = await loadEntireManifest(M12, { request: { mode: "same-origin", credentials: "include" } });
    assert.equal(stub.calls.length, TWELVE.length,
      "the platform transport must be the one that ran; zero calls here means the load was refused");
    assert.deepEqual(stub.calls.map(fmt), Array(TWELVE.length).fill("same-origin|include"));
    assertWholeManifestLoaded(loaded, TWELVE.length);
  } finally {
    globalThis.fetch = real;
  }
});

test("a failing file does not disturb the init of the requests around it", async () => {
  // EVERY OTHER RUN IN THIS FILE SUCCEEDS ON EVERY REQUEST, so "applied identically to every planned
  // request" is otherwise only ever checked on an all-success plan. `de` sits at index 2 of twelve,
  // so the failure lands inside the first window with eight requests still to come: a loader that
  // rebuilt or reused init state around the failure path would show it in the tail.
  const stub = recordingFetch((url) => (url.endsWith("/de.json") ? { ok: false, status: 404 } : responseFor(url)));
  const loaded = await withPoisonedGlobalFetch(() => loadEntireManifest(M12, {
    fetch: stub.impl,
    request: { mode: "same-origin", credentials: "include" },
    partialFailure: "allow-partial",
  }));

  assert.equal(stub.calls.length, TWELVE.length);
  assert.deepEqual(stub.calls.map(fmt), Array(TWELVE.length).fill("same-origin|include"));
  // Controls: the run really did take the mixed path rather than succeeding outright, and the
  // fallback file loaded — without which plan 6.2 rejects and there would be no result to inspect.
  assert.equal(loaded.complete, false);
  assert.deepEqual(loaded.failures.map((/** @type {any} */ failure) => failure.locale), ["de"]);
  assert.equal(Object.keys(loaded.catalogs).length, TWELVE.length - 1);
});

test("an override does not leak from one load into the next", async () => {
  // "IDENTICALLY TO EVERY PLANNED REQUEST" IS PER LOAD, and plan 6.2:2116 says there is no hidden
  // process-global cache. The tempting optimisation — resolve the init once and keep it — is
  // invisible to every single-load probe in this file, because within one load the cached value IS
  // the right one. It takes two loads in one process, in this order, to see it.
  //
  // This test is LAST on purpose: it is the only place where a load supplying no `request` follows
  // one that did, which is precisely the sequence a sticky init needs in order to show itself.
  const first = recordingFetch();
  const loadedFirst = await withPoisonedGlobalFetch(() =>
    loadEntireManifest(M4, { fetch: first.impl, request: { mode: "same-origin", credentials: "include" } }));
  assert.deepEqual(first.calls.map(fmt), Array(4).fill("same-origin|include"));
  assertWholeManifestLoaded(loadedFirst, 4);

  const second = recordingFetch();
  const loadedSecond = await withPoisonedGlobalFetch(() => loadEntireManifest(M4, { fetch: second.impl }));
  assert.equal(second.calls.length, 4);
  assert.deepEqual(second.calls.map(fmt), Array(4).fill("cors|same-origin"),
    "the second load supplies no override, so it must see the documented defaults and not the first load's");
  assertWholeManifestLoaded(loadedSecond, 4);
});
