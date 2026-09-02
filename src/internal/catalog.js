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
 * Out of M2 scope, by instruction: duplicate JSON member rejection and line/column diagnostics
 * (`lokalized/parse`, M5a), and expression syntax validation for `alternatives` (M6). Alternatives
 * are parsed into the model and left unevaluated.
 */

import { isValidIdentifier, placeholderNamesIn } from "./interpolate.js";

/** `LocalizedStringLoadingOptions.DEFAULT_MAXIMUM_JSON_NESTING_DEPTH`. */
const DEFAULT_MAXIMUM_JSON_NESTING_DEPTH = 64;
/** `LocalizedStringLoadingOptions.DEFAULT_MAXIMUM_TRANSLATION_NODES`. */
const DEFAULT_MAXIMUM_TRANSLATION_NODES = 100_000;
/** `LocalizedStringLoadingOptions.MAXIMUM_JSON_NESTING_DEPTH` — the ceiling on the option itself. */
const MAXIMUM_JSON_NESTING_DEPTH = 128;
/** `LocalizedStringValidator.MAXIMUM_ALTERNATIVE_DEPTH`. */
const MAXIMUM_ALTERNATIVE_DEPTH = 128;
/** `LocalizedStringLoader.MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS`. */
const MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS = 4096;

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
 * @property {number} [maximumJsonNestingDepth]
 * @property {number} [maximumTranslationNodes]
 */

/**
 * @typedef {object} ParseContext
 * @property {string} [locale] the locale this catalog is being parsed for
 * @property {string} [source] identifies the catalog in diagnostics
 * @property {ParseLimits} [limits]
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
 * `LocalizedStringLoader.appendBoundedPathPart`.
 *
 * @param {string} path
 * @param {string} part
 * @returns {string}
 */
function appendBoundedPathPart(path, part) {
  const remaining = MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS - path.length;

  if (remaining <= 0) return path;
  if (part.length <= remaining) return path + part;

  return `${path}${remaining > 1 ? part.slice(0, remaining - 1) : ""}…`;
}

/**
 * `LocalizedStringLoader.boundedJsonPath` — the declaration path of a nested alternative, capped at
 * 4096 UTF-16 units with a trailing ellipsis, exactly as Java caps it.
 *
 * @param {string} parentPath
 * @param {string} prefix
 * @param {string} component
 * @param {string} suffix
 * @returns {string}
 */
function boundedJsonPath(parentPath, prefix, component, suffix) {
  if (parentPath.length >= MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS) return parentPath;

  let path = appendBoundedPathPart("", parentPath);
  path = appendBoundedPathPart(path, prefix);
  path = appendBoundedPathPart(path, component);
  return appendBoundedPathPart(path, suffix);
}

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

/** Tracks the translation-node budget across one catalog. */
class NodeBudget {
  /**
   * @param {number} maximum
   * @param {string} source
   */
  constructor(maximum, source) {
    if (!Number.isInteger(maximum) || maximum < 0)
      throw new Error("maximumTranslationNodes must be nonnegative");

    this.maximum = maximum;
    this.source = source;
    this.used = 0;
  }

  /** @param {number} count */
  add(count) {
    if (this.used > this.maximum - count)
      throw new Error(
        `${this.source}: localized strings load exceeds the aggregate maximum of ` +
          `${this.maximum} translation nodes`,
      );

    this.used += count;
  }
}

/** Everything one parse needs to report and bound itself. */
class ParseSession {
  /**
   * @param {string} source
   * @param {NodeBudget} budget
   */
  constructor(source, budget) {
    this.source = source;
    this.budget = budget;
  }

  /**
   * @param {string} message
   * @returns {Error}
   */
  error(message) {
    return new Error(`${this.source}: ${message}`);
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
 * Bounded parse of one raw catalog object into the internal model.
 *
 * @param {unknown} raw the decoded catalog object: key -> string or entry object
 * @param {ParseContext} [context]
 * @returns {Map<string, Definition>}
 */
export function parseCatalog(raw, context) {
  const source = context?.source ?? "catalog";
  const limits = context?.limits ?? {};
  const maximumJsonNestingDepth =
    limits.maximumJsonNestingDepth ?? DEFAULT_MAXIMUM_JSON_NESTING_DEPTH;
  const maximumTranslationNodes =
    limits.maximumTranslationNodes ?? DEFAULT_MAXIMUM_TRANSLATION_NODES;

  if (
    !Number.isInteger(maximumJsonNestingDepth) ||
    maximumJsonNestingDepth <= 0 ||
    maximumJsonNestingDepth > MAXIMUM_JSON_NESTING_DEPTH
  )
    throw new Error(`maximumJsonNestingDepth must be between 1 and ${MAXIMUM_JSON_NESTING_DEPTH}`);

  if (!isObject(raw))
    throw new Error(`${source}: a localized strings file must be comprised of a single JSON object`);

  validateNestingDepth(raw, maximumJsonNestingDepth, source);

  const session = new ParseSession(source, new NodeBudget(maximumTranslationNodes, source));
  const keys = Object.keys(raw);
  session.budget.add(keys.length);

  /** @type {Map<string, Definition>} */
  const definitions = new Map();

  for (const key of keys) definitions.set(key, parseNode(session, key, key, key, raw[key], 0));

  return definitions;
}
