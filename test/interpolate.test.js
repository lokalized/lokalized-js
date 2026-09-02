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
import { render } from "../src/internal/interpolate.js";

const corpus = JSON.parse(
  readFileSync(
    new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url),
    "utf8",
  ),
);

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
  if (definition.alternatives.length > 0) return "whole-message alternatives (M6)";

  for (const placeholder of definition.placeholders.values()) {
    if (placeholder.kind === "expression") {
      if (placeholder.alternatives.length > 0) return "fragment alternatives (M6)";
      continue;
    }

    if (placeholder.range !== null) return "cardinal ranges (data/ranges not generated)";
    if (placeholder.axis === "ordinality") return "ordinality (data/ordinal not generated)";
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

describe("render under the supplying locale (evaluation-locale corpus family)", () => {
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
      if (BIDI_ISOLATES.test(expected.translation)) continue; // bidi isolation is not M2

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
        const actual = render(definition, decodeInputs(testCase.input.placeholders), {
          key: testCase.input.key,
          evaluationLocale: donor.locale,
        });

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
    assert.equal(rendered, 95, `expected 95 rendered evaluation-locale cases, saw ${rendered}`);
    // The whole point of the family: categories the REQUESTED locale cannot produce.
    assert.equal(
      arabicOnlyCategories,
      41,
      `expected 41 donor-only categories to be reached, saw ${arabicOnlyCategories}`,
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
          render(definition, decodeInputs(testCase.input.placeholders), {
            key: testCase.input.key,
            evaluationLocale: donorLocale,
          }),
        /Missing cardinality translation for CARDINALITY_/,
        `${testCase.id}: expected a resolution failure under the supplying locale`,
      );
      ++checked;
    }

    assert.ok(checked >= 3, `expected the sparse-donor cases, saw ${checked}`);
  });

  it("does not yet classify ordinals from a number (data/ordinal is not generated)", () => {
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

      if (
        !definition ||
        unsupportedReason(definition) !== "ordinality (data/ordinal not generated)"
      )
        continue;

      assert.throws(
        () =>
          render(definition, decodeInputs(testCase.input.placeholders), {
            key: testCase.input.key,
            evaluationLocale: donor.locale,
          }),
        /numeric ordinality selection is not implemented in M2/,
      );
      ++checked;
    }

    assert.equal(checked, 6, "the known ordinal gap should cover exactly six corpus cases");
  });
});

describe("render across every renderable getResult case", () => {
  it("matches the corpus translation wherever M2 covers the entry", () => {
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

      try {
        const actual = render(definition, decodeInputs(testCase.input.placeholders), {
          key: testCase.input.key,
          evaluationLocale: donor.locale,
        });

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
    assert.equal(rendered, 468, `expected 468 rendered getResult cases, saw ${rendered}`);
  });
});

/**
 * The mirror image of the render gates, and the one that catches a permissive port: wherever Java
 * recorded a RESOLUTION_FAILURE, `render` must throw. A port that quietly substituted a default,
 * skipped an unselectable branch, or stringified a value it should have rejected passes every
 * positive gate and fails only here.
 */
describe("resolution failures the corpus records must also fail here", () => {
  /**
   * The only recorded resolution failures M2 cannot reproduce: Java's default output budgets
   * (`maximumInterpolatedOutputCharacters`, `maximumGeneratedExpansionCharacters`), which live on
   * TranslationRuntimeLimits and are not part of RenderContext.
   */
  const OUTPUT_BUDGET_CASES = new Set([
    "generated-placeholders.limits.cumulative-expansion-exceeds-character-budget",
    "runtime-limits.expansion.default.one-past-the-budget",
    "runtime-limits.interpolated-output.default.one-past-the-maximum",
  ]);

  it("throws for every RESOLUTION_FAILURE whose donor entry M2 can evaluate", () => {
    let checked = 0;
    /** @type {string[]} */
    const survivors = [];

    for (const testCase of corpus.cases) {
      if (testCase.operation !== "getResult") continue;

      const expected = testCase.expected.result;

      if (!expected || expected.failureReason !== "RESOLUTION_FAILURE") continue;
      if (OUTPUT_BUDGET_CASES.has(testCase.id)) continue;

      const fixture = corpus.fixtures[testCase.fixture];

      if (fixture.runtimeLimits) continue; // retuned budgets this module does not own

      // The donor is the candidate that actually held the key and then failed to resolve.
      const donorLocale = /** @type {string[]} */ (expected.attemptedLocales ?? []).find(
        (locale) => fixture.files?.[locale] && testCase.input.key in fixture.files[locale],
      );

      if (donorLocale === undefined) continue;

      /** @type {Map<string, any>} */
      let definitions;

      try {
        definitions = parseCatalog(fixture.files[donorLocale], {
          locale: donorLocale,
          source: donorLocale,
        });
      } catch {
        continue;
      }

      const definition = definitions.get(testCase.input.key);

      if (!definition || unsupportedReason(definition) !== null) continue;
      if (fixture.phoneticResolver) continue; // the resolver decides, and M2 has none

      let threw = false;

      try {
        render(definition, decodeInputs(testCase.input.placeholders), {
          key: testCase.input.key,
          evaluationLocale: donorLocale,
        });
      } catch {
        threw = true;
      }

      ++checked;
      if (!threw) survivors.push(testCase.id);
    }

    assert.deepEqual(survivors, [], "resolution failures that render silently survived");
    assert.equal(checked, 60, `expected 60 negative cases, saw ${checked}`);
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
      /must be a number, bigint, decimal, plural-operands/,
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
      /must be a tagged gender language form but was string/,
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
      /must be a tagged gender language form/,
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
      /must be a number, bigint, decimal, plural-operands, or an exact tagged language form/,
    );
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
      /Missing cardinality translation for CARDINALITY_FEW/,
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
