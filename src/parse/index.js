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
import { refuseUnknownOptions } from "../internal/configuration-error.js";
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
import { StringsParseError, parseError, rethrowAsParseError } from "../internal/parse-diagnostics.js";
import { incompleteLanguageFormReporter } from "../internal/parse-warnings.js";
import { PLURAL_DATA_RUNTIME } from "../internal/plural.js";

export { StringsParseError };

const freeze = Object.freeze;

/** The default source label, per plan section 4.1. */

/** @typedef {import("../internal/catalog.js").Definition} Definition */
/** @typedef {import("../internal/catalog.js").ParseLimits} StringsLoadingLimits */
/**
 * @typedef {Pick<StringsLoadingLimits, "maximumLocalizedStringsFiles" | "maximumTranslationNodes"
 *   | "maximumWarnings">} ParsedCatalogLimits plan 4.1's three limits that apply to an ALREADY-PARSED
 *   catalog. The raw boundaries — input bytes, reader characters, JSON nesting — have no text left to
 *   bound by the time one exists, which is the distinction the name carries.
 */

/** @typedef {import("../internal/catalog.js").PlaceholderDefinition} PlaceholderDefinition */
/** @typedef {import("../internal/catalog.js").LocalizedStringNodeInput} LocalizedStringNodeInput */

/** @typedef {import("../internal/parse-warnings.js").LocalizedStringWarning} LocalizedStringWarning */

/**
 * `locale` is the locale this resource represents; `source` is the label every diagnostic and
 * warning reports and defaults to `<input>`; `pluralData` takes the OPTIONAL plural modules'
 * exported data objects, of which only `ordinal` is consulted and only to report ordinality gaps,
 * because this module is in the ratcheted root graph and cannot import `lokalized/data/ordinal`
 * for itself.
 *
 * **WRAPPED, PER BOOT-M0-0721 THROUGH BOOT-M0-0724.** `Readonly<>` on an OPTIONS type costs a caller
 * nothing — a mutable object literal is still assignable to a readonly-membered parameter — and it
 * says the true thing, which is that this door reads the options once and never writes them back.
 *
 * @typedef {Readonly<{
 *   locale: string,
 *   source?: string,
 *   limits?: StringsLoadingLimits,
 *   onWarning?: (warning: LocalizedStringWarning) => void,
 *   pluralData?: Readonly<{ ordinal?: unknown, ranges?: unknown }>,
 * }>} ParseStringsOptions
 */

/**
 * The parsed model of one strings file — BOOT-M0-0301 through BOOT-M0-0306, all six `readonly`.
 *
 * It is an OUTPUT of `parseStrings` and an INPUT to `mergeParsedStringsFiles`, so the wrap has to
 * hold in both directions: a caller may still build one and hand it over, because readonly members
 * accept a mutable source, and the arrays inside were already `readonly`.
 *
 * @typedef {Readonly<{
 *   $lokalized: "parsed-strings-file",
 *   locale: string,
 *   sources: readonly string[],
 *   strings: readonly LocalizedStringInput[],
 *   originsByKey: Readonly<Record<string, readonly string[]>>,
 *   warnings: readonly LocalizedStringWarning[],
 * }>} ParsedStringsFile
 */

/**
 * BOOT-M0-0566 for `key`, and the four optional members with it.
 *
 * @typedef {Readonly<{
 *   key: string,
 *   translation?: string,
 *   commentary?: string,
 *   placeholders?: Readonly<Record<string, PlaceholderDefinitionInput>>,
 *   alternatives?: readonly WholeMessageAlternativeInput[],
 * }>} LocalizedStringInput
 */

/**
 * BOOT-M0-0568 for `expression`.
 *
 * @typedef {Readonly<{
 *   expression: string,
 *   translation?: string,
 *   commentary?: string,
 *   placeholders?: Readonly<Record<string, PlaceholderDefinitionInput>>,
 *   alternatives?: readonly WholeMessageAlternativeInput[],
 * }>} WholeMessageAlternativeInput
 */

/**
 * The registry names the two arms separately — `LanguageFormTranslationInput` (BOOT-M0-0571 to
 * BOOT-M0-0576) and `ExpressionTranslationInput` (BOOT-M0-0577 to BOOT-M0-0581) — where the port
 * publishes the union under one name. Both arms are wrapped; the nested `range` and the
 * expression-fragment alternatives already were.
 *
 * @typedef {Readonly<{ kind: "language-form", value?: string,
 *     range?: Readonly<{ start: string, end: string }>,
 *     translations: Readonly<Record<string, string>> }>
 *   | Readonly<{ kind: "expression", translation: string,
 *       alternatives?: readonly Readonly<{ expression: string, translation: string }>[] }>
 * } PlaceholderDefinitionInput
 */


/**
 * Every member `parseStrings` reads. `limits` is read at this door; `source`, `locale`, `pluralData`
 * and `onWarning` are read in the shared body `parseStringsWithSession`, which this door hands its
 * whole options object to.
 *
 * A recording proxy MISSES `onWarning` on a clean catalog, because it is read lazily inside the
 * per-warning callback and a clean catalog produces none — the per-bucket blind spot this project
 * has recorded for the same technique one layer up. It is in the set because a warning-producing
 * fixture reaches it.
 */
const PARSE_STRINGS_OPTIONS = /** @type {const} */ ([
  "locale", "source", "limits", "onWarning", "pluralData",
]);

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
  // BEFORE the session, which is constructed as an ARGUMENT below — so `resolveLimits`' RangeError
  // fires before any body statement and would mask a call carrying both a bad limit and a typo.
  refuseUnknownOptions("parseStrings", options, PARSE_STRINGS_OPTIONS,
    { loadingLimits: "limits" });

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
 * @param {LocalizedStringInput} input BOOT-M0-0582. It was `unknown` — which is honest about the
 *   runtime, since the walk refuses anything it does not recognise, and silent at the one moment a
 *   compiler could have spoken. The refusals all remain: a declared type is not a validation
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
 * @param {readonly LocalizedStringInput[]} inputs BOOT-M0-0584. `unknown[]` admitted anything and
 *   the walk below refuses it at run time; the element type says so at compile time instead
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


/**
 * STRUCTURAL EQUALITY OF A VALIDATED MODEL — and the shape of it was MEASURED on the pinned JDK
 * rather than read off plan 2.3's sentence, which does not say what it looks like it says.
 *
 * The plan describes the dedup rule as deduplicating "definitions whose complete validated model
 * (including commentary and declaration order, excluding origin/warning metadata) is structurally
 * equal". Read plainly, "declaration order" makes a placeholder map authored `{z, a}` unequal to one
 * authored `{a, z}`. **Java says otherwise, and Java is the specification.** Measured 2026-09-15
 * against `lokalized-java` 3.0.0's own `LocalizedString#equals` on the pinned JDK:
 *
 *     placeholder map insertion order `{z,a}` vs `{a,z}`          EQUAL
 *     LinkedHashMap vs HashMap for the same entries               EQUAL
 *     translations-by-language-form order MASC,FEM vs FEM,MASC    EQUAL
 *     alternatives order [x,y] vs [y,x]                           NOT EQUAL
 *     alternatives same order (the control)                       EQUAL
 *     commentary null vs "note"                                   NOT EQUAL
 *     no placeholders vs an EMPTY placeholder map                 EQUAL
 *
 * The mechanism is visible at `LocalizedString.java:168-181`: `placeholderDefinitions` is compared
 * with `Objects.equals` on a `Map`, which is order-insensitive, while `alternatives` is a `List`
 * walked BY INDEX. So "declaration order" is the ALTERNATIVES' order and nothing else, and a
 * comparison that also honoured map order would be STRICTLY STRICTER THAN JAVA — refusing a merge of
 * two shards a Java deployment would accept. That is the same defect class as validating load-time
 * expressions against runtime defaults, one file up.
 *
 * **ARRAYS ORDER-SENSITIVE, KEYED RECORDS ORDER-INSENSITIVE, AND NO FIELD LIST ANYWHERE.** The walk
 * is generic on purpose: a hand-written list of compared fields is a claim that goes stale the day
 * the model grows a member, and this project has already measured that exact silence once — widening
 * `catalogIdentityInputFor` changed no fingerprint and no behaviour, and only an exact key-set
 * assertion could see it. Here a new field participates by construction.
 *
 * The values compared are the parser's CANONICAL PROJECTION, which is what makes the last row above
 * a non-issue: `parseStrings` drops an empty `placeholders` map rather than emitting one, so two
 * genuinely parsed definitions cannot differ that way. A HAND-BUILT `ParsedStringsFile` that is not
 * canonical may therefore report a conflict where its canonical twin would merge — which fails
 * CLOSED, with a diagnostic naming both origins, and is stated here rather than left to be found.
 *
 * @param {unknown} left @param {unknown} right @returns {boolean}
 */
function structurallyEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;

  const leftArray = Array.isArray(left);
  if (leftArray !== Array.isArray(right)) return false;

  if (leftArray) {
    const other = /** @type {readonly unknown[]} */ (right);
    return left.length === other.length
      && left.every((value, index) => structurallyEqual(value, other[index]));
  }

  const leftKeys = Object.keys(left);
  const rightRecord = /** @type {Record<string, unknown>} */ (right);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  return leftKeys.every((key) =>
    Object.hasOwn(rightRecord, key)
    && structurallyEqual(/** @type {Record<string, unknown>} */ (left)[key], rightRecord[key]));
}

/** The source label a merge reports when a diagnostic is about the merge itself. */
const MERGE_SOURCE = "<merged>";

/**
 * @param {unknown} file @param {number} index
 * @returns {ParsedStringsFile}
 */
function requireParsedStringsFile(file, index) {
  const candidate = /** @type {Partial<ParsedStringsFile>} */ (file);
  if (candidate === null || typeof candidate !== "object"
    || candidate.$lokalized !== "parsed-strings-file"
    || typeof candidate.locale !== "string"
    || !Array.isArray(candidate.sources) || !Array.isArray(candidate.strings)
    || !Array.isArray(candidate.warnings)
    || candidate.originsByKey === null || typeof candidate.originsByKey !== "object")
    throw parseError(
      `${MERGE_SOURCE}: input ${index} is not a parsed strings file`,
      { source: MERGE_SOURCE });
  return /** @type {ParsedStringsFile} */ (file);
}

/**
 * MERGE EXACT-LOCALE SHARDS — plan 2.3:172-190 and 3.6:1477-1496.
 *
 * An application whose translations are split by route or namespace parses each shard separately and
 * merges before construction; V1 manifests and the runtime loader model ONE assembled resource per
 * locale, so the splitting is the application's and the assembly happens here.
 *
 * **THE LOCALE RULE IS EXACT AND THE PLAN SAYS WHY IN ONE EXAMPLE.** "Matching primary language,
 * likely script, or `equivalent(a, b)` is insufficient. For example, `pt` and `pt-PT` must remain
 * separate because their cardinal rules differ for `0`, `0.0`, and `1.5`." An entry is evaluated
 * under the locale of the file that supplied it, so merging across two tags silently re-evaluates
 * half the catalog under the wrong plural rules. Tags are NORMALIZED first — `en-us` and `en-US` are
 * one locale — and then compared exactly.
 *
 * **LAST-WRITE-WINS IS FORBIDDEN (plan 2.3:190).** A repeated key is either the same definition,
 * which unions its origins, or a conflict, which is refused with both origins named. There is no
 * third behaviour, and the absence of one is the point: shards that disagree are an authoring bug
 * that a silent winner turns into a mystery at render time.
 *
 * **WHAT IT REVALIDATES, AND WHAT IT CANNOT.** Plan 3.6:1493-1496: "Raw input-byte, reader-character,
 * total-byte, and JSON-nesting limits are enforceable only where the original string/bytes or stream
 * is observed; normalized `ParsedStringsFile` values do not pretend to reconstruct them from lost
 * whitespace, escapes, or BOMs." So the three limits that survive are the model ones, and the merged
 * catalog is walked once against them rather than each input being re-charged: after dedup the merged
 * set IS what exists, and charging the pre-dedup sum would refuse a merge of two identical shards at
 * a budget the result fits inside.
 *
 * @param {readonly ParsedStringsFile[]} files the shards, in the order their sources should appear
 * @param {Readonly<{ limits?: ParsedCatalogLimits }>} [options] BOOT-M0-0729
 * @returns {ParsedStringsFile}
 * @throws {StringsParseError} on no input, a locale disagreement, a conflicting repeated key, a
 *   value that is not a parsed strings file, or a limit the merged catalog exceeds
 */
export function mergeParsedStringsFiles(files, options) {
  // BEFORE the arity guard, deliberately: `mergeParsedStringsFiles([], { typo })` names the typo
  // rather than the empty array, because a misspelled option is a mistake the caller can fix from
  // the message and an empty list is usually a symptom of one.
  refuseUnknownOptions("mergeParsedStringsFiles", options, ["limits"], { loadingLimits: "limits" });

  if (!Array.isArray(files) || files.length === 0)
    throw parseError(`${MERGE_SOURCE}: merging requires at least one parsed strings file`,
      { source: MERGE_SOURCE });

  const inputs = files.map(requireParsedStringsFile);
  const session = new LoadingSession(options?.limits);

  // THE FILE BUDGET IS CHARGED PER INPUT, IN CALLER ORDER, so the refusal names the shard that
  // crossed it rather than the merge.
  for (const file of inputs) session.beginFile(file.sources[0] ?? MERGE_SOURCE);

  /** @type {string | null} */
  let locale = null;
  for (const file of inputs) {
    const normalized = normalizeTag(file.locale);
    if (locale === null) locale = normalized;
    else if (normalized !== locale)
      throw parseError(
        `${MERGE_SOURCE}: every input must be authored for one exact locale, but '${locale}' and ` +
        `'${normalized}' were both supplied. Matching primary language or script is not enough — ` +
        `plural and language-form selection depend on the exact tag.`,
        { source: MERGE_SOURCE });
  }

  /** @type {string[]} */
  const sources = [];
  /** @type {Map<string, { definition: LocalizedStringInput, origins: string[] }>} */
  const merged = new Map();
  /** @type {LocalizedStringWarning[]} */
  const warnings = [];

  for (const file of inputs) {
    sources.push(...file.sources);
    warnings.push(...file.warnings);

    for (const definition of file.strings) {
      const key = definition.key;
      const origins = originsFor(file, key);
      const held = merged.get(key);

      if (held === undefined) {
        merged.set(key, { definition, origins: [...origins] });
        continue;
      }

      if (!structurallyEqual(held.definition, definition))
        throw parseError(
          `${MERGE_SOURCE}: key '${key}' is defined differently in ` +
          `${javaList(held.origins)} and ${javaList([...origins])}. Merging shards never picks a ` +
          `winner; make the definitions identical or give them different keys.`,
          { source: MERGE_SOURCE });

      for (const origin of origins) if (!held.origins.includes(origin)) held.origins.push(origin);
    }
  }

  // THE WARNING BUDGET APPLIES TO WHAT IS CARRIED, not to anything re-emitted: the merge produces no
  // warnings of its own, and re-running the parser's warning hooks over already-parsed values would
  // duplicate every one of them.
  for (const warning of warnings) session.warn(warning);

  // Model revalidation and the translation-node budget in one walk, through the same door
  // `defineCatalog` uses — so a fabricated input meets the file rules rather than a second dialect
  // of them, and the output is canonical whatever the inputs were.
  /** @type {Map<string, Definition>} */
  let definitions;
  try {
    definitions = parseModelCatalog([...merged.values()].map((entry) => entry.definition), {
      source: MERGE_SOURCE,
      limits: options?.limits,
      validateExpression: validateExpressionAtLoad,
    });
  } catch (error) {
    rethrowAsParseError(error, MERGE_SOURCE);
  }

  /** @type {Map<Definition, Omit<WholeMessageAlternativeInput, "expression">>} */
  const memo = new Map();
  /** @type {Record<string, readonly string[]>} */
  const originsByKey = Object.create(null);
  for (const [key, entry] of merged) originsByKey[key] = freeze([...entry.origins]);

  return freeze({
    $lokalized: /** @type {const} */ ("parsed-strings-file"),
    locale: /** @type {string} */ (locale),
    sources: freeze(sources),
    strings: freeze(
      [...definitions].map(([key, definition]) => freeze({ key, ...projectNode(definition, memo) })),
    ),
    originsByKey: freeze(originsByKey),
    warnings: freeze(warnings),
  });
}

/**
 * A key's origins, falling back to the file's own source list.
 *
 * `originsByKey` is null-prototype and a fabricated input may simply omit a key from it; the file's
 * sources are then the honest answer, because that IS where the definition came from.
 *
 * @param {ParsedStringsFile} file @param {string} key @returns {readonly string[]}
 */
function originsFor(file, key) {
  const declared = Object.hasOwn(file.originsByKey, key) ? file.originsByKey[key] : undefined;
  return Array.isArray(declared) && declared.length > 0 ? declared : file.sources;
}

/** `java.util.List#toString` — the bracketed, comma-space form every diagnostic here uses. */
const javaList = (/** @type {readonly string[]} */ values) => `[${values.join(", ")}]`;
