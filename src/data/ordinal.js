// @ts-check

/**
 * `lokalized/data/ordinal` — the optional ordinal data and classifiers.
 *
 * CLDR keeps ORDINAL plural rules in a table of their own, and the two tables genuinely disagree:
 * English cardinals are `{one, other}` while English ordinals are `{one, two, few, other}`; Russian
 * ordinals are `{other}` alone while its cardinals are `{one, few, many, other}`; Irish is
 * `{one, other}` for ordinals and five-way for cardinals. Reusing the cardinal answer for an ordinal
 * question is therefore wrong at almost every locale, which is why this is a separate table rather
 * than a flag on the cardinal one — and why it is OPTIONAL: most catalogs never ask an ordinal
 * question, and 3 KB of ordinal rules should not be in everyone's bundle.
 *
 * Three pieces of `CldrPluralRules` behaviour are transcribed here rather than invented:
 *
 *   1. Lookup walks the same canonicalized CLDR candidate chain as cardinals (`mo` asks `ro`), using
 *      the shared table built by `../internal/plural.js`. There is ONE rule parser and ONE exact
 *      arithmetic in this library; this module supplies data to it and nothing else.
 *   2. `ordinalRulesForLocale` falls back to the UNDETERMINED group — not to "unsupported" — for a
 *      locale that has cardinal rules but no ordinal ones (`asa`, `bem`, …). Only a locale that the
 *      CARDINAL table does not know is unsupported for ordinals.
 *   3. `supportedOrdinalitiesForLocale` returns an empty list for that unsupported locale while
 *      `ordinalityForNumber` throws for it. The asymmetry is Java's and is deliberate on both sides.
 *
 * This module is OUTSIDE the root graph: `src/index.js` must never reach `./ordinal-rules.js`, and
 * `npm run scenario:0a`'s module ratchet is what keeps that honest. The dependency runs the other
 * way — importing the root from here is what makes the returned constants the SAME frozen objects
 * the root exports, so `ordinalityForNumber(2, "en") === ORDINALITY_TWO` holds by identity and not
 * merely by shape.
 */

import { configurationError } from "../internal/configuration-error.js";
import {
  ORDINALITY_ZERO,
  ORDINALITY_ONE,
  ORDINALITY_TWO,
  ORDINALITY_FEW,
  ORDINALITY_MANY,
  ORDINALITY_OTHER,
} from "../index.js";
import { jdkLanguageTag } from "../internal/locale-jdk-tag.js";
import {
  PLURAL_DATA_RUNTIME,
  UnsupportedLocaleError,
  cardinalRuleLocaleTags,
  createRuleTable,
  hasCardinalRulesForLocale,
  operandsForPluralValue,
} from "../internal/plural.js";
import { decode as decodeOrdinalRules } from "./ordinal-rules.js";
import { decode as decodeProvenance } from "./provenance.js";

const freeze = Object.freeze;

const ORDINAL_GROUPS = decodeOrdinalRules();
const ORDINAL_TABLE = createRuleTable(ORDINAL_GROUPS);

/** The generated table spells lokalized-java's `root` ordinal group `und`. */
const UNDETERMINED_TAG = "und";

/**
 * `Ordinality`'s declaration order, which is the order Java's `SortedSet<Ordinality>` iterates and
 * the order plan section 3.7 requires of every category array.
 */
const ORDINALITY_ORDER = /** @type {const} */ (["zero", "one", "two", "few", "many", "other"]);

/** @typedef {Readonly<{ $lokalized: "language-form", axis: "ordinality", name: string, renderName: string }>} OrdinalityValue */

/**
 * One of the root's six `ORDINALITY_*` constants, checked to be exactly that.
 *
 * Plan section 3.7 admits only tagged records whose `(axis, name)` pair is in the generated 61-value
 * allowlist, and rejects forged or mismatched tuples. Checking the six on the way in is the cheapest
 * place to honour that — a root that does not export them, or exports something else under the name,
 * is a mispaired module and fails here at construction rather than returning a wrong axis to a
 * caller. It also gives this module's published types a return value that is never `undefined`.
 *
 * @param {unknown} form
 * @param {string} name
 * @returns {OrdinalityValue}
 */
function requireOrdinality(form, name) {
  const tagged = /** @type {Partial<OrdinalityValue> | null} */ (
    form !== null && typeof form === "object" ? form : null
  );

  if (tagged === null || tagged.$lokalized !== "language-form" || tagged.axis !== "ordinality" || tagged.name !== name)
    throw configurationError(`lokalized/data/ordinal: the root did not supply the ${name} language form`);

  return /** @type {OrdinalityValue} */ (tagged);
}

/** CLDR count keyword to the root's own frozen constant. */
const ORDINALITY_BY_COUNT = freeze({
  zero: requireOrdinality(ORDINALITY_ZERO, "ORDINALITY_ZERO"),
  one: requireOrdinality(ORDINALITY_ONE, "ORDINALITY_ONE"),
  two: requireOrdinality(ORDINALITY_TWO, "ORDINALITY_TWO"),
  few: requireOrdinality(ORDINALITY_FEW, "ORDINALITY_FEW"),
  many: requireOrdinality(ORDINALITY_MANY, "ORDINALITY_MANY"),
  other: requireOrdinality(ORDINALITY_OTHER, "ORDINALITY_OTHER"),
});

/** @type {readonly OrdinalityValue[]} */
const NO_ORDINALITIES = freeze([]);


/**
 * Provenance is checked HERE, at module construction, not at the first lookup.
 *
 * Plan section 3.7: incompatible optional data is "a construction-time `ConfigurationError`, not a
 * late lookup surprise". `lokalized/data/ordinal` is separately installable and separately bundled
 * (plan 6.3 ships `dist/browser/data/ordinal.js` as its own file), so the pairing that can go wrong
 * is an ordinal module built from one pinned CLDR release loaded beside a root built from another.
 * Two independent checks catch that, and both run before this module exports anything:
 *
 *   - the pinned provenance record must have the shape a generated record has, so a hand-edited or
 *     truncated `./provenance.js` is rejected rather than silently believed; and
 *   - every locale this ordinal table represents must also be represented by the ROOT's cardinal
 *     table. That is a real cross-graph comparison — it is the invariant `ordinalRulesForLocale`
 *     depends on (its undetermined-group fallback is keyed on cardinal support), and CLDR releases
 *     add locales, so a mismatched pair shows up here as an ordinal locale the root has never heard
 *     of rather than as a wrong answer months later.
 *
 * The remaining seam — two *equal-looking* records from different releases — is closed by
 * `createStrings`, which compares `ordinalData.provenance` against the rendering core's own
 * constants. That comparison needs the root to publish its provenance, which it does not yet.
 *
 * @param {{ cldrVersion: string, dataFingerprint: string }} provenance
 */
function validateProvenance(provenance) {
  if (typeof provenance.cldrVersion !== "string" || !/^\d+(?:\.\d+)*$/.test(provenance.cldrVersion))
    throw configurationError(
      `lokalized/data/ordinal: pinned CLDR version '${String(provenance.cldrVersion)}' is not a CLDR version`,
    );

  if (typeof provenance.dataFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(provenance.dataFingerprint))
    throw configurationError("lokalized/data/ordinal: pinned data fingerprint is not a SHA-256 digest");

  if (ORDINAL_GROUPS.length === 0) throw configurationError("lokalized/data/ordinal: the ordinal rule table is empty");

  /** @type {Set<string>} */
  const ordinalTags = new Set();
  for (const group of ORDINAL_GROUPS) {
    if (group.rules.length === 0)
      throw configurationError(`lokalized/data/ordinal: rule group [${group.locales.join(", ")}] has no rules`);

    for (const rule of group.rules)
      if (!Object.hasOwn(ORDINALITY_BY_COUNT, rule.count))
        throw configurationError(`lokalized/data/ordinal: '${rule.count}' is not a CLDR ordinal category`);

    // The unconditional `other` terminates every CLDR rule list; without it a group could fall off
    // the end and report a category the locale does not support.
    const last = group.rules[group.rules.length - 1];
    if (last === undefined || last.count !== "other" || last.condition !== "")
      throw configurationError(
        `lokalized/data/ordinal: rule group [${group.locales.join(", ")}] does not end in unconditional 'other'`,
      );

    for (const locale of group.locales) ordinalTags.add(locale);
  }

  if (!ordinalTags.has(UNDETERMINED_TAG))
    throw configurationError(`lokalized/data/ordinal: the table has no '${UNDETERMINED_TAG}' group to fall back to`);

  const cardinalTags = new Set(cardinalRuleLocaleTags());
  const unknown = [...ordinalTags].filter((tag) => !cardinalTags.has(tag));
  if (unknown.length > 0)
    throw configurationError(
      `lokalized/data/ordinal: CLDR ${provenance.cldrVersion} ordinal data does not pair with this root's ` +
        `cardinal data; it carries locales the root does not know: ${unknown.join(", ")}`,
    );
}

const PROVENANCE = freeze({ ...decodeProvenance() });
validateProvenance(PROVENANCE);

/**
 * The pinned-data provenance of this module, for `createStrings` to compare against the root's.
 *
 * @type {Readonly<{ $lokalized: "ordinal-data", provenance: Readonly<{ cldrVersion: string, dataFingerprint: string }> }>}
 */
export const ordinalData = freeze({
  $lokalized: /** @type {const} */ ("ordinal-data"),
  provenance: PROVENANCE,

  // The capability `createStrings` needs, under a symbol that is not part of the published shape.
  // Core cannot import this module — the root graph is ratcheted precisely so it cannot — so an
  // ORDINALITY_* placeholder is answerable only by the classifier the CONSUMER hands over with the
  // data. Names rather than tagged values: the renderer keys `translations` by name and must not
  // acquire an edge to this module's constants either.
  [PLURAL_DATA_RUNTIME]: freeze({
    /**
     * @param {unknown} value
     * @param {string} locale
     * @returns {string}
     */
    ordinalityNameFor: (value, locale) =>
      ordinalityForNumber(/** @type {number | bigint | Readonly<{ $lokalized: string, value: string }>} */ (value), locale)
        .name,

    /**
     * The same table, entered from plural OPERANDS instead of a caller value.
     *
     * The expression evaluator has already converted its operand by the time it needs an ordinal
     * category (`position == ORDINALITY_TWO`), so re-deriving operands from a value would be both
     * wasteful and lossy — a `pluralOperands` carrier's explicit visible places would be lost.
     *
     * @param {import("../internal/plural.js").Operands} operands
     * @param {string} locale
     * @returns {string} the bare CLDR category (`"two"`)
     */
    ordinalCategoryForOperands: (operands, locale) => {
      const index = ordinalGroupIndexFor(locale);

      if (index < 0) throw new UnsupportedLocaleError(jdkLanguageTag(locale));

      return ORDINAL_TABLE.countFor(index, operands);
    },

    /**
     * The third capability, and the one `parseStrings` needs: which ordinal forms a locale can
     * produce, as strings-file names, in `Ordinality` declaration order.
     *
     * `LocalizedStringLoader.warnOnIncompleteOrdinalityTranslations` calls
     * `Ordinality.supportedOrdinalitiesForLocale` directly because Java's loader has the whole
     * library on its classpath. The JS parser is in the ROOT graph and this module deliberately is
     * not, so the probe travels with the caller's `pluralData` exactly as the two classifiers above
     * do. A parse without it reports no ordinality gaps rather than importing the table.
     *
     * @param {string} locale
     * @returns {readonly string[]}
     */
    supportedOrdinalityNamesFor: (locale) =>
      supportedOrdinalitiesForLocale(locale).map((ordinality) => ordinality.name),
  }),
});

/** The undetermined group's index, resolved once. */
const UNDETERMINED_INDEX = ORDINAL_TABLE.indexForLocale(UNDETERMINED_TAG);

/**
 * `CldrPluralRules.ordinalRulesForLocale`, transcribed.
 *
 * A locale with no ordinal rules of its own still HAS ordinal rules if the cardinal table knows it:
 * the undetermined group, whose single unconditional rule is `other`. That is why `ru` reports
 * `[OTHER]` and is ordinally complete with a one-form catalog, while its cardinal answer is
 * four-way. Only a locale the cardinal table does not know is unsupported here.
 *
 * @param {string} localeTag
 * @returns {number} the resolved ordinal rule-group index, or -1 when the locale is unsupported
 */
function ordinalGroupIndexFor(localeTag) {
  const index = ORDINAL_TABLE.indexForLocale(localeTag);
  if (index >= 0) return index;
  return hasCardinalRulesForLocale(localeTag) ? UNDETERMINED_INDEX : -1;
}

/**
 * @param {string} count
 * @returns {OrdinalityValue}
 */
function ordinalityForCount(count) {
  const ordinality = /** @type {Record<string, OrdinalityValue | undefined>} */ (ORDINALITY_BY_COUNT)[count];
  if (ordinality === undefined) throw new RangeError(`Unsupported CLDR ordinal category '${count}'`);
  return ordinality;
}

/**
 * The CLDR ordinal category for a value under a locale — `Ordinality.forNumber`.
 *
 * Negative values are classified by their absolute value, and the visible form of the number is part
 * of the question: `decimal("1.0")` is not `1`. A locale with no CLDR plural rules at all throws
 * rather than quietly reporting `ORDINALITY_OTHER`.
 *
 * @param {number | bigint | Readonly<{ $lokalized: string, value: string }>} value
 * @param {string} locale
 * @returns {OrdinalityValue}
 */
export function ordinalityForNumber(value, locale) {
  // The VALUE is converted first, and deliberately: `Ordinality.forNumber` is
  // `forOperands(PluralOperands.forNumber(number).build(), locale)`, so Java builds the operands
  // before the locale is ever looked at and an unusable value out-throws an unusable locale. The
  // root's `cardinalityForNumber` has the same order; the two axes must not disagree about which
  // of two bad arguments a caller hears about.
  const operands = operandsForPluralValue(value);
  const index = ordinalGroupIndexFor(locale);

  // `UnsupportedLocaleException(locale)` reports `locale.toLanguageTag()`, not the raw input.
  if (index < 0) throw new UnsupportedLocaleError(jdkLanguageTag(locale));

  return ordinalityForCount(ORDINAL_TABLE.countFor(index, operands));
}

/**
 * The CLDR ordinal category for explicit plural operands — `Ordinality.forOperands`.
 *
 * This is the route for a displayed number carrying detail the value alone does not: trailing zeros
 * (`v`/`w`) or a compact-decimal exponent (`c`/`e`), both of which are rule inputs in their own right.
 *
 * @param {Readonly<{ $lokalized: string, value: string }>} value
 * @param {string} locale
 * @returns {OrdinalityValue}
 */
export function ordinalityForOperands(value, locale) {
  return ordinalityForNumber(value, locale);
}

/**
 * The ordinalities a locale can produce — `Ordinality.supportedOrdinalitiesForLocale`.
 *
 * In `Ordinality` declaration order, deduplicated, frozen. A well-formed but unsupported locale
 * yields an EMPTY array rather than throwing; only a malformed tag is an error. `ordinalityForNumber`
 * throws for that same locale, and the difference is Java's.
 *
 * @param {string} locale
 * @returns {readonly OrdinalityValue[]}
 */
export function supportedOrdinalitiesForLocale(locale) {
  const index = ordinalGroupIndexFor(locale);
  if (index < 0) return NO_ORDINALITIES;

  const group = ORDINAL_GROUPS[index];
  if (group === undefined) throw new RangeError(`Unknown ordinal rule group ${index}`);

  const present = new Set(group.rules.map((rule) => rule.count));
  return freeze(ORDINALITY_ORDER.filter((count) => present.has(count)).map(ordinalityForCount));
}

/** @type {readonly string[]} */
const SUPPORTED_LOCALE_TAGS = freeze(
  [...new Set([...cardinalRuleLocaleTags(), ...ORDINAL_GROUPS.flatMap((group) => group.locales)])].sort(),
);

/**
 * `Ordinality.getSupportedLocaleTags`: the union of the tags the generated CARDINAL and ORDINAL
 * tables represent directly, in natural string order.
 *
 * The cardinal tags belong here because of the undetermined-group fallback — every locale the
 * cardinal table knows is answerable for ordinals too. This is not the exhaustive set of tags
 * accepted: `en-GB` is supported through fallback and is not listed. Java's `remove("root")` /
 * `add("und")` has no work left to do, because the generator already spells that group `und`.
 *
 * @returns {readonly string[]}
 */
export function getSupportedOrdinalityLocaleTags() {
  return SUPPORTED_LOCALE_TAGS;
}
