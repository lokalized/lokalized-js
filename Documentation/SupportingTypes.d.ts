/**
 * Definitions used by the public signatures. This documentation group is not
 * a package import path; import public exports from the entry points instead.
 * @module Supporting types
 */
export type { BidiIsolation } from "../types/internal/bidi.js";
export type { Definition, LocalizedStringNodeInput, PlaceholderDefinition, ParseLimits,
  LanguageFormPlaceholder, ExpressionPlaceholder, Alternative, LanguageFormAxis,
  PlaceholderRange } from "../types/internal/catalog.js";
export type { LocaleMatchResult, WeightedLanguageRange } from "../types/internal/locale.js";
export type { LocalizedStringWarning } from "../types/internal/parse-warnings.js";
export type { LokalizedErrorCode } from "../types/internal/lokalized-error.js";
export type { Placeholders } from "../types/internal/interpolate.js";
export type { Operands } from "../types/internal/plural.js";
export type { DirectoryManifestOptions } from "../types/node/manifest-directory.js";
export type { LoadStringsFromDirectoryOptions, LoadStringsFromFilesOptions } from "../types/node/file-loader.js";
export type { ParsedStringsFile } from "../types/node/directory.js";
export type { CatalogIdentity } from "../types/load/identity.js";
export type { StringsManifestV1 } from "../types/load/manifest.js";
