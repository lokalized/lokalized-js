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
import { parseCatalog } from "../internal/catalog.js";
import { isValidIdentifier, render } from "../internal/interpolate.js";
import { equivalentTags } from "../internal/locale-cldr.js";
import { candidateChain, matchFor, normalizeTag } from "../internal/locale.js";

/** @typedef {import("../internal/catalog.js").Definition} Definition */

/**
 * @typedef {object} CreateStringsOptions
 * @property {string} fallbackLocale
 * @property {Record<string, unknown>} strings raw catalogs keyed by locale tag
 * @property {string} [locale] the ambient locale; required until localeResolver lands
 * @property {Record<string, string[]> | null} [tiebreakers]
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

  /** @type {Map<string, Map<string, Definition>>} */
  const catalogs = new Map();
  for (const [tag, raw] of Object.entries(options.strings)) {
    const locale = normalizeTag(tag);
    if (catalogs.has(locale))
      throw new RangeError(`Duplicate localized strings for locale '${locale}'`);
    catalogs.set(locale, parseCatalog(raw, { locale, source: tag }));
  }

  const supported = [...catalogs.keys()];
  const tiebreakers = options.tiebreakers ?? null;

  /**
   * @param {string} key
   * @param {Readonly<Record<string, unknown>> | undefined} placeholders
   * @param {{ locale?: string } | undefined} callOptions
   */
  function getResult(key, placeholders, callOptions) {
    const lookupLocale = normalizeTag(callOptions?.locale ?? ambientLocale);

    // Channel one: the diagnostic. Computed for every lookup, never used to redirect the walk.
    const localeMatch = freeze(matchFor(lookupLocale, supported, fallbackLocale, tiebreakers));

    // Channel two: the resolution walk.
    const chain = candidateChain(lookupLocale, supported, fallbackLocale, tiebreakers);
    /** @type {string[]} */
    const attempted = [];
    /** @type {unknown} */
    let firstFailureCause = null;

    for (const candidate of chain) {
      attempted.push(candidate);
      const definition = catalogs.get(candidate)?.get(key);
      if (definition === undefined) continue;

      try {
        // The evaluation locale is the SUPPLYING candidate, not the requested tag. This one argument
        // is the donor rule, and passing `lookupLocale` here would be silently wrong for every
        // fallback-served plural, gender, and phonetic selection.
        const translation = render(definition, placeholders, { key, evaluationLocale: candidate });
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
        // The default policy halts on a resolution failure rather than walking past it. Policies are
        // M2-out-of-scope, so only the default is implemented; the corpus gates the rest.
        return failure(key, lookupLocale, localeMatch, attempted, "resolution-failure", firstFailureCause,
            placeholders);
      }
    }

    return failure(key, lookupLocale, localeMatch, attempted, "missing-translation", null,
        placeholders);
  }

  /**
   * @param {string} key
   * @param {Readonly<Record<string, unknown>>} [placeholders]
   * @param {{ locale?: string }} [callOptions]
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
      freeze({ fallbackLocale, supportedLocales: freeze([...supported]), tiebreakers }),
    getCatalogIdentity: () => null,
    isCatalogComplete: () => true,
    getLoadVerification: () => null,
    getWarnings: () => freeze([]),
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
 * Interpolate a returned key LENIENTLY.
 *
 * The strict renderer is wrong here. A failure key is not a catalog entry the author controls — it is
 * whatever string the caller passed — so anything unresolvable stays literal instead of raising:
 *
 *   `Malformed {{2name}} for {{name}}` + {name}      -> `Malformed {{2name}} for Sarah`
 *   `Hi {{name}} and {{other`         + {name}      -> `Hi Sarah and {{other`
 *   `{{greeting}}, {{name}}!`         + {name}      -> `{{greeting}}, Sarah!`
 *
 * Substituting only well-formed, supplied tokens and leaving the rest alone is what makes the
 * fail-soft path fail soft; throwing here would turn a missing translation into a broken render.
 *
 * @param {string} key
 * @param {Readonly<Record<string, unknown>> | undefined} placeholders
 */
function interpolateFailureKey(key, placeholders) {
  if (placeholders === undefined || placeholders === null) return key;
  return key.replace(/\{\{([^{}]*)\}\}/g, (token, name) => {
    if (!isValidIdentifier(name)) return token;
    if (!Object.prototype.hasOwnProperty.call(placeholders, name)) return token;
    const value = placeholders[name];
    return value === null || value === undefined ? token : String(value);
  });
}

/**
 * @param {string} key
 * @param {string} lookupLocale
 * @param {unknown} localeMatch
 * @param {string[]} attempted
 * @param {"missing-translation" | "no-matching-alternative" | "resolution-failure"} failureReason
 * @param {unknown} cause
 * @param {Readonly<Record<string, unknown>> | undefined} placeholders
 */
function failure(key, lookupLocale, localeMatch, attempted, failureReason, cause, placeholders) {
  // Fail-soft, and the KEY IS A TEMPLATE. Keys routinely contain placeholders — `Farewell {{name}}`
  // — and Java interpolates the returned key with the caller's values rather than emitting the raw
  // braces. Returning the key verbatim looks correct until a real catalog has a templated key.
  //
  // Interpolation of the failure key is evaluated under the REQUESTED locale, not a supplying one:
  // by definition no catalog supplied this entry.
  const translation = interpolateFailureKey(key, placeholders);

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
