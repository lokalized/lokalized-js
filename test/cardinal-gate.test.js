// @ts-check

/**
 * M4's cardinal gate.
 *
 * `test/plural.test.js` already drives the pinned CLDR samples through `src/internal/plural.js`.
 * That is not what M4 asks for: the gate is that "every generated case passes through the PUBLIC
 * classifier APIs". So this file imports `lokalized` — the package root, by its export-map specifier
 * shape — and never reaches into `src/internal/`. If a sample can be classified internally but not
 * expressed through `decimal()` / `pluralOperands()` / `cardinalityForNumber` /
 * `cardinalityForOperands`, that is a hole in the public surface and this file is where it shows up.
 *
 * The routing mirrors lokalized-java's own `CldrConformanceTests.assertCardinality`: a bare sample
 * token is a `BigDecimal` and goes to `forNumber`, and a `<mantissa>c<exponent>` token becomes
 * `PluralOperands.forNumber(mantissa).compactExponent(exponent)` and goes to `forOperands`. The JS
 * equivalents are `decimal(token)` and `pluralOperands(mantissa, { compactExponent })`.
 *
 * Skips cleanly when the sibling `lokalized-spec` checkout is absent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cardinalityForNumber,
  cardinalityForOperands,
  decimal,
  getSupportedCardinalityLocaleTags,
  pluralOperands,
  supportedCardinalitiesForLocale,
} from "../src/index.js";

const root = new URL("../", import.meta.url).pathname;
const specDir = process.env.LOKALIZED_SPEC_DIR ?? resolve(root, "../lokalized-spec");
const vectorsPath = resolve(
  specDir,
  "vendor/lokalized-java/src/build/resources/cldr/cldr-conformance-vectors.json",
);
const skip = existsSync(vectorsPath) ? false : `CLDR conformance vectors not found at ${vectorsPath}`;

/** @returns {any} */
function vectors() {
  return JSON.parse(readFileSync(vectorsPath, "utf8"));
}

/** The pinned corpus counts. A gate that silently shrinks is not a gate. */
const EXPECTED_GROUPS = 40;
const EXPECTED_LOCALES = 224;
const EXPECTED_SAMPLE_ROWS = 3022;
const EXPECTED_ASSERTIONS = 12396;

/** `count` in the vectors is CLDR's spelling; the public API answers with the tagged constant. */
const CONSTANT_NAME_BY_COUNT = new Map([
  ["zero", "CARDINALITY_ZERO"],
  ["one", "CARDINALITY_ONE"],
  ["two", "CARDINALITY_TWO"],
  ["few", "CARDINALITY_FEW"],
  ["many", "CARDINALITY_MANY"],
  ["other", "CARDINALITY_OTHER"],
]);

/**
 * One CLDR sample token, classified through the public surface.
 *
 * `1.0000001c6` is a compact sample: mantissa `1.0000001` displayed with exponent 6, so the visible
 * number is `1000000.1` while `c` and `e` stay 6. `pluralOperands` is the only public route that can
 * say that, which is exactly why the gate has to go through it.
 *
 * @param {string} token
 * @param {string} localeTag
 * @returns {unknown}
 */
function classifySample(token, localeTag) {
  const compactSeparator = token.indexOf("c");

  if (compactSeparator < 0) return cardinalityForNumber(decimal(token), localeTag);

  return cardinalityForOperands(
    pluralOperands(token.slice(0, compactSeparator), {
      compactExponent: Number(token.slice(compactSeparator + 1)),
    }),
    localeTag,
  );
}

test("the pinned corpus is the shape this gate claims to cover", { skip }, () => {
  const corpus = vectors();
  assert.equal(corpus.cldrVersion, "48.2", "conformance vectors are not the pinned CLDR version");
  assert.equal(corpus.cardinalRuleGroups.length, EXPECTED_GROUPS);

  let locales = 0;
  let sampleRows = 0;
  let assertions = 0;
  for (const group of corpus.cardinalRuleGroups) {
    locales += group.locales.length;
    for (const rule of group.rules) {
      sampleRows += rule.samples.length;
      assertions += rule.samples.length * group.locales.length;
    }
  }

  assert.equal(locales, EXPECTED_LOCALES);
  assert.equal(sampleRows, EXPECTED_SAMPLE_ROWS);
  assert.equal(assertions, EXPECTED_ASSERTIONS);
});

test(
  `every CLDR 48.2 cardinal sample classifies through the public API (${EXPECTED_ASSERTIONS} assertions)`,
  { skip },
  () => {
    const corpus = vectors();

    let assertions = 0;
    let compactAssertions = 0;
    let visibleDecimalAssertions = 0;

    for (const group of corpus.cardinalRuleGroups) {
      for (const rule of group.rules) {
        const expected = CONSTANT_NAME_BY_COUNT.get(rule.count);
        assert.ok(expected !== undefined, `unmapped CLDR count '${rule.count}'`);

        for (const sample of rule.samples) {
          const compact = sample.includes("c");
          const visibleDecimals = sample.includes(".");

          for (const localeTag of group.locales) {
            const actual = /** @type {any} */ (classifySample(sample, localeTag));
            assert.equal(
              actual?.name,
              expected,
              `locale ${localeTag}, sample ${sample}, rule '${rule.condition}' -> ${rule.count}`,
            );
            assert.equal(actual?.axis, "cardinality", `locale ${localeTag}, sample ${sample}`);

            assertions++;
            if (compact) compactAssertions++;
            if (visibleDecimals) visibleDecimalAssertions++;
          }
        }
      }
    }

    assert.equal(assertions, EXPECTED_ASSERTIONS, "the gate did not run every generated case");
    // The two families the M4 gate names explicitly, counted so neither can quietly drop out.
    assert.equal(compactAssertions, 216, "compact-notation coverage changed");
    assert.equal(visibleDecimalAssertions, 6598, "visible-decimal coverage changed");
  },
);

test("the classifier returns the identical frozen constant every time", { skip }, () => {
  const first = cardinalityForNumber(1, "en");
  assert.equal(first, cardinalityForNumber(decimal("1"), "en"));
  assert.equal(first, cardinalityForNumber(1n, "en"));
  assert.equal(first, cardinalityForOperands(pluralOperands("1"), "en"));
  assert.ok(Object.isFrozen(first));
  assert.equal(/** @type {any} */ (first).name, "CARDINALITY_ONE");
  assert.equal(/** @type {any} */ (first).renderName, "ONE");
});

test("distinct sample values classify identically as text and as a number", { skip }, () => {
  // Only the integer samples: `1.0` as `decimal("1.0")` has a visible scale that the `number` 1.0
  // cannot carry, and that difference is the whole point of the tagged decimal.
  const corpus = vectors();
  /** @type {Set<string>} */
  const integerSamples = new Set();
  for (const group of corpus.cardinalRuleGroups)
    for (const rule of group.rules)
      for (const sample of rule.samples) if (/^\d+$/.test(sample)) integerSamples.add(sample);

  const locales = corpus.cardinalRuleGroups.map((/** @type {any} */ group) => group.locales[0]);
  let assertions = 0;

  for (const sample of integerSamples)
    for (const localeTag of locales) {
      const asText = cardinalityForNumber(decimal(sample), localeTag);
      assert.equal(cardinalityForNumber(Number(sample), localeTag), asText, `${localeTag} ${sample}`);
      assert.equal(cardinalityForNumber(BigInt(sample), localeTag), asText, `${localeTag} ${sample}`);
      assertions += 2;
    }

  assert.equal(assertions, 9840, "the number/bigint cross-check changed shape");
});

test("large integers and visible decimals survive the public API", { skip: false }, () => {
  const name = (/** @type {unknown} */ value) => /** @type {any} */ (value).name;

  // Well past 2^53: a float implementation cannot tell these apart, because 10n**20n and
  // 10n**20n + 2n round to the same double. Polish reads `i % 10`, so they are different categories.
  assert.equal(name(cardinalityForNumber(10n ** 20n, "pl")), "CARDINALITY_MANY");
  assert.equal(name(cardinalityForNumber(10n ** 20n + 2n, "pl")), "CARDINALITY_FEW");
  assert.equal(Number(10n ** 20n), Number(10n ** 20n + 2n), "the two values must be one double");
  assert.equal(name(cardinalityForNumber(decimal("100000000000000000000"), "pl")), "CARDINALITY_MANY");
  assert.equal(name(cardinalityForNumber(decimal("1e20"), "pl")), "CARDINALITY_MANY");

  // Visible decimals: `1`, `1.0` and `1.00` are three different values in CLDR, and only the first
  // is `one` in English. The declared-places route has to agree with the written-scale route.
  assert.equal(name(cardinalityForNumber(decimal("1"), "en")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("1.0"), "en")), "CARDINALITY_OTHER");
  assert.equal(name(cardinalityForNumber(decimal("1.00"), "en")), "CARDINALITY_OTHER");
  assert.equal(name(cardinalityForOperands(pluralOperands("1", { visibleDecimalPlaces: 0 }), "en")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForOperands(pluralOperands("1", { visibleDecimalPlaces: 2 }), "en")), "CARDINALITY_OTHER");
  assert.equal(name(cardinalityForOperands(pluralOperands("1.00", { visibleDecimalPlaces: 2 }), "en")), "CARDINALITY_OTHER");

  // Czech separates `v = 0` integers from any visible fraction, so it reads `w`/`v` rather than `n`.
  assert.equal(name(cardinalityForNumber(decimal("2"), "cs")), "CARDINALITY_FEW");
  assert.equal(name(cardinalityForNumber(decimal("2.0"), "cs")), "CARDINALITY_MANY");

  // Reducing the visible places below the written scale throws rather than rounding (plan 3.7).
  assert.throws(() => cardinalityForOperands(pluralOperands("1.25", { visibleDecimalPlaces: 1 }), "en"), RangeError);
});

test("compact exponents shift the mantissa before the operands are derived", { skip: false }, () => {
  const name = (/** @type {unknown} */ value) => /** @type {any} */ (value).name;

  // The shift happens BEFORE the operands are read: `0.000001c6` displays as 1, so `i` is 1 and `v`
  // is 0 and English calls it `one`. Read without the shift it would be `i = 0, v = 6` -> `other`.
  assert.equal(name(cardinalityForOperands(pluralOperands("0.000001", { compactExponent: 6 }), "en")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("0.000001"), "en")), "CARDINALITY_OTHER");

  // `c`/`e` are rule inputs in their own right, not just a shift. French `many` is
  // `e = 0 and i != 0 and i % 1000000 = 0 and v = 0 or e != 0..5`, so the same numeric value
  // 2100000 is `many` when it is displayed compactly and `other` when it is written out.
  assert.equal(name(cardinalityForOperands(pluralOperands("2.1", { compactExponent: 6 }), "fr")), "CARDINALITY_MANY");
  assert.equal(name(cardinalityForNumber(decimal("2100000"), "fr")), "CARDINALITY_OTHER");
  assert.equal(name(cardinalityForOperands(pluralOperands("2.1", { compactExponent: 3 }), "fr")), "CARDINALITY_OTHER");

  // A zero exponent is the ordinary case and must equal the plain decimal exactly.
  for (const locale of ["en", "pl", "ar", "cy", "ru"])
    for (const value of ["0", "1", "1.0", "2", "5", "11", "100"])
      assert.equal(
        cardinalityForOperands(pluralOperands(value, { compactExponent: 0 }), locale),
        cardinalityForNumber(decimal(value), locale),
        `${locale} ${value}`,
      );
});

/**
 * The gate above is only as strong as the corpus behind it, so the corpus's blind spots have to be
 * named and covered by hand rather than left implicit.
 *
 * CLDR 48.2 generates no cardinal sample that separates the `f` operand from the `t` operand: every
 * sample with a fraction either has no trailing zero (`0.1`, `2.5`) or is all zeros (`1.00`), and in
 * both shapes `f` and `t` are the same integer. So all 12,396 assertions still pass with `t` wired
 * to `f`, or `f` wired to `t` — verified by mutation. `is` and `ru` are the only locales whose rules
 * read those operands, and the values below are the ones that tell them apart.
 */
test("the corpus cannot separate the f and t operands, so these do it by hand", { skip }, () => {
  const corpus = vectors();

  // First state the blind spot as a fact about the pinned data, so a future CLDR release that adds
  // a discriminating sample makes this test fail loudly instead of leaving the claim stale.
  /** @type {string[]} */
  const discriminating = [];
  for (const group of corpus.cardinalRuleGroups)
    for (const rule of group.rules)
      for (const sample of rule.samples) {
        const dot = sample.indexOf(".");
        if (dot < 0 || sample.includes("c")) continue;
        const fraction = sample.slice(dot + 1);
        // `f` and `t` differ exactly when stripping trailing zeros changes the fraction's value.
        if (fraction !== fraction.replace(/0+$/, "") && Number(fraction) !== 0) discriminating.push(sample);
      }
  assert.deepEqual(discriminating, [], "the corpus now separates f from t; fold these samples in");

  const name = (/** @type {unknown} */ value) => /** @type {any} */ (value).name;

  // Icelandic `one` is `t = 0 and i % 10 = 1 and i % 100 != 11 or t % 10 = 1 and t % 100 != 11`.
  // `0.10` has t = 1 (one) and f = 10 (would fall through to other), so it pins t as the stripped
  // fraction. `11.10` additionally defeats the `t = 0` branch, whose `i % 100 != 11` fails.
  assert.equal(name(cardinalityForNumber(decimal("0.10"), "is")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("0.100"), "is")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("2.10"), "is")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("11.10"), "is")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("11"), "is")), "CARDINALITY_OTHER");

  // The mirror image, on `f`. Croatian and Macedonian read
  // `v = 0 and i % 10 = 1 and i % 100 != 11 or f % 10 = 1 and f % 100 != 11`: `0.1` is one, and
  // `0.10` is other because f is 10 — reading the STRIPPED fraction there would give f = 1 and
  // wrongly say one. (Russian's rules never mention f at all; these are the locales that do.)
  for (const localeTag of ["hr", "bs", "sr", "mk"]) {
    assert.equal(name(cardinalityForNumber(decimal("0.1"), localeTag)), "CARDINALITY_ONE", localeTag);
    assert.equal(name(cardinalityForNumber(decimal("0.10"), localeTag)), "CARDINALITY_OTHER", localeTag);
    assert.equal(name(cardinalityForNumber(decimal("1.10"), localeTag)), "CARDINALITY_OTHER", localeTag);
  }

  // Sinhala's `i = 0 and f = 1`, and Upper/Lower Sorbian's `f % 100 = 1`, fail the same way if `f`
  // is stripped: `0.10` and `0.100` would both become f = 1.
  assert.equal(name(cardinalityForNumber(decimal("0.1"), "si")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("0.10"), "si")), "CARDINALITY_OTHER");
  assert.equal(name(cardinalityForNumber(decimal("0.01"), "hsb")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("0.100"), "hsb")), "CARDINALITY_OTHER");

  // Latvian reads `v` and `f` together — `v = 2 and f % 100 = 11..19` — so it pins the pair.
  assert.equal(name(cardinalityForNumber(decimal("0.11"), "lv")), "CARDINALITY_ZERO");

  // Danish `one` is `n = 1 or t != 0 and i = 0,1`: the same value with and without a visible zero.
  assert.equal(name(cardinalityForNumber(decimal("0.10"), "da")), "CARDINALITY_ONE");
  assert.equal(name(cardinalityForNumber(decimal("0.0"), "da")), "CARDINALITY_OTHER");
});

/**
 * CLDR operands are derived from the ABSOLUTE value ("n: the absolute value of the source number"),
 * and lokalized-java calls `BigDecimal.abs()` before it derives anything. Every corpus sample is
 * non-negative, so dropping that `abs()` leaves all 12,396 assertions passing while changing what
 * `cardinalityForNumber(-1, "en")` answers — verified by mutation. Negation is therefore pinned here
 * as its own invariant, across every rule group and both the number and the decimal-text routes.
 */
test("negating a value never changes its cardinality", { skip }, () => {
  const corpus = vectors();
  const representatives = corpus.cardinalRuleGroups.map((/** @type {any} */ group) => group.locales[0]);

  /** @type {Set<string>} */
  const samples = new Set();
  for (const group of corpus.cardinalRuleGroups)
    for (const rule of group.rules)
      for (const sample of rule.samples) if (!sample.includes("c")) samples.add(sample);

  let assertions = 0;
  for (const localeTag of representatives)
    for (const sample of samples) {
      const positive = cardinalityForNumber(decimal(sample), localeTag);
      assert.equal(cardinalityForNumber(decimal(`-${sample}`), localeTag), positive, `${localeTag} -${sample}`);
      assertions++;

      if (/^\d+$/.test(sample)) {
        assert.equal(cardinalityForNumber(-Number(sample), localeTag), positive, `${localeTag} -${sample} (number)`);
        assert.equal(cardinalityForNumber(-BigInt(sample), localeTag), positive, `${localeTag} -${sample} (bigint)`);
        assertions += 2;
      }
    }

  assert.equal(assertions, 21520, "the negation cross-check changed shape");

  // `-0` is a distinct double, and `BigInt(-0)` is `0n`; neither may leak a sign into the operands.
  assert.equal(cardinalityForNumber(-0, "en"), cardinalityForNumber(0, "en"));
  assert.equal(cardinalityForNumber(decimal("-0.0"), "en"), cardinalityForNumber(decimal("0.0"), "en"));
});

/**
 * Which operands the pinned rules actually read. Recorded because it bounds what ANY corpus-driven
 * gate can prove: no CLDR 48.2 cardinal rule mentions `w` or `c`, so neither operand is observable
 * through the public classifier at all, and no assertion here or in the corpus constrains them.
 * Stating it keeps the coverage claim honest, and the day CLDR starts using one this fails.
 */
test("the pinned cardinal rules read n, i, v, f, t and e — and neither w nor c", { skip }, () => {
  const corpus = vectors();
  const conditions = corpus.cardinalRuleGroups.flatMap((/** @type {any} */ group) =>
    group.rules.map((/** @type {any} */ rule) => rule.condition),
  );

  const read = [..."nivwftec"].filter((operand) =>
    conditions.some((/** @type {string} */ condition) =>
      new RegExp(`(^|[^a-z])${operand}\\s*(%|!=|=)`).test(condition),
    ),
  );

  assert.deepEqual(read, ["n", "i", "v", "f", "t", "e"]);
});

test("supportedCardinalitiesForLocale agrees with the pinned rule groups", { skip }, () => {
  const corpus = vectors();

  /** @type {Map<string, Set<string>>} */
  const expectedByLocale = new Map();
  for (const group of corpus.cardinalRuleGroups)
    for (const localeTag of group.locales) {
      const counts = expectedByLocale.get(localeTag) ?? new Set();
      for (const rule of group.rules) counts.add(rule.count);
      expectedByLocale.set(localeTag, counts);
    }

  // Java: assertEquals(Cardinality.getSupportedLocaleTags(), expectedCardinalitiesByLocale.keySet())
  assert.deepEqual([...getSupportedCardinalityLocaleTags()], [...expectedByLocale.keys()].sort());
  assert.equal(getSupportedCardinalityLocaleTags().length, EXPECTED_LOCALES);

  let assertions = 0;
  for (const [localeTag, counts] of expectedByLocale) {
    const expected = [...CONSTANT_NAME_BY_COUNT]
      .filter(([count]) => counts.has(count))
      .map(([, constantName]) => constantName);

    assert.deepEqual(
      supportedCardinalitiesForLocale(localeTag).map((form) => /** @type {any} */ (form).name),
      expected,
      `supported cardinalities for ${localeTag}`,
    );
    assertions++;
  }

  assert.equal(assertions, EXPECTED_LOCALES);
});

test("supportedCardinalitiesForLocale is a probe, not a classifier", () => {
  // Declaration order, not alphabetical and not rule order: ZERO, ONE, TWO, FEW, MANY, OTHER.
  assert.deepEqual(
    supportedCardinalitiesForLocale("cy").map((form) => /** @type {any} */ (form).name),
    [
      "CARDINALITY_ZERO",
      "CARDINALITY_ONE",
      "CARDINALITY_TWO",
      "CARDINALITY_FEW",
      "CARDINALITY_MANY",
      "CARDINALITY_OTHER",
    ],
  );

  // Well-formed, unsupported: an empty frozen array rather than a throw (plan 3.7).
  const unsupported = supportedCardinalitiesForLocale("zz");
  assert.deepEqual([...unsupported], []);
  assert.ok(Object.isFrozen(unsupported));
  assert.throws(() => cardinalityForNumber(1, "zz"), /Unsupported locale/);

  // Fallback: neither `en-GB` nor `de-CH-1901` is a rule tag, but both classify.
  assert.ok(!getSupportedCardinalityLocaleTags().includes("en-GB"));
  assert.deepEqual(
    supportedCardinalitiesForLocale("en-GB").map((form) => /** @type {any} */ (form).name),
    ["CARDINALITY_ONE", "CARDINALITY_OTHER"],
  );
  // `mo` canonicalizes to `ro` for plural rules even though the catalog loader keeps it `mo`.
  assert.deepEqual(supportedCardinalitiesForLocale("mo"), supportedCardinalitiesForLocale("ro"));
  // A private-use-only tag falls back to the root rules, matching lokalized-java's own test.
  assert.deepEqual(
    supportedCardinalitiesForLocale("x-acme").map((form) => /** @type {any} */ (form).name),
    ["CARDINALITY_OTHER"],
  );

  assert.ok(Object.isFrozen(getSupportedCardinalityLocaleTags()));
  assert.equal(getSupportedCardinalityLocaleTags(), getSupportedCardinalityLocaleTags());
});

test("the classifier rejects values the plan says are not numeric", () => {
  // A raw string is text, never a number (plan 3.7).
  assert.throws(() => cardinalityForNumber(/** @type {any} */ ("1"), "en"), TypeError);
  assert.throws(() => cardinalityForNumber(/** @type {any} */ (null), "en"), TypeError);
  assert.throws(() => cardinalityForNumber(NaN, "en"), RangeError);
  assert.throws(() => cardinalityForNumber(Infinity, "en"), RangeError);
  // The tagged-value grammar rejects whitespace, hex, and the non-finite spellings.
  for (const bad of [" 1", "0x10", "1_000", "NaN", "Infinity", "1.2.3", ""])
    assert.throws(() => decimal(bad), RangeError, `decimal(${JSON.stringify(bad)}) should be rejected`);
});
