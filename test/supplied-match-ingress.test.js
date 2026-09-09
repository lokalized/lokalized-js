import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings, forLocaleMatch } from "../src/core/index.js";
import { createLocaleNegotiator } from "../src/negotiate/index.js";

/**
 * THE SUPPLIED-MATCH INGRESS — `LocaleUtils.requireWellFormed` at the three sites inside the PUBLIC
 * `LocaleMatchResult` constructor: `Selected locale` (`LocaleMatchResult.java:97`), `Fallback
 * locale` (`:101`) and `Considered locale` (`:117`).
 *
 * WHY THESE ARE CALLER-FACING AT ALL, since a lookup pre-empts every one of them. The constructor is
 * public on purpose and its javadoc says so (`LocaleMatchResult.java:65-80`: "This is public so
 * custom LocaleMatcher implementations can expose the same diagnostics"). The port's counterpart is
 * `validateLocaleMatchStructure`, reached from the allowlisted export `forLocaleMatch`
 * (`lokalized-spec/symbol-allowlist.json:104`, shipped through the `lokalized/core` subpath), from a
 * per-call `{ localeMatch }`, and from `localeMatchResolver`.
 *
 * WHY THIS FILE EXISTS, and it is the same reason `test/construction-ingress.test.js` does, one
 * object over. The port called `normalizeTag` at all three — the TAG-level guard, which ACCEPTS
 * `en-x-lvariant-NY` — while the comment above those two lines asserted `LocaleUtils.requireWellFormed`
 * "applied to the two locales the constructor validates at `:97` and `:101`". A reader was actively
 * told the check existed. `npm run diff:lookup` is structurally blind here: it has lookup, matcher,
 * construction and inspection shapes and no SUPPLIED-MATCH shape, and no lookup can reach a
 * caller-built result. So this file is the whole enforcement, and the instrument's reach was
 * deliberately not allowed to decide the scope of the fix.
 *
 * EVERY REFUSAL BELOW IS MEASURED against the pinned Corretto 21 and `lokalized-3.0.0.jar`, with
 * controls on both sides:
 *
 *   new LocaleMatchResult([en], en__NY, en@1.0, 1.0, EXACT, fr, [en__NY, fr])
 *       -> IllegalArgumentException: Selected locale 'en__NY' is not a well-formed IETF BCP 47 locale
 *   ... with fallbackLocale = en__NY   -> Fallback locale 'en__NY' is not a well-formed …
 *   ... with consideredLocales [fr, en__NY], unmatched
 *                                      -> Considered locale 'en__NY' is not a well-formed …
 *   ... all well-formed, matched AND unmatched   -> both CONSTRUCT
 *
 * The port names the same locale by its BCP 47 tag rather than by `Locale#toString`, which is the
 * standing declared divergence `requireWellFormed-names-a-Locale-toString`, and raises `RangeError`
 * where Java raises `IllegalArgumentException`, which `tools/conformance.mjs`'s `ERROR_NAME` already
 * permits. Neither is new here.
 */

/** A well-formed matched result. Every case below is this with ONE field replaced. */
const matched = () => ({
  requestedLanguageRanges: [{ range: "en", weight: 1 }],
  locale: "en",
  languageRange: { range: "en", weight: 1 },
  effectiveWeight: 1,
  matchType: "exact",
  fallbackLocale: "fr",
  consideredLocales: ["en", "fr"],
});

/** @param {Record<string, unknown>} overrides */
const refuse = (overrides) => {
  try {
    forLocaleMatch({ ...matched(), ...overrides });
    return "NOTHING THROWN";
  } catch (error) {
    return /** @type {Error} */ (error).message;
  }
};

describe("Selected locale — LocaleMatchResult.java:97", () => {
  it("refuses a selected locale that is not well-formed", () => {
    assert.equal(
      refuse({ locale: "en-x-lvariant-NY", consideredLocales: ["en-x-lvariant-NY", "fr"] }),
      "Selected locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("fires BEFORE the unmatched-arm check at :103 — the wrong-site row this closed", () => {
    // THIS IS THE BEHAVIOUR, not the wording. Java answers `Selected locale 'en__NY' is not a
    // well-formed IETF BCP 47 locale` for `{ locale: en__NY, matchType: NONE }`, because `:97`
    // precedes `:103`. The port answered `A matched locale result requires a range, weight, and
    // non-NONE match type` — it refused, but named a SHAPE CONTRADICTION where Java names a
    // malformed locale. A fix that added the three checks after the arms would leave this row wrong
    // and every other assertion in this file green, which is exactly why it is asserted separately.
    assert.equal(
      refuse({
        locale: "en-x-lvariant-NY",
        languageRange: null,
        effectiveWeight: null,
        matchType: "none",
        consideredLocales: ["en-x-lvariant-NY", "fr"],
      }),
      "Selected locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("CONTROL: a null selected locale is not validated — Java's `locale == null ? null : …`", () => {
    assert.equal(
      refuse({
        locale: null,
        languageRange: null,
        effectiveWeight: null,
        matchType: "none",
        isMatch: false,
        requestedLanguageRanges: [],
        consideredLocales: ["fr"],
      }),
      "NOTHING THROWN",
    );
  });
});

describe("Fallback locale — LocaleMatchResult.java:101", () => {
  it("refuses a fallback locale that is not well-formed", () => {
    assert.equal(
      refuse({ fallbackLocale: "en-x-lvariant-NY", consideredLocales: ["en", "en-x-lvariant-NY"] }),
      "Fallback locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("fires BEFORE fallback containment — a malformed fallback is malformed, not absent", () => {
    // Containment at `:123` would otherwise report `The fallback locale must be present in
    // considered locales`, which is a true statement about a different problem.
    assert.equal(
      refuse({ fallbackLocale: "en-x-lvariant-NY" }),
      "Fallback locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });
});

describe("Considered locale — LocaleMatchResult.java:117", () => {
  it("refuses an ill-formed member of consideredLocales", () => {
    assert.equal(
      refuse({
        locale: null,
        languageRange: null,
        effectiveWeight: null,
        matchType: "none",
        isMatch: false,
        requestedLanguageRanges: [],
        consideredLocales: ["fr", "en-x-lvariant-NY"],
      }),
      "Considered locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("fires BEFORE the duplicate-tag check at :119", () => {
    // `:117` is inside the loop and `:119` is the next statement, so an ill-formed member that is
    // ALSO a duplicate is reported as ill-formed. The duplicate rule was the only part of this
    // constructor the port already implemented, which is why the ordering needs its own row.
    assert.equal(
      refuse({
        locale: null,
        languageRange: null,
        effectiveWeight: null,
        matchType: "none",
        isMatch: false,
        requestedLanguageRanges: [],
        consideredLocales: ["fr", "en-x-lvariant-NY", "en-x-lvariant-NY"],
      }),
      "Considered locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("CONTROL: the duplicate rule still fires for WELL-FORMED duplicates", () => {
    // The `zh-123` trap in reverse: if the new check swallowed the duplicate case, every assertion
    // above would still pass. `test/ambient-resolvers.test.js` owns the rule; this pins that adding
    // an earlier guard did not pre-empt it.
    assert.equal(
      refuse({ consideredLocales: ["en", "fr", "FR"] }),
      "Considered locales must not contain duplicate language tag 'fr'",
    );
  });
});

describe("CONTROLS: well-formed results still construct", () => {
  it("a matched result constructs", () => {
    assert.equal(refuse({}), "NOTHING THROWN");
  });

  it("a well-formed variant lift constructs — this is not a private-use ban", () => {
    // `fonipa` is a registered variant, so `en-x-lvariant-fonipa` lifts to `en-fonipa` and denotes a
    // `Locale` the builder accepts. A check that refused every `x-lvariant` would pass every
    // refusal above and fail here.
    assert.equal(
      refuse({
        locale: "en-x-lvariant-fonipa",
        consideredLocales: ["en-x-lvariant-fonipa", "fr"],
        requestedLanguageRanges: [{ range: "en-fonipa", weight: 1 }],
        languageRange: { range: "en-fonipa", weight: 1 },
      }),
      "NOTHING THROWN",
    );
  });
});

describe("the same three checks through the consuming surfaces", () => {
  const build = () =>
    createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: { fr: { Hello: "bonjour" }, en: { Hello: "hello" } },
    });

  it("a per-call { localeMatch } is refused at the same site", () => {
    assert.throws(
      () => build().get("Hello", undefined, { localeMatch: { ...matched(), locale: "en-x-lvariant-NY", consideredLocales: ["en-x-lvariant-NY", "fr"] } }),
      { name: "RangeError", message: "Selected locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale" },
    );
  });

  it("a localeMatchResolver result is refused at the same site, not as a set disagreement", () => {
    // BEFORE the fix this reported `localeMatchSupplier returned a result for different supported
    // locales` for an ill-formed CONSIDERED locale and `The selected locale must be present in
    // considered locales` for an ill-formed SELECTED one — refusing, but for the wrong reason, from
    // the instance-dependent layer that runs after this one.
    const strings = createStrings({
      fallbackLocale: "fr",
      strings: { fr: { Hello: "bonjour" }, en: { Hello: "hello" } },
      localeMatchResolver: () => ({ ...matched(), consideredLocales: ["en-x-lvariant-NY", "fr"] }),
    });

    assert.throws(
      () => strings.get("Hello"),
      { name: "RangeError", message: "Considered locale 'en-x-lvariant-NY' is not a well-formed IETF BCP 47 locale" },
    );
  });

  it("createLocaleNegotiator can no longer report an ill-formed considered locale", () => {
    // MEASURED before the fix: `createLocaleNegotiator({ fallbackLocale: "fr", supportedLocales:
    // ["fr", "en-x-lvariant-NY"] }).matchFor("fr").consideredLocales` answered
    // `["en-x-lvariant-NY", "fr"]` — a `LocaleMatch` value Java's type system cannot construct,
    // because `DefaultStrings.java:1945/:1951` hand `consideredLocales` to the very constructor that
    // refuses it. The negotiator refuses its own configuration first, which is why this asserts a
    // throw rather than a sorted list.
    assert.throws(
      () => createLocaleNegotiator({ fallbackLocale: "fr", supportedLocales: ["fr", "en-x-lvariant-NY"] }).matchFor("fr"),
      { message: /is not a well-formed IETF BCP 47 locale/ },
    );
  });

  it("CONTROL: a well-formed negotiator still answers", () => {
    const match = createLocaleNegotiator({ fallbackLocale: "fr", supportedLocales: ["fr", "en"] }).matchFor("en");
    assert.equal(match.locale, "en");
    assert.deepEqual([...match.consideredLocales], ["en", "fr"]);
  });
});
