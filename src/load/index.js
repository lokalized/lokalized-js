// @ts-check

/**
 * lokalized/load — manifest validation, planning, Fetch loading, identity.
 *
 * THE TYPE SURFACE LANDS BEFORE THE RUNTIME, deliberately. These are the shapes slices S6-S8 will be
 * written against, and declaring them first means the contract is reviewable — and machine-checked by
 * `test/declared-surface.test.js` — while it is still cheap to change. Every declaration here is
 * transcribed from `IMPLEMENTATION-PLAN-v7.md`'s own TypeScript blocks, cited per type, rather than
 * invented: this subpath has no Java counterpart at all, so the plan is the only oracle it has, and
 * a type that drifts from the plan has nothing to catch it.
 *
 * A NOTE ON WHAT THIS DOES NOT YET DECLARE. `chain` and `fetchSet` are FUNCTIONS with real planning
 * behaviour behind them, so they arrive with slice S7 rather than as empty signatures; they remain
 * recorded as owed. Declaring a function's type without its implementation would satisfy the gate
 * while delivering nothing, which is the shape of decoration this project audits for.
 */

/** @typedef {import("../parse/index.js").ParsedStringsFile} ParsedStringsFile */
/** @typedef {import("../parse/index.js").StringsLoadingLimits} StringsLoadingLimits */
/** @typedef {import("../internal/parse-warnings.js").LocalizedStringWarning} LocalizedStringWarning */

/**
 * A catalog set's identity, independent of where it was served from — CORE'S TYPE, CONSUMED HERE.
 *
 * Plan section 2.2 (`interface CatalogIdentity`) gives it to `core`, and plan 3.1's `load` row ends
 * "it consumes but does not re-own or re-export core's `CatalogIdentity` and `StringsLoadCoverage`".
 * This module used to DECLARE it, which `tsc` emits as `export type CatalogIdentity` on
 * `lokalized/load` — the re-export that sentence forbids. The two declarations had also drifted:
 * core's was `Readonly<{...}>` and this one was not, so the same public name meant a frozen record on
 * one subpath and a mutable one on the other. Referenced INLINE rather than through a module-scope
 * `@typedef`, because an imported typedef is emitted as an export too — measured on
 * `ParsedStringsFile`, which arrives by import and still appears as `export type` in `types/load`.
 */

/**
 * @typedef {"reject" | "allow-partial"} PartialFailurePolicy
 *   `"reject"` fails the load if a file fails. `"allow-partial"` retains successfully
 *   loaded catalogs and reports failures; the fallback catalog must still load.
 */

/**
 * Options for `loadStrings` and `loadEntireManifest`.
 *
 * `fetch` supplies a custom transport; otherwise the global Fetch API is used.
 * `signal` cancels the load, including when a custom transport ignores cancellation.
 * `request` configures the request mode and credentials. `partialFailure` defaults
 * to `"reject"`; select `"allow-partial"` to retain successfully loaded catalogs.
 * `limits` bounds resource parsing and the total load.
 *
 * @typedef {Readonly<{
 *   fetch?: (url: string, init: RequestInit) => Promise<Response>,
 *   signal?: AbortSignal,
 *   request?: Readonly<{ mode?: "cors" | "same-origin", credentials?: "omit" | "same-origin" | "include" }>,
 *   partialFailure?: PartialFailurePolicy,
 *   limits?: import("../parse/index.js").StringsLoadingLimits,
 * }>} LoadStringsOptions
 */

/**
 * The manifest a browser or edge runtime loads from.
 *
 * `formatVersion` is the literal `1` rather than a number, so a future format cannot be mistaken for
 * this one by a structural check.
 *
 * @typedef {object} StringsManifestV1
 * @property {1} formatVersion
 * @property {string} catalogVersion
 * @property {string} catalogFingerprint
 * @property {string} cldrVersion
 * @property {string} dataFingerprint
 * @property {string} behavioralVectorsVersion
 * @property {"pinned"} localeDataMode
 * @property {"exact"} cardinalityMode
 * @property {string} ianaRegistryDate
 *   The date of the pinned IANA Language Subtag Registry snapshot, as `YYYY-MM-DD`.
 * @property {string} ianaDataFingerprint
 * @property {string} fallbackLocale
 * @property {string} baseUrl
 * @property {Readonly<Record<string, Readonly<{ url: string, sha256: string, decodedBytes?: number }>>>} files
 *   Per locale: the URL, lowercase SHA-256 of the response body bytes after content
 *   decoding and before text decoding, and an optional expected decoded byte count.
 * @property {Readonly<Record<string, readonly string[]>>} tiebreakerLocalesByLanguageCode
 */

/**
 * A planned catalog file. `url` is absolute, resolved against the manifest's
 * `baseUrl`. `sha256` is the expected lowercase SHA-256 digest.
 *
 * @typedef {object} FetchEntry
 * @property {string} locale
 * @property {string} url
 * @property {string} sha256
 * @property {number} [expectedDecodedBytes]
 */

/**
 * Catalog content and locale configuration used to compute its fingerprint.
 * The identity excludes publication URLs and decoded byte counts, so relocating
 * unchanged catalogs does not change their identity.
 *
 * @typedef {object} CatalogIdentityInputV1
 * @property {1} formatVersion
 * @property {string} catalogVersion
 * @property {string} resolvedFallbackLocale
 * @property {Readonly<Record<string, string>>} localeToSha256
 * @property {Readonly<Record<string, readonly string[]>>} tiebreakerLocalesByLanguageCode
 */

/**
 * What a load was asked to cover — CORE'S TYPE, CONSUMED HERE, for the same reason as
 * `CatalogIdentity` above.
 *
 * Plan section 2.2 (`type StringsLoadCoverage`). The `lookup` arm carries NORMALIZED planning input
 * and the plan states plainly that the tag NEED NOT OCCUR IN THE MANIFEST — a lookup locale is a
 * request, not a claim about what was published.
 */

/**
 * A catalog file that failed to load. `stage` identifies whether the failure
 * occurred during fetching, reading, limit checks, digest verification, text
 * decoding, JSON parsing, or catalog validation. `cause` retains the original error.
 *
 * @typedef {object} LoadFailure
 * @property {string} locale
 * @property {string} url
 * @property {"fetch" | "read" | "limit" | "digest" | "decode" | "parse" | "validate"} stage
 * @property {unknown} cause
 */

/**
 * A loader-produced catalog snapshot accepted by `createStrings({ loaded })`.
 * It includes catalogs, locale configuration, content identity, coverage, and
 * diagnostics. Construction validates the snapshot and its provenance.
 *
 * @typedef {object} LoadedStrings
 * @property {Readonly<Record<string, ParsedStringsFile>>} catalogs
 * @property {Readonly<Record<string, readonly string[]>>} tiebreakerLocalesByLanguageCode
 * @property {string} fallbackLocale
 * @property {Readonly<{ fallbackLocale: string, supportedLocales: readonly string[], tiebreakerLocalesByLanguageCode: Readonly<Record<string, readonly string[]>> }>} manifestLocaleConfiguration
 * @property {import("../core/index.js").CatalogIdentity} catalogIdentity
 * @property {string} cldrVersion
 * @property {string} dataFingerprint
 * @property {StringsLoadingLimits} loadingLimits
 * @property {import("../core/index.js").StringsLoadCoverage} coverage
 * @property {readonly FetchEntry[]} requestedFiles
 * @property {readonly LoadFailure[]} failures
 * @property {readonly LocalizedStringWarning[]} warnings
 * @property {boolean} complete
 */

export { computeCatalogIdentity } from "./identity.js";
export { chain, fetchSet } from "./planning.js";
/**
 * `DigestUnavailableError` IS EXPORTED BECAUSE THE PLAN ALREADY DECLARED IT, not because this widens
 * anything. Plan 3.5:1099 lists `const DigestUnavailableError: CatchOnlyErrorClass<DigestUnavailableError>`
 * among nine package exports, and :1107 says those runtime values "are public for catching and
 * `instanceof`" while their declarations "expose no constructor or extension signature" — which is
 * exactly the shape S22 gave this class. Plan 3.1's `load` row permits it under the "loading errors"
 * category that `LocalizedStringLoadingError` already sits in. M8 clause 75 was recorded as blocked on a
 * maintainer decision to widen the surface; there was no widening to decide.
 */
export { DigestUnavailableError, LocalizedStringLoadingError, loadEntireManifest, loadStrings } from "./fetch-loader.js";
export {
  localeConfigurationForManifest,
  parseStringsManifest,
  validateStringsManifest,
} from "./manifest.js";

export {};
