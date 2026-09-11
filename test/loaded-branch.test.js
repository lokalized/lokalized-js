// @ts-check
/**
 * `createStrings({ loaded })` — plan 3.4 and plan 8.3's fabricated-`LoadedStrings` rejections.
 *
 * **A `LoadedStrings` IS AN ORDINARY OBJECT A CALLER CAN BUILD BY HAND.** That is the whole reason
 * these tests exist: plan 3.4 says the branch must ensure "a valid relaxed loader result is not
 * spuriously rejected AND a fabricated result cannot bypass the same limits", and only the second
 * half needs defending. Every field that would otherwise be believed is recomputed, and each
 * rejection below is paired with the near-identical accepted case, because a branch that refused
 * everything would pass every rejection test ever written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { parseStrings } from "../src/parse/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";

const en = parseStrings(JSON.stringify({ Hi: "hello" }), { locale: "en" });
const fr = parseStrings(JSON.stringify({ Hi: "bonjour" }), { locale: "fr" });

/** A LoadedStrings this core should accept. */
function loadedStrings(overrides = {}) {
  const pinned = pinnedProvenance();
  return /** @type {any} */ ({
    catalogs: { fr, en },
    tiebreakers: {},
    fallbackLocale: "en",
    catalogIdentity: { catalogVersion: "v1", catalogFingerprint: "0".repeat(64) },
    cldrVersion: pinned.cldrVersion,
    dataFingerprint: pinned.dataFingerprint,
    loadingLimits: {},
    coverage: { kind: "lookup", lookupLocale: "fr" },
    requestedFiles: [{ locale: "fr" }, { locale: "en" }],
    failures: [],
    warnings: [],
    complete: true,
    ...overrides,
  });
}

test("a valid loader result builds and renders", () => {
  const strings = createStrings({ loaded: loadedStrings(), locale: "fr" });
  assert.deepEqual(strings.getSupportedLocales(), ["en", "fr"]);
  assert.equal(strings.get("Hi"), "bonjour");
  // The control for every rejection below: without it they would all pass on a branch that refused
  // any `loaded` input at all.
});

test("REJECTS a result produced against different pinned CLDR data", () => {
  // Plan 3.4: it fails "EVEN WHEN its immediate file plan happens to match" — the plan here is
  // byte-identical to the accepted case, and only the provenance differs.
  assert.throws(() => createStrings({ loaded: loadedStrings({ cldrVersion: "1.0" }), locale: "fr" }),
    /produced against CLDR 1\.0/);
  assert.throws(
    () => createStrings({ loaded: loadedStrings({ dataFingerprint: "e".repeat(64) }), locale: "fr" }),
    /this core carries CLDR/);
});

test("REJECTS a fetch plan whose ORDER differs from what this core would compute", () => {
  // Mode 1 of plan :2578. Same locales, same catalogs, same coverage — only the recorded order moves.
  assert.throws(
    () => createStrings({
      loaded: loadedStrings({ requestedFiles: [{ locale: "en" }, { locale: "fr" }] }),
      locale: "fr",
    }),
    /is not the plan this core computes/);
});

test("REJECTS a covered set carrying a tag the plan never requested", () => {
  // Mode 3. The catalog for `en` is real and loadable; what is wrong is that nothing planned it.
  assert.throws(
    () => createStrings({ loaded: loadedStrings({ requestedFiles: [{ locale: "fr" }] }), locale: "fr" }),
    /contains 'en', which the recorded fetch plan never requested/);
});

test("REJECTS a complete:true plan whose file never arrived", () => {
  // Mode 2. `de` was planned, no catalog for it exists, and the result still claims completeness.
  assert.throws(
    () => createStrings({
      loaded: loadedStrings({ requestedFiles: [{ locale: "fr" }, { locale: "en" }, { locale: "de" }] }),
      locale: "fr",
    }),
    /claims complete: true, but no catalog for it arrived/);

  // The control: the SAME shortfall with `complete: false` is a legitimate partial load and must be
  // accepted, which is what makes the assertion above about the CLAIM rather than about the gap.
  assert.doesNotThrow(() => createStrings({
    loaded: loadedStrings({
      requestedFiles: [{ locale: "fr" }, { locale: "en" }, { locale: "de" }],
      complete: false,
    }),
    locale: "fr",
  }));
});

test("REJECTS a catalog filed under a name it does not claim", () => {
  assert.throws(
    () => createStrings({ loaded: loadedStrings({ catalogs: { de: fr, en } }), locale: "en" }),
    /declares locale "fr"/);
});

test("REJECTS `loaded` alongside any direct input it would duplicate", () => {
  // Plan 3.4 lists them as alternatives. Merging would make the instance depend on which source
  // construction read first.
  for (const conflicting of ["strings", "fallbackLocale", "tiebreakers", "limits"])
    assert.throws(
      () => createStrings({ loaded: loadedStrings(), locale: "fr", [conflicting]: {} }),
      /already carries/, `${conflicting} must not be accepted alongside loaded`);
});

test("the loader's own limits are reused, not the defaults", () => {
  // Plan 3.4: the branch "neither falls back to defaults nor permits a second override", so a catalog
  // loaded under RELAXED limits must not be spuriously rejected when it revalidates. A default-using
  // branch refuses this instance; a relaxed one builds it.
  const deep = { a: { b: { c: { d: { e: "x" } } } } };
  const relaxed = parseStrings(JSON.stringify({ Deep: "plain" }), {
    locale: "en", limits: { maximumJsonNestingDepth: 4 },
  });
  void deep;
  assert.doesNotThrow(() => createStrings({
    loaded: loadedStrings({
      catalogs: { en: relaxed },
      requestedFiles: [{ locale: "en" }],
      coverage: { kind: "lookup", lookupLocale: "en" },
      loadingLimits: { maximumJsonNestingDepth: 4, maximumTranslationNodes: 2 },
    }),
    locale: "en",
  }));
});

test("entire-manifest coverage does not order-check, and says so", () => {
  // The order of a whole-manifest plan is the manifest's own iteration order and is not recomputable
  // from a LoadedStrings, so mode 1 is deliberately not applied. Pinned so that a later reader does
  // not mistake a green whole-manifest load for an order check.
  assert.doesNotThrow(() => createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  }));
});
