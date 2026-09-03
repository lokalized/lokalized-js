// @ts-check

/**
 * `lokalized/data/ranges` — optional cardinal-range data and the range classifier.
 *
 * CLDR's plural ranges are not a rule language. `pluralRanges.xml` states, for each locale group, the
 * cardinality of a range like "1–2 books" as a table indexed by the ORDERED pair of the endpoints'
 * own cardinalities. So this module is a lookup, and everything interesting about it is what happens
 * when the lookup misses. lokalized-java's `CldrPluralRules.cardinalityForRange` pins three distinct
 * behaviours, and they are deliberately not the same:
 *
 *   1. The locale has no CLDR CARDINAL rules at all — `UnsupportedLocaleError`. Note that the probe
 *      is the cardinal rule table, not the range table: a locale is "supported" for ranges exactly
 *      when it is supported for cardinals.
 *   2. The locale has cardinal rules but no range group — the result is `end`. CLDR states ranges
 *      for 91 of the 224 cardinal locales; the rest (`asa`, `bem`, `chr`, …, and `und`) simply have
 *      nothing said about their ranges, and the end cardinality is the documented fallback. `mo` is
 *      the one tag that looks like this and is not: it canonicalizes to `ro` and reaches `ro`'s
 *      group, because range lookup canonicalizes exactly as cardinal rule lookup does.
 *   3. The locale has a range group but the group has no row for this (start, end) pair — again the
 *      result is `end`, reached by a different path (an empty map versus a present map that misses).
 *
 * Cases 2 and 3 agree on the answer and disagree on how they get there; case 1 differs from both.
 *
 * Locale resolution is NOT reimplemented here. `../internal/plural.js` owns the one canonicalizing
 * candidate walk this library has (`CldrPluralRules.localeCandidates`), and exposes it as
 * `createRuleTable`; the range table is built by that factory over the range groups, so `pt-PT`
 * inheriting `pt` and `mo` asking `ro` are the same code that answers `cardinalityForNumber`, not a
 * transcription of it that can drift. The support probe is likewise the root's own
 * `hasCardinalRulesForLocale`.
 *
 * Endpoints are the tagged `CARDINALITY_*` constants (plan section 3.7: "Cardinality-range endpoints
 * also accept explicit `CARDINALITY_*` values"). A bare `"one"` is rejected — in this library a
 * string is always text, never a language form — but a structurally equivalent record that has been
 * through JSON, a worker, or `structuredClone` is accepted, and the value returned is always the
 * canonical frozen constant from the root, so `===` holds against the exported constants.
 *
 * This module is OUTSIDE the root graph: `src/index.js` must never reach `./cardinal-ranges.js`.
 * The dependency runs the other way — importing the root from here is what keeps the returned
 * constants identical to the ones the root exports.
 */

import {
  CARDINALITY_ZERO,
  CARDINALITY_ONE,
  CARDINALITY_TWO,
  CARDINALITY_FEW,
  CARDINALITY_MANY,
  CARDINALITY_OTHER,
} from "../index.js";
import { jdkLanguageTag } from "../internal/locale-jdk-tag.js";
import {
  PLURAL_DATA_RUNTIME,
  UnsupportedLocaleError,
  cardinalRuleLocaleTags,
  createRuleTable,
  hasCardinalRulesForLocale,
} from "../internal/plural.js";
import { decode as decodeCardinalRanges } from "./cardinal-ranges.js";
import { decode as decodeProvenance } from "./provenance.js";

const freeze = Object.freeze;

/** @typedef {Readonly<{ $lokalized: "language-form", axis: string, name: string, renderName: string }>} CardinalityValue */

/**
 * The library-owned failure for a module that cannot be paired with the root it was loaded beside.
 *
 * Plan section 3.7 calls this a construction-time `ConfigurationError`. The public catch-only error
 * hierarchy (`LokalizedError` and friends, each carrying `code`) is core's to land; until it does,
 * this carries the same `code` so the eventual swap is invisible to a consumer that checks it. It is
 * spelled the same way in `lokalized/data/ordinal`, which is deliberate: the two optional modules
 * fail identically, and neither may add bytes to the root graph to share six lines.
 *
 * @param {string} message
 * @returns {Error}
 */
function configurationError(message) {
  const error = /** @type {Error & { code: string }} */ (new Error(message));
  error.name = "ConfigurationError";
  error.code = "CONFIGURATION";
  return error;
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/** `Cardinality`'s declaration order, which is also the order the generated table's rows name. */
const CATEGORY_ORDER = /** @type {const} */ (["zero", "one", "two", "few", "many", "other"]);
const CATEGORY_COUNT = CATEGORY_ORDER.length;

/**
 * CLDR count keyword to the root's own frozen constant, paired explicitly.
 *
 * Written out rather than derived from the constant's name: plan section 3.7 forbids deriving one
 * half of a language form from the other half's spelling, and an explicit table is also what makes
 * the load-time check below meaningful.
 */
const CARDINALITY_BY_CATEGORY = freeze({
  zero: CARDINALITY_ZERO,
  one: CARDINALITY_ONE,
  two: CARDINALITY_TWO,
  few: CARDINALITY_FEW,
  many: CARDINALITY_MANY,
  other: CARDINALITY_OTHER,
});

/**
 * The six constants by category index, and the two lookups that reach it.
 *
 * A category is carried as its index in `CATEGORY_ORDER` from here on, so a range row is a pair of
 * small integers and a group's table is 36 bytes rather than 36 string keys.
 *
 * @type {CardinalityValue[]}
 */
const VALUE_BY_INDEX = [];
/** @type {Map<string, number>} category name (`"one"`) to index, for reading the generated table */
const INDEX_BY_CATEGORY = new Map();
/** @type {Map<string, number>} language-form name (`"CARDINALITY_ONE"`) to index, for a caller's endpoint */
const INDEX_BY_FORM_NAME = new Map();

for (let index = 0; index < CATEGORY_COUNT; index++) {
  const category = CATEGORY_ORDER[index];
  const value = category === undefined ? undefined : CARDINALITY_BY_CATEGORY[category];

  // The root types these `CardinalityValue | undefined`, because it destructures them out of a
  // `Record<string, …>` and `noUncheckedIndexedAccess` widens every such read. The guard is
  // therefore a type obligation rather than a real possibility — but it is also the one place this
  // module trusts the root's shape, so it is checked rather than cast away.
  if (category === undefined || value === undefined || value.axis !== "cardinality")
    throw configurationError("lokalized/data/ranges: the root did not export the six CARDINALITY_* constants");

  VALUE_BY_INDEX.push(value);
  INDEX_BY_CATEGORY.set(category, index);
  INDEX_BY_FORM_NAME.set(value.name, index);
}

/**
 * @param {number} index
 * @returns {CardinalityValue}
 */
function valueAt(index) {
  const value = VALUE_BY_INDEX[index];
  if (value === undefined) throw new RangeError(`Unknown CLDR plural category index ${index}`);
  return value;
}

/**
 * Canonicalizes one range endpoint to its category index.
 *
 * Recognition is structural rather than by identity, so a constant that has crossed a realm, a
 * worker boundary or a JSON round trip still works; the axis is checked, so an `ORDINALITY_*` value
 * is rejected rather than silently read as its cardinal namesake.
 *
 * @param {unknown} value
 * @param {"start"|"end"} parameter
 * @returns {number}
 */
function endpointIndex(value, parameter) {
  if (value !== null && typeof value === "object") {
    const tagged = /** @type {{ $lokalized?: unknown, axis?: unknown, name?: unknown }} */ (value);

    if (tagged.$lokalized === "language-form" && tagged.axis === "cardinality" && typeof tagged.name === "string") {
      const index = INDEX_BY_FORM_NAME.get(tagged.name);
      if (index !== undefined) return index;
    }
  }

  throw new TypeError(
    `cardinalityForRange() requires a CARDINALITY_* value for '${parameter}'; received ${describe(value)}`,
  );
}

/**
 * A short, always-safe rendering of a rejected value for the error message. `JSON.stringify` alone
 * would throw on a bigint or a cyclic object, turning a clear diagnostic into a confusing one.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);

  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    // Cyclic or otherwise unserializable; the constructor name is enough.
  }

  return Object.prototype.toString.call(value);
}

/* -------------------------------------------------------------------------- */
/* The pinned table, validated at construction                                */
/* -------------------------------------------------------------------------- */

const RANGE_GROUPS = decodeCardinalRanges();
const PROVENANCE = freeze({ ...decodeProvenance() });

/** No row: the pair falls through to the end cardinality. */
const NO_ROW = -1;

/**
 * Compiles every group's rows into a 36-entry table indexed by `start * 6 + end`, validating the
 * pinned data on the way through.
 *
 * The validation is not decoration. `lokalized/data/ranges` is separately installable and separately
 * bundled (plan 6.3 ships `dist/browser/data/ranges.js` as its own file), so the pairing that can go
 * wrong is a range module built from one pinned CLDR release loaded beside a root built from
 * another — and the failure mode without a check is a wrong answer months later rather than a loud
 * one at import. Plan 3.7 requires the loud one: a construction-time `ConfigurationError`.
 *
 * Three independent things are checked, and each of them can actually fail:
 *
 *   - the provenance record must have the shape a generated record has, so a hand-edited or
 *     truncated `./provenance.js` is rejected rather than silently believed;
 *   - the table must be a well-formed range table — groups with locales, rows naming real CLDR
 *     categories, no locale claimed by two groups, no ordered pair stated twice; and
 *   - every locale this table represents must also be represented by the ROOT's cardinal table.
 *     That is the cross-graph comparison, and it is the invariant `cardinalityForRange` depends on:
 *     the throw is keyed on cardinal support, so a range locale the root has never heard of would
 *     be a group that can never be reached.
 *
 * @param {Readonly<{ cldrVersion?: unknown, dataFingerprint?: unknown }>} provenance
 * @param {{ locales: string[], ranges: { start: string, end: string, result: string }[] }[]} groups
 * @returns {Int8Array[]} one 36-entry row table per group
 */
function compileValidatedGroups(provenance, groups) {
  if (typeof provenance.cldrVersion !== "string" || !/^\d+(?:\.\d+)*$/.test(provenance.cldrVersion))
    throw configurationError(
      `lokalized/data/ranges: pinned CLDR version '${String(provenance.cldrVersion)}' is not a CLDR version`,
    );

  if (typeof provenance.dataFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(provenance.dataFingerprint))
    throw configurationError("lokalized/data/ranges: pinned data fingerprint is not a SHA-256 digest");

  if (groups.length === 0) throw configurationError("lokalized/data/ranges: the cardinal range table is empty");

  const cardinalTags = new Set(cardinalRuleLocaleTags());
  /** @type {Map<string, number>} */
  const claimedBy = new Map();
  /** @type {Int8Array[]} */
  const compiled = [];

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (group === undefined) throw configurationError(`lokalized/data/ranges: range group ${index} is missing`);

    const where = `range group [${group.locales.join(", ")}]`;

    if (group.locales.length === 0) throw configurationError(`lokalized/data/ranges: range group ${index} has no locales`);
    if (group.ranges.length === 0) throw configurationError(`lokalized/data/ranges: ${where} has no rows`);

    for (const locale of group.locales) {
      const claimant = claimedBy.get(locale);
      if (claimant !== undefined)
        throw configurationError(`lokalized/data/ranges: '${locale}' is claimed by range groups ${claimant} and ${index}`);
      claimedBy.set(locale, index);

      if (!cardinalTags.has(locale))
        throw configurationError(
          `lokalized/data/ranges: CLDR ${provenance.cldrVersion} range data does not pair with this root's ` +
            `cardinal data; it carries locale '${locale}', which the root does not know`,
        );
    }

    const rows = new Int8Array(CATEGORY_COUNT * CATEGORY_COUNT).fill(NO_ROW);

    for (const row of group.ranges) {
      const start = INDEX_BY_CATEGORY.get(row.start);
      const end = INDEX_BY_CATEGORY.get(row.end);
      const result = INDEX_BY_CATEGORY.get(row.result);

      if (start === undefined || end === undefined || result === undefined)
        throw configurationError(
          `lokalized/data/ranges: ${where} states '${row.start}'..'${row.end}' -> '${row.result}', ` +
            "which is not a CLDR plural category",
        );

      const slot = start * CATEGORY_COUNT + end;
      if (rows[slot] !== NO_ROW)
        throw configurationError(`lokalized/data/ranges: ${where} states '${row.start}'..'${row.end}' twice`);

      rows[slot] = result;
    }

    compiled.push(rows);
  }

  return compiled;
}

const ROWS_BY_GROUP = compileValidatedGroups(PROVENANCE, RANGE_GROUPS);

/**
 * The range table's locale index, built by the ROOT's own rule-table factory so range lookup walks
 * exactly the candidate chain cardinal lookup walks: JDK round trip, CLDR canonicalization
 * (`mo` asks `ro`), then `language-Script-REGION`, `language-Script`, `language-REGION`, `language`,
 * with the undetermined group spelled `und`. Only `indexForLocale` is used — a range group has no
 * rules to evaluate, and none are supplied.
 */
const RANGE_TABLE = createRuleTable(RANGE_GROUPS.map((group) => ({ locales: group.locales, rules: [] })));

/* -------------------------------------------------------------------------- */
/* Data carrier                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The provenance of the pinned CLDR cardinal-range data, carried so an application that opts into
 * this module can prove which generated data it linked, and so `createStrings` can compare it
 * against the rendering core's own constants.
 *
 * The generator emits the two fields the canonical data lock exposes to the optional modules; plan
 * section 3.2's fuller `DataProvenance` (`formatVersion`, `generatorVersion`, `inputsSha256`) is a
 * generator gap shared with `lokalized/data/ordinal` and is reported rather than papered over here.
 *
 * @type {Readonly<{ $lokalized: "cardinal-range-data", provenance: Readonly<{ cldrVersion: string, dataFingerprint: string }> }>}
 */
export const cardinalRangeData = freeze({
  $lokalized: /** @type {const} */ ("cardinal-range-data"),
  provenance: PROVENANCE,

  // See `PLURAL_DATA_RUNTIME`: the range classifier travels on the carrier because the root graph
  // must not reach this module's table. Endpoints and result are language-form NAMES so the
  // renderer, which keys `translations` by name, needs no edge to the constants either.
  [PLURAL_DATA_RUNTIME]: freeze({
    /**
     * @param {string} startName
     * @param {string} endName
     * @param {string} locale
     * @returns {string}
     */
    rangeCardinalityNameFor: (startName, endName, locale) =>
      cardinalityForRange(cardinalityNamed(startName), cardinalityNamed(endName), locale).name,
  }),
});

/**
 * The root's frozen `CARDINALITY_*` constant with this name.
 *
 * @param {string} name
 * @returns {CardinalityValue}
 */
function cardinalityNamed(name) {
  const index = INDEX_BY_FORM_NAME.get(name);

  if (index === undefined) throw new RangeError(`Unknown cardinality '${name}'`);

  return valueAt(index);
}

/* -------------------------------------------------------------------------- */
/* Public classifier                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The CLDR cardinality of a range whose endpoints have the given cardinalities.
 *
 * For "1–2 books" in English you pass the cardinality of `1` and the cardinality of `2`; the answer
 * is the cardinality the whole range takes, which is what a translation's `CARDINALITY_*` branch
 * must be selected on. The endpoints are cardinalities, not numbers, because CLDR states the table
 * that way — every value that classifies as `one` behaves identically as a range endpoint. The end's
 * own cardinality does not decide the range's: English `0–1` is `one`..`one` and yet `other`.
 *
 * When CLDR states nothing about the pair — either the locale has no range data at all, or its group
 * has no row for this ordered pair — the range takes the cardinality of its END, which is CLDR's
 * documented default. A locale with no cardinal rules at all throws instead: an unsupported locale
 * is a caller error, not a range whose answer happens to be the end.
 *
 * @param {CardinalityValue} start the cardinality of the range's start value
 * @param {CardinalityValue} end the cardinality of the range's end value
 * @param {string} locale a BCP 47 locale tag. An ill-formed tag is not an error here any more than
 *   it is in `Locale.forLanguageTag`: it resolves to the undetermined locale, exactly as it does for
 *   `cardinalityForNumber`, and only a non-string is rejected outright.
 * @returns {CardinalityValue} one of the root's frozen `CARDINALITY_*` constants
 * @throws {TypeError} if an endpoint is not a `CARDINALITY_*` value, or the locale is not a string
 * @throws {UnsupportedLocaleError} if the locale has no CLDR cardinal rules
 */
export function cardinalityForRange(start, end, locale) {
  const startIndex = endpointIndex(start, "start");
  const endIndex = endpointIndex(end, "end");

  // Java gates on the CARDINAL table before it ever looks at the range table, and it does so whatever
  // the endpoints are: `if (!cardinalRulesForLocale(locale).isPresent()) throw ...`. An unsupported
  // locale must throw even for a pair that would have fallen through to the end.
  // `UnsupportedLocaleException(locale)` reports `locale.toLanguageTag()`, not the raw input.
  if (!hasCardinalRulesForLocale(locale)) throw new UnsupportedLocaleError(jdkLanguageTag(locale));

  const groupIndex = RANGE_TABLE.indexForLocale(locale);
  if (groupIndex < 0) return valueAt(endIndex);

  const rows = ROWS_BY_GROUP[groupIndex];
  if (rows === undefined) throw new RangeError(`Unknown cardinal range group ${groupIndex}`);

  const result = rows[startIndex * CATEGORY_COUNT + endIndex];

  return result === undefined || result === NO_ROW ? valueAt(endIndex) : valueAt(result);
}
