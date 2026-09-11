// @ts-check
/**
 * The handshake: `lokalized/load` -> `createStrings({ loaded })` -> `lokalized/ssr`.
 *
 * **THIS FILE EXISTS BECAUSE THE THREE SLICES WERE GREEN SEPARATELY AND DISAGREED.** S8 shipped the
 * Fetch loader and its own tests pass; S9 shipped the loaded branch and its own tests pass; nothing
 * ran a real loader result through real construction. Two defects lived in that gap:
 *
 *   1. `loadEntireManifest` planned in `Object.entries(files)` order — the manifest's JSON key order —
 *      while `createStrings` recomputes the plan in normalized-tag order (plan 3.4:727). A manifest
 *      whose keys are not already sorted produced a result the loaded branch would reject. The test
 *      below uses a DELIBERATELY UNSORTED manifest, because a sorted one cannot fail;
 *   2. the loader never emitted `manifestLocaleConfiguration`, a field its own `LoadedStrings`
 *      typedef has declared since S5. Nothing compared the returned literal to the typedef, so the
 *      declaration and the object drifted silently — until the branch that needs the field arrived.
 *
 * Both are the same shape as this project's standing lesson about probe spaces: each slice's tests
 * were derived from that slice, so neither could see the seam between them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { createSsrStamp } from "../src/ssr/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Hi: `hello ${tag}` });

/** A manifest whose `files` keys keep the order they are given — the point of the fixture. */
function manifest(/** @type {string[]} */ tags) {
  const files = Object.fromEntries(tags.map((tag) => {
    const bytes = utf8.encode(bodyFor(tag));
    return [tag, { url: `${tag}.json`, sha256: sha256Hex(bytes) }];
  }));
  const draft = {
    formatVersion: 1, catalogVersion: "2026.09.11", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: "en", baseUrl: "https://cdn.example/v1/", files, tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/** An in-order fetch returning each locale's real body. Misbehaviour is `fetch-loader.test.js`'s job. */
const fetchImpl = async (/** @type {string} */ url) => {
  const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
  const bytes = utf8.encode(bodyFor(tag));
  let sent = false;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes })),
      cancel: async () => {},
    }) },
  };
};

test("a WHOLE-MANIFEST load built from unsorted keys constructs and stamps", async () => {
  // `fr` before `en` in the manifest's own key order. Before this slice the loader planned in that
  // order and `createStrings` recomputed `["en", "fr"]`, so construction refused a result its own
  // loader had just produced.
  const source = manifest(["fr", "en", "de"]);
  assert.deepEqual(Object.keys(source.files), ["fr", "en", "de"], "the fixture must be unsorted");

  const loaded = await loadEntireManifest(source, { fetch: fetchImpl });
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ e) => e.locale), ["de", "en", "fr"],
    "the whole-manifest plan is normalized-tag order");
  assert.deepEqual(loaded.manifestLocaleConfiguration,
    { fallbackLocale: "en", supportedLocales: ["de", "en", "fr"], tiebreakers: {} });

  const strings = createStrings({ loaded, locale: "fr" });
  assert.equal(strings.get("Hi"), "hello fr");
  assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr"]);
  assert.deepEqual(strings.getCatalogIdentity(), {
    catalogVersion: source.catalogVersion, catalogFingerprint: source.catalogFingerprint,
  });

  // And the whole chain ends in a stamp whose catalog identity is the MANIFEST's, which is the point
  // of the identity travelling at all.
  const stamp = createSsrStamp(strings, { kind: "locale", locale: "fr" });
  assert.equal(stamp.catalogFingerprint, source.catalogFingerprint);
  assert.equal(stamp.lookupLocale, "fr");
});

test("a LOOKUP-SUBSET load constructs, and its coverage tag is the normalized request", async () => {
  const source = manifest(["fr", "en"]);
  // Requested in a non-canonical spelling on purpose: plan 6.1 records the NORMALIZED serialized
  // value, and plan 6.4 then compares a rendering context against exactly that.
  const loaded = await loadStrings(source, "FR", { fetch: fetchImpl });
  assert.deepEqual(loaded.coverage, { kind: "lookup", lookupLocale: "fr" });
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ e) => e.locale), ["fr", "en"]);

  const strings = createStrings({ loaded, locale: "fr" });
  const stamp = createSsrStamp(strings, { kind: "locale", locale: "fr" });
  assert.equal(stamp.localeMatch.locale, "fr");

  // The coverage rule is live on a REAL loader result, not only on a hand-built one: this instance
  // was planned from `fr` and cannot stamp an `en` render.
  assert.throws(() => createSsrStamp(strings, { kind: "locale", locale: "en" }),
    /covers lookup 'fr' only/);
});
