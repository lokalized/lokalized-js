// @ts-check
/**
 * The library-owned failure for a configuration a caller supplied that cannot be honoured.
 *
 * EXTRACTED from `src/data/ordinal.js` when `lokalized/load` needed the same failure, because two
 * factories that must produce the SAME `name` and `code` are two dialects of one thing — and the one
 * that drifts is the one nobody is looking at. Plan 3.7 calls these construction-time
 * `ConfigurationError`s. The public catch-only hierarchy (`LokalizedError` and friends) is core's to
 * land; this carries the eventual `code` already, so that swap stays invisible to a consumer who
 * checks it.
 *
 * @param {string} message
 * @returns {Error}
 */
export function configurationError(message) {
  const error = /** @type {Error & { code: string }} */ (new Error(message));
  error.name = "ConfigurationError";
  error.code = "CONFIGURATION";
  return error;
}
