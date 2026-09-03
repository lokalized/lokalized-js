// @ts-check

/**
 * Internal: `LocalizedStringLoader.warnOnIncompleteLanguageFormTranslations` and its two halves.
 *
 * A cardinality- or ordinality-driven placeholder that omits a form its locale requires per CLDR is
 * a WARNING, not a failure: a placeholder that can only ever receive a subset of values may
 * legitimately supply a subset of forms. Range-driven translations are skipped entirely, because
 * they are expected to be partial by design.
 *
 * Traversal order is observable and pinned by the corpus: root keys in declaration order, each
 * node's placeholders in declaration order, cardinality before ordinality for the same placeholder,
 * and whole-message alternatives after the node that carries them.
 *
 * The ORDINAL half arrives through an injected probe rather than an import. `lokalized/data/ordinal`
 * is optional and deliberately outside the root graph — `test/pinned-data-only.test.js` and
 * `npm run scenario:0a` ratchet exactly that — so a parser that imported it would drag the ordinal
 * table into every browser bundle. Without the probe, ordinality gaps simply go unreported, the same
 * way `createStrings` refuses to answer an ordinal question the caller supplied no data for.
 */

import { supportedCardinalCategoriesFor } from "./plural.js";

/** @typedef {import("./catalog.js").Definition} Definition */

/**
 * @typedef {object} LocalizedStringWarning
 * @property {"INCOMPLETE_CARDINALITY_TRANSLATIONS" | "INCOMPLETE_ORDINALITY_TRANSLATIONS"} type
 * @property {string} source
 * @property {string} locale
 * @property {string} key the ROOT key, even for a warning raised inside an alternative
 * @property {string} placeholder
 * @property {readonly string[]} missingLanguageForms in declared form order, never hash order
 * @property {string} message
 */

/**
 * @typedef {object} WarningContext
 * @property {string} source
 * @property {string} locale the normalized tag, which is also what the warning reports
 * @property {(warning: LocalizedStringWarning) => void} emit
 * @property {((locale: string) => readonly string[]) | null} supportedOrdinalityNamesFor
 */

const CARDINALITY_PREFIX = "CARDINALITY_";
const ORDINALITY_PREFIX = "ORDINALITY_";

/**
 * `Cardinality.supportedCardinalitiesForLocale` spelled as strings-file form names.
 *
 * @param {string} locale
 * @returns {string[]}
 */
function supportedCardinalityNamesFor(locale) {
  return supportedCardinalCategoriesFor(locale).map(
    (category) => `${CARDINALITY_PREFIX}${category.toUpperCase()}`,
  );
}

/**
 * One half of the check, shared by both axes because Java's two methods differ only in their table,
 * their prefix, and the axis name printed in the message.
 *
 * @param {WarningContext} context
 * @param {string} rootKey
 * @param {string} placeholderName
 * @param {Map<string, string>} translations
 * @param {string} prefix
 * @param {string} axisName the Java enum's simple name, printed verbatim
 * @param {readonly string[]} supported
 * @param {"INCOMPLETE_CARDINALITY_TRANSLATIONS" | "INCOMPLETE_ORDINALITY_TRANSLATIONS"} type
 * @returns {void}
 */
function checkAxis(context, rootKey, placeholderName, translations, prefix, axisName, supported, type) {
  // An empty PROVIDED set means the placeholder is not driven by this axis at all; nothing to check.
  // An empty SUPPORTED set means the locale has no forms on this axis, which is not a gap either.
  let provided = false;
  for (const name of translations.keys()) if (name.startsWith(prefix)) { provided = true; break; }
  if (!provided || supported.length === 0) return;

  const missing = supported.filter((name) => !translations.has(name));
  if (missing.length === 0) return;

  const message =
    `${context.source}: placeholder '${placeholderName}' for key '${rootKey}' is missing ${axisName} ` +
    `translation[s] for locale '${context.locale}': [${missing.join(", ")}]. ` +
    `Supported forms are [${supported.join(", ")}]. ` +
    "Values that resolve to a missing form are treated as resolution failures at runtime.";

  context.emit(
    Object.freeze({
      type,
      source: context.source,
      locale: context.locale,
      key: rootKey,
      placeholder: placeholderName,
      missingLanguageForms: Object.freeze([...missing]),
      message,
    }),
  );
}

/**
 * @param {WarningContext} context
 * @param {string} rootKey
 * @param {Definition} node
 * @param {readonly string[]} supportedCardinalities
 * @param {readonly string[] | null} supportedOrdinalities
 * @param {Set<Definition>} visited
 * @returns {void}
 */
function walkNode(context, rootKey, node, supportedCardinalities, supportedOrdinalities, visited) {
  // Guarded by node IDENTITY. A parsed file is a tree and never revisits anything, so for the loader
  // this changes nothing. A programmatically supplied graph may share one alternative subtree
  // between several parents (plan 3.6), and `parseModelCatalog` preserves the sharing rather than
  // expanding it — so an unguarded walk is exponential in the depth of a shared diamond, and a
  // catalog that constructs in a millisecond takes longer than the universe to warn about.
  //
  // Reporting once per NODE rather than once per PATH is also the right answer on its own: the same
  // placeholder in the same node has the same gap however many parents reach it, and emitting the
  // identical warning n times would just spend the warning budget on repeats.
  if (visited.has(node)) return;
  visited.add(node);

  for (const [placeholderName, placeholder] of node.placeholders) {
    if (placeholder.kind !== "language-form") continue;
    // Range-driven translations legitimately supply a subset of forms; do not check them.
    if (placeholder.range !== null) continue;

    checkAxis(context, rootKey, placeholderName, placeholder.translations, CARDINALITY_PREFIX,
      "Cardinality", supportedCardinalities, "INCOMPLETE_CARDINALITY_TRANSLATIONS");

    if (supportedOrdinalities !== null)
      checkAxis(context, rootKey, placeholderName, placeholder.translations, ORDINALITY_PREFIX,
        "Ordinality", supportedOrdinalities, "INCOMPLETE_ORDINALITY_TRANSLATIONS");
  }

  for (const alternative of node.alternatives)
    walkNode(context, rootKey, alternative.definition, supportedCardinalities, supportedOrdinalities, visited);
}

/**
 * Bind the per-locale form tables once, and return the per-ROOT-KEY reporter.
 *
 * Per key rather than per catalog because Java warns inside its member loop, the instant a key is
 * parsed and before the next one is read. A file whose first key warns and whose second key is
 * malformed therefore DELIVERS THE WARNING and then fails — and when the warning budget is what the
 * first key busts, the budget is the failure the file reports, not the second key's defect. Emitting
 * afterwards would drop every warning the file did produce whenever anything later went wrong.
 *
 * The tables are looked up once here because both are pure functions of the locale, and a catalog
 * with thousands of keys would otherwise rebuild them thousands of times.
 *
 * @param {WarningContext} context
 * @returns {(key: string, definition: Definition) => void}
 */
export function incompleteLanguageFormReporter(context) {
  const supportedCardinalities = supportedCardinalityNamesFor(context.locale);
  const supportedOrdinalities = context.supportedOrdinalityNamesFor
    ? context.supportedOrdinalityNamesFor(context.locale)
    : null;

  // The visited set is per ROOT KEY, not per catalog: two root keys that share a subtree each
  // legitimately report its gap, because the warning names the root key it was reached through.
  return (key, definition) =>
    walkNode(context, key, definition, supportedCardinalities, supportedOrdinalities, new Set());
}
