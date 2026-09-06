// @ts-check

/**
 * `onFallback` — plan sections 3.2 (`:542`), 3.3 (`:651`), 3.5 (`:998-1010`, `:1024`, `:1032`).
 *
 * THIS FILE IS THE ONLY ENFORCEMENT THIS FEATURE HAS. `onFallback` has no Java counterpart at all:
 * `DefaultStrings` discards a candidate's failure the moment a later candidate answers, so there is
 * nothing in `lokalized-java` for `VectorOracle` to record and not one row of the 2,303-case corpus
 * can check any of it. `npm run conformance` is green on a port that never calls the observer —
 * that was the state before this landed — so "conformance stayed at 1,917 passed / 0 FAILED" is a
 * statement that this feature did no HARM and says nothing whatever about whether it does GOOD.
 * The assertions below are the specification.
 *
 * Because of that the file is written to a stricter standard than a corpus-backed one:
 *
 *   - Every positive assertion has a CONTROL that must NOT move. "Fires on a fallback" is worthless
 *     without "does not fire when the first candidate serves" beside it, and a port that called the
 *     observer unconditionally would satisfy the first.
 *   - The observer-fired assertion is made through a channel the OBSERVER writes, never through the
 *     absence of records. The last suite demonstrates why, by exhibiting the assertion that has no
 *     teeth next to the one that does.
 *   - Reference equality, never deep equality, wherever plan 3.3's identity clause (`:869`) is what
 *     is under test. A structural copy of `localeMatch` satisfies every field and violates the
 *     clause, so `assert.deepEqual` would pass on exactly the implementation the clause forbids.
 *
 * ABLATIONS RUN AGAINST THIS FILE — every row MEASURED by mutating `src/core/index.js`, running
 * `node --test test/fallback-observer.test.js`, and restoring the file (the restored copy was
 * `diff`ed byte-for-byte against the original):
 *
 *   | ablation in `src/core/index.js`                               | pass / fail (of 31) |
 *   |---|---:|
 *   | delete the `notifyFallbackObserver(...)` call in the walk     | 13 / 18 |
 *   | notify from INSIDE the candidate's `try` (the real defect)    | see below |
 *   | fire on every successful lookup, not only after a fallback    | 26 /  5 |
 *   | drop the thenable check from `notifyFallbackObserver`         | 29 /  2 |
 *   | fire on `isFallback` instead of `precedingFailures.length`    | 30 /  1 |
 *   | give every record `firstFailureCause` instead of its own      | 30 /  1 |
 *   | hand the event a structural COPY of `localeMatch`             | 30 /  1 |
 *   | hard-code the `where` string to the construction spelling     | 30 /  1 |
 *   | collapse `no-matching-alternative` into `missing-translation` | 30 /  1 |
 *
 * `npm run conformance` was ALSO measured under the FIRST of those — the observer entirely
 * unwired — and reports 1,917 passed / 0 FAILED / 221 unsupported / 165 no counterpart, exit 0:
 * exactly the numbers it reports with the feature present. That is the corpus blindness stated as a
 * measurement rather than as a claim, and it is why this file is written the way it is. (The last
 * row is the one exception — `no-matching-alternative` is corpus-visible through the fallback
 * policy, so the corpus catches that one too. It is listed because the EVENT's copy of the reason
 * is a separate channel and could have been flattened on its own.)
 *
 * THE SECOND ROW CARRIES NO COUNT ON PURPOSE, and an earlier draft of this header did — `21 / 10`.
 * That number is RECONSTRUCTION-SENSITIVE and therefore not reproducible from the row's own prose,
 * which is the one thing an ablation table must be. "Notify from inside the try" is a family of
 * mutations, not a mutation: three faithful reconstructions measured across two sessions give
 * `28 / 3`, `27 / 4` and `27 / 4`, and `21 / 10` additionally requires `freeze(precedingFailures)`
 * to become `freeze([...precedingFailures])` — freezing a COPY is what stops the walk crashing on
 * the next candidate's `push` and lets seven further failures surface. A reader who reconstructs
 * the row as written and reads 27/4 has not found a regression.
 *
 * What IS stable across every reconstruction tried, and is what the row actually claims, is WHICH
 * tests catch it:
 *
 *   - `an exception propagates immediately and the caller gets no translation`
 *   - `a thenable return is rejected as asynchronous`
 *   - `the thenable refusal names the option the caller actually wrote`
 *
 * The row is not hypothetical. Wiring the notification inside the candidate's `try` is the obvious
 * placement — the success path lived there — and it made a throwing observer get caught by that
 * `catch`, relabelled as the answering candidate's own `resolution-failure`, and the walk continue
 * past a translation it had already produced. "An exception propagates immediately" is one clause;
 * it took an adversarial test to notice that the natural implementation violated it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MissingTranslationError,
  THROW_EXCEPTION,
  createStrings,
  forLocaleMatch,
} from "../src/core/index.js";

/**
 * The four-candidate chain: `en-GB` -> `en-001` -> `en` -> `fr`. Requesting `en-GB` walks all four
 * because `candidateChain` appends the configured fallback, and the three keys select where in that
 * chain the walk stops.
 *
 *   `InEvery`         the FIRST candidate answers        — no fallback, no event
 *   `OnlyInEn`        the THIRD candidate answers        — two preceding failures
 *   `OnlyInFallback`  the FOURTH candidate answers       — three preceding failures
 *   `Nowhere`         nothing answers                    — no event, by `:1024`
 */
const FOUR_CANDIDATE = {
  fallbackLocale: "fr",
  locale: "en-GB",
  tiebreakers: { en: ["en-GB", "en-001", "en"] },
  strings: {
    "en-GB": { InEvery: "en-GB: everywhere" },
    "en-001": { InEvery: "en-001: everywhere" },
    en: { InEvery: "en: everywhere", OnlyInEn: "en: only here" },
    fr: { InEvery: "fr: everywhere", OnlyInFallback: "fr: only here" },
  },
};

/**
 * A definition that HOLDS the key and cannot render it: `absentCount` is never supplied, so the
 * generated placeholder raises inside the candidate and the walk records a `resolution-failure`
 * with a real cause object. The same shape `test/fallback-policy.test.js` uses.
 *
 * @param {string} tag
 */
const unrenderable = (tag) => ({
  translation: `${tag}: {{word}}`,
  placeholders: {
    word: {
      value: "absentCount",
      translations: { CARDINALITY_ONE: "x", CARDINALITY_OTHER: "y" },
    },
  },
});

/** Records every event it is handed, and nothing else. */
function recordingObserver() {
  /** @type {any[]} */
  const events = [];
  return { events, observer: (/** @type {any} */ event) => void events.push(event) };
}

/** @param {Record<string, unknown>} overrides */
const stringsWith = (overrides) =>
  createStrings(/** @type {any} */ ({ ...FOUR_CANDIDATE, ...overrides }));

describe("onFallback — when it fires and when it must not", () => {
  it("fires EXACTLY ONCE when a later candidate answers", () => {
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("OnlyInEn");

    assert.equal(result.translation, "en: only here");
    assert.equal(result.resolvedLocale, "en");
    assert.deepEqual([...result.attemptedLocales], ["en-GB", "en-001", "en"]);

    // ONCE, not once per skipped candidate. Two candidates failed on the way to `en`; a port that
    // notified per failure would report 2 here and would still pass every field assertion below.
    assert.equal(events.length, 1);
  });

  it("fires exactly once on the longest walk too — three failures, one event", () => {
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("OnlyInFallback");

    assert.equal(result.resolvedLocale, "fr");
    assert.deepEqual([...result.attemptedLocales], ["en-GB", "en-001", "en", "fr"]);
    assert.equal(events.length, 1);
    assert.equal(events[0].precedingFailures.length, 3);
  });

  it("CONTROL: does NOT fire when the first candidate answers", () => {
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("InEvery");

    assert.equal(result.translation, "en-GB: everywhere");
    assert.deepEqual([...result.attemptedLocales], ["en-GB"]);
    assert.equal(events.length, 0);
  });

  it("CONTROL: does NOT fire when the walk fails entirely", () => {
    // Plan `:1024` — the observer is called "after a later candidate succeeds". Nothing succeeded,
    // so nothing is observed, even though this walk attempted all four candidates and failed at
    // three of them. `resolvedLocale: null` is the discriminator.
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("Nowhere");

    assert.equal(result.status, "returned-key");
    assert.equal(result.resolvedLocale, null);
    assert.deepEqual([...result.attemptedLocales], ["en-GB", "en-001", "en", "fr"]);
    assert.equal(events.length, 0);
  });

  it("does NOT fire off `isFallback`: a negotiation fallback answering at the first candidate", () => {
    // THE INTENTIONAL DISAGREEMENT, and the reason the walk tests `precedingFailures.length` rather
    // than the far more obvious `result.isFallback`. A supplied `cldr-fallback` match selects `en`,
    // so the lookup locale IS `en`, the chain is one element long, and the very first candidate
    // answers. `isFallback` is true because NEGOTIATION fell back; no per-key fallback happened, so
    // no event. A port that fired the observer off `isFallback` passes every other test in this
    // file and fails this one.
    const { events, observer } = recordingObserver();
    const strings = createStrings({
      fallbackLocale: "fr",
      locale: "fr",
      strings: { en: { K: "en: value" }, fr: { K: "fr: value" } },
      onFallback: observer,
    });

    const result = strings.getResult(
      "K",
      undefined,
      forLocaleMatch({
        matchType: "cldr-fallback",
        locale: "en",
        isMatch: true,
        fallbackLocale: "fr",
        consideredLocales: ["en", "fr"],
        effectiveWeight: 1,
        languageRange: { range: "en-us", weight: 1 },
        requestedLanguageRanges: [{ range: "en-us", weight: 1 }],
      }),
    );

    assert.equal(result.translation, "en: value");
    assert.equal(result.isFallback, true);
    assert.deepEqual([...result.attemptedLocales], ["en"]);
    assert.equal(events.length, 0);
  });
});

describe("onFallback — the event's contents", () => {
  it("carries the whole `FallbackEvent` shape from plan `:998-1010`", () => {
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("OnlyInEn");
    const [event] = events;

    assert.deepEqual(Object.keys(event).sort(), [
      "attemptedLocales",
      "key",
      "localeMatch",
      "lookupLocale",
      "precedingFailures",
      "resolvedLocale",
    ]);
    assert.equal(event.key, "OnlyInEn");
    assert.equal(event.lookupLocale, "en-GB");
    assert.equal(event.resolvedLocale, "en");
    assert.equal(event.resolvedLocale, result.resolvedLocale);
    assert.deepEqual([...event.attemptedLocales], ["en-GB", "en-001", "en"]);
  });

  it("`precedingFailures` is the attempted list MINUS the candidate that answered, in walk order", () => {
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("OnlyInFallback");
    const [event] = events;

    // Never includes the successful candidate — the arithmetic is exact, not a floor. A port that
    // pushed its record before checking for a translation would report 4 here.
    assert.equal(event.precedingFailures.length, result.attemptedLocales.length - 1);
    assert.deepEqual(
      event.precedingFailures.map((/** @type {any} */ f) => f.locale),
      result.attemptedLocales.slice(0, -1),
    );
    assert.deepEqual(
      event.precedingFailures.map((/** @type {any} */ f) => f.reason),
      ["missing-translation", "missing-translation", "missing-translation"],
    );
    for (const failure of event.precedingFailures) assert.equal(failure.cause, null);
  });

  it("records each candidate's OWN cause, not the walk's retained first one", () => {
    // THE DISCRIMINATING CASE for reusing B1's channel. The walk keeps `firstFailureCause` for the
    // final failure, and a record built from that field would be plausible, deep-equal-looking, and
    // wrong: both entries would be the SAME object. Two candidates that each throw their own error
    // is what separates the two implementations.
    const { events, observer } = recordingObserver();
    const result = stringsWith({
      fallbackPolicy: "any-failure", // the default policy halts on a resolution failure
      strings: {
        "en-GB": { K: unrenderable("en-GB") },
        "en-001": { K: unrenderable("en-001") },
        en: { K: "en: served" },
        fr: { K: "fr: never reached" },
      },
      onFallback: observer,
    }).getResult("K");

    assert.equal(result.translation, "en: served");
    // A SUCCESSFUL result carries no cause at all, which is why the causes cannot be read off the
    // result and have to travel on the event.
    assert.equal(result.cause, null);

    const [first, second] = events[0].precedingFailures;
    assert.deepEqual([first.locale, second.locale], ["en-GB", "en-001"]);
    assert.deepEqual([first.reason, second.reason], ["resolution-failure", "resolution-failure"]);
    assert.ok(first.cause instanceof Error);
    assert.ok(second.cause instanceof Error);
    assert.notEqual(first.cause, second.cause);
  });

  it("distinguishes `no-matching-alternative` from `missing-translation`", () => {
    // The three `FailureReason` members are the same vocabulary the fallback policy is handed, and
    // the event must not flatten them: "the key was absent here" and "the key was here and nothing
    // matched" are different facts about the same fallback, and only the second is a catalog bug.
    const { events, observer } = recordingObserver();
    const result = stringsWith({
      strings: {
        "en-GB": { K: { alternatives: [{ "tier == 1": { translation: "en-GB: tier one" } }] } },
        "en-001": { K: "en-001: served" },
        en: { K: "en: not reached" },
        fr: { K: "fr: not reached" },
      },
      onFallback: observer,
    }).getResult("K", { tier: 2 });

    assert.equal(result.translation, "en-001: served");
    assert.deepEqual(
      events[0].precedingFailures.map((/** @type {any} */ f) => [f.locale, f.reason]),
      [["en-GB", "no-matching-alternative"]],
    );
  });

  it("the event and its records are frozen", () => {
    const { events, observer } = recordingObserver();
    stringsWith({ onFallback: observer }).getResult("OnlyInEn");
    const [event] = events;

    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.attemptedLocales));
    assert.ok(Object.isFrozen(event.precedingFailures));
    for (const failure of event.precedingFailures) assert.ok(Object.isFrozen(failure));
  });
});

describe("onFallback — plan 3.3's identity clause (`:869`)", () => {
  it("the event's `localeMatch` is the SAME OBJECT as the result's", () => {
    const { events, observer } = recordingObserver();
    const result = stringsWith({ onFallback: observer }).getResult("OnlyInEn");

    // `assert.equal` on objects is reference equality in `node:assert/strict`. That is the whole
    // point: `deepEqual` would pass on a structural copy, which satisfies every field of the
    // clause and violates it.
    assert.equal(events[0].localeMatch, result.localeMatch);
    assert.equal(events[0].attemptedLocales, result.attemptedLocales);
  });

  it("CONTROL: the assertion above is not vacuous — two lookups get two match objects", () => {
    // Without this, a port that cached ONE `localeMatch` per instance — or per module — would make
    // the reference assertion above pass no matter where the event's copy came from. Measured: a
    // constant instance locale is recomputed per lookup, so the two objects differ by reference and
    // agree by value.
    const strings = stringsWith({});
    const first = strings.getResult("InEvery").localeMatch;
    const second = strings.getResult("InEvery").localeMatch;

    assert.notEqual(first, second);
    assert.deepEqual(first, second);
  });

  it("the failure half of the same clause: the handler's failure reaches MissingTranslationError", () => {
    // An event and a `MissingTranslationError` cannot occur in ONE call — the observer fires only
    // after a candidate succeeded, and the error is thrown only when none did — so the clause's two
    // halves are necessarily measured on two calls. This is the half the event cannot reach.
    /** @type {any} */
    let captured = null;
    const strings = stringsWith({
      onFailure: (/** @type {any} */ failure) => {
        captured = failure;
        return THROW_EXCEPTION;
      },
    });

    assert.throws(
      () => strings.getResult("Nowhere"),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof MissingTranslationError);
        assert.equal(error.failure, captured);
        assert.equal(error.failure.localeMatch, captured.localeMatch);
        assert.equal(error.failure.attemptedLocales, captured.attemptedLocales);
        return true;
      },
    );
  });
});

describe("onFallback — the observer contract (plan `:1032`)", () => {
  it("an exception propagates immediately and the caller gets no translation", () => {
    const boom = new Error("observer said no");
    const strings = stringsWith({
      onFallback: () => {
        throw boom;
      },
    });

    // By IDENTITY: not wrapped, not converted into a resolution failure of the candidate that had
    // already answered, not swallowed into a `returned-key`.
    assert.throws(() => strings.getResult("OnlyInEn"), (error) => error === boom);
  });

  it("CONTROL: the identical lookup with a non-throwing observer returns the translation", () => {
    assert.equal(stringsWith({ onFallback: () => {} }).getResult("OnlyInEn").translation,
        "en: only here");
  });

  it("CONTROL: a throwing observer is inert on a lookup that does not fall back", () => {
    // Proves the throw above came from the OBSERVER being invoked rather than from the option being
    // present. Same instance shape, same throwing observer, a key the first candidate answers.
    const strings = stringsWith({
      onFallback: () => {
        throw new Error("must not be reached");
      },
    });
    assert.equal(strings.getResult("InEvery").translation, "en-GB: everywhere");
    assert.equal(strings.getResult("Nowhere").status, "returned-key");
  });

  it("a thenable return is rejected as asynchronous", () => {
    for (const [label, observer] of /** @type {[string, any][]} */ ([
      ["an async function", async () => {}],
      ["a hand-rolled thenable", () => ({ then: () => {} })],
      ["a callable thenable", () => Object.assign(() => {}, { then: () => {} })],
      ["a resolved promise", () => Promise.resolve(1)],
    ])) {
      assert.throws(
        () => stringsWith({ onFallback: observer }).getResult("OnlyInEn"),
        (/** @type {any} */ error) => {
          assert.ok(error instanceof TypeError, `${label} should raise a TypeError`);
          assert.match(error.message, /must be synchronous/);
          return true;
        },
        label,
      );
    }
  });

  it("CONTROL: an ordinary return value is ignored, thenable-shaped neighbours included", () => {
    // The rejection above must key on a CALLABLE `then` and nothing else. An object carrying a
    // `then` STRING is not a thenable and must not be refused; neither is `null`, which is
    // `typeof "object"`.
    for (const returned of [undefined, null, 0, false, "", "ignored", { then: "not callable" },
        { thenable: true }, [1, 2, 3], Symbol("s")]) {
      const { events, observer } = recordingObserver();
      const result = stringsWith({
        onFallback: (/** @type {any} */ event) => {
          observer(event);
          return returned;
        },
      }).getResult("OnlyInEn");

      assert.equal(result.translation, "en: only here", `return ${String(returned)}`);
      assert.equal(events.length, 1, `return ${String(returned)}`);
    }
  });

  it("the thenable refusal names the option the caller actually wrote", () => {
    // Without this the `where` string threaded to `notifyFallbackObserver` is decoration: every
    // other assertion in this file passes with it hard-coded to the construction-time spelling.
    const strings = stringsWith({});
    assert.throws(
      () => strings.getResult("OnlyInEn", undefined,
          /** @type {any} */ ({ onFallback: async () => {} })),
      (/** @type {any} */ error) => {
        assert.match(error.message, /^get\(\{ onFallback \}\) must be synchronous/);
        return true;
      },
    );
    // CONTROL: the instance spelling, from the same code path, must differ.
    assert.throws(
      () => stringsWith({ onFallback: async () => {} }).getResult("OnlyInEn"),
      (/** @type {any} */ error) => {
        assert.match(error.message, /^createStrings\(\{ onFallback \}\) must be synchronous/);
        return true;
      },
    );
  });

  it("an observer may itself translate — the walk's per-call state is not shared", () => {
    // A logging observer that localizes its own message is an ordinary shape, and it re-enters
    // `getResult` from inside the walk. `precedingFailures` is per-CALL and is frozen just before
    // the observer runs, so a re-entrant lookup that falls back must build its own list rather than
    // pushing onto the frozen one. (An implementation that hoisted the list to the instance crashes
    // here with "object is not extensible" — which is how the placement defect in the header table
    // announced itself.)
    /** @type {any[]} */
    const outer = [];
    /** @type {any[]} */
    const inner = [];
    /** @type {any} */
    let strings = null;
    strings = stringsWith({
      onFallback: (/** @type {any} */ event) => {
        outer.push(event);
        if (event.key !== "OnlyInFallback")
          inner.push(strings.getResult("OnlyInFallback").translation);
      },
    });

    assert.equal(strings.getResult("OnlyInEn").translation, "en: only here");
    assert.deepEqual(inner, ["fr: only here"]);
    assert.deepEqual(outer.map((/** @type {any} */ e) => e.key), ["OnlyInEn", "OnlyInFallback"]);
    assert.deepEqual(outer[0].precedingFailures.map((/** @type {any} */ f) => f.locale),
        ["en-GB", "en-001"]);
    assert.deepEqual(outer[1].precedingFailures.map((/** @type {any} */ f) => f.locale),
        ["en-GB", "en-001", "en"]);
  });

  it("CONTROL: a truncating policy that stops before the answer fires nothing", () => {
    // The event tracks the walk that HAPPENED, not the chain that existed. `"never"` halts after
    // `en-GB`, so the candidate holding `OnlyInEn` is never reached and there is no success to
    // observe — even though the chain had three more candidates and one of them would have answered.
    const { events, observer } = recordingObserver();
    const result = stringsWith({ fallbackPolicy: "never", onFallback: observer }).getResult("OnlyInEn");

    assert.equal(result.status, "returned-key");
    assert.deepEqual([...result.attemptedLocales], ["en-GB"]);
    assert.equal(events.length, 0);
  });

  it("CONTROL: a thenable returned by an observer that never fires is never seen", () => {
    // The check lives at the CALL SITE, not at configuration: an async observer on an instance that
    // never falls back is legal, because it is never called. That is deliberate — refusing it at
    // construction would be a stricter rule than plan `:1032` states.
    const strings = stringsWith({ onFallback: async () => {} });
    assert.equal(strings.getResult("InEvery").translation, "en-GB: everywhere");
  });

  it("the observer cannot change the translation", () => {
    const strings = stringsWith({
      onFallback: (/** @type {any} */ event) => {
        // Frozen, so these are no-ops rather than errors in sloppy mode — asserted here through
        // the RESULT, which is the thing a caller would actually be harmed by.
        try {
          event.resolvedLocale = "fr";
          /** @type {any} */ (event.precedingFailures).length = 0;
        } catch {
          /* strict-mode TypeError is equally acceptable */
        }
        return { action: "return-string", translation: "hijacked" };
      },
    });

    const result = strings.getResult("OnlyInEn");
    assert.equal(result.translation, "en: only here");
    assert.equal(result.resolvedLocale, "en");
    assert.equal(result.status, "translated");
  });
});

describe("onFallback — configuration", () => {
  it("a non-function is refused at CONSTRUCTION, before any lookup", () => {
    for (const bad of [42, "observer", {}, [], true, Symbol("s")]) {
      assert.throws(
        () => stringsWith({ onFallback: bad }),
        (/** @type {any} */ error) => {
          assert.ok(error instanceof TypeError);
          assert.match(error.message, /createStrings\(\{ onFallback \}\) must be a function/);
          return true;
        },
        `onFallback: ${String(bad)}`,
      );
    }
  });

  it("CONTROL: a function constructs, and so does an omitted option", () => {
    assert.equal(stringsWith({ onFallback: () => {} }).getResult("InEvery").status, "translated");
    assert.equal(stringsWith({}).getResult("OnlyInEn").translation, "en: only here");
  });

  it("a per-call non-function is refused at the call site", () => {
    const strings = stringsWith({});
    assert.throws(
      () => strings.getResult("OnlyInEn", undefined, /** @type {any} */ ({ onFallback: 42 })),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof TypeError);
        assert.match(error.message, /get\(\{ onFallback \}\) must be a function/);
        return true;
      },
    );
    // Refused even for a lookup that would never have fired it — a shape mistake is a configuration
    // mistake, exactly as it is for `onFailure`.
    assert.throws(
      () => strings.getResult("InEvery", undefined, /** @type {any} */ ({ onFallback: 42 })),
      TypeError,
    );
  });

  it("a per-call observer REPLACES the instance one", () => {
    const instance = recordingObserver();
    const perCall = recordingObserver();
    const strings = stringsWith({ onFallback: instance.observer });

    strings.getResult("OnlyInEn", undefined, /** @type {any} */ ({ onFallback: perCall.observer }));

    assert.equal(perCall.events.length, 1);
    assert.equal(instance.events.length, 0, "the instance observer must not also run");
  });

  it("an explicit per-call null selects the instance observer, matching `onFailure`'s `== null`", () => {
    const instance = recordingObserver();
    const strings = stringsWith({ onFallback: instance.observer });

    strings.getResult("OnlyInEn", undefined, /** @type {any} */ ({ onFallback: null }));
    strings.getResult("OnlyInEn", undefined, /** @type {any} */ ({ onFallback: undefined }));

    assert.equal(instance.events.length, 2);
  });

  it("a per-call observer works with no instance observer configured", () => {
    const perCall = recordingObserver();
    stringsWith({}).getResult("OnlyInEn", undefined,
        /** @type {any} */ ({ onFallback: perCall.observer }));
    assert.equal(perCall.events.length, 1);
  });

  it("`get` and `t` reach the same observer as `getResult`", () => {
    // DOCUMENTS RATHER THAN DISCRIMINATES, said plainly so a later reader does not bank it as
    // coverage: `src/core/index.js` returns `freeze({ get, t: get, … })`, so `t` IS `get` — the
    // same function object, not a second entry point. This row cannot fail independently of `get`,
    // and no mutation can make it. It is kept because the ALIASING is itself a contract worth
    // pinning: a future `t` that wrapped `get` would have to keep the observer wired, and this row
    // is where that would be noticed.
    const { events, observer } = recordingObserver();
    const strings = stringsWith({ onFallback: observer });

    assert.equal(strings.get("OnlyInEn"), "en: only here");
    assert.equal(strings.t("OnlyInEn"), "en: only here");
    assert.equal(events.length, 2);
  });
});

describe("onFallback — the wiring test's own teeth", () => {
  it("an observer that records nothing is indistinguishable from one never invoked", () => {
    // THE NEGATIVE TEST OF THE WIRING ITSELF. Stub the observer so it records nothing, then make
    // the assertion every positive test in this file makes. It goes RED — which is the point: the
    // empty list proves nothing about whether the observer ran, so no test here may rest on it.
    /** @type {any[]} */
    const events = [];
    const silent = stringsWith({ onFallback: () => {} });

    assert.equal(silent.getResult("OnlyInEn").translation, "en: only here");
    assert.throws(
      () => assert.equal(events.length, 1),
      { name: "AssertionError" },
      "if this stops throwing, the assertion shape used throughout this file has lost its teeth",
    );

    // The distinguishing channel is one the OBSERVER writes. Same instance shape, same lookup.
    let calls = 0;
    stringsWith({ onFallback: () => { calls += 1; } }).getResult("OnlyInEn");
    assert.equal(calls, 1);

    // ...and the same counter on a lookup that must not fall back stays at zero, so the counter is
    // measuring the invocation and not merely the option's presence.
    let controlCalls = 0;
    stringsWith({ onFallback: () => { controlCalls += 1; } }).getResult("InEvery");
    assert.equal(controlCalls, 0);
  });
});
