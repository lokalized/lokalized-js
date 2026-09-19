import { LOKALIZED_ERROR_TOKEN, LokalizedError } from "./lokalized-error.js";

// @ts-check

/**
 * Internal: the declared error type of `lokalized/parse`.
 *
 * The JS counterpart of `com.lokalized.LocalizedStringLoadingException`, and the only place in the
 * package that turns one into the other. It is a TYPE, not a message factory: every message it
 * carries is composed by the code that detected the failure — `catalog.js` for structure,
 * `json-parse.js` for syntax, this subpath for expressions and warnings — because Java composes them
 * there too, and duplicating the wording here would give the same failure two spellings that drift.
 *
 * `MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS`, `boundedJsonPath` and `boundedDiagnosticValue` live in
 * `json-parse.js` alongside the reader that builds the paths; nothing is re-implemented here.
 */

/**
 * A parse failure, carrying the source it came from and — when the failure is lexical — where.
 *
 * Plan section 3.4 makes this catch-only: consumers may `catch` it and test `instanceof`, but
 * constructing one is a library-internal act, so the constructor demands a module-private token no
 * consumer can obtain. That is stricter than a documented convention and cheaper than a
 * factory-only export, because it also refuses `class Mine extends StringsParseError` at
 * instantiation time rather than merely discouraging it.
 */
  // Extends `LokalizedError` as of S35, so one `instanceof` answers "did this come from
  // lokalized" — plan 3.5:1039-1042 and :1092. The token travels up; it never leaves the package.
export class StringsParseError extends LokalizedError {
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
   * @private
   * @param {symbol} token the internal construction token
   * @param {string} message
   * @param {{ source: string, line?: number | null, column?: number | null, path?: string | null, cause?: unknown }} details
   */
  constructor(token, message, details) {
    if (token !== CONSTRUCTION_TOKEN)
      throw new TypeError("StringsParseError is not constructible; it is thrown by lokalized/parse");

    super(LOKALIZED_ERROR_TOKEN, "STRINGS_PARSE", message,
      details.cause === undefined ? undefined : { cause: details.cause });

    /** @type {"StringsParseError"} */
    this.name = "StringsParseError";
    // BOOT-M0-0527 through BOOT-M0-0530 declare all four `readonly`, and `@readonly` is what emits
    // the modifier from a JSDoc class field. They are set once here and never again; before this the
    // declaration let a consumer rewrite the location of a diagnostic they had been handed.
    /** The caller-supplied label every diagnostic is prefixed with. @type {string} @readonly */
    this.source = details.source;
    /** One-based, or null when the failure is not lexical. @type {number | null} @readonly */
    this.line = details.line ?? null;
    /** One-based, or null when the failure is not lexical. @type {number | null} @readonly */
    this.column = details.column ?? null;
    /** The bounded JSON path, or null when the failure is not located in the document. @type {string | null} @readonly */
    this.path = details.path ?? null;
  }

  /**
   * The one construction path, because the constructor above is private. Its parameters are the
   * constructor's, so the module's own factory keeps its types; a consumer cannot reach it, because
   * the token it takes first is never exported from this package.
   *
   * @param {symbol} token @param {string} message
   * @param {Parameters<typeof parseError>[1] & { cause?: unknown }} details
   */
  static raise(token, message, details) {
    return new StringsParseError(token, message, details);
  }
}

/** Unexported by design: only this package can hand it to the constructor. */
const CONSTRUCTION_TOKEN = Symbol("lokalized.strings-parse-error");

/**
 * @param {string} message
 * @param {{ source: string, line?: number | null, column?: number | null, path?: string | null, cause?: unknown }} details
 * @returns {StringsParseError}
 */
export function parseError(message, details) {
  return StringsParseError.raise(CONSTRUCTION_TOKEN, message, details);
}

/**
 * Re-raise whatever the bounded reader or the structural validator threw as the declared type.
 *
 * Both compose Java's wording already, including the `<source>: ` prefix, so the message passes
 * through untouched and the original becomes `cause`. `line`, `column` and `path` are read as
 * OPTIONAL structured fields the thrower may have attached; a failure that is not located in the
 * document simply has none. `test/parse.test.js` pins the located case, so the fields cannot quietly
 * stop arriving.
 *
 * @param {unknown} error
 * @param {string} source
 * @returns {never}
 */
export function rethrowAsParseError(error, source) {
  if (error instanceof StringsParseError) throw error;
  if (!(error instanceof Error)) throw parseError(String(error), { source, cause: error });

  const located = /** @type {{ line?: unknown, column?: unknown, path?: unknown }} */ (
    /** @type {unknown} */ (error)
  );

  throw parseError(error.message, {
    source,
    cause: error,
    line: typeof located.line === "number" ? located.line : null,
    column: typeof located.column === "number" ? located.column : null,
    path: typeof located.path === "string" ? located.path : null,
  });
}
