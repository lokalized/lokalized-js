import { LOKALIZED_ERROR_TOKEN, LokalizedError } from "../internal/lokalized-error.js";

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
 * **IT IS A REAL CLASS AS OF S34, and the docblock above had already designed for the swap** — "the
 * public catch-only hierarchy is core's to land; this carries the eventual `code` already, so that
 * swap stays invisible to a consumer who checks it". It was a plain `Error` with `name` and `code`
 * assigned afterwards, so **119 call sites across `src/` produced a failure no `instanceof` could
 * recognise** — a consumer could only match it by string. That is the THIRD instance of exactly the
 * shape S22 fixed for `StringsLoadingError` and `DigestUnavailableError`, and the largest: it reaches
 * a caller from `core`, `load`, `ssr` and `node` alike.
 *
 * Plan 3.5:1100 declares it a package export, `const ConfigurationError:
 * CatchOnlyErrorClass<ConfigurationError>`, and :1107-1108 requires the runtime constructor to take
 * an unexported token so "plain-JavaScript direct construction and subclass instantiation fail
 * rather than creating partially initialized library errors". The FACTORY is what keeps the token
 * private while 119 sites raise one, the same arrangement `loadingError` and `parseError` use.
 *
 * `name` and `code` are unchanged, so the fourteen places that match on the string keep working —
 * measured before the change, and that is the whole point of the docblock's promise.
 */
  // Extends `LokalizedError` as of S35, so one `instanceof` answers "did this come from
  // lokalized" — plan 3.5:1039-1042 and :1092. The token travels up; it never leaves the package.
export class ConfigurationError extends LokalizedError {
  /**
   * **PRIVATE, WHICH IS HOW THE DECLARATION STOPS EXPOSING A CONSTRUCTOR.** Plan 3.5:1107-1108
   * requires the runtime constructor to take an unexported token AND the declaration to "expose no
   * constructor or extension signature". The token was there; the declaration was not — `tsc`
   * emitted `constructor(token: symbol, …)` for all five error classes, so a consumer's TypeScript
   * saw a constructible-looking class. `@private` emits `private constructor();`, which TypeScript
   * refuses to `new` AND refuses to extend: exactly the two properties the plan names. The static
   * raiser below is what lets the module's own factory still build one, since a private constructor
   * is callable only from inside the class body.
   *
   * @private @param {symbol} token the internal construction token @param {string} message */
  constructor(token, message) {
    if (token !== CONFIGURATION_ERROR_TOKEN)
      throw new TypeError("ConfigurationError is not constructible; it is thrown by lokalized");

    super(LOKALIZED_ERROR_TOKEN, message);
    /** @type {"ConfigurationError"} */
    this.name = "ConfigurationError";
    /** @type {"CONFIGURATION"} */
    this.code = "CONFIGURATION";
  }

  /**
   * The one construction path, because the constructor above is private. Its parameters are the
   * constructor's, so the module's own factory keeps its types; a consumer cannot reach it, because
   * the token it takes first is never exported from this package.
   *
   * @param {symbol} token @param {string} message
   */
  static raise(token, message) {
    return new ConfigurationError(token, message);
  }
}

/** Unexported by design: only this package can hand it to the constructor. */
const CONFIGURATION_ERROR_TOKEN = Symbol("lokalized.ConfigurationError");

/**
 * @param {string} message
 * @returns {ConfigurationError}
 */
export function configurationError(message) {
  return ConfigurationError.raise(CONFIGURATION_ERROR_TOKEN, message);
}
