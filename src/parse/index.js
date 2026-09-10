// @ts-check

/**
 * `lokalized/parse` — the public face of the bounded, duplicate-aware strings-file parser.
 *
 * Port of `LocalizedStringLoader.parse(InputStream|Reader, Locale, String source, warningHandler,
 * loadingOptions)`: one resource in, one validated `ParsedStringsFile` out, with every failure
 * carrying the caller-supplied source label and, when the failure is lexical, a one-based line and
 * column.
 *
 * The bounded reader, the byte/character/BOM/blank handling, the nesting prepass, the duplicate
 * rejection and the structural model all live in `src/internal/` and are shared with `createStrings`
 * — this module is the ENTRY POINT and the DIAGNOSTIC SURFACE over them. What it adds on its own is
 * the part of Java's loader `createStrings` has no use for:
 *
 *   - every internal failure re-raised as the declared `StringsParseError`;
 *   - EAGER expression compilation, and the incomplete-language-form warnings, both handed to the
 *     structural walk as hooks so they run where Java runs them rather than in a pass afterwards —
 *     see `parseCatalogMembers`, which owns the interleaving;
 *   - the frozen, null-prototype `ParsedStringsFile` projection of the internal model.
 */

import { LoadingSession, parseCatalogSource, parseModelCatalog } from "../internal/catalog.js";
import {
  DEFAULT_SOURCE,
  parseStringsWithSession,
  projectNode,
  validateExpressionAtLoad,
} from "../internal/parse-file.js";
import { EXPRESSION_LIMIT_CEILINGS, compile as compileExpression } from "../internal/expression.js";

/**
 * Load-time expression validation, against the HARD CEILINGS rather than the runtime defaults.
 *
 * Java's loaders build their evaluator with `TranslationRuntimeLimits.hardCeilings()` —
 * `LocalizedStringLoader.java:115` and `LocalizedStringValidator.java:50` — deliberately, because at
 * load time an application's runtime policy is not yet available: the catalog is being parsed, and
 * whatever limits the eventual `Strings` instance will carry are not known. Validating against the
 * DEFAULTS instead makes the parser strictly stricter than Java, so a catalog Java accepts is
 * refused. `compile()` falls back to the defaults when handed no limits, which is right for runtime
 * and wrong here, so the ceilings are passed explicitly.
 *
 * @param {string} expression
 */
import { normalizeTag } from "../internal/locale.js";
import { StringsParseError, rethrowAsParseError } from "../internal/parse-diagnostics.js";
import { incompleteLanguageFormReporter } from "../internal/parse-warnings.js";
import { PLURAL_DATA_RUNTIME } from "../internal/plural.js";

export { StringsParseError };

const freeze = Object.freeze;

/** The default source label, per plan section 4.1. */

/** @typedef {import("../internal/catalog.js").Definition} Definition */
/** @typedef {import("../internal/catalog.js").ParseLimits} StringsLoadingLimits */
/** @typedef {import("../internal/parse-warnings.js").LocalizedStringWarning} LocalizedStringWarning */

/**
 * @typedef {object} ParseStringsOptions
 * @property {string} locale the locale this resource represents
 * @property {string} [source] the label every diagnostic and warning reports; defaults to `<input>`
 * @property {StringsLoadingLimits} [limits]
 * @property {(warning: LocalizedStringWarning) => void} [onWarning]
 * @property {{ ordinal?: unknown, ranges?: unknown }} [pluralData] the OPTIONAL plural modules'
 *   exported data objects. Only `ordinal` is consulted, and only to report ordinality gaps: this
 *   module is in the ratcheted root graph and cannot import `lokalized/data/ordinal` for itself.
 */

/**
 * @typedef {object} ParsedStringsFile
 * @property {"parsed-strings-file"} $lokalized
 * @property {string} locale
 * @property {readonly string[]} sources
 * @property {readonly LocalizedStringInput[]} strings
 * @property {Readonly<Record<string, readonly string[]>>} originsByKey
 * @property {readonly LocalizedStringWarning[]} warnings
 */

/**
 * @typedef {object} LocalizedStringInput
 * @property {string} key
 * @property {string} [translation]
 * @property {string} [commentary]
 * @property {Readonly<Record<string, PlaceholderDefinitionInput>>} [placeholders]
 * @property {readonly WholeMessageAlternativeInput[]} [alternatives]
 */

/**
 * @typedef {object} WholeMessageAlternativeInput
 * @property {string} expression
 * @property {string} [translation]
 * @property {string} [commentary]
 * @property {Readonly<Record<string, PlaceholderDefinitionInput>>} [placeholders]
 * @property {readonly WholeMessageAlternativeInput[]} [alternatives]
 */

/**
 * @typedef {{ kind: "language-form", value?: string, range?: Readonly<{ start: string, end: string }>,
 *   translations: Readonly<Record<string, string>> }
 *   | { kind: "expression", translation: string,
 *       alternatives?: readonly Readonly<{ expression: string, translation: string }>[] }
 * } PlaceholderDefinitionInput
 */


/**
 * Parse one localized strings resource.
 *
 * @param {string | Uint8Array} input raw resource text, or its bytes
 * @param {ParseStringsOptions} options
 * @returns {ParsedStringsFile}
 * @throws {RangeError} if a limit is outside its permitted band — thrown before the input is read,
 *   exactly as `LocalizedStringLoadingOptions.Builder` rejects it before a loader ever runs
 * @throws {StringsParseError} if the resource cannot be read, decoded, parsed, or validated
 */
export function parseStrings(input, options) {
  // A FRESH session per call: this door parses exactly one resource, so every aggregate budget is
  // that resource's alone. `lokalized/node`'s directory loader threads ONE session across a whole
  // directory instead, which is what the shared body exists for.
  return parseStringsWithSession(input, options, new LoadingSession(options.limits));
}

/**
 * The source label a programmatic definition reports in its diagnostics.
 *
 * Not a file name and not `<input>`: these values never came from a resource, and pointing an author
 * at a nonexistent file is the diagnostic mistake this label exists to avoid.
 */
const DEFINE_SOURCE = "<defined>";

/**
 * Validate, defensively copy, and freeze one programmatic localized string — plan section 3.6.
 *
 * The validation is not a second implementation of the file rules; it IS the file rules. The input
 * is run through the shared model walk, and the frozen result is projected back out of the internal
 * model, so a defined value and the same string parsed from a strings file are structurally
 * identical — and an authoring mistake produces one diagnostic rather than two dialects of one.
 *
 * Three properties follow from taking the round trip rather than copying the argument:
 *
 *   - every expression is COMPILED here, so a malformed predicate fails at the definition site
 *     instead of at whichever `createStrings` later consumed it;
 *   - the returned graph shares nothing with the caller's object, so mutating the argument
 *     afterwards cannot change what was defined;
 *   - every keyed record in it is a frozen null-prototype object, so `__proto__` in a placeholder or
 *     translation map is an ordinary member.
 *
 * @param {unknown} input
 * @returns {Readonly<LocalizedStringInput>}
 * @throws {StringsParseError} if the value is not a valid localized string
 */
export function defineLocalizedString(input) {
  // One input in, exactly one out: `parseModelCatalog` rejects a non-object and a missing key, so
  // this cannot be empty by the time it returns.
  return /** @type {Readonly<LocalizedStringInput>} */ (defineCatalog([input])[0]);
}

/**
 * Validate, defensively copy, and freeze a programmatic catalog — plan section 3.6.
 *
 * Validated as ONE catalog rather than as N independent strings, which is the difference that
 * matters: duplicate keys are rejected, and a subtree shared between two root keys is proved once.
 *
 * @param {readonly unknown[]} inputs
 * @returns {readonly Readonly<LocalizedStringInput>[]}
 * @throws {StringsParseError} if any value is not a valid localized string
 */
export function defineCatalog(inputs) {
  /** @type {Map<string, Definition>} */
  let definitions;

  try {
    definitions = parseModelCatalog(inputs, {
      source: DEFINE_SOURCE,
      validateExpression: validateExpressionAtLoad,
    });
  } catch (error) {
    rethrowAsParseError(error, DEFINE_SOURCE);
  }

  // One memo for the whole catalog, so a subtree shared across root keys is projected once. Without
  // it a legal shared diamond validates in linear time and then expands exponentially right here.
  /** @type {Map<Definition, Omit<WholeMessageAlternativeInput, "expression">>} */
  const memo = new Map();

  return freeze(
    [...definitions].map(([key, definition]) => freeze({ key, ...projectNode(definition, memo) })),
  );
}

