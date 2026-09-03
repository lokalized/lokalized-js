// @ts-check

/**
 * Internal: bounded parse of one raw catalog object into the internal model.
 *
 * Port of `LocalizedStringLoader.parseLocalizedString`/`parsePlaceholderDefinition` plus the
 * structural half of `LocalizedStringValidator` from lokalized-java 3.0.0.
 *
 * Bounded means the limits are enforced while parsing, not afterwards: JSON container depth,
 * translation-node count, and alternative nesting depth.
 *
 * Expression validation and incomplete-language-form warnings are INJECTED rather than imported
 * (`ParseContext.validateExpression` / `onRootParsed`), and they run where Java runs them: inside
 * this walk. A caller that supplies neither gets the structural parse alone, which is what
 * `createStrings` still does — it compiles every expression in its own later pass
 * (`compileDefinitionExpressions`, `DefaultStrings.compileExpressions`'s order) and surfaces the
 * evaluator's message unwrapped, and it emits no warnings at all. Keeping the hooks optional is what
 * lets `lokalized/parse` be loader-faithful without changing what `createStrings` reports.
 */

import { isValidIdentifier, placeholderNamesIn } from "./interpolate.js";
import {
  boundedDiagnosticValue,
  boundedJsonPath,
  normalizeCatalogText,
  parseJsonDocument,
  readCharacters,
  readStrictUtf8,
  validateJsonNestingDepth as validateTextNestingDepth,
} from "./json-parse.js";

/** The `LocalizedStringLoadingOptions` defaults, and the two ceilings on the options themselves. */
const DEFAULT_MAXIMUM_INPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAXIMUM_READER_CHARACTERS = 8 * 1024 * 1024;
const DEFAULT_MAXIMUM_JSON_NESTING_DEPTH = 64;
const DEFAULT_MAXIMUM_TOTAL_INPUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAXIMUM_LOCALIZED_STRINGS_FILES = 256;
const DEFAULT_MAXIMUM_TRANSLATION_NODES = 100_000;
const DEFAULT_MAXIMUM_WARNINGS = 1_000;
const MAXIMUM_JSON_NESTING_DEPTH = 128;
/** `Integer.MAX_VALUE - 1`, the ceiling Java's builder puts on `maximumInputBytes`. */
const MAXIMUM_INPUT_BYTES = 2_147_483_646;
/** `LocalizedStringValidator.MAXIMUM_ALTERNATIVE_DEPTH`. */
const MAXIMUM_ALTERNATIVE_DEPTH = 128;

/**
 * @typedef {"cardinality" | "ordinality" | "gender" | "grammatical-case" | "definiteness"
 *   | "classifier" | "formality" | "clusivity" | "animacy" | "phonetic"} LanguageFormAxis
 */

/**
 * @typedef {object} PlaceholderRange
 * @property {string} start
 * @property {string} end
 */

/**
 * A per-language-form translation set: `LocalizedString.LanguageFormTranslation`.
 *
 * Exactly one of `value` and `range` is non-null. `axis` is the single axis every key of
 * `translations` belongs to, recorded at parse time so rendering never re-derives it.
 *
 * @typedef {object} LanguageFormPlaceholder
 * @property {"language-form"} kind
 * @property {string | null} value
 * @property {PlaceholderRange | null} range
 * @property {LanguageFormAxis} axis
 * @property {Map<string, string>} translations keyed by language-form name (`"CARDINALITY_ONE"`)
 */

/**
 * A generated template fragment: `LocalizedString.ExpressionTranslation`.
 *
 * @typedef {object} ExpressionPlaceholder
 * @property {"expression"} kind
 * @property {string} translation
 * @property {{ expression: string, translation: string }[]} alternatives
 */

/** @typedef {LanguageFormPlaceholder | ExpressionPlaceholder} PlaceholderDefinition */

/**
 * @typedef {object} Alternative
 * @property {string} expression
 * @property {Definition} definition
 */

/**
 * One catalog entry, or one whole-message alternative branch of it.
 *
 * `translation` is null only for a node that carries at least one alternative; the corpus keeps
 * such entries (an alternatives-only entry loads cleanly in Java).
 *
 * @typedef {object} Definition
 * @property {string | null} translation
 * @property {string | null} commentary
 * @property {Map<string, PlaceholderDefinition>} placeholders
 * @property {Alternative[]} alternatives
 */

/**
 * @typedef {object} ParseLimits
 * @property {number} [maximumInputBytes] per-resource, byte input only
 * @property {number} [maximumReaderCharacters] per-resource, text input only
 * @property {number} [maximumJsonNestingDepth]
 * @property {number} [maximumTotalInputBytes] aggregate, across a load
 * @property {number} [maximumLocalizedStringsFiles] aggregate, across a load
 * @property {number} [maximumTranslationNodes] aggregate, across a load
 * @property {number} [maximumWarnings] aggregate, across a load
 */

/**
 * @typedef {object} ParseContext
 * @property {string} [locale] the locale this catalog is being parsed for
 * @property {string} [source] identifies the catalog in diagnostics
 * @property {ParseLimits} [limits]
 * @property {(expression: string) => void} [validateExpression] compile every alternative's
 *   expression WHERE JAVA COMPILES IT, inside the structural walk. Supplied by `lokalized/parse`;
 *   omitted by `createStrings`, which compiles in a pass of its own afterwards.
 * @property {(key: string, definition: Definition) => void} [onRootParsed] run for each root member
 *   the instant it is parsed, before the next member is read — Java's slot for
 *   `warnOnIncompleteLanguageFormTranslations`.
 */

/**
 * @typedef {ParseContext & { session?: LoadingSession }} ParseSourceContext
 */

/**
 * Language-form names by axis.
 *
 * The ORDER is load-bearing, not cosmetic: it is the insertion order of
 * `LocalizedStringLoader.SUPPORTED_LANGUAGE_FORMS_BY_NAME` (a `LinkedHashMap`), and the corpus pins
 * it byte-for-byte in the "valid values are [...]" text of
 * `malformed-structure.language-form.unknown-form-name-rejected`. Java enumerates Gender,
 * GrammaticalCase, Definiteness, Classifier, Formality, Clusivity, Animacy, Cardinality, Ordinality,
 * Phonetic — the plural axes come near the END, not the front.
 */
/**
 * Exported for the root entry point, which builds the 61 public language-form constants from it.
 *
 * Each row is `[axis, JS constant prefix, Java enum member names]`, so a tuple is
 * `(axis, prefix + member, member)` and `renderName` is the member NAME rather than anything derived
 * by stripping a prefix off the constant — plan section 3.7 forbids that derivation. The corpus's
 * `languageForms` case carries all 61 authoritative tuples and proves this table exact.
 */
export const LANGUAGE_FORM_NAMES = /** @type {[LanguageFormAxis, string, string[]][]} */ ([
  ["gender", "GENDER_", ["MASCULINE", "FEMININE", "COMMON", "NEUTER"]],
  [
    "grammatical-case",
    "CASE_",
    [
      "NOMINATIVE",
      "ACCUSATIVE",
      "GENITIVE",
      "DATIVE",
      "INSTRUMENTAL",
      "LOCATIVE",
      "PREPOSITIONAL",
      "VOCATIVE",
      "ABLATIVE",
    ],
  ],
  ["definiteness", "DEFINITENESS_", ["DEFINITE", "INDEFINITE", "CONSTRUCT"]],
  [
    "classifier",
    "CLASSIFIER_",
    ["GENERAL", "PERSON", "ANIMAL", "LONG_THIN", "FLAT", "BOUND", "MACHINE", "VEHICLE"],
  ],
  ["formality", "FORMALITY_", ["CASUAL", "INFORMAL", "FORMAL", "HUMBLE", "HONORIFIC"]],
  ["clusivity", "CLUSIVITY_", ["INCLUSIVE", "EXCLUSIVE"]],
  ["animacy", "ANIMACY_", ["ANIMATE", "INANIMATE"]],
  ["cardinality", "CARDINALITY_", ["ZERO", "ONE", "TWO", "FEW", "MANY", "OTHER"]],
  ["ordinality", "ORDINALITY_", ["ZERO", "ONE", "TWO", "FEW", "MANY", "OTHER"]],
  [
    "phonetic",
    "PHONETIC_",
    [
      "VOWEL",
      "CONSONANT",
      "H_SILENT",
      "H_ASPIRATED",
      "S_IMPURE",
      "Z",
      "GN",
      "PS",
      "PN",
      "X",
      "GLIDE_Y",
      "GLIDE_W",
      "STRESSED_A",
      "SOLAR",
      "LUNAR",
      "OTHER",
    ],
  ],
]);

/** @type {Map<string, LanguageFormAxis>} */
const AXIS_BY_LANGUAGE_FORM_NAME = new Map();

for (const [axis, prefix, names] of LANGUAGE_FORM_NAMES)
  for (const name of names) AXIS_BY_LANGUAGE_FORM_NAME.set(`${prefix}${name}`, axis);

/** `LocalizedStringValidator.RESERVED_LANGUAGE_FORM_NAMES` — 61 names. */
const RESERVED_LANGUAGE_FORM_NAMES = AXIS_BY_LANGUAGE_FORM_NAME;

const VALID_LANGUAGE_FORM_NAMES = [...AXIS_BY_LANGUAGE_FORM_NAME.keys()].join(", ");

/**
 * `LocalizedStringLoader.descriptionAtDeclarationPath`.
 *
 * At the root the declaration path IS the key, so the description stands alone; inside an
 * alternative it is suffixed with the path that reached it. The corpus pins the suffixed form in
 * `malformed-structure.reference.inside-alternative-reports-declaration-path`.
 *
 * @param {string} description
 * @param {string} rootKey
 * @param {string} declarationPath
 * @returns {string}
 */
function descriptionAtDeclarationPath(description, rootKey, declarationPath) {
  return rootKey === declarationPath ? description : `${description} declared at ${declarationPath}`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} object
 * @param {string} member
 * @returns {boolean}
 */
function has(object, member) {
  return Object.hasOwn(object, member);
}

/**
 * Bounded, iterative container-depth scan.
 *
 * `LocalizedStringLoader.validateJsonNestingDepth` counts every `{`/`[` in the file text before the
 * document is parsed, so the catalog object itself is depth 1. The walk here is the structural
 * equivalent over an already-decoded value and bails as soon as the limit is passed.
 *
 * @param {unknown} root
 * @param {number} maximum
 * @param {string} source
 * @returns {void}
 */
function validateNestingDepth(root, maximum, source) {
  /** @type {{ value: unknown, depth: number }[]} */
  const stack = [{ value: root, depth: 0 }];

  while (stack.length > 0) {
    const frame = /** @type {{ value: unknown, depth: number }} */ (stack.pop());
    const { value } = frame;

    if (!Array.isArray(value) && !isObject(value)) continue;

    const depth = frame.depth + 1;

    if (depth > maximum)
      throw new Error(`${source}: JSON nesting depth exceeds the maximum of ${maximum}`);

    if (Array.isArray(value)) {
      for (const element of value) stack.push({ value: element, depth });
    } else {
      for (const key of Object.keys(value)) stack.push({ value: value[key], depth });
    }
  }
}

/**
 * `LocalizedStringLoadingOptions.Builder`'s validation, which Java performs when the options are
 * BUILT — before a byte is read. A limit outside its range is refused, never clamped and never
 * ignored: clamping and ignoring are indistinguishable from the caller's side until a resource that
 * should have been refused is accepted.
 *
 * These are `IllegalArgumentException` in Java. The JS contract splits that across `TypeError` (the
 * wrong kind of value) and `RangeError` (the right kind, out of range); every one of them is a
 * range, so `RangeError` it is.
 *
 * @param {ParseLimits} [limits]
 * @returns {Required<ParseLimits>}
 */
export function resolveLimits(limits) {
  const resolved = {
    maximumInputBytes: limits?.maximumInputBytes ?? DEFAULT_MAXIMUM_INPUT_BYTES,
    maximumReaderCharacters: limits?.maximumReaderCharacters ?? DEFAULT_MAXIMUM_READER_CHARACTERS,
    maximumJsonNestingDepth: limits?.maximumJsonNestingDepth ?? DEFAULT_MAXIMUM_JSON_NESTING_DEPTH,
    maximumTotalInputBytes: limits?.maximumTotalInputBytes ?? DEFAULT_MAXIMUM_TOTAL_INPUT_BYTES,
    maximumLocalizedStringsFiles:
      limits?.maximumLocalizedStringsFiles ?? DEFAULT_MAXIMUM_LOCALIZED_STRINGS_FILES,
    maximumTranslationNodes: limits?.maximumTranslationNodes ?? DEFAULT_MAXIMUM_TRANSLATION_NODES,
    maximumWarnings: limits?.maximumWarnings ?? DEFAULT_MAXIMUM_WARNINGS,
  };

  if (!Number.isInteger(resolved.maximumInputBytes) || resolved.maximumInputBytes <= 0 ||
    resolved.maximumInputBytes > MAXIMUM_INPUT_BYTES)
    throw new RangeError("maximumInputBytes must be between 1 and Integer.MAX_VALUE - 1");

  if (!Number.isInteger(resolved.maximumReaderCharacters) || resolved.maximumReaderCharacters <= 0)
    throw new RangeError("maximumReaderCharacters must be positive");

  if (!Number.isInteger(resolved.maximumJsonNestingDepth) || resolved.maximumJsonNestingDepth <= 0 ||
    resolved.maximumJsonNestingDepth > MAXIMUM_JSON_NESTING_DEPTH)
    throw new RangeError(`maximumJsonNestingDepth must be between 1 and ${MAXIMUM_JSON_NESTING_DEPTH}`);

  if (!Number.isInteger(resolved.maximumTotalInputBytes) || resolved.maximumTotalInputBytes <= 0)
    throw new RangeError("maximumTotalInputBytes must be positive");

  if (!Number.isInteger(resolved.maximumLocalizedStringsFiles) ||
    resolved.maximumLocalizedStringsFiles <= 0)
    throw new RangeError("maximumLocalizedStringsFiles must be positive");

  if (!Number.isInteger(resolved.maximumTranslationNodes) || resolved.maximumTranslationNodes < 0)
    throw new RangeError("maximumTranslationNodes must be nonnegative");

  if (!Number.isInteger(resolved.maximumWarnings) || resolved.maximumWarnings < 0)
    throw new RangeError("maximumWarnings must be nonnegative");

  return resolved;
}

/**
 * `LocalizedStringLoader.LoadingSession` — the budgets that span a whole load rather than one
 * resource, so a directory of files cannot pay each limit over again.
 *
 * Every one of these REJECTS BEFORE THE OVER-LIMIT ITEM IS RETAINED: the counter is compared before
 * it is incremented, and `warn` refuses the warning instead of delivering it, which is why a load
 * whose warning budget is zero fails on the first warning rather than emitting it and failing later.
 */
export class LoadingSession {
  /** @param {ParseLimits} [limits] */
  constructor(limits) {
    this.limits = resolveLimits(limits);
    this.inputBytes = 0;
    this.localizedStringsFiles = 0;
    this.translationNodes = 0;
    this.warnings = 0;
  }

  /** @param {string} source @returns {void} */
  beginFile(source) {
    if (this.localizedStringsFiles >= this.limits.maximumLocalizedStringsFiles)
      throw new Error(
        `${source}: localized strings load exceeds the aggregate localized strings file limit of ` +
          `${this.limits.maximumLocalizedStringsFiles}`,
      );

    ++this.localizedStringsFiles;
  }

  /** @param {number} count @param {string} source @returns {void} */
  addInputBytes(count, source) {
    if (count < 0 || this.inputBytes > this.limits.maximumTotalInputBytes - count)
      throw new Error(
        `${source}: localized strings load exceeds the aggregate maximum of ` +
          `${this.limits.maximumTotalInputBytes} input bytes`,
      );

    this.inputBytes += count;
  }

  /** @param {number} count @param {string} source @returns {void} */
  addTranslationNodes(count, source) {
    if (count < 0 || this.translationNodes > this.limits.maximumTranslationNodes - count)
      throw new Error(
        `${source}: localized strings load exceeds the aggregate maximum of ` +
          `${this.limits.maximumTranslationNodes} translation nodes`,
      );

    this.translationNodes += count;
  }

  /**
   * @param {{ source: string }} warning
   * @param {(warning: any) => void} [onWarning]
   * @returns {void}
   */
  warn(warning, onWarning) {
    if (this.warnings >= this.limits.maximumWarnings)
      throw new Error(
        `${warning.source}: localized strings load exceeds the aggregate maximum of ` +
          `${this.limits.maximumWarnings} warnings`,
      );

    ++this.warnings;
    if (onWarning) onWarning(warning);
  }
}

/** One resource's view of the session's translation-node budget. */
class NodeBudget {
  /**
   * @param {LoadingSession} session
   * @param {string} source
   */
  constructor(session, source) {
    this.session = session;
    this.source = source;
  }

  /** @param {number} count */
  add(count) {
    this.session.addTranslationNodes(count, this.source);
  }
}

/** Everything one parse needs to report and bound itself. */
class ParseSession {
  /**
   * @param {string} source
   * @param {NodeBudget} budget
   * @param {((expression: string) => void) | null} [validateExpression] the expression compiler, when
   *   the caller wants validation to happen HERE. Injected rather than imported so `catalog.js`
   *   stays independent of the expression language: `lokalized/parse` supplies it because the loader
   *   wording and the loader's ordering are its contract; `createStrings` does not, and compiles in
   *   its own pass afterwards.
   */
  constructor(source, budget, validateExpression) {
    this.source = source;
    this.budget = budget;
    this.validateExpression = validateExpression ?? null;
  }

  /**
   * @param {string} message
   * @param {unknown} [cause]
   * @returns {Error}
   */
  error(message, cause) {
    return new Error(
      `${this.source}: ${message}`,
      cause === undefined ? undefined : { cause },
    );
  }

  /**
   * `LocalizedStringLoader.validateWholeMessageAlternativeExpression` and
   * `validateFragmentAlternativeExpression`, which differ only in their wording.
   *
   * Called from INSIDE the structural walk, at the exact points Java calls them, because the order
   * is observable: a file whose first alternative carries a bad expression and whose second carries
   * a structural error reports the expression, and validating afterwards would report the structure.
   *
   * @param {string} expression
   * @param {(reason: string) => string} describe
   * @returns {void}
   */
  checkExpression(expression, describe) {
    if (this.validateExpression === null) return;

    try {
      this.validateExpression(expression);
    } catch (cause) {
      throw this.error(describe(cause instanceof Error ? cause.message : String(cause)), cause);
    }
  }
}

/**
 * `LocalizedStringLoader.ensureValidPlaceholderName`.
 *
 * @param {ParseSession} session
 * @param {string} key
 * @param {string} name
 * @param {string} description
 * @returns {void}
 */
function ensureValidPlaceholderName(session, key, name, description) {
  if (!isValidIdentifier(name))
    throw session.error(
      `invalid ${description} '${name}'. Placeholder names must start with a Unicode letter or ` +
        "underscore and contain only Unicode letters, Unicode numbers, Unicode combining marks, " +
        `underscores, or hyphens. Key is '${key}'`,
    );

  if (RESERVED_LANGUAGE_FORM_NAMES.has(name))
    throw session.error(
      `invalid ${description} '${name}'. Placeholder names may not use reserved expression ` +
        `constants. Key is '${key}'`,
    );
}

/**
 * `LocalizedStringLoader.validatePlaceholderReferences`.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} template
 * @param {string} description
 * @returns {void}
 */
function validatePlaceholderReferences(session, rootKey, template, description) {
  /** @type {string[]} */
  let names;

  try {
    names = placeholderNamesIn(template);
  } catch (cause) {
    throw session.error(
      `invalid placeholder reference in ${description} for key '${rootKey}': ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  for (const name of names)
    ensureValidPlaceholderName(session, rootKey, name, `${description} placeholder reference`);
}

/**
 * `LocalizedStringLoader.validateNoUnexpectedObjectMembers`.
 *
 * @param {ParseSession} session
 * @param {string} key
 * @param {Record<string, unknown>} object
 * @param {string} description
 * @param {string[]} expected
 * @returns {void}
 */
function validateNoUnexpectedObjectMembers(session, key, object, description, expected) {
  for (const member of Object.keys(object))
    if (!expected.includes(member))
      throw session.error(
        `unexpected field '${member}' in ${description} for key '${key}'. Valid fields are ` +
          `[${[...expected].sort().join(", ")}]`,
      );
}

/**
 * @param {ParseSession} session
 * @param {string} key
 * @param {string} placeholderKey
 * @param {string} member
 * @param {Record<string, unknown>} object
 * @returns {void}
 */
function rejectExplicitNullPlaceholderMember(session, key, placeholderKey, member, object) {
  if (has(object, member) && object[member] === null)
    throw session.error(
      `placeholder member '${member}' may not be null. Placeholder is '${placeholderKey}' for ` +
        `key '${key}'`,
    );
}

/**
 * `LocalizedStringLoader.parseSingleAxisLanguageFormTranslation`.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} placeholderKey
 * @param {string} declarationPath
 * @param {Record<string, unknown>} object
 * @returns {LanguageFormPlaceholder}
 */
function parseLanguageFormTranslation(session, rootKey, placeholderKey, declarationPath, object) {
  rejectExplicitNullPlaceholderMember(session, rootKey, placeholderKey, "value", object);
  rejectExplicitNullPlaceholderMember(session, rootKey, placeholderKey, "range", object);
  rejectExplicitNullPlaceholderMember(session, rootKey, placeholderKey, "translations", object);

  const hasValue = has(object, "value");
  const hasRange = has(object, "range");

  if (!hasValue && !hasRange)
    throw session.error(
      `a placeholder translation value or range is required. Key is '${rootKey}'`,
    );

  if (hasValue && hasRange)
    throw session.error(
      `a placeholder translation cannot have both a value and a range. Key is '${rootKey}'`,
    );

  /** @type {string | null} */
  let value = null;
  /** @type {PlaceholderRange | null} */
  let range = null;

  if (hasRange) {
    const rangeValue = object["range"];

    if (!isObject(rangeValue))
      throw session.error(
        `the placeholder translation range must be an object. Key is '${rootKey}'`,
      );

    validateNoUnexpectedObjectMembers(
      session,
      rootKey,
      rangeValue,
      `range for placeholder '${placeholderKey}'`,
      ["start", "end"],
    );

    const start = rangeValue["start"];
    const end = rangeValue["end"];

    if (start === undefined || start === null)
      throw session.error(
        `a placeholder translation range start is required. Key is '${rootKey}'`,
      );

    if (end === undefined || end === null)
      throw session.error(`a placeholder translation range end is required. Key is '${rootKey}'`);

    if (typeof start !== "string")
      throw session.error(
        `a placeholder translation range start must be a string. Key is '${rootKey}'`,
      );

    if (typeof end !== "string")
      throw session.error(
        `a placeholder translation range end must be a string. Key is '${rootKey}'`,
      );

    ensureValidPlaceholderName(session, rootKey, start, "range start");
    ensureValidPlaceholderName(session, rootKey, end, "range end");
    range = { start, end };
  } else {
    const rawValue = object["value"];

    if (typeof rawValue !== "string")
      throw session.error(`a placeholder translation value must be a string. Key is '${rootKey}'`);

    ensureValidPlaceholderName(session, rootKey, rawValue, "placeholder value");
    value = rawValue;
  }

  if (!has(object, "translations"))
    throw session.error(`placeholder translations are required. Key is '${rootKey}'`);

  const translationsValue = object["translations"];

  if (!isObject(translationsValue))
    throw session.error(
      `the placeholder translations value must be an object. Key is '${rootKey}'`,
    );

  /** @type {Map<string, string>} */
  const translations = new Map();
  /** @type {Set<LanguageFormAxis>} */
  const axes = new Set();

  for (const formName of Object.keys(translationsValue)) {
    const axis = AXIS_BY_LANGUAGE_FORM_NAME.get(formName);

    if (axis === undefined)
      throw session.error(
        `unexpected placeholder translation language form encountered. Key is '${rootKey}'. ` +
          `You provided '${formName}', valid values are [${VALID_LANGUAGE_FORM_NAMES}]`,
      );

    const formTranslation = translationsValue[formName];

    if (typeof formTranslation !== "string")
      throw session.error(
        `the placeholder translation value must be a string. Key is '${rootKey}'`,
      );

    validatePlaceholderReferences(
      session,
      rootKey,
      formTranslation,
      descriptionAtDeclarationPath(
        `placeholder translation for generated placeholder '${placeholderKey}'`,
        rootKey,
        declarationPath,
      ),
    );
    translations.set(formName, formTranslation);
    axes.add(axis);
  }

  if (translations.size === 0)
    throw session.error(`placeholder translations are required. Key is '${rootKey}'`);

  if (axes.size > 1)
    throw session.error(
      "you cannot mix-and-match language forms in placeholder translations. Placeholder is " +
        `'${placeholderKey}' for key '${rootKey}'`,
    );

  const axis = /** @type {LanguageFormAxis} */ ([...axes][0]);

  if (range !== null && axis !== "cardinality")
    throw session.error(
      `range-based translations only support Cardinality. Placeholder is '${placeholderKey}' for ` +
        `key '${rootKey}'`,
    );

  return { kind: "language-form", value, range, axis, translations };
}

/**
 * `LocalizedStringLoader.parseExpressionTranslation`.
 *
 * The expression text itself is NOT validated in M2 — the expression language is M6.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} placeholderKey
 * @param {string} declarationPath
 * @param {Record<string, unknown>} object
 * @returns {ExpressionPlaceholder}
 */
function parseExpressionTranslation(session, rootKey, placeholderKey, declarationPath, object) {
  if (!has(object, "translation"))
    throw session.error(
      `a default template translation is required for placeholder '${placeholderKey}' in root ` +
        `key '${rootKey}'`,
    );

  const translationValue = object["translation"];

  if (translationValue === null)
    throw session.error(
      `default template translation may not be null for placeholder '${placeholderKey}' in root ` +
        `key '${rootKey}'`,
    );

  if (typeof translationValue !== "string")
    throw session.error(
      `default template translation must be a string for placeholder '${placeholderKey}' in root ` +
        `key '${rootKey}'`,
    );

  validatePlaceholderReferences(
    session,
    rootKey,
    translationValue,
    descriptionAtDeclarationPath(
      `default fragment for generated placeholder '${placeholderKey}'`,
      rootKey,
      declarationPath,
    ),
  );

  /** @type {{ expression: string, translation: string }[]} */
  const alternatives = [];

  if (!has(object, "alternatives"))
    return { kind: "expression", translation: translationValue, alternatives };

  const alternativesValue = object["alternatives"];

  if (alternativesValue === null)
    throw session.error(
      `fragment alternatives may not be null for placeholder '${placeholderKey}' in root key ` +
        `'${rootKey}'`,
    );

  if (!Array.isArray(alternativesValue))
    throw session.error(
      `fragment alternatives must be an array for placeholder '${placeholderKey}' in root key ` +
        `'${rootKey}'`,
    );

  if (alternativesValue.length === 0)
    throw session.error(
      `fragment alternatives must contain at least one expression for placeholder ` +
        `'${placeholderKey}' in root key '${rootKey}'`,
    );

  for (let index = 0; index < alternativesValue.length; ++index) {
    session.budget.add(1);

    const element = alternativesValue[index];

    if (element === null || element === undefined)
      throw session.error(
        `fragment alternative ${index} may not be null for placeholder '${placeholderKey}' in ` +
          `root key '${rootKey}'`,
      );

    if (!isObject(element))
      throw session.error(
        `fragment alternative ${index} must be an object for placeholder '${placeholderKey}' in ` +
          `root key '${rootKey}'`,
      );

    const members = Object.keys(element);

    if (members.length !== 1)
      throw session.error(
        `fragment alternative ${index} must contain exactly one expression so array order ` +
          `defines first-match precedence. Placeholder is '${placeholderKey}' in root key ` +
          `'${rootKey}'`,
      );

    const expression = /** @type {string} */ (members[0]);
    const alternativeTranslation = element[expression];

    if (typeof alternativeTranslation !== "string")
      throw session.error(
        `fragment alternative ${index} for expression '${expression}' must have a string result. ` +
          `Placeholder is '${placeholderKey}' in root key '${rootKey}'`,
      );

    session.checkExpression(
      expression,
      (reason) =>
        `unable to parse fragment alternative ${index} expression '${expression}' for ` +
        `placeholder '${placeholderKey}' in root key '${rootKey}': ${reason}`,
    );
    validatePlaceholderReferences(
      session,
      rootKey,
      alternativeTranslation,
      descriptionAtDeclarationPath(
        `fragment alternative ${index} for expression '${expression}' and generated placeholder ` +
          `'${placeholderKey}'`,
        rootKey,
        declarationPath,
      ),
    );
    alternatives.push({ expression, translation: alternativeTranslation });
  }

  return { kind: "expression", translation: translationValue, alternatives };
}

/**
 * `LocalizedStringLoader.parsePlaceholderDefinition`.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} placeholderKey
 * @param {string} declarationPath
 * @param {Record<string, unknown>} object
 * @returns {PlaceholderDefinition}
 */
function parsePlaceholderDefinition(session, rootKey, placeholderKey, declarationPath, object) {
  validateNoUnexpectedObjectMembers(
    session,
    rootKey,
    object,
    `placeholder '${placeholderKey}'`,
    ["value", "range", "translations", "translation", "alternatives"],
  );

  const hasLanguageFormMember =
    has(object, "value") || has(object, "range") || has(object, "translations");
  const hasTemplateMember = has(object, "translation") || has(object, "alternatives");

  if (hasLanguageFormMember && hasTemplateMember)
    throw session.error(
      `placeholder '${placeholderKey}' for root key '${rootKey}' mixes language-form members ` +
        "[value, range, translations] with template members [translation, alternatives]; " +
        "placeholder modes are mutually exclusive",
    );

  if (!hasLanguageFormMember && !hasTemplateMember)
    throw session.error(
      `placeholder '${placeholderKey}' for root key '${rootKey}' must define either a ` +
        "language-form translation or a template translation",
    );

  if (hasTemplateMember)
    return parseExpressionTranslation(session, rootKey, placeholderKey, declarationPath, object);

  return parseLanguageFormTranslation(session, rootKey, placeholderKey, declarationPath, object);
}

/**
 * `LocalizedStringLoader.parseLocalizedString`.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} key the root key, or the alternative expression at this node
 * @param {string} declarationPath the JSON path that reached this node, for diagnostics
 * @param {unknown} value
 * @param {number} alternativeDepth
 * @returns {Definition}
 */
function parseNode(session, rootKey, key, declarationPath, value, alternativeDepth) {
  if (alternativeDepth > MAXIMUM_ALTERNATIVE_DEPTH)
    throw session.error(
      `alternative nesting exceeds the maximum depth of ${MAXIMUM_ALTERNATIVE_DEPTH} for key ` +
        `'${rootKey}'`,
    );

  if (typeof value === "string") {
    validatePlaceholderReferences(
      session,
      rootKey,
      value,
      descriptionAtDeclarationPath("translation", rootKey, declarationPath),
    );
    return { translation: value, commentary: null, placeholders: new Map(), alternatives: [] };
  }

  if (!isObject(value))
    throw session.error(
      `either a translation string or object value is required for key '${key}'`,
    );

  validateNoUnexpectedObjectMembers(session, key, value, "localized string", [
    "translation",
    "commentary",
    "placeholders",
    "alternatives",
  ]);

  /** @type {string | null} */
  let translation = null;

  if (has(value, "translation")) {
    const translationValue = value["translation"];

    if (typeof translationValue !== "string")
      throw session.error(`translation must be a string for key '${key}'`);

    translation = translationValue;
  }

  /** @type {string | null} */
  let commentary = null;

  if (has(value, "commentary")) {
    const commentaryValue = value["commentary"];

    if (typeof commentaryValue !== "string")
      throw session.error(`commentary must be a string for key '${key}'`);

    commentary = commentaryValue;
  }

  /** @type {Map<string, PlaceholderDefinition>} */
  const placeholders = new Map();

  if (has(value, "placeholders")) {
    const placeholdersValue = value["placeholders"];

    if (!isObject(placeholdersValue))
      throw session.error(`the placeholders value must be an object. Key is '${key}'`);

    for (const placeholderKey of Object.keys(placeholdersValue)) {
      session.budget.add(1);
      ensureValidPlaceholderName(session, key, placeholderKey, "placeholder");

      const placeholderValue = placeholdersValue[placeholderKey];

      if (!isObject(placeholderValue))
        throw session.error(`the placeholder value must be an object. Key is '${key}'`);

      placeholders.set(
        placeholderKey,
        parsePlaceholderDefinition(
          session,
          rootKey,
          placeholderKey,
          declarationPath,
          placeholderValue,
        ),
      );
    }
  }

  /** @type {Alternative[]} */
  const alternatives = [];

  if (has(value, "alternatives")) {
    const alternativesValue = value["alternatives"];

    if (!Array.isArray(alternativesValue))
      throw session.error(`alternatives must be an array. Key is '${key}'`);

    if (alternativesValue.length === 0)
      throw session.error(`alternatives must contain at least one expression. Key is '${key}'`);

    for (const element of alternativesValue) {
      session.budget.add(1);

      if (element === null || element === undefined)
        throw session.error(`alternative values cannot be null. Key is '${key}'`);

      if (!isObject(element))
        throw session.error(`alternative value must be an object. Key is '${key}'`);

      const members = Object.keys(element);

      if (members.length === 0)
        throw session.error(
          `alternative objects must contain at least one expression. Key is '${key}'`,
        );

      if (members.length > 1)
        throw session.error(
          "each alternative object must contain exactly one expression so array order defines " +
            `first-match precedence. Key is '${key}'`,
        );

      const expression = /** @type {string} */ (members[0]);

      session.checkExpression(
        expression,
        (reason) =>
          `unable to parse whole-message alternative expression '${expression}' for root key ` +
          `'${rootKey}': ${reason}`,
      );

      alternatives.push({
        expression,
        definition: parseNode(
          session,
          rootKey,
          expression,
          boundedJsonPath(declarationPath, " -> alternative[", expression, "]"),
          element[expression],
          alternativeDepth + 1,
        ),
      });
    }
  }

  if (translation === null && alternatives.length === 0)
    throw session.error(
      `either a translation or at least one alternative expression is required for key '${key}'`,
    );

  if (translation !== null)
    validatePlaceholderReferences(
      session,
      rootKey,
      translation,
      descriptionAtDeclarationPath("translation", rootKey, declarationPath),
    );

  return { translation, commentary, placeholders, alternatives };
}

/**
 * `LocalizedStringLoader.parseLocalizedStrings`'s member loop — the ONE place a catalog's root
 * members become definitions, shared by the decoded-object and raw-source entry points.
 *
 * The interleaving here is Java's and it is observable. For each root member IN DOCUMENT ORDER:
 * the root key's own uniqueness is checked, then every duplicate member anywhere BELOW that key,
 * then the member is structurally parsed, then `onRootParsed` runs for it. So a structural error
 * under an earlier key beats a duplicate under a later one, a duplicate under a key beats that key's
 * own structural error, and a warning raised by an earlier key is DELIVERED before a later key's
 * failure is raised — which is why the warning budget can be what a file fails on even though a
 * later key is also malformed.
 *
 * @param {ParseSession} session
 * @param {[string, unknown][]} members root members in order, duplicates included
 * @param {import("./json-parse.js").DuplicateMember[]} duplicates in document order
 * @param {((key: string, definition: Definition) => void) | null} [onRootParsed]
 *   `warnOnIncompleteLanguageFormTranslations`'s slot in Java's member loop
 * @returns {Map<string, Definition>}
 */
function parseCatalogMembers(session, members, duplicates, onRootParsed) {
  session.budget.add(members.length);

  /** @type {Map<string, Definition>} */
  const definitions = new Map();
  // At most one finding arrives, and one is all this loop could ever use: any later duplicate lies
  // under a member the loop never reaches, because it stops at the first failure. `json-parse.js`
  // relies on that to keep duplicate detection O(1) in retained state rather than O(duplicates).
  const duplicate = duplicates[0];

  for (let index = 0; index < members.length; index++) {
    const [key, value] = /** @type {[string, unknown]} */ (members[index]);

    if (definitions.has(key))
      throw session.error(`duplicate localized string key '${key}' encountered`);

    if (duplicate && duplicate.rootIndex === index)
      // The bounded path is attached as a STRUCTURED FIELD as well as interpolated into the message,
      // because `lokalized/parse` publishes `StringsParseError.path` (plan 3.4) and a consumer
      // should not have to re-parse English to learn where the duplicate was.
      throw Object.assign(
        session.error(
          `duplicate JSON object member '${boundedDiagnosticValue(duplicate.name)}' encountered at ` +
            `${duplicate.path}`,
        ),
        { path: duplicate.path },
      );

    const definition = parseNode(session, key, key, key, value, 0);

    definitions.set(key, definition);
    if (onRootParsed) onRootParsed(key, definition);
  }

  return definitions;
}

/**
 * Bounded parse of one already-decoded catalog object into the internal model.
 *
 * A decoded object cannot carry duplicates, byte length, or source locations — plan 4.1: it is not
 * a raw strings-file input. `parseCatalogSource` is the entry point that owns those guarantees.
 *
 * The load's `session` is threaded through when there is one, and that is not an optimisation. Plan
 * 3.2 requires the model/file/node/warning limits to apply "across all raw and already-parsed
 * catalogs": a session created here instead would give every decoded catalog its own private budget,
 * so a construction whose catalogs jointly blow the node limit would be accepted, and a caller's
 * `loadingLimits` would silently govern only the catalogs that happened to arrive as text.
 *
 * @param {unknown} raw the decoded catalog object: key -> string or entry object
 * @param {ParseSourceContext} [context]
 * @returns {Map<string, Definition>}
 */
export function parseCatalog(raw, context) {
  const source = context?.source ?? "catalog";
  const session = context?.session ?? new LoadingSession(context?.limits);

  session.beginFile(source);

  if (!isObject(raw))
    throw new Error(`${source}: a localized strings file must be comprised of a single JSON object`);

  validateNestingDepth(raw, session.limits.maximumJsonNestingDepth, source);

  const keys = Object.keys(raw);

  return parseCatalogMembers(
    new ParseSession(source, new NodeBudget(session, source), context?.validateExpression),
    keys.map((key) => /** @type {[string, unknown]} */ ([key, raw[key]])),
    [],
    context?.onRootParsed,
  );
}

/**
 * Bounded parse of one RAW localized strings resource — bytes or text — into the internal model.
 *
 * `LocalizedStringLoader.parse(InputStream|Reader, ...)`, in Java's order, because the order decides
 * which limit a hostile resource trips:
 *
 *   1. the loading options are validated before anything is read;
 *   2. the file-count budget admits the resource;
 *   3. byte input is bounded per-resource AND against the load's aggregate while it is counted,
 *      before any string exists; text input is bounded by character count the same way;
 *   4. bytes are decoded as FATAL UTF-8 — malformed, truncated and overlong sequences fail here
 *      rather than becoming U+FFFD;
 *   5. at most one leading BOM is removed, and only then is the resource tested for blankness;
 *   6. JSON nesting depth is counted over the raw characters, before the document is parsed;
 *   7. the document is parsed by the bounded reader, which rejects lone surrogates and records
 *      duplicate members with their JSON paths;
 *   8. the root must be an object, and its member count is charged to the node budget;
 *   9. only now is the catalog model materialized, member by member — and per member, in Java's
 *      order: duplicates, structure and expressions together, then `onRootParsed`.
 *
 * @param {Uint8Array | string} input
 * @param {ParseSourceContext} [context]
 * @returns {Map<string, Definition>}
 */
export function parseCatalogSource(input, context) {
  const source = context?.source ?? "<input>";
  const session = context?.session ?? new LoadingSession(context?.limits);

  session.beginFile(source);

  const decoded =
    typeof input === "string"
      ? readCharacters(input, source, session.limits.maximumReaderCharacters)
      : readStrictUtf8(
          input,
          source,
          session.limits.maximumInputBytes,
          (count, forSource) => session.addInputBytes(count, forSource),
        );

  const text = normalizeCatalogText(decoded, source);

  validateTextNestingDepth(text, source, session.limits.maximumJsonNestingDepth);

  const { members, duplicates } = parseJsonDocument(text, source);

  if (members === null)
    throw new Error(`${source}: a localized strings file must be comprised of a single JSON object`);

  return parseCatalogMembers(
    new ParseSession(source, new NodeBudget(session, source), context?.validateExpression),
    members,
    duplicates,
    context?.onRootParsed,
  );
}

// -------------------------------------------------------------------------------------------------
// Programmatic construction — plan sections 3.2 and 3.6.
//
// The fourth `CatalogInput` form is `readonly LocalizedStringInput[]`: an application's own data,
// never a file. `LocalizedStringValidator` (the Java class of the same job) exists because Java
// accepts programmatically built `LocalizedString` graphs too, and its contract is that "programmatically
// constructed and file-backed localized strings fail at construction time in the same places".
//
// So this does NOT re-implement validation. It walks the input graph and hands each LEAF — a
// translation template, a placeholder definition, an alternative's expression — to the very functions
// the file path uses, so one authoring mistake produces one diagnostic no matter which door it came
// through. What it owns alone is the part a file cannot express: a JSON document is a tree, while an
// input graph is an arbitrary object graph that can share subtrees and can point at itself.
// -------------------------------------------------------------------------------------------------

/**
 * @typedef {object} LocalizedStringNodeInput
 * @property {string} [translation]
 * @property {string} [commentary]
 * @property {unknown} [placeholders]
 * @property {unknown} [alternatives]
 */

/**
 * @typedef {ParseContext & { session?: LoadingSession }} ModelParseContext
 */

/** The members a programmatic node may carry, mirroring the strings-file object's members. */
const MODEL_NODE_MEMBERS = ["translation", "commentary", "placeholders", "alternatives"];

/**
 * One programmatic placeholder definition, rewritten into the shape the file parser validates.
 *
 * The two shapes differ only in framing: the input form carries an explicit `kind` discriminator
 * because a JavaScript object literal has no schema to disambiguate it, while the file form infers
 * the mode from which members are present. Everything past this function is shared, which is the
 * point — `parsePlaceholderDefinition` owns mixed axes, reserved names, range-is-cardinality-only,
 * template references and fragment-expression compilation, and it must own them for both doors.
 *
 * Rewritten onto NULL-PROTOTYPE objects (plan 4.3): a language-form name, an expression, or a
 * placeholder name is caller data, and `{ [expression]: translation }` on an ordinary object literal
 * would let `__proto__` reach an inherited setter instead of landing as an own member.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} key the node's own key: the root key, or this alternative's expression
 * @param {string} placeholderKey
 * @param {unknown} input
 * @returns {Record<string, unknown>}
 */
function modelPlaceholderShape(session, rootKey, key, placeholderKey, input) {
  // The NODE key, not the root key, exactly as `parseNode` reports it. Inside a whole-message
  // alternative the two differ — the node key is the alternative's expression — and this function's
  // whole premise is that one authoring mistake reads the same through either door.
  if (!isObject(input))
    throw session.error(`the placeholder value must be an object. Key is '${key}'`);

  const kind = input["kind"];

  if (kind !== "language-form" && kind !== "expression")
    throw session.error(
      `placeholder '${placeholderKey}' for root key '${rootKey}' must declare kind ` +
        `'language-form' or 'expression'; received ${JSON.stringify(kind) ?? String(kind)}`,
    );

  validateNoUnexpectedObjectMembers(
    session,
    rootKey,
    input,
    `placeholder '${placeholderKey}'`,
    kind === "language-form"
      ? ["kind", "value", "range", "translations"]
      : ["kind", "translation", "alternatives"],
  );

  /** @type {Record<string, unknown>} */
  const shape = Object.create(null);

  if (kind === "language-form") {
    // `has`, not `!== undefined`: an explicitly present `value: undefined` is a different authoring
    // mistake from an absent one, and only the file parser's own diagnostics should name it.
    if (has(input, "value")) shape["value"] = input["value"];
    if (has(input, "range")) {
      const range = input["range"];
      shape["range"] = isObject(range) ? { ...range } : range;
    }

    if (!has(input, "translations"))
      throw session.error(`placeholder translations are required. Key is '${rootKey}'`);

    const translations = input["translations"];

    if (!isObject(translations))
      throw session.error(
        `the placeholder translations value must be an object. Key is '${rootKey}'`,
      );

    /** @type {Record<string, unknown>} */
    const copied = Object.create(null);
    for (const form of Object.keys(translations)) copied[form] = translations[form];
    shape["translations"] = copied;

    return shape;
  }

  if (has(input, "translation")) shape["translation"] = input["translation"];

  if (has(input, "alternatives")) {
    const alternatives = input["alternatives"];

    if (!Array.isArray(alternatives))
      throw session.error(
        `fragment alternatives must be an array for placeholder '${placeholderKey}' in root key ` +
          `'${rootKey}'`,
      );

    shape["alternatives"] = alternatives.map((alternative, index) => {
      if (!isObject(alternative))
        throw session.error(
          `fragment alternative ${index} must be an object for placeholder '${placeholderKey}' in ` +
            `root key '${rootKey}'`,
        );

      validateNoUnexpectedObjectMembers(
        session,
        rootKey,
        alternative,
        `fragment alternative ${index} for placeholder '${placeholderKey}'`,
        ["expression", "translation"],
      );

      const expression = alternative["expression"];

      if (typeof expression !== "string")
        throw session.error(
          `fragment alternative ${index} must carry a string expression for placeholder ` +
            `'${placeholderKey}' in root key '${rootKey}'`,
        );

      /** @type {Record<string, unknown>} */
      const pair = Object.create(null);
      pair[expression] = alternative["translation"];
      return pair;
    });
  }

  return shape;
}

/**
 * One programmatic node — a root string, or a whole-message alternative — as a `Definition`.
 *
 * The DAG discipline here is Java's `LocalizedStringValidator.validate`, and each half of it exists
 * for a failure the other cannot catch:
 *
 *   - `active` is the set on the current path, so a node that reaches itself is a cycle. Without it
 *     this recursion does not terminate, and the depth ceiling would report a bogus "too deep".
 *   - `validatedDepth` memoizes the DEEPEST placement at which a node has already been proved to
 *     fit. A shared subtree reached again at the same depth or shallower is proved; reached DEEPER
 *     it is revalidated, because the depth ceiling is measured from the root and a subtree that fit
 *     at depth 3 may not fit at depth 126. Caching "seen" without the depth would miss that; not
 *     caching at all makes a shared diamond exponential.
 *
 * The memo also returns the SAME `Definition` object for a shared input node, so the model is a DAG
 * wherever the input was one rather than an expansion of it. Callers that walk definitions must
 * therefore guard their own recursion by node identity.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} key the root key, or this alternative's expression
 * @param {string} declarationPath
 * @param {unknown} input
 * @param {number} depth
 * @param {Map<object, number>} validatedDepth
 * @param {Set<object>} active
 * @param {Map<object, Definition>} built
 * @returns {Definition}
 */
function definitionFromInput(session, rootKey, key, declarationPath, input, depth, validatedDepth, active, built) {
  if (depth > MAXIMUM_ALTERNATIVE_DEPTH)
    throw session.error(
      `alternative nesting exceeds the maximum depth of ${MAXIMUM_ALTERNATIVE_DEPTH} for key ` +
        `'${rootKey}'`,
    );

  if (!isObject(input))
    throw session.error(
      `either a translation string or object value is required for key '${key}'`,
    );

  const node = /** @type {object} */ (input);

  if (active.has(node))
    throw session.error(`alternative graph contains an identity cycle for key '${rootKey}'`);

  const proved = validatedDepth.get(node);
  const cached = built.get(node);
  if (proved !== undefined && cached !== undefined && proved >= depth) return cached;

  active.add(node);

  try {
    const definition = buildDefinitionFromInput(
      session, rootKey, key, declarationPath, input, depth, validatedDepth, active, built);

    validatedDepth.set(node, depth);
    built.set(node, definition);
    return definition;
  } finally {
    active.delete(node);
  }
}

/**
 * The body of `definitionFromInput`, split out so the cycle bookkeeping above stays readable.
 *
 * Member ORDER matches `parseNode`: unexpected members, translation, commentary, placeholders,
 * alternatives, then the "translation or alternative required" rule and the translation's own
 * placeholder references last. A catalog with two mistakes must name the same one either way it was
 * supplied.
 *
 * @param {ParseSession} session
 * @param {string} rootKey
 * @param {string} key
 * @param {string} declarationPath
 * @param {Record<string, unknown>} input
 * @param {number} depth
 * @param {Map<object, number>} validatedDepth
 * @param {Set<object>} active
 * @param {Map<object, Definition>} built
 * @returns {Definition}
 */
function buildDefinitionFromInput(session, rootKey, key, declarationPath, input, depth, validatedDepth, active, built) {
  // `key` and `expression` are the node's own identity, carried on the record rather than in a
  // wrapper, so they are expected members here where the file form has no equivalent.
  validateNoUnexpectedObjectMembers(session, key, input, "localized string", [
    ...MODEL_NODE_MEMBERS,
    depth === 0 ? "key" : "expression",
  ]);

  // An explicitly `undefined` member counts as ABSENT here, where the file door has no such case to
  // consider: JSON cannot express `undefined`, but `{ translation: maybe }` and an optional-property
  // spread are ordinary JavaScript, and rejecting them would make the shape harder to build from
  // real data than from a literal. `null` is still an error, because it is a value the author wrote.
  /** @type {string | null} */
  let translation = null;

  if (has(input, "translation") && input["translation"] !== undefined) {
    if (typeof input["translation"] !== "string")
      throw session.error(`translation must be a string for key '${key}'`);

    translation = input["translation"];
  }

  /** @type {string | null} */
  let commentary = null;

  if (has(input, "commentary") && input["commentary"] !== undefined) {
    if (typeof input["commentary"] !== "string")
      throw session.error(`commentary must be a string for key '${key}'`);

    commentary = input["commentary"];
  }

  /** @type {Map<string, PlaceholderDefinition>} */
  const placeholders = new Map();

  if (has(input, "placeholders") && input["placeholders"] !== undefined) {
    const supplied = input["placeholders"];
    // A `Map` is the shape plan 4.3 recommends whenever placeholder names come from a generated or
    // untrusted source, so it is accepted here rather than only tolerated at lookup time.
    const entries =
      supplied instanceof Map
        ? [...supplied.entries()]
        : isObject(supplied)
          ? Object.keys(supplied).map((name) => /** @type {[string, unknown]} */ ([name, supplied[name]]))
          : null;

    if (entries === null)
      throw session.error(`the placeholders value must be an object. Key is '${key}'`);

    for (const [placeholderKey, value] of entries) {
      session.budget.add(1);

      if (typeof placeholderKey !== "string")
        throw session.error(`placeholder names must be strings. Key is '${key}'`);

      ensureValidPlaceholderName(session, key, placeholderKey, "placeholder");

      if (placeholders.has(placeholderKey))
        throw session.error(
          `duplicate placeholder '${placeholderKey}' encountered for key '${key}'`,
        );

      placeholders.set(
        placeholderKey,
        parsePlaceholderDefinition(
          session,
          rootKey,
          placeholderKey,
          declarationPath,
          modelPlaceholderShape(session, rootKey, key, placeholderKey, value),
        ),
      );
    }
  }

  /** @type {Alternative[]} */
  const alternatives = [];

  if (has(input, "alternatives") && input["alternatives"] !== undefined) {
    const supplied = input["alternatives"];

    if (!Array.isArray(supplied))
      throw session.error(`alternatives must be an array. Key is '${key}'`);

    if (supplied.length === 0)
      throw session.error(`alternatives must contain at least one expression. Key is '${key}'`);

    for (const element of supplied) {
      session.budget.add(1);

      if (element === null || element === undefined)
        throw session.error(`alternative values cannot be null. Key is '${key}'`);

      if (!isObject(element))
        throw session.error(`alternative value must be an object. Key is '${key}'`);

      const expression = element["expression"];

      if (typeof expression !== "string")
        throw session.error(
          `each alternative must carry its predicate as a string 'expression'. Key is '${key}'`,
        );

      session.checkExpression(
        expression,
        (reason) =>
          `unable to parse whole-message alternative expression '${expression}' for root key ` +
          `'${rootKey}': ${reason}`,
      );

      alternatives.push({
        expression,
        definition: definitionFromInput(
          session,
          rootKey,
          expression,
          boundedJsonPath(declarationPath, " -> alternative[", expression, "]"),
          element,
          depth + 1,
          validatedDepth,
          active,
          built,
        ),
      });
    }
  }

  if (translation === null && alternatives.length === 0)
    throw session.error(
      `either a translation or at least one alternative expression is required for key '${key}'`,
    );

  if (translation !== null)
    validatePlaceholderReferences(
      session,
      rootKey,
      translation,
      descriptionAtDeclarationPath("translation", rootKey, declarationPath),
    );

  return { translation, commentary, placeholders, alternatives };
}

/**
 * Validate a programmatic catalog — `readonly LocalizedStringInput[]` — into the internal model.
 *
 * Charged to the same `LoadingSession` as every other catalog form. Plan 4.1 is explicit that
 * programmatic values "receive model/schema validation and node limits, not source-level
 * guarantees": there is no text to bound and no duplicate JSON member to find, but the translation
 * NODE budget is a model limit and applies here exactly as it does to a parsed file.
 *
 * @param {readonly unknown[]} inputs
 * @param {ModelParseContext} [context]
 * @returns {Map<string, Definition>}
 */
export function parseModelCatalog(inputs, context) {
  const source = context?.source ?? "catalog";
  const session = context?.session ?? new LoadingSession(context?.limits);

  session.beginFile(source);

  if (!Array.isArray(inputs))
    throw new Error(`${source}: a programmatic localized strings catalog must be an array`);

  const parseSession = new ParseSession(
    source,
    new NodeBudget(session, source),
    context?.validateExpression,
  );

  parseSession.budget.add(inputs.length);

  /** @type {Map<string, Definition>} */
  const definitions = new Map();
  // Shared across the WHOLE catalog, not per root key: two root keys may legitimately share one
  // alternative subtree, and re-proving it for the second key is the exponential case this memo
  // exists to avoid. `active` is per key because a path is per key.
  /** @type {Map<object, number>} */
  const validatedDepth = new Map();
  /** @type {Map<object, Definition>} */
  const built = new Map();

  for (const input of inputs) {
    if (!isObject(input))
      throw parseSession.error("each programmatic localized string must be an object");

    const key = input["key"];

    if (typeof key !== "string")
      throw parseSession.error("each programmatic localized string must carry a string 'key'");

    if (definitions.has(key))
      throw parseSession.error(`duplicate localized string key '${key}' encountered`);

    const definition = definitionFromInput(
      parseSession, key, key, key, input, 0, validatedDepth, new Set(), built);

    definitions.set(key, definition);
    if (context?.onRootParsed) context.onRootParsed(key, definition);
  }

  return definitions;
}
