// @ts-check
/**
 * THE PUBLISH STEP BOTH EXAMPLES SHARE — catalogs on disk become a manifest plus a set of
 * digest-bound, immutable asset URLs.
 *
 * `createStringsManifestFromDirectory` does the part that needs a real oracle: it walks the directory
 * the way `readStringsFromDirectory` does, hashes each catalog's bytes, and computes the catalog
 * identity. What it does NOT do is name the files immutably — measured, the generator emits
 * `baseUrl` plus each catalog's own name ON DISK, percent-encoded (`manifest-directory.js:157` is
 * `url: encodeURIComponent(entry.fileName)`), and has no option for anything else.
 *
 * **THAT MATTERS BECAUSE PLAN 6.5:2327 WANTS THE PRELOAD TO POINT AT "exact digest-bound immutable
 * files"** — and 6.3:2177 shows one, `/strings/en-US.a1b2.json`. A URL that is stable across catalog
 * revisions cannot carry `Cache-Control: immutable`, so a deployment wanting the plan's preload
 * story has to rename the
 * files itself, exactly as below. This step is therefore part of the example rather than an
 * implementation detail of it, and the gap is recorded in `planning/M9-STATUS.md` rather than hidden
 * behind a helper.
 *
 * **RENAMING IS SAFE, AND IT IS SAFE BY DESIGN RATHER THAN BY LUCK.** `CatalogIdentityInputV1`
 * (plan 6.1) omits `baseUrl` and every per-file `url` and `decodedBytes`, so the identity is a fact
 * about the TRANSLATIONS and not about where they are served from. `test/example-server.test.js`
 * asserts the fingerprint is byte-identical before and after this rewrite, which is the S6 exclusion
 * test arriving from the consumer's side.
 *
 * This module imports `lokalized/node` and is therefore Node-only. The edge worker never imports it —
 * it receives the published manifest over the network like any other client — and
 * `tools/example-graphs.mjs` checks that the separation holds rather than trusting it.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createStringsManifestFromDirectory } from "lokalized/node";

/** @typedef {import("lokalized/load").StringsManifestV1} StringsManifestV1 */

/** The catalogs these examples publish. */
export const CATALOG_DIRECTORY = new URL("../catalogs/", import.meta.url);

/**
 * The tiebreaker list the `fr` family requires.
 *
 * `fr` and `fr-CA` share a primary language, and `createStrings` refuses an ambiguous family outright
 * (`DefaultStrings.<init>:394`) rather than electing a winner — so a manifest that omits this loads
 * `complete: true` and then cannot be constructed from. The generator is the only door a tiebreaker
 * can enter through, which is the defect S15 found on the flagship loader.
 */
export const TIEBREAKERS = Object.freeze({ fr: Object.freeze(["fr", "fr-CA"]) });

/**
 * Generate the manifest and rewrite every file URL to a digest-bound, immutable name.
 *
 * @param {Readonly<{ catalogVersion: string, publicationBaseUrl: string }>} options
 * @returns {Promise<Readonly<{
 *   manifest: StringsManifestV1,
 *   assets: ReadonlyMap<string, Uint8Array>,
 * }>>} the manifest, and every asset path it names mapped to the bytes to serve
 */
export async function publishCatalogs(options) {
  const generated = await createStringsManifestFromDirectory(CATALOG_DIRECTORY, {
    catalogVersion: options.catalogVersion,
    fallbackLocale: "en",
    tiebreakers: TIEBREAKERS,
    publicationBaseUrl: options.publicationBaseUrl,
  });

  /** @type {Record<string, { url: string, sha256: string, decodedBytes?: number }>} */
  const files = {};
  /** @type {Map<string, Uint8Array>} */
  const assets = new Map();

  for (const [locale, entry] of Object.entries(generated.files)) {
    // The first eight hex digits of the body digest. Long enough that two revisions of one catalog
    // do not collide in any deployment this example describes, and short enough to read in a log.
    const path = `${locale}.${entry.sha256.slice(0, 8)}.json`;
    files[locale] = { ...entry, url: new URL(path, options.publicationBaseUrl).href };
    assets.set(path, await readFile(fileURLToPath(new URL(`${locale}.json`, CATALOG_DIRECTORY))));
  }

  // `catalogFingerprint` is carried over UNCHANGED and deliberately not recomputed: the rewrite
  // touched only URLs, which the identity projection excludes. Recomputing here would hide a real
  // change to that projection behind a fresh hash of whatever this function happened to produce.
  return Object.freeze({
    manifest: Object.freeze({ ...generated, files: Object.freeze(files) }),
    assets,
  });
}

/**
 * THE SAME CATALOGS, DESCRIBED FOR A PROCESS THAT CAN READ THE DISK.
 *
 * A deployment has two manifests describing one set of translations: the one it SERVES, whose URLs
 * are public and digest-bound, and the one its own renderer loads from, whose URLs are `file:`. They
 * are not interchangeable — `lokalized/node`'s loaders refuse a non-`file:` scheme in PREFLIGHT and
 * the Fetch loader refuses `file:` the same way, each before any read — so this is a second manifest
 * rather than a second base URL on the first.
 *
 * **AND THE TWO SHARE A CATALOG IDENTITY, which is the property the SSR stamp rests on.** Plan 6.4
 * lets "a whole-manifest server instance and a lookup-subset client instance" validate the same
 * stamp; here the server's instance is built over `file:` and the client's over `https:`, and they
 * agree because the identity projection never saw a URL. `test/example-server.test.js` asserts the
 * two fingerprints are equal, which is S6's exclusion test arriving from the outside.
 *
 * @param {Readonly<{ catalogVersion: string }>} options
 * @returns {Promise<StringsManifestV1>}
 */
export async function localCatalogManifest(options) {
  return createStringsManifestFromDirectory(CATALOG_DIRECTORY, {
    catalogVersion: options.catalogVersion,
    fallbackLocale: "en",
    tiebreakers: TIEBREAKERS,
    publicationBaseUrl: CATALOG_DIRECTORY.href,
  });
}
