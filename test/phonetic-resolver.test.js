// @ts-check

/**
 * The phonetic axis: the one language form whose selection runs CALLER CODE.
 *
 * Every other axis is a pure function of the value the caller passed. Phonetics are not: a raw
 * string is a TERM, and classifying it means calling back into the application, in the middle of a
 * lookup, with a locale the application never named. Three things follow, and each is checked here
 * rather than only through the corpus runner, because each is invisible in a rendered string:
 *
 *   - WHICH locale the resolver is handed. The donor rule says the SUPPLYING catalog's locale, so a
 *     `de` request served by the `en` fallback hands the resolver `en`. A port that passed the
 *     requested tag renders identically whenever the two agree, which is most of the time.
 *   - HOW MANY times it runs, and in what order. Resolution is lazy, driven by the order the
 *     TEMPLATE mentions placeholders, deduplicated by placeholder NAME and never by term.
 *   - WHETHER it runs at all. An unconfigured resolver is a throwing default, not a construction
 *     error, so a catalog with an unreachable phonetic definition still renders.
 *
 * Corpus counterparts: `phonetic-resolver.*` and `resolver-locale.*`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { render } from "../src/internal/interpolate.js";
import { parseCatalog } from "../src/internal/catalog.js";
import { PHONETIC_CONSONANT, PHONETIC_VOWEL, GENDER_FEMININE, CARDINALITY_ONE } from "../src/index.js";

/** The four branches every fixture below selects among. */
const ONSETS = {
  PHONETIC_VOWEL: "an",
  PHONETIC_CONSONANT: "a",
  PHONETIC_S_IMPURE: "uno",
  PHONETIC_OTHER: "the",
};

/** A resolver that records what it was handed and answers from a term table. */
function recordingResolver(byTerm, fallback = PHONETIC_CONSONANT) {
  /** @type {{ term: string, locale: string }[]} */
  const calls = [];
  const resolve = (/** @type {string} */ term, /** @type {string} */ locale) => {
    calls.push({ term, locale });
    return Object.hasOwn(byTerm, term) ? byTerm[term] : fallback;
  };
  return { calls, resolve };
}

const ARTICLE = {
  Article: {
    translation: "{{a}} thing",
    placeholders: { a: { value: "term", translations: ONSETS } },
  },
};

describe("phonetic resolver: what it is called with", () => {
  it("hands the resolver the raw term and the EVALUATION locale", () => {
    const resolver = recordingResolver({ apple: PHONETIC_VOWEL });
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: resolver.resolve,
    });

    assert.equal(strings.get("Article", { term: "apple" }), "an thing");
    assert.deepEqual(resolver.calls, [{ term: "apple", locale: "en" }]);
  });

  it("hands the DONOR locale over, not the requested one", () => {
    // `de` is not loaded, so the `en` catalog supplies the entry. Java's
    // `shouldApplyBidiIsolation`/`getInternal` pair both take the evaluation locale, and
    // `resolver-locale.fallback.de-request-served-by-en-fallback` records `en` reaching the
    // resolver. Passing `de` here would render exactly the same string.
    const resolver = recordingResolver({ apple: PHONETIC_VOWEL });
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: resolver.resolve,
    });

    assert.equal(strings.get("Article", { term: "apple" }, { locale: "de" }), "an thing");
    assert.deepEqual(resolver.calls, [{ term: "apple", locale: "en" }]);
  });

  it("treats a string that spells a constant as an ordinary term", () => {
    // The asymmetry that makes phonetics different from every other axis, and the corpus pins it as
    // `phonetic-resolver.input.string-spelling-a-constant`: `"PHONETIC_VOWEL"` is fifteen characters
    // handed to the resolver, not a language form. Sniffing it would be a silent security-shaped
    // bug — caller DATA choosing a catalog branch.
    const resolver = recordingResolver({});
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: resolver.resolve,
    });

    assert.equal(strings.get("Article", { term: "PHONETIC_VOWEL" }), "a thing");
    assert.deepEqual(resolver.calls, [{ term: "PHONETIC_VOWEL", locale: "en" }]);
  });

  it("never calls the resolver for an explicitly tagged phonetic value", () => {
    const resolver = recordingResolver({});
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: resolver.resolve,
    });

    assert.equal(strings.get("Article", { term: PHONETIC_VOWEL }), "an thing");
    assert.deepEqual(resolver.calls, []);
  });

  it("names the axis type in the rejection, the way Java names the runtime class", () => {
    // Java's message ends in `getClass().getSimpleName()`, and the port copies the message
    // verbatim — so the last word must be filled in wherever the port can know it. A TAGGED
    // language form always can: it carries its own axis, and the axis IS the Java class.
    // `phonetic-resolver.input.tagged-gender` and `.tagged-cardinality` record `Gender` and
    // `Cardinality`; a bare "a tagged 'language-form' value" there is a half-finished port, and it
    // also tells the caller nothing about which axis they actually passed.
    //
    // `5` stays `number` on purpose: one JS number is both Java's `Integer` and its `Double`, so
    // there is no honest single answer and the JS-idiomatic description is the truthful one.
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: () => PHONETIC_VOWEL,
    });

    for (const [value, expected] of [
      [GENDER_FEMININE, "Gender"],
      [CARDINALITY_ONE, "Cardinality"],
      [5, "number"],
    ]) {
      const result = strings.getResult("Article", { term: value });
      assert.equal(result.failureReason, "resolution-failure");
      assert.match(
        String(result.cause?.message),
        new RegExp(`must be a Phonetic or CharSequence but was ${expected}$`),
      );
    }
  });

  it("never calls the resolver for a value that is neither a term nor a phonetic form", () => {
    for (const value of [5, true, GENDER_FEMININE]) {
      const resolver = recordingResolver({});
      const strings = createStrings({
        fallbackLocale: "en",
        locale: "en",
        strings: { en: ARTICLE },
        phoneticResolver: resolver.resolve,
      });
      const result = strings.getResult("Article", { term: value });

      assert.equal(result.failureReason, "resolution-failure");
      assert.deepEqual(resolver.calls, [], `${String(value)} must not reach the resolver`);
    }
  });
});

describe("phonetic resolver: how often it is called", () => {
  const ORDER_CATALOG = {
    // Template order is the OPPOSITE of definition order, and the two placeholders read different
    // sources, so the recorded call order can tell them apart.
    Reversed: {
      translation: "{{x}}-{{y}}",
      placeholders: {
        x: { value: "t1", translations: ONSETS },
        y: { value: "t2", translations: ONSETS },
      },
    },
    Repeated: {
      translation: "{{x}} {{x}}",
      placeholders: { x: { value: "t1", translations: ONSETS } },
    },
    SameSource: {
      translation: "{{x}}+{{y}}",
      placeholders: {
        x: { value: "t1", translations: ONSETS },
        y: { value: "t1", translations: ONSETS },
      },
    },
    Unreferenced: {
      translation: "no placeholder here",
      placeholders: { x: { value: "t1", translations: ONSETS } },
    },
  };

  const stringsWith = (resolver) =>
    createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ORDER_CATALOG },
      phoneticResolver: resolver,
    });

  it("resolves in TEMPLATE order, not definition order", () => {
    const resolver = recordingResolver({ apple: PHONETIC_VOWEL });
    stringsWith(resolver.resolve).get("Reversed", { t1: "apple", t2: "book" });
    assert.deepEqual(resolver.calls.map((c) => c.term), ["apple", "book"]);
  });

  it("resolves one placeholder once however often the template names it", () => {
    const resolver = recordingResolver({ apple: PHONETIC_VOWEL });
    const value = stringsWith(resolver.resolve).get("Repeated", { t1: "apple" });
    assert.equal(value, "an an");
    assert.equal(resolver.calls.length, 1);
  });

  it("does NOT memoize by term: two placeholders on one source resolve twice", () => {
    // The exact complement of the case above, and the pair is what pins the dedup key as the
    // placeholder NAME. Caching on the term would pass the previous test and fail this one.
    const resolver = recordingResolver({ apple: PHONETIC_VOWEL });
    const value = stringsWith(resolver.resolve).get("SameSource", { t1: "apple" });
    assert.equal(value, "an+an");
    assert.equal(resolver.calls.length, 2);
  });

  it("never resolves a definition the selected template does not name", () => {
    const resolver = recordingResolver({});
    const value = stringsWith(resolver.resolve).get("Unreferenced", { t1: "apple" });
    assert.equal(value, "no placeholder here");
    assert.deepEqual(resolver.calls, []);
  });
});

describe("phonetic resolver: absent, misbehaving, and misconfigured", () => {
  it("is a resolution failure when unconfigured and reached, not a construction error", () => {
    const strings = createStrings({ fallbackLocale: "en", locale: "en", strings: { en: ARTICLE } });
    const result = strings.getResult("Article", { term: "apple" });

    assert.equal(result.failureReason, "resolution-failure");
    assert.equal(result.status, "returned-key");
    assert.match(String(result.cause?.message), /phoneticResolver/);
  });

  it("renders happily when unconfigured and never reached", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Plain: { translation: "hello", placeholders: { a: { value: "term", translations: ONSETS } } } } },
    });

    assert.equal(strings.get("Plain", { term: "apple" }), "hello");
  });

  it("rejects a null return, and a bare string that merely spells a category", () => {
    // Section 3.7: the resolver must return a TAGGED phonetic value. `"VOWEL"` and
    // `"PHONETIC_VOWEL"` are both invalid, and accepting either would re-open the string-sniffing
    // hole the input side closes.
    for (const bad of [null, undefined, "VOWEL", "PHONETIC_VOWEL", GENDER_FEMININE]) {
      const strings = createStrings({
        fallbackLocale: "en",
        locale: "en",
        strings: { en: ARTICLE },
        phoneticResolver: () => bad,
      });

      assert.equal(
        strings.getResult("Article", { term: "apple" }).failureReason,
        "resolution-failure",
        `a resolver returning ${JSON.stringify(bad)} must fail resolution`,
      );
    }
  });

  it("lets a thrown resolver error become the candidate's resolution failure", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: () => { throw new Error("resolver refuses"); },
    });
    const result = strings.getResult("Article", { term: "apple" });

    assert.equal(result.failureReason, "resolution-failure");
    // Identity is preserved down the cause chain: the application's own error is still in there.
    let cause = result.cause;
    const messages = [];
    while (cause instanceof Error) {
      messages.push(cause.message);
      cause = cause.cause;
    }
    assert.ok(messages.includes("resolver refuses"), messages.join(" | "));
  });

  it("refuses a resolver that is not a function, at construction", () => {
    assert.throws(
      () => createStrings({
        fallbackLocale: "en",
        locale: "en",
        strings: { en: ARTICLE },
        phoneticResolver: /** @type {any} */ ("PHONETIC_VOWEL"),
      }),
      TypeError,
    );
  });
});

describe("phonetic resolver: the term is bounded before the resolver sees it", () => {
  it("checks the interpolated-output limit before calling out", () => {
    // Java bounds the term with `maximumInterpolatedOutputCharacters` via `CharSequenceUtils`, and
    // the check runs BEFORE `resolver.resolve` — so an over-long term produces no call at all. The
    // limit is not settable through `createStrings` in v1, so this drives the renderer directly.
    const definitions = parseCatalog(ARTICLE, { locale: "en", source: "en" });
    const definition = definitions.get("Article");
    assert.ok(definition);

    /** @type {string[]} */
    const seen = [];
    const context = {
      key: "Article",
      evaluationLocale: "en",
      maximumInterpolatedOutputCharacters: 8,
      phoneticResolver: (/** @type {string} */ term) => {
        seen.push(term);
        return PHONETIC_VOWEL;
      },
    };

    assert.equal(render(definition, { term: "aaaaaaaa" }, context), "an thing");
    assert.deepEqual(seen, ["aaaaaaaa"]);

    assert.throws(
      () => render(definition, { term: "aaaaaaaaa" }, context),
      /exceeds the maximum of 8 characters/,
    );
    assert.deepEqual(seen, ["aaaaaaaa"], "an over-long term must never reach the resolver");
  });
});

describe("phonetic resolver: expression operands take the same route", () => {
  const EXPRESSION_CATALOG = {
    "Expr.One": {
      translation: "default",
      alternatives: [{ "noun == PHONETIC_VOWEL": { translation: "alt-vowel" } }],
    },
  };

  it("classifies a raw operand through the resolver, under the donor locale", () => {
    const resolver = recordingResolver({ apple: PHONETIC_VOWEL });
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: EXPRESSION_CATALOG },
      phoneticResolver: resolver.resolve,
    });

    assert.equal(strings.get("Expr.One", { noun: "apple" }, { locale: "de" }), "alt-vowel");
    assert.deepEqual(resolver.calls, [{ term: "apple", locale: "en" }]);
  });

  it("bypasses the resolver for a tagged operand, even with none configured", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: EXPRESSION_CATALOG },
    });

    assert.equal(strings.get("Expr.One", { noun: PHONETIC_VOWEL }), "alt-vowel");
  });

  it("makes an unconfigured resolver a resolution failure of the candidate", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: EXPRESSION_CATALOG },
    });

    assert.equal(strings.getResult("Expr.One", { noun: "apple" }).failureReason, "resolution-failure");
  });
});
