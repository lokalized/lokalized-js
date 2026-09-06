// @ts-check
/**
 * `lokalized` — the root entry point: strict core, parser, cardinal/locale/direct-match data.
 *
 * M2 walking skeleton. Everything here is browser-safe: no Node built-ins, no dynamic code
 * evaluation, no dependencies.
 */
import { LANGUAGE_FORM_NAMES } from "./internal/catalog.js";
import {
  cardinalCategoryFor,
  cardinalRuleLocaleTags,
  operandsForPluralValue,
  supportedCardinalCategoriesFor,
  validateOperandOptions,
} from "./internal/plural.js";

export { createStrings } from "./core/index.js";

// Plan 3.4: "The root graph instead exports a pure small chooser and a browser convenience." They
// are core's symbols (allowlist owner `core`, `reExportedByRoot`) and they enter NO new module —
// both live in `src/core/index.js`, which the root graph already reaches, so the 0a module count
// stays 25 root / 24 core. That is the half of the ratchet that keeps `lokalized/negotiate` and its
// 806-class IANA table out of the browser graph, and the chooser exists precisely so a browser does
// not have to pull them in to pick a locale.
export { chooseBrowserLocale, chooseLocaleForPreferredLanguages } from "./core/index.js";

const freeze = Object.freeze;

/**
 * The 61 public language-form constants.
 *
 * `renderName` is the Java enum member's own name, taken from the generated table rather than
 * derived by stripping a prefix off the constant — plan section 3.7 forbids that derivation, and the
 * corpus's `languageForms` case carries all 61 authoritative tuples to prove this exact.
 *
 * Frozen and structurally recognized, so the values survive JSON, RSC, workers, structured clone,
 * and cross-realm boundaries.
 *
 * @type {Record<string, Readonly<{ $lokalized: "language-form", axis: string, name: string, renderName: string }>>}
 */
const LANGUAGE_FORMS = {};
for (const [axis, prefix, members] of LANGUAGE_FORM_NAMES)
  for (const member of members) {
    const name = `${prefix}${member}`;
    LANGUAGE_FORMS[name] = freeze({
      $lokalized: /** @type {const} */ ("language-form"),
      axis,
      name,
      renderName: member,
    });
  }

// Named exports for every constant. Enumerated rather than spread so the package-surface test and
// the symbol allowlist can both see them statically.
export const {
  ANIMACY_ANIMATE, ANIMACY_INANIMATE,
  CARDINALITY_ZERO, CARDINALITY_ONE, CARDINALITY_TWO, CARDINALITY_FEW, CARDINALITY_MANY, CARDINALITY_OTHER,
  CASE_NOMINATIVE, CASE_ACCUSATIVE, CASE_GENITIVE, CASE_DATIVE, CASE_INSTRUMENTAL, CASE_LOCATIVE,
  CASE_PREPOSITIONAL, CASE_VOCATIVE, CASE_ABLATIVE,
  CLASSIFIER_GENERAL, CLASSIFIER_PERSON, CLASSIFIER_ANIMAL, CLASSIFIER_LONG_THIN, CLASSIFIER_FLAT,
  CLASSIFIER_BOUND, CLASSIFIER_MACHINE, CLASSIFIER_VEHICLE,
  CLUSIVITY_INCLUSIVE, CLUSIVITY_EXCLUSIVE,
  DEFINITENESS_DEFINITE, DEFINITENESS_INDEFINITE, DEFINITENESS_CONSTRUCT,
  FORMALITY_CASUAL, FORMALITY_INFORMAL, FORMALITY_FORMAL, FORMALITY_HUMBLE, FORMALITY_HONORIFIC,
  GENDER_MASCULINE, GENDER_FEMININE, GENDER_COMMON, GENDER_NEUTER,
  ORDINALITY_ZERO, ORDINALITY_ONE, ORDINALITY_TWO, ORDINALITY_FEW, ORDINALITY_MANY, ORDINALITY_OTHER,
  PHONETIC_VOWEL, PHONETIC_CONSONANT, PHONETIC_H_SILENT, PHONETIC_H_ASPIRATED, PHONETIC_S_IMPURE,
  PHONETIC_Z, PHONETIC_GN, PHONETIC_PS, PHONETIC_PN, PHONETIC_X, PHONETIC_GLIDE_Y, PHONETIC_GLIDE_W,
  PHONETIC_STRESSED_A, PHONETIC_SOLAR, PHONETIC_LUNAR, PHONETIC_OTHER,
} = LANGUAGE_FORMS;

/**
 * An exact decimal carried as text.
 *
 * The value stays a digit string because the distinctions this type exists to preserve — `1` versus
 * `1.0`, `0` versus `0.0`, anything past 2^53 — are exactly the ones a binary64 round trip destroys.
 *
 * @param {string} value
 */
export function decimal(value) {
  if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    throw new RangeError(`decimal() requires the versioned decimal grammar; received ${JSON.stringify(value)}`);
  return freeze({ $lokalized: /** @type {const} */ ("decimal"), value });
}

/**
 * Explicit plural operands, for a displayed number whose visible form carries information the value
 * alone does not — trailing zeros, or compact notation.
 *
 * @param {string} value
 * @param {{ visibleDecimalPlaces?: number, compactExponent?: number }} [options]
 */
export function pluralOperands(value, options) {
  decimal(value); // reuse the grammar check
  // EAGERLY, at value construction, because that is where Java refuses. `PluralOperands.Builder`
  // carries its OWN `TranslationRuntimeLimits`, defaulted to `TranslationRuntimeLimits.defaults()`,
  // and `build()` checks the options before it touches the number at all — so a caller writing
  // `pluralOperands("1", { compactExponent: 65 })` gets `Compact exponent 65 exceeds the maximum of
  // 64` from THIS call, not a translation failure from a later `get`.
  //
  // The divergence this closes was invisible: deferring the check to `operandsForPluralValue` still
  // raised the same error with the same message, but at the wrong phase, so the walk turned it into
  // a RESOLUTION_FAILURE and the default handler returned the key. Java throws out of the caller's
  // own value construction, and `runtime-limits.numeric.default.compact-exponent-65` and
  // `.visible-decimal-places-1025` record exactly that — a `thrown` block with no failure channel at
  // all. Their at-limit twins (`-64`, `-1024`) stay TRANSLATED, which is the control that says this
  // is a boundary and not a blanket refusal.
  validateOperandOptions(options ?? {});
  return freeze({
    $lokalized: /** @type {const} */ ("plural-operands"),
    value,
    ...(options?.visibleDecimalPlaces !== undefined ? { visibleDecimalPlaces: options.visibleDecimalPlaces } : {}),
    ...(options?.compactExponent !== undefined ? { compactExponent: options.compactExponent } : {}),
  });
}

/**
 * @param {string} category
 * @returns {Readonly<{ $lokalized: "language-form", axis: string, name: string, renderName: string }>}
 */
function cardinalityConstant(category) {
  const constant = LANGUAGE_FORMS[`CARDINALITY_${category.toUpperCase()}`];
  if (constant === undefined) throw new RangeError(`Unsupported CLDR plural category '${category}'`);
  return constant;
}

/**
 * The CLDR cardinal category for a value under a locale.
 *
 * @param {number | bigint | Readonly<{ $lokalized: string, value: string }>} value
 * @param {string} locale
 */
export function cardinalityForNumber(value, locale) {
  // Through `cardinalityConstant` rather than a bare index, so the declared return type is the
  // tagged value plan 3.7 promises and not `... | undefined`.
  return cardinalityConstant(cardinalCategoryFor(operandsForPluralValue(value), locale));
}

/**
 * The CLDR cardinal category for explicit operands.
 *
 * @param {Readonly<{ $lokalized: string, value: string }>} value
 * @param {string} locale
 */
export function cardinalityForOperands(value, locale) {
  return cardinalityForNumber(value, locale);
}

/**
 * The cardinal categories a locale's CLDR rules can produce, in `CARDINALITY_*` declaration order.
 *
 * This is a probe, not a classifier: a well-formed locale with no CLDR cardinal rules returns an
 * empty array, where `cardinalityForNumber` would throw. Only a malformed tag is an error. Java
 * draws the same line — `supportedCardinalitiesForLocale` returns an empty `SortedSet` and
 * `Cardinality.forNumber` throws `UnsupportedLocaleException`.
 *
 * @param {string} locale
 */
export function supportedCardinalitiesForLocale(locale) {
  return freeze(supportedCardinalCategoriesFor(locale).map(cardinalityConstant));
}

/** @type {readonly string[] | null} */
let supportedCardinalityLocaleTags = null;

/**
 * The BCP 47 tags carried directly by the generated cardinal rule table, in natural string order.
 *
 * These are rule-table keys, not the set of accepted locales: `en-GB`, `de-CH-1901` and `mo` all
 * classify, through canonicalization and the script/region walk, without appearing here. Use
 * {@link supportedCardinalitiesForLocale} to ask about a concrete tag.
 */
export function getSupportedCardinalityLocaleTags() {
  supportedCardinalityLocaleTags ??= freeze(cardinalRuleLocaleTags());
  return supportedCardinalityLocaleTags;
}
