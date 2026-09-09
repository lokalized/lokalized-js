import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/index.js";

/**
 * THE CONSTRUCTION INGRESS — `LocaleUtils.requireWellFormed` at the three sites a caller reaches
 * before any lookup exists: `Fallback locale` (`Strings.java:211` and `DefaultStrings.java:248`),
 * `Localized strings locale` (`:276`) and `Tiebreaker locale` (`:347`).
 *
 * WHY THIS FILE EXISTS. The checks shipped; the gate did not. `src/core/index.js` named this file as
 * what gates them and the file did not exist, so the only thing driving these three sites was
 * `npm run diff:lookup`, which is not part of `npm run verify` — and which compared the
 * BUILT/REFUSED boolean rather than the refusal, so two of the three could not be discriminated
 * there at all (the port refuses an ill-formed fallback anyway because it names no loaded catalog,
 * and an ill-formed tiebreaker anyway because it breaks the exact-permutation rule). Both halves are
 * fixed; this is the default-gate half.
 *
 * EVERY REFUSAL BELOW IS MEASURED AGAINST THE PINNED CORRETTO 21, against `lokalized-3.0.0.jar`,
 * and every one is paired with a control that must still CONSTRUCT or must refuse for a DIFFERENT,
 * named reason — because a port that refused every ill-formed-looking input would satisfy the
 * refusal half on its own, and because two of these three sites sit next to a refusal the port would
 * raise anyway.
 *
 * THE DIVERGENCE, declared once for the whole file: Java names the offending locale with
 * `Locale#toString` (`en__NY`), a spelling JavaScript has no counterpart for; the port names the
 * same locale by its BCP 47 tag. That is `tools/lookup-diff/`'s
 * `requireWellFormed-names-a-Locale-toString`, staleness-gated there, and it is the ONLY difference
 * at any of these sites — same class of error, same description, same sentence around the name.
 */

/** `Locale.forLanguageTag("en-x-lvariant-NY")` is the Java `Locale` `en__NY`, whose variant `NY` is
 * two characters where BCP 47 wants 5-8 (or 4 with a leading digit). The TAG is well-formed and the
 * LOCALE is not, which is the whole gap `requireWellFormed` exists to close — a tag-level check
 * cannot see it, and `npm run diff:direct-tag` is green on this input. */
const ILL_FORMED = "en-x-lvariant-NY";

const CATALOGS = { en: { Hello: "hello" }, "en-US": { Hello: "hello-us" }, fr: { Hello: "bonjour" } };

describe("Fallback locale — DefaultStrings.java:248 / Strings.java:211", () => {
  it("refuses a fallback locale that is not well-formed", () => {
    // Java, measured: `Fallback locale 'en__NY' is not a well-formed IETF BCP 47 locale`.
    assert.throws(
      () => createStrings({ fallbackLocale: ILL_FORMED, locale: "fr", strings: CATALOGS }),
      {
        name: "RangeError",
        message: "Fallback locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
      },
    );
  });

  it("CONTROL: a well-formed fallback naming no loaded catalog gets the OTHER refusal", () => {
    // THIS IS THE DISCRIMINATING CONTROL, not decoration. The port refuses an ill-formed fallback
    // even with the well-formedness check deleted, because `en-x-lvariant-NY` names no loaded
    // catalog — so "it throws" proves nothing and only the SENTENCE says which check answered.
    // Java, measured, says the same thing here:
    //   Specified fallback locale is 'de' but no matching localized strings locale was found.
    assert.throws(
      () => createStrings({ fallbackLocale: "de", locale: "fr", strings: CATALOGS }),
      {
        name: "RangeError",
        message:
          "Specified fallback locale is 'de' but no matching localized strings locale was found. " +
          "Known locales: [en, en-US, fr]",
      },
    );
  });

  it("CONTROL: a well-formed, loaded fallback constructs and serves", () => {
    // No `en`/`en-US` pair here: that pair is ambiguous without tiebreakers and would refuse for a
    // reason that has nothing to do with this file, which is the trap the tiebreaker suite below
    // pins deliberately.
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: { en: { Hello: "hello" }, fr: { Hello: "bonjour" } },
    });
    assert.equal(strings.get("Hello"), "bonjour");
  });

  it("is checked BEFORE the missing-catalog refusal, as Java checks it before :250", () => {
    // Measured on the pinned JDK: `Strings.withFallbackLocale(en__NY)` throws at the BUILDER ENTRY
    // POINT, before a `localizedStringSupplier` is even configured, and `withFallbackLocale(fr)
    // .build()` then reports the missing supplier. The port has one entry point, so the two Java
    // sites collapse into one — but the ORDER against the neighbouring refusal is observable here
    // and is the same.
    assert.throws(
      () => createStrings({ fallbackLocale: ILL_FORMED, locale: "fr" }),
      { name: "RangeError", message: /^Fallback locale /},
    );
    // The control that makes the ordering claim mean something: with a well-formed fallback the
    // very same call reports the missing catalog instead.
    assert.throws(
      () => createStrings({ fallbackLocale: "fr", locale: "fr" }),
      { name: "TypeError", message: /^createStrings\(\{ strings \}\) is required/ },
    );
  });
});

describe("Localized strings locale — DefaultStrings.java:276", () => {
  it("refuses a catalog key that is not well-formed", () => {
    // Java, measured: `Localized strings locale 'en__NY' is not a well-formed IETF BCP 47 locale`.
    assert.throws(
      () => createStrings({
        fallbackLocale: "fr",
        locale: "fr",
        strings: { fr: { Hello: "bonjour" }, [ILL_FORMED]: { Hello: "hello" } },
      }),
      {
        name: "RangeError",
        message: "Localized strings locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
      },
    );
  });

  it("answers the well-formedness refusal BEFORE the duplicate-tag refusal, as Java does at :280", () => {
    // Two keys that normalize to the same tag AND are ill-formed. Java, measured on the pinned JDK,
    // answers the well-formedness sentence — `:276` precedes `:280` — and so does this.
    assert.throws(
      () => createStrings({
        fallbackLocale: "fr",
        locale: "fr",
        strings: {
          fr: { Hello: "bonjour" },
          [ILL_FORMED]: { Hello: "hello" },
          "en-x-lvariant-ny": { Hello: "hello" },
        },
      }),
      { name: "RangeError", message: /^Localized strings locale / },
    );
    // The control that keeps the ordering claim honest: two colliding keys that are both WELL
    // FORMED still get the duplicate refusal, so the assertion above is about order and not about
    // one refusal having swallowed the other.
    assert.throws(
      () => createStrings({
        fallbackLocale: "fr",
        locale: "fr",
        strings: { fr: { Hello: "bonjour" }, en: { Hello: "hello" }, EN: { Hello: "hello" } },
      }),
      { name: "RangeError", message: /both use IETF BCP 47 language tag/ },
    );
  });

  it("CONTROL: a WELL-FORMED variant key still loads — this is not a variant ban", () => {
    // `fonipa` is a registered 6-character variant, so `en-x-lvariant-fonipa` denotes a `Locale`
    // that `Locale.Builder#setLocale` accepts. A check that refused every private-use variant lift
    // would fail here while passing every assertion above.
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "en-fonipa",
      strings: { fr: { Hello: "bonjour" }, "en-x-lvariant-fonipa": { Hello: "hello-fonipa" } },
    });
    // Sorted for comparison on purpose: what is asserted is that the catalog was ACCEPTED under the
    // lifted tag `en-fonipa`, not the order `getSupportedLocales` returns.
    //
    // WHEN THIS WAS WRITTEN THE `.sort()` WAS ALSO HIDING A REAL DIVERGENCE, and that is worth
    // recording even though the scoping decision was right: the accessor returned the caller's
    // insertion order where Java returns `sortedSupportedLocales`. The `.sort()` here is now
    // redundant rather than load-bearing, and the ordering itself is pinned below, on its own, as
    // its own claim — which is the difference between scoping a test and normalizing away a
    // measurement inside the batch that introduced it.
    assert.deepEqual([...strings.getSupportedLocales()].sort(), ["en-fonipa", "fr"]);
    assert.equal(strings.get("Hello"), "hello-fonipa");
  });
});

describe("getSupportedLocales ordering — DefaultStrings.java:520-521 and plan 3.3:759", () => {
  // MEASURED on pinned Corretto 21 with catalogs {fr, en-fonipa, de, ar}: Java's
  // `getSupportedLocales()` answers `[ar, de, en__fonipa, fr]`, because `DefaultStrings.java:520-521`
  // sorts by `Comparator.comparing(Locale::toLanguageTag)` and `:2700-2702` hands that list back
  // through a `LinkedHashSet`. Plan 3.3:759 says the same thing independently: "Supported locales
  // are sorted by normalized serialized tag."
  //
  // The port answered the CALLER'S INSERTION ORDER from both accessors until 2026-09-09. Nothing
  // caught it because every other consumer sorts locally and `consideredLocales` is sorted inside
  // `src/internal/locale.js`, so the matcher agreed with Java and only the two OBSERVATION points
  // did not. The catalog set is deliberately spelled in an order that is neither sorted nor
  // reverse-sorted, so a port that reversed would fail this too.
  const build = () =>
    createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: {
        fr: { Hello: "bonjour" },
        "en-fonipa": { Hello: "hello-fonipa" },
        de: { Hello: "hallo" },
        ar: { Hello: "marhaba" },
      },
    });

  it("getSupportedLocales is sorted by serialized tag, not by insertion order", () => {
    assert.deepEqual([...build().getSupportedLocales()], ["ar", "de", "en-fonipa", "fr"]);
  });

  it("getLocaleConfiguration().supportedLocales is sorted the same way", () => {
    assert.deepEqual([...build().getLocaleConfiguration().supportedLocales], ["ar", "de", "en-fonipa", "fr"]);
  });

  it("CONTROL: an already-sorted catalog set is unchanged — this is a sort, not a reversal", () => {
    const strings = createStrings({
      fallbackLocale: "ar",
      locale: "ar",
      strings: { ar: { Hello: "marhaba" }, de: { Hello: "hallo" }, fr: { Hello: "bonjour" } },
    });
    assert.deepEqual([...strings.getSupportedLocales()], ["ar", "de", "fr"]);
  });
});

describe("Tiebreaker locale — DefaultStrings.java:347", () => {
  it("refuses a tiebreaker locale that is not well-formed", () => {
    // Java, measured: `Tiebreaker locale 'en__NY' is not a well-formed IETF BCP 47 locale`.
    assert.throws(
      () => createStrings({
        fallbackLocale: "fr",
        locale: "fr",
        strings: CATALOGS,
        tiebreakers: { en: [ILL_FORMED, "en", "en-US"] },
      }),
      {
        name: "RangeError",
        message: "Tiebreaker locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
      },
    );
  });

  it("is NOT the tag-level guard `test/tiebreaker-normalization.test.js` reaches", () => {
    // The distinction this pins is the `zh-123` shape at the tiebreaker site. The pre-existing
    // assertion for an ill-formed tiebreaker uses `!!not-a-tag!!`, which `normalizeTag` refuses
    // FIRST with its own sentence — so it never reaches `:347` at all, and matched the shared
    // regexp `/not a well-formed IETF BCP 47 locale/` anyway. The two guards are different guards
    // and they say different things:
    const guard = (/** @type {string} */ member) => {
      try {
        createStrings({
          fallbackLocale: "fr",
          locale: "fr",
          strings: CATALOGS,
          tiebreakers: { en: ["en", "en-US", member] },
        });
        return "constructed";
      } catch (error) {
        return /** @type {Error} */ (error).message;
      }
    };
    assert.equal(guard("!!not-a-tag!!"), "Locale tag '!!not-a-tag!!' is not a well-formed IETF BCP 47 locale");
    assert.equal(
      guard(ILL_FORMED),
      "Tiebreaker locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("is checked BEFORE the exact-permutation rule, as Java checks :347 before :369", () => {
    // A single ill-formed member is BOTH ill-formed and not a permutation of [en, en-US]. Java,
    // measured, answers the well-formedness sentence; a port that validated the permutation first
    // would answer that the list is missing [en, en-US].
    assert.throws(
      () => createStrings({
        fallbackLocale: "fr",
        locale: "fr",
        strings: CATALOGS,
        tiebreakers: { en: [ILL_FORMED] },
      }),
      { name: "RangeError", message: /^Tiebreaker locale / },
    );
    // The control: a well-formed list that is merely not a permutation still gets the permutation
    // refusal, so the assertion above discriminates the ORDER rather than reporting that any bad
    // list throws.
    assert.throws(
      () => createStrings({
        fallbackLocale: "fr",
        locale: "fr",
        strings: CATALOGS,
        tiebreakers: { en: ["en"] },
      }),
      { name: "RangeError", message: /must be an exact permutation of loaded locales/ },
    );
  });

  it("CONTROL: a well-formed tiebreaker list constructs and resolves the ambiguity", () => {
    // `{en, en-US}` REFUSES to construct without a tiebreaker list — measured:
    //   You must specify tiebreaker locales via createStrings({ tiebreakers }) …
    // so a construction that succeeds here is the ambiguity being resolved, and both catalogs
    // remain reachable afterwards.
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "en",
      strings: CATALOGS,
      tiebreakers: { en: ["en-US", "en"] },
    });
    assert.equal(strings.get("Hello"), "hello");
    assert.equal(strings.get("Hello", undefined, { locale: "en-US" }), "hello-us");
  });
});
