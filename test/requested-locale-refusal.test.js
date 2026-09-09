// @ts-check

/**
 * JAVA'S THREE LOOKUP-REACHABLE `LocaleUtils.requireWellFormed` INGRESS SITES, ported.
 *
 *   | Java                                    | description             | JS surface                        |
 *   |---|---|---|
 *   | `TranslationOptions.java:73` and `:310` | `Locale override`       | the per-call `{ locale }` option   |
 *   | `DefaultStrings.java:2457`              | `localeSupplier result` | `createStrings({ localeResolver })`|
 *   | `LocaleMatcher.java:64`                 | `Requested locale`      | `matchFor` / `bestMatchFor` / `getDirectLocaleContext` |
 *
 * plus `createStrings({ locale })`, a FOURTH surface with no Java setter behind it —
 * `Strings.Builder` has none, and `VectorOracle.java:300` realizes a fixture's `instanceLocale` as
 * `localeSupplier(matcher -> instanceLocale)`, so in Java that source IS a supplier. It is refused
 * at the same point in the lookup and gets its own phrase, `Instance locale`, rather than borrowing
 * the name of a callback the caller never installed. The wording rule and its reasoning live in
 * `src/internal/locale-jdk-tag.js`'s `LOCALE_INGRESS_DESCRIPTION`; this file is what pins the four
 * strings.
 *
 * WHAT IS ACTUALLY UNDER TEST IS THE TIMING, NOT THE THROW. Before these checks the port refused
 * every one of these inputs anyway — later, from inside the walk, as `attemptedLocaleRefusal`'s
 * `Attempted locale` refusal, because the lookup locale is also the chain's first member. The
 * OUTCOME agreed with Java and the BEHAVIOUR did not. Measured on the pinned Corretto 21 against
 * `lokalized-3.0.0.jar`, catalogs {fr}, with a `fallbackPolicy` and an `onFailure` installed and
 * key `Absent`:
 *
 *   `en-x-lvariant-NY`   java  calls=[]
 *                        port  calls=[policy:en-x-lvariant-NY, policy:en-x-lvariant, policy:en,
 *                                     policy:en-x-lvariant-ny, onFailure:en-x-lvariant-NY]
 *
 * The port ran a whole walk Java never starts. Every refusal assertion below therefore asserts an
 * EMPTY call trace as well as the message, because a port that reached the same message from inside
 * the walk would satisfy the message half on its own — which is exactly what the port did before
 * this slice.
 *
 * AND EVERY REFUSAL IS PAIRED WITH A CONTROL THAT MUST STILL SERVE. "These tags throw" is the wrong
 * statement and a port that refused everything would satisfy the refusal half of this file wholesale.
 * The controls are not invented here either: `en-US-x-lvariant-POSIX`, `ja-JP-x-lvariant-JP` and
 * `th-TH-x-lvariant-TH` denote `en_US_POSIX`, `ja_JP_JP` and `th_TH_TH`, all three of which
 * `Locale.Builder#setLocale` ACCEPTS — the last two by explicit legacy special case — and the corpus
 * already keeps them as `lvariant.exhausting-walk.*.selection-channel-does-not-refuse` for precisely
 * this reason. Measured on the pinned JDK: `strings.matchFor(Locale.forLanguageTag(t))` answers for
 * all three and throws `Requested locale 'en__NY' …` for `en-x-lvariant-NY`.
 *
 * THE SELECTION CHANNEL IS NORMALIZED EXACTLY ONCE, and that is the second thing this file pins. It
 * is a defect the `matchFor` ingress found the day it was added: Java's `matchFor(Locale)` builds
 * its range from `locale.toLanguageTag()` — one normalization — while the port handed its matcher
 * kernel an ALREADY-normalized tag and the kernel normalized again. The two differ for one family, a
 * non-lowercase `und` followed only by private use, where the second application drops the `und`.
 *
 * ABLATIONS, ALL TEN MEASURED, each restored afterwards and each caught by exactly its OWN
 * assertion — the failing test name is printed beside every row rather than only a count, because
 * "one red" from two different ablations is not evidence that the two are independently gated.
 * `npm run diff:lookup` is reported beside `npm test` because five of these ten are invisible to it,
 * and a check no differential can see is a check whose only specification is this file.
 *
 *   | ablation                                              | this file | diff:lookup |
 *   |---|---|---|
 *   | CONTROL, unmodified                                   | 0 red     | exit 0, 0 unexplained |
 *   | delete the `Locale override` check                     | 1 — `refuses BEFORE the walk…`      | exit 1, 4,641 unexplained |
 *   | delete the `localeResolver result` check               | 1 — `names \`localeResolver\`…`      | exit 1, 4,641 unexplained |
 *   | delete the `Instance locale` check                     | 1 — `a constant createStrings({ locale })…` | **GREEN — no signal** |
 *   | delete `Requested locale` at `getDirectLocaleContext`   | 1 — `getDirectLocaleContext refuses…` | exit 1, 1,547 unexplained |
 *   | delete `Requested locale` at the negotiator's two doors | 2 — both negotiator doors           | **GREEN — no signal** |
 *   | double-normalize the per-call diagnostic               | 1 — `the per-call lookup's own diagnostic…` | **GREEN — no signal** |
 *   | double-normalize the ambient diagnostic                | 1 — `the ambient lookup's diagnostic…` | **GREEN — no signal** |
 *   | double-normalize `getDirectLocaleContext`               | 1 — `the door diff:lookup's matcher ingress caught` | exit 1, 42 unexplained |
 *   | double-normalize the negotiator's doors                | 1 — `the door that was already correct` | **GREEN — no signal** |
 *   | refuse at ALL four sites unconditionally               | 10, FIVE of them the serving controls | exit 1, 320,460 unexplained |
 *
 * FIVE ROWS SAY "GREEN", and they are why this file exists rather than being folded into the
 * differential: `Instance locale`, the negotiator's two doors, and both lookup DIAGNOSTIC channels
 * are surfaces `diff:lookup` does not drive or does not compare — it drives six OUTCOME fields and
 * the `localeMatch` is not among them. Fixing only what the differential could see would have been
 * a probe space deciding the scope of its own fix, which is the trap `CLAUDE.md` records costing a
 * milestone.
 *
 * THE LAST ROW IS THE ANTI-DECORATION CONTROL. A port that refused every one of these four sites
 * unconditionally would satisfy every REFUSAL assertion in this file; it is caught by the SERVING
 * controls, five of the ten reds, and never by a refusal assertion.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { createLocaleNegotiator } from "../src/negotiate/index.js";

/** Catalogs that cannot serve an `en`/`ja`/`th` request, so a lookup runs the whole chain. */
const EXHAUSTS = { fr: { Hello: "bonjour" }, nb: { Hello: "BOKMAAL" }, nn: { Hello: "NYNORSK" } };

/** The control fixture: `en`, `ja` and `th` each answer their chain's bare-language candidate. */
const SERVES_EARLY = {
  en: { Hello: "hello-en" },
  fr: { Hello: "bonjour" },
  ja: { Hello: "konnichiwa" },
  th: { Hello: "sawatdee" },
};

/** A locale whose `Locale` carries the variant `NY` — two characters, so `Locale.Builder` refuses it. */
const REFUSED = "en-x-lvariant-NY";

/** The three the JDK ACCEPTS, spelled as the corpus spells them. */
const ACCEPTED = ["en-US-x-lvariant-POSIX", "ja-JP-x-lvariant-JP", "th-TH-x-lvariant-TH"];

const SENTENCE = "is not a well-formed IETF BCP 47 locale";

/**
 * One instance plus the trace of every callback it consults, so a refusal can assert WHEN it
 * happened and not merely that it happened.
 *
 * @param {Record<string, unknown>} extra
 */
function instrumented(extra) {
  /** @type {string[]} */
  const calls = [];
  const strings = createStrings({
    fallbackLocale: "fr",
    strings: EXHAUSTS,
    fallbackPolicy: (/** @type {string} */ _reason, /** @type {string} */ attemptedLocale) => {
      calls.push(`policy:${attemptedLocale}`);
      return true;
    },
    onFailure: (/** @type {{lookupLocale: string}} */ failure) => {
      calls.push(`onFailure:${failure.lookupLocale}`);
      return { action: /** @type {const} */ ("return-key") };
    },
    .../** @type {any} */ (extra),
  });
  return { strings, calls };
}

/**
 * @param {() => unknown} run
 * @param {string} description
 * @param {string} name
 */
function assertRefusal(run, description, name) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof RangeError, `expected a RangeError, got ${String(error)}`);
    assert.equal(error.message, `${description} '${name}' ${SENTENCE}`);
    return true;
  });
}

describe("requireWellFormed at the per-call `{ locale }` ingress — Java's `Locale override`", () => {
  it("refuses BEFORE the walk: the exact sentence, and no callback consulted", () => {
    const { strings, calls } = instrumented({ locale: "fr" });
    assertRefusal(() => strings.getResult("Absent", undefined, { locale: REFUSED }),
      "Locale override", REFUSED);
    assert.deepEqual(calls, [],
      "Java answers this input with calls=[]; a port refusing from inside the walk records five");
  });

  it("CONTROL — the three locales `Locale.Builder` accepts still serve", () => {
    const strings = createStrings({ fallbackLocale: "fr", locale: "fr", strings: SERVES_EARLY });
    assert.deepEqual(
      ACCEPTED.map((locale) => strings.get("Hello", undefined, { locale })),
      ["hello-en", "konnichiwa", "sawatdee"],
    );
  });

  it("CONTROL — the walk's OWN refusal still fires, at its own site and with its own wording", () => {
    // `ja-JP-x-lvariant-JP` passes the ingress and is refused four candidates later, on the
    // variant-LOWERCASED twin the chain synthesizes. A port that moved the check to the tag layer
    // would refuse it here instead, with the wrong description and an empty trace.
    const { strings, calls } = instrumented({ locale: "fr" });
    assert.throws(
      () => strings.getResult("Hello", undefined, { locale: "ja-JP-x-lvariant-JP" }),
      /^TypeError: Attempted locale 'ja-JP-u-ca-japanese-x-lvariant-jp' is not a well-formed/,
    );
    assert.equal(calls.length, 8, "the whole chain is walked before the refusal, exactly as in Java");
  });
});

describe("requireWellFormed at the ambient ingress — Java's `localeSupplier result`", () => {
  it("names `localeResolver`, Java's shape with the JS name substituted", () => {
    const { strings, calls } = instrumented({ localeResolver: () => REFUSED });
    assertRefusal(() => strings.getResult("Absent"), "localeResolver result", REFUSED);
    assert.deepEqual(calls, []);
  });

  it("CONTROL — a resolver answering an accepted locale still serves", () => {
    const strings = createStrings({
      fallbackLocale: "fr",
      localeResolver: () => "ja-JP-x-lvariant-JP",
      strings: SERVES_EARLY,
    });
    assert.equal(strings.get("Hello"), "konnichiwa");
  });

  it("a constant `createStrings({ locale })` gets its own phrase, and refuses at the same point", () => {
    // Not `localeResolver result`: no resolver was installed. Not `Locale override` either: that is
    // the per-call site. See `LOCALE_INGRESS_DESCRIPTION`.
    const { strings, calls } = instrumented({ locale: REFUSED });
    assertRefusal(() => strings.getResult("Absent"), "Instance locale", REFUSED);
    assert.deepEqual(calls, []);
  });

  it("CONTROL — construction itself is unmoved: an accepted instance locale builds AND serves", () => {
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "th-TH-x-lvariant-TH",
      strings: SERVES_EARLY,
    });
    assert.equal(strings.get("Hello"), "sawatdee");
  });
});

describe("requireWellFormed at the selection ingress — Java's `Requested locale`", () => {
  const configuration = createStrings({
    fallbackLocale: "fr",
    locale: "fr",
    strings: EXHAUSTS,
  }).getLocaleConfiguration();

  // ONE TEST PER DOOR, not one loop over three. `getDirectLocaleContext` lives in `src/core` and the
  // other two in `src/negotiate`, so a single assertion covering all three would be killed by an
  // ablation of EITHER module and would report the same "1 failing" either way — a test that cannot
  // tell two independent checks apart is not discriminating them.
  it("`getDirectLocaleContext` refuses — the counterpart plan 3.3 names, and the corpus drives", () => {
    const strings = createStrings({ fallbackLocale: "fr", locale: "fr", strings: EXHAUSTS });
    assertRefusal(() => strings.getDirectLocaleContext(REFUSED), "Requested locale", REFUSED);
  });

  it("the negotiator's `matchFor` refuses", () => {
    const negotiator = createLocaleNegotiator(configuration);
    assertRefusal(() => negotiator.matchFor(REFUSED), "Requested locale", REFUSED);
  });

  it("the negotiator's `bestMatchFor` refuses — Java reaches :64 through `matchFor` at :1532", () => {
    const negotiator = createLocaleNegotiator(configuration);
    assertRefusal(() => negotiator.bestMatchFor(REFUSED), "Requested locale", REFUSED);
  });

  it("CONTROL — the three the corpus keeps as `selection-channel-does-not-refuse` all ANSWER", () => {
    const negotiator = createLocaleNegotiator(configuration);
    const strings = createStrings({ fallbackLocale: "fr", locale: "fr", strings: EXHAUSTS });

    for (const locale of ACCEPTED) {
      assert.equal(negotiator.matchFor(locale).isMatch, false, `${locale} must answer, not throw`);
      assert.equal(negotiator.bestMatchFor(locale), "fr");
      assert.equal(strings.getDirectLocaleContext(locale).localeMatch.isMatch, false);
    }
  });

  it("CONTROL — the RANGE doors are untouched, because Java's take no `Locale`", () => {
    // `matchFor(List<LanguageRange>)` validates a member COUNT and nothing else, so a range that
    // spells a locale `Locale.Builder` would refuse is still a legal range.
    const negotiator = createLocaleNegotiator(configuration);
    const member = [{ range: REFUSED, weight: 1 }];
    assert.equal(negotiator.matchForLanguageRanges(member).isMatch, false);
    assert.equal(negotiator.bestMatchForLanguageRanges(member), "fr");
  });
});

describe("the selection channel normalizes the requested locale exactly ONCE", () => {
  // Java: `matchFor(Locale)` is `matchFor(List.of(new LanguageRange(locale.toLanguageTag())))`, so
  // the tag is derived once. Measured on the pinned JDK with catalogs {fr, nb, nn}: `UND-x-a`
  // reports `requestedLanguageRanges [und-x-a]`. `normalizeTag` applied twice yields `x-a` — the
  // non-lowercase `und` is only dropped on the second pass — so a port that hands its matcher an
  // already-normalized tag reports the wrong range. Found by `diff:lookup`'s matcher ingress on the
  // day it was added, in 42 rows no lookup ingress could reach.
  const UND = "UND-x-a";
  const configuration = { fallbackLocale: "fr", supportedLocales: ["fr", "nb", "nn"], tiebreakers: {} };

  /** @param {{requestedLanguageRanges: {range: string}[]}} match */
  const ranges = (match) => match.requestedLanguageRanges.map((member) => member.range);

  // FOUR DOORS, FOUR TESTS. They are four separate call sites in two modules, and one test covering
  // all of them would report "1 red" for an ablation of any single one — indistinguishable, which is
  // the same discrimination failure the split above avoids.
  it("the negotiator's `matchFor` — the door that was already correct, kept as the reference", () => {
    assert.deepEqual(ranges(createLocaleNegotiator(configuration).matchFor(UND)), ["und-x-a"]);
  });

  it("`getDirectLocaleContext` — the door `diff:lookup`'s matcher ingress caught", () => {
    const strings = createStrings({ fallbackLocale: "fr", locale: "fr", strings: EXHAUSTS });
    assert.deepEqual(ranges(strings.getDirectLocaleContext(UND).localeMatch), ["und-x-a"]);
  });

  it("the per-call lookup's own diagnostic channel, which NO differential field compares", () => {
    // `diff:lookup` compares six OUTCOME fields and the match is not among them, so this site's
    // ablation shows up here and nowhere else. It is the reason the fix was applied to all four
    // doors rather than to the one the probe happened to see.
    const strings = createStrings({ fallbackLocale: "fr", locale: "fr", strings: EXHAUSTS });
    assert.deepEqual(
      ranges(/** @type {any} */ (strings.getResult("Absent", undefined, { locale: UND })).localeMatch),
      ["und-x-a"],
    );
  });

  it("the ambient lookup's diagnostic channel, likewise uncompared by any differential", () => {
    assert.deepEqual(
      ranges(/** @type {any} */ (createStrings({
        fallbackLocale: "fr",
        localeResolver: () => UND,
        strings: EXHAUSTS,
      }).getResult("Absent")).localeMatch),
      ["und-x-a"],
    );
  });

  it("CONTROL — `lookupLocale` is still the NORMALIZED tag, which is a different question", () => {
    const strings = createStrings({ fallbackLocale: "fr", locale: "fr", strings: EXHAUSTS });
    assert.equal(strings.getDirectLocaleContext(UND).lookupLocale, "und-x-a");
    assert.equal(strings.getDirectLocaleContext("EN-latn-us").lookupLocale, "en-Latn-US");
  });
});
