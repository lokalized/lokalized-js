// @ts-check

/**
 * THE DONOR RULE, named consumer by consumer.
 *
 * The measured invariant is one sentence — *the evaluation locale is the SUPPLYING catalog's, never
 * the requested one* — and it is threaded through the whole renderer by ONE argument:
 * `renderContextFor(key, candidate, bidiIsolation)` in `src/core/index.js`, where `candidate` is the
 * catalog that supplied the entry. Every consumer below reads it, and swapping that single argument
 * for `lookupLocale` is a one-token edit that compiles, renders, and is wrong for every
 * fallback-served lookup.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FAMILY COUNT. `evaluation-locale` is 117/117 and
 * `pt-flattening` 27/27 — measured this session, not inherited — and it is tempting to call the
 * clause discharged on those numbers. It is not: a family count says which rows the runner compared,
 * not which readers of the invariant it reached. Enumerating the corpus family by subject shows it
 * covers cardinal classification, ordinal classification, bidi isolation and expression
 * alternatives, and covers the CARDINAL-RANGE combination in NO row at all (`range` appears in zero
 * of the 117 ids), while phonetic resolution lives in a different family entirely
 * (`resolver-locale`). So the count is a floor over four of the readers and silent about the other
 * two. Each one below is verified by ABLATION — `candidate` replaced by `lookupLocale` — and the
 * measurement is recorded beside it.
 *
 * Every case is a PAIR. The donor instance loads only `en`, so a `cy` request is served by the
 * English catalog; the control instance loads a `cy` catalog carrying the same keys, so the
 * identical request is served by `cy`. Welsh is chosen because its cardinal and ordinal categories
 * disagree with English at small integers — `2` is CARDINALITY_TWO in cy and CARDINALITY_OTHER in
 * en, `5` is ORDINALITY_MANY in cy and ORDINALITY_OTHER in en — so the two evaluations produce
 * DIFFERENT TEXT rather than the same text by two routes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { PHONETIC_CONSONANT, PHONETIC_VOWEL } from "../src/index.js";
import { cardinalRangeData } from "../src/data/ranges.js";
import { ordinalData } from "../src/data/ordinal.js";

/** Every CLDR category spelled as its own answer, so the rendered text names the classification. */
const CARDINAL_FORMS = {
  CARDINALITY_ZERO: "ZERO",
  CARDINALITY_ONE: "ONE",
  CARDINALITY_TWO: "TWO",
  CARDINALITY_FEW: "FEW",
  CARDINALITY_MANY: "MANY",
  CARDINALITY_OTHER: "OTHER",
};
const ORDINAL_FORMS = {
  ORDINALITY_ZERO: "ZERO",
  ORDINALITY_ONE: "ONE",
  ORDINALITY_TWO: "TWO",
  ORDINALITY_FEW: "FEW",
  ORDINALITY_MANY: "MANY",
  ORDINALITY_OTHER: "OTHER",
};

const CATALOG = {
  // Consumer 1: cardinal classification (`cardinalityNameForValue`).
  Cardinal: { translation: "{{noun}}", placeholders: { noun: { value: "count", translations: CARDINAL_FORMS } } },
  // Consumer 2: ordinal classification (`ordinalityNameForValue`), through the optional module.
  Ordinal: { translation: "{{place}}", placeholders: { place: { value: "rank", translations: ORDINAL_FORMS } } },
  // Consumer 3: language-form selection, on the RANGE path — both endpoints are classified under
  // the evaluation locale and then COMBINED under it.
  Range: {
    translation: "{{span}}",
    placeholders: { span: { range: { start: "lo", end: "hi" }, translations: CARDINAL_FORMS } },
  },
  // Consumer 5: phonetic resolution — the resolver is CALLED with the evaluation locale.
  Phonetic: {
    translation: "{{article}}",
    placeholders: { article: { value: "term", translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" } } },
  },
  // The fifth reader the M7 row does not name: an expression alternative's own classification.
  Alternative: {
    translation: "DEFAULT",
    alternatives: [{ "count == CARDINALITY_TWO": "ALT-TWO" }],
  },
};

/** A resolver that records the locale it was handed and answers from a term table. */
function recordingResolver() {
  /** @type {{ term: string, locale: string }[]} */
  const calls = [];
  return {
    calls,
    resolve: (/** @type {string} */ term, /** @type {string} */ locale) => {
      calls.push({ term, locale });
      return term === "apple" ? PHONETIC_VOWEL : PHONETIC_CONSONANT;
    },
  };
}

const donorResolver = recordingResolver();
const controlResolver = recordingResolver();

const common = {
  fallbackLocale: "en",
  locale: "en",
  pluralData: { ordinal: ordinalData, ranges: cardinalRangeData },
};

/** Only `en` is loaded, so a `cy` request is SERVED BY the English catalog. */
const donor = createStrings({ ...common, strings: { en: CATALOG }, phoneticResolver: donorResolver.resolve });

/** The same request, served by a `cy` catalog: the control that must move. */
const control = createStrings({
  ...common,
  strings: { en: CATALOG, cy: CATALOG },
  phoneticResolver: controlResolver.resolve,
});

const cy = { locale: "cy" };

describe("the evaluation locale is the supplying catalog's — every consumer", () => {
  it("routes the two instances as the pairing assumes", () => {
    // Read, not assumed: if `cy` ever became reachable on the donor instance the pairs below would
    // agree for the wrong reason and every assertion in this file would go quiet.
    assert.equal(donor.getResult("Cardinal", { count: 2 }, cy).resolvedLocale, "en");
    assert.equal(control.getResult("Cardinal", { count: 2 }, cy).resolvedLocale, "cy");
    assert.equal(donor.getResult("Cardinal", { count: 2 }, cy).lookupLocale, "cy");
  });

  it("CONSUMER 1 — cardinal classification classifies under the donor", () => {
    // 2 is CARDINALITY_OTHER in en and CARDINALITY_TWO in cy.
    assert.equal(donor.get("Cardinal", { count: 2 }, cy), "OTHER");
    assert.equal(control.get("Cardinal", { count: 2 }, cy), "TWO");
  });

  it("CONSUMER 2 — ordinal classification classifies under the donor", () => {
    // 5 is ORDINALITY_OTHER in en and ORDINALITY_MANY in cy.
    assert.equal(donor.get("Ordinal", { rank: 5 }, cy), "OTHER");
    assert.equal(control.get("Ordinal", { rank: 5 }, cy), "MANY");
  });

  it("CONSUMER 3 — language-form selection on the RANGE path, endpoints AND combination", () => {
    // Endpoints: 2 classifies TWO under cy and OTHER under en, and the combination differs too.
    assert.equal(donor.get("Range", { lo: 2, hi: 2 }, cy), "OTHER");
    assert.equal(control.get("Range", { lo: 2, hi: 2 }, cy), "TWO");

    // THE COMBINATION ALONE, isolated: 5 and 1 classify identically in both locales (OTHER, ONE),
    // so only `cardinalityForRange(OTHER, ONE, evaluationLocale)` can move the answer — en answers
    // OTHER and cy answers ONE. This is the reader NO row of the 117-case family reaches.
    assert.equal(donor.get("Range", { lo: 5, hi: 1 }, cy), "OTHER");
    assert.equal(control.get("Range", { lo: 5, hi: 1 }, cy), "ONE");
  });

  it("CONSUMER 4 — bidi isolation reads the donor, in both directions", () => {
    // Default mode is rtl-locales. An ARABIC request served by an English catalog is NOT isolated;
    // an ENGLISH request served by an Arabic catalog IS. Nothing about the request decides it.
    const ltrDonor = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Greeting: "Hello, {{name}}" }, ar: { "Locale.Marker": "ar" } },
    });
    const rtlDonor = createStrings({
      fallbackLocale: "ar",
      locale: "en",
      strings: { ar: { Greeting: "AR {{name}}" }, en: { "Locale.Marker": "en" } },
    });

    assert.equal(ltrDonor.get("Greeting", { name: "Sarah" }, { locale: "ar" }), "Hello, Sarah");
    assert.equal(rtlDonor.get("Greeting", { name: "Sarah" }, { locale: "en" }), "AR ⁨Sarah⁩");
  });

  it("CONSUMER 5 — the phonetic resolver is CALLED with the donor's locale", () => {
    donorResolver.calls.length = 0;
    controlResolver.calls.length = 0;

    assert.equal(donor.get("Phonetic", { term: "apple" }, cy), "an");
    assert.deepEqual(donorResolver.calls, [{ term: "apple", locale: "en" }]);

    assert.equal(control.get("Phonetic", { term: "apple" }, cy), "an");
    assert.deepEqual(controlResolver.calls, [{ term: "apple", locale: "cy" }]);
  });

  it("and an expression ALTERNATIVE classifies under the donor too", () => {
    // `count == CARDINALITY_TWO` with count 2: false under en (2 is OTHER), true under cy.
    assert.equal(donor.get("Alternative", { count: 2 }, cy), "DEFAULT");
    assert.equal(control.get("Alternative", { count: 2 }, cy), "ALT-TWO");
  });
});
