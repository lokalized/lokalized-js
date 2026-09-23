// @ts-check
/**
 * Manifest parsing, validation and locale configuration — plan section 6.1.
 *
 * THE TWO DOORS ARE DIFFERENT ON PURPOSE, and the plan says so in one sentence:
 * `parseStringsManifest` "uses the duplicate-aware bounded JSON path from 4.2 and applies the loading
 * limits", while `validateStringsManifest` "defensively copies and semantically validates a
 * caller-supplied object but CANNOT RECOVER SOURCE DUPLICATES OR SOURCE LOCATIONS". That is a
 * declared capability DIFFERENCE, not an oversight: a JavaScript object literal has already lost the
 * duplicate — `{a: 1, a: 2}` is `{a: 2}` before any library sees it — so the object door cannot
 * diagnose what the byte door can. It is recorded here because the tempting "fix" is to make the two
 * doors agree, which would mean either inventing a duplicate the object never had or dropping a check
 * the bytes genuinely support. This project has one live scar from exactly that shape: `parseCatalog`
 * once charged the JSON-nesting budget to an already-decoded object, where Java charges it only
 * inside its parser.
 *
 * EVERY DOOR RECOMPUTES THE FINGERPRINT, BEFORE ANY CATALOG I/O. Plan :1893 requires "manifest
 * parsing, validation, planning, and loading all perform full structural and semantic validation,
 * recompute the catalog fingerprint, and check runtime `cldrVersion`/`dataFingerprint` compatibility
 * before catalog I/O". The fingerprint half is implemented here; see the note on runtime
 * compatibility at `assertRuntimeCompatible` for the half that is not, and why it is declared rather
 * than guessed.
 *
 * VALIDATION PRESERVES ALL THREE URL SCHEMES. `http:`, `https:` and `file:` all validate, because
 * "common manifest parsing/validation preserves all three schemes so one manifest shape can cross
 * subpaths". The narrowing is the LOADER's: Fetch rejects `file:`, Node rejects everything else. A
 * validator that narrowed here would make a manifest un-shareable between them.
 */
import { resolveLimits } from "../internal/catalog.js";
import { decode as decodePinnedProvenance } from "../data/provenance.js";
import { configurationError } from "../internal/configuration-error.js";
import {
  normalizeCatalogText,
  parseJsonDocument,
  readCharacters,
  readStrictUtf8,
  validateJsonNestingDepth,
} from "../internal/json-parse.js";
import { canonicalLanguageTag, equivalentTags, isKnownLanguageTag } from "../internal/locale-cldr.js";
import { compareTags, normalizedLanguageCode, primaryLanguage } from "../internal/locale.js";
import { javaSplit } from "../internal/locale-jdk-tag.js";

/**
 * Java's list rendering, the one the direct door's identical diagnosis uses. Three lines of it are
 * not worth an import across a subpath boundary — `lokalized/load` reaching into `core` for a
 * string join would put core in load's module graph for no other reason.
 *
 * @param {readonly string[]} tags
 */
const javaList = (tags) => `[${tags.join(", ")}]`;
import { jdkLocaleWellFormed } from "../internal/locale-jdk-tag.js";
import { normalizeTag } from "../internal/locale.js";
import { parseError, rethrowAsParseError } from "../internal/parse-diagnostics.js";
import { catalogIdentityInputFor, computeCatalogIdentity } from "./identity.js";
import { RUNTIME_METADATA } from "../internal/runtime-metadata.js";
import { refuseUnknownOptions } from "../internal/configuration-error.js";

/** Shared by the cldrVersion and behavioralVectorsVersion rules, which want the same shape. */
const VERSION_SHAPE = /^\d+(?:\.\d+)*$/;

/** @typedef {import("./index.js").StringsManifestV1} StringsManifestV1 */

const HEX_64 = /^[0-9a-f]{64}$/;
const MANIFEST_URL_SCHEMES = new Set(["http:", "https:", "file:"]);
const DEFAULT_SOURCE = "<manifest>";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isPlainRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  // A `Map` IS REFUSED, not quietly emptied. It passes the two tests above, and every read below
  // goes through `Object.entries`, which answers `[]` for one — so a manifest carrying a `Map` of
  // tiebreakers validated cleanly and lost every order it declared, with a fingerprint identical to
  // declaring none. Found by review during S11b; no JSON can produce a `Map`, so the only way to
  // reach it is programmatically, which is exactly the caller who would never see the loss.
  && !(value instanceof Map) && !(value instanceof Set);

/**
 * A manifest file tag: well-formed AND known to the pinned CLDR data.
 *
 * Plan :1892 is explicit that "manifest file tags remain pinned-data-known, valid tags; broadening
 * lookup input does not loosen manifest validation". The asymmetry is the rule: any well-formed tag
 * is a legal thing to LOOK UP, while a manifest KEY is a claim about what was published, and a
 * publisher naming a locale CLDR has never heard of has made a mistake rather than a request.
 *
 * @param {unknown} tag @param {string} where
 */
export function requireManifestTag(tag, where) {
  if (typeof tag !== "string" || tag.length === 0)
    throw configurationError(`${where} must be a non-empty locale tag`);
  // The normalization is inside the guard, not after it. `jdkLocaleWellFormed` and
  // `isKnownLanguageTag` do not between them cover everything `normalizeTag` refuses — measured:
  // `en_US` passes both and then `normalizeTag` raises a RangeError — so without this the manifest
  // door would leak a RangeError where plan 6.2 says a semantic manifest problem is a
  // ConfigurationError. Which internal predicate noticed is not something a caller should have to
  // catch two ways.
  try {
    if (!jdkLocaleWellFormed(tag) || !isKnownLanguageTag(tag))
      throw configurationError(`${where} is '${tag}', which is not a valid pinned-data-known locale tag`);
    return normalizeTag(tag);
  } catch (error) {
    if (error instanceof Error && error.name === "ConfigurationError") throw error;
    throw configurationError(`${where} is '${tag}', which is not a valid pinned-data-known locale tag`);
  }
}

/**
 * Runtime CLDR/data compatibility — plan :1893, "before catalog I/O".
 *
 * **THIS WAS DECLARED OWED IN SLICE S6b ON A FALSE PREMISE, and the correction is recorded here
 * rather than quietly made.** That note said the port "exposes its pinned cldrVersion/dataFingerprint
 * only on the OPTIONAL lokalized/data/ordinal module" and that core "publishes no provenance of its
 * own". The first half was right about REACHABILITY and wrong about existence: `src/data/provenance.js`
 * carries both constants, generated from `cldr-data-lock`, and was simply imported by nothing outside
 * the optional data modules. Importing it costs ONE module in the load graph.
 *
 * The lesson is the one this project keeps relearning one subsystem at a time: "there is no X" is the
 * easiest claim to get wrong, because a search for the wrong name returns nothing just as convincingly
 * as an absence does. An owed entry resting on an absence deserves the same scepticism as a gate.
 *
 * A manifest built against different pinned data fails EVEN IF its file plan happens to match, which
 * is the whole point — plural rules and locale identity come from that data, so a catalog published
 * against CLDR 47 renders differently through a CLDR 48 core while looking entirely well-formed.
 *
 * @param {Record<string, unknown>} manifest
 */
function assertRuntimeCompatible(manifest) {
  // SHAPE first, then the comparison: a manifest whose cldrVersion is not version-shaped is
  // refused for THAT, so the mismatch message below never has to describe a malformed value.
  if (typeof manifest.cldrVersion !== "string" || !VERSION_SHAPE.test(manifest.cldrVersion))
    throw configurationError(`A manifest's cldrVersion must be a CLDR version; received ${JSON.stringify(manifest.cldrVersion)}`);
  if (typeof manifest.dataFingerprint !== "string" || !HEX_64.test(manifest.dataFingerprint))
    throw configurationError("A manifest's dataFingerprint must be a full lowercase hexadecimal SHA-256");

  const pinned = decodePinnedProvenance();
  if (manifest.cldrVersion !== pinned.cldrVersion || manifest.dataFingerprint !== pinned.dataFingerprint)
    throw configurationError(
      `This manifest was published against CLDR ${manifest.cldrVersion} / ` +
      `${String(manifest.dataFingerprint).slice(0, 12)}…, and this build carries CLDR ` +
      `${pinned.cldrVersion} / ${pinned.dataFingerprint.slice(0, 12)}…. Plural rules and locale ` +
      `identity come from that data, so the catalogs would render differently even though the file ` +
      `plan matches.`,
    );

  // THE OTHER FIVE OF THE SEVEN, and they are here because two was not enough. M-D S27 measured the
  // asymmetry: an SSR stamp carries all seven build-identity fields and a manifest carried two, so
  // **two builds differing only in their pinned IANA data published indistinguishable manifests
  // and loaded each other's catalogs without complaint.** Range equivalence and whole-list matching
  // come from that data, so the catalogs a visitor is served can be chosen differently by the two
  // builds while every file digest matches.
  //
  // FIXED LITERALS FIRST, each its own test, because they are different facts. A manifest declaring
  // `localeDataMode: "host"` came from an implementation that classifies through `Intl`; that is not
  // a version disagreement and must not be reported as one.
  if (manifest.localeDataMode !== "pinned")
    throw configurationError(
      `A manifest's localeDataMode must be "pinned"; received ${JSON.stringify(manifest.localeDataMode)}`);
  if (manifest.cardinalityMode !== "exact")
    throw configurationError(
      `A manifest's cardinalityMode must be "exact"; received ${JSON.stringify(manifest.cardinalityMode)}`);

  if (typeof manifest.behavioralVectorsVersion !== "string" ||
    !VERSION_SHAPE.test(manifest.behavioralVectorsVersion))
    throw configurationError(
      `A manifest's behavioralVectorsVersion must be a version; ` +
      `received ${JSON.stringify(manifest.behavioralVectorsVersion)}`);
  // DELIBERATELY NOT DATE-SHAPED, and the reason is history rather than today's value. The build's
  // own value read `jdk-oracle:21.0.11` until M-R S11 pinned a registry snapshot, and a
  // `\d{4}-\d{2}-\d{2}` rule written then would have made the generator refuse its own output. It is
  // a date now (plan 5.1's File-Date), but the equality below is what binds a manifest to this build,
  // so a shape rule would add a second refusal for a value that is already compared exactly.
  if (typeof manifest.ianaRegistryDate !== "string" || manifest.ianaRegistryDate.length === 0)
    throw configurationError(
      `A manifest's ianaRegistryDate must be a non-empty identity string; ` +
      `received ${JSON.stringify(manifest.ianaRegistryDate)}`);
  if (typeof manifest.ianaDataFingerprint !== "string" || !HEX_64.test(manifest.ianaDataFingerprint))
    throw configurationError(
      "A manifest's ianaDataFingerprint must be a full lowercase hexadecimal SHA-256");

  // ONE SENTENCE OF ITS OWN, not appended to the CLDR one. The CLDR sentence earns its length by
  // naming a consequence about RENDERING; these three govern NEGOTIATION, which is a different
  // consequence — and keeping the two apart is also what keeps their ablations distinguishable.
  if (manifest.behavioralVectorsVersion !== RUNTIME_METADATA.behavioralVectorsVersion ||
    manifest.ianaRegistryDate !== RUNTIME_METADATA.ianaRegistryDate ||
    manifest.ianaDataFingerprint !== RUNTIME_METADATA.ianaDataFingerprint)
    throw configurationError(
      `This manifest was published against IANA ${manifest.ianaRegistryDate} / ` +
      `${String(manifest.ianaDataFingerprint).slice(0, 12)}… and vectors ` +
      `${manifest.behavioralVectorsVersion}, and this build carries ` +
      `${RUNTIME_METADATA.ianaRegistryDate} / ${RUNTIME_METADATA.ianaDataFingerprint.slice(0, 12)}… ` +
      `and vectors ${RUNTIME_METADATA.behavioralVectorsVersion}. Range equivalence and whole-list ` +
      `matching come from that IANA data, so the two builds can negotiate a visitor to different ` +
      `catalogs even though every file digest matches.`,
    );
}

/**
 * Defensively copy and semantically validate a caller-supplied manifest.
 *
 * @param {unknown} input
 * @param {{ limits?: import("../internal/catalog.js").ParseLimits }} [options]
 * @returns {Readonly<StringsManifestV1>}
 */
export function validateStringsManifest(input, options = {}) {
  options = refuseUnknownOptions("validateStringsManifest", options, ["limits"], { loadingLimits: "limits" });
  const limits = resolveLimits(options.limits);

  if (!isPlainRecord(input)) throw configurationError("A strings manifest must be an object");
  if (input.formatVersion !== 1)
    throw configurationError(`A strings manifest must declare formatVersion 1; received ${JSON.stringify(input.formatVersion)}`);
  if (typeof input.catalogVersion !== "string" || input.catalogVersion.length === 0)
    throw configurationError("A strings manifest must carry a non-empty catalogVersion");
  if (typeof input.catalogFingerprint !== "string" || !HEX_64.test(input.catalogFingerprint))
    throw configurationError("A manifest's catalogFingerprint must be a full lowercase hexadecimal SHA-256");
  assertRuntimeCompatible(input);

  const fallbackLocale = requireManifestTag(input.fallbackLocale, "A manifest's fallbackLocale");

  if (typeof input.baseUrl !== "string")
    throw configurationError("A manifest's baseUrl must be a string");
  let baseUrl;
  try {
    baseUrl = new URL(input.baseUrl);
  } catch {
    throw configurationError(`A manifest's baseUrl must be an absolute URL; received ${JSON.stringify(input.baseUrl)}`);
  }
  if (!MANIFEST_URL_SCHEMES.has(baseUrl.protocol))
    throw configurationError(`A manifest's baseUrl must be http:, https: or file:; received '${baseUrl.protocol}'`);

  if (!isPlainRecord(input.files)) throw configurationError("A manifest's files must be an object");
  const fileEntries = Object.entries(input.files);
  if (fileEntries.length > limits.maximumLocalizedStringsFiles)
    throw configurationError(
      `A manifest declares ${fileEntries.length} files, which exceeds the maximum of ` +
      `${limits.maximumLocalizedStringsFiles}`,
    );

  /** @type {Record<string, { url: string, sha256: string, decodedBytes?: number }>} */
  const files = Object.create(null);
  for (const [rawTag, rawFile] of fileEntries) {
    const tag = requireManifestTag(rawTag, `A manifest file key`);
    if (tag in files)
      throw configurationError(`A manifest declares two file keys that normalize to '${tag}'`);
    if (!isPlainRecord(rawFile)) throw configurationError(`The manifest entry for '${tag}' must be an object`);
    if (typeof rawFile.url !== "string" || rawFile.url.length === 0)
      throw configurationError(`The manifest entry for '${tag}' must carry a non-empty url`);

    let resolved;
    try {
      resolved = new URL(rawFile.url, baseUrl);
    } catch {
      throw configurationError(`The url for '${tag}' does not resolve against the manifest baseUrl`);
    }
    if (!MANIFEST_URL_SCHEMES.has(resolved.protocol))
      throw configurationError(`The resolved url for '${tag}' has scheme '${resolved.protocol}', which a manifest may not name`);

    if (typeof rawFile.sha256 !== "string" || !HEX_64.test(rawFile.sha256))
      throw configurationError(`The sha256 for '${tag}' must be a full lowercase hexadecimal SHA-256`);
    if (rawFile.decodedBytes !== undefined &&
        (!Number.isSafeInteger(rawFile.decodedBytes) || /** @type {number} */ (rawFile.decodedBytes) < 0))
      throw configurationError(`The decodedBytes for '${tag}' must be a non-negative integer`);

    files[tag] = Object.freeze({
      url: rawFile.url,
      sha256: rawFile.sha256,
      ...(rawFile.decodedBytes === undefined ? {} : { decodedBytes: /** @type {number} */ (rawFile.decodedBytes) }),
    });
  }

  if (!isPlainRecord(input.tiebreakers)) throw configurationError("A manifest's tiebreakers must be an object");
  /** @type {Record<string, readonly string[]>} */
  const tiebreakers = Object.create(null);
  for (const [rawTag, candidates] of Object.entries(input.tiebreakers)) {
    const tag = requireManifestTag(rawTag, "A manifest tiebreaker key");
    if (!Array.isArray(candidates))
      throw configurationError(`The tiebreakers for '${tag}' must be an array of locale tags`);
    tiebreakers[tag] = Object.freeze(
      candidates.map((candidate, index) => requireManifestTag(candidate, `The tiebreaker for '${tag}' at index ${index}`)),
    );
  }

  validateManifestTiebreakers(files, tiebreakers);

  // PLAN 6.2:145 AT THE MANIFEST DOOR — "zero or still-ambiguous matches fail construction/MANIFEST
  // VALIDATION". The sentence names BOTH doors and only the direct one implemented it.
  //
  // MEASURED BEFORE THE FIX: a manifest declaring `fallbackLocale: "und"` over files
  // `und-bokmal` and `und-nynorsk` validated, planned, loaded and SERVED — `chain(m, "pt-BR")`
  // ended `und-bokmal`, the subset door fetched that one file and nothing else, and the instance
  // answered every unmatched request from a catalog nobody chose. The core guard that would have
  // caught it is only reachable through the WHOLE-manifest door, which fetches both files first; the
  // subset door never gave it the chance. So the divergence was not "a different message" — it was a
  // `complete: true` load of a manifest the plan says must be refused.
  //
  // REFUSED HERE rather than inside `chain`/`fetchSet`, for the reason S11a recorded one door over:
  // a check inside the planner degrades into one failure among many, and under `allow-partial` that
  // is a successful load which silently skipped what the caller asked for. Validation is before I/O,
  // like the fingerprint guard below it.
  //
  // The DIAGNOSIS is Java's, word for word with the direct door's — which locales collided, and that
  // tiebreakers are how a caller resolves it. Only the CLASS differs, because a manifest-door refusal
  // is a `ConfigurationError`: the phase taxonomy S23 gated says this door's failures are
  // configuration, not resolution.
  const declaredLocales = Object.keys(files).sort(compareTags);
  const equivalentFallbacks = declaredLocales.filter((tag) => equivalentTags(tag, fallbackLocale));

  if (equivalentFallbacks.length === 0)
    throw configurationError(
      `A manifest's fallbackLocale is '${fallbackLocale}' but no matching catalog was declared. ` +
        `Known locales: ${javaList(declaredLocales)}`,
    );

  if (equivalentFallbacks.length > 1 && !equivalentFallbacks.includes(fallbackLocale)) {
    // A tiebreaker for the fallback's own language resolves it, exactly as it does at the direct
    // door. `validateManifestTiebreakers` has already required each list to be a permutation of that
    // language's files, so the first member that is an equivalent is the elected one.
    const languageCode = normalizedLanguageCode(javaSplit(canonicalLanguageTag(fallbackLocale))[0] ?? "");
    const ordered = tiebreakers[languageCode];
    const elected = ordered?.find((candidate) => equivalentFallbacks.includes(candidate));
    // THE REMEDY IS SPELLING THE TAG EXACTLY, NOT A TIEBREAKER, and that is measured rather than
    // assumed. `validateManifestTiebreakers` groups files by PRIMARY LANGUAGE and skips undetermined
    // and private-use tags outright — "they carry no broad-language matching semantics, so two of
    // them create no ambiguity for a tiebreaker to resolve" — so `primaryLanguage("und-bokmal")` is
    // the empty string and a manifest tiebreaker keyed 'und' is itself refused ("declares tiebreakers
    // for 'und' but no file for that language"). A message telling a publisher to add one would send
    // them at a door that is locked. For a LANGUAGE-BEARING fallback the tiebreaker above is the
    // remedy and is already mandatory, so this arm is reached only by the undetermined case.
    if (elected === undefined)
      throw configurationError(
        `A manifest's fallbackLocale '${fallbackLocale}' is canonically equivalent to multiple ` +
          `declared locales ${javaList(equivalentFallbacks)}; declare it as one of them exactly`,
      );
  }

  const manifest = /** @type {StringsManifestV1} */ (Object.freeze({
    formatVersion: /** @type {1} */ (1),
    catalogVersion: input.catalogVersion,
    catalogFingerprint: input.catalogFingerprint,
    cldrVersion: input.cldrVersion,
    dataFingerprint: input.dataFingerprint,
    behavioralVectorsVersion: input.behavioralVectorsVersion,
    localeDataMode: /** @type {"pinned"} */ (input.localeDataMode),
    cardinalityMode: /** @type {"exact"} */ (input.cardinalityMode),
    ianaRegistryDate: input.ianaRegistryDate,
    ianaDataFingerprint: input.ianaDataFingerprint,
    fallbackLocale,
    baseUrl: input.baseUrl,
    files: Object.freeze({ ...files }),
    tiebreakers: Object.freeze({ ...tiebreakers }),
  }));

  // THE FINGERPRINT IS RECOMPUTED, NOT TRUSTED, and this is the "before I/O" rejection: a manifest
  // whose declared identity does not match its own contents is refused here, so no loader ever
  // reaches a per-file plan for it, let alone a network request.
  const recomputed = computeCatalogIdentity(catalogIdentityInputFor(manifest)).catalogFingerprint;
  if (recomputed !== manifest.catalogFingerprint)
    throw configurationError(
      `A manifest's declared catalogFingerprint does not match its contents: declared ` +
      `${manifest.catalogFingerprint}, computed ${recomputed}`,
    );

  return manifest;
}

/**
 * The locale configuration a manifest implies.
 *
 * @param {StringsManifestV1} manifest
 * @param {{ limits?: import("../internal/catalog.js").ParseLimits }} [options]
 * @returns {Readonly<{ fallbackLocale: string, supportedLocales: readonly string[], tiebreakers: Readonly<Record<string, readonly string[]>> }>}
 */
export function localeConfigurationForManifest(manifest, options = {}) {
  options = refuseUnknownOptions("localeConfigurationForManifest", options, ["limits"],
    { loadingLimits: "limits" });
  const validated = validateStringsManifest(manifest, { limits: options.limits });
  return Object.freeze({
    fallbackLocale: validated.fallbackLocale,
    // Sorted, so two manifests declaring the same locales in different orders produce the same
    // configuration — the same reason the identity projection canonicalizes.
    supportedLocales: Object.freeze(Object.keys(validated.files).sort()),
    tiebreakers: validated.tiebreakers,
  });
}

/**
 * Parse a manifest from raw bytes or text, through the bounded duplicate-aware JSON path.
 *
 * @param {string | Uint8Array} input
 * @param {{ limits?: import("../internal/catalog.js").ParseLimits, source?: string }} [options]
 * @returns {Readonly<StringsManifestV1>}
 */
export function parseStringsManifest(input, options = {}) {
  // FIRST, ahead of every read and decode below: this is the one manifest door that does real input
  // work, and `readCharacters`, `readStrictUtf8`, `normalizeCatalogText`, `validateJsonNestingDepth`
  // and `parseJsonDocument` can each throw first and mask a misspelling.
  options = refuseUnknownOptions("parseStringsManifest", options, ["limits", "source"],
    { loadingLimits: "limits" });

  const source = options.source ?? DEFAULT_SOURCE;
  const limits = resolveLimits(options.limits);

  const text = typeof input === "string"
    ? readCharacters(input, source, limits.maximumReaderCharacters)
    : readCharacters(
        readStrictUtf8(input, source, limits.maximumInputBytes, () => {}),
        source,
        limits.maximumReaderCharacters,
      );
  const normalized = normalizeCatalogText(text, source);
  validateJsonNestingDepth(normalized, source, limits.maximumJsonNestingDepth);

  // Through the declared parse error, exactly as `parseStrings` does: a syntax failure at this door
  // is a `StringsParseError` with its `<source>:line:column:` prefix, while a SCHEMA or fingerprint
  // failure below is a `ConfigurationError`. Plan 6.2 splits them deliberately, and the two reach
  // different catch blocks in a consumer, so conflating them is observable rather than cosmetic.
  let document;
  try {
    document = parseJsonDocument(normalized, source);
  } catch (error) {
    rethrowAsParseError(error, source);
  }

  // THE CAPABILITY THE OBJECT DOOR DOES NOT HAVE. `parseJsonDocument` keeps the LAST of duplicate
  // members and reports them separately, so this door can refuse what the object door cannot even
  // see. Root members are checked here; the reader reports at most one finding below the root, which
  // is the bounded choice its own header explains.
  if (document && document.members) {
    const seen = new Set();
    for (const [name] of document.members) {
      if (seen.has(name))
        throw parseError(`${source}: duplicate manifest member '${name}' encountered`, { source });
      seen.add(name);
    }
  }
  const [nested] = /** @type {{ duplicates: { name: string, path: string }[] }} */ (document).duplicates;
  if (nested)
    throw parseError(
      `${source}: duplicate JSON object member '${nested.name}' encountered at ${nested.path}`,
      { source },
    );

  // PROJECTED, NOT FORWARDED. `source` is this door's option and the validator does not take it, so
  // handing the whole object over makes the validator refuse a call that is perfectly correct — a
  // door refusing its own caller for using its own documented option. Measured: leaving this
  // wholesale reds 289 tests, 25 of them on exactly that name.
  return validateStringsManifest(/** @type {{ value: unknown }} */ (document).value,
    { limits: options.limits });
}

/**
 * Plan 6.2:2103 — "Manifest tiebreakers are validated against the FULL manifest".
 *
 * **THIS IS WHAT MAKES THE LOADER'S FILTER SAFE RATHER THAN SILENT.** `runPlan` filters the declared
 * tiebreakers down to the catalogs that actually loaded, so without this check a tiebreaker naming a
 * tag the manifest never declared — `en-UK` for `en-GB`, the kind of thing a publisher writes once —
 * is simply dropped on the floor and the manifest resolves by a shorter order than its author wrote.
 * A filter that cannot distinguish "did not load" from "was never real" is the `ReadonlyMap` defect
 * S11b found, wearing different clothes.
 *
 * The RULE is the core's, at manifest scope: `DefaultStrings.<init>:388` refuses a language code with
 * no catalogs and `:394` requires an exact permutation of that language's catalogs. Applying it here
 * against the manifest's declared files means a manifest that validates is a manifest whose declared
 * coverage can be constructed from; applying it against the LOADED subset instead would refuse every
 * lookup-subset load, which is the defect this pair of changes exists to fix.
 *
 * Private-use and undetermined tags are skipped exactly as the core skips them: they carry no
 * broad-language matching semantics, so two of them create no ambiguity for a tiebreaker to resolve.
 *
 * @param {Record<string, unknown>} files declared files, keyed by normalized tag
 * @param {Record<string, readonly string[]>} tiebreakers normalized, in declared order
 */
function validateManifestTiebreakers(files, tiebreakers) {
  /** @type {Map<string, string[]>} */
  const declaredByLanguageCode = new Map();
  for (const tag of Object.keys(files)) {
    const languageCode = primaryLanguage(tag);
    if (languageCode.length === 0) continue;
    const existing = declaredByLanguageCode.get(languageCode);
    if (existing === undefined) declaredByLanguageCode.set(languageCode, [tag]);
    else existing.push(tag);
  }

  // BOTH DIRECTIONS. A manifest declaring two catalogs for one language and NO tiebreaker for it is
  // not merely under-specified: `createStrings` refuses it outright (`DefaultStrings.<init>:388`), so
  // the manifest describes coverage that can never be loaded. Refusing it here is the difference
  // between a publisher learning it at build time and a browser learning it at run time.
  for (const [languageCode, declared] of declaredByLanguageCode) {
    if (declared.length > 1 && tiebreakers[languageCode] === undefined)
      throw configurationError(
        `The manifest declares ${declared.length} files for '${languageCode}' [${declared.join(", ")}] ` +
        `and no tiebreakers for it, so no instance could resolve between them`);
  }

  for (const [languageCode, candidates] of Object.entries(tiebreakers)) {
    const declared = declaredByLanguageCode.get(languageCode);
    if (declared === undefined)
      throw configurationError(
        `The manifest declares tiebreakers for '${languageCode}' but no file for that language`);

    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate))
        throw configurationError(
          `The tiebreakers for '${languageCode}' name '${candidate}' twice; this list is a resolution ` +
          `order, so a repeat has no recoverable meaning`);
      seen.add(candidate);
    }
    const unrelated = candidates.filter((tag) => !declared.includes(tag));
    const missing = declared.filter((tag) => !seen.has(tag));
    if (unrelated.length > 0 || missing.length > 0)
      throw configurationError(
        `The tiebreakers for '${languageCode}' must be an exact permutation of the files the manifest ` +
        `declares for that language [${declared.join(", ")}]; missing: [${missing.join(", ")}]; ` +
        `unrelated: [${unrelated.join(", ")}]`);
  }
}

