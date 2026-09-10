import assert from "node:assert/strict";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { CONSTRUCT_REFUSAL_ADAPTATIONS } from "../tools/construct-refusals.mjs";

/**
 * `DefaultStrings`' construction-time validation, and the table that adapts Java's wording to this
 * library's.
 *
 * The corpus family `owed-construct` observes seven degenerate builder configurations plus one
 * control, and the conformance runner compares the refusal IDENTITY — error type and message — after
 * mapping Java's recorded pair through `tools/construct-refusals.mjs`. That mapping is only worth
 * anything while both ends hold: the runner keys it on the JAVA side exactly and fails on a stale
 * entry, and THIS FILE holds the JS side, by driving `createStrings` with the same degeneracy each
 * fixture builds and asserting the port raises the entry's `jsType`/`jsMessage` verbatim.
 *
 * Without this, the table could be edited to match a port that had silently changed its wording, and
 * the conformance family would stay green while the library's diagnostics drifted. With it, the two
 * files have to be changed together and the change is visible in both diffs.
 *
 * `SUBJECTS` mirrors `VectorOracle.buildStrings`' closed `constructionOverrides` set. Every table
 * entry must appear here (asserted below), so an entry added without an input that reaches it fails
 * rather than sitting unexercised — the same staleness rule the runner applies from the other side.
 */
const CATALOG = { Greeting: { translation: "Hello" } };
const BASE = { fallbackLocale: "en", locale: "en", strings: { en: CATALOG } };
/** Two catalogs under one language code: the state every tiebreaker rule below is about. */
const AMBIGUOUS = {
  fallbackLocale: "en",
  locale: "en",
  strings: { en: CATALOG, "en-US": { Greeting: { translation: "Howdy" } } },
};

/** @type {Record<string, () => unknown>} keyed by the `DefaultStrings.java` site the table names */
const SUBJECTS = {
  // :250 -- no catalog source at all.
  "DefaultStrings.java:250": () => createStrings({ fallbackLocale: "en", locale: "en" }),
  // :254 -- the both-ABSENT arm of "exactly one of".
  "DefaultStrings.java:254": () => createStrings({ fallbackLocale: "en", strings: { en: CATALOG } }),
  // :262 -- the catalog source present and null.
  "DefaultStrings.java:262": () => createStrings({ ...BASE, strings: null }),
  // :273 -- a null locale key, which needs a Map.
  "DefaultStrings.java:273": () =>
    createStrings({ ...BASE, strings: new Map([[null, CATALOG]]) }),
  // :280 -- two keys whose tags differ only in variant case, so they collide once lowercased.
  "DefaultStrings.java:280": () =>
    createStrings({ ...BASE, strings: { "en-US-POSIX": CATALOG, "en-US-posix": CATALOG } }),
  // :286 -- a null catalog for one locale.
  "DefaultStrings.java:286": () => createStrings({ ...BASE, strings: { en: null } }),
  // :293 -- a null entry inside an otherwise valid catalog.
  "DefaultStrings.java:293": () =>
    createStrings({ ...BASE, strings: { en: [{ key: "Greeting", translation: "Hello" }, null] } }),

  // The `owed-init` half: the fallback and tiebreaker rules of the same constructor. AMBIGUOUS is
  // the shape all four tiebreaker-list rules need -- two catalogs under one language code -- and it
  // is deliberately the SAME shape the control below constructs from, so each refusal differs from
  // an accepting instance in exactly one field.
  // :309 -- the fallback locale names no loaded catalog.
  "DefaultStrings.java:309": () =>
    createStrings({ fallbackLocale: "de", locale: "en", strings: { en: CATALOG } }),
  // :329 -- two tiebreaker language codes that canonicalize alike. `mo`/`ro` is a CLDR alias pair,
  // not a JDK legacy one, so a port that only did the JDK's own he->iw mapping still accepts it.
  "DefaultStrings.java:329": () =>
    createStrings({
      fallbackLocale: "ro",
      locale: "ro",
      strings: { ro: CATALOG },
      tiebreakers: { mo: ["mo"], ro: ["ro"] },
    }),
  // :349 -- a repeated locale inside one tiebreaker list.
  "DefaultStrings.java:349": () =>
    createStrings({ ...AMBIGUOUS, tiebreakers: { en: ["en", "en-US", "en"] } }),
  // :388 -- a tiebreaker language code with no loaded catalogs at all.
  "DefaultStrings.java:388": () => createStrings({ ...BASE, tiebreakers: { pt: ["pt-BR"] } }),
  // :394, first disjunct -- the list is a strict subset, so the SIZES differ.
  "DefaultStrings.java:394 (size disjunct)": () =>
    createStrings({ ...AMBIGUOUS, tiebreakers: { en: ["en"] } }),
  // :394, second disjunct -- right size, wrong membership, so only set equality fails.
  "DefaultStrings.java:394 (membership disjunct)": () =>
    createStrings({ ...AMBIGUOUS, tiebreakers: { en: ["en", "en-GB"] } }),
  // :426 -- two catalogs share a language code and no tiebreakers were supplied at all.
  "DefaultStrings.java:426": () => createStrings(AMBIGUOUS),
  // :335 -- a null tiebreaker locale LIST.
  "DefaultStrings.java:335": () => createStrings({ ...BASE, tiebreakers: { en: null } }),
  // :343 -- a null entry INSIDE a tiebreaker list.
  "DefaultStrings.java:343": () => createStrings({ ...BASE, tiebreakers: { en: [null] } }),
  // :2650 -- a NULL language code, which only the Map half of `TiebreakerMap` can present.
  "DefaultStrings.java:2650": () =>
    createStrings({ ...BASE, tiebreakers: new Map([[null, ["en"]]]) }),
  // :500 -- the same key twice in one locale's ARRAY catalog. A record cannot express it.
  "DefaultStrings.java:500": () =>
    createStrings({
      ...BASE,
      strings: {
        en: [
          { key: "Greeting", translation: "Hello" },
          { key: "Greeting", translation: "Hello" },
        ],
      },
    }),
  // :465 -- the fallback tag is canonically equivalent to MORE THAN ONE loaded catalog. Only the
  // undetermined language reaches it: `und-bokmal` and `und-nynorsk` both canonicalize to `und`,
  // and neither enters a language bucket, so no tiebreaker list can disambiguate them.
  "DefaultStrings.java:465": () =>
    createStrings({
      fallbackLocale: "und",
      locale: "und-bokmal",
      strings: { "und-bokmal": CATALOG, "und-nynorsk": CATALOG },
    }),

  // The `owed-validator` half: `DefaultStrings:297` hands every supplied definition to
  // `LocalizedStringValidator`, so a catalog written in code -- plan 3.2's `LocalizedStringInput[]`,
  // never a file -- reaches six validations no loaded input can, because the loader refuses each of
  // them first with its own wording. Each subject below differs from CONTROL_MODEL in exactly one
  // member, which is what makes its refusal attributable to that member and nothing else.
  //
  // NOT routed through `defineLocalizedString`: that export validates eagerly, so every refusal
  // would come from the definition call rather than from `createStrings`, which is the site the
  // corpus recorded. Java's `LocalizedString.Builder.build()` validates nothing either.
  // :212 -- an EMPTY translations map.
  "LocalizedStringValidator.java:212": () =>
    createStrings({
      ...BASE,
      strings: {
        en: [
          {
            key: "Greeting",
            translation: "Hello {{itemCount}}",
            placeholders: { itemCount: { kind: "language-form", value: "count", translations: {} } },
          },
        ],
      },
    }),
  // :230 -- forms from TWO axes in one map.
  "LocalizedStringValidator.java:230": () =>
    createStrings({
      ...BASE,
      strings: {
        en: [
          {
            key: "Greeting",
            translation: "Hello {{itemCount}}",
            placeholders: {
              itemCount: {
                kind: "language-form",
                value: "count",
                translations: { CARDINALITY_ONE: "one", GENDER_MASCULINE: "masc" },
              },
            },
          },
        ],
      },
    }),
  // :233 -- a RANGE whose forms are not cardinal. ONE non-cardinal form, because two would be
  // refused by :230 a line earlier and this subject would assert a rule it never reached.
  "LocalizedStringValidator.java:233": () =>
    createStrings({
      ...BASE,
      strings: {
        en: [
          {
            key: "Greeting",
            translation: "Hello {{itemCount}}",
            placeholders: {
              itemCount: {
                kind: "language-form",
                range: { start: "first", end: "last" },
                translations: { GENDER_MASCULINE: "masc" },
              },
            },
          },
        ],
      },
    }),
  // :312 -- a generated-placeholder NAME that is not a valid identifier. Its definition is the
  // control's, so only the name can be the reason.
  "LocalizedStringValidator.java:312": () =>
    createStrings({
      ...BASE,
      strings: {
        en: [
          {
            key: "Greeting",
            translation: "Hello",
            placeholders: {
              "not a name": {
                kind: "language-form",
                value: "count",
                translations: { CARDINALITY_ONE: "one", CARDINALITY_OTHER: "other" },
              },
            },
          },
        ],
      },
    }),
  // :314 -- a name that IS a valid identifier and IS a reserved language-form constant.
  "LocalizedStringValidator.java:314": () =>
    createStrings({
      ...BASE,
      strings: {
        en: [
          {
            key: "Greeting",
            translation: "Hello",
            placeholders: {
              CARDINALITY_ONE: {
                kind: "language-form",
                value: "count",
                translations: { CARDINALITY_ONE: "one", CARDINALITY_OTHER: "other" },
              },
            },
          },
        ],
      },
    }),
  // validateTemplate -- a malformed placeholder REFERENCE in the root translation, the one refusal
  // of the six that Java raises with a cause retained (`invalid():327`'s caused arm).
  "LocalizedStringValidator.java:302 (validateTemplate)": () =>
    createStrings({
      ...BASE,
      strings: { en: [{ key: "Greeting", translation: "Hello {{" }] },
    }),
};

/**
 * The accepting neighbour of the six validator subjects above, asserted below.
 *
 * A family of refusals proves only that something was refused; this proves the SHAPES they degenerate
 * are otherwise accepted, so each refusal is attributable to its one degeneracy. It is the same
 * `definedCatalog` the corpus fixture `owed-validator-base` carries.
 */
const CONTROL_MODEL = [
  { key: "Greeting", translation: "Hello" },
  {
    key: "Items",
    translation: "{{itemCount}} items",
    placeholders: {
      itemCount: {
        kind: "language-form",
        value: "count",
        translations: { CARDINALITY_ONE: "one", CARDINALITY_OTHER: "other" },
      },
    },
  },
  { key: "Alt", translation: "Fallback", alternatives: [{ expression: "count == 1", translation: "One" }] },
];

test("the construct-refusal table's JS half is what createStrings actually raises", async (t) => {
  for (const entry of CONSTRUCT_REFUSAL_ADAPTATIONS) {
    await t.test(`${entry.site} — ${entry.jsType}`, () => {
      const subject = SUBJECTS[entry.site];
      assert.ok(subject, `no input in this file reaches ${entry.site}`);

      // Not `assert.throws({ message })`, which would accept a prefix on a RegExp and gives no hold
      // on the constructor NAME the runner compares. The runner reads `error.constructor.name`, so
      // that is what is asserted here.
      let thrown = null;
      try {
        subject();
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, `${entry.site} constructed instead of refusing`);
      assert.equal(thrown.constructor.name, entry.jsType);
      assert.equal(thrown.message, entry.jsMessage);
    });
  }
});

test("every declared adaptation has an input here, and every input a declaration", () => {
  const declared = CONSTRUCT_REFUSAL_ADAPTATIONS.map((entry) => entry.site).sort();
  assert.deepEqual(Object.keys(SUBJECTS).sort(), declared);
});

test("the programmatic control constructs, so each validator refusal names its one degeneracy", () => {
  const strings = createStrings({ ...BASE, strings: { en: CONTROL_MODEL } });
  assert.equal(strings.get("Greeting"), "Hello");
});

test("the control constructs and ANSWERS, which is what makes the refusals readable", () => {
  // The corpus control records `probe: { value: "Hello", threwType: null }` rather than merely
  // `constructed: true`, because a family of seven refusals with no accepting neighbour proves only
  // that something was refused.
  const strings = createStrings(BASE);
  assert.equal(strings.get("Greeting"), "Hello");
});

test("the locale-source rule is ONE rule: none and both are refused by the same check", () => {
  // B3 landed the at-most-one half and B4 the at-least-one half, and they must not drift into two
  // diagnostics for one proposition — `DefaultStrings.java:254` is a single
  // `(localeSupplier == null) == (localeMatchSupplier == null)`.
  assert.throws(
    () => createStrings({ fallbackLocale: "en", strings: { en: CATALOG } }),
    {
      name: "RangeError",
      message:
        "createStrings requires exactly one of 'locale', 'localeResolver' or 'localeMatchResolver'; " +
        "received none",
    },
  );
  assert.throws(
    () =>
      createStrings({
        fallbackLocale: "en",
        strings: { en: CATALOG },
        localeResolver: () => "en",
        localeMatchResolver: () => ({}),
      }),
    {
      name: "RangeError",
      message:
        "createStrings requires exactly one of 'locale', 'localeResolver' or 'localeMatchResolver'; " +
        "received [localeResolver, localeMatchResolver]",
    },
  );
});

test("a catalog key colliding only after normalization is refused too", () => {
  // The lowercase collision is not only about variant case. `normalizeTag` canonicalizes region
  // case, so `en-us` and `en-US` are ONE loaded locale — which used to be the "Duplicate localized
  // strings" refusal and is now the same `:280` message, because Java has one check for both and a
  // caller who wrote the same locale twice should not have to learn two diagnostics.
  //
  // THE FIRST TWO SLOTS ARE THE CALLER'S RAW KEYS, and this assertion is where that is pinned. It
  // read `'en-US' and 'en-US'` until this session — the duplicate map stored the NORMALIZED tag, so
  // the message named the same tag three times and neither of the two spellings the caller actually
  // wrote appeared anywhere in it. Nothing was actionable in it: a caller staring at
  // `'en-US' and 'en-US'` cannot tell which of their keys to change. The third slot stays the
  // NORMALIZED tag, which is what Java prints there (`locale.toLanguageTag()`).
  assert.throws(
    () => createStrings({ ...BASE, strings: new Map([["en-us", CATALOG], ["en-US", CATALOG]]) }),
    {
      name: "RangeError",
      message:
        "Localized strings locales 'en-us' and 'en-US' both use IETF BCP 47 language tag 'en-US'",
    },
  );

  // The mirror image, so the assertion above pins "the caller's own keys, in the order they were
  // supplied" rather than a fixed pair of strings: swapping the two keys swaps the first two slots.
  //
  // The THIRD slot does not swap, and that is the discriminating half of this pair: it stays
  // `en-US` in both orders because it is `normalizeTag` of the second key, and `normalizeTag`
  // canonicalizes region case. A port that printed the raw key in all three slots would pass the
  // assertion above and fail this one.
  assert.throws(
    () => createStrings({ ...BASE, strings: new Map([["en-US", CATALOG], ["en-us", CATALOG]]) }),
    {
      name: "RangeError",
      message:
        "Localized strings locales 'en-US' and 'en-us' both use IETF BCP 47 language tag 'en-US'",
    },
  );
});

test("a well-formed variant catalog still loads — the collision rule is not a variant ban", () => {
  // THE CONTROL FOR :280, and the reason it is here: a rule that lowercased tags into the catalog
  // MAP rather than into a collision index would also pass the refusal test above while quietly
  // renaming every variant catalog. This one is expected to construct.
  const strings = createStrings({
    fallbackLocale: "en-US-POSIX",
    locale: "en-US-POSIX",
    strings: { "en-US-POSIX": CATALOG },
  });

  assert.equal(strings.get("Greeting"), "Hello");
  assert.deepEqual(strings.getLocaleConfiguration().supportedLocales, ["en-US-POSIX"]);
});
