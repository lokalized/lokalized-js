// @ts-check
/**
 * The M4 gate for `lokalized/data/ordinal`.
 *
 * Every sample of every rule of every ordinal rule group in the pinned CLDR 48.2 conformance
 * vectors, under EVERY locale of that group — 2,645 assertions — driven three times through the
 * PUBLIC classifiers, never through the generated table or the internal rule interpreter they read:
 *
 *   1. `ordinalityForNumber(decimal(sample), locale)`   — the exact decimal-text path
 *   2. `ordinalityForOperands(pluralOperands(sample), locale)` — the explicit-operand path
 *   3. `ordinalityForNumber(Number(sample), locale)`    — the binary64 path
 *
 * 7,935 classifier calls in all. The third pass matters because it routes every sample through the
 * `Double.toString` port rather than through digit text, so a regression there cannot hide behind
 * the decimal path.
 *
 * Around the gate sit the behaviours the conformance vectors cannot show, because they contain only
 * rows that exist: the undetermined-group fallback for a locale with cardinal rules and no ordinal
 * ones, the empty-array-versus-throw asymmetry at an unsupported locale, and the ordinal category
 * sets recorded in the behavioral corpus — which is the corpus's sharpest evidence that the ordinal
 * table is not the cardinal one wearing a different name.
 *
 * Every ordinal case the behavioral corpus recorded from a running lokalized-java also runs here,
 * value by value -- 17 of them at the time of writing, including the ones that recorded a THROW. They are the only oracle in the repo for what happens at 2^53 and past
 * `Long.MAX_VALUE`, and for the fact that a Java `long` and a Java `double` holding the same digits
 * are two different questions — the samples above cannot reach any of that, because CLDR's ordinal
 * samples are 111 bare integers and (as asserted below, from the shipped rules) never could be.
 *
 * Every assertion runs with `Intl.PluralRules` and `Intl.NumberFormat` deleted from the host, which
 * is the M4 requirement that the answers come from pinned CLDR data and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, dirname, resolve } from "node:path";

import { decode as decodeOrdinalRules } from "../src/data/ordinal-rules.js";
import {
  getSupportedOrdinalityLocaleTags,
  ordinalData,
  ordinalityForNumber,
  ordinalityForOperands,
  supportedOrdinalitiesForLocale,
} from "../src/data/ordinal.js";
import {
  CARDINALITY_ONE,
  cardinalityForNumber,
  ORDINALITY_FEW,
  ORDINALITY_MANY,
  ORDINALITY_ONE,
  ORDINALITY_OTHER,
  ORDINALITY_TWO,
  ORDINALITY_ZERO,
  decimal,
  pluralOperands,
} from "../src/index.js";

const root = new URL("../", import.meta.url).pathname;
const specDir = process.env.LOKALIZED_SPEC_DIR ? resolve(process.env.LOKALIZED_SPEC_DIR) : resolve(root, "../lokalized-spec");

/** @type {any} */
let vectors = null;
/** @type {any} */
let dataLock = null;
/** @type {any} */
let corpus = null;
try {
  vectors = JSON.parse(
    readFileSync(resolve(specDir, "vendor/lokalized-java/src/build/resources/cldr/cldr-conformance-vectors.json"), "utf8"),
  );
  dataLock = JSON.parse(readFileSync(resolve(specDir, "generated/cldr-data-lock.json"), "utf8"));
  corpus = JSON.parse(readFileSync(resolve(specDir, "generated/behavioral-vectors.json"), "utf8"));
} catch {
  // Sibling spec checkout not present; the data-driven tests skip, as elsewhere in this suite.
}

const skip = vectors ? false : `CLDR conformance vectors not found under ${specDir}`;

/**
 * The host's own plural machinery, removed before a single assertion runs. lokalized answers from
 * pinned CLDR data or not at all; if any answer below came from ICU, this deletion would break it.
 */
const hostPluralRules = Reflect.get(Intl, "PluralRules");
Reflect.deleteProperty(Intl, "PluralRules");
Reflect.deleteProperty(Intl, "NumberFormat");

test("the host's Intl plural machinery really is absent for this file", () => {
  assert.ok(hostPluralRules, "the host was expected to HAVE Intl.PluralRules, so deleting it proves something");
  assert.equal(Reflect.get(Intl, "PluralRules"), undefined);
  assert.equal(Reflect.get(Intl, "NumberFormat"), undefined);
});

const ORDINALITY_BY_COUNT = /** @type {Record<string, any>} */ ({
  zero: ORDINALITY_ZERO,
  one: ORDINALITY_ONE,
  two: ORDINALITY_TWO,
  few: ORDINALITY_FEW,
  many: ORDINALITY_MANY,
  other: ORDINALITY_OTHER,
});

/** Assertion tallies, reported by the last test so the gate's size is a checked number. */
const counts = { decimalPath: 0, operandPath: 0, numberPath: 0, corpus: 0, fallback: 0, edge: 0 };

/* -------------------------------------------------------------------------- */
/* The gate                                                                   */
/* -------------------------------------------------------------------------- */

/** The shape of the corpus, pinned first: a filter bug that quietly halved the gate must be visible. */
function ordinalGroups() {
  const groups = vectors.ordinalRuleGroups;
  assert.equal(groups.length, 25, "ordinal rule group count");
  assert.equal(new Set(groups.flatMap((/** @type {any} */ g) => g.locales)).size, 108, "distinct ordinal locales");
  assert.equal(
    groups.reduce(
      (/** @type {number} */ total, /** @type {any} */ g) =>
        total + g.rules.reduce((/** @type {number} */ n, /** @type {any} */ r) => n + r.samples.length, 0),
      0,
    ),
    841,
    "distinct ordinal samples",
  );
  return groups;
}

test("every ordinal sample classifies to its rule, under every locale of its group", { skip }, () => {
  for (const group of ordinalGroups()) {
    for (const locale of group.locales) {
      for (const rule of group.rules) {
        for (const sample of rule.samples) {
          const expected = ORDINALITY_BY_COUNT[rule.count];
          assert.ok(expected, `unknown CLDR count '${rule.count}'`);
          assert.equal(
            ordinalityForNumber(decimal(sample), locale),
            expected,
            `locale ${locale}, sample ${sample}, rule '${rule.condition}'`,
          );
          counts.decimalPath++;
        }
      }
    }
  }

  assert.equal(counts.decimalPath, 2645, "the ordinal gate is 2,645 assertions; anything less is not the gate");
});

test("the same 2,645 assertions hold through the explicit-operand entry point", { skip }, () => {
  for (const group of ordinalGroups()) {
    for (const locale of group.locales) {
      for (const rule of group.rules) {
        for (const sample of rule.samples) {
          assert.equal(
            ordinalityForOperands(pluralOperands(sample), locale),
            ORDINALITY_BY_COUNT[rule.count],
            `locale ${locale}, sample ${sample}, rule '${rule.condition}'`,
          );
          counts.operandPath++;
        }
      }
    }
  }

  // EXACT, and it must stay exact. This loop is driven by the pinned CLDR 48.2 vectors, not by the
  // behavioral corpus: `ordinalGroups()` above already pins 25 groups, 108 locales and 841 samples
  // exactly, so this number cannot move without one of those moving first. A floor here would buy
  // nothing and would hide a filter that quietly stopped visiting a rule group.
  assert.equal(counts.operandPath, 2645, "the ordinal gate is 2,645 assertions; anything less is not the gate");
});

test("the same 2,645 assertions hold for a native number, through the Double.toString port", { skip }, () => {
  for (const group of ordinalGroups()) {
    for (const locale of group.locales) {
      for (const rule of group.rules) {
        for (const sample of rule.samples) {
          const value = Number(sample);
          assert.ok(Number.isSafeInteger(value), `sample ${sample} is not exactly representable`);
          assert.equal(
            ordinalityForNumber(value, locale),
            ORDINALITY_BY_COUNT[rule.count],
            `locale ${locale}, sample ${sample}, rule '${rule.condition}'`,
          );
          counts.numberPath++;
        }
      }
    }
  }

  assert.equal(counts.numberPath, 2645);
});

test("the generated ordinal table carries the pinned rules verbatim", { skip }, () => {
  // The gate above proves the classifier agrees with the vectors. This proves the SHIPPED table is
  // the one the vectors describe -- same groups, same order, same conditions, same locale
  // membership -- so the gate is not passing against a table that quietly diverged.
  const expected = vectors.ordinalRuleGroups.map((/** @type {any} */ group) => ({
    locales: group.locales,
    rules: group.rules.map((/** @type {any} */ rule) => [rule.count, rule.condition]),
  }));

  // Read as data, deliberately: this is the only place the file touches the generated module, and it
  // is comparing what the package ships against the corpus, not classifying with it.
  const generated = decodeOrdinalRules().map((group) => ({
    locales: group.locales,
    rules: group.rules.map((rule) => [rule.count, rule.condition]),
  }));

  assert.deepEqual(generated, expected);
});

/* -------------------------------------------------------------------------- */
/* Behaviour the vectors cannot show                                          */
/* -------------------------------------------------------------------------- */

/**
 * A corpus value, decoded into whatever the public API accepts.
 *
 * The Java TYPE is load-bearing and the corpus records it: `long` is an exact 64-bit integer and
 * must become a `bigint`, while `double` is a binary64 and must become a `number` — the corpus
 * carries a `long` row and a `double` row for the very same digits (2^53+1) precisely so a port
 * that collapses the two is caught. Anything that routed `long` through `Number()` would answer
 * TWO for both and pass exactly half of that pair.
 *
 * @param {any} value
 */
function corpusValue(value) {
  switch (value.$lokalized) {
    case "integer": return Number(value.value);
    case "long": case "bigint": return BigInt(value.value);
    case "double": case "float": return Number(value.value);
    case "decimal": return decimal(value.value);
    case "plural-operands":
      return pluralOperands(value.value, {
        ...(value.visibleDecimalPlaces !== undefined ? { visibleDecimalPlaces: value.visibleDecimalPlaces } : {}),
        ...(value.compactExponent !== undefined ? { compactExponent: value.compactExponent } : {}),
      });
    default:
      throw new Error(`the ordinal corpus grew a value kind this gate does not decode: ${value.$lokalized}`);
  }
}

/**
 * Java exception type -> the JS error name the port raises for it. The same mapping
 * `tools/conformance.mjs` applies; restated here so `npm test` alone compares the error KIND and not
 * just its message.
 */
const JAVA_ERROR_NAMES = new Map([
  ["com.lokalized.UnsupportedLocaleException", ["UnsupportedLocaleError"]],
  ["java.lang.IllegalArgumentException", ["TypeError", "RangeError"]],
  ["java.lang.ArithmeticException", ["RangeError"]],
]);

/**
 * Asserts that `error` is the JS counterpart of the Java exception a corpus case recorded.
 *
 * An unmapped Java type FAILS rather than passing vacuously: a corpus case that starts recording an
 * exception this file has never seen must stop the suite, not slip through an absent map entry.
 *
 * @param {any} error the error the port raised
 * @param {any} thrown the case's `expected.thrown` block
 * @param {string} id the case id, for the failure message
 */
function assertMatchesRecordedThrow(error, thrown, id) {
  assert.ok(error instanceof Error, `${id}: expected an Error`);
  assert.equal(error.message, thrown.message, `${id}: message`);
  const permitted = JAVA_ERROR_NAMES.get(thrown.type);
  assert.ok(permitted, `${id}: no JS counterpart recorded for ${thrown.type}`);
  assert.ok(permitted.includes(error.name), `${id}: ${error.name} is not one of ${permitted.join(", ")}`);
}

test("every ordinal case the behavioral corpus recorded from Java passes", { skip }, () => {
  // The conformance vectors are CLDR's own samples; THIS is lokalized-java's recorded behaviour at
  // the three ordinal entry points, and it reaches places the samples cannot: 2^53 and its
  // neighbours by three different carrier types, values past Long.MAX_VALUE, the compact exponent on
  // the ordinal operand path, `pt-PT` falling through to `pt` on an axis where the pt-PT rule bundle
  // does not exist, a locale with no ordinalities at all, a cardinal-only locale (`ckb`) answering
  // from the root ordinals, and `zxx` -- which has no rule bundle on either axis and throws. `npm run conformance` drives these
  // too; they are restated here so `npm test` alone cannot go green on a port that fails them.
  const recorded = corpus.cases.filter((/** @type {any} */ c) => /^(ordinality|supportedOrdinalities)/.test(c.operation));
  // A FLOOR, not an exact count: the exact form fails on corpus GROWTH, which is the one reason that
  // is unambiguously good news, while saying nothing about correctness. It is pinned at the corpus's
  // CURRENT size rather than the pre-M3b 15, because a floor's whole job is to catch a silent SHRINK
  // and 15 would let two of the cases below vanish unnoticed. Raise it when the corpus grows again.
  assert.ok(recorded.length >= 17, `expected at least 17 ordinal operation cases, saw ${recorded.length}`);

  for (const testCase of recorded) {
    const { operation, input, expected } = testCase;

    if (operation === "supportedOrdinalitiesForLocale") {
      assert.deepEqual(
        supportedOrdinalitiesForLocale(input.locale).map((form) => form.name),
        expected.classifications.map((/** @type {any} */ form) => form.name),
        testCase.id,
      );
    } else {
      const classify = operation === "ordinalityForOperands" ? ordinalityForOperands : ordinalityForNumber;

      // A case may record a THROW rather than a classification -- M3b added
      // `owed.m3b.cldr.ordinality-for-rules-less-locale-throws`, which is `zxx` (CLDR's "no
      // linguistic content"), a tag with no rule bundle on either axis. This branch is not a
      // relaxation: it is the same oracle comparison, on the outcome Java actually recorded. A
      // recorded throw must be met by a throw whose message is byte-identical to Java's, and a
      // recorded classification must still not throw -- the `assert.throws` below fails if the call
      // returns.
      if (expected.thrown !== undefined) {
        assert.throws(
          () => classify(/** @type {any} */ (corpusValue(input.value)), input.locale),
          (/** @type {any} */ error) => {
            assertMatchesRecordedThrow(error, expected.thrown, testCase.id);
            return true;
          },
          testCase.id,
        );
        counts.corpus++;
        continue;
      }

      const classified = classify(/** @type {any} */ (corpusValue(input.value)), input.locale);
      assert.equal(classified.name, expected.classification.name, testCase.id);
      assert.equal(classified.axis, expected.classification.axis, testCase.id);
      assert.equal(classified.renderName, expected.classification.renderName, testCase.id);
    }
    counts.corpus++;
  }
});

test("the ordinal category sets the behavioral corpus recorded", { skip }, () => {
  // The corpus's `warnings-ordinality-matrix` fixture exists to separate the two CLDR tables: it
  // parses one identical catalog under many locales and records, in each warning's message, the
  // ordinal forms Java said the locale supports. Those lists are the oracle here.
  const cases = corpus.cases.filter((/** @type {any} */ c) => c.fixture === "warnings-ordinality-matrix");
  // A FLOOR for the same reason as everywhere else in this file: the fixture is corpus data and may
  // gain locales. Zero would mean the fixture was renamed out from under this test, which is the
  // failure worth catching.
  assert.ok(cases.length >= 6, `the ordinality matrix fixture should carry at least six recorded locales, saw ${cases.length}`);

  for (const testCase of cases) {
    const expected = testCase.expected.parse ?? testCase.expected.load;
    for (const warning of expected.warnings) {
      assert.equal(warning.type, "INCOMPLETE_ORDINALITY_TRANSLATIONS");
      const recorded = /Supported forms are \[([^\]]+)\]/.exec(warning.message);
      assert.ok(recorded && recorded[1], `no supported-forms list in ${testCase.id}`);

      assert.deepEqual(
        supportedOrdinalitiesForLocale(warning.locale).map((form) => form.name),
        recorded[1].split(", "),
        `${testCase.id}: supported ordinalities for ${warning.locale}`,
      );
      counts.corpus++;
    }
  }

  // The fixture's two controls emit no warning, so their sets are recorded in the case notes
  // instead: `warnings.ordinality.ga-one-other-is-complete` and
  // `warnings.ordinality.ru-only-other-is-complete`. Both are the interesting direction -- a locale
  // whose ORDINAL set is strictly smaller than its cardinal one.
  assert.deepEqual(supportedOrdinalitiesForLocale("ga"), [ORDINALITY_ONE, ORDINALITY_OTHER]);
  assert.deepEqual(supportedOrdinalitiesForLocale("ru"), [ORDINALITY_OTHER]);
  counts.corpus += 2;
});

test("a locale with cardinal rules but no ordinal ones falls back to the undetermined group", { skip }, () => {
  // `CldrPluralRules.ordinalRulesForLocale`: this is a fallback, not an unsupported locale. 116 of
  // the 224 cardinal locales are in this state; `asa` and `bem` are two of them.
  const ordinalTags = new Set(vectors.ordinalRuleGroups.flatMap((/** @type {any} */ g) => g.locales));
  const cardinalTags = new Set(vectors.cardinalRuleGroups.flatMap((/** @type {any} */ g) => g.locales));
  const cardinalOnly = [...cardinalTags].filter((tag) => !ordinalTags.has(tag)).sort();
  assert.equal(cardinalOnly.length, 116, "cardinal locales with no ordinal rules of their own");

  for (const tag of cardinalOnly) {
    // The undetermined group's one rule is the unconditional `other`, so every value agrees.
    for (const value of [0, 1, 2, 3, 11, 101]) {
      assert.equal(ordinalityForNumber(value, tag), ORDINALITY_OTHER, `ordinality for ${value} in ${tag}`);
      counts.fallback++;
    }
    assert.deepEqual(supportedOrdinalitiesForLocale(tag), [ORDINALITY_OTHER], `supported ordinalities for ${tag}`);
    counts.fallback++;
  }
});

test("an unsupported locale throws to classify and answers empty to probe", () => {
  // Java's asymmetry: `Ordinality.forOperands` throws `UnsupportedLocaleException` while
  // `supportedOrdinalitiesForLocale` returns `Collections.emptySortedSet()`.
  for (const tag of ["xx", "qaa", "zxx"]) {
    assert.throws(
      () => ordinalityForNumber(1, tag),
      (/** @type {any} */ error) => {
        assert.equal(error.name, "UnsupportedLocaleError");
        assert.equal(error.message, `Unsupported locale '${tag}' was provided`);
        return true;
      },
      tag,
    );

    const supported = supportedOrdinalitiesForLocale(tag);
    assert.deepEqual(supported, []);
    assert.ok(Object.isFrozen(supported), "the empty probe result must be frozen");
    counts.edge += 2;
  }
});

test("lookup canonicalizes the requested tag, exactly as cardinal lookup does", () => {
  // `mo` is a CLDR alias for `ro`, and `en-GB` reaches `en` through the candidate walk. Neither tag
  // is a key in the ordinal table, and both must answer with the target's rules.
  assert.equal(ordinalityForNumber(1, "mo"), ORDINALITY_ONE); //   ro: n = 1
  assert.equal(ordinalityForNumber(2, "mo"), ORDINALITY_OTHER);
  assert.equal(ordinalityForNumber(2, "en-GB"), ORDINALITY_TWO); // en: n % 10 = 2 and n % 100 != 12
  assert.equal(ordinalityForNumber(2, "en-Latn-US"), ORDINALITY_TWO);
  assert.equal(ordinalityForNumber(12, "en-GB"), ORDINALITY_OTHER);
  assert.deepEqual(supportedOrdinalitiesForLocale("en-GB"), supportedOrdinalitiesForLocale("en"));
  counts.edge += 6;
});

test("exactness survives magnitudes and visible forms that binary64 destroys", () => {
  // 10^20 is exactly representable as a double and 10^20 + 1 is not, so a port that went through a
  // double here would answer `other` for both. English ordinals key on the last two digits.
  assert.equal(ordinalityForNumber(10n ** 20n, "en"), ORDINALITY_OTHER);
  assert.equal(ordinalityForNumber(10n ** 20n + 1n, "en"), ORDINALITY_ONE);
  assert.equal(ordinalityForNumber(10n ** 20n + 11n, "en"), ORDINALITY_OTHER); // n % 100 = 11
  assert.equal(ordinalityForNumber(decimal("100000000000000000003"), "en"), ORDINALITY_FEW);

  // A visible fractional part is not integer-valued, so a RANGE rejects it while a single exact
  // literal still accepts a trailing zero. `ne` is `one` for `n = 1..4`.
  assert.equal(ordinalityForNumber(2, "ne"), ORDINALITY_ONE);
  assert.equal(ordinalityForNumber(decimal("2.0"), "ne"), ORDINALITY_ONE);
  assert.equal(ordinalityForNumber(decimal("2.5"), "ne"), ORDINALITY_OTHER);
  assert.equal(ordinalityForNumber(decimal("1.0"), "en"), ORDINALITY_ONE); // n = 1 admits 1.0

  // The compact exponent shifts the displayed mantissa right BEFORE the operands are derived:
  // `1c6` is one million, whose English ordinal is `other`, not the `one` that `1` alone gives.
  assert.equal(ordinalityForNumber(1, "en"), ORDINALITY_ONE);
  assert.equal(ordinalityForOperands(pluralOperands("1", { compactExponent: 6 }), "en"), ORDINALITY_OTHER);
  assert.equal(ordinalityForOperands(pluralOperands("2.1", { compactExponent: 6 }), "en"), ORDINALITY_OTHER);
  assert.equal(ordinalityForOperands(pluralOperands("2.1", { compactExponent: 1 }), "en"), ORDINALITY_ONE); // 21

  // Negative values classify by their absolute value.
  assert.equal(ordinalityForNumber(-2, "en"), ORDINALITY_TWO);
  assert.equal(ordinalityForNumber(decimal("-3"), "en"), ORDINALITY_FEW);

  // `0` versus `0.0`: identical on this axis, and the test below says WHY that is not a gap.
  assert.equal(ordinalityForNumber(0, "cy"), ORDINALITY_ZERO); //          cy ordinal: n = 0
  assert.equal(ordinalityForNumber(decimal("0.0"), "cy"), ORDINALITY_ZERO);
  assert.equal(ordinalityForNumber(decimal("0.00"), "cy"), ORDINALITY_ZERO);
  counts.edge += 17;
});

test("no ordinal category can depend on visible decimals, and the shipped table says so", { skip }, () => {
  // Why the ordinal conformance samples are all bare integers -- 111 distinct values, not one with a
  // fraction or a compact exponent -- and why that is COMPLETE coverage rather than a hole: every
  // condition in the shipped ordinal table references `n` and `i` alone. `v`, `w`, `f`, `t`, `c` and
  // `e` never appear, so no visible form can move a value between ordinal categories, and the
  // sample set cannot be missing a case it has no way to express.
  //
  // Stated as an assertion over the DATA rather than as a comment, because it is the premise the
  // gate's shape rests on: if a future CLDR release adds an ordinal rule keyed on `v` or `c`, the
  // integer-only sample set silently stops being sufficient, and this is what says so out loud.
  const referenced = new Set();
  for (const group of decodeOrdinalRules())
    for (const rule of group.rules)
      for (const match of rule.condition.matchAll(/\b[a-z]\b/g)) referenced.add(match[0]);

  assert.deepEqual([...referenced].sort(), ["i", "n"], "ordinal rules reference only the n and i operands");

  const samples = new Set(
    vectors.ordinalRuleGroups.flatMap((/** @type {any} */ g) =>
      g.rules.flatMap((/** @type {any} */ r) => r.samples),
    ),
  );
  assert.equal(samples.size, 111);
  for (const sample of samples) assert.match(sample, /^\d+$/, `ordinal sample ${sample} is not a bare integer`);
});

test("only a tagged plural value is accepted, and a string never is", () => {
  // Plan 3.7: a raw JavaScript string is always text, even when it contains "1".
  for (const value of ["1", "one", null, undefined, {}, { $lokalized: "language-form" }, Number.NaN]) {
    assert.throws(() => ordinalityForNumber(/** @type {any} */ (value), "en"), /** @type {any} */ (Error), String(value));
    counts.edge++;
  }
});

test("the value is converted before the locale is looked up, as in Java and as on the root", () => {
  // `Ordinality.forNumber` is `forOperands(PluralOperands.forNumber(number).build(), locale)`, so
  // Java builds the operands before the locale is examined: given two bad arguments, the caller
  // hears about the VALUE. The root's `cardinalityForNumber` already evaluates in that order, and
  // the two axes disagreeing about which complaint wins is a difference a caller can see.
  const both = () => ordinalityForNumber(/** @type {any} */ ("1"), "xx");
  assert.throws(both, (/** @type {any} */ error) => {
    assert.equal(error.name, "TypeError", "the unusable value must out-throw the unsupported locale");
    return true;
  });

  assert.throws(
    () => cardinalityForNumber(/** @type {any} */ ("1"), "xx"),
    (/** @type {any} */ error) => {
      assert.equal(error.name, "TypeError", "the root is the reference for this ordering");
      return true;
    },
  );

  // With a usable value the locale complaint is still the one that surfaces.
  assert.throws(() => ordinalityForNumber(1, "xx"), /Unsupported locale/);
  counts.edge += 3;
});

test("classifiers return the root's own frozen ORDINALITY_* constants", () => {
  // Identity, not merely shape: `lokalized/data/ordinal` imports the constants from the root rather
  // than minting its own, so `===` against the exported constant holds for a consumer.
  const two = ordinalityForNumber(2, "en");
  assert.equal(two, ORDINALITY_TWO);
  assert.ok(Object.isFrozen(two));
  assert.equal(two.axis, "ordinality");
  assert.equal(two.renderName, "TWO", "renderName is the Java enum member's own name");
  assert.notEqual(/** @type {any} */ (two), CARDINALITY_ONE);

  const supported = supportedOrdinalitiesForLocale("cy");
  assert.ok(Object.isFrozen(supported));
  assert.deepEqual(supported, [
    ORDINALITY_ZERO,
    ORDINALITY_ONE,
    ORDINALITY_TWO,
    ORDINALITY_FEW,
    ORDINALITY_MANY,
    ORDINALITY_OTHER,
  ]);
  for (const form of supported) assert.equal(form.axis, "ordinality");
  counts.edge += 6;
});

test("the supported locale tags are the union of both tables, in serialized-tag order", { skip }, () => {
  // `CldrPluralRules.ordinalSupportedLocales` is the union of the cardinal and ordinal rule keys,
  // because of the undetermined-group fallback -- every cardinal locale is answerable for ordinals.
  const tags = getSupportedOrdinalityLocaleTags();
  const expected = [
    ...new Set([
      ...vectors.cardinalRuleGroups.flatMap((/** @type {any} */ g) => g.locales),
      ...vectors.ordinalRuleGroups.flatMap((/** @type {any} */ g) => g.locales),
    ]),
  ].sort();

  assert.deepEqual([...tags], expected);
  assert.equal(tags.length, 224);
  assert.ok(Object.isFrozen(tags));
  assert.ok(tags.includes("und"), "the undetermined group is published as `und`");
  assert.ok(!tags.includes("root"), "Java's internal `root` key is never published");
  assert.ok(!tags.includes("en-GB"), "the list is the directly represented tags, not every accepted tag");

  // Every published tag must actually answer, and never through an exception.
  for (const tag of tags) assert.ok(supportedOrdinalitiesForLocale(tag).length > 0, tag);
});

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

test("the module carries the pinned provenance, validated at construction", { skip }, () => {
  // Importing this module ran the construction-time check; had it failed, every test above would
  // have failed to import rather than answering wrongly at some later lookup.
  assert.equal(ordinalData.$lokalized, "ordinal-data");
  assert.ok(Object.isFrozen(ordinalData));
  assert.ok(Object.isFrozen(ordinalData.provenance));

  // Grounded in the spec repo's external lock, not in a copy of the generated module.
  assert.equal(ordinalData.provenance.cldrVersion, dataLock.cldrVersion);
  assert.equal(ordinalData.provenance.dataFingerprint, dataLock.dataFingerprint);
  assert.equal(ordinalData.provenance.cldrVersion, vectors.cldrVersion);
});

/**
 * The construction-time provenance check, exercised by actually breaking the pairing.
 *
 * The module is copied to a scratch file with its `./provenance.js` and/or `./ordinal-rules.js`
 * imports repointed at a deliberately wrong module, then imported. A check that only ever runs
 * against correct data proves nothing, so each substitution must make the import itself fail.
 *
 * @param {{ provenance?: string, rules?: string, root?: string }} substitutes replacement module source
 */
async function importOrdinalWith(substitutes) {
  const stamp = `${process.pid}-${scratchCounter++}`;
  const source = readFileSync(resolve(root, "src/data/ordinal.js"), "utf8");
  const written = [];

  /** @param {string} name @param {string} text */
  const write = (name, text) => {
    const file = resolve(root, `.tmp-${stamp}-${name}.mjs`);
    writeFileSync(file, text, "utf8");
    written.push(file);
    return `./${basename(file)}`;
  };

  // Relative specifiers are rewritten for the scratch file's depth, then the substituted ones are
  // repointed. Every replacement is asserted, so a rename in the module cannot silently defang this.
  let copy = source.replaceAll('from "../', 'from "./src/');
  assert.ok(copy.includes('from "./src/index.js"'), "the root import should have been rewritten");

  for (const [name, specifier, fallback] of [
    ["provenance", "./provenance.js", "./src/data/provenance.js"],
    ["rules", "./ordinal-rules.js", "./src/data/ordinal-rules.js"],
    ["root", "./src/index.js", "./src/index.js"],
  ]) {
    const substitute = /** @type {any} */ (substitutes)[name];
    const target = substitute === undefined ? fallback : write(name, substitute);
    assert.ok(copy.includes(`from "${specifier}"`), `${specifier} should be imported by the module`);
    copy = copy.replace(`from "${specifier}"`, `from "${target}"`);
  }

  const entry = resolve(root, `.tmp-${stamp}-ordinal.mjs`);
  writeFileSync(entry, copy, "utf8");
  written.push(entry);

  try {
    return await import(pathToFileURL(entry).href);
  } finally {
    for (const file of written) rmSync(file, { force: true });
  }
}

let scratchCounter = 0;

test("incompatible pinned data fails at construction, not at the first lookup", async () => {
  // The control: the same copy with nothing substituted must import cleanly, or the three failures
  // below would prove only that the harness is broken.
  const control = await importOrdinalWith({});
  assert.equal(control.ordinalityForNumber(2, "en").name, "ORDINALITY_TWO");

  /** @param {Promise<unknown>} imported @param {RegExp} message */
  const rejects = async (imported, message) => {
    await assert.rejects(imported, (/** @type {any} */ error) => {
      assert.equal(error.name, "ConfigurationError", `expected a ConfigurationError, got ${error.name}`);
      assert.equal(error.code, "CONFIGURATION");
      assert.match(error.message, message);
      return true;
    });
  };

  await rejects(
    importOrdinalWith({ provenance: 'export const decode = () => ({ cldrVersion: "forty-eight", dataFingerprint: "9b4f" });' }),
    /is not a CLDR version/,
  );

  await rejects(
    importOrdinalWith({
      provenance: `export const decode = () => ({ cldrVersion: "48.2", dataFingerprint: "not-a-digest" });`,
    }),
    /not a SHA-256 digest/,
  );

  // The real cross-graph check: ordinal data from a CLDR release the root's cardinal table predates
  // carries locales the root has never heard of. `xyz` stands in for such a locale.
  await rejects(
    importOrdinalWith({
      rules: 'export const decode = () => ([{ locales: ["und", "xyz"], rules: [{ count: "other", condition: "" }] }]);',
    }),
    /carries locales the root does not know: xyz/,
  );

  // And the data-shape checks that keep a truncated table from answering confidently.
  await rejects(
    importOrdinalWith({ rules: 'export const decode = () => ([{ locales: ["und"], rules: [{ count: "one", condition: "n = 1" }] }]);' }),
    /does not end in unconditional 'other'/,
  );

  await rejects(
    importOrdinalWith({ rules: 'export const decode = () => ([{ locales: ["en"], rules: [{ count: "other", condition: "" }] }]);' }),
    /has no 'und' group to fall back to/,
  );

  await rejects(
    importOrdinalWith({
      rules: 'export const decode = () => ([{ locales: ["und"], rules: [{ count: "plenty", condition: "" }] }]);',
    }),
    /'plenty' is not a CLDR ordinal category/,
  );

  // Plan 3.7 rejects forged or mismatched (axis, name) tuples. A root whose ORDINALITY_* constants
  // are not ordinality constants is a mispaired module, and the classifier must never hand a
  // caller a value off the wrong axis.
  const wrongAxis = ["ZERO", "ONE", "TWO", "FEW", "MANY", "OTHER"]
    .map(
      (member) =>
        `export const ORDINALITY_${member} = Object.freeze({ $lokalized: "language-form", ` +
        `axis: "cardinality", name: "ORDINALITY_${member}", renderName: "${member}" });`,
    )
    .join("\n");
  await rejects(importOrdinalWith({ root: wrongAxis }), /did not supply the ORDINALITY_ZERO language form/);
});

test("the root graph never reaches the ordinal table", () => {
  // The invariant that makes this module OPTIONAL. `npm run scenario:0a` ratchets the same fact by
  // module count; this states it directly, and names the file that must never appear.
  const seen = new Set();
  const queue = [resolve(root, "src/index.js")];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const specifier = match[1];
      if (specifier !== undefined) queue.push(resolve(dirname(file), specifier));
    }
  }

  for (const forbidden of ["src/data/ordinal.js", "src/data/ordinal-rules.js"]) {
    assert.ok(!seen.has(resolve(root, forbidden)), `${forbidden} must not be reachable from the root entry point`);
  }
  assert.ok(seen.has(resolve(root, "src/internal/plural.js")), "the walk should have found the shared engine");
});

test("the gate ran the number of assertions it claims", { skip }, () => {
  // The five keys below are pinned to fixed inputs -- the CLDR 48.2 conformance vectors and this
  // file's own hand-written edges -- so an exact count is right for them: any movement is a real
  // change in what ran.
  const { corpus, ...pinned } = counts;
  assert.deepEqual(pinned, {
    decimalPath: 2645,
    operandPath: 2645,
    numberPath: 2645,
    fallback: 812,
    edge: 45,
  });

  // `corpus` is the exception, and it is a FLOOR. It counts assertions driven by the behavioral
  // corpus, which GROWS: M3b's owed cases took it 21 -> 23. The exact form fails on exactly the one
  // kind of change that is unambiguously good news, while saying nothing about correctness. What
  // the floor guards is what the exact count really guarded -- that the corpus-driven loops reached
  // the corpus rather than silently zero. Pinned at the current 23, not the pre-growth 21, so that a
  // shrink is caught too; raise it the next time the corpus grows.
  assert.ok(corpus >= 23, `corpus-driven assertions ${corpus} < 23`);
});
