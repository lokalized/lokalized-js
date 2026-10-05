// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createStrings, RETURN_KEY } from "../src/core/index.js";
import { createLocaleMatcher } from "../src/negotiate/index.js";

const bytes = readFileSync(new URL("./fixtures/fallback-observer-v1.json", import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"), "4c844d73e8d333dde8432cb9e76fcdeb22b4937b50a632205fe74855b6e57d18");
const profile = JSON.parse(bytes.toString("utf8"));
assert.equal(profile.profileID, "fallback-observer-v1");
assert.equal(profile.profileVersion, "1.0.0");
assert.equal(profile.cases.length, 12);

/** @param {any} event */
function project(event) {
  return {
    key: event.key,
    lookupLocale: event.lookupLocale,
    resolvedLocale: event.resolvedLocale,
    attemptedLocales: [...event.attemptedLocales],
    precedingFailures: event.precedingFailures.map((/** @type {any} */ failure) => `${failure.locale}:${failure.reason}`),
  };
}

describe("shared fallback-observer profile", () => {
  for (const row of profile.cases) {
    it(row.id, () => {
      /** @type {any[]} */
      const instanceEvents = [];
      /** @type {any[]} */
      const perCallEvents = [];
      /** @type {any[]} */
      const nestedResults = [];
      /** @type {string[]} */
      const policyCalls = [];
      /** @type {unknown[]} */
      const policyCauses = [];
      let handlerCalls = 0;
      const marker = new Error("observer marker");
      const firstCause = new Error("first cause");
      const secondCause = new Error("second cause");
      const catalogs = row.catalogVariant
        ? profile.fixture.catalogVariants[row.catalogVariant] : profile.fixture.catalogs;
      const negotiated = row.requestMode === "negotiated";
      const matcher = negotiated ? createLocaleMatcher({
        fallbackLocale: profile.fixture.fallbackLocale,
        supportedLocales: Object.keys(catalogs),
        tiebreakerLocalesByLanguageCode: profile.fixture.tiebreakerLocalesByLanguageCode,
      }) : null;
      const placeholders = row.placeholderMode === "tier-two" ? { tier: 2 }
        : row.placeholderMode === "throwing-two" ? {
          x: { toString() { throw firstCause; } },
          y: { toString() { throw secondCause; } },
        } : undefined;
      const capture = (/** @type {any} */ event) => {
        instanceEvents.push(event);
        if (row.observer === "throw") throw marker;
        if (row.nestedKey && event.key === row.key) nestedResults.push(strings.getResult(row.nestedKey));
      };
      const strings = createStrings({
        fallbackLocale: profile.fixture.fallbackLocale,
        localeSupplier: negotiated ? null : () => profile.fixture.requestLocale,
        localeMatchSupplier: negotiated ? () => matcher.matchFor(profile.fixture.negotiationRequestLocale) : null,
        localizedStringSupplier: () => catalogs,
        tiebreakerLocalesByLanguageCode: profile.fixture.tiebreakerLocalesByLanguageCode,
        translationFallbackObserver: capture,
        translationFallbackPolicy: (/** @type {string} */ reason, /** @type {string} */ locale, /** @type {unknown} */ cause) => {
          policyCalls.push(`${locale}:${reason}`);
          policyCauses.push(cause);
          return row.policy === "advance";
        },
        translationFailureHandler: () => { handlerCalls++; return RETURN_KEY; },
      });
      const options = row.observer === "replace"
        ? { translationFallbackObserver: (/** @type {any} */ event) => void perCallEvents.push(event) }
        : row.observer === "inherit" ? { translationFallbackObserver: null }
        : undefined;
      /** @type {any} */
      let result;
      let thrown;
      try { result = strings.getResult(row.key, placeholders, options); }
      catch (error) { thrown = error; }

      const expected = row.expected;
      if (expected.outcome === "observer-threw") assert.strictEqual(thrown, marker);
      else {
        assert.equal(thrown, undefined);
        assert.equal(result.status, expected.outcome);
        assert.equal(result.translation, expected.translation);
        assert.deepEqual([...result.attemptedLocales], expected.attemptedLocales);
        if (Object.hasOwn(expected, "isFallback")) assert.equal(result.isFallback, expected.isFallback);
        const event = instanceEvents[0] ?? perCallEvents[0];
        if (event) {
          assert.notEqual(result.localeMatchResult, null);
          assert.strictEqual(event.localeMatchResult, result.localeMatchResult);
        }
      }
      assert.deepEqual(policyCalls, expected.policyCalls);
      assert.equal(handlerCalls, expected.handlerCalls);
      assert.deepEqual(instanceEvents.map(project), expected.instanceEvents);
      assert.deepEqual(perCallEvents.map(project), expected.perCallEvents);
      if (expected.nestedResult) {
        assert.equal(nestedResults.length, 1);
        assert.equal(nestedResults[0].key, expected.nestedResult.key);
        assert.equal(nestedResults[0].translation, expected.nestedResult.translation);
        assert.deepEqual([...nestedResults[0].attemptedLocales], expected.nestedResult.attemptedLocales);
        assert.strictEqual(instanceEvents[1].localeMatchResult, nestedResults[0].localeMatchResult);
      } else assert.equal(nestedResults.length, 0);
      for (const event of [...instanceEvents, ...perCallEvents]) {
        if (expected.causeIdentity === "distinct-policy-matched") {
          assert.strictEqual(event.precedingFailures[0].cause, firstCause);
          assert.strictEqual(event.precedingFailures[1].cause, secondCause);
          assert.notStrictEqual(event.precedingFailures[0].cause, event.precedingFailures[1].cause);
          assert.strictEqual(policyCauses[0], firstCause);
          assert.strictEqual(policyCauses[1], secondCause);
        } else for (const failure of event.precedingFailures) assert.equal(failure.cause, null);
      }
    });
  }
});
