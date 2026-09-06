// @ts-check
/**
 * `normalizeTag` is `Locale.forLanguageTag(tag).toLanguageTag()`, not a re-serialization of the tag.
 *
 * A tag becomes a `Locale` on the way in — a four-field `BaseLocale` plus a SORTED
 * `LocaleExtensions` — and only that intermediate is rendered back out. Four rewrites ride on that
 * round trip and none of them is reachable by shuffling subtags:
 *
 *   1. the `lvariant` VARIANT LIFT — a private-use subtag beginning `lvariant-` is not private use
 *      at all, it is how a Java `Locale` variant rides through a grammar with no slot for one;
 *   2. the COMPATIBILITY EXTENSIONS — a bare `JP` variant on `ja-JP` (`TH` on `th-TH`) synthesizes
 *      `u-ca-japanese` (`u-nu-thai`);
 *   3. the `no-NO-NY` REWRITE — the Java-6 spelling of Nynorsk becomes `nn-NO`, changing the
 *      LANGUAGE and therefore which catalog answers;
 *   4. the `-u-` PAYLOAD SORT — a Unicode extension is a set of attributes and a map of
 *      keyword→type, so `u-nu-latn-ca-gregory` and `u-ca-gregory-nu-latn` are one locale.
 *
 * WHY THIS FILE EXISTS AND WHAT IT IS WORTH. Not one corpus row spells a Unicode extension or an
 * `x-lvariant` tag, so `npm run conformance` was byte-identical before and after this behaviour
 * landed — the same shape as the two tiebreaker defects `CLAUDE.md` records. The real oracle is
 * `npm run diff:direct-tag`, which compares tens of thousands of well-formed tags against the
 * pinned Corretto 21 and is NOT part of `npm run verify`. No count is quoted here on purpose: the
 * run prints its own, the probe space grows whenever a slice adds an edge, and an earlier draft of
 * this header said 46,363 when the measured figure was 46,369. What IS load-bearing and was checked
 * mechanically: every tag asserted below is a member of that probe space, so every expectation is
 * copied from what the JDK answered rather than from what this port produces.
 *
 * Every block pairs a DISCRIMINATING input with a CONTROL the port already answered correctly
 * before the change. Verified by ablation rather than by argument: with `locale-jdk-tag.js` reverted
 * to its pre-slice version the discriminating assertions fail and every control stays green.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStrings } from "../src/core/index.js";
import { normalizeTag } from "../src/internal/locale.js";

/**
 * @param {[string, string][]} rows
 * @param {string} why
 */
function expectAll(rows, why) {
  for (const [tag, expected] of rows) assert.equal(normalizeTag(tag), expected, `${why}: ${tag}`);
}

describe("the lvariant variant lift", () => {
  test("a private-use `lvariant` marker carries a Locale variant, and the variant comes back out in place", () => {
    expectAll(
      [
        ["en-US-x-lvariant-POSIX", "en-US-POSIX"],
        ["en-x-lvariant-POSIX", "en-POSIX"],
        ["de-DE-x-lvariant-1901", "de-DE-1901"],
        // The marker need not be first: what precedes it stays private use, what follows is lifted.
        ["en-US-x-a-lvariant-POSIX", "en-US-POSIX-x-a"],
        // A real variant and a lifted one concatenate, in that order.
        ["en-US-1901-x-lvariant-POSIX", "en-US-1901-POSIX"],
      ],
      "lifted variant",
    );
  });

  test("the lifted variant keeps its CASE, unlike every other subtag class", () => {
    // `Locale#getVariant` is the one field `BaseLocale` does not case-normalize, so these are two
    // different locales — which is exactly the collision `DefaultStrings.java:280` refuses.
    assert.equal(normalizeTag("en-US-x-lvariant-POSIX"), "en-US-POSIX");
    assert.equal(normalizeTag("en-US-x-lvariant-posix"), "en-US-posix");
    assert.notEqual(normalizeTag("en-US-x-lvariant-POSIX"), normalizeTag("en-US-x-lvariant-posix"));
  });

  test("a lifted variant BCP 47 cannot spell goes back out behind the marker, still cased", () => {
    // `A` and `B` are not well-formed variants, so `toLanguageTag` re-emits them as private use.
    assert.equal(normalizeTag("EN-US-X-LVARIANT-A-B"), "en-US-x-lvariant-A-B");
  });

  test("CONTROLS: a trailing marker is not a marker, and ordinary private use is untouched", () => {
    expectAll(
      [
        // `x-lvariant` with nothing behind it carries no variant and round-trips whole.
        ["en-US-x-lvariant", "en-US-x-lvariant"],
        ["en-US-x-a", "en-US-x-a"],
        ["en-x-private", "en-x-private"],
        ["x-private", "x-private"],
        // A variant spelled the ordinary way needs no lift and must not acquire one.
        ["en-US-POSIX", "en-US-POSIX"],
      ],
      "control",
    );
  });
});

describe("the ja-JP-JP / th-TH-TH compatibility extensions", () => {
  test("a bare JP/TH variant synthesizes the calendar and numbering-system extensions", () => {
    expectAll(
      [
        ["ja-JP-x-lvariant-JP", "ja-JP-u-ca-japanese-x-lvariant-JP"],
        ["th-TH-x-lvariant-TH", "th-TH-u-nu-thai-x-lvariant-TH"],
      ],
      "compatibility extension",
    );
  });

  test("the synthesis is exact-case, script-sensitive, and suppressed by any extension", () => {
    expectAll(
      [
        // `getCompatibilityExtensions` compares the variant with `"JP".equals(...)`, not ignoring case.
        ["ja-JP-x-lvariant-jp", "ja-JP-x-lvariant-jp"],
        // It also requires an EMPTY script.
        ["ja-Latn-JP-x-lvariant-JP", "ja-Latn-JP-x-lvariant-JP"],
        // And `forLanguageTag` only consults it when the locale has no extensions of its own.
        ["ja-JP-a-bbb-x-lvariant-JP", "ja-JP-a-bbb-x-lvariant-JP"],
        ["ja-JP-u-ca-gregory-x-lvariant-JP", "ja-JP-u-ca-gregory-x-lvariant-JP"],
        ["th-TH-a-bbb-x-lvariant-TH", "th-TH-a-bbb-x-lvariant-TH"],
      ],
      "suppressed synthesis",
    );
  });

  test("CONTROLS: what a suppressed synthesis must NOT produce, and tags this slice cannot touch", () => {
    // The rows above are NOT controls and saying so is the point: three of the five carry an
    // uppercase private-use payload, so their whole-tag expectations move under the ablation for the
    // `lvariant` casing rather than for the suppression. What holds on BOTH sides of the change is
    // the absence of a synthesized extension, so that is what the control asserts.
    for (const tag of ["ja-JP-x-lvariant-jp", "ja-Latn-JP-x-lvariant-JP", "ja-JP-a-bbb-x-lvariant-JP",
      "ja-JP-u-ca-gregory-x-lvariant-JP"])
      assert.ok(!normalizeTag(tag).includes("ca-japanese"), `no calendar may be synthesized for ${tag}`);

    for (const tag of ["th-TH-a-bbb-x-lvariant-TH", "th-th-x-lvariant-th"])
      assert.ok(!normalizeTag(tag).includes("nu-thai"), `no numbering system may be synthesized for ${tag}`);

    expectAll(
      [
        // An all-lowercase payload cannot trigger the synthesis and never carried the casing fix
        // either, so these two are unchanged in both directions.
        ["ja-jp-x-lvariant-jp", "ja-JP-x-lvariant-jp"],
        ["th-th-x-lvariant-th", "th-TH-x-lvariant-th"],
        // An extension spelled by the caller is not synthesis and never was affected.
        ["ja-JP-u-ca-japanese", "ja-JP-u-ca-japanese"],
        ["th-TH-u-nu-thai", "th-TH-u-nu-thai"],
        ["ja-JP", "ja-JP"],
        ["th-TH", "th-TH"],
      ],
      "control",
    );
  });
});

describe("the no-NO-NY rewrite, which changes the language", () => {
  test("`no-NO` with a lifted `NY` variant IS Nynorsk", () => {
    assert.equal(normalizeTag("no-NO-x-lvariant-NY"), "nn-NO");
    // `LanguageTag.parseLocale` tests language/region/variant only — a script does not block it.
    assert.equal(normalizeTag("no-Latn-NO-x-lvariant-NY"), "nn-Latn-NO");
  });

  test("CONTROLS: neither neighbour of the rewrite moves", () => {
    expectAll(
      [
        // The variant comparison is case-sensitive: a lowercase `ny` is not the Java-6 spelling.
        ["no-no-x-lvariant-ny", "no-NO-x-lvariant-ny"],
        ["no-NO", "no-NO"],
        ["nn-NO", "nn-NO"],
        ["nn", "nn"],
        // The grandfathered spellings reach the same place by a different route, and always did.
        ["no-nyn", "nn"],
        ["no-bok", "nb"],
      ],
      "control",
    );
  });

  test("END TO END: the rewrite decides which catalog answers, not just what the tag prints", () => {
    // Measured on the pinned Corretto 21 against `lokalized-3.0.0.jar` with the same three catalogs
    // and fallback: Java answers NYNORSK / BOKMAAL / NYNORSK for these three requests.
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: { nn: { greeting: "NYNORSK" }, nb: { greeting: "BOKMAAL" }, fr: { greeting: "FRENCH" } },
    });

    const answer = /** @param {string} tag */ (tag) => strings.getResult("greeting", undefined, { locale: tag });

    const nynorsk = answer("no-NO-x-lvariant-NY");
    assert.equal(nynorsk.translation, "NYNORSK");
    assert.equal(nynorsk.resolvedLocale, "nn");

    // The two controls are what make the line above evidence rather than assertion: a port that
    // simply always answered `nb` would pass the first of these and fail the second.
    const bokmaal = answer("no-NO");
    assert.equal(bokmaal.translation, "BOKMAAL");
    assert.equal(bokmaal.resolvedLocale, "nb");

    const direct = answer("nn");
    assert.equal(direct.translation, "NYNORSK");
    assert.equal(direct.resolvedLocale, "nn");
  });

  test("CONSTRUCTION, corroborated against Java: the lift makes two case-differing catalogs a refusal Java also makes", () => {
    // THIS is the Java-backed construction row for the private-use casing work, and the one place
    // where the port and `DefaultStrings.java:277-282` observably agree on a duplicate.
    //
    // MEASURED on the pinned Corretto 21 against `lokalized-3.0.0.jar` this session:
    //
    //   Locale.forLanguageTag("en-US-x-lvariant-POSIX")  ->  en_US_POSIX   (toLanguageTag en-US-POSIX)
    //   Locale.forLanguageTag("en-US-x-lvariant-posix")  ->  en_US_posix   (toLanguageTag en-US-posix)
    //   equals -> FALSE. Two DISTINCT Locales, so a `Map<Locale, …>` holds both (size 3 after 3
    //   puts), `:280` fires, and `Strings.build()` throws:
    //     Localized strings locales 'en_US_POSIX' and 'en_US_posix' both use IETF BCP 47 language
    //     tag 'en-US-posix'
    //
    // The port throws the same sentence with BCP 47 spellings where Java prints `Locale#toString`'s
    // underscore form, which JavaScript has no counterpart for. Contrast the `-u-` pair below,
    // which Java's map type CANNOT hold as two entries and which is therefore a port choice rather
    // than parity.
    //
    // ABLATION (revert `src/internal/locale-jdk-tag.js` to its pre-slice version): the refusal
    // still fires, but with NO distinction in it — both keys lift to nothing and print identically
    // as `en-US-x-lvariant-posix`, so the message names a collision between a tag and itself. The
    // message pattern below is what discriminates; a bare /both use IETF BCP 47/ would not.
    assert.throws(
      () =>
        createStrings({
          fallbackLocale: "en",
          locale: "en",
          strings: {
            en: { k: "EN" },
            "en-US-x-lvariant-POSIX": { k: "A" },
            "en-US-x-lvariant-posix": { k: "B" },
          },
        }),
      /locales 'en-US-x-lvariant-POSIX' and 'en-US-x-lvariant-posix' both use IETF BCP 47 language tag 'en-US-posix'/,
    );

    // The same collision spelled the way Java's `Locale#toString` renders it. Here the port's
    // message is Java's byte for byte, modulo `-` for `_`: the caller's own keys ARE the two
    // distinct locales Java prints.
    assert.throws(
      () =>
        createStrings({
          fallbackLocale: "en",
          locale: "en",
          strings: { en: { k: "EN" }, "en-US-POSIX": { k: "A" }, "en-US-posix": { k: "B" } },
        }),
      (/** @type {unknown} */ error) =>
        error instanceof RangeError &&
        error.message ===
          "Localized strings locales 'en-US-POSIX' and 'en-US-posix' both use IETF BCP 47 " +
            "language tag 'en-US-posix'",
    );

    // CONTROL: two lifted variants that are not a case pair still construct, so the refusals above
    // are the CASE collision and not `x-lvariant` being rejected wholesale.
    //
    // The languages are deliberately all different, and that is a `zh-123` guard rather than
    // fussiness: the first draft of this control paired `en` with `en-US-x-lvariant-POSIX` and
    // threw before it ever reached the duplicate check — `You must specify tiebreaker locales …
    // for language code 'en' … [en, en-US-POSIX]` — which would have "passed" a control that never
    // exercised the check under test. (Java refuses that shape too, measured this session.)
    assert.doesNotThrow(() =>
      createStrings({
        fallbackLocale: "en",
        locale: "en",
        strings: {
          en: { k: "EN" },
          "fr-FR-x-lvariant-POSIX": { k: "A" },
          "de-DE-x-lvariant-1901": { k: "B" },
        },
      }),
    );
  });
});

describe("the Unicode extension payload is a set and a map, not a subtag list", () => {
  test("keyword keys come back SORTED, whatever order the caller spelled them in", () => {
    assert.equal(normalizeTag("en-US-u-nu-latn-ca-gregory"), "en-US-u-ca-gregory-nu-latn");
  });

  test("attributes are sorted too, and a repeated keyword key is first-wins", () => {
    expectAll(
      [
        ["en-u-zzzz-aaaa-ca-gregory", "en-u-aaaa-zzzz-ca-gregory"],
        ["en-u-ca-gregory-ca-japanese", "en-u-ca-gregory"],
        // The edge a paraphrase of the JDK loop loses: once the repeated `ca` is dropped, `x2` is
        // re-examined as a KEY rather than banked as a second type for `ca`.
        ["en-u-ca-x1-ca-x2", "en-u-ca-x1-x2"],
        // A keyword with no type is emitted bare, and still sorts by its key.
        ["en-u-nu-latn-ca", "en-u-ca-nu-latn"],
        // A repeated singleton keeps only the first occurrence.
        ["en-u-ca-buddhist-u-nu-thai", "en-u-ca-buddhist"],
      ],
      "unicode extension",
    );
  });

  test("CONTROLS: an already-canonical payload is unchanged, and singleton order was never the bug", () => {
    expectAll(
      [
        ["en-US-u-ca-gregory-nu-latn", "en-US-u-ca-gregory-nu-latn"],
        ["en-u-aaaa-zzzz-ca-gregory", "en-u-aaaa-zzzz-ca-gregory"],
        ["en-u-ca-buddhist", "en-u-ca-buddhist"],
        // Singletons already sorted before this slice; these two rows prove the new code did not
        // trade one ordering for another.
        ["en-a-bbb-u-ca-gregory", "en-a-bbb-u-ca-gregory"],
        ["en-US-t-en-latn-u-ca-gregory", "en-US-t-en-latn-u-ca-gregory"],
      ],
      "control",
    );
  });

  test("two catalogs differing only in keyword order are now ONE locale, and refused — a PORT CHOICE", () => {
    // A PORT DECISION WITH NO JAVA COUNTERPART, and an earlier draft of this comment claimed the
    // opposite. It said Java refuses this pair at `DefaultStrings.java:277-282`. MEASURED on the
    // pinned Corretto 21 this session, it does not, and it cannot:
    //
    //   Locale.forLanguageTag("en-US-u-nu-latn-ca-gregory")
    //     == Locale.forLanguageTag("en-US-u-ca-gregory-nu-latn")   // true, the SAME interned object
    //
    // Java's supplier signature is `Map<Locale, ? extends Iterable<LocalizedString>>`, so the pair
    // cannot be expressed as two entries at all: a `LinkedHashMap` given both spellings holds ONE
    // (measured: size 2 after 3 puts), the second `put` silently REPLACES the first, and
    // `:277-282` is never reached. Java's nearest observable behaviour is therefore to keep one
    // catalog and drop the other without a word — reachable in real use, since `loadFromFilesystem`
    // and `loadFromClasspath` also key by `Locale`.
    //
    // The port keys catalogs by STRING, so it can see the pair and refuses it. That is a defensible
    // choice — silently dropping a catalog is the worse failure — but it is the port's, not Java's,
    // and it must not be recorded as parity. The Java-corroborated row is the case-collision test
    // below, which reaches `:277-282` for real.
    assert.throws(
      () =>
        createStrings({
          fallbackLocale: "en",
          locale: "en",
          strings: {
            en: { k: "EN" },
            "en-US-u-nu-latn-ca-gregory": { k: "A" },
            "en-US-u-ca-gregory-nu-latn": { k: "B" },
          },
        }),
      /both use IETF BCP 47 language tag/,
    );

    // The diagnostic must name BOTH keys the caller actually wrote. It did not before: the
    // duplicate map stored the NORMALIZED tag, so this message printed
    // `'en-US-u-ca-gregory-nu-latn' and 'en-US-u-ca-gregory-nu-latn'` — the same tag three times,
    // neither of the caller's two spellings anywhere in it, and nothing to act on.
    assert.throws(
      () =>
        createStrings({
          fallbackLocale: "en",
          locale: "en",
          strings: {
            en: { k: "EN" },
            "en-US-u-nu-latn-ca-gregory": { k: "A" },
            "en-US-u-ca-gregory-nu-latn": { k: "B" },
          },
        }),
      /locales 'en-US-u-nu-latn-ca-gregory' and 'en-US-u-ca-gregory-nu-latn' both use/,
    );

    // CONTROL: the same two payloads on genuinely different locales still construct, so the refusal
    // above is the keyword sort collapsing two spellings and not extensions being rejected wholesale.
    assert.doesNotThrow(() =>
      createStrings({
        fallbackLocale: "en",
        locale: "en",
        strings: {
          en: { k: "EN" },
          "fr-FR-u-nu-latn-ca-gregory": { k: "A" },
          "de-DE-u-ca-gregory-nu-latn": { k: "B" },
        },
      }),
    );
  });
});
