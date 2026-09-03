// @ts-check

/**
 * Internal: lexical analysis for the Lokalized expression language.
 *
 * Direct port of `ExpressionTokenizer`, `TokenType`, and `Token` from lokalized-java 3.0.0.
 *
 * Java compiles one big named-group alternation and, at each position, calls `Matcher.lookingAt()`
 * on a region anchored at that position; the first alternative that matches wins, and its group
 * name identifies the token type. This module reproduces that engine exactly with a single sticky
 * (`y`) regular expression: JavaScript and Java are both leftmost-alternative backtracking engines,
 * so alternation ORDER is behaviour, not style. Two orderings are load-bearing:
 *
 * - `<=` and `>=` precede `<` and `>`, or the two-character operators would never be produced;
 * - `VARIABLE` precedes all 61 language-form constants.
 *
 * That second one is the subtle part. Every language-form constant is also a legal identifier, so
 * the `VARIABLE` alternative always claims it first and the constants' own `\b...\b` alternatives
 * never fire. Java recovers the constant afterwards in `tokenFor`, by looking the matched text up in
 * `TokenType.getTokenTypesBySymbol()` — an EXACT, whole-symbol map lookup. That is where the word
 * boundary really comes from: `GENDER_FEMININEX` and `myGENDER_FEMININE` are matched whole by the
 * greedy identifier pattern, miss the exact lookup, and stay variables. Moving the constants ahead
 * of `VARIABLE` is not merely redundant, it is WRONG: `-` is an identifier character, so Java lexes
 * `GENDER_FEMININE-X` as one variable, while a leading `\bGENDER_FEMININE\b` would claim the
 * constant (the `-` satisfies the trailing boundary) and then choke on `-X`. The constant patterns
 * are kept here anyway, in Java's order, because they are part of the ported grammar.
 *
 * `NUMBER` and `VARIABLE` are, by contrast, DISJOINT — a number must start with a sign, a dot, or a
 * digit and an identifier must start with a letter or an underscore — so their relative order is
 * genuinely free, and nothing here should be read as depending on it.
 *
 * Ignorable whitespace is exactly ASCII space, tab, carriage return, line feed, and form feed; it
 * matches its own group and produces no token. Any other character — including other Unicode
 * whitespace — is an error at that index.
 *
 * This module is pure lexing. Expression limits (characters, tokens, nesting), precedence, the
 * shunting-yard conversion, and operand typing belong to the evaluator, exactly as they do in Java.
 */

/**
 * The 74 token types of `TokenType`, in Java's declaration order.
 *
 * `BOOLEAN_RESULT` is never produced by the tokenizer; the evaluator uses it for the `true`/`false`
 * sentinels it pushes while reducing a compiled tree.
 */
export const TokenType = Object.freeze({
  VARIABLE: "VARIABLE",
  NUMBER: "NUMBER",
  BOOLEAN_RESULT: "BOOLEAN_RESULT",
  GROUP_START: "GROUP_START",
  GROUP_END: "GROUP_END",
  AND: "AND",
  OR: "OR",
  LESS_THAN: "LESS_THAN",
  GREATER_THAN: "GREATER_THAN",
  EQUAL_TO: "EQUAL_TO",
  NOT_EQUAL_TO: "NOT_EQUAL_TO",
  LESS_THAN_OR_EQUAL_TO: "LESS_THAN_OR_EQUAL_TO",
  GREATER_THAN_OR_EQUAL_TO: "GREATER_THAN_OR_EQUAL_TO",
  CARDINALITY_ZERO: "CARDINALITY_ZERO",
  CARDINALITY_ONE: "CARDINALITY_ONE",
  CARDINALITY_TWO: "CARDINALITY_TWO",
  CARDINALITY_FEW: "CARDINALITY_FEW",
  CARDINALITY_MANY: "CARDINALITY_MANY",
  CARDINALITY_OTHER: "CARDINALITY_OTHER",
  ORDINALITY_ZERO: "ORDINALITY_ZERO",
  ORDINALITY_ONE: "ORDINALITY_ONE",
  ORDINALITY_TWO: "ORDINALITY_TWO",
  ORDINALITY_FEW: "ORDINALITY_FEW",
  ORDINALITY_MANY: "ORDINALITY_MANY",
  ORDINALITY_OTHER: "ORDINALITY_OTHER",
  PHONETIC_VOWEL: "PHONETIC_VOWEL",
  PHONETIC_CONSONANT: "PHONETIC_CONSONANT",
  PHONETIC_OTHER: "PHONETIC_OTHER",
  PHONETIC_H_SILENT: "PHONETIC_H_SILENT",
  PHONETIC_H_ASPIRATED: "PHONETIC_H_ASPIRATED",
  PHONETIC_S_IMPURE: "PHONETIC_S_IMPURE",
  PHONETIC_Z: "PHONETIC_Z",
  PHONETIC_GN: "PHONETIC_GN",
  PHONETIC_PS: "PHONETIC_PS",
  PHONETIC_PN: "PHONETIC_PN",
  PHONETIC_X: "PHONETIC_X",
  PHONETIC_GLIDE_Y: "PHONETIC_GLIDE_Y",
  PHONETIC_GLIDE_W: "PHONETIC_GLIDE_W",
  PHONETIC_STRESSED_A: "PHONETIC_STRESSED_A",
  PHONETIC_SOLAR: "PHONETIC_SOLAR",
  PHONETIC_LUNAR: "PHONETIC_LUNAR",
  GENDER_MASCULINE: "GENDER_MASCULINE",
  GENDER_FEMININE: "GENDER_FEMININE",
  GENDER_COMMON: "GENDER_COMMON",
  GENDER_NEUTER: "GENDER_NEUTER",
  CASE_NOMINATIVE: "CASE_NOMINATIVE",
  CASE_ACCUSATIVE: "CASE_ACCUSATIVE",
  CASE_GENITIVE: "CASE_GENITIVE",
  CASE_DATIVE: "CASE_DATIVE",
  CASE_INSTRUMENTAL: "CASE_INSTRUMENTAL",
  CASE_LOCATIVE: "CASE_LOCATIVE",
  CASE_PREPOSITIONAL: "CASE_PREPOSITIONAL",
  CASE_VOCATIVE: "CASE_VOCATIVE",
  CASE_ABLATIVE: "CASE_ABLATIVE",
  DEFINITENESS_DEFINITE: "DEFINITENESS_DEFINITE",
  DEFINITENESS_INDEFINITE: "DEFINITENESS_INDEFINITE",
  DEFINITENESS_CONSTRUCT: "DEFINITENESS_CONSTRUCT",
  CLASSIFIER_GENERAL: "CLASSIFIER_GENERAL",
  CLASSIFIER_PERSON: "CLASSIFIER_PERSON",
  CLASSIFIER_ANIMAL: "CLASSIFIER_ANIMAL",
  CLASSIFIER_LONG_THIN: "CLASSIFIER_LONG_THIN",
  CLASSIFIER_FLAT: "CLASSIFIER_FLAT",
  CLASSIFIER_BOUND: "CLASSIFIER_BOUND",
  CLASSIFIER_MACHINE: "CLASSIFIER_MACHINE",
  CLASSIFIER_VEHICLE: "CLASSIFIER_VEHICLE",
  FORMALITY_CASUAL: "FORMALITY_CASUAL",
  FORMALITY_INFORMAL: "FORMALITY_INFORMAL",
  FORMALITY_FORMAL: "FORMALITY_FORMAL",
  FORMALITY_HUMBLE: "FORMALITY_HUMBLE",
  FORMALITY_HONORIFIC: "FORMALITY_HONORIFIC",
  CLUSIVITY_INCLUSIVE: "CLUSIVITY_INCLUSIVE",
  CLUSIVITY_EXCLUSIVE: "CLUSIVITY_EXCLUSIVE",
  ANIMACY_ANIMATE: "ANIMACY_ANIMATE",
  ANIMACY_INANIMATE: "ANIMACY_INANIMATE",
});

/** @typedef {(typeof TokenType)[keyof typeof TokenType]} TokenTypeName */

/**
 * One token: `Token`. `symbol` is the matched source text, or the token type's fixed symbol.
 *
 * @typedef {object} Token
 * @property {TokenTypeName} tokenType
 * @property {string} symbol
 */

/**
 * The problem type for every expression diagnostic, lexical and later.
 *
 * Port of `ExpressionEvaluationException`. `name` and `code` are stable so a caller that cannot
 * `instanceof` this exact class (a second copy of the module, a wrapper defined elsewhere) can still
 * recognise it.
 */
export class ExpressionEvaluationError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options);
    /** @type {string} */
    this.name = "ExpressionEvaluationError";
    /** @type {"EXPRESSION_EVALUATION"} */
    this.code = "EXPRESSION_EVALUATION";
  }
}

/**
 * The 61 language-form token types, in `TokenType` declaration order.
 *
 * Cardinality, Ordinality, and Phonetic come FIRST here — this is `TokenType`'s order, which is not
 * the loader's `SUPPORTED_LANGUAGE_FORMS_BY_NAME` order that `catalog.js` pins.
 *
 * @type {readonly TokenTypeName[]}
 */
export const LANGUAGE_FORM_TOKEN_TYPES = Object.freeze([
  TokenType.CARDINALITY_ZERO,
  TokenType.CARDINALITY_ONE,
  TokenType.CARDINALITY_TWO,
  TokenType.CARDINALITY_FEW,
  TokenType.CARDINALITY_MANY,
  TokenType.CARDINALITY_OTHER,
  TokenType.ORDINALITY_ZERO,
  TokenType.ORDINALITY_ONE,
  TokenType.ORDINALITY_TWO,
  TokenType.ORDINALITY_FEW,
  TokenType.ORDINALITY_MANY,
  TokenType.ORDINALITY_OTHER,
  TokenType.PHONETIC_VOWEL,
  TokenType.PHONETIC_CONSONANT,
  TokenType.PHONETIC_OTHER,
  TokenType.PHONETIC_H_SILENT,
  TokenType.PHONETIC_H_ASPIRATED,
  TokenType.PHONETIC_S_IMPURE,
  TokenType.PHONETIC_Z,
  TokenType.PHONETIC_GN,
  TokenType.PHONETIC_PS,
  TokenType.PHONETIC_PN,
  TokenType.PHONETIC_X,
  TokenType.PHONETIC_GLIDE_Y,
  TokenType.PHONETIC_GLIDE_W,
  TokenType.PHONETIC_STRESSED_A,
  TokenType.PHONETIC_SOLAR,
  TokenType.PHONETIC_LUNAR,
  TokenType.GENDER_MASCULINE,
  TokenType.GENDER_FEMININE,
  TokenType.GENDER_COMMON,
  TokenType.GENDER_NEUTER,
  TokenType.CASE_NOMINATIVE,
  TokenType.CASE_ACCUSATIVE,
  TokenType.CASE_GENITIVE,
  TokenType.CASE_DATIVE,
  TokenType.CASE_INSTRUMENTAL,
  TokenType.CASE_LOCATIVE,
  TokenType.CASE_PREPOSITIONAL,
  TokenType.CASE_VOCATIVE,
  TokenType.CASE_ABLATIVE,
  TokenType.DEFINITENESS_DEFINITE,
  TokenType.DEFINITENESS_INDEFINITE,
  TokenType.DEFINITENESS_CONSTRUCT,
  TokenType.CLASSIFIER_GENERAL,
  TokenType.CLASSIFIER_PERSON,
  TokenType.CLASSIFIER_ANIMAL,
  TokenType.CLASSIFIER_LONG_THIN,
  TokenType.CLASSIFIER_FLAT,
  TokenType.CLASSIFIER_BOUND,
  TokenType.CLASSIFIER_MACHINE,
  TokenType.CLASSIFIER_VEHICLE,
  TokenType.FORMALITY_CASUAL,
  TokenType.FORMALITY_INFORMAL,
  TokenType.FORMALITY_FORMAL,
  TokenType.FORMALITY_HUMBLE,
  TokenType.FORMALITY_HONORIFIC,
  TokenType.CLUSIVITY_INCLUSIVE,
  TokenType.CLUSIVITY_EXCLUSIVE,
  TokenType.ANIMACY_ANIMATE,
  TokenType.ANIMACY_INANIMATE,
]);

/** @type {Set<string>} */
const LANGUAGE_FORM_TOKEN_TYPE_SET = new Set(LANGUAGE_FORM_TOKEN_TYPES);

/**
 * The fixed symbol of each token type that has one: `TokenType`'s constructor argument.
 *
 * A language-form constant's symbol IS its name, so those 61 are filled in from the list above
 * rather than restated as identical pairs. `VARIABLE`, `NUMBER`, and `BOOLEAN_RESULT` carry no fixed
 * symbol and are absent.
 *
 * @type {Readonly<Partial<Record<TokenTypeName, string>>>}
 */
export const SYMBOL_BY_TOKEN_TYPE = Object.freeze({
  [TokenType.GROUP_START]: "(",
  [TokenType.GROUP_END]: ")",
  [TokenType.AND]: "&&",
  [TokenType.OR]: "||",
  [TokenType.LESS_THAN]: "<",
  [TokenType.GREATER_THAN]: ">",
  [TokenType.EQUAL_TO]: "==",
  [TokenType.NOT_EQUAL_TO]: "!=",
  [TokenType.LESS_THAN_OR_EQUAL_TO]: "<=",
  [TokenType.GREATER_THAN_OR_EQUAL_TO]: ">=",
  ...Object.fromEntries(LANGUAGE_FORM_TOKEN_TYPES.map((tokenType) => [tokenType, tokenType])),
});

/**
 * `TokenType.getTokenTypesBySymbol()` — the exact, whole-symbol lookup that turns an identifier
 * match into a language-form token.
 *
 * @type {Readonly<Record<string, TokenTypeName>>}
 */
export const TOKEN_TYPE_BY_SYMBOL = Object.freeze(
  /** @type {Record<string, TokenTypeName>} */ (
    Object.fromEntries(
      Object.entries(SYMBOL_BY_TOKEN_TYPE).map(([tokenType, symbol]) => [symbol, tokenType]),
    )
  ),
);

/**
 * True if `tokenType` is one of the 61 reserved language-form constants.
 *
 * @param {string} tokenType
 * @returns {boolean}
 */
export function isLanguageFormTokenType(tokenType) {
  return LANGUAGE_FORM_TOKEN_TYPE_SET.has(tokenType);
}

/**
 * Gets the fixed symbol of a token type, or null when it has none.
 *
 * @param {TokenTypeName} tokenType
 * @returns {string | null}
 */
export function symbolForTokenType(tokenType) {
  // OWN properties only. Both symbol tables are ordinary objects, so an inherited `Object.prototype`
  // member would otherwise answer a lookup: `SYMBOL_BY_TOKEN_TYPE["toString"]` is a function, not
  // `undefined`. Java asks a `HashMap`, which has no such members.
  if (!Object.hasOwn(SYMBOL_BY_TOKEN_TYPE, tokenType)) return null;

  const symbol = SYMBOL_BY_TOKEN_TYPE[tokenType];
  return symbol === undefined ? null : symbol;
}

/**
 * Builds a token, applying the two checks Java's `Token` constructors apply: a type with no fixed
 * symbol must be given one, and a type with a fixed symbol may only be given that symbol.
 *
 * @param {TokenTypeName} tokenType
 * @param {string} [symbol] required for `VARIABLE`, `NUMBER`, and `BOOLEAN_RESULT`
 * @returns {Token}
 */
export function createToken(tokenType, symbol) {
  const fixedSymbol = symbolForTokenType(tokenType);

  if (symbol === undefined) {
    if (fixedSymbol === null)
      throw new TypeError(`You must provide a symbol for TokenType.${tokenType} values.`);

    return Object.freeze({ tokenType, symbol: fixedSymbol });
  }

  if (fixedSymbol !== null && fixedSymbol !== symbol)
    throw new TypeError(
      `Provided symbol value '${symbol}' does not match required value '${fixedSymbol}' for ` +
        `TokenType.${tokenType}.`,
    );

  return Object.freeze({ tokenType, symbol });
}

/**
 * `LocalizedStringUtils.localizedStringIdentifierPattern()` — the source text of the `VARIABLE`
 * alternative. Shared verbatim with `interpolate.js`'s placeholder-identifier check.
 */
const IDENTIFIER_PATTERN_SOURCE = "[\\p{L}_][\\p{L}\\p{N}\\p{M}_-]*";

/** `ExpressionTokenizer.WHITESPACE_GROUP_PATTERN`. */
const WHITESPACE_PATTERN_SOURCE = "[ \\t\\r\\n\\f]";

/** The whitespace group's name; it is deliberately not a token type. */
const WHITESPACE_GROUP_NAME = "WHITESPACE";

/**
 * `ExpressionTokenizer.PATTERNS_BY_TOKEN_TYPE`, in its exact insertion order.
 *
 * @type {readonly (readonly [TokenTypeName, string])[]}
 */
const PATTERNS_BY_TOKEN_TYPE = Object.freeze([
  [TokenType.GROUP_START, "\\("],
  [TokenType.GROUP_END, "\\)"],
  [TokenType.AND, "&&"],
  [TokenType.OR, "\\|\\|"],
  [TokenType.LESS_THAN_OR_EQUAL_TO, "<="],
  [TokenType.GREATER_THAN_OR_EQUAL_TO, ">="],
  [TokenType.LESS_THAN, "<"],
  [TokenType.GREATER_THAN, ">"],
  [TokenType.EQUAL_TO, "=="],
  [TokenType.NOT_EQUAL_TO, "!="],
  [TokenType.NUMBER, "[+-]?((\\d+\\.\\d*)|(\\.\\d+)|(\\d+))([eE][+-]?\\d+)?"],
  [TokenType.VARIABLE, IDENTIFIER_PATTERN_SOURCE],
  // The 61 language-form constants, each `\bNAME\b`, in TokenType declaration order. Unreachable in
  // practice — VARIABLE above claims every one of them first — but ported for fidelity.
  ...LANGUAGE_FORM_TOKEN_TYPES.map(
    (tokenType) =>
      /** @type {readonly [TokenTypeName, string]} */ ([tokenType, `\\b${tokenType}\\b`]),
  ),
]);

/**
 * Underscores are illegal in Java regex group names, so Java strips them. Doing the same here keeps
 * the two alternations character-for-character comparable.
 *
 * @param {string} tokenType
 * @returns {string}
 */
function groupNameFor(tokenType) {
  return tokenType.replaceAll("_", "");
}

/** Group name -> token type, for reading a match back. @type {Map<string, TokenTypeName>} */
const TOKEN_TYPE_BY_GROUP_NAME = new Map(
  PATTERNS_BY_TOKEN_TYPE.map(([tokenType]) => [groupNameFor(tokenType), tokenType]),
);

/**
 * The single sticky alternation. `y` anchors each attempt at `lastIndex`, which is what Java gets
 * from `matcher.region(position, length)` plus `lookingAt()`.
 */
const TOKEN_PATTERN = new RegExp(
  [
    `(?<${WHITESPACE_GROUP_NAME}>${WHITESPACE_PATTERN_SOURCE})`,
    ...PATTERNS_BY_TOKEN_TYPE.map(
      ([tokenType, pattern]) => `(?<${groupNameFor(tokenType)}>${pattern})`,
    ),
  ].join("|"),
  "yu",
);

/**
 * Formats a code point the way Java's `%04X` does: uppercase hex, zero-padded to at least four
 * digits, and never truncated for a supplementary code point.
 *
 * @param {number} codePoint
 * @returns {string}
 */
function formatCodePoint(codePoint) {
  return codePoint.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * `ExpressionTokenizer.unexpectedContent`.
 *
 * @param {string} expression
 * @param {number} position
 * @returns {ExpressionEvaluationError}
 */
function unexpectedContent(expression, position) {
  const codePoint = expression.codePointAt(position) ?? 0;
  let errorMessage =
    `Unexpected code point U+${formatCodePoint(codePoint)} at index ${position} ` +
    `while evaluating expression '${expression}'.`;

  // Special message for the common error of using "=" instead of "==" for equality checks.
  if (codePoint === 0x3d) errorMessage = `${errorMessage} Did you mean '=='?`;

  return new ExpressionEvaluationError(errorMessage);
}

/**
 * `ExpressionTokenizer.tokenFor` — a matched identifier that spells a language-form constant
 * exactly becomes that constant; anything else stays what it matched.
 *
 * @param {TokenTypeName} tokenType
 * @param {string} symbol
 * @returns {Token}
 */
function tokenFor(tokenType, symbol) {
  if (tokenType === TokenType.VARIABLE) {
    // OWN properties only: `toString`, `valueOf`, `constructor` and `hasOwnProperty` are all legal
    // identifiers and therefore legal placeholder names, and a bare index would find the inherited
    // `Object.prototype` function instead of `undefined` and turn each of them into a bogus token
    // type. Java's `TokenType.getTokenTypesBySymbol()` is a `HashMap` and returns null for all four.
    const exactSymbolTokenType = Object.hasOwn(TOKEN_TYPE_BY_SYMBOL, symbol)
      ? TOKEN_TYPE_BY_SYMBOL[symbol]
      : undefined;

    if (exactSymbolTokenType !== undefined) return createToken(exactSymbolTokenType);
  }

  return createToken(tokenType, symbol);
}

/**
 * Scans an expression into its tokens.
 *
 * Whitespace between tokens is consumed and produces nothing. The scan is total: every code unit is
 * either part of a token or the subject of an error, so a returned token list covers the whole
 * source.
 *
 * @param {string} expression the expression to tokenize
 * @returns {Token[]} the tokens that comprise the expression, in source order
 * @throws {ExpressionEvaluationError} if the expression contains content no token can match
 */
export function extractTokens(expression) {
  /** @type {Token[]} */
  const tokens = [];
  let position = 0;

  while (position < expression.length) {
    TOKEN_PATTERN.lastIndex = position;
    const match = TOKEN_PATTERN.exec(expression);

    if (match === null) throw unexpectedContent(expression, position);

    const groups = /** @type {Record<string, string | undefined>} */ (match.groups ?? {});

    // Exactly one alternative participates in a match, so at most one group is defined; whitespace
    // is the one group with no token type, which is how it is skipped.
    for (const [groupName, tokenType] of TOKEN_TYPE_BY_GROUP_NAME) {
      const symbol = groups[groupName];

      if (symbol !== undefined) tokens.push(tokenFor(tokenType, symbol));
    }

    // No alternative can match empty (whitespace, every operator, and both literal forms require at
    // least one character), but a zero-length match would spin forever, so refuse to make progress
    // dishonestly.
    if (TOKEN_PATTERN.lastIndex <= position) throw unexpectedContent(expression, position);

    position = TOKEN_PATTERN.lastIndex;
  }

  return tokens;
}
