// @ts-check
/**
 * M8 acceptance clause 19 — `createStrings({ loaded })` "preserves `LoadedStrings.warnings` exactly
 * … without resorting" (plan 3.2:629-632, whose subject is BOTH channels, `onWarning` AND
 * `getWarnings()`).
 *
 * **WHY THE OBVIOUS PROBE PROVES NOTHING, twice over.**
 *
 *   1. A `loadEntireManifest` fixture is VACUOUS for the cross-file half. Plan 6.2:2111 fixes the
 *      whole-manifest plan at normalized-tag order, which is exactly the order the DIRECT branch
 *      sorts by (plan 3.2:629-630) — so a branch that re-sorts the loaded list executes the sort and
 *      emits a byte-identical answer. The discriminating input has to be a LOOKUP-SUBSET load whose
 *      fetch-plan order is a different permutation of its own tags from the sorted order. FIXTURE P
 *      plans `[pl-PL, pl, ru]`, whose ascending sort is `[pl, pl-PL, ru]` and whose descending sort
 *      is `[ru, pl-PL, pl]` — neither, and the first test asserts that at runtime rather than
 *      trusting the fixture author.
 *   2. A fixture where every file raises ONE warning is vacuous for the within-file half: a stable
 *      sort by key and no sort at all produce identical output. `pl-PL.json` therefore declares
 *      `Zebra.Count` BEFORE `Apple.Count`, so declaration order and lexical order disagree inside one
 *      file. Without that inversion a `${locale}\0${key}` sort — the tidy-up an author reaches for
 *      when a list looks arbitrary — passes every locale-sequence assertion in this file.
 *
 * **AND THE ASSERTIONS ARE ANCHORED TO A PRE-CONSTRUCTION SNAPSHOT, not to `loaded.warnings` read
 * afterwards.** `Array.prototype.sort` mutates, and nothing in the plan freezes the warnings ARRAY
 * (`readonly` is compile-time only; plan 4.4 freezes the warning RECORDS). A branch that sorted the
 * caller's array in place would move both sides of a relational `deepEqual(getWarnings(),
 * loaded.warnings)` together and stay green — the likelier author slip, invisible to the relational
 * form. Every comparison below is against `recordSeq`, projected before `createStrings` is called,
 * and the record's own array is re-compared afterwards as its own named assertion.
 *
 * Two more things that are deliberate rather than incidental:
 *
 *   - OBJECT IDENTITY is not asserted. "Preserves exactly" is satisfiable by value-exact frozen
 *     copies and plan 4.3 makes defensive copying the house style, so an identity assertion would
 *     over-constrain the clause. Every comparison is on the seven-field projection `pick`.
 *   - The warnings the loader produces are NULL-PROTOTYPE frozen records, and `assert.deepEqual` is
 *     strict here, so it compares prototypes. `pick` spreads them into plain objects for exactly
 *     that reason: a conforming branch that defensively copied a warning into a plain object would
 *     otherwise red for a reason the clause does not name.
 *
 * WHAT THIS FILE DOES NOT PROVE, measured and reported rather than assumed: the loaded branch does
 * not READ `loaded.warnings` at all. It hands `loaded.catalogs` to the shared construction path,
 * which replays each `ParsedStringsFile.warnings` in catalog-insertion order
 * (`core/index.js:2630`). The two coincide for every record the loader produces, and the last test
 * here is the gate on that coincidence — see its comment for the measurement.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { fetchSet } from "../src/load/planning.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();

/** A cardinality-driven placeholder carrying ONLY the forms named — the rest are the warning. */
const form = (/** @type {Record<string, string>} */ translations) => ({
  translation: "{{n}} {{thing}}",
  placeholders: { thing: { value: "n", translations } },
});

/**
 * FIXTURE P's three catalogs.
 *
 * Polish and Russian both support ONE/FEW/MANY/OTHER, so a placeholder declaring {ONE, OTHER} is
 * missing two forms and one declaring {OTHER} alone is missing three. `Zebra.Count` is the
 * three-form one ON PURPOSE: its `missingLanguageForms` is then the CLDR-declared
 * `[ONE, FEW, MANY]`, whose alphabetical sort `[FEW, MANY, ONE]` differs AT INDEX 0. A fixture in
 * which every warning misses `[FEW, MANY]` — already alphabetical — makes the "re-sort the form
 * list" mutation a literal no-op, which is this project's S6 lesson (covering the array path is not
 * discriminating its order) landing inside the probe written to check exactly that.
 *
 * `Apple.Count` keeps {ONE, OTHER} so that `get("Apple.Count", { n: 1 })` is a real render rather
 * than a resolution failure — the end-to-end control has to be a request the catalogs can answer.
 * `n: 5` would select Polish `many`, which these catalogs deliberately do not declare.
 *
 * ORDINALITY is avoided entirely: `lokalized/data/ordinal` is outside the root graph by ratchet, so
 * importing it here to obtain a second warning `type` would buy one axis at the price of a module
 * this file has no business pulling in. Named in `deferred` rather than papered over.
 */
const BODIES = {
  "pl-PL": JSON.stringify({
    // DECLARATION ORDER IS THE POINT: `Zebra` before `Apple`, the reverse of their lexical order.
    "Zebra.Count": form({ CARDINALITY_OTHER: "zeber" }),
    "Apple.Count": form({ CARDINALITY_ONE: "jablko", CARDINALITY_OTHER: "jablek" }),
  }),
  pl: JSON.stringify({ "Apple.Count": form({ CARDINALITY_ONE: "jablko", CARDINALITY_OTHER: "jablek" }) }),
  ru: JSON.stringify({ "Apple.Count": form({ CARDINALITY_ONE: "yabloko", CARDINALITY_OTHER: "yablok" }) }),
};

/**
 * The manifest, built programmatically so its digests and fingerprint are always right.
 *
 * `tiebreakers: { pl: [...] }` is mandatory rather than decorative: two loaded catalogs share the
 * language code `pl`, and the core applies Java's construction rule that a language's tiebreaker
 * list be an exact permutation of the catalogs it actually has.
 */
const MANIFEST = (() => {
  const files = Object.fromEntries(Object.entries(BODIES).map(([tag, body]) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(body)) }]));
  const draft = {
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: "ru", baseUrl: "https://cdn.example/v3/", files,
    tiebreakers: { pl: ["pl", "pl-PL"] },
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
})();

/** A well-behaved fetch. Misbehaviour is `fetch-loader.test.js`'s job; order is this file's. */
const stubFetch = (/** @type {readonly string[]} */ absent = []) => async (/** @type {string} */ url) => {
  const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
  if (absent.includes(tag)) return { ok: false, status: 404 };
  const bytes = utf8.encode(/** @type {any} */ (BODIES)[tag]);
  let sent = false;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes })),
      cancel: async () => {},
    }) },
  };
};

/** FIXTURE P: a lookup-subset load of `pl-PL`, whose plan order is NOT its sorted order. */
const fixtureP = () => loadStrings(MANIFEST, "pl-PL", { fetch: stubFetch() });

/** Plan 4.4:1551-1564's seven fields, spread into a plain object — see the header on prototypes. */
const pick = (/** @type {any} */ w) => ({
  type: w.type, source: w.source, locale: w.locale, key: w.key, placeholder: w.placeholder,
  missingLanguageForms: [...w.missingLanguageForms], message: w.message,
});
const seq = (/** @type {readonly any[]} */ ws) => ws.map((w) => `${w.locale}/${w.key}`);
/** The projection a "don't report the same thing four times" dedupe would collapse on. */
const triple = (/** @type {any} */ w) => `${w.type}|${w.key}|${w.placeholder}`;

const PLAN_SEQUENCE = ["pl-PL/Zebra.Count", "pl-PL/Apple.Count", "pl/Apple.Count", "ru/Apple.Count"];

// -------------------------------------------------------------------------------------------------
// The anti-vacuity half. Every gate below is asserted on the RECORD, before construction, so a
// failure here reads as "the fixture no longer discriminates" rather than as a clause red.
// -------------------------------------------------------------------------------------------------

test("FIXTURE P discriminates: the record's order is neither locale-sorted nor key-sorted", async () => {
  const loaded = await fixtureP();

  // An empty or short array makes every elementwise assertion in this file vacuously true.
  assert.equal(loaded.complete, true);
  assert.equal(loaded.failures.length, 0);
  assert.equal(loaded.warnings.length, 4, "four warnings, or the rest of this file proves nothing");

  // The plan order comes from the PUBLIC, synchronous, pure planner (plan 6.1:1878-1890), so this
  // gate needs no implementation reading and no oracle of its own.
  const planTags = fetchSet(MANIFEST, "pl-PL", { limits: loaded.loadingLimits })
    .map((/** @type {any} */ entry) => entry.locale);
  assert.deepEqual(planTags, ["pl-PL", "pl", "ru"]);
  assert.notDeepEqual(planTags, [...planTags].sort(),
    "if the plan order ever becomes its own ascending sort, a re-sorting branch is invisible");
  assert.notDeepEqual(planTags, [...planTags].sort().reverse());

  // The record's locale sequence is the PLAN order, grouped — not the sorted order.
  assert.deepEqual(loaded.warnings.map((/** @type {any} */ w) => w.locale), ["pl-PL", "pl-PL", "pl", "ru"]);

  // Within `pl-PL`, declaration order is the reverse of lexical order. Without this inversion the
  // within-file arm is untestable and its test would silently ride on the cross-file one.
  const withinFile = loaded.warnings.filter((/** @type {any} */ w) => w.locale === "pl-PL")
    .map((/** @type {any} */ w) => w.key);
  assert.deepEqual(withinFile, ["Zebra.Count", "Apple.Count"]);
  assert.notDeepEqual(withinFile, [...withinFile].sort(), "declaration order must not be alphabetical");

  // Four warnings collapsing to TWO distinct (type, key, placeholder) triples: the record genuinely
  // contains duplicate-looking rows, which is what a dedupe would eat and what a one-warning-per-file
  // fixture would never contain.
  assert.equal(new Set(loaded.warnings.map(triple)).size, 2);

  // A `source` the DIRECT rule (plan 3.2:626, `catalog:<normalized-locale>`) cannot produce. If the
  // loader ever adopted that spelling, the field-exactness ablation would become a no-op and this
  // gate — not a green run — is what says so.
  assert.ok(loaded.warnings.every((/** @type {any} */ w) => w.source !== `catalog:${w.locale}`),
    "the loader's warnings must carry a source the direct branch could not have stamped");

  // And at least one form list whose declared order is NOT its alphabetical order, so that a
  // re-sorting of `missingLanguageForms` is observable at all.
  assert.ok(loaded.warnings.some((/** @type {any} */ w) =>
    JSON.stringify([...w.missingLanguageForms]) !== JSON.stringify([...w.missingLanguageForms].sort())),
    "no warning's form list discriminates its own order; the form-sort ablation would be a no-op");
});

// -------------------------------------------------------------------------------------------------
// Clause 19 proper.
// -------------------------------------------------------------------------------------------------

test("the loaded branch returns the record's warning sequence, not a locale-sorted one", async () => {
  const loaded = await fixtureP();
  // SNAPSHOT FIRST. See the header: anchoring to `loaded.warnings` read after construction is blind
  // to an in-place sort, which is the likelier slip of the two.
  const recordSeq = loaded.warnings.map(pick);

  const strings = createStrings({ loaded, locale: "pl-PL" });

  // END-TO-END CONTROL, before any warning is read: this instance is fully built and renders, so a
  // red below is the branch reordering and not construction having quietly half-failed.
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");

  assert.deepEqual(strings.getWarnings().map(pick), recordSeq);
  assert.deepEqual(seq(strings.getWarnings()), PLAN_SEQUENCE);

  // `pick` would hide a field the branch invented or dropped, so the key sets are compared too —
  // "exactly" is a claim about the whole record, not about seven fields somebody listed.
  const got = strings.getWarnings();
  for (let k = 0; k < got.length; k++)
    assert.deepEqual(Object.keys(got[k]).sort(), Object.keys(loaded.warnings[k]).sort(), `warning ${k}`);

  // Construction did not reorder the CALLER'S array out from under the comparison.
  assert.deepEqual(loaded.warnings.map(pick), recordSeq, "construction must not mutate the record");
});

test("the SAME catalogs through the DIRECT door warn in a different order", async () => {
  // THE ATTRIBUTION CONTROL for every red above and below. It is fed the RAW JSON bodies, not
  // `loaded.catalogs`: plan 3.2:625-631 states the direct branch's warning rules for raw inputs, and
  // says nothing about replaying an already-parsed file's pre-existing warnings — so a control built
  // from `ParsedStringsFile` values could legitimately observe zero and the attribution would
  // collapse. The keys are inserted in ASCENDING order for the same kind of reason: "normalized-locale
  // order" is not defined further in the plan, and with the source map already ascending the control
  // holds under either reading of it.
  const directRecorded = /** @type {any[]} */ ([]);
  const direct = createStrings({
    locale: "pl-PL", fallbackLocale: "ru",
    strings: { pl: BODIES.pl, "pl-PL": BODIES["pl-PL"], ru: BODIES.ru },
    tiebreakers: { pl: ["pl", "pl-PL"] },
    onWarning: (/** @type {any} */ w) => directRecorded.push(w),
  });

  assert.equal(direct.get("Apple.Count", { n: 1 }), "1 jablko");
  assert.equal(directRecorded.length, 4, "four warnings are raisable from these catalogs through a callback");
  assert.deepEqual(directRecorded.map((w) => w.source),
    ["catalog:pl", "catalog:pl-PL", "catalog:pl-PL", "catalog:ru"], "plan 3.2:626's direct source rule");

  // The two doors' orders are genuinely different permutations. Compared against a LITERAL rather
  // than against a loaded instance, so this gate stays a statement about the fixture even when a
  // mutation is applied to the loaded branch.
  assert.notDeepEqual(seq(directRecorded), PLAN_SEQUENCE);
  assert.deepEqual(seq(directRecorded),
    ["pl/Apple.Count", "pl-PL/Zebra.Count", "pl-PL/Apple.Count", "ru/Apple.Count"]);
});

test("within one file, declaration order survives: Zebra stays before Apple", async () => {
  const loaded = await fixtureP();
  // The oracle is the RECORD, asserted as literals BEFORE construction. Read afterwards it could
  // have been sorted in place by the very branch under test, and the comparison would agree with
  // whatever happened.
  assert.equal(loaded.warnings[0].locale, "pl-PL");
  assert.equal(loaded.warnings[0].key, "Zebra.Count");
  assert.equal(loaded.warnings[1].locale, "pl-PL");
  assert.equal(loaded.warnings[1].key, "Apple.Count");

  const strings = createStrings({ loaded, locale: "pl-PL" });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");

  const got = strings.getWarnings();
  assert.equal(got[0].locale, "pl-PL");
  assert.equal(got[0].key, "Zebra.Count", "a stable sort by key would put Apple here and pass every " +
    "locale-sequence assertion in this file");
  assert.equal(got[1].locale, "pl-PL");
  assert.equal(got[1].key, "Apple.Count");

  // The finer control: a mutation confined to the within-file axis leaves these two in place, so a
  // red at index 0 with greens at 2-3 localizes the fault.
  assert.deepEqual(seq(got.slice(2)), ["pl/Apple.Count", "ru/Apple.Count"]);
});

test("nothing is dropped, deduplicated or added: four warnings in, four out", async () => {
  const loaded = await fixtureP();
  const recordLength = loaded.warnings.length;

  const strings = createStrings({ loaded, locale: "pl-PL" });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");

  // Asserted separately and BEFORE any elementwise comparison, so a multiplicity regression reports
  // as a multiplicity regression: a suffix-dropping defect leaves the survivors in order, and an
  // order-only probe would blame the order.
  assert.equal(strings.getWarnings().length, recordLength);
  assert.equal(strings.getWarnings().length, 4);

  // The three rows that a `type|key|placeholder` dedupe collapses, and the two that a
  // "only warn about the locale we render from" narrowing would drop.
  assert.equal(strings.getWarnings().filter((/** @type {any} */ w) => w.key === "Apple.Count").length, 3);
  assert.deepEqual(strings.getWarnings().map((/** @type {any} */ w) => w.locale),
    ["pl-PL", "pl-PL", "pl", "ru"]);
  assert.equal(new Set(strings.getWarnings().map(triple)).size, 2);
});

test("every field survives verbatim, including missingLanguageForms order", async () => {
  const loaded = await fixtureP();
  const recordSeq = loaded.warnings.map(pick);

  const strings = createStrings({ loaded, locale: "pl-PL" });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");
  const got = strings.getWarnings();
  assert.equal(got.length, recordSeq.length);

  // A RE-DERIVING branch produces a list of the right length in the right order and is wrong only in
  // a field — green on every other test in this file. That is the S10 shape: nothing compared a
  // returned literal to what it claimed to carry.
  for (let k = 0; k < recordSeq.length; k++) {
    for (const field of /** @type {const} */ (["type", "source", "locale", "key", "placeholder", "message"]))
      assert.equal(got[k][field], recordSeq[k][field], `warning ${k}: ${field}`);
    assert.deepEqual([...got[k].missingLanguageForms], recordSeq[k].missingLanguageForms, `warning ${k}: forms`);
  }

  // The two discrimination anchors, stated as what a wrong branch WOULD produce rather than as what
  // the loader happens to produce.
  assert.notEqual(got[0].source, `catalog:${got[0].locale}`,
    "plan 3.2:626 is the DIRECT branch's source rule and must not be re-stamped onto a loaded warning");
  assert.notDeepEqual([...got[0].missingLanguageForms], [...got[0].missingLanguageForms].sort(),
    "plan 4.4:1555 — declared form order, never a tidy alphabetical one");
});

test("onWarning replays the record's sequence, once per warning, in the record's order", async () => {
  const loaded = await fixtureP();
  const recordSeq = loaded.warnings.map(pick);

  const recorded = /** @type {any[]} */ ([]);
  const strings = createStrings({
    loaded, locale: "pl-PL", onWarning: (/** @type {any} */ w) => recorded.push(w),
  });

  // COUNT FIRST AND BY NAME. Plan 3.2:632 — "Applications that already handled parser warnings
  // should omit it to avoid replay" — is a standing invitation to conclude that a loaded record's
  // warnings were already reported by the loader and need not be replayed at all. A zero recording
  // makes every comparison below vacuously true, so it must surface as its own red.
  assert.equal(recorded.length, recordSeq.length, "the loaded branch must REPLAY, not silently skip");
  assert.equal(recorded.length, 4);

  assert.deepEqual(recorded.map(pick), recordSeq);
  // The two channels agree WITH EACH OTHER, so a later change cannot fix one and diverge the other.
  assert.deepEqual(recorded.map(pick), strings.getWarnings().map(pick));
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");
});

test("getWarnings answers the same frozen sequence every call, in a fresh array", async () => {
  const loaded = await fixtureP();
  const recordSeq = loaded.warnings.map(pick);
  const strings = createStrings({ loaded, locale: "pl-PL" });

  const first = strings.getWarnings();
  const second = strings.getWarnings();
  assert.deepEqual(first.map(pick), recordSeq);
  assert.deepEqual(second.map(pick), recordSeq, "a getter that drains an internal buffer answers [] here");
  // A branch handing out the instance's own array lets one caller's in-place sort rewrite what every
  // later caller sees — the preservation claim would then hold only until somebody read it.
  assert.notStrictEqual(first, second);
  assert.ok(Object.isFrozen(first), "plan 4.3's freezing rule");
});

// -------------------------------------------------------------------------------------------------
// The other loaded ingresses. `loaded` is one branch in the clause's wording and three ingress
// shapes in the type; a branch that preserved on one and re-derived on another passes everything
// above.
// -------------------------------------------------------------------------------------------------

test("the whole-manifest ingress preserves its own record's order and multiplicity", async () => {
  const whole = await loadEntireManifest(MANIFEST, { fetch: stubFetch() });
  const recordSeq = whole.warnings.map(pick);

  // VACUOUS FOR THE CROSS-FILE HALF AND SAID SO: plan 6.2:2111 plans the whole manifest in
  // normalized-tag order, which is the direct branch's sort, so a locale re-sort is an identity here.
  // It is NOT vacuous for the rest — `pl-PL` still declares Zebra before Apple, `coverage.kind` is
  // the other arm of a switch the branch really does make (plan 3.4:727), and multiplicity, fields
  // and the callback channel all discriminate normally.
  assert.equal(whole.warnings.length, 4);
  assert.deepEqual(seq(whole.warnings),
    ["pl/Apple.Count", "pl-PL/Zebra.Count", "pl-PL/Apple.Count", "ru/Apple.Count"]);

  const recorded = /** @type {any[]} */ ([]);
  const strings = createStrings({
    loaded: whole, locale: "pl-PL", onWarning: (/** @type {any} */ w) => recorded.push(w),
  });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");
  assert.equal(recorded.length, 4);
  assert.deepEqual(strings.getWarnings().map(pick), recordSeq);
  assert.deepEqual(recorded.map(pick), recordSeq);
});

test("a PARTIAL record's surviving warnings are preserved exactly", async () => {
  // Plan 6.2:2082-2085 makes `allow-partial` a first-class result, and a plausible branch handles it
  // in a separate arm — or filters warnings to the locales that produced catalogs, which here is a
  // no-op that looks like the rule being enforced. `pl` 404s; the fallback `ru` still loads, as
  // :2082 requires, so this is a partial success rather than a rejection.
  const partial = await loadStrings(MANIFEST, "pl-PL", {
    fetch: stubFetch(["pl"]), partialFailure: "allow-partial",
  });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.failures.map((/** @type {any} */ f) => f.locale), ["pl"]);
  assert.equal(partial.warnings.length, 3, "the pl file's warning is gone because the file is");

  const recordSeq = partial.warnings.map(pick);
  const recorded = /** @type {any[]} */ ([]);
  const strings = createStrings({
    loaded: partial, locale: "pl-PL", onWarning: (/** @type {any} */ w) => recorded.push(w),
  });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");
  assert.deepEqual(strings.getWarnings().map(pick), recordSeq);
  assert.deepEqual(recorded.map(pick), recordSeq);
  // Locale-sorting IS an identity on `[pl-PL, pl-PL, ru]`, so the cross-file axis does not
  // discriminate here; the within-file inversion still does, and that is what this line pins.
  assert.deepEqual(seq(strings.getWarnings()),
    ["pl-PL/Zebra.Count", "pl-PL/Apple.Count", "ru/Apple.Count"]);
});

test("the localeResolver ingress preserves the same sequence", async () => {
  // The second of the three ingress shapes `createStrings` names at :733 — "exactly one of 'locale',
  // 'localeResolver' or 'localeMatchResolver'". `loaded` is ONE branch in the clause's wording and
  // three shapes in the type, and nothing in the plan says one stands for all three.
  const loaded = await fixtureP();
  const recordSeq = loaded.warnings.map(pick);

  const recorded = /** @type {any[]} */ ([]);
  const strings = createStrings({
    loaded, localeResolver: () => "pl-PL", onWarning: (/** @type {any} */ w) => recorded.push(w),
  });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");
  assert.deepEqual(strings.getWarnings().map(pick), recordSeq);
  assert.deepEqual(recorded.map(pick), recordSeq);
});

test("the localeMatchResolver ingress preserves the same sequence", async () => {
  // The third ingress: the instance takes its locale from a SUPPLIED MATCH rather than from a tag.
  // Nothing else about the record changes, so a branch that preserved warnings on the direct-locale
  // path and re-derived them here would pass every test above this one.
  const loaded = await fixtureP();
  const recordSeq = loaded.warnings.map(pick);

  const recorded = /** @type {any[]} */ ([]);
  const strings = createStrings({
    loaded,
    // A complete, well-formed `LocaleMatchResult`; a bare `{ locale }` is refused by
    // `validateLocaleMatchStructure` before construction ever reaches the warnings, which would be
    // the `zh-123` shape — a probe rejected by an earlier guard that never reaches the check.
    localeMatchResolver: () => ({
      requestedLanguageRanges: [{ range: "pl-PL", weight: 1 }],
      locale: "pl-PL",
      languageRange: { range: "pl-PL", weight: 1 },
      effectiveWeight: 1,
      matchType: /** @type {const} */ ("exact"),
      fallbackLocale: "ru",
      // The APPLICABLE configuration for a manifest-backed instance is the FULL manifest set (plan
      // 3.4:845-847), not the catalogs that loaded, so all three tags belong here.
      consideredLocales: ["pl", "pl-PL", "ru"],
    }),
    onWarning: (/** @type {any} */ w) => recorded.push(w),
  });
  assert.equal(strings.get("Apple.Count", { n: 1 }), "1 jablko");
  assert.deepEqual(strings.getWarnings().map(pick), recordSeq);
  assert.deepEqual(recorded.map(pick), recordSeq);
});

// -------------------------------------------------------------------------------------------------
// The coincidence the clause currently rests on.
// -------------------------------------------------------------------------------------------------

test("the record's aggregate and its per-catalog concatenation still COINCIDE", async () => {
  // **MEASURED, AND IT IS THE HONEST LIMIT OF THIS FILE.** The loaded branch does not read
  // `loaded.warnings`. `optionsFromLoadedStrings` hands `loaded.catalogs` to the shared construction
  // path, which replays each `ParsedStringsFile.warnings` in catalog-insertion order
  // (`core/index.js:2630`). Measured directly: a record whose `warnings` array is REVERSED — every
  // sub-record shared by reference, so no value-level guard can see the difference — constructs
  // happily and reports the ORIGINAL plan order, and a record whose `catalogs` keys are reversed
  // reports `[ru, pl, pl-PL/Zebra, pl-PL/Apple]` where its own `warnings` field says plan order.
  // Plan 8.3:2578-2580 enumerates the fabrications that must be rejected and neither is among them,
  // so both are accepted and the field is ignored.
  //
  // Every test above is therefore correct only because these two orders AGREE for records the loader
  // produces. This gate is the part of that which a machine can re-check: it fails the moment the
  // loader's catalog-insertion order and its aggregate warning order stop agreeing — which is exactly
  // the moment the branch's reconstruction would stop equalling the record — instead of leaving the
  // divergence to be discovered by whoever is next to reorder `run-plan.js`. The residual half, a
  // branch that reads a FABRICATED record's warnings field, cannot be probed green and is reported.
  const loaded = await fixtureP();

  assert.deepEqual(Object.keys(loaded.catalogs), ["pl-PL", "pl", "ru"],
    "catalog insertion order is the fetch-plan order (plan 6.2:2080)");
  assert.deepEqual(
    Object.values(loaded.catalogs).flatMap((/** @type {any} */ c) => c.warnings).map(pick),
    loaded.warnings.map(pick),
    "the aggregate and the per-file concatenation must remain the same sequence");

  const strings = createStrings({ loaded, locale: "pl-PL" });
  assert.deepEqual(seq(strings.getWarnings()), seq(loaded.warnings));
});

// ---------------------------------------------------------------------------------------------
// THE RECORD'S TWO COPIES OF ITS WARNINGS MUST AGREE — `requireWarningsAgree`, added after the
// measurement below.
//
// A `LoadedStrings` carries every warning TWICE: once inside each `ParsedStringsFile`, and once as
// the flat `warnings` aggregate. Construction reads only the first, so the second could disagree
// with no diagnostic at all. Measured across the whole suite, conformance and two differentials
// before the check was written: 88 constructions from a loaded record, 0 disagreements — but 77 of
// those 88 carried NO warnings, and every one of the 11 that did came from THIS file. Before it,
// nothing in the repository ever constructed from a loaded record carrying a warning.
//
// The check is therefore not defending against an observed failure; it is closing a hole that
// nothing had yet walked into. What makes it worth having is that the transform which triggers it
// is ordinary — see the sorted-catalogs test.
// ---------------------------------------------------------------------------------------------

test("THE CONTROL: the records the library itself produces are accepted, including copies", async () => {
  // A record survives both structured serialization paths intact, and those are the server-render
  // paths — so a check that refused them would break the feature it is meant to protect. This
  // control is what makes the four refusals below attributable to disagreement rather than to the
  // check being too strict.
  const loaded = await fixtureP();
  assert.equal(loaded.warnings.length, 4, "the fixture must carry warnings, or this proves nothing");

  for (const [label, copy] of /** @type {[string, any][]} */ ([
    ["straight from the loader", loaded],
    ["JSON round-trip", JSON.parse(JSON.stringify(loaded))],
    ["structuredClone", structuredClone(loaded)],
  ]))
    assert.doesNotThrow(() => createStrings({ loaded: copy, locale: "pl-PL" }), label);
});

test("a record with NO warnings at all still constructs", async () => {
  // The common case — 77 of the 88 measured constructions. An equality check written as "both lists
  // must be non-empty", or one that read a missing field as a disagreement, would break every one.
  //
  // FIXTURE P cannot supply this: EVERY one of its catalogs is missing plural forms on purpose, so
  // every one of them warns. (The first draft of this test asserted `ru` was warning-free and was
  // red on its first run — the fixture's whole design is that it warns.) A catalog with no
  // cardinality placeholder at all warns about nothing.
  const body = JSON.stringify({ Hi: "hello" });
  const quiet = (() => {
    const draft = {
      formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
      cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
      fallbackLocale: "en", baseUrl: "https://cdn.example/quiet/",
      files: { en: { url: "en.json", sha256: sha256Hex(utf8.encode(body)) } }, tiebreakers: {},
    };
    draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
    return /** @type {any} */ (draft);
  })();
  const serve = async () => {
    const bytes = utf8.encode(body);
    let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      cancel: async () => {},
    }) } };
  };

  const loaded = await loadStrings(quiet, "en", { fetch: serve });
  assert.equal(loaded.warnings.length, 0, "a catalog with no plural placeholder warns about nothing");
  assert.doesNotThrow(() => createStrings({ loaded, locale: "en" }));
});

test("REORDERING THE CATALOGS IS REFUSED — the ordinary transform that used to be silent", async () => {
  // Sorting `catalogs` for deterministic output is a plausible thing to do to a record in transit,
  // and it is accepted by every other check: `requestedFiles` is untouched, so the plan-order check
  // passes, and the catalog SET is unchanged, so the coverage check passes. Before this refusal the
  // instance rendered warnings in the sorted order while the record's own field said otherwise.
  const loaded = await fixtureP();
  const sorted = {
    ...loaded,
    catalogs: Object.fromEntries(Object.entries(loaded.catalogs).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  assert.notDeepEqual(Object.keys(sorted.catalogs), Object.keys(loaded.catalogs),
    "the fixture's plan order must differ from its sorted order, or this test is vacuous");
  assert.throws(() => createStrings({ loaded: sorted, locale: "pl-PL" }),
    /`loaded.warnings` disagrees with the catalogs at index 0/);
});

test("a reordered .warnings array is refused, naming the index and both sides", async () => {
  const loaded = await fixtureP();
  assert.throws(
    () => createStrings({ loaded: { ...loaded, warnings: [...loaded.warnings].reverse() }, locale: "pl-PL" }),
    /at index 0: the record lists 'ru\/Apple.Count' where its own catalogs hold 'pl-PL\/Zebra.Count'/);
});

test("a COUNT mismatch is refused separately, with both counts", async () => {
  // Separate from the order refusal on purpose: a record that lost warnings and one that kept them
  // in the wrong order are different mistakes, and a single message for both would make the first
  // read as a sorting bug.
  const loaded = await fixtureP();
  assert.throws(() => createStrings({ loaded: { ...loaded, warnings: [] }, locale: "pl-PL" }),
    /lists 0 warning\(s\) while the catalogs it carries hold 4/);
  assert.throws(
    () => createStrings({ loaded: { ...loaded, warnings: loaded.warnings.slice(0, 3) }, locale: "pl-PL" }),
    /lists 3 warning\(s\) while the catalogs it carries hold 4/);
});

test("a missing .warnings field is refused rather than read as zero warnings", async () => {
  // Plan 3.4:130 declares `warnings` a required property of the record. Defaulting it to `[]` would
  // silently accept a record that is missing the very field the clause is about.
  const loaded = await fixtureP();
  const { warnings: _dropped, ...withoutWarnings } = loaded;
  assert.throws(() => createStrings({ loaded: withoutWarnings, locale: "pl-PL" }),
    /`loaded.warnings` must be an array/);
});

test("the comparison is by VALUE, not identity", async () => {
  // The loader pushes the SAME warning objects into both copies, so an identity comparison would
  // pass here and refuse every record that had been serialized — which is the one shape that
  // actually travels. Rebuilding each warning as a fresh, equal object must still be accepted.
  const loaded = await fixtureP();
  const rebuilt = {
    ...loaded,
    warnings: loaded.warnings.map((/** @type {any} */ w) => ({ ...w, missingLanguageForms: [...w.missingLanguageForms] })),
  };
  assert.notStrictEqual(rebuilt.warnings[0], loaded.warnings[0], "the fixture must hand over NEW objects");
  assert.deepEqual(pick(rebuilt.warnings[0]), pick(loaded.warnings[0]), "…that are nonetheless equal");
  assert.doesNotThrow(() => createStrings({ loaded: rebuilt, locale: "pl-PL" }));
});

test("a disagreement at a LATER index is refused too", async () => {
  // A check that compared only the first pair, or only the lengths, would pass this. The swap is at
  // indices 2 and 3, and both warnings are real — so nothing but the ORDER differs.
  const loaded = await fixtureP();
  const swapped = [...loaded.warnings];
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  assert.throws(() => createStrings({ loaded: { ...loaded, warnings: swapped }, locale: "pl-PL" }),
    /at index 2/);
});
