// @ts-check

/**
 * Internal: the bounded, duplicate-aware JSON reader for localized strings resources.
 *
 * Port of `LocalizedStringLoader.readStrictUtf8`, `normalizeLocalizedStringsFileContents`,
 * `isJsonWhitespaceOnly` and `validateJsonNestingDepth`, plus the parts of the vendored
 * `MinimalJson` reader whose behaviour is observable through the loader: the accepted grammar, the
 * surrogate-pairing rule, and the line/column of the first syntax error.
 *
 * WHY A DEDICATED PARSER RATHER THAN A LEXICAL PREPASS OVER `JSON.parse`. Plan v7 4.2 asks for the
 * choice to be made on measured simplicity/size, so both were written to the same contract and run
 * against the corpus. They agree exactly — each reproduces Java's answer for 97 of the 118 `parse`
 * cases, the other 21 needing capabilities above this layer (expression compilation, warnings):
 *
 *                                          code lines   corpus docs   1.3MB catalog
 *   B  dedicated bounded parser (this)            254         54.8ms         162.0ms
 *   A  lexical prepass + `JSON.parse`             265         75.0ms         186.0ms
 *
 * Code lines exclude comments and blanks, and count only the part that differs — an identical
 * 88-line prologue (byte/character boundaries, BOM/blank handling, the nesting prepass, bounded
 * paths) is shared. Timings are the best of five runs, over the corpus's 1,917 parseable documents
 * and over a generated 1.3MB catalog.
 *
 * The prepass is not smaller because it cannot be a lexer: duplicate reporting needs the JSON PATH
 * of every member and Java's diagnostics need the FIRST syntax error's line and column, so it has to
 * walk the grammar with a container stack anyway. It is this parser with the value construction
 * removed, plus what `JSON.parse` then forces back on: the text span of every root member (a
 * duplicated root key's FIRST value must survive, and `JSON.parse` keeps the last), and a full
 * rebuild of the tree as null-prototype records, which `JSON.parse`'s reviver cannot do for the
 * root. It is also less faithful — it inherits `JSON.parse`'s acceptance of lone surrogate escapes,
 * which the prepass must then re-reject — and it holds two copies of the document at once.
 * Last-write-wins duplicates were never on the table.
 *
 * `TextDecoder` is used for the fatal UTF-8 decode. It is a WHATWG global, not a Node built-in, so
 * it is available unchanged in browsers and edge runtimes — `test/package-shape.test.js` only
 * forbids `node:` imports, and this file has none.
 */

/** `LocalizedStringLoader.MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS`. */
export const MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS = 4096;

/**
 * `MinimalJson.JsonParser.MAX_NESTING_LEVEL`, the reader's backstop against unbounded recursion. The
 * loader's nesting prepass refuses anything past 128 long before this can fire; it is kept for
 * callers that reach the reader directly.
 */
const MAXIMUM_PARSER_NESTING_LEVEL = 1000;

/** The chunk size `readStrictUtf8` reads with, which decides WHICH byte limit reports first. */
const INPUT_CHUNK_BYTES = 8192;

const UTF_8_BOM = "﻿";

/**
 * `LocalizedStringLoader.appendBoundedPathPart`.
 *
 * @param {string} path
 * @param {string} part
 * @returns {string}
 */
export function appendBoundedPathPart(path, part) {
  const remaining = MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS - path.length;

  if (remaining <= 0) return path;
  if (part.length <= remaining) return path + part;

  return `${path}${remaining > 1 ? part.slice(0, remaining - 1) : ""}…`;
}

/**
 * `LocalizedStringLoader.boundedJsonPath` — a JSON pointer-ish diagnostic path capped at 4096
 * UTF-16 units with a trailing ellipsis, exactly as Java caps it.
 *
 * @param {string} parentPath
 * @param {string} prefix
 * @param {string} component
 * @param {string} suffix
 * @returns {string}
 */
export function boundedJsonPath(parentPath, prefix, component, suffix) {
  if (parentPath.length >= MAXIMUM_JSON_DIAGNOSTIC_PATH_CHARACTERS) return parentPath;

  let path = appendBoundedPathPart("", parentPath);
  path = appendBoundedPathPart(path, prefix);
  path = appendBoundedPathPart(path, component);
  return appendBoundedPathPart(path, suffix);
}

/**
 * `LocalizedStringLoader.boundedDiagnosticValue` — a catalog-controlled string quoted into a
 * diagnostic is capped at 256 UTF-16 units so a hostile member name cannot dominate the message.
 *
 * @param {string} value
 * @returns {string}
 */
export function boundedDiagnosticValue(value) {
  return value.length <= 256 ? value : `${value.slice(0, 255)}…`;
}

/**
 * A duplicate JSON object member, recorded rather than thrown.
 *
 * Java detects duplicates in a walk that runs per ROOT MEMBER, interleaved with the structural parse
 * of the members before it (`parseLocalizedStrings`), so "the first duplicate in the file" is not
 * always the failure Java reports: a structural error under an earlier root key wins. Recording the
 * finding with the root member it belongs to lets the catalog parser reproduce that interleaving
 * without a second traversal.
 *
 * @typedef {object} DuplicateMember
 * @property {string} name the duplicated member name, unbounded; bound it for diagnostics
 * @property {string} path the bounded JSON path of the object that holds it
 * @property {number} rootIndex index of the root member whose subtree contains it
 */

/**
 * DUPLICATE DETECTION IS SPLIT ACROSS TWO LAYERS, AND THE SPLIT IS JAVA'S, NOT AN ACCIDENT.
 *
 * `parseLocalizedStrings` rejects a repeated ROOT key itself — "duplicate localized string key
 * '<key>' encountered", with no path — and only then hands that key's VALUE to
 * `validateNoDuplicateObjectMembers`, which reports anything below it as "duplicate JSON object
 * member '<name>' encountered at <path>". Two different messages raised at two different points of
 * one interleaved loop, so they cannot come from one place.
 *
 * This reader therefore records duplicates BELOW the root and says nothing about the root's own,
 * which `parseCatalogMembers` in `catalog.js` rejects. `duplicates` is EMPTY for a document whose
 * only repeat is a root key: that is the contract, not a miss. `test/json-parse.test.js` pins both
 * halves, and pins the absence of the root half from here.
 *
 * @typedef {object} JsonDocument
 * @property {unknown} value the decoded document; objects are null-prototype records, last-wins
 * @property {[string, unknown][] | null} members the root object's members IN ORDER, duplicates
 *   included and each carrying its own value — null when the document is not an object
 * @property {DuplicateMember[]} duplicates AT MOST ONE finding: the first duplicate member BELOW
 *   the root, in document order. Empty when the document has none — see `JsonReader.duplicates` for
 *   why one is both sufficient and the only bounded choice
 */

/**
 * `LocalizedStringLoader.readStrictUtf8` — the per-resource and aggregate BYTE boundaries, then a
 * fatal UTF-8 decode.
 *
 * The boundaries are checked against the byte view BEFORE any string is allocated, and in Java's
 * order, which is observable: the aggregate limit is charged in 8KiB chunks WHILE the resource is
 * being read, so a resource that busts both reports the aggregate first, while the per-resource
 * limit is only decided once reading stops (at one byte past the limit, which is why a resource
 * exactly at the limit still loads).
 *
 * @param {Uint8Array} bytes
 * @param {string} source
 * @param {number} maximumInputBytes
 * @param {(count: number, source: string) => void} [addInputBytes] aggregate accounting
 * @returns {string}
 */
export function readStrictUtf8(bytes, source, maximumInputBytes, addInputBytes) {
  const readable = Math.min(bytes.length, maximumInputBytes + 1);
  const chunk = Math.min(maximumInputBytes + 1, INPUT_CHUNK_BYTES);

  if (addInputBytes) for (let read = 0; read < readable; read += chunk)
    addInputBytes(Math.min(chunk, readable - read), source);

  if (bytes.length > maximumInputBytes)
    throw new Error(
      `${source}: localized strings resource exceeds the maximum size of ${maximumInputBytes} bytes`,
    );

  try {
    // `ignoreBOM: true` keeps a leading U+FEFF in the decoded text instead of silently eating it,
    // because Java strips EXACTLY ONE below. Letting the decoder eat one and stripping another
    // would accept a two-BOM file that Java rejects as malformed JSON.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${source}: localized strings resource is not valid UTF-8`);
  }
}

/**
 * `LocalizedStringLoader.readCharacters` — the character boundary for text input, checked against
 * the input's length before it is copied anywhere.
 *
 * @param {string} text
 * @param {string} source
 * @param {number} maximumReaderCharacters
 * @returns {string}
 */
export function readCharacters(text, source, maximumReaderCharacters) {
  if (text.length > maximumReaderCharacters)
    throw new Error(
      `${source}: localized strings resource exceeds the maximum size of ` +
        `${maximumReaderCharacters} characters`,
    );

  return text;
}

/**
 * `LocalizedStringLoader.normalizeLocalizedStringsFileContents` plus `isJsonWhitespaceOnly`.
 *
 * At most ONE leading BOM is removed, and the blank test runs after that removal, so a BOM-only
 * resource is blank while a two-BOM resource is malformed JSON. Java's JSON whitespace set is space,
 * tab, LF and CR only: U+00A0 is not blank, it is a syntax error at 1:1.
 *
 * @param {string} text
 * @param {string} source
 * @returns {string}
 */
export function normalizeCatalogText(text, source) {
  const normalized = text.startsWith(UTF_8_BOM) ? text.slice(1) : text;

  for (let i = 0; i < normalized.length; i++) {
    const character = normalized[i];

    if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r")
      return normalized;
  }

  throw new Error(
    `${source}: a localized strings file may not be blank; use an empty JSON object ({}) for an empty file`,
  );
}

/**
 * `LocalizedStringLoader.validateJsonNestingDepth`.
 *
 * A character prepass over the raw text, deliberately kept separate from the parse: it counts every
 * `{`/`[` outside a string in the whole document, so a resource that is BOTH too deep and
 * syntactically broken reports the depth, which is what Java reports. Nothing is materialized.
 *
 * @param {string} json
 * @param {string} source
 * @param {number} maximumJsonNestingDepth
 * @returns {void}
 */
export function validateJsonNestingDepth(json, source, maximumJsonNestingDepth) {
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const character = json[i];

    if (insideString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') insideString = false;

      continue;
    }

    if (character === '"') insideString = true;
    else if (character === "{" || character === "[") {
      ++depth;

      if (depth > maximumJsonNestingDepth)
        throw new Error(
          `${source}: JSON nesting depth exceeds the maximum of ${maximumJsonNestingDepth}`,
        );
    } else if (character === "}" || character === "]") --depth;
  }
}

/** Character codes the reader switches on. */
const QUOTE = 0x22;
const COMMA = 0x2c;
const MINUS = 0x2d;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const EOF = -1;

/**
 * The reader. One pass: it validates the grammar, tracks Java's line/column, builds null-prototype
 * values, and records duplicate member names with the JSON path that reaches them.
 *
 * Every failure carries the loader's message, whose only variable part is the location, because the
 * loader discards MinimalJson's own text: `<source>:<line>:<column>: unable to parse localized
 * strings file`.
 */
class JsonReader {
  /**
   * @param {string} text
   * @param {string} source
   */
  constructor(text, source) {
    this.text = text;
    this.source = source;
    /** Offset of the current character; `text.length` once past the end. */
    this.position = -1;
    /** The current character code, or `EOF`. Starts non-EOF so the first read advances to 0. */
    this.current = 0;
    this.line = 1;
    this.lineOffset = 0;
    this.previousCarriageReturn = false;
    this.nestingLevel = 0;
    /** Index of the root member whose subtree is being read. */
    this.rootIndex = -1;
    /**
     * AT MOST ONE finding, and the cap is a bounded-work requirement rather than a tidy-up.
     *
     * Only `duplicates[0]` can ever be the failure Java reports: findings are produced in document
     * order, the catalog parser stops at the first root member carrying one, and every later finding
     * lies under a member that loop never reaches. Retaining the rest bought nothing and cost a fresh
     * `path()` materialization — up to 4096 UTF-16 units, rebuilt from the whole container stack —
     * for EVERY repeated member name in the document. A 590 KB file holding 100,000 repetitions of
     * one name at depth 63 allocated 384 MB and took 172 ms before this cap; after it, 4.7 MB and
     * 7.5 ms, with the identical diagnostic. `test/json-parse.test.js` pins the cap.
     *
     * @type {DuplicateMember[]}
     */
    this.duplicates = [];
    /** The JSON path to the container being read, as parallel prefix/component/suffix stacks. */
    /** @type {string[]} */
    this.pathPrefixes = [];
    /** @type {string[]} */
    this.pathComponents = [];
    /** @type {string[]} */
    this.pathSuffixes = [];

    this.read();
  }

  /**
   * `MinimalJson.JsonParser.read` and `updateLineState`: the line advances on the character AFTER
   * the break, and CRLF counts once.
   *
   * @returns {void}
   */
  read() {
    if (this.current === EOF) return;

    const next = this.position + 1;

    if (this.current === 0x0d) {
      ++this.line;
      this.lineOffset = next;
      this.previousCarriageReturn = true;
    } else if (this.current === 0x0a) {
      if (!this.previousCarriageReturn) ++this.line;
      this.lineOffset = next;
      this.previousCarriageReturn = false;
    } else {
      this.previousCarriageReturn = false;
    }

    this.position = next;
    this.current = next < this.text.length ? this.text.charCodeAt(next) : EOF;
  }

  /** `MinimalJson.JsonParser.getLocation`, as the loader's diagnostic prefix. @returns {string} */
  location() {
    return `${this.line}:${this.position - this.lineOffset + 1}`;
  }

  /**
   * The location is also attached as STRUCTURED FIELDS, not only interpolated into the message:
   * `lokalized/parse` publishes `StringsParseError.line` / `.column` (plan 3.4), and a consumer that
   * wants to point an editor at the offending character should not have to re-parse English.
   * `test/parse.test.js` pins both against this message.
   *
   * @param {string} [location] a location captured earlier, for a deferred surrogate failure
   * @returns {Error}
   */
  syntaxError(location) {
    const at = location ?? this.location();
    const [line, column] = at.split(":");
    const error = new Error(`${this.source}:${at}: unable to parse localized strings file`);
    return Object.assign(error, { line: Number(line), column: Number(column) });
  }

  /** @param {number} code @returns {boolean} */
  readChar(code) {
    if (this.current !== code) return false;

    this.read();
    return true;
  }

  /** @returns {void} */
  skipWhiteSpace() {
    while (this.current === 0x20 || this.current === 0x09 || this.current === 0x0a || this.current === 0x0d)
      this.read();
  }

  /**
   * @param {string} prefix
   * @param {string} component
   * @param {string} suffix
   * @returns {void}
   */
  pushPath(prefix, component, suffix) {
    this.pathPrefixes.push(prefix);
    this.pathComponents.push(component);
    this.pathSuffixes.push(suffix);
  }

  /** @returns {void} */
  popPath() {
    this.pathPrefixes.pop();
    this.pathComponents.pop();
    this.pathSuffixes.pop();
  }

  /**
   * The bounded path of the container being read, materialized only when a duplicate is found:
   * the stacks hold primitives and cost nothing to maintain, a path string per container would not.
   *
   * @returns {string}
   */
  path() {
    let path = "$";

    for (let i = 0; i < this.pathComponents.length; i++)
      path = boundedJsonPath(
        path,
        /** @type {string} */ (this.pathPrefixes[i]),
        /** @type {string} */ (this.pathComponents[i]),
        /** @type {string} */ (this.pathSuffixes[i]),
      );

    return path;
  }

  /**
   * The whole document: one value, then end of input.
   *
   * @returns {JsonDocument}
   */
  readDocument() {
    this.skipWhiteSpace();

    /** @type {[string, unknown][] | null} */
    let members = null;
    /** @type {unknown} */
    let value;

    if (this.current === OPEN_BRACE) {
      members = [];
      value = this.readObject(members);
    } else {
      value = this.readValue();
    }

    this.skipWhiteSpace();

    if (this.current !== EOF) throw this.syntaxError();

    return { value, members, duplicates: this.duplicates };
  }

  /** @returns {unknown} */
  readValue() {
    switch (this.current) {
      case 0x6e: return this.readLiteral("null", null);
      case 0x74: return this.readLiteral("true", true);
      case 0x66: return this.readLiteral("false", false);
      case QUOTE: return this.readString();
      case OPEN_BRACKET: return this.readArray();
      case OPEN_BRACE: return this.readObject(null);
      default:
        if (this.current === MINUS || (this.current >= ZERO && this.current <= NINE))
          return this.readNumber();

        throw this.syntaxError();
    }
  }

  /**
   * @param {string} literal
   * @param {null | boolean} value
   * @returns {null | boolean}
   */
  readLiteral(literal, value) {
    this.read();

    for (let i = 1; i < literal.length; i++)
      if (!this.readChar(literal.charCodeAt(i))) throw this.syntaxError();

    return value;
  }

  /** @returns {number} */
  readNumber() {
    const start = this.position;

    this.readChar(MINUS);

    const firstDigit = this.current;

    if (!this.readDigit()) throw this.syntaxError();
    // A leading zero ends the integer part: `01` is two tokens to Java, and the second one is the
    // syntax error its caller reports.
    if (firstDigit !== ZERO) while (this.readDigit());

    if (this.readChar(0x2e)) {
      if (!this.readDigit()) throw this.syntaxError();
      while (this.readDigit());
    }

    if (this.readChar(0x65) || this.readChar(0x45)) {
      if (!this.readChar(0x2b)) this.readChar(MINUS);
      if (!this.readDigit()) throw this.syntaxError();
      while (this.readDigit());
    }

    return Number(this.text.slice(start, this.position));
  }

  /** @returns {boolean} */
  readDigit() {
    if (this.current < ZERO || this.current > NINE) return false;

    this.read();
    return true;
  }

  /** @returns {string} */
  readString() {
    this.read();

    let value = "";
    let chunkStart = this.position;
    /** @type {string | null} */
    let pendingHighSurrogate = null;

    while (this.current !== QUOTE) {
      if (this.current === BACKSLASH) {
        const escapeLocation = this.location();

        value += this.text.slice(chunkStart, this.position);

        const escaped = this.readEscape();

        pendingHighSurrogate = this.validateStringCharacter(escaped, escapeLocation, pendingHighSurrogate);
        value += String.fromCharCode(escaped);
        chunkStart = this.position;
      } else if (this.current < 0x20) {
        // Also the end-of-input case: `EOF` is -1, so a truncated string fails here.
        throw this.syntaxError();
      } else {
        pendingHighSurrogate = this.validateStringCharacter(
          this.current,
          this.location(),
          pendingHighSurrogate,
        );
        this.read();
      }
    }

    if (pendingHighSurrogate !== null) throw this.syntaxError(pendingHighSurrogate);

    value += this.text.slice(chunkStart, this.position);
    this.read();
    return value;
  }

  /** @returns {number} the escaped character's code */
  readEscape() {
    this.read();

    /** @type {number} */
    let escaped;

    switch (this.current) {
      case QUOTE: case 0x2f: case BACKSLASH: escaped = this.current; break;
      case 0x62: escaped = 0x08; break;
      case 0x66: escaped = 0x0c; break;
      case 0x6e: escaped = 0x0a; break;
      case 0x72: escaped = 0x0d; break;
      case 0x74: escaped = 0x09; break;
      case 0x75: {
        escaped = 0;

        for (let i = 0; i < 4; i++) {
          this.read();

          const digit = this.hexDigit();

          if (digit < 0) throw this.syntaxError();

          escaped = escaped * 16 + digit;
        }

        break;
      }
      default: throw this.syntaxError();
    }

    this.read();
    return escaped;
  }

  /** @returns {number} the current character's hex value, or -1 */
  hexDigit() {
    const code = this.current;

    if (code >= ZERO && code <= NINE) return code - ZERO;
    if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
    if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;

    return -1;
  }

  /**
   * `MinimalJson.JsonParser.validateStringCharacter`. A lone surrogate — escaped or literal — is
   * valid JSON syntax and invalid Unicode, and Java rejects it at the position of the character
   * that opened the pair.
   *
   * @param {number} code
   * @param {string} location
   * @param {string | null} pendingHighSurrogate
   * @returns {string | null} the pending high surrogate's location, if one is now open
   */
  validateStringCharacter(code, location, pendingHighSurrogate) {
    const isLow = code >= 0xdc00 && code <= 0xdfff;

    if (pendingHighSurrogate !== null) {
      if (isLow) return null;

      throw this.syntaxError(pendingHighSurrogate);
    }

    if (isLow) throw this.syntaxError(location);

    return code >= 0xd800 && code <= 0xdbff ? location : null;
  }

  /** @returns {unknown[]} */
  readArray() {
    this.read();

    if (++this.nestingLevel > MAXIMUM_PARSER_NESTING_LEVEL) throw this.syntaxError();

    /** @type {unknown[]} */
    const array = [];

    this.skipWhiteSpace();

    if (this.readChar(CLOSE_BRACKET)) {
      --this.nestingLevel;
      return array;
    }

    do {
      this.skipWhiteSpace();
      this.pushPath("[", String(array.length), "]");
      array.push(this.readValue());
      this.popPath();
      this.skipWhiteSpace();
    } while (this.readChar(COMMA));

    if (!this.readChar(CLOSE_BRACKET)) throw this.syntaxError();

    --this.nestingLevel;
    return array;
  }

  /**
   * @param {[string, unknown][] | null} members the ordered member sink, for the ROOT object only
   * @returns {Record<string, unknown>}
   */
  readObject(members) {
    this.read();

    if (++this.nestingLevel > MAXIMUM_PARSER_NESTING_LEVEL) throw this.syntaxError();

    // Null-prototype, so `__proto__`, `constructor` and `prototype` are ordinary members that
    // neither reach a prototype chain nor collide with an inherited property.
    /** @type {Record<string, unknown>} */
    const object = Object.create(null);

    this.skipWhiteSpace();

    if (this.readChar(CLOSE_BRACE)) {
      --this.nestingLevel;
      return object;
    }

    /** @type {Set<string>} */
    const names = new Set();

    do {
      this.skipWhiteSpace();

      if (this.current !== QUOTE) throw this.syntaxError();

      const name = this.readString();

      this.skipWhiteSpace();

      if (!this.readChar(COLON)) throw this.syntaxError();

      this.skipWhiteSpace();

      // Recorded BEFORE the member's value is read, so the finding is the FIRST in document order:
      // Java's walk reports the outer duplicate when a duplicated member's value holds one of its
      // own. Root duplicates are the catalog parser's business — they carry a different message and
      // a different position in Java's interleaving — so they are not recorded here. Only the first
      // finding is retained; the parse still runs to completion because a syntax error ANYWHERE in
      // the document precedes every duplicate in Java's order.
      if (names.has(name)) {
        if (members === null && this.duplicates.length === 0)
          this.duplicates.push({ name, path: this.path(), rootIndex: this.rootIndex });
      } else {
        names.add(name);
      }

      if (members !== null) this.rootIndex = members.length;

      this.pushPath(".", name, "");

      const value = this.readValue();

      this.popPath();

      object[name] = value;
      if (members !== null) members.push([name, value]);

      this.skipWhiteSpace();
    } while (this.readChar(COMMA));

    if (!this.readChar(CLOSE_BRACE)) throw this.syntaxError();

    --this.nestingLevel;
    return object;
  }
}

/**
 * Parse one localized strings document.
 *
 * Nothing here is `JSON.parse`: it keeps the last of duplicate members, materializes the whole
 * document before any limit could fire, accepts lone surrogate escapes, and reports positions that
 * are the engine's rather than Java's.
 *
 * @param {string} text the normalized resource text, BOM already removed
 * @param {string} source
 * @returns {JsonDocument}
 */
export function parseJsonDocument(text, source) {
  return new JsonReader(text, source).readDocument();
}
