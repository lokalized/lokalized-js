// @ts-check

/**
 * The walk's two caller callbacks: `fallbackPolicy`, consulted between candidates, and `onFailure`,
 * consulted once at the end.
 *
 * The corpus covers both channels heavily — 424 rows record policy consultations and 471 record the
 * failure the handler was handed — so most of what is asserted here is deliberately NOT a restatement
 * of that. Five things live here because the conformance runner structurally cannot see them:
 *
 *   - THE BUILT-IN NAMES. `tools/conformance.mjs` must occupy the single policy slot with its own
 *     recording wrapper, so every corpus case that names `"any-failure"` exercises the RUNNER's copy
 *     of the built-in and never the port's table. Delete `BUILTIN_FALLBACK_POLICIES` from
 *     `src/core/index.js` and the whole corpus stays green; the first suite below goes red. That is
 *     the ablation, and it is the only thing standing behind three of plan 2.5's four policies.
 *   - THE LIBRARY DEFAULTS. For the same reason: the runner always installs both callbacks, so the
 *     `== null` defaulting is never reached from the corpus at all.
 *   - A POLICY THAT RETURNS A NON-BOOLEAN. Java's `requireNonNull` (DefaultStrings.java:735) has no
 *     corpus counterpart because `VectorOracle` has no return-null behavior — plan open question 7.
 *   - THE SHAPE OF `TranslationFailure`. Frozen, null-prototype, with a null-prototype placeholders
 *     record. The runner reads named fields off it and would not notice an inherited `constructor`.
 *   - THAT THE POLICY IS NOT CONSULTED FOR THE FINAL CANDIDATE when the chain has exactly one
 *     element. The corpus states this in `custom-policy.singlecandidate.throwing-policy-is-inert-and-
 *     the-handler-fires`. That row is no longer attributed — B2 landed the throw comparison and it
 *     passes — so the clause now has two independent witnesses rather than one. It stays here
 *     because the corpus row reaches it through a THROWING policy, and a port that consulted the
 *     final candidate with a well-behaved policy would still be wrong and still be green there.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RETURN_KEY, THROW_EXCEPTION, createStrings, returnString } from "../src/core/index.js";

/**
 * en-GB / en-001 / en with fallback fr: the four-candidate chain `custom-policy-four-candidate-chain`
 * uses, reproduced here because chain LENGTH is the variable every truncation clause turns on.
 */
const FOUR_CANDIDATE = {
  fallbackLocale: "fr",
  locale: "fr",
  tiebreakers: { en: ["en-GB", "en-001", "en"] },
  strings: {
    "en-GB": { InEvery: "en-GB: everywhere" },
    "en-001": { InEvery: "en-001: everywhere" },
    en: { InEvery: "en: everywhere", OnlyInEn: "en: only here" },
    fr: { InEvery: "fr: everywhere", OnlyInFallback: "fr: only here" },
  },
};

/** A single-element chain: only `en` is loaded, `en` is the fallback, `en` is requested. */
const SINGLE_CANDIDATE = { fallbackLocale: "en", locale: "en", strings: { en: { Present: "here" } } };

/** Records every consultation and answers from a delegate. */
function recordingPolicy(delegate) {
  /** @type {{ reason: string, locale: string, cause: unknown }[]} */
  const calls = [];
  return {
    calls,
    policy: (/** @type {any} */ reason, /** @type {any} */ locale, /** @type {any} */ cause) => {
      calls.push({ reason, locale, cause });
      return delegate(reason, locale, cause);
    },
  };
}

describe("createStrings({ fallbackPolicy }) — the three built-in names", () => {
  // THE ABLATION THAT MATTERS. Each case drives the same lookup twice against the same catalogs:
  // once naming the built-in by STRING, which only the port's own table can resolve, and once with
  // an explicit function spelling the same rule. The two must agree on the translation AND on the
  // attempted list, so a table that resolved `"any-failure"` to the wrong predicate — or resolved it
  // at all when it should have refused — is caught here and nowhere else.
  const CATALOGS = {
    fallbackLocale: "en",
    locale: "de",
    strings: {
      // `de` holds the key but cannot render it: `absentCount` is never supplied.
      de: {
        Key: {
          translation: "de: {{word}}",
          placeholders: { word: { value: "absentCount", translations: { CARDINALITY_ONE: "x", CARDINALITY_OTHER: "y" } } },
        },
      },
      en: { Key: "en: served by the fallback" },
    },
  };

  const EQUIVALENTS = /** @type {const} */ ([
    ["missing-or-no-match", (/** @type {string} */ reason) => reason !== "resolution-failure"],
    ["any-failure", () => true],
    ["never", () => false],
  ]);

  for (const [name, equivalent] of EQUIVALENTS) {
    it(`'${name}' resolves to the same policy as the function that spells it`, () => {
      const byName = createStrings({ ...CATALOGS, fallbackPolicy: name }).getResult("Key");
      const byFunction = createStrings({ ...CATALOGS, fallbackPolicy: equivalent }).getResult("Key");

      assert.equal(byName.translation, byFunction.translation);
      assert.equal(byName.status, byFunction.status);
      assert.deepEqual([...byName.attemptedLocales], [...byFunction.attemptedLocales]);
    });
  }

  it("the three built-ins do not all behave alike, so the comparison above can fail", () => {
    // Without this control the suite would pass against a table that mapped all three names onto one
    // policy — and against a runner that never consulted a policy at all.
    const of = (/** @type {any} */ policy) => createStrings({ ...CATALOGS, fallbackPolicy: policy }).getResult("Key");

    assert.equal(of("any-failure").status, "translated");
    assert.equal(of("any-failure").resolvedLocale, "en");
    assert.equal(of("missing-or-no-match").status, "returned-key");
    assert.deepEqual([...of("missing-or-no-match").attemptedLocales], ["de"]);
    assert.equal(of("never").status, "returned-key");
  });

  it("refuses a name that is not one of the three", () => {
    assert.throws(
      () => createStrings({ ...CATALOGS, fallbackPolicy: /** @type {any} */ ("always") }),
      /must be a function or one of/,
    );
  });

  it("refuses an inherited Object property masquerading as a built-in name", () => {
    // The table has a null prototype precisely so `"toString"` cannot resolve to a function.
    assert.throws(
      () => createStrings({ ...CATALOGS, fallbackPolicy: /** @type {any} */ ("toString") }),
      /must be a function or one of/,
    );
  });
});

describe("the library defaults, which the conformance runner always replaces", () => {
  it("an omitted fallbackPolicy halts on a resolution failure and forfeits a reachable donor", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "de",
      strings: {
        de: {
          Key: {
            translation: "de: {{word}}",
            placeholders: { word: { value: "absentCount", translations: { CARDINALITY_ONE: "x", CARDINALITY_OTHER: "y" } } },
          },
        },
        en: { Key: "en: reachable but never reached" },
      },
    });
    const result = strings.getResult("Key");

    assert.equal(result.status, "returned-key");
    assert.equal(result.failureReason, "resolution-failure");
    assert.deepEqual([...result.attemptedLocales], ["de"]);
  });

  it("an omitted fallbackPolicy walks past a missing translation", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "de",
      strings: { de: { Other: "de: something else" }, en: { Key: "en: reached" } },
    });

    assert.equal(strings.get("Key"), "en: reached");
  });

  it("an omitted onFailure returns the INTERPOLATED key", () => {
    const strings = createStrings({ fallbackLocale: "en", locale: "en", strings: { en: { Other: "x" } } });
    const result = strings.getResult("Farewell {{name}}", { name: "Sarah" });

    assert.equal(result.status, "returned-key");
    assert.equal(result.translation, "Farewell Sarah");
  });

  it("an explicit null is the same state as an omitted option, on both", () => {
    const options = { fallbackLocale: "en", locale: "en", strings: { en: { Other: "x" } } };
    const omitted = createStrings(options).getResult("Key");
    const nulled = createStrings({
      ...options,
      fallbackPolicy: /** @type {any} */ (null),
      onFailure: /** @type {any} */ (null),
    }).getResult("Key");

    assert.equal(nulled.status, omitted.status);
    assert.equal(nulled.translation, omitted.translation);
  });
});

describe("the policy is never consulted for the final candidate", () => {
  it("a throwing policy is INERT on a one-element chain", () => {
    // The sharpest statement of the clause: if the guard moved below the consultation this throws.
    const strings = createStrings({
      ...SINGLE_CANDIDATE,
      fallbackPolicy: () => { throw new Error("the policy must never be consulted here"); },
    });

    assert.equal(strings.getResult("Absent").status, "returned-key");
  });

  it("the same instance DOES consult once the chain grows to two", () => {
    // The control. Without it the assertion above would also pass against a port that had no policy
    // support at all — the `zh-123` shape, where the check under test is never reached.
    const consulted = recordingPolicy(() => true);
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "de",
      strings: { en: { Present: "here" } },
      fallbackPolicy: consulted.policy,
    });

    assert.equal(strings.getResult("Absent").status, "returned-key");
    assert.deepEqual(consulted.calls.map((call) => call.locale), ["de"]);
  });

  it("four listed candidates produce exactly three consultations", () => {
    const consulted = recordingPolicy(() => true);
    const strings = createStrings({ ...FOUR_CANDIDATE, fallbackPolicy: consulted.policy });
    // Per call, because the INSTANCE locale is fr — a one-element chain, which is the control this
    // very suite depends on elsewhere. The four-candidate chain only exists for an en-GB request.
    const result = strings.getResult("MissingEverywhere", undefined, { locale: "en-GB" });

    assert.deepEqual([...result.attemptedLocales], ["en-GB", "en-001", "en", "fr"]);
    assert.deepEqual(consulted.calls.map((call) => call.locale), ["en-GB", "en-001", "en"]);
  });

  it("a policy that halts makes the counts EQUAL, which is the invariant's other half", () => {
    // `policyCalls.length === attemptedLocales.length` IFF the last decision was false. Both halves
    // are asserted, in the same file, because "always one fewer" is the wrong rule and passes here.
    const consulted = recordingPolicy((/** @type {any} */ _reason, /** @type {any} */ locale) => locale === "en-GB");
    const strings = createStrings({ ...FOUR_CANDIDATE, fallbackPolicy: consulted.policy });
    const result = strings.getResult("OnlyInFallback", undefined, { locale: "en-GB" });

    assert.deepEqual([...result.attemptedLocales], ["en-GB", "en-001"]);
    assert.equal(consulted.calls.length, result.attemptedLocales.length);
    assert.equal(consulted.calls.at(-1)?.locale, "en-001");
  });
});

describe("what the policy is handed", () => {
  it("the CURRENT candidate, its own reason, and a cause only for a resolution failure", () => {
    const consulted = recordingPolicy(() => true);
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "en-GB",
      tiebreakers: { en: ["en-GB", "en-001", "en"] },
      strings: {
        "en-GB": {
          Key: {
            translation: "en-GB: {{word}}",
            placeholders: { word: { value: "absentCount", translations: { CARDINALITY_ONE: "x", CARDINALITY_OTHER: "y" } } },
          },
        },
        "en-001": { Key: { alternatives: [{ "tier == 1": { translation: "en-001: tier one" } }] } },
        en: { Other: "en: not this key" },
        fr: { Other: "fr: not this key either" },
      },
      fallbackPolicy: consulted.policy,
    });

    strings.getResult("Key", { tier: 7 });

    assert.deepEqual(
      consulted.calls.map((call) => [call.locale, call.reason, call.cause === null]),
      [
        ["en-GB", "resolution-failure", false],
        ["en-001", "no-matching-alternative", true],
        ["en", "missing-translation", true],
      ],
    );
  });

  it("the CURRENT candidate's cause, not the retained first one", () => {
    const consulted = recordingPolicy(() => true);
    const failing = (/** @type {string} */ tag) => ({
      Key: {
        translation: `${tag}: {{word}}`,
        placeholders: { word: { value: "absentCount", translations: { CARDINALITY_ONE: "x", CARDINALITY_OTHER: "y" } } },
      },
    });
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "de",
      strings: { de: failing("de"), fr: failing("fr") },
      fallbackPolicy: consulted.policy,
    });
    const result = strings.getResult("Key");

    assert.equal(consulted.calls.length, 1);
    assert.equal(consulted.calls[0]?.cause, result.cause, "the first candidate's cause is the retained one");
    assert.ok(result.cause instanceof Error);
  });

  it("refuses a policy that returns something other than a boolean", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "de",
      strings: { en: { Present: "here" } },
      fallbackPolicy: /** @type {any} */ (() => null),
    });

    assert.throws(() => strings.getResult("Absent"), /must return a boolean/);
  });
});

describe("createStrings({ onFailure })", () => {
  const MISSING = { fallbackLocale: "en", locale: "en", strings: { en: { Other: "x" } } };

  it("fires exactly once, after the walk, however many candidates failed", () => {
    /** @type {any[]} */
    const seen = [];
    const strings = createStrings({
      ...FOUR_CANDIDATE,
      onFailure: (failure) => { seen.push(failure); return RETURN_KEY; },
    });
    const result = strings.getResult("NowhereAtAll", undefined, { locale: "en-GB" });

    assert.equal(seen.length, 1);
    assert.deepEqual([...seen[0].attemptedLocales], ["en-GB", "en-001", "en", "fr"]);
    assert.equal(result.status, "returned-key");
  });

  it("is not consulted at all when a candidate serves the key", () => {
    const strings = createStrings({
      ...FOUR_CANDIDATE,
      onFailure: () => { throw new Error("the handler must not run on a successful lookup"); },
    });

    assert.equal(strings.get("OnlyInFallback", undefined, { locale: "en-GB" }), "fr: only here");
  });

  it("returnString is returned VERBATIM — not interpolated, not isolated", () => {
    const strings = createStrings({ ...MISSING, onFailure: () => returnString("Fallback for {{name}}") });
    const result = strings.getResult("Farewell {{name}}", { name: "Sarah" });

    assert.equal(result.translation, "Fallback for {{name}}");
    assert.equal(result.status, "returned-string");
    assert.equal(result.resolvedLocale, null);
    assert.equal(result.failureReason, "missing-translation");
  });

  it("RETURN_KEY interpolates the key, which is how the two responses differ", () => {
    const strings = createStrings({ ...MISSING, onFailure: () => RETURN_KEY });

    assert.equal(strings.get("Farewell {{name}}", { name: "Sarah" }), "Farewell Sarah");
  });

  it("a structural object literal is honored, since responses are not singletons", () => {
    const strings = createStrings({ ...MISSING, onFailure: () => ({ action: "return-string", translation: "literal" }) });

    assert.equal(strings.get("Absent"), "literal");
  });

  it("THROW_EXCEPTION rethrows the retained first cause BY IDENTITY", () => {
    const boom = new Error("the resolver said no");
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Key: { translation: "{{form}}", placeholders: { form: { value: "noun", translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" } } } } } },
      phoneticResolver: () => { throw boom; },
      onFailure: () => THROW_EXCEPTION,
    });

    try {
      strings.getResult("Key", { noun: "apple" });
      assert.fail("expected a throw");
    } catch (error) {
      // Reference identity, which is strictly stronger than any name or message comparison and is
      // what plan 3.5's "no additional wrapper is added" clause actually needs.
      assert.equal(/** @type {any} */ (error).cause, boom);
    }
  });

  it("a throwing handler propagates rather than being turned into a result", () => {
    const strings = createStrings({ ...MISSING, onFailure: () => { throw new Error("handler refused"); } });

    assert.throws(() => strings.getResult("Absent"), /handler refused/);
  });

  it("refuses a handler that returns a response with no recognized action", () => {
    const strings = createStrings({ ...MISSING, onFailure: /** @type {any} */ (() => ({ action: "shrug" })) });

    assert.throws(() => strings.getResult("Absent"), /Unsupported failure response action/);
  });

  it("refuses a handler that returns nothing at all", () => {
    const strings = createStrings({ ...MISSING, onFailure: /** @type {any} */ (() => undefined) });

    assert.throws(() => strings.getResult("Absent"), /must return a failure response object/);
  });
});

describe("the TranslationFailure the handler is handed", () => {
  it("is frozen, null-prototype, and carries a null-prototype placeholders record", () => {
    /** @type {any} */
    let seen = null;
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Other: "x" } },
      onFailure: (failure) => { seen = failure; return RETURN_KEY; },
    });
    strings.getResult("Absent {{who}}", { who: "Ada", when: "now" });

    assert.ok(Object.isFrozen(seen));
    assert.equal(Object.getPrototypeOf(seen), null);
    assert.equal(Object.getPrototypeOf(seen.placeholders), null);
    assert.ok(Object.isFrozen(seen.placeholders));
    // No inherited magic keys: `constructor` is a real absence, not a Function.
    assert.equal(seen.placeholders.constructor, undefined);
    assert.deepEqual(Object.keys(seen.placeholders).sort(), ["when", "who"]);
    assert.equal(seen.placeholders.who, "Ada");
  });

  it("reads placeholders out of a Map as well as a record", () => {
    /** @type {any} */
    let seen = null;
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Other: "x" } },
      onFailure: (failure) => { seen = failure; return RETURN_KEY; },
    });
    strings.getResult("Absent", /** @type {any} */ (new Map([["who", "Ada"]])));

    assert.deepEqual(Object.keys(seen.placeholders), ["who"]);
  });

  it("carries the SAME match object the result carries", () => {
    /** @type {any} */
    let seen = null;
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Other: "x" } },
      onFailure: (failure) => { seen = failure; return RETURN_KEY; },
    });
    const result = strings.getResult("Absent");

    // Reference identity, which is what `matchObjectIdenticalToResult` records `true` on all 370
    // corpus rows able to compare the two.
    assert.equal(seen.localeMatch, result.localeMatch);
    assert.equal(seen.attemptedLocales, result.attemptedLocales);
  });

  it("carries Java's redacted message verbatim, with the Java-compatible reason token", () => {
    /** @type {any} */
    let seen = null;
    const strings = createStrings({
      ...FOUR_CANDIDATE,
      onFailure: (failure) => { seen = failure; return RETURN_KEY; },
    });
    strings.getResult("Nowhere", { secret: "must not appear" }, { locale: "en-GB" });

    assert.equal(
      seen.message,
      "Unable to resolve translation key 'Nowhere' for locale 'en-GB'. Reason: MISSING_TRANSLATION. " +
        "Attempted locales: [en-GB, en-001, en, fr]",
    );
    assert.equal(seen.reason, "missing-translation", "the FIELD keeps the JS vocabulary");
    assert.ok(!seen.message.includes("must not appear"), "placeholder VALUES are redacted");
  });
});

describe("per-call fallbackPolicy and onFailure REPLACE the instance ones", () => {
  const CATALOGS = {
    fallbackLocale: "en",
    locale: "de",
    strings: {
      de: {
        Key: {
          translation: "de: {{word}}",
          placeholders: { word: { value: "absentCount", translations: { CARDINALITY_ONE: "x", CARDINALITY_OTHER: "y" } } },
        },
      },
      en: { Key: "en: served by the fallback" },
    },
  };

  it("a per-call any-failure widens an instance missing-or-no-match", () => {
    const strings = createStrings({ ...CATALOGS, fallbackPolicy: "missing-or-no-match" });

    assert.equal(strings.getResult("Key").status, "returned-key");
    assert.equal(strings.get("Key", undefined, { fallbackPolicy: "any-failure" }), "en: served by the fallback");
  });

  it("a per-call never narrows an instance any-failure", () => {
    const strings = createStrings({ ...CATALOGS, fallbackPolicy: "any-failure" });

    assert.equal(strings.get("Key"), "en: served by the fallback");
    assert.equal(strings.getResult("Key", undefined, { fallbackPolicy: "never" }).status, "returned-key");
  });

  it("a per-call handler displaces the instance handler wholesale", () => {
    const strings = createStrings({
      ...CATALOGS,
      fallbackPolicy: "never",
      onFailure: () => returnString("INSTANCE"),
    });

    assert.equal(strings.get("Key"), "INSTANCE");
    assert.equal(strings.get("Key", undefined, { onFailure: () => returnString("PER-CALL") }), "PER-CALL");
  });

  it("an explicit per-call null keeps the instance callbacks", () => {
    const strings = createStrings({
      ...CATALOGS,
      fallbackPolicy: "never",
      onFailure: () => returnString("INSTANCE"),
    });

    assert.equal(
      strings.get("Key", undefined, { fallbackPolicy: null, onFailure: null }),
      "INSTANCE",
    );
  });

  it("refuses a per-call policy of the wrong shape at the call site", () => {
    const strings = createStrings(CATALOGS);

    assert.throws(
      () => strings.getResult("Key", undefined, { fallbackPolicy: /** @type {any} */ ("sometimes") }),
      /get\(\{ fallbackPolicy \}\)/,
    );
    assert.throws(
      () => strings.getResult("Key", undefined, { onFailure: /** @type {any} */ ("nope") }),
      /get\(\{ onFailure \}\)/,
    );
  });
});
