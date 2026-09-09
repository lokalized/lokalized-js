// @ts-check

/**
 * The two port defects `tools/lookup-diff/` found on its first two runs, pinned as unit assertions.
 *
 * NEITHER IS REACHABLE FROM THE CORPUS, and that is measured rather than assumed: `npm run
 * conformance` prints the identical line with each defect REINTRODUCED — **1,960 passed / 0 FAILED,
 * exit 0** either way — while this file goes 4 red and 2 red respectively. (The quoted number has
 * moved twice, 1,957 / 1 -> 1,958 / 0 -> 1,960 / 0, as unrelated runner-model fixes closed rows the
 * port already answered correctly; the CLAIM is unchanged and has been RE-MEASURED at each move,
 * never re-typed.) They are also invisible to the six pre-existing differentials, each
 * of which compares one LAYER — though `diff:lookup`'s matcher ingress now does see the `und` one,
 * at 66 unexplained rows against 24 before it was added.
 *
 * Every expectation below is MEASURED on the pinned Corretto 21 against
 * `lokalized-java/target/lokalized-3.0.0.jar` — never derived from what this port produces — and
 * every discriminating assertion is paired with a CONTROL that the fix must not move.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { normalizeTag } from "../src/internal/locale.js";
import { jdkLanguageSubtag, parseJdkTag, renderJdkTag } from "../src/internal/locale-jdk-tag.js";

describe("`und` is dropped case-SENSITIVELY, and only as a primary language subtag", () => {
  /**
   * `InternalLocaleBuilder.setLanguageTag` compares the parsed primary language against the constant
   * `"und"` with `equals`, not `equalsIgnoreCase`. Only that comparison produces the empty language.
   *
   * MEASURED, `Locale.forLanguageTag(tag).toLanguageTag()` on the pinned Corretto 21:
   *
   *   und-x-a          -> x-a              UND-x-a          -> und-x-a
   *   und-x-private    -> x-private        UND-X-PRIVATE    -> und-x-private
   *   und-x-lvariant   -> x-lvariant       UND-X-LVARIANT   -> und-x-lvariant
   */
  it("a lowercase primary `und` becomes the empty language; any other casing does not", () => {
    for (const [tag, expected] of /** @type {[string, string][]} */ ([
      ["und-x-a", "x-a"],
      ["UND-x-a", "und-x-a"],
      ["und-X-A", "x-a"],
      ["UND-X-A", "und-x-a"],
      ["Und-x-a", "und-x-a"],
      ["uND-x-a", "und-x-a"],
      ["und-x-private", "x-private"],
      ["UND-X-PRIVATE", "und-x-private"],
      ["und-x-lvariant", "x-lvariant"],
      ["UND-X-LVARIANT", "und-x-lvariant"],
      ["und-x-lvariant-NY", "x-lvariant-NY"],
      ["UND-X-LVARIANT-NY", "und-x-lvariant-NY"],
    ]))
      assert.equal(normalizeTag(tag), expected, tag);
  });

  it("CONTROLS: with a script, a region or a variant present, both spellings agree", () => {
    // `toLanguageTag` re-emits `und` whenever any other subtag is present, so the distinction is
    // unobservable here — which is exactly why `tools/direct-tag-diff/`'s language x script x region
    // sweep could not find the defect and why these rows never moved.
    for (const [tag, expected] of /** @type {[string, string][]} */ ([
      ["und-Latn-x-a", "und-Latn-x-a"],
      ["UND-LATN-X-A", "und-Latn-x-a"],
      ["und-US-x-a", "und-US-x-a"],
      ["UND-US-X-A", "und-US-x-a"],
      ["und-1901", "und-1901"],
      ["und", "und"],
      ["UND", "und"],
      ["x-private", "x-private"],
    ]))
      assert.equal(normalizeTag(tag), expected, tag);
  });

  it("`Locale#getLanguage()` answers `und` for every spelling but the lowercase primary one", () => {
    // The second half of the same defect, and it was wrong in BOTH directions before the fix: this
    // function blanked `und` unconditionally. MEASURED — `Locale.forLanguageTag(t).getLanguage()`:
    //   und -> ""        UND -> "und"      uND -> "und"      unD -> "und"
    //   und-x-a -> ""    UND-x-a -> "und"  zh-und -> "und"   zh-UND -> "und"
    assert.equal(jdkLanguageSubtag("und"), "");
    assert.equal(jdkLanguageSubtag("und-x-a"), "");
    for (const tag of ["UND", "uND", "unD", "UND-x-a", "Und-x-a"])
      assert.equal(jdkLanguageSubtag(tag), "und", tag);

    // An EXTLANG `und` replaces the primary language and is never treated as "no language" at all,
    // whatever its casing. This is the control that keeps the rule scoped to the primary subtag.
    for (const tag of ["zh-und", "zh-UND"]) assert.equal(jdkLanguageSubtag(tag), "und", tag);
  });

  it("`parseJdkTag` records the distinction on the parts, not on the lowercased subtag", () => {
    // The flag is what makes the three consumers agree; asserting it directly means a future
    // consumer cannot silently re-introduce a `language === \"und\"` test and pass these rows.
    assert.equal(parseJdkTag("und-x-a").undetermined, true);
    assert.equal(parseJdkTag("UND-x-a").undetermined, false);
    assert.equal(parseJdkTag("und-x-a").language, "und");
    assert.equal(parseJdkTag("UND-x-a").language, "und");
    // Both parse to the same lowercased language; only the flag separates them, which is the whole
    // point — a port that compared `parts.language` could not tell these two apart.
    assert.notEqual(renderJdkTag(parseJdkTag("und-x-a")), renderJdkTag(parseJdkTag("UND-x-a")));
  });

  it("END TO END: the distinction survives into the lookup locale, and the CHAIN drops it as Java does", () => {
    // MEASURED on the pinned Corretto 21 against `lokalized-3.0.0.jar`, catalogs {fr, nb, nn},
    // fallback fr, per-call locale, key `Hello`:
    //
    //   UND-X-A  lookup=und-x-a  resolved=fr  attempted=[x-a, und, fr]
    //   und-x-a  lookup=x-a      resolved=fr  attempted=[x-a, und, fr]
    //
    // The second line is the one worth keeping: Java's own candidate chain drops the `und` even
    // where its `lookupLocale` keeps it, so the two rows share an attempted list and differ only in
    // the lookup locale. A port that "fixed" this by keeping `und` in the chain would match Java on
    // the first field and diverge on the third.
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: { fr: { Hello: "bonjour" }, nb: { Hello: "B" }, nn: { Hello: "N" } },
    });

    const upper = strings.getResult("Hello", undefined, { locale: "UND-X-A" });
    assert.equal(upper.lookupLocale, "und-x-a");
    assert.deepEqual([...upper.attemptedLocales], ["x-a", "und", "fr"]);

    const lower = strings.getResult("Hello", undefined, { locale: "und-x-a" });
    assert.equal(lower.lookupLocale, "x-a");
    assert.deepEqual([...lower.attemptedLocales], ["x-a", "und", "fr"]);

    assert.notEqual(upper.lookupLocale, lower.lookupLocale);
  });
});

describe("`throwExceptionFor` validates the attempted locales when it has no cause to rethrow", () => {
  /**
   * `DefaultStrings.java:3196-3213` rethrows a retained cause by identity and OTHERWISE constructs a
   * `MissingTranslationException`, whose constructor (`MissingTranslationException.java:130-166`)
   * runs the same `requireWellFormed` + duplicate-language-tag loop as `TranslationResult`'s. The
   * port's `throwForFailure` skipped it, and its own docblock argued the site could not be reached.
   *
   * Three things have to line up before the divergence appears, which is why no earlier gate saw it:
   * a THROWING failure handler, catalogs that cannot answer, and a key present in NO catalog.
   */
  const EXHAUSTS = { fr: { Hello: "bonjour" }, nb: { Hello: "B" }, nn: { Hello: "N" } };

  /** @param {Record<string, unknown>} extra */
  const throwing = (extra = {}) =>
    createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: EXHAUSTS,
      onFailure: () => ({ action: "throw" }),
      ...extra,
    });

  it("refuses a duplicate normalized language tag instead of reporting a missing translation", () => {
    // MEASURED: java.lang.IllegalArgumentException
    //   `Attempted locales must not contain duplicate language tag 'en-US-posix'`
    // The port used to answer `MissingTranslationError: No match for 'Absent' was found for locale
    // 'en-US-POSIX'.`
    assert.throws(
      () => throwing().get("Absent", undefined, { locale: "en-US-x-lvariant-POSIX" }),
      (/** @type {unknown} */ error) =>
        error instanceof TypeError &&
        error.message === "Attempted locales must not contain duplicate language tag 'en-US-posix'",
    );
  });

  it("refuses an ill-formed attempted locale on the same path", () => {
    // NOT decoration beside the row above: this arm is `requireWellFormed`, that one the duplicate
    // check, and the two are separate loops in the same constructor. Java names the locale with
    // `Locale#toString` (`ja_JP_jp_#u-ca-japanese`); the port names it by its BCP 47 tag, the one
    // declared divergence `tools/lookup-diff/` carries.
    assert.throws(
      () => throwing().get("Absent", undefined, { locale: "ja-JP-x-lvariant-JP" }),
      (/** @type {unknown} */ error) =>
        error instanceof TypeError &&
        error.message ===
          "Attempted locale 'ja-JP-u-ca-japanese-x-lvariant-jp' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("CONTROL: a RETAINED CAUSE is still rethrown by identity, before any validation", () => {
    // `:3200-3208` checks the cause FIRST and only then constructs. A port that validated first
    // would replace the corpus's 25 rethrown-by-identity rows with a refusal, so the ORDER is
    // asserted rather than assumed — and the lookup locale here carries the very duplicate the row
    // above proves is refused, so this control fails the moment the two are swapped.
    //
    // The retained cause is the CONTEXTUALIZED wrapper, not the application's own error: a phonetic
    // resolver that throws is wrapped once at the generated-placeholder boundary, and it is the
    // wrapper that is stored, handed to the handler and rethrown unchanged.
    const sentinel = new Error("resolver refuses");
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: {
        fr: {
          Hello: {
            translation: "[{{a}}]",
            placeholders: { a: { value: "term", translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" } } },
          },
        },
        nb: { Hello: "B" },
        nn: { Hello: "N" },
      },
      onFailure: () => ({ action: "throw" }),
      phoneticResolver: () => {
        throw sentinel;
      },
    });

    assert.throws(
      () => strings.get("Hello", { term: "x" }, { locale: "en-US-x-lvariant-POSIX" }),
      (/** @type {unknown} */ error) =>
        error instanceof Error &&
        !(error instanceof TypeError) &&
        error.cause === sentinel &&
        error.message.startsWith("Unable to resolve generated placeholder 'a'"),
    );
  });

  it("CONTROL: an ordinary exhausted walk still raises MissingTranslationError", () => {
    // The refusal must be scoped to chains that actually carry a bad attempted locale. A port that
    // threw a `TypeError` here would pass both discriminating rows above and break every corpus row
    // that records a thrown `MissingTranslationException`.
    assert.throws(
      () => throwing().get("Absent", undefined, { locale: "en" }),
      (/** @type {unknown} */ error) =>
        error instanceof Error &&
        !(error instanceof TypeError) &&
        error.message === "No match for 'Absent' was found for locale 'en'.",
    );
  });
});
