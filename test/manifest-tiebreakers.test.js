// @ts-check
/**
 * Manifest tiebreakers across the loader seam — plan 6.2:2103-2107, M8 acceptance clause 30.
 *
 * **THE CLAUSE WAS UNIMPLEMENTED IN BOTH HALVES AND THE FLAGSHIP DOOR WAS BROKEN BY IT.** Plan
 * 6.2:2103 says manifest tiebreakers are "validated against the full manifest, then filtered to
 * successfully loaded tags while preserving each declared tiebreaker-list order", and that "a
 * language entry with zero successful catalogs is omitted rather than retained as an invalid empty
 * order". Neither sentence had any code. What that cost:
 *
 *   - `loadStrings` — the subset door, the headline API of M8 — fetches the candidate chain and
 *     nothing else, then handed the core the manifest's FULL tiebreaker list. The core applies
 *     Java's construction rule (`DefaultStrings.<init>:394`): the list must be an exact permutation
 *     of the catalogs that language actually has. So any manifest declaring a tiebreaker produced a
 *     `complete: true` record that its own `createStrings` refused.
 *   - A directory holding `en.json` beside `en-GB.json` — the most ordinary multi-catalog layout
 *     there is — generated a manifest, loaded it with `complete: true`, and then refused to
 *     construct, advising the caller to pass `createStrings({ tiebreakers })`, which the loaded
 *     branch explicitly forbids (`loaded-input.js:49`). Unfollowable advice on an ordinary input.
 *
 * **WHY 1,069 TESTS MISSED IT, which is the part worth keeping:** every fixture in
 * `fetch-loader.test.js` and `node-file-loader.test.js` declares `tiebreakers: {}`. The seam was
 * covered in both directions and the one input that discriminates never appeared — the `Zzzz` shape
 * again, this time spelled as an empty object.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { validateStringsManifest } from "../src/load/manifest.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ [`Key.${tag}`]: `hello ${tag}` });

/** A manifest whose fingerprint matches its contents. */
function manifest(tags, { fallbackLocale = "en", tiebreakers = {} } = {}) {
  const files = Object.fromEntries(tags.map((/** @type {string} */ tag) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(bodyFor(tag))) }]));
  const draft = {
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY,
    fallbackLocale, baseUrl: "https://cdn.example/v1/", files, tiebreakers,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

const streamed = (/** @type {Uint8Array[]} */ chunks) => ({
  ok: true, status: 200,
  body: { getReader: () => {
    let index = 0;
    return {
      read: async () => (index >= chunks.length ? { done: true } : { done: false, value: chunks[index++] }),
      cancel: async () => {},
    };
  } },
});
const okBody = (/** @type {string} */ url) =>
  streamed([utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(".json", "")))]);
/** Serves every file except the named ones, which 404. */
const failing = (/** @type {readonly string[]} */ absent) => async (/** @type {string} */ url) =>
  (absent.some((tag) => url.endsWith(`/${tag}.json`)) ? { ok: false, status: 404 } : okBody(url));

// ---------------------------------------------------------------------------------------------
// The filter — plan 6.2:2104. Each of these fails if `tiebreakersForLoaded` is removed from
// `run-plan.js` and the manifest's full set is returned, which is what shipped until now.
// ---------------------------------------------------------------------------------------------

test("a lookup-subset load produces a record its OWN core accepts", async () => {
  // THE DEFECT, at its smallest. The manifest publishes three `en` catalogs; a lookup for `fr`
  // fetches `fr` and the fallback `en` and nothing else. Handing the core all three names is a
  // permutation of catalogs that did not arrive, and it refuses.
  const m = manifest(["en", "en-GB", "en-US", "fr"],
    { fallbackLocale: "en", tiebreakers: { en: ["en-GB", "en-US", "en"] } });
  const loaded = await loadStrings(m, "fr", { fetch: async (/** @type {string} */ u) => okBody(u) });

  assert.equal(loaded.complete, true, "nothing failed; this is a complete SUBSET load");
  assert.deepEqual({ ...loaded.tiebreakers }, { en: ["en"] });
  assert.doesNotThrow(() => createStrings({ loaded, locale: "fr" }));
});

test("the DECLARED ORDER survives filtering rather than being re-derived", async () => {
  // A filter that rebuilt the list from the loaded set — by iterating the catalogs, or by sorting —
  // would produce `["en", "en-GB"]` here and look entirely correct. This list IS the resolution
  // order for an ambiguous language code, so its order is the whole content.
  const m = manifest(["en", "en-GB", "en-US", "fr"],
    { fallbackLocale: "en", tiebreakers: { en: ["en-GB", "en-US", "en"] } });
  const loaded = await loadEntireManifest(m, {
    fetch: failing(["en-US"]), partialFailure: "allow-partial",
  });

  assert.deepEqual({ ...loaded.tiebreakers }, { en: ["en-GB", "en"] });
  assert.notDeepEqual(loaded.tiebreakers.en, ["en", "en-GB"], "sorted, not declared, would pass everything else here");
});

test("a language with ZERO surviving catalogs is OMITTED, not kept as an empty order", async () => {
  // Plan 6.2:2105 names this separately because the two values are not the same thing: an empty
  // array is a declared order that resolves nothing, and the core validates it strictly.
  const m = manifest(["en", "fr", "fr-CA"],
    { fallbackLocale: "en", tiebreakers: { fr: ["fr", "fr-CA"] } });
  const loaded = await loadStrings(m, "en", { fetch: async (/** @type {string} */ u) => okBody(u) });

  assert.deepEqual(Object.keys(loaded.catalogs), ["en"]);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.tiebreakers, "fr"), false,
    "an omitted language must be ABSENT, not present with an empty list");
  assert.doesNotThrow(() => createStrings({ loaded, locale: "en" }));
});

test("SELECTION keeps the full manifest while RESOLUTION keeps what loaded", async () => {
  // The two channels are separate and this is the field that proves it: filtering
  // `manifestLocaleConfiguration` as well would make a partial load unable to SELECT a locale the
  // manifest declares, which is the S9-owed half's entire subject.
  const m = manifest(["en", "en-GB", "en-US", "fr"],
    { fallbackLocale: "en", tiebreakers: { en: ["en-GB", "en-US", "en"] } });
  const loaded = await loadEntireManifest(m, {
    fetch: failing(["en-GB", "en-US"]), partialFailure: "allow-partial",
  });

  assert.equal(loaded.complete, false);
  assert.deepEqual({ ...loaded.tiebreakers }, { en: ["en"] }, "resolution: only what loaded");
  assert.deepEqual({ ...loaded.manifestLocaleConfiguration.tiebreakers }, { en: ["en-GB", "en-US", "en"] },
    "selection: the full manifest, unfiltered");

  const strings = createStrings({ loaded, locale: "en" });
  assert.deepEqual({ ...strings.getLocaleConfiguration().tiebreakers }, { en: ["en-GB", "en-US", "en"] });
});

// ---------------------------------------------------------------------------------------------
// The validation — plan 6.2:2103. Without it the filter above is SILENT: a tiebreaker naming a tag
// the manifest never published is indistinguishable from one whose catalog failed to load, and the
// manifest resolves by a shorter order than its author wrote.
// ---------------------------------------------------------------------------------------------

test("a tiebreaker naming a file the manifest does not declare is REFUSED", () => {
  // `en-UK` for `en-GB` is the typo a publisher writes once. Before this rule it validated, loaded,
  // and silently resolved by a two-name order where three were intended.
  assert.throws(
    () => validateStringsManifest(manifest(["en", "en-GB", "fr"],
      { tiebreakers: { en: ["en-GB", "en-UK", "en"] } })),
    /must be an exact permutation of the files the manifest declares[\s\S]*unrelated: \[en-UK\]/);
});

test("a tiebreaker that OMITS a declared sibling is REFUSED", () => {
  assert.throws(
    () => validateStringsManifest(manifest(["en", "en-GB", "en-US", "fr"],
      { tiebreakers: { en: ["en-GB", "en"] } })),
    /missing: \[en-US\]/);
});

test("a tiebreaker for a language the manifest publishes nothing for is REFUSED", () => {
  assert.throws(
    () => validateStringsManifest(manifest(["en", "fr"], { tiebreakers: { de: ["de"] } })),
    /declares tiebreakers for 'de' but no file for that language/);
});

test("an AMBIGUOUS language with no tiebreaker at all is REFUSED, at publication", () => {
  // The complement, and the one that broke the Node pipeline: `createStrings` refuses this instance
  // outright (`DefaultStrings.<init>:388`), so a manifest that omits the tiebreaker describes
  // coverage nothing can load. Refusing it here is the difference between the publisher learning it
  // at build time and a browser learning it at run time — with advice it cannot follow, because
  // `createStrings({ loaded, tiebreakers })` is itself refused.
  assert.throws(
    () => validateStringsManifest(manifest(["en", "en-GB", "fr"])),
    /declares 2 files for 'en' \[en, en-GB\] and no tiebreakers for it/);
});

test("THE CONTROLS: a legal manifest validates, and one file per language needs no tiebreaker", () => {
  // Without these every refusal above could be firing for an unrelated reason — the `zh-123` shape,
  // which this project has now hit inside its own probe spaces four times.
  assert.doesNotThrow(() => validateStringsManifest(manifest(["en", "en-GB", "fr"],
    { tiebreakers: { en: ["en-GB", "en"] } })));
  assert.doesNotThrow(() => validateStringsManifest(manifest(["en", "fr", "de"])));
});

test("a repeated tiebreaker entry is refused rather than silently deduplicated", () => {
  assert.throws(
    () => validateStringsManifest(manifest(["en", "en-GB", "fr"],
      { tiebreakers: { en: ["en-GB", "en-GB", "en"] } })),
    /name 'en-GB' twice/);
});

test("private-use and undetermined tags create no ambiguity to resolve", () => {
  // The core's carve-out, mirrored deliberately: `LocaleUtils.normalizedLanguage` returns nothing for
  // these, so `x-a` beside `x-b` is a legal instance and must not be forced to declare a tiebreaker.
  assert.doesNotThrow(() => validateStringsManifest(manifest(["en", "und", "x-a", "x-b"])));
});
