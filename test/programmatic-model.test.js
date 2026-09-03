// @ts-check
/**
 * Plan section 3.6's programmatic localized-string model, and the parts of `4.3`/`4.4` that only
 * construction can show: safe keyed data, falsy placeholder values, and the incomplete
 * language-form warnings `createStrings` raises for the catalogs it is handed directly.
 *
 * The organising claim is that there is ONE model with two doors. A strings file and a
 * `LocalizedStringInput[]` carrying the same content must validate under the same rules, fail with
 * the same diagnostic, and render the same answer — Java says so out loud in
 * `LocalizedStringValidator`'s own contract ("programmatically constructed and file-backed localized
 * strings fail at construction time in the same places"), and most of what follows is that claim
 * spelled out one rule at a time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStrings } from "../src/core/index.js";
import { defineCatalog, defineLocalizedString, parseStrings } from "../src/parse/index.js";
import { ordinalData } from "../src/data/ordinal.js";
import { cardinalRangeData } from "../src/data/ranges.js";

const en = (/** @type {unknown} */ catalog, /** @type {object} */ extra = {}) =>
  createStrings({ fallbackLocale: "en", locale: "en", strings: { en: catalog }, ...extra });

// --- define* validates, copies, and freezes ------------------------------------------------------

test("defineLocalizedString returns a frozen null-prototype value that shares nothing with its input", () => {
  const input = {
    key: "Books",
    commentary: "shown in the library header",
    translation: "{{count}} {{books}}",
    placeholders: {
      books: {
        kind: "language-form",
        value: "count",
        translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
      },
    },
  };

  const defined = defineLocalizedString(input);

  assert.ok(Object.isFrozen(defined));
  assert.ok(Object.isFrozen(defined.placeholders));
  assert.equal(Object.getPrototypeOf(defined.placeholders), null, "keyed records are null-prototype");
  assert.notEqual(defined.placeholders, input.placeholders, "the copy must be defensive");

  // Plan 3.6: commentary "survives parsing and programmatic construction" and never affects
  // rendering. Both halves matter — dropping it loses tooling data, honouring it changes output.
  assert.equal(defined.commentary, "shown in the library header");
  assert.equal(en([defined]).get("Books", { count: 1 }), "1 book");

  // Mutating the argument afterwards cannot change what was defined.
  input.translation = "TAMPERED";
  assert.equal(defined.translation, "{{count}} {{books}}");
});

test("a defined string and the same string parsed from a file are structurally identical", () => {
  // The strongest statement of "one model, two doors" this suite can make: if these ever diverge,
  // one door has grown a rule the other has not.
  const file = {
    Books: {
      commentary: "c",
      translation: "{{count}} {{books}}",
      placeholders: {
        books: { value: "count", translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" } },
      },
      alternatives: [{ "count == 0": { translation: "none" } }],
    },
  };

  const parsed = parseStrings(JSON.stringify(file), { locale: "en" });
  const defined = defineLocalizedString({
    key: "Books",
    commentary: "c",
    translation: "{{count}} {{books}}",
    placeholders: {
      books: {
        kind: "language-form",
        value: "count",
        translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
      },
    },
    alternatives: [{ expression: "count == 0", translation: "none" }],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(defined)), JSON.parse(JSON.stringify(parsed.strings[0])));
});

test("defineCatalog compiles every expression at the definition site", () => {
  // Eager, per plan 3.6's closing line. A predicate that cannot compile must fail where it was
  // written, not at whichever `createStrings` happened to consume the value months later.
  assert.throws(
    () => defineCatalog([{ key: "K", translation: "t", alternatives: [{ expression: "count ===== 1", translation: "x" }] }]),
    /whole-message alternative expression/,
  );
  assert.throws(
    () => defineLocalizedString({
      key: "K",
      translation: "{{frag}}",
      placeholders: {
        frag: { kind: "expression", translation: "d", alternatives: [{ expression: "!!", translation: "x" }] },
      },
    }),
    /fragment alternative 0/,
  );
});

test("defineCatalog rejects duplicate keys across the catalog", () => {
  assert.throws(
    () => defineCatalog([{ key: "K", translation: "a" }, { key: "K", translation: "b" }]),
    /duplicate localized string key 'K'/,
  );
});

test("the file rules apply unchanged to programmatic values", () => {
  const cases = [
    [{ key: "K" }, /either a translation or at least one alternative/],
    [{ key: "K", translation: "t", alternatives: [] }, /at least one expression/],
    [{ key: "K", translation: "{{2bad}}" }, /invalid placeholder reference|Placeholder names must start/],
    [{ key: "K", translation: "t", placeholders: { CARDINALITY_ONE: { kind: "expression", translation: "x" } } },
      /reserved expression constants/],
    [{ key: "K", translation: "t", placeholders: { p: { kind: "language-form", value: "c", translations: { CARDINALITY_ONE: "a", GENDER_MALE: "b" } } } },
      /unexpected placeholder translation language form/],
    [{ key: "K", translation: "t", placeholders: { p: { kind: "language-form", value: "c", translations: { CARDINALITY_ONE: "a", GENDER_MASCULINE: "b" } } } },
      /mix-and-match language forms/],
    [{ key: "K", translation: "t", placeholders: { p: { kind: "language-form", range: { start: "a", end: "b" }, translations: { GENDER_MASCULINE: "m" } } } },
      /range-based translations only support Cardinality/],
    [{ key: "K", translation: "t", placeholders: { p: { kind: "language-form", value: "c", range: { start: "a", end: "b" }, translations: { CARDINALITY_ONE: "x" } } } },
      /cannot have both a value and a range/],
    [{ key: "K", translation: "t", placeholders: { p: { translations: { CARDINALITY_ONE: "x" } } } }, /must declare kind/],
    [{ key: "K", translation: "t", surprise: 1 }, /unexpected field 'surprise'/],
    [{ translation: "t" }, /must carry a string 'key'/],
    [{ key: "K", translation: "t", alternatives: [{ translation: "x" }] }, /must carry its predicate as a string/],
  ];

  for (const [input, expected] of cases)
    assert.throws(() => defineLocalizedString(/** @type {any} */ (input)), /** @type {RegExp} */ (expected),
      `expected ${expected} for ${JSON.stringify(input)}`);
});

// --- depth and the DAG rules ---------------------------------------------------------------------

/** An alternative chain `depth` levels deep, ending in a leaf. */
const chain = (/** @type {number} */ depth, /** @type {any} */ leaf = { expression: "count == 1", translation: "leaf" }) => {
  let node = leaf;
  for (let i = 1; i < depth; i++) node = { expression: "count == 1", translation: "m", alternatives: [node] };
  return node;
};

test("alternative nesting is capped at 128, counting the root as depth 0", () => {
  defineLocalizedString({ key: "K", translation: "r", alternatives: [chain(128)] });
  assert.throws(
    () => defineLocalizedString({ key: "K", translation: "r", alternatives: [chain(129)] }),
    /exceeds the maximum depth of 128/,
  );
});

test("an identity cycle is rejected instead of recursing forever", () => {
  /** @type {any} */
  const alternative = { expression: "count == 1", translation: "t" };
  alternative.alternatives = [alternative];

  assert.throws(
    () => defineLocalizedString({ key: "S", translation: "x", alternatives: [alternative] }),
    /identity cycle/,
  );
});

test("a shared subtree proved shallow is REVALIDATED when it is reused deeper", () => {
  // Plan 3.6's exact rule: the memo may skip a reused subtree "only when the cached depth is greater
  // than or equal to its current entry depth". Caching mere seen-ness instead would accept this
  // graph, because the 20-deep tail is first proved at depth 1 and then reused at depth 120.
  const shared = chain(20);
  assert.throws(
    () => defineLocalizedString({ key: "K", translation: "r", alternatives: [shared, chain(120, shared)] }),
    /exceeds the maximum depth of 128/,
  );

  // ...and the same subtree reused at an equal or shallower placement is fine.
  defineLocalizedString({ key: "K", translation: "r", alternatives: [chain(100, shared), shared] });
});

test("a shared diamond validates in linear time rather than exponential", () => {
  // 60 levels of two-way sharing is 2^60 paths. Without the identity memo in validation, in the
  // model projection, and in construction's two definition walks, any one of them hangs here.
  /** @type {any} */
  let node = { expression: "count == 1", translation: "leaf" };
  for (let i = 0; i < 60; i++) node = { expression: "count == 1", translation: "m", alternatives: [node, node] };

  const started = Date.now();
  const s = en([{ key: "K", translation: "r", alternatives: [node] }]);
  assert.equal(s.get("K", { count: 1 }), "leaf");
  assert.ok(Date.now() - started < 5_000, "construction over a shared DAG must not expand it");
});

// --- warnings ------------------------------------------------------------------------------------

test("direct construction raises the incomplete language-form warnings", () => {
  // Plan 3.2 gives `createStrings` the loader's job for the catalogs it is handed, so `getWarnings()`
  // must report what a parse of the same content would. Returning an empty array made every
  // incomplete plural set in a directly-supplied catalog silently invisible.
  const s = en(
    { Books: { translation: "{{books}}", placeholders: { books: { value: "count", translations: { CARDINALITY_ONE: "a" } } } } },
    { pluralData: { ordinal: ordinalData } },
  );

  const [warning, ...rest] = s.getWarnings();
  assert.equal(rest.length, 0);
  assert.equal(warning.type, "INCOMPLETE_CARDINALITY_TRANSLATIONS");
  assert.equal(warning.key, "Books");
  assert.equal(warning.placeholder, "books");
  assert.deepEqual([...warning.missingLanguageForms], ["CARDINALITY_OTHER"]);
  assert.ok(Object.isFrozen(s.getWarnings()));

  // Plan 3.2: "Direct raw inputs use source name `catalog:<normalized-locale>`" — the normalized
  // tag, so the record does not vary with how the caller happened to spell the map key.
  assert.equal(warning.source, "catalog:en");
  assert.equal(warning.locale, "en");
});

test("missingLanguageForms follows declared form order, never hash order", () => {
  // Plan 4.4. Russian's supported set is ONE, FEW, MANY, OTHER in declaration order; a catalog
  // supplying only ONE must name the other three in exactly that order.
  const s = createStrings({
    fallbackLocale: "ru",
    locale: "ru",
    strings: { ru: { B: { translation: "{{b}}", placeholders: { b: { value: "c", translations: { CARDINALITY_ONE: "a" } } } } } },
  });

  assert.deepEqual([...s.getWarnings()[0].missingLanguageForms],
    ["CARDINALITY_FEW", "CARDINALITY_MANY", "CARDINALITY_OTHER"]);
});

test("ordinality warnings need the optional ordinal data, and cardinality warnings do not", () => {
  const catalog = {
    Rank: { translation: "{{r}}", placeholders: { r: { value: "rank", translations: { ORDINALITY_ONE: "st" } } } },
  };

  // Without the table this module cannot import, an ordinality gap simply goes unreported — the same
  // trade `lokalized/parse` makes, and the reason the root graph stays free of the ordinal data.
  assert.deepEqual(
    createStrings({ fallbackLocale: "en", locale: "en", strings: { en: catalog }, pluralData: { ordinal: ordinalData } })
      .getWarnings().map((w) => w.type),
    ["INCOMPLETE_ORDINALITY_TRANSLATIONS"],
  );
});

test("a range-driven placeholder is exempt, and a complete set is silent", () => {
  // Range-driven translations are partial by design, so they are never a gap. The range data has to
  // be supplied for the catalog to construct at all — a range placeholder is exactly the case
  // `resolvePluralData` refuses to leave until lookup time.
  assert.deepEqual(
    en(
      { B: { translation: "{{b}}", placeholders: { b: { range: { start: "s", end: "e" }, translations: { CARDINALITY_ONE: "a" } } } } },
      { pluralData: { ranges: cardinalRangeData } },
    ).getWarnings(),
    [],
  );
  assert.deepEqual(
    en({ B: { translation: "{{b}}", placeholders: { b: { value: "c", translations: { CARDINALITY_ONE: "a", CARDINALITY_OTHER: "b" } } } } })
      .getWarnings(),
    [],
  );
});

test("onWarning observes each warning, and a throwing handler aborts construction", () => {
  const seen = [];
  const catalog = { B: { translation: "{{b}}", placeholders: { b: { value: "c", translations: { CARDINALITY_ONE: "a" } } } } };

  en(catalog, { onWarning: (/** @type {any} */ w) => seen.push(w.key) });
  assert.deepEqual(seen, ["B"]);

  assert.throws(() => en(catalog, { onWarning: () => { throw new Error("nope"); } }), /nope/);
});

test("the warning budget refuses the warning rather than delivering it and failing after", () => {
  const catalog = { B: { translation: "{{b}}", placeholders: { b: { value: "c", translations: { CARDINALITY_ONE: "a" } } } } };
  const seen = [];

  assert.throws(
    () => en(catalog, { loadingLimits: { maximumWarnings: 0 }, onWarning: (/** @type {any} */ w) => seen.push(w) }),
    /maximum of 0 warnings/,
  );
  assert.deepEqual(seen, [], "a refused warning must never reach the handler");
});

test("a ParsedStringsFile's warnings are replayed, not recomputed", () => {
  // Plan 3.2 tells applications that "already handled parser warnings should omit [onWarning] to
  // avoid replay" — which is only meaningful if construction replays what the file carries. It must,
  // because the file's warnings name the sources it was parsed or merged from and this construction
  // no longer knows them.
  const parsed = parseStrings(
    JSON.stringify({ B: { translation: "{{b}}", placeholders: { b: { value: "c", translations: { CARDINALITY_ONE: "a" } } } } }),
    { locale: "en", source: "messages/en.json" },
  );

  assert.equal(parsed.warnings.length, 1);
  const replayed = en(parsed).getWarnings();
  assert.equal(replayed.length, 1, "replayed once, not once per pass");
  assert.equal(replayed[0].source, "messages/en.json", "the file's own source label survives");
});

// --- safe keyed data ------------------------------------------------------------------------------

const MAGIC = ["__proto__", "constructor", "prototype", "toString"];

test("magic keys are ordinary translation keys in every catalog form", () => {
  // Plan 4.3: these "are ordinary translation or placeholder keys when they satisfy the strings-file
  // identifier rules. They must not alter prototypes or collide with inherited properties."
  const document = Object.create(null);
  for (const key of MAGIC) document[key] = `value for ${key}`;

  const forms = [
    document,
    JSON.stringify(document),
    MAGIC.map((key) => ({ key, translation: `value for ${key}` })),
    parseStrings(JSON.stringify(document), { locale: "en" }),
  ];

  for (const form of forms) {
    const s = en(form);
    assert.deepEqual([...s.getKeysForLocale("en")].sort(), [...MAGIC].sort());
    for (const key of MAGIC) assert.equal(s.get(key), `value for ${key}`, `${key} in ${typeof form}`);
  }

  assert.equal(/** @type {any} */ ({}).ordinary, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype, "the global prototype is untouched");
});

test("magic keys are ordinary placeholder names and ordinary caller keys", () => {
  const s = en([
    {
      key: "K",
      translation: "<{{constructor}}|{{toString}}>",
      placeholders: {
        constructor: { kind: "expression", translation: "C" },
        toString: { kind: "expression", translation: "T" },
      },
    },
    { key: "Echo", translation: "{{constructor}} and {{toString}}" },
  ]);

  assert.equal(s.get("K"), "<C|T>");

  // A caller bag whose own properties are magic: `Object.hasOwn` sees them, an `in` test would also
  // have seen every inherited method, and a bare property read would have found `Object.prototype`'s.
  const values = Object.create(null);
  values["constructor"] = "one";
  values["toString"] = "two";
  assert.equal(s.get("Echo", values), "one and two");

  // And an ORDINARY object literal that supplies neither must not pick them up from its prototype.
  // An unsupplied placeholder is a resolution failure rather than literal text, so the tell that a
  // magic name was silently satisfied from the prototype is a SUCCESS here, not a wrong string:
  // `Object.prototype.toString` would have interpolated as "function toString() { [native code] }".
  const missing = s.getResult("Echo", {});
  assert.equal(missing.failureReason, "resolution-failure");
  assert.equal(missing.translation, "Echo");
});

test("an unconfigured tiebreaker map reads as an empty record, not null", () => {
  // `LocaleConfiguration` in plan 3.2 types `tiebreakers` as a record, not a nullable one. A reader
  // about to iterate it should not have to null-check first.
  const { tiebreakers } = en({ K: "v" }).getLocaleConfiguration();
  assert.deepEqual({ ...tiebreakers }, {});
  assert.equal(Object.getPrototypeOf(tiebreakers), null);
});

test("tiebreakers are snapshotted into a frozen null-prototype record", () => {
  // Plan 4.3 names tiebreaker output among the records that must be "defensively copied, frozen
  // null-prototype". Holding the caller's object let an instance's reported configuration change
  // under it with no call into the library at all.
  const supplied = { es: ["es-MX"] };
  const s = createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: { en: { K: "v" }, "es-MX": { K: "v" } },
    tiebreakers: supplied,
  });

  const { tiebreakers } = s.getLocaleConfiguration();
  assert.equal(Object.getPrototypeOf(tiebreakers), null);
  assert.ok(Object.isFrozen(tiebreakers) && Object.isFrozen(tiebreakers.es));

  supplied.es.push("es-AR");
  assert.deepEqual([...s.getLocaleConfiguration().tiebreakers.es], ["es-MX"]);
});

test("a Map is accepted wherever a keyed record is, per plan 3.2", () => {
  const s = createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: { en: { K: "v" }, "es-MX": { K: "v" } },
    tiebreakers: new Map([["es", ["es-MX"]]]),
  });
  assert.deepEqual([...s.getLocaleConfiguration().tiebreakers.es], ["es-MX"]);

  // ...including a placeholder map on a programmatic definition, which is what plan 4.3 recommends
  // when placeholder names come from a generated or untrusted source.
  const defined = defineLocalizedString({
    key: "K",
    translation: "{{__proto__}}",
    placeholders: new Map([["__proto__", { kind: "expression", translation: "ok" }]]),
  });
  assert.equal(en([defined]).get("K"), "ok");
});

// --- falsy placeholder values ---------------------------------------------------------------------

test("0, empty string and false are values, not absences", () => {
  // The classic `??`-versus-`||` bug. Every one of these is a legitimate value a caller supplies, and
  // treating any of them as missing leaves the raw `{{token}}` in user-visible text.
  const s = en([{ key: "K", translation: "[{{n}}][{{s}}][{{b}}][{{z}}]" }]);
  const expected = "[0][][false][0n]";

  assert.equal(s.get("K", { n: 0, s: "", b: false, z: 0n }), expected.replace("0n", "0"));
  assert.equal(s.get("K", new Map([["n", 0], ["s", ""], ["b", false], ["z", 0n]])), expected.replace("0n", "0"));

  // The stakes: an unsupplied placeholder is a RESOLUTION FAILURE, not literal text, so a falsy
  // value mistaken for an absence does not merely print `{{n}}` — it loses the whole translation.
  const absent = s.getResult("K", { n: null, s: undefined, b: false, z: 0 });
  assert.equal(absent.failureReason, "resolution-failure");
  assert.equal(s.getResult("K", { n: 0, s: "", b: false, z: 0 }).failureReason, null);
});

test("a falsy value still drives selection and still reaches a returned key", () => {
  const s = en([
    {
      key: "Books",
      translation: "{{books}}",
      placeholders: {
        books: {
          kind: "language-form",
          value: "count",
          translations: { CARDINALITY_ONE: "one book", CARDINALITY_OTHER: "no books at all" },
        },
      },
    },
  ]);

  assert.equal(s.get("Books", { count: 0 }), "no books at all", "zero must classify, not go missing");

  // The returned key is a template too, and a falsy value belongs in it.
  assert.equal(s.get("Missing {{count}} and {{label}}", { count: 0, label: "" }), "Missing 0 and ");
});

test("a placeholder mistake inside an alternative names the same node through either door", () => {
  // The premise of routing programmatic values through the file parser's own validators is that one
  // authoring mistake produces one diagnostic. `modelPlaceholderShape` reported the ROOT key where
  // `parseNode` reports the NODE key, so inside a whole-message alternative — where the node key is
  // the alternative's expression — the two doors disagreed about which node was at fault.
  const strip = (fn) => {
    try {
      fn();
      return "no error";
    } catch (error) {
      return String(error instanceof Error ? error.message : error).replace(/^(<defined>|S): /, "");
    }
  };

  const fromFile = strip(() =>
    parseStrings('{"k":{"alternatives":[{"count == 1":{"translation":"t","placeholders":{"n":1}}}]}}',
      { locale: "en", source: "S" }));
  const fromModel = strip(() =>
    defineCatalog([{ key: "k", alternatives: [
      { expression: "count == 1", translation: "t", placeholders: { n: 1 } },
    ] }]));

  assert.match(fromFile, /Key is 'count == 1'/);
  assert.equal(fromModel, fromFile);
});
