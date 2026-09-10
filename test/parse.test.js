// @ts-check

/**
 * `lokalized/parse` — the diagnostic surface the M5a gate names.
 *
 * The corpus already proves the 118 `parse` cases match Java's messages exactly, so these tests are
 * deliberately NOT a second copy of it. They pin the four things the corpus cannot:
 *
 *   1. the STRUCTURED diagnostics — `source`, `line`, `column`, `path` — which Java has no
 *      counterpart for (its exception carries only text) and which the corpus therefore never
 *      records, so nothing else would notice them quietly becoming null;
 *   2. the BOUNDS on those diagnostics, which need inputs far larger than any fixture;
 *   3. `StringsParseError` being catch-only;
 *   4. the shape guarantees of the returned `ParsedStringsFile` — frozen, null-prototype, and
 *      `__proto__` as an ordinary translation key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { StringsParseError, parseStrings } from "../src/parse/index.js";
import { ordinalData } from "../src/data/ordinal.js";
import { createStrings } from "../src/core/index.js";

/** @param {() => unknown} run @returns {StringsParseError} */
function parseFailure(run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof StringsParseError, `expected a StringsParseError, got ${error}`);
    return error;
  }
  throw new assert.AssertionError({ message: "expected a StringsParseError, nothing was thrown" });
}

test("a lexical failure reports one-based line and column as fields, not only as text", () => {
  // `{"a":"\ud800"}` — valid JSON syntax, a lone high surrogate escape. The backslash is the
  // seventh character of the first line, and MinimalJson reports the position of the character it
  // was looking at, so 1:7.
  const single = parseFailure(() => parseStrings('{"a":"\\ud800"}', { locale: "en", source: "s" }));
  assert.equal(single.message, "s:1:7: unable to parse localized strings file");
  assert.equal(single.source, "s");
  assert.equal(single.line, 1);
  assert.equal(single.column, 7);
  assert.equal(single.code, "STRINGS_PARSE");

  // A second line, to prove the line counter is real and not a constant 1.
  const multiline = parseFailure(() => parseStrings('{\n  "a": tru\n}', { locale: "en", source: "s" }));
  assert.equal(multiline.message, "s:2:11: unable to parse localized strings file");
  assert.equal(multiline.line, 2);
  assert.equal(multiline.column, 11);
});

test("a CR-only line ending advances the line, and CRLF advances it once", () => {
  const carriageReturn = parseFailure(() => parseStrings('{\r  "a": tru\r}', { locale: "en", source: "s" }));
  assert.equal(carriageReturn.line, 2);

  const crlf = parseFailure(() => parseStrings('{\r\n  "a": tru\r\n}', { locale: "en", source: "s" }));
  assert.equal(crlf.line, 2, "CRLF is one line ending, not two");
});

test("a non-lexical failure carries the source with no location", () => {
  const failure = parseFailure(() => parseStrings("[]", { locale: "en", source: "arr" }));
  assert.equal(failure.message, "arr: a localized strings file must be comprised of a single JSON object");
  assert.equal(failure.source, "arr");
  assert.equal(failure.line, null);
  assert.equal(failure.column, null);
  assert.equal(failure.path, null);
});

test("a nested duplicate member reports its bounded JSON path as a field", () => {
  const failure = parseFailure(() =>
    parseStrings('{"Key.A":{"translation":"x","translation":"y"}}', { locale: "en", source: "d" }),
  );
  assert.equal(failure.message, "d: duplicate JSON object member 'translation' encountered at $.Key.A");
  assert.equal(failure.path, "$.Key.A");
});

test("the JSON path is bounded at 4096 characters however deep the document goes", () => {
  // 40 levels of 200-character member names would produce an ~8000-character path. Java caps the
  // whole path at 4096 and marks the truncation with one U+2026; an unbounded path would let a
  // hostile file turn one rejection into an arbitrarily large error string.
  const segment = "n".repeat(200);
  let document = '{"dup":1,"dup":2}';
  for (let level = 0; level < 40; level++) document = `{"${segment}":${document}}`;

  const failure = parseFailure(() =>
    parseStrings(`{"Key.A":${document}}`, { locale: "en", source: "deep" }),
  );

  assert.equal(failure.path?.length, 4096, "the path is capped at exactly 4096 characters");
  assert.ok(failure.path?.endsWith("…"), "a truncated path ends with a single ellipsis");
  assert.ok(failure.message.includes(`at ${failure.path}`));
});

test("a duplicated member NAME is bounded at 256 characters in the message", () => {
  const name = "k".repeat(400);
  const failure = parseFailure(() =>
    parseStrings(`{"Key.A":{"${name}":1,"${name}":2}}`, { locale: "en", source: "big" }),
  );

  assert.ok(failure.message.includes(`'${"k".repeat(255)}…'`), failure.message.slice(0, 80));
  assert.ok(!failure.message.includes("k".repeat(256)), "the raw 400-character name must not appear");
});

test("StringsParseError is catch-only", () => {
  // Plan 3.4: consumers catch it and test `instanceof`; only library code creates it.
  assert.throws(
    // @ts-expect-error the declaration exposes no construct signature; this asserts the runtime too
    () => new StringsParseError("nope", "boom", { source: "s" }),
    TypeError,
  );

  class Subclass extends StringsParseError {}
  assert.throws(() => new Subclass(), TypeError, "a subclass must not be instantiable either");
});

test("__proto__, constructor and prototype are ordinary translation keys", () => {
  const parsed = parseStrings(
    '{"__proto__":"p","constructor":"c","prototype":"y","Key.Normal":"n"}',
    { locale: "en", source: "magic" },
  );

  assert.deepEqual(
    parsed.strings.map((string) => string.key).sort(),
    ["Key.Normal", "__proto__", "constructor", "prototype"],
  );
  assert.equal(Object.getPrototypeOf(parsed.originsByKey), null);
  assert.deepEqual(parsed.originsByKey["__proto__"], ["magic"]);
  assert.equal(Object.getPrototypeOf({}), Object.prototype, "no prototype was polluted");
});

test("the parsed file and every keyed record inside it are frozen", () => {
  const parsed = parseStrings(
    '{"Books":{"translation":"{{books}}","placeholders":{"books":{"value":"n","translations":{"CARDINALITY_ONE":"book","CARDINALITY_OTHER":"books"}}}}}',
    { locale: "en", source: "f" },
  );

  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.strings));
  const first = parsed.strings[0];
  assert.ok(first && Object.isFrozen(first));
  const placeholders = first?.placeholders;
  assert.ok(placeholders && Object.isFrozen(placeholders) && Object.getPrototypeOf(placeholders) === null);
  const books = placeholders?.["books"];
  assert.ok(books && books.kind === "language-form" && Object.isFrozen(books.translations));
  assert.equal(Object.getPrototypeOf(books.translations), null);
});

test("at most one leading BOM is removed, and a BOM-only resource is blank", () => {
  const utf8 = new TextEncoder();

  const withBom = parseStrings(utf8.encode('﻿{"Key.A":"a"}'), { locale: "en", source: "b" });
  assert.deepEqual(withBom.strings.map((s) => s.key), ["Key.A"]);

  const bomOnly = parseFailure(() => parseStrings(utf8.encode("﻿"), { locale: "en", source: "b" }));
  assert.match(bomOnly.message, /may not be blank/);

  // Two BOMs: one is stripped, the second is not whitespace, so this is malformed JSON at 1:1.
  const twoBoms = parseFailure(() =>
    parseStrings(utf8.encode('﻿﻿{"Key.A":"a"}'), { locale: "en", source: "b" }),
  );
  assert.equal(twoBoms.message, "b:1:1: unable to parse localized strings file");
});

test("malformed UTF-8 fails instead of becoming U+FFFD", () => {
  // The decoder's default behaviour is substitution, which would turn this into a catalog that
  // loads. `{"Key.A":"<FF><FE>"}`.
  const bytes = Uint8Array.from([
    0x7b, 0x22, 0x4b, 0x65, 0x79, 0x2e, 0x41, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d,
  ]);
  const failure = parseFailure(() => parseStrings(bytes, { locale: "en", source: "u" }));
  assert.equal(failure.message, "u: localized strings resource is not valid UTF-8");
});

test("a limit outside its band is a RangeError, raised before the input is read", () => {
  // Java rejects this in `LocalizedStringLoadingOptions.Builder`, so no resource is examined and the
  // failure is not a parse failure at all.
  assert.throws(
    () => parseStrings("!!! not json", { locale: "en", limits: { maximumLocalizedStringsFiles: 0 } }),
    /maximumLocalizedStringsFiles must be positive/,
  );
  assert.throws(
    () => parseStrings("!!! not json", { locale: "en", limits: { maximumJsonNestingDepth: 129 } }),
    /maximumJsonNestingDepth must be between 1 and 128/,
  );
});

test("ordinality warnings need the optional ordinal data; cardinality warnings do not", () => {
  const resource =
    '{"Finish":{"translation":"{{place}}","placeholders":{"place":{"value":"n","translations":{"ORDINALITY_ONE":"1st"}}},"commentary":"c"}}';

  const withoutData = parseStrings(resource, { locale: "cy", source: "o" });
  assert.deepEqual(withoutData.warnings, [], "the ordinal table is not reachable from the root graph");

  const withData = parseStrings(resource, { locale: "cy", source: "o", pluralData: { ordinal: ordinalData } });
  assert.equal(withData.warnings.length, 1);
  const warning = withData.warnings[0];
  assert.equal(warning?.type, "INCOMPLETE_ORDINALITY_TRANSLATIONS");
  assert.equal(warning?.key, "Finish");
  assert.equal(warning?.placeholder, "place");
  assert.equal(warning?.locale, "cy");
  // Declared `Ordinality` order, not alphabetical and not hash order.
  assert.deepEqual(warning?.missingLanguageForms, [
    "ORDINALITY_ZERO",
    "ORDINALITY_TWO",
    "ORDINALITY_FEW",
    "ORDINALITY_MANY",
    "ORDINALITY_OTHER",
  ]);
  assert.equal(withData.strings[0]?.commentary, "c", "commentary survives parsing");
});

test("the warning budget refuses the over-limit warning rather than truncating afterwards", () => {
  /** @type {unknown[]} */
  const delivered = [];
  const resource =
    '{"Items":{"translation":"{{noun}}","placeholders":{"noun":{"value":"count","translations":{"CARDINALITY_ONE":"kniga"}}}}}';

  const failure = parseFailure(() =>
    parseStrings(resource, {
      locale: "ru",
      source: "w",
      limits: { maximumWarnings: 0 },
      onWarning: (warning) => delivered.push(warning),
    }),
  );

  assert.equal(failure.message, "w: localized strings load exceeds the aggregate maximum of 0 warnings");
  assert.deepEqual(delivered, [], "the refused warning was never handed to the caller");
});

test("a malformed expression fails the whole file, in a branch no lookup would reach", () => {
  const failure = parseFailure(() =>
    parseStrings(
      '{"Key.A":{"translation":"t","alternatives":[{"count ==":{"translation":"x"}}]}}',
      { locale: "en", source: "e" },
    ),
  );

  assert.equal(
    failure.message,
    "e: unable to parse whole-message alternative expression 'count ==' for root key 'Key.A': " +
      "Invalid expression 'count ==': Insufficient arguments provided for operator '=='",
  );
  assert.ok(failure.cause instanceof Error, "the evaluator's own error is kept as the cause");
});

test("a parsed file reports its source once, and every key's origin", () => {
  const parsed = parseStrings('{"A":"a","B":"b"}', { locale: "en-US", source: "src" });
  assert.equal(parsed.$lokalized, "parsed-strings-file");
  assert.equal(parsed.locale, "en-US");
  assert.deepEqual([...parsed.sources], ["src"]);
  assert.deepEqual(Object.keys(parsed.originsByKey).sort(), ["A", "B"]);
  assert.deepEqual(parsed.originsByKey["A"], ["src"]);
});

/**
 * WHERE the two hooks run inside the structural walk.
 *
 * Every expectation below was taken from unmodified lokalized-java 3.0.0 by calling
 * `LocalizedStringLoader.parse(InputStream, Locale, source, handler, options)` on the same bytes;
 * none of it is recoverable from the corpus, whose `parse` fixtures each carry exactly one defect.
 * Compiling expressions or emitting warnings in a pass AFTER the structural parse — which is what
 * this port did until these were written — gets every one of them wrong.
 */
const WARNER =
  '"W":{"translation":"x {{b}}","placeholders":{"b":{"value":"c","translations":' +
  '{"CARDINALITY_ONE":"1","CARDINALITY_OTHER":"o"}}}}';
const BAD_EXPRESSION = '"X":{"translation":"t","alternatives":[{"count ==":{"translation":"y"}}]}';
const BAD_STRUCTURE = '"S":3';

test("a warning raised by an earlier key is delivered before a later key fails", () => {
  /** @type {string[]} */
  const delivered = [];

  const failure = parseFailure(() =>
    parseStrings(`{${WARNER},${BAD_EXPRESSION}}`, {
      locale: "ru",
      source: "o",
      pluralData: { ordinal: ordinalData },
      onWarning: (warning) => delivered.push(warning.key),
    }),
  );

  assert.match(failure.message, /unable to parse whole-message alternative expression 'count =='/);
  assert.deepEqual(delivered, ["W"], "Java hands the handler the warning it already produced");
});

test("a warning budget busted by an earlier key is what the file fails on", () => {
  for (const later of [BAD_EXPRESSION, BAD_STRUCTURE, '"D":{"translation":"x","translation":"y"}']) {
    const failure = parseFailure(() =>
      parseStrings(`{${WARNER},${later}}`, {
        locale: "ru",
        source: "o",
        limits: { maximumWarnings: 0 },
        pluralData: { ordinal: ordinalData },
      }),
    );

    assert.equal(
      failure.message,
      "o: localized strings load exceeds the aggregate maximum of 0 warnings",
      `the later defect (${later.slice(0, 4)}…) must not preempt the budget`,
    );
  }
});

test("a bad expression under an earlier key beats a structural error under a later one", () => {
  const failure = parseFailure(() =>
    parseStrings(`{${BAD_EXPRESSION},${BAD_STRUCTURE}}`, { locale: "en", source: "o" }),
  );

  assert.match(failure.message, /unable to parse whole-message alternative expression 'count =='/);
});

test("within one key, a bad expression beats a structural error in a later alternative", () => {
  // Java validates each alternative's expression before it parses that alternative's value, so the
  // element-0 expression is reached before the element-1 structure. Validating expressions over the
  // finished model instead would report the structure.
  const failure = parseFailure(() =>
    parseStrings(
      '{"A":{"translation":"t","alternatives":[{"count ==":{"translation":"y"}},{"count == 1":3}]}}',
      { locale: "en", source: "o" },
    ),
  );

  assert.equal(
    failure.message,
    "o: unable to parse whole-message alternative expression 'count ==' for root key 'A': " +
      "Invalid expression 'count ==': Insufficient arguments provided for operator '=='",
  );
});

test("a bad FRAGMENT expression beats a structural error in a later alternative", () => {
  const failure = parseFailure(() =>
    parseStrings(
      '{"A":{"translation":"t {{f}}","placeholders":{"f":{"translation":"d","alternatives":' +
        '[{"count ==":"r"}]}},"alternatives":[{"count == 1":3}]}}',
      { locale: "en", source: "o" },
    ),
  );

  assert.equal(
    failure.message,
    "o: unable to parse fragment alternative 0 expression 'count ==' for placeholder 'f' in root " +
      "key 'A': Invalid expression 'count ==': Insufficient arguments provided for operator '=='",
  );
});

test("each door reproduces JAVA's wording for that door, and the two do not drift", () => {
  // MEASURED on the pinned Corretto 21, driving a programmatic `LocalizedString` into
  // `Strings.Builder.localizedStringSupplier` — the true analogue of `createStrings`, since neither
  // path parses JSON. Java wraps at CONSTRUCTION through `LocalizedStringValidator`:
  //
  //   IllegalArgumentException
  //   "Invalid localized string 'A' for locale 'en': Invalid alternative expression 'count ==': …"
  //   cause: ExpressionEvaluationException
  //
  // This test previously asserted the OPPOSITE — that `createStrings` "surfaces the evaluator's
  // message unwrapped" — which left a construction failure with no key, no locale and no cause, and
  // broke `catalog.js`'s own stated contract that one authoring mistake produces one diagnostic
  // whichever door it came through. The rest of that contract stands and is still pinned here: the
  // two doors must NOT drift into each other, because Java's own two wordings differ and the corpus
  // pins the loader half exactly.
  const catalog = { A: { translation: "t", alternatives: [{ "count ==": { translation: "y" } }] } };

  assert.throws(
    // `locale` is named because B4 made the ambient locale source required (plan 3.2's "exactly one
    // of"), and without it this assertion would be satisfied by THAT refusal instead of the
    // expression one it is written to pin — an earlier guard answering for a later check.
    () => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: catalog } }),
    {
      message:
        "Invalid localized string 'A' for locale 'en': Invalid alternative expression 'count ==': " +
        "Invalid expression 'count ==': Insufficient arguments provided for operator '=='",
    },
  );
  assert.throws(
    () => parseStrings(JSON.stringify(catalog), { locale: "en", source: "o" }),
    { message: /^o: unable to parse whole-message alternative expression 'count =='/ },
  );
});

test("the construction door retains the evaluator's error as the CAUSE, as Java retains it", () => {
  // Java's validator passes the `ExpressionEvaluationException` to `invalid()` at
  // `LocalizedStringValidator.java:326`, so the original survives on the wrapper. A wrapper that
  // merely quotes the message reads identically and loses the thing a caller can inspect — which is
  // why this is asserted separately from the wording above.
  const catalog = { A: { translation: "t", alternatives: [{ "count ==": { translation: "y" } }] } };

  try {
    createStrings({ fallbackLocale: "en", locale: "en", strings: { en: catalog } });
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.cause instanceof Error, "the evaluator's error must survive as `cause`");
    assert.match(
      /** @type {Error} */ (error.cause).message,
      /^Invalid expression 'count ==': /,
      "the cause is the evaluator's own message, unwrapped",
    );
  }
});

test("the FRAGMENT shape gets Java's other construction sentence, not the whole-message one", () => {
  // Java has two sentences and picks by shape (`LocalizedStringValidator.java:159` vs the
  // generated-placeholder one). Measured, both wrapped by `invalid()`'s outer clause. Asserting only
  // the whole-message shape would let a port that used one sentence for everything pass.
  const catalog = {
    A: { translation: "t {{f}}", placeholders: { f: { translation: "frag", alternatives: [{ "count ==": "alt" }] } } },
  };

  assert.throws(
    () => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: catalog } }),
    {
      message:
        "Invalid localized string 'A' for locale 'en': Invalid expression alternative 0 for " +
        "generated placeholder 'f', expression 'count ==': " +
        "Invalid expression 'count ==': Insufficient arguments provided for operator '=='",
    },
  );
});

test("a NESTED alternative reports the ROOT key, not a path — measured against Java", () => {
  // Java's message for a bad expression two alternatives deep is byte-identical to the depth-1 one:
  // the validator names the ROOT key and the offending expression, and carries no path. A port that
  // threaded a path would look more helpful and would not be Java.
  const nested = {
    A: {
      translation: "t",
      alternatives: [{ "count == 1": { translation: "y", alternatives: [{ "count ==": { translation: "z" } }] } }],
    },
  };

  assert.throws(
    () => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: nested } }),
    {
      message:
        "Invalid localized string 'A' for locale 'en': Invalid alternative expression 'count ==': " +
        "Invalid expression 'count ==': Insufficient arguments provided for operator '=='",
    },
  );
});
