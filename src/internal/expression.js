// @ts-check

/**
 * Internal: the alternative-expression language — eager compiler and evaluator.
 *
 * Port of `ExpressionEvaluator` from lokalized-java 3.0.0, plus the three expression-shaped
 * limits of `TranslationRuntimeLimits`. Lexing lives next door in `./expression-tokenizer.js`,
 * the same split Java draws between `ExpressionTokenizer` and `ExpressionEvaluator`.
 *
 * Three properties of this module are contractual rather than incidental:
 *
 *   1. **No dynamic code evaluation.** No `eval`, no `new Function`, no `import()` of generated
 *      source. An expression compiles to a frozen tree of plain records and is walked by
 *      {@link evaluate}. `test/expression.test.js` asserts the absence of both constructs across
 *      the whole expression implementation.
 *   2. **Eager compilation.** {@link compile} runs once, when the catalog is parsed, and does every
 *      piece of work that does not depend on caller values: lexing, the shunting-yard
 *      conversion, static operand typing, numeric-literal validation, and all three limits. A
 *      later {@link evaluate} does no parsing. This is observable and not merely a speed choice:
 *      Java's `DefaultStrings` constructor compiles every loaded expression, so a malformed or
 *      over-limit expression fails construction of the whole catalog rather than the one lookup
 *      that happens to reach it.
 *   3. **Tagged values preserve the nominal/text distinction.** A raw string is ALWAYS text. It is
 *      never sniffed into a language form, even when it spells one exactly: `"GENDER_FEMININE"`
 *      supplied by a caller is a phonetic term, not a gender, and comparing it against the
 *      `GENDER_FEMININE` constant reaches the phonetic branch (and its resolver requirement)
 *      rather than comparing equal. Recognition of a tagged value is structural — `$lokalized` plus
 *      `axis`/`name` — so values survive JSON, workers, `structuredClone`, and RSC boundaries.
 *
 * The grammar, from `ExpressionEvaluator`'s class javadoc:
 *
 *     EXPRESSION          = OR_EXPRESSION ;
 *     OR_EXPRESSION       = AND_EXPRESSION { "||" AND_EXPRESSION } ;
 *     AND_EXPRESSION      = PRIMARY_EXPRESSION { "&&" PRIMARY_EXPRESSION } ;
 *     PRIMARY_EXPRESSION  = COMPARISON | "(" EXPRESSION ")" ;
 *     COMPARISON          = OPERAND COMPARISON_OPERATOR OPERAND ;
 *     OPERAND             = VARIABLE | LANGUAGE_FORM | NUMBER ;
 *
 * Comparison binds tighter than `&&`, which binds tighter than `||`; parentheses override.
 *
 * Numeric comparison is EXACT and goes through `./plural.js`'s decimal path — the same operands
 * engine the classifiers use — never through binary64. `10n ** 20n` and `1.0` versus `1` are the
 * cases that break a float implementation and the corpus contains both.
 */

import { LANGUAGE_FORM_NAMES } from "./catalog.js";
import {
  ExpressionEvaluationError,
  TokenType,
  extractTokens,
  isLanguageFormTokenType,
} from "./expression-tokenizer.js";
import {
  cardinalCategoryFor,
  operandsForPluralValue,
  operandsFromDecimalText,
  operandsFromNumber,
} from "./plural.js";

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `ExpressionEvaluationException`, re-exported from the tokenizer so lexical and evaluation
 * failures are ONE class. Two copies would each satisfy their own `instanceof` and neither the
 * other's, which is exactly the bug a caller writing `catch (e) { if (e instanceof
 * ExpressionEvaluationError) ... }` would never think to look for.
 */
export { ExpressionEvaluationError };

/**
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {ExpressionEvaluationError}
 */
function fail(message, cause) {
  return cause === undefined
    ? new ExpressionEvaluationError(message)
    : new ExpressionEvaluationError(message, { cause });
}

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/* -------------------------------------------------------------------------- */
/* Fixed runtime limits                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The three expression-shaped limits of `TranslationRuntimeLimits`, at their library defaults.
 *
 * Enforced exactly where Java enforces them, because the ORDER is observable in which error a
 * caller gets:
 *
 *   - characters, BEFORE tokenization (`validateExpressionSourceLength`);
 *   - tokens and nesting depth, AFTER tokenization (`validateInfixTokens`, called at the top of the
 *     shunting-yard conversion).
 *
 * An expression of 5,000 characters therefore reports a length breach and never a token-count one,
 * while `(((...)))` past the depth limit reports depth even though it is well under 2,048
 * characters.
 */
export const EXPRESSION_LIMITS = Object.freeze({
  /** `DEFAULT_MAXIMUM_EXPRESSION_CHARACTERS`. */
  maximumExpressionCharacters: 2048,
  /** `DEFAULT_MAXIMUM_EXPRESSION_TOKENS`. */
  maximumExpressionTokens: 256,
  /** `DEFAULT_MAXIMUM_EXPRESSION_NESTING_DEPTH`. */
  maximumExpressionNestingDepth: 32,
});

/**
 * The hard ceilings a future configured limit may not exceed: `MAXIMUM_EXPRESSION_CHARACTERS`,
 * `MAXIMUM_EXPRESSION_TOKENS`, `MAXIMUM_EXPRESSION_NESTING_DEPTH`.
 *
 * Java's loaders validate expressions against these ceilings because an application's runtime
 * policy is not yet available; `Strings` construction then enforces its configured limits.
 */
export const EXPRESSION_LIMIT_CEILINGS = Object.freeze({
  maximumExpressionCharacters: 4096,
  maximumExpressionTokens: 512,
  maximumExpressionNestingDepth: 64,
});

/**
 * `DEFAULT_MAXIMUM_INTERPOLATED_OUTPUT_CHARACTERS`, which also bounds one phonetic input.
 */
const DEFAULT_MAXIMUM_PHONETIC_INPUT_CHARACTERS = 256 * 1024;

/**
 * @typedef {object} ExpressionLimits
 * @property {number} [maximumExpressionCharacters]
 * @property {number} [maximumExpressionTokens]
 * @property {number} [maximumExpressionNestingDepth]
 */

/**
 * `TranslationRuntimeLimits.Builder.validatePositive` / `validateNonNegative` / `validateCeiling`.
 *
 * A configured limit above its hard ceiling is REJECTED, never clamped and never ignored. Clamping
 * would let an application believe it had raised a bound the library then quietly overrode, and
 * ignoring the ceiling entirely — which is what this function did before — makes the exported
 * `EXPRESSION_LIMIT_CEILINGS` a decoration rather than a bound. The messages are Java's, verbatim.
 *
 * @param {string} name
 * @param {unknown} value
 * @param {number} ceiling
 * @param {0 | 1} floor 1 for a positive limit, 0 for a non-negative one
 * @returns {number}
 */
function validateLimit(name, value, ceiling, floor) {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new TypeError(`${name} must be an integer, but was ${String(value)}`);

  if (value < floor)
    throw new RangeError(
      `${name} must be ${floor === 0 ? "non-negative" : "positive"}, but was ${value}`,
    );

  if (value > ceiling) throw new RangeError(`${name} ${value} exceeds the hard ceiling of ${ceiling}`);

  return value;
}

/**
 * @param {ExpressionLimits | undefined} limits
 * @returns {{ maximumExpressionCharacters: number, maximumExpressionTokens: number, maximumExpressionNestingDepth: number }}
 */
function effectiveLimits(limits) {
  if (limits === undefined) return EXPRESSION_LIMITS;

  const characters = limits.maximumExpressionCharacters;
  const tokens = limits.maximumExpressionTokens;
  const depth = limits.maximumExpressionNestingDepth;

  return {
    maximumExpressionCharacters:
      characters === undefined
        ? EXPRESSION_LIMITS.maximumExpressionCharacters
        : validateLimit(
            "maximumExpressionCharacters",
            characters,
            EXPRESSION_LIMIT_CEILINGS.maximumExpressionCharacters,
            1,
          ),
    maximumExpressionTokens:
      tokens === undefined
        ? EXPRESSION_LIMITS.maximumExpressionTokens
        : validateLimit(
            "maximumExpressionTokens",
            tokens,
            EXPRESSION_LIMIT_CEILINGS.maximumExpressionTokens,
            1,
          ),
    maximumExpressionNestingDepth:
      depth === undefined
        ? EXPRESSION_LIMITS.maximumExpressionNestingDepth
        : validateLimit(
            "maximumExpressionNestingDepth",
            depth,
            EXPRESSION_LIMIT_CEILINGS.maximumExpressionNestingDepth,
            0,
          ),
  };
}

/* -------------------------------------------------------------------------- */
/* Terms                                                                      */
/* -------------------------------------------------------------------------- */

/** @typedef {import("./catalog.js").LanguageFormAxis} LanguageFormAxis */
/** @typedef {import("./expression-tokenizer.js").Token} Token */
/** @typedef {import("./expression-tokenizer.js").TokenTypeName} TokenTypeName */

/**
 * A compiler's-eye view of one token: the lexer's token plus the two facts the evaluator would
 * otherwise re-derive on every evaluation.
 *
 * `axis` is non-null exactly for the 61 language-form constants; `numeric` is non-null exactly for
 * `NUMBER` literals. Both are resolved ONCE, during {@link compile} — which is what makes
 * evaluation free of parsing. They live here rather than on `Token` because a token is the lexer's
 * frozen output and belongs to it.
 *
 * @typedef {object} Term
 * @property {TokenTypeName} type
 * @property {string} symbol
 * @property {LanguageFormAxis | null} axis
 * @property {ExactDecimal | null} numeric
 */

/**
 * An exact decimal as a sign plus a plain (never scientific) absolute decimal string, which is what
 * `./plural.js` hands back as the `n` operand. Comparison is digit-wise, so nothing rounds.
 *
 * @typedef {object} ExactDecimal
 * @property {string} abs
 * @property {boolean} negative
 */

/**
 * The axis of each language-form constant, read LAZILY.
 *
 * The lexer knows the 61 constants; only the CATALOG knows which axis each belongs to, and axis is
 * what decides how two operands compare. Lazy because the modules that own those two halves import
 * each other: reading `LANGUAGE_FORM_NAMES` at this module's top level would hit the temporal dead
 * zone whenever the catalog module happens to be evaluated first. A read on the first `compile()`
 * call cannot, because compilation happens long after both modules have finished initializing.
 *
 * @type {Map<string, LanguageFormAxis> | null}
 */
let axisByLanguageFormName = null;

/**
 * @param {TokenTypeName} tokenType
 * @returns {LanguageFormAxis | null}
 */
function axisForTokenType(tokenType) {
  if (!isLanguageFormTokenType(tokenType)) return null;

  if (axisByLanguageFormName === null) {
    /** @type {Map<string, LanguageFormAxis>} */
    const axes = new Map();
    for (const [axis, prefix, members] of LANGUAGE_FORM_NAMES)
      for (const member of members) axes.set(`${prefix}${member}`, axis);
    axisByLanguageFormName = axes;
  }

  const axis = axisByLanguageFormName.get(tokenType);

  // Unreachable unless the lexer's 61 constants and the catalog's 61 forms drift apart, which is
  // precisely the drift worth failing loudly on rather than treating as an ordinary variable.
  if (axis === undefined) throw fail(`Unexpected language-form token '${tokenType}'`);

  return axis;
}

/**
 * @param {readonly Token[]} tokens
 * @returns {Term[]}
 */
const termsFrom = (tokens) =>
  tokens.map((token) => ({
    type: token.tokenType,
    symbol: token.symbol,
    axis: axisForTokenType(token.tokenType),
    /** @type {ExactDecimal | null} */
    numeric: null,
  }));

/** The comparison operators, by token type. @type {ReadonlySet<string>} */
const COMPARISON_OPERATORS = new Set([
  TokenType.LESS_THAN,
  TokenType.LESS_THAN_OR_EQUAL_TO,
  TokenType.GREATER_THAN,
  TokenType.GREATER_THAN_OR_EQUAL_TO,
  TokenType.EQUAL_TO,
  TokenType.NOT_EQUAL_TO,
]);

/** The operators that ORDER rather than merely compare; numeric operands only. @type {ReadonlySet<string>} */
const ORDERING_OPERATORS = new Set([
  TokenType.LESS_THAN,
  TokenType.LESS_THAN_OR_EQUAL_TO,
  TokenType.GREATER_THAN,
  TokenType.GREATER_THAN_OR_EQUAL_TO,
]);

/** @type {ReadonlySet<string>} */
const BOOLEAN_OPERATORS = new Set([TokenType.AND, TokenType.OR]);

/** @param {Term} term */
const isOperator = (term) => COMPARISON_OPERATORS.has(term.type) || BOOLEAN_OPERATORS.has(term.type);

/** @param {Term} term */
const isOperand = (term) =>
  term.type === TokenType.VARIABLE || term.type === TokenType.NUMBER || term.axis !== null;

/**
 * `ExpressionEvaluator.precedence`.
 *
 * @param {Term} term
 * @returns {number}
 */
function precedence(term) {
  if (COMPARISON_OPERATORS.has(term.type)) return 2;
  if (term.type === TokenType.AND) return 1;
  if (term.type === TokenType.OR) return 0;

  throw fail(`Cannot determine precedence for '${term.symbol}'`);
}

/* -------------------------------------------------------------------------- */
/* Exact decimals                                                             */
/* -------------------------------------------------------------------------- */

/** @param {string} digits */
const allZeroes = (digits) => !/[1-9]/.test(digits);

/**
 * The exact value of decimal text, as sign plus plain absolute digits.
 *
 * Routed through `operandsFromDecimalText` rather than a private parser so there is exactly ONE
 * decimal path in the library: the same function that decides a plural category decides what a
 * comparison sees, and the same precision and scale limits apply to both. `n` is the absolute
 * value in plain notation, which is precisely what an exact comparison needs.
 *
 * @param {string} text
 * @returns {ExactDecimal}
 */
function exactDecimalFromText(text) {
  return { abs: operandsFromDecimalText(text, {}).n, negative: text.startsWith("-") };
}

/**
 * `validateNumericLiteralTokens`, which runs as its own pass AFTER the whole expression has been
 * tokenized — so a stray code point anywhere in the source is reported before an out-of-range
 * literal earlier in it. The exact value is retained on the token, which is what makes evaluation
 * free of any parsing.
 *
 * @param {Term[]} tokens
 */
function validateNumericLiteralTokens(tokens) {
  for (const token of tokens) {
    if (token.type !== "NUMBER") continue;

    try {
      token.numeric = exactDecimalFromText(token.symbol);
    } catch (cause) {
      throw fail(`Invalid numeric literal '${token.symbol}': ${messageOf(cause)}`, cause);
    }
  }
}

/**
 * Compares two exact decimals. Digit-wise and total; nothing is converted to a JavaScript number.
 *
 * @param {ExactDecimal} left
 * @param {ExactDecimal} right
 * @returns {number} negative, zero, or positive, like `BigDecimal.compareTo`
 */
function compareExact(left, right) {
  const leftZero = allZeroes(left.abs);
  const rightZero = allZeroes(right.abs);

  // `BigDecimal` has no negative zero: `-0.0` and `0` compare equal.
  if (leftZero && rightZero) return 0;

  const leftNegative = left.negative && !leftZero;
  const rightNegative = right.negative && !rightZero;

  if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;

  const magnitude = compareAbsolute(left.abs, right.abs);
  return leftNegative ? -magnitude : magnitude;
}

/**
 * @param {string} left plain, non-negative decimal text
 * @param {string} right plain, non-negative decimal text
 * @returns {number}
 */
function compareAbsolute(left, right) {
  const [leftInteger = "", leftFraction = ""] = left.split(".");
  const [rightInteger = "", rightFraction = ""] = right.split(".");

  const leftWhole = leftInteger.replace(/^0+(?=\d)/, "");
  const rightWhole = rightInteger.replace(/^0+(?=\d)/, "");

  if (leftWhole.length !== rightWhole.length) return leftWhole.length < rightWhole.length ? -1 : 1;
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;

  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftPadded = leftFraction.padEnd(width, "0");
  const rightPadded = rightFraction.padEnd(width, "0");

  if (leftPadded === rightPadded) return 0;
  return leftPadded < rightPadded ? -1 : 1;
}

/* -------------------------------------------------------------------------- */
/* Static (compile-time) operand typing                                       */
/* -------------------------------------------------------------------------- */

/**
 * `ExpressionValueType`. `UNKNOWN_VARIABLE` is a variable whose runtime type is not yet knowable;
 * `BOOLEAN` is the result of an already-validated comparison.
 *
 * @typedef {"NUMBER" | "BOOLEAN" | "GENDER" | "GRAMMATICAL_CASE" | "DEFINITENESS" | "CLASSIFIER"
 *   | "FORMALITY" | "CLUSIVITY" | "ANIMACY" | "CARDINALITY" | "ORDINALITY" | "PHONETIC"
 *   | "UNKNOWN_VARIABLE"} ExpressionValueType
 */

/**
 * `OperandType`, the runtime counterpart of `ExpressionValueType`.
 *
 * @typedef {"NUMBER" | "BOOLEAN" | "GENDER" | "GRAMMATICAL_CASE" | "DEFINITENESS" | "CLASSIFIER"
 *   | "FORMALITY" | "CLUSIVITY" | "ANIMACY" | "CARDINALITY" | "ORDINALITY" | "PHONETIC"
 *   | "UNKNOWN"} OperandType
 */

/**
 * Axis -> operand type. Every one of the ten axes appears; `grammatical-case` is the only one whose
 * spelling is not a straight upper-casing.
 *
 * @type {Record<LanguageFormAxis, OperandType>}
 */
const OPERAND_TYPE_BY_AXIS = {
  cardinality: "CARDINALITY",
  ordinality: "ORDINALITY",
  gender: "GENDER",
  "grammatical-case": "GRAMMATICAL_CASE",
  definiteness: "DEFINITENESS",
  classifier: "CLASSIFIER",
  formality: "FORMALITY",
  clusivity: "CLUSIVITY",
  animacy: "ANIMACY",
  phonetic: "PHONETIC",
};

/**
 * Axis -> the Java type name the diagnostics use. Kept verbatim because the corpus records these
 * messages; they are the same words a Java user would see for the same mistake.
 *
 * @type {Record<LanguageFormAxis, string>}
 */
const JAVA_TYPE_NAME_BY_AXIS = {
  cardinality: "Cardinality",
  ordinality: "Ordinality",
  gender: "Gender",
  "grammatical-case": "GrammaticalCase",
  definiteness: "Definiteness",
  classifier: "Classifier",
  formality: "Formality",
  clusivity: "Clusivity",
  animacy: "Animacy",
  phonetic: "Phonetic",
};

/** @type {Partial<Record<OperandType, string>>} */
const JAVA_TYPE_NAME_BY_OPERAND_TYPE = {
  NUMBER: "Number",
  BOOLEAN: "Boolean",
  GENDER: "Gender",
  GRAMMATICAL_CASE: "GrammaticalCase",
  DEFINITENESS: "Definiteness",
  CLASSIFIER: "Classifier",
  FORMALITY: "Formality",
  CLUSIVITY: "Clusivity",
  ANIMACY: "Animacy",
  CARDINALITY: "Cardinality",
  ORDINALITY: "Ordinality",
  PHONETIC: "Phonetic",
};

/**
 * `ExpressionEvaluator.expressionValueTypeForToken`.
 *
 * @param {Term} token
 * @returns {ExpressionValueType}
 */
function expressionValueTypeForToken(token) {
  if (token.type === TokenType.NUMBER) return "NUMBER";
  if (token.axis !== null) return /** @type {ExpressionValueType} */ (OPERAND_TYPE_BY_AXIS[token.axis]);
  if (token.type === TokenType.VARIABLE) return "UNKNOWN_VARIABLE";

  throw fail(`Unexpected operand symbol encountered: '${token.symbol}'`);
}

/**
 * `canBeNumericExpressionValue`. An unbound variable may still turn out to be a number, so ordering
 * is a compile-time error only when the operand is statically known NOT to be one.
 *
 * @param {ExpressionValueType} type
 */
const canBeNumeric = (type) => type === "NUMBER" || type === "UNKNOWN_VARIABLE";

/**
 * `canBeEqualExpressionValue`. Number-versus-cardinality and number-versus-ordinality are the two
 * cross-type equalities the language allows, because a number classifies into a plural category.
 *
 * @param {ExpressionValueType} left
 * @param {ExpressionValueType} right
 */
function canBeEqual(left, right) {
  if (left === "UNKNOWN_VARIABLE" || right === "UNKNOWN_VARIABLE") return true;
  if (left === right) return true;

  return (
    (left === "NUMBER" && (right === "CARDINALITY" || right === "ORDINALITY")) ||
    (right === "NUMBER" && (left === "CARDINALITY" || left === "ORDINALITY"))
  );
}

/* -------------------------------------------------------------------------- */
/* Compilation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A node of the compiled tree. Leaves carry an operand token and no children; interior nodes carry
 * an operator and exactly two children.
 *
 * @typedef {object} ExpressionNode
 * @property {Term} token
 * @property {ExpressionNode | null} left
 * @property {ExpressionNode | null} right
 */

/**
 * A compiled expression: the immutable product of {@link compile}, evaluable any number of times
 * against different caller values.
 *
 * @typedef {object} CompiledExpression
 * @property {string} expression the source, retained for diagnostics
 * @property {ExpressionNode} root
 */

/**
 * `validateExpressionSourceLength` — checked BEFORE tokenization, which is why an over-long
 * expression never reports a token-count breach.
 *
 * @param {string} expression
 * @param {number} maximum
 */
function validateExpressionSourceLength(expression, maximum) {
  if (expression.length > maximum)
    throw fail(`Expression length ${expression.length} exceeds maximum supported length ${maximum}`);
}

/**
 * `validateInfixTokens` — token count, then grouping depth, both AFTER tokenization.
 *
 * Depth is the RUNNING count of unclosed groups, not the total number of groups: it increments on
 * every `(` and decrements on every `)` that closes one, so `(a==1) && (b==1)` is depth 1 while
 * `((a==1))` is depth 2.
 *
 * @param {Term[]} tokens
 * @param {{ maximumExpressionTokens: number, maximumExpressionNestingDepth: number }} limits
 */
function validateInfixTokens(tokens, limits) {
  if (tokens.length > limits.maximumExpressionTokens)
    throw fail(
      `Expression contains ${tokens.length} tokens, which exceeds maximum supported token count ` +
        `${limits.maximumExpressionTokens}`,
    );

  let groupDepth = 0;

  for (const token of tokens) {
    if (token.type === TokenType.GROUP_START) {
      ++groupDepth;

      if (groupDepth > limits.maximumExpressionNestingDepth)
        throw fail(
          "Expression grouping depth exceeds maximum supported depth " +
            `${limits.maximumExpressionNestingDepth}`,
        );
    } else if (token.type === TokenType.GROUP_END && groupDepth > 0) {
      --groupDepth;
    }
  }
}

/**
 * Dijkstra's shunting-yard, as `convertTokensToReversePolishNotation`.
 *
 * @param {Term[]} tokens
 * @param {{ maximumExpressionTokens: number, maximumExpressionNestingDepth: number }} limits
 * @returns {Term[]}
 */
function convertToReversePolishNotation(tokens, limits) {
  validateInfixTokens(tokens, limits);

  /** @type {Term[]} */
  const output = [];
  /** @type {Term[]} */
  const operators = [];

  for (const token of tokens) {
    if (isOperand(token)) {
      output.push(token);
    } else if (isOperator(token)) {
      // Every operator here is left-associative, so an equal precedence pops too.
      while (operators.length > 0) {
        const top = /** @type {Term} */ (operators[operators.length - 1]);
        if (!isOperator(top) || precedence(token) > precedence(top)) break;
        output.push(/** @type {Term} */ (operators.pop()));
      }

      operators.push(token);
    } else if (token.type === TokenType.GROUP_START) {
      operators.push(token);
    } else if (token.type === TokenType.GROUP_END) {
      while (operators.length > 0 && /** @type {Term} */ (operators[operators.length - 1]).type !== TokenType.GROUP_START)
        output.push(/** @type {Term} */ (operators.pop()));

      if (operators.length === 0) throw fail("Unbalanced ) detected");

      operators.pop();
    }
  }

  while (operators.length > 0) {
    const top = /** @type {Term} */ (operators[operators.length - 1]);

    if (top.type === TokenType.GROUP_START || top.type === TokenType.GROUP_END)
      throw fail(`Unbalanced ${top.symbol} detected`);

    output.push(/** @type {Term} */ (operators.pop()));
  }

  return output;
}

/**
 * `validateOperatorOperands`. This is where a chained comparison is rejected: once a comparison has
 * produced a BOOLEAN, feeding it back into another comparison is `a < b < c`, and the message names
 * both operands — the synthetic `previous comparison` on one side and the real symbol on the other.
 *
 * @param {{ type: ExpressionValueType, symbol: string }} left
 * @param {Term} operator
 * @param {{ type: ExpressionValueType, symbol: string }} right
 */
function validateOperatorOperands(left, operator, right) {
  const context = `'${left.symbol} ${operator.symbol} ${right.symbol}'`;

  if (BOOLEAN_OPERATORS.has(operator.type)) {
    if (left.type === "BOOLEAN" && right.type === "BOOLEAN") return;

    throw fail(
      `Operator '${operator.symbol}' requires boolean operands but encountered ${left.type} and ` +
        `${right.type} in ${context}`,
    );
  }

  if (COMPARISON_OPERATORS.has(operator.type)) {
    if (left.type === "BOOLEAN" || right.type === "BOOLEAN")
      throw fail(
        `Chained comparisons are not supported. Operator '${operator.symbol}' cannot compare ` +
          `${left.type} and ${right.type} in ${context}`,
      );

    if (ORDERING_OPERATORS.has(operator.type)) {
      if (canBeNumeric(left.type) && canBeNumeric(right.type)) return;

      throw fail(
        `Operator '${operator.symbol}' requires numeric operands but encountered ${left.type} and ` +
          `${right.type} in ${context}`,
      );
    }

    if (canBeEqual(left.type, right.type)) return;

    throw fail(
      `Operator '${operator.symbol}' cannot compare ${left.type} and ${right.type} operands in ${context}`,
    );
  }

  throw fail(`Expected operator but encountered '${operator.symbol}'`);
}

/**
 * `validateReversePolishNotationTokens` — the static shape and type check, run over the RPN stream.
 *
 * @param {Term[]} tokens
 */
function validateReversePolishNotationTokens(tokens) {
  if (tokens.length === 0) throw fail("Expression must not be empty");

  /** @type {{ type: ExpressionValueType, symbol: string }[]} */
  const values = [];

  for (const token of tokens) {
    if (isOperand(token)) {
      values.push({ type: expressionValueTypeForToken(token), symbol: token.symbol });
    } else if (isOperator(token)) {
      if (values.length < 2) throw fail(`Insufficient arguments provided for operator '${token.symbol}'`);

      const right = /** @type {{ type: ExpressionValueType, symbol: string }} */ (values.pop());
      const left = /** @type {{ type: ExpressionValueType, symbol: string }} */ (values.pop());
      validateOperatorOperands(left, token, right);
      values.push({ type: "BOOLEAN", symbol: "previous comparison" });
    } else {
      throw fail(`Unexpected symbol encountered: '${token.symbol}'`);
    }
  }

  // Java streams an `ArrayDeque` head-first, which is top-of-stack first.
  if (values.length !== 1)
    throw fail(
      `Unexpected extra values exist on the stack: [${[...values].reverse().map((value) => value.symbol).join(", ")}]`,
    );

  const result = /** @type {{ type: ExpressionValueType, symbol: string }} */ (values[0]);

  if (result.type !== "BOOLEAN")
    throw fail(
      `Expression must evaluate to a boolean result but ended with operand '${result.symbol}' (${result.type})`,
    );
}

/**
 * `buildExpressionTreeFromReversePolishNotationTokens`.
 *
 * @param {Term[]} tokens
 * @returns {ExpressionNode}
 */
function buildExpressionTree(tokens) {
  /** @type {ExpressionNode[]} */
  const nodes = [];

  for (const token of tokens) {
    if (isOperand(token)) {
      nodes.push(Object.freeze({ token: Object.freeze(token), left: null, right: null }));
    } else if (isOperator(token)) {
      if (nodes.length < 2)
        throw fail(
          `Insufficient arguments provided for operator '${token.symbol}' ` +
            `([${[...nodes].reverse().map((node) => node.token.symbol).join(", ")}])`,
        );

      const right = /** @type {ExpressionNode} */ (nodes.pop());
      const left = /** @type {ExpressionNode} */ (nodes.pop());
      nodes.push(Object.freeze({ token: Object.freeze(token), left, right }));
    } else {
      throw fail(`Unexpected symbol encountered: '${token.symbol}'`);
    }
  }

  if (nodes.length === 1) return /** @type {ExpressionNode} */ (nodes[0]);

  throw fail(
    `Unexpected extra values exist on the stack: [${[...nodes].reverse().map((node) => node.token.symbol).join(", ")}]`,
  );
}

/**
 * Compiles an expression once into an immutable tree that {@link evaluate} can run repeatedly.
 *
 * Call this while PARSING, not while evaluating: every error below is an authoring error in the
 * catalog, and Java surfaces all of them at construction time.
 *
 * The pipeline, in the order Java runs it — the order decides which error a broken expression
 * reports:
 *
 *   1. source length          (`Expression length %d exceeds maximum supported length %d`)
 *   2. tokenize               (`Unexpected code point U+%04X at index %d ...`)
 *   3. numeric literals       (`Invalid numeric literal '%s': %s`)
 *   4. token count            (`Expression contains %d tokens, ...`)
 *   5. nesting depth          (`Expression grouping depth exceeds ...`)
 *   6. shunting-yard          (`Unbalanced ( detected` / `Unbalanced ) detected`)
 *   7. static shape and types (wrapped as `Invalid expression '%s': %s`)
 *   8. tree construction
 *
 * Only step 7's failures are wrapped with the expression source; the others already name it or are
 * reported by the caller in its own context.
 *
 * @param {string} expression
 * @param {{ limits?: ExpressionLimits }} [options]
 * @returns {CompiledExpression}
 */
export function compile(expression, options) {
  if (typeof expression !== "string") throw fail(`An expression must be a string; received ${typeof expression}`);

  const limits = effectiveLimits(options?.limits);

  validateExpressionSourceLength(expression, limits.maximumExpressionCharacters);

  const tokens = termsFrom(extractTokens(expression));
  validateNumericLiteralTokens(tokens);
  const rpn = convertToReversePolishNotation(tokens, limits);

  try {
    validateReversePolishNotationTokens(rpn);
  } catch (cause) {
    throw fail(`Invalid expression '${expression}': ${messageOf(cause)}`, cause);
  }

  return Object.freeze({ expression, root: buildExpressionTree(rpn) });
}

/* -------------------------------------------------------------------------- */
/* Caller values                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | null | undefined} ExpressionValues
 */

/**
 * Java distinguishes `containsKey` from a null value, and so must this: an absent binding and an
 * explicit null are different authoring mistakes with different messages.
 *
 * @param {ExpressionValues} values
 * @param {string} name
 * @returns {boolean}
 */
function hasBinding(values, name) {
  if (values === null || values === undefined) return false;
  if (values instanceof Map) return values.has(name);
  return Object.hasOwn(/** @type {Readonly<Record<string, unknown>>} */ (values), name);
}

/**
 * @param {ExpressionValues} values
 * @param {string} name
 * @returns {unknown}
 */
function readBinding(values, name) {
  if (values === null || values === undefined) return undefined;
  if (values instanceof Map) return values.get(name);
  return /** @type {Readonly<Record<string, unknown>>} */ (values)[name];
}

/**
 * The `$lokalized` discriminator of a tagged record, or null for anything else.
 *
 * Structural, never by identity, so a tagged value survives JSON, workers, `structuredClone`, and
 * RSC boundaries. A string is not a record and can never match, which is the mechanism behind the
 * raw-string rule.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function taggedKindOf(value) {
  if (typeof value !== "object" || value === null) return null;
  const tag = /** @type {{ $lokalized?: unknown }} */ (value).$lokalized;
  return typeof tag === "string" ? tag : null;
}

/**
 * The axis and name of a tagged language-form value, or null.
 *
 * @param {unknown} value
 * @returns {{ axis: string, name: string } | null}
 */
function taggedLanguageForm(value) {
  if (taggedKindOf(value) !== "language-form") return null;

  const record = /** @type {{ axis?: unknown, name?: unknown }} */ (value);
  if (typeof record.axis !== "string" || typeof record.name !== "string") return null;

  return { axis: record.axis, name: record.name };
}

/**
 * `ExpressionEvaluator.operandType`.
 *
 * A raw string reports PHONETIC — a caller-supplied character sequence is a phonetic TERM, not a
 * language-form name and not a number. Anything else (a boolean, a date, a plain object) is
 * UNKNOWN, which is a hard error rather than a silent false.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @returns {OperandType}
 */
function operandTypeOf(token, values) {
  if (token.type === TokenType.BOOLEAN_RESULT) return "BOOLEAN";
  if (token.type === TokenType.NUMBER) return "NUMBER";
  if (token.axis !== null) return OPERAND_TYPE_BY_AXIS[token.axis];

  if (token.type === TokenType.VARIABLE) {
    if (!hasBinding(values, token.symbol))
      throw fail(`No value was provided for placeholder '${token.symbol}'`);

    const value = readBinding(values, token.symbol);

    if (value === null || value === undefined) throw fail(`Placeholder '${token.symbol}' resolved to null`);

    const tag = taggedKindOf(value);
    if (tag === "plural-operands" || tag === "decimal") return "NUMBER";
    if (typeof value === "number" || typeof value === "bigint") return "NUMBER";

    const form = taggedLanguageForm(value);
    if (form !== null && Object.hasOwn(OPERAND_TYPE_BY_AXIS, form.axis))
      return OPERAND_TYPE_BY_AXIS[/** @type {LanguageFormAxis} */ (form.axis)];

    if (typeof value === "string") return "PHONETIC";
  }

  return "UNKNOWN";
}

/**
 * `ExpressionEvaluator.runtimeTypeName` — the type name diagnostics report.
 *
 * For a variable Java prints `value.getClass().getSimpleName()`, so the JavaScript side names the
 * Java class each carrier stands in for: a whole `number` in `int` range is an `Integer`, a wider
 * one a `Long`, a fractional one a `Double`, a `bigint` a `BigInteger`, `decimal()` a `BigDecimal`.
 * The names are diagnostic only; nothing dispatches on them.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @returns {string}
 */
function runtimeTypeName(token, values) {
  if (token.type !== "VARIABLE")
    return JAVA_TYPE_NAME_BY_OPERAND_TYPE[operandTypeOf(token, values)] ?? token.type;

  const value = readBinding(values, token.symbol);

  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return "String";
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "bigint") return "BigInteger";

  if (typeof value === "number") {
    if (!Number.isInteger(value)) return "Double";
    return value >= -2147483648 && value <= 2147483647 ? "Integer" : "Long";
  }

  const tag = taggedKindOf(value);
  if (tag === "decimal") return "BigDecimal";
  if (tag === "plural-operands") return "PluralOperands";

  const form = taggedLanguageForm(value);
  if (form !== null && Object.hasOwn(JAVA_TYPE_NAME_BY_AXIS, form.axis))
    return JAVA_TYPE_NAME_BY_AXIS[/** @type {LanguageFormAxis} */ (form.axis)];

  if (typeof value === "object") return value.constructor?.name ?? "Object";

  return typeof value;
}

/**
 * `isCallerSuppliedCharacterSequence`. Only a VARIABLE can be one — an expression's own
 * `PHONETIC_*` constant is a language form, never text.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @returns {boolean}
 */
function isRawString(token, values) {
  return token.type === TokenType.VARIABLE && typeof readBinding(values, token.symbol) === "string";
}

/* -------------------------------------------------------------------------- */
/* Runtime operand extraction                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `bigDecimalFromOperand`, as an exact decimal.
 *
 * A NUMBER token's value was computed at COMPILE time; only a variable is resolved here.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @returns {ExactDecimal}
 */
function exactDecimalFromOperand(token, values) {
  if (token.numeric !== null) return token.numeric;

  if (token.type === TokenType.VARIABLE) {
    const value = readBinding(values, token.symbol);

    try {
      if (typeof value === "number" || typeof value === "bigint")
        return { abs: operandsFromNumber(value).n, negative: typeof value === "bigint" ? value < 0n : value < 0 };

      const tag = taggedKindOf(value);

      if (tag === "decimal" || tag === "plural-operands") {
        const text = /** @type {{ value?: unknown }} */ (value).value;

        if (typeof text !== "string")
          throw new TypeError("a tagged numeric value must carry exact decimal text");

        // Java validates the whole `PluralOperands` — including its compact exponent and visible
        // decimal places — and then compares its SOURCE number, before any compact shift.
        if (tag === "plural-operands") operandsForPluralValue(value);

        return { abs: operandsFromDecimalText(text, {}).n, negative: text.startsWith("-") };
      }
    } catch (cause) {
      throw fail(`Unable to extract numeric value from '${token.symbol}': ${messageOf(cause)}`, cause);
    }
  }

  throw fail(`Unable to extract numeric value from '${token.symbol}'`);
}

/**
 * Exact plural operands for a caller value, for the cases where a NUMBER must be CLASSIFIED rather
 * than compared. Routed through the shared engine, so a `decimal("1.0")` keeps its visible scale
 * and a `pluralOperands("1", { visibleDecimalPlaces: 1 })` keeps its explicit one — both of which
 * change the answer.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @returns {import("./plural.js").Operands}
 */
function operandsFromToken(token, values) {
  try {
    if (token.type === TokenType.NUMBER) return operandsFromDecimalText(token.symbol, {});
    return operandsForPluralValue(readBinding(values, token.symbol));
  } catch (cause) {
    throw fail(`Unable to extract numeric value from '${token.symbol}': ${messageOf(cause)}`, cause);
  }
}

/**
 * `cardinalityFromOperand`.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @param {string} locale
 * @returns {string} a `CARDINALITY_*` name
 */
function cardinalityFromOperand(token, values, locale) {
  if (token.axis === "cardinality") return token.symbol;

  if (token.type === TokenType.NUMBER)
    return `CARDINALITY_${cardinalCategoryFor(operandsFromToken(token, values), locale).toUpperCase()}`;

  if (token.type === TokenType.VARIABLE) {
    const value = readBinding(values, token.symbol);
    const form = taggedLanguageForm(value);

    if (form !== null && form.axis === "cardinality") return form.name;

    const tag = taggedKindOf(value);

    if (typeof value === "number" || typeof value === "bigint" || tag === "decimal" || tag === "plural-operands")
      return `CARDINALITY_${cardinalCategoryFor(operandsFromToken(token, values), locale).toUpperCase()}`;
  }

  throw fail(`Unable to extract Cardinality value from '${token.symbol}'`);
}

/**
 * Classifies a NUMBER into an ordinal category, using the resolver the CALLER passed to
 * {@link evaluate}.
 *
 * CLDR keeps ordinal rules in a table of their own and most catalogs never ask an ordinal question,
 * so the ~3 KB table is deliberately outside the root graph: `src/index.js` must never reach
 * `src/data/ordinal-rules.js`. An expression can still compare a TAGGED `ORDINALITY_*` value
 * against an `ORDINALITY_*` constant with no table at all — that is a nominal comparison. Only
 * classifying a NUMBER into an ordinal category needs the data, and that is what this seam exists
 * for.
 *
 * The resolver arrives PER EVALUATION and there is deliberately no module-level registration.
 * Two `Strings` instances in one process are independent configurations: one built with
 * `pluralData.ordinal` and one built without must not be able to answer each other's ordinal
 * questions, and a global would make the second silently answerable as soon as the first was
 * constructed — a cross-instance leak whose symptom (a catalog that resolves only when some
 * unrelated instance happens to exist) is close to undebuggable.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions | undefined} options
 * @returns {string} an `ORDINALITY_*` name
 */
function ordinalityCategoryFor(token, values, locale, options) {
  const resolver = options?.ordinalCategoryResolver;

  if (resolver === null || resolver === undefined)
    throw fail(
      `Unable to extract Ordinality value from '${token.symbol}': classifying a number as an ` +
        "ordinal category requires the optional 'lokalized/data/ordinal' module",
    );

  return `ORDINALITY_${resolver(operandsFromToken(token, values), locale).toUpperCase()}`;
}

/**
 * `ordinalityFromOperand`.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions | undefined} options
 * @returns {string} an `ORDINALITY_*` name
 */
function ordinalityFromOperand(token, values, locale, options) {
  if (token.axis === "ordinality") return token.symbol;
  if (token.type === TokenType.NUMBER) return ordinalityCategoryFor(token, values, locale, options);

  if (token.type === TokenType.VARIABLE) {
    const value = readBinding(values, token.symbol);
    const form = taggedLanguageForm(value);

    if (form !== null && form.axis === "ordinality") return form.name;

    const tag = taggedKindOf(value);

    if (typeof value === "number" || typeof value === "bigint" || tag === "decimal" || tag === "plural-operands")
      return ordinalityCategoryFor(token, values, locale, options);
  }

  throw fail(`Unable to extract Ordinality value from '${token.symbol}'`);
}

/**
 * `phoneticFromOperand`.
 *
 * A tagged `PHONETIC_*` value compares directly. A RAW STRING is a term and must go through the
 * caller's phonetic resolver — which is exactly why `"GENDER_FEMININE"` as a caller value does not
 * equal the `GENDER_FEMININE` constant: the comparison lands here, not on the gender axis.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions | undefined} options
 * @returns {string} a `PHONETIC_*` name
 */
function phoneticFromOperand(token, values, locale, options) {
  if (token.axis === "phonetic") return token.symbol;

  if (token.type === TokenType.VARIABLE) {
    const value = readBinding(values, token.symbol);
    const form = taggedLanguageForm(value);

    if (form !== null && form.axis === "phonetic") return form.name;

    if (typeof value === "string") {
      const resolver = options?.phoneticResolver ?? null;

      // Java's default resolver throws when first reached, and that becomes the current candidate's
      // resolution failure rather than a construction error.
      if (resolver === null)
        throw fail(
          "No phoneticResolver was configured. Provide one via " +
            `createStrings({ phoneticResolver }) to compare placeholder '${token.symbol}' phonetically`,
        );

      const maximum = options?.maximumPhoneticInputCharacters ?? DEFAULT_MAXIMUM_PHONETIC_INPUT_CHARACTERS;

      // Java's wording verbatim (`CharSequenceUtils.toString` via `ExpressionEvaluator:1751`), and
      // verbatim on purpose: this is a structural diagnostic the corpus records, not the
      // JVM-specific configuration advice the absent-resolver message above is.
      if (value.length > maximum)
        throw fail(
          `Phonetic input for placeholder '${token.symbol}' exceeds the maximum of ` +
            `${maximum} characters`,
        );

      const resolved = resolver(value, locale);
      const resolvedForm = taggedLanguageForm(resolved);

      if (resolvedForm === null || resolvedForm.axis !== "phonetic")
        throw fail(
          // Java is typed, so "not a Phonetic" can only ever reach it as null. JavaScript can be
          // handed anything, and the two are kept apart: the null wording is Java's own.
          resolved === null || resolved === undefined
            ? `PhoneticResolver returned null for placeholder '${token.symbol}'`
            : `phoneticResolver returned a non-phonetic value for placeholder '${token.symbol}'`,
        );

      return resolvedForm.name;
    }
  }

  throw fail(`Unable to extract Phonetic value from '${token.symbol}'`);
}

/**
 * The seven purely nominal axes: gender, grammatical case, definiteness, classifier, formality,
 * clusivity, and animacy. Each compares by exact tagged identity and nothing else — no numeric
 * coercion, no string sniffing, no cross-axis match.
 *
 * @param {Term} token
 * @param {ExpressionValues} values
 * @param {LanguageFormAxis} axis
 * @returns {string} a language-form name on `axis`
 */
function nominalFromOperand(token, values, axis) {
  if (token.axis === axis) return token.symbol;

  if (token.type === TokenType.VARIABLE) {
    const form = taggedLanguageForm(readBinding(values, token.symbol));
    if (form !== null && form.axis === axis) return form.name;
  }

  throw fail(`Unable to extract ${JAVA_TYPE_NAME_BY_AXIS[axis]} value from '${token.symbol}'`);
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} EvaluateOptions
 * @property {((term: string, locale: string) => unknown) | null} [phoneticResolver]
 * @property {number} [maximumPhoneticInputCharacters]
 * @property {((operands: import("./plural.js").Operands, locale: string) => string) | null} [ordinalCategoryResolver]
 */

/** The seven axes needing BOTH operands on the axis, in Java's dispatch order. */
const AXIS_ORDER = /** @type {const} */ ([
  "gender",
  "grammatical-case",
  "definiteness",
  "classifier",
  "formality",
  "clusivity",
  "animacy",
]);

/**
 * @param {LanguageFormAxis} axis
 * @returns {string}
 */
function comparisonNoun(axis) {
  return axis === "grammatical-case" ? "grammatical case" : axis;
}

/**
 * Rejects an ordering operator on an axis that only supports equality.
 *
 * @param {Term} left
 * @param {Term} operator
 * @param {Term} right
 * @param {string} noun
 */
function requireEqualityOperator(left, operator, right, noun) {
  if (operator.type === TokenType.EQUAL_TO || operator.type === TokenType.NOT_EQUAL_TO) return;

  throw fail(
    `You may only use the '==' and '!=' operators when performing ${noun} comparisons. ` +
      `Offending comparison: '${left.symbol} ${operator.symbol} ${right.symbol}'`,
  );
}

/**
 * `evaluateBinaryOperator`, for a comparison.
 *
 * The dispatch ORDER is Java's and is observable. Numbers first; then the seven nominal axes, which
 * require BOTH sides to be on the axis; then cardinality, ordinality and phonetic, each of which
 * claims the comparison when EITHER side is on it. That asymmetry is why `cardinalityValue ==
 * GENDER_FEMININE` reports "Unable to extract Cardinality value from 'GENDER_FEMININE'" rather than
 * an incompatible-types message: cardinality claimed the comparison and then could not read the
 * other side.
 *
 * @param {Term} left
 * @param {Term} operator
 * @param {Term} right
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions | undefined} options
 * @returns {boolean}
 */
function evaluateComparison(left, operator, right, values, locale, options) {
  const leftType = operandTypeOf(left, values);
  const rightType = operandTypeOf(right, values);

  if (leftType === "UNKNOWN" || rightType === "UNKNOWN")
    throw fail(
      `Unable to evaluate expression '${left.symbol} ${operator.symbol} ${right.symbol}'. ` +
        `Operand types ${leftType} and ${rightType} are unsupported`,
    );

  const leftIsRawString = isRawString(left, values);
  const rightIsRawString = isRawString(right, values);

  // Two raw strings are never comparable. Textual equality is not in the language: a string is a
  // phonetic TERM, and two terms can only be compared after each is resolved to a category, which
  // would make `left == right` mean something quite different from what it looks like. Java refuses
  // rather than guess, and says so differently for equality and for ordering.
  if (leftType === "PHONETIC" && rightType === "PHONETIC" && leftIsRawString && rightIsRawString) {
    if (operator.type === TokenType.EQUAL_TO || operator.type === TokenType.NOT_EQUAL_TO)
      throw fail(
        `Raw CharSequence placeholders '${left.symbol}' and '${right.symbol}' cannot be compared ` +
          `with '${operator.symbol}': expressions do not support textual equality. Compare phonetic ` +
          "input with a PHONETIC_* constant or an explicit Phonetic value instead",
      );

    throw fail(
      `Raw CharSequence placeholders '${left.symbol}' and '${right.symbol}' cannot be compared ` +
        `with '${operator.symbol}': expressions do not support textual ordering. Use numeric ` +
        "operands for ordering, or compare phonetic input with a PHONETIC_* constant or an " +
        "explicit Phonetic value using '==' or '!='",
    );
  }

  // A string opposite a number is a typing mistake with a specific remedy, so it gets its own
  // message rather than falling through to the phonetic branch.
  const rawStringOperand =
    leftType === "NUMBER" && rightIsRawString ? right : rightType === "NUMBER" && leftIsRawString ? left : null;

  if (rawStringOperand !== null)
    throw fail(
      `Numeric comparison '${left.symbol} ${operator.symbol} ${right.symbol}' requires numeric ` +
        `operands supplied as Number or PluralOperands values, but placeholder ` +
        `'${rawStringOperand.symbol}' resolved to ${runtimeTypeName(rawStringOperand, values)}`,
    );

  if (leftType === "NUMBER" && rightType === "NUMBER") {
    const comparison = compareExact(exactDecimalFromOperand(left, values), exactDecimalFromOperand(right, values));

    switch (operator.type) {
      case "LESS_THAN":
        return comparison < 0;
      case "LESS_THAN_OR_EQUAL_TO":
        return comparison <= 0;
      case "GREATER_THAN":
        return comparison > 0;
      case "GREATER_THAN_OR_EQUAL_TO":
        return comparison >= 0;
      case "EQUAL_TO":
        return comparison === 0;
      case "NOT_EQUAL_TO":
        return comparison !== 0;
      default:
        throw fail(`Encountered unexpected operator '${operator.symbol}'`);
    }
  }

  for (const axis of AXIS_ORDER) {
    const type = OPERAND_TYPE_BY_AXIS[axis];

    if (leftType === type && rightType === type) {
      requireEqualityOperator(left, operator, right, comparisonNoun(axis));

      const equal = nominalFromOperand(left, values, axis) === nominalFromOperand(right, values, axis);
      return operator.type === TokenType.EQUAL_TO ? equal : !equal;
    }
  }

  if (leftType === "CARDINALITY" || rightType === "CARDINALITY") {
    requireEqualityOperator(left, operator, right, "cardinality");

    const equal =
      cardinalityFromOperand(left, values, locale) === cardinalityFromOperand(right, values, locale);
    return operator.type === TokenType.EQUAL_TO ? equal : !equal;
  }

  if (leftType === "ORDINALITY" || rightType === "ORDINALITY") {
    requireEqualityOperator(left, operator, right, "ordinality");

    const equal =
      ordinalityFromOperand(left, values, locale, options) === ordinalityFromOperand(right, values, locale, options);
    return operator.type === TokenType.EQUAL_TO ? equal : !equal;
  }

  if (leftType === "PHONETIC" || rightType === "PHONETIC") {
    requireEqualityOperator(left, operator, right, "phonetic");

    const equal =
      phoneticFromOperand(left, values, locale, options) === phoneticFromOperand(right, values, locale, options);
    return operator.type === TokenType.EQUAL_TO ? equal : !equal;
  }

  throw fail(
    `Unable to evaluate expression '${left.symbol} ${operator.symbol} ${right.symbol}'. ` +
      `Operand runtime types ${runtimeTypeName(left, values)} and ${runtimeTypeName(right, values)} ` +
      "are incompatible",
  );
}

/**
 * `evaluateExpressionNode`.
 *
 * Boolean operators SHORT-CIRCUIT, and that is semantics rather than optimization: the skipped side
 * may reference a placeholder the caller never supplied, or one whose value has the wrong type, and
 * either would be a hard error if it were touched. The left operand is always evaluated, even when
 * the right alone would settle the result.
 *
 * @param {ExpressionNode} node
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions | undefined} options
 * @returns {boolean}
 */
function evaluateNode(node, values, locale, options) {
  const { token } = node;

  if (BOOLEAN_OPERATORS.has(token.type)) {
    if (node.left === null) throw fail(`Missing left operand for '${token.symbol}'`);
    if (node.right === null) throw fail(`Missing right operand for '${token.symbol}'`);

    const left = evaluateNode(node.left, values, locale, options);

    if (token.type === TokenType.AND && !left) return false;
    if (token.type === TokenType.OR && left) return true;

    const right = evaluateNode(node.right, values, locale, options);
    return token.type === TokenType.AND ? left && right : left || right;
  }

  if (COMPARISON_OPERATORS.has(token.type)) {
    if (node.left === null) throw fail(`Missing left operand for '${token.symbol}'`);
    if (node.right === null) throw fail(`Missing right operand for '${token.symbol}'`);

    return evaluateComparison(node.left.token, token, node.right.token, values, locale, options);
  }

  if (isOperand(token))
    throw fail(`Expression must evaluate to a boolean result but ended with operand '${token.symbol}'`);

  throw fail(`Unexpected symbol encountered: '${token.symbol}'`);
}

/**
 * Evaluates a previously compiled expression against caller values.
 *
 * `locale` is the EVALUATION locale — the catalog that supplied the entry, never the requested tag —
 * because a plural category is locale-sensitive and a fallback-served entry must classify under the
 * locale whose text it is.
 *
 * @param {CompiledExpression} compiled
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions} [options]
 * @returns {boolean}
 */
export function evaluate(compiled, values, locale, options) {
  return evaluateNode(compiled.root, values, locale, options);
}

/**
 * Compiles and evaluates in one step: `ExpressionEvaluator.evaluate(expression, context, locale)`.
 *
 * For tests and one-off use. Production paths compile once at parse time and call {@link evaluate}.
 *
 * @param {string} expression
 * @param {ExpressionValues} values
 * @param {string} locale
 * @param {EvaluateOptions} [options]
 * @returns {boolean}
 */
export function evaluateExpression(expression, values, locale, options) {
  return evaluate(compile(expression), values, locale, options);
}
