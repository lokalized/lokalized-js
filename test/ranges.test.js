// @ts-check
/**
 * The M4 gate for `lokalized/data/ranges`.
 *
 * Every row of every cardinal-range group in the pinned CLDR conformance vectors, under every locale
 * of that group — 441 assertions — driven through the PUBLIC `cardinalityForRange`, never through
 * the generated table it reads. 441 is small enough that "every range row" means literally all of
 * them, so nothing here samples.
 *
 * Around that gate sit the three behaviours lokalized-java's `CldrPluralRules.cardinalityForRange`
 * distinguishes and the vectors alone cannot show, because the vectors only contain rows that exist:
 * an unsupported locale throws, a supported locale with no range group answers `end`, and a group
 * with no row for the pair also answers `end`. The second and third are pinned exhaustively over all
 * 36 ordered endpoint pairs.
 *
 * Three further groups of tests answer the questions a reviewer of this module has to ask:
 *
 *   - locale ACCEPTANCE is swept against the root's own classifier over every locale the pinned
 *     cardinal table names, plus a region subtag on each — because range lookup and cardinal lookup
 *     must resolve one shared candidate walk, and a sweep is what proves it rather than a spot check;
 *   - endpoints are COMPOSED from the exact classifier (`10n ** 20n`, `decimal("1.0")` against `1`,
 *     compact exponents, visible decimals), because "1–2" reaches this function through
 *     `cardinalityForNumber` in real use and the range answer inherits its exactness; and
 *   - the module's construction-time validation is FORCED to fail, by importing a copy of the module
 *     wired to deliberately wrong pinned data. A check that only ever runs against correct data
 *     proves nothing.
 *
 * Every assertion in this file runs with `Intl.PluralRules` and `Intl.NumberFormat` deleted from the
 * host, which is the M4 requirement that the answers come from pinned CLDR data and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { cardinalRangeData, cardinalityForRange } from "../src/data/ranges.js";
import {
  CARDINALITY_FEW,
  CARDINALITY_MANY,
  CARDINALITY_ONE,
  CARDINALITY_OTHER,
  CARDINALITY_TWO,
  CARDINALITY_ZERO,
  ORDINALITY_ONE,
  cardinalityForNumber,
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
const hostNumberFormat = Reflect.get(Intl, "NumberFormat");
Reflect.deleteProperty(Intl, "PluralRules");
Reflect.deleteProperty(Intl, "NumberFormat");

test("the host's Intl plural machinery really is absent for this file", () => {
  assert.ok(hostPluralRules, "the host was expected to HAVE Intl.PluralRules, so deleting it proves something");
  assert.equal(Reflect.get(Intl, "PluralRules"), undefined);
  assert.equal(Reflect.get(Intl, "NumberFormat"), undefined);
});

const CARDINALITY_BY_CATEGORY = /** @type {Record<string, any>} */ ({
  zero: CARDINALITY_ZERO,
  one: CARDINALITY_ONE,
  two: CARDINALITY_TWO,
  few: CARDINALITY_FEW,
  many: CARDINALITY_MANY,
  other: CARDINALITY_OTHER,
});

const CATEGORIES = /** @type {const} */ (["zero", "one", "two", "few", "many", "other"]);

/** Assertion tallies, reported by the last test so the gate's size is a checked number. */
const counts = { gate: 0, missingRow: 0, noGroup: 0, alias: 0, corpus: 0, parity: 0, exact: 0, config: 0, edge: 0 };

/* -------------------------------------------------------------------------- */
/* The gate                                                                   */
/* -------------------------------------------------------------------------- */

test("every cardinal-range row classifies under every locale of its group", { skip }, () => {
  // The corpus shape is pinned first: a filter bug that quietly halved the gate would otherwise be
  // invisible, and "441 assertions" is the claim this file exists to support.
  const groups = vectors.cardinalRangeGroups;
  assert.equal(groups.length, 22, "cardinal-range group count");
  assert.equal(new Set(groups.flatMap((/** @type {any} */ g) => g.locales)).size, 91, "distinct range locales");
  assert.equal(
    groups.reduce((/** @type {number} */ total, /** @type {any} */ g) => total + g.ranges.length, 0),
    175,
    "distinct range rows",
  );

  for (const group of groups) {
    for (const locale of group.locales) {
      for (const row of group.ranges) {
        const start = CARDINALITY_BY_CATEGORY[row.start];
        const end = CARDINALITY_BY_CATEGORY[row.end];
        const expected = CARDINALITY_BY_CATEGORY[row.result];
        assert.ok(start && end && expected, `unknown category in row ${row.start}..${row.end} -> ${row.result}`);

        const actual = cardinalityForRange(start, end, locale);

        // Identity, not just equality: plan 3.7 says classification functions return the same frozen
        // tagged constants the root exports, so `===` is the contract and `deepEqual` would hide a
        // module that rebuilt its own lookalike constants.
        assert.equal(
          actual,
          expected,
          `${locale}: ${row.start}..${row.end} expected ${row.result}, got ${actual?.renderName?.toLowerCase()}`,
        );
        counts.gate += 1;
      }
    }
  }

  assert.equal(counts.gate, 441, "every range row under every locale of its group");
});

/* -------------------------------------------------------------------------- */
/* What the vectors cannot show: the misses                                   */
/* -------------------------------------------------------------------------- */

test("a pair with no row in the locale's group takes the END cardinality", { skip }, () => {
  // `cardinality == null ? end : cardinality` in CldrPluralRules.cardinalityForRange. Exhaustive
  // over all 36 ordered pairs for one locale per group: the rows that exist re-confirm the gate, and
  // the ~500 that do not are the fallback, which no vector row can express.
  let missing = 0;

  for (const group of vectors.cardinalRangeGroups) {
    const locale = group.locales[0];
    const stated = new Map(group.ranges.map((/** @type {any} */ r) => [`${r.start} ${r.end}`, r.result]));

    for (const start of CATEGORIES) {
      for (const end of CATEGORIES) {
        const expectedCategory = stated.get(`${start} ${end}`) ?? end;
        assert.equal(
          cardinalityForRange(CARDINALITY_BY_CATEGORY[start], CARDINALITY_BY_CATEGORY[end], locale),
          CARDINALITY_BY_CATEGORY[expectedCategory],
          `${locale}: ${start}..${end}`,
        );
        counts.missingRow += 1;
        if (!stated.has(`${start} ${end}`)) missing += 1;
      }
    }
  }

  assert.equal(counts.missingRow, 22 * 36);
  assert.ok(missing > 400, `expected the fallback to be exercised heavily, it fired ${missing} times`);
});

test("a locale with cardinal rules but no range group takes the END cardinality", { skip }, () => {
  // CLDR states ranges for 91 of the 224 cardinal locales. The other 133 are not unsupported — they
  // answer, and the answer is always `end`. `localeRangesForLocale` returns an empty map and the
  // lookup misses; the throw upstream is keyed on the CARDINAL table, which these locales are in.
  //
  // `mo` is the one exception in the whole set and it is not an exception to the rule: CLDR
  // canonicalizes Moldovan to Romanian before any lookup, so `mo` reaches `ro`'s range group and is
  // pinned against `ro` in the next test instead.
  const rangeLocales = new Set(vectors.cardinalRangeGroups.flatMap((/** @type {any} */ g) => g.locales));
  const cardinalLocales = new Set(vectors.cardinalRuleGroups.flatMap((/** @type {any} */ g) => g.locales));
  // `und` is in this set: it has cardinal rules (the root group) and no range group, so it answers
  // with the end like the other 132 rather than throwing.
  const withoutRanges = [...cardinalLocales].filter((l) => !rangeLocales.has(l) && l !== "mo").sort();

  assert.equal(withoutRanges.length, 132, "cardinal locales with no range group, `mo` aside");

  for (const locale of withoutRanges) {
    for (const start of CATEGORIES) {
      for (const end of CATEGORIES) {
        assert.equal(
          cardinalityForRange(CARDINALITY_BY_CATEGORY[start], CARDINALITY_BY_CATEGORY[end], locale),
          CARDINALITY_BY_CATEGORY[end],
          `${locale}: ${start}..${end}`,
        );
        counts.noGroup += 1;
      }
    }
  }

  assert.equal(counts.noGroup, 132 * 36);
});

test("`mo` reaches `ro`'s range group, because range lookup canonicalizes first", { skip }, () => {
  // The only cardinal locale outside the 91 that still resolves to a group. Plural-rule lookup
  // canonicalizes the requested tag where the catalog loader deliberately does not, and ranges use
  // the same ladder — so `mo` must answer exactly as `ro` does, on all 36 ordered pairs.
  for (const start of CATEGORIES) {
    for (const end of CATEGORIES) {
      assert.equal(
        cardinalityForRange(CARDINALITY_BY_CATEGORY[start], CARDINALITY_BY_CATEGORY[end], "mo"),
        cardinalityForRange(CARDINALITY_BY_CATEGORY[start], CARDINALITY_BY_CATEGORY[end], "ro"),
        `mo vs ro: ${start}..${end}`,
      );
      counts.alias += 1;
    }
  }

  // And it is a real difference, not a vacuous one: `ro` does not simply answer `end` everywhere.
  assert.equal(cardinalityForRange(CARDINALITY_FEW, CARDINALITY_ONE, "mo"), CARDINALITY_FEW);
  counts.alias += 1;
});

test("a locale with no cardinal rules at all throws, rather than answering with the end", () => {
  // The third behaviour, and the one that differs. `xx` is well-formed and has no CLDR rules.
  for (const locale of ["xx", "qqq", "zz"]) {
    assert.throws(
      () => cardinalityForRange(CARDINALITY_ONE, CARDINALITY_OTHER, locale),
      (/** @type {any} */ error) => error.name === "UnsupportedLocaleError" && error.localeTag === locale,
      `${locale} should be unsupported`,
    );
    counts.edge += 1;
  }
});

/* -------------------------------------------------------------------------- */
/* Locale acceptance, swept                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of a call as a comparable string: `"ok"`, or the error's name.
 *
 * @param {() => unknown} call
 * @returns {string}
 */
function outcomeOf(call) {
  try {
    call();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
}

test("locale acceptance matches the root cardinal classifier over every pinned locale", { skip }, () => {
  // Ranges and cardinals resolve the SAME candidate list in Java (two independent walks over one
  // `localeCandidates` result), and in this port they resolve the same table factory. Any tag the
  // root classifier accepts, this must accept; any tag it rejects, this must reject with the same
  // error name. A divergent locale walk is the single most likely defect in an optional data module,
  // so this is swept over every locale the pinned cardinal table names — each bare, and each with a
  // region subtag appended — rather than spot-checked.
  const cardinalLocales = [...new Set(vectors.cardinalRuleGroups.flatMap((/** @type {any} */ g) => g.locales))].sort();
  assert.equal(cardinalLocales.length, 224, "pinned cardinal locales");

  /** @type {string[]} */
  const tags = [];
  for (const locale of cardinalLocales) tags.push(String(locale), `${locale}-001`);
  tags.push(
    "en-US", "en-Latn-US", "pt-PT", "pt-BR", "zh-Hant-TW", "sr-Cyrl", "mo", "mo-MD", "iw", "in",
    "und-US", "root", "no-NO", "yue-Hans", "xx", "xx-YY", "qaa", "zz-ZZ-ZZZZ", "i-klingon", "sh",
    // Ill-formed tags are deliberately in the sweep. Neither function rejects them: the port follows
    // `Locale.forLanguageTag`, which yields the undetermined locale rather than throwing, and the
    // undetermined locale HAS cardinal rules. What matters is that both agree on that, too.
    "en-", "-en", "e", "toolongtobealanguage", "en--US", "", "x-private", "en_US",
    // Non-strings are the one input either function refuses outright.
    /** @type {any} */ (undefined), /** @type {any} */ (null), /** @type {any} */ (5),
    /** @type {any} */ ({ toString: () => "en" }),
  );

  /** @type {Set<string>} */
  const outcomes = new Set();

  for (const tag of tags) {
    const rootOutcome = outcomeOf(() => cardinalityForNumber(1, tag));
    const rangeOutcome = outcomeOf(() => cardinalityForRange(CARDINALITY_ONE, CARDINALITY_OTHER, tag));

    assert.equal(rangeOutcome, rootOutcome, `locale acceptance differs for '${String(tag)}'`);
    outcomes.add(rootOutcome);
    counts.parity += 1;
  }

  // The sweep must not be vacuously green: it has to contain acceptance, an unsupported locale and a
  // rejected input, or "they agree" would be a statement about nothing.
  assert.deepEqual([...outcomes].sort(), ["TypeError", "UnsupportedLocaleError", "ok"]);
  assert.equal(counts.parity, 224 * 2 + 32);
});

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

test("endpoints must be CARDINALITY_* values; a raw string is text, not a language form", () => {
  for (const raw of ["one", "OTHER", "CARDINALITY_ONE"]) {
    assert.throws(
      () => cardinalityForRange(/** @type {any} */ (raw), CARDINALITY_OTHER, "en"),
      TypeError,
      `${raw} must not be accepted as a start endpoint`,
    );
    assert.throws(
      () => cardinalityForRange(CARDINALITY_ONE, /** @type {any} */ (raw), "en"),
      TypeError,
      `${raw} must not be accepted as an end endpoint`,
    );
    counts.edge += 2;
  }
});

test("a value on the wrong axis is rejected rather than read as its cardinal namesake", () => {
  assert.throws(() => cardinalityForRange(/** @type {any} */ (ORDINALITY_ONE), CARDINALITY_OTHER, "en"), TypeError);
  assert.throws(() => cardinalityForRange(CARDINALITY_ONE, /** @type {any} */ (ORDINALITY_ONE), "en"), TypeError);
  counts.edge += 2;

  // Structural recognition has to require the axis AND the name to agree, not either one. A record
  // whose halves disagree cannot have come from the root's own constants, so it is a corrupted or
  // forged value and not a `CARDINALITY_ONE` that lost its axis on the way through a boundary.
  const forged = { $lokalized: "language-form", axis: "ordinality", name: "CARDINALITY_ONE" };
  assert.throws(() => cardinalityForRange(/** @type {any} */ (forged), CARDINALITY_OTHER, "en"), TypeError);
  assert.throws(() => cardinalityForRange(CARDINALITY_ONE, /** @type {any} */ (forged), "en"), TypeError);
  counts.edge += 2;
});

test("non-language-form values are rejected without the error itself throwing", () => {
  const cyclic = /** @type {any} */ ({ $lokalized: "language-form", axis: "cardinality" });
  cyclic.self = cyclic;

  for (const value of [null, undefined, 1, 1n, "1", Symbol("one"), [], {}, cyclic, { $lokalized: "decimal", value: "1" }]) {
    assert.throws(
      () => cardinalityForRange(/** @type {any} */ (value), CARDINALITY_OTHER, "en"),
      TypeError,
      `${String(value)} must be rejected`,
    );
    counts.edge += 1;
  }
});

test("a bad endpoint is rejected before the locale is even looked at", () => {
  // Java's `requireNonNull(start)` runs before the locale gate, so an unsupported locale does not get
  // to convert an endpoint mistake into an UnsupportedLocaleException.
  assert.throws(() => cardinalityForRange(/** @type {any} */ ("one"), CARDINALITY_OTHER, "xx"), TypeError);
  assert.throws(() => cardinalityForRange(/** @type {any} */ ("one"), CARDINALITY_OTHER, "en--US"), TypeError);
  counts.edge += 2;
});

test("a structurally equivalent endpoint survives JSON, structuredClone and a bare record", () => {
  // The constants are declared structurally recognizable, so a value that crossed a worker, an RSC
  // boundary or a JSON round trip still selects. Note the bare record carries no `renderName`, which
  // is exactly the shape the behavioral corpus uses for its own range inputs.
  const viaJson = JSON.parse(JSON.stringify(CARDINALITY_ONE));
  const viaClone = structuredClone({ ...CARDINALITY_FEW });
  const bare = { $lokalized: "language-form", axis: "cardinality", name: "CARDINALITY_ONE" };

  assert.equal(cardinalityForRange(viaJson, viaClone, "ru"), CARDINALITY_FEW);
  assert.equal(cardinalityForRange(bare, CARDINALITY_FEW, "ru"), CARDINALITY_FEW);
  assert.equal(cardinalityForRange(bare, CARDINALITY_OTHER, "en"), CARDINALITY_OTHER);
  counts.edge += 3;
});

/* -------------------------------------------------------------------------- */
/* Endpoints composed from the exact classifier                               */
/* -------------------------------------------------------------------------- */

test("endpoints composed from exact values carry the exactness into the range answer", { skip }, () => {
  // In real use "1–2 books" reaches this function as two `cardinalityForNumber` results, so the
  // distinctions the exact path exists to preserve have to survive the composition: `1` is not
  // `1.0` (they differ in `v`), `10n ** 20n` is past binary64's exact range, and a compact exponent
  // or an explicit visible-decimal count changes the endpoint's own category.
  //
  // Expected range results are read from the pinned vectors rather than written down here, so this
  // test cannot drift from the table the gate above checks.

  /** @param {string} locale @param {string} start @param {string} end */
  const expected = (locale, start, end) => {
    const group = vectors.cardinalRangeGroups.find((/** @type {any} */ g) => g.locales.includes(locale));
    const row = group?.ranges.find((/** @type {any} */ r) => r.start === start && r.end === end);
    return CARDINALITY_BY_CATEGORY[row ? row.result : end];
  };

  // `1` and `1.0` are two different endpoints in English, and the range they bound is `other`.
  const one = cardinalityForNumber(1, "en");
  const oneDotZero = cardinalityForNumber(decimal("1.0"), "en");
  assert.equal(one, CARDINALITY_ONE);
  assert.equal(oneDotZero, CARDINALITY_OTHER);
  assert.equal(cardinalityForRange(one, oneDotZero, "en"), expected("en", "one", "other"));
  assert.equal(cardinalityForRange(oneDotZero, one, "en"), expected("en", "other", "one"));
  counts.exact += 4;

  // `0` and `0.0`: both `other` in English, and `0–1 days` is the CLDR example where the end's own
  // cardinality (`one`) is NOT the range's.
  assert.equal(cardinalityForNumber(0, "en"), CARDINALITY_OTHER);
  assert.equal(cardinalityForNumber(decimal("0.0"), "en"), CARDINALITY_OTHER);
  assert.equal(cardinalityForRange(cardinalityForNumber(0, "en"), one, "en"), CARDINALITY_OTHER);
  assert.notEqual(cardinalityForRange(cardinalityForNumber(0, "en"), one, "en"), one);
  counts.exact += 4;

  // Past 2^53, exactly: 10^20 is `many` in Russian (i % 10 = 0) and `other` in English.
  const huge = 10n ** 20n;
  assert.equal(cardinalityForNumber(huge, "ru"), CARDINALITY_MANY);
  assert.equal(cardinalityForNumber(huge, "en"), CARDINALITY_OTHER);
  assert.equal(cardinalityForRange(CARDINALITY_ONE, cardinalityForNumber(huge, "ru"), "ru"), expected("ru", "one", "many"));
  assert.equal(
    cardinalityForRange(cardinalityForNumber(huge, "ru"), CARDINALITY_ONE, "ru"),
    expected("ru", "many", "one"),
  );
  counts.exact += 4;

  // A compact exponent shifts the displayed mantissa before the operands are derived, so `1c6` is
  // `other` in English where `1` is `one` — a different endpoint for the same numeric value.
  const compact = cardinalityForNumber(pluralOperands("1", { compactExponent: 6 }), "en");
  assert.equal(compact, CARDINALITY_OTHER);
  assert.equal(cardinalityForRange(one, compact, "en"), expected("en", "one", "other"));
  counts.exact += 2;

  // An explicit visible-decimal count does the same through `v`, without changing the value.
  const visible = cardinalityForNumber(pluralOperands("1", { visibleDecimalPlaces: 2 }), "en");
  assert.equal(visible, CARDINALITY_OTHER);
  assert.equal(cardinalityForRange(visible, one, "en"), expected("en", "other", "one"));
  counts.exact += 2;

  // And the Arabic table, which is the one with rows for every category, driven from real values.
  const zero = cardinalityForNumber(0, "ar");
  const two = cardinalityForNumber(2, "ar");
  const few = cardinalityForNumber(3, "ar");
  const many = cardinalityForNumber(11, "ar");
  assert.equal(zero, CARDINALITY_ZERO);
  assert.equal(two, CARDINALITY_TWO);
  assert.equal(few, CARDINALITY_FEW);
  assert.equal(many, CARDINALITY_MANY);
  assert.equal(cardinalityForRange(zero, two, "ar"), expected("ar", "zero", "two"));
  assert.equal(cardinalityForRange(two, few, "ar"), expected("ar", "two", "few"));
  assert.equal(cardinalityForRange(few, many, "ar"), expected("ar", "few", "many"));
  assert.equal(cardinalityForRange(many, few, "ar"), expected("ar", "many", "few"));
  counts.exact += 8;
});

/* -------------------------------------------------------------------------- */
/* Locale fallback                                                            */
/* -------------------------------------------------------------------------- */

test("range lookup walks the locale ladder and canonicalizes aliases", { skip }, () => {
  // `pt-PT` has no range group of its own and must reach `pt`; `mo` must reach `ro`; a region or
  // script subtag must never be able to turn an answer into a throw.
  assert.equal(cardinalityForRange(CARDINALITY_ONE, CARDINALITY_ONE, "pt-PT"), CARDINALITY_ONE);
  assert.equal(cardinalityForRange(CARDINALITY_ONE, CARDINALITY_ONE, "pt"), CARDINALITY_ONE);
  assert.equal(
    cardinalityForRange(CARDINALITY_ONE, CARDINALITY_FEW, "mo"),
    cardinalityForRange(CARDINALITY_ONE, CARDINALITY_FEW, "ro"),
  );
  assert.equal(cardinalityForRange(CARDINALITY_ONE, CARDINALITY_FEW, "ru-Cyrl-RU"), CARDINALITY_FEW);
  assert.equal(cardinalityForRange(CARDINALITY_ONE, CARDINALITY_FEW, "ru-UA"), CARDINALITY_FEW);
  counts.edge += 5;

  // The ladder is only ever asked for a bare language here, and that is a property of the data, not
  // an assumption: no range group is keyed by a script or region. Assert it, then check that every
  // group survives a region subtag.
  const keys = vectors.cardinalRangeGroups.flatMap((/** @type {any} */ g) => g.locales);
  assert.deepEqual(keys.filter((/** @type {string} */ k) => k.includes("-")), [], "range groups are keyed by language");
  counts.edge += 1;

  for (const group of vectors.cardinalRangeGroups) {
    for (const locale of group.locales) {
      const row = group.ranges[0];
      assert.equal(
        cardinalityForRange(CARDINALITY_BY_CATEGORY[row.start], CARDINALITY_BY_CATEGORY[row.end], `${locale}-001`),
        CARDINALITY_BY_CATEGORY[row.result],
        `${locale}-001 must inherit ${locale}'s range group`,
      );
      counts.edge += 1;
    }
  }
});

/* -------------------------------------------------------------------------- */
/* The Java oracle's own range cases                                          */
/* -------------------------------------------------------------------------- */

test("the behavioral corpus's recorded cardinalityForRange cases pass", { skip }, () => {
  // These are what an unmodified lokalized-java 3.0.0 actually returned, recorded case by case —
  // including `pt-flattening.range.pt-pt-inherits-pt-one-to-one`, whose note says a port that keyed
  // ranges by exact locale "would throw here".
  const cases = corpus.cases.filter((/** @type {any} */ c) => c.operation === "cardinalityForRange");
  // A FLOOR pinned at the corpus's CURRENT size: growth is fine, a silent shrink is not. M3b took
  // cardinalityForRange 3 -> 12, and at 3 nine of those could disappear without failing anything.
  assert.ok(cases.length >= 12, `expected the corpus to carry at least 12 range cases, found ${cases.length}`);

  for (const testCase of cases) {
    const { start, end, locale } = testCase.input;

    // A case may record a THROW rather than a classification. M3b added
    // `owed.m3b.cldr.range-for-rules-less-locale-throws` -- `zxx`, a tag with no cardinal rule
    // bundle at all -- which is the FIRST of the three behaviours this file's header names ("an
    // unsupported locale throws") to be pinned by the Java oracle rather than by hand. This branch
    // is not a relaxation: `assert.throws` fails if the call returns, so a recorded throw still has
    // to be a throw, with a message byte-identical to Java's.
    if (testCase.expected.thrown !== undefined) {
      assert.throws(
        () => cardinalityForRange(start, end, locale),
        (/** @type {any} */ error) => {
          assert.ok(error instanceof Error, `${testCase.id}: expected an Error`);
          assert.equal(error.message, testCase.expected.thrown.message, `${testCase.id}: message`);
          assert.equal(error.name, "UnsupportedLocaleError", `${testCase.id}: error kind`);
          assert.equal(
            testCase.expected.thrown.type,
            "com.lokalized.UnsupportedLocaleException",
            `${testCase.id}: this gate only knows the UnsupportedLocaleException counterpart`,
          );
          return true;
        },
        testCase.id,
      );
      counts.corpus += 1;
      continue;
    }

    // All three fields, not just `name`: the corpus records `axis` and `renderName` too, and they are
    // what separates a cardinal form from an ordinal one wearing the same category. Comparing `name`
    // alone would accept a port that answered on the wrong axis.
    const actual = cardinalityForRange(start, end, locale);
    assert.equal(actual?.name, testCase.expected.classification.name, testCase.id);
    assert.equal(actual?.axis, testCase.expected.classification.axis, `${testCase.id}: axis`);
    assert.equal(actual?.renderName, testCase.expected.classification.renderName, `${testCase.id}: renderName`);
    counts.corpus += 1;
  }
});

/* -------------------------------------------------------------------------- */
/* Provenance, and the validation that has to be able to fail                  */
/* -------------------------------------------------------------------------- */

test("cardinalRangeData carries the pinned provenance", { skip }, () => {
  assert.equal(cardinalRangeData.$lokalized, "cardinal-range-data");
  assert.ok(Object.isFrozen(cardinalRangeData));
  assert.ok(Object.isFrozen(cardinalRangeData.provenance));

  assert.equal(cardinalRangeData.provenance.cldrVersion, dataLock.cldrVersion);
  assert.equal(cardinalRangeData.provenance.dataFingerprint, dataLock.dataFingerprint);

  // The classifier and its provenance must describe the same CLDR release.
  assert.equal(cardinalRangeData.provenance.cldrVersion, vectors.cldrVersion);
});

test("the shipped range table is the pinned CLDR table, row for row", { skip }, async () => {
  // Provenance in the other direction: the fingerprint above says which data was generated, this
  // says the generated data was not edited afterwards.
  const { decode } = await import("../src/data/cardinal-ranges.js");
  const shipped = decode().map((g) => [g.locales, g.ranges.map((r) => [r.start, r.end, r.result])]);
  const pinned = vectors.cardinalRangeGroups.map((/** @type {any} */ g) => [
    g.locales,
    g.ranges.map((/** @type {any} */ r) => [r.start, r.end, r.result]),
  ]);

  assert.deepEqual(shipped, pinned);
});

let scratchCounter = 0;

/**
 * Imports a copy of `src/data/ranges.js` with its pinned-data imports repointed at substitutes.
 *
 * The module is copied to a scratch file at the repository root, its relative specifiers are
 * rewritten for that depth, and the named ones are replaced. Every rewrite is asserted, so a rename
 * inside the module cannot silently defang these tests by making the substitution a no-op.
 *
 * @param {{ provenance?: string, ranges?: string, rootEntry?: string }} substitutes replacement source
 */
async function importRangesWith(substitutes) {
  const stamp = `${process.pid}-${scratchCounter++}`;
  const source = readFileSync(resolve(root, "src/data/ranges.js"), "utf8");
  /** @type {string[]} */
  const written = [];

  /** @param {string} name @param {string} text */
  const write = (name, text) => {
    const file = resolve(root, `.tmp-${stamp}-${name}.mjs`);
    writeFileSync(file, text, "utf8");
    written.push(file);
    return `./${basename(file)}`;
  };

  let copy = source.replaceAll('from "../', 'from "./src/');
  assert.ok(copy.includes('from "./src/index.js"'), "the root import should have been rewritten");

  for (const [name, specifier, fallback] of [
    ["provenance", "./provenance.js", "./src/data/provenance.js"],
    ["ranges", "./cardinal-ranges.js", "./src/data/cardinal-ranges.js"],
    ["rootEntry", "./src/index.js", "./src/index.js"],
  ]) {
    const substitute = /** @type {any} */ (substitutes)[name];
    const target = substitute === undefined ? fallback : write(String(name), substitute);
    assert.ok(copy.includes(`from "${specifier}"`), `${specifier} should be imported by the module`);
    copy = copy.replace(`from "${specifier}"`, `from "${target}"`);
  }

  const entry = resolve(root, `.tmp-${stamp}-entry.mjs`);
  writeFileSync(entry, copy, "utf8");
  written.push(entry);

  try {
    return await import(pathToFileURL(entry).href);
  } finally {
    for (const file of written) rmSync(file, { force: true });
  }
}

/** The real pinned data, spelled as a substitute module — the control for every tamper below. */
const goodProvenance = (/** @type {string} */ version, /** @type {string} */ fingerprint) =>
  `export const decode = () => ({ cldrVersion: ${JSON.stringify(version)}, dataFingerprint: ${JSON.stringify(fingerprint)} });`;

/** @param {unknown} groups */
const rangesModule = (groups) => `export const decode = () => (${JSON.stringify(groups)});`;

test("the substitution harness itself works: correct substitutes still import and answer", { skip }, async () => {
  // Without this control, every "it threw" below could just as well mean "the rewrite broke the
  // copy". The copy is wired to hand-written but CORRECT data and must classify identically, with
  // the SAME frozen constants the root exports — the scratch module imports the same `src/index.js`.
  const module = await importRangesWith({
    provenance: goodProvenance(dataLock.cldrVersion, dataLock.dataFingerprint),
    ranges: rangesModule([{ locales: ["en"], ranges: [{ start: "one", end: "other", result: "other" }] }]),
  });

  assert.equal(module.cardinalRangeData.provenance.cldrVersion, dataLock.cldrVersion);
  assert.equal(module.cardinalityForRange(CARDINALITY_ONE, CARDINALITY_OTHER, "en"), CARDINALITY_OTHER);
  // A locale the substitute table does not carry still answers with the end rather than throwing.
  assert.equal(module.cardinalityForRange(CARDINALITY_ONE, CARDINALITY_FEW, "ru"), CARDINALITY_FEW);
  // And an unsupported locale still throws: the gate is the ROOT's cardinal table, not this data.
  assert.throws(() => module.cardinalityForRange(CARDINALITY_ONE, CARDINALITY_OTHER, "xx"), /Unsupported locale/);
  counts.config += 4;
});

test("construction fails loudly on pinned data that cannot be trusted", { skip }, async () => {
  const version = dataLock.cldrVersion;
  const fingerprint = dataLock.dataFingerprint;
  const table = [{ locales: ["en"], ranges: [{ start: "one", end: "other", result: "other" }] }];

  /** @type {[string, { provenance?: string, ranges?: string }, RegExp][]} */
  const tampered = [
    [
      "a fingerprint that is not a SHA-256 digest",
      { provenance: goodProvenance(version, "not-a-digest") },
      /fingerprint is not a SHA-256 digest/,
    ],
    [
      "a fingerprint truncated by a bad hand edit",
      { provenance: goodProvenance(version, fingerprint.slice(0, 63)) },
      /fingerprint is not a SHA-256 digest/,
    ],
    [
      "a CLDR version that is not a version",
      { provenance: goodProvenance("forty-eight", fingerprint) },
      /is not a CLDR version/,
    ],
    ["an empty range table", { ranges: rangesModule([]) }, /the cardinal range table is empty/],
    [
      "a group with no rows",
      { ranges: rangesModule([{ locales: ["en"], ranges: [] }]) },
      /has no rows/,
    ],
    [
      "a row naming a category CLDR does not have",
      { ranges: rangesModule([{ locales: ["en"], ranges: [{ start: "one", end: "lots", result: "other" }] }]) },
      /not a CLDR plural category/,
    ],
    [
      "a result naming a category CLDR does not have",
      { ranges: rangesModule([{ locales: ["en"], ranges: [{ start: "one", end: "other", result: "plenty" }] }]) },
      /not a CLDR plural category/,
    ],
    [
      "the same ordered pair stated twice",
      {
        ranges: rangesModule([
          {
            locales: ["en"],
            ranges: [
              { start: "one", end: "other", result: "other" },
              { start: "one", end: "other", result: "one" },
            ],
          },
        ]),
      },
      /states 'one'\.\.'other' twice/,
    ],
    [
      "one locale claimed by two groups",
      {
        ranges: rangesModule([
          { locales: ["en"], ranges: [{ start: "one", end: "other", result: "other" }] },
          { locales: ["en"], ranges: [{ start: "one", end: "other", result: "one" }] },
        ]),
      },
      /is claimed by range groups 0 and 1/,
    ],
    [
      "range data from a release the root's cardinal data does not know",
      {
        ranges: rangesModule([
          ...table,
          { locales: ["qqz"], ranges: [{ start: "one", end: "other", result: "other" }] },
        ]),
      },
      /does not pair with this root's cardinal data/,
    ],
  ];

  for (const [what, substitutes, message] of tampered) {
    await assert.rejects(
      () => importRangesWith(substitutes),
      (/** @type {any} */ error) =>
        error.name === "ConfigurationError" && error.code === "CONFIGURATION" && message.test(error.message),
      `${what} must be a construction-time ConfigurationError`,
    );
    counts.config += 1;
  }

  // The honest boundary of what "provenance validation" means today: a well-formed record from a
  // DIFFERENT CLDR release is accepted, because the root does not yet publish its own provenance for
  // this module to disagree with. Shape is checked; release pairing is checked only through the
  // locale cross-check above, which is what actually catches a mismatched pair in practice.
  const older = await importRangesWith({ provenance: goodProvenance("47.1", fingerprint) });
  assert.equal(older.cardinalRangeData.provenance.cldrVersion, "47.1");
  counts.config += 1;

  // The module also refuses to build against a ROOT that cannot supply the six constants it must
  // return by identity. That guard is unreachable with the real root, which is exactly why it is
  // worth firing here rather than trusting it.
  const sixConstants = ["ZERO", "ONE", "TWO", "FEW", "MANY", "OTHER"];
  /** @param {(member: string) => string} entry */
  const stubRoot = (entry) => sixConstants.map((member) => `export const CARDINALITY_${member} = ${entry(member)};`).join("\n");

  for (const [what, entry] of [
    ["one constant missing", (/** @type {string} */ m) => (m === "TWO" ? "undefined" : form(m))],
    ["a constant on the wrong axis", (/** @type {string} */ m) => (m === "FEW" ? form(m, "ordinality") : form(m))],
  ]) {
    await assert.rejects(
      () => importRangesWith({ rootEntry: stubRoot(/** @type {any} */ (entry)) }),
      (/** @type {any} */ error) =>
        error.name === "ConfigurationError" && /did not export the six CARDINALITY_\* constants/.test(error.message),
      `a root with ${what} must be a construction-time ConfigurationError`,
    );
    counts.config += 1;
  }
});

/**
 * One language-form record as source text, for the stub roots above.
 *
 * @param {string} member
 * @param {string} [axis]
 */
function form(member, axis = "cardinality") {
  return `Object.freeze({ $lokalized: "language-form", axis: ${JSON.stringify(axis)}, name: "CARDINALITY_${member}", renderName: ${JSON.stringify(member)} })`;
}

/* -------------------------------------------------------------------------- */
/* Source hygiene                                                             */
/* -------------------------------------------------------------------------- */

test("the module's source carries no invisible control characters", () => {
  // A raw C0 byte in a source file is invisible in a terminal, makes `grep` treat the file as
  // binary, and makes git decline to diff it. This module carried a literal NUL as a map-key
  // separator until it was replaced by an integer index; the check is here so it cannot come back.
  const source = readFileSync(resolve(root, "src/data/ranges.js"), "utf8");
  const offenders = [...source].filter((c) => c.codePointAt(0) < 32 && c !== "\n" && c !== "\t");

  assert.deepEqual(
    offenders.map((c) => `U+${c.codePointAt(0)?.toString(16).padStart(4, "0")}`),
    [],
    "src/data/ranges.js must be plain text",
  );
});

/* -------------------------------------------------------------------------- */
/* Graph isolation                                                            */
/* -------------------------------------------------------------------------- */

test("the root graph does not reach the range table", async () => {
  // The ratchet in tools/scenario-0a.mjs is the enforcement; this is the same rule stated where a
  // reader of this module will see it, and it fails on the specific import rather than on a byte
  // count that could be explained away.
  const seen = new Set();
  const queue = [resolve(new URL("../src/index.js", import.meta.url).pathname)];

  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) queue.push(resolve(dirname(file), match[1] ?? ""));
  }

  const forbidden = [...seen].filter((f) => /\/(cardinal-ranges|ranges)\.js$/.test(f));
  assert.deepEqual(forbidden, [], "the root graph must not reach the optional range modules");
});

/* -------------------------------------------------------------------------- */
/* The count                                                                  */
/* -------------------------------------------------------------------------- */

test("the gate ran the assertions it claims", { skip }, () => {
  assert.equal(counts.gate, 441, "CLDR conformance range assertions");
  assert.equal(counts.missingRow, 792, "all 36 ordered pairs for one locale per group");
  assert.equal(counts.noGroup, 4752, "all 36 ordered pairs for every cardinal locale with no group");
  assert.equal(counts.alias, 37, "mo pinned against ro");
  // A FLOOR, not an exact count: `counts.corpus` is driven by the behavioral corpus, which GROWS --
  // M3b's owed cases took cardinalityForRange 3 -> 12. Worse, the exact `3` had stopped meaning
  // anything: the loop above was aborting on the new `zxx` throw case, which happens to be the
  // fourth, so this assertion was reading a count produced by a FAILING test and calling it correct.
  // The floor guards what matters -- that the loop reached the corpus at all rather than zero cases.
  assert.ok(counts.corpus >= 12, `recorded lokalized-java cardinalityForRange cases: ${counts.corpus} < 12`);
  assert.equal(counts.parity, 480, "locale acceptance swept against the root classifier");
  assert.equal(counts.exact, 24, "endpoints composed from the exact classifier");
  assert.equal(counts.config, 17, "construction-time validation, forced to fail");
  assert.equal(counts.edge, 125, "endpoint and locale-ladder assertions");

  // The total is EXACT, expressed relative to the tallies asserted above. What the old fixed 6,671
  // caught was a tally key nothing accounts for -- a new counter added to `counts` and then never
  // checked. A floor loses exactly that: any unaccounted key only pushes the total UP and passes.
  // Written this way it survives corpus growth (the one term that moves is `counts.corpus`, which
  // has its own floor above) while still failing the moment a key appears that no line above names.
  const accounted =
    counts.gate +
    counts.missingRow +
    counts.noGroup +
    counts.alias +
    counts.corpus +
    counts.parity +
    counts.exact +
    counts.config +
    counts.edge;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.equal(total, accounted, "every tally key must be one the assertions above name; an unaccounted key lands here");

  Reflect.defineProperty(Intl, "PluralRules", { value: hostPluralRules, writable: true, configurable: true });
  Reflect.defineProperty(Intl, "NumberFormat", { value: hostNumberFormat, writable: true, configurable: true });
});
