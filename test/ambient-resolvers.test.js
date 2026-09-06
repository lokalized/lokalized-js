// @ts-check

/**
 * The locale INGRESS: `localeResolver` / `localeMatchResolver` on the instance, `locale` /
 * `localeMatch` per call, and the two-layer validation of a caller-supplied `LocaleMatchResult`.
 *
 * The corpus covers this ingress heavily — 131 rows install a supplier and 51 of those exist purely
 * to refuse a fabricated match — so most of what is asserted here is deliberately NOT a restatement
 * of that. Six things live here because the conformance runner structurally cannot see them:
 *
 *   - THE LAYER-TWO COMPARISON PRIMITIVE. This is the one that matters most, and it is MEASURED to
 *     be invisible to the corpus: replacing `normalizeTag` with `equivalentTags` in
 *     `validateSuppliedLocaleMatch` leaves conformance byte-identical at 1,746 passed / 0 FAILED,
 *     because every considered list in the corpus is spelled canonically. Java compares
 *     `Set<Locale>.equals`, so the JDK's own canonicalization applies and CLDR equivalence does not
 *     — re-probed on the pinned Corretto 21, where `forLanguageTag("iw")` IS `he` but `mo` is NOT
 *     `ro` and `tl` is NOT `fil`. That is the same shape as the two tiebreaker defects this repo
 *     found by hand-reading a file rather than by running the corpus, and the suite below is the
 *     only thing standing behind it.
 *   - THE CONSTRUCTION-TIME EXCLUSION of two locale sources. `DefaultStrings:254`'s both-present arm
 *     is DEAD in Java — `Strings.Builder`'s setters each null the other — so no oracle run can
 *     corroborate the JS refusal and no corpus row will ever reach it. It is a recorded decision.
 *   - THE PER-CALL EXCLUSION of `locale` and `localeMatch`, for the same reason: Java's counterpart
 *     state is decided by builder setter order, and the six corpus rows that record it are
 *     classified as having no JS counterpart precisely so that nothing here can be inferred from
 *     them.
 *   - A RESOLVER THAT RETURNS NULL, or one of the wrong shape. `VectorOracle` has no return-null
 *     behavior (plan open question 7), so the corpus cannot reach either.
 *   - `forLocaleMatch`. Nothing in the corpus calls it directly; the runner uses it to reproduce the
 *     ORACLE's ordering, which is a different claim from the function's own contract.
 *   - THE WEIGHTED-RANGE ROUND TRIP, in the only direction still blind. The corpus records
 *     `languageRange` as a bare string; since the B2/B3 repair the runner recovers the weight from
 *     the recorded `requestedLanguageRanges` — Java's constructor guarantees it is there — so 14
 *     runnable rows now DO compare the weight the port produces. What no row can see is the round
 *     trip itself: that the match `matchForLanguageRanges` returns survives being handed straight
 *     back through `{ localeMatch }`. Nothing in the corpus feeds a produced match into a lookup,
 *     and the port failed exactly that for every weighted range until the producer began emitting
 *     the pair. The test below is the whole guard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings, forLocaleMatch } from "../src/core/index.js";
import { createLocaleNegotiator } from "../src/negotiate/index.js";

/** Two catalogs, one key each, and a fallback that names a loaded one. */
const EN_FR = {
  fallbackLocale: "en",
  strings: {
    en: { "Greeting.Hello": "Hello", "Only.En": "en-only" },
    fr: { "Greeting.Hello": "Bonjour", "Only.Fr": "fr-only" },
  },
};

/** A structurally valid match selecting `fr` over the `EN_FR` configuration. */
const frMatch = () => ({
  requestedLanguageRanges: [{ range: "fr", weight: 1 }],
  locale: "fr",
  languageRange: "fr",
  effectiveWeight: 1,
  matchType: "exact",
  fallbackLocale: "en",
  consideredLocales: ["en", "fr"],
  isMatch: true,
});

const message = (/** @type {() => unknown} */ run) => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "NOTHING THROWN";
};

describe("createStrings — exactly one locale source", () => {
  it("refuses both resolvers in one object literal", () => {
    // The user's recorded decision, on `DefaultStrings:254`'s own proposition. Java cannot reach this
    // state through its builder, so nothing measures it; the argument is that an object literal is
    // the analogue of the CONSTRUCTOR, and last-key-wins would make behaviour depend on spread order.
    assert.throws(
      () => createStrings({ ...EN_FR, localeResolver: () => "en", localeMatchResolver: frMatch }),
      /exactly one of 'locale', 'localeResolver' or 'localeMatchResolver'/,
    );
  });

  it("refuses a constant locale beside a resolver", () => {
    assert.throws(
      () => createStrings({ ...EN_FR, locale: "en", localeResolver: () => "fr" }),
      /exactly one of/,
    );
    assert.throws(
      () => createStrings({ ...EN_FR, locale: "en", localeMatchResolver: frMatch }),
      /exactly one of/,
    );
  });

  it("accepts each source on its own — the control", () => {
    assert.equal(createStrings({ ...EN_FR, locale: "fr" }).get("Greeting.Hello"), "Bonjour");
    assert.equal(createStrings({ ...EN_FR, localeResolver: () => "fr" }).get("Greeting.Hello"), "Bonjour");
    assert.equal(createStrings({ ...EN_FR, localeMatchResolver: frMatch }).get("Greeting.Hello"), "Bonjour");
  });

  it("refuses a resolver that is not a function", () => {
    assert.throws(
      () => createStrings({ ...EN_FR, localeResolver: /** @type {any} */ ("fr") }),
      /localeResolver.*must be a function/s,
    );
    assert.throws(
      () => createStrings({ ...EN_FR, localeMatchResolver: /** @type {any} */ ({}) }),
      /localeMatchResolver.*must be a function/s,
    );
  });

  it("treats an explicitly null resolver as an omitted one", () => {
    // The `== null` rule every other option follows. Two sources are refused; a null one is not a
    // source at all, so `locale` still applies.
    const strings = createStrings({ ...EN_FR, locale: "fr", localeResolver: /** @type {any} */ (null) });
    assert.equal(strings.get("Greeting.Hello"), "Bonjour");
  });
});

describe("the ingress arms, and the asymmetry between them", () => {
  // The six-ingress table in miniature. `zh-TW` is not loaded; `zh-Hant` is. A locale SOURCE keeps
  // the requested tag and attempts it first; a MATCH source replaces it with the selection, so the
  // `zh-TW` step is simply not there. A port that picks one convention passes half of this.
  const ZH = {
    fallbackLocale: "en",
    tiebreakers: { zh: ["zh", "zh-Hant"] },
    strings: {
      zh: { "Checkout.Title": "结账" },
      "zh-Hant": { "Unrelated.Key": "無關" },
      en: { "Checkout.Title": "Checkout" },
    },
  };
  const zhHantMatch = (/** @type {ReturnType<typeof createStrings>} */ probe) =>
    probe.getDirectLocaleContext("zh-TW").localeMatch;

  it("a locale source keeps the REQUESTED tag as the lookup locale", () => {
    for (const options of [{ locale: "zh-TW" }, { localeResolver: () => "zh-TW" }]) {
      const result = createStrings({ ...ZH, ...options }).getResult("Checkout.Title");
      assert.equal(result.lookupLocale, "zh-TW");
      assert.deepEqual([...result.attemptedLocales], ["zh-TW", "zh-Hant", "en"]);
    }
  });

  it("a match source replaces it with the SELECTION", () => {
    const probe = createStrings({ ...ZH, locale: "en" });
    const match = zhHantMatch(probe);
    assert.equal(match.locale, "zh-Hant");

    const viaResolver = createStrings({ ...ZH, localeMatchResolver: () => match })
      .getResult("Checkout.Title");
    assert.equal(viaResolver.lookupLocale, "zh-Hant");
    assert.deepEqual([...viaResolver.attemptedLocales], ["zh-Hant", "en"]);

    const perCall = probe.getResult("Checkout.Title", undefined, { localeMatch: match });
    assert.equal(perCall.lookupLocale, "zh-Hant");
    assert.deepEqual([...perCall.attemptedLocales], ["zh-Hant", "en"]);
  });

  it("an unmatched supplied match looks up through its own fallback locale", () => {
    const strings = createStrings({
      ...EN_FR,
      localeMatchResolver: () => ({
        requestedLanguageRanges: [{ range: "de", weight: 1 }],
        locale: null,
        languageRange: null,
        effectiveWeight: null,
        matchType: "none",
        fallbackLocale: "en",
        consideredLocales: ["en", "fr"],
        isMatch: false,
      }),
    });
    const result = strings.getResult("Greeting.Hello");
    assert.equal(result.lookupLocale, "en");
    assert.equal(result.translation, "Hello");
    // `matchType: "none"` is one of the negotiation-fallback types, so the result reports a fallback
    // even though `en` is exactly what it resolved from.
    assert.equal(result.isFallback, true);
  });

  it("consults the resolver once per lookup and not at construction", () => {
    let calls = 0;
    const strings = createStrings({ ...EN_FR, localeResolver: () => { ++calls; return "fr"; } });
    assert.equal(calls, 0);
    strings.get("Greeting.Hello");
    strings.get("Greeting.Hello");
    assert.equal(calls, 2);
  });

  it("does not consult the resolver when a per-call locale is supplied", () => {
    // The absence IS the assertion: the resolver would throw if it ran.
    const strings = createStrings({
      ...EN_FR,
      localeMatchResolver: () => { throw new Error("the resolver must not be consulted"); },
    });
    assert.equal(strings.get("Greeting.Hello", undefined, { locale: "fr" }), "Bonjour");
    // Nor for the standalone diagnostic, which touches no callback at all.
    assert.equal(strings.getDirectLocaleContext("fr").localeMatch.locale, "fr");
  });

  it("refuses a resolver that answers null", () => {
    assert.throws(
      () => createStrings({ ...EN_FR, localeResolver: () => /** @type {any} */ (null) }).get("Greeting.Hello"),
      /localeResolver returned null/,
    );
    assert.throws(
      () => createStrings({ ...EN_FR, localeMatchResolver: () => /** @type {any} */ (null) }).get("Greeting.Hello"),
      /localeMatchResolver returned null/,
    );
  });

  it("refuses a per-call object naming both a locale and a localeMatch", () => {
    const strings = createStrings({ ...EN_FR, locale: "en" });
    assert.throws(
      () => strings.getResult("Greeting.Hello", undefined, { locale: "fr", localeMatch: frMatch() }),
      /names two locale sources/,
    );
  });
});

describe("layer one — LocaleMatchResult's own rules, and their order", () => {
  const refuse = (/** @type {Record<string, unknown>} */ overrides) =>
    message(() => forLocaleMatch(/** @type {any} */ ({ ...frMatch(), ...overrides })));

  it("accepts the valid control", () => {
    assert.equal(refuse({}), "NOTHING THROWN");
  });

  it("caps requested ranges at 32, and accepts exactly 32", () => {
    const ranges = (/** @type {number} */ n) =>
      Array.from({ length: n }, (_, i) => ({ range: i === 0 ? "fr" : `x${i}`, weight: 1 }));
    assert.equal(refuse({ requestedLanguageRanges: ranges(32) }), "NOTHING THROWN");
    assert.equal(
      refuse({ requestedLanguageRanges: ranges(33) }),
      "At most 32 language ranges are supported, but received 33",
    );
  });

  it("refuses an unmatched result carrying a range, a weight or a non-none type", () => {
    const unmatched = { locale: null, languageRange: null, effectiveWeight: null, matchType: "none", isMatch: false };
    assert.equal(refuse(unmatched), "NOTHING THROWN");
    for (const contradiction of [{ languageRange: "fr" }, { effectiveWeight: 1 }, { matchType: "exact" }])
      assert.equal(
        refuse({ ...unmatched, ...contradiction }),
        "An unmatched locale result must use NONE and omit range and weight",
      );
  });

  it("refuses a matched result missing a range, a weight or a non-none type", () => {
    for (const gap of [{ languageRange: null }, { effectiveWeight: null }, { matchType: "none" }])
      assert.equal(
        refuse(gap),
        "A matched locale result requires a range, weight, and non-NONE match type",
      );
  });

  it("refuses a matched range that is not among the requested ranges — WEIGHT INCLUDED", () => {
    // Re-probed on the pinned Corretto 21: `new LanguageRange("fr").equals(new LanguageRange("fr",
    // 0.5))` is FALSE, so Java's `List.contains` refuses this pair. A bare range string means weight
    // 1.0 — the one-argument constructor's own default.
    assert.equal(
      refuse({ languageRange: "de" }),
      "The matched language range must be present in requested language ranges",
    );
    assert.equal(
      refuse({ languageRange: "fr", requestedLanguageRanges: [{ range: "fr", weight: 0.5 }] }),
      "The matched language range must be present in requested language ranges",
    );
    // The pair form is how a caller hands back a match won by a weighted header range, and it is the
    // control that proves the rule is about identity and not about the weight being 1.
    assert.equal(
      refuse({
        languageRange: { range: "fr", weight: 0.5 },
        requestedLanguageRanges: [{ range: "fr", weight: 0.5 }],
        effectiveWeight: 0.5,
      }),
      "NOTHING THROWN",
    );
  });

  it("ROUND-TRIPS a match won by a weighted range back through the same instance", () => {
    // THE DEFECT THIS PINS. `matchForLanguageRanges` used to answer `languageRange: "fr"` — a bare
    // string, which layer one reads as weight 1.0 — beside `requestedLanguageRanges: [fr@0.5]`, so
    // the port produced a match its OWN validator refused with "The matched language range must be
    // present in requested language ranges". Conformance was byte-identical before and after the
    // fix on every row that RUNS today, because every per-call row that lands has a weight-1 winner.
    //
    // Reconstructing the weight from `effectiveWeight` at consumption time cannot fix it and must
    // not be tried: `supplied-match.range.identity-includes-weight` is a recorded row whose
    // effective weight is 0.5 against a range weight of 1.0, and Java REFUSES it. The range carries
    // its own weight or the two are conflated.
    const strings = createStrings({ ...EN_FR, locale: "en" });
    const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());

    for (const weight of [0.5, 0.7, 1]) {
      const match = negotiator.matchForLanguageRanges([{ range: "fr", weight }]);

      assert.deepEqual(match.languageRange, { range: "fr", weight },
        `the produced match must carry the governing range's OWN weight (q=${weight})`);
      assert.equal(strings.get("Greeting.Hello", undefined, { localeMatch: match }), "Bonjour",
        `a match won at q=${weight} must survive being handed straight back`);
      assert.equal(strings.get("Greeting.Hello", undefined, forLocaleMatch(match)), "Bonjour",
        `and must survive the forLocaleMatch door too (q=${weight})`);
    }
  });

  it("checks range containment BEFORE the weight bound", () => {
    // Both are wrong; the containment message is the one Java reports.
    assert.equal(
      refuse({ languageRange: "de", effectiveWeight: 0 }),
      "The matched language range must be present in requested language ranges",
    );
  });

  it("bounds the effective weight to (0, 1]", () => {
    for (const weight of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      assert.equal(
        refuse({ effectiveWeight: weight }),
        "A matched locale result requires a finite effective weight greater than 0 and at most 1",
      );
    assert.equal(refuse({ effectiveWeight: 1 }), "NOTHING THROWN");
    assert.equal(refuse({ effectiveWeight: 0.25 }), "NOTHING THROWN");
  });

  it("refuses duplicate considered locales, quoting the tag", () => {
    assert.equal(
      refuse({ consideredLocales: ["fr", "en", "fr"] }),
      "Considered locales must not contain duplicate language tag 'fr'",
    );
    // Two spellings of one locale collide, exactly as they do in Java, which lowercases
    // `toLanguageTag()` before the test.
    assert.equal(
      refuse({ consideredLocales: ["en", "fr", "FR"] }),
      "Considered locales must not contain duplicate language tag 'fr'",
    );
  });

  it("checks the duplicate rule BEFORE fallback containment", () => {
    assert.equal(
      refuse({ consideredLocales: ["fr", "fr"], locale: null, languageRange: null, effectiveWeight: null, matchType: "none", isMatch: false }),
      "Considered locales must not contain duplicate language tag 'fr'",
    );
  });

  it("requires the fallback and the selected locale to be considered", () => {
    // An EMPTY considered list fails HERE, on fallback containment — not later, on layer two's set
    // comparison. Folding the two layers into one check reports the wrong message on this row.
    assert.equal(
      refuse({ consideredLocales: [], locale: null, languageRange: null, effectiveWeight: null, matchType: "none", isMatch: false }),
      "The fallback locale must be present in considered locales",
    );
    assert.equal(
      refuse({ consideredLocales: ["en"] }),
      "The selected locale must be present in considered locales",
    );
  });

  it("refuses an isMatch that contradicts the selection", () => {
    assert.equal(
      refuse({ isMatch: false }),
      "forLocaleMatch(localeMatch) isMatch must be true exactly when a locale was selected",
    );
  });

  it("validates a hand-written per-call localeMatch the same way", () => {
    const strings = createStrings({ ...EN_FR, locale: "en" });
    assert.throws(
      () => strings.getResult("Greeting.Hello", undefined,
        { localeMatch: /** @type {any} */ ({ ...frMatch(), effectiveWeight: 0 }) }),
      /finite effective weight greater than 0/,
    );
  });
});

describe("layer two — the instance's own check", () => {
  const refuse = (/** @type {Record<string, unknown>} */ overrides, /** @type {any} */ config = EN_FR) =>
    message(() =>
      createStrings({ ...config, localeMatchResolver: () => /** @type {any} */ ({ ...frMatch(), ...overrides }) })
        .get("Greeting.Hello"));

  it("accepts the valid control", () => {
    assert.equal(refuse({}), "NOTHING THROWN");
  });

  it("refuses a foreign fallback locale, and checks it BEFORE the considered set", () => {
    assert.equal(
      refuse({ fallbackLocale: "fr", consideredLocales: ["fr"], locale: "fr" }),
      "localeMatchSupplier returned a result for a different fallback locale",
    );
  });

  it("refuses a considered set that is not the loaded set", () => {
    for (const considered of [["en"], ["en", "fr", "de"], ["en", "qq"]])
      assert.equal(
        refuse({ consideredLocales: considered, locale: considered.includes("fr") ? "fr" : null,
          ...(considered.includes("fr") ? {} : { languageRange: null, effectiveWeight: null, matchType: "none", isMatch: false }) }),
        "localeMatchSupplier returned a result for different supported locales",
      );
  });

  it("ignores ORDER — Java compares sets", () => {
    assert.equal(refuse({ consideredLocales: ["fr", "en"] }), "NOTHING THROWN");
  });

  /**
   * THE ONE THE CORPUS CANNOT SEE. Measured: swapping `normalizeTag` for `equivalentTags` here
   * leaves conformance at 1,746 passed / 0 FAILED, because every considered list in the corpus is
   * spelled canonically. Java compares `Locale.equals` through `Set.equals`, so the JDK's own
   * canonicalization applies — and nothing else does.
   */
  describe("compares JDK-normalized tags, not CLDR equivalence", () => {
    const HE = {
      fallbackLocale: "en",
      strings: { en: { "Greeting.Hello": "Hello" }, he: { "Greeting.Hello": "שלום" } },
    };
    const RO = {
      fallbackLocale: "en",
      strings: { en: { "Greeting.Hello": "Hello" }, ro: { "Greeting.Hello": "Salut" } },
    };
    const heMatch = (/** @type {string[]} */ considered) => ({
      requestedLanguageRanges: [{ range: "he", weight: 1 }],
      locale: "he", languageRange: "he", effectiveWeight: 1, matchType: "exact",
      fallbackLocale: "en", consideredLocales: considered, isMatch: true,
    });
    // SELECTS `en`, deliberately. A match selecting `ro` against a considered list spelled `mo`
    // never reaches layer two at all — layer one's "selected locale must be present in considered
    // locales" fires first, and the probe would confirm a rule it never exercised. That is the
    // `zh-123` shape, and it is why every assertion below carries a control expected to pass.
    const enMatch = (/** @type {string[]} */ considered) => ({
      requestedLanguageRanges: [{ range: "en", weight: 1 }],
      locale: "en", languageRange: "en", effectiveWeight: 1, matchType: "exact",
      fallbackLocale: "en", consideredLocales: considered, isMatch: true,
    });
    const run = (/** @type {any} */ config, /** @type {any} */ match) =>
      message(() => createStrings({ ...config, localeMatchResolver: () => match }).get("Greeting.Hello"));

    it("ACCEPTS a legacy spelling the JDK canonicalizes — iw is he", () => {
      // `Locale.forLanguageTag("iw").toLanguageTag()` is `he` on the pinned Corretto 21.
      assert.equal(run(HE, heMatch(["en", "iw"])), "NOTHING THROWN");
      assert.equal(run(HE, heMatch(["EN", "HE"])), "NOTHING THROWN");
    });

    it("REFUSES a CLDR-equivalent spelling the JDK does not canonicalize — mo is not ro", () => {
      // `forLanguageTag("mo").toLanguageTag()` is `mo`, so `Set<Locale>.equals` is false against a
      // loaded `ro`. `equivalentTags("mo", "ro")` is TRUE, which is exactly the wrong answer here.
      assert.equal(
        run(RO, enMatch(["en", "mo"])),
        "localeMatchSupplier returned a result for different supported locales",
      );
      assert.equal(run(RO, enMatch(["en", "ro"])), "NOTHING THROWN");
    });

    it("applies the same rule to the fallback locale", () => {
      const FIL = {
        fallbackLocale: "fil",
        strings: { fil: { "Greeting.Hello": "Kamusta" }, en: { "Greeting.Hello": "Hello" } },
      };
      // The fallback must be among the considered locales or layer ONE refuses it first, so the two
      // travel together — which is also what makes the control meaningful.
      const match = (/** @type {string} */ fallback) => ({
        requestedLanguageRanges: [{ range: "en", weight: 1 }],
        locale: "en", languageRange: "en", effectiveWeight: 1, matchType: "exact",
        fallbackLocale: fallback, consideredLocales: [fallback, "en"], isMatch: true,
      });
      // `tl` and `fil` are CLDR-equivalent and are two different `Locale`s to the JDK.
      assert.equal(
        run(FIL, match("tl")),
        "localeMatchSupplier returned a result for a different fallback locale",
      );
      assert.equal(run(FIL, match("fil")), "NOTHING THROWN");
    });
  });
});

describe("forLocaleMatch", () => {
  it("returns a frozen per-call options object carrying the validated match", () => {
    const options = forLocaleMatch(frMatch());
    assert.equal(Object.isFrozen(options), true);
    assert.equal(options.localeMatch.locale, "fr");
    assert.equal(createStrings({ ...EN_FR, locale: "en" }).get("Greeting.Hello", undefined, options), "Bonjour");
  });

  it("validates at the site that spelled it, not at consumption", () => {
    // The whole reason it exists, and the same reason `forLocale` does: a fabricated match is
    // reported where it was written rather than at whichever unrelated lookup later consumed it.
    assert.throws(() => forLocaleMatch(/** @type {any} */ ({ ...frMatch(), matchType: "none" })),
      /A matched locale result requires a range, weight, and non-NONE match type/);
  });

  it("does NOT apply the instance-dependent layer, so one object stays reusable", () => {
    // `consideredLocales` names a set no instance here loads; layer one is silent about it.
    const options = forLocaleMatch({
      requestedLanguageRanges: [{ range: "de", weight: 1 }],
      locale: "de", languageRange: "de", effectiveWeight: 1, matchType: "exact",
      fallbackLocale: "de", consideredLocales: ["de"], isMatch: true,
    });
    assert.equal(options.localeMatch.locale, "de");
    assert.throws(
      () => createStrings({ ...EN_FR, locale: "en" }).get("Greeting.Hello", undefined, options),
      /different fallback locale/,
    );
  });
});
