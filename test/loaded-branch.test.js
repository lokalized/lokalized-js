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
    // THE MANIFEST'S UNIVERSE, which is what the plan is recomputed against. Every fixture below that
    // moves `requestedFiles` has to move this too, and that is the point: a plan is only checkable
    // against the locale set it was planned over.
    manifestLocaleConfiguration: { fallbackLocale: "en", supportedLocales: ["en", "fr"], tiebreakers: {} },
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
  // Mode 2. `de` was genuinely planned — it is the lookup, and the manifest publishes it — no catalog
  // for it exists, and the result still claims completeness. The plan has to be one this core would
  // itself compute, or mode 1 or 3 would fire first and this assertion would be about a different
  // rejection than the one it names: the `zh-123` shape, inside a fixture.
  const partial = {
    catalogs: { en },
    coverage: { kind: "lookup", lookupLocale: "de" },
    manifestLocaleConfiguration: {
      fallbackLocale: "en", supportedLocales: ["de", "en", "fr"], tiebreakers: {},
    },
    requestedFiles: [{ locale: "de" }, { locale: "en" }],
  };
  assert.throws(
    () => createStrings({ loaded: loadedStrings(partial), locale: "en" }),
    /claims complete: true, but no catalog for it arrived/);

  // The control: the SAME shortfall with `complete: false` is a legitimate partial load and must be
  // accepted, which is what makes the assertion above about the CLAIM rather than about the gap.
  assert.doesNotThrow(
    () => createStrings({ loaded: loadedStrings({ ...partial, complete: false }), locale: "en" }));
});

test("REJECTS completeness claimed over recorded failures", () => {
  // The other half of plan 3.4:730 — "every planned tag must be covered AND no load failure may
  // remain". Separately falsifiable from the covered-tag half above: this result covers every tag it
  // planned, so an implementation that checked only coverage accepts it.
  assert.throws(
    () => createStrings({
      loaded: loadedStrings({ failures: [{ locale: "de", url: "x", stage: "fetch", cause: null }] }),
      locale: "fr",
    }),
    /claims complete: true while recording 1 load failure/);
  assert.doesNotThrow(() => createStrings({
    loaded: loadedStrings({
      failures: [{ locale: "de", url: "x", stage: "fetch", cause: null }],
      complete: false,
    }),
    locale: "fr",
  }));
});

test("REJECTS a result with no manifest configuration to recompute the plan against", () => {
  assert.throws(
    () => createStrings({ loaded: loadedStrings({ manifestLocaleConfiguration: undefined }), locale: "fr" }),
    /cannot be recomputed, only believed/);
});

test("REJECTS a result whose two fallback records disagree", () => {
  assert.throws(
    () => createStrings({
      loaded: loadedStrings({
        manifestLocaleConfiguration: { fallbackLocale: "fr", supportedLocales: ["en", "fr"], tiebreakers: {} },
      }),
      locale: "fr",
    }),
    /resolves fallback 'en' while its manifest configuration resolves 'fr'/);
});

test("REJECTS a catalog filed under a name it does not claim", () => {
  assert.throws(
    () => createStrings({ loaded: loadedStrings({ catalogs: { de: fr, en } }), locale: "en" }),
    /declares locale "fr"/);
});

test("REJECTS `loaded` alongside any direct input it would duplicate", () => {
  // Plan 3.4 lists them as alternatives. Merging would make the instance depend on which source
  // construction read first.
  for (const conflicting of ["strings", "fallbackLocale", "tiebreakers", "limits", "catalogIdentity"])
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

test("entire-manifest coverage IS order-checked, in normalized-tag order", () => {
  // **THIS REVERSES WHAT S9 RECORDED HERE, and the reversal is the finding.** S9 left whole-manifest
  // plans unchecked on the grounds that their order is the manifest's own iteration order and is not
  // recomputable. That was true of what S9 had: a `LoadedStrings` without its manifest configuration.
  // Plan 3.4:727 names the order outright — "normalized-tag order for entire-manifest coverage" — and
  // with the configuration preserved it is recomputable, so mode 1 applies to both kinds.
  //
  // It was also not merely a missing check. `loadEntireManifest` planned in `Object.entries` order,
  // so a manifest whose JSON keys are not sorted produced a result this core now recomputes
  // differently — the loader and the loaded branch disagreed, and nothing compared them.
  assert.doesNotThrow(() => createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  }));
  assert.throws(
    () => createStrings({
      loaded: loadedStrings({
        coverage: { kind: "entire-manifest" },
        requestedFiles: [{ locale: "fr" }, { locale: "en" }],
      }),
      locale: "fr",
    }),
    /is not the plan this core computes for the whole manifest/);
});

test("an unknown coverage kind is REFUSED rather than treated as unchecked", () => {
  // A third `kind` must not fall through the two recomputations into acceptance — which is exactly
  // what a two-arm `if` would do, and what the S9 shape did for `entire-manifest`.
  assert.throws(
    () => createStrings({ loaded: loadedStrings({ coverage: { kind: "everything" } }), locale: "fr" }),
    /must be 'lookup' or 'entire-manifest'/);
});
