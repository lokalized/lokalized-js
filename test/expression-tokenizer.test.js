// @ts-check
/**
 * Gates `src/internal/expression-tokenizer.js` against `ExpressionTokenizer.java`.
 *
 * Three kinds of assertion:
 *
 * 1. Hand-derived token sequences for every shape the grammar can produce. These come from reading
 *    the Java alternation, not from re-running the JS tokenizer, so they catch an ordering mistake
 *    rather than ratifying one.
 * 2. A whole-corpus sweep: every distinct expression that appears anywhere in the 483 fixtures must
 *    tokenize, EXCEPT `count =? 0`, which the corpus records as failing during tokenization with an
 *    exact message. Every other malformed expression in the corpus fails later, in the evaluator, so
 *    it must lex cleanly here.
 * 3. Structural invariants of the ported enum: 74 token types, the exact symbol tables, and the
 *    absence of `eval`/`new Function`.
 */

import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ExpressionEvaluationError,
  LANGUAGE_FORM_TOKEN_TYPES,
  SYMBOL_BY_TOKEN_TYPE,
  TOKEN_TYPE_BY_SYMBOL,
  TokenType,
  createToken,
  extractTokens,
  isLanguageFormTokenType,
  symbolForTokenType,
} from "../src/internal/expression-tokenizer.js";

const corpus = JSON.parse(
  readFileSync(
    new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url),
    "utf8",
  ),
);

/**
 * Compact rendering of a token list: `["VARIABLE:count", "EQUAL_TO:==", "NUMBER:1"]`.
 *
 * @param {string} expression
 * @returns {string[]}
 */
function lex(expression) {
  return extractTokens(expression).map((token) => `${token.tokenType}:${token.symbol}`);
}

test("enum: 74 token types in Java's declaration order", () => {
  const names = Object.keys(TokenType);
  strictEqual(names.length, 74);
  strictEqual(new Set(names).size, 74);

  // Values are their own names, so a token type is always printable as Java prints it.
  for (const name of names) strictEqual(TokenType[/** @type {never} */ (name)], name);

  deepStrictEqual(names.slice(0, 13), [
    "VARIABLE",
    "NUMBER",
    "BOOLEAN_RESULT",
    "GROUP_START",
    "GROUP_END",
    "AND",
    "OR",
    "LESS_THAN",
    "GREATER_THAN",
    "EQUAL_TO",
    "NOT_EQUAL_TO",
    "LESS_THAN_OR_EQUAL_TO",
    "GREATER_THAN_OR_EQUAL_TO",
  ]);

  strictEqual(LANGUAGE_FORM_TOKEN_TYPES.length, 61);
  deepStrictEqual(names.slice(13), [...LANGUAGE_FORM_TOKEN_TYPES]);
});

test("enum: the 61 language forms cover the ten axes with Java's member counts", () => {
  /** @type {Record<string, number>} */
  const expected = {
    CARDINALITY_: 6,
    ORDINALITY_: 6,
    PHONETIC_: 16,
    GENDER_: 4,
    CASE_: 9,
    DEFINITENESS_: 3,
    CLASSIFIER_: 8,
    FORMALITY_: 5,
    CLUSIVITY_: 2,
    ANIMACY_: 2,
  };

  /** @type {Record<string, number>} */
  const actual = {};
  for (const name of LANGUAGE_FORM_TOKEN_TYPES) {
    const prefix = Object.keys(expected).find((candidate) => name.startsWith(candidate));
    ok(prefix, `${name} belongs to no known axis`);
    actual[prefix] = (actual[prefix] ?? 0) + 1;
  }

  deepStrictEqual(actual, expected);
});

test("enum: symbol tables match TokenType's constructor arguments", () => {
  // 10 operators/grouping + 61 language forms; VARIABLE, NUMBER and BOOLEAN_RESULT have none.
  strictEqual(Object.keys(SYMBOL_BY_TOKEN_TYPE).length, 71);
  strictEqual(symbolForTokenType(TokenType.VARIABLE), null);
  strictEqual(symbolForTokenType(TokenType.NUMBER), null);
  strictEqual(symbolForTokenType(TokenType.BOOLEAN_RESULT), null);
  strictEqual(symbolForTokenType(TokenType.LESS_THAN_OR_EQUAL_TO), "<=");
  strictEqual(symbolForTokenType(TokenType.OR), "||");

  // A language form's symbol is its own name.
  for (const name of LANGUAGE_FORM_TOKEN_TYPES) strictEqual(symbolForTokenType(name), name);

  strictEqual(Object.keys(TOKEN_TYPE_BY_SYMBOL).length, 71);
  strictEqual(TOKEN_TYPE_BY_SYMBOL["=="], TokenType.EQUAL_TO);
  strictEqual(TOKEN_TYPE_BY_SYMBOL["GENDER_FEMININE"], TokenType.GENDER_FEMININE);
  strictEqual(TOKEN_TYPE_BY_SYMBOL["count"], undefined);

  ok(isLanguageFormTokenType(TokenType.PHONETIC_GLIDE_W));
  ok(!isLanguageFormTokenType(TokenType.VARIABLE));
  ok(!isLanguageFormTokenType(TokenType.BOOLEAN_RESULT));
});

test("createToken: applies both Java Token constructor checks", () => {
  deepStrictEqual(createToken(TokenType.AND), { tokenType: "AND", symbol: "&&" });
  deepStrictEqual(createToken(TokenType.BOOLEAN_RESULT, "true"), {
    tokenType: "BOOLEAN_RESULT",
    symbol: "true",
  });
  deepStrictEqual(createToken(TokenType.AND, "&&"), { tokenType: "AND", symbol: "&&" });

  throws(() => createToken(TokenType.VARIABLE), /must provide a symbol for TokenType.VARIABLE/);
  throws(() => createToken(TokenType.AND, "||"), /does not match required value '&&'/);
});

test("operators: the two-character forms are never split by their prefixes", () => {
  deepStrictEqual(lex("a <= b"), ["VARIABLE:a", "LESS_THAN_OR_EQUAL_TO:<=", "VARIABLE:b"]);
  deepStrictEqual(lex("a >= b"), ["VARIABLE:a", "GREATER_THAN_OR_EQUAL_TO:>=", "VARIABLE:b"]);
  deepStrictEqual(lex("a < b"), ["VARIABLE:a", "LESS_THAN:<", "VARIABLE:b"]);
  deepStrictEqual(lex("a > b"), ["VARIABLE:a", "GREATER_THAN:>", "VARIABLE:b"]);
  deepStrictEqual(lex("a == b"), ["VARIABLE:a", "EQUAL_TO:==", "VARIABLE:b"]);
  deepStrictEqual(lex("a != b"), ["VARIABLE:a", "NOT_EQUAL_TO:!=", "VARIABLE:b"]);
  deepStrictEqual(lex("a&&b"), ["VARIABLE:a", "AND:&&", "VARIABLE:b"]);
  deepStrictEqual(lex("a||b"), ["VARIABLE:a", "OR:||", "VARIABLE:b"]);
  deepStrictEqual(lex("()"), ["GROUP_START:(", "GROUP_END:)"]);

  // `==` is one token, not two `=`; `<==` is `<=` then `=`, which is unlexable.
  deepStrictEqual(lex("a<=b"), ["VARIABLE:a", "LESS_THAN_OR_EQUAL_TO:<=", "VARIABLE:b"]);
  throws(() => extractTokens("a<==b"), ExpressionEvaluationError);
});

test("numbers: the accepted literal forms", () => {
  deepStrictEqual(lex("1"), ["NUMBER:1"]);
  deepStrictEqual(lex("1.234"), ["NUMBER:1.234"]);
  deepStrictEqual(lex("1."), ["NUMBER:1."]);
  deepStrictEqual(lex(".5"), ["NUMBER:.5"]);
  deepStrictEqual(lex("-5"), ["NUMBER:-5"]);
  deepStrictEqual(lex("+5"), ["NUMBER:+5"]);
  deepStrictEqual(lex("1e10"), ["NUMBER:1e10"]);
  deepStrictEqual(lex("1E-10"), ["NUMBER:1E-10"]);
  deepStrictEqual(lex("1.5e+3"), ["NUMBER:1.5e+3"]);
  deepStrictEqual(lex("100000000000000000001"), ["NUMBER:100000000000000000001"]);

  // NUMBER precedes VARIABLE, so a digit start wins even when letters follow.
  deepStrictEqual(lex("1abc"), ["NUMBER:1", "VARIABLE:abc"]);
  // `5-3` is two signed literals, not subtraction: there is no arithmetic in this language.
  deepStrictEqual(lex("5-3"), ["NUMBER:5", "NUMBER:-3"]);
  // But `-` is an identifier character, so a leading letter swallows it.
  deepStrictEqual(lex("a-5"), ["VARIABLE:a-5"]);
  // A bare `.` matches nothing.
  throws(() => extractTokens("."), ExpressionEvaluationError);
});

test("identifiers: language-form constants are recovered by EXACT whole-symbol lookup", () => {
  deepStrictEqual(lex("GENDER_FEMININE"), ["GENDER_FEMININE:GENDER_FEMININE"]);
  deepStrictEqual(lex("CARDINALITY_OTHER"), ["CARDINALITY_OTHER:CARDINALITY_OTHER"]);

  // The boundary cases the alternation must get right: a constant with anything glued to it is a
  // variable, because the greedy identifier pattern matches the whole run and misses the lookup.
  deepStrictEqual(lex("GENDER_FEMININEX"), ["VARIABLE:GENDER_FEMININEX"]);
  deepStrictEqual(lex("myGENDER_FEMININE"), ["VARIABLE:myGENDER_FEMININE"]);
  deepStrictEqual(lex("GENDER_FEMININE_"), ["VARIABLE:GENDER_FEMININE_"]);
  deepStrictEqual(lex("GENDER_FEMININE1"), ["VARIABLE:GENDER_FEMININE1"]);
  deepStrictEqual(lex("GENDER_FEMININE-X"), ["VARIABLE:GENDER_FEMININE-X"]);
  deepStrictEqual(lex("GENDER_"), ["VARIABLE:GENDER_"]);
  deepStrictEqual(lex("gender_feminine"), ["VARIABLE:gender_feminine"]);

  // A delimiter does re-expose the constant.
  deepStrictEqual(lex("(GENDER_FEMININE)"), [
    "GROUP_START:(",
    "GENDER_FEMININE:GENDER_FEMININE",
    "GROUP_END:)",
  ]);

  // Every one of the 61 lexes to its own token type, and nothing else does.
  for (const name of LANGUAGE_FORM_TOKEN_TYPES) deepStrictEqual(lex(name), [`${name}:${name}`]);

  deepStrictEqual(lex("_leading"), ["VARIABLE:_leading"]);
  deepStrictEqual(lex("naïve-count_2"), ["VARIABLE:naïve-count_2"]);
  // A digit cannot start an identifier.
  deepStrictEqual(lex("2x"), ["NUMBER:2", "VARIABLE:x"]);
});

test("whitespace: exactly the five ASCII forms are ignorable", () => {
  deepStrictEqual(lex("a\t==\r\n\f b"), ["VARIABLE:a", "EQUAL_TO:==", "VARIABLE:b"]);
  strictEqual(extractTokens("   ").length, 0);
  strictEqual(extractTokens("").length, 0);

  // Other Unicode separators are rejected, not skipped: NBSP and the vertical tab.
  throws(() => extractTokens("a == b"), /U\+00A0 at index 1/);
  throws(() => extractTokens("a== b"), /U\+000B at index 1/);
  throws(() => extractTokens("a == b"), /U\+2028 at index 1/);
});

test("diagnostics: exact Java message text, including the single-equals hint", () => {
  throws(
    () => extractTokens("count =? 0"),
    (error) => {
      ok(error instanceof ExpressionEvaluationError);
      strictEqual(error.name, "ExpressionEvaluationError");
      strictEqual(error.code, "EXPRESSION_EVALUATION");
      strictEqual(
        error.message,
        "Unexpected code point U+003D at index 6 while evaluating expression 'count =? 0'." +
          " Did you mean '=='?",
      );
      return true;
    },
  );

  // The hint is attached only for `=`.
  throws(
    () => extractTokens("a ? b"),
    (error) => {
      strictEqual(
        /** @type {Error} */ (error).message,
        "Unexpected code point U+003F at index 2 while evaluating expression 'a ? b'.",
      );
      return true;
    },
  );

  // A lone `&` or `|` is not an operator.
  throws(() => extractTokens("a & b"), /U\+0026 at index 2/);
  throws(() => extractTokens("a | b"), /U\+007C at index 2/);
  throws(() => extractTokens("a ! b"), /U\+0021 at index 2/);

  // `%04X` is a minimum width, not a truncation: a supplementary code point prints in full, and its
  // index is the UTF-16 index Java reports.
  throws(() => extractTokens("a \u{1f600}"), /U\+1F600 at index 2/);
});

test("corpus: every fixture expression lexes, except the one the corpus fails at this stage", () => {
  /** @type {Map<string, string>} */
  const expressions = new Map();

  /**
   * @param {unknown} node
   * @param {string} fixtureName
   */
  const walk = (node, fixtureName) => {
    if (Array.isArray(node)) {
      for (const element of node) walk(element, fixtureName);
      return;
    }
    if (node === null || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      // An alternative is a single-key object whose KEY is the expression.
      if (key === "alternatives" && Array.isArray(value))
        for (const element of value)
          if (element !== null && typeof element === "object" && !Array.isArray(element))
            for (const expression of Object.keys(element))
              if (!expressions.has(expression)) expressions.set(expression, fixtureName);

      walk(value, fixtureName);
    }
  };

  for (const [fixtureName, fixture] of Object.entries(corpus.fixtures)) {
    walk(/** @type {{ files?: unknown }} */ (fixture).files, fixtureName);
    walk(/** @type {{ rawFiles?: unknown }} */ (fixture).rawFiles, fixtureName);
  }

  // Guards the sweep itself: if the extraction stops finding expressions, this test stops proving
  // anything, so pin a floor well below the current 280.
  ok(expressions.size >= 250, `only found ${expressions.size} corpus expressions`);

  /** The only corpus expression whose recorded failure is a TOKENIZER diagnostic. */
  const lexicallyInvalid = new Set(["count =? 0"]);

  /** @type {string[]} */
  const unexpectedFailures = [];
  /** @type {string[]} */
  const unexpectedSuccesses = [];

  for (const [expression, fixtureName] of expressions) {
    let failed = false;
    try {
      extractTokens(expression);
    } catch {
      failed = true;
    }

    if (failed && !lexicallyInvalid.has(expression))
      unexpectedFailures.push(`${expression} (${fixtureName})`);
    if (!failed && lexicallyInvalid.has(expression))
      unexpectedSuccesses.push(`${expression} (${fixtureName})`);
  }

  deepStrictEqual(unexpectedFailures, []);
  deepStrictEqual(unexpectedSuccesses, []);

  // And the corpus really does record that one as a tokenizer failure.
  const unknownOperator = corpus.cases.find(
    (/** @type {{ id: string }} */ testCase) =>
      testCase.id === "malformed-structure.expression.unknown-operator-rejected",
  );
  ok(unknownOperator, "corpus case malformed-structure.expression.unknown-operator-rejected");
  ok(
    String(unknownOperator.expected.parse.failureMessage).endsWith(
      "Unexpected code point U+003D at index 6 while evaluating expression 'count =? 0'." +
        " Did you mean '=='?",
    ),
    "the corpus message ends with the tokenizer diagnostic this module produces",
  );
});

test("corpus: hand-derived token sequences for the expression shapes the fixtures use", () => {
  /** @type {[string, string[]][]} */
  const cases = [
    ["", []],
    ["count == 1", ["VARIABLE:count", "EQUAL_TO:==", "NUMBER:1"]],
    // Fails later as "Unexpected extra values exist on the stack: [0, count]", which is only
    // possible if it lexes to exactly these two operand tokens.
    ["count 0", ["VARIABLE:count", "NUMBER:0"]],
    ["count ==", ["VARIABLE:count", "EQUAL_TO:=="]],
    ["count == 0 &&", ["VARIABLE:count", "EQUAL_TO:==", "NUMBER:0", "AND:&&"]],
    ["count == 0)", ["VARIABLE:count", "EQUAL_TO:==", "NUMBER:0", "GROUP_END:)"]],
    ["(count == 0", ["GROUP_START:(", "VARIABLE:count", "EQUAL_TO:==", "NUMBER:0"]],
    [
      "count == 0 == 1",
      ["VARIABLE:count", "EQUAL_TO:==", "NUMBER:0", "EQUAL_TO:==", "NUMBER:1"],
    ],
    [
      "itemCount == CARDINALITY_MANY",
      ["VARIABLE:itemCount", "EQUAL_TO:==", "CARDINALITY_MANY:CARDINALITY_MANY"],
    ],
    [
      "value == PHONETIC_VOWEL",
      ["VARIABLE:value", "EQUAL_TO:==", "PHONETIC_VOWEL:PHONETIC_VOWEL"],
    ],
    [
      "formality == FORMALITY_HONORIFIC",
      ["VARIABLE:formality", "EQUAL_TO:==", "FORMALITY_HONORIFIC:FORMALITY_HONORIFIC"],
    ],
    [
      "alpha == 1 || beta == 1 && gamma == 1",
      [
        "VARIABLE:alpha",
        "EQUAL_TO:==",
        "NUMBER:1",
        "OR:||",
        "VARIABLE:beta",
        "EQUAL_TO:==",
        "NUMBER:1",
        "AND:&&",
        "VARIABLE:gamma",
        "EQUAL_TO:==",
        "NUMBER:1",
      ],
    ],
    [
      "(alpha == 1 || beta == 1) && gamma == 1",
      [
        "GROUP_START:(",
        "VARIABLE:alpha",
        "EQUAL_TO:==",
        "NUMBER:1",
        "OR:||",
        "VARIABLE:beta",
        "EQUAL_TO:==",
        "NUMBER:1",
        "GROUP_END:)",
        "AND:&&",
        "VARIABLE:gamma",
        "EQUAL_TO:==",
        "NUMBER:1",
      ],
    ],
    ["level >= 1", ["VARIABLE:level", "GREATER_THAN_OR_EQUAL_TO:>=", "NUMBER:1"]],
    ["left != right", ["VARIABLE:left", "NOT_EQUAL_TO:!=", "VARIABLE:right"]],
    ["n == 1.234", ["VARIABLE:n", "EQUAL_TO:==", "NUMBER:1.234"]],
    [
      "orderId == 9007199254740993",
      ["VARIABLE:orderId", "EQUAL_TO:==", "NUMBER:9007199254740993"],
    ],
    [
      "orderId == 100000000000000000001",
      ["VARIABLE:orderId", "EQUAL_TO:==", "NUMBER:100000000000000000001"],
    ],
    [
      "itemCount > 0 && itemCount < 3",
      [
        "VARIABLE:itemCount",
        "GREATER_THAN:>",
        "NUMBER:0",
        "AND:&&",
        "VARIABLE:itemCount",
        "LESS_THAN:<",
        "NUMBER:3",
      ],
    ],
    // The token-limit fixture is pinned at nine tokens; the count must agree.
    [
      "(a > 0) && b == 1",
      [
        "GROUP_START:(",
        "VARIABLE:a",
        "GREATER_THAN:>",
        "NUMBER:0",
        "GROUP_END:)",
        "AND:&&",
        "VARIABLE:b",
        "EQUAL_TO:==",
        "NUMBER:1",
      ],
    ],
  ];

  for (const [expression, expected] of cases)
    deepStrictEqual(lex(expression), expected, `tokenizing ${JSON.stringify(expression)}`);

  strictEqual(extractTokens("(a > 0) && b == 1").length, 9);
  strictEqual("(a > 0) && b == 1".length, 17);
});

test("identifiers named after Object.prototype members stay variables", () => {
  // `TOKEN_TYPE_BY_SYMBOL` and `SYMBOL_BY_TOKEN_TYPE` are ordinary objects, so a bare index would
  // find the INHERITED member and turn each of these into a bogus token type. Java asks a HashMap,
  // which returns null. Verified against the Java tokenizer for all of these.
  for (const name of [
    "toString",
    "valueOf",
    "constructor",
    "hasOwnProperty",
    "__proto__",
    "__defineGetter__",
    "propertyIsEnumerable",
    "isPrototypeOf",
    "toLocaleString",
  ]) {
    deepStrictEqual(lex(name), [`VARIABLE:${name}`]);
    deepStrictEqual(lex(`${name} == 1`), [`VARIABLE:${name}`, "EQUAL_TO:==", "NUMBER:1"]);
  }

  strictEqual(symbolForTokenType(/** @type {never} */ ("toString")), null);
  strictEqual(symbolForTokenType(/** @type {never} */ ("constructor")), null);
  strictEqual(isLanguageFormTokenType("toString"), false);
});

test("java ground truth: every vector produced by lokalized-java 3.0.0 itself", () => {
  const ground = JSON.parse(
    readFileSync(new URL("data/expression-tokenizer-java-vectors.json", import.meta.url), "utf8"),
  );

  strictEqual(ground.vectors.length, ground.vectorCount);
  ok(ground.vectorCount >= 1400, `only ${ground.vectorCount} ground-truth vectors`);

  /** @type {string[]} */
  const mismatches = [];
  let rejections = 0;

  for (const vector of ground.vectors) {
    /** @type {{ tokens?: string[], error?: string }} */
    let actual;
    try {
      actual = { tokens: lex(vector.expression) };
    } catch (error) {
      actual = { error: /** @type {Error} */ (error).message };
    }

    if ("error" in vector) {
      rejections += 1;
      if (actual.error !== vector.error)
        mismatches.push(
          `${JSON.stringify(vector.expression)}: expected error ${JSON.stringify(vector.error)},` +
            ` got ${JSON.stringify(actual.error ?? actual.tokens)}`,
        );
      continue;
    }

    if (JSON.stringify(actual.tokens) !== JSON.stringify(vector.tokens))
      mismatches.push(
        `${JSON.stringify(vector.expression)}: expected ${JSON.stringify(vector.tokens)},` +
          ` got ${JSON.stringify(actual.error ?? actual.tokens)}`,
      );
  }

  deepStrictEqual(mismatches.slice(0, 10), []);
  strictEqual(mismatches.length, 0);
  // Both halves must be exercised: a file of only-accepts would not gate the diagnostics.
  ok(rejections >= 150, `only ${rejections} rejection vectors`);
});

test("no dynamic code evaluation in the tokenizer", () => {
  const source = readFileSync(
    new URL("../src/internal/expression-tokenizer.js", import.meta.url),
    "utf8",
  );

  ok(!/\beval\s*\(/.test(source), "eval( appears in the tokenizer");
  ok(!/new\s+Function\b/.test(source), "new Function appears in the tokenizer");
  ok(!/\bimport\s*\(/.test(source), "dynamic import appears in the tokenizer");
});
