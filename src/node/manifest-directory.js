// @ts-check
/**
 * `createStringsManifestFromDirectory` — plan section 6.2's directory-to-manifest generator, clause 64.
 *
 * **IT HASHES; IT DOES NOT PARSE. That is the governing decision of this slice and it is DERIVED,
 * not preferred.** Plan 6.2:2122-2126 enumerates what the generator does — "hashes raw file bytes and
 * emits URLs against the absolute publicationBaseUrl, computes the canonical identity projection, and
 * returns the browser manifest shape" — and parsing is not in it. The decisive structural evidence is
 * the option type: `DirectoryManifestOptions` carries no `onWarning`, and parsing a catalog PRODUCES
 * warnings (incomplete cardinality and ordinality), so a parsing generator would have nowhere to
 * deliver them. The limits it can honour are therefore exactly the ones plan 6.2:2123 names —
 * file, count and aggregate BYTE budgets — and not `maximumTranslationNodes`, which has no meaning
 * before a model exists.
 *
 * The consequence is real and is stated rather than hidden: **a directory of malformed catalogs
 * generates a perfectly valid manifest.** That is correct for a publisher — a digest identifies
 * BYTES, and a manifest is a claim about what was published, not about whether it parses — and it is
 * why `loadStringsFromDirectory` is generate-AND-whole-load rather than generate alone. The composed
 * door does parse, at the load half, and reports a `parse`-stage failure per file.
 *
 * **THE WALK IS THE RAW LOADER'S, SHARED RATHER THAN RE-IMPLEMENTED** (`./discovery.js`). Every rule
 * in it was measured on the pinned JDK, several of them are the opposite of what a careful reading
 * gives, and none of them is restated in plan 6.2. A generator with its own walk would be a second
 * thing to keep in step with a specification that lives in a status document and a JDK.
 */
import { fileURLToPath, pathToFileURL } from "node:url";

import { configurationError } from "../internal/configuration-error.js";
import { resolveLimits } from "../internal/catalog.js";
import { sha256Hex } from "../internal/sha256.js";
import { decode as pinnedProvenance } from "../data/provenance.js";
import { computeCatalogIdentity } from "../load/identity.js";
import { catalogIdentityInputFor } from "../load/identity.js";
import { requireManifestTag, validateStringsManifest } from "../load/manifest.js";
import { directoryLabel, discoverCatalogFiles, keyedByRenderedTag, resolveDiscoveryLimit } from "./discovery.js";

/** @typedef {import("../load/index.js").StringsManifestV1} StringsManifestV1 */

/**
 * Plan 6.2's `DirectoryManifestOptions`, plus the Node-owned discovery budget.
 *
 * `maximumDiscoveryEntries` is here for the reason maintainer decision D2 put it on
 * `readStringsFromDirectory`: plan 4.5's `StringsLoadingLimits` is the portable parser's seven-field
 * contract and says in words that discovery controls are not part of it. The two directory doors walk
 * the same directory with the same budget, so a knob on one and not the other would be a difference
 * with no reason behind it.
 *
 * @typedef {object} DirectoryManifestOptions
 * @property {string} catalogVersion
 * @property {string} fallbackLocale
 * @property {Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]>} [tiebreakers]
 * @property {string | URL} [publicationBaseUrl]
 * @property {import("../internal/catalog.js").ParseLimits} [limits]
 * @property {number} [maximumDiscoveryEntries]
 */

/** A directory argument, as a filesystem path. Accepts a `file:` URL, as plan 6.2 types it. */
export function directoryPath(/** @type {string | URL} */ directory) {
  if (directory instanceof URL) {
    if (directory.protocol !== "file:")
      throw configurationError(
        `A directory must be a filesystem path or a \`file:\` URL, not '${directory.protocol}'`);
    return fileURLToPath(directory);
  }
  return directory;
}

/**
 * The base every emitted URL resolves against, always ending in a slash.
 *
 * **THE TRAILING SLASH IS LOAD-BEARING AND IS SUPPLIED RATHER THAN REQUIRED.** Measured:
 * `new URL("en.json", "https://cdn.example/v1/catalogs")` is `https://cdn.example/v1/en.json` — RFC
 * 3986 relative resolution drops the last segment of a base that does not end in one. So a base
 * written without a slash would silently publish every catalog one directory up.
 *
 * Appending is the consistent answer rather than a convenience: `pathToFileURL` of a directory does
 * not end in a slash either (measured), so the generator must append one for its own DEFAULT base to
 * work at all — and a rule that applies to the default and not to an explicit value would be the
 * surprising design. Appending can never relocate anything, because it only ever preserves segments.
 *
 * @param {string | URL | undefined} supplied @param {string} directory
 */
function publicationBase(supplied, directory) {
  let base;
  if (supplied === undefined) {
    base = pathToFileURL(directory);
  } else if (supplied instanceof URL) {
    base = new URL(supplied.href);
  } else {
    try {
      base = new URL(supplied);
    } catch {
      throw configurationError(
        `\`publicationBaseUrl\` must be an ABSOLUTE URL; received ${JSON.stringify(supplied)}. A ` +
        `manifest is published at a location, so there is nothing for a relative value to resolve ` +
        `against`);
    }
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

/**
 * Generate a publishable `StringsManifestV1` from one directory of catalogs.
 *
 * @param {string | URL} directory
 * @param {DirectoryManifestOptions} options
 * @returns {Promise<Readonly<StringsManifestV1>>}
 */
export async function createStringsManifestFromDirectory(directory, options) {
  if (options === null || typeof options !== "object")
    throw configurationError("createStringsManifestFromDirectory requires catalogVersion and fallbackLocale");
  if (typeof options.catalogVersion !== "string" || options.catalogVersion.length === 0)
    throw configurationError("`catalogVersion` must be a non-empty string");
  if (typeof options.fallbackLocale !== "string" || options.fallbackLocale.length === 0)
    throw configurationError("`fallbackLocale` must be a locale tag");

  // Both budgets validated BEFORE any I/O, and in this order, for the reason the raw door validates
  // them in this order: an out-of-band limit is Java's options-builder refusal, which precedes the
  // loader entirely. A caller who passed a bad limit AND a bad path should be told about the limit.
  const maximumDiscoveryEntries = resolveDiscoveryLimit(options.maximumDiscoveryEntries);
  const limits = resolveLimits(options.limits);

  const path = directoryPath(directory);
  const base = publicationBase(options.publicationBaseUrl, path);
  const label = directoryLabel(path);

  /** @type {{ tag: string, value: { url: string, sha256: string, decodedBytes: number, sourceFileName: string } }[]} */
  const discovered = [];
  let totalBytes = 0;

  for (const entry of discoverCatalogFiles(path, { maximumDiscoveryEntries })) {
    // The file and byte budgets, charged on what this door actually does: one entry per file it
    // EMITS, and the bytes it actually reads. Clause 55's rule is "only files actually PARSED, not
    // directory entries"; at a door that parses nothing, the entries it emits are the analogue, and
    // the complement holds unchanged — a skipped dotfile or subdirectory still costs nothing here.
    if (discovered.length >= limits.maximumLocalizedStringsFiles)
      throw configurationError(
        `${label}: more than ${limits.maximumLocalizedStringsFiles} localized strings files`);
    if (entry.bytes.length > limits.maximumInputBytes)
      throw configurationError(
        `${entry.canonicalPath}: ${entry.bytes.length} bytes exceeds the maximum of ` +
        `${limits.maximumInputBytes}`);
    totalBytes += entry.bytes.length;
    if (totalBytes > limits.maximumTotalInputBytes)
      throw configurationError(
        `${label}: the catalogs total more than ${limits.maximumTotalInputBytes} bytes`);

    discovered.push({
      tag: entry.tag,
      value: {
        // A RELATIVE reference — one path segment, percent-encoded — against an absolute `baseUrl`.
        // The identity projection omits both, so this is not an identity question; it is a
        // relocatability one, and `baseUrl` exists precisely so a catalog set can move. The name is
        // the one ON DISK, never the tag: `en-US.JSON` and an extensionless `fr` are both loadable
        // and neither is spelled like its key.
        url: encodeURIComponent(entry.fileName),
        // Plan 6.2 hashes RAW FILE BYTES — the octets as they sit on disk, BOM and all. A generator
        // that hashed a re-serialization of a parsed catalog would publish a digest no browser could
        // ever reproduce, because the browser verifies what it downloaded.
        sha256: sha256Hex(entry.bytes),
        // EMITTED, though the plan leaves it optional. It is identity-neutral and it is the only
        // field that lets a consumer reject a wrong-length body BEFORE spending a digest; the value
        // is measured here, so it can only be wrong if the file changed — which is what it is for.
        decodedBytes: entry.bytes.length,
        // Kept only so a refusal can name the file a caller has to go and rename; stripped before
        // the manifest is built, since it is not a manifest field.
        sourceFileName: entry.fileName,
      },
    });
  }

  const byTag = keyedByRenderedTag(discovered, label);

  // EVERY KEY CHECKED HERE, so a rejection names the FILE. The manifest tag rule is narrower than the
  // walk's: `en-US-x-lvariant-POSIX.json` loads through the raw door and renders `en-US-POSIX`, which
  // no manifest may key on. Letting `validateStringsManifest` catch it produced "A manifest file key
  // is 'en-US-POSIX'" — true, and useless to someone looking at a directory, since it names neither
  // the file nor the directory.
  for (const [tag, value] of Object.entries(byTag))
    try {
      requireManifestTag(tag, "x");
    } catch {
      throw configurationError(
        `${value.sourceFileName} in ${label} is a locale the raw directory loader accepts and a ` +
        `manifest cannot publish: '${tag}' is not a valid pinned-data-known manifest tag`);
    }

  /** @type {Record<string, { url: string, sha256: string, decodedBytes: number }>} */
  const files = Object.create(null);
  for (const [tag, value] of Object.entries(byTag))
    files[tag] = { url: value.url, sha256: value.sha256, decodedBytes: value.decodedBytes };

  // THE FALLBACK MUST BE BACKED BY A FILE, which is where this door parts company with the raw one.
  // Plan 2.2's manifest fallback rule ends "zero or ambiguous FAILS", and a manifest whose fallback
  // has no catalog cannot produce a `LoadedStrings` any `createStrings` will accept — so generating
  // one would only defer the failure to a different door with a worse message. An EMPTY directory
  // lands here too: `readStringsFromDirectory` answers it with an empty map and no error (measured on
  // the JDK, and a required corpus case), and this door cannot, because a manifest without a
  // fallback locale is not a manifest. Said plainly because the two doors genuinely differ.
  //
  // Only the EXACT-tag arm of plan 2.2's resolution is implemented; the sole-CLDR-equivalent and
  // tiebreaker-ordered arms remain owed, and a tag that would resolve through them is refused here
  // rather than silently resolved by a rule this port does not yet have.
  // NORMALIZED WITH THE VALIDATOR'S OWN FUNCTION, never compared raw. Found by review: `en-us` was
  // refused over a directory holding `en-US.json`, because the keys are rendered tags and the option
  // was not normalized — while `validateStringsManifest` would have accepted the identical spelling
  // one line later. Two normalizations in one call that disagree is the shape this project keeps
  // finding; the fix is to have only one.
  const fallbackLocale = requireManifestTag(options.fallbackLocale, "`fallbackLocale`");
  if (!Object.prototype.hasOwnProperty.call(files, fallbackLocale))
    throw configurationError(
      `No catalog in ${label} is the declared fallbackLocale '${fallbackLocale}'; the directory ` +
      `holds [${Object.keys(files).join(", ")}]. A manifest's fallback must be a locale it publishes`);

  const draft = {
    formatVersion: /** @type {1} */ (1),
    catalogVersion: options.catalogVersion,
    catalogFingerprint: "",
    // FROM THE RENDERER'S PINNED DATA, never invented. A manifest carrying anything else is one that
    // no `createStrings({ loaded })` will ever accept, and the generator is the only party here that
    // knows which data the catalogs were authored against.
    cldrVersion: pinnedProvenance().cldrVersion,
    dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale,
    baseUrl: base.href,
    files,
    // NOT synthesized — plan 2.2's one-element synthesis is a VALIDATION rule, and doing it here
    // would make the fingerprint depend on the file set through a second, invisible route. But
    // NORMALIZED, for the reason the fingerprint below depends on: see `normalizedTiebreakers`.
    tiebreakers: normalizedTiebreakers(options.tiebreakers),
  };
  // **COMPUTED OVER A DRAFT THAT IS ALREADY NORMALIZED, and that is not a detail.** Found by review:
  // computing it over the caller's spelling made `validateStringsManifest` — which normalizes, then
  // RE-derives the fingerprint and compares — reject the generator's own output with "declared X,
  // computed Y", a self-contradiction from one call. Any tiebreaker spelled non-canonically
  // (`{ fr: ["fr", "fr-ca"] }`) reached it.
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;

  // VALIDATED THROUGH THE SAME DOOR EVERY LOADER USES, so a generator that emitted something a
  // loader would refuse fails here rather than at a consumer. It also re-derives the fingerprint and
  // compares, which makes the line above checkable rather than merely executed.
  return validateStringsManifest(draft, { limits });
}

/**
 * The caller's tiebreakers, in the ONE shape a manifest carries.
 *
 * Plan 3.2 types the OPTION as `TiebreakerMap` — `Readonly<Record<…>> | ReadonlyMap<…>` — while plan
 * 6.1 types the manifest FIELD as a plain record. Converting between them is therefore this
 * function's job, and getting it wrong was silent: a `ReadonlyMap` reached `Object.entries`, which
 * answers `[]`, so a publisher's declared orders vanished and the manifest fingerprinted exactly as
 * if none had been given. Found by review, not by a test.
 *
 * Tags are normalized through the manifest validator's OWN function, so the draft this produces and
 * the manifest that validator returns cannot disagree — which is what the fingerprint depends on.
 *
 * @param {Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]> | undefined} supplied
 */
function normalizedTiebreakers(supplied) {
  if (supplied === undefined || supplied === null) return {};
  const entries = supplied instanceof Map ? [...supplied.entries()] : Object.entries(supplied);
  /** @type {Record<string, readonly string[]>} */
  const normalized = Object.create(null);
  for (const [rawTag, candidates] of entries) {
    const tag = requireManifestTag(rawTag, "A tiebreaker key");
    if (!Array.isArray(candidates))
      throw configurationError(`The tiebreakers for '${tag}' must be an array of locale tags`);
    normalized[tag] = candidates.map((candidate, index) =>
      requireManifestTag(candidate, `The tiebreaker for '${tag}' at index ${index}`));
  }
  return normalized;
}
