// @ts-check
/**
 * lokalized/ssr — the SSR stamp, plan section 6.4.
 *
 * **THIS MODULE DELIBERATELY OWNS NO CONSTANTS, NO DATA AND NO KERNEL, and that absence is the
 * design.** Plan 6.4: every producer/data/mode field in a created stamp comes "from that verified
 * record, never from the SSR module's own constants", and "the SSR module never reimplements direct
 * matching or substitutes its own core/data copy". The reason is concrete rather than stylistic — a
 * page can easily end up with the renderer from one installed copy of the package and this helper
 * from another, and a stamp that described the HELPER would then certify a build that rendered
 * nothing. So everything below is computed from exactly two inputs: the record
 * `strings.getLoadVerification()` returns, and the answers `strings` itself gives to questions about
 * locales.
 *
 * That is enforced structurally, not by intent: this file imports one thing, and
 * `test/ssr-graph.test.js` walks the module graph and fails if `lokalized/ssr` ever acquires a route
 * to the locale kernel, the pinned data or the fetch planner. A prohibition that is invisible to a
 * result assertion needs a gate shaped like the prohibition.
 *
 * **WHAT A STAMP PROVES, stated narrowly because the temptation is to read it as more.** Plan 6.4:
 * it "proves library/data/catalog/mode and locale-selection compatibility only. It does not hash
 * placeholders, per-call bidi/fallback/failure options, or injected phonetic/failure/fallback
 * callbacks." Hydration equality therefore still requires the application to supply the same inputs
 * on both sides, and for a supplied match that includes the complete `LocaleMatchResult` — not
 * merely the narrow projection this stamp carries.
 */
import { configurationError } from "../internal/configuration-error.js";

/**
 * The narrow serialized match projection.
 *
 * Plan 6.4: it "intentionally contains only selected locale and match type. It never leaks requested
 * ranges, q-values, fallback configuration, or the supported/considered locale inventory." A full
 * `LocaleMatchResult` carries all four — `requestedLanguageRanges`, `effectiveWeight`,
 * `fallbackLocale`, `consideredLocales` — so the narrowing is a privacy boundary rather than a
 * convenience, and `test/ssr-stamp.test.js` checks it by diffing the WHOLE serialized object against
 * an expected key set rather than by spot-checking fields.
 *
 * @typedef {Readonly<{ locale: string | null, matchType: string }>} SsrLocaleMatchV1
 */

/**
 * Plan 6.4's `LokalizedSsrStampV1`, transcribed field for field.
 *
 * @typedef {Readonly<{ formatVersion: 1, producerImplementation: "lokalized-js",
 *   producerVersion: string, catalogVersion: string, catalogFingerprint: string, cldrVersion: string,
 *   dataFingerprint: string, ianaRegistryDate: string, ianaDataFingerprint: string,
 *   behavioralVectorsVersion: string, localeDataMode: "pinned" | "host-intl",
 *   cardinalityMode: "exact" | "host-intl", lookupLocale: string,
 *   localeMatch: SsrLocaleMatchV1 }>} LokalizedSsrStampV1
 */

/**
 * The rendering context a stamp describes.
 *
 * @typedef {Readonly<{ kind: "locale", locale: string }>
 *   | Readonly<{ kind: "locale-match", localeMatch: any }>} SsrLocaleContext
 */

/** The eight match types plan 3.2 declares. `none` is the one the null-locale rule keys on. */
const MATCH_TYPES = new Set([
  "none", "exact", "canonical", "cldr-fallback", "likely-subtag", "extended-range",
  "primary-language", "wildcard",
]);

/** @param {unknown} value */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {readonly string[]} a @param {readonly string[]} b */
const sameSequence = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The verified record, re-checked against the instance that reports it.
 *
 * **A WELL-SHAPED RECORD IS NOT A VERIFIED ONE.** `getLoadVerification()` returns a plain structural
 * object — plan 3.4:713 requires exactly that, so a `Strings` from one installed copy stays usable
 * here — which means nothing about it is trustworthy on the strength of its shape. Every claim it
 * makes is therefore asked of the instance a second time, through the instance's own inspection
 * methods, and a disagreement is a refusal rather than a downgrade.
 *
 * @param {any} strings
 * @returns {any}
 */
function verifiedRecordFor(strings) {
  if (!isRecord(strings) || typeof strings.getLoadVerification !== "function")
    throw configurationError("createSsrStamp requires a Strings instance");

  const record = strings.getLoadVerification();
  if (record === null || record === undefined)
    throw configurationError(
      "This Strings instance was constructed directly, so there is no verified manifest load to " +
      "stamp. Plan 6.4 makes direct construction ineligible even when the caller supplied a " +
      "shape-valid catalog identity, because core validates an identity's SHAPE and not its truth",
    );
  if (!isRecord(record) || record.source !== "verified-manifest-v1")
    throw configurationError(
      `A load verification must record source 'verified-manifest-v1', not ${JSON.stringify(
        isRecord(record) ? record.source : record)}`);
  if (record.producerImplementation !== "lokalized-js")
    throw configurationError(
      `Strict v1 stamping requires producerImplementation 'lokalized-js', not ` +
      `${JSON.stringify(record.producerImplementation)}; a cross-implementation hydration contract ` +
      `needs a new format version with an explicit certified-compatibility rule`);

  // `complete: false` is a legitimate partial load and an illegitimate thing to stamp: hydration
  // would promise a client catalogs the server never proved it had.
  if (record.complete !== true)
    throw configurationError(
      "This load is incomplete (complete: false), so it cannot be stamped for hydration");

  const identity = strings.getCatalogIdentity();
  if (!isRecord(identity)
    || identity.catalogVersion !== record.catalogIdentity?.catalogVersion
    || identity.catalogFingerprint !== record.catalogIdentity?.catalogFingerprint)
    throw configurationError(
      "The verification record's catalog identity is not the identity this instance reports");
  if (strings.isCatalogComplete() !== record.complete)
    throw configurationError(
      "The verification record's completeness is not the completeness this instance reports");

  const configuration = strings.getLocaleConfiguration();
  if (!isRecord(configuration)
    || configuration.fallbackLocale !== record.manifestLocaleConfiguration?.fallbackLocale)
    throw configurationError(
      "The verification record's manifest locale configuration resolves a different fallback than " +
      "this instance did");

  const supported = strings.getSupportedLocales();
  if (!sameSequence(record.coveredLocales ?? [], supported))
    throw configurationError(
      `The verification record covers [${(record.coveredLocales ?? []).join(", ")}] while the ` +
      `instance supports [${supported.join(", ")}]`);
  // Plan 6.4 requires every renderer-owned planned tag to occur in the covered set. With
  // `complete: true` already required above this is implied by the loaded branch's own check — and
  // it is asserted anyway, because that check lives in another module and a record reaching here is
  // not required to have come from it.
  for (const tag of record.plannedLocales ?? [])
    if (!supported.includes(tag))
      throw configurationError(
        `The verification record plans '${tag}', which the instance does not support`);
  // "It then verifies that the loaded catalog set and resolved fallback recorded by the renderer are
  // present" — the resolved fallback is the one locale every unmatched render lands on, so an
  // instance that cannot serve it cannot honour the stamp it would produce.
  if (!supported.includes(configuration.fallbackLocale))
    throw configurationError(
      `The instance's resolved fallback '${configuration.fallbackLocale}' is not among its loaded ` +
      `catalogs`);

  return record;
}

/**
 * Normalize a tag THROUGH THE RENDERER, never here.
 *
 * `getDirectLocaleContext` exists in part for this (plan 3.3): it validates and normalizes with the
 * rendering instance's own kernel and returns the result as `lookupLocale`, side-effect-free and
 * invoking no callback. It is how this module reaches a normalized tag without importing a kernel
 * whose data could differ from the one that rendered the page.
 *
 * @param {any} strings @param {string} tag
 */
const normalizedThroughRenderer = (strings, tag) => strings.getDirectLocaleContext(tag).lookupLocale;

/** @param {any} match */
function narrow(match) {
  if (!isRecord(match)) throw configurationError("A locale match must be an object");
  const locale = match.locale ?? null;
  const matchType = match.matchType;
  if (locale !== null && typeof locale !== "string")
    throw configurationError("A locale match's `locale` must be a tag or null");
  if (typeof matchType !== "string" || !MATCH_TYPES.has(matchType))
    throw configurationError(`Unknown locale match type ${JSON.stringify(matchType)}`);
  return { locale: /** @type {string | null} */ (locale), matchType };
}

/**
 * The rendering context, resolved to the pair a stamp serializes.
 *
 * @param {any} strings @param {any} context
 * @returns {{ lookupLocale: string, localeMatch: { locale: string | null, matchType: string } }}
 */
function projectionFor(strings, context) {
  if (!isRecord(context)) throw configurationError("A rendering context is required");

  if (context.kind === "locale") {
    if (typeof context.locale !== "string")
      throw configurationError("A { kind: 'locale' } context must carry a tag");
    // Plan 6.4: "A direct context preserves its normalized requested locale and is resolved ONLY by
    // calling `strings.getDirectLocaleContext(locale)`." The selected locale may differ from the
    // lookup locale, and that difference is exactly what the stamp has to carry.
    const resolved = strings.getDirectLocaleContext(context.locale);
    return { lookupLocale: resolved.lookupLocale, localeMatch: narrow(resolved.localeMatch) };
  }

  if (context.kind === "locale-match") {
    const match = narrow(context.localeMatch);
    // Plan 6.4: "A match context derives lookup from the selected locale or the instance fallback
    // when unmatched" — the same derivation core itself performs for a per-call `localeMatch`
    // (`src/core/index.js`, `normalizeTag(match.locale ?? match.fallbackLocale)`), reached here
    // through the renderer so the normalization is the renderer's.
    const fallback = strings.getLocaleConfiguration().fallbackLocale;
    return {
      lookupLocale: normalizedThroughRenderer(strings, match.locale ?? fallback),
      localeMatch: match,
    };
  }

  if (context.kind !== undefined)
    throw configurationError(`Unknown rendering context kind ${JSON.stringify(context.kind)}`);

  // A `TranslationResult`. Plan 6.4 accepts one "only when its lookup/match pair satisfies one of
  // those two origins", so both are recomputed and at least one must hold. An exact result satisfies
  // BOTH without ambiguity, because both imply the same serialized context.
  if (typeof context.lookupLocale !== "string" || context.localeMatch === undefined)
    throw configurationError(
      "A rendering context must be { kind: 'locale' }, { kind: 'locale-match' } or a TranslationResult");

  const match = narrow(context.localeMatch);
  const lookupLocale = normalizedThroughRenderer(strings, context.lookupLocale);

  const automatic = narrow(strings.getDirectLocaleContext(lookupLocale).localeMatch);
  const fromDirect = automatic.locale === match.locale && automatic.matchType === match.matchType;

  const fallback = strings.getLocaleConfiguration().fallbackLocale;
  const fromSupplied = lookupLocale === normalizedThroughRenderer(strings, match.locale ?? fallback);

  if (!fromDirect && !fromSupplied)
    throw configurationError(
      `This TranslationResult's lookup locale '${lookupLocale}' is neither the automatic direct ` +
      `result for itself (which selects ${JSON.stringify(automatic.locale)} as ` +
      `'${automatic.matchType}') nor the lookup a supplied match selecting ` +
      `${JSON.stringify(match.locale)} would derive`);

  return { lookupLocale, localeMatch: match };
}

/**
 * The invariants plan 6.4 states for both construction and validation.
 *
 * @param {any} strings
 * @param {{ lookupLocale: string, localeMatch: { locale: string | null, matchType: string } }} projection
 */
function requireMatchInvariants(strings, projection) {
  const { locale, matchType } = projection.localeMatch;
  // "enforce `localeMatch.locale === null` exactly when `matchType === 'none'`" — both directions.
  if ((locale === null) !== (matchType === "none"))
    throw configurationError(
      `A locale match selects null exactly when its type is 'none'; this one selects ` +
      `${JSON.stringify(locale)} as '${matchType}'`);
  if (locale !== null && !strings.getSupportedLocales().includes(locale))
    throw configurationError(
      `A selected locale must occur in the instance's applicable configuration; '${locale}' does not`);
}

/**
 * Does this load's coverage cover this rendering context?
 *
 * Plan 6.4: "`entire-manifest` covers any valid rendering context; `{kind: "lookup"}` covers ONLY the
 * same normalized original `lookupLocale`." The lookup arm is the rule the whole-server/subset-client
 * case rests on: a client that loaded only its DIAGNOSTIC selection (`fr-FR`) has not covered a
 * direct `fr-BE` context, even though every catalog the render touches is present, because the next
 * `fr-BE` render on the client would plan differently than the server did.
 *
 * @param {any} coverage @param {string} lookupLocale
 */
function requireCoverage(coverage, lookupLocale) {
  if (coverage?.kind === "entire-manifest") return;
  if (coverage?.kind === "lookup") {
    if (coverage.lookupLocale !== lookupLocale)
      throw configurationError(
        `This load covers lookup '${coverage.lookupLocale}' only, and the rendering context is ` +
        `'${lookupLocale}'`);
    return;
  }
  throw configurationError(`Unknown load coverage ${JSON.stringify(coverage?.kind)}`);
}

/**
 * Stamp a rendered page's locale selection, plan 6.4.
 *
 * @param {any} strings the `Strings` that rendered the page
 * @param {SsrLocaleContext | any} context the rendering context, or a `TranslationResult` from it
 * @returns {LokalizedSsrStampV1}
 */
export function createSsrStamp(strings, context) {
  const record = verifiedRecordFor(strings);
  const projection = projectionFor(strings, context);
  requireMatchInvariants(strings, projection);
  requireCoverage(record.coverage, projection.lookupLocale);

  return Object.freeze({
    formatVersion: /** @type {const} */ (1),
    producerImplementation: record.producerImplementation,
    producerVersion: record.producerVersion,
    catalogVersion: record.catalogIdentity.catalogVersion,
    catalogFingerprint: record.catalogIdentity.catalogFingerprint,
    cldrVersion: record.cldrVersion,
    dataFingerprint: record.dataFingerprint,
    ianaRegistryDate: record.ianaRegistryDate,
    ianaDataFingerprint: record.ianaDataFingerprint,
    behavioralVectorsVersion: record.behavioralVectorsVersion,
    localeDataMode: record.localeDataMode,
    cardinalityMode: record.cardinalityMode,
    lookupLocale: projection.lookupLocale,
    localeMatch: Object.freeze({
      locale: projection.localeMatch.locale,
      matchType: projection.localeMatch.matchType,
    }),
  });
}

/**
 * Validate a server's stamp against the client instance about to hydrate, plan 6.4.
 *
 * **THE LOCAL INSTANCE IS VERIFIED FIRST, and the order is the contract rather than an
 * implementation detail.** Plan 6.4: validation "performs the same local-instance verification
 * BEFORE comparing the serialized fields, so a caller cannot validate against incomplete or
 * direct-construction state merely by presenting a well-shaped stamp." Building the local stamp is
 * how that is guaranteed structurally: there is no route to the comparison that skips it.
 *
 * **THE COMPARISON IS EXHAUSTIVE OVER THE STAMP, not a maintained field list.** Plan 6.4 names
 * fifteen fields; a hand-copied list of fifteen is precisely the kind of text this project has
 * repeatedly found asserting the inverse of what it described, and it would silently stop covering a
 * sixteenth. So every own field of the locally built stamp is compared, `localeMatch` by its two
 * members, and `test/ssr-stamp.test.js` asserts that the set of compared paths IS the plan's fifteen.
 *
 * @param {LokalizedSsrStampV1} stamp the stamp the server serialized into the page
 * @param {any} strings the client `Strings` about to hydrate
 * @param {SsrLocaleContext} expectedContext the context the client is rendering
 * @returns {void}
 */
export function validateSsrStamp(stamp, strings, expectedContext) {
  const local = createSsrStamp(strings, expectedContext);

  if (!isRecord(stamp)) throw configurationError("A stamp is required");

  // Plan 6.4: "Strict hydration accepts only `localeDataMode: 'pinned'` with
  // `cardinalityMode: 'exact'`; a host-`Intl` stamp forces a client render." Checked on the PRESENTED
  // stamp, because that is the side that can carry host-`Intl` while the local instance does not —
  // and checked as its own rule rather than left to the field comparison, which would only catch it
  // when the two sides happen to disagree.
  if (stamp.localeDataMode !== "pinned" || stamp.cardinalityMode !== "exact")
    throw configurationError(
      `Strict hydration accepts only pinned locale data with exact cardinality; this stamp reports ` +
      `${JSON.stringify(stamp.localeDataMode)}/${JSON.stringify(stamp.cardinalityMode)}. Render on ` +
      `the client, or navigate, rather than hydrating mismatched translated content`);

  for (const field of Object.keys(local)) {
    if (field === "localeMatch") continue;
    if (/** @type {any} */ (stamp)[field] !== /** @type {any} */ (local)[field])
      throw configurationError(
        `Stamp field '${field}' is ${JSON.stringify(/** @type {any} */ (stamp)[field])} and this ` +
        `instance reports ${JSON.stringify(/** @type {any} */ (local)[field])}`);
  }
  const presentedMatch = /** @type {any} */ (stamp).localeMatch;
  if (!isRecord(presentedMatch))
    throw configurationError("Stamp field 'localeMatch' is missing");
  for (const field of /** @type {const} */ (["locale", "matchType"]))
    if (presentedMatch[field] !== local.localeMatch[field])
      throw configurationError(
        `Stamp field 'localeMatch.${field}' is ${JSON.stringify(presentedMatch[field])} and this ` +
        `instance reports ${JSON.stringify(local.localeMatch[field])}`);

  // An UNKNOWN field cannot come from a compatible producer: strict v1 already required exact
  // `producerVersion` equality above, so anything this build did not emit was added after the fact.
  const expected = new Set(Object.keys(local));
  for (const field of Object.keys(stamp))
    if (!expected.has(field))
      throw configurationError(`This stamp carries an unknown field '${field}'`);
}
