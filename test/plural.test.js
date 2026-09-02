// @ts-check

/**
 * `src/internal/plural.js` is gated against two recorded corpora, not against hand-written
 * expectations:
 *
 * 1. `lokalized-spec/generated/behavioral-vectors.json` — every `cardinalityForNumber` and
 *    `cardinalityForOperands` case, including the ones that record a thrown exception.
 * 2. `cldr-conformance-vectors.json` — the pinned CLDR 48.2 sample values, driven for every locale
 *    in every cardinal rule group. This is the large gate: thousands of assertions covering rule
 *    shapes the behavioral vectors never reach.
 *
 * Both skip cleanly when the sibling `lokalized-spec` checkout is absent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { decode as decodeCardinalRules } from "../src/data/cardinal.js";
import { decode as decodeLanguageAliases } from "../src/data/aliases-language.js";
import {
  UnsupportedLocaleError,
  cardinalCategoryFor,
  operandsFromDecimalText,
  operandsFromNumber,
} from "../src/internal/plural.js";

const root = new URL("../", import.meta.url).pathname;
const specDir = process.env.LOKALIZED_SPEC_DIR ?? resolve(root, "../lokalized-spec");
const vectorsPath = resolve(specDir, "generated/behavioral-vectors.json");
const conformancePath = resolve(
  specDir,
  "vendor/lokalized-java/src/build/resources/cldr/cldr-conformance-vectors.json",
);

const vectorsSkip = existsSync(vectorsPath) ? false : `behavioral vectors not found at ${vectorsPath}`;
const conformanceSkip = existsSync(conformancePath)
  ? false
  : `CLDR conformance vectors not found at ${conformancePath}`;

/**
 * @param {string} path
 * @returns {any}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Java's `CARDINALITY_ONE` becomes the JS contract's `one`. */
const CATEGORY_BY_JAVA_NAME = new Map([
  ["CARDINALITY_ZERO", "zero"],
  ["CARDINALITY_ONE", "one"],
  ["CARDINALITY_TWO", "two"],
  ["CARDINALITY_FEW", "few"],
  ["CARDINALITY_MANY", "many"],
  ["CARDINALITY_OTHER", "other"],
]);

/**
 * Materializes one corpus `$lokalized` value into operands, mirroring how the Java oracle
 * (`VectorOracle.decodeValue`) turns the same tuple into a `Number` or a `PluralOperands`.
 *
 * @param {any} value
 * @param {number|undefined} visibleDecimalPlaces case-level visible decimal places, if any
 * @returns {import("../src/internal/plural.js").Operands}
 */
function operandsForCorpusValue(value, visibleDecimalPlaces) {
  /** @type {import("../src/internal/plural.js").OperandsOptions} */
  const options = {};
  if (visibleDecimalPlaces !== undefined) options.visibleDecimalPlaces = visibleDecimalPlaces;

  switch (value.$lokalized) {
    // Integral Java types: no observable visible scale.
    case "integer":
    case "long":
    case "bigint":
      return operandsFromNumber(BigInt(value.value), options);
    // Java Double/Float: converted through the shortest round-tripping decimal form.
    case "double":
    case "float":
      return operandsFromNumber(Number(value.value), options);
    // Java BigDecimal: the written scale IS the visible scale.
    case "decimal":
      return operandsFromDecimalText(value.value, options);
    case "plural-operands": {
      /** @type {import("../src/internal/plural.js").OperandsOptions} */
      const operandOptions = {};
      if (value.visibleDecimalPlaces !== undefined) operandOptions.visibleDecimalPlaces = value.visibleDecimalPlaces;
      if (value.compactExponent !== undefined) operandOptions.compactExponent = value.compactExponent;
      return operandsFromDecimalText(value.value, operandOptions);
    }
    default:
      throw new Error(`Unsupported corpus value kind '${value.$lokalized}'`);
  }
}

test("behavioral vectors: cardinalityForNumber and cardinalityForOperands", { skip: vectorsSkip }, () => {
  const corpus = readJson(vectorsPath);
  /** @type {any[]} */
  const cases = corpus.cases.filter(
    (/** @type {any} */ testCase) =>
      testCase.operation === "cardinalityForNumber" || testCase.operation === "cardinalityForOperands",
  );

  assert.equal(
    cases.filter((testCase) => testCase.operation === "cardinalityForNumber").length,
    49,
    "expected 49 cardinalityForNumber cases",
  );
  assert.equal(
    cases.filter((testCase) => testCase.operation === "cardinalityForOperands").length,
    15,
    "expected 15 cardinalityForOperands cases",
  );

  for (const testCase of cases) {
    const { locale, value, visibleDecimalPlaces } = testCase.input;

    if (testCase.expected.thrown !== undefined) {
      assert.throws(
        () => cardinalCategoryFor(operandsForCorpusValue(value, visibleDecimalPlaces), locale),
        (/** @type {unknown} */ error) => {
          assert.ok(error instanceof Error, `${testCase.id}: expected an Error`);
          assert.equal(error.message, testCase.expected.thrown.message, testCase.id);
          return true;
        },
        testCase.id,
      );
      continue;
    }

    const expected = CATEGORY_BY_JAVA_NAME.get(testCase.expected.classification.name);
    assert.ok(expected !== undefined, `${testCase.id}: unmapped category`);

    const actual = cardinalCategoryFor(operandsForCorpusValue(value, visibleDecimalPlaces), locale);
    assert.equal(actual, expected, `${testCase.id} (locale ${locale}, value ${JSON.stringify(value)})`);
  }
});

/**
 * A CLDR sample token is either plain decimal text or `<mantissa>c<exponent>`, and the Java
 * conformance test routes the two forms to `forNumber(BigDecimal)` and `forOperands` respectively.
 * Both are the decimal-text path here, which is what makes `1.0` and `1` stay distinct.
 *
 * @param {string} token
 * @returns {import("../src/internal/plural.js").Operands}
 */
function operandsForSample(token) {
  const compactSeparator = token.indexOf("c");
  if (compactSeparator < 0) return operandsFromDecimalText(token);
  return operandsFromDecimalText(token.slice(0, compactSeparator), {
    compactExponent: Number(token.slice(compactSeparator + 1)),
  });
}

test("CLDR 48.2 conformance: every cardinal sample classifies to its rule", { skip: conformanceSkip }, () => {
  const conformance = readJson(conformancePath);
  assert.equal(conformance.cldrVersion, "48.2", "conformance vectors are not the pinned CLDR version");

  let assertions = 0;
  let locales = 0;

  for (const group of conformance.cardinalRuleGroups) {
    for (const localeTag of group.locales) {
      locales++;
      for (const rule of group.rules) {
        for (const sample of rule.samples) {
          const actual = cardinalCategoryFor(operandsForSample(sample), localeTag);
          assert.equal(actual, rule.count, `locale ${localeTag}, sample ${sample}, rule ${rule.condition}`);
          assertions++;
        }
      }
    }
  }

  assert.ok(locales >= 200, `expected the full CLDR locale set, saw ${locales}`);
  assert.ok(assertions >= 10000, `expected a large sample gate, ran ${assertions} assertions`);
});

test("CLDR 48.2 conformance: rule text and locale membership match the pinned data", { skip: conformanceSkip }, () => {
  const conformance = readJson(conformancePath);

  // The generated `src/data/cardinal.js` must carry the same groups, in the same order, with the
  // same conditions -- otherwise the sample gate above is testing the wrong rules.
  const expected = conformance.cardinalRuleGroups.map((/** @type {any} */ group) => ({
    locales: group.locales,
    rules: group.rules.map((/** @type {any} */ rule) => [rule.count, rule.condition]),
  }));

  const actual = decodeCardinalRules().map((group) => ({
    locales: group.locales,
    rules: group.rules.map((rule) => [rule.count, rule.condition]),
  }));

  assert.deepEqual(actual, expected);
});

test("exact arithmetic survives magnitudes that break binary64", () => {
  // 10^20 is exactly representable as a double, 10^20 + 1 is not; the two must classify differently.
  assert.equal(cardinalCategoryFor(operandsFromNumber(10n ** 20n), "fr"), "many");
  assert.equal(cardinalCategoryFor(operandsFromNumber(10n ** 20n + 1n), "fr"), "other");
  assert.equal(cardinalCategoryFor(operandsFromNumber(10n ** 20n), "ru"), "many");
  assert.equal(cardinalCategoryFor(operandsFromNumber(10n ** 20n + 1n), "ru"), "one");

  // 2^53 and 2^53 - 1 sit either side of the safe-integer boundary.
  assert.equal(cardinalCategoryFor(operandsFromNumber(9007199254740991n), "ru"), "one");
  assert.equal(cardinalCategoryFor(operandsFromNumber(9007199254740992n), "ru"), "few");
});

test("visible scale is part of the value", () => {
  const one = operandsFromDecimalText("1");
  const onePointZero = operandsFromDecimalText("1.0");

  assert.deepEqual(one, { n: "1", i: "1", v: 0, w: 0, f: "0", t: "0", c: 0, e: 0 });
  assert.deepEqual(onePointZero, { n: "1.0", i: "1", v: 1, w: 0, f: "0", t: "0", c: 0, e: 0 });

  assert.equal(cardinalCategoryFor(one, "en"), "one");
  assert.equal(cardinalCategoryFor(onePointZero, "en"), "other");

  // `n = 1` still matches 1.0, because a range entry whose bounds are equal is an exact comparison.
  assert.equal(cardinalCategoryFor(onePointZero, "hi"), "one");

  // A plain number cannot carry a trailing zero, so 1.0 strips back to v = 0.
  assert.equal(cardinalCategoryFor(operandsFromNumber(1.0), "en"), "one");

  // pt and pt-PT are separate rule groups and must never be merged.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("0.0"), "pt"), "one");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("0.0"), "pt-PT"), "other");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("0"), "pt"), "one");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("0"), "pt-PT"), "other");
});

test("operands derive f, t, v and w exactly", () => {
  assert.deepEqual(operandsFromDecimalText("2.150"), {
    n: "2.150",
    i: "2",
    v: 3,
    w: 2,
    f: "150",
    t: "15",
    c: 0,
    e: 0,
  });

  // The compact exponent shifts the mantissa before the operands are derived; c and e keep it.
  assert.deepEqual(operandsFromDecimalText("1.2", { compactExponent: 6 }), {
    n: "1200000",
    i: "1200000",
    v: 0,
    w: 0,
    f: "0",
    t: "0",
    c: 6,
    e: 6,
  });

  assert.deepEqual(operandsFromDecimalText("0.001", { compactExponent: 3 }), {
    n: "1",
    i: "1",
    v: 0,
    w: 0,
    f: "0",
    t: "0",
    c: 3,
    e: 3,
  });

  // A negative value is evaluated by its absolute value.
  assert.equal(operandsFromDecimalText("-1.25").n, "1.25");
  assert.equal(operandsFromNumber(-2n).n, "2");
});

test("operands supplied by a caller are accepted as-is", () => {
  // The Operands record is the module boundary: another module may build one and hand it back.
  // Everything the evaluator needs must be reconstructible from the record's own fields.
  /** @type {import("../src/internal/plural.js").Operands} */
  const compactMillion = { n: "1000000", i: "1000000", v: 0, w: 0, f: "0", t: "0", c: 6, e: 6 };
  assert.equal(cardinalCategoryFor(compactMillion, "fr"), "many");

  // Same mantissa and same n, but the exponent is inside `e = 0..5`, so `many` no longer fires.
  const withinRange = { ...compactMillion, c: 5, e: 5 };
  assert.equal(cardinalCategoryFor(withinRange, "fr"), "other");

  // A hand-built record with a fractional n round-trips its own visible scale through `n`.
  assert.equal(cardinalCategoryFor({ n: "1.0", i: "1", v: 1, w: 0, f: "0", t: "0", c: 0, e: 0 }, "en"), "other");

  assert.throws(() => cardinalCategoryFor({ ...compactMillion, i: "one million" }, "fr"), {
    message: "Operand must be an integer digit string, but was 'one million'",
  });
});

test("locale lookup walks the CLDR candidate chain", () => {
  // language-Script-REGION, then language-Script, then language-REGION, then language.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1.5"), "pt-Latn-PT"), "other");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1.5"), "pt-BR"), "one");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "kok-Latn"), "one");

  // Case is normalized the way BCP-47 canonicalization would.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1.5"), "PT-latn-pt"), "other");

  // A tag with no language subtag falls back to the undetermined rules.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "und"), "other");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "x-acme"), "other");

  // A deprecated language code resolves through its CLDR replacement.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "iw"), "one");

  // The four rule-table locales that are themselves CLDR alias sources must keep answering, even
  // though the walk canonicalizes them away before the lookup happens.
  for (const [alias, canonical] of [["jw", "jv"], ["sh", "sr"], ["tl", "fil"], ["mo", "ro"]]) {
    const aliasTag = /** @type {string} */ (alias);
    const canonicalTag = /** @type {string} */ (canonical);
    assert.equal(
      cardinalCategoryFor(operandsFromDecimalText("2"), aliasTag),
      cardinalCategoryFor(operandsFromDecimalText("2"), canonicalTag),
      aliasTag,
    );
  }
});

test("every locale in the generated rule data resolves to its own group", () => {
  const groups = decodeCardinalRules();

  for (const group of groups) {
    const signature = JSON.stringify(group.rules);
    for (const localeTag of group.locales) {
      const category = cardinalCategoryFor(operandsFromDecimalText("1"), localeTag);
      assert.ok(typeof category === "string", localeTag);

      // Confirm the locale actually landed in this group, not a same-answer neighbour.
      const matched = groups.find((candidate) => candidate.locales.includes(localeTag));
      assert.ok(matched !== undefined, localeTag);
      assert.equal(JSON.stringify(matched.rules), signature, localeTag);
    }
  }
});

test("unsupported locales and out-of-range inputs throw with the recorded messages", () => {
  assert.throws(
    () => cardinalCategoryFor(operandsFromNumber(1n), "zxx"),
    (error) => {
      assert.ok(error instanceof UnsupportedLocaleError);
      assert.equal(error.message, "Unsupported locale 'zxx' was provided");
      return true;
    },
  );

  assert.throws(() => operandsFromDecimalText("1", { compactExponent: -1 }), {
    message: "Compact exponent must be non-negative, but was -1",
  });
  assert.throws(() => operandsFromDecimalText("1", { compactExponent: 65 }), {
    message: "Compact exponent 65 exceeds the maximum of 64",
  });
  assert.throws(() => operandsFromDecimalText("1.5", { visibleDecimalPlaces: 0 }), {
    message: "Rounding necessary",
  });
  assert.throws(() => operandsFromNumber(Number.POSITIVE_INFINITY), {
    message: "Number must be finite, but was Infinity",
  });
  assert.throws(() => operandsFromNumber(Number.NaN), {
    message: "Number must be finite, but was NaN",
  });
  assert.throws(() => operandsFromDecimalText("not a number"), {
    message: "Invalid decimal text 'not a number'",
  });

  // The exponent may reach the documented default maximum without complaint.
  assert.equal(operandsFromDecimalText("1", { compactExponent: 64 }).e, 64);
});

test("no eval or Function constructor is used to evaluate rules", () => {
  const source = readFileSync(resolve(root, "src/internal/plural.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  assert.ok(!/\beval\s*\(/.test(source), "plural.js must not call eval");
  assert.ok(!/\bFunction\s*\(/.test(source), "plural.js must not use the Function constructor");
});

test("a well-formed language with no CLDR cardinal rules is rejected rather than defaulted", () => {
  // `zxx`, `qqq` and `latn` are all well-formed BCP-47 language subtags (Java's `isLanguage` accepts
  // 2..8 alpha, four letters included), so the walk finds no rules and reports the requested tag.
  for (const [tag, reported] of [
    ["zxx", "zxx"],
    ["qqq", "qqq"],
    ["Latn", "latn"],
  ]) {
    assert.throws(
      () => cardinalCategoryFor(operandsFromDecimalText("1"), /** @type {string} */ (tag)),
      (/** @type {unknown} */ error) => {
        assert.ok(error instanceof UnsupportedLocaleError, tag);
        assert.equal(error.message, `Unsupported locale '${reported}' was provided`);
        return true;
      },
      tag,
    );
  }
});

test("a tag with no language at all uses the undetermined rules, as Java's root fallback does", () => {
  // `Locale.forLanguageTag` drops an ill-formed tag entirely and reports `und`, and
  // `CldrPluralRules` then answers from the `root` rule group rather than throwing. This is
  // lokalized-java's `privateUseLocalesUseRootPluralRules` behavior, generalized.
  for (const tag of ["und", "root", "x-acme", "123", "en_US", ""]) {
    assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), tag), "other", tag);
  }

  // `en` would say `one` for the same operands, so these really are the undetermined rules.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "en"), "one");
});

test("every CLDR language alias classifies exactly like its canonical target", () => {
  // A transcription of lokalized-java's `generatedLanguageAliasesUseCanonicalPluralBehavior`:
  // plural-rule lookup canonicalizes the tag first, so `mo` must behave as `ro`, `sh` as `sr-Latn`,
  // `tl` as `fil`, `aa-Saaho` as `ssy` and the grandfathered `i-lux` as `lb`.
  const samples = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "20", "21",
    "100", "1000", "0.1", "1.0", "1.1", "2.0"];

  /** @param {string} tag */
  const classify = (tag) => {
    try {
      return samples.map((sample) => cardinalCategoryFor(operandsFromDecimalText(sample), tag)).join(",");
    } catch {
      return null;
    }
  };

  let compared = 0;

  for (const { from, to } of decodeLanguageAliases()) {
    const canonical = classify(to);
    // Java skips the comparison when the canonical locale has no cardinal rules of its own.
    if (canonical === null) continue;

    assert.equal(classify(from), canonical, `${from} -> ${to}`);
    compared++;
  }

  assert.ok(compared >= 200, `expected the alias table to exercise the walk, compared ${compared}`);

  // Spot-checks that would survive a table that silently compared nothing.
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("2"), "mo"), cardinalCategoryFor(operandsFromDecimalText("2"), "ro"));
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "i-lux"), "one");
  assert.equal(cardinalCategoryFor(operandsFromDecimalText("1"), "aa-Saaho"), "one");
  // `i-klingon` becomes `tlh`, for which CLDR ships no plural rules -- so it must throw naming the
  // rewritten tag, not fall back to `other`.
  assert.throws(() => cardinalCategoryFor(operandsFromDecimalText("1"), "i-klingon"), {
    message: "Unsupported locale 'tlh' was provided",
  });
});

test("builder options are validated before the number is converted", () => {
  // Java's `build()` rejects the compact exponent before `NumberUtils.toBigDecimal` ever sees the
  // number, so a non-finite double behind a bad exponent reports the exponent.
  assert.throws(() => operandsFromNumber(Number.NaN, { compactExponent: 65 }), {
    message: "Compact exponent 65 exceeds the maximum of 64",
  });

  // Decimal text is the caller's own `new BigDecimal(...)`, evaluated before the builder runs.
  assert.throws(() => operandsFromDecimalText("not a number", { compactExponent: 65 }), {
    message: "Invalid decimal text 'not a number'",
  });
});
