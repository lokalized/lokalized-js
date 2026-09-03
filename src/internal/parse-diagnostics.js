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
export class StringsParseError extends Error {
  /**
   * @param {symbol} token the internal construction token
   * @param {string} message
   * @param {{ source: string, line?: number | null, column?: number | null, path?: string | null, cause?: unknown }} details
   */
  constructor(token, message, details) {
    if (token !== CONSTRUCTION_TOKEN)
      throw new TypeError("StringsParseError is not constructible; it is thrown by lokalized/parse");

    super(message, details.cause === undefined ? undefined : { cause: details.cause });

    /** @type {"StringsParseError"} */
    this.name = "StringsParseError";
    /** @type {"STRINGS_PARSE"} */
    this.code = "STRINGS_PARSE";
    /** The caller-supplied label every diagnostic is prefixed with. @type {string} */
    this.source = details.source;
    /** One-based, or null when the failure is not lexical. @type {number | null} */
    this.line = details.line ?? null;
    /** One-based, or null when the failure is not lexical. @type {number | null} */
    this.column = details.column ?? null;
    /** The bounded JSON path, or null when the failure is not located in the document. @type {string | null} */
    this.path = details.path ?? null;
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
  return new StringsParseError(CONSTRUCTION_TOKEN, message, details);
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
