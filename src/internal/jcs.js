// @ts-check
/**
 * RFC 8785 JSON Canonicalization, for the BOUNDED value classes this port actually canonicalizes.
 *
 * WHY BOUNDED, AND WHY IT REFUSES. Plan section 5.1 requires "RFC 8785 JCS exactly", and the honest
 * way to deliver a subset of "exactly" is to REFUSE what is outside it rather than to serialize it
 * approximately. A canonicalizer that silently mis-spells a value produces a fingerprint that is
 * stable, plausible and wrong — and because the fingerprint is compared only against ITSELF across
 * hosts, nothing downstream would ever notice. So every value class below is either implemented to
 * the letter or rejected by name.
 *
 * WHAT IS IMPLEMENTED, and where each rule comes from:
 *
 *   - PROPERTY ORDER (§3.2.3): keys sorted by their UTF-16 code units. JavaScript's default string
 *     comparison IS UTF-16 code-unit order, so a bare `sort()` is correct here. That is worth saying
 *     out loud because the same default is WRONG one directory over: `tools/load-diff` must sort
 *     filenames by UTF-8 bytes, where a name starting U+10000 orders before one starting U+FFFD and
 *     the JavaScript default puts them the other way round. Same operation, opposite answer, because
 *     JCS specifies UTF-16 and a filesystem does not.
 *   - STRINGS (§3.2.2.2): the minimal escape set — `\b \t \n \f \r \" \\`, `\u00xx` for other
 *     controls, and every other character literal, non-ASCII included. `JSON.stringify` implements
 *     exactly that set, so it is used rather than reimplemented; what it does NOT do is reject lone
 *     surrogates, which RFC 8785 requires, so those are refused before it is called.
 *   - NUMBERS (§3.2.2.3): only SAFE INTEGERS are accepted, and `String(n)` is their JCS spelling.
 *     Non-integers are refused. RFC 8785 defers to ECMAScript's `Number::toString` for them, which
 *     JavaScript would give for free — but "for free" is not "audited", the plan restricts schema
 *     numbers to JCS-safe values anyway, and nothing this port canonicalizes has a fractional value.
 *
 * WHAT IS REFUSED: non-integer and non-finite numbers, `undefined`, functions and symbols, `null`
 * (nothing in the projections needs it, so accepting it would be untested surface), non-plain
 * objects, arrays with holes, and lone surrogates in any string or key.
 */

const OWN = Object.prototype.hasOwnProperty;

/** @param {string} text @param {string} where */
function requireWellFormed(text, where) {
  // A lone surrogate has no UTF-8 encoding, so RFC 8785 has no bytes to canonicalize. `isWellFormed`
  // is ES2024; the manual scan keeps this module free of a runtime floor the rest of the port does
  // not impose.
  for (let i = 0; i < text.length; ++i) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff)
        throw new TypeError(`${where} contains a lone surrogate and has no canonical form`);
      ++i;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${where} contains a lone surrogate and has no canonical form`);
    }
  }
}

/** @param {unknown} value @param {string} where @returns {string} */
function serialize(value, where) {
  if (typeof value === "string") {
    requireWellFormed(value, where);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new TypeError(
        `${where} is ${String(value)}; this canonicalizer accepts only safe integers, so that no ` +
        `number is spelled by a rule it has not audited`,
      );
    return String(value);
  }
  if (Array.isArray(value))
    return `[${value.map((element, index) => serialize(element, `${where}[${index}]`)).join(",")}]`;

  if (value === null || typeof value !== "object")
    throw new TypeError(`${where} is ${value === null ? "null" : typeof value}, which this canonicalizer refuses`);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${where} is not a plain object, so its members are not a canonical set`);

  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record).filter((key) => OWN.call(record, key));
  for (const key of keys) requireWellFormed(key, `${where}: the property name ${JSON.stringify(key)}`);
  // §3.2.3 — UTF-16 code-unit order, which is JavaScript's default string comparison.
  keys.sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], `${where}.${key}`)}`).join(",")}}`;
}

/**
 * The exact canonical UTF-8 bytes of a value, per RFC 8785, with no BOM and no trailing newline.
 *
 * @param {unknown} value
 * @param {string} [label] what to call the value in a refusal message
 * @returns {Uint8Array}
 */
export function canonicalBytes(value, label = "the value") {
  return new TextEncoder().encode(serialize(value, label));
}

/**
 * The canonical text, for tests and diagnostics that want to SEE the bytes rather than hash them.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @returns {string}
 */
export function canonicalText(value, label = "the value") {
  return serialize(value, label);
}
