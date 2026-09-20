// @ts-check
/**
 * PLAN 3.4:904-915's REMAINING `negotiate` SURFACE — the two option helpers and the two IANA
 * constants — plus the delegation clause the M9 scope map recorded as almost ungated.
 *
 * **WHY THE HELPERS EXIST IS A STATEMENT ABOUT THE MODULE GRAPH**, and it is the only reason to put
 * them on this subpath rather than on core: plan 3.4:933 — "`forLanguageRanges` and
 * `forAcceptLanguage` negotiate immediately and return core `localeMatch` options, so the
 * browser/root graph does not contain the whole-list solver." The alternative shape, handing core a
 * MATCHER and letting core call it, drags this module and its 806-class IANA closure into every
 * graph that can render.
 *
 * **AND THE TWO DOORS ONTO `Accept-Language` DISAGREE ON PURPOSE.** `bestMatchForAcceptLanguage`
 * fabricates: unusable input answers the configured fallback TAG. `forAcceptLanguage` does not:
 * unusable input carries an UNMATCHED diagnostic whose "own `locale` remains null" (:930-931), and
 * core then uses the configured fallback as the lookup locale. Both serve the same catalog; only one
 * of them tells the page that the visitor asked for the language it is being served. The five
 * refusals behind that difference are one predicate, shared verbatim, and the cross-door test below
 * is what keeps the two from drifting into agreeing-by-coincidence.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createStrings, forLocaleMatch } from "../src/core/index.js";
import {
  createLocaleNegotiator, forAcceptLanguage, forLanguageRanges,
  ianaDataFingerprint, ianaRegistryDate, parseLanguageRanges,
} from "../src/negotiate/index.js";
import { ianaDataFingerprint as coreFingerprint, ianaRegistryDate as coreDate } from "../src/core/index.js";
import { graphBytes } from "../tools/graph-walk.mjs";

const strings = createStrings({
  strings: {
    en: { Hi: "hello en" }, fr: { Hi: "bonjour fr" },
    "fr-CA": { Hi: "bonjour fr-CA" }, es: { Hi: "hola es" }, ja: { Hi: "konnichiwa ja" },
  },
  fallbackLocale: "en", tiebreakers: { fr: ["fr", "fr-CA"] }, locale: "en",
});
const configuration = strings.getLocaleConfiguration();
const negotiator = createLocaleNegotiator(configuration);

/** The corpus's own pair, quoted by id so a reader can find the recorded Java answer. */
const THIRTY_THREE = "he,id,yi,cmn,yue,nan,hak,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.1";
const THIRTY_TWO = "he,id,yi,cmn,yue,nan,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.9,de;q=0.8,es;q=0.7,it;q=0.6";

/** One per class of unusable input plan 3.4:929 names. */
const UNUSABLE = /** @type {const} */ ([
  ["absent (null)", null],
  ["absent (undefined)", undefined],
  ["blank", "   "],
  ["empty", ""],
  ["malformed weight", "fr;q=2"],
  ["malformed grammar", "not a header!"],
  ["over 4,096 code units", `${"fr,".repeat(1400)}fr`],
  ["over 32 expanded ranges", THIRTY_THREE],
]);

describe("forLanguageRanges is strict", () => {
  test("it negotiates a usable list and returns frozen core options", () => {
    const options = forLanguageRanges(negotiator, parseLanguageRanges("fr-CH"));
    assert.equal(options.localeMatch.locale, "fr");
    assert.equal(options.localeMatch.matchType, "cldr-fallback");
    assert.ok(Object.isFrozen(options));
  });

  test("a list longer than 32 throws rather than truncating", () => {
    const ranges = Array.from({ length: 33 }, (_, index) => ({ range: `fr-${String(index).padStart(3, "0")}`, weight: 1 }));
    assert.throws(() => forLanguageRanges(negotiator, ranges), RangeError);
    // THE CONTROL. Without it "it throws" is satisfied by a helper that throws on everything.
    assert.doesNotThrow(() => forLanguageRanges(negotiator, ranges.slice(0, 32)));
  });

  test("it builds exactly what core's own `forLocaleMatch` builds", () => {
    // This module does NOT import core — that would pull a 30-module graph into a 16-module subpath
    // — so the two literals are built independently and this is what keeps them equal. The option
    // shape is structural by plan 3.4:713, which is why two constructions are the intended design
    // rather than duplication to tidy away.
    const ranges = parseLanguageRanges("fr-CA,fr;q=0.9");
    assert.deepEqual(
      forLanguageRanges(negotiator, ranges),
      forLocaleMatch(negotiator.matchForLanguageRanges(ranges)));
  });
});

describe("forAcceptLanguage is fail-soft, and says so in the diagnostic", () => {
  for (const [label, header] of UNUSABLE) {
    test(`${label}: an unmatched result whose own locale is null`, () => {
      const { localeMatch } = forAcceptLanguage(negotiator, header);
      assert.equal(localeMatch.locale, null, "plan 3.4:931 — the unmatched result's own locale remains null");
      assert.equal(localeMatch.matchType, "none");
      assert.equal(localeMatch.isMatch, false);
      // NOTHING IS TRUNCATED (:931). A 33-expanded-range header reports ZERO requested ranges, not
      // the first 32 — which is the whole difference between refusing and truncating, and the
      // corpus pins it from the other side at `accept-language.limit.thirty-three-expanded-ranges`.
      assert.deepEqual(localeMatch.requestedLanguageRanges, []);
    });
  }

  test("the strict door refuses the same input — except the one guard that is the header door's alone", () => {
    // **THE 4,096-CODE-UNIT CAP HAS NO STRICT COUNTERPART, and finding that out is what this test is
    // for.** It applies to the RAW header, before `trim` and before normalization, because that is
    // where Java applies it — so the same value handed to the strict door as a parsed RANGE LIST is
    // perfectly legal: 1,400 repetitions of `fr,` dedupe to ONE range, and `forLanguageRanges`
    // negotiates it without complaint. My first draft asserted the strict door throws on every
    // unusable input and this is the one that said otherwise.
    const long = `${"fr,".repeat(1400)}fr`;
    assert.ok(long.length > 4096);
    assert.equal(forAcceptLanguage(negotiator, long).localeMatch.locale, null);
    assert.equal(forLanguageRanges(negotiator, parseLanguageRanges(long)).localeMatch.locale, "fr");

    // Every OTHER class of unusable input is refused by the strict door too, which is what makes the
    // fail-soft door a policy rather than a second parser.
    for (const header of ["   ", "", "fr;q=2", "not a header!", THIRTY_THREE])
      assert.throws(() => forLanguageRanges(negotiator, parseLanguageRanges(header)), RangeError, header);
  });

  test("a USABLE header that simply matches nothing is a different diagnostic", () => {
    // Both are unmatched, and a consumer can still tell them apart: `de` was parsed and considered,
    // the fail-soft inputs above were not. Collapsing the two would make a malformed header
    // indistinguishable from a visitor who asked for a language this deployment does not publish.
    const { localeMatch } = forAcceptLanguage(negotiator, "de");
    assert.equal(localeMatch.locale, null);
    assert.equal(localeMatch.matchType, "none");
    assert.deepEqual(localeMatch.requestedLanguageRanges, [{ range: "de", weight: 1 }]);
  });

  test("the 32-member sibling is accepted WHOLE", () => {
    // `accept-language.limit.thirty-two-expanded-ranges`. A port that truncated to 32 instead of
    // refusing at 33 answers this row correctly and the other one wrongly, which is why the pair is
    // here rather than either half alone.
    const { localeMatch } = forAcceptLanguage(negotiator, THIRTY_TWO);
    assert.equal(localeMatch.requestedLanguageRanges.length, 32);
    assert.equal(localeMatch.locale, "fr");
  });

  test("a usable header negotiates exactly as the strict door would", () => {
    for (const header of ["fr-CA,fr;q=0.9", "fr-CH", "es;q=0.4,ja;q=0.8", "de"])
      assert.deepEqual(
        forAcceptLanguage(negotiator, header),
        forLanguageRanges(negotiator, parseLanguageRanges(header)),
        `${header} took a different path through the two doors`);
  });
});

describe("both range doors render a refused weight the way Java does", () => {
  /**
   * **MEASURED ON THE PINNED JDK 2026-09-15, one row per weight, and the literals below ARE the
   * measurement.** `Locale.LanguageRange.parse("fr;q=2")` answers
   * `weight=2.0 for language range "fr". It must be between 0.0 and 1.0.` — Java renders the
   * offending weight with `Double.toString`, so an integral value carries its `.0` and a large one
   * takes the `E` form. JS spells those `2` and `1e+21`, differing in the mantissa AND the exponent
   * marker, which is why a repair that merely appended `.0` would still be wrong on the large one.
   *
   * THE HEADER DOOR WAS ALWAYS RIGHT AND THE OBJECT DOOR WAS NOT, which is the shape worth keeping:
   * one sentence, two doors, two renderings. `parseLanguageRanges` used `javaDoubleText`;
   * `matchForLanguageRanges({ range, weight })` used `String(weight)`. Nothing compared them —
   * `diff:language-range` never opened the CONSTRUCTOR arm, so the oracle never emitted a weighted
   * verdict and the runner never compared one. An EMIT-side blind spot: no recording proxy and no
   * column count can see a value the harness never prints.
   */
  const JAVA_MESSAGES = /** @type {[number, string, string][]} */ ([
    [2, "2.0", "fr;q=2"],
    [-1, "-1.0", "fr;q=-1"],
    [3, "3.0", "fr;q=3"],
    [1e21, "1.0E21", "fr;q=1.0E21"],
    [1.5, "1.5", "fr;q=1.5"],
  ]);

  for (const [weight, rendering, header] of JAVA_MESSAGES)
    test(`weight ${rendering} is spelled the same by both doors`, () => {
      const expected =
        `weight=${rendering} for language range "fr". It must be between 0.0 and 1.0.`;

      const fromObject = /** @type {Error} */ (assertThrown(() =>
        negotiator.matchForLanguageRanges([{ range: "fr", weight }])));
      const fromHeader = /** @type {Error} */ (assertThrown(() => parseLanguageRanges(header)));

      assert.equal(fromHeader.message, expected, "the header door drifted from Java");
      assert.equal(fromObject.message, expected, "the object door drifted from Java");
      assert.equal(fromObject.message, fromHeader.message);
    });

  test("a non-number keeps the port's own rendering, because Java has no such arm", () => {
    // `Locale.LanguageRange`'s parameter is a `double`; a string or null cannot reach it, so there is
    // no oracle for this and the port's guard spells the value as it received it.
    for (const [weight, rendering] of /** @type {[unknown, string][]} */ ([["x", "x"], [null, "null"]]))
      assert.match(
        /** @type {Error} */ (assertThrown(() =>
          negotiator.matchForLanguageRanges([{ range: "fr", weight }]))).message,
        new RegExp(`^weight=${rendering} `));
  });

  test("an ACCEPTED weight is untouched, or the tests above would pass over a door that refuses all", () => {
    assert.equal(negotiator.matchForLanguageRanges([{ range: "fr", weight: 0.5 }]).locale, "fr");
    assert.equal(parseLanguageRanges("fr;q=0.5")[0]?.weight, 0.5);
  });
});

describe("the two Accept-Language doors share one predicate", () => {
  test("every probe agrees on which catalog answers", () => {
    // THE CROSS-DOOR INVARIANT. `bestMatchForAcceptLanguage` returns a TAG and `forAcceptLanguage`
    // returns a DIAGNOSTIC, so they can only be compared through what each one makes core do: an
    // unmatched diagnostic resolves to the configured fallback. A drift in either door's guard chain
    // — the length cap moving after `trim`, a blanket `catch`, a truncation — separates them here.
    const probes = [
      ...UNUSABLE.map(([, header]) => header),
      "fr-CA,fr;q=0.9", "fr-CH", "de", "es;q=0.4,ja;q=0.8", THIRTY_TWO, "*", "*;q=0.5,fr;q=0.1",
    ];
    for (const header of probes) {
      const { localeMatch } = forAcceptLanguage(negotiator, header);
      assert.equal(
        localeMatch.locale ?? configuration.fallbackLocale,
        negotiator.bestMatchForAcceptLanguage(header),
        `the doors disagree on ${JSON.stringify(header)}`);
    }

    // ANTI-VACUITY: the probe set must contain both outcomes, or the invariant is asserted over a
    // column of identical values.
    const selected = new Set(probes.map((header) => negotiator.bestMatchForAcceptLanguage(header)));
    assert.ok(selected.size > 1, `every probe selected ${[...selected]} — the set discriminates nothing`);
  });

  test("core consumes an unmatched diagnostic by using the configured fallback as lookup", () => {
    const result = strings.getResult("Hi", undefined, forAcceptLanguage(negotiator, "fr;q=2"));
    assert.equal(result.translation, "hello en");
    assert.equal(result.lookupLocale, "en", "plan 3.4:930 — core consumption uses the configured fallback");
    assert.equal(result.localeMatch?.locale, null, "and the result's own locale is still null");

    // The control: a usable header reaches a different catalog through the same call shape.
    assert.equal(strings.get("Hi", undefined, forAcceptLanguage(negotiator, "fr-CH")), "bonjour fr");
  });
});

describe("matchFor delegates to the same strict kernel core's direct diagnostic uses", () => {
  // THE M9 SCOPE MAP'S BLOCKER 4: "the `matchFor` delegation has almost no gate. Ablating it reds
  // exactly ONE test on one axis." The clause (plan :2925) is that `LocaleNegotiator.matchFor(locale)`
  // "delegates to or differentially equals core's automatic single-locale operation". Both doors
  // import one kernel from `src/internal/locale.js` today, so the strongest available check is that
  // their OBSERVATIONS agree exactly over a probe space that reaches every outcome — which is what a
  // differential would assert if the two sides were separate implementations, and what keeps the
  // clause true if anyone ever makes them separate.
  const TAGS = [
    "en", "fr", "fr-CA", "fr-CH", "fr-BE", "es", "ja", "de", "zh-Hant-TW", "en-GB",
    "und", "en-US-POSIX", "sr-Latn", "es-419", "pt-BR", "nn", "iw", "he", "fil", "tl",
  ];

  /**
   * TWO CONFIGURATIONS, AND THE SECOND ONE IS HERE BECAUSE AN ABLATION DID NOT FIRE.
   *
   * Dropping the tiebreaker list from this module's `matchFor` — passing `undefined` where the
   * configuration's own list belongs — changed NOTHING over the first configuration. It could not:
   * a direct single-tag match only consults the list when the language it lands on has SIBLINGS and
   * no catalog spelled exactly. `{en, fr, fr-CA}` always has `fr` to land on, so the election never
   * happens. `{en, fr-CA, fr-FR}` has no bare `fr`, so `matchFor("fr")` must elect, and reversing
   * the declared order moves the answer from `fr-FR` to `fr-CA`. The mutation reds over it.
   *
   * It also reaches a fourth match type — `likely-subtag` — that the first configuration never
   * produces. Covering a branch is not discriminating the input that chooses between its arms, and
   * a probe set over one catalog shape is exactly that mistake one level up.
   */
  const DOORS = [
    { label: "with a bare `fr` to land on", strings, negotiator },
    (() => {
      const elected = createStrings({
        strings: { en: { Hi: "hello en" }, "fr-CA": { Hi: "bonjour fr-CA" }, "fr-FR": { Hi: "bonjour fr-FR" } },
        fallbackLocale: "en", tiebreakers: { fr: ["fr-FR", "fr-CA"] }, locale: "en",
      });
      return {
        label: "where the tiebreaker must elect",
        strings: elected,
        negotiator: createLocaleNegotiator(elected.getLocaleConfiguration()),
      };
    })(),
  ];

  for (const door of DOORS)
    test(`every probe produces a byte-identical match on both doors, ${door.label}`, () => {
      for (const tag of TAGS)
        assert.deepEqual(
          door.negotiator.matchFor(tag),
          door.strings.getDirectLocaleContext(tag).localeMatch,
          `the two doors disagree on ${tag}`);
    });

  test("the tiebreaker-electing configuration really does elect", () => {
    // The precondition for the second door above. Without it, that configuration is just a third
    // spelling of the first and the ablation it exists to catch goes on not firing.
    const [, elected] = DOORS;
    assert.equal(elected?.negotiator.matchFor("fr").locale, "fr-FR");
    const reversed = createStrings({
      strings: { en: { Hi: "hello en" }, "fr-CA": { Hi: "bonjour fr-CA" }, "fr-FR": { Hi: "bonjour fr-FR" } },
      fallbackLocale: "en", tiebreakers: { fr: ["fr-CA", "fr-FR"] }, locale: "en",
    });
    assert.equal(createLocaleNegotiator(reversed.getLocaleConfiguration()).matchFor("fr").locale, "fr-CA",
      "reversing the declared order must move the answer, or the list is not being read");
  });

  test("the probe space reaches every outcome, or the agreement above means nothing", () => {
    const types = new Set(DOORS.flatMap((door) => TAGS.map((tag) => door.negotiator.matchFor(tag).matchType)));
    assert.ok(types.size >= 4, `the probes produced only ${[...types].join(", ")}`);
    for (const required of ["exact", "none", "cldr-fallback", "likely-subtag"])
      assert.ok(types.has(required), `no probe produced a ${required} match`);
    assert.ok(TAGS.some((tag) => negotiator.matchFor(tag).locale === "fr-CA"),
      "and one must land on a tiebreaker-elected catalog");
  });

  test("both doors refuse an ill-formed tag the same way", () => {
    // `LocaleMatcher.java:64` is the first statement of `matchFor(Locale)` and core reaches the same
    // check through `getDirectLocaleContext`. A door that validated later would answer here.
    const caught = (/** @type {() => unknown} */ fn) => {
      try { fn(); return null; } catch (error) { return /** @type {Error} */ (error); }
    };
    for (const bad of ["en-x-lvariant-NY", "en-Latin-US", "!!"]) {
      const fromNegotiator = caught(() => negotiator.matchFor(bad));
      const fromCore = caught(() => strings.getDirectLocaleContext(bad));
      assert.ok(fromNegotiator !== null && fromCore !== null, `${bad}: one door answered`);
      assert.equal(fromNegotiator.constructor, fromCore.constructor, `${bad}: different error class`);
      // The MESSAGE too: the role word differs between sites in Java, and a door that validated
      // through a different call site would report a different one.
      assert.equal(fromNegotiator.message, fromCore.message, `${bad}: different message`);
    }
    // THE CONTROL: the three tags Java ANSWERS rather than refusing, so "both throw" is not
    // satisfied by two doors that throw on everything.
    for (const good of ["en-US-x-lvariant-POSIX", "ja-JP-x-lvariant-JP", "th-TH-x-lvariant-TH"]) {
      assert.doesNotThrow(() => negotiator.matchFor(good));
      assert.doesNotThrow(() => strings.getDirectLocaleContext(good));
    }
  });
});

describe("the IANA constants plan 3.4:914-915 declares on this subpath", () => {
  test("they are the values core reports, not a second copy", () => {
    assert.equal(ianaRegistryDate, coreDate);
    assert.equal(ianaDataFingerprint, coreFingerprint);
    assert.ok(ianaRegistryDate.length > 0 && ianaDataFingerprint.length > 0);
  });

  test("`ianaRegistryDate` IS the pinned snapshot's File-Date", () => {
    // **REVERSED IN M-R S11, and the old name was the whole point of the test.** It read
    // "deliberately not date-shaped": maintainer decision A11 kept `jdk-oracle:<version>` because
    // there was no pinned registry snapshot and inventing a plausible date is a defect class this
    // project has caught five times. M-R S11 pinned a real snapshot — File-Date 2026-09-17, with
    // 156 reconstruction-verified JDK-compatibility overrides — so the reason for A11 is gone and
    // the maintainer took the date. Asserted date-SHAPED here and asserted EQUAL to the artifact's
    // own File-Date in `test/runtime-metadata.test.js`, so this cannot drift from the snapshot.
    assert.match(ianaRegistryDate, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the solver stays out of the graphs plan 3.4:933 keeps it out of", () => {
  test("negotiate does not reach core", () => {
    // Not a size question: importing `forLocaleMatch` from core to build the option object would be
    // the natural thing to write, and it would put all of core behind `lokalized/negotiate`.
    const graph = graphBytes(".", "src/negotiate/index.js").files;
    assert.ok(!graph.some((file) => file.endsWith("src/core/index.js")),
      "lokalized/negotiate reaches core; build the option literal instead of importing it");
  });

  test("and the root graph does not reach negotiate", () => {
    // The mirror, and the reason the helpers live here: a root graph holding the whole-list solver
    // is what plan 3.4:933 exists to prevent. `test/pinned-data-only.test.js` names the module so
    // this fails as a test rather than as a byte ratchet nobody can attribute.
    for (const entry of ["src/index.js", "src/core/index.js"]) {
      const graph = graphBytes(".", entry).files;
      assert.ok(!graph.some((file) => file.endsWith("src/negotiate/index.js")),
        `${entry} reaches the whole-list solver`);
    }
  });
});

/** Runs `fn`, requires it to throw, and returns what it threw. `assert.throws` returns nothing. */
function assertThrown(/** @type {() => unknown} */ fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail("expected a throw");
}
