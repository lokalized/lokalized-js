// @ts-check

/**
 * `src/internal/catalog.js` — driven directly against the behavioral corpus.
 *
 * The corpus is the specification: every fixture catalog is parsed here and the outcome is compared
 * with what unmodified lokalized-java 3.0.0 was recorded doing for it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { EXPRESSION_LIMIT_CEILINGS, compile } from "../src/internal/expression.js";

/**
 * Load-time expression validation, as `lokalized/parse` and `createStrings` both perform it.
 *
 * `parseCatalog` validates expressions only when handed a validator. Omitting it here compared a
 * validator-less parse against Java's validating load — an omission that agreed only while no
 * fixture carried a bad expression, and stopped agreeing the moment M3b's owed cases added some.
 * The ceilings rather than the defaults, because Java's loaders use `hardCeilings()`.
 */
const compileExpressionAtLoad = (/** @type {string} */ expression) =>
  compile(expression, { limits: EXPRESSION_LIMIT_CEILINGS });

import { parseCatalog } from "../src/internal/catalog.js";

const corpus = JSON.parse(
  readFileSync(
    new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url),
    "utf8",
  ),
);

/**
 * Fixture files whose Java outcome parseCatalog deliberately does not reproduce in M2.
 * The value states why; each entry is a documented gap, not a silent skip.
 */
const KNOWN_M2_GAPS = new Map([
  // Load-wide budgets (file count, warning count) belong to the loader, not to a single catalog.
  ["classpath-resources-file-limit::en", "aggregate file-count limit (loader)"],
  ["loading-limits-files-one-exceeds::en", "aggregate file-count limit (loader)"],
  ["loading-limits-files-zero::en", "maximumLocalizedStringsFiles option (loader)"],
  ["loading-limits-manifest-257-default::afu", "aggregate file-count limit (loader)"],
  ["manifest-loads-file-limit-exceeded::en", "aggregate file-count limit (loader)"],
  ["loading-limits-warnings-one-two-warnings::ru", "warning budget (loader warnings)"],
  ["loading-limits-warnings-zero-one-warning::ru", "warning budget (loader warnings)"],
  ["warnings-limit-one-four-warnings::ru", "warning budget (loader warnings)"],
  ["warnings-limit-two-four-warnings::ru", "warning budget (loader warnings)"],
  ["warnings-limit-zero-one-warning::ru", "warning budget (loader warnings)"],
]);

/**
 * Fixtures whose loading options Java refuses before it reads a byte, and which parseCatalog
 * likewise refuses because it owns those two options.
 */
const OPTION_VALIDATION_FAILURES = new Set([
  "loading-limits-depth-zero::en",
  "loading-limits-depth-above-ceiling::en",
  "loading-limits-nodes-negative::en",
]);

/** @returns {Map<string, any>} `${fixture}::${file}` -> parse case */
function parseCasesByFile() {
  /** @type {Map<string, any>} */
  const byFile = new Map();

  for (const testCase of corpus.cases)
    if (testCase.operation === "parse")
      byFile.set(`${testCase.fixture}::${testCase.input.file}`, testCase);

  return byFile;
}

/** @returns {Set<string>} `${fixture}::${file}` for every load-time failure attributed to a file */
function loadFailuresByFile() {
  /** @type {Set<string>} */
  const failures = new Set();

  for (const testCase of corpus.cases) {
    if (!testCase.operation.startsWith("load")) continue;

    const expected = Object.values(testCase.expected)[0];

    if (!expected || !expected.failed) continue;

    const match = /\/([^/\s]+)\/([^/\s:]+):/.exec(expected.failureMessage ?? "");

    if (match && match[1] === testCase.fixture) failures.add(`${testCase.fixture}::${match[2]}`);
  }

  return failures;
}

/**
 * @param {any} fixture
 * @returns {{ locale?: string, source?: string, limits: object }}
 */
function limitsFor(fixture) {
  /** @type {Record<string, number>} */
  const limits = {};

  if (typeof fixture.loadingOptions?.maximumJsonNestingDepth === "number")
    limits["maximumJsonNestingDepth"] = fixture.loadingOptions.maximumJsonNestingDepth;

  if (typeof fixture.loadingOptions?.maximumTranslationNodes === "number")
    limits["maximumTranslationNodes"] = fixture.loadingOptions.maximumTranslationNodes;

  return { limits };
}

describe("parseCatalog against every corpus fixture", () => {
  const parseCases = parseCasesByFile();
  const loadFailures = loadFailuresByFile();

  it("reproduces Java's accept/reject decision for every fixture catalog", () => {
    let checked = 0;
    let rejected = 0;
    /** @type {string[]} */
    const mismatches = [];

    for (const [fixtureName, fixture] of Object.entries(corpus.fixtures)) {
      for (const [locale, rawCatalog] of Object.entries(
        /** @type {Record<string, unknown>} */ (fixture.files ?? {}),
      )) {
        const identity = `${fixtureName}::${locale}`;
        const parseCase = parseCases.get(identity);
        let expectedFailure = parseCase
          ? parseCase.expected.parse.failed
          : loadFailures.has(identity) || OPTION_VALIDATION_FAILURES.has(identity);

        if (KNOWN_M2_GAPS.has(identity)) expectedFailure = false;

        /** @type {unknown} */
        let thrown = null;
        /** @type {Map<string, unknown> | null} */
        let definitions = null;

        try {
          definitions = parseCatalog(rawCatalog, {
            locale,
            source: locale,
            ...limitsFor(fixture),
            validateExpression: compileExpressionAtLoad,
          });
        } catch (error) {
          thrown = error;
        }

        ++checked;
        if (thrown !== null) ++rejected;

        if ((thrown !== null) !== expectedFailure)
          mismatches.push(
            `${identity}: expected ${expectedFailure ? "rejection" : "acceptance"}, got ` +
              `${thrown instanceof Error ? `rejection (${thrown.message})` : "acceptance"}`,
          );
        else if (
          definitions !== null &&
          parseCase &&
          !KNOWN_M2_GAPS.has(identity) &&
          Array.isArray(parseCase.expected.parse.keys)
        )
          assert.deepEqual(
            [...definitions.keys()].sort(),
            [...parseCase.expected.parse.keys].sort(),
            `${identity}: parsed key set`,
          );
      }
    }

    assert.deepEqual(mismatches, [], "fixture catalogs disagreeing with the corpus");
    assert.ok(checked > 1_700, `expected the whole corpus to be exercised, saw ${checked} catalogs`);
    assert.ok(rejected > 60, `expected the malformed fixtures to be rejected, saw ${rejected}`);
  });

  it("rejects every structurally malformed catalog the corpus records", () => {
    /** @type {string[]} */
    const accepted = [];

    for (const testCase of corpus.cases) {
      if (testCase.operation !== "parse" || !testCase.expected.parse.failed) continue;

      const fixture = corpus.fixtures[testCase.fixture];
      const rawCatalog = fixture.files?.[testCase.input.file];

      if (rawCatalog === undefined) continue; // raw-bytes / raw-text case: not a decoded catalog
      if (KNOWN_M2_GAPS.has(`${testCase.fixture}::${testCase.input.file}`)) continue;

      try {
        parseCatalog(rawCatalog, {
          locale: testCase.input.locale,
          source: testCase.input.source,
          ...limitsFor(fixture),
          validateExpression: compileExpressionAtLoad,
        });
        accepted.push(testCase.id);
      } catch {
        // expected
      }
    }

    assert.deepEqual(accepted, [], "malformed catalogs that were wrongly accepted");
  });

  it("reproduces Java's rejection message verbatim, not merely the rejection", () => {
    // Accept/reject alone is a weak gate: a parser that rejected everything for the wrong reason
    // would pass it. The corpus records Java's exact `failureMessage`, so compare that instead.
    let compared = 0;
    /** @type {string[]} */
    const differences = [];

    for (const testCase of corpus.cases) {
      if (testCase.operation !== "parse" || !testCase.expected.parse.failed) continue;

      const fixture = corpus.fixtures[testCase.fixture];
      const rawCatalog = fixture.files?.[testCase.input.file];

      if (rawCatalog === undefined) continue; // raw-bytes / raw-text case: not a decoded catalog
      if (KNOWN_M2_GAPS.has(`${testCase.fixture}::${testCase.input.file}`)) continue;

      try {
        parseCatalog(rawCatalog, {
          locale: testCase.input.locale,
          source: testCase.input.source,
          ...limitsFor(fixture),
          validateExpression: compileExpressionAtLoad,
        });
        differences.push(`${testCase.id}: accepted, expected a rejection`);
      } catch (error) {
        ++compared;

        const actual = error instanceof Error ? error.message : String(error);

        if (actual !== testCase.expected.parse.failureMessage)
          differences.push(
            `${testCase.id}:\n    got  ${JSON.stringify(actual)}\n    want ` +
              `${JSON.stringify(testCase.expected.parse.failureMessage)}`,
          );
      }
    }

    assert.deepEqual(differences, [], "rejection messages that differ from Java's");
  // A FLOOR, not an exact count. The exact form was pinned at 64 and broke the moment M3b's owed
  // cases grew the corpus to 88 — failing for the one reason that is unambiguously good news, while
  // saying nothing about whether the messages still match. What this assertion is actually for is
  // ensuring the loop above compared a substantial number of messages rather than silently zero, and
  // a floor does that without punishing growth. The real gate is `differences` being empty.
  assert.ok(
    compared >= 97,
    `expected at least 64 message-comparable rejections, compared ${compared} — a drop means the ` +
      `corpus lost rejection cases or the loop stopped reaching them`,
  );
  });
});

describe("parseCatalog model", () => {
  it("parses a plain-string entry as its own translation", () => {
    const definitions = parseCatalog({ "Hello": "Hi" }, { locale: "en", source: "t" });
    const definition = definitions.get("Hello");

    assert.equal(definition?.translation, "Hi");
    assert.equal(definition?.commentary, null);
    assert.equal(definition?.placeholders.size, 0);
    assert.deepEqual(definition?.alternatives, []);
  });

  it("keeps commentary and records the language-form axis", () => {
    const definitions = parseCatalog(
      {
        "Books": {
          translation: "I read {{books}}",
          commentary: "note",
          placeholders: {
            books: {
              value: "bookCount",
              translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
            },
          },
        },
      },
      { locale: "en", source: "t" },
    );

    const definition = definitions.get("Books");
    assert.equal(definition?.commentary, "note");

    const placeholder = definition?.placeholders.get("books");
    assert.equal(placeholder?.kind, "language-form");
    assert.equal(placeholder?.kind === "language-form" ? placeholder.axis : null, "cardinality");
    assert.equal(placeholder?.kind === "language-form" ? placeholder.value : null, "bookCount");
    assert.equal(
      placeholder?.kind === "language-form" ? placeholder.translations.get("CARDINALITY_ONE") : null,
      "book",
    );
  });

  it("accepts an alternatives-only entry and leaves the expression unevaluated", () => {
    const definitions = parseCatalog(
      { "Books": { alternatives: [{ "bookCount == 0": { translation: "none" } }] } },
      { locale: "en", source: "t" },
    );

    const definition = definitions.get("Books");
    assert.equal(definition?.translation, null);
    assert.equal(definition?.alternatives.length, 1);
    assert.equal(definition?.alternatives[0]?.expression, "bookCount == 0");
    assert.equal(definition?.alternatives[0]?.definition.translation, "none");
  });

  it("parses a template-mode placeholder into a fragment definition", () => {
    const definitions = parseCatalog(
      {
        "Frag": {
          translation: "[{{frag}}]",
          placeholders: {
            frag: { translation: "few visits", alternatives: [{ "visitCount > 5": "many visits" }] },
          },
        },
      },
      { locale: "en", source: "t" },
    );

    const placeholder = definitions.get("Frag")?.placeholders.get("frag");
    assert.equal(placeholder?.kind, "expression");
    assert.deepEqual(
      placeholder?.kind === "expression" ? placeholder.alternatives : null,
      [{ expression: "visitCount > 5", translation: "many visits" }],
    );
  });
});

describe("parseCatalog bounds", () => {
  it("counts translation nodes while parsing: keys, placeholders, and alternatives", () => {
    const catalog = {
      "Key.A": {
        translation: "{{x}}",
        placeholders: { x: { translation: "default", alternatives: [{ "c == 1": "one" }, { "c == 2": "two" }] } },
        alternatives: [{ "c == 0": { translation: "zero" } }],
      },
    };

    // 1 root key + 1 placeholder + 2 fragment alternatives + 1 whole-message alternative.
    assert.ok(parseCatalog(catalog, { source: "t", limits: { maximumTranslationNodes: 5 } }));
    assert.throws(
      () => parseCatalog(catalog, { source: "t", limits: { maximumTranslationNodes: 4 } }),
      /exceeds the aggregate maximum of 4 translation nodes/,
    );
  });

  it("admits a flat catalog but not a nested one at depth 1", () => {
    assert.ok(
      parseCatalog({ "Key.A": "a" }, { source: "t", limits: { maximumJsonNestingDepth: 1 } }),
    );
    assert.throws(
      () =>
        parseCatalog(
          { "Key.A": { translation: "a" } },
          { source: "t", limits: { maximumJsonNestingDepth: 1 } },
        ),
      /JSON nesting depth exceeds the maximum of 1/,
    );
  });

  it("refuses a nesting-depth option outside 1..128", () => {
    assert.throws(
      () => parseCatalog({}, { source: "t", limits: { maximumJsonNestingDepth: 0 } }),
      /maximumJsonNestingDepth must be between 1 and 128/,
    );
    assert.throws(
      () => parseCatalog({}, { source: "t", limits: { maximumJsonNestingDepth: 129 } }),
      /maximumJsonNestingDepth must be between 1 and 128/,
    );
  });

  it("admits the deepest alternative nesting the JSON-depth ceiling allows", () => {
    // The two limits interact exactly as the corpus notes: each alternative level costs three JSON
    // containers, so with the option's own ceiling of 128 the alternative-depth cap of 128 is
    // unreachable from a file and 42 levels is the deepest catalog Java accepts.
    /** @param {number} depth */
    const nest = (depth) => {
      /** @type {any} */
      let node = { translation: "leaf" };

      for (let index = 0; index < depth; ++index)
        node = { translation: "t", alternatives: [{ "c == 1": node }] };

      return { "Nested.Alternatives": node };
    };

    assert.ok(parseCatalog(nest(42), { source: "t", limits: { maximumJsonNestingDepth: 128 } }));
    assert.throws(
      () => parseCatalog(nest(43), { source: "t", limits: { maximumJsonNestingDepth: 128 } }),
      /JSON nesting depth exceeds the maximum of 128/,
    );
  });

  it("names the declaration path of a reference inside an alternative", () => {
    // Java threads a `declarationPath` through the parse so a bad reference nested in an
    // alternative says WHERE it was declared. The corpus pins the exact text.
    assert.throws(
      () =>
        parseCatalog(
          { "Key.A": { alternatives: [{ "count == 0": { translation: "{{1bad}}" } }] } },
          { source: "s" },
        ),
      /invalid placeholder reference in translation declared at Key\.A -> alternative\[count == 0\] for key 'Key\.A'/,
    );
  });

  it("rejects reserved language-form names and malformed identifiers", () => {
    assert.throws(
      () => parseCatalog({ "Key.A": "I read {{CARDINALITY_ONE}}" }, { source: "t" }),
      /reserved expression constants/,
    );
    assert.throws(
      () => parseCatalog({ "Key.A": "Hello, {{1bad}}" }, { source: "t" }),
      /invalid placeholder reference/,
    );
    assert.throws(
      () => parseCatalog({ "Key.A": "Hello, {{name" }, { source: "t" }),
      /Unclosed placeholder/,
    );
    assert.throws(
      () => parseCatalog({ "Key.A": "Hello }} there" }, { source: "t" }),
      /Unexpected placeholder closing delimiter/,
    );
  });

  it("treats JavaScript's magic object keys as ordinary translation keys", () => {
    // The corpus records this file under `rawFiles`, so it is not reachable from the fixture gate,
    // but it is the one place the JS port can diverge from Java by accident.
    const raw = corpus.fixtures["loader-smoke-magic-keys"].rawFiles["en"];
    const definitions = parseCatalog(JSON.parse(raw), { locale: "en", source: "magic-keys" });

    assert.deepEqual(
      [...definitions.keys()].sort(),
      ["Key.Normal", "__proto__", "constructor", "prototype"],
    );
    assert.equal(definitions.get("__proto__")?.translation, "p");
    assert.equal(definitions.get("constructor")?.translation, "c");
  });

  it("rejects a top-level value that is not an object", () => {
    for (const value of [42, "text", null, [{ "Key.A": "a" }], true])
      assert.throws(
        () => parseCatalog(value, { source: "t" }),
        /must be comprised of a single JSON object/,
      );
  });
});
