// @ts-check
/**
 * `src/internal/expression.js` — eager compilation and runtime evaluation.
 *
 * The corpus already gates the 74 `expressions` cases end to end through `npm run conformance`, so
 * this file deliberately does NOT re-run them. It covers what a `getResult` case cannot see:
 *
 *   - the COMPILE/EVALUATE split, which is a behaviour rather than an optimization;
 *   - the three fixed limits and, more importantly, the ORDER they are checked in;
 *   - exact numeric comparison at magnitudes and scales binary64 destroys;
 *   - all ten axes, including the seven the corpus's expression fixtures never exercise;
 *   - the diagnostic text, which the conformance runner's result projection does not compare.
 *
 * Java message text is quoted verbatim wherever the corpus records it. Two messages are
 * deliberately JavaScript's own — the missing-phonetic-resolver hint and the missing-ordinal-data
 * hint — because the Java originals name Java APIs that do not exist here.
 */
import { deepStrictEqual, match, ok, strictEqual, throws } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXPRESSION_LIMITS,
  EXPRESSION_LIMIT_CEILINGS,
  ExpressionEvaluationError,
  compile,
  evaluate,
  evaluateExpression,
} from "../src/internal/expression.js";

const EN = "en";

/** @param {string} name */
const sourceOf = (name) =>
  readFileSync(fileURLToPath(new URL(`../src/internal/${name}`, import.meta.url)), "utf8");

/**
 * Evaluate, returning either the boolean or the thrown message. Reads far better than a dozen
 * `throws` blocks when the point of a case IS the message.
 *
 * @param {string} expression
 * @param {Record<string, unknown> | Map<string, unknown> | undefined} [values]
 * @param {string} [locale]
 * @returns {boolean | string}
 */
function run(expression, values, locale = EN) {
  try {
    return evaluateExpression(expression, values, locale);
  } catch (error) {
    ok(error instanceof ExpressionEvaluationError, `expected an ExpressionEvaluationError: ${error}`);
    return error.message;
  }
}

/**
 * @param {string} axis
 * @param {string} name
 */
const form = (axis, name) => Object.freeze({ $lokalized: "language-form", axis, name, renderName: name });

const decimal = (/** @type {string} */ value) => Object.freeze({ $lokalized: "decimal", value });

/**
 * @param {string} value
 * @param {{ visibleDecimalPlaces?: number, compactExponent?: number }} [options]
 */
const operands = (value, options) => Object.freeze({ $lokalized: "plural-operands", value, ...options });

/* -------------------------------------------------------------------------- */

test("no dynamic code evaluation anywhere in the expression implementation", () => {
  // The gate names this explicitly, and it is the one property a passing corpus could never prove:
  // an evaluator built on `new Function` would pass all 74 cases and be the wrong artifact.
  for (const file of ["expression.js", "expression-tokenizer.js"]) {
    // Comments are stripped first, so a module is free to NAME the constructs it refuses to use —
    // which both of these do, at length. Only executable text is scanned.
    const source = sourceOf(file)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    ok(!/\beval\s*\(/.test(source), `eval( appears in ${file}`);
    ok(!/new\s+Function\b/.test(source), `new Function appears in ${file}`);
    ok(!/\bFunction\s*\(/.test(source), `Function( appears in ${file}`);
    ok(!/\bimport\s*\(/.test(source), `a dynamic import appears in ${file}`);
  }
});

test("compilation is eager: every static error is raised by compile(), not by evaluate()", () => {
  // Java's `DefaultStrings` constructor compiles every loaded expression, so a broken predicate in
  // a branch no lookup ever reaches still fails construction of the whole catalog. A lazily-parsing
  // port passes the corpus and loses that property, which is why this is asserted directly.
  for (const broken of ["count ==", "count == 0 &&", "(count == 0", "count == 0)", "count =? 0", ""])
    throws(() => compile(broken), ExpressionEvaluationError, `compile should reject ${JSON.stringify(broken)}`);

  // And the converse: a compiled expression is a value, evaluable repeatedly against different
  // bindings, with no re-parsing in between.
  const compiled = compile("count == 1 || count == 2");

  strictEqual(evaluate(compiled, { count: 1 }, EN), true);
  strictEqual(evaluate(compiled, { count: 2 }, EN), true);
  strictEqual(evaluate(compiled, { count: 3 }, EN), false);

  ok(Object.isFrozen(compiled), "a compiled expression must be frozen");
  ok(Object.isFrozen(compiled.root), "the compiled tree must be frozen");
  strictEqual(compiled.expression, "count == 1 || count == 2");
});

test("compilation resolves numeric literals once, so evaluation parses nothing", () => {
  // A bad literal is an authoring error and must surface at compile time even though nothing has
  // been evaluated yet.
  throws(
    () => compile("count == 1e999999"),
    (/** @type {Error} */ error) =>
      error instanceof ExpressionEvaluationError && error.message.startsWith("Invalid numeric literal '1e999999':"),
  );
});

/* --- precedence and grouping ---------------------------------------------- */

test("precedence: && binds tighter than ||, and parentheses override", () => {
  // alpha || (beta && gamma). The same tuple under the other parse is false, which is what makes
  // this observable rather than a matter of taste.
  const orOfAnd = "alpha == 1 || beta == 1 && gamma == 1";
  const andOfOr = "(alpha == 1 || beta == 1) && gamma == 1";

  strictEqual(run(orOfAnd, { alpha: 1, beta: 1, gamma: 0 }), true);
  strictEqual(run(andOfOr, { alpha: 1, beta: 1, gamma: 0 }), false);

  strictEqual(run(orOfAnd, { alpha: 0, beta: 1, gamma: 1 }), true);
  strictEqual(run(orOfAnd, { alpha: 0, beta: 1, gamma: 0 }), false);
  strictEqual(run(andOfOr, { alpha: 1, beta: 1, gamma: 1 }), true);
});

test("precedence: comparison binds tighter than either boolean operator", () => {
  strictEqual(run("a == 1 && b == 1", { a: 1, b: 1 }), true);
  strictEqual(run("a < 2 && b >= 2", { a: 1, b: 2 }), true);
});

test("short-circuiting is semantics: the skipped side is never resolved", () => {
  // `absentRight` has no binding at all. Touching it is a hard error, so these cases prove the
  // operand was not merely ignored but never reached.
  strictEqual(run("alpha == 1 || absentRight == 1", { alpha: 1 }), true);
  strictEqual(run("alpha == 1 && absentRight == 1", { alpha: 0 }), false);
  strictEqual(run("alpha == 1 || absentLeft == 1 && absentRight == 1", { alpha: 1 }), true);
  strictEqual(run("alpha == 1 && (beta == 1 || absentRight == 1)", { alpha: 0, beta: 1 }), false);
  strictEqual(run("alpha == 1 && (beta == 1 || absentRight == 1)", { alpha: 1, beta: 1 }), true);

  // The LEFT operand is always evaluated, even when the right alone would settle the result.
  strictEqual(run("absentLeft == 1 || alpha == 1", { alpha: 1 }), "No value was provided for placeholder 'absentLeft'");

  // And a reached operand still fails, so short-circuiting is not a blanket suppression.
  strictEqual(run("alpha == 1 || absentRight == 1", { alpha: 0 }), "No value was provided for placeholder 'absentRight'");
  strictEqual(
    run("alpha == 1 && absentRight == 1", { alpha: 1 }),
    "No value was provided for placeholder 'absentRight'",
  );
});

/* --- chained comparisons --------------------------------------------------- */

test("chained comparisons are rejected at compile time, naming both operands", () => {
  // `a < b < c` is the shape; Java reports the synthetic left operand as `previous comparison`,
  // which is what tells an author WHERE the second comparison went wrong.
  strictEqual(
    run("count == 0 == 1", { count: 0 }),
    "Invalid expression 'count == 0 == 1': Chained comparisons are not supported. " +
      "Operator '==' cannot compare BOOLEAN and NUMBER in 'previous comparison == 1'",
  );

  strictEqual(
    run("a < b < c", { a: 1, b: 2, c: 3 }),
    "Invalid expression 'a < b < c': Chained comparisons are not supported. " +
      "Operator '<' cannot compare BOOLEAN and UNKNOWN_VARIABLE in 'previous comparison < c'",
  );

  // A boolean operand on the RIGHT of a comparison is the same defect seen from the other side.
  strictEqual(
    run("1 == (a == 1)", { a: 1 }),
    "Invalid expression '1 == (a == 1)': Chained comparisons are not supported. " +
      "Operator '==' cannot compare NUMBER and BOOLEAN in '1 == previous comparison'",
  );
});

test("a boolean operator requires boolean operands", () => {
  strictEqual(
    run("a && b", { a: 1, b: 1 }),
    "Invalid expression 'a && b': Operator '&&' requires boolean operands but encountered " +
      "UNKNOWN_VARIABLE and UNKNOWN_VARIABLE in 'a && b'",
  );
});

test("an expression must evaluate to a boolean", () => {
  strictEqual(
    run("count", { count: 1 }),
    "Invalid expression 'count': Expression must evaluate to a boolean result but ended with " +
      "operand 'count' (UNKNOWN_VARIABLE)",
  );

  strictEqual(run("", {}), "Invalid expression '': Expression must not be empty");
});

test("leftover operands are reported TOP-OF-STACK FIRST, the way Java streams an ArrayDeque", () => {
  // The corpus records this exact string for `count 0`, and the order inside the brackets is the
  // half a port gets wrong for free. The values are PUSHED `count` then `0`; Java streams the
  // `ArrayDeque` head-first, so the message reads `[0, count]`. A port that prints its own array in
  // push order emits `[count, 0]` — same characters, wrong answer — and nothing else can see the
  // difference: the only corpus case carrying this message is a `parse` case, which this milestone
  // does not run. Verified against the recorded Java text in behavioral-vectors.json.
  strictEqual(
    run("count 0", { count: 1 }),
    "Invalid expression 'count 0': Unexpected extra values exist on the stack: [0, count]",
  );

  // Three deep, so what is pinned is an ORDERING and not a two-element swap.
  strictEqual(
    run("a b c", {}),
    "Invalid expression 'a b c': Unexpected extra values exist on the stack: [c, b, a]",
  );
});

test("ordering operators reject statically non-numeric operands", () => {
  strictEqual(
    run("GENDER_FEMININE < 5", {}),
    "Invalid expression 'GENDER_FEMININE < 5': Operator '<' requires numeric operands but " +
      "encountered GENDER and NUMBER in 'GENDER_FEMININE < 5'",
  );
});

test("equality across statically incompatible constant axes is rejected at compile time", () => {
  strictEqual(
    run("GENDER_FEMININE == FORMALITY_FORMAL", {}),
    "Invalid expression 'GENDER_FEMININE == FORMALITY_FORMAL': Operator '==' cannot compare " +
      "GENDER and FORMALITY operands in 'GENDER_FEMININE == FORMALITY_FORMAL'",
  );

  // Number-versus-cardinality and number-versus-ordinality are the two cross-type equalities the
  // language DOES allow, because a number classifies into a plural category.
  strictEqual(run("1 == CARDINALITY_ONE", {}), true);
  strictEqual(run("5 == CARDINALITY_ONE", {}), false);
});

/* --- the fixed limits ------------------------------------------------------ */

test("the fixed limits are Java's defaults and ceilings", () => {
  deepStrictEqual({ ...EXPRESSION_LIMITS }, {
    maximumExpressionCharacters: 2048,
    maximumExpressionTokens: 256,
    maximumExpressionNestingDepth: 32,
  });

  deepStrictEqual({ ...EXPRESSION_LIMIT_CEILINGS }, {
    maximumExpressionCharacters: 4096,
    maximumExpressionTokens: 512,
    maximumExpressionNestingDepth: 64,
  });
});

test("limits: characters are checked BEFORE tokenization, tokens and depth after", () => {
  // The ordering is observable. This expression breaches BOTH the character limit and the token
  // limit; Java checks length first, so the length message is the one an author sees.
  const many = Array.from({ length: 400 }, () => "a==1").join("||");
  ok(many.length > EXPRESSION_LIMITS.maximumExpressionCharacters, "fixture must exceed the character limit");

  strictEqual(run(many, { a: 1 }), `Expression length ${many.length} exceeds maximum supported length 2048`);

  // Same argument from the other direction: content the lexer would reject is never reached,
  // because the length check happens before a single character is scanned.
  const overlongAndUnlexable = `${"a".repeat(2100)} =? 1`;
  strictEqual(
    run(overlongAndUnlexable, {}),
    `Expression length ${overlongAndUnlexable.length} exceeds maximum supported length 2048`,
  );
});

test("limits: the token count is checked after tokenization", () => {
  // 65 comparisons joined by `||` is 259 tokens in 388 characters — over the token limit and well
  // under the character one, so only the token limit can fire.
  const source = Array.from({ length: 65 }, () => "a==1").join("||");
  ok(source.length <= EXPRESSION_LIMITS.maximumExpressionCharacters);

  strictEqual(
    run(source, { a: 1 }),
    "Expression contains 259 tokens, which exceeds maximum supported token count 256",
  );

  // One term fewer is 255 tokens and evaluates normally.
  strictEqual(run(Array.from({ length: 64 }, () => "a==1").join("||"), { a: 1 }), true);
});

test("limits: the token boundary itself, not merely a gross overflow", () => {
  // The boundary is what an off-by-one moves, and the two assertions above it cannot see one: at
  // 259 tokens and at 7-against-a-limit-of-4 a `>` and a `>= ` and a `> limit + 1` all agree. A
  // mutation that relaxed `validateInfixTokens` to `tokens.length > maximum + 1` survived the whole
  // suite AND the whole corpus, which is why these two live here.
  //
  // A well-formed expression always has an ODD token count (3 per comparison, 1 per joining
  // operator, 2 per balanced group), so 256 exactly is unreachable and the default's boundary is
  // pinned from both sides: 255 accepted, 257 refused.
  const comparisons = (/** @type {number} */ count) => Array.from({ length: count }, () => "a==1").join("||");

  strictEqual(run(comparisons(64), { a: 1 }), true); // 255 tokens

  const justOver = `(a==1)||${comparisons(63)}`; // 257 tokens
  strictEqual(
    run(justOver, { a: 1 }),
    "Expression contains 257 tokens, which exceeds maximum supported token count 256",
  );

  // And the configured-limit boundary exactly: a limit EQUAL to the token count is accepted, one
  // below it is refused. `a == 1 && b == 1` is seven tokens.
  strictEqual(evaluate(compile("a == 1 && b == 1", { limits: { maximumExpressionTokens: 7 } }), { a: 1, b: 1 }, EN), true);
  throws(
    () => compile("a == 1 && b == 1", { limits: { maximumExpressionTokens: 6 } }),
    (/** @type {Error} */ error) =>
      error.message === "Expression contains 7 tokens, which exceeds maximum supported token count 6",
  );
});

test("limits: the character boundary itself, not merely a gross overflow", () => {
  // Same argument as the token boundary above, for the limit that is checked FIRST. Every other
  // character-limit assertion in this file is thousands of characters over, where `>` and `>=`
  // agree; only the limit itself separates them. A mutation relaxing
  // `validateExpressionSourceLength` to `>=` — which refuses an expression of exactly 2,048
  // characters that Java accepts — survived the entire suite and the entire corpus before this.
  const name = "a".repeat(2043);
  const atTheLimit = `${name} == 1`;
  strictEqual(atTheLimit.length, EXPRESSION_LIMITS.maximumExpressionCharacters);
  strictEqual(run(atTheLimit, { [name]: 1 }), true);

  const onePast = `${name}b == 1`;
  strictEqual(onePast.length, EXPRESSION_LIMITS.maximumExpressionCharacters + 1);
  strictEqual(run(onePast, {}), "Expression length 2049 exceeds maximum supported length 2048");

  // And at a configured limit, from both sides: a limit EQUAL to the source length is accepted.
  strictEqual(evaluate(compile("a == 1", { limits: { maximumExpressionCharacters: 6 } }), { a: 1 }, EN), true);
  throws(
    () => compile("a == 1", { limits: { maximumExpressionCharacters: 5 } }),
    (/** @type {Error} */ error) => error.message === "Expression length 6 exceeds maximum supported length 5",
  );
});

test("limits: a configured limit above its hard ceiling is REJECTED, never clamped", () => {
  // `EXPRESSION_LIMIT_CEILINGS` is only a bound if something enforces it. Clamping and ignoring are
  // indistinguishable from the caller's side until an expression that should have been refused is
  // accepted, so Java rejects, and the messages here are Java's `validateCeiling` /
  // `validatePositive` / `validateNonNegative` verbatim.
  throws(
    () => compile("a == 1", { limits: { maximumExpressionCharacters: 4097 } }),
    (/** @type {Error} */ error) =>
      error.name === "RangeError" &&
      error.message === "maximumExpressionCharacters 4097 exceeds the hard ceiling of 4096",
  );
  throws(
    () => compile("a == 1", { limits: { maximumExpressionTokens: 513 } }),
    (/** @type {Error} */ error) =>
      error.message === "maximumExpressionTokens 513 exceeds the hard ceiling of 512",
  );
  throws(
    () => compile("a == 1", { limits: { maximumExpressionNestingDepth: 65 } }),
    (/** @type {Error} */ error) =>
      error.message === "maximumExpressionNestingDepth 65 exceeds the hard ceiling of 64",
  );

  // The ceiling itself is fine, and the limit really is the configured one rather than the default.
  strictEqual(
    evaluate(compile("a == 1", { limits: { maximumExpressionCharacters: 4096 } }), { a: 1 }, EN),
    true,
  );
  strictEqual(
    run(`${"(".repeat(33)}a == 1${")".repeat(33)}`, { a: 1 }),
    "Expression grouping depth exceeds maximum supported depth 32",
  );
  strictEqual(
    evaluate(
      compile(`${"(".repeat(33)}a == 1${")".repeat(33)}`, { limits: { maximumExpressionNestingDepth: 64 } }),
      { a: 1 },
      EN,
    ),
    true,
  );

  // Below the floor, and not a number at all.
  throws(
    () => compile("a == 1", { limits: { maximumExpressionCharacters: 0 } }),
    (/** @type {Error} */ error) => error.message === "maximumExpressionCharacters must be positive, but was 0",
  );
  throws(
    () => compile("a == 1", { limits: { maximumExpressionNestingDepth: -1 } }),
    (/** @type {Error} */ error) =>
      error.message === "maximumExpressionNestingDepth must be non-negative, but was -1",
  );
  throws(
    () => compile("a == 1", { limits: { maximumExpressionTokens: /** @type {any} */ (2.5) } }),
    (/** @type {Error} */ error) =>
      error.name === "TypeError" && error.message === "maximumExpressionTokens must be an integer, but was 2.5",
  );
});

test("limits: grouping depth counts UNCLOSED groups, not total groups", () => {
  const nested = (/** @type {number} */ depth) => `${"(".repeat(depth)}a == 1${")".repeat(depth)}`;

  strictEqual(run(nested(32), { a: 1 }), true);
  strictEqual(run(nested(33), { a: 1 }), "Expression grouping depth exceeds maximum supported depth 32");

  // Sibling groups do not accumulate: forty of them are still depth 1.
  const siblings = Array.from({ length: 40 }, () => "(a == 1)").join("||");
  strictEqual(run(siblings, { a: 1 }), true);
});

test("limits: a caller-supplied limit is honoured, which is what runtime-limit overrides will use", () => {
  throws(
    () => compile("a == 1", { limits: { maximumExpressionCharacters: 5 } }),
    (/** @type {Error} */ error) => error.message === "Expression length 6 exceeds maximum supported length 5",
  );

  throws(
    () => compile("(a == 1)", { limits: { maximumExpressionNestingDepth: 0 } }),
    (/** @type {Error} */ error) => error.message === "Expression grouping depth exceeds maximum supported depth 0",
  );

  throws(
    () => compile("a == 1 && b == 1", { limits: { maximumExpressionTokens: 4 } }),
    (/** @type {Error} */ error) =>
      error.message === "Expression contains 7 tokens, which exceeds maximum supported token count 4",
  );
});

/* --- exact numeric comparison ---------------------------------------------- */

test("numeric comparison is exact at magnitudes binary64 cannot represent", () => {
  // 10^20 is exactly representable as a double; 10^20 + 1 is not, and rounds to 10^20. A float
  // implementation reports these two as equal.
  strictEqual(run("big == 100000000000000000000", { big: 10n ** 20n }), true);
  strictEqual(run("big == 100000000000000000001", { big: 10n ** 20n }), false);
  strictEqual(run("big != 100000000000000000001", { big: 10n ** 20n }), true);
  strictEqual(run("big < 100000000000000000001", { big: 10n ** 20n }), true);

  // 2^53 + 1 versus 2^53, the classic pair.
  strictEqual(run("n == 9007199254740993", { n: 9007199254740993n }), true);
  strictEqual(run("n == 9007199254740992", { n: 9007199254740993n }), false);

  // Exact decimal text, far past any float.
  strictEqual(
    run("n == 12345678901234567890.12345678901234567890", {
      n: decimal("12345678901234567890.12345678901234567890"),
    }),
    true,
  );
});

test("numeric comparison ignores scale, exactly as BigDecimal.compareTo does", () => {
  strictEqual(run("value == 5", { value: decimal("5.00") }), true);
  strictEqual(run("value == 5.0", { value: 5 }), true);
  strictEqual(run("value == 1", { value: decimal("1.0") }), true);
  strictEqual(run("value >= 1 && value <= 1", { value: decimal("1.000") }), true);

  // ... but SCALE still decides a plural category, which is a different question about the same
  // value. `1.0` is `other` in English, not `one`.
  strictEqual(run("value == CARDINALITY_ONE", { value: decimal("1.0") }), false);
  strictEqual(run("value == CARDINALITY_ONE", { value: 1 }), true);
  strictEqual(run("value == CARDINALITY_ONE", { value: operands("1", { visibleDecimalPlaces: 1 }) }), false);
});

test("numeric comparison handles signs and zero", () => {
  strictEqual(run("a < b", { a: -5, b: 1 }), true);
  strictEqual(run("a < b", { a: -5, b: -1 }), true);
  strictEqual(run("a > b", { a: -1, b: -5 }), true);
  strictEqual(run("a == b", { a: decimal("-0.0"), b: 0 }), true);
  strictEqual(run("a == -1.5", { a: decimal("-1.50") }), true);
  strictEqual(run("a == +1.5", { a: decimal("1.5") }), true);
  strictEqual(run("a == 1.5e3", { a: 1500 }), true);
  strictEqual(run("a >= 0 && a <= 0", { a: -0 }), true);
});

test("every ordering operator is exercised", () => {
  strictEqual(run("a < 5", { a: 4 }), true);
  strictEqual(run("a < 5", { a: 5 }), false);
  strictEqual(run("a <= 5", { a: 5 }), true);
  strictEqual(run("a > 5", { a: 6 }), true);
  strictEqual(run("a > 5", { a: 5 }), false);
  strictEqual(run("a >= 5", { a: 5 }), true);
  strictEqual(run("a != 5", { a: 6 }), true);
  strictEqual(run("a != 5", { a: 5 }), false);
});

/* --- operand typing across every axis -------------------------------------- */

/**
 * The ten axes, each with two distinct members and the noun Java uses in its
 * "you may only use == and !=" diagnostic.
 *
 * @type {[string, string, string, string][]}
 */
const AXES = [
  ["gender", "GENDER_FEMININE", "GENDER_MASCULINE", "gender"],
  ["grammatical-case", "CASE_GENITIVE", "CASE_DATIVE", "grammatical case"],
  ["definiteness", "DEFINITENESS_DEFINITE", "DEFINITENESS_INDEFINITE", "definiteness"],
  ["classifier", "CLASSIFIER_PERSON", "CLASSIFIER_ANIMAL", "classifier"],
  ["formality", "FORMALITY_FORMAL", "FORMALITY_CASUAL", "formality"],
  ["clusivity", "CLUSIVITY_INCLUSIVE", "CLUSIVITY_EXCLUSIVE", "clusivity"],
  ["animacy", "ANIMACY_ANIMATE", "ANIMACY_INANIMATE", "animacy"],
  ["cardinality", "CARDINALITY_ONE", "CARDINALITY_OTHER", "cardinality"],
  ["ordinality", "ORDINALITY_TWO", "ORDINALITY_ONE", "ordinality"],
  ["phonetic", "PHONETIC_VOWEL", "PHONETIC_CONSONANT", "phonetic"],
];

test("all ten axes: a tagged value compares against its own constant, and only its own", () => {
  for (const [axis, first, second] of AXES) {
    strictEqual(run(`value == ${first}`, { value: form(axis, first) }), true, `${axis} == self`);
    strictEqual(run(`value == ${first}`, { value: form(axis, second) }), false, `${axis} == sibling`);
    strictEqual(run(`value != ${first}`, { value: form(axis, second) }), true, `${axis} != sibling`);
    strictEqual(run(`left == right`, { left: form(axis, first), right: form(axis, first) }), true, `${axis} pair`);
    strictEqual(run(`left == right`, { left: form(axis, first), right: form(axis, second) }), false, `${axis} pair`);
  }
});

test("all ten axes: ordering operators are refused with the axis's own noun", () => {
  for (const [axis, first, , noun] of AXES)
    strictEqual(
      run(`value < ${first}`, { value: form(axis, first) }),
      `Invalid expression 'value < ${first}': Operator '<' requires numeric operands but ` +
        `encountered UNKNOWN_VARIABLE and ${
          { "grammatical-case": "GRAMMATICAL_CASE" }[axis] ?? axis.toUpperCase()
        } in 'value < ${first}'`,
      `${axis} ordering`,
    );

  // Reached at RUNTIME rather than compile time when the constant side is a bare variable, which is
  // the shape the corpus records: `value < 5` with a cardinality-valued `value`.
  strictEqual(
    run("value < 5", { value: form("cardinality", "CARDINALITY_ONE") }),
    "You may only use the '==' and '!=' operators when performing cardinality comparisons. " +
      "Offending comparison: 'value < 5'",
  );
  strictEqual(
    run("value < 5", { value: form("ordinality", "ORDINALITY_ONE") }),
    "You may only use the '==' and '!=' operators when performing ordinality comparisons. " +
      "Offending comparison: 'value < 5'",
  );
});

test("all ten axes: an operand of the wrong axis fails, and the message says which axis claimed it", () => {
  // The seven nominal axes require BOTH sides to be on the axis, so a mismatch reports incompatible
  // runtime types...
  strictEqual(
    run("left == right", { left: form("gender", "GENDER_FEMININE"), right: form("formality", "FORMALITY_FORMAL") }),
    "Unable to evaluate expression 'left == right'. Operand runtime types Gender and Formality are incompatible",
  );

  // ...while cardinality, ordinality, and phonetic claim the comparison when EITHER side is on the
  // axis, and then fail reading the other side. That asymmetry is Java's and it is observable.
  strictEqual(
    run("left == right", {
      left: form("cardinality", "CARDINALITY_ONE"),
      right: form("gender", "GENDER_FEMININE"),
    }),
    "Unable to extract Cardinality value from 'right'",
  );
  strictEqual(
    run("value == GENDER_FEMININE", { value: form("cardinality", "CARDINALITY_ONE") }),
    "Unable to extract Cardinality value from 'GENDER_FEMININE'",
  );
  strictEqual(
    run("value == ORDINALITY_TWO", { value: form("cardinality", "CARDINALITY_TWO") }),
    "Unable to extract Cardinality value from 'ORDINALITY_TWO'",
  );
  strictEqual(
    run("left == right", {
      left: form("ordinality", "ORDINALITY_ONE"),
      right: form("gender", "GENDER_FEMININE"),
    }),
    "Unable to extract Ordinality value from 'right'",
  );
  strictEqual(
    run("left == right", {
      left: form("phonetic", "PHONETIC_VOWEL"),
      right: form("gender", "GENDER_FEMININE"),
    }),
    "Unable to extract Phonetic value from 'right'",
  );
});

test("a number coerces to a plural category, in the EVALUATION locale", () => {
  strictEqual(run("value == CARDINALITY_ONE", { value: 1 }), true);
  strictEqual(run("value == CARDINALITY_OTHER", { value: 5 }), true);
  strictEqual(run("left == right", { left: 1, right: form("cardinality", "CARDINALITY_ONE") }), true);
  strictEqual(run("value == CARDINALITY_ONE", { value: operands("1") }), true);

  // Polish gives 5 `many` where English gives `other`; the locale argument is what decides.
  strictEqual(run("value == CARDINALITY_MANY", { value: 5 }, "pl"), true);
  strictEqual(run("value == CARDINALITY_MANY", { value: 5 }, EN), false);
});

/* --- the nominal / text distinction ---------------------------------------- */

test("a raw string is ALWAYS text, even when it spells a language form exactly", () => {
  // This is the gate's own wording. `"GENDER_FEMININE"` supplied by a caller is a phonetic term,
  // so the comparison lands on the phonetic axis and demands a resolver — it does NOT quietly
  // become the gender constant and compare equal.
  match(
    String(run("value == GENDER_FEMININE", { value: "GENDER_FEMININE" })),
    /^No phoneticResolver was configured\./,
  );

  // On an axis that CLAIMS the comparison, the same string simply fails to be read as that axis.
  strictEqual(
    run("value == CARDINALITY_ONE", { value: "CARDINALITY_ONE" }),
    "Unable to extract Cardinality value from 'value'",
  );
  strictEqual(
    run("value == ORDINALITY_ONE", { value: "ORDINALITY_ONE" }),
    "Unable to extract Ordinality value from 'value'",
  );

  // And a string that spells a number is not a number.
  strictEqual(
    run("value == 5", { value: "5" }),
    "Numeric comparison 'value == 5' requires numeric operands supplied as Number or " +
      "PluralOperands values, but placeholder 'value' resolved to String",
  );
  strictEqual(
    run("value < 5", { value: "3" }),
    "Numeric comparison 'value < 5' requires numeric operands supplied as Number or " +
      "PluralOperands values, but placeholder 'value' resolved to String",
  );
  strictEqual(
    run("left == right", { left: "1", right: 1 }),
    "Numeric comparison 'left == right' requires numeric operands supplied as Number or " +
      "PluralOperands values, but placeholder 'left' resolved to String",
  );
});

test("a raw string that spells a PHONETIC_* constant is a resolver TERM, not the constant", () => {
  // The phonetic axis is the one axis that legitimately accepts a raw string, which makes it the
  // one place a "helpful" shortcut could sniff a constant name and skip the resolver entirely. It
  // must not: `"PHONETIC_VOWEL"` from a caller is a term like any other, and it is the RESOLVER's
  // answer that decides the comparison.
  //
  // Verified by consequence, not by inspection: this resolver deliberately answers CONSONANT for
  // every term, so a sniffing implementation would compare equal here and this test would fail.
  /** @type {string[]} */
  const seen = [];
  const alwaysConsonant = {
    phoneticResolver: (/** @type {string} */ term) => {
      seen.push(term);
      return form("phonetic", "PHONETIC_CONSONANT");
    },
  };

  strictEqual(
    evaluate(compile("value == PHONETIC_VOWEL"), { value: "PHONETIC_VOWEL" }, EN, alwaysConsonant),
    false,
  );
  strictEqual(
    evaluate(compile("value == PHONETIC_CONSONANT"), { value: "PHONETIC_VOWEL" }, EN, alwaysConsonant),
    true,
  );
  deepStrictEqual(seen, ["PHONETIC_VOWEL", "PHONETIC_VOWEL"]);

  // A TAGGED phonetic value is the opposite case: it is already a language form, so the resolver is
  // never consulted for it.
  seen.length = 0;
  strictEqual(
    evaluate(
      compile("value == PHONETIC_VOWEL"),
      { value: form("phonetic", "PHONETIC_VOWEL") },
      EN,
      alwaysConsonant,
    ),
    true,
  );
  deepStrictEqual(seen, []);
});

test("two raw strings are never comparable, on any operator", () => {
  const equality =
    "expressions do not support textual equality. Compare phonetic input with a PHONETIC_* " +
    "constant or an explicit Phonetic value instead";
  const ordering =
    "expressions do not support textual ordering. Use numeric operands for ordering, or compare " +
    "phonetic input with a PHONETIC_* constant or an explicit Phonetic value using '==' or '!='";

  // Identical strings too: this is a refusal, not a comparison that happens to be false.
  strictEqual(
    run("left == right", { left: "abc", right: "abc" }),
    `Raw CharSequence placeholders 'left' and 'right' cannot be compared with '==': ${equality}`,
  );
  strictEqual(
    run("left != right", { left: "abc", right: "abc" }),
    `Raw CharSequence placeholders 'left' and 'right' cannot be compared with '!=': ${equality}`,
  );
  strictEqual(
    run("left != right", { left: "abc", right: "xyz" }),
    `Raw CharSequence placeholders 'left' and 'right' cannot be compared with '!=': ${equality}`,
  );
  strictEqual(
    run("left < right", { left: "abc", right: "abd" }),
    `Raw CharSequence placeholders 'left' and 'right' cannot be compared with '<': ${ordering}`,
  );
});

test("a tagged phonetic value compares without a resolver; a raw string needs one", () => {
  strictEqual(run("value == PHONETIC_VOWEL", { value: form("phonetic", "PHONETIC_VOWEL") }), true);
  strictEqual(run("value == PHONETIC_VOWEL", { value: form("phonetic", "PHONETIC_CONSONANT") }), false);

  match(String(run("value == PHONETIC_VOWEL", { value: "apple" })), /^No phoneticResolver was configured\./);

  // With a resolver, the term is resolved and then compared as a category.
  const phoneticResolver = (/** @type {string} */ term) =>
    form("phonetic", /^[aeiou]/i.test(term) ? "PHONETIC_VOWEL" : "PHONETIC_CONSONANT");

  strictEqual(
    evaluate(compile("value == PHONETIC_VOWEL"), { value: "apple" }, EN, { phoneticResolver }),
    true,
  );
  strictEqual(
    evaluate(compile("value == PHONETIC_VOWEL"), { value: "pear" }, EN, { phoneticResolver }),
    false,
  );

  // A resolver that returns something other than a tagged phonetic value is an error, not a guess.
  throws(
    () => evaluate(compile("value == PHONETIC_VOWEL"), { value: "apple" }, EN, {
      phoneticResolver: () => "PHONETIC_VOWEL",
    }),
    ExpressionEvaluationError,
  );
});

/* --- bindings -------------------------------------------------------------- */

test("an absent binding, an explicit null, and a wrong-name binding are all distinct", () => {
  strictEqual(run("value == 5", undefined), "No value was provided for placeholder 'value'");
  strictEqual(run("value == 5", {}), "No value was provided for placeholder 'value'");
  strictEqual(run("value == 5", { other: 5 }), "No value was provided for placeholder 'value'");
  strictEqual(run("value == 5", { value: null }), "Placeholder 'value' resolved to null");
  strictEqual(run("value == 5", { value: undefined }), "Placeholder 'value' resolved to null");
});

test("a value of no recognized kind is UNKNOWN rather than silently false", () => {
  strictEqual(
    run("value == 5", { value: true }),
    "Unable to evaluate expression 'value == 5'. Operand types UNKNOWN and NUMBER are unsupported",
  );
  strictEqual(
    run("value == 5", { value: new Date(0) }),
    "Unable to evaluate expression 'value == 5'. Operand types UNKNOWN and NUMBER are unsupported",
  );
});

test("values may be supplied as a Map as well as a plain object", () => {
  strictEqual(run("value == 5", new Map([["value", 5]])), true);
  strictEqual(run("value == 5", new Map()), "No value was provided for placeholder 'value'");
  strictEqual(run("value == 5", new Map([["value", null]])), "Placeholder 'value' resolved to null");
});

test("bindings are read as own properties, so a prototype member is not a binding", () => {
  // `toString` exists on every object literal's prototype. Reading it as a binding would turn a
  // typo into a silently-typed operand.
  strictEqual(run("toString == 5", {}), "No value was provided for placeholder 'toString'");
});

/* --- the optional ordinal seam --------------------------------------------- */

test("classifying a number as an ordinal category needs the optional module", () => {
  // The ordinal rule table is deliberately outside the root graph, so the root cannot answer this
  // question on its own. Comparing two TAGGED ordinal values never needs it.
  strictEqual(run("value == ORDINALITY_TWO", { value: form("ordinality", "ORDINALITY_TWO") }), true);

  match(
    String(run("value == ORDINALITY_TWO", { value: 2 })),
    /^Unable to extract Ordinality value from 'value': classifying a number as an ordinal category/,
  );

  // Once the caller hands the classifier over, the same expression answers. The resolver arrives
  // PER EVALUATION; there is deliberately no module-level registration that could install it.
  const withResolver = { ordinalCategoryResolver: () => "two" };
  strictEqual(evaluate(compile("value == ORDINALITY_TWO"), { value: 2 }, EN, withResolver), true);
  strictEqual(evaluate(compile("value == ORDINALITY_ONE"), { value: 2 }, EN, withResolver), false);

  // ...and it does not leak to the NEXT evaluation. That is the cross-instance property: one
  // `Strings` built with `pluralData.ordinal` must not make a second one, built without it, able to
  // classify a number. A module-level registration seam would fail exactly here.
  match(
    String(run("value == ORDINALITY_TWO", { value: 2 })),
    /^Unable to extract Ordinality value from 'value': classifying a number as an ordinal category/,
  );
});

/* --- diagnostics ----------------------------------------------------------- */

test("every failure is an ExpressionEvaluationError carrying the mapped code", () => {
  try {
    evaluateExpression("value == 5", {}, EN);
    ok(false, "expected a throw");
  } catch (error) {
    ok(error instanceof ExpressionEvaluationError);
    strictEqual(error.name, "ExpressionEvaluationError");
    strictEqual(/** @type {{ code: string }} */ (/** @type {unknown} */ (error)).code, "EXPRESSION_EVALUATION");
  }
});

test("a compile-time failure keeps the underlying error as its cause", () => {
  try {
    compile("count ==");
    ok(false, "expected a throw");
  } catch (error) {
    ok(error instanceof ExpressionEvaluationError);
    ok(error.cause instanceof ExpressionEvaluationError, "the wrapped error must be the cause");
    strictEqual(
      /** @type {Error} */ (error.cause).message,
      "Insufficient arguments provided for operator '=='",
    );
  }
});
