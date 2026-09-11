// @ts-check
/**
 * `createStrings({ loaded })` — plan sections 3.4 and 8.3's fabricated-`LoadedStrings` rejections,
 * and plan 6.4's `StringsLoadVerification` record.
 *
 * WHY THIS NORMALIZES RATHER THAN BRANCHES. `createStrings` already accepts a `ParsedStringsFile` as
 * a catalog value, so a `LoadedStrings` can be turned into the inputs the direct branch already takes
 * and handed to the SAME construction path. The alternative — a second branch through construction —
 * would be a second place for locale validation, duplicate rejection, model validation and expression
 * compilation to drift, in a milestone that is closed and heavily tested. Everything below runs
 * BEFORE that path and changes nothing inside it.
 *
 * **A LOADER RESULT IS NOT TRUSTED BECAUSE IT IS WELL SHAPED.** Plan 3.4 is explicit that the loaded
 * branch exists so "a valid relaxed loader result is not spuriously rejected AND a fabricated result
 * cannot bypass the same limits" — both halves, and the second is the reason this file is longer than
 * a spread. A `LoadedStrings` is an ordinary object a caller can build by hand, so every field that
 * would otherwise be believed is recomputed here.
 *
 * AND THE RECORD IS AN OUTPUT OF THAT RECOMPUTATION, not a copy of the input. Plan 3.4:711 calls
 * `getLoadVerification()` "the duplication-safe SSR provenance channel", which only means anything if
 * what travels through it was PROVED here rather than transcribed: `plannedLocales` is this core's
 * own plan, `coveredLocales` is the catalog set construction actually received, and the CLDR/IANA
 * identity is this core's pinned data, never the loader's claim about it.
 */
import { candidateChain, compareTags, normalizeTag } from "./locale.js";
import { configurationError } from "./configuration-error.js";
import { RUNTIME_METADATA } from "./runtime-metadata.js";
import { decode as decodePinnedProvenance } from "../data/provenance.js";

/** @param {unknown} value */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {readonly string[]} tags */
const normalizedSorted = (tags) => [...tags].map(normalizeTag).sort(compareTags);

/**
 * Turn a `LoadedStrings` into the options the direct construction path already accepts, and build the
 * verification record the instance will report.
 *
 * @param {Record<string, any>} options the caller's `createStrings` options, carrying `loaded`
 * @returns {{ options: Record<string, any>, verification: Record<string, any> }}
 */
export function optionsFromLoadedStrings(options) {
  const loaded = options.loaded;
  if (!isRecord(loaded)) throw configurationError("`loaded` must be a LoadedStrings object");

  // Plan 3.4 lists `loaded` and the direct inputs as alternatives, not a merge. Accepting both would
  // make the answer depend on which one construction happened to read first.
  for (const conflicting of ["strings", "fallbackLocale", "tiebreakers", "limits", "catalogIdentity"])
    if (options[conflicting] !== undefined)
      throw configurationError(
        `createStrings({ loaded }) already carries ${conflicting}; supplying it alongside would make ` +
        `the instance depend on which source construction read first`,
      );

  // EXACT equality against the rendering core's own pinned data, before any catalog is accepted.
  // Plan 3.4: "a loader copy built from different pinned data fails with ConfigurationError EVEN WHEN
  // its immediate file plan happens to match" — plural rules and locale identity come from that data,
  // so a matching plan is not evidence of compatibility.
  const pinned = decodePinnedProvenance();
  if (loaded.cldrVersion !== pinned.cldrVersion || loaded.dataFingerprint !== pinned.dataFingerprint)
    throw configurationError(
      `This LoadedStrings was produced against CLDR ${String(loaded.cldrVersion)} / ` +
      `${String(loaded.dataFingerprint).slice(0, 12)}…, and this core carries CLDR ` +
      `${pinned.cldrVersion} / ${pinned.dataFingerprint.slice(0, 12)}…`,
    );

  if (!isRecord(loaded.catalogs)) throw configurationError("`loaded.catalogs` must be an object");
  if (!isRecord(loaded.loadingLimits))
    throw configurationError("`loaded.loadingLimits` must be the loader's frozen normalized limits");
  if (!isRecord(loaded.catalogIdentity)
    || typeof loaded.catalogIdentity.catalogVersion !== "string"
    || typeof loaded.catalogIdentity.catalogFingerprint !== "string")
    throw configurationError(
      "`loaded.catalogIdentity` must carry a string catalogVersion and catalogFingerprint");

  // The FULL manifest configuration, which plan 3.4:727 requires the plan to be recomputed against —
  // not the loaded subset. The distinction is the whole point for a PARTIAL load: a candidate walk
  // over only the catalogs that arrived can resolve a tag to a different file than the walk that
  // produced the plan, so recomputing from the survivors would compare against a plan this core never
  // would have made.
  const manifestConfiguration = loaded.manifestLocaleConfiguration;
  if (!isRecord(manifestConfiguration)
    || typeof manifestConfiguration.fallbackLocale !== "string"
    || !Array.isArray(manifestConfiguration.supportedLocales))
    throw configurationError(
      "`loaded.manifestLocaleConfiguration` must be the manifest's LocaleConfiguration; without it " +
      "the recorded fetch plan cannot be recomputed, only believed",
    );
  if (normalizeTag(manifestConfiguration.fallbackLocale) !== normalizeTag(loaded.fallbackLocale))
    throw configurationError(
      `The result resolves fallback '${String(loaded.fallbackLocale)}' while its manifest ` +
      `configuration resolves '${String(manifestConfiguration.fallbackLocale)}'`,
    );

  const covered = normalizedSorted(Object.keys(loaded.catalogs));
  const planned = Array.isArray(loaded.requestedFiles)
    ? loaded.requestedFiles.map((/** @type {any} */ entry) => entry?.locale)
    : null;
  if (planned === null) throw configurationError("`loaded.requestedFiles` must be an array");
  if (!Array.isArray(loaded.failures)) throw configurationError("`loaded.failures` must be an array");

  // A map key and its file's own `locale` must be the same normalized tag; otherwise a catalog can be
  // served under a name it does not claim, and every later comparison is against the wrong one.
  for (const [tag, parsed] of Object.entries(loaded.catalogs)) {
    const declared = isRecord(parsed) ? parsed.locale : undefined;
    if (typeof declared !== "string" || normalizeTag(declared) !== normalizeTag(tag))
      throw configurationError(
        `The catalog filed under '${tag}' declares locale ${JSON.stringify(declared)}; a map key and a ` +
        `ParsedStringsFile.locale must be the same normalized loaded tag`,
      );
  }

  // ---- plan :2578's three fabricated-LoadedStrings rejections ---------------------------------
  //
  // Recomputed rather than believed, and recomputed WITHOUT the manifest itself, which a
  // `LoadedStrings` does not carry: the walk needs only the manifest's locale configuration, and it
  // is the same `candidateChain` the loader's own planner calls. Core cannot import `lokalized/load`
  // for it — that would pull a 690 KB delivery subpath into the ratcheted root graph — so both
  // callers share the internal function instead of one calling the other.
  const coverage = loaded.coverage;
  if (!isRecord(coverage)) throw configurationError("`loaded.coverage` must be a StringsLoadCoverage");

  const manifestTags = normalizedSorted(manifestConfiguration.supportedLocales);

  // (1) covered set has an EXTRA tag: a catalog nothing planned to fetch.
  for (const tag of covered)
    if (!planned.includes(tag))
      throw configurationError(
        `The loaded catalog set contains '${tag}', which the recorded fetch plan never requested`,
      );

  // (2) a `complete: true` plan MISSING a covered tag, or completeness claimed over recorded
  // failures. Plan 3.4:730: "every planned tag must be covered and no load failure may remain;
  // disagreement is a ConfigurationError, not a silent downgrade."
  if (loaded.complete === true) {
    for (const tag of planned)
      if (!covered.includes(tag))
        throw configurationError(
          `The fetch plan requested '${tag}' and the result claims complete: true, but no catalog for ` +
          `it arrived`,
        );
    if (loaded.failures.length > 0)
      throw configurationError(
        `The result claims complete: true while recording ${loaded.failures.length} load failure(s)`,
      );
  }

  // (3) the plan's ORDER. Recomputed for BOTH coverage kinds, because the manifest configuration
  // makes both recomputable: plan 3.4:727 — "first-use resolved file-tag order for lookup coverage,
  // or normalized-tag order for entire-manifest coverage", requiring "exact equality with
  // `loaded.requestedFiles.map(entry => entry.locale)`".
  const recomputed = coverage.kind === "lookup"
    ? candidateChain(
        normalizeTag(coverage.lookupLocale),
        manifestTags,
        normalizeTag(manifestConfiguration.fallbackLocale),
        manifestConfiguration.tiebreakers ?? {},
      ).filter((/** @type {string} */ tag) => manifestTags.includes(tag))
    : coverage.kind === "entire-manifest"
      ? manifestTags
      : null;
  if (recomputed === null)
    throw configurationError(
      `\`loaded.coverage.kind\` must be 'lookup' or 'entire-manifest', not ${JSON.stringify(coverage.kind)}`);
  if (recomputed.join(",") !== planned.join(","))
    throw configurationError(
      `The recorded fetch plan [${planned.join(", ")}] is not the plan this core computes for ` +
      `${coverage.kind === "lookup" ? `lookup '${coverage.lookupLocale}'` : "the whole manifest"}, ` +
      `which is [${recomputed.join(", ")}]`,
    );

  const { loaded: _consumed, ...rest } = options;
  return {
    options: {
      ...rest,
      fallbackLocale: loaded.fallbackLocale,
      strings: loaded.catalogs,
      ...(loaded.tiebreakers === undefined ? {} : { tiebreakers: loaded.tiebreakers }),
      // The loader's OWN normalized record, reused verbatim. Plan 3.4: the branch "neither falls back
      // to defaults nor permits a second override", so a catalog loaded under relaxed limits
      // revalidates under those same limits rather than being spuriously rejected by the defaults.
      limits: loaded.loadingLimits,
    },
    verification: verificationRecord(loaded, coverage, planned, covered, manifestConfiguration),
  };
}

/**
 * Plan 3.4:711-735's record, built from what was just proved.
 *
 * **WHERE EACH FIELD COMES FROM IS THE CONTRACT, not an implementation detail.** Plan 3.4:733: "After
 * the exact loaded/core data check above, the record takes `cldrVersion` and `dataFingerprint` from
 * the RENDERER, not by blindly copying the loader fields", and ":731" says the same of the two IANA
 * fields. They are equal to the loader's today only because the equality check above just refused
 * everything else — taking them from `loaded` would be indistinguishable now and wrong the moment
 * that check is relaxed or moved.
 */
function verificationRecord(
  /** @type {Record<string, any>} */ loaded,
  /** @type {Record<string, any>} */ coverage,
  /** @type {readonly string[]} */ planned,
  /** @type {readonly string[]} */ covered,
  /** @type {Record<string, any>} */ manifestConfiguration,
) {
  const pinned = decodePinnedProvenance();
  return Object.freeze({
    source: /** @type {const} */ ("verified-manifest-v1"),
    producerImplementation: RUNTIME_METADATA.producerImplementation,
    producerVersion: RUNTIME_METADATA.producerVersion,
    manifestLocaleConfiguration: Object.freeze({
      fallbackLocale: normalizeTag(manifestConfiguration.fallbackLocale),
      supportedLocales: Object.freeze(normalizedSorted(manifestConfiguration.supportedLocales)),
      tiebreakers: Object.freeze({ ...(manifestConfiguration.tiebreakers ?? {}) }),
    }),
    // Defensively copied, so a later mutation of the caller's object cannot rewrite what the
    // instance reports about itself.
    catalogIdentity: Object.freeze({
      catalogVersion: loaded.catalogIdentity.catalogVersion,
      catalogFingerprint: loaded.catalogIdentity.catalogFingerprint,
    }),
    cldrVersion: pinned.cldrVersion,
    dataFingerprint: pinned.dataFingerprint,
    ianaRegistryDate: RUNTIME_METADATA.ianaRegistryDate,
    ianaDataFingerprint: RUNTIME_METADATA.ianaDataFingerprint,
    behavioralVectorsVersion: RUNTIME_METADATA.behavioralVectorsVersion,
    localeDataMode: RUNTIME_METADATA.localeDataMode,
    cardinalityMode: RUNTIME_METADATA.cardinalityMode,
    coverage: coverage.kind === "lookup"
      ? Object.freeze({ kind: /** @type {const} */ ("lookup"), lookupLocale: normalizeTag(coverage.lookupLocale) })
      : Object.freeze({ kind: /** @type {const} */ ("entire-manifest") }),
    plannedLocales: Object.freeze([...planned]),
    coveredLocales: Object.freeze([...covered]),
    complete: loaded.complete === true,
  });
}
