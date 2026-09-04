// @ts-check

/**
 * `forLocale(tag)` — the per-call options object for one explicit locale.
 *
 * NOTHING IN THE CORPUS GATES THIS FUNCTION. The oracle has no counterpart operation for it, and
 * every recorded ingress spells its tag well-formed, so a `forLocale` that skipped normalization
 * entirely — or that deferred it to the `get` call, which is what the plain object literal already
 * does — would leave the conformance count byte-identical. This file is the whole gate, and it is
 * written to DISCRIMINATE rather than to exercise: each pair below has a half that must fail beside
 * the half that must pass, because plan section 3.5 buys exactly one property with this function and
 * a test that only checks the happy half cannot see it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings, forLocale } from "../src/core/index.js";

const strings = createStrings({
  fallbackLocale: "en",
  locale: "en",
  strings: {
    en: { GREETING: "Hello" },
    fr: { GREETING: "Bonjour" },
    "nb-NO": { GREETING: "Hei" },
  },
});

describe("forLocale — syntactic normalization happens immediately", () => {
  it("normalizes the tag at the call site, not at the lookup", () => {
    // The JDK's own selective rewriting, borrowed whole from `normalizeTag`: subtag casing, and the
    // legacy/grandfathered codes. The tag is normalized in the RETURNED object, which is the only
    // place a caller can observe that it happened before any `Strings` was consulted.
    assert.deepEqual(forLocale("nb-no"), { locale: "nb-NO" });
    assert.deepEqual(forLocale("i-klingon"), { locale: "tlh" });
    assert.deepEqual(forLocale("iw"), { locale: "he" });
  });

  it("rejects a malformed tag AT THE CALL, where a hand-written object defers to the lookup", () => {
    // The discriminating half. Both spellings below are rejected in the end, so an implementation
    // that returned `{ locale }` unexamined would pass any test that only checked THAT the malformed
    // tag is refused. What separates them is WHEN: `forLocale` refuses before a `Strings` is even
    // named, and the object literal gets as far as `getResult`.
    assert.throws(() => forLocale("en US"), {
      name: "RangeError",
      message: "Locale tag 'en US' is not a well-formed IETF BCP 47 locale",
    });

    // The control that must FAIL only later: the same malformed tag, hand-written, survives being
    // built into an options object and is refused by the lookup instead.
    const deferred = { locale: "en US" };
    assert.deepEqual(deferred, { locale: "en US" }, "the literal is built without complaint");
    assert.throws(() => strings.get("GREETING", undefined, deferred), { name: "RangeError" });

    // And the control that must PASS, so the rejection above is known to be about well-formedness
    // rather than about anything `forLocale` does to every input it is handed.
    assert.deepEqual(forLocale("en-US"), { locale: "en-US" });
  });

  it("refuses a non-string and an empty tag the same way `normalizeTag` does", () => {
    assert.throws(() => forLocale(/** @type {any} */ (undefined)), { name: "RangeError" });
    assert.throws(() => forLocale(""), { name: "RangeError" });
  });
});

describe("forLocale — the returned object", () => {
  it("is frozen, so one options value cannot be mutated between two calls that share it", () => {
    const options = forLocale("fr");
    assert.ok(Object.isFrozen(options));
    assert.throws(() => {
      /** @type {any} */ (options).locale = "en";
    }, TypeError);
  });

  it("is accepted by `get` and `getResult`, and selects the locale it names", () => {
    // Not merely "does not throw": the instance's ambient locale is `en`, so an options object that
    // was ignored would still answer, and would answer "Hello".
    assert.equal(strings.get("GREETING", undefined, forLocale("fr")), "Bonjour");
    assert.equal(strings.get("GREETING"), "Hello");
    assert.equal(strings.getResult("GREETING", undefined, forLocale("nb-no")).translation, "Hei");
    assert.equal(strings.getResult("GREETING", undefined, forLocale("nb-no")).lookupLocale, "nb-NO");
  });

  it("carries no catalog knowledge: an unloaded but well-formed tag is a valid request", () => {
    // Section 3.5: the instance-dependent validation belongs at consumption, not here. `de` is not
    // loaded, and `forLocale('de')` must still be constructible — it resolves through the fallback
    // at lookup time like any other unloaded request.
    assert.deepEqual(forLocale("de"), { locale: "de" });
    assert.equal(strings.get("GREETING", undefined, forLocale("de")), "Hello");
  });
});
