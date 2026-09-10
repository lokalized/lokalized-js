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
import { configurationError } from "../internal/configuration-error.js";
import {
  normalizeCatalogText,
  parseJsonDocument,
  readCharacters,
  readStrictUtf8,
  validateJsonNestingDepth,
} from "../internal/json-parse.js";
import { isKnownLanguageTag } from "../internal/locale-cldr.js";
import { jdkLocaleWellFormed } from "../internal/locale-jdk-tag.js";
import { normalizeTag } from "../internal/locale.js";
import { parseError, rethrowAsParseError } from "../internal/parse-diagnostics.js";
import { catalogIdentityInputFor, computeCatalogIdentity } from "./identity.js";

/** @typedef {import("./index.js").StringsManifestV1} StringsManifestV1 */

const HEX_64 = /^[0-9a-f]{64}$/;
const MANIFEST_URL_SCHEMES = new Set(["http:", "https:", "file:"]);
const DEFAULT_SOURCE = "<manifest>";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isPlainRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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
function requireManifestTag(tag, where) {
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
 * Runtime CLDR/data compatibility — DECLARED AND NOT IMPLEMENTED, deliberately.
 *
 * Plan :1893 requires this check before catalog I/O, and it cannot be written honestly yet: the port
 * exposes its pinned `cldrVersion`/`dataFingerprint` only on the OPTIONAL `lokalized/data/ordinal`
 * module, which `lokalized/load` must not import (it is outside the root graph by design and the
 * subpath ratchet enforces it), and core publishes no provenance of its own. Guessing a value to
 * compare against would produce a check that always passes, which is worse than none: it would read
 * as coverage. Recorded as owed by the slice that lands core's `DataProvenance`.
 *
 * @param {Record<string, unknown>} manifest
 */
function assertRuntimeCompatible(manifest) {
  // The manifest's own declarations are still SHAPE-checked here; only the comparison is missing.
  if (typeof manifest.cldrVersion !== "string" || !/^\d+(?:\.\d+)*$/.test(manifest.cldrVersion))
    throw configurationError(`A manifest's cldrVersion must be a CLDR version; received ${JSON.stringify(manifest.cldrVersion)}`);
  if (typeof manifest.dataFingerprint !== "string" || !HEX_64.test(manifest.dataFingerprint))
    throw configurationError("A manifest's dataFingerprint must be a full lowercase hexadecimal SHA-256");
}

/**
 * Defensively copy and semantically validate a caller-supplied manifest.
 *
 * @param {unknown} input
 * @param {{ limits?: import("../internal/catalog.js").ParseLimits }} [options]
 * @returns {Readonly<StringsManifestV1>}
 */
export function validateStringsManifest(input, options = {}) {
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

  const manifest = /** @type {StringsManifestV1} */ (Object.freeze({
    formatVersion: /** @type {1} */ (1),
    catalogVersion: input.catalogVersion,
    catalogFingerprint: input.catalogFingerprint,
    cldrVersion: input.cldrVersion,
    dataFingerprint: input.dataFingerprint,
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
  const validated = validateStringsManifest(manifest, options);
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

  return validateStringsManifest(/** @type {{ value: unknown }} */ (document).value, options);
}
