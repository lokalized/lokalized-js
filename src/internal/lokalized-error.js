// @ts-check
/**
 * Error codes reported by Lokalized.
 *
 * @typedef {"MISSING_TRANSLATION" | "UNSUPPORTED_LOCALE" | "EXPRESSION_EVALUATION"
 *   | "RESOLUTION_INVALID_ARGUMENT" | "RESOLUTION_INVALID_STATE" | "STRINGS_PARSE"
 *   | "STRINGS_LOADING" | "DIGEST_UNAVAILABLE" | "CONFIGURATION"} LokalizedErrorCode
 *   Every `code` a library error can carry. `ResolutionError` carries either `RESOLUTION_*` member:
 *   `RESOLUTION_INVALID_ARGUMENT` or `RESOLUTION_INVALID_STATE`.
 */

/** Unexported by design: only this package can hand it to a constructor. */
export const LOKALIZED_ERROR_TOKEN = Symbol("lokalized.LokalizedError");

/**
 * Base class for Lokalized errors. Use `instanceof LokalizedError` to recognize
 * library failures and inspect `code` to distinguish their causes.
 * Instances are created by the library.
 */
export class LokalizedError extends Error {
  /**
   * Library-owned constructor. Applications catch errors raised by Lokalized.
   *
   * @internal
   *
   * @protected
   * @param {symbol} token the internal construction token
   * @param {LokalizedErrorCode} code the subclass's own code, supplied at `super(...)`
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(token, code, message, options) {
    if (token !== LOKALIZED_ERROR_TOKEN)
      throw new TypeError("LokalizedError is not constructible; it is thrown by lokalized");

    super(message, options);
    /** @type {LokalizedErrorCode} @readonly */
    this.code = code;
  }
}
