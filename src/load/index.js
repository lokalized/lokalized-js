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
 * A catalog set's identity, independent of where it was served from.
 *
 * Plan section 2.2 (`interface CatalogIdentity`). The two fields are deliberately separate: the
 * VERSION is chosen by whoever publishes, while the FINGERPRINT is derived from the content, so a
 * republished-but-identical catalog keeps its fingerprint and a silently-changed one cannot.
 *
 * @typedef {object} CatalogIdentity
 * @property {string} catalogVersion
 * @property {string} catalogFingerprint
 */

/**
 * The manifest a browser or edge runtime loads from.
 *
 * Plan section 6.1 (`interface StringsManifestV1`). `formatVersion` is the literal `1` rather than a
 * number, so a future format cannot be mistaken for this one by a structural check.
 *
 * @typedef {object} StringsManifestV1
 * @property {1} formatVersion
 * @property {string} catalogVersion
 * @property {string} catalogFingerprint
 * @property {string} cldrVersion
 * @property {string} dataFingerprint
 * @property {string} fallbackLocale
 * @property {string} baseUrl
 * @property {Readonly<Record<string, Readonly<{ url: string, sha256: string, decodedBytes?: number }>>>} files
 *   Per locale: the URL, the full lowercase SHA-256 of the RESPONSE-BODY OCTETS (not of the decoded
 *   text — the digest is taken after any content coding and before decoding), and an optional
 *   expected decoded size.
 * @property {Readonly<Record<string, readonly string[]>>} tiebreakers
 */

/**
 * One file the loader intends to fetch, after planning.
 *
 * Plan section 6.1 (`interface FetchEntry`). `url` is the ABSOLUTE serialized URL — resolution
 * against the manifest's `baseUrl` happens during planning, so nothing downstream re-resolves it.
 *
 * @typedef {object} FetchEntry
 * @property {string} locale
 * @property {string} url
 * @property {string} sha256
 * @property {number} [expectedDecodedBytes]
 */

/**
 * The canonical projection a catalog fingerprint is computed over.
 *
 * Plan section 6.1 (`interface CatalogIdentityInputV1`). What it OMITS is the point, and slice S6
 * owes one negative test per omitted field: `baseUrl`, per-file `url` and `decodedBytes` are all
 * absent, so moving a catalog to a different host or re-encoding it does NOT change its identity,
 * while changing a locale's bytes does.
 *
 * @typedef {object} CatalogIdentityInputV1
 * @property {1} formatVersion
 * @property {string} catalogVersion
 * @property {string} resolvedFallbackLocale
 * @property {Readonly<Record<string, string>>} localeToSha256
 * @property {Readonly<Record<string, readonly string[]>>} tiebreakers
 */

/**
 * What a load was asked to cover.
 *
 * Plan section 2.2 (`type StringsLoadCoverage`). The `lookup` arm carries NORMALIZED planning input
 * and the plan states plainly that the tag NEED NOT OCCUR IN THE MANIFEST — a lookup locale is a
 * request, not a claim about what was published.
 *
 * @typedef {{ kind: "lookup", lookupLocale: string } | { kind: "entire-manifest" }} StringsLoadCoverage
 */

/**
 * One file that did not load.
 *
 * Plan section 6.2 (`interface LoadFailure`). The `stage` is a seven-member sequence rather than a
 * boolean because the partial-failure policy and the diagnostics both discriminate on WHERE it went
 * wrong; collapsing it would make "the digest did not match" indistinguishable from "the JSON was
 * malformed", which are different problems for whoever published the catalog.
 *
 * @typedef {object} LoadFailure
 * @property {string} locale
 * @property {string} url
 * @property {"fetch" | "read" | "limit" | "digest" | "decode" | "parse" | "validate"} stage
 * @property {unknown} cause
 */

/**
 * The result of a load, and the input `createStrings({ loaded })` accepts.
 *
 * Plan section 6.2 (`interface LoadedStrings`). It carries its own provenance — identity, CLDR
 * version, data fingerprint and the resolved limits — because `createStrings` REVALIDATES all of it
 * rather than trusting the caller; plan 8.3 names four fabricated-`LoadedStrings` fixtures that must
 * each be REJECTED with a `ConfigurationError` rather than downgraded.
 *
 * @typedef {object} LoadedStrings
 * @property {Readonly<Record<string, ParsedStringsFile>>} catalogs
 * @property {Readonly<Record<string, readonly string[]>>} tiebreakers
 * @property {string} fallbackLocale
 * @property {Readonly<{ fallbackLocale: string, supportedLocales: readonly string[], tiebreakers: Readonly<Record<string, readonly string[]>> }>} manifestLocaleConfiguration
 * @property {CatalogIdentity} catalogIdentity
 * @property {string} cldrVersion
 * @property {string} dataFingerprint
 * @property {StringsLoadingLimits} loadingLimits
 * @property {StringsLoadCoverage} coverage
 * @property {readonly FetchEntry[]} requestedFiles
 * @property {readonly LoadFailure[]} failures
 * @property {readonly LocalizedStringWarning[]} warnings
 * @property {boolean} complete
 */

export { computeCatalogIdentity } from "./identity.js";
export { chain, fetchSet } from "./planning.js";
export { StringsLoadingError, loadEntireManifest, loadStrings } from "./fetch-loader.js";
export {
  localeConfigurationForManifest,
  parseStringsManifest,
  validateStringsManifest,
} from "./manifest.js";

export {};
