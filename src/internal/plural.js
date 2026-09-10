// @ts-check

/**
 * Exact CLDR plural operands and plural-rule evaluation.
 *
 * Everything here is exact: values are carried as a `bigint` unscaled value plus a decimal scale,
 * which is the same representation Java's `BigDecimal` uses, so `10n ** 20n` classifies correctly
 * and `1` / `1.0` / `1.00` stay three different values with three different operand sets.
 * No floating-point arithmetic is performed on a value at any point.
 *
 * `../data/cardinal.js` carries CLDR rule conditions as source text (`n % 10 = 1 and n % 100 != 11`),
 * so this module contains a small recursive-descent-free parser for that grammar. There is no `eval`
 * and no `new Function`; conditions compile to closures over parsed literals.
 *
 * The shape of the grammar and the arithmetic mirror lokalized-java 3.0.0's `CldrPluralRules` and
 * `PluralOperands`, including the quirks that the corpus pins:
 *
 * - `and` binds tighter than `or`, and there is no grouping syntax.
 * - A range or set membership test only admits a value with a fractional part when the entry is a
 *   single exact literal — `n = 1..3` is false for `n = 1.5`, but `n = 1` is true for `n = 1.0`.
 * - The compact exponent shifts the displayed mantissa right BEFORE n/i/v/w/f/t are derived, while
 *   `c` and `e` are themselves the exponent and are rule inputs in their own right.
 * - Rule lookup canonicalizes the requested tag — JDK round trip first, then the CLDR alias tables —
 *   which the CATALOG LOADER deliberately does not. `mo` stays `mo` when a catalog is loaded, but
 *   asks `ro` for its plural rules.
 */

import { decode as decodeCardinalRules } from "../data/cardinal.js";
import { canonicalLanguageTag, hasUndeterminedLanguage } from "./locale-cldr.js";
import { jdkLanguageTag, parseJdkTag } from "./locale-jdk-tag.js";

/**
 * CLDR plural operands.
 *
 * `n` is the absolute value of the (already exponent-shifted) number rendered in plain notation with
 * exactly `v` fraction digits, so it round-trips both the value and its visible scale. `i`, `f` and
 * `t` are exact non-negative integers rendered as digit strings.
 *
 * @typedef {Object} Operands
 * @property {string} n absolute value, plain notation, trailing zeros preserved
 * @property {string} i integer digits
 * @property {number} v count of visible fraction digits
 * @property {number} w count of visible fraction digits without trailing zeros
 * @property {string} f visible fraction digits as an integer
 * @property {string} t visible fraction digits without trailing zeros, as an integer
 * @property {number} c compact decimal exponent
 * @property {number} e compact decimal exponent (the same value as `c`)
 */

/**
 * @typedef {Object} OperandsOptions
 * @property {number} [visibleDecimalPlaces] explicit visible fraction digit count; never rounds
 * @property {number} [compactExponent] compact decimal exponent, non-negative
 */

/** @typedef {"zero"|"one"|"two"|"few"|"many"|"other"} CardinalCategory */

/**
 * The hidden key under which an OPTIONAL plural-data carrier hangs the classifier core needs.
 *
 * `lokalized/data/ordinal` and `lokalized/data/ranges` are outside the root graph on purpose — the
 * root must never reach their tables — so `createStrings` cannot import their classifiers. Plan
 * section 3.2 has the consumer hand the data over instead (`pluralData: { ordinal: ordinalData }`),
 * and section 3.2's `OrdinalData`/`CardinalRangeData` are declared as provenance carriers alone. The
 * capability therefore travels on the carrier under a key that is not part of the published shape: a
 * symbol is invisible to `Object.keys`, `JSON.stringify`, and the generated declarations, so the
 * public type stays exactly what the plan says it is.
 *
 * `Symbol.for` rather than `Symbol()` deliberately. An application may legitimately install a
 * separate copy of the optional module — that is precisely the case the provenance comparison in
 * those modules exists to catch — and two copies of this file would mint two unequal private
 * symbols, making a perfectly compatible module unreadable. The registry key is versioned so a
 * future incompatible capability shape cannot be silently accepted.
 */
export const PLURAL_DATA_RUNTIME = Symbol.for("lokalized.plural-data-runtime.v1");

/**
 * Thrown when no CLDR cardinal rules exist for the requested locale, and — with a `role` — when an
 * inspection argument names a locale the instance does not support.
 *
 * `role` NAMES WHICH ARGUMENT, and it exists because the omission was a measured loss rather than a
 * style question. `DefaultStrings.java` refuses the two `getMissingKeys` arguments with DIFFERENT
 * sentences, `Source locale '%s' is not supported` (`:2738`) and `Target locale '%s' is not
 * supported` (`:2741`); the port answered one sentence to both, so a caller who passed two tags was
 * told only that one of them was wrong. `tools/lookup-diff/run.mjs` had recorded exactly that as "a
 * known loss ... worth a maintainer's attention on its own", and its rule could only compare the
 * QUOTED LOCALE, which discriminates the role by proxy and absorbs a role swap outright on the one
 * row where both arguments name the same tag.
 *
 * The role is OPTIONAL and absent by default, which keeps the sentence byte-identical at the three
 * plural-data sites (`plural.js:1092`, `data/ordinal.js:230`/`:304`, `data/ranges.js:390`) and at
 * `getKeysForLocale`, whose Java counterpart (`:2718`) likewise names no role because it has only
 * one argument to name. So this widens the diagnostic exactly where Java's is wider and nowhere
 * else.
 *
 * The sentence stays the port's own rather than becoming Java's: plan 3.3:771 names
 * `UnsupportedLocaleError` and its wording for this surface, and that is a recorded maintainer
 * decision (M7 decision 3) — what was owed here is the ROLE, not Java's spelling of it.
 */
export class UnsupportedLocaleError extends Error {
  /**
   * @param {string} localeTag
   * @param {"source" | "target"} [role] which argument the tag came from, when the caller passed more
   *   than one and the sentence would otherwise be ambiguous
   */
  constructor(localeTag, role) {
    super(
      role === undefined
        ? `Unsupported locale '${localeTag}' was provided`
        : `Unsupported ${role} locale '${localeTag}' was provided`,
    );
    this.name = "UnsupportedLocaleError";
    /** @type {string} */
    this.localeTag = localeTag;
    /** @type {"source" | "target" | undefined} */
    this.role = role;
  }
}

// Limits mirrored from lokalized-java's TranslationRuntimeLimits.defaults() and PluralOperands.
const MAXIMUM_NUMBER_PRECISION = 1024;
const MAXIMUM_ABSOLUTE_NUMBER_SCALE = 1024;
const MAXIMUM_VISIBLE_DECIMAL_PLACES = 1024;
const MAXIMUM_COMPACT_EXPONENT = 64;
const MAXIMUM_MATERIALIZED_PRECISION = 12288;

/* -------------------------------------------------------------------------- */
/* Exact decimals                                                             */
/* -------------------------------------------------------------------------- */

/**
 * An exact decimal: `u / 10 ** s`. A negative `s` is legal and means trailing implicit zeros, which
 * is how `BigDecimal.stripTrailingZeros()` represents `100`.
 *
 * @typedef {{ u: bigint, s: number }} Decimal
 */

/** @type {bigint[]} */
const POWERS_OF_TEN = [1n];

/**
 * @param {number} exponent non-negative
 * @returns {bigint}
 */
function pow10(exponent) {
  if (exponent < 0) throw new RangeError(`Negative power of ten: ${exponent}`);
  for (let index = POWERS_OF_TEN.length; index <= exponent; index++) {
    const previous = POWERS_OF_TEN[index - 1];
    if (previous === undefined) throw new RangeError("Power of ten cache is corrupt");
    POWERS_OF_TEN[index] = previous * 10n;
  }
  const power = POWERS_OF_TEN[exponent];
  if (power === undefined) throw new RangeError(`Unavailable power of ten: ${exponent}`);
  return power;
}

/**
 * @param {bigint} value
 * @returns {bigint}
 */
function absBigInt(value) {
  return value < 0n ? -value : value;
}

/**
 * Number of significant decimal digits, matching `BigDecimal.precision()` (zero has precision one).
 *
 * @param {bigint} unscaled
 * @returns {number}
 */
function digitCount(unscaled) {
  const digits = absBigInt(unscaled).toString();
  return digits.length;
}

const DECIMAL_TEXT = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

/**
 * Parses decimal text the way `new BigDecimal(String)` does: the scale is the number of fraction
 * digits written, less any exponent. Trailing zeros are significant.
 *
 * @param {string} text
 * @returns {Decimal}
 */
function parseDecimalText(text) {
  if (typeof text !== "string") throw new TypeError("Decimal text must be a string");
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) throw new RangeError(`Invalid decimal text '${text}'`);

  const sign = match[1] === "-" ? -1n : 1n;
  const integerDigits = match[2] ?? "";
  const fractionDigits = match[3] ?? match[4] ?? "";
  const exponentText = match[5];

  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isSafeInteger(exponent)) throw new RangeError(`Invalid decimal exponent in '${text}'`);

  const digits = `${integerDigits}${fractionDigits}`;
  if (digits.length === 0) throw new RangeError(`Invalid decimal text '${text}'`);

  const scale = fractionDigits.length - exponent;
  if (!Number.isSafeInteger(scale)) throw new RangeError(`Invalid decimal scale in '${text}'`);

  return { u: sign * BigInt(digits), s: scale };
}

/**
 * Renders a decimal in plain (never scientific) notation.
 *
 * @param {Decimal} value
 * @returns {string}
 */
function plainString(value) {
  const negative = value.u < 0n;
  const digits = absBigInt(value.u).toString();
  let body;

  if (value.s <= 0) {
    body = digits === "0" ? "0" : `${digits}${"0".repeat(-value.s)}`;
  } else {
    const padded = digits.padStart(value.s + 1, "0");
    body = `${padded.slice(0, padded.length - value.s)}.${padded.slice(padded.length - value.s)}`;
  }

  return negative ? `-${body}` : body;
}

/**
 * @param {Decimal} value
 * @returns {Decimal}
 */
function absDecimal(value) {
  return value.u < 0n ? { u: -value.u, s: value.s } : value;
}

/**
 * `BigDecimal.stripTrailingZeros()`. Zero normalizes to scale zero, as it has since Java 8.
 *
 * @param {Decimal} value
 * @returns {Decimal}
 */
function stripTrailingZeros(value) {
  if (value.u === 0n) return { u: 0n, s: 0 };
  let unscaled = value.u;
  let scale = value.s;
  while (unscaled % 10n === 0n) {
    unscaled /= 10n;
    scale -= 1;
  }
  return { u: unscaled, s: scale };
}

/**
 * `BigDecimal.setScale(scale, RoundingMode.UNNECESSARY)`.
 *
 * @param {Decimal} value
 * @param {number} scale
 * @returns {Decimal}
 */
function setScale(value, scale) {
  const difference = scale - value.s;
  if (difference === 0) return value;
  if (difference > 0) return { u: value.u * pow10(difference), s: scale };
  const divisor = pow10(-difference);
  if (value.u % divisor !== 0n) throw new RangeError("Rounding necessary");
  return { u: value.u / divisor, s: scale };
}

/**
 * `BigDecimal.movePointRight(n)`: the scale drops by `n` and is clamped at zero by materializing the
 * shortfall into the unscaled value.
 *
 * @param {Decimal} value
 * @param {number} places non-negative
 * @returns {Decimal}
 */
function movePointRight(value, places) {
  const scale = value.s - places;
  if (scale < 0) return { u: value.u * pow10(-scale), s: 0 };
  return { u: value.u, s: scale };
}

/**
 * @param {Decimal} left
 * @param {Decimal} right
 * @returns {number} -1, 0 or 1
 */
function compareDecimals(left, right) {
  const scale = Math.max(left.s, right.s);
  const leftUnscaled = left.u * pow10(scale - left.s);
  const rightUnscaled = right.u * pow10(scale - right.s);
  if (leftUnscaled < rightUnscaled) return -1;
  if (leftUnscaled > rightUnscaled) return 1;
  return 0;
}

/**
 * `BigDecimal.remainder(BigDecimal)` for an integral divisor: truncated division, so the sign
 * follows the dividend and the scale is preserved.
 *
 * @param {Decimal} value
 * @param {bigint} modulus positive
 * @returns {Decimal}
 */
function remainderDecimal(value, modulus) {
  if (modulus === 0n) throw new RangeError("Modulus must be non-zero");
  // A negative scale is normalized first so the divisor stays aligned with the unscaled value.
  if (value.s < 0) return { u: (value.u * pow10(-value.s)) % modulus, s: 0 };
  return { u: value.u % (modulus * pow10(value.s)), s: value.s };
}

/**
 * `value.stripTrailingZeros().scale() <= 0` — whether the value has no fractional part.
 *
 * @param {Decimal} value
 * @returns {boolean}
 */
function isIntegerValued(value) {
  if (value.s <= 0) return true;
  return value.u % pow10(value.s) === 0n;
}

/* -------------------------------------------------------------------------- */
/* Operand construction                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {unknown} value
 * @param {string} description
 * @param {number} maximum
 * @returns {number|null}
 */
function validateOptionalLimit(value, description, maximum) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new TypeError(`${description} must be an integer, but was ${String(value)}`);
  if (value < 0) throw new RangeError(`${description} must be non-negative, but was ${value}`);
  if (value > maximum) throw new RangeError(`${description} ${value} exceeds the maximum of ${maximum}`);
  return value;
}

/**
 * @typedef {{ compactExponent: number, visibleDecimalPlaces: number|null }} OperandLimits
 */

/**
 * The first thing `PluralOperands.Builder.build()` does, before it touches the number at all. The
 * order matters: a non-finite double supplied alongside a rejected compact exponent reports the
 * exponent, because Java never gets as far as converting the number.
 *
 * EXPORTED so `pluralOperands()` can run it at VALUE CONSTRUCTION, which is where Java runs it.
 * `PluralOperands.Builder` seeds itself with `TranslationRuntimeLimits.defaults()` and nothing in
 * `Strings` reaches back into it, so an out-of-range option is refused while the caller is building
 * the value and never becomes a translation failure — `runtime-limits.ceilings.operand-builder-
 * still-rejects-visible-decimal-places-1025` records that refusal on an instance whose own ceiling
 * was raised to 4096, byte-identical to the defaults fixture. The limits here are the DEFAULTS on
 * purpose: threading an instance's limits into this call would resolve that case and diverge.
 *
 * @param {OperandsOptions} options
 * @returns {OperandLimits}
 */
export function validateOperandOptions(options) {
  return {
    compactExponent:
      validateOptionalLimit(options.compactExponent, "Compact exponent", MAXIMUM_COMPACT_EXPONENT) ?? 0,
    visibleDecimalPlaces: validateOptionalLimit(
      options.visibleDecimalPlaces,
      "Visible decimal places",
      MAXIMUM_VISIBLE_DECIMAL_PLACES,
    ),
  };
}

/**
 * The shared tail of both public constructors: it is a transcription of lokalized-java's
 * `PluralOperands.Builder.build()` followed by the `PluralOperands` constructor.
 *
 * @param {Decimal} value
 * @param {boolean} scaleIsExplicit true when the source carried its own visible scale (a decimal
 *   literal), false when the source was a plain number whose trailing zeros are not observable
 * @param {OperandLimits} limits already-validated options
 * @returns {Operands}
 */
function buildOperands(value, scaleIsExplicit, limits) {
  const compactExponent = limits.compactExponent;
  const visibleDecimalPlaces = limits.visibleDecimalPlaces;

  if (Math.abs(value.s) > MAXIMUM_ABSOLUTE_NUMBER_SCALE)
    throw new RangeError(
      `Number scale ${value.s} exceeds the maximum absolute scale of ${MAXIMUM_ABSOLUTE_NUMBER_SCALE}`,
    );

  const precision = digitCount(value.u);
  if (precision > MAXIMUM_NUMBER_PRECISION)
    throw new RangeError(`Number precision ${precision} exceeds the maximum of ${MAXIMUM_NUMBER_PRECISION}`);

  let number = absDecimal(value);
  let effectiveScale = number.s;
  let materializedPrecision = precision;

  if (visibleDecimalPlaces === null) {
    if (!scaleIsExplicit) {
      effectiveScale = Math.max(0, stripTrailingZeros(number).s);
      materializedPrecision += Math.max(0, effectiveScale - number.s);
    }
  } else {
    effectiveScale = visibleDecimalPlaces;
    materializedPrecision += Math.max(0, effectiveScale - number.s);
  }

  materializedPrecision += Math.max(0, compactExponent - effectiveScale);

  if (materializedPrecision > MAXIMUM_MATERIALIZED_PRECISION)
    throw new RangeError(
      `Plural operand materialized precision ${materializedPrecision} exceeds the maximum of ${MAXIMUM_MATERIALIZED_PRECISION}`,
    );

  if (!scaleIsExplicit || visibleDecimalPlaces !== null) number = setScale(number, effectiveScale);

  // The compact exponent shifts the mantissa BEFORE any operand is derived.
  const operandNumber = movePointRight(number, compactExponent);
  const stripped = stripTrailingZeros(operandNumber);

  const integerComponent = operandNumber.s > 0 ? operandNumber.u / pow10(operandNumber.s) : operandNumber.u;
  const fraction = operandNumber.s > 0 ? absBigInt(operandNumber.u % pow10(operandNumber.s)) : 0n;
  const strippedFraction = stripped.s > 0 ? absBigInt(stripped.u % pow10(stripped.s)) : 0n;

  return Object.freeze({
    n: plainString(operandNumber),
    i: integerComponent.toString(),
    v: operandNumber.s,
    w: Math.max(0, stripped.s),
    f: fraction.toString(),
    t: strippedFraction.toString(),
    c: compactExponent,
    e: compactExponent,
  });
}

/**
 * Operands for a JavaScript number or bigint.
 *
 * Neither carries an observable visible scale, so — exactly as lokalized-java treats a `Long`,
 * `BigInteger` or `Double` — trailing zeros are stripped and `v` is the number of fraction digits
 * the shortest exact decimal form needs, unless `visibleDecimalPlaces` says otherwise. A `number`
 * is converted through its shortest round-tripping decimal form; the arithmetic afterwards is exact.
 *
 * @param {number|bigint} value
 * @param {OperandsOptions} [options]
 * @returns {Operands}
 */
export function operandsFromNumber(value, options = {}) {
  // Java validates the builder's own arguments before it converts the number.
  const limits = validateOperandOptions(options);

  /** @type {Decimal} */
  let decimal;

  if (typeof value === "bigint") {
    decimal = { u: value, s: 0 };
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`Number must be finite, but was ${String(value)}`);
    decimal = decimalForDouble(value);
  } else {
    throw new TypeError(`Unsupported number type '${typeof value}'; provide a number or a bigint`);
  }

  return buildOperands(decimal, false, limits);
}

/**
 * Operands for decimal text, whose written scale IS the visible scale — `"1"`, `"1.0"` and `"1.00"`
 * produce three different operand sets. This is the `BigDecimal` path in lokalized-java.
 *
 * @param {string} text
 * @param {OperandsOptions} [options]
 * @returns {Operands}
 */
export function operandsFromDecimalText(text, options = {}) {
  // The decimal is parsed first: in Java the caller has already built the `BigDecimal` by the time
  // `build()` inspects the builder's options, so malformed text is reported ahead of a bad option.
  const value = parseDecimalText(text);
  return buildOperands(value, true, validateOperandOptions(options));
}

/**
 * Operands for any accepted public plural input, tagged or native.
 *
 * Shared by every classifier so that the cardinal, ordinal and range surfaces accept exactly the same
 * values and reject the rest with exactly the same message. Recognition of the tagged records is
 * structural, not by identity, so a value that has been through JSON, a worker, `structuredClone`, or
 * an RSC boundary still classifies.
 *
 * @param {unknown} value
 * @returns {Operands}
 */
export function operandsForPluralValue(value) {
  if (typeof value === "number" || typeof value === "bigint") return operandsFromNumber(value);
  if (value !== null && typeof value === "object") {
    const tagged = /** @type {{ $lokalized?: string, value?: string, visibleDecimalPlaces?: number, compactExponent?: number }} */ (value);
    if (tagged.$lokalized === "decimal" && typeof tagged.value === "string")
      return operandsFromDecimalText(tagged.value, {});
    if (tagged.$lokalized === "plural-operands" && typeof tagged.value === "string")
      return operandsFromDecimalText(tagged.value, {
        visibleDecimalPlaces: tagged.visibleDecimalPlaces,
        compactExponent: tagged.compactExponent,
      });
  }
  throw new TypeError("a plural value must be a number, a bigint, decimal(...), or pluralOperands(...)");
}

/* -------------------------------------------------------------------------- */
/* Java's Double.toString, implemented rather than assumed                    */
/* -------------------------------------------------------------------------- */

/**
 * lokalized-java converts a `Double` with `new BigDecimal(Double.toString(d)).stripTrailingZeros()`
 * (`NumberUtils.decimalForDouble`), so the plural value of a JS `number` is decided by JDK 21's
 * `Double.toString` — NOT by `Number.prototype.toString`. Plan section 3.7 requires that contract to
 * be implemented explicitly rather than assumed identical, and it is not identical:
 *
 * ECMA-262 renders the SHORTEST decimal that round-trips. JDK 21 does too, with one extra clause: if
 * the shortest length `p` is 1, the selected decimal is drawn from the decimals of length 1 OR 2,
 * whichever is closest to the value. For every normal double the two agree, because a one-digit
 * decimal only round-trips when it agrees with the value to ~16 digits. For eight denormals — the
 * ones whose ulp is a large fraction of their own magnitude — they do not:
 * `Double.MIN_VALUE` is `5e-324` in JavaScript and `4.9E-324` in Java, and those two decimals have
 * different plural operands (`v` 324 versus 325, `f` 5 versus 49) and therefore, in some locales,
 * different categories. `test/number-text.test.js` enumerates all eight and proves there are no
 * others anywhere in binary64.
 *
 * Everything below is exact: the double is decomposed into `m * 2 ** q` and every comparison is
 * `BigInt`. No decimal digit is ever re-derived from a float.
 */

const DOUBLE_BITS = new DataView(new ArrayBuffer(8));

/**
 * The exact value of a finite non-zero double as `m * 2 ** q` with integral `m` and `q`.
 *
 * @param {number} value positive and finite
 * @returns {{ m: bigint, q: number }}
 */
function decomposeDouble(value) {
  DOUBLE_BITS.setFloat64(0, value);
  const high = DOUBLE_BITS.getUint32(0);
  const low = DOUBLE_BITS.getUint32(4);
  const biasedExponent = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);

  // A zero biased exponent is subnormal: no implicit leading bit, and a fixed exponent.
  return biasedExponent === 0
    ? { m: fraction, q: -1074 }
    : { m: fraction | (1n << 52n), q: biasedExponent - 1075 };
}

/**
 * The decimal `Double.toString` selects for a finite positive double, as `digits * 10 ** exponent`
 * with `digits` carrying no trailing zero — the javadoc's `s` and `i`.
 *
 * @param {number} value positive and finite
 * @returns {{ digits: string, exponent: number }}
 */
function shortestRoundTripDecimal(value) {
  const { m, q } = decomposeDouble(value);
  const numerator = q >= 0 ? m << BigInt(q) : m;
  const denominator = q >= 0 ? 1n : 1n << BigInt(-q);

  // `pointPosition` is the javadoc's `e + 1`: 10 ** (pointPosition - 1) <= value < 10 ** pointPosition.
  // The float estimate only seeds the search; the loop settles it with exact comparisons.
  let pointPosition = Math.floor(Math.log10(value)) + 1;
  if (!Number.isFinite(pointPosition))
    pointPosition = numerator.toString().length - denominator.toString().length + 1;
  for (;;) {
    const atLeastLow =
      pointPosition - 1 >= 0
        ? numerator >= pow10(pointPosition - 1) * denominator
        : numerator * pow10(1 - pointPosition) >= denominator;
    const belowHigh =
      pointPosition >= 0
        ? numerator < pow10(pointPosition) * denominator
        : numerator * pow10(-pointPosition) < denominator;
    if (atLeastLow && belowHigh) break;
    pointPosition += atLeastLow ? 1 : -1;
  }

  // R, the set of decimals that round to this double: the half-ulp interval around it. The interval
  // is closed when the significand is even (round-half-to-even keeps it) and open when it is odd,
  // and its lower half is only half as wide when the double sits on a power-of-two boundary.
  const onPowerOfTwoBoundary = m === 1n << 52n && q > -1074;
  const shift = 2 - q;
  const boundaryDenominator = shift <= 0 ? 1n : 1n << BigInt(shift);
  const upperBound =
    shift <= 0 ? (2n * m + 1n) * (1n << BigInt(q - 1)) : (2n * m + 1n) * 2n;
  const lowerBound =
    shift <= 0
      ? (onPowerOfTwoBoundary ? (4n * m - 1n) * (1n << BigInt(q - 2)) : (2n * m - 1n) * (1n << BigInt(q - 1)))
      : (onPowerOfTwoBoundary ? 4n * m - 1n : (2n * m - 1n) * 2n);
  const closed = m % 2n === 0n;

  /** The value scaled so that a `length`-digit decimal is an integer: `value * 10 ** (length - e10)`. */
  const scaled = (/** @type {number} */ length) => {
    const power = length - pointPosition;
    return power >= 0
      ? { a: numerator * pow10(power), b: denominator }
      : { a: numerator, b: denominator * pow10(-power) };
  };

  /** Is `significand * 10 ** (pointPosition - length)` a member of R? */
  const roundsBack = (/** @type {bigint} */ significand, /** @type {number} */ length) => {
    if (significand <= 0n) return false;
    const power = pointPosition - length;
    const candidateNumerator = power >= 0 ? significand * pow10(power) : significand;
    const candidateDenominator = power >= 0 ? 1n : pow10(-power);
    const aboveLow = candidateNumerator * boundaryDenominator - lowerBound * candidateDenominator;
    const belowHigh = candidateNumerator * boundaryDenominator - upperBound * candidateDenominator;
    return (closed ? aboveLow >= 0n : aboveLow > 0n) && (closed ? belowHigh <= 0n : belowHigh < 0n);
  };

  /** The members of R on the `length`-significant-digit grid: the two grid points bracketing value. */
  const admissible = (/** @type {number} */ length) => {
    const { a, b } = scaled(length);
    const floor = a / b;
    return [floor, floor + 1n].filter((significand) => roundsBack(significand, length));
  };

  // A double needs at most 17 significant digits to round-trip.
  let minimalLength = 0;
  for (let length = 1; length <= 17; length++)
    if (admissible(length).length > 0) {
      minimalLength = length;
      break;
    }
  if (minimalLength === 0) throw new RangeError(`No round-tripping decimal for ${value}`);

  // The javadoc's T: length `p` when `p >= 2`, and length 1 OR 2 when `p` is 1 — which is the same
  // grid, since every one-digit decimal is also a point on the two-digit grid.
  const selectionLength = Math.max(minimalLength, 2);
  const candidates = admissible(selectionLength);
  const low = candidates[0];
  if (low === undefined) throw new RangeError(`No selectable decimal for ${value}`);

  let selected = low;
  const high = candidates[1];
  if (high !== undefined) {
    const { a, b } = scaled(selectionLength);
    const belowDistance = a - low * b;
    const aboveDistance = high * b - a;
    // Closest wins; the javadoc breaks an exact tie toward the even significand, as ECMA-262 does.
    if (aboveDistance < belowDistance) selected = high;
    else if (aboveDistance === belowDistance && stripSignificand(low) % 2n !== 0n) selected = high;
  }

  let exponent = pointPosition;
  if (selected === pow10(selectionLength)) {
    selected = pow10(selectionLength - 1);
    exponent += 1;
  }

  const digits = stripSignificand(selected).toString();
  return { digits, exponent };
}

/**
 * @param {bigint} significand positive
 * @returns {bigint} the same value with every trailing zero removed
 */
function stripSignificand(significand) {
  let stripped = significand;
  while (stripped % 10n === 0n) stripped /= 10n;
  return stripped;
}

/**
 * JDK 21 `Double.toString(double)`, verbatim from its specification — including `"0.0"`/`"-0.0"`,
 * the forced fraction digit, and the switch to computerized scientific notation outside
 * `[10 ** -3, 10 ** 7)`.
 *
 * The plural path does not need the text (it uses {@link decimalForDouble}); this exists so the
 * contract can be stated and tested as itself rather than inferred from what the plural path
 * happens to accept.
 *
 * @param {number} value
 * @returns {string}
 */
export function javaDoubleToString(value) {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";

  const { digits, exponent } = shortestRoundTripDecimal(Math.abs(value));
  const length = digits.length;
  let body;

  if (exponent >= -2 && exponent <= 7) {
    if (exponent <= 0) body = `0.${"0".repeat(-exponent)}${digits}`;
    else if (exponent >= length) body = `${digits}${"0".repeat(exponent - length)}.0`;
    else body = `${digits.slice(0, exponent)}.${digits.slice(exponent)}`;
  } else {
    body = `${digits.slice(0, 1)}.${length > 1 ? digits.slice(1) : "0"}E${exponent - 1}`;
  }

  return value < 0 ? `-${body}` : body;
}

/**
 * `NumberUtils.decimalForDouble`: the exact decimal lokalized-java derives from a `Double`.
 *
 * @param {number} value finite
 * @returns {Decimal}
 */
function decimalForDouble(value) {
  // Every integer this size is its own shortest round-tripping decimal — the half-ulp interval is
  // narrower than 1, so no other integer and no shorter decimal can land in it. Taking that shortcut
  // keeps the ordinary counting case off the BigInt path; `test/number-text.test.js` checks the two
  // agree. `Object.is` keeps -0 out, since `BigInt(-0)` would silently become `0n`.
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && !Object.is(value, -0))
    return stripTrailingZeros({ u: BigInt(value), s: 0 });

  if (value === 0) return { u: 0n, s: 0 };

  const { digits, exponent } = shortestRoundTripDecimal(Math.abs(value));
  const sign = value < 0 ? -1n : 1n;
  // `digits` carries no trailing zero, so this is already `stripTrailingZeros()`'s normal form.
  return { u: sign * BigInt(digits), s: digits.length - exponent };
}

/* -------------------------------------------------------------------------- */
/* Rule compilation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} EvaluationContext
 * @property {Decimal} n
 * @property {Decimal} i
 * @property {Decimal} v
 * @property {Decimal} w
 * @property {Decimal} f
 * @property {Decimal} t
 * @property {Decimal} c
 * @property {Decimal} e
 */

/** @typedef {(context: EvaluationContext) => boolean} Condition */

/** @typedef {{ minimum: Decimal, maximum: Decimal }} ValueRange */

// One operand letter, an optional integer modulus, `=` or `!=`, then a comma list of values or
// `a..b` ranges. This is lokalized-java's RELATION_PATTERN verbatim.
const RELATION = /^([nivwftec])(?:\s*%\s*([0-9]+))?\s*(!=|=)\s*(.+)$/;

/**
 * @param {string} valueList
 * @returns {ValueRange[]}
 */
function parseValueSet(valueList) {
  /** @type {ValueRange[]} */
  const ranges = [];

  for (const rawValue of valueList.split(",")) {
    const value = rawValue.trim();
    if (value.length === 0) continue;

    const rangeIndex = value.indexOf("..");

    if (rangeIndex >= 0) {
      ranges.push({
        minimum: parseDecimalText(value.slice(0, rangeIndex).trim()),
        maximum: parseDecimalText(value.slice(rangeIndex + 2).trim()),
      });
    } else {
      const exact = parseDecimalText(value);
      ranges.push({ minimum: exact, maximum: exact });
    }
  }

  return ranges;
}

/**
 * A value with a fractional part is only ever admitted by a single exact literal, never by a range.
 * That is what makes `n % 10 = 2..4` false for `n = 2.5` while `n = 2` stays true for `n = 2.0`.
 *
 * @param {ValueRange} range
 * @param {Decimal} value
 * @returns {boolean}
 */
function rangeContains(range, value) {
  if (!isIntegerValued(value))
    return compareDecimals(range.minimum, range.maximum) === 0 && compareDecimals(value, range.minimum) === 0;

  return compareDecimals(value, range.minimum) >= 0 && compareDecimals(value, range.maximum) <= 0;
}

/**
 * @param {EvaluationContext} context
 * @param {string} operand
 * @returns {Decimal}
 */
function operandValue(context, operand) {
  switch (operand) {
    case "n": return context.n;
    case "i": return context.i;
    case "v": return context.v;
    case "w": return context.w;
    case "f": return context.f;
    case "t": return context.t;
    case "c": return context.c;
    case "e": return context.e;
    default: throw new RangeError(`Unsupported CLDR plural operand '${operand}'`);
  }
}

/**
 * @param {string} relation
 * @returns {Condition}
 */
function compileRelation(relation) {
  const match = RELATION.exec(relation);
  if (match === null) throw new RangeError(`Unsupported CLDR plural relation '${relation}'`);

  const operand = match[1];
  const modulusText = match[2];
  const operator = match[3];
  const valueList = match[4];

  if (operand === undefined || operator === undefined || valueList === undefined)
    throw new RangeError(`Unsupported CLDR plural relation '${relation}'`);

  const modulus = modulusText === undefined ? null : BigInt(modulusText);
  const negated = operator === "!=";
  const ranges = parseValueSet(valueList);

  return (context) => {
    let value = operandValue(context, operand);
    if (modulus !== null) value = remainderDecimal(value, modulus);

    let contains = false;
    for (const range of ranges) {
      if (rangeContains(range, value)) {
        contains = true;
        break;
      }
    }

    return negated ? !contains : contains;
  };
}

/**
 * Compiles a CLDR plural-rule condition. `and` binds tighter than `or`; an empty condition is the
 * unconditional match that terminates every rule list.
 *
 * @param {string} condition
 * @returns {Condition}
 */
function compileCondition(condition) {
  const trimmed = condition.trim();
  if (trimmed.length === 0) return () => true;

  const disjuncts = trimmed.split(/\s+or\s+/).map((orPart) => {
    const conjuncts = orPart.split(/\s+and\s+/).map((andPart) => compileRelation(andPart.trim()));
    return /** @type {Condition} */ ((context) => {
      for (const conjunct of conjuncts) if (!conjunct(context)) return false;
      return true;
    });
  });

  return (context) => {
    for (const disjunct of disjuncts) if (disjunct(context)) return true;
    return false;
  };
}

/* -------------------------------------------------------------------------- */
/* Locale lookup                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The undetermined rule group answers to two names: lokalized-java keys it `root`, the generated JS
 * tables spell it `und`. The candidate walk is done in Java's vocabulary and only the final table
 * lookup is translated.
 */
const ROOT_GROUP_LOCALE = "root";
const UNDETERMINED_GROUP_LOCALE = "und";

const CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

/**
 * `LocaleUtils.languageForCanonicalTag`: the primary language of an already-CLDR-canonical tag, or
 * the empty string when the tag is private-use-only or undetermined.
 *
 * @param {string} canonicalTag
 * @returns {string}
 */
function languageForCanonicalTag(canonicalTag) {
  const lowered = canonicalTag.toLowerCase();
  if (lowered === "x" || lowered.startsWith("x-")) return "";

  const separatorIndex = canonicalTag.indexOf("-");
  const language = separatorIndex < 0 ? canonicalTag : canonicalTag.slice(0, separatorIndex);

  return language === "" || language.toLowerCase() === "und" ? "" : language;
}

/**
 * `CldrPluralRules.localeCandidates`, transcribed.
 *
 * The requested tag goes through the JDK round trip first (which is where `iw` becomes `he` and
 * `i-klingon` becomes `tlh`), then through CLDR canonicalization (which is where `mo` becomes `ro`
 * and `aa-Saaho` becomes `ssy`) — plural-rule lookup canonicalizes even though the catalog loader
 * does not. A tag with no language at all falls back to the undetermined rules; anything else walks
 * `language-Script-REGION`, `language-Script`, `language-REGION`, `language`.
 *
 * @param {string} localeTag
 * @returns {string[]} candidate rule-table keys, possibly empty
 */
function localeCandidates(localeTag) {
  if (typeof localeTag !== "string") throw new TypeError("Locale tag must be a string");

  const canonicalTag = canonicalLanguageTag(jdkLanguageTag(localeTag));
  const language = languageForCanonicalTag(canonicalTag);

  if (language === "")
    return hasUndeterminedLanguage(jdkLanguageTag(canonicalTag)) ? [ROOT_GROUP_LOCALE] : [];

  const canonicalParts = parseJdkTag(canonicalTag);
  const script = canonicalParts.script;
  const region = canonicalParts.region;

  /** @type {string[]} */
  const candidates = [];
  const add = /** @param {string} candidate */ (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  if (script !== "" && region !== "") add(`${language}-${script}-${region}`);
  if (script !== "") add(`${language}-${script}`);
  if (region !== "") add(`${language}-${region}`);
  add(language);

  return candidates;
}

/**
 * Resolved tags are memoized per table: the canonicalization walk costs far more than the lookup it
 * feeds. The bound stops attacker-supplied tags from growing the cache without limit; lokalized-java
 * holds no such cache and recomputes every call.
 */
const MAXIMUM_CACHED_TAGS = 512;

/**
 * A decoded CLDR rule-group table, compiled: the one parser and the one arithmetic behind every
 * plural family. The root builds its CARDINAL table here; `lokalized/data/ordinal` passes its own
 * groups in, which is what keeps `../data/ordinal-rules.js` out of the root graph. A locale miss is
 * `-1` rather than a throw, because ordinal lookup falls back where cardinal lookup rejects.
 *
 * @param {{ locales: string[], rules: { count: string, condition: string }[] }[]} groups
 */
export function createRuleTable(groups) {
  /** @type {Map<string, number>} */
  const indexByLocale = new Map();
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    if (group === undefined) continue;
    for (const locale of group.locales) indexByLocale.set(locale, index);
  }

  /** @type {(({ count: string, condition: Condition }[]) | undefined)[]} */
  const compiled = new Array(groups.length);

  /** @type {Map<string, number>} */
  const indexByTag = new Map();

  return Object.freeze({
    /** @param {string} localeTag @returns {number} group index, or -1 */
    indexForLocale(localeTag) {
      const cached = indexByTag.get(localeTag);
      if (cached !== undefined) return cached;

      for (const candidate of localeCandidates(localeTag)) {
        const index = indexByLocale.get(candidate === ROOT_GROUP_LOCALE ? UNDETERMINED_GROUP_LOCALE : candidate);

        if (index !== undefined) {
          if (indexByTag.size >= MAXIMUM_CACHED_TAGS) indexByTag.clear();
          indexByTag.set(localeTag, index);
          return index;
        }
      }

      return -1;
    },

    /** @param {number} index @param {Operands} operands @returns {string} first match's count */
    countFor(index, operands) {
      let rules = compiled[index];

      if (rules === undefined) {
        const group = groups[index];
        if (group === undefined) throw new RangeError(`Unknown plural rule group ${index}`);
        rules = group.rules.map((rule) => {
          if (!CATEGORIES.has(rule.count)) throw new RangeError(`Unsupported CLDR plural category '${rule.count}'`);
          return { count: rule.count, condition: compileCondition(rule.condition) };
        });
        compiled[index] = rules;
      }

      const context = evaluationContext(operands);
      for (const rule of rules) if (rule.condition(context)) return rule.count;
      return "other";
    },
  });
}

const CARDINAL_GROUPS = decodeCardinalRules();
const CARDINAL_TABLE = createRuleTable(CARDINAL_GROUPS);

/** `Cardinality`'s declaration order, which is the order Java's `SortedSet<Cardinality>` iterates. */
const CARDINAL_CATEGORY_ORDER = /** @type {const} */ (["zero", "one", "two", "few", "many", "other"]);

/**
 * `Cardinality.supportedCardinalitiesForLocale`: the categories the locale's rule group can produce,
 * in `Cardinality` declaration order, deduplicated.
 *
 * A well-formed tag with no rule group yields an EMPTY list rather than throwing — Java returns
 * `Collections.emptySortedSet()` there, and only a malformed tag is an error. That is the opposite
 * of `cardinalCategoryFor`, which throws, and the difference is deliberate on both sides.
 *
 * @param {string} localeTag
 * @returns {CardinalCategory[]}
 */
export function supportedCardinalCategoriesFor(localeTag) {
  const index = CARDINAL_TABLE.indexForLocale(localeTag);
  if (index < 0) return [];

  const group = CARDINAL_GROUPS[index];
  if (group === undefined) throw new RangeError(`Unknown cardinal rule group ${index}`);

  const present = new Set(group.rules.map((rule) => rule.count));
  return CARDINAL_CATEGORY_ORDER.filter((category) => present.has(category));
}

/**
 * `Cardinality.getSupportedLocaleTags`: the tags carried directly by the generated cardinal table,
 * in natural string order. Java translates its internal `root` key to `und` on the way out; the
 * generated table already spells that group `und`, so there is nothing left to translate.
 *
 * @returns {string[]}
 */
export function cardinalRuleLocaleTags() {
  /** @type {Set<string>} */
  const tags = new Set();
  for (const group of CARDINAL_GROUPS) for (const locale of group.locales) tags.add(locale);
  return [...tags].sort();
}

/**
 * Whether the CARDINAL table covers a locale.
 *
 * `lokalized/data/ordinal` needs exactly this: `CldrPluralRules.ordinalRulesForLocale` falls back to
 * the undetermined ordinal group for a locale with cardinal rules and no ordinal ones, and reports
 * the locale unsupported only when the cardinal table has never heard of it either.
 *
 * @param {string} localeTag
 * @returns {boolean}
 */
export function hasCardinalRulesForLocale(localeTag) {
  return CARDINAL_TABLE.indexForLocale(localeTag) >= 0;
}

/**
 * @param {string} text
 * @returns {Decimal}
 */
function integerDecimalFromText(text) {
  if (typeof text !== "string" || !/^[+-]?\d+$/.test(text))
    throw new RangeError(`Operand must be an integer digit string, but was '${String(text)}'`);
  return { u: BigInt(text), s: 0 };
}

/**
 * @param {number} value
 * @param {string} name
 * @returns {Decimal}
 */
function integerDecimalFromNumber(value, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new RangeError(`Operand '${name}' must be a safe integer, but was ${String(value)}`);
  return { u: BigInt(value), s: 0 };
}

/**
 * @param {Operands} operands
 * @returns {EvaluationContext}
 */
function evaluationContext(operands) {
  return {
    n: parseDecimalText(operands.n),
    i: integerDecimalFromText(operands.i),
    v: integerDecimalFromNumber(operands.v, "v"),
    w: integerDecimalFromNumber(operands.w, "w"),
    f: integerDecimalFromText(operands.f),
    t: integerDecimalFromText(operands.t),
    c: integerDecimalFromNumber(operands.c, "c"),
    e: integerDecimalFromNumber(operands.e, "e"),
  };
}

/**
 * The CLDR cardinal category of the given operands under the given locale.
 *
 * Rules are ordered and the first match wins; the final rule of every group is the unconditional
 * `other`. A locale with no CLDR cardinal rules throws rather than silently reporting `other`.
 *
 * @param {Operands} operands
 * @param {string} localeTag
 * @returns {CardinalCategory}
 */
export function cardinalCategoryFor(operands, localeTag) {
  const index = CARDINAL_TABLE.indexForLocale(localeTag);

  // `UnsupportedLocaleException(locale)` reports `locale.toLanguageTag()`, not the raw input.
  if (index < 0) throw new UnsupportedLocaleError(jdkLanguageTag(localeTag));

  return /** @type {CardinalCategory} */ (CARDINAL_TABLE.countFor(index, operands));
}
