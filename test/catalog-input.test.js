// @ts-check
/**
 * Plan section 3.2's `CatalogInput` contract:
 *
 *   type CatalogInput = string | Uint8Array | ParsedStringsFile | readonly LocalizedStringInput[]
 *
 * Two of the four forms went unimplemented from M2 until M5a's parser was wired in, and nothing
 * caught it — `createStrings` accepted only the already-parsed object and the corpus never exercised
 * the others, because the corpus drives `parse` and `getResult` separately rather than passing text
 * to construction. These tests are that missing gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStrings } from "../src/core/index.js";
import { parseStrings } from "../src/parse/index.js";

const DOCUMENT = { "Greeting": "Hello, {{name}}" };
const strings = (catalog) => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: catalog } });

test("CatalogInput accepts an already-parsed object", () => {
  assert.equal(strings(DOCUMENT).get("Greeting", { name: "Ada" }), "Hello, Ada");
});

test("CatalogInput accepts raw text", () => {
  assert.equal(strings(JSON.stringify(DOCUMENT)).get("Greeting", { name: "Ada" }), "Hello, Ada");
});

test("CatalogInput accepts bytes", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(DOCUMENT));
  assert.equal(strings(bytes).get("Greeting", { name: "Ada" }), "Hello, Ada");
});

test("the three forms produce identical results", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(DOCUMENT));
  const rendered = [DOCUMENT, JSON.stringify(DOCUMENT), bytes].map((c) => strings(c).get("Greeting", { name: "Ada" }));
  assert.deepEqual(new Set(rendered), new Set(["Hello, Ada"]), "the input form must not change the output");
});

test("text and byte catalogs go through the bounded parser, not JSON.parse", () => {
  // Each of these is something `JSON.parse` accepts or silently repairs, and the bounded parser
  // must not. If `createStrings` ever regresses to `JSON.parse` for these forms, these fail.
  assert.throws(
    () => strings(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])),
    /not valid UTF-8/,
    "invalid UTF-8 must fail rather than become U+FFFD",
  );
  assert.throws(
    () => strings('{"Greeting":"a","Greeting":"b"}'),
    /duplicate/i,
    "a duplicate key must be rejected, not resolved last-wins",
  );
});

test("an already-parsed object is NOT re-parsed", () => {
  // The object form has no text to bound and no duplicates to find — a JS object cannot carry them.
  // Routing it through the parser would be wasted work and would reject `__proto__` differently.
  const withMagicKey = { "__proto__": "ordinary", "Greeting": "hi" };
  const s = strings(withMagicKey);
  assert.equal(s.get("Greeting"), "hi");
  assert.equal(/** @type {any} */ ({}).ordinary, undefined, "the prototype must not be polluted");
});

test("aggregate load limits span every catalog, not each one separately", () => {
  // Java's `maximumTotalInputBytes` is per-LOAD. A session per catalog would enforce each file's own
  // limit and never the aggregate — two catalogs individually under budget but jointly over it must
  // still fail.
  // Bytes, not text: `maximumTotalInputBytes` governs byte input, while text is bounded by character
  // count. Pairing a text catalog with a byte budget tests nothing, which is how this test failed
  // when first written.
  const half = new TextEncoder().encode(JSON.stringify({ "Greeting": "x".repeat(200) }));

  // Control: each catalog alone fits comfortably inside the budget.
  const budget = Math.floor(half.length * 1.5);
  assert.ok(half.length < budget, "each catalog must individually fit, or the test proves nothing");
  createStrings({ fallbackLocale: "en", locale: "en", strings: { en: half }, loadingLimits: { maximumTotalInputBytes: budget } });

  // Together they exceed it, and a per-catalog session would never notice.
  assert.throws(
    () => createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: half, fr: half },
      loadingLimits: { maximumTotalInputBytes: budget },
    }),
    /aggregate|total/i,
    "the aggregate budget must be charged across catalogs",
  );
});

// --- the two forms plan 3.2 names that construction did not accept -------------------------------

test("CatalogInput accepts a programmatic LocalizedStringInput[]", () => {
  // The fourth form, and the one an application with its own data is told to use: plan 4.1 sends
  // programmatic callers here rather than to `JSON.parse` output, because these values "receive
  // model/schema validation and node limits, not source-level guarantees".
  const catalog = [
    { key: "Greeting", translation: "Hello, {{name}}" },
    {
      key: "Books",
      translation: "{{count}} {{books}}",
      placeholders: {
        books: {
          kind: "language-form",
          value: "count",
          translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
        },
      },
    },
    { key: "Alt", translation: "many", alternatives: [{ expression: "count == 1", translation: "one" }] },
  ];

  const s = strings(catalog);
  assert.equal(s.get("Greeting", { name: "Ada" }), "Hello, Ada");
  assert.equal(s.get("Books", { count: 1 }), "1 book");
  assert.equal(s.get("Books", { count: 4 }), "4 books");
  assert.equal(s.get("Alt", { count: 1 }), "one");
  assert.equal(s.get("Alt", { count: 2 }), "many");
});

test("CatalogInput accepts a ParsedStringsFile", () => {
  // `ParsedStringsFile` is a NAMED form in `CatalogInput`, not a decoded document: it carries
  // `$lokalized`, `locale`, `sources`, `strings`, `originsByKey` and `warnings`. Routing it through
  // the decoded-object path treats `sources` as a translation key, which is how this silently did
  // not work — construction failed with "either a translation string or object value is required
  // for key 'sources'".
  const parsed = parseStrings(JSON.stringify(DOCUMENT), { locale: "en", source: "en.json" });
  assert.equal(strings(parsed).get("Greeting", { name: "Ada" }), "Hello, Ada");
});

test("a ParsedStringsFile parsed for another locale is refused, not relabelled", () => {
  // Plan 3.2: "A map key and a `ParsedStringsFile.locale` must be the same normalized loaded tag."
  // Trusting the key would serve a French catalog as German, and every plural, gender and phonetic
  // selection under it would then classify against the wrong language rather than fail.
  const parsed = parseStrings(JSON.stringify(DOCUMENT), { locale: "fr", source: "fr.json" });
  assert.throws(
    () => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: DOCUMENT, de: parsed } }),
    /parsed for locale 'fr'/,
  );
});

test("a ParsedStringsFile's own case-different tag still matches its key", () => {
  const parsed = parseStrings(JSON.stringify(DOCUMENT), { locale: "en-us", source: "x" });
  assert.equal(
    createStrings({ fallbackLocale: "en-US", locale: "en-US", strings: { "EN-us": parsed } })
      .get("Greeting", { name: "Ada" }),
    "Hello, Ada",
  );
});

test("all four forms produce the same translation", () => {
  const forms = [
    DOCUMENT,
    JSON.stringify(DOCUMENT),
    new TextEncoder().encode(JSON.stringify(DOCUMENT)),
    [{ key: "Greeting", translation: "Hello, {{name}}" }],
    parseStrings(JSON.stringify(DOCUMENT), { locale: "en" }),
  ];
  const rendered = forms.map((c) => strings(c).get("Greeting", { name: "Ada" }));
  assert.deepEqual(new Set(rendered), new Set(["Hello, Ada"]), "the input form must not change the output");
});

test("model limits are charged across every catalog form, not just the raw ones", () => {
  // Plan 3.2: "model/file/node/warning limits apply across all raw and already-parsed catalogs."
  // The decoded-object path used to build a `LoadingSession` of its own, which gave every object
  // catalog a private budget and its own copy of the DEFAULT limits -- so a caller's node ceiling
  // governed only the catalogs that happened to arrive as text, and never the aggregate.
  const options = (strings) => ({
    fallbackLocale: "en",
    locale: "en",
    strings,
    loadingLimits: { maximumTranslationNodes: 3 },
  });

  // Two keys per catalog: one catalog fits, two together do not.
  const two = { A: "a", B: "b" };
  createStrings(options({ en: two }));
  assert.throws(() => createStrings(options({ en: two, fr: two })), /translation nodes/);
  assert.throws(() => createStrings(options({ en: two, fr: JSON.stringify(two) })), /translation nodes/);
  assert.throws(
    () => createStrings(options({ en: two, fr: [{ key: "A", translation: "a" }, { key: "B", translation: "b" }] })),
    /translation nodes/,
  );
});

test("loadingLimits reaches the decoded-object form's JSON nesting check", () => {
  // Nesting depth is checked over decoded objects too, and it was checked against the DEFAULT
  // rather than the caller's number: `alternatives-structure.depth.41-levels` is a corpus case that
  // Java accepts under a raised ceiling and this rejected with "exceeds the maximum of 64".
  const nest = (depth) => {
    let node = { translation: "leaf" };
    for (let i = 0; i < depth; i++) node = { translation: "m", alternatives: [{ "count == 1": node }] };
    return { Deep: node };
  };

  const deep = nest(25);
  assert.throws(() => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: deep } }), /nesting depth/);
  assert.equal(
    createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: deep },
      loadingLimits: { maximumJsonNestingDepth: 128 },
    }).get("Deep", { count: 2 }),
    "m",
  );
});

test("runtimeLimits is refused rather than ignored", () => {
  // Plan 4.6: v1 fixes Java's `TranslationRuntimeLimits` defaults and "a non-undefined
  // `runtimeLimits` option is a construction-time" error. Silently ignoring it would answer under a
  // bound the caller does not have, which is the one outcome that cannot be debugged from outside.
  assert.throws(
    () => createStrings({ fallbackLocale: "en", locale: "en", strings: { en: DOCUMENT }, runtimeLimits: {} }),
    /runtimeLimits/,
  );
  // Explicitly `undefined` is not "supplied": it is what the declared option type says.
  createStrings({ fallbackLocale: "en", locale: "en", strings: { en: DOCUMENT }, runtimeLimits: undefined });
});

test("the catalog map may be a Map, not only a record", () => {
  // Plan 3.2 declares `CatalogMap` as `Readonly<Record<LocaleTag, CatalogInput>>` OR
  // `ReadonlyMap<LocaleTag, CatalogInput>`, and plan 4.3 takes a `Map` wherever it takes a keyed
  // record. `Object.entries` on a `Map` returns `[]`: construction SUCCEEDED with no catalogs at
  // all, `getSupportedLocales()` was empty, and every lookup returned its own key — a missing
  // translation, which is a thing that legitimately happens, so nothing anywhere said the catalogs
  // had been dropped. Each of the four `CatalogInput` forms is exercised through the Map door.
  const map = new Map([
    ["en", DOCUMENT],
    ["fr", JSON.stringify({ "Greeting": "Bonjour, {{name}}" })],
    ["de", new TextEncoder().encode(JSON.stringify({ "Greeting": "Hallo, {{name}}" }))],
    ["es", [{ key: "Greeting", translation: "Hola, {{name}}" }]],
  ]);
  const instance = createStrings({ fallbackLocale: "en", locale: "en", strings: map });

  assert.deepEqual([...instance.getSupportedLocales()], ["en", "fr", "de", "es"]);
  assert.equal(instance.get("Greeting", { name: "Ada" }), "Hello, Ada");
  assert.equal(instance.get("Greeting", { name: "Ada" }, { locale: "fr" }), "Bonjour, Ada");
  assert.equal(instance.get("Greeting", { name: "Ada" }, { locale: "de" }), "Hallo, Ada");
  assert.equal(instance.get("Greeting", { name: "Ada" }, { locale: "es" }), "Hola, Ada");
});

test("a catalog supplied where the catalog MAP belongs is refused, not indexed", () => {
  // `strings` is a map of locale tag to catalog, and a catalog may now itself be an array — so
  // handing one array straight to `strings` is the natural slip. `Object.entries` turns it into
  // index keys, and the only complaint was that the locale tag `'0'` is malformed, which names
  // neither the mistake nor the option that carries it.
  for (const wrong of [[{ key: "Greeting", translation: "Hello" }], JSON.stringify(DOCUMENT), null]) {
    assert.throws(
      () => createStrings({ fallbackLocale: "en", locale: "en", strings: /** @type {any} */ (wrong) }),
      (error) => error instanceof TypeError && /strings/.test(error.message),
    );
  }
});
