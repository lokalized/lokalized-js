// @ts-check
/**
 * `computeCatalogIdentity` — plan section 6.1.
 *
 * A catalog set's identity is a property of the TRANSLATIONS, deliberately not of how they were
 * served. The plan states the projection exactly: JCS is applied to
 * `{formatVersion, catalogVersion, resolvedFallbackLocale, localeToSha256, tiebreakers}` and the
 * `catalogFingerprint` is the full lowercase hexadecimal SHA-256 of those exact UTF-8 bytes.
 *
 * WHAT IT EXCLUDES IS THE WHOLE POINT, and it is a behaviour rather than an omission: the fingerprint
 * excludes itself, the CLDR and data fingerprints, and the transport-only `baseUrl`, per-file `url`
 * and `decodedBytes` — "so server and CDN manifests can identify the same translations". A manifest
 * moved to a different host, or republished with different declared decoded sizes, is the SAME
 * catalog and must fingerprint identically. `test/catalog-identity.test.js` asserts that one field at
 * a time, each with an included-field control that must MOVE the digest, because a projection that
 * ignored everything would pass every exclusion test on its own.
 *
 * Synchronous, because plan 6.1 requires it in a browser with no Node APIs — see
 * `src/internal/sha256.js` for why the port carries its own digest for this bounded projection.
 */
import { canonicalBytes } from "../internal/jcs.js";
import { sha256Hex } from "../internal/sha256.js";

/** @typedef {import("./index.js").CatalogIdentity} CatalogIdentity */
/** @typedef {import("./index.js").CatalogIdentityInputV1} CatalogIdentityInputV1 */
/** @typedef {import("./index.js").StringsManifestV1} StringsManifestV1 */

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * The identity projection, built FIELD BY FIELD rather than by spreading the argument.
 *
 * Explicit for the same reason `conformance.mjs` builds its limit tables explicitly: a spread would
 * carry any extra property the caller happened to attach straight into the canonical bytes, so an
 * object that merely PASSED THROUGH a manifest reader would fingerprint differently from one built
 * by hand — and the difference would be invisible, because a fingerprint is only ever compared
 * against another fingerprint.
 *
 * @param {CatalogIdentityInputV1} input
 * @returns {Record<string, unknown>}
 */
function projection(input) {
  if (input === null || typeof input !== "object")
    throw new TypeError("A catalog identity input must be an object");
  if (input.formatVersion !== 1)
    throw new RangeError(`A catalog identity input must declare formatVersion 1; received ${String(input.formatVersion)}`);
  if (typeof input.catalogVersion !== "string" || input.catalogVersion.length === 0)
    throw new TypeError("A catalog identity input must carry a non-empty catalogVersion");
  if (typeof input.resolvedFallbackLocale !== "string" || input.resolvedFallbackLocale.length === 0)
    throw new TypeError("A catalog identity input must carry a non-empty resolvedFallbackLocale");

  /** @type {Record<string, string>} */
  const localeToSha256 = Object.create(null);
  for (const [tag, digest] of Object.entries(input.localeToSha256 ?? {})) {
    // The digest spelling is pinned rather than trusted: an uppercase or truncated hex string would
    // canonicalize cleanly and produce a stable, wrong fingerprint that nothing downstream compares
    // against anything but itself.
    if (typeof digest !== "string" || !HEX_64.test(digest))
      throw new TypeError(
        `The digest for '${tag}' must be a full lowercase hexadecimal SHA-256; received ${JSON.stringify(digest)}`,
      );
    localeToSha256[tag] = digest;
  }

  /** @type {Record<string, string[]>} */
  const tiebreakers = Object.create(null);
  for (const [tag, candidates] of Object.entries(input.tiebreakers ?? {})) {
    if (!Array.isArray(candidates))
      throw new TypeError(`The tiebreakers for '${tag}' must be an array of locale tags`);
    tiebreakers[tag] = [...candidates];
  }

  // A null-prototype object is not a "plain object" to the canonicalizer, so the projection is handed
  // over with Object.prototype. The null prototype above is what keeps a `__proto__` key in a
  // manifest an ordinary member rather than a mutation.
  return {
    formatVersion: 1,
    catalogVersion: input.catalogVersion,
    resolvedFallbackLocale: input.resolvedFallbackLocale,
    localeToSha256: { ...localeToSha256 },
    tiebreakers: { ...tiebreakers },
  };
}

/**
 * The exact canonical bytes a fingerprint is taken over. Exposed internally so tests can compare the
 * BYTES rather than only the digest — a digest mismatch says something changed, the bytes say what.
 *
 * @param {CatalogIdentityInputV1} input
 * @returns {Uint8Array}
 */
export function catalogIdentityBytes(input) {
  return canonicalBytes(projection(input), "the catalog identity input");
}

/**
 * @param {CatalogIdentityInputV1} input
 * @returns {Readonly<CatalogIdentity>}
 */
export function computeCatalogIdentity(input) {
  return Object.freeze({
    catalogVersion: input.catalogVersion,
    catalogFingerprint: sha256Hex(catalogIdentityBytes(input)),
  });
}

/**
 * The identity input a manifest implies — where the EXCLUSIONS actually happen.
 *
 * `computeCatalogIdentity` cannot exclude `baseUrl` or a per-file `url`, because they never reach
 * it: this is the function that drops them, and it drops them by naming what it keeps rather than by
 * deleting what it does not.
 *
 * @param {StringsManifestV1} manifest
 * @returns {CatalogIdentityInputV1}
 */
export function catalogIdentityInputFor(manifest) {
  /** @type {Record<string, string>} */
  const localeToSha256 = Object.create(null);
  for (const [tag, file] of Object.entries(manifest.files ?? {}))
    localeToSha256[tag] = /** @type {{ sha256: string }} */ (file).sha256;

  return {
    formatVersion: 1,
    catalogVersion: manifest.catalogVersion,
    resolvedFallbackLocale: manifest.fallbackLocale,
    localeToSha256,
    tiebreakers: manifest.tiebreakers,
  };
}
