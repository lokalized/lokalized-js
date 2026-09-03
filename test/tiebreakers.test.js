// @ts-check

/**
 * `createStrings({ tiebreakers })`'s construction-time rules.
 *
 * A tiebreaker says which of two catalogs sharing a language code serves a broad request for it.
 * Java treats a missing one as a configuration error rather than a preference: `DefaultStrings`
 * refuses `en` beside `en-US` outright (DefaultStrings.java:412-430) instead of building an
 * instance whose resolution order falls out of catalog insertion order.
 *
 * The corpus cannot gate any of this. Every constructing fixture that loads two locales sharing a
 * language code also supplies tiebreakers, and the four fixtures that do not are `loadOnly` — Java
 * parsed their strings files and never built a `Strings` from them. So the rules below were read off
 * the real `DefaultStrings` on the pinned JDK, and the messages are asserted against what it
 * printed, not against what the port happens to say.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";

/** @param {Record<string, unknown>} strings @param {Record<string, string[]>} [tiebreakers] */
const build = (strings, tiebreakers) =>
  createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings,
    ...(tiebreakers ? { tiebreakers } : {}),
  });

const EN_PAIR = { en: { K: "a" }, "en-US": { K: "b" } };

describe("createStrings({ tiebreakers }) — ambiguity is refused at construction", () => {
  it("refuses two locales sharing a language code with no tiebreakers", () => {
    // The report that opened this gap: JS built the instance and answered lookups.
    assert.throws(() => build(EN_PAIR), {
      name: "RangeError",
      message:
        "You must specify tiebreaker locales via createStrings({ tiebreakers }) to resolve " +
        "ambiguity for language code 'en' because localized strings exist for the following " +
        "locale[s]: [en, en-US]",
    });
  });

  it("builds the same catalogs once a tiebreaker orders them", () => {
    const strings = build(EN_PAIR, { en: ["en-US", "en"] });

    assert.deepEqual(strings.getSupportedLocales(), ["en", "en-US"]);

    // What the pinned JDK answers for this exact configuration. `en-GB` is served by `en` rather
    // than by the first tiebreaker, because truncating the region lands on a loaded locale and the
    // tiebreaker is never consulted — the order matters where two locales are equally reachable,
    // which the corpus already exercises. What is being pinned here is that supplying the order at
    // all is what makes the instance legal.
    assert.equal(strings.get("K"), "a");
    assert.equal(strings.get("K", undefined, { locale: "en-GB" }), "a");
    assert.equal(strings.get("K", undefined, { locale: "en-US" }), "b");
  });

  it("groups by CANONICAL language code, so `mo` and `ro` collide", () => {
    // Not a spelling collision: CLDR canonicalizes `mo` to `ro`, so one language code carries both
    // and a request for `ro` has the same two answers `en` had. Java refuses this pair too.
    assert.throws(() => createStrings({ fallbackLocale: "ro", locale: "ro", strings: { mo: { K: "a" }, ro: { K: "b" } } }), {
      message: /language code 'ro' because localized strings exist for the following locale\[s\]: \[mo, ro\]/,
    });
  });

  it("accepts a language code carried by exactly one locale — it is its own tiebreaker", () => {
    // The identity case. Every ordinary multi-language catalog set lands here, which is why the
    // rule is "more than one locale per language code" and not "every language code".
    const strings = build({ en: { K: "a" }, fr: { K: "b" }, "de-CH": { K: "c" } });

    assert.equal(strings.get("K"), "a");
    assert.equal(strings.get("K", undefined, { locale: "de" }), "c");
  });

  it("accepts two private-use tags, which have no language code to be ambiguous about", () => {
    // `LocaleUtils.normalizedLanguage` reports nothing for `x-*`. Such a catalog can be selected
    // exactly but never by broadening, so no tiebreaker could apply.
    const strings = build({ en: { K: "a" }, "x-a": { K: "b" }, "x-b": { K: "c" } });

    assert.equal(strings.get("K", undefined, { locale: "x-b" }), "c");
  });
});

describe("createStrings({ tiebreakers }) — a supplied list must be an exact permutation", () => {
  it("refuses a list that omits a loaded locale", () => {
    assert.throws(() => build(EN_PAIR, { en: ["en"] }), {
      name: "RangeError",
      message:
        "Tiebreaker locales for language code 'en' must be an exact permutation of loaded " +
        "locales [en, en-US]; missing: [en-US]; unrelated: []",
    });
  });

  it("refuses a list naming a locale that was never loaded", () => {
    assert.throws(() => build(EN_PAIR, { en: ["en", "en-US", "en-GB"] }), {
      name: "RangeError",
      message:
        "Tiebreaker locales for language code 'en' must be an exact permutation of loaded " +
        "locales [en, en-US]; missing: []; unrelated: [en-GB]",
    });
  });

  it("reports an empty list as a permutation failure, not as a missing tiebreaker", () => {
    // Java's order, and it is observable: the permutation check runs over what was supplied before
    // the ambiguity check runs over what was loaded, so `[]` is a wrong list rather than no list.
    assert.throws(() => build(EN_PAIR, { en: [] }), {
      message: /must be an exact permutation of loaded locales \[en, en-US\]; missing: \[en, en-US\]; unrelated: \[\]/,
    });
  });

  it("refuses a language code with no loaded locales at all", () => {
    assert.throws(() => build({ en: { K: "a" } }, { fr: ["fr"] }), {
      name: "RangeError",
      message: "Tiebreaker language code 'fr' has no localized strings locales",
    });
  });

  it("compares normalized locales, not the caller's spelling", () => {
    // Java compares `Locale` instances, so `en-us` and `EN` are the same configuration as
    // `en-US` and `en`. Refusing this pair over a lowercase region would reject an instance Java
    // builds.
    assert.equal(build(EN_PAIR, { EN: ["en-us", "en"] }).get("K"), "a");
  });

  it("holds a single-locale language code to the same permutation rule once one is supplied", () => {
    assert.throws(() => build({ en: { K: "a" } }, { en: ["en", "en-US"] }), {
      message: /must be an exact permutation of loaded locales \[en\]; missing: \[\]; unrelated: \[en-US\]/,
    });
  });
});
