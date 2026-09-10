import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/index.js";

/**
 * Plan 3.3:771-773, the exact-locale inspection surface.
 *
 * Both members were measured against the pinned JDK on 2026-09-06 and both were wrong:
 * `getKeysForLocale` returned `[]` for an unsupported locale where Java throws, and returned keys in
 * catalog INSERTION order where Java's `TreeSet` returns them sorted. `getMissingKeys` did not exist.
 *
 * Every refusal below is paired with a control that must PASS, because a member that refused
 * everything would satisfy the refusal half on its own.
 */
const strings = () =>
  createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: { en: { Beta: "b", Alpha: "a", Gamma: "g" }, "en-GB": { Alpha: "a" }, ro: { Alpha: "a" } },
    tiebreakers: { en: ["en", "en-GB"] },
  });

describe("getKeysForLocale", () => {
  it("returns keys SORTED, not in catalog insertion order", () => {
    // The catalog is authored Beta, Alpha, Gamma. Insertion order would be the authored order, and
    // that is exactly the defect this pins: Java's TreeSet answers natural String order.
    assert.deepEqual(strings().getKeysForLocale("en"), ["Alpha", "Beta", "Gamma"]);
  });

  it("throws for a locale that is not supported, rather than answering empty", () => {
    assert.throws(() => strings().getKeysForLocale("fr"), /Unsupported locale 'fr' was provided/);
  });

  it("accepts a case-normalized spelling of a supported tag — the control for the throw above", () => {
    assert.deepEqual(strings().getKeysForLocale("EN-gb"), ["Alpha"]);
  });

  it("refuses an absent CLDR-EQUIVALENT tag, which is the distinction plan 3.3:773 draws", () => {
    // `mo` is CLDR-equivalent to the loaded `ro`, and inspection performs no equivalence. The pair
    // matters: `ro` must still resolve, or this would pass for a member that refused both.
    assert.throws(() => strings().getKeysForLocale("mo"), /Unsupported locale 'mo' was provided/);
    assert.deepEqual(strings().getKeysForLocale("ro"), ["Alpha"]);
  });

  it("returns a frozen array", () => {
    assert.equal(Object.isFrozen(strings().getKeysForLocale("en")), true);
  });
});

describe("getMissingKeys", () => {
  it("reports keys present in the source and absent from the target", () => {
    assert.deepEqual(strings().getMissingKeys("en", "ro"), ["Beta", "Gamma"]);
  });

  it("is directional — the control that stops a symmetric-difference implementation passing", () => {
    assert.deepEqual(strings().getMissingKeys("ro", "en"), []);
  });

  it("applies the support rule INDEPENDENTLY to source and target, and NAMES WHICH", () => {
    // The ROLE, and these two assertions are the reason it exists. Until 2026-09-09 both of them
    // read `/Unsupported locale 'fr'/` — the same sentence for two different arguments — so a
    // caller who passed two tags was told only that one of them was wrong, and this file could not
    // tell a port that refused the source from one that refused the target. Java draws the
    // distinction at `DefaultStrings.java:2738` and `:2741`; the well-formedness half of the same
    // ingress already drew it here (see the RangeError assertions below). Exact messages, not
    // regexps: a regexp for the source sentence matches the target one under `/Unsupported/`.
    assert.throws(() => strings().getMissingKeys("fr", "en"), {
      name: "UnsupportedLocaleError",
      message: "Unsupported source locale 'fr' was provided",
    });
    assert.throws(() => strings().getMissingKeys("en", "fr"), {
      name: "UnsupportedLocaleError",
      message: "Unsupported target locale 'fr' was provided",
    });
    // Control: both supported still answers.
    assert.deepEqual(strings().getMissingKeys("en", "en-GB"), ["Beta", "Gamma"]);
  });

  it("returns a frozen array", () => {
    assert.equal(Object.isFrozen(strings().getMissingKeys("en", "ro")), true);
  });
});

/**
 * THE INSPECTION INGRESS — `LocaleUtils.requireWellFormed` at `DefaultStrings.java:2713`
 * ("Locale"), `:2735` ("Source locale") and `:2736` ("Target locale").
 *
 * NOTHING ABOVE THIS BLOCK IS CHANGED. These are additions: the file specified WHAT inspection
 * answers and said nothing about the ill-formed input class, so the port refused it at the wrong
 * site for a week — `getKeysForLocale(en__NY)` came back as `UnsupportedLocaleError: Unsupported
 * locale 'en-x-lvariant-NY' was provided`, reporting a catalog that is missing where Java reports a
 * locale that cannot exist.
 *
 * MEASURED ON THE PINNED CORRETTO 21 against `lokalized-3.0.0.jar`, with catalogs {en, fr}:
 *
 *   getKeysForLocale(en__NY)             Locale 'en__NY' is not a well-formed IETF BCP 47 locale
 *   getKeysForLocale(de)                 Locale 'de' is not supported
 *   getMissingKeys(en__NY, en)           Source locale 'en__NY' is not a well-formed …
 *   getMissingKeys(en, en__NY)           Target locale 'en__NY' is not a well-formed …
 *   getMissingKeys(de, en__NY)           Target locale 'en__NY' is not a well-formed …   <- ORDER
 *   getMissingKeys(de, en)               Source locale 'de' is not supported
 *
 * The fifth row is the whole point: BOTH well-formedness checks run before EITHER support check, so
 * an unsupported source and an ill-formed target answer about the TARGET. A port that resolved
 * source-then-target answers about the source and satisfies every other row here.
 *
 * TWO DIVERGENCES, both decided elsewhere and neither introduced here. The locale is named by its
 * BCP 47 tag rather than by `Locale#toString` (`tools/lookup-diff/`'s
 * `requireWellFormed-names-a-Locale-toString`), and the SUPPORT refusal follows plan 3.3:771's
 * `UnsupportedLocaleError` rather than Java's sentence (M7-STATUS decision 3). The well-formedness
 * refusal is `RangeError`, `normalizeTag`'s class, because it is the same validation boundary.
 */
describe("the inspection ingress — well-formedness is checked BEFORE support", () => {
  /** `en__NY` in Java: a well-formed TAG denoting a `Locale` that `Locale.Builder` will not rebuild. */
  const ILL_FORMED = "en-x-lvariant-NY";

  it("getKeysForLocale refuses an ill-formed locale as ILL-FORMED, not as unsupported", () => {
    assert.throws(() => strings().getKeysForLocale(ILL_FORMED), {
      name: "RangeError",
      message: "Locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    });
    // THE PAIRED CONTROL, and it is what makes the assertion above about the SITE rather than about
    // the throw: a locale that is well-formed and merely absent still gets the support refusal, and
    // a supported one still answers.
    assert.throws(() => strings().getKeysForLocale("de"), {
      name: "UnsupportedLocaleError",
      message: "Unsupported locale 'de' was provided",
    });
    assert.deepEqual(strings().getKeysForLocale("en"), ["Alpha", "Beta", "Gamma"]);
  });

  it("getMissingKeys names the SOURCE and the TARGET separately, as Java's two sites do", () => {
    assert.throws(() => strings().getMissingKeys(ILL_FORMED, "en"), {
      name: "RangeError",
      message: "Source locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    });
    assert.throws(() => strings().getMissingKeys("en", ILL_FORMED), {
      name: "RangeError",
      message: "Target locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    });
    // Control: both well-formed and both supported still answers.
    assert.deepEqual(strings().getMissingKeys("en", "ro"), ["Beta", "Gamma"]);
  });

  it("checks BOTH locales for well-formedness before EITHER for support", () => {
    // The ordering probe. An unsupported source and an ill-formed target: Java answers about the
    // TARGET, because `:2735`/`:2736` both precede `:2738`. A port that validated and resolved one
    // argument at a time would answer `Unsupported locale 'de'` here and pass every other assertion
    // in this file.
    assert.throws(() => strings().getMissingKeys("de", ILL_FORMED), {
      name: "RangeError",
      message: "Target locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    });
    // The mirror, so the assertion above cannot be satisfied by always naming the target.
    assert.throws(() => strings().getMissingKeys(ILL_FORMED, "de"), {
      name: "RangeError",
      message: "Source locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    });
    // And the control that keeps the ORDER claim from being trivially satisfied by a port that
    // never checks support at all: with both locales well-formed, the source's absence is what
    // answers.
    assert.throws(() => strings().getMissingKeys("de", "en"), {
      name: "UnsupportedLocaleError",
      message: "Unsupported source locale 'de' was provided",
    });
  });

  it("names the SOURCE when BOTH locales are ill-formed, because :2735 precedes :2736", () => {
    // The only input that separates the source pre-check from the target one: with both ill-formed,
    // deleting the source pre-check leaves the target's firing first and the message names the
    // wrong argument. Java, measured on the pinned JDK with two DIFFERENT ill-formed locales so the
    // answer cannot be read either way:
    //   getMissingKeys(en__NY, de__XX)  ->  Source locale 'en__NY' is not a well-formed …
    //   getMissingKeys(de__XX, en__NY)  ->  Source locale 'de__XX' is not a well-formed …
    assert.throws(() => strings().getMissingKeys(ILL_FORMED, "de-x-lvariant-XX"), {
      name: "RangeError",
      message: "Source locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    });
    assert.throws(() => strings().getMissingKeys("de-x-lvariant-XX", ILL_FORMED), {
      name: "RangeError",
      message: "Source locale 'de-x-lvariant-XX' is not a well-formed IETF BCP 47 locale",
    });
  });
});
