// @ts-check
/**
 * M8 acceptance clause 18 — plan 6.2:2080-2081: "Warnings are ordered by fetch-plan order and then
 * depth-first declaration order, independent of request completion timing."
 *
 * **WHY THE OBVIOUS PROBE PROVES ALMOST NONE OF IT.** "Load a manifest, assert the warnings look
 * right" is green against at least five different wrong implementations, and each hole needs its own
 * fixture:
 *
 *   1. **A whole-manifest fixture cannot see a re-sort.** Plan 6.2:2111 fixes the whole-manifest plan
 *      at normalized-tag order, so a runner that sorted its warnings by locale at the very end emits
 *      a byte-identical answer. The ordering SOURCE is only observable through a lookup-subset load
 *      whose `fetchSet` order is a different permutation of its own tags (C2), and only then if the
 *      fixture is built so plan order, ascending order, descending order and manifest JSON key order
 *      are four PAIRWISE DISTINCT sequences — asserted at runtime here, not trusted to the author.
 *   2. **A stub that settles in plan order makes the timing half unfalsifiable.** An append-on-arrival
 *      runner passes every ordering assertion when nothing ever arrives out of order. C1 therefore
 *      asserts, as its own named assertion, that the observed settle order DIFFERED from plan order —
 *      without which the clause degrades into a claim every implementation satisfies on a fast stub.
 *   3. **One warning per file makes contiguity vacuously true.** C5 needs the SAME key names in every
 *      file, because with different names a stable sort by key is very nearly a no-op — an ablation
 *      that changes nothing is indistinguishable from an instrument that sees nothing.
 *   4. **A failure at the END of the plan cannot shift anything.** C6's failing file is INTERIOR and
 *      both flanking files warn, which is the only shape where reading the warning slots by SUCCESS
 *      index instead of plan index silently loses a file's diagnostics.
 *   5. **Depth-first and breadth-first coincide on any single chain.** C4 needs a depth-2 descendant
 *      AND a depth-1 sibling, or the walk is reached without being discriminated.
 *
 * **THE ORDINALITY SILENCE, and it is why this file does not simply reuse the corpus fixtures.**
 * Plan 6.2:1950-1959's `LoadStringsOptions` declares no `pluralData` and no `onWarning`, so the
 * manifest doors call `parseStrings` without ordinal data and `INCOMPLETE_ORDINALITY_TRANSLATIONS`
 * can never be reported here. That is derived from the option type, not preferred — the same shape as
 * S11b's hash-only manifest generator. The consequence is measured and load-bearing:
 * `lokalized-spec/fixtures/warnings-nested-alternative-attribution.json` distinguishes depth-first
 * from breadth-first ONLY through its ordinal sibling `posb`, so at this door it degrades to
 * `[own, nega, deep]` — a sequence both walks produce. The corpus's own depth-first fixture is
 * VACUOUS here, which is asserted as a fact in "C4 (vacuity)" rather than discovered later. C4's
 * discriminating fixture is that catalog with the sibling respelled on the cardinal axis.
 *
 * **WHAT IS PARITY EVIDENCE AND WHAT IS NOT.** The WITHIN-FILE half (C3, C4) is arbitrated against
 * real Java by `lokalized-spec/cases/warnings.cases.json`'s `warnings.order.*` requiredPortableIds,
 * through the parse and directory doors. The manifest loaders have NO Java counterpart at all — Java
 * has no manifest and no fetch set — so what these rows buy at this door is the SEAM: nothing else in
 * the tree would notice the loader re-sorting a correct parser's output. The ACROSS-FILES half (C1,
 * C2, C5, C6, M1-M3) has no oracle and can never acquire one:
 * `lokalized-spec/cases/warnings.cases.json:8` records that Java's `loadFromDirectory` iterates a raw
 * `Files.newDirectoryStream` and sorts only the RESULT map, so its cross-file warning order is a
 * filesystem hash. Those rows are port-side design evidence; any text calling them conformance-
 * verified states the inverse of the fact.
 *
 * **THE NODE DOOR IS A DRIFT DETECTOR, NOT A SECOND PROOF.** While `runPlan` is shared, C1's ablation
 * reddens both doors, so C7's result-equality row is not independent evidence — and a result assertion
 * cannot see the topology it exists to protect, exactly as `test/ssr-graph.test.js` records one
 * subsystem over. The weight is therefore on "C7 (shape)", which DERIVES the set of modules that
 * assemble a warnings array across both doors' graphs and pins it as an exact set. That row goes red
 * on the day a second loop is written, with nobody having to write the loop to record its ablation.
 *
 * REPO GOTCHA, load-bearing for every comparison below: the loader builds NULL-PROTOTYPE frozen
 * records and `assert.deepEqual` is strict here, so it compares prototypes. Every assertion projects
 * warnings to arrays of primitives.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { fetchSet } from "../src/load/planning.js";
import { graphBytes, withoutComments } from "../tools/graph-walk.mjs";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { loadEntireManifestFromFiles } from "../src/node/file-loader.js";
import { ordinalData } from "../src/data/ordinal.js";
import { parseStrings } from "../src/parse/index.js";
import { primaryLanguage } from "../src/internal/locale.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();

const SPEC_FIXTURES = new URL("../../lokalized-spec/fixtures/", import.meta.url).pathname;

/** The `ru` catalog of `lokalized-spec`'s `warnings-order-single-file` fixture, read not retyped. */
const corpusCatalog = (/** @type {string} */ id) =>
  JSON.stringify(JSON.parse(readFileSync(`${SPEC_FIXTURES}${id}.json`, "utf8")).files.ru);

// -------------------------------------------------------------------------------------------
// Fixture construction
// -------------------------------------------------------------------------------------------

/**
 * One root key whose single cardinality-driven placeholder declares ONE form and is missing the rest.
 *
 * Cardinality, never ordinality — see the module header. `value: "n"` and a `{{name}}` reference in
 * the node's OWN translation are both hard preconditions: an unreferenced placeholder is rejected by
 * placeholder-reference validation long before the warning check runs, so a carelessly authored
 * fixture fails the load and proves nothing about traversal.
 */
const warns = (/** @type {string} */ key, /** @type {string} */ placeholder) => ({
  [key]: {
    translation: `{{${placeholder}}}`,
    placeholders: { [placeholder]: { value: "n", translations: { CARDINALITY_ONE: "x" } } },
  },
});

/**
 * A manifest over already-encoded catalog bodies.
 *
 * `order` fixes the JSON KEY insertion order independently of plan order — plan 6.1:1927 excludes
 * `baseUrl` and per-file `url` from the identity projection and `computeCatalogIdentity`
 * canonicalizes key order, so shuffling the keys cannot invalidate the manifest and "the runner
 * walked `Object.entries(files)`" becomes a named, visible failure. S10 shipped exactly that defect.
 *
 * `declaredDigestOf` lets one entry declare the digest of DIFFERENT bytes than the transport serves,
 * which is how C6 produces an interior failure at a named stage.
 *
 * @param {Record<string, string>} bodies
 * @param {{ fallbackLocale: string, tiebreakers?: Record<string, readonly string[]>,
 *   order?: readonly string[], baseUrl?: string, declaredDigestOf?: Record<string, string> }} options
 */
function manifestOver(bodies, {
  fallbackLocale, tiebreakers = {}, order, baseUrl = "https://cdn.example/v1/", declaredDigestOf = {},
}) {
  /** @type {Record<string, { url: string, sha256: string }>} */
  const files = {};
  for (const tag of order ?? Object.keys(bodies))
    files[tag] = {
      url: `${tag}.json`,
      sha256: sha256Hex(utf8.encode(declaredDigestOf[tag] ?? /** @type {string} */ (bodies[tag]))),
    };

  const draft = {
    formatVersion: 1,
    catalogVersion: "clause-18",
    catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion,
    dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale,
    baseUrl,
    files,
    tiebreakers,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/**
 * THE TRANSPORT STUB, one factory serving both doors, with a DETERMINISTIC schedule.
 *
 * **NO WALL CLOCK DECIDES ANYTHING.** Timers were the first design and they are not reproducible: a
 * delay of `(N - i)` ms makes entries 8 and 9 expire in the same millisecond, so the recorded settle
 * order — which the clause ledger wants as a reproducible ablation record — becomes machine-
 * dependent. Instead every read parks on a gate the test opens BY NAME, one at a time, draining the
 * event loop between releases. The settle order is then exactly the order this file chose.
 *
 * It records and it never throws: an in-stub guard that raised on a schedule violation would be
 * recorded by the runner as an acquisition failure, freeing a slot and cascading, so the loader's
 * control flow under an ablation would differ from its control flow un-ablated.
 *
 * `locale` is keyed by RESOLVED URL out of the manifest rather than parsed off the filename, so the
 * labels the ordering assertions compare cannot be an artifact of how the fixture spells its urls.
 *
 * @param {any} manifest @param {Record<string, string>} bodies
 * @param {{ open?: boolean }} [options]
 */
function gatedTransport(manifest, bodies, { open = false } = {}) {
  /** @type {Map<string, string>} */
  const tagByUrl = new Map();
  for (const [tag, file] of Object.entries(manifest.files))
    tagByUrl.set(new URL(/** @type {any} */ (file).url, manifest.baseUrl).href, tag);

  /** @type {string[]} */
  const startLog = [];
  /** @type {string[]} */
  const settleLog = [];
  /** @type {Map<string, () => void>} */
  const gates = new Map();
  /** @type {Set<string>} */
  const released = new Set();
  let inFlight = 0;
  let maxInFlight = 0;
  let openAll = open;

  const held = (/** @type {string} */ locale) => {
    if (openAll) return Promise.resolve();
    return new Promise((resolve) => {
      if (released.has(locale)) { resolve(undefined); return; }
      gates.set(locale, () => resolve(undefined));
    });
  };

  /** Invocation, recorded SYNCHRONOUSLY on entry — before any await inside the transport. */
  const begin = (/** @type {string} */ url) => {
    const locale = tagByUrl.get(url) ?? `UNKNOWN(${url})`;
    startLog.push(locale);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return locale;
  };
  const settle = (/** @type {string} */ locale) => { settleLog.push(locale); inFlight -= 1; };

  const bytesOf = (/** @type {string} */ locale) =>
    utf8.encode(/** @type {string} */ (bodies[locale] ?? "{}"));

  /** A one-chunk response body. */
  const responseOf = (/** @type {Uint8Array} */ bytes) => {
    let done = false;
    return {
      ok: true, status: 200,
      body: {
        getReader: () => ({
          read: async () => (done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes })),
          cancel: async () => {},
        }),
      },
    };
  };

  return {
    /** `lokalized/load`'s injection surface (plan 6.2:1951). */
    fetch: async (/** @type {string} */ url) => {
      const locale = begin(url);
      await held(locale);
      settle(locale);
      return responseOf(bytesOf(locale));
    },
    /** `lokalized/node`'s injection surface (plan 6.2:2002-2007), the complete-`Uint8Array` arm. */
    readFile: async (/** @type {string} */ url) => {
      const locale = begin(url);
      await held(locale);
      settle(locale);
      return bytesOf(locale);
    },
    startLog,
    settleLog,
    maxInFlight: () => maxInFlight,
    release: (/** @type {string} */ locale) => {
      released.add(locale);
      const gate = gates.get(locale);
      if (gate) { gates.delete(locale); gate(); }
    },
    /**
     * Run the event loop until the invocation count has been still for twenty consecutive turns.
     *
     * Adaptive rather than a fixed sleep: a released read runs through an ASYNCHRONOUS digest before
     * its worker can claim the next plan index, and a fixed turn count that happened to suffice on
     * one machine is the kind of number that fails in CI and nowhere else.
     */
    drain: async () => {
      let last = -1;
      let stable = 0;
      for (let turn = 0; turn < 600 && stable < 20; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (startLog.length === last) stable += 1;
        else { last = startLog.length; stable = 0; }
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

/** Never await an unsettled load: capture its outcome, so no probe in this file can hang. */
const started = (/** @type {Promise<any>} */ promise) =>
  promise.then((value) => ({ resolved: true, value, error: /** @type {any} */ (null) }),
    (error) => ({ resolved: false, value: /** @type {any} */ (null), error }));

/** Projections. Arrays of primitives, never the null-prototype records themselves. */
const locales = (/** @type {readonly any[]} */ ws) => ws.map((w) => w.locale);
const slots = (/** @type {readonly any[]} */ ws) => ws.map((w) => `${w.locale}/${w.placeholder}`);
const blocks = (/** @type {readonly any[]} */ ws) => ws.map((w) => `${w.locale}/${w.key}`);
const paths = (/** @type {readonly any[]} */ ws) => ws.map((w) => `${w.key}/${w.placeholder}`);
const triples = (/** @type {readonly any[]} */ ws) => ws.map((w) => [w.type, w.key, w.placeholder]);

// -------------------------------------------------------------------------------------------
// C1 — across files, plan order survives a settle order that is not plan order.
//
// Ten files rather than three is NOT padding, and the assertions below are what make that true: with
// the cap at eight (plan 6.2:2087) entries nine and ten are admitted only when an earlier read
// COMPLETES, so plan position and start order are produced by different mechanisms. The first draft
// of this design asserted that in prose and observed none of it.
// -------------------------------------------------------------------------------------------

/**
 * Ten ASCII-ascending tags with TEN DISTINCT PRIMARY LANGUAGES, so the whole-manifest plan
 * (plan 6.2:2111) is this array verbatim AND no tiebreaker is required.
 *
 * The language distinctness is a fixture precondition, not a nicety: plan 2.2:133-135 makes a
 * tiebreaker MANDATORY for a language with more than one loaded locale, so two same-language tags
 * would make the manifest invalid and kill the probe at `ConfigurationError` before a plan exists —
 * the zh-123 shape, where an earlier guard refuses the input and the test "confirms" a rule it never
 * reached. Every tag also has at least two cardinal forms, or its catalog could not warn at all.
 */
const TEN = Object.freeze(["cs", "da", "de", "el", "en", "es", "fi", "fr", "it", "nl"]);

/** Each file's placeholder is unique, so a warning names its file without relying on `locale`. */
const tenBodies = Object.fromEntries(TEN.map((tag) => [tag, JSON.stringify(warns("K", `p_${tag}`))]));

test("CONTROL-0: every across-files fixture validates and loads end to end", async () => {
  // Without this row every count below is ambiguous between "the rule held" and "the manifest was
  // refused before a per-file plan existed" (plan 6.2:2072-2076).
  assert.equal(typeof globalThis.crypto?.subtle?.digest, "function",
    "the Fetch door fails CLOSED without WebCrypto, which would make every sequence below empty");

  assert.equal(new Set(TEN.map((tag) => primaryLanguage(tag))).size, TEN.length,
    "two tags sharing a primary language would make the ten-file manifest invalid (plan 2.2:133-135)");
  assert.deepEqual([...TEN].sort(), [...TEN],
    "the whole-manifest plan is normalized-tag order (plan 6.2:2111); TEN must already be that order");

  const m = manifestOver(tenBodies, { fallbackLocale: "en" });
  const stub = gatedTransport(m, tenBodies, { open: true });
  const loaded = await loadEntireManifest(m, { fetch: stub.fetch });
  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.equal(loaded.warnings.length, 10, "every one of the ten catalogs must actually warn");
  assert.deepEqual(locales(loaded.warnings), [...TEN]);
});

test("C1: warning blocks keep PLAN order when the reads settle in the reverse of it", async () => {
  const m = manifestOver(tenBodies, { fallbackLocale: "en" });
  const stub = gatedTransport(m, tenBodies);
  const run = started(loadEntireManifest(m, { fetch: stub.fetch }));

  // ADMISSION. Exactly the first eight plan entries start, and nothing else can until one finishes.
  await stub.drain();
  assert.deepEqual(stub.startLog, TEN.slice(0, 8), "queued work retains fetch-plan order (plan 6.2:2087)");
  assert.equal(stub.maxInFlight(), 8, "eight reads are outstanding, which is what makes 9 and 10 queued");

  // THE REFILL IS DRIVEN BY COMPLETION, one release at a time, and the ninth and tenth entries are
  // observed entering in PLAN order rather than in the order slots happened to free.
  stub.release("fr");
  await stub.drain();
  assert.deepEqual(stub.startLog, TEN.slice(0, 9), "one completion admits exactly the next PLAN entry");
  assert.ok(stub.startLog.indexOf("it") > 7, "entry nine started only after eight others — it was queued");

  stub.release("fi");
  await stub.drain();
  assert.deepEqual(stub.startLog, TEN.slice(0, 10));

  for (const locale of ["es", "en", "el", "de", "da", "cs"]) { stub.release(locale); await stub.drain(); }
  assert.deepEqual(stub.startLog, [...TEN], "ten starts, in plan order, none of them skipped");

  stub.release("nl");
  await stub.drain();
  stub.release("it");
  const outcome = await run;

  assert.ok(outcome.resolved, `the load must succeed: ${outcome.error}`);
  const loaded = outcome.value;
  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.equal(loaded.warnings.length, 10);

  // **THE ANTI-VACUITY ASSERTION, and it is the one that must never be dropped.** Without it a stub
  // that happened to settle in plan order makes every assertion below green against an
  // append-on-arrival runner — the shape this project has already shipped once.
  assert.deepEqual(stub.settleLog, ["fr", "fi", "es", "en", "el", "de", "da", "cs", "nl", "it"],
    "the schedule this test chose, reproduced exactly; no wall clock decides it");
  assert.notDeepEqual(stub.settleLog, [...TEN], "the settle order genuinely differed from plan order");

  assert.deepEqual(locales(loaded.warnings), [...TEN],
    "plan order, not settle order (plan 6.2:2080-2081)");
  assert.deepEqual(loaded.warnings.map((w) => w.placeholder), TEN.map((tag) => `p_${tag}`));
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ f) => f.locale), [...TEN],
    "the plan the loader reports agrees with the literal the assertion above is pinned to");
});

test("C1 (control): the same fixture released in PLAN order is byte-identical", async () => {
  // The control proves the expected array is reachable end to end and that nothing about the
  // perturbed schedule is load-bearing for the fixture itself.
  const m = manifestOver(tenBodies, { fallbackLocale: "en" });
  const stub = gatedTransport(m, tenBodies);
  const run = started(loadEntireManifest(m, { fetch: stub.fetch }));
  await stub.drain();
  for (const locale of TEN) { stub.release(locale); await stub.drain(); }
  const outcome = await run;

  assert.ok(outcome.resolved, `the control load must succeed: ${outcome.error}`);
  assert.deepEqual(stub.settleLog, [...TEN], "this schedule DOES agree with plan order, by construction");
  assert.deepEqual(slots(outcome.value.warnings), TEN.map((tag) => `${tag}/p_${tag}`));
});

// -------------------------------------------------------------------------------------------
// C2 — the basis is the fetch PLAN specifically.
//
// FIXTURE REPAIR, recorded because the first design could not run: `{en, de, de-AT}` declares two
// `de` locales with no tiebreaker, which plan 2.2:133-135 refuses at validation. An ablation whose
// baseline is already red is not an instrument. `el` replaces `en` because it is Grek — so plan
// 2.2:112's script-compatible stage cannot contribute it and stage 4 places it last — and the `de`
// tiebreaker is declared explicitly.
// -------------------------------------------------------------------------------------------

const THREE_BODIES = Object.freeze({
  el: JSON.stringify(warns("K", "pEL")),
  de: JSON.stringify(warns("K", "pDE")),
  "de-AT": JSON.stringify(warns("K", "pAT")),
});

/** JSON key order `el, de, de-AT`, which is none of the three orders the plan could be confused with. */
const threeManifest = () => manifestOver(THREE_BODIES, {
  fallbackLocale: "el",
  tiebreakers: { de: ["de-AT", "de"] },
  order: ["el", "de", "de-AT"],
});

const PLAN_THREE = Object.freeze(["de-AT", "de", "el"]);

test("C2: the across-files basis is the fetch PLAN, not key order, not tag order, not its reverse", async () => {
  const m = threeManifest();

  // THE FOUR ORDERS ARE PAIRWISE DISTINCT, asserted rather than asserted-in-prose. A truncation chain
  // is naturally descending among its own prefixes, so without a fallback locale sorting ABOVE the
  // chain head (`el` > `de-AT` > `de`) "plan order" and "descending" would coincide and this probe
  // would silently prove less than it claims.
  const ASCENDING = ["de", "de-AT", "el"];
  const DESCENDING = ["el", "de-AT", "de"];
  const JSON_KEYS = ["el", "de", "de-AT"];
  for (const [a, b] of [[PLAN_THREE, ASCENDING], [PLAN_THREE, DESCENDING], [PLAN_THREE, JSON_KEYS],
    [ASCENDING, DESCENDING], [ASCENDING, JSON_KEYS], [DESCENDING, JSON_KEYS]])
    assert.notDeepEqual([...a], [...b], "the four candidate orders must stay pairwise distinct");
  assert.deepEqual(Object.keys(m.files), JSON_KEYS, "the manifest's own key order is the shuffled one");

  // The plan is pinned as a LITERAL as well as read from `fetchSet`: an expectation derived only from
  // the planner moves in lockstep with any defect in the planner and stays green.
  assert.deepEqual(fetchSet(m, "de-AT").map((e) => e.locale), [...PLAN_THREE]);

  const stub = gatedTransport(m, THREE_BODIES, { open: true });
  const loaded = await loadStrings(m, "de-AT", { fetch: stub.fetch });

  // BY NAME, FIRST: a validation rejection must never be mistaken for an ordering red.
  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.equal(loaded.warnings.length, 3);

  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ f) => f.locale), [...PLAN_THREE]);
  assert.deepEqual(locales(loaded.warnings), [...PLAN_THREE]);
  assert.deepEqual(slots(loaded.warnings), ["de-AT/pAT", "de/pDE", "el/pEL"]);
});

test("C2 (control): the SAME manifest whole-loaded warns in normalized-tag order instead", async () => {
  // Without this the previous row could be reading a fixed property of the manifest rather than a
  // plan: the two doors must genuinely disagree on this one fixture.
  const m = threeManifest();
  const stub = gatedTransport(m, THREE_BODIES, { open: true });
  const loaded = await loadEntireManifest(m, { fetch: stub.fetch });
  assert.equal(loaded.complete, true);
  assert.deepEqual(locales(loaded.warnings), ["de", "de-AT", "el"],
    "plan 6.2:2111's whole-manifest order, which is NOT the lookup plan above");

  // And the second control: each catalog alone yields exactly one warning, by name — so a
  // three-element expectation cannot be satisfied by a file that silently produced none.
  for (const [tag, body] of Object.entries(THREE_BODIES)) {
    const alone = parseStrings(body, { locale: tag, source: "control" });
    assert.equal(alone.warnings.length, 1, `${tag} must warn exactly once on its own`);
  }
});

// -------------------------------------------------------------------------------------------
// C3 — the seam: each file's block is the parse door's own array, verbatim.
// -------------------------------------------------------------------------------------------

const CORPUS_SINGLE = corpusCatalog("warnings-order-single-file");

test("C3: a file's block is the parse door's array verbatim — no loader-side re-sort", async () => {
  const bodies = { ru: CORPUS_SINGLE };
  const m = manifestOver(bodies, { fallbackLocale: "ru" });

  // (1) BOTH SIDES ARE NON-EMPTY AND NAMED BEFORE ANY COMPARISON. An empty-vs-empty deepEqual is the
  // green-with-zero-assertions shape.
  const viaParse = parseStrings(CORPUS_SINGLE, { locale: "ru", source: "probe" });
  assert.equal(viaParse.warnings.length, 3);
  assert.deepEqual(paths(viaParse.warnings), ["Zulu/zc", "Alpha/beta", "Alpha/gamma"]);

  const stub = gatedTransport(m, bodies, { open: true });
  const loaded = await loadStrings(m, "ru", { fetch: stub.fetch });
  assert.equal(loaded.complete, true);
  assert.equal(loaded.warnings.length, 3);

  // (2) THE LOADER-VS-PARSER DIFFERENTIAL, on three fields because `source` legitimately differs
  // between the doors (the loader reports the resolved url).
  assert.deepEqual(triples(loaded.warnings), triples(viaParse.warnings));

  // (3) THE INTRA-RESULT DIFFERENTIAL, which no shared-parser mutation can move. `LoadedStrings.
  // catalogs` is a `Record<LocaleTag, ParsedStringsFile>` (plan 6.2:1975) and each entry carries its
  // own warnings, so a re-sort of the AGGREGATE leaves the per-catalog array correct and this fires
  // where (2) would not. Both are kept: they catch different mutations.
  assert.deepEqual(triples(loaded.warnings), triples(loaded.catalogs.ru.warnings));

  // (4) AND THE LITERAL, so a regression shared by both sides reddens here rather than nowhere. The
  // fixture is the discriminating one because its keys are declared Zulu-then-Alpha: sorting by key
  // yields ["Alpha/beta","Alpha/gamma","Zulu/zc"] and diverges at index 0, and so does reversing.
  assert.deepEqual(paths(loaded.warnings), ["Zulu/zc", "Alpha/beta", "Alpha/gamma"]);
});

test("C3 (control): the fourth warning this door structurally cannot report", () => {
  // **THE COUNT ABOVE IS A REAL COUNT, and this is what makes it one.** The corpus fixture declares
  // FOUR warnable placeholders; `Alpha/zeta` is ordinality-driven, and plan 6.2:1950-1959's
  // `LoadStringsOptions` has no `pluralData`, so the manifest doors parse without ordinal data and
  // `INCOMPLETE_ORDINALITY_TRANSLATIONS` cannot be produced at all. Measured here rather than assumed,
  // and asserted so that the day the option arrives this row goes red instead of C3 silently
  // acquiring a fourth element nobody expected.
  const withOrdinal = parseStrings(CORPUS_SINGLE, {
    locale: "ru", source: "probe", pluralData: { ordinal: ordinalData },
  });
  assert.deepEqual(paths(withOrdinal.warnings),
    ["Zulu/zc", "Alpha/zeta", "Alpha/beta", "Alpha/gamma"]);
  assert.deepEqual(withOrdinal.warnings.map((w) => w.type), [
    "INCOMPLETE_CARDINALITY_TRANSLATIONS",
    "INCOMPLETE_ORDINALITY_TRANSLATIONS",
    "INCOMPLETE_CARDINALITY_TRANSLATIONS",
    "INCOMPLETE_CARDINALITY_TRANSLATIONS",
  ]);

  const withoutOrdinal = parseStrings(CORPUS_SINGLE, { locale: "ru", source: "probe" });
  assert.equal(withoutOrdinal.warnings.length, 3, "the door this clause is about sees three of the four");
});

// -------------------------------------------------------------------------------------------
// C4 — within a root key the walk is depth-first pre-order.
// -------------------------------------------------------------------------------------------

/**
 * `warnings-nested-alternative-attribution`'s shape with its SIBLING respelled on the cardinal axis.
 *
 * Root's own placeholder, a first alternative carrying `nega` that itself nests `deep`, and a
 * SIBLING second alternative carrying `posb`. Depth-first pre-order is `[own, nega, deep, posb]`;
 * breadth-first is `[own, nega, posb, deep]`; post-order is `[deep, nega, posb, own]`. Three depths
 * plus one sibling is the minimum that separates all three.
 *
 * **WHY NOT THE CORPUS FIXTURE VERBATIM:** its `posb` is ORDINALITY, which this door cannot report
 * (see the module header), and without a fourth element depth-first and breadth-first produce the
 * same sequence. The next test asserts that vacuity as a measured fact.
 *
 * Every placeholder is referenced in its OWN node's translation and every missing-form set differs,
 * so no warning here can be a duplicate of another.
 */
const NESTED_CARDINAL = JSON.stringify({
  Root: {
    translation: "{{own}}",
    placeholders: { own: { value: "n", translations: { CARDINALITY_ONE: "o" } } },
    alternatives: [
      {
        "n < 10": {
          translation: "{{nega}}",
          placeholders: { nega: { value: "n", translations: { CARDINALITY_FEW: "a" } } },
          alternatives: [
            {
              "n < 5": {
                translation: "{{deep}}",
                placeholders: { deep: { value: "n", translations: { CARDINALITY_MANY: "d" } } },
              },
            },
          ],
        },
      },
      {
        "n > 100": {
          translation: "{{posb}}",
          placeholders: { posb: { value: "n", translations: { CARDINALITY_OTHER: "b" } } },
        },
      },
    ],
  },
});

test("C4: within a root key the walk is depth-first pre-order, not breadth-first", async () => {
  const bodies = { ru: NESTED_CARDINAL };
  const m = manifestOver(bodies, { fallbackLocale: "ru" });
  const stub = gatedTransport(m, bodies, { open: true });
  const loaded = await loadStrings(m, "ru", { fetch: stub.fetch });

  // The end-to-end control: an unreferenced placeholder is refused by placeholder-reference
  // validation before the warning check runs, so a fixture that failed to load would prove nothing.
  assert.equal(loaded.complete, true, "every placeholder must be referenced in its own translation");
  assert.equal(loaded.failures.length, 0);
  assert.equal(loaded.warnings.length, 4);

  assert.deepEqual(loaded.warnings.map((w) => w.placeholder), ["own", "nega", "deep", "posb"],
    "breadth-first would put the sibling `posb` before the depth-2 `deep`");

  // Every warning names the ROOT key, never an alternative's expression.
  assert.deepEqual([...new Set(loaded.warnings.map((w) => w.key))], ["Root"]);

  // AND THE SIBLING WAS GENUINELY REACHED rather than the fourth element being a repeat of the third:
  // each node declares a different form, so each warning's missing set is different. Stated as set
  // membership, not as an order claim — `missingLanguageForms` ordering is plan 4.4:1557, a different
  // clause, and crediting this one with it is how an anchor turns into imaginary coverage.
  const missing = loaded.warnings.map((w) => [...w.missingLanguageForms].sort().join("+"));
  assert.equal(new Set(missing).size, 4, "four distinct gaps, so no two warnings are the same warning");
});

test("C4 (vacuity): the corpus's own nested fixture cannot discriminate the walk at THIS door", () => {
  // **MEASURED, AND THE REASON C4's FIXTURE IS NOT THE CORPUS FIXTURE.** Strip the ordinality warning
  // this door cannot emit and the remaining three lie on a single chain, where depth-first and
  // breadth-first are the same sequence. A row written over this fixture would reach the traversal
  // and discriminate nothing — the standing lesson in its literal form — and would look identical to
  // a row that works.
  const corpusNested = corpusCatalog("warnings-nested-alternative-attribution");
  const atThisDoor = parseStrings(corpusNested, { locale: "ru", source: "probe" });
  assert.deepEqual(atThisDoor.warnings.map((w) => w.placeholder), ["own", "nega", "deep"]);

  const BREADTH_FIRST_COUNTERFACTUAL = ["own", "nega", "deep"];
  assert.deepEqual(atThisDoor.warnings.map((w) => w.placeholder), BREADTH_FIRST_COUNTERFACTUAL,
    "the two walks agree here, which is exactly why this fixture is not used above");

  // With ordinal data the same bytes DO discriminate — which is what the corpus's
  // `warnings.order.alternative-warning-names-root-key` case arbitrates against real Java, through a
  // door that has ordinal data. Asserted so the vacuity is attributed to the DOOR, not to the fixture.
  const withOrdinal = parseStrings(corpusNested, {
    locale: "ru", source: "probe", pluralData: { ordinal: ordinalData },
  });
  assert.deepEqual(withOrdinal.warnings.map((w) => w.placeholder), ["own", "nega", "deep", "posb"]);
  assert.notDeepEqual(withOrdinal.warnings.map((w) => w.placeholder), ["own", "nega", "posb", "deep"]);
});

// -------------------------------------------------------------------------------------------
// C5 — the two orders COMPOSE: plan order of blocks, declaration order within a block.
// -------------------------------------------------------------------------------------------

/** Two keys per file, declared Zulu-then-Alpha, and the SAME names in every file. */
const SHARED_KEY_BODY = JSON.stringify({ ...warns("Zulu", "zc"), ...warns("Alpha", "ac") });
const SIX_BODIES = Object.freeze({
  el: SHARED_KEY_BODY, de: SHARED_KEY_BODY, "de-AT": SHARED_KEY_BODY,
});

test("C5: a file's warnings are one contiguous block and the two orders compose", async () => {
  const m = manifestOver(SIX_BODIES, {
    fallbackLocale: "el", tiebreakers: { de: ["de-AT", "de"] }, order: ["el", "de", "de-AT"],
  });
  const stub = gatedTransport(m, SIX_BODIES, { open: true });
  const loaded = await loadStrings(m, "de-AT", { fetch: stub.fetch });

  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.equal(loaded.warnings.length, 6);

  // **SHARED KEY NAMES ARE THE WHOLE FIXTURE.** With different names per file a stable sort by key is
  // very nearly a no-op; sharing them turns a global sort into an interleave
  // (["de-AT/Alpha","de/Alpha","el/Alpha","de-AT/Zulu",…]) that fails at index 0.
  assert.deepEqual(blocks(loaded.warnings), [
    "de-AT/Zulu", "de-AT/Alpha", "de/Zulu", "de/Alpha", "el/Zulu", "el/Alpha",
  ]);

  // THE COMPOSITION RULE STATED DIRECTLY, and this is the assertion a future global sort cannot
  // satisfy by accident: the aggregate IS the per-catalog arrays concatenated in plan order.
  const composed = loaded.requestedFiles
    .filter((/** @type {any} */ entry) => loaded.catalogs[entry.locale] !== undefined)
    .flatMap((/** @type {any} */ entry) => triples(loaded.catalogs[entry.locale].warnings));
  assert.equal(composed.length, 6, "the composition must not be vacuously empty");
  assert.deepEqual(triples(loaded.warnings), composed);

  // CONTIGUITY as its own named assertion: each locale's indices are consecutive integers.
  for (const tag of PLAN_THREE) {
    const indices = loaded.warnings
      .map((/** @type {any} */ w, /** @type {number} */ i) => (w.locale === tag ? i : -1))
      .filter((/** @type {number} */ i) => i >= 0);
    assert.equal(indices.length, 2, `${tag} must contribute two warnings`);
    assert.deepEqual(indices, [indices[0], indices[0] + 1], `${tag}'s warnings must be adjacent`);
  }
});

test("C5 (control): one warning per file, same three blocks, same plan order", async () => {
  // A genuine extension check with its OWN literal. Restating C5's six-element expectation here —
  // which the design first proposed — would be a control that cannot pass, the mirror of an ablation
  // that cannot fail.
  const m = threeManifest();
  const stub = gatedTransport(m, THREE_BODIES, { open: true });
  const loaded = await loadStrings(m, "de-AT", { fetch: stub.fetch });
  assert.equal(loaded.complete, true);
  assert.deepEqual(blocks(loaded.warnings), ["de-AT/K", "de/K", "el/K"]);
});

// -------------------------------------------------------------------------------------------
// C6 — under allow-partial an INTERIOR failure neither shifts nor drops anything.
//
// This is the only row where a plausible mutation changes the SET of warnings rather than their
// order, which is why it is not folded into C1.
// -------------------------------------------------------------------------------------------

const twoWarners = (/** @type {string} */ a, /** @type {string} */ b) =>
  JSON.stringify({ ...warns("K1", a), ...warns("K2", b) });

/**
 * `loadEntireManifest`, not `loadStrings`, and the door matters.
 *
 * Plan 2.2:108-117 puts the lookup locale FIRST and the resolved fallback file LAST, so a lookup plan
 * whose first entry is the fallback and which still has two entries after it cannot arise at all —
 * if lookup equals fallback the plan is one entry. The whole-manifest plan is normalized-tag order
 * (plan 6.2:2111), where `ar` sorts first and can be both the fallback and the head of the plan, which
 * plan 6.2:2082-2084 requires for `allow-partial` to offer a result at all.
 */
const C6_BODIES = Object.freeze({
  ar: twoWarners("a1", "a2"), de: twoWarners("b1", "b2"), en: twoWarners("c1", "c2"),
});

test("C6: an interior failure under allow-partial shifts no later block and drops none", async () => {
  const m = manifestOver(C6_BODIES, { fallbackLocale: "ar" });

  // **THE SERVED BODY IS FULLY VALID AND MERELY MISMATCHES ITS DECLARED DIGEST.** A malformed body
  // would let a parse-first implementation report stage `parse` and a digest-first one report
  // `digest`, so the row would go red about a different clause — the digest-before-parse probe defect
  // this project already shipped once. One trailing space changes the bytes and nothing else.
  const served = { ...C6_BODIES, de: `${C6_BODIES.de} ` };
  const stub = gatedTransport(m, served, { open: true });
  const loaded = await loadEntireManifest(m, { fetch: stub.fetch, partialFailure: "allow-partial" });

  // STATED BY NAME, never as a guard. A test shaped `if (!loaded.complete) { …assert… }` over a door
  // that rejected instead of returning is the green-with-zero-assertions failure.
  assert.equal(loaded.complete, false);
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ f) => f.locale), ["ar", "de", "en"],
    "the failing file must be INTERIOR; a last-position failure cannot shift anything");
  assert.deepEqual(loaded.failures.map((/** @type {any} */ f) => [f.locale, f.stage]), [["de", "digest"]]);

  assert.equal(loaded.warnings.length, 4);
  assert.deepEqual(slots(loaded.warnings), ["ar/a1", "ar/a2", "en/c1", "en/c2"],
    "reading the slots by SUCCESS index would take `en`'s block out of the failed `de`'s empty slot");

  // "Dropped" versus "never produced", distinguished at the catalog level too.
  assert.deepEqual(Object.keys(loaded.catalogs), ["ar", "en"]);
  assert.equal(locales(loaded.warnings).includes("de"), false);
});

test("C6 (control): the same manifest with a correct digest loads all six warnings", async () => {
  // The partial expectation above is a DELTA from a run known to work end to end, rather than an
  // isolated literal that could be matching for the wrong reason.
  const m = manifestOver(C6_BODIES, { fallbackLocale: "ar" });
  const stub = gatedTransport(m, C6_BODIES, { open: true });
  const loaded = await loadEntireManifest(m, { fetch: stub.fetch, partialFailure: "allow-partial" });
  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.deepEqual(slots(loaded.warnings), ["ar/a1", "ar/a2", "de/b1", "de/b2", "en/c1", "en/c2"]);
});

// -------------------------------------------------------------------------------------------
// C7 — the Node file door. Parity smoke test plus the structural drift detector.
// -------------------------------------------------------------------------------------------

test("C7: the Node file door produces the identical sequence under a backwards reader", async () => {
  // TWO MANIFESTS, not one: `lokalized/node` refuses a resolved non-`file:` URL in PREFLIGHT, so the
  // Fetch fixture's https urls could never reach it. They differ ONLY in scheme, and "identical
  // inputs" is a CHECKED fact below rather than a claim — plan 6.1:1927 excludes `baseUrl` and
  // per-file `url` from the identity projection, so the two fingerprints must be equal.
  const overHttp = manifestOver(tenBodies, { fallbackLocale: "en" });
  const overFile = manifestOver(tenBodies, { fallbackLocale: "en", baseUrl: "file:///lokalized/clause-18/" });
  assert.equal(overFile.catalogFingerprint, overHttp.catalogFingerprint,
    "the two doors must be given the same catalog identity, or `identical inputs` is unchecked");
  assert.deepEqual(Object.keys(overFile.files).map((t) => overFile.files[t].sha256),
    Object.keys(overHttp.files).map((t) => overHttp.files[t].sha256));

  const fetchStub = gatedTransport(overHttp, tenBodies, { open: true });
  const viaFetch = await loadEntireManifest(overHttp, { fetch: fetchStub.fetch });

  const fileStub = gatedTransport(overFile, tenBodies);
  const run = started(loadEntireManifestFromFiles(overFile, { readFile: fileStub.readFile }));
  await fileStub.drain();
  assert.deepEqual(fileStub.startLog, TEN.slice(0, 8), "the Node door queues under the same cap");
  for (const locale of [...TEN.slice(0, 8)].reverse()) { fileStub.release(locale); await fileStub.drain(); }
  for (const locale of ["nl", "it"]) { fileStub.release(locale); await fileStub.drain(); }
  const outcome = await run;

  assert.ok(outcome.resolved, `the Node load must succeed: ${outcome.error}`);
  const viaFiles = outcome.value;
  assert.equal(viaFiles.complete, true);
  assert.equal(viaFiles.warnings.length, 10);
  assert.equal(viaFetch.warnings.length, 10);
  assert.notDeepEqual(fileStub.settleLog, [...TEN], "the Node schedule genuinely differed from plan order");

  assert.deepEqual(triples(viaFiles.warnings), triples(viaFetch.warnings), "the two doors agree");
  // AND AGAINST THE LITERAL, without which "the two doors agree" is satisfied by both being wrong.
  assert.deepEqual(locales(viaFiles.warnings), [...TEN]);
  assert.deepEqual(locales(viaFetch.warnings), [...TEN]);
});

test("C7 (shape): exactly one module assembles the cross-file warnings array", () => {
  // **A RESULT-EQUALITY TEST CANNOT SEE THE TOPOLOGY IT EXISTS TO PROTECT.** While `runPlan` is
  // shared, C1's ablation reddens both doors, so the row above is a smoke test and not independent
  // evidence — and to ablate "give the Node door its own collection loop" someone would first have to
  // WRITE that loop, making the recorded ablation a hypothesis rather than a run. This row is shaped
  // like the rule instead, on `test/ssr-graph.test.js`'s precedent, and its own ablation IS executable
  // today: point one door's import at a copied module and the derived set grows.
  const root = new URL("../", import.meta.url).pathname;
  const union = [...new Set([
    ...graphBytes(root, "src/load/fetch-loader.js").files,
    ...graphBytes(root, "src/node/file-loader.js").files,
  ])].sort();
  assert.ok(union.length > 20, "both door graphs must have been walked, or every set below is empty");

  const sourceOf = (/** @type {string} */ file) => withoutComments(readFileSync(file, "utf8"));
  const relative = (/** @type {string[]} */ files) => files.map((file) => file.slice(root.length));

  // DERIVED, not hard-coded: any line that pushes, sorts, splices, spreads or iterates a `warnings`
  // array. S11b's fix is the precedent — a structural test that counted four hard-coded module names
  // was defeated by a byte-copy of the module.
  const ASSEMBLY = /(?:\.\.\.|of\s+|push\(|sort\(|concat\(|unshift\(|splice\()[^\n]*\bwarnings\b|\bwarnings\s*\.\s*(?:push|sort|concat|unshift|splice)\(/;
  const assemblers = relative(union.filter((file) => ASSEMBLY.test(sourceOf(file))));

  // AN EXACT SET, not a containment and not a count — a count accepts a swap. Two modules, one per
  // half of the clause: `parse-file.js` produces ONE file's warnings in depth-first declaration
  // order, `run-plan.js` concatenates the per-file blocks in fetch-plan order. A door that grew its
  // own loop would necessarily spell one of those verbs and make this a three-element set.
  assert.deepEqual(assemblers, ["src/internal/parse-file.js", "src/load/run-plan.js"]);

  // And the importers, derived the same way, so the shared runner is reached by both doors and by
  // nothing else in either graph.
  const importers = relative(union.filter((file) => /from\s+"[^"]*run-plan\.js"/.test(sourceOf(file))));
  assert.deepEqual(importers, ["src/load/fetch-loader.js", "src/node/file-loader.js"]);
});

// -------------------------------------------------------------------------------------------
// M1-M3 — what "fetch-plan order" MEANS, which the ordering rows above all take for granted.
//
// Every fixture above gives each planned candidate exactly one file, so none of them can tell a
// runner that assembles from the PLAN from one that assembles from the CHAIN, or that dedups on the
// wrong key. Those change the SET of blocks, not merely their order.
// -------------------------------------------------------------------------------------------

test("M1: a file reached by two candidates contributes ONE block at its first-use position", async () => {
  // Plan 6.1:1890 and plan 2.2:125-127: dedup is first-wins on the POST-RESOLUTION exact tag, so the
  // stage-4 fallback collapses into the `de` the truncation walk already reached. A runner that
  // appended the fallback unconditionally emits `de`'s block TWICE, and the manifest fingerprints
  // identically either way — nothing downstream could detect the duplicate.
  const bodies = { "de-AT": JSON.stringify(warns("K", "pAT")), de: JSON.stringify(warns("K", "pDE")) };
  const m = manifestOver(bodies, { fallbackLocale: "de", tiebreakers: { de: ["de-AT", "de"] } });
  assert.deepEqual(fetchSet(m, "de-AT").map((e) => e.locale), ["de-AT", "de"],
    "the fallback `de` is already in the plan; it must not be appended a second time");

  const stub = gatedTransport(m, bodies, { open: true });
  const loaded = await loadStrings(m, "de-AT", { fetch: stub.fetch });
  assert.equal(loaded.complete, true);
  assert.equal(loaded.warnings.length, 2, "two blocks, not three");
  assert.deepEqual(slots(loaded.warnings), ["de-AT/pAT", "de/pDE"]);
});

test("M2/M3: the plan is TIEBREAKER-ordered, and a catalog-less candidate occupies no slot", async () => {
  // **THE SHARPEST AVAILABLE PROBE THAT THE BASIS IS THE PLAN.** Two runs over manifests identical in
  // file set, in JSON key order and in tag-sort order, differing ONLY in the declared `de` tiebreaker
  // list, must produce REVERSED block order — plan 2.2:112's stage 3 is "script-compatible supported
  // locales in normalized-primary-language tiebreaker order". Every wrong basis C2 considers
  // (manifest-key order, ascending, descending) is INVARIANT under that change, so C2's four-way
  // distinctness argument cannot reach this and this row is not a restatement of it.
  //
  // M3 rides along: `de` is in the CHAIN (plan 6.1:1889, "chain includes attempted candidates without
  // files") and in no plan, so a runner assembling blocks from the chain has a slot with nothing in
  // it — a spread of nothing that looks correct until a later slot shifts.
  const bodies = {
    "de-AT": JSON.stringify(warns("K", "pAT")),
    "de-CH": JSON.stringify(warns("K", "pCH")),
    el: JSON.stringify(warns("K", "pEL")),
  };

  /** @type {string[][]} */
  const observed = [];
  for (const tiebreaker of [["de-AT", "de-CH"], ["de-CH", "de-AT"]]) {
    const m = manifestOver(bodies, { fallbackLocale: "el", tiebreakers: { de: tiebreaker } });
    const stub = gatedTransport(m, bodies, { open: true });
    const loaded = await loadStrings(m, "de", { fetch: stub.fetch });
    assert.equal(loaded.complete, true);
    assert.equal(loaded.warnings.length, 3,
      "three planned files, three blocks — the catalog-less `de` candidate contributes none");
    assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ f) => f.locale),
      [...tiebreaker, "el"], "the plan itself follows the declared tiebreaker order");
    observed.push(locales(loaded.warnings));
  }

  assert.deepEqual(observed[0], ["de-AT", "de-CH", "el"]);
  assert.deepEqual(observed[1], ["de-CH", "de-AT", "el"]);
  assert.notDeepEqual(observed[0], observed[1],
    "if these ever agree the fixture has stopped discriminating and the row proves nothing");
});

// -------------------------------------------------------------------------------------------
// M4 — the warning budget, which the clause would govern if it had a cross-file counting order.
// -------------------------------------------------------------------------------------------

test("M4: the warning budget is charged PER FILE here, so it has no cross-file counting order", async () => {
  // **DISPOSED OF BY MEASUREMENT RATHER THAN DECLINED ON A CITATION.** Plan 4.4:1563-1564 makes
  // exceeding `maximumWarnings` a loading FAILURE rather than silent truncation, which settles
  // truncation and says nothing about counting order — and counting order would be squarely "independent
  // of request completion timing" if the counter spanned the plan: with two files of two warnings each
  // and a budget of three, a plan-order counter always blames the second PLAN file while an
  // arrival-order counter blames whichever settled second.
  //
  // It does not span the plan. `parseStrings` opens a FRESH `LoadingSession` per call and the manifest
  // runner calls it once per file, so a budget of two admits two warnings from EACH of two files. With
  // no cross-file counter there is no cross-file order for a schedule to perturb, and the row that
  // would have probed one would have been probing a counter that does not exist.
  const bodies = { en: twoWarners("e1", "e2"), fr: twoWarners("f1", "f2") };
  const m = manifestOver(bodies, { fallbackLocale: "en" });

  const stub = gatedTransport(m, bodies, { open: true });
  const loaded = await loadEntireManifest(m, { fetch: stub.fetch, limits: { maximumWarnings: 2 } });
  assert.equal(loaded.complete, true);
  assert.deepEqual(slots(loaded.warnings), ["en/e1", "en/e2", "fr/f1", "fr/f2"],
    "four warnings under a budget of two: the counter is per file, not per load");

  // THE CONTROL, without which the row above is satisfied by a budget that is never enforced at all.
  // Both files bust a budget of one, and the resulting failures are themselves in PLAN order — the
  // sibling rule at plan 6.2:2077, asserted here because this is the only fixture in the file that
  // produces two failures.
  const tight = gatedTransport(m, bodies, { open: true });
  const error = await loadEntireManifest(m, { fetch: tight.fetch, limits: { maximumWarnings: 1 } })
    .then(() => null, (thrown) => thrown);
  assert.ok(error, "a budget of one must refuse");
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => [f.locale, f.stage]),
    [["en", "parse"], ["fr", "parse"]]);
});
