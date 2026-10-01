import assert from "node:assert/strict";
import { test } from "node:test";
import { createStrings, ConfigurationError, forLocaleMatch } from "../src/core/index.js";
import * as negotiation from "../src/negotiate/index.js";
import * as loading from "../src/load/index.js";

const configuration = () => ({
  localizedStringSupplier: () => ({
    "en-US": { Greeting: "Hello", OnlyAmerican: "American" },
    "en-GB": { Greeting: "Hallo" },
  }),
  fallbackLocale: "en-US",
  localeSupplier: () => "en-CA",
  tiebreakerLocalesByLanguageCode: { en: ["en-GB", "en-US"] },
});

test("shared configuration names flow from construction through matching and fallback", () => {
  const fallbacks = [];
  const strings = createStrings({
    ...configuration(),
    translationFallbackObserver: event => fallbacks.push(event),
  });
  assert.equal(strings.get("Greeting"), "Hallo");
  assert.equal(strings.get("OnlyAmerican"), "American");
  assert.deepEqual(fallbacks.map(event => event.key), ["Greeting", "OnlyAmerican"]);
  assert.deepEqual(Object.keys(strings.getLocaleConfiguration()).sort(),
    ["fallbackLocale", "supportedLocales", "tiebreakerLocalesByLanguageCode"]);

  const matcher = negotiation.createLocaleMatcher(strings.getLocaleConfiguration());
  const matched = createStrings({
    ...configuration(),
    localeSupplier: null,
    localeMatchSupplier: () => matcher.matchForLanguageRanges([{ range: "en-ca", weight: 1 }]),
  });
  assert.equal(matched.getResult("Greeting").localeMatchResult.locale, "en-GB");
  assert.equal(strings.get("Missing", {}, {
    translationFallbackPolicy: "never",
    translationFailureHandler: () => ({ action: "return-string", translation: "Handled" }),
  }), "Handled");
});

test("retired candidate option names and the old matcher factory are not aliases", () => {
  for (const name of ["strings", "localeResolver", "localeMatchResolver", "tiebreakers", "onFailure",
    "fallbackPolicy", "onWarning", "onFallback"])
    assert.throws(() => createStrings({ ...configuration(), [name]: () => "en-US" }),
      error => error instanceof ConfigurationError && error.message.includes(name));
  assert.equal(Object.hasOwn(negotiation, "createLocaleNegotiator"), false);
});

test("localizedStringSupplier runs once and the instance snapshots its catalogs", () => {
  let calls = 0;
  const catalogs = { en: { Greeting: "Hello" } };
  const strings = createStrings({
    localizedStringSupplier: () => { calls++; return catalogs; },
    fallbackLocale: "en",
    localeSupplier: () => "en",
  });
  assert.equal(calls, 1);
  catalogs.en.Greeting = "Changed";
  assert.equal(strings.get("Greeting"), "Hello");
  assert.equal(strings.getResult("Greeting").translation, "Hello");
  assert.equal(calls, 1);
});

test("localizedStringSupplier rejects asynchronous and invalid sources and preserves thrown errors", () => {
  const options = { fallbackLocale: "en", localeSupplier: () => "en" };
  assert.throws(() => createStrings({ ...options, localizedStringSupplier: {} }), /must be a function/);
  assert.throws(() => createStrings({ ...options, localizedStringSupplier: () => null }), /returned null/);
  assert.throws(() => createStrings({ ...options, localizedStringSupplier: () => Promise.resolve({ en: {} }) }),
    /must be synchronous/);
  const cause = new Error("Load failed");
  assert.throws(() => createStrings({ ...options, localizedStringSupplier: () => { throw cause; } }),
    error => error === cause);
});

test("localeMatchResult is shared by lookup diagnostics, failure handlers and fallback observers", () => {
  let failure;
  let fallback;
  const strings = createStrings({
    ...configuration(),
    translationFailureHandler: value => { failure = value; return { action: "return-key" }; },
    translationFallbackObserver: value => { fallback = value; },
  });
  const direct = strings.getDirectLocaleContext("en-CA");
  assert.ok(direct.localeMatchResult);
  assert.equal(Object.hasOwn(direct, "localeMatch"), false);
  const options = forLocaleMatch(direct.localeMatchResult);
  assert.deepEqual(Object.keys(options), ["localeMatchResult"]);
  const translated = strings.getResult("OnlyAmerican", undefined, options);
  assert.equal(translated.localeMatchResult, options.localeMatchResult);
  assert.equal(fallback.localeMatchResult, translated.localeMatchResult);
  const missing = strings.getResult("Missing", undefined, options);
  assert.equal(failure.localeMatchResult, missing.localeMatchResult);
  for (const value of [translated, missing, failure, fallback])
    assert.equal(Object.hasOwn(value, "localeMatch"), false);
  assert.throws(() => strings.get("Greeting", {}, { localeMatch: direct.localeMatchResult }),
    error => error instanceof ConfigurationError && error.message.includes("localeMatch"));
});

test("the loading error has the shared name and no retired alias", () => {
  assert.equal(typeof loading.LocalizedStringLoadingError, "function");
  assert.equal(Object.hasOwn(loading, "StringsLoadingError"), false);
});
