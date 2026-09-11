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
import { configurationError } from "../internal/configuration-error.js";
import { optionsFromLoadedStrings } from "../internal/loaded-input.js";
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
  ExpressionEvaluationError,
  compile as compileExpression,
  evaluate as evaluateCompiledExpression,
} from "../internal/expression.js";
import { interpolateFailureKey, render } from "../internal/interpolate.js";
import { canonicalLanguageTag, equivalentTags } from "../internal/locale-cldr.js";
import {
  javaSplit,
  jdkLocaleWellFormed,
  LOCALE_INGRESS_DESCRIPTION,
  requireJdkWellFormedLocale,
} from "../internal/locale-jdk-tag.js";
import {
  candidateChain,
  compareTags,
  matchFor,
  normalizedLanguageCode,
  normalizeTag,
  primaryLanguage,
  resolveTiebreakers,
} from "../internal/locale.js";
import { incompleteLanguageFormReporter } from "../internal/parse-warnings.js";
import { PLURAL_DATA_RUNTIME, UnsupportedLocaleError } from "../internal/plural.js";

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
 * @property {CatalogIdentity | null} [catalogIdentity] plan 3.4:635's build-produced identity for a
 *   DIRECT construction. Core validates its shape, not its truth, and reports it from
 *   `getCatalogIdentity()`; it does not make the instance stampable, because plan 6.4 requires a
 *   verified `LoadedStrings` and a shape-valid identity is exactly what that rule exists to refuse.
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
 * @property {BuiltinFallbackPolicy | FallbackPolicy} [fallbackPolicy] plan section 2.5's
 *   per-candidate continuation decision. `== null` means unset and selects `"missing-or-no-match"`,
 *   the same defaulting `bidiIsolation` uses and for the same reason (`DefaultStrings.java:473`
 *   substitutes the built-in when handed null, so an explicit null and an omitted option are one
 *   state in Java and must be one state here).
 * @property {FailureHandler} [onFailure] plan section 3.5's final-failure handler, consulted EXACTLY
 *   ONCE and only after the walk has ended with nothing. `== null` selects the library default,
 *   which returns the interpolated key (`DefaultStrings.java:472`).
 * @property {FallbackObserver} [onFallback] plan sections 3.2/3.5's fallback OBSERVER, called at
 *   most once per lookup — after a LATER candidate has produced a translation and before that
 *   translation is returned. It has NO Java counterpart: `DefaultStrings` discards each candidate's
 *   failure the moment a later one succeeds, so nothing in the corpus can check this and the tests
 *   in `test/fallback-observer.test.js` are the specification's only enforcement. `== null` means
 *   "no observer" rather than a library default, because there is no sensible default observation.
 * @property {() => string} [localeResolver] plan section 3.2's ambient locale ingress, Java's
 *   `localeSupplier` (`DefaultStrings.java:2456`). Consulted per lookup, never at construction. The
 *   value it returns is the REQUESTED tag and stays the `lookupLocale`; the diagnostic match is
 *   computed from it. Takes no matcher argument — plan 3.2: "callers that need negotiation close
 *   over a `LocaleNegotiator` from `lokalized/negotiate`".
 * @property {() => LocaleMatch} [localeMatchResolver] plan section 3.2's negotiation ingress, Java's
 *   `localeMatchSupplier` (`DefaultStrings.java:2447`). Consulted per lookup. Its SELECTION, or the
 *   match's own fallback when unmatched, REPLACES the lookup locale — the asymmetry against
 *   `localeResolver` that the one-fixture six-ingress table exists to pin.
 */

/**
 * @typedef {"missing-translation" | "no-matching-alternative" | "resolution-failure"} FailureReason
 * @typedef {"missing-or-no-match" | "any-failure" | "never"} BuiltinFallbackPolicy
 * @typedef {(reason: FailureReason, attemptedLocale: string, cause: unknown) => boolean} FallbackPolicy
 * @typedef {{ action: "return-key" } | { action: "return-string", translation: string } | { action: "throw" }} FailureResponse
 * @typedef {(failure: TranslationFailure) => FailureResponse} FailureHandler
 * @typedef {{ range: string, weight: number }} WeightedLanguageRange
 * @typedef {{ matchType: string, locale: string | null, isMatch: boolean, fallbackLocale: string,
 *   consideredLocales: readonly string[], effectiveWeight: number | null,
 *   languageRange: string | WeightedLanguageRange | null,
 *   requestedLanguageRanges: readonly WeightedLanguageRange[] }} LocaleMatch
 * @typedef {Readonly<{ key: string, lookupLocale: string, localeMatch: unknown,
 *   attemptedLocales: readonly string[], placeholders: Readonly<Record<string, unknown>>,
 *   reason: FailureReason, cause: unknown, message: string }>} TranslationFailure
 * @typedef {Readonly<{ locale: string, reason: FailureReason, cause: unknown }>} PrecedingFailure
 * @typedef {Readonly<{ key: string, lookupLocale: string, localeMatch: unknown,
 *   attemptedLocales: readonly string[], resolvedLocale: string,
 *   precedingFailures: readonly PrecedingFailure[] }>} FallbackEvent
 * @typedef {(event: FallbackEvent) => void} FallbackObserver
 * @typedef {{ locale?: string, localeMatch?: LocaleMatch,
 *   bidiIsolation?: import("../internal/bidi.js").BidiIsolation,
 *   fallbackPolicy?: BuiltinFallbackPolicy | FallbackPolicy | null,
 *   onFailure?: FailureHandler | null,
 *   onFallback?: FallbackObserver | null }} TranslationCallOptions
 */

/**
 * The three loading types core itself names, transcribed from plan 2.2's declaration block (:465-496).
 *
 * THEY ARE DECLARED HERE AND NOT IMPORTED FROM `lokalized/load` ON PURPOSE. Core must not import that
 * subpath — it is a ~690 KB delivery graph and the root module-count ratchet exists to keep it out —
 * and plan 3.4:713 states the reason a shared nominal type would be wrong anyway: the record "is
 * STRUCTURAL rather than branded, so a `Strings` value created by one installed copy or direct-browser
 * entry remains usable by `lokalized/ssr` from another copy". Two structurally identical declarations
 * in two subpaths is the intended shape, not duplication to be tidied away.
 *
 * @typedef {Readonly<{ catalogVersion: string, catalogFingerprint: string }>} CatalogIdentity
 * @typedef {Readonly<{ kind: "lookup", lookupLocale: string }>
 *   | Readonly<{ kind: "entire-manifest" }>} StringsLoadCoverage
 * @typedef {Readonly<{ fallbackLocale: string, supportedLocales: readonly string[],
 *   tiebreakers: Readonly<Record<string, readonly string[]>> }>} LocaleConfiguration
 * @typedef {Readonly<{ source: "verified-manifest-v1", producerImplementation: "lokalized-js",
 *   producerVersion: string, manifestLocaleConfiguration: LocaleConfiguration,
 *   catalogIdentity: CatalogIdentity, cldrVersion: string, dataFingerprint: string,
 *   ianaRegistryDate: string, ianaDataFingerprint: string, behavioralVectorsVersion: string,
 *   localeDataMode: "pinned", cardinalityMode: "exact", coverage: StringsLoadCoverage,
 *   plannedLocales: readonly string[], coveredLocales: readonly string[],
 *   complete: boolean }>} StringsLoadVerification
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
 * JAVA'S SHAPE, WITH BOTH IDENTIFIERS SUBSTITUTED AND NOTHING ELSE ADDED. Java's default resolver
 * raises `No PhoneticResolver was configured. Provide one via Strings.Builder#phoneticResolver(...)`
 * (`DefaultStrings.java:76-79`). `PhoneticResolver` is a Java INTERFACE this port does not have —
 * the JS surface is the `phoneticResolver` option — and `Strings.Builder` is a fluent builder the JS
 * API replaced with an object literal, so both slots must be respelled; advice a JS caller cannot
 * follow is worse than a divergence, which is the rule `createStrings({ tiebreakers })` follows too.
 *
 * NEITHER RESPELLING LICENSED THE TRAILING CLAUSE this used to append — `to classify the term
 * supplied for locale '...'`. Java composes this message from a STATIC string with no locale in it
 * at all, so that clause was the port diverging further than the two identifiers require, on top of
 * a divergence it had to have. It is gone, and what remains is declared with exactly that argument
 * in `DECLARED_CAUSE_MESSAGE_DIVERGENCES` (`tools/conformance.mjs`), which pins this string
 * byte-for-byte and fails the run if it drifts.
 *
 * @param {string} term
 * @param {string} locale
 * @returns {never}
 */
// eslint-disable-next-line no-unused-vars -- the PhoneticResolver signature, not this body's needs.
function THROWING_PHONETIC_RESOLVER(term, locale) {
  throw new Error(
    "No phoneticResolver was configured. Provide one via createStrings({ phoneticResolver })",
  );
}

/**
 * Plan section 3.5's three failure responses.
 *
 * DISCRIMINATED STRUCTURALLY — the plan says outright that "correctness never depends on singleton
 * identity", so a handler returning `{ action: "return-key" }` written by hand is treated exactly
 * as one returning this constant. The constants exist so the common cases are allocation-free and
 * spelled once; the dispatch in `getResult` reads `.action` and never compares by reference.
 */
export const RETURN_KEY = freeze({ action: /** @type {const} */ ("return-key") });
export const THROW_EXCEPTION = freeze({ action: /** @type {const} */ ("throw") });

/**
 * `TranslationFailureResponse.returnString(...)`.
 *
 * The string is returned VERBATIM — not interpolated and not bidi-isolated, which is the whole
 * difference between this response and `RETURN_KEY`. The corpus pins both halves against one
 * another: `bidi-isolation.failure-response.return-string-is-not-interpolated-or-isolated` records
 * `Fallback for {{name}}` with the braces intact while its `return-key` neighbour records
 * `Farewell ⁨Sarah⁩` with the isolate controls in place.
 *
 * @param {string} translation
 */
export function returnString(translation) {
  if (typeof translation !== "string")
    throw new TypeError(
      `returnString(translation) requires a string; received ${JSON.stringify(translation)}`,
    );

  return freeze({ action: /** @type {const} */ ("return-string"), translation });
}

/**
 * `DefaultTranslationFallbackPolicy`'s three members (TranslationFallbackPolicy.java).
 *
 * `missing-or-no-match` is the library default and is the one that FORFEITS A REACHABLE
 * TRANSLATION: it halts the walk on a resolution failure even when a later candidate holds a
 * perfectly good entry for the key. That is Java's behavior, it is measured, and it is not a bug to
 * be smoothed over — `fallback-policy.handler.return-string-not-used-when-policy-reaches-donor`
 * exists precisely to show the same lookup succeeding once the policy is widened to `any-failure`.
 *
 * A null prototype so `Object.hasOwn` is not the only thing standing between a caller writing
 * `fallbackPolicy: "toString"` and a policy that is the Function prototype's method.
 */
const BUILTIN_FALLBACK_POLICIES = freeze(
  Object.assign(Object.create(null), {
    "missing-or-no-match": (/** @type {FailureReason} */ reason) => reason !== "resolution-failure",
    "any-failure": () => true,
    never: () => false,
  }),
);

/** @type {FallbackPolicy} */
const DEFAULT_FALLBACK_POLICY = BUILTIN_FALLBACK_POLICIES["missing-or-no-match"];

/** `TranslationFailureHandler.returnKey()` (DefaultStrings.java:472). @type {FailureHandler} */
const DEFAULT_FAILURE_HANDLER = () => RETURN_KEY;

/**
 * @param {unknown} policy
 * @param {string} where
 * @returns {FallbackPolicy}
 */
function validateFallbackPolicy(policy, where) {
  if (typeof policy === "function") return /** @type {FallbackPolicy} */ (policy);
  if (typeof policy === "string" && Object.hasOwn(BUILTIN_FALLBACK_POLICIES, policy))
    return BUILTIN_FALLBACK_POLICIES[policy];

  throw new RangeError(
    `${where} must be a function or one of 'missing-or-no-match', 'any-failure', or 'never' but ` +
      `was ${JSON.stringify(policy)}`,
  );
}

/**
 * @param {unknown} handler
 * @param {string} where
 * @returns {FailureHandler}
 */
function validateFailureHandler(handler, where) {
  if (typeof handler !== "function") throw new TypeError(`${where} must be a function`);
  return /** @type {FailureHandler} */ (handler);
}

/**
 * The fallback observer's SHAPE, refused on the same rule the policy and handler follow.
 *
 * @param {unknown} observer
 * @param {string} where
 * @returns {FallbackObserver}
 */
function validateFallbackObserver(observer, where) {
  if (typeof observer !== "function") throw new TypeError(`${where} must be a function`);
  return /** @type {FallbackObserver} */ (observer);
}

/**
 * Calls an observer and enforces plan 3.5's observer contract on what comes back: "an ordinary
 * return value is ignored, a thenable is rejected as asynchronous".
 *
 * The distinction is the whole reason this is not a bare call. Ignoring an ordinary return is what
 * makes `onFallback: (event) => log(event)` legal no matter what `log` answers; REJECTING a thenable
 * is what stops `onFallback: async (event) => …` from being accepted, running its synchronous prefix
 * only, and abandoning the rest of the observation after the translation has already been returned.
 * A promise here cannot be awaited — every callback in this library is synchronous by plan 3.5 —
 * so the honest answer is to refuse it at the call site rather than to drop it silently.
 *
 * An exception the observer THROWS is not caught: plan 3.5's callback table says it "propagates
 * immediately", which is also why this helper does no try/finally of its own.
 *
 * @param {FallbackObserver} observer
 * @param {FallbackEvent} event
 * @param {string} where
 */
function notifyFallbackObserver(observer, event, where) {
  const returned = observer(event);

  // `typeof` on both arms deliberately: a thenable may be a function (a callable object with a
  // `then` property) as well as an object, and `null` is `"object"`.
  if (returned !== null && (typeof returned === "object" || typeof returned === "function")) {
    const then = /** @type {{ then?: unknown }} */ (returned).then;
    if (typeof then === "function")
      throw new TypeError(
        `${where} must be synchronous; it returned a thenable. Observers cannot be awaited — do ` +
          "the asynchronous work outside the observer and record the event synchronously",
      );
  }
}

/**
 * A locale-source callback's SHAPE, refused at construction on the same rule the policy and handler
 * follow: a callback of the wrong kind is a configuration mistake, and one that misbehaves at
 * runtime is not. Java has no counterpart check because its signature is typed; the JS analogue is
 * this one.
 *
 * @param {unknown} resolver
 * @param {string} where
 * @returns {(...args: never[]) => any}
 */
function validateResolver(resolver, where) {
  if (typeof resolver !== "function") throw new TypeError(`${where} must be a function`);
  return /** @type {(...args: never[]) => any} */ (resolver);
}

/**
 * The caller's placeholders as the frozen, null-prototype, enumerable record plan 3.5 promises
 * `TranslationFailure.placeholders` is — "it has no inherited magic keys", so a handler reading
 * `failure.placeholders.constructor` gets `undefined` rather than a function.
 *
 * A `Map` is accepted for the same reason `catalogEntries` accepts one: plan 3.2 types
 * `Placeholders` as a record OR a `ReadonlyMap`, and `interpolate.js`'s `lookupFor` already honors
 * both, so a failure record that only understood the object form would silently report NO
 * placeholder names for exactly the callers who were told to prefer a `Map`.
 *
 * @param {Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | undefined} placeholders
 */
function placeholderRecord(placeholders) {
  const record = Object.create(null);
  if (placeholders instanceof Map) for (const [name, value] of placeholders) record[name] = value;
  else if (placeholders != null)
    for (const [name, value] of Object.entries(placeholders)) record[name] = value;
  return freeze(record);
}

/**
 * Java's `TranslationResult` CONSTRUCTOR validation of the accumulated attempted locales
 * (`TranslationResult.java:114-126`), returned as a refusal rather than thrown.
 *
 * TWO REFUSALS, IN THIS ORDER, PER ELEMENT — and the order is observable, not cosmetic. Java runs
 * `LocaleUtils.requireWellFormed` on each attempted locale and only then adds its lowercased
 * `toLanguageTag()` to a `LinkedHashSet`, so an element that is BOTH ill-formed and a case-
 * insensitive duplicate of an earlier one reports ill-formedness. The `ja-JP-x-lvariant-JP` chain is
 * exactly that element: `ja-JP-u-ca-japanese-x-lvariant-jp` collides with candidate 0 and is
 * unspellable as a `Locale`, and Java names the well-formedness failure.
 *
 * WHERE THIS IS CALLED IS THE WHOLE BEHAVIOUR. Java validates the list a RESULT is built from, never
 * the chain, so the refusal bites only on the prefix the walk actually reached: with catalogs
 * {en, fr} the same `en-US-x-lvariant-POSIX` request serves at `en` and never sees the colliding
 * fourth candidate. A port that validated `candidateChain`'s output up front would refuse where Java
 * answers, which is a NEW divergence in the opposite direction — `lvariant.early-serve.*` are the
 * four corpus rows that catch it.
 *
 * RETURNED, NOT THROWN, because the two call sites dispose of it the two different ways Java's own
 * code layout does. On the success path the construction sits INSIDE the `try` that wraps
 * `getInternal`, so the exception becomes that candidate's `RESOLUTION_FAILURE` cause and the walk
 * carries on; the port's `try` deliberately covers the render and nothing else (see the comment
 * there), so routing the refusal by hand is what keeps both properties. On the failure path the
 * construction is outside every `try` and the exception escapes to the caller — which is why a
 * refusing lookup reports its failure to `onFailure` AND then throws, and why the escaping error is
 * a SECOND object rather than the retained cause.
 *
 * `TypeError` on both, for want of a plan sentence: plan 2.2 scopes malformed-input refusal to the
 * caller's own direct locale, and these locales are SYNTHESIZED by the chain. Java raises
 * `IllegalArgumentException`, whose declared JS counterpart in this port is `TypeError`/`RangeError`
 * (`tools/conformance.mjs`'s `ERROR_NAME`), and a wrong-kind value is a `TypeError` rather than a
 * `RangeError`.
 *
 * `TypeError` IS NOW THE SATISFYING VALUE, AND THIS PARAGRAPH USED TO SAY NO VALUE WAS. It read:
 * "`ERROR_NAME` (the `thrown` channel) permits `TypeError | RangeError`, `CAUSE_NAME` (the
 * `failures[].causeType` channel) demands exactly `Error` … NO VALUE OF THIS CONSTRUCTOR MAKES THE
 * ROW GREEN", over a measurement reporting 1,957 passed / 1 FAILED. That was a true statement about
 * a runner that could not tell WHICH `IllegalArgumentException` it was naming, and it is stale now
 * that the runner can: `causeNamesFor` recognizes that the failure's cause and the escaping throw
 * come from the SAME construction site — same class, same message, and the corpus's new
 * `thrown.identicalToRetainedCause` says they are nevertheless two objects — and lets `ERROR_NAME`
 * name both. The two tables no longer disagree about this site.
 *
 * RE-MEASURED HERE, by swapping only the two constructors below and reading `$?` from a redirected
 * `npm run conformance`:
 *
 *   raising `TypeError`  ->  1,960 passed / 0 FAILED / 221 unsupported, exit 0
 *   raising `Error`      ->  1,957 passed / 3 FAILED, and all three `lvariant.exhausting-walk.*`
 *                            rows fail on BOTH `.thrown.name` and `.failures[0].causeType`,
 *                            each wanting `TypeError or RangeError` and getting `Error`
 *
 * So this constructor is load-bearing and gated, in both directions, on all three rows — not a
 * choice made to satisfy an inconsistency. `TypeError` rather than `RangeError` for the reason the
 * paragraph above gives: a wrong-kind value.
 *
 * The ill-formed message names the port's own normalized TAG where Java's names a `Locale#toString`
 * (`ja_JP_jp_#u-ca-japanese`). That representation does not exist in this port and inventing it for
 * one diagnostic would be worse than diverging; the two Java spellings are pinned EXACTLY against
 * these two JS strings in `conformance.mjs`'s `DECLARED_MESSAGE_DIVERGENCES`, which fails the run
 * STALE if the port ever starts reproducing Java verbatim. The duplicate message already does
 * reproduce Java verbatim, because `toLanguageTag()` is what this port speaks, and it carries no
 * entry.
 *
 * @param {readonly string[]} attemptedLocales
 * @returns {TypeError | null} the refusal Java's constructor would raise, or null
 */
function attemptedLocaleRefusal(attemptedLocales) {
  /** @type {Set<string>} */
  const languageTags = new Set();

  for (const attemptedLocale of attemptedLocales) {
    if (!jdkLocaleWellFormed(attemptedLocale))
      return new TypeError(`Attempted locale '${attemptedLocale}' is not a well-formed IETF BCP 47 locale`);

    const normalizedLanguageTag = attemptedLocale.toLowerCase();

    if (languageTags.has(normalizedLanguageTag))
      return new TypeError(
        `Attempted locales must not contain duplicate language tag '${attemptedLocale}'`,
      );

    languageTags.add(normalizedLanguageTag);
  }

  return null;
}

/**
 * `DefaultTranslationFailure` plus `TranslationFailure#getMessage`'s default method.
 *
 * The message is reproduced VERBATIM from Java, including the `MISSING_TRANSLATION` spelling of the
 * reason. That is a deliberate choice and not an oversight: the corpus records the string on every
 * one of the 471 rows that observe a failure, it is already redacted the way plan 3.5 requires (no
 * placeholder VALUES, no cause message), and reproducing it exactly is what lets the conformance
 * runner compare the field with no adaptation rule of its own. The JS-facing spelling of the reason
 * is `failure.reason`, which is the JS vocabulary; the message quotes the Java-compatible token so
 * a log line from this port and one from lokalized-java can be diffed.
 *
 * Frozen and null-prototype, so nothing a handler does to it can reach a later lookup.
 *
 * @param {string} key
 * @param {string} lookupLocale
 * @param {unknown} localeMatch
 * @param {readonly string[]} attemptedLocales the FROZEN list handed to the result as well
 * @param {FailureReason} reason
 * @param {unknown} cause
 * @param {Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | undefined} placeholders
 * @returns {TranslationFailure}
 */
function translationFailureFor(key, lookupLocale, localeMatch, attemptedLocales, reason, cause,
    placeholders) {
  const failure = Object.create(null);
  failure.key = key;
  failure.lookupLocale = lookupLocale;
  failure.localeMatch = localeMatch;
  failure.attemptedLocales = attemptedLocales;
  failure.placeholders = placeholderRecord(placeholders);
  failure.reason = reason;
  failure.cause = cause ?? null;
  failure.message =
    `Unable to resolve translation key '${key}' for locale '${lookupLocale}'. ` +
    `Reason: ${reason.replace(/-/g, "_").toUpperCase()}. ` +
    `Attempted locales: [${attemptedLocales.join(", ")}]`;
  return freeze(failure);
}

/**
 * `com.lokalized.MissingTranslationException`'s JS counterpart (plan 3.5), raised when the walk
 * ended with nothing and the failure handler answered `THROW_EXCEPTION` with no cause to rethrow.
 *
 * CATCH-ONLY, on exactly the `StringsParseError` pattern in `src/internal/parse-diagnostics.js`:
 * the constructor demands a module-private token, so a consumer can `catch` one and test
 * `instanceof` but cannot manufacture one and cannot instantiate a subclass. Plan 3.1 declares it
 * as a `CatchOnlyErrorClass`, and that is what the token buys at runtime rather than only in the
 * declarations.
 *
 * DECLARED HERE rather than beside `StringsParseError`, and the reason is measured, not stylistic.
 * `src/internal/parse-diagnostics.js` is reachable only from `src/parse/index.js`; it is in neither
 * the root nor the core 0a graph. Putting a translation-runtime error there would pull that module
 * into both and move the module ratchet off 25 / 24 — the half of the 0a gate that a slice can
 * genuinely break, and the half that keeps the optional data tables out. That file's own docblock
 * also scopes it to `lokalized/parse` ("the declared error type of `lokalized/parse`"), which this
 * error is not.
 *
 * `failure` is the SAME frozen `TranslationFailure` object the handler was handed, by reference —
 * plan 8.3's "identical match-object identity through result, failure and thrown-failure paths"
 * runs through here, so a copy would break it silently.
 */
export class MissingTranslationError extends Error {
  /**
   * @param {symbol} token the internal construction token
   * @param {string} message
   * @param {TranslationFailure} failure
   */
  constructor(token, message, failure) {
    if (token !== MISSING_TRANSLATION_TOKEN)
      throw new TypeError(
        "MissingTranslationError is not constructible; it is thrown by a throwing onFailure handler",
      );

    super(message);

    /** @type {"MissingTranslationError"} */
    this.name = "MissingTranslationError";
    /** @type {"MISSING_TRANSLATION"} */
    this.code = "MISSING_TRANSLATION";
    /** The frozen failure the handler saw, by reference. @type {TranslationFailure} */
    this.failure = failure;
  }
}

/** Unexported by design: only this module can hand it to the constructor. */
const MISSING_TRANSLATION_TOKEN = Symbol("lokalized.missing-translation-error");

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
  // The `loaded` branch is NORMALIZED into the direct branch's inputs rather than given a second
  // construction path, so locale validation, duplicate rejection, model validation and expression
  // compilation stay in exactly one place. Everything the loader result has to prove is proved
  // before this line; nothing below it knows which branch it came from.
  //
  // The one thing that must survive the normalization is the PROOF: `getLoadVerification()` reports
  // what was established here, and plan 3.4:711 makes that record the channel an SSR helper from a
  // different installed copy reads the renderer's identity through. `null` for a direct instance is
  // the load-bearing half — it is what makes direct construction ineligible for a stamp.
  /** @type {Readonly<StringsLoadVerification> | null} */
  let loadVerification = null;
  if (/** @type {any} */ (options).loaded !== undefined) {
    const normalized = optionsFromLoadedStrings(/** @type {any} */ (options));
    options = /** @type {CreateStringsOptions} */ (/** @type {unknown} */ (normalized.options));
    loadVerification = /** @type {any} */ (normalized.verification);
  }

  // Plan 3.4:635 — "`getCatalogIdentity()` returns null unless the caller supplies a build-produced
  // `catalogIdentity`; core validates its SHAPE, NOT ITS TRUTH." A build pipeline that knows what it
  // published can hand core the identity for application diagnostics, and nothing here can tell a
  // real one from an invented one. That is precisely why plan 6.4 makes SSR key on
  // `getLoadVerification()` instead: a shape-valid identity is the adversarial input, not the proof.
  /** @type {Readonly<CatalogIdentity> | null} */
  let suppliedIdentity = null;
  const identityOption = /** @type {any} */ (options).catalogIdentity;
  if (identityOption !== undefined && identityOption !== null) {
    if (typeof identityOption !== "object"
      || typeof identityOption.catalogVersion !== "string"
      || typeof identityOption.catalogFingerprint !== "string")
      throw configurationError(
        "`catalogIdentity` must carry a string catalogVersion and catalogFingerprint");
    suppliedIdentity = freeze({
      catalogVersion: identityOption.catalogVersion,
      catalogFingerprint: identityOption.catalogFingerprint,
    });
  }

  // The tag the CALLER wrote, normalized but not yet resolved against the loaded catalogs. Java
  // keeps the same two values apart: the constructor parameter, and `this.fallbackLocale`, which is
  // the loaded catalog the parameter names (`DefaultStrings.java:446-470`). Only the second is a
  // catalog anything can be served from, and only the first is what the ambient locale defaults to.
  const configuredFallbackLocale = normalizeTag(options.fallbackLocale);

  // THE FIRST OF THREE CONSTRUCTION INGRESS CHECKS — `LocaleUtils.requireWellFormed(fallbackLocale,
  // "Fallback locale")`, which Java runs at BOTH `Strings.java:211` (the builder's entry point) and
  // `DefaultStrings.java:248` (the constructor's first statement, before the
  // `localizedStringSupplier` null check at `:250`). The port has one construction entry point, so
  // the two Java sites collapse to one here and the ordering against the `strings` refusal below is
  // preserved.
  //
  // MEASURED, not inferred, on pinned Corretto 21 against `lokalized-3.0.0.jar`: catalogs installed
  // under `Locale.forLanguageTag("en-x-lvariant-NY")` (= `en__NY`) make Java refuse with
  // `Fallback locale 'en__NY' is not a well-formed IETF BCP 47 locale`, while the port BUILT the
  // instance and reported `getSupportedLocales() = ["en-x-lvariant-NY"]`. That is a servable catalog
  // Java cannot construct — behaviour, not wording.
  //
  // THE CORPUS IS BLIND TO ALL THREE OF THESE SITES, measured: every locale spelled by every
  // fixture — catalog keys, fallback locales, instance locales and tiebreaker lists — is
  // `jdkLocaleWellFormed`, 0 exceptions across 2,346 cases. Adding these checks moves no conformance
  // row in either direction. What gates them is `test/construction-ingress.test.js` — the default
  // gate, and the only one inside `npm run verify` — and `tools/lookup-diff/`'s `C` line, whose
  // `illformed-*` catalog sets exist for exactly this axis.
  //
  // THE `C` LINE DID NOT ACTUALLY GATE THEM UNTIL 2026-09-09, and the correction is worth keeping:
  // it compared the BUILT/REFUSED boolean and threw the refusal away, so two of the three sites
  // could not be discriminated there at all — the port refuses an ill-formed FALLBACK anyway
  // (it names no loaded catalog) and an ill-formed TIEBREAKER anyway (it breaks the permutation
  // rule), and only the message says which library answered. It now compares the refusal through
  // the same `agree`/`KNOWN_DIVERGENCES` machinery a lookup's uses.
  requireJdkWellFormedLocale(configuredFallbackLocale, LOCALE_INGRESS_DESCRIPTION.fallbackLocale);

  // `DefaultStrings.java:250` — the catalog SOURCE is absent. Java's counterpart is a null
  // `localizedStringSupplier`; the JS analogue is an absent `strings`, because `createStrings` takes
  // the catalog map itself rather than a supplier of one.
  //
  // Refused HERE, before the locale-source rule below, because Java refuses in that order (`:250`
  // precedes `:254`) — and separately from the `strings === null` refusal in `catalogEntries`, which
  // is Java's `:262` "the supplier returned null". Those are two states in Java and they are two
  // states here: an omitted option is a caller who forgot, an explicit null is a caller whose own
  // lookup came back empty. Collapsing them into the one message this used to raise would make
  // `owed-construct.refusal.catalog-omitted` and `.catalog-null` indistinguishable, which is the
  // whole property those two rows are read against each other for.
  if (options.strings === undefined)
    throw new TypeError(
      "createStrings({ strings }) is required: supply a record or a Map of locale tag to catalog",
    );

  // `DefaultStrings.java:254` — `(localeSupplier == null) == (localeMatchSupplier == null)` — which
  // refuses BOTH degenerate arms with one proposition: "exactly one of". The BOTH-PRESENT arm is
  // dead in Java and no oracle run can corroborate it, because `Strings.Builder`'s two setters each
  // null the other (`Strings.java:288-289`, `310-311`); a `localeSource: "both"` case was authored,
  // MEASURED, and removed because it constructed. It is nevertheless the arm a JavaScript object
  // literal reaches most easily, and the user's recorded decision is to REFUSE it: the literal is
  // the analogue of the CONSTRUCTOR, not of the fluent builder, so last-key-wins would make
  // behaviour depend on spread order.
  //
  // `locale` joins the same exclusion, on plan 3.2's `LocaleSourceOptions` union ("Exactly one of
  // `locale`, `localeResolver`, and `localeMatchResolver` is required"). B3 landed the AT-MOST-ONE
  // half; B4 lands the AT-LEAST-ONE half, which is what `owed-construct.refusal.locale-source-absent`
  // records Java refusing. `options.locale ?? options.fallbackLocale` is still what computes the
  // ambient tag below — the defaulting is unchanged and is simply no longer reachable with no source
  // named, so the fallback locale can never silently become the ambient locale by omission.
  const localeSources = ["locale", "localeResolver", "localeMatchResolver"]
    .filter((name) => /** @type {Record<string, unknown>} */ (options)[name] != null);

  if (localeSources.length !== 1)
    throw new RangeError(
      `createStrings requires exactly one of 'locale', 'localeResolver' or 'localeMatchResolver'; ` +
        `received ${localeSources.length === 0 ? "none" : javaList(localeSources)}`,
    );

  const localeResolver =
    options.localeResolver == null
      ? null
      : validateResolver(options.localeResolver, "createStrings({ localeResolver })");
  const localeMatchResolver =
    options.localeMatchResolver == null
      ? null
      : validateResolver(options.localeMatchResolver, "createStrings({ localeMatchResolver })");

  // Deliberately the CONFIGURED spelling, not the resolved one. The corpus pins this:
  // `locale-identity.deprecated-fallback.instance-locale-uses-loaded-spelling` configures `hy-810`,
  // resolves the fallback to the loaded `hy-AM`, and still records `lookupLocale: "hy-810"`.
  //
  // Computed even when a resolver is installed — it is simply never READ then, exactly as
  // `VectorOracle` ignores a fixture's `instanceLocale` whenever it installs a supplier
  // (`VectorOracle.java:268-276`). The exclusion above is what makes that unobservable rather than
  // merely unlikely.
  //
  // THE RAW SPELLING IS WHAT TRAVELS, and its normalized twin is deliberately NOT kept. Two
  // consumers want two different things: `lookupLocale` wants the NORMALIZED tag (the corpus row
  // named above), and it computes it at the ingress; the SELECTION channel wants the raw one,
  // because Java's `matchFor(Locale)` normalizes exactly once and this port's matcher kernel
  // normalizes whatever it is handed. See `localeLookupFor`'s per-call arm for the measurement that
  // separates them.
  //
  // `normalizeTag`'s RESULT is discarded here and its THROW is not: a malformed configured locale is
  // still refused at construction rather than at the first lookup, which is unchanged behaviour and
  // is what `owed-construct.*` records.
  const ambientLocaleSource = options.locale ?? options.fallbackLocale;
  normalizeTag(ambientLocaleSource);

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
  // `== null` catches BOTH undefined and an explicit null, deliberately. Java's option setters are
  // `@Nullable` and its getters return an `Optional` that is empty for null, so `.orElse(instance)`
  // makes an explicitly-null option identical to an omitted one (`DefaultStrings.java:683-685`).
  // Rejecting null instead — which this did — turns `{ bidiIsolation: someMaybeValue }` into a crash
  // for callers whose value is legitimately absent, which is a very ordinary JavaScript shape.
  const instanceBidiIsolation =
    options.bidiIsolation == null
      ? DEFAULT_BIDI_ISOLATION
      : validateBidiIsolation(options.bidiIsolation, "createStrings({ bidiIsolation })");

  // The same `== null` rule, for the same reason, on the two callbacks the walk consults. Java's
  // constructor substitutes its built-ins when handed null (`DefaultStrings.java:472-475`), so an
  // explicitly-null option and an omitted one are ONE state there and must be one state here — and
  // both are validated at CONSTRUCTION rather than at first failure, because a policy of the wrong
  // shape would otherwise surface only on the unlucky lookup that first missed.
  const instanceFallbackPolicy =
    options.fallbackPolicy == null
      ? DEFAULT_FALLBACK_POLICY
      : validateFallbackPolicy(options.fallbackPolicy, "createStrings({ fallbackPolicy })");
  const instanceFailureHandler =
    options.onFailure == null
      ? DEFAULT_FAILURE_HANDLER
      : validateFailureHandler(options.onFailure, "createStrings({ onFailure })");

  // NOT defaulted to a no-op function, deliberately: `null` is the state the walk reads to decide
  // whether to accumulate `precedingFailures` at all, and a no-op default would make every lookup
  // pay for records nobody can observe. Validated at CONSTRUCTION for the same reason the handler
  // is — a non-function would otherwise surface only on the unlucky lookup that first fell back,
  // which is precisely the lookup a caller installed an observer to hear about.
  const instanceFallbackObserver =
    options.onFallback == null
      ? null
      : validateFallbackObserver(options.onFallback, "createStrings({ onFallback })");

  /** @type {Map<string, Map<string, Definition>>} */
  const catalogs = new Map();
  // ONE session across every catalog, not one per file. Java's aggregate budgets
  // (`maximumTotalInputBytes`, `maximumLocalizedStringsFiles`) are per-LOAD: a session per catalog
  // would enforce each file's own limit and silently never enforce the aggregate at all.
  const session = new LoadingSession(options.loadingLimits);

  /** @type {LocalizedStringWarning[]} */
  const warnings = [];

  // `DefaultStrings.java:277-281`'s `localesByLanguageTag`, keyed on
  // `toLanguageTag().toLowerCase(Locale.ROOT)` rather than on the tag itself. The lowercasing is
  // load-bearing and the port did not do it: `normalizeTag` canonicalizes language, script and
  // region case but PRESERVES variant and private-use case, so `en-US-POSIX` and `en-US-posix`
  // survived as two distinct catalogs where Java refuses the pair outright. Two catalogs whose tags
  // differ only in case cannot both be looked up — every lookup normalizes — so one of them was
  // permanently unreachable, silently.
  /**
   * @type {Map<string, string>} normalized-lowercase tag -> the CALLER'S OWN spelling of the first
   * key that claimed it. The raw key, not the normalized one: normalization is exactly what
   * collapses the two keys, so a message built from normalized tags names the collision without
   * naming either party to it.
   */
  const localesByLanguageTag = new Map();

  for (const [tag, raw] of catalogEntries(options.strings)) {
    // `DefaultStrings.java:273`. A `Map` catalog can carry a null key where a record cannot, and a
    // nullish key reaching `normalizeTag` used to be reported as "a locale tag must be a non-empty
    // string" — true, but it names the wrong mistake and does not distinguish a null KEY from a
    // catalog written for the empty string.
    if (tag == null)
      throw new TypeError("Null locale encountered in supplied localized strings");

    const locale = normalizeTag(tag);

    // THE SECOND CONSTRUCTION INGRESS CHECK — `LocaleUtils.requireWellFormed(locale, "Localized
    // strings locale")` (`DefaultStrings.java:276`). ORDER IS JAVA'S: after the null-key refusal at
    // `:273` and BEFORE the duplicate-language-tag refusal at `:280`, so a catalog map that is both
    // ill-formed and colliding answers the well-formedness refusal, as Java does. Measured on the
    // pinned JDK: `{fr, en__NY}` gives `Localized strings locale 'en__NY' is not a well-formed IETF
    // BCP 47 locale`, where the port BUILT and served both catalogs.
    requireJdkWellFormedLocale(locale, LOCALE_INGRESS_DESCRIPTION.localizedStringsLocale);

    // `DefaultStrings.java:280`. One check for both collisions Java has one check for: two spellings
    // that normalize identically (`en` and `EN`), and two that normalize to tags differing only in
    // case (`en-US-POSIX` and `en-US-posix`).
    //
    // THE FIRST TWO SLOTS PRINT THE CALLER'S RAW KEYS, and that is the whole point of the message.
    // Java can afford to print its two `Locale` objects because they ARE distinct objects there —
    // `en_US_POSIX` and `en_US_posix`, which `Locale#toString` renders differently. In JavaScript
    // the two keys are strings that `normalizeTag` maps onto one tag, so printing the normalized
    // form names the same tag three times and tells the caller nothing they can act on: the raw
    // keys `en-US-u-nu-latn-ca-gregory` and `en-US-u-ca-gregory-nu-latn`, or `fr` and `FR`, would
    // both vanish from their own diagnostic. MEASURED both ways this session — before the fix, the
    // `-u-` pair printed `'en-US-u-ca-gregory-nu-latn' and 'en-US-u-ca-gregory-nu-latn'` and the
    // `fr`/`FR` pair printed `'fr' and 'fr'`.
    //
    // The THIRD slot is the normalized tag, which is what Java prints there
    // (`locale.toLanguageTag()` on the second locale) and is the tag both keys collide on. So this
    // message follows Java's exactly for the case-collision shape it shares with Java — the
    // `en-US-POSIX`/`en-US-posix` pair, probed on the pinned Corretto 21 this session, where Java
    // throws `Localized strings locales 'en_US_POSIX' and 'en_US_posix' both use IETF BCP 47
    // language tag 'en-US-posix'` — differing only in that JavaScript has no counterpart for
    // `Locale#toString`'s underscore form and prints the caller's BCP 47 spelling instead.
    const existing = localesByLanguageTag.get(locale.toLowerCase());

    if (existing !== undefined)
      throw new RangeError(
        `Localized strings locales '${existing}' and '${tag}' both use IETF BCP 47 language ` +
          `tag '${locale}'`,
      );

    localesByLanguageTag.set(locale.toLowerCase(), tag);

    // `DefaultStrings.java:286`. A null catalog is not an empty one, and reading it as an empty one
    // is the failure mode the corpus row names: the locale would still be SUPPORTED, negotiation
    // would still elect it, and every key would then miss.
    if (raw == null)
      throw new TypeError(`Null localized strings catalog encountered for locale '${locale}'`);

    // `DefaultStrings.java:293`, over the `LocalizedStringInput[]` form — the JS counterpart of
    // Java's `Iterable<LocalizedString>`. Refused here rather than left to the model walk, whose
    // "each programmatic localized string must be an object" says the same thing about a null entry
    // and about a number, so a port that SKIPPED nulls and one that rejected them would have been
    // indistinguishable from the message alone.
    if (Array.isArray(raw))
      for (const entry of raw)
        if (entry == null)
          throw new TypeError(`Null localized string encountered for locale '${locale}'`);

    // Plan 3.2: "Direct raw inputs use source name `catalog:<normalized-locale>`." The NORMALIZED
    // tag, not the caller's map key, so two constructions that spell the same locale differently
    // produce the same diagnostics and the same warning records.
    catalogs.set(locale, parseCatalogInput(raw, locale, `catalog:${locale}`, session, options, warnings));
  }

  const supported = [...catalogs.keys()];
  const tiebreakers = safeTiebreakers(options.tiebreakers);

  // `DefaultStrings.java:304-314`, and it runs BEFORE the tiebreaker rules below, exactly as Java
  // orders the two. Sorted by tag because the walk below and Java's diagnostic both read this list
  // in `Locale#toLanguageTag` order.
  const equivalentFallbackLocales = supported
    .filter((tag) => equivalentTags(tag, configuredFallbackLocale))
    .sort(compareTags);

  // The first of the two construction refusals A0 adds. A fallback naming no loaded catalog is not
  // a fallback: every lookup that reaches the end of its chain would then be served by whichever
  // catalog happened to be there, or by nothing at all, and the configuration mistake would show up
  // only as translations quietly coming from the wrong locale.
  if (equivalentFallbackLocales.length === 0)
    throw new RangeError(
      `Specified fallback locale is '${configuredFallbackLocale}' but no matching localized ` +
        `strings locale was found. Known locales: ${javaList([...supported].sort(compareTags))}`,
    );

  // Refused at CONSTRUCTION, before the first lookup can hide the ambiguity behind an arbitrary
  // winner. `DefaultStrings` runs this check (DefaultStrings.java:395-430) and the port did not, so
  // `{ strings: { en, "en-US" } }` with no tiebreakers built an instance Java refuses outright.
  validateTiebreakers(supported, tiebreakers);

  // `DefaultStrings.java:446-470`. THE CALLER'S SPELLING IS NOT A CATALOG NAME, and until this
  // landed the port simply passed the normalized configured tag on to the kernel — whose `matchFor`
  // doc comment has always said `@param fallbackLocale resolved fallback locale tag`. The kernel was
  // right; only its caller was wrong. Nothing here touches `src/internal/locale.js`.
  const fallbackLocale = resolveFallbackLocale(
    configuredFallbackLocale,
    supported,
    equivalentFallbackLocales,
    tiebreakers,
  );

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

  for (const [catalogLocale, definitions] of catalogs)
    for (const [rootKey, definition] of definitions)
      compileDefinitionExpressions(definition, compiledExpressions, new Set(), rootKey, catalogLocale);

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
   * LAYER TWO: the instance's own check on a match it did not compute
   * (`DefaultStrings#validateSuppliedLocaleMatchResult`, `:2460-2471`).
   *
   * Two comparisons, in Java's order, and the ORDER is what
   * `supplied-match.fallback.fallback-check-precedes-considered-check` pins: a match whose fallback
   * AND considered set are both foreign reports the fallback message.
   *
   * BOTH COMPARE JDK-NORMALIZED TAGS, NOT CLDR EQUIVALENCE, and this was re-probed on the pinned
   * Corretto 21 rather than inherited. Java compares `Locale.equals` — through
   * `getFallbackLocale().equals(...)` and `Set<Locale>.equals` — so the JDK's own canonicalization
   * applies and nothing else does: `["EN","HE"]` and `["en","iw"]` both equal a loaded `{en, he}`
   * (measured: `forLanguageTag("iw").toLanguageTag()` is `he`), while `["en","mo"]` does NOT equal a
   * loaded `{en, ro}` and `["en","tl"]` does not equal `{en, fil}`. `normalizeTag` reproduces that
   * canonicalization exactly on all of them, verified against the JDK side by side. Using
   * `equivalentTags` here would silently ACCEPT the `mo`/`ro` and `tl`/`fil` results Java refuses,
   * and no corpus case would catch it: every considered list in the corpus is spelled canonically.
   * That is the shape of the two tiebreaker defects this repo found by hand-reading, not by running.
   *
   * ORDER IS NOT PART OF IT. Java builds a `LinkedHashSet` and compares with `Set.equals`, so
   * `supplied-match.considered.caller-order-is-preserved` and `.reordered` both construct — and the
   * caller's order is echoed back verbatim in the diagnostic.
   *
   * THE MESSAGES ARE JAVA'S VERBATIM, including the name `localeMatchSupplier`, which is Java's
   * option and not this port's. That is the opposite of the rewording `validateTiebreakers` and
   * `THROWING_PHONETIC_RESOLVER` apply, and the difference is measured rather than stylistic: no
   * corpus fixture reaches those two, while FIVE rows reach this one and the conformance runner
   * compares the message EXACTLY (`thrownProjection` arm 3). Reproducing it is what keeps that
   * comparison free of an adaptation rule. The per-call `localeMatch` ingress has no Java
   * counterpart at all — Java's per-call arm is `languageRanges` and builds its own match — so it
   * names the JS option it actually has.
   *
   * @param {LocaleMatch} match
   * @param {string} source the option that produced it, for the JS-only per-call arm
   * @returns {LocaleMatch}
   */
  function validateSuppliedLocaleMatch(match, source) {
    const javaSource = source === "localeMatchResolver";

    if (normalizeTag(match.fallbackLocale) !== fallbackLocale)
      throw new RangeError(
        javaSource
          ? "localeMatchSupplier returned a result for a different fallback locale"
          : `get({ localeMatch }) supplied a result for a different fallback locale`,
      );

    const considered = new Set(match.consideredLocales.map(normalizeTag));
    const sameSet = considered.size === supported.length && supported.every((tag) => considered.has(tag));

    if (!sameSet)
      throw new RangeError(
        javaSource
          ? "localeMatchSupplier returned a result for different supported locales"
          : `get({ localeMatch }) supplied a result for different supported locales`,
      );

    return match;
  }

  /**
   * `DefaultStrings#localeLookupFor` (`:2431-2457`): which locale this lookup starts from, and which
   * diagnostic travels with it. FOUR ARMS, in Java's order, and the asymmetry between them is the
   * whole subject.
   *
   *   per-call `locale`      → the REQUESTED tag stays the lookup locale; the match is computed
   *   per-call `localeMatch` → the SELECTION replaces it (Java's per-call `languageRanges` arm)
   *   `localeMatchResolver`  → the SELECTION replaces it
   *   `localeResolver` / the constant instance locale → the REQUESTED tag stays
   *
   * `ingress-matrix-java.zh-tw.*` is the acceptance test and it is one fixture across six ingresses:
   * instance-locale, per-call locale and `localeSupplier` all attempt `[zh-TW, zh-Hant, en]`, while
   * `localeMatchSupplier` and per-call ranges attempt `[zh-Hant, en]` — the `zh-TW` step is simply
   * not there, because the lookup never asked for `zh-TW`. A port that picks ONE convention passes
   * half that table, which is the failure mode that looks like near-success.
   *
   * An unmatched supplied match falls back to the MATCH's own fallback locale (`:2452`), not the
   * instance's. Layer two has just proved the two are the same tag, so the distinction is invisible
   * — but it is Java's line, and `supplied-match.unmatched.lookup-uses-supplied-fallback-locale`
   * is the row that observes it.
   *
   * @param {{ locale?: string, localeMatch?: LocaleMatch } | undefined} callOptions
   * @returns {{ lookupLocale: string, localeMatch: LocaleMatch }}
   */
  function localeLookupFor(callOptions) {
    const perCallLocale = callOptions?.locale;
    const perCallMatch = callOptions?.localeMatch;

    // Plan 3.3: "A per-call `locale` and `localeMatch` are mutually exclusive in declarations and
    // runtime validation." REFUSED, never resolved by precedence — the same reasoning that refuses
    // two locale sources at construction, and the reason three `per-call-override-order` corpus rows
    // that pass today must stop passing: Java's `TranslationOptions.Builder` setters clear each other
    // (`TranslationOptions.java:309-313`, `:330-333`), so its answer to the both-present state is
    // decided by which setter ran last. A JS object literal has no "last setter", so reproducing the
    // Java answer would mean picking one arbitrarily and calling it a specification.
    if (perCallLocale != null && perCallMatch != null)
      throw new RangeError(
        "get({ locale, localeMatch }) names two locale sources; supply exactly one of 'locale' or " +
          "'localeMatch'",
      );

    if (perCallLocale != null) {
      // `LocaleUtils.requireWellFormed(locale, "Locale override")` — BOTH of Java's copies,
      // `TranslationOptions.java:73` (the constructor) and `:310` (the builder setter), which are
      // one site to a JS caller because an options OBJECT has no separate builder.
      //
      // BEFORE THE WALK, and that is the observable half. Java refuses here, so `calls=[]`: no
      // candidate is attempted, the `fallbackPolicy` is never consulted and `onFailure` never
      // fires. Measured on the pinned JDK with catalogs {fr} and both callbacks installed,
      // `en-x-lvariant-NY` gave Java `calls=[]` and this port
      // `[policy:en-x-lvariant-NY, policy:en-x-lvariant, policy:en, policy:en-x-lvariant-ny,
      // onFailure:en-x-lvariant-NY]` — a whole walk Java never starts. `attemptedLocaleRefusal`
      // eventually refused the same input, so the OUTCOME agreed and the TRACE did not.
      const lookupLocale = requireJdkWellFormedLocale(
        normalizeTag(perCallLocale), LOCALE_INGRESS_DESCRIPTION.perCallLocale);
      // THE CALLER'S OWN SPELLING GOES TO THE MATCHER, not `lookupLocale`. `DefaultStrings:2439`
      // is `matchFor(requestedLocale)` on the RAW `Locale`, and `matchFor(Locale)` builds its range
      // from `locale.toLanguageTag()` — ONE normalization. The kernel here normalizes its argument
      // too, so handing it the already-normalized tag normalizes TWICE, and the two differ for one
      // family: a non-lowercase `und` followed only by private use, where the second application
      // drops the `und`. Measured against the pinned JDK for `UND-x-a`, catalogs {fr, nb, nn}: Java
      // reports `requestedLanguageRanges [und-x-a]` and a double-normalizing port `[x-a]`.
      // `lookupLocale` is unaffected and stays the normalized tag the corpus records.
      return {
        lookupLocale,
        localeMatch: matchFor(perCallLocale, supported, fallbackLocale, tiebreakers),
      };
    }

    if (perCallMatch != null) {
      const match = validateSuppliedLocaleMatch(
        validateLocaleMatchStructure(perCallMatch, "get({ localeMatch })"), "localeMatch");
      return { lookupLocale: normalizeTag(match.locale ?? match.fallbackLocale), localeMatch: match };
    }

    if (localeMatchResolver !== null) {
      // `requireNonNull(localeMatchSupplier.apply(this), "localeMatchSupplier returned null")`
      // (`:2447`). Refused rather than defaulted: a resolver that answers nothing has failed, and
      // silently substituting the instance fallback would serve every lookup from it.
      const supplied = localeMatchResolver();

      if (supplied == null) throw new TypeError("localeMatchResolver returned null");

      const match = validateSuppliedLocaleMatch(
        validateLocaleMatchStructure(supplied, "createStrings({ localeMatchResolver })"),
        "localeMatchResolver");
      return { lookupLocale: normalizeTag(match.locale ?? match.fallbackLocale), localeMatch: match };
    }

    // `LocaleUtils.requireWellFormed(suppliedLocale, "localeSupplier result")` (`:2456`), which
    // `normalizeTag` raises for the same class of input. The REQUESTED tag survives: a resolver that
    // answers `zh-TW` against catalogs holding only `zh`, `zh-Hant` and `en` still attempts `zh-TW`
    // first, which is exactly what separates this arm from the two match arms above.
    const requested = localeResolver === null ? ambientLocaleSource : localeResolver();

    if (requested == null) throw new TypeError("localeResolver returned null");

    // The refusal `:2457` names, at the point `:2457` runs: after the resolver has answered and
    // before `matchFor` or any candidate sees the tag.
    //
    // THE DESCRIPTION DEPENDS ON THE SOURCE because Java's does. A resolver answered it, so the
    // resolver is named; a constant `createStrings({ locale })` is a port affordance Java has no
    // setter for, and it gets its own phrase rather than borrowing a callback name nobody
    // installed. See `LOCALE_INGRESS_DESCRIPTION`, which is where that reasoning lives.
    const lookupLocale = requireJdkWellFormedLocale(
      normalizeTag(requested),
      localeResolver === null
        ? LOCALE_INGRESS_DESCRIPTION.instanceLocale
        : LOCALE_INGRESS_DESCRIPTION.localeResolverResult,
    );
    // `matchFor(suppliedLocale)` on the RAW value (`:2458`), for the reason recorded on the per-call
    // arm above: the kernel normalizes what it is given, and Java normalizes exactly once.
    return {
      lookupLocale,
      localeMatch: matchFor(requested, supported, fallbackLocale, tiebreakers),
    };
  }

  /**
   * BRACKETS, NOT `| undefined`, on the two trailing parameters. They are the same type either way
   * at runtime, but `@param {T | undefined} x` emits `x: T | undefined` — a REQUIRED parameter — so
   * a TypeScript caller wanting `strings.getResult("k")` had to write
   * `strings.getResult("k", undefined, undefined)`. `get` and `t` already used the bracket form and
   * were unaffected; this was the one entry point where the two spellings disagreed.
   *
   * @param {string} key
   * @param {Readonly<Record<string, unknown>>} [placeholders]
   * @param {TranslationCallOptions} [callOptions]
   */
  function getResult(key, placeholders, callOptions) {
    // REPLACES the instance policy rather than narrowing it, in both directions: per-call `"all"`
    // over an instance `"none"` isolates, and per-call `"none"` over an instance `"all"` does not.
    // `TranslationOptions.getBidiIsolation().orElse(getBidiIsolation())` (DefaultStrings.java:683).
    const bidiIsolation =
      callOptions?.bidiIsolation == null
        ? instanceBidiIsolation
        : validateBidiIsolation(callOptions.bidiIsolation, "get({ bidiIsolation })");
    // The same REPLACEMENT rule, from the same two lines of Java (`DefaultStrings.java:684-686`).
    // A per-call `never` over an instance `any-failure` halts at the first candidate; a per-call
    // handler displaces the instance one wholesale rather than running after it.
    const fallbackPolicy =
      callOptions?.fallbackPolicy == null
        ? instanceFallbackPolicy
        : validateFallbackPolicy(callOptions.fallbackPolicy, "get({ fallbackPolicy })");
    const onFailure =
      callOptions?.onFailure == null
        ? instanceFailureHandler
        : validateFailureHandler(callOptions.onFailure, "get({ onFailure })");
    // The same REPLACEMENT rule again (plan 3.3 lists `onFallback` in `TranslationBehaviorOptions`
    // beside `onFailure`), and the same `== null` reading of an explicit null: a per-call observer
    // displaces the instance one wholesale rather than running after it. There is no way to say
    // "no observer for this one call" while an instance observer is installed, exactly as there is
    // no way to say "no failure handler" — an explicit null selects the instance value in both.
    const onFallbackWhere = callOptions?.onFallback == null
      ? "createStrings({ onFallback })"
      : "get({ onFallback })";
    const onFallback =
      callOptions?.onFallback == null
        ? instanceFallbackObserver
        : validateFallbackObserver(callOptions.onFallback, "get({ onFallback })");

    // THE INGRESS, and it runs before anything else this lookup does. Every refusal it raises —
    // the mutually-exclusive per-call sources, both supplied-match layers, a resolver answering
    // null or a malformed tag — is a PRE-WALK refusal: no candidate is attempted, no policy is
    // consulted, and the failure handler never fires. The corpus is explicit about that: all 31
    // supplied-match ingress rows record an empty `failures` and `policyCalls` channel alongside
    // their `IllegalArgumentException`.
    //
    // Channel one, the diagnostic, comes back with it. Computed once for the lookup and never used
    // to redirect the walk: `matchFor` answers "which locale would a delivery have had to fetch",
    // `candidateChain` answers "which catalogs does per-key lookup try", and they legitimately
    // disagree. A supplied match is NOT re-derived here — plan 8.3's "intentional lookup difference"
    // is only observable when the supplied match disagrees with what the matcher would have said,
    // and `ingress-smoke.fabricated.supplied-match-is-preserved-not-rederived` is the row that
    // observes it.
    const lookup = localeLookupFor(callOptions);
    const lookupLocale = lookup.lookupLocale;
    const localeMatch = freeze(lookup.localeMatch);

    // A NULL PLACEHOLDER NAME (`DefaultStrings.java:690`), refused AFTER the locale ingress and
    // before the walk, which is Java's own order and is observable: a call that also carries a bad
    // per-call locale reports the locale.
    //
    // Only a `Map` can present one — plan 3.2 types `Placeholders` as a record OR a `ReadonlyMap`
    // and blesses the Map form precisely for generated and untrusted keys, which is also the source
    // most likely to produce a null name when one entry of a generated list is missing. Ignoring it
    // is not harmless: the entry silently disappears, so the template either renders an unresolved
    // placeholder or, worse, resolves from a stale definition, and the caller is told nothing. This
    // port did ignore it until `owed-null-placeholder-name` measured it against Java.
    if (placeholders instanceof Map && placeholders.has(null))
      throw new TypeError("Placeholder names must not be null");

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
    // Plan 3.5's `FallbackEvent.precedingFailures`, and it is NOT a parallel channel: each record
    // is exactly the `(reason, locale, cause)` triple the walk already computes and already hands
    // to `fallbackPolicy` one line later, captured instead of discarded. Java discards it — a
    // candidate's failure is dead the moment a later candidate answers — which is why this list has
    // no counterpart to compare against and why it is accumulated only when someone is listening.
    //
    // ONLY when `onFallback !== null`. An always-on accumulator would allocate one frozen record
    // per failed candidate on every lookup in the library, for a value that is unreachable unless
    // an observer is installed; the `!== null` gate is what keeps the no-observer walk allocating
    // exactly what it allocated before this option existed.
    /** @type {PrecedingFailure[]} */
    const precedingFailures = [];

    // INDEX-DRIVEN, and the index is the point. `DefaultStrings.java:698-741` ends every candidate
    // the same way — `if (candidateIndex + 1 >= fallbackCandidates.size()) break;` and then exactly
    // ONE `shouldTryNextLocale` consultation — and the port used to encode that ending three
    // separate times: `continue` for an absent entry, `continue` for a non-matching alternative, and
    // an unconditional `break` for a throw. Each was the default policy's answer inlined at the site,
    // which is why every corpus row still agreed: the decisions were right and unobservable. They
    // stop being either the moment a caller supplies a policy, and the truncation clauses are about
    // the calls that DO NOT happen — `custom-policy.finalcandidate.no-call-though-the-last-locale-is
    // -listed` lists all four locales and records exactly three consultations.
    for (const [candidateIndex, candidate] of chain.entries()) {
      attempted.push(candidate);
      // Java's per-attempt pair, reset for every candidate: the reason THIS candidate failed for,
      // and THIS candidate's cause. Neither is the final failure's — `attemptCause` is the current
      // throw where `firstFailureCause` is the retained first one, and the two differ on every walk
      // that fails more than once. `custom-policy.cause.truncated-walk-still-reports-the-first-cause`
      // is the row that separates them: the policy is handed the SECOND candidate's cause while the
      // result still carries the first.
      /** @type {FailureReason} */
      let attemptFailureReason = "missing-translation";
      /** @type {unknown} */
      let attemptCause = null;

      const definition = catalogs.get(candidate)?.get(key);

      /** @type {string | null} */
      let translation = null;
      // NOT `translation !== null`: `render` returning null and `render` throwing are two different
      // outcomes and the walk reports them as two different reasons, so which one happened has to
      // be recorded rather than inferred. Inferring it from `attemptCause === null` would misread
      // the one candidate that threw a null.
      let rendered = false;

      if (definition !== undefined) {
        // THE TRY COVERS THE RENDER AND NOTHING ELSE, and that scope is load-bearing rather than
        // stylistic. The success path used to be built and returned from inside this block; when
        // `onFallback` was first wired there, a THROWING observer was caught by this very `catch`,
        // relabelled as the candidate's own `resolution-failure`, and the walk carried on to the
        // next candidate — turning plan `:1032`'s "an exception propagates immediately" into
        // "an exception demotes the translation that had already succeeded". The port then crashed
        // on the next candidate trying to push onto the already-frozen `precedingFailures`, which
        // is the only reason the mistake was loud. `test/fallback-observer.test.js`'s
        // "an exception propagates immediately" is what caught it and is what keeps it caught.
        try {
          // The evaluation locale is the SUPPLYING candidate, not the requested tag. This one
          // argument is the donor rule, and passing `lookupLocale` here would be silently wrong for
          // every fallback-served plural, gender, and phonetic selection — and for every
          // ALTERNATIVE, whose `count == CARDINALITY_ONE` must classify under the donor too.
          translation = render(
            definition,
            placeholders,
            renderContextFor(key, candidate, bidiIsolation),
          );
          rendered = true;
        } catch (error) {
          attemptFailureReason = "resolution-failure";
          attemptCause = error;
          // First cause wins, never the last: Java assigns `firstFallbackFailure` only while null.
          if (firstFailureCause === null) firstFailureCause = error;
        }

        // Java's `Optional.empty()`: the entry exists, but no alternative matched and the selected
        // node carries no translation. A DIFFERENT reason from the key being absent, and the
        // difference is visible to a policy — `custom-policy.reasons.halts-on-the-unlisted-no-
        // matching-alternative` halts on it while its neighbour walks past.
        if (rendered && translation === null) {
          attemptFailureReason = "no-matching-alternative";
          noMatchingAlternative = true;
        }
      }

      // `TranslationResult`'s constructor runs INSIDE the `try` at `DefaultStrings.java:713-726`, so
      // an attempted-locale refusal is caught as THIS candidate's `RESOLUTION_FAILURE` and the walk
      // continues exactly as it would after a throwing render — same reason, same first-cause
      // retention, same policy consultation. The port's own `try` covers the render alone, on
      // purpose (see above), so the refusal is routed by hand rather than by widening that scope.
      const attemptedRefusal = translation === null ? null : attemptedLocaleRefusal(attempted);

      if (attemptedRefusal !== null) {
        translation = null;
        attemptFailureReason = "resolution-failure";
        attemptCause = attemptedRefusal;
        if (firstFailureCause === null) firstFailureCause = attemptedRefusal;
      }

      if (translation !== null) {
        // ONE frozen list again, shared by the result and the event, on the same rule the failure
        // path states below for the failure and its result.
        const attemptedLocales = freeze([...attempted]);
        const result = freeze({
          key,
          translation,
          status: /** @type {const} */ ("translated"),
          lookupLocale,
          localeMatch,
          resolvedLocale: candidate,
          attemptedLocales,
          isFallback: isFallbackFor(localeMatch, lookupLocale, candidate),
          failureReason: null,
          cause: null,
        });

        // "Called once after a later candidate succeeds and before return" (plan 3.5). BOTH halves
        // are load-bearing:
        //
        //   * "a LATER candidate" — `precedingFailures.length > 0` is the whole test, and it is
        //     equivalent to "this is not the first candidate attempted", since the walk only
        //     advances past a candidate that failed. The FIRST candidate answering is not a
        //     per-key fallback no matter what negotiation did upstream, which is why this
        //     deliberately does NOT consult `isFallback`. The two fields answer different
        //     questions — "did NEGOTIATION land on what you asked for" and "did per-key
        //     RESOLUTION walk past a candidate" — and the disagreement is the contract, not a
        //     defect. Measured, not argued: a supplied `cldr-fallback` match selecting `en` over
        //     catalogs {en, fr} attempts exactly `[en]`, answers from it, and reports
        //     `isFallback: true` with ZERO events. `test/fallback-observer.test.js` pins that row,
        //     because a port that fired the observer off `isFallback` would pass every other
        //     assertion in this file.
        //   * "before return" — the observer runs while `result` exists but is not yet the
        //     caller's, so a throwing observer means the caller gets the exception and no
        //     translation, and there is no window in which both happen.
        //
        // `localeMatch` goes in BY REFERENCE, not rebuilt: plan 3.3's identity clause requires the
        // same frozen object on the result, the failure, every event and any final
        // `MissingTranslationError`, and a structural copy would satisfy every field while
        // violating it. `test/fallback-observer.test.js` asserts it with `assert.equal`, which is
        // reference equality, for exactly that reason.
        if (onFallback !== null && precedingFailures.length > 0)
          notifyFallbackObserver(
            onFallback,
            freeze({
              key,
              lookupLocale,
              localeMatch,
              attemptedLocales,
              resolvedLocale: candidate,
              precedingFailures: freeze(precedingFailures),
            }),
            onFallbackWhere,
          );

        return result;
      }

      // This candidate did not answer. Recorded from the SAME three values the policy consultation
      // below is handed, and recorded here — before the final-candidate break — so a walk that ends
      // by exhausting its chain records its last failure like every other. Nothing reads the list on
      // that path (no event fires when nothing succeeded), but a list whose contents depended on how
      // the loop happened to exit would be a trap for the next change to this function.
      if (onFallback !== null)
        precedingFailures.push(
          freeze({ locale: candidate, reason: attemptFailureReason, cause: attemptCause }),
        );

      // BEFORE the consultation, never after. A policy is never asked about the final candidate,
      // whatever it would have said — which is what makes a throwing policy inert on a one-element
      // chain, and what makes `policyCalls.length === attemptedLocales.length` true exactly when the
      // last recorded decision was `false` rather than "always one fewer".
      if (candidateIndex + 1 >= chain.length) break;

      const shouldTryNextLocale = fallbackPolicy(attemptFailureReason, candidate, attemptCause);

      // `requireNonNull(..., "translationFallbackPolicy returned null")` (DefaultStrings.java:735).
      // Refused rather than coerced: a policy returning `undefined` is a caller mistake, and reading
      // it as "stop" would silently truncate every walk it governs. No corpus row reaches this — the
      // TWO ARMS, because Java only has something to say about one of them.
      //
      // Java's guard is `requireNonNull(..., "translationFallbackPolicy returned null")`
      // (`DefaultStrings.java:735`), recorded by the oracle's return-null behavior. We reproduce its
      // SHAPE with the JS option name, which is what `localeResolver`/`localeMatchResolver` already
      // do at `:900`/`:914` — the port speaking one dialect rather than three. The remaining
      // difference from Java is the identifier alone, declared in conformance.mjs's
      // DECLARED_MESSAGE_DIVERGENCES and gated STALE if it ever stops differing.
      if (shouldTryNextLocale == null) throw new TypeError("fallbackPolicy returned null");

      // Java's type system makes a non-boolean unreachable, so there is no Java wording to match and
      // nothing to declare: this arm is the port's own, and it stays informative.
      if (typeof shouldTryNextLocale !== "boolean")
        throw new TypeError(
          "The configured fallbackPolicy must return a boolean; received " +
            `${JSON.stringify(shouldTryNextLocale) ?? String(shouldTryNextLocale)}`,
        );

      if (!shouldTryNextLocale) break;
    }

    // Java's precedence, and the ORDER is not the order the attempts happened in: a resolution
    // failure anywhere outranks a no-match anywhere, which outranks the key simply being absent.
    const failureReason = firstFailureCause !== null
      ? /** @type {const} */ ("resolution-failure")
      : noMatchingAlternative
        ? /** @type {const} */ ("no-matching-alternative")
        : /** @type {const} */ ("missing-translation");

    // ONE frozen list, shared by the failure the handler sees and the result it produces, the same
    // way `localeMatch` is shared. `matchObjectIdenticalToResult` is a recorded observable on the
    // Java side and the corpus asserts it `true` on all 370 rows that can compare the two.
    const attemptedLocales = freeze([...attempted]);
    const translationFailure = translationFailureFor(key, lookupLocale, localeMatch,
        attemptedLocales, failureReason, firstFailureCause, placeholders);

    // EXACTLY ONCE, and only here — after the walk, never per candidate. All 471 corpus rows that
    // observe the handler record exactly one failure, including the walks that failed at four
    // separate candidates for three distinct reasons.
    const response = onFailure(translationFailure);

    // Two arms, for the reason given at the fallbackPolicy guard above: Java's
    // `requireNonNull(..., "TranslationFailureHandler returned null")` speaks only to the null case,
    // so that arm reproduces its shape with the JS option name and the rest stays the port's own.
    if (response == null) throw new TypeError("onFailure returned null");

    if (typeof response !== "object")
      throw new TypeError(
        "The configured onFailure handler must return a failure response object; received " +
          `${JSON.stringify(response) ?? String(response)}`,
      );

    switch (response.action) {
      case "return-key":
        // The failure key is interpolated under the REQUESTED locale, not a supplying one: by
        // definition no catalog supplied this entry (DefaultStrings.java:754 passes `locale`).
        return failureResult(translationFailure, "returned-key",
            interpolateFailureKey(key, placeholders,
                shouldApplyBidiIsolation(bidiIsolation, lookupLocale)));
      case "return-string":
        if (typeof response.translation !== "string")
          throw new TypeError(
            "A return-string failure response must carry a string translation; received " +
              `${JSON.stringify(response.translation) ?? String(response.translation)}`,
          );
        // VERBATIM. Not interpolated, not isolated — see `returnString`.
        return failureResult(translationFailure, "returned-string", response.translation);
      case "throw":
        return throwForFailure(translationFailure);
      default:
        // `TranslationFailureResponse.Action` has three members and Java's own `default` arm raises
        // `IllegalArgumentException` on a fourth (DefaultStrings.java:764-766). Reached here by a
        // handler returning an object of some other shape, which TypeScript's union has already
        // narrowed away — hence the cast, which is a statement about untyped callers, not a hole.
        throw new TypeError(
          `Unsupported failure response action ${JSON.stringify(/** @type {any} */ (response).action)}; ` +
            "expected 'return-key', 'return-string', or 'throw'",
        );
    }
  }

  /**
   * The handler-produced `TranslationResult`, for the two responses that produce one.
   *
   * @param {TranslationFailure} translationFailure
   * @param {"returned-key" | "returned-string"} status
   * @param {string} translation
   */
  function failureResult(translationFailure, status, translation) {
    // The SECOND run of `TranslationResult`'s constructor validation, and the one that escapes.
    // `DefaultStrings.java:754/759` build the handler's result OUTSIDE every `try`, so a refusal the
    // walk already reported to `onFailure` as a `RESOLUTION_FAILURE` cause now reaches the caller —
    // and reaches it as a NEW error, because Java re-enters the constructor rather than rethrowing
    // what it caught. `THROW_EXCEPTION` is deliberately not covered: `throwExceptionFor`
    // (`DefaultStrings.java:3196-3213`) builds no result, so it rethrows the retained cause by
    // identity, which `throwForFailure` already does.
    const refusal = attemptedLocaleRefusal(translationFailure.attemptedLocales);
    if (refusal !== null) throw refusal;

    return freeze({
      key: translationFailure.key,
      translation,
      status,
      lookupLocale: translationFailure.lookupLocale,
      localeMatch: translationFailure.localeMatch,
      resolvedLocale: null,
      attemptedLocales: translationFailure.attemptedLocales,
      isFallback: isFallbackFor(/** @type {any} */ (translationFailure.localeMatch),
          translationFailure.lookupLocale, null),
      failureReason: translationFailure.reason,
      cause: translationFailure.cause,
    });
  }

  /**
   * @param {string} key
   * @param {Readonly<Record<string, unknown>>} [placeholders]
   * @param {TranslationCallOptions} [callOptions] plan 3.3's full `TranslationOptions`, not a subset.
   *   This declaration used to name only `locale` and `bidiIsolation` while forwarding VERBATIM to
   *   `getResult`, so `localeMatch`, `fallbackPolicy` and `onFailure` all worked at runtime and were
   *   type errors — a TypeScript caller could reach them only through `getResult`. Widened here
   *   rather than adding `onFallback` alone to a shape that was already three options short.
   */
  const get = (key, placeholders, callOptions) => getResult(key, placeholders, callOptions).translation;

  /**
   * The exact-locale lookup both inspection members share, sorted the way Java's `TreeSet` sorts.
   *
   * A case-normalized spelling of the same serialized tag is accepted because `normalizeTag` folds
   * it; an absent CLDR-EQUIVALENT tag is not, because `normalizeTag` performs JDK normalization and
   * not CLDR aliasing — `mo` stays `mo` and does not find a loaded `ro`. Plan 3.3:773 names exactly
   * that distinction.
   */
  const keysForExactLocale = (
    /** @type {string} */ locale,
    /** @type {string} */ description,
    /** @type {"source" | "target" | undefined} */ role,
  ) => {
    // THE INSPECTION INGRESS — `LocaleUtils.requireWellFormed` at `DefaultStrings.java:2713`
    // ("Locale"), `:2735` ("Source locale") and `:2736` ("Target locale"). It is Java's FIRST
    // statement in both members, before the support test, and the two questions are genuinely
    // different: measured on pinned Corretto 21, `getKeysForLocale(en__NY)` answers `Locale 'en__NY'
    // is not a well-formed IETF BCP 47 locale` while `getKeysForLocale(de)` — a well-formed locale
    // that is simply absent — answers `Locale 'de' is not supported`.
    //
    // THE PORT ANSWERED THE SUPPORT QUESTION TO BOTH, which is a wrong-site refusal: an ill-formed
    // locale came back as `UnsupportedLocaleError: Unsupported locale 'en-x-lvariant-NY' was
    // provided`, reporting a catalog that is missing where Java reports a locale that cannot exist.
    // The support half is unchanged and is deliberately NOT Java's wording — plan 3.3:771 names
    // `UnsupportedLocaleError` and its sentence, and that decision is out of scope here.
    //
    // WHAT GATES IT: `test/inspection.test.js`, which carried no well-formedness assertion until
    // 2026-09-09, and `tools/lookup-diff/`'s FOUR inspection shapes, added the same day because
    // NOTHING drove this surface — no corpus row reaches an inspection call (the Java branches are
    // `required` and still owe a case, since fixing the PORT closes no JAVA branch) and the
    // differential drove lookups only. The four shapes sweep `getKeysForLocale`, the tag in
    // `getMissingKeys`'s SOURCE role, the tag in its TARGET role against a well-formed UNSUPPORTED
    // source, and BOTH roles ill-formed at once. The last two are the ORDER probes: Java answers
    // about the target's well-formedness where a port that resolved source-then-target answers about
    // the source, and names the SOURCE when both are ill-formed.
    //
    // "Three" here was a stale count, not a design: `missingSourceFirst` was added while the
    // differential grew inside its own batch and three of the four places that name the number were
    // never revisited. Corrected 2026-09-09; `PROBE_SHAPES` in `tools/lookup-diff/run.mjs` is the
    // only authority.
    const normalized = requireJdkWellFormedLocale(normalizeTag(locale), description);
    const catalog = catalogs.get(normalized);
    // THE ROLE, and it is Java's distinction rather than a decoration. `:2738` and `:2741` refuse
    // `getMissingKeys`' two arguments with DIFFERENT sentences; this port answered one sentence to
    // both until 2026-09-09, so a caller who passed two tags learned only that one of them was
    // wrong. The well-formedness refusal one line above ALREADY named the role — `description` is
    // threaded here for exactly that — so the two halves of the same ingress disagreed with each
    // other, which is what makes this a repair and not a widening. `getKeysForLocale` passes no role
    // because Java's `:2718` names none: it has one argument, and there is nothing to disambiguate.
    if (catalog === undefined) throw new UnsupportedLocaleError(normalized, role);
    return [...catalog.keys()].sort();
  };

  return freeze({
    get,
    t: get,
    getResult,
    // SORTED, and the sort is the contract rather than a convenience. Plan 3.3:759 — "Supported
    // locales are sorted by normalized serialized tag" — and `DefaultStrings.java:520-521` sorts
    // `sortedSupportedLocales` by `Comparator.comparing(Locale::toLanguageTag)`, which
    // `getSupportedLocales()` (`:2700-2702`) then hands back through a `LinkedHashSet`.
    //
    // MEASURED with catalogs `{fr, en-fonipa, de, ar}`: Java answers `[ar, de, en__fonipa, fr]`;
    // this accessor and `getLocaleConfiguration().supportedLocales` both answered `["fr",
    // "en-fonipa", "de", "ar"]` — the caller's insertion order — until 2026-09-09. Nothing caught it
    // because every OTHER consumer sorts locally (`:818`, `:829`, `:1708`, `:1713`) and
    // `consideredLocales` is sorted inside `src/internal/locale.js:447`, so the matcher agreed with
    // Java and only the two ACCESSORS did not: the port was right where it is used and wrong only
    // where it is observed. `compareTags` is `<`/`>` on the serialized tag, i.e. UTF-16 code-unit
    // order, which is what `String.compareTo` gives Java's comparator.
    getSupportedLocales: () => freeze([...supported].sort(compareTags)),
    /**
     * Plan 3.3:771. INSPECTION IS EXACT-LOCALE-ONLY: normalize, then look the tag up exactly. No
     * equivalence, no negotiation, no fallback — which is what separates this from every other
     * locale-taking member here.
     *
     * Two defects were measured against Java on 2026-09-06 and are fixed here. (1) An unsupported
     * locale returned `[]`, where Java throws (`DefaultStrings.java:2718-2720`); the port refused
     * nothing at all, so a caller inspecting a locale it had never loaded got silence instead of an
     * answer. (2) Keys came back in catalog INSERTION order, where Java's `TreeSet` returns them
     * sorted; `sort()` on UTF-16 code units is `String.compareTo`'s ordering, so the two agree.
     *
     * The thrown type follows PLAN 3.3, not Java: Java raises `IllegalArgumentException`, the plan
     * names `UnsupportedLocaleError`, and this is a JS-facing inspection API. No corpus row exercises
     * it, so nothing arbitrates between them today — deliberately NOT papered over by widening
     * `conformance.mjs`'s shared `IllegalArgumentException` row, which would weaken 34 unrelated
     * comparisons to settle one unmeasured case.
     */
    getKeysForLocale: (/** @type {string} */ locale) =>
      freeze(keysForExactLocale(locale, LOCALE_INGRESS_DESCRIPTION.inspectionLocale, undefined)),

    /**
     * Plan 3.3:773 — the same exact-locale rule applied INDEPENDENTLY to source and target, so an
     * unsupported target is refused even when the source is fine. Java validates in that order too
     * (`DefaultStrings.java:2735-2741`).
     */
    getMissingKeys: (/** @type {string} */ sourceLocale, /** @type {string} */ targetLocale) => {
      // BOTH WELL-FORMEDNESS CHECKS RUN BEFORE EITHER SUPPORT CHECK, because that is Java's order
      // (`:2735`, `:2736`, then `:2738` and `:2741`) and the difference is observable: with an
      // unsupported source and an ill-formed target, Java answers `Target locale '…' is not a
      // well-formed IETF BCP 47 locale` and a port that simply resolved source-then-target would
      // answer that the SOURCE is unsupported. Validating inside `keysForExactLocale` alone would
      // interleave the four checks and produce exactly that wrong answer.
      requireJdkWellFormedLocale(normalizeTag(sourceLocale), LOCALE_INGRESS_DESCRIPTION.sourceLocale);
      requireJdkWellFormedLocale(normalizeTag(targetLocale), LOCALE_INGRESS_DESCRIPTION.targetLocale);

      const source = keysForExactLocale(sourceLocale, LOCALE_INGRESS_DESCRIPTION.sourceLocale, "source");
      const target = new Set(
        keysForExactLocale(targetLocale, LOCALE_INGRESS_DESCRIPTION.targetLocale, "target"),
      );
      return freeze(source.filter((key) => !target.has(key)));
    },
    getLocaleConfiguration: () =>
      // `tiebreakers` is a RECORD here even when none were configured, per the `LocaleConfiguration`
      // declaration in plan 3.2, which types it `Readonly<Record<...>>` rather than nullable. Null
      // travels on internally because the matcher distinguishes "none" from "empty" in its own
      // bookkeeping; a reader of the configuration does not, and should not have to null-check a
      // map it is about to iterate.
      freeze({
        fallbackLocale,
        // Sorted for the same reason `getSupportedLocales` above is: plan 3.3:765 says a directly
        // constructed instance's configuration "likewise contains that loaded set", and :759 sorts
        // it. The two accessors were the only places the port reported the raw insertion order.
        supportedLocales: freeze([...supported].sort(compareTags)),
        tiebreakers: tiebreakers ?? EMPTY_TIEBREAKERS,
      }),
    /**
     * Plan 3.3's three loading seams, and all three answer for the DIRECT branch too.
     *
     * `isCatalogComplete()` is `true` for a directly constructed instance and that is not a
     * placeholder: a caller who handed core its catalogs handed it all of them, so there is nothing
     * partial about the set. Completeness is a statement about a LOAD, and a direct instance's load
     * is the argument list. The identity and the verification record are `null` for the same reason
     * in reverse — neither exists unless a verified manifest loader produced one, and plan 6.4 makes
     * that absence the thing `createSsrStamp` refuses on.
     */
    getCatalogIdentity: () =>
      (loadVerification === null ? suppliedIdentity : loadVerification.catalogIdentity),
    isCatalogComplete: () => (loadVerification === null ? true : loadVerification.complete),
    getLoadVerification: () => loadVerification,
    getWarnings: () => freeze([...warnings]),
    /**
     * The narrow, side-effect-free observation of core's automatic direct-locale path.
     *
     * Plan 3.3 declares this the counterpart of `Strings#matchFor(Locale)`, so it carries that
     * method's ingress check: `LocaleUtils.requireWellFormed(locale, "Requested locale")` at
     * `LocaleMatcher.java:64`, the default interface method every `matchFor(Locale)` and
     * `bestMatchFor(Locale)` call enters through. `src/negotiate/index.js` carries the same check
     * on the same locale for the standalone negotiator's two locale doors.
     *
     * INVISIBLE FROM THE LOOKUP SITES ABOVE, which is why implementing only those would have been
     * the probe-space trap: `localeLookupFor` validates first, so Java's `matchFor(requestedLocale)`
     * at `DefaultStrings.java:2439` and `:2458` can never be the refusal a lookup observes. This
     * site is only reachable when a caller asks the SELECTION channel directly, and the corpus
     * already carries three controls that must keep ANSWERING it —
     * `lvariant.exhausting-walk.{en-us-posix,ja-jp,th-th}.selection-channel-does-not-refuse`, whose
     * locales denote `en_US_POSIX`, `ja_JP_JP` and `th_TH_TH`, all three of which
     * `Locale.Builder#setLocale` accepts (the last two by explicit legacy special case).
     */
    getDirectLocaleContext: (/** @type {string} */ locale) => {
      const lookupLocale = requireJdkWellFormedLocale(
        normalizeTag(locale), LOCALE_INGRESS_DESCRIPTION.requestedLocale);
      // The caller's own spelling into the matcher, `lookupLocale` out of the observation — the
      // same split, for the same measured reason, as `localeLookupFor`'s two arms. This site is
      // where the double normalization was CAUGHT: `diff:lookup`'s new matcher ingress reported 42
      // rows where Java answered `requestedLanguageRanges [und-x-a]` and this port `[x-a]`, all of
      // them a non-lowercase `und` followed only by private use, and none of them reachable through
      // the two lookup ingresses the tool already drove.
      return freeze({
        lookupLocale,
        localeMatch: freeze(matchFor(locale, supported, fallbackLocale, tiebreakers)),
      });
    },
  });
}

/**
 * The per-call options object naming one explicit locale:
 * `strings.get(key, undefined, forLocale("fr-CA"))`.
 *
 * Plan section 3.3 declares it and section 3.5 gives it its entire behavior in one word: `forLocale`
 * "performs syntactic normalization IMMEDIATELY". A caller who writes the object by hand —
 * `{ locale: "fr-ca" }` — is equally valid and normalizes inside `getResult` instead, so the only
 * thing this function buys is WHERE a malformed tag is reported: at the site that spelled it, rather
 * than at whichever unrelated lookup later consumed it. That difference is the reason it exists, and
 * it is the thing `test/for-locale.test.js` discriminates — nothing in the corpus can, because the
 * oracle has no counterpart operation for it and every recorded ingress spells its tag well-formed.
 *
 * It deliberately knows nothing about any catalog. The instance-dependent match and coverage
 * validation stays where section 3.5 puts it, at consumption by a `Strings`, so one options object
 * stays reusable across instances that load different locales.
 *
 * @param {string} locale
 * @returns {Readonly<{ locale: string }>}
 * @throws {RangeError} if the tag is not a well-formed IETF BCP 47 locale
 */
export function forLocale(locale) {
  return freeze({ locale: normalizeTag(locale) });
}

/** Plan 3.4: the chooser "examines at most 32 entries in order". Its own cap, not the matcher's. */
const MAXIMUM_PREFERRED_LANGUAGES = 32;

/**
 * Plan 3.4's small browser chooser, and it is EXPLICITLY NON-PARITY: it ranks nothing.
 *
 * Java has no counterpart, so there is no oracle for it and the corpus has zero cases that call it.
 * What the corpus does carry is the two halves the chooser is assembled from — every
 * `browser-chooser.*.locale` row is the strict single-locale kernel this walks the list with, and
 * the matching `.ranges` row is what the whole-list solver in `lokalized/negotiate` answers for the
 * same preference. Those two disagree on purpose, and the disagreement is why this function is
 * allowed to be small rather than wrong: `browser-chooser.conflict.sgn-no-solvers-diverge.locale`
 * records `sgn-NO` selecting `nsl` while its `.ranges` twin selects `nsi`, and
 * `browser-chooser.collision.zh-cmn-solvers-diverge.locale` records `cmn` against the solver's `zh`.
 * A chooser that quietly answered like the solver would be a second, undeclared implementation of
 * RFC 4647 living in the root graph — which is the one thing plan 3.1 keeps out of it.
 *
 * THREE TRAPS, each of which produces a plausible answer if it is fallen into:
 *
 *  1. **The kernel must be the STRICT one.** `matchFor` reports an unmatched preference as
 *     unmatched; `bestMatchFor` manufactures the configured fallback for it. Built on the latter,
 *     the very first preference always "matches" and the list never advances past entry one —
 *     `["xx", "fr"]` answers the fallback instead of `fr`, and looks like a matcher bug rather than
 *     a chooser bug.
 *  2. **Over-32 TRUNCATES SILENTLY, and that is a third behaviour.** The same overflow is a throw
 *     through `matchForLanguageRanges` (`browser-chooser.limit.explicit-thirty-three-ranges-
 *     rejected` records `IllegalArgumentException`) and a fail-soft fallback through
 *     `bestMatchForAcceptLanguage` (`accept-language.limit.thirty-three-expanded-ranges`). Neither
 *     is this one. `navigator.languages` is attacker-influenced in a browser and the plan's words
 *     are "examines at most 32 entries in order", so entry 33 is not looked at — it is not an error
 *     either, and turning it into one would make a page fail on a preference list the user set.
 *  3. **Exhaustion returns the RESOLVED fallback, never the configured tag.** This is A0's
 *     resolution (`DefaultStrings.java:446-470`), and it is reachable here because a
 *     `LocaleConfiguration` may be hand-built rather than taken from `getLocaleConfiguration()`,
 *     whose `fallbackLocale` is already resolved. Configured `hy-810` over loaded `{hy-AM, hy-SU}`
 *     is canonically equivalent to BOTH, so the configured spelling names no catalog at all: a
 *     chooser returning it hands the caller a tag every subsequent lookup misses on, and the
 *     tiebreaker that decides between the two is never consulted. `test/browser-chooser.test.js`
 *     pins it by REVERSING that tiebreaker and requiring the answer to move.
 *
 * The two refusals below are `createStrings`' own, deliberately: a configuration is a configuration
 * whichever door it arrives at, and a fallback naming no loaded catalog is the mistake `createStrings`
 * refuses at construction. `lokalized/negotiate`'s `applicableConfiguration` refuses the same shape
 * differently — it requires an ALREADY-resolved fallback and will not resolve one — so this is not a
 * duplicated rule but the other half of the pair: the negotiator is handed a `Strings` instance's
 * configuration, and this is the door a hand-built one comes through.
 *
 * @param {{ fallbackLocale: string, supportedLocales: readonly string[],
 *   tiebreakers?: Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]> | null }} configuration
 * @param {Iterable<unknown>} languages the caller's preference list, most-preferred first
 * @returns {string} the selected supported locale, or the resolved fallback
 */
export function chooseLocaleForPreferredLanguages(configuration, languages) {
  if (typeof configuration !== "object" || configuration === null)
    throw new RangeError("A locale configuration is required");

  if (languages == null || typeof languages === "string" ||
      typeof (/** @type {any} */ (languages)[Symbol.iterator]) !== "function")
    throw new TypeError(
      "chooseLocaleForPreferredLanguages(configuration, languages) requires an iterable of " +
        "preferred language tags; pass [] when the host has none",
    );

  const supported = [...configuration.supportedLocales].map((tag) => normalizeTag(tag));
  const configuredFallbackLocale = normalizeTag(configuration.fallbackLocale);
  const tiebreakers = safeTiebreakers(configuration.tiebreakers);
  const equivalentFallbackLocales = supported
    .filter((tag) => equivalentTags(tag, configuredFallbackLocale))
    .sort(compareTags);

  if (equivalentFallbackLocales.length === 0)
    throw new RangeError(
      `Specified fallback locale is '${configuredFallbackLocale}' but no matching localized ` +
        `strings locale was found. Known locales: ${javaList([...supported].sort(compareTags))}`,
    );

  const fallbackLocale = resolveFallbackLocale(
    configuredFallbackLocale,
    supported,
    equivalentFallbackLocales,
    tiebreakers,
  );

  let examined = 0;
  for (const preference of languages) {
    if (examined >= MAXIMUM_PREFERRED_LANGUAGES) break;
    examined += 1;

    // "Ignores malformed entries", and malformed is decided by the SAME `normalizeTag` every other
    // ingress uses rather than by a pattern of its own. A non-string entry is malformed too: a
    // browser hands over strings, and anything else in the list is the host's mistake, not a reason
    // to abandon the preferences that follow it.
    if (typeof preference !== "string") continue;

    try {
      normalizeTag(preference);
    } catch {
      continue;
    }

    // THE RAW PREFERENCE, not the normalized one, for the reason `localeLookupFor` records: the
    // kernel normalizes its argument, so passing the normalized tag normalizes twice and the two
    // disagree for a non-lowercase `und` followed only by private use. `normalizeTag` above is the
    // MALFORMEDNESS test and nothing else — its result is discarded, which is why it is called for
    // its throw. The chooser has no Java counterpart to diverge from, and it is aligned here anyway
    // so that "which locale does this range select" has ONE answer across every matcher ingress in
    // the port rather than an answer per door.
    const match = matchFor(preference, supported, fallbackLocale, tiebreakers);

    // `locale` is non-null for every matched result the kernel can produce, and the guard is here so
    // the return type is a tag rather than a tag-or-null: reading `isMatch` alone and returning
    // `match.locale` would type-check and hand back `null` if that invariant ever moved.
    if (match.isMatch && match.locale !== null) return match.locale;
  }

  return fallbackLocale;
}

/**
 * The browser convenience: `navigator.languages`, or `[]` when the host has none.
 *
 * It reads the global lazily rather than at module scope, so the module still evaluates in a worker,
 * on a server, and under SSR — where there is no `navigator` at all and the honest answer is the
 * configured fallback.
 *
 * `navigator.languages` is an ARRAY of tags; `navigator.language` is a single STRING. Spreading the
 * latter by accident yields one-character "preferences" that are all malformed, so the chooser would
 * silently answer the fallback for every request — which is why a string is refused here rather than
 * iterated, and why the pure helper above refuses one too.
 *
 * @param {Parameters<typeof chooseLocaleForPreferredLanguages>[0]} configuration
 * @returns {string} the selected supported locale, or the resolved fallback
 */
export function chooseBrowserLocale(configuration) {
  const languages = /** @type {any} */ (globalThis).navigator?.languages;

  return chooseLocaleForPreferredLanguages(
    configuration,
    languages != null && typeof languages !== "string" &&
      typeof languages[Symbol.iterator] === "function"
      ? [...languages]
      : [],
  );
}

/**
 * `LocaleMatcher.MAXIMUM_LANGUAGE_RANGES` (LocaleMatcher.java:52), which `LocaleMatchResult`'s own
 * constructor enforces before anything else it checks.
 */
const MAXIMUM_LANGUAGE_RANGES = 32;

/**
 * LAYER ONE of the two the plan requires for a caller-supplied match: `LocaleMatchResult`'s own
 * constructor (`LocaleMatchResult.java:80-135`), which is instance-INDEPENDENT.
 *
 * Java gets this layer for free because `LocaleMatchResult` is a class and a caller cannot hold an
 * invalid one. Plan 3.4 gives JS the same value as a STRUCTURAL type, so there is no constructor to
 * run and the rules have to be applied where the value is consumed — here, and by `forLocaleMatch`
 * at the site that spelled it, exactly as `forLocale` front-loads `normalizeTag`.
 *
 * THE ORDER IS JAVA'S AND IS OBSERVABLE. Four corpus rows exist only to pin it, each named for the
 * check it proves runs first: `supplied-match.considered.duplicate-check-precedes-fallback-
 * containment`, `.range.containment-check-precedes-weight-check`, `supplied-match.contradiction.
 * none-with-locale-is-rejected` (the unmatched arm at :103 is evaluated before the matched arm at
 * :106, so a locale carried with `matchType: "none"` reports the MATCHED message), and
 * `supplied-match.considered.empty-list-fails-in-the-constructor` — whose entire point is that an
 * empty considered list is refused HERE, by fallback containment, and never reaches layer two's
 * set comparison. Folding the two layers into one check reports the wrong message on that row.
 *
 * THE WEIGHT IS PART OF THE MATCHED RANGE'S IDENTITY. Re-probed on the pinned Corretto 21 rather
 * than inherited: `new LanguageRange("he").equals(new LanguageRange("he", 0.5))` is FALSE (control:
 * two `he@0.5` are equal, and `List.contains` agrees with both), so Java's `contains` at
 * `LocaleMatchResult.java:108` refuses a matched `("fr",1.0)` against a requested `[("fr",0.5)]`.
 * `supplied-match.range.identity-includes-weight` is that row. A JS `languageRange` may therefore be
 * spelled either as a bare range string — the one-argument `LanguageRange` spelling, whose weight is
 * 1.0 by definition — or as the `{ range, weight }` pair, and the pair is what a caller must use to
 * hand back a match won by a weighted header range.
 *
 * @param {unknown} supplied
 * @param {string} where the option that carried it, for the JS-facing shape errors only
 * @returns {LocaleMatch} the same object, unchanged
 */
function validateLocaleMatchStructure(supplied, where) {
  if (typeof supplied !== "object" || supplied === null)
    throw new TypeError(`${where} must be a LocaleMatchResult object; received ${JSON.stringify(supplied) ?? String(supplied)}`);

  const match = /** @type {LocaleMatch} */ (supplied);
  const requested = match.requestedLanguageRanges ?? [];

  if (!Array.isArray(requested))
    throw new TypeError(`${where} must carry requestedLanguageRanges as an array`);

  // `LocaleMatchResult.java:86`. FIRST, before every other rule, and the pair
  // `supplied-match.range-count.thirty-two-is-accepted-and-echoed` / `.thirty-three-is-rejected`
  // pins the boundary from both sides.
  if (requested.length > MAXIMUM_LANGUAGE_RANGES)
    throw new RangeError(
      `At most ${MAXIMUM_LANGUAGE_RANGES} language ranges are supported, but received ${requested.length}`,
    );

  for (const range of requested)
    if (typeof range !== "object" || range === null || typeof range.range !== "string" || typeof range.weight !== "number")
      throw new TypeError(`${where} requestedLanguageRanges entries must be { range, weight }`);

  const locale = match.locale ?? null;
  // THE SUPPLIED-MATCH INGRESS — `LocaleUtils.requireWellFormed` at `LocaleMatchResult.java:97`
  // ("Selected locale"), `:101` ("Fallback locale") and `:117` ("Considered locale"), the third of
  // which is in the considered loop below. These are CALLER-FACING: `LocaleMatchResult`'s
  // constructor is public on purpose (`:65-80`, "This is public so custom LocaleMatcher
  // implementations can expose the same diagnostics"), and the port's counterpart surfaces are
  // `forLocaleMatch`, per-call `{ localeMatch }` and `localeMatchResolver`.
  //
  // UNTIL 2026-09-09 THIS COMMENT CLAIMED THE CHECK AND THE CODE CALLED `normalizeTag` ALONE — the
  // tag-level guard, which ACCEPTS `en-x-lvariant-NY`. That is the one shape a reader is actively
  // told exists, so it is worth naming: the port accepted all three of Java's refusals, and
  // `createLocaleNegotiator({ fallbackLocale: "fr", supportedLocales: ["fr",
  // "en-x-lvariant-NY"] }).matchFor("fr").consideredLocales` answered with a `LocaleMatch` value
  // Java's type system cannot construct.
  //
  // MEASURED on pinned Corretto 21 against `lokalized-3.0.0.jar`, both controls constructing:
  // `new LocaleMatchResult([en], en__NY, en, 1.0, EXACT, fr, [en__NY, fr])` -> `Selected locale
  // 'en__NY' is not a well-formed IETF BCP 47 locale`; the same with `fallbackLocale = en__NY` ->
  // `Fallback locale '…'`; with `en__NY` only inside `consideredLocales` -> `Considered locale '…'`.
  //
  // THE ORDER IS THE BEHAVIOUR, not a tidiness preference. `:97` precedes the unmatched-arm check at
  // `:103`, so a `{ locale: en__NY, matchType: "none" }` result is reported as a MALFORMED LOCALE
  // and not as a shape contradiction — the port answered `A matched locale result requires a range,
  // weight, and non-NONE match type`, refusing for the wrong reason. Likewise `:117` precedes the
  // duplicate-tag check at `:119`. Both orderings are pinned by `test/supplied-match-ingress.test.js`.
  const selectedLocale =
    locale === null
      ? null
      : requireJdkWellFormedLocale(normalizeTag(locale), LOCALE_INGRESS_DESCRIPTION.selectedLocale);
  const matchFallbackLocale = requireJdkWellFormedLocale(
    normalizeTag(match.fallbackLocale), LOCALE_INGRESS_DESCRIPTION.fallbackLocale);
  const languageRange = match.languageRange ?? null;
  const effectiveWeight = match.effectiveWeight ?? null;
  const matchType = match.matchType;

  if (selectedLocale === null && (languageRange !== null || effectiveWeight !== null || matchType !== "none"))
    throw new RangeError("An unmatched locale result must use NONE and omit range and weight");

  if (selectedLocale !== null && (languageRange === null || effectiveWeight === null || matchType === "none"))
    throw new RangeError("A matched locale result requires a range, weight, and non-NONE match type");

  if (languageRange !== null) {
    const rangeText = typeof languageRange === "string" ? languageRange : languageRange.range;
    const rangeWeight = typeof languageRange === "string" ? 1 : languageRange.weight;

    if (typeof rangeText !== "string" || typeof rangeWeight !== "number")
      throw new TypeError(`${where} languageRange must be a range string or a { range, weight } pair`);

    if (!requested.some((range) => range.range === rangeText && range.weight === rangeWeight))
      throw new RangeError("The matched language range must be present in requested language ranges");
  }

  if (effectiveWeight !== null && (!Number.isFinite(effectiveWeight) || effectiveWeight <= 0 || effectiveWeight > 1))
    throw new RangeError(
      "A matched locale result requires a finite effective weight greater than 0 and at most 1",
    );

  const considered = match.consideredLocales;

  if (!Array.isArray(considered))
    throw new TypeError(`${where} must carry consideredLocales as an array`);

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const normalizedConsidered = [];

  for (const consideredLocale of considered) {
    // `LocaleMatchResult.java:117`, inside the loop and BEFORE the duplicate test at `:119` — so an
    // ill-formed member is reported as ill-formed even when it is also a duplicate.
    const normalized = requireJdkWellFormedLocale(
      normalizeTag(consideredLocale), LOCALE_INGRESS_DESCRIPTION.consideredLocale);

    // Java lowercases `toLanguageTag()` before the duplicate test (`:118`). `normalizeTag` already
    // produces the canonical serialization, so two spellings of one locale collide here exactly as
    // they do there — and the MESSAGE quotes the caller's tag as Java quotes `validatedLocale`.
    if (seen.has(normalized))
      throw new RangeError(`Considered locales must not contain duplicate language tag '${normalized}'`);

    seen.add(normalized);
    normalizedConsidered.push(normalized);
  }

  if (!seen.has(matchFallbackLocale))
    throw new RangeError("The fallback locale must be present in considered locales");

  if (selectedLocale !== null && !normalizedConsidered.includes(selectedLocale))
    throw new RangeError("The selected locale must be present in considered locales");

  // `isMatch` is derived in Java and declared derived by plan 3.4 ("`isMatch` is exactly
  // `locale !== null`"). A supplied value that CONTRADICTS its own selection is refused rather than
  // ignored: ignoring it would let a result claim no match while carrying one, and every consumer
  // of the diagnostic — `isFallback` included — reads one field or the other.
  if (match.isMatch !== undefined && match.isMatch !== (selectedLocale !== null))
    throw new RangeError(`${where} isMatch must be true exactly when a locale was selected`);

  return match;
}

/**
 * The per-call options object naming one precomputed negotiation result:
 * `strings.get(key, undefined, forLocaleMatch(negotiator.matchForLanguageRanges(ranges)))`.
 *
 * Plan section 3.3 declares it beside `forLocale` and it earns its place the same way: the
 * INSTANCE-INDEPENDENT half of the validation runs at the site that spelled the value, so a
 * fabricated or stale match is reported where it was written rather than at whichever unrelated
 * lookup later consumed it. The instance-dependent half — the fallback and considered-set
 * comparison — stays at consumption, so one options object remains reusable across instances.
 *
 * A caller writing `{ localeMatch: … }` by hand is equally valid and is validated inside
 * `getResult`, exactly as `{ locale: "fr-ca" }` is.
 *
 * @param {LocaleMatch} localeMatch
 * @returns {Readonly<{ localeMatch: LocaleMatch }>}
 */
export function forLocaleMatch(localeMatch) {
  return freeze({ localeMatch: validateLocaleMatchStructure(localeMatch, "forLocaleMatch(localeMatch)") });
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
    // `DefaultStrings.java:2650`, through `normalizedTiebreakerLanguageCode`. A record cannot carry a
    // null key and a `Map` can, which is precisely why plan 3.1 types this input as a `TiebreakerMap`
    // rather than a record — so the refusal is live, not defensive. It must be refused HERE, before
    // the snapshot: a record key is a string, so storing one would silently rename the entry to the
    // four-character code "null" and then diagnose THAT, which is what this port used to do.
    if (languageCode === null || languageCode === undefined)
      throw new TypeError("A tiebreaker language code must not be null");

    // `:335`. A null list is not the same mistake as a list of the wrong shape, and Java keeps the
    // two apart: null is a caller whose own lookup came back empty, where a string or a number is a
    // caller who misread the option. Only the null arm gets Java's sentence.
    if (locales === null || locales === undefined)
      throw new TypeError(
        `Null tiebreaker locale list encountered for language code '${languageCode}'`,
      );

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
 * Five rules, and the order between them is Java's — which is why they run in two passes:
 *
 *   - two supplied language codes that CANONICALIZE alike are two names for one entry (`:329`);
 *   - a repeated locale within one list is an unrecoverable intent, not a spelling (`:349`);
 *   - a supplied language code with no loaded locale at all is a mistake, not a no-op (`:388`);
 *   - a supplied list must be an exact permutation of that language code's loaded locales, so a
 *     later-added catalog cannot quietly inherit last place (`:394`) — which is also why an EMPTY
 *     list reports the permutation failure rather than the missing-tiebreaker one, MEASURED on the
 *     pinned JDK rather than reasoned about;
 *   - only then, a language code with more than one loaded locale and nothing supplied is refused
 *     (`:426`).
 *
 * The identity case is the reason the last rule is not simply "every language code needs one":
 * where exactly one locale carries a language code, Java synthesizes that one-element list as its
 * own tiebreaker. `resolveTiebreakers` in the locale kernel already derives the same entries when it
 * consults this map, so there is nothing for this function to carry forward — only a case it must
 * not reject.
 *
 * THE CORPUS NOW REACHES ALL FIVE, and it did not when the first three of them were written: the
 * `owed-init` family's eight `construct` rows are the Java-recorded refusals, and two of them were
 * red on their first run. The `:329` and `:349` rules above are the repair — before it, this
 * function had no key-collision check at all (so `{ ro: [...], mo: [...] }` reported the permutation
 * refusal Java never reaches) and built its comparison `Set` straight from the caller's array (so a
 * list naming one locale twice was silently deduplicated and ACCEPTED, where Java refuses).
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
  /** normalized code -> the caller's spelling that claimed it first, for the collision diagnostic. */
  const suppliedByNormalizedCode = new Map();
  /** normalized code -> that entry's tags, already normalized, in the caller's order. */
  const providedByLanguageCode = new Map();

  // TWO LOOPS, AND THE SPLIT IS JAVA'S, NOT STYLE. `DefaultStrings.<init>` validates every supplied
  // entry IN FULL (`:329` key collision, `:349` duplicate locale) before it looks at any of them
  // against the loaded catalogs (`:388` unknown code, `:394` permutation). A single fused loop
  // reports whichever rule the FIRST offending entry trips, so a map that both collides and
  // mis-permutes answers the permutation refusal where Java answers the collision — measured, and it
  // is exactly how `{ ro: ["ro"], mo: ["mo"] }` used to be diagnosed here.
  for (const [suppliedLanguageCode, locales] of Object.entries(tiebreakers ?? {})) {
    // The SAME key normalization `resolveTiebreakers` applies when it reads this map, so a code
    // that validates here is a code that matching will actually find. `mo` and `ro` are one entry
    // to both.
    const languageCode = primaryLanguage(suppliedLanguageCode) || suppliedLanguageCode.toLowerCase();

    // `DefaultStrings.java:329`. Two keys that CANONICALIZE alike are two names for one entry, and a
    // record cannot hold both: whichever `resolveTiebreakers` reached last would silently win, so
    // the ORDER a caller wrote their tiebreakers in would decide which catalog answers. Java names
    // both of the caller's own spellings and the code they collapsed to; so does this.
    const existingSuppliedLanguageCode = suppliedByNormalizedCode.get(languageCode);

    if (existingSuppliedLanguageCode !== undefined)
      throw new RangeError(
        `Tiebreaker language codes '${existingSuppliedLanguageCode}' and '${suppliedLanguageCode}' ` +
          `both normalize to '${languageCode}'`,
      );

    suppliedByNormalizedCode.set(languageCode, suppliedLanguageCode);

    // Normalized before comparison because Java compares `Locale` instances and not the caller's
    // spelling: `en-us` and `en-US` are one locale to `Locale.forLanguageTag`, and an instance Java
    // builds must not be refused here over a lowercase region. A tag `normalizeTag` cannot parse
    // raises its error; one it parses into a `Locale` that `Locale.Builder` will not take back is
    // refused just below, at the site and with the sentence Java refuses it with.
    /** @type {string[]} */
    const provided = [];

    for (const locale of locales) {
      // `DefaultStrings.java:343`, and it must precede normalization: `normalizeTag(null)` refuses
      // too, but with "A locale tag must be a non-empty string" — a sentence that names neither the
      // tiebreaker list nor its language code, so the caller cannot tell which of their options was
      // wrong. Skipping the null instead would silently shorten the resolution order for an ambiguous
      // language code, which is the failure this check exists to prevent.
      if (locale === null || locale === undefined)
        throw new TypeError(
          `Null tiebreaker locale encountered for language code '${suppliedLanguageCode}'`,
        );

      const validated = normalizeTag(locale);

      // THE THIRD CONSTRUCTION INGRESS CHECK — `LocaleUtils.requireWellFormed(locale, "Tiebreaker
      // locale")` (`DefaultStrings.java:347`). ORDER IS JAVA'S: after the null-entry refusal at
      // `:343` and BEFORE the duplicate refusal at `:349`.
      //
      // IT IS REACHABLE ON ITS OWN, which is why it is a third check and not a consequence of the
      // second: measured on the pinned JDK with WELL-FORMED catalogs `{fr, en, en-US}` and
      // `tiebreakerLocalesByLanguageCode = {en: [en__NY, en]}`, Java answers `Tiebreaker locale
      // 'en__NY' is not a well-formed IETF BCP 47 locale`. The port answered the unrelated
      // missing-tiebreaker refusal instead, because an ill-formed tiebreaker simply failed to match
      // any loaded catalog — a wrong-site refusal naming neither the offending locale nor the real
      // mistake. The loop head's comment used to say an ill-formed tag "raises `normalizeTag`'s own
      // error, where Java raises `requireWellFormed`'s"; that was true of a tag `normalizeTag`
      // REFUSES and silently false of one it accepts, which is this entire class.
      requireJdkWellFormedLocale(validated, LOCALE_INGRESS_DESCRIPTION.tiebreakerLocale);

      // `DefaultStrings.java:349`. A repeat is not a harmless spelling of the same preference: this
      // list IS the resolution order for an ambiguous language code, so a caller who wrote one
      // locale twice has an intent the library cannot recover. Deduplicating silently — which is
      // what building the `Set` below straight from `locales` did — accepts it and picks one.
      if (provided.includes(validated))
        throw new RangeError(
          `Duplicate tiebreaker locale '${validated}' encountered for language code ` +
            `'${suppliedLanguageCode}'`,
        );

      provided.push(validated);
    }

    providedByLanguageCode.set(languageCode, provided);
  }

  for (const [languageCode, provided] of providedByLanguageCode) {
    const loaded = loadedByLanguageCode.get(languageCode);

    if (loaded === undefined)
      throw new RangeError(`Tiebreaker language code '${languageCode}' has no localized strings locales`);

    configuredLanguageCodes.add(languageCode);

    const providedSet = new Set(provided);
    const missing = loaded.filter((tag) => !providedSet.has(tag)).sort();
    const unrelated = [...providedSet].filter((tag) => !loaded.includes(tag)).sort();

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

// `compareTags`, `normalizedLanguageCode` and the tiebreaker-map finalizer used to live here as
// private copies of three helpers the locale kernel already had. They are now imported from
// `../internal/locale.js`, which is the only honest arrangement: each is ONE function in Java
// (`Comparator.comparing(Locale::toLanguageTag)`, `DefaultStrings#normalizedLanguageCode:2669`, and
// `finalizedTiebreakerLocalesByLanguageCode:395-444`), read here at construction and there at every
// lookup. A divergence in any of the three resolves the fallback to a catalog that per-lookup
// resolution never consults, and the corpus cannot see it: every tiebreaker in it is spelled
// canonically, so the two spellings agree on every recorded input while disagreeing in general.

/**
 * Java's fallback-locale resolution, `DefaultStrings.java:446-470`, in Java's order: the configured
 * tag when a catalog is loaded under exactly that spelling; else the ONE canonically equivalent
 * loaded catalog; else the fallback's language code walked through the tiebreaker list, taking the
 * first entry that is itself equivalent to the fallback; else the instance is refused.
 *
 * Two details carry the rule, each with a corpus fixture behind it.
 *
 * The language code is Java's `normalizedLanguageCode(canonicalLanguageTag(tag).split("-")[0])`, not
 * `tag.split("-")[0]`: `dedup-and-candidates-equivalent-fallback-am-first` configures `arm-SU`
 * against a tiebreaker map keyed `hy`, so a raw first subtag looks up `arm`, finds nothing, and
 * falls through to whichever equivalent catalog happens to come first.
 *
 * And the walk SKIPS a tiebreaker not equivalent to the fallback rather than taking the head of the
 * list: `owed-ds-fallback-tiebreaker-walk` loads `sr-Cyrl`, `sh` and `hbs` and leads its `sr` list
 * with `sr-Cyrl`, which is not equivalent to the configured `sr-Latn`. Taking the first entry
 * unconditionally serves every fallback translation from the Cyrillic catalog.
 *
 * @param {string} configured the normalized tag the caller configured
 * @param {readonly string[]} supported the loaded catalogs' normalized tags
 * @param {readonly string[]} equivalentFallbackLocales loaded catalogs equivalent to `configured`,
 *   tag-sorted, non-empty by the refusal in `createStrings`
 * @param {Readonly<Record<string, readonly string[]>> | null} tiebreakers
 * @returns {string}
 */
function resolveFallbackLocale(configured, supported, equivalentFallbackLocales, tiebreakers) {
  if (supported.includes(configured)) return configured;
  if (equivalentFallbackLocales.length === 1) return /** @type {string} */ (equivalentFallbackLocales[0]);

  const languageCode = normalizedLanguageCode(javaSplit(canonicalLanguageTag(configured))[0] ?? "");
  const ordered = resolveTiebreakers(tiebreakers, supported).get(languageCode);

  if (ordered !== undefined)
    for (const tiebreaker of ordered)
      if (equivalentFallbackLocales.includes(tiebreaker)) return tiebreaker;

  // Java's message names `tiebreakerLocalesByLanguageCode`, its constructor parameter; only that
  // half is reworded to the option a JavaScript caller has, on the rule `validateTiebreakers`
  // follows. The diagnosis — which locales collided — is Java's.
  throw new RangeError(
    `Fallback locale '${configured}' is canonically equivalent to multiple loaded locales ` +
      `${javaList(equivalentFallbackLocales)}; configure createStrings({ tiebreakers }) to choose one`,
  );
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

  // `DefaultStrings.java:262`, "The 'localizedStringSupplier' returned null" — kept apart from the
  // absent-option refusal in `createStrings` for the reason recorded there.
  if (strings === null)
    throw new TypeError(
      "createStrings({ strings }) was null: supply a record or a Map of locale tag to catalog",
    );

  if (typeof strings !== "object" || Array.isArray(strings))
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
function compileDefinitionExpressions(definition, compiled, visited = new Set(), rootKey = "", locale = "") {
  /**
   * Java's construction-path wording, MEASURED on the pinned Corretto 21 rather than read.
   *
   * `LocalizedStringValidator` — not `DefaultStrings.compileExpressions` — is what fires for every
   * shape here, and it wraps twice: `invalid()` at `:326` adds
   * `Invalid localized string '<key>' for locale '<tag>': ` around a per-shape sentence, retaining
   * the `ExpressionEvaluationException` as the cause. The two sentences are `:159`'s
   * `Invalid alternative expression '<expr>'` and the generated-placeholder one. A nested
   * alternative reports the ROOT key, not a path — measured: depth 2 produces a message byte-identical
   * to depth 1.
   *
   * This is deliberately NOT the loader's wording. `lokalized/parse` reproduces
   * `LocalizedStringLoader`'s sentences because that is the door it is; construction has its own, and
   * Java's two differ. The port previously threw the evaluator's error BARE here — no key, no locale,
   * no cause — which broke `catalog.js`'s own stated contract that one authoring mistake produces one
   * diagnostic whichever door it came through.
   *
   * The TYPE stays `ExpressionEvaluationError` where Java raises `IllegalArgumentException`: the
   * class is the port's idiomatic analogue and consumers catch it, so this follows the established
   * rule of Java's SHAPE with the JS name — the message and the retained cause are Java's.
   *
   * @param {string} sentence the per-shape half, already formatted
   * @param {unknown} cause the evaluator's own error, retained by reference as Java retains it
   */
  const invalid = (sentence, cause) => {
    const error = new ExpressionEvaluationError(
      `Invalid localized string '${rootKey}' for locale '${locale}': ${sentence}`,
      { cause },
    );
    return error;
  };

  /**
   * @template T
   * @param {() => T} compileOne
   * @param {(reason: string) => string} sentenceFor
   * @returns {T}
   */
  const wrapping = (compileOne, sentenceFor) => {
    try {
      return compileOne();
    } catch (error) {
      if (!(error instanceof ExpressionEvaluationError)) throw error;
      throw invalid(sentenceFor(error.message), error);
    }
  };

  // Guarded by node IDENTITY, because a programmatically supplied catalog is an object graph rather
  // than a tree: plan 3.6 permits a shared alternative subtree, and `parseModelCatalog` preserves
  // the sharing instead of expanding it. Re-walking a diamond is exponential in its depth, so a
  // legal 40-deep shared graph would hang construction here without this. Parsed catalogs allocate
  // a fresh node per occurrence, so for them the guard never fires.
  if (visited.has(definition)) return;
  visited.add(definition);

  for (const [placeholderName, placeholder] of definition.placeholders) {
    if (placeholder.kind !== "expression") continue;

    let index = 0;

    for (const alternative of placeholder.alternatives) {
      const at = index++;

      if (!compiled.has(alternative))
        compiled.set(
          alternative,
          wrapping(
            () => compileExpression(alternative.expression),
            (reason) =>
              `Invalid expression alternative ${at} for generated placeholder '${placeholderName}', ` +
              `expression '${alternative.expression}': ${reason}`,
          ),
        );
    }
  }

  for (const alternative of definition.alternatives) {
    if (!compiled.has(alternative))
      compiled.set(
        alternative,
        wrapping(
          () => compileExpression(alternative.expression),
          (reason) => `Invalid alternative expression '${alternative.expression}': ${reason}`,
        ),
      );

    // The ROOT key and locale travel down unchanged: Java reports the root, not a path.
    compileDefinitionExpressions(alternative.definition, compiled, visited, rootKey, locale);
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
 * `DefaultStrings#throwExceptionFor` (DefaultStrings.java:3196-3213).
 *
 * TWO ARMS, and the corpus discriminates them by `thrown.causeType`. When a cause was retained it
 * is rethrown BY IDENTITY — no wrapper, no re-message, plan 3.5's "no additional wrapper is added
 * when the cause is stored" — which is why 25 corpus rows record a `thrown.type` that is the
 * cause's Java class rather than `MissingTranslationException` (22 `IllegalStateException`, 1
 * `IllegalArgumentException`, 2 `ExpressionEvaluationException`, the last a type nothing else on
 * this path can produce). Only a cause-less failure constructs, and 23 rows record that.
 *
 * The object rethrown is the CONTEXTUALIZED error, not the application's original: a phonetic
 * resolver that throws has its error wrapped once at the generated-placeholder boundary, and it is
 * that wrapper — message beginning `Unable to resolve generated placeholder`, `cause` the original —
 * which is retained, handed to the handler, and rethrown here unchanged.
 *
 * The MESSAGE is `DefaultStrings.java:741`'s, built from the RAW key — literally the string the
 * caller passed, `{{name}}` braces and all — and from the lookup locale's language tag. It is
 * neither interpolated nor bidi-isolated: `bidi-isolation.failure-response.get-throw-message-is-not-
 * isolated` runs under `ALWAYS` isolation and still records `No match for 'Farewell {{name}}' was
 * found for locale 'en'.` with no directional controls, because Java composes it at :741 and hands
 * it straight to the constructor without touching `BidiUtils` or the interpolator. A port that
 * isolated eagerly puts isolate controls inside an exception message, which is unreadable in logs.
 *
 * Java's two `instanceof` guards (`RuntimeException`, `Error`) have no JS counterpart and need
 * none: every JS value is throwable, so the checked-exception fallthrough they guard cannot arise.
 *
 * THE THIRD ATTEMPTED-LOCALE VALIDATION SITE, and this docblock USED TO DENY IT EXISTED. It said
 * `failureResult`'s sibling check was "deliberately not covered [here]: `throwExceptionFor` builds
 * no result, so it rethrows the retained cause by identity". The first half is true and the
 * conclusion does not follow — when there is NO cause to rethrow, `throwExceptionFor` constructs a
 * `MissingTranslationException`, and THAT constructor
 * (`MissingTranslationException.java:130-166`) runs the same `requireWellFormed` +
 * duplicate-language-tag loop as `TranslationResult`'s. MEASURED on the pinned Corretto 21 against
 * `lokalized-3.0.0.jar`, catalogs {fr, nb, nn}, fallback fr, a handler answering `THROW_EXCEPTION`,
 * and a key NO catalog holds:
 *
 *   `en-US-x-lvariant-POSIX` -> java IllegalArgumentException `Attempted locales must not contain
 *                                   duplicate language tag 'en-US-posix'`
 *                              js   MissingTranslationError   `No match for 'Absent' was found …`
 *
 * It was invisible to `npm run conformance` (no corpus row pairs a throwing handler with an
 * unanswerable key and an lvariant chain) and to every layer differential, and it needed all three
 * of `tools/lookup-diff/`'s axes at once — a throwing handler, an exhausting catalog set, and a key
 * present in no catalog. Reaching a branch is not discriminating it.
 *
 * ORDER IS LOAD-BEARING and copied from `:3200-3208`: the retained cause is rethrown FIRST, by
 * identity, and the validation runs only on the cause-less arm. A port that validated first would
 * replace the 25 corpus rows' rethrown-by-identity causes with a refusal.
 *
 * @param {TranslationFailure} translationFailure
 * @returns {never}
 */
function throwForFailure(translationFailure) {
  if (translationFailure.cause !== null) throw translationFailure.cause;

  const refusal = attemptedLocaleRefusal(translationFailure.attemptedLocales);
  if (refusal !== null) throw refusal;

  throw new MissingTranslationError(
    MISSING_TRANSLATION_TOKEN,
    `No match for '${translationFailure.key}' was found for locale ` +
      `'${translationFailure.lookupLocale}'.`,
    translationFailure,
  );
}
