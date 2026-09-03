// @ts-check
/**
 * `lokalized/core` — strict runtime plus synchronous raw-catalog parsing accepted by
 * `createStrings`.
 *
 * M2 walking skeleton. This module is the ASSEMBLY point: it wires the locale kernel, the bounded
 * parser, the exact plural engine, and the renderer into the public `Strings` surface. The behavior
 * it must reproduce is recorded in the shared behavioral corpus, which was produced by executing
 * lokalized-java 3.0.0 rather than by describing it.
 *
 * The one invariant to hold on to while reading this file: **selection and resolution are separate
 * channels.** `matchFor` answers "which locale would a delivery have had to fetch"; `candidateChain`
 * answers "which catalogs does per-key lookup actually try". They legitimately disagree — a `zh-TW`
 * request can select `zh-Hant` and still resolve through `en` without ever visiting a loaded `zh`
 * that holds the key. Collapsing them is the single most tempting simplification here and it is
 * wrong.
 */
import {
  DEFAULT_BIDI_ISOLATION,
  shouldApplyBidiIsolation,
  validateBidiIsolation,
} from "../internal/bidi.js";
import {
  LoadingSession,
  parseCatalog,
  parseCatalogSource,
  parseModelCatalog,
} from "../internal/catalog.js";
import {
  compile as compileExpression,
  evaluate as evaluateCompiledExpression,
} from "../internal/expression.js";
import { interpolateFailureKey, render } from "../internal/interpolate.js";
import { equivalentTags } from "../internal/locale-cldr.js";
import { candidateChain, matchFor, normalizeTag, primaryLanguage } from "../internal/locale.js";
import { incompleteLanguageFormReporter } from "../internal/parse-warnings.js";
import { PLURAL_DATA_RUNTIME } from "../internal/plural.js";

/** @typedef {import("../internal/catalog.js").Definition} Definition */
/** @typedef {import("../internal/parse-warnings.js").LocalizedStringWarning} LocalizedStringWarning */

/**
 * @typedef {object} CreateStringsOptions
 * @property {string} fallbackLocale
 * @property {Record<string, unknown> | ReadonlyMap<string, unknown>} strings plan section 3.2's
 *   `CatalogMap`: each locale tag mapped to one `CatalogInput`. A `Map` is accepted alongside a
 *   record — see `catalogEntries`, and plan 4.3, which accepts a `Map` wherever a keyed record is
 *   taken because the keys come from a generated or untrusted source.
 * @property {string} [locale] the ambient locale; required until localeResolver lands
 * @property {Record<string, readonly string[]> | ReadonlyMap<string, readonly string[]> | null}
 *   [tiebreakers] plan section 3.2's `TiebreakerMap`. Snapshotted and frozen at construction —
 *   see `safeTiebreakers`.
 * @property {import("../internal/catalog.js").ParseLimits} [loadingLimits] per-load bounds; plan
 *   section 3.2's `Partial<StringsLoadingLimits>`. The RAW boundaries — input bytes, reader
 *   characters, JSON nesting — apply only to the forms that still have the original text; the
 *   model/file/node/warning boundaries apply to every form, "across all raw and already-parsed
 *   catalogs".
 * @property {undefined} [runtimeLimits] plan 4.6: v1 exposes no runtime-limit customization, and a
 *   non-undefined value is refused at construction rather than silently ignored.
 * @property {(warning: LocalizedStringWarning) => void} [onWarning] observer for the incomplete
 *   language-form warnings this construction raises, called as each is admitted by the warning
 *   budget. A throwing handler aborts construction.
 * @property {{ ordinal?: unknown, ranges?: unknown }} [pluralData] the OPTIONAL plural modules'
 *   exported data objects. The root graph cannot reach `lokalized/data/ordinal` or
 *   `lokalized/data/ranges` — `npm run scenario:0a` ratchets it so it cannot — so a catalog that
 *   selects on `ORDINALITY_*` or uses a range placeholder is answerable only if the application
 *   hands the data over here.
 * @property {(term: string, locale: string) => unknown} [phoneticResolver] plan section 3.7's
 *   `PhoneticResolver`: synchronous, handed a raw TERM and the EVALUATION locale, and returning a
 *   tagged `PHONETIC_*` value. Omitting it is not the same as having none — see
 *   `THROWING_PHONETIC_RESOLVER`.
 * @property {import("../internal/bidi.js").BidiIsolation} [bidiIsolation] whether caller-supplied
 *   values are wrapped in Unicode isolate controls. DEFAULTS TO `"rtl-locales"`, so isolation is on
 *   for RTL evaluation locales with nothing configured; it is not opt-in behavior.
 */

const freeze = Object.freeze;

/**
 * Match types that mean negotiation itself fell back rather than landing on what was asked for.
 * `TranslationResult.isFallback` is true whenever one of these was reported, INDEPENDENTLY of what
 * per-key resolution went on to do.
 */
const NEGOTIATION_FALLBACK_TYPES = new Set(["none", "cldr-fallback", "likely-subtag", "primary-language"]);

/**
 * Java's `TranslationResult.isFallback` (TranslationResult.java:251), which is not "the candidate
 * differed from the request".
 *
 *   negotiationUsedFallback() || (resolvedLocale != null && !equivalent(lookup, resolved))
 *
 * Two consequences a naive identity check gets backwards in opposite directions. A request that
 * resolves through an ALIAS — `hy-SU` served by `hy-AM` — is NOT a fallback, because the two tags are
 * equivalent. And a lookup that resolves NOTHING still reports a fallback when the match type says
 * negotiation fell back, even though there is no resolved locale to compare.
 *
 * @param {{ matchType: string } | null} localeMatch
 * @param {string} lookupLocale
 * @param {string | null} resolvedLocale
 */
function isFallbackFor(localeMatch, lookupLocale, resolvedLocale) {
  if (localeMatch !== null && NEGOTIATION_FALLBACK_TYPES.has(localeMatch.matchType)) return true;
  return resolvedLocale !== null && !equivalentTags(lookupLocale, resolvedLocale);
}

/**
 * `DefaultStrings.DEFAULT_PHONETIC_RESOLVER` (DefaultStrings.java:76).
 *
 * Java never holds a null resolver: the constructor substitutes a fail-fast one, so "no resolver
 * configured" is observable only as an exception raised at the moment a raw term first reaches the
 * phonetic axis. That distinction is load-bearing in both directions and the corpus pins both ends
 * of it — `phonetic-resolver.absent-resolver.unreferenced-definition-never-fails` renders happily
 * because the definition is never referenced, while `absent-resolver.expression-raw-term` becomes a
 * `resolution-failure` of that candidate rather than a construction error. Rejecting the missing
 * option at construction time would break the first; returning some default category would break
 * the second and silently mistranslate.
 *
 * The message is deliberately NOT Java's, which points at `Strings.Builder#phoneticResolver(...)`.
 *
 * @param {string} term
 * @param {string} locale
 * @returns {never}
 */
function THROWING_PHONETIC_RESOLVER(term, locale) {
  throw new Error(
    "No phoneticResolver was configured. Provide one via createStrings({ phoneticResolver }) to " +
      `classify the term supplied for locale '${locale}'`,
  );
}

/**
 * A translation failure, carried out of the render/lookup path so the walk can decide what to do
 * with it. Not public: it becomes a `resolution-failure` result or is swallowed by fallback.
 */
class ResolutionFailure extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ResolutionFailure";
    this.cause = cause;
  }
}

/**
 * Build a `Strings` from raw catalogs.
 *
 * Synchronous by contract: parsing, validation, and locale-configuration work all happen here so
 * that a later `get` cannot surprise the caller with a construction-time error.
 *
 * @param {CreateStringsOptions} options
 */
export function createStrings(options) {
  const fallbackLocale = normalizeTag(options.fallbackLocale);
  const ambientLocale = normalizeTag(options.locale ?? options.fallbackLocale);

  // A callback of the wrong SHAPE is a configuration mistake and is refused here; a callback that
  // misbehaves at runtime is not, and becomes the current candidate's resolution failure instead.
  // Plan section 3.5 draws the line in exactly that place.
  if (options.phoneticResolver !== undefined && typeof options.phoneticResolver !== "function")
    throw new TypeError("createStrings({ phoneticResolver }) must be a function");

  // Plan 4.6: "V1 exposes no runtime-limit customization... A non-undefined `runtimeLimits` option
  // is a construction-time ConfigurationError." REFUSED rather than ignored, and the difference is
  // the whole point: an ignored limit produces a plausible answer computed under a bound the caller
  // does not have, which is the one outcome nobody can debug. Java's `TranslationRuntimeLimits` is
  // configurable and the corpus records 94 cases that lower or raise it; the JS port fixes the
  // defaults in `4.6`, so the honest answer to a supplied override is to say so at construction.
  if (options.runtimeLimits !== undefined)
    throw new RangeError(
      "createStrings({ runtimeLimits }) is not customizable in v1; the fixed limits in plan " +
        "section 4.6 apply to every instance",
    );

  const phoneticResolver = options.phoneticResolver ?? THROWING_PHONETIC_RESOLVER;

  // Validated at CONSTRUCTION even though it is only read per lookup, for the same reason the
  // resolver's shape is: `DefaultStrings` stores `DEFAULT_BIDI_ISOLATION` when handed null
  // (DefaultStrings.java:477), so an unrecognized spelling would otherwise be indistinguishable
  // from the default and isolation would quietly vanish from every RTL render.
  const instanceBidiIsolation =
    options.bidiIsolation === undefined
      ? DEFAULT_BIDI_ISOLATION
      : validateBidiIsolation(options.bidiIsolation, "createStrings({ bidiIsolation })");

  /** @type {Map<string, Map<string, Definition>>} */
  const catalogs = new Map();
  // ONE session across every catalog, not one per file. Java's aggregate budgets
  // (`maximumTotalInputBytes`, `maximumLocalizedStringsFiles`) are per-LOAD: a session per catalog
  // would enforce each file's own limit and silently never enforce the aggregate at all.
  const session = new LoadingSession(options.loadingLimits);

  /** @type {LocalizedStringWarning[]} */
  const warnings = [];

  for (const [tag, raw] of catalogEntries(options.strings)) {
    const locale = normalizeTag(tag);
    if (catalogs.has(locale))
      throw new RangeError(`Duplicate localized strings for locale '${locale}'`);

    // Plan 3.2: "Direct raw inputs use source name `catalog:<normalized-locale>`." The NORMALIZED
    // tag, not the caller's map key, so two constructions that spell the same locale differently
    // produce the same diagnostics and the same warning records.
    catalogs.set(locale, parseCatalogInput(raw, locale, `catalog:${locale}`, session, options, warnings));
  }

  const supported = [...catalogs.keys()];
  const tiebreakers = safeTiebreakers(options.tiebreakers);

  // Refused at CONSTRUCTION, before the first lookup can hide the ambiguity behind an arbitrary
  // winner. `DefaultStrings` runs this check (DefaultStrings.java:395-430) and the port did not, so
  // `{ strings: { en, "en-US" } }` with no tiebreakers built an instance Java refuses outright.
  validateTiebreakers(supported, tiebreakers);

  // Eager, construction-time: what the catalogs actually ask for, and whether the caller supplied
  // it. Plan section 3.7 is explicit that missing optional data is a construction failure "not a
  // late lookup surprise", and the difference is observable — a lazy check would let an application
  // ship, serve a thousand keys, and only fail the first time a user's rank hit an ordinal branch.
  const pluralDataRuntime = resolvePluralData(options.pluralData, catalogs);

  // EAGER COMPILATION, and it is a behaviour rather than an optimisation. Java's `DefaultStrings`
  // constructor compiles every loaded expression — including the ones in branches no lookup will
  // ever reach — so a malformed or over-limit expression fails construction of the whole catalog
  // instead of the single lookup unlucky enough to touch it. Compiling lazily would pass the corpus
  // and lose that property.
  //
  // Keyed by the parsed alternative NODE, exactly as Java keys by the `LocalizedString` /
  // `ExpressionAlternative` instance. Identity, not expression text: two alternatives may spell the
  // same predicate and are still separate authoring sites.
  /** @type {Map<object, ReturnType<typeof compileExpression>>} */
  const compiledExpressions = new Map();

  for (const definitions of catalogs.values())
    for (const definition of definitions.values()) compileDefinitionExpressions(definition, compiledExpressions);

  /**
   * The services `render` cannot import for itself.
   *
   * `evaluateExpression` closes over the eagerly compiled expressions; the two plural classifiers
   * come off the optional data carriers the caller supplied. All three are per-instance, so two
   * `Strings` built from different catalogs never share a compiled expression by accident.
   *
   * @param {string} key
   * @param {string} candidate the SUPPLYING locale
   * @param {import("../internal/bidi.js").BidiIsolation} bidiIsolation
   * @returns {import("../internal/interpolate.js").RenderContext}
   */
  function renderContextFor(key, candidate, bidiIsolation) {
    return {
      key,
      evaluationLocale: candidate,
      // THE DONOR RULE, applied to isolation as well as to classification. Java hands `getInternal`
      // the `candidateLocale` (DefaultStrings.java:713) and `shouldApplyBidiIsolation` reads that,
      // so an Arabic request served by an English catalog is NOT isolated and an English request
      // served by an Arabic one IS. Passing `lookupLocale` here would get both backwards.
      isolateValues: shouldApplyBidiIsolation(bidiIsolation, candidate),
      /**
       * @param {object} alternative
       * @param {import("../internal/interpolate.js").Placeholders} values
       * @returns {boolean}
       */
      evaluateExpression: (alternative, values) => {
        const compiled = compiledExpressions.get(alternative);

        if (compiled === undefined)
          throw new Error("No compiled expression was found for this alternative");

        // The EVALUATION locale, not the requested one: `count == CARDINALITY_ONE` in a Polish
        // donor entry served to an English request must classify under Polish.
        //
        // The ordinal classifier travels WITH the call, not through module state. It belongs to
        // this instance's `pluralData`, so a second `Strings` built without ordinal data must not
        // inherit the ability to answer `rank == ORDINALITY_TWO` merely because this one exists.
        return evaluateCompiledExpression(compiled, values, candidate, {
          ordinalCategoryResolver: pluralDataRuntime.ordinalCategoryForOperands ?? null,
          // Same donor rule, same argument: `noun == PHONETIC_VOWEL` in an entry supplied by `en`
          // classifies the term under `en` even when the request was `zh-TW`.
          phoneticResolver,
        });
      },
      phoneticResolver,
      ...(pluralDataRuntime.ordinalityNameFor === undefined
        ? {}
        : { ordinalityNameFor: pluralDataRuntime.ordinalityNameFor }),
      ...(pluralDataRuntime.rangeCardinalityNameFor === undefined
        ? {}
        : { rangeCardinalityNameFor: pluralDataRuntime.rangeCardinalityNameFor }),
    };
  }

  /**
   * @param {string} key
   * @param {Readonly<Record<string, unknown>> | undefined} placeholders
   * @param {{ locale?: string, bidiIsolation?: import("../internal/bidi.js").BidiIsolation } | undefined} callOptions
   */
  function getResult(key, placeholders, callOptions) {
    const lookupLocale = normalizeTag(callOptions?.locale ?? ambientLocale);
    // REPLACES the instance policy rather than narrowing it, in both directions: per-call `"all"`
    // over an instance `"none"` isolates, and per-call `"none"` over an instance `"all"` does not.
    // `TranslationOptions.getBidiIsolation().orElse(getBidiIsolation())` (DefaultStrings.java:683).
    const bidiIsolation =
      callOptions?.bidiIsolation === undefined
        ? instanceBidiIsolation
        : validateBidiIsolation(callOptions.bidiIsolation, "get({ bidiIsolation })");

    // Channel one: the diagnostic. Computed for every lookup, never used to redirect the walk.
    const localeMatch = freeze(matchFor(lookupLocale, supported, fallbackLocale, tiebreakers));

    // Channel two: the resolution walk.
    const chain = candidateChain(lookupLocale, supported, fallbackLocale, tiebreakers);
    /** @type {string[]} */
    const attempted = [];
    /** @type {unknown} */
    let firstFailureCause = null;
    // A candidate that HELD the key and still produced nothing, because no alternative matched and
    // the selected node has no translation of its own. That is a different outcome from the key
    // being absent, and the default policy treats them differently, so it is tracked separately.
    let noMatchingAlternative = false;

    for (const candidate of chain) {
      attempted.push(candidate);
      const definition = catalogs.get(candidate)?.get(key);
      if (definition === undefined) continue;

      try {
        // The evaluation locale is the SUPPLYING candidate, not the requested tag. This one argument
        // is the donor rule, and passing `lookupLocale` here would be silently wrong for every
        // fallback-served plural, gender, and phonetic selection — and for every ALTERNATIVE, whose
        // `count == CARDINALITY_ONE` must classify under the donor too.
        const translation = render(
          definition,
          placeholders,
          renderContextFor(key, candidate, bidiIsolation),
        );

        // Java's `Optional.empty()`: the entry exists, but no alternative matched and the selected
        // node carries no translation. NOT a failure of this candidate — the default policy walks
        // PAST it to the next donor, so this must never be conflated with the throw below.
        if (translation === null) {
          noMatchingAlternative = true;
          continue;
        }

        return freeze({
          key,
          translation,
          status: /** @type {const} */ ("translated"),
          lookupLocale,
          localeMatch,
          resolvedLocale: candidate,
          attemptedLocales: freeze([...attempted]),
          isFallback: isFallbackFor(localeMatch, lookupLocale, candidate),
          failureReason: null,
          cause: null,
        });
      } catch (error) {
        // First cause wins, never the last: Java assigns `firstFallbackFailure` only while null.
        if (firstFailureCause === null) firstFailureCause = error;
        // The default policy halts on a resolution failure rather than walking past it, forfeiting
        // a donor that would have resolved. Policies are out of scope here; the corpus gates them.
        break;
      }
    }

    // Java's precedence, and the ORDER is not the order the attempts happened in: a resolution
    // failure anywhere outranks a no-match anywhere, which outranks the key simply being absent.
    const failureReason = firstFailureCause !== null
      ? /** @type {const} */ ("resolution-failure")
      : noMatchingAlternative
        ? /** @type {const} */ ("no-matching-alternative")
        : /** @type {const} */ ("missing-translation");

    // The failure key is interpolated under the REQUESTED locale, not a supplying one: by definition
    // no catalog supplied this entry (DefaultStrings.java:754 passes `locale`, not a candidate).
    return failure(key, lookupLocale, localeMatch, attempted, failureReason, firstFailureCause,
        placeholders, shouldApplyBidiIsolation(bidiIsolation, lookupLocale));
  }

  /**
   * @param {string} key
   * @param {Readonly<Record<string, unknown>>} [placeholders]
   * @param {{ locale?: string, bidiIsolation?: import("../internal/bidi.js").BidiIsolation }} [callOptions]
   */
  const get = (key, placeholders, callOptions) => getResult(key, placeholders, callOptions).translation;

  return freeze({
    get,
    t: get,
    getResult,
    getSupportedLocales: () => freeze([...supported]),
    getKeysForLocale: (/** @type {string} */ locale) =>
      freeze([...(catalogs.get(normalizeTag(locale))?.keys() ?? [])]),
    getLocaleConfiguration: () =>
      // `tiebreakers` is a RECORD here even when none were configured, per the `LocaleConfiguration`
      // declaration in plan 3.2, which types it `Readonly<Record<...>>` rather than nullable. Null
      // travels on internally because the matcher distinguishes "none" from "empty" in its own
      // bookkeeping; a reader of the configuration does not, and should not have to null-check a
      // map it is about to iterate.
      freeze({
        fallbackLocale,
        supportedLocales: freeze([...supported]),
        tiebreakers: tiebreakers ?? EMPTY_TIEBREAKERS,
      }),
    getCatalogIdentity: () => null,
    isCatalogComplete: () => true,
    getLoadVerification: () => null,
    getWarnings: () => freeze([...warnings]),
    /** The narrow, side-effect-free observation of core's automatic direct-locale path. */
    getDirectLocaleContext: (/** @type {string} */ locale) => {
      const lookupLocale = normalizeTag(locale);
      return freeze({
        lookupLocale,
        localeMatch: freeze(matchFor(lookupLocale, supported, fallbackLocale, tiebreakers)),
      });
    },
  });
}

/**
 * Pull the ordinal support probe off a `lokalized/data/ordinal` carrier, if one was supplied.
 *
 * Without it, ordinality gaps simply go unreported — the same trade `lokalized/parse` makes, and for
 * the same reason: the ordinal table is deliberately outside the ratcheted root graph, so this
 * module cannot import it and must be handed it.
 *
 * @param {unknown} carrier
 * @returns {((locale: string) => readonly string[]) | null}
 */
function ordinalitySupportProbe(carrier) {
  if (typeof carrier !== "object" || carrier === null) return null;

  const runtime = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (carrier))[PLURAL_DATA_RUNTIME];
  if (typeof runtime !== "object" || runtime === null) return null;

  const probe = /** @type {Record<string, unknown>} */ (runtime)["supportedOrdinalityNamesFor"];
  return typeof probe === "function" ? /** @type {(locale: string) => readonly string[]} */ (probe) : null;
}

/**
 * Snapshot the caller's tiebreaker map as a frozen, null-prototype record of frozen arrays.
 *
 * Plan 4.3 names tiebreaker output specifically among the "defensively copied, frozen null-prototype
 * record[s]", and both halves of that earn their place here. It is a SNAPSHOT because construction
 * is documented as snapshotting its inputs: holding the caller's object let `getLocaleConfiguration()`
 * report a list the caller had appended to afterwards, so an instance's own configuration could
 * change under it without any call into the library. It is NULL-PROTOTYPE because the keys are
 * language codes and the values locale tags, and a `constructor` key on an ordinary object would
 * otherwise collide with an inherited property.
 *
 * A `Map` is accepted alongside a record, per plan 3.2's `TiebreakerMap`, and is preferred when the
 * keys come from a generated or untrusted source.
 *
 * @param {Record<string, readonly string[]> | ReadonlyMap<string, readonly string[]> | null | undefined} supplied
 * @returns {Readonly<Record<string, readonly string[]>> | null}
 */
function safeTiebreakers(supplied) {
  if (supplied === null || supplied === undefined) return null;

  const entries = supplied instanceof Map ? [...supplied.entries()] : Object.entries(supplied);

  /** @type {Record<string, readonly string[]>} */
  const safe = Object.create(null);
  for (const [languageCode, locales] of entries) {
    if (!Array.isArray(locales))
      throw new TypeError(
        `createStrings({ tiebreakers }) must map a language code to an array of locale tags; ` +
          `'${languageCode}' maps to something else`,
      );

    safe[languageCode] = freeze([...locales]);
  }

  return freeze(safe);
}

/** Java's `List.toString()`, which every message copied below embeds verbatim. */
const javaList = (/** @type {readonly string[]} */ tags) => `[${tags.join(", ")}]`;

/**
 * Java's construction-time tiebreaker rules (DefaultStrings.java:395-430), which the port had been
 * missing entirely.
 *
 * A tiebreaker is not a preference. When two loaded catalogs share a language code — `en` and
 * `en-US`, or `mo` and `ro`, which are one language code because CLDR canonicalizes `mo` to `ro` —
 * nothing in the matcher can say which of them a broad `en` request should be served by, so Java
 * makes the caller say and REFUSES THE INSTANCE otherwise. Building anyway is the worse failure of
 * the two: the resolution order then falls out of catalog insertion order, silently, per lookup.
 *
 * Three rules, and the order between them is Java's:
 *
 *   - a supplied language code with no loaded locale at all is a mistake, not a no-op;
 *   - a supplied list must be an exact permutation of that language code's loaded locales, so a
 *     later-added catalog cannot quietly inherit last place — which is also why an EMPTY list
 *     reports the permutation failure rather than the missing-tiebreaker one;
 *   - only then, a language code with more than one loaded locale and nothing supplied is refused.
 *
 * The identity case is the reason the third rule is not simply "every language code needs one":
 * where exactly one locale carries a language code, Java synthesizes that one-element list as its
 * own tiebreaker. `resolveTiebreakers` in the locale kernel already derives the same entries when it
 * consults this map, so there is nothing for this function to carry forward — only a case it must
 * not reject.
 *
 * No corpus fixture reaches here: every constructing fixture that loads two locales sharing a
 * language code also supplies tiebreakers, and the four that do not are `loadOnly`, so Java never
 * built an instance for them either. The rules above were read off the real `DefaultStrings` on the
 * pinned JDK, message by message.
 *
 * @param {readonly string[]} supported the loaded catalogs' normalized tags, in supplied order
 * @param {Readonly<Record<string, readonly string[]>> | null} tiebreakers the frozen snapshot
 */
function validateTiebreakers(supported, tiebreakers) {
  /** @type {Map<string, string[]>} */
  const loadedByLanguageCode = new Map();

  for (const tag of supported) {
    const languageCode = primaryLanguage(tag);

    // Private-use and undetermined tags have no primary-language matching semantics. They can be
    // selected exactly, but two of them do not create the broad-language ambiguity a tiebreaker
    // resolves — so `x-a` beside `x-b` is a legal instance, and `LocaleUtils.normalizedLanguage`
    // returning nothing is how Java says so.
    if (languageCode.length === 0) continue;

    const loaded = loadedByLanguageCode.get(languageCode);

    if (loaded === undefined) loadedByLanguageCode.set(languageCode, [tag]);
    else loaded.push(tag);
  }

  /** @type {Set<string>} */
  const configuredLanguageCodes = new Set();

  for (const [suppliedLanguageCode, locales] of Object.entries(tiebreakers ?? {})) {
    // The SAME key normalization `resolveTiebreakers` applies when it reads this map, so a code
    // that validates here is a code that matching will actually find. `mo` and `ro` are one entry
    // to both.
    const languageCode = primaryLanguage(suppliedLanguageCode) || suppliedLanguageCode.toLowerCase();
    const loaded = loadedByLanguageCode.get(languageCode);

    if (loaded === undefined)
      throw new RangeError(`Tiebreaker language code '${languageCode}' has no localized strings locales`);

    configuredLanguageCodes.add(languageCode);

    // Normalized before comparison because Java compares `Locale` instances and not the caller's
    // spelling: `en-us` and `en-US` are one locale to `Locale.forLanguageTag`, and an instance Java
    // builds must not be refused here over a lowercase region. An ill-formed tag raises
    // `normalizeTag`'s own error, where Java raises `requireWellFormed`'s.
    const provided = new Set(locales.map(normalizeTag));
    const missing = loaded.filter((tag) => !provided.has(tag)).sort();
    const unrelated = [...provided].filter((tag) => !loaded.includes(tag)).sort();

    if (missing.length > 0 || unrelated.length > 0)
      throw new RangeError(
        `Tiebreaker locales for language code '${languageCode}' must be an exact permutation of ` +
          `loaded locales ${javaList([...loaded].sort())}; missing: ${javaList(missing)}; ` +
          `unrelated: ${javaList(unrelated)}`,
      );
  }

  for (const [languageCode, loaded] of loadedByLanguageCode) {
    // Exactly one loaded locale IS its own tiebreaker, in identity order.
    if (loaded.length === 1 || configuredLanguageCodes.has(languageCode)) continue;

    // Java's message names `tiebreakerLocalesByLanguageCode`, its constructor parameter. Only that
    // half is reworded to the option a JavaScript caller actually has, on the same rule that keeps
    // `THROWING_PHONETIC_RESOLVER` from pointing at `Strings.Builder`; the diagnosis the message
    // carries — which language code, and which locales collided under it — is Java's verbatim.
    throw new RangeError(
      `You must specify tiebreaker locales via createStrings({ tiebreakers }) to resolve ambiguity ` +
        `for language code '${languageCode}' because localized strings exist for the following ` +
        `locale[s]: ${javaList([...loaded].sort())}`,
    );
  }
}

/** The frozen, null-prototype empty record `getLocaleConfiguration()` reports when none were set. */
const EMPTY_TIEBREAKERS = freeze(Object.create(null));

/**
 * Plan section 3.2's `CatalogMap`, as entries in supplied order.
 *
 * A `ReadonlyMap` is one of the two declared spellings, and it has to be recognized HERE rather than
 * left to `Object.entries`: a `Map` has no own enumerable string properties, so `Object.entries`
 * returns `[]` and the construction succeeds with no catalogs at all. Every lookup then returns its
 * own key, which reads as a translation-not-found rather than as a catalog that was never seen —
 * the ignored-input-produces-a-plausible-answer failure with nothing to debug from.
 *
 * A value that is neither spelling is REFUSED rather than coerced. `Object.entries` on a string or
 * an array yields index keys, so `strings: [...]` — the shape of one catalog rather than of a map of
 * them, and an easy slip now that a catalog may itself be an array — otherwise fails much later as
 * an unrelated complaint that the locale tag `'0'` is malformed.
 *
 * @param {Record<string, unknown> | ReadonlyMap<string, unknown>} strings
 * @returns {[string, unknown][]}
 */
function catalogEntries(strings) {
  if (strings instanceof Map) return [...strings.entries()];

  if (strings === null || typeof strings !== "object" || Array.isArray(strings))
    throw new TypeError(
      "createStrings({ strings }) must be a record or a Map of locale tag to catalog; a single " +
        "catalog must be supplied under the locale tag it is written for",
    );

  return Object.entries(strings);
}

/** A value carrying the `ParsedStringsFile` discriminator from plan section 3.2. */
const isParsedStringsFile = (/** @type {unknown} */ value) =>
  typeof value === "object" && value !== null &&
  /** @type {{ $lokalized?: unknown }} */ (value).$lokalized === "parsed-strings-file";

/**
 * One entry of `strings`, in whichever of plan 3.2's `CatalogInput` forms it arrived, as the model.
 *
 * Four forms, and the split between them is about what each one still HAS to be checked, not about
 * convenience:
 *
 *   - text and bytes still carry their source, so they alone can be held to fatal UTF-8, duplicate
 *     JSON members at every path, and the byte/character/nesting boundaries;
 *   - a `ParsedStringsFile` was already held to all of that by whoever parsed it, and arrives with
 *     the warnings that parse produced — which are REPLAYED rather than recomputed, because they
 *     name the sources the file was merged from and this construction no longer knows them;
 *   - a `LocalizedStringInput[]` never had a source at all: plan 4.1 gives it "model/schema
 *     validation and node limits, not source-level guarantees";
 *   - a decoded plain object is the same deal with the members spelled as a document.
 *
 * Every form shares the load's `session`, so the file, node and warning budgets are the load's and
 * not each catalog's.
 *
 * @param {unknown} raw
 * @param {string} locale the normalized tag this catalog is keyed by
 * @param {string} source
 * @param {LoadingSession} session
 * @param {CreateStringsOptions} options
 * @param {LocalizedStringWarning[]} warnings collected in supplied-catalog order
 * @returns {Map<string, Definition>}
 */
function parseCatalogInput(raw, locale, source, session, options, warnings) {
  /** @param {LocalizedStringWarning} warning */
  const admit = (warning) => {
    // Through the session, so a busted warning budget REFUSES the warning rather than delivering it
    // and failing afterwards.
    session.warn(warning, (admitted) => {
      warnings.push(/** @type {LocalizedStringWarning} */ (admitted));
      options.onWarning?.(/** @type {LocalizedStringWarning} */ (admitted));
    });
  };

  const onRootParsed = incompleteLanguageFormReporter({
    source,
    locale,
    supportedOrdinalityNamesFor: ordinalitySupportProbe(options.pluralData?.ordinal),
    emit: admit,
  });

  if (typeof raw === "string" || raw instanceof Uint8Array)
    return parseCatalogSource(raw, { locale, source, session, onRootParsed });

  if (isParsedStringsFile(raw)) {
    const file = /** @type {{ locale: string, strings: unknown, warnings?: readonly LocalizedStringWarning[] }} */ (raw);

    // Plan 3.2: "A map key and a `ParsedStringsFile.locale` must be the same normalized loaded tag."
    // Silently trusting the map key would let a `fr` catalog be served as `de`, and every plural,
    // gender and phonetic selection under it would then classify against the wrong language.
    if (normalizeTag(file.locale) !== locale)
      throw new RangeError(
        `Localized strings for '${source}' were parsed for locale '${file.locale}', which does ` +
          `not match the key they are supplied under`,
      );

    const definitions = parseModelCatalog(/** @type {readonly unknown[]} */ (file.strings), {
      locale,
      source,
      session,
    });

    for (const warning of file.warnings ?? []) admit(warning);
    return definitions;
  }

  if (Array.isArray(raw)) return parseModelCatalog(raw, { locale, source, session, onRootParsed });

  return parseCatalog(raw, { locale, source, session, onRootParsed });
}

/**
 * Compiles every expression reachable from one parsed definition, in Java's order.
 *
 * `DefaultStrings.compileExpressions` walks a node's PLACEHOLDER definitions before its whole-message
 * alternatives, then recurses into each alternative branch. The order is not cosmetic: when a
 * catalog contains more than one broken expression, it decides which one the construction failure
 * names.
 *
 * @param {Definition} definition
 * @param {Map<object, ReturnType<typeof compileExpression>>} compiled
 * @returns {void}
 */
function compileDefinitionExpressions(definition, compiled, visited = new Set()) {
  // Guarded by node IDENTITY, because a programmatically supplied catalog is an object graph rather
  // than a tree: plan 3.6 permits a shared alternative subtree, and `parseModelCatalog` preserves
  // the sharing instead of expanding it. Re-walking a diamond is exponential in its depth, so a
  // legal 40-deep shared graph would hang construction here without this. Parsed catalogs allocate
  // a fresh node per occurrence, so for them the guard never fires.
  if (visited.has(definition)) return;
  visited.add(definition);

  for (const placeholder of definition.placeholders.values()) {
    if (placeholder.kind !== "expression") continue;

    for (const alternative of placeholder.alternatives)
      if (!compiled.has(alternative)) compiled.set(alternative, compileExpression(alternative.expression));
  }

  for (const alternative of definition.alternatives) {
    if (!compiled.has(alternative)) compiled.set(alternative, compileExpression(alternative.expression));

    compileDefinitionExpressions(alternative.definition, compiled, visited);
  }
}

/**
 * The classifiers an optional plural-data carrier hands over.
 *
 * @typedef {object} PluralDataRuntime
 * @property {(value: unknown, locale: string) => string} [ordinalityNameFor]
 * @property {(operands: import("../internal/plural.js").Operands, locale: string) => string} [ordinalCategoryForOperands]
 * @property {(startName: string, endName: string, locale: string) => string} [rangeCardinalityNameFor]
 */

/** An `ORDINALITY_*` constant used as an expression operand. */
const ORDINALITY_CONSTANT = /\bORDINALITY_[A-Z]+\b/;

/**
 * What a set of parsed catalogs actually asks the optional plural modules for.
 *
 * Walks every definition, every whole-message alternative branch, and every placeholder definition
 * inside each of those. Unreachable branches count: a branch's reachability depends on runtime
 * values, so "this catalog can ask an ordinal question" is the only property that can be settled at
 * construction, and it is the property the plan requires be settled there.
 *
 * @param {Map<string, Map<string, Definition>>} catalogs
 * @returns {{ ordinality: boolean, ranges: boolean }}
 */
function pluralDataNeededBy(catalogs) {
  let ordinality = false;
  let ranges = false;

  /** @type {Set<Definition>} */
  const visited = new Set();

  /** @param {Definition} definition */
  const visit = (definition) => {
    // Identity-guarded for the same reason the compile walk is: a programmatic catalog may share a
    // subtree, and re-answering "does this ask an ordinal question" for a diamond is exponential.
    if (visited.has(definition)) return;
    visited.add(definition);

    for (const placeholder of definition.placeholders.values()) {
      if (placeholder.kind === "expression") {
        // An EXPRESSION can ask an ordinal question too — `position == ORDINALITY_TWO` classifies a
        // number — and that use must be detected here or it becomes exactly the late lookup surprise
        // the contract forbids. A textual scan is exact for this grammar: the 61 language-form names
        // are reserved identifiers, so `ORDINALITY_TWO` in an expression cannot be a variable, and
        // the language has no string literals for it to hide in.
        for (const alternative of placeholder.alternatives)
          if (ORDINALITY_CONSTANT.test(alternative.expression)) ordinality = true;

        continue;
      }

      if (placeholder.axis === "ordinality") ordinality = true;
      if (placeholder.range !== null) ranges = true;
    }

    for (const alternative of definition.alternatives) {
      if (ORDINALITY_CONSTANT.test(alternative.expression)) ordinality = true;

      visit(alternative.definition);
    }
  };

  for (const definitions of catalogs.values()) for (const definition of definitions.values()) visit(definition);

  return { ordinality, ranges };
}

/**
 * Validates one supplied optional data carrier and extracts its runtime capability.
 *
 * @param {unknown} carrier
 * @param {string} discriminator the carrier's declared `$lokalized` tag
 * @param {string} subpath the npm subpath that exports it, for the diagnostic
 * @returns {Record<string, unknown>}
 */
function pluralDataCapabilityOf(carrier, discriminator, subpath) {
  if (typeof carrier !== "object" || carrier === null)
    throw new RangeError(`pluralData value for '${subpath}' must be the module's exported data object`);

  const tagged = /** @type {Record<string | symbol, unknown>} */ (carrier);

  // A WRONG-AXIS module is its own diagnosis, and a likely one: `{ ordinal: cardinalRangeData }` is
  // a plausible slip, and without this check it would fail much later as a missing capability.
  if (tagged["$lokalized"] !== discriminator)
    throw new RangeError(
      `pluralData value for '${subpath}' must be a '${discriminator}' value but was ` +
        `'${String(tagged["$lokalized"])}'`,
    );

  const capability = tagged[PLURAL_DATA_RUNTIME];

  if (typeof capability !== "object" || capability === null)
    throw new RangeError(
      `pluralData value for '${subpath}' carries no runtime capability; it was not produced by ` +
        "this version of the module",
    );

  return /** @type {Record<string, unknown>} */ (capability);
}

/**
 * Reconciles the optional plural data the caller supplied with what the catalogs need.
 *
 * Both directions are checked, and only one of them is the interesting one. Data that is NEEDED and
 * missing fails construction — that is the contract. Data that is supplied and unneeded is fine and
 * is simply carried, because a catalog that gains an ordinal branch later should not also require an
 * application change.
 *
 * @param {{ ordinal?: unknown, ranges?: unknown } | undefined} supplied
 * @param {Map<string, Map<string, Definition>>} catalogs
 * @returns {PluralDataRuntime}
 */
function resolvePluralData(supplied, catalogs) {
  const needed = pluralDataNeededBy(catalogs);
  /** @type {PluralDataRuntime} */
  const runtime = {};

  if (supplied?.ordinal !== undefined && supplied.ordinal !== null) {
    const capability = pluralDataCapabilityOf(supplied.ordinal, "ordinal-data", "lokalized/data/ordinal");
    const classify = capability["ordinalityNameFor"];
    if (typeof classify !== "function")
      throw new RangeError("pluralData.ordinal does not provide an ordinal classifier");
    runtime.ordinalityNameFor = /** @type {(value: unknown, locale: string) => string} */ (classify);

    // The expression evaluator classifies numbers into ordinal categories through its own seam,
    // which takes plural OPERANDS rather than a caller value. Same optional table, same reason it
    // cannot be imported here; carrying it is what makes `position == ORDINALITY_TWO` answerable.
    // It is held PER INSTANCE and handed to each evaluation, never registered on the module.
    const categorize = capability["ordinalCategoryForOperands"];

    if (typeof categorize === "function")
      runtime.ordinalCategoryForOperands =
        /** @type {(operands: import("../internal/plural.js").Operands, locale: string) => string} */ (categorize);
  }

  if (supplied?.ranges !== undefined && supplied.ranges !== null) {
    const capability = pluralDataCapabilityOf(supplied.ranges, "cardinal-range-data", "lokalized/data/ranges");
    const classify = capability["rangeCardinalityNameFor"];
    if (typeof classify !== "function")
      throw new RangeError("pluralData.ranges does not provide a cardinal-range classifier");
    runtime.rangeCardinalityNameFor =
      /** @type {(startName: string, endName: string, locale: string) => string} */ (classify);
  }

  if (needed.ordinality && runtime.ordinalityNameFor === undefined)
    throw new RangeError(
      "These localized strings select on ORDINALITY_*, which needs the optional ordinal data. " +
        "Pass it as createStrings({ pluralData: { ordinal: ordinalData } }) with ordinalData " +
        "imported from 'lokalized/data/ordinal'",
    );

  if (needed.ranges && runtime.rangeCardinalityNameFor === undefined)
    throw new RangeError(
      "These localized strings use a range-driven cardinality placeholder, which needs the " +
        "optional cardinal-range data. Pass it as createStrings({ pluralData: { ranges: " +
        "cardinalRangeData } }) with cardinalRangeData imported from 'lokalized/data/ranges'",
    );

  return runtime;
}

/**
 * @param {string} key
 * @param {string} lookupLocale
 * @param {unknown} localeMatch
 * @param {string[]} attempted
 * @param {"missing-translation" | "no-matching-alternative" | "resolution-failure"} failureReason
 * @param {unknown} cause
 * @param {Readonly<Record<string, unknown>> | undefined} placeholders
 * @param {boolean} isolateValues decided in `getResult` from the REQUESTED locale
 */
function failure(key, lookupLocale, localeMatch, attempted, failureReason, cause, placeholders,
    isolateValues) {
  // Fail-soft, and the KEY IS A TEMPLATE. Keys routinely contain placeholders — `Farewell {{name}}`
  // — and Java interpolates the returned key with the caller's values rather than emitting the raw
  // braces. Returning the key verbatim looks correct until a real catalog has a templated key.
  //
  // The SAME scanner the renderer uses, in its lenient mode, rather than a regex over `{{…}}`. The
  // difference is not cosmetic: escapes are mode-INDEPENDENT, so `\\`, `\}}` and `\{{` are processed
  // in a returned key exactly as in a translation, and an escaped opening swallows everything
  // through the next `}}` — including a real, bound placeholder. A regex that only knows about
  // well-formed tokens gets every one of those wrong while looking right on the common case.
  const translation = interpolateFailureKey(key, placeholders, isolateValues);

  return freeze({
    key,
    translation,
    status: /** @type {const} */ ("returned-key"),
    lookupLocale,
    localeMatch,
    resolvedLocale: null,
    attemptedLocales: freeze([...attempted]),
    isFallback: isFallbackFor(/** @type {any} */ (localeMatch), lookupLocale, null),
    failureReason,
    cause: cause ?? null,
  });
}
