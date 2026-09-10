// @ts-check
/**
 * The shared body of `parseStrings`, with the load session INJECTED rather than created.
 *
 * EXTRACTED FOR M8, and the reason is a semantic one rather than tidiness. Java threads ONE
 * `LoadingSession` through an entire directory load (`LocalizedStringLoader.java:1081`), so the four
 * AGGREGATE budgets — total input bytes, localized-strings files, translation nodes and warnings —
 * accumulate ACROSS the files of a directory. `parseStrings` constructs its own session per call,
 * which is exactly right for the single-resource door and exactly wrong for the directory door.
 *
 * **THE CORPUS CANNOT TELL THE TWO APART, AND THAT IS WHY THIS IS WRITTEN OUT RATHER THAN ASSUMED.**
 * Measured: no `load` case combines multiple warnings with multiple files, and every
 * `maximumTotalInputBytes` and `maximumTranslationNodes` fixture is single-file — so a port using a
 * FRESH session per file scores identically on all 145. Shipping the per-file version would have been
 * invisible to conformance and wrong against the oracle, which is this project's "the corpus is a
 * floor, not a proof" lesson in its most literal form. `test/directory-session.test.js` is the
 * enforcement, not the corpus.
 *
 * Nothing about the single-resource behaviour changes: `parseStrings` now passes a fresh session and
 * is otherwise byte-for-byte the function it was.
 */
import { parseCatalogSource } from "./catalog.js";
import { EXPRESSION_LIMIT_CEILINGS, compile as compileExpression } from "./expression.js";
import { normalizeTag } from "./locale.js";
import { rethrowAsParseError } from "./parse-diagnostics.js";
import { incompleteLanguageFormReporter } from "./parse-warnings.js";
import { PLURAL_DATA_RUNTIME } from "./plural.js";

/** @typedef {import("./catalog.js").Definition} Definition */
/** @typedef {import("./catalog.js").LoadingSession} LoadingSession */
/** @typedef {import("./parse-warnings.js").LocalizedStringWarning} LocalizedStringWarning */
// The public shapes are declared by the subpath that owns them. Importing them BACK is a type-level
// cycle only: nothing here imports `../parse/index.js` at runtime, so no module cycle is created.
/** @typedef {import("../parse/index.js").ParseStringsOptions} ParseStringsOptions */
/** @typedef {import("../parse/index.js").ParsedStringsFile} ParsedStringsFile */
/** @typedef {import("../parse/index.js").LocalizedStringInput} LocalizedStringInput */
/** @typedef {import("../parse/index.js").WholeMessageAlternativeInput} WholeMessageAlternativeInput */
/** @typedef {import("../parse/index.js").PlaceholderDefinitionInput} PlaceholderDefinitionInput */

const freeze = Object.freeze;

/** The source label a resource reports when the caller named none. */
export const DEFAULT_SOURCE = "<input>";

/** Expressions are compiled at load with the ceilings the loader enforces. */
/** @param {string} expression */
export const validateExpressionAtLoad = (expression) =>
  compileExpression(expression, { limits: EXPRESSION_LIMIT_CEILINGS });

/**
 * The internal model, projected onto the public `LocalizedStringInput` shape.
 *
 * Every keyed record is a FROZEN NULL-PROTOTYPE object, per plan section 4.3: the property names
 * come from the catalog, so `__proto__` must land as an ordinary own property rather than reaching
 * an inherited setter, and a caller must not be able to mutate a parsed file into a different one.
 *
 * MEMOIZED by node identity. A parsed file is a tree and never hits the memo; a programmatically
 * supplied graph may share one subtree between two alternatives, and `parseModelCatalog` preserves
 * that sharing rather than expanding it. Projecting a shared diamond without the memo is
 * exponential in its depth — the input passes validation and then the projection hangs.
 *
 * @param {Definition} node
 * @param {Map<Definition, Omit<WholeMessageAlternativeInput, "expression">>} [memo]
 * @returns {Omit<WholeMessageAlternativeInput, "expression">}
 */
export function projectNode(node, memo = new Map()) {
  const projected = memo.get(node);
  if (projected !== undefined) return projected;
  /** @type {Record<string, PlaceholderDefinitionInput>} */
  const placeholders = Object.create(null);
  let hasPlaceholders = false;

  for (const [name, placeholder] of node.placeholders) {
    hasPlaceholders = true;

    if (placeholder.kind === "language-form") {
      /** @type {Record<string, string>} */
      const translations = Object.create(null);
      for (const [form, text] of placeholder.translations) translations[form] = text;

      placeholders[name] = freeze({
        kind: /** @type {const} */ ("language-form"),
        ...(placeholder.value === null ? {} : { value: placeholder.value }),
        ...(placeholder.range === null ? {} : { range: freeze({ ...placeholder.range }) }),
        translations: freeze(translations),
      });
    } else {
      placeholders[name] = freeze({
        kind: /** @type {const} */ ("expression"),
        translation: placeholder.translation,
        ...(placeholder.alternatives.length === 0
          ? {}
          : { alternatives: freeze(placeholder.alternatives.map((a) => freeze({ ...a }))) }),
      });
    }
  }

  const result = {
    ...(node.translation === null ? {} : { translation: node.translation }),
    ...(node.commentary === null ? {} : { commentary: node.commentary }),
    ...(hasPlaceholders ? { placeholders: freeze(placeholders) } : {}),
    ...(node.alternatives.length === 0
      ? {}
      : {
          alternatives: freeze(
            node.alternatives.map((alternative) =>
              freeze({ expression: alternative.expression, ...projectNode(alternative.definition, memo) }),
            ),
          ),
        }),
  };

  memo.set(node, result);
  return result;
}

/**
 * Pull the ordinal support probe off a `lokalized/data/ordinal` carrier, if one was supplied.
 *
 * Deliberately tolerant of a carrier without the probe, and silent about a value that is not a
 * carrier at all: `createStrings` owns the diagnosis of a misconfigured `pluralData`, and repeating
 * it here would give one mistake two different messages depending on which entry point saw it first.
 *
 * @param {unknown} carrier
 * @returns {((locale: string) => readonly string[]) | null}
 */
function ordinalitySupportProbe(carrier) {
  if (typeof carrier !== "object" || carrier === null) return null;

  const runtime = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (carrier))[PLURAL_DATA_RUNTIME];
  if (typeof runtime !== "object" || runtime === null) return null;

  const probe = /** @type {Record<string, unknown>} */ (runtime)["supportedOrdinalityNamesFor"];
  return typeof probe === "function"
    ? /** @type {(locale: string) => readonly string[]} */ (probe)
    : null;
}

/**
 * Parse one localized strings resource against a CALLER-SUPPLIED session.
 *
 * Limit validation happens when the session is constructed — FIRST, and as a `RangeError` rather
 * than a parse failure. The split is Java's: a limit outside its band is an
 * `IllegalArgumentException` from the options, raised before any resource is looked at, and the
 * corpus records exactly that for `maximumLocalizedStringsFiles` 0.
 *
 * @param {string | Uint8Array} input raw resource text, or its bytes
 * @param {ParseStringsOptions} options
 * @param {LoadingSession} session budgets that may span more than this one resource
 * @returns {ParsedStringsFile}
 * @throws {RangeError} if a limit is outside its permitted band — thrown before the input is read,
 *   exactly as `LocalizedStringLoadingOptions.Builder` rejects it before a loader ever runs
 * @throws {StringsParseError} if the resource cannot be read, decoded, parsed, or validated
 */
export function parseStringsWithSession(input, options, session) {
  const source = options.source ?? DEFAULT_SOURCE;
  const locale = normalizeTag(options.locale);


  /** @type {LocalizedStringWarning[]} */
  const warnings = [];

  const reportIncompleteLanguageForms = incompleteLanguageFormReporter({
    source,
    locale,
    supportedOrdinalityNamesFor: ordinalitySupportProbe(options.pluralData?.ordinal),
    // Through the session, so the warning budget REFUSES the over-limit warning instead of
    // retaining it and reporting afterwards: `session.warn` compares before it increments, and the
    // handler that appends only runs once the budget has admitted it.
    emit: (warning) => {
      session.warn(warning, (admitted) => {
        warnings.push(/** @type {LocalizedStringWarning} */ (admitted));
        options.onWarning?.(/** @type {LocalizedStringWarning} */ (admitted));
      });
    },
  });

  /** @type {Map<string, Definition>} */
  let definitions;
  try {
    // Both hooks run INSIDE the structural walk, which is where Java runs them, and the placement is
    // observable three ways: an early key's bad expression beats a later key's structural error, an
    // early key's warning is delivered before a later key fails, and a warning budget busted by an
    // early key is what the file fails on even when a later key is also malformed.
    definitions = parseCatalogSource(input, {
      source,
      locale,
      session,
      validateExpression: validateExpressionAtLoad,
      onRootParsed: reportIncompleteLanguageForms,
    });
  } catch (error) {
    rethrowAsParseError(error, source);
  }

  /** @type {LocalizedStringInput[]} */
  const strings = [];
  /** @type {Record<string, readonly string[]>} */
  const originsByKey = Object.create(null);

  for (const [key, definition] of definitions) {
    strings.push(freeze({ key, ...projectNode(definition) }));
    originsByKey[key] = freeze([source]);
  }

  return freeze({
    $lokalized: /** @type {const} */ ("parsed-strings-file"),
    locale,
    sources: freeze([source]),
    strings: freeze(strings),
    originsByKey: freeze(originsByKey),
    warnings: freeze(warnings),
  });
}
