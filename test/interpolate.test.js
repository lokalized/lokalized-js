// @ts-check

/**
 * `src/internal/interpolate.js` — driven directly against the behavioral corpus.
 *
 * The decisive family is `evaluation-locale.*`: every one of those translations names the category
 * actually selected, so a port that evaluated under the REQUESTED locale instead of the SUPPLYING
 * one fails loudly here (an English request served by an Arabic donor must still reach
 * `CARDINALITY_ZERO`, a category English does not have).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseCatalog } from "../src/internal/catalog.js";
import { compile, evaluate as evaluateCompiled } from "../src/internal/expression.js";
import { render } from "../src/internal/interpolate.js";
import { cardinalityForRange } from "../src/data/ranges.js";
import { ordinalData, ordinalityForNumber } from "../src/data/ordinal.js";
import * as root from "../src/index.js";

/** @type {Map<object, ReturnType<typeof compile>>} */
const COMPILED = new Map();

// `n == ORDINALITY_TWO` classifies a NUMBER, which needs the optional ordinal table. The evaluator
// takes it PER EVALUATION, the same way `createStrings` hands it over when the caller supplies
// `pluralData.ordinal`; a test that skipped this would silently under-cover the corpus.
const ORDINAL_CATEGORY_FOR_OPERANDS =
  /** @type {any} */ (ordinalData)[Symbol.for("lokalized.plural-data-runtime.v1")]
    .ordinalCategoryForOperands;

/**
 * Whether a case needs a `PhoneticResolver`, which this module deliberately does not have.
 *
 * Phonetics are the one axis that accepts a raw string, and it hands that string to a resolver
 * rather than reading it as a constant — in a placeholder AND in an expression operand. Both shapes
 * are out of scope here and neither is detectable from a parsed definition alone.
 *
 * @param {any} testCase
 * @returns {boolean}
 */
function needsPhoneticResolver(testCase) {
  const fixture = corpus.fixtures[testCase.fixture];
  return Boolean(fixture.phoneticResolver) || JSON.stringify(fixture.files ?? {}).includes("PHONETIC_");
}

/**
 * The render context core builds.
 *
 * `render` takes the ordinal and cardinal-range classifiers as INJECTED services rather than
 * importing them, because `lokalized/data/ordinal` and `lokalized/data/ranges` are optional modules
 * the root graph must not reach. A test is not in the root graph, so it may import them directly —
 * which is also the smallest possible check that the seam is wired the way core will wire it.
 *
 * @param {string} key
 * @param {string} evaluationLocale
 * @returns {import("../src/internal/interpolate.js").RenderContext}
 */
function contextFor(key, evaluationLocale) {
  return {
    key,
    evaluationLocale,
    // The shipping compiler and evaluator, wired the way core wires them: compiled once per
    // alternative node, evaluated against RAW caller input under the SUPPLYING locale.
    evaluateExpression: (alternative, values) => {
      const node = /** @type {{ expression: string }} */ (alternative);
      let compiled = COMPILED.get(alternative);

      if (compiled === undefined) {
        compiled = compile(node.expression);
        COMPILED.set(alternative, compiled);
      }

      return evaluateCompiled(compiled, values, evaluationLocale, {
        ordinalCategoryResolver: ORDINAL_CATEGORY_FOR_OPERANDS,
      });
    },
    ordinalityNameFor: (value, locale) =>
      ordinalityForNumber(/** @type {any} */ (value), locale).name,
    rangeCardinalityNameFor: (startName, endName, locale) =>
      cardinalityForRange(
        /** @type {any} */ (/** @type {any} */ (root)[startName]),
        /** @type {any} */ (/** @type {any} */ (root)[endName]),
        locale,
      ).name,
  };
}

/**
 * The sibling spec checkout, guarded.
 *
 * This read used to be BARE, so a clone without `../lokalized-spec` did not skip — it CRASHED the
 * whole file, and with it every self-contained test in it. CI hit exactly that. The other corpus
 * gates in this suite already guard the read and skip; these five did not, which is why five files
 * died while forty tests reported a tidy `# SKIP`.
 *
 * Skipping is only half the answer, and on its own it is the failure mode this project keeps
 * relearning: a suite that quietly shrinks has stopped gating. CI therefore checks out
 * `lokalized-spec` AND fails when ANY test skips, so the skip below can only ever be a local
 * convenience, never a green CI run that verified nothing.
 */
let corpus = null;
try {
  corpus = JSON.parse(
    readFileSync(new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url), "utf8"),
  );
} catch {
  // Sibling spec checkout not present.
}
const corpusSkip = corpus
  ? false
  : "behavioral vectors not found at ../lokalized-spec/generated/behavioral-vectors.json";

/** Unicode bidi isolate controls; isolation is not part of M2. */
const BIDI_ISOLATES = /[⁦-⁩]/;

/**
 * Corpus placeholder inputs carry Java's source type. Map each onto the JavaScript value the port
 * documents for it: integral Java types become `bigint`, `double` becomes `number`, and the exact
 * decimal / plural-operand / language-form records are already the JS wire format.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function decodeInputValue(value) {
  if (value === null || typeof value !== "object") return value;

  const record = /** @type {Record<string, any>} */ (value);

  switch (record["$lokalized"]) {
    case "integer":
    case "long":
    case "bigint":
      return BigInt(record["value"]);
    case "double":
      return Number(record["value"]);
    default:
      return value;
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} placeholders
 * @returns {Record<string, unknown>}
 */
function decodeInputs(placeholders) {
  return Object.fromEntries(
    Object.entries(placeholders ?? {}).map(([name, value]) => [name, decodeInputValue(value)]),
  );
}

/**
 * @param {any} definition
 * @returns {string | null} why M2 cannot render this entry, or null when it can
 */
function unsupportedReason(definition) {
  for (const placeholder of definition.placeholders.values()) {
    if (placeholder.kind === "expression") continue;

    if (placeholder.axis === "phonetic") return "phonetic (needs a PhoneticResolver)";
  }

  return null;
}

/**
 * @param {any} testCase
 * @returns {{ locale: string, catalog: Record<string, unknown> } | null}
 */
function donorFor(testCase) {
  const fixture = corpus.fixtures[testCase.fixture];
  const donor = testCase.expected.result?.resolvedLocale;

  if (typeof donor !== "string") return null;

  const catalog = fixture.files?.[donor];

  if (!catalog || !(testCase.input.key in catalog)) return null;

  return { locale: donor, catalog };
}

describe("render under the supplying locale (evaluation-locale corpus family)", { skip: corpusSkip }, () => {
  const cases = corpus.cases.filter(
    (/** @type {any} */ testCase) =>
      testCase.operation === "getResult" && testCase.fixture.startsWith("evaluation-locale"),
  );

  it("reproduces every translated evaluation-locale case it can render", () => {
    let rendered = 0;
    let arabicOnlyCategories = 0;
    /** @type {string[]} */
    const failures = [];

    for (const testCase of cases) {
      const expected = testCase.expected.result;

      if (expected.status !== "TRANSLATED") continue;
      if (BIDI_ISOLATES.test(expected.translation)) continue; // bidi isolation is out of scope here
      if (needsPhoneticResolver(testCase)) continue;

      const donor = donorFor(testCase);

      if (donor === null) continue;

      const definitions = parseCatalog(donor.catalog, {
        locale: donor.locale,
        source: donor.locale,
      });
      const definition = definitions.get(testCase.input.key);

      assert.ok(definition, `${testCase.id}: donor catalog is missing the key`);

      if (unsupportedReason(definition) !== null) continue;

      try {
        const actual = render(
            definition,
            decodeInputs(testCase.input.placeholders),
            contextFor(testCase.input.key, donor.locale),
          );

        if (actual !== expected.translation)
          failures.push(
            `${testCase.id}: got ${JSON.stringify(actual)}, want ` +
              `${JSON.stringify(expected.translation)}`,
          );
        else {
          ++rendered;
          if (/ZERO|TWO|FEW|MANY/.test(expected.translation) && donor.locale !== testCase.input.locale)
            ++arabicOnlyCategories;
        }
      } catch (error) {
        failures.push(
          `${testCase.id}: threw ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    assert.deepEqual(failures, [], "evaluation-locale cases that disagree with the corpus");
    // Pinned, not a floor: the corpus is a fixed artifact, so a drop here means the filter above
    // silently stopped selecting cases rather than that the corpus changed.
    assert.ok(rendered >= 110, `evaluation-locale rendered cases fell to ${rendered}`);
    // The whole point of the family: categories the REQUESTED locale cannot produce.
    assert.equal(
      arabicOnlyCategories, 46,
      `expected 46 donor-only categories to be reached, saw ${arabicOnlyCategories}`,
    );
  });

  it("fails resolution when the supplying locale selects a branch the donor lacks", () => {
    let checked = 0;

    for (const testCase of cases) {
      const expected = testCase.expected.result;

      if (expected.failureReason !== "RESOLUTION_FAILURE") continue;

      const fixture = corpus.fixtures[testCase.fixture];
      const donorEntries = Object.entries(
        /** @type {Record<string, any>} */ (fixture.files ?? {}),
      ).filter(([, catalog]) => testCase.input.key in catalog);

      assert.equal(donorEntries.length, 1, `${testCase.id}: expected exactly one donor catalog`);

      const [donorLocale, catalog] = /** @type {[string, any]} */ (donorEntries[0]);
      const definitions = parseCatalog(catalog, { locale: donorLocale, source: donorLocale });
      const definition = definitions.get(testCase.input.key);

      assert.ok(definition);
      assert.throws(
        () =>
          render(
            definition,
            decodeInputs(testCase.input.placeholders),
            contextFor(testCase.input.key, donorLocale),
          ),
        /Missing Cardinality translation for /,
        `${testCase.id}: expected a resolution failure under the supplying locale`,
      );
      ++checked;
    }

    assert.ok(checked >= 3, `expected the sparse-donor cases, saw ${checked}`);
  });

  it("classifies ordinals under the supplying locale, and only with the optional module", () => {
    let checked = 0;

    for (const testCase of cases) {
      if (testCase.expected.result?.status !== "TRANSLATED") continue;

      const donor = donorFor(testCase);

      if (donor === null) continue;

      const definitions = parseCatalog(donor.catalog, {
        locale: donor.locale,
        source: donor.locale,
      });
      const definition = definitions.get(testCase.input.key);

      if (!definition || unsupportedReason(definition) !== null) continue;

      const selectsOrdinality = [...definition.placeholders.values()].some(
        (/** @type {any} */ placeholder) =>
          placeholder.kind === "language-form" && placeholder.axis === "ordinality",
      );

      if (!selectsOrdinality) continue;

      assert.equal(
        render(
          definition,
          decodeInputs(testCase.input.placeholders),
          contextFor(testCase.input.key, donor.locale),
        ),
        testCase.expected.result.translation,
        testCase.id,
      );

      // And WITHOUT the injected classifier the same render fails cleanly instead of falling back
      // to the cardinal answer, which is wrong at almost every locale: Russian ordinals are
      // {other} alone while its cardinals are four-way.
      assert.throws(
        () =>
          render(definition, decodeInputs(testCase.input.placeholders), {
            key: testCase.input.key,
            evaluationLocale: donor.locale,
          }),
        /lokalized\/data\/ordinal/,
        testCase.id,
      );
      ++checked;
    }

    assert.equal(checked, 6, "the ordinal evaluation-locale cases should all render");
  });
});

describe("render across every renderable getResult case", { skip: corpusSkip }, () => {
  it("matches the corpus translation wherever this module covers the entry", () => {
    let rendered = 0;
    /** @type {string[]} */
    const failures = [];

    for (const testCase of corpus.cases) {
      if (testCase.operation !== "getResult") continue;

      const expected = testCase.expected.result;

      if (!expected || expected.status !== "TRANSLATED") continue;
      if (BIDI_ISOLATES.test(expected.translation)) continue;

      const fixture = corpus.fixtures[testCase.fixture];

      // Only non-default runtime limits are excluded: they retune budgets (numeric scale, generated
      // depth, output characters) that `render` does not own. A phonetic resolver or a failure
      // handler does NOT justify a skip — `unsupportedReason` already excludes phonetic entries,
      // and a handler cannot change an entry that resolved to TRANSLATED.
      if (fixture.runtimeLimits) continue;

      const donor = donorFor(testCase);

      if (donor === null) continue;

      /** @type {Map<string, any>} */
      let definitions;

      try {
        definitions = parseCatalog(donor.catalog, {
          locale: donor.locale,
          source: donor.locale,
          limits: {
            maximumJsonNestingDepth: fixture.loadingOptions?.maximumJsonNestingDepth,
            maximumTranslationNodes: fixture.loadingOptions?.maximumTranslationNodes,
          },
        });
      } catch {
        continue; // the loader-limit fixtures reject the catalog outright
      }

      const definition = definitions.get(testCase.input.key);

      if (!definition || unsupportedReason(definition) !== null) continue;
      if (needsPhoneticResolver(testCase)) continue;

      try {
        const actual = render(
            definition,
            decodeInputs(testCase.input.placeholders),
            contextFor(testCase.input.key, donor.locale),
          );

        if (actual !== expected.translation)
          failures.push(
            `${testCase.id}: got ${JSON.stringify(actual)}, want ` +
              `${JSON.stringify(expected.translation)}`,
          );
        else ++rendered;
      } catch (error) {
        failures.push(
          `${testCase.id}: threw ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    assert.deepEqual(failures, [], "getResult cases that disagree with the corpus");
    // A FLOOR set at the CURRENT count, not the pre-growth one. A floor is right — an exact
    // count fails on corpus growth, the one reason that is unambiguously good news. But leaving
    // the floor at a stale value leaves room for cases to drop out of the sweep unnoticed, and a
    // floor at today's count is still growth-safe because growth can only raise it.
    assert.ok(rendered >= 547, `rendered fell to ${rendered}, below the recorded 547`);
  });
});

/**
 * The mirror image of the render gates, and the one that catches a permissive port: wherever Java
 * recorded a RESOLUTION_FAILURE, `render` must throw. A port that quietly substituted a default,
 * skipped an unselectable branch, or stringified a value it should have rejected passes every
 * positive gate and fails only here.
 */
describe("resolution failures the corpus records must also fail here", { skip: corpusSkip }, () => {
  // The three default-budget cases USED to be excluded here, on the grounds that
  // `maximumInterpolatedOutputCharacters` and `maximumGeneratedExpansionCharacters` lived on
  // `TranslationRuntimeLimits` and not on `RenderContext`. M7 C1 put all three budgets in this
  // module at their fixed defaults, so the exclusion is deleted rather than kept as a list that no
  // longer describes anything — the way every known-gap list in this project is required to end.
  // They are now among the failures asserted below, and `test/runtime-budgets.test.js` pins the
  // boundaries the corpus cannot reach.

  it("throws for every RESOLUTION_FAILURE whose donor entry this module can evaluate", () => {
    let checked = 0;
    /** @type {string[]} */
    const survivors = [];

    for (const testCase of corpus.cases) {
      if (testCase.operation !== "getResult") continue;

      const expected = testCase.expected.result;

      if (!expected || expected.failureReason !== "RESOLUTION_FAILURE") continue;

      const fixture = corpus.fixtures[testCase.fixture];

      if (fixture.runtimeLimits) continue; // retuned budgets this module does not own

      if (needsPhoneticResolver(testCase)) continue; // the resolver decides, and this module has none

      // Walk the candidates in the order the recorded result attempted them, exactly as core does.
      // The first one that HOLDS the key and produces something decides — and "produces something"
      // is three-valued now: a string ends the walk, a throw is the failure being asserted, and a
      // null (no alternative matched, no translation of its own) means the walk moves on. Taking
      // only the first donor was right until alternatives were evaluated; `failure-handler.final-
      // reason.no-match-then-resolution-failure-reports-resolution-failure` is the case that names
      // the difference — its first donor legitimately renders nothing at all.
      /** @type {"threw" | "rendered" | null} */
      let outcome = null;
      let evaluable = false;

      for (const donorLocale of /** @type {string[]} */ (expected.attemptedLocales ?? [])) {
        if (!fixture.files?.[donorLocale] || !(testCase.input.key in fixture.files[donorLocale])) continue;

        /** @type {Map<string, any>} */
        let definitions;

        try {
          definitions = parseCatalog(fixture.files[donorLocale], {
            locale: donorLocale,
            source: donorLocale,
          });
        } catch {
          break;
        }

        const definition = definitions.get(testCase.input.key);

        if (!definition || unsupportedReason(definition) !== null) break;

        evaluable = true;

        try {
          const rendered = render(
            definition,
            decodeInputs(testCase.input.placeholders),
            contextFor(testCase.input.key, donorLocale),
          );

          if (rendered !== null) {
            outcome = "rendered";
            break;
          }
        } catch {
          outcome = "threw";
          break;
        }
      }

      if (!evaluable) continue;

      ++checked;
      if (outcome !== "threw") survivors.push(testCase.id);
    }

    assert.deepEqual(survivors, [], "resolution failures that render silently survived");
    // A FLOOR set at the CURRENT count, not the pre-growth one. A floor is right — an exact
    // count fails on corpus growth, the one reason that is unambiguously good news. But leaving
    // the floor at a stale value leaves room for cases to drop out of the sweep unnoticed, and a
    // floor at today's count is still growth-safe because growth can only raise it. Raised 90 -> 93
    // at M7 C1: the three default-budget cases are no longer excluded, because this module now
    // enforces all three budgets itself.
    assert.ok(checked >= 93, `checked fell to ${checked}, below the recorded 93`);
  });
});

describe("render dispatch", () => {
  /**
   * @param {Record<string, unknown>} catalog
   * @param {string} key
   */
  const definitionFor = (catalog, key) => {
    const definition = parseCatalog(catalog, { locale: "en", source: "t" }).get(key);
    assert.ok(definition);
    return definition;
  };

  /**
   * The message the placeholder resolver itself composed, unwrapped.
   *
   * `render` CONTEXTUALIZES a placeholder failure (`Unable to resolve generated placeholder 'x'
   * (LanguageFormTranslation) for key 'k'; definition declared at k: ...`) and retains the original
   * as `cause`, exactly as `DefaultStrings` does. Java's own composed sentence is the CAUSE, so
   * these assertions read the cause and pin it end to end — a substring match on the wrapper would
   * pass for a port that composed only half the sentence.
   *
   * @param {() => unknown} run
   * @returns {string}
   */
  const refusalCause = (run) => {
    try {
      run();
    } catch (error) {
      const cause = /** @type {{ cause?: unknown }} */ (error).cause;
      return /** @type {Error} */ (cause ?? error).message;
    }
    return assert.fail("expected a refusal");
  };

  const booksCatalog = {
    "Books": {
      translation: "I read {{bookCount}} {{books}}",
      placeholders: {
        books: {
          value: "bookCount",
          translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
        },
      },
    },
  };

  it("selects the cardinal category under the supplying locale", () => {
    const definition = definitionFor(booksCatalog, "Books");

    assert.equal(
      render(definition, { bookCount: 1n }, { key: "Books", evaluationLocale: "en" }),
      "I read 1 book",
    );
    assert.equal(
      render(definition, { bookCount: 3n }, { key: "Books", evaluationLocale: "en" }),
      "I read 3 books",
    );
    // French treats 0 and 1 as ONE; English does not. The supplying locale decides.
    assert.equal(
      render(definition, { bookCount: 0n }, { key: "Books", evaluationLocale: "fr" }),
      "I read 0 book",
    );
    assert.equal(
      render(definition, { bookCount: 0n }, { key: "Books", evaluationLocale: "en" }),
      "I read 0 books",
    );
  });

  it("treats a raw string as text and never sniffs it into a language form", () => {
    const definition = definitionFor(booksCatalog, "Books");

    assert.throws(
      () => render(definition, { bookCount: "1" }, { key: "Books", evaluationLocale: "en" }),
      /must be a Number, PluralOperands, or Cardinality but was String/,
    );

    const genderCatalog = {
      "Actor": {
        translation: "{{who}}",
        placeholders: {
          who: {
            value: "gender",
            translations: { GENDER_MASCULINE: "He", GENDER_FEMININE: "She" },
          },
        },
      },
    };
    const genderDefinition = definitionFor(genderCatalog, "Actor");

    assert.throws(
      () =>
        render(
          genderDefinition,
          { gender: "GENDER_FEMININE" },
          { key: "Actor", evaluationLocale: "en" },
        ),
      /must be a Gender but was String/,
    );
    assert.equal(
      render(
        genderDefinition,
        { gender: { $lokalized: "language-form", axis: "gender", name: "GENDER_FEMININE" } },
        { key: "Actor", evaluationLocale: "en" },
      ),
      "She",
    );
  });

  it("refuses a tagged language form from the wrong axis", () => {
    // Java dispatches on the Java TYPE of the value (`value instanceof Gender`), so a Formality
    // handed to a gender selector is a hard error rather than a silent miss. The JS port carries
    // the axis on the tagged record, and it must be checked, not merely carried.
    const genderDefinition = definitionFor(
      {
        "Actor": {
          translation: "{{who}}",
          placeholders: {
            who: {
              value: "gender",
              translations: { GENDER_MASCULINE: "He", GENDER_FEMININE: "She" },
            },
          },
        },
      },
      "Actor",
    );

    assert.throws(
      () =>
        render(
          genderDefinition,
          { gender: { $lokalized: "language-form", axis: "formality", name: "FORMALITY_FORMAL" } },
          { key: "Actor", evaluationLocale: "en" },
        ),
      /must be a Gender but was Formality/,
    );

    // ...and the same value is still rejected when the selector is cardinality, which would
    // otherwise fall through to numeric classification.
    assert.throws(
      () =>
        render(
          definitionFor(booksCatalog, "Books"),
          {
            bookCount: {
              $lokalized: "language-form",
              axis: "ordinality",
              name: "ORDINALITY_ONE",
            },
          },
          { key: "Books", evaluationLocale: "en" },
        ),
      /must be a Number, PluralOperands, or Cardinality but was Ordinality/,
    );
  });

  it("composes the range arm's refusal with Java's own description strings", () => {
    // `DefaultStrings.java:948-951` calls `cardinalityForValue` with `"Range start placeholder"` and
    // `"Range end placeholder"` where the non-range arm passes `"Placeholder"`, and that first word
    // is the ONLY difference between the three sentences. The port ran no accept-set test on the
    // range path at all until this slice, so a bad endpoint fell through to the numeric classifier
    // and answered with the classifier's own unprefixed wording — naming neither the endpoint, the
    // accept set, nor the Java class.
    //
    // The corpus rows `m3b-form-diagnostics-value-types.range.start-wrong-type-string` and
    // `.end-wrong-type-gender` gate this against Java. These assertions gate it HERE, where a
    // re-partitioned corpus row cannot take the wording's only enforcement with it.
    const rangeCatalog = {
      "Range.Books": {
        translation: "I read {{books}}",
        placeholders: {
          books: {
            range: { start: "low", end: "high" },
            translations: { CARDINALITY_ONE: "one book", CARDINALITY_OTHER: "books" },
          },
        },
      },
    };
    const definition = definitionFor(rangeCatalog, "Range.Books");
    const context = contextFor("Range.Books", "en");

    const accepts = " must be a Number, PluralOperands, or Cardinality but was ";
    assert.equal(
      refusalCause(() => render(definition, { low: "lo", high: 5 }, context)),
      `Range start placeholder 'low' in key 'Range.Books'${accepts}String`,
    );
    assert.equal(
      refusalCause(() => render(definition, { low: 1, high: true }, context)),
      `Range end placeholder 'high' in key 'Range.Books'${accepts}Boolean`,
    );
    assert.equal(
      refusalCause(() =>
        render(
          definition,
          { low: 1, high: { $lokalized: "language-form", axis: "gender", name: "GENDER_FEMININE" } },
          context,
        ),
      ),
      `Range end placeholder 'high' in key 'Range.Books'${accepts}Gender`,
    );

    // THE CONTROL THAT SEPARATES THE GUARD FROM AN OVER-STRICT ONE. Java's accept set is three
    // shapes, not one: a guard spelled `typeof value === "number"` passes every assertion above and
    // turns these two legal endpoints into refusals.
    assert.equal(
      render(definition, { low: { $lokalized: "plural-operands", value: "1" }, high: 5 }, context),
      "I read books",
    );
    assert.equal(
      render(definition, { low: { $lokalized: "decimal", value: "1" }, high: 5n }, context),
      "I read books",
    );
  });

  it("names the endpoint categories when a range's computed form is absent", () => {
    // `DefaultStrings.java:955-957`, the RANGE arm's own absent-translation wording. The port used
    // to fall through to the plain `Missing %s translation for %s` and lose both endpoint
    // categories — the half of the diagnostic a caller staring at a sparse range table needs. One
    // corpus row (`m3b-form-diagnostics.range.computed-form-absent`) was its only enforcement.
    const sparse = {
      "Range.Sparse": {
        translation: "I read {{books}}",
        placeholders: {
          books: {
            range: { start: "low", end: "high" },
            translations: { CARDINALITY_ONE: "one book" },
          },
        },
      },
    };

    assert.equal(
      refusalCause(() =>
        render(definitionFor(sparse, "Range.Sparse"), { low: 1, high: 5 }, contextFor("Range.Sparse", "en")),
      ),
      "Missing Cardinality translation for range cardinality OTHER (start was ONE, end was OTHER)",
    );
  });

  it("tests the plural accept set BEFORE consulting the optional ordinal module", () => {
    // JAVA'S ORDER. `ordinalityForValue` refuses an unacceptable value at
    // `DefaultStrings.java:1487-1490` before anything classifies, so the diagnostic a caller sees is
    // Java's composed sentence whether or not ordinal data is present. The port classified first,
    // which meant an instance WITHOUT `lokalized/data/ordinal` answered a bad value with the
    // module-missing advice instead — right complaint, wrong question. Rendered here with a context
    // carrying NO `ordinalityNameFor` at all, which is the state that used to hide it.
    const ordinalCatalog = {
      "Ordinal.Finish": {
        translation: "You finished {{position}}.",
        placeholders: {
          position: {
            value: "rank",
            translations: { ORDINALITY_ONE: "1st", ORDINALITY_OTHER: "th" },
          },
        },
      },
    };
    const definition = definitionFor(ordinalCatalog, "Ordinal.Finish");
    const withoutOrdinalData = { key: "Ordinal.Finish", evaluationLocale: "en" };

    assert.equal(
      refusalCause(() => render(definition, { rank: "1" }, withoutOrdinalData)),
      "Placeholder 'rank' in key 'Ordinal.Finish' must be a Number, PluralOperands, or Ordinality but was String",
    );
    // The control: a value that PASSES the accept set still reaches the absent-module complaint, so
    // the reorder moved the accept-set test and did not swallow the module check.
    assert.match(
      refusalCause(() => render(definition, { rank: 1 }, withoutOrdinalData)),
      /requires the optional 'lokalized\/data\/ordinal' module/,
    );
  });

  it("names the Java class of every value whose class a JS value determines", () => {
    // `javaSimpleNameOf`'s whole test, asserted rather than argued. `BigDecimal` and
    // `PluralOperands` were carried as declared divergences on a SECOND criterion — "a Java class
    // name for a type this API does not expose" — that the same sentence's left half already
    // ignores. The four numeric carriers are the only shapes that genuinely fail the test, and they
    // fail it because two Java classes share one JS carrier.
    const genderCatalog = {
      "Gender.Actor": {
        translation: "{{who}}",
        placeholders: {
          who: { value: "gender", translations: { GENDER_MASCULINE: "He", GENDER_FEMININE: "She" } },
        },
      },
    };
    const definition = definitionFor(genderCatalog, "Gender.Actor");
    const context = { key: "Gender.Actor", evaluationLocale: "en" };
    /** @param {unknown} value */
    const refusal = (value) => refusalCause(() => render(definition, { gender: value }, context));

    const prefix = "Placeholder 'gender' in key 'Gender.Actor' must be a Gender but was ";
    assert.equal(refusal("x"), `${prefix}String`);
    assert.equal(refusal(true), `${prefix}Boolean`);
    assert.equal(refusal({ $lokalized: "decimal", value: "1.5" }), `${prefix}BigDecimal`);
    assert.equal(refusal({ $lokalized: "plural-operands", value: "1" }), `${prefix}PluralOperands`);
    assert.equal(
      refusal({ $lokalized: "language-form", axis: "cardinality", name: "CARDINALITY_ONE" }),
      `${prefix}Cardinality`,
    );

    // THE FOUR THAT CANNOT BE NAMED, and the reason: `Integer`/`Double` share one JS `number` and
    // `Long`/`BigInteger` share one JS `bigint`, so the port describes the carrier. Both halves of
    // each collision are recorded in the corpus and declared in `tools/conformance.mjs`.
    assert.equal(refusal(5), `${prefix}number`);
    assert.equal(refusal(5n), `${prefix}bigint`);
  });

  it("renders a tagged language form in a plain slot as its bare constant name", () => {
    const definition = definitionFor({ "Slot": "[{{form}}]" }, "Slot");

    assert.equal(
      render(
        definition,
        { form: { $lokalized: "language-form", axis: "phonetic", name: "PHONETIC_VOWEL" } },
        { key: "Slot", evaluationLocale: "en" },
      ),
      "[VOWEL]",
    );
  });

  it("distinguishes an exact decimal from a number: 1.0 is not 1", () => {
    const catalog = {
      "Items": {
        translation: "{{noun}}",
        placeholders: {
          noun: {
            value: "count",
            translations: { CARDINALITY_ONE: "one", CARDINALITY_OTHER: "other" },
          },
        },
      },
    };
    const definition = definitionFor(catalog, "Items");

    assert.equal(
      render(definition, { count: 1 }, { key: "Items", evaluationLocale: "en" }),
      "one",
    );
    assert.equal(
      render(
        definition,
        { count: { $lokalized: "decimal", value: "1.0" } },
        { key: "Items", evaluationLocale: "en" },
      ),
      "other",
    );
  });

  it("throws on a missing branch and on an unresolved placeholder", () => {
    const definition = definitionFor(booksCatalog, "Books");

    assert.throws(
      () => render(definition, { bookCount: 3n }, { key: "Books", evaluationLocale: "ru" }),
      /Missing Cardinality translation for FEW/,
    );
    assert.throws(
      () => render(definition, {}, { key: "Books", evaluationLocale: "en" }),
      /Missing value for placeholder 'bookCount'/,
    );
    assert.throws(
      () =>
        render(definitionFor({ "Hi": "Hello, {{name}}" }, "Hi"), {}, {
          key: "Hi",
          evaluationLocale: "en",
        }),
      /Missing value for placeholder\(s\) \[name\]/,
    );
  });

  it("expands generated placeholders transitively and detects cycles", () => {
    const chain = definitionFor(
      {
        "Chain": {
          translation: "{{a}}",
          placeholders: { a: { translation: "A-{{b}}" }, b: { translation: "B" } },
        },
      },
      "Chain",
    );

    assert.equal(render(chain, {}, { key: "Chain", evaluationLocale: "en" }), "A-B");

    const cyclic = definitionFor(
      {
        "Cycle": {
          translation: "{{a}}",
          placeholders: { a: { translation: "A-{{b}}" }, b: { translation: "B-{{a}}" } },
        },
      },
      "Cycle",
    );

    assert.throws(
      () => render(cyclic, {}, { key: "Cycle", evaluationLocale: "en" }),
      /Generated placeholder cycle/,
    );
  });

  it("honors the backslash escapes of the interpolation grammar", () => {
    const definition = definitionFor({ "Esc": "\\{{name}} is {{name}} \\\\ \\}}" }, "Esc");

    assert.equal(
      render(definition, { name: "Sarah" }, { key: "Esc", evaluationLocale: "en" }),
      "{{name}} is Sarah \\ }}",
    );
  });
});

describe("alternative selection", () => {
  /**
   * The renderer takes its evaluator through the context, so a test can supply a real one without
   * this module acquiring an edge to it. `compile` is the shipping compiler; the map is keyed by the
   * parsed alternative NODE, exactly as core keys it.
   *
   * @param {string} evaluationLocale
   * @returns {import("../src/internal/interpolate.js").RenderContext}
   */
  const evaluatingContext = (evaluationLocale = "en") => ({
    key: "K",
    evaluationLocale,
    evaluateExpression: (alternative, values) =>
      evaluateCompiled(
        compile(/** @type {{ expression: string }} */ (alternative).expression),
        values,
        evaluationLocale,
      ),
  });

  /**
   * @param {Record<string, unknown>} catalog
   * @param {string} key
   */
  const entry = (catalog, key) => {
    const definition = parseCatalog(catalog, { locale: "en", source: "en" }).get(key);
    assert.ok(definition);
    return definition;
  };

  it("takes the first matching branch and never a later sibling", () => {
    const definition = entry(
      {
        K: {
          translation: "default",
          alternatives: [
            { "n > 100": "big" },
            { "n > 10": "medium" },
            { "n > 1": "small" },
          ],
        },
      },
      "K",
    );

    assert.equal(render(definition, { n: 500 }, evaluatingContext()), "big");
    assert.equal(render(definition, { n: 50 }, evaluatingContext()), "medium");
    assert.equal(render(definition, { n: 0 }, evaluatingContext()), "default");
  });

  it("returns null — not a throw — when no alternative matches and there is no translation", () => {
    // Java's `Optional.empty()`. The distinction is load-bearing: the default fallback policy walks
    // PAST this to the next donor locale, while a thrown resolution failure halts the walk.
    const definition = entry({ K: { alternatives: [{ "n > 10": "big" }] } }, "K");

    assert.equal(render(definition, { n: 50 }, evaluatingContext()), "big");
    assert.equal(render(definition, { n: 1 }, evaluatingContext()), null);
  });

  it("does not fall through from an unmatched NESTED subtree to a later sibling", () => {
    const definition = entry(
      {
        K: {
          alternatives: [
            { "n > 10": { alternatives: [{ "n > 1000": "huge" }] } },
            { "n > 1": "small" },
          ],
        },
      },
      "K",
    );

    // 50 selects the first branch, whose own alternatives all miss. `small` is NOT reached.
    assert.equal(render(definition, { n: 50 }, evaluatingContext()), null);
    assert.equal(render(definition, { n: 5 }, evaluatingContext()), "small");
  });

  it("inherits a placeholder the branch does not mention and replaces one it does, WHOLE", () => {
    // Two rules that are easy to conflate. Bindings accumulate BY NAME — a branch keeps ancestor
    // definitions for names it says nothing about (`DefaultStrings.getInternal` builds
    // `effectivePlaceholderBindings` as inherited-plus-own). But a name the branch DOES redefine is
    // swapped whole, never merged form-by-form, so a branch table declaring only CARDINALITY_OTHER
    // fails for a value selecting ONE instead of borrowing the parent's ONE.
    const catalog = {
      K: {
        translation: "{{n}} {{books}} {{shelf}}",
        placeholders: {
          books: {
            value: "n",
            translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
          },
          shelf: { translation: "on the shelf" },
        },
        alternatives: [
          {
            "mode == 1": {
              translation: "{{n}} {{books}} {{shelf}}",
              placeholders: {
                books: { value: "n", translations: { CARDINALITY_OTHER: "volumes" } },
              },
            },
          },
        ],
      },
    };
    const definition = entry(catalog, "K");

    // `shelf` is inherited untouched; `books` is the branch's partial table and serves its own form.
    assert.equal(
      render(definition, { n: 5, mode: 1 }, evaluatingContext()),
      "5 volumes on the shelf",
    );
    // ... and fails for the form the branch omitted rather than borrowing the parent's `book`.
    assert.throws(
      () => render(definition, { n: 1, mode: 1 }, evaluatingContext()),
      /Missing Cardinality translation for ONE/,
    );
    // The unselected path still has the parent's complete table.
    assert.equal(render(definition, { n: 1, mode: 0 }, evaluatingContext()), "1 book on the shelf");
  });

  it("selects a generated fragment's own alternatives against RAW caller input", () => {
    // `{{size}}` is a fragment whose branches read `n` — the caller's value, not the generated text
    // that `{{n}}` would interpolate.
    const definition = entry(
      {
        K: {
          translation: "{{size}}",
          placeholders: {
            size: {
              translation: "a shelf",
              alternatives: [{ "n > 1000": "an enormous library" }, { "n > 100": "a large library" }],
            },
          },
        },
      },
      "K",
    );

    assert.equal(render(definition, { n: 5000 }, evaluatingContext()), "an enormous library");
    assert.equal(render(definition, { n: 500 }, evaluatingContext()), "a large library");
    assert.equal(render(definition, { n: 5 }, evaluatingContext()), "a shelf");
  });

  it("evaluates alternatives under the SUPPLYING locale", () => {
    // `n == CARDINALITY_ONE` classifies 0 differently in French and English, and a fallback-served
    // entry must classify under the locale whose text it is.
    const definition = entry(
      { K: { translation: "other", alternatives: [{ "n == CARDINALITY_ONE": "one" }] } },
      "K",
    );

    assert.equal(render(definition, { n: 0 }, evaluatingContext("fr")), "one");
    assert.equal(render(definition, { n: 0 }, evaluatingContext("en")), "other");
  });
});
