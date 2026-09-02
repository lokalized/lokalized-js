// @ts-check

/**
 * Exact numeric conversion for a JavaScript `number`.
 *
 * Plan section 3.7: a finite JS number's plural conversion "follows the shortest round-trippable
 * decimal contract of the pinned JDK 21 oracle (including exponent and negative-zero cases), with an
 * explicit JS implementation rather than assuming `Number.prototype.toString` is identical".
 *
 * It is not identical, and this file is the proof. lokalized-java converts a `Double` with
 * `new BigDecimal(Double.toString(d)).stripTrailingZeros()`, and JDK 21's `Double.toString` differs
 * from ECMA-262's `Number::toString` in one clause of its selection rule:
 *
 *   JDK 21: "Let p be the minimal length over all decimals in R. When p >= 2, let T be the set of
 *   all decimals in R with length p. Otherwise, let T be the set of all decimals in R with length
 *   1 OR 2. Define d_m as the decimal in T that is closest to m."
 *
 * ECMA-262 stops at the minimal length. So whenever ONE significant digit already round-trips but a
 * two-digit decimal is closer to the actual double, the two languages pick different decimals for
 * the same double. `Double.MIN_VALUE` is the famous one: `5e-324` in JavaScript, `4.9E-324` in Java.
 *
 * The formatting differs too — Java forces a fraction digit and switches to scientific notation
 * outside `[10^-3, 10^7)` — but formatting alone is harmless, because both sides strip trailing
 * zeros afterwards. Only a different DECIMAL VALUE can change an operand set, and the last test here
 * shows that it does, through the public classifier.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { javaDoubleToString, operandsFromNumber } from "../src/internal/plural.js";
import { cardinalityForNumber } from "../src/index.js";

/**
 * The exact value of decimal text as a canonical `<significand>e<exponent>` string with no trailing
 * zero — i.e. what `new BigDecimal(text).stripTrailingZeros()` holds. Notation is erased; value is
 * not. Written independently of `src/` so it can referee the two conversions.
 *
 * @param {string} text
 * @returns {string}
 */
function canonicalDecimalValue(text) {
  const match = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  assert.ok(match !== null, `unparseable decimal text ${JSON.stringify(text)}`);

  const fraction = match[3] ?? match[4] ?? "";
  let significand = BigInt(`${match[2] ?? ""}${fraction}`);
  let exponent = (match[5] === undefined ? 0 : Number(match[5])) - fraction.length;

  if (significand === 0n) return "0e0";
  while (significand % 10n === 0n) {
    significand /= 10n;
    exponent += 1;
  }
  return `${match[1] === "-" ? "-" : ""}${significand}e${exponent}`;
}

/** Every finite double whose shortest round-tripping decimal has ONE significant digit. */
function* singleDigitDoubles() {
  // Any such double is the nearest double to some s * 10^i with s in 1..9. Below 10^-323 and above
  // 10^308 the range runs out; the bounds are deliberately wider than binary64 so nothing is missed.
  for (let exponent = -340; exponent <= 320; exponent++)
    for (let significand = 1; significand <= 9; significand++) {
      const value = Number(`${significand}e${exponent}`);
      if (Number.isFinite(value) && value !== 0) yield value;
    }
}

/** A deterministic pseudo-random bit pattern generator, so a failure is reproducible. */
function* randomDoubles(count) {
  const view = new DataView(new ArrayBuffer(8));
  let state = 0x2545f491n;
  for (let index = 0; index < count; index++) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    view.setBigUint64(0, state);
    const value = view.getFloat64(0);
    if (Number.isFinite(value) && value !== 0) yield value;
  }
}

test("javaDoubleToString reproduces the JDK 21 javadoc's own worked examples", () => {
  // The four formatting cases named in the specification, plus its zero/infinity/NaN clauses.
  assert.equal(javaDoubleToString(1e23), "1.0E23"); // 1 x 10^23, subcase n = 1
  assert.equal(javaDoubleToString(0.0123), "0.0123"); // 123 x 10^-4, case -3 <= e < 0
  assert.equal(javaDoubleToString(12300), "12300.0"); // 123 x 10^2, subcase i >= 0
  assert.equal(javaDoubleToString(12.3), "12.3"); // 123 x 10^-1, subcase i < 0
  assert.equal(javaDoubleToString(1.23e-19), "1.23E-19"); // 123 x 10^-21, subcase n > 1

  assert.equal(javaDoubleToString(0), "0.0");
  assert.equal(javaDoubleToString(-0), "-0.0");
  assert.equal(javaDoubleToString(NaN), "NaN");
  assert.equal(javaDoubleToString(Infinity), "Infinity");
  assert.equal(javaDoubleToString(-Infinity), "-Infinity");
});

test("javaDoubleToString switches notation exactly where the JDK does", () => {
  // Plain inside [10^-3, 10^7), scientific outside. `Number.prototype.toString` switches at 10^21
  // and 10^-7 instead, which is the loud half of the difference and the harmless half.
  const cases = /** @type {[number, string][]} */ ([
    [0.001, "0.001"],
    [0.0001, "1.0E-4"],
    [0.00012, "1.2E-4"],
    [9999999, "9999999.0"],
    [1e7, "1.0E7"],
    [12345678, "1.2345678E7"],
    [1, "1.0"],
    [-1, "-1.0"],
    [100, "100.0"],
    [1e21, "1.0E21"],
    [1.7976931348623157e308, "1.7976931348623157E308"],
    [5e-324, "4.9E-324"],
    [2.2250738585072014e-308, "2.2250738585072014E-308"],
  ]);
  for (const [value, expected] of cases) assert.equal(javaDoubleToString(value), expected, String(value));

  // Every one of those is still the same double read back — notation never changes the value.
  for (const [value] of cases) assert.equal(Number(javaDoubleToString(value)), value, String(value));
});

test("the selected decimal round-trips, and no shorter one does", () => {
  let checked = 0;

  const verify = (/** @type {number} */ value) => {
    const text = javaDoubleToString(value);
    assert.equal(Number(text), value, `round trip failed for ${value}`);

    const digits = (canonicalDecimalValue(text).replace("-", "").split("e")[0] ?? "").length;

    // Minimality, refereed by `Number.prototype.toExponential`, which rounds to the nearest decimal
    // of the requested length: no shorter decimal may round-trip. The one licensed exception is the
    // JDK's length-1-or-2 clause, which lets a two-digit decimal be chosen over a one-digit one.
    const minimumIsOne = digits === 2 && Number(value.toExponential(0)) === value;
    const floor = minimumIsOne ? 1 : digits;
    for (let length = 1; length < floor; length++)
      assert.notEqual(
        Number(value.toExponential(length - 1)),
        value,
        `${value} claims ${digits} significant digits but ${length} round-trips`,
      );

    checked++;
  };

  for (const value of singleDigitDoubles()) verify(value);
  for (const value of randomDoubles(60000)) verify(value);
  for (let index = 0; index < 4000; index++) verify(index / 7);

  assert.ok(checked > 60000, `expected a broad sweep, ran ${checked}`);
});

test("EXHAUSTIVE: exactly eight doubles convert to a different decimal than Number#toString", () => {
  // Divergence is only possible where the JDK's "length 1 or 2" clause bites, and that clause only
  // applies when the minimal round-tripping length is 1 — which means the double is the nearest
  // double to some s x 10^i with s in 1..9. `singleDigitDoubles` enumerates every such double in
  // binary64, so this loop is exhaustive over the whole divergence domain, not a sample of it.
  /** @type {Map<string, string>} */
  const divergent = new Map();
  let examined = 0;

  for (const value of singleDigitDoubles()) {
    examined++;
    const fromJavaScript = canonicalDecimalValue(value.toString());
    const fromJava = canonicalDecimalValue(javaDoubleToString(value));
    if (fromJavaScript !== fromJava) divergent.set(value.toString(), javaDoubleToString(value));
  }

  assert.ok(examined > 5000, `expected the full single-digit enumeration, ran ${examined}`);
  assert.deepEqual(
    [...divergent],
    [
      ["5e-324", "4.9E-324"],
      ["1e-323", "9.9E-324"],
      ["5e-323", "4.9E-323"],
      ["6e-323", "5.9E-323"],
      ["7e-323", "6.9E-323"],
      ["8e-323", "7.9E-323"],
      ["9e-323", "8.9E-323"],
      ["1e-322", "9.9E-323"],
    ],
    "the divergence set between JDK 21 Double.toString and ECMA-262 Number#toString changed",
  );

  // And nowhere else: every other double either has a minimal length of 2 or more (where the two
  // specifications are word-for-word the same rule) or already agrees.
  let agreed = 0;
  for (const value of randomDoubles(200000)) {
    assert.equal(
      canonicalDecimalValue(Math.abs(value).toString()),
      canonicalDecimalValue(javaDoubleToString(Math.abs(value))),
      `unexpected divergence at ${value}`,
    );
    agreed++;
  }
  for (const value of [1e21, 1e23, 2e23, 4.35, 1 / 3, 0.1, 0.3, 745610097848097.2, 9007199254740993]) {
    assert.equal(
      canonicalDecimalValue(Math.abs(value).toString()),
      canonicalDecimalValue(javaDoubleToString(Math.abs(value))),
      `unexpected divergence at ${value}`,
    );
    agreed++;
  }
  assert.ok(agreed > 150000, `expected a broad agreement sweep, ran ${agreed}`);
});

test("the divergence reaches the operands, and the public classifier", () => {
  // 5e-324 written the JavaScript way is `5 x 10^-324`: one visible digit, 324 decimal places.
  // Written the Java way it is `49 x 10^-325`: two visible digits, 325 decimal places. Different
  // `v`, different `f`, and in some locales a different category.
  const operands = operandsFromNumber(5e-324);
  assert.equal(operands.v, 325);
  assert.equal(operands.f, "49");
  assert.equal(operands.i, "0");

  // Filipino's `one` is `v = 0 and i = 1,2,3 or v = 0 and i % 10 != 4,6,9 or v != 0 and f % 10 != 4,6,9`.
  // With f = 5 (the JavaScript decimal) that last clause holds and the answer is `one`;
  // with f = 49 it does not, and the answer is `other`. Java says `other`.
  assert.equal(/** @type {any} */ (cardinalityForNumber(5e-324, "fil")).name, "CARDINALITY_OTHER");
  assert.equal(/** @type {any} */ (cardinalityForNumber(1e-323, "hr")).name, "CARDINALITY_OTHER");

  // The same values written as exact decimal text keep their own scale and are unaffected — this is
  // a property of the double conversion, not of the rule evaluator.
  assert.equal(operandsFromNumber(5e-324).n, operandsFromNumber(4.9e-324).n);
});

test("the fast path for safe integers agrees with the general conversion", () => {
  // `decimalForDouble` shortcuts integers within 2^53 instead of running the BigInt search. The two
  // must be indistinguishable, or the shortcut is a second implementation with its own bugs.
  const values = [
    0, 1, 2, 9, 10, 100, 1000, 999999, 1e7, 1e15, 2 ** 53 - 1, -(2 ** 53 - 1), -1, -0,
    12345678901234, 4503599627370496,
  ];
  for (const value of values) {
    const viaFastPath = operandsFromNumber(value);
    const viaText = operandsFromNumber(Number(javaDoubleToString(value)));
    assert.deepEqual(viaFastPath, viaText, `${value}`);
    // And against the decimal the JDK text names, parsed independently of `src/`.
    assert.equal(
      canonicalDecimalValue(viaFastPath.n),
      canonicalDecimalValue(javaDoubleToString(Math.abs(value))),
      `${value}`,
    );
  }

  // Negative zero: the sign is real in `Double.toString` and gone by the time operands exist,
  // because plural classification uses the absolute value.
  assert.equal(javaDoubleToString(-0), "-0.0");
  assert.deepEqual(operandsFromNumber(-0), operandsFromNumber(0));
  assert.equal(operandsFromNumber(-0).n, "0");
});

test("non-finite numbers fail rather than classifying", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => operandsFromNumber(value), RangeError, String(value));
    assert.throws(() => cardinalityForNumber(value, "en"), RangeError, String(value));
  }
});
