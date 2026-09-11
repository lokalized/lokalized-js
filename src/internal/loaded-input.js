// @ts-check
/**
 * `createStrings({ loaded })` — plan sections 3.4 and 8.3's fabricated-`LoadedStrings` rejections.
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
 */
import { candidateChain, normalizeTag } from "./locale.js";
import { configurationError } from "./configuration-error.js";
import { decode as decodePinnedProvenance } from "../data/provenance.js";

/** @param {unknown} value */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Turn a `LoadedStrings` into the options the direct construction path already accepts.
 *
 * @param {Record<string, any>} options the caller's `createStrings` options, carrying `loaded`
 * @returns {Record<string, any>}
 */
export function optionsFromLoadedStrings(options) {
  const loaded = options.loaded;
  if (!isRecord(loaded)) throw configurationError("`loaded` must be a LoadedStrings object");

  // Plan 3.4 lists `loaded` and the direct inputs as alternatives, not a merge. Accepting both would
  // make the answer depend on which one construction happened to read first.
  for (const conflicting of ["strings", "fallbackLocale", "tiebreakers", "limits"])
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

  const covered = Object.keys(loaded.catalogs);
  const planned = Array.isArray(loaded.requestedFiles)
    ? loaded.requestedFiles.map((/** @type {any} */ entry) => entry?.locale)
    : null;
  if (planned === null) throw configurationError("`loaded.requestedFiles` must be an array");

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
  // Recomputed rather than believed, and recomputed WITHOUT the manifest, which a LoadedStrings does
  // not carry: the candidate walk needs only the covered set, the fallback and the tiebreakers, and
  // it is the same `candidateChain` the loader's own planner calls. Core cannot import
  // `lokalized/load` for it — that would pull a 690 KB delivery subpath into the ratcheted root
  // graph — so both callers share the internal function instead of one calling the other.
  const coverage = loaded.coverage;
  if (!isRecord(coverage)) throw configurationError("`loaded.coverage` must be a StringsLoadCoverage");

  // (1) covered set has an EXTRA tag: a catalog nothing planned to fetch.
  for (const tag of covered)
    if (!planned.includes(tag))
      throw configurationError(
        `The loaded catalog set contains '${tag}', which the recorded fetch plan never requested`,
      );

  // (2) a `complete: true` plan MISSING a covered tag: the load claims it fetched everything it
  // planned, and a planned file has no catalog.
  if (loaded.complete === true)
    for (const tag of planned)
      if (!covered.includes(tag))
        throw configurationError(
          `The fetch plan requested '${tag}' and the result claims complete: true, but no catalog for ` +
          `it arrived`,
        );

  // (3) the plan's ORDER differs from what planning would produce. Only checkable for lookup
  // coverage, where the sequence is a function of the recorded lookup tag; `entire-manifest` is a set
  // whose order is the manifest's own iteration order and is not recomputable from here. Said out
  // loud rather than silently skipped, so nobody reads a green whole-manifest load as an order check.
  if (coverage.kind === "lookup") {
    const recomputed = candidateChain(
      normalizeTag(coverage.lookupLocale),
      covered,
      normalizeTag(loaded.fallbackLocale),
      loaded.tiebreakers ?? {},
    ).filter((/** @type {string} */ tag) => covered.includes(tag));
    const recorded = planned.filter((/** @type {string} */ tag) => covered.includes(tag));
    if (recomputed.join(",") !== recorded.join(","))
      throw configurationError(
        `The recorded fetch plan [${recorded.join(", ")}] is not the plan this core computes for ` +
        `lookup '${coverage.lookupLocale}' over the loaded catalogs, which is ` +
        `[${recomputed.join(", ")}]`,
      );
  }

  const { loaded: _consumed, ...rest } = options;
  return {
    ...rest,
    fallbackLocale: loaded.fallbackLocale,
    strings: loaded.catalogs,
    ...(loaded.tiebreakers === undefined ? {} : { tiebreakers: loaded.tiebreakers }),
    // The loader's OWN normalized record, reused verbatim. Plan 3.4: the branch "neither falls back to
    // defaults nor permits a second override", so a catalog loaded under relaxed limits revalidates
    // under those same limits rather than being spuriously rejected by the defaults.
    limits: loaded.loadingLimits,
  };
}
