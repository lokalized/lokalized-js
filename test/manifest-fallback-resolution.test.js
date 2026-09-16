// @ts-check
/**
 * WHICH LOADED CATALOG A CONFIGURED FALLBACK TAG NAMES — M8 acceptance clause 8, at BOTH doors.
 *
 * The clause (plan 3.1:143-148): "The configured fallback tag need not be byte-identical to a file
 * tag, but it must resolve to a loaded exact tag: prefer an exact normalized file tag, otherwise the
 * sole CLDR-equivalent file, otherwise the first equivalent file in the applicable tiebreaker list.
 * Zero or still-ambiguous matches fail construction/manifest validation. All runtime configuration,
 * match results, fallback-file loading, and SSR metadata use that resolved exact loaded tag for
 * their fallback field. This does not rewrite a direct request's separate lookupLocale."
 *
 * **WHY THE OBVIOUS PROBE FAILS, four ways, and every one of them was measured rather than argued.**
 *
 * 1. **The obvious fixture spells the fallback exactly as a file key**, and then arm 1, arm 2 and
 *    arm 3 all predict the same tag. Every fixture here spells it NON-exactly, or puts a
 *    non-equivalent sibling at the head of the tiebreaker list, so the three arms disagree inside one
 *    fixture. Reaching an arm is not discriminating it.
 * 2. **The obvious ambiguity fixture — `{deu, ger}` with no tiebreakers — never reaches the
 *    ambiguity guard.** It is refused earlier by the missing-tiebreaker guard, which is a different
 *    branch with its own corpus case. For any fallback bearing a primary language a tiebreaker is
 *    MANDATORY and must be an exact permutation of that language's files, so the walk always finds an
 *    equivalent; only undetermined-language catalogs reach the arm at all. Both sentences are pinned
 *    below, in the same test, so the distinction is machine-checked rather than asserted in prose.
 * 3. **`localeConfigurationForManifest(m).fallbackLocale` is an unconditional ECHO of the declared
 *    tag today**, so `=== 'de'` for a manifest declaring 'de' passes under an implementation that
 *    resolves nothing at all. The discriminating manifest observations are `chain` and `fetchSet`,
 *    and every manifest assertion here uses those.
 * 4. **A manifest fixture whose `catalogFingerprint` is not recomputed is refused by the fingerprint
 *    guard BEFORE any fallback-resolution code runs** — measured, with a plausible-looking
 *    `ConfigurationError` that reads exactly like the probe's own refusal. So `manifest()` computes
 *    the fingerprint with the implementation's own `computeCatalogIdentity`, and every manifest probe
 *    asserts the manifest VALIDATES before it asserts anything about resolution.
 *
 * **SIX ROWS BELOW ARE MARKED `DIVERGENCE` AND PIN BEHAVIOUR THE CLAUSE DOES NOT ASK FOR — and two
 * more were, until the maintainer decided them (D3).** C6 and C7 now assert the REFUSAL the clause
 * asks for at the manifest door: a zero-candidate fallback and a still-ambiguous one both fail
 * validation before any per-file plan exists, so neither reaches a network request. The two that
 * remain are the tests whose own NAMES carry the word — C8 and C11 — so this count cannot drift out
 * of step with the file without a test name drifting too. (The first draft of this sentence told you
 * to count them with a grep, and the grep matched the sentence itself.) They are
 * written the way `DECLARED_MESSAGE_DIVERGENCES` is written: the divergence is REQUIRED to exist, so
 * a fix cannot land silently and a reader cannot mistake the pin for agreement. Each says what the
 * clause requires and what the port does instead. No src/ file was changed to write this file.
 *
 * **WHAT IS NEW HERE AND WHAT IS A DUPLICATE, said out loud so nobody counts it twice.** The direct
 * door's zero, ambiguous and tiebreaker-walk rows have gated corpus cases already
 * (`owed-init.refusal.fallback-locale-names-no-catalog`,
 * `owed-init.refusal.fallback-equivalent-to-multiple-catalogs`,
 * `owed-ds.fallback-tiebreaker-walk{,-alt}`); they are kept as JS-door pins and labelled. The
 * MANIFEST door has no corpus case and no Java counterpart — Java has no manifest — so every
 * manifest row is this file's own evidence, and that is where all six divergences are.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { createSsrStamp } from "../src/ssr/index.js";
import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import {
  chain,
  computeCatalogIdentity,
  fetchSet,
  loadEntireManifest,
  loadStrings,
  localeConfigurationForManifest,
  parseStringsManifest,
  validateStringsManifest,
} from "../src/load/index.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();

/** One key per catalog, whose VALUE names the catalog — so "which file served this" is observable. */
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Greeting: `${tag.toUpperCase()}!` });
const catalogFor = (/** @type {string} */ tag) => ({ Greeting: `${tag.toUpperCase()}!` });
const catalogsFor = (/** @type {readonly string[]} */ tags) =>
  Object.fromEntries(tags.map((tag) => [tag, catalogFor(tag)]));

/**
 * A structurally valid manifest whose fingerprint is produced BY THE IMPLEMENTATION.
 *
 * `spelledAs` re-spells the declared fallback AFTER the fingerprint is taken, which is the only way
 * to build a non-normalized fallback that survives the door: `validateStringsManifest` normalizes the
 * tag and then recomputes identity over the NORMALIZED spelling, so a fixture that hashes 'DE'
 * verbatim is rejected as `declared X, computed Y` before reaching any arm of the clause. Measured.
 *
 * @param {readonly string[]} tags @param {string} fallbackLocale
 * @param {Record<string, readonly string[]>} [tiebreakers]
 * @param {{ spelledAs?: string, catalogVersion?: string }} [overrides]
 */
function manifest(tags, fallbackLocale, tiebreakers = {}, overrides = {}) {
  const files = Object.fromEntries(tags.map((tag) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(bodyFor(tag))) }]));
  const draft = /** @type {any} */ ({
    formatVersion: 1,
    catalogVersion: overrides.catalogVersion ?? "v1",
    catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion,
    dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale,
    baseUrl: "https://cdn.example/v1/",
    files,
    tiebreakers,
  });
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  if (overrides.spelledAs !== undefined) draft.fallbackLocale = overrides.spelledAs;
  return draft;
}

/** A transport that records every call, so "nothing was read" is falsifiable. */
function recordingFetch(/** @type {Set<string>} */ failing = new Set()) {
  /** @type {string[]} */
  const calls = [];
  return { calls, impl: async (/** @type {string} */ url) => {
    calls.push(url);
    const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
    if (failing.has(tag)) return { ok: false, status: 404 };
    const bytes = utf8.encode(bodyFor(tag));
    let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      cancel: async () => {},
    }) } };
  } };
}

const thrown = (/** @type {() => unknown} */ body) => {
  try { body(); return null; } catch (error) { return /** @type {any} */ (error); }
};
const rejected = async (/** @type {() => Promise<unknown>} */ body) =>
  body().then(() => null, (error) => /** @type {any} */ (error));

/** Every manifest probe's first line: a fingerprint refusal must never be read as the probe's own. */
const validates = (/** @type {any} */ m) => {
  assert.doesNotThrow(() => validateStringsManifest(m),
    "the fixture itself must be acceptable, or nothing below is attributable to the fallback");
  return m;
};

const localesOf = (/** @type {readonly {locale: string}[]} */ entries) => entries.map((e) => e.locale);

// ---------------------------------------------------------------------------------------------
// C1 — arm 1: an exact (post-normalization) file tag beats the tiebreaker list.
// ---------------------------------------------------------------------------------------------

test("clause 8 C1: the EXACT arm beats a tiebreaker list that names the equivalent sibling first", () => {
  // THE LIST LEADS WITH THE NON-EXACT SPELLING ON PURPOSE. `de` and `deu` are distinct JDK tags and
  // CLDR-equivalent, so with `tiebreakers: { de: ['deu', 'de'] }` arm 1 predicts `de` and arm 3
  // predicts `deu` — different tags AND different translations, in one fixture.
  const direct = createStrings({
    strings: catalogsFor(["de", "deu"]), tiebreakers: { de: ["deu", "de"] },
    fallbackLocale: "de", locale: "pt-BR",
  });
  assert.equal(direct.getLocaleConfiguration().fallbackLocale, "de");
  assert.equal(direct.get("Greeting"), "DE!", "and the SERVED catalog moves with the resolved tag");
  assert.equal(direct.getResult("Greeting").localeMatch.fallbackLocale, "de");

  // THE CONTROL, and it is what makes the row a resolution test rather than a "de always wins" test:
  // the SAME catalogs and the SAME list with `deu` configured elect `deu` and serve its catalog, so
  // both files are loadable and either is electable.
  const control = createStrings({
    strings: catalogsFor(["de", "deu"]), tiebreakers: { de: ["deu", "de"] },
    fallbackLocale: "deu", locale: "pt-BR",
  });
  assert.equal(control.getLocaleConfiguration().fallbackLocale, "deu");
  assert.equal(control.get("Greeting"), "DEU!");

  // THE MANIFEST DOOR, through `fetchSet`/`chain` rather than `localeConfigurationForManifest`:
  // that accessor echoes the declared tag today (see C8), so `=== 'de'` would pass under an
  // implementation that resolves nothing. The PLAN is what moves.
  const m = validates(manifest(["de", "deu"], "de", { de: ["deu", "de"] }));
  assert.deepEqual(localesOf(fetchSet(m, "pt-BR")), ["de"]);
  assert.deepEqual([...chain(m, "pt-BR")], ["pt-BR", "pt", "de"]);

  const controlManifest = validates(manifest(["de", "deu"], "deu", { de: ["deu", "de"] }));
  assert.deepEqual(localesOf(fetchSet(controlManifest, "pt-BR")), ["deu"],
    "the manifest control, for the same reason as the direct one");
});

test("clause 8 C1: 'exact' means exact AFTER normalization, not byte-identical", () => {
  // `DE` is byte-different from every file key and normalizes onto one of them. A byte-wise
  // implementation does NOT refuse here — measured — it falls through to the tiebreaker walk and
  // elects `deu`, which is why the assertion is on the elected tag rather than on a throw.
  const direct = createStrings({
    strings: catalogsFor(["de", "deu"]), tiebreakers: { de: ["deu", "de"] },
    fallbackLocale: "DE", locale: "pt-BR",
  });
  assert.equal(direct.getLocaleConfiguration().fallbackLocale, "de");
  assert.equal(direct.get("Greeting"), "DE!");

  const m = validates(manifest(["de", "deu"], "de", { de: ["deu", "de"] }, { spelledAs: "DE" }));
  assert.equal(m.fallbackLocale, "DE", "the fixture really does declare the non-normalized spelling");
  assert.deepEqual(localesOf(fetchSet(m, "pt-BR")), ["de"]);
});

// ---------------------------------------------------------------------------------------------
// C2 — arm 2, and the relation it rests on.
// ---------------------------------------------------------------------------------------------

test("clause 8 C2: the sole CLDR-equivalent file resolves the fallback, at both doors", () => {
  const languageAlias = createStrings({
    strings: catalogsFor(["deu", "fr"]), fallbackLocale: "de", locale: "pt-BR",
  });
  assert.equal(languageAlias.getLocaleConfiguration().fallbackLocale, "deu");
  assert.equal(languageAlias.getResult("Greeting").resolvedLocale, "deu");
  assert.equal(languageAlias.get("Greeting"), "DEU!");

  // A REGION alias, not a language one, so the row does not rest on a single CLDR table entry.
  const regionAlias = createStrings({
    strings: catalogsFor(["en-GB", "fr"]), fallbackLocale: "en-UK", locale: "pt-BR",
  });
  assert.equal(regionAlias.getLocaleConfiguration().fallbackLocale, "en-GB");

  // **A DISCRIMINATION LIMIT, MEASURED AND NOT ARGUED, because a later reader would otherwise
  // over-read these two rows.** Deleting core's sole-equivalent arm does NOT turn them red: for any
  // language-bearing tag `resolveTiebreakers` SYNTHESIZES an identity order for a language holding
  // exactly one catalog, so arm 3 returns the same tag and the two arms are observationally identical
  // here. The row that does separate them at the direct door is C5's `{und-bokmal, fr}` control —
  // `und-*` never enters a language bucket, so no order is synthesized and the ablated resolver falls
  // through to the ambiguity refusal. At the MANIFEST door the arm is separately observable, because
  // the planner reaches it through a different function; hence the manifest twin below, which is also
  // what makes the widened-equivalence ablation visible at that door at all (the S10/S11a lesson).
  const m = validates(manifest(["deu", "fr"], "de"));
  assert.deepEqual(localesOf(fetchSet(m, "pt-BR")), ["deu"]);
  assert.deepEqual([...chain(m, "pt-BR")], ["pt-BR", "pt", "deu"],
    "the chain ENDS on the resolved file tag; the raw 'de' does not appear in it");
});

test("clause 8 C2: equivalence is CLDR canonical equality, not shared primary language", () => {
  // THE NEGATIVE ROW IS THE NOVEL CONTENT. Widening the relation only ever ADDS candidates, so an
  // all-positive fixture set stays green under that mistake; the clause is falsified only by a pair,
  // and the second half must be a same-primary-language NON-equivalent tag.
  const refusal = thrown(() => createStrings({
    strings: catalogsFor(["de-AT", "fr"]), fallbackLocale: "de", locale: "pt-BR",
  }));
  assert.equal(refusal?.name, "RangeError");
  assert.equal(refusal?.message,
    "Specified fallback locale is 'de' but no matching localized strings locale was found. " +
    "Known locales: [de-AT, fr]");

  // THE ANTI-zh-123 CONTROL: `de-AT` is a loadable, valid, ELECTABLE tag, so the refusal above is
  // the equivalence verdict and not an earlier guard rejecting the catalog.
  const control = createStrings({
    strings: catalogsFor(["de-AT", "fr"]), fallbackLocale: "de-AT", locale: "pt-BR",
  });
  assert.equal(control.getLocaleConfiguration().fallbackLocale, "de-AT");
  assert.equal(control.get("Greeting"), "DE-AT!");

  // THE MANIFEST TWIN OF THE NEGATIVE ROW, and since C6's fix it REFUSES at the door rather than
  // planning an empty fetch set. The equivalence verdict is still what is asserted — a relation
  // widened to shared primary language would make the fallback equivalent to de-AT and this manifest
  // would validate — but the verdict is now a refusal instead of an absence, which is the whole
  // point of moving the check to the door.
  const manifestRefusal = thrown(() => validateStringsManifest(manifest(["de-AT", "fr"], "de")));
  assert.equal(manifestRefusal?.name, "ConfigurationError");
  assert.equal(manifestRefusal?.message,
    "A manifest's fallbackLocale is 'de' but no matching catalog was declared. " +
    "Known locales: [de-AT, fr]");

  // THE MANIFEST CONTROL, mirroring the direct one above: the same two files with an electable
  // fallback validate and plan, so the refusal is the equivalence verdict and not the fixture.
  const controlManifest = validates(manifest(["de-AT", "fr"], "de-AT"));
  assert.deepEqual(localesOf(fetchSet(controlManifest, "pt-BR")), ["de-AT"]);
});

// ---------------------------------------------------------------------------------------------
// C3 — arm 3: the FIRST EQUIVALENT entry of the applicable list, not its head.
// ---------------------------------------------------------------------------------------------

/** `sh` and `hbs` both canonicalize to `sr-Latn`; `sr-Cyrl` does not. */
const SR_FILES = ["en", "hbs", "sh", "sr-Cyrl"];
const SR_ORDER_A = ["sr-Cyrl", "sh", "hbs"];
const SR_ORDER_B = ["hbs", "sr-Cyrl", "sh"];

test("clause 8 C3: the manifest planner walks the tiebreaker list in ITS order, skipping non-equivalents", () => {
  // TWO ORDERS, because three separate mistakes all EXECUTE this arm and only a pair separates them:
  // first-entry-wins elects the non-equivalent `sr-Cyrl`; lexicographic-wins elects `hbs` under both
  // orders, which leaves order (b) GREEN — so a single-order fixture has a coin-flip chance of
  // reporting that ablation as a clean run.
  const a = validates(manifest(SR_FILES, "sr-Latn", { sr: SR_ORDER_A }));
  assert.deepEqual([...chain(a, "de")], ["de", "sh"]);
  assert.deepEqual(localesOf(fetchSet(a, "de")), ["sh"]);

  const b = validates(manifest(SR_FILES, "sr-Latn", { sr: SR_ORDER_B }));
  assert.deepEqual([...chain(b, "de")], ["de", "hbs"]);
  assert.deepEqual(localesOf(fetchSet(b, "de")), ["hbs"]);

  // THE CONTROL: on each manifest a request that hits a declared file directly plans that file FIRST,
  // so both orders are serviceable end to end and the difference above is the fallback arm alone. The
  // resolved fallback file is still planned behind it — plan 6.1 keeps the whole candidate chain — and
  // that second slot is the one that moves, which is worth asserting in the control too.
  assert.deepEqual(localesOf(fetchSet(a, "en")), ["en", "sh"]);
  assert.deepEqual(localesOf(fetchSet(b, "en")), ["en", "hbs"]);
});

test("clause 8 C3: the direct door pins the same two orders (regression duplicate of two corpus cases)", () => {
  // NOT INDEPENDENT EVIDENCE. `owed-ds.fallback-tiebreaker-walk-serves-resolved-catalog` and
  // `-alt-order-changes-catalog` are byte-for-byte this fixture and already gate both orders through
  // conformance. Kept as a JS-door pin, labelled so a later reader does not count it twice.
  for (const [order, expected] of /** @type {[readonly string[], string][]} */ ([
    [SR_ORDER_A, "sh"], [SR_ORDER_B, "hbs"],
  ])) {
    const strings = createStrings({
      strings: catalogsFor(SR_FILES), tiebreakers: { sr: [...order] },
      fallbackLocale: "sr-Latn", locale: "de",
    });
    assert.equal(strings.getLocaleConfiguration().fallbackLocale, expected);
    assert.equal(strings.get("Greeting"), `${expected.toUpperCase()}!`);
    assert.deepEqual([...strings.getResult("Greeting").attemptedLocales], ["de", expected]);
  }
});

// ---------------------------------------------------------------------------------------------
// C4 / C5 — the two refusals, and the guard each one is NOT.
// ---------------------------------------------------------------------------------------------

test("clause 8 C4: zero equivalents refuses with the tag AND the known-locale list", () => {
  // THE MESSAGE, NOT THE THROW. A `assert.throws(...)` alone stays green under an ablation that
  // refuses for the wrong reason — measured: disabling the zero guard still throws, from the
  // ambiguity guard, over an empty equivalent set. The enumerated list also makes the row sensitive
  // to WHICH catalogs the resolver considered, so a resolver reading the wrong set fails here even
  // when it correctly refuses. (Duplicate of `owed-init.refusal.fallback-locale-names-no-catalog`;
  // this is the JS-door pin.)
  const refusal = thrown(() => createStrings({
    strings: catalogsFor(["fr", "es"]), fallbackLocale: "de", locale: "pt-BR",
  }));
  assert.equal(refusal?.name, "RangeError");
  assert.equal(refusal?.message,
    "Specified fallback locale is 'de' but no matching localized strings locale was found. " +
    "Known locales: [es, fr]");

  const control = createStrings({
    strings: catalogsFor(["fr", "es"]), fallbackLocale: "fr", locale: "pt-BR",
  });
  assert.equal(control.getLocaleConfiguration().fallbackLocale, "fr");
});

test("clause 8 C5: an ambiguous undetermined fallback refuses, naming both equivalents", () => {
  // ONLY UNDETERMINED-LANGUAGE CATALOGS REACH THIS ARM — see the companion test below. The JS
  // remedy clause already lives in `tools/construct-refusals.mjs` under the `DefaultStrings.java:465`
  // entry with the JS half pinned exactly; do not add a second declaration for it.
  const refusal = thrown(() => createStrings({
    strings: { "und-bokmal": catalogFor("und-bokmal"), "und-nynorsk": catalogFor("und-nynorsk") },
    fallbackLocale: "und", locale: "und",
  }));
  assert.equal(refusal?.name, "RangeError");
  assert.equal(refusal?.message,
    "Fallback locale 'und' is canonically equivalent to multiple loaded locales " +
    "[und-bokmal, und-nynorsk]; configure createStrings({ tiebreakers }) to choose one");

  // THE ANTI-zh-123 CONTROL: `und-*` catalogs load, `und` is an acceptable fallback spelling, and
  // one equivalent resolves through arm 2 — so the refusal above is ambiguity, not undeterminedness.
  const control = createStrings({
    strings: { "und-bokmal": catalogFor("und-bokmal"), fr: catalogFor("fr") },
    fallbackLocale: "und", locale: "und",
  });
  assert.equal(control.getLocaleConfiguration().fallbackLocale, "und-bokmal");
});

test("clause 8 C5: the OBVIOUS ambiguity fixture proves the neighbouring guard, not this one", () => {
  // MEASURED TRAP, machine-checked rather than argued in a comment. `{deu, ger}` with no tiebreakers
  // is the fixture anyone reaches for, and it is refused by the MISSING-TIEBREAKER guard, which is a
  // different branch. A designer who picks it reports a passing ambiguity test that never executed
  // the ambiguity arm. Pinning the other sentence here is what keeps the two apart.
  const refusal = thrown(() => createStrings({
    strings: catalogsFor(["deu", "ger"]), fallbackLocale: "de", locale: "de",
  }));
  assert.equal(refusal?.name, "RangeError");
  assert.equal(refusal?.message,
    "You must specify tiebreaker locales via createStrings({ tiebreakers }) to resolve ambiguity " +
    "for language code 'de' because localized strings exist for the following locale[s]: [deu, ger]");
  assert.ok(!/canonically equivalent to multiple loaded locales/.test(String(refusal?.message)),
    "if this ever becomes the ambiguity sentence, C5's fixture stopped being the only way in");
});

// ---------------------------------------------------------------------------------------------
// C6 / C7 — ":145 — Zero or still-ambiguous matches fail construction/MANIFEST VALIDATION."
// Both are DIVERGENCES today. Measured 2026-09-13; no src/ file was changed.
// ---------------------------------------------------------------------------------------------

test("clause 8 C6: a zero-candidate fallback is REFUSED at the manifest door, before any I/O", async () => {
  // WAS A DIVERGENCE UNTIL THE MAINTAINER DECIDED IT (D3). The clause (:145) and plan 6.2:2072
  // ("Manifest schema/semantic/fingerprint/runtime-data mismatch rejects with ConfigurationError
  // BEFORE a per-file plan exists") together require a refusal at the door, and the port planned an
  // empty fetch set instead, then refused only after fetching every catalog.
  //
  // TWO FIXTURES WHOSE ZERO-NESS HAS DIFFERENT CAUSES, kept from the divergence row because the
  // second is what makes a primary-language-widened relation visible at this door at all.
  for (const [label, tags, expected] of /** @type {[string, string[], string][]} */ ([
    ["unrelated languages", ["fr", "es"], "[es, fr]"],
    ["an equivalence verdict", ["de-AT", "fr"], "[de-AT, fr]"],
  ])) {
    const refusal = thrown(() => validateStringsManifest(manifest(tags, "de")));
    assert.equal(refusal?.name, "ConfigurationError", label);
    assert.equal(refusal?.message,
      `A manifest's fallbackLocale is 'de' but no matching catalog was declared. Known locales: ${expected}`,
      label);
    // THE PARSE DOOR TOO: a manifest arriving as text must not slip past the check that its
    // already-decoded twin fails, which is the shape S23 gated one phase over.
    assert.equal(thrown(() => parseStringsManifest(JSON.stringify(manifest(tags, "de"))))?.name,
      "ConfigurationError", label);
  }

  // AND NOTHING IS READ. The refusal the clause asks for is worth having precisely because it costs
  // no network: the loader never reaches a per-file plan, so a recording transport sees zero calls.
  const transport = recordingFetch();
  const failed = await rejected(() => loadEntireManifest(manifest(["fr", "es"], "de"), { fetch: transport.impl }));
  assert.equal(failed?.name, "ConfigurationError");
  assert.equal(transport.calls.length, 0,
    "the whole point of a door-stage refusal: before the fix this fetched every catalog first");

  // THE CONTROL: the identical manifest with a resolvable fallback validates, plans and loads, so
  // every refusal above is attributable to the fallback tag alone.
  const control = validates(manifest(["fr", "es"], "fr"));
  assert.equal(localeConfigurationForManifest(control).fallbackLocale, "fr");
  assert.deepEqual(localesOf(fetchSet(control, "pt-BR")), ["fr"]);
  assert.doesNotThrow(() =>
    createStrings({ strings: catalogsFor(["fr", "es"]), fallbackLocale: "fr", locale: "pt-BR" }));
});

test("clause 8 C7: an ambiguous fallback is REFUSED at the manifest door, not silently elected", async () => {
  // THE SHARPEST ROW IN THE FILE, and it was the sharpest DIVERGENCE until D3.
  // `owed-init.refusal.fallback-equivalent-to-multiple-catalogs` exists precisely to stop a port
  // quietly electing one of two equivalents; the corpus reaches only the direct door, and at the
  // manifest door the port did exactly that — `chain(m, "pt-BR")` ended `und-bokmal`, the subset
  // door fetched that one file, and the instance answered every unmatched request from a catalog
  // nobody chose. A `complete: true` load of a manifest the plan says must be refused.
  const ambiguous = manifest(["und-bokmal", "und-nynorsk"], "und");
  const refusal = thrown(() => validateStringsManifest(ambiguous));
  assert.equal(refusal?.name, "ConfigurationError");
  assert.equal(refusal?.message,
    "A manifest's fallbackLocale 'und' is canonically equivalent to multiple declared locales " +
    "[und-bokmal, und-nynorsk]; declare it as one of them exactly");

  // ASSERTING VALIDATION ALONE WOULD MISS THE OLD DEFECT, which is why the planner is asserted too:
  // an implementation that refused in `validateStringsManifest` and still elected inside
  // `chain`/`fetchSet` would pass a validation-only test. Both doors perform full validation.
  assert.equal(thrown(() => [...chain(ambiguous, "pt-BR")])?.name, "ConfigurationError");
  assert.equal(thrown(() => fetchSet(ambiguous, "pt-BR"))?.name, "ConfigurationError");
  assert.equal(thrown(() => parseStringsManifest(JSON.stringify(ambiguous)))?.name, "ConfigurationError");

  // AND NO FILE IS READ. Before the fix the subset door fetched exactly one — the elected one.
  const transport = recordingFetch();
  const failed = await rejected(() => loadStrings(ambiguous, "pt-BR", { fetch: transport.impl }));
  assert.equal(failed?.name, "ConfigurationError");
  assert.equal(transport.calls.length, 0);

  // THE REMEDY THE MESSAGE NAMES ACTUALLY WORKS, which is the half that keeps a refusal from being a
  // dead end. Spelling the fallback as one of the two validates and plans that file.
  //
  // A TIEBREAKER IS NOT THE REMEDY HERE AND THE MESSAGE DOES NOT CLAIM IT IS — measured:
  // `validateManifestTiebreakers` skips undetermined tags when grouping by primary language, so a
  // manifest tiebreaker keyed 'und' is refused with "no file for that language". The message was
  // reworded after this fixture caught it pointing at a locked door.
  const resolved = validates(manifest(["und-bokmal", "und-nynorsk"], "und-nynorsk"));
  assert.deepEqual(localesOf(fetchSet(resolved, "pt-BR")), ["und-nynorsk"]);
  assert.match(String(thrown(() => validateStringsManifest(
    manifest(["und-bokmal", "und-nynorsk"], "und", { und: ["und-nynorsk", "und-bokmal"] })))?.message),
    /no file for that language/,
    "a tiebreaker keyed on the undetermined tag is itself refused, which is why the message says otherwise");

  // THE CONTROL, which also retires the zh-123 worry about `und-*` keys: one equivalent resolves
  // through arm 2 at this door, so the rows above are about ambiguity and not about undetermined
  // tags being refused somewhere upstream.
  const control = validates(manifest(["und-bokmal", "fr"], "und"));
  assert.deepEqual(localesOf(fetchSet(control, "pt-BR")), ["und-bokmal"]);
});

// ---------------------------------------------------------------------------------------------
// C8 — ":146 — All runtime configuration, match results … use that resolved exact loaded tag."
// ---------------------------------------------------------------------------------------------

test("clause 8 C8: DIVERGENCE — the loader's own record disagrees with the instance it builds", async () => {
  // THE FIXTURE MUST SPELL THE FALLBACK NON-EXACTLY or the conjunct is vacuous: with a fallback
  // spelled exactly as a file key the resolved and declared tags coincide and nothing can differ.
  const m = validates(manifest(["deu", "fr"], "de"));
  const loaded = await loadEntireManifest(m, { fetch: recordingFetch().impl });

  assert.equal(loaded.fallbackLocale, "de",
    "DIVERGENCE: :146 requires the RESOLVED loaded tag 'deu'");
  assert.deepEqual({ ...loaded.manifestLocaleConfiguration },
    { fallbackLocale: "de", supportedLocales: ["deu", "fr"], tiebreakers: {} },
    "DIVERGENCE: a configuration whose fallback is not a member of its own supported set, which " +
    "plan 3.4:842-843 forbids for any match result built from it");

  // THE SAME INSTANCE REPORTS TWO DIFFERENT FALLBACKS, which is the caller-visible form of the
  // defect and the row the adversarial review predicted would be green. It is not: core resolves,
  // the loader does not, and both answers are handed to the same caller.
  const instance = createStrings({ loaded, locale: "pt-BR" });
  assert.equal(instance.getLocaleConfiguration().fallbackLocale, "deu");
  assert.equal(
    /** @type {any} */ (instance.getLoadVerification()).manifestLocaleConfiguration.fallbackLocale, "de");
  assert.notEqual(
    instance.getLocaleConfiguration().fallbackLocale,
    /** @type {any} */ (instance.getLoadVerification()).manifestLocaleConfiguration.fallbackLocale,
    "DIVERGENCE: these must be one value; when they become one, this assertion is the thing to delete");

  // THE SSR OBSERVATION, which `unprovableParts` gave up as unreachable. `LokalizedSsrStampV1` has no
  // fallback field — true — but plan 6.4:2256 makes `createSsrStamp` compare the record's resolved
  // fallback against the instance's, and that comparison is live and falsifiable.
  const refusal = thrown(() => createSsrStamp(instance, { kind: "locale", locale: "pt-BR" }));
  assert.equal(refusal?.name, "ConfigurationError");
  assert.equal(refusal?.message,
    "The verification record's manifest locale configuration resolves a different fallback than " +
    "this instance did");

  // THE CONTROL: the same catalogs with the fallback spelled exactly stamp cleanly, so the refusal
  // above is the spelling and not the fixture.
  const exact = validates(manifest(["deu", "fr"], "deu"));
  const exactLoaded = await loadEntireManifest(exact, { fetch: recordingFetch().impl });
  const exactInstance = createStrings({ loaded: exactLoaded, locale: "pt-BR" });
  assert.equal(exactInstance.getLocaleConfiguration().fallbackLocale, "deu");
  assert.equal(
    /** @type {any} */ (exactInstance.getLoadVerification()).manifestLocaleConfiguration.fallbackLocale,
    "deu");
  assert.equal(typeof createSsrStamp(exactInstance, { kind: "locale", locale: "pt-BR" }).lookupLocale,
    "string");
});

test("clause 8 C8: the record fed back to its own instance is REJECTED; the resolved tag is accepted", async () => {
  // THE ROUND TRIP, not field equality. Plan 3.4 names this record's purpose — "so an external
  // negotiator sees the same set used before subset loading" — and a field-equality test can be
  // satisfied by making every record raw and self-consistent while breaking exactly that use.
  //
  // THE MATCH IS NOT HAND-BUILT. A hand-built one is refused by the unmatched-shape guard before any
  // fallback check runs (measured), which would read as the probe firing while proving nothing; so it
  // comes from the instance's own matcher and only `fallbackLocale` is overridden. The resolver is
  // consulted at LOOKUP time, so each row must perform one.
  const m = validates(manifest(["deu", "fr"], "de"));
  const loaded = await loadEntireManifest(m, { fetch: recordingFetch().impl });
  const probe = createStrings({ loaded, locale: "pt-BR" });
  const ownMatch = probe.getDirectLocaleContext("pt-BR").localeMatch;
  const configuration = loaded.manifestLocaleConfiguration;

  // THE CONTROL FIRST: if this is rejected, the row below proves nothing.
  const accepted = createStrings({
    loaded,
    localeMatchResolver: () => /** @type {any} */ ({ ...ownMatch, fallbackLocale: "deu" }),
  });
  assert.equal(accepted.get("Greeting"), "DEU!");

  const rejection = thrown(() => createStrings({
    loaded,
    localeMatchResolver: () => /** @type {any} */ ({
      ...ownMatch,
      fallbackLocale: configuration.fallbackLocale,
      consideredLocales: [...configuration.supportedLocales],
    }),
  }).get("Greeting"));
  assert.equal(rejection?.name, "RangeError");
  assert.equal(rejection?.message, "The fallback locale must be present in considered locales",
    "DIVERGENCE: the loader hands back a configuration its own instance calls structurally invalid — " +
    "and the guard that fires is the CONTAINMENT one, which is the point: 'de' is not in [deu, fr]");
});

test("clause 8 C8: the DIRECT door's supplied match requires the RESOLVED fallback", () => {
  // The mirror of the row above at the door that WORKS (plan 3.4:845-848, "the instance's exact
  // fallback"). Cheap, green today, and it pins "match results use the resolved tag" where the
  // manifest-backed round trip cannot, because that one is red for a different reason.
  const strings = { strings: catalogsFor(["deu", "fr"]), fallbackLocale: "de" };
  const probe = createStrings({ ...strings, locale: "pt-BR" });
  const ownMatch = probe.getDirectLocaleContext("pt-BR").localeMatch;
  assert.equal(ownMatch.fallbackLocale, "deu", "the instance's own match already carries the resolved tag");

  const accepted = createStrings({
    ...strings, localeMatchResolver: () => /** @type {any} */ ({ ...ownMatch, fallbackLocale: "deu" }),
  });
  assert.equal(accepted.get("Greeting"), "DEU!");

  const rejection = thrown(() => createStrings({
    ...strings, localeMatchResolver: () => /** @type {any} */ ({ ...ownMatch, fallbackLocale: "de" }),
  }).get("Greeting"));
  assert.equal(rejection?.name, "RangeError");
  assert.equal(rejection?.message, "The fallback locale must be present in considered locales");
});

// ---------------------------------------------------------------------------------------------
// C9 — ":146 — … fallback-file loading … use that resolved exact loaded tag."
// ---------------------------------------------------------------------------------------------

test("clause 8 C9: the planned fallback FILE is the resolved file, entry and all", () => {
  // THE ENTRY, not the label. An implementation that emitted the right locale against the wrong file
  // would pass a tag-only assertion; url and sha256 are what a loader actually reads.
  const m = validates(manifest(["deu", "fr"], "de"));
  const planned = fetchSet(m, "pt-BR");
  assert.equal(planned.length, 1);
  assert.deepEqual({ ...planned[0] }, {
    locale: "deu",
    url: "https://cdn.example/v1/deu.json",
    sha256: sha256Hex(utf8.encode(bodyFor("deu"))),
  });
  // NON-VACUOUS FORM of "no entry keyed 'de'": no file is named `de`, so no plan could carry that
  // key under any implementation. The raw tag CAN leak into the chain, and does for an unresolvable
  // manifest (see C6) — so the chain is where the assertion belongs.
  assert.deepEqual([...chain(m, "pt-BR")], ["pt-BR", "pt", "deu"]);

  // AND IT MOVES WITH THE TIEBREAKER ORDER, which is what makes it resolution rather than a plan
  // that happens to contain every file.
  assert.deepEqual(localesOf(fetchSet(manifest(SR_FILES, "sr-Latn", { sr: SR_ORDER_A }), "de")), ["sh"]);
  assert.deepEqual(localesOf(fetchSet(manifest(SR_FILES, "sr-Latn", { sr: SR_ORDER_B }), "de")), ["hbs"]);
});

test("clause 8 C9: an exactly-spelled fallback plans the same file only where the arms agree", () => {
  // THE CONTROL, NARROWED. "Spell the fallback exactly and the plan is identical" is FALSE for
  // order (b): `sr-Latn` resolves through the tiebreaker list to `hbs`, while an exactly-spelled
  // `sh` takes arm 1 and resolves to `sh`. Asserting identity there would be a control that must
  // fail — and a control that must fail gets "fixed" by weakening the probe.
  assert.deepEqual(localesOf(fetchSet(validates(manifest(["deu", "fr"], "deu")), "pt-BR")), ["deu"]);
  assert.deepEqual(localesOf(fetchSet(validates(manifest(SR_FILES, "sh", { sr: SR_ORDER_A })), "de")), ["sh"]);
  assert.deepEqual(localesOf(fetchSet(validates(manifest(SR_FILES, "sh", { sr: SR_ORDER_B })), "de")), ["sh"],
    "arm 1 over arm 3 — the OPPOSITE of order (b)'s answer for 'sr-Latn', per C1");
});

// ---------------------------------------------------------------------------------------------
// C10 — the final conjunct: the resolved tag never rewrites a direct request's lookupLocale.
// ---------------------------------------------------------------------------------------------

test("clause 8 C10: a direct request's lookupLocale is never rewritten to the fallback", () => {
  // DIRECTION MATTERS AND ONE FIXTURE IS NOT ENOUGH.
  // (i) inverts the natural fixture: the fallback resolves through arm 1 to `de` while the REQUEST is
  //     the equivalent spelling `deu`, so requested / configured / resolved are three observations of
  //     which two must differ inside one result object. This is the row a "canonicalize the request
  //     for free" shortcut breaks.
  const inverted = createStrings({
    strings: catalogsFor(["de", "deu"]), tiebreakers: { de: ["deu", "de"] },
    fallbackLocale: "de", locale: "deu",
  });
  const invertedResult = inverted.getResult("Greeting");
  assert.equal(invertedResult.lookupLocale, "deu");
  assert.equal(invertedResult.localeMatch.fallbackLocale, "de",
    "two different tags in one result object, which is the whole conjunct");
  assert.equal(invertedResult.translation, "DEU!");

  // (ii) the natural direction, where the request and the resolved tag differ the other way. Close to
  //      the gated corpus case `dedup-and-candidates.fallbackalias.mo-request-resolves-ro`.
  const natural = createStrings({ strings: catalogsFor(["deu", "fr"]), fallbackLocale: "de", locale: "de" });
  const naturalResult = natural.getResult("Greeting");
  assert.equal(naturalResult.lookupLocale, "de");
  assert.equal(naturalResult.resolvedLocale, "deu");

  // THE CONTROL: an unrelated request on the same instance must actually REACH the fallback, or the
  // non-rewrite assertion can pass vacuously on an instance where resolution never ran.
  const reaching = createStrings({ strings: catalogsFor(["deu", "fr"]), fallbackLocale: "de", locale: "ja-JP" });
  const reachingResult = reaching.getResult("Greeting");
  assert.equal(reachingResult.lookupLocale, "ja-JP");
  assert.equal(reachingResult.resolvedLocale, "deu");
  assert.deepEqual([...reachingResult.attemptedLocales], ["ja-JP", "ja", "deu"]);
});

test("clause 8 C10: the SSR stamp and lookup coverage carry the REQUEST, not the resolved fallback", async () => {
  // A DIFFERENT DOOR, stated rather than smuggled in: `createSsrStamp` refuses a directly constructed
  // instance outright (plan 6.4:2246-2247), so attaching it to C10's direct fixtures would throw for
  // a reason unrelated to rewriting and read as the probe firing. The fixture is therefore
  // manifest-backed, and it is fixture (i) — the inverted one — because fixture (ii) cannot
  // distinguish a rewrite to the configured fallback from no rewrite at all.
  const m = validates(manifest(["de", "deu"], "de", { de: ["deu", "de"] }));
  const loaded = await loadStrings(m, "deu", { fetch: recordingFetch().impl });
  assert.deepEqual(loaded.requestedFiles.map((entry) => entry.locale), ["deu", "de"]);
  assert.deepEqual({ ...loaded.coverage }, { kind: "lookup", lookupLocale: "deu" });

  // Plan 3.4:850-856 validates coverage against the locale that ACTUALLY STARTS per-key fallback, so
  // a rewritten lookup would make this construction refuse — the machine-checkable half of the
  // clause's last sentence.
  const instance = createStrings({ loaded, locale: "deu" });
  assert.equal(instance.getResult("Greeting").lookupLocale, "deu");
  assert.equal(instance.getLocaleConfiguration().fallbackLocale, "de");
  assert.equal(instance.get("Greeting"), "DEU!");

  const stamp = createSsrStamp(instance, { kind: "locale", locale: "deu" });
  assert.equal(stamp.lookupLocale, "deu",
    "the stamp carries the REQUEST; it has no fallback field at all, by plan 6.4's design");
  assert.deepEqual({ ...stamp.localeMatch }, { locale: "deu", matchType: "exact" });
});

// ---------------------------------------------------------------------------------------------
// C11 — `CatalogIdentityInputV1.resolvedFallbackLocale` (plan 6.1:1840).
// ---------------------------------------------------------------------------------------------

test("clause 8 C11: DIVERGENCE — identity hashes the DECLARED fallback, so two publishers of one catalog set disagree", () => {
  // THE OBSERVATION MUST BE CROSS-MANIFEST. A single manifest is self-consistent under either rule —
  // the same tag computes and checks — so nothing is visible from one. Both fingerprints here are
  // produced by the implementation at fixture-build time and both manifests validate, so a
  // declared/computed mismatch can never be misreported as fingerprint inequality.
  const declaredRaw = validates(manifest(["deu", "fr"], "de"));
  const declaredExact = validates(manifest(["deu", "fr"], "deu"));
  assert.notEqual(declaredRaw.catalogFingerprint, declaredExact.catalogFingerprint,
    "DIVERGENCE: both resolve to deu.json over byte-identical catalogs, so plan 6.1:1928's stated " +
    "purpose — 'so server and CDN manifests can identify the same translations' — says these should " +
    "be equal. INTERPRETIVE, and owed a maintainer ruling: should two publishers of the same " +
    "catalogs who spell the fallback differently be told they hold different translations?");

  // THE TRANSPORT EXCLUSION still holds, so the inequality above is the fallback field and not a
  // fingerprint that moves for everything.
  const moved = manifest(["deu", "fr"], "de");
  moved.baseUrl = "https://other.example/x/";
  moved.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(moved)).catalogFingerprint;
  assert.equal(moved.catalogFingerprint, declaredRaw.catalogFingerprint);
});

test("clause 8 C11: identity does read the fallback — the inclusion control that fails if the field is dropped", () => {
  // WITHOUT THIS ROW THE CONJUNCT CANNOT TELL "identity uses the RESOLVED fallback" FROM "identity
  // ignores the fallback": an implementation that simply omitted `resolvedFallbackLocale` from the
  // JCS projection passes the equality reading above and passes a catalogVersion-differs control,
  // because that control varies a different field. Two manifests whose fallbacks resolve to
  // DIFFERENT files must fingerprint differently under either reading of the clause.
  const toDeu = validates(manifest(["deu", "fr"], "de"));
  const toFr = validates(manifest(["deu", "fr"], "fr"));
  assert.notEqual(toDeu.catalogFingerprint, toFr.catalogFingerprint);

  const otherVersion = validates(manifest(["deu", "fr"], "de", {}, { catalogVersion: "v2" }));
  assert.notEqual(otherVersion.catalogFingerprint, toDeu.catalogFingerprint,
    "the ordinary inclusion control, kept so 'differs' is not read as 'this digest differs for all input'");
});

// ---------------------------------------------------------------------------------------------
// Plan 6.2:2082 — allow-partial is gated on "the RESOLVED fallback-locale file".
// ---------------------------------------------------------------------------------------------

test("clause 8 :2082: DIVERGENCE — allow-partial tests the DECLARED fallback tag, so a resolved fallback that loaded is not credited", async () => {
  // ":2082 — may return successes and ordered failures only if the RESOLVED fallback-locale file
  // loaded and validated; fallback-file failure always rejects." The guard compares a failure row's
  // locale against the DECLARED tag, which never matches a plan built from the RESOLVED one — so for
  // a non-exactly-spelled fallback the guard can never be satisfied and allow-partial degenerates
  // into reject-always. A fixture whose fallback is spelled exactly cannot see this.
  const raw = validates(manifest(["deu", "fr"], "de"));

  const spuriously = await rejected(() => loadEntireManifest(raw, {
    fetch: recordingFetch(new Set(["fr"])).impl, partialFailure: "allow-partial",
  }));
  assert.equal(spuriously?.name, "StringsLoadingError");
  assert.match(String(spuriously?.message), /the resolved fallback-locale file is among them/,
    "DIVERGENCE: deu.json — the resolved fallback file — loaded fine; only fr.json failed, and " +
    ":2082 says this load may return successes and ordered failures");

  // THE OTHER DIRECTION IS RIGHT TODAY, and it is right for the wrong reason — the guard refuses
  // everything — so it is pinned with the control that proves the machinery works at all.
  const genuinely = await rejected(() => loadEntireManifest(raw, {
    fetch: recordingFetch(new Set(["deu"])).impl, partialFailure: "allow-partial",
  }));
  assert.equal(genuinely?.name, "StringsLoadingError");

  // THE CONTROL: the identical catalogs with the fallback spelled EXACTLY do return a partial result
  // when a non-fallback file fails, and still reject when the fallback file fails. So the divergence
  // above is the spelling of the fallback tag and nothing else about the fixture.
  const exact = validates(manifest(["deu", "fr"], "deu"));
  const partial = await loadEntireManifest(exact, {
    fetch: recordingFetch(new Set(["fr"])).impl, partialFailure: "allow-partial",
  });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.failures.map((failure) => failure.locale), ["fr"]);
  assert.deepEqual(Object.keys(partial.catalogs), ["deu"]);

  const exactFallbackFails = await rejected(() => loadEntireManifest(exact, {
    fetch: recordingFetch(new Set(["deu"])).impl, partialFailure: "allow-partial",
  }));
  assert.equal(exactFallbackFails?.name, "StringsLoadingError");
});
