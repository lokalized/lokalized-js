// @ts-check
/**
 * WHAT `getLoadVerification()` SAYS, AND WHERE EACH FIELD COMES FROM — M8 clauses 5, 13 and 36.
 *
 * These three propositions were recorded with gates that exist and ablations that never named them,
 * and an ablation sweep over the whole SSR family found each of them BLIND — measured, not assumed:
 *
 *   - taking the record's IANA identity from the LOADED RECORD instead of the renderer turns ZERO
 *     tests red across ssr-stamp, ssr-graph, ssr-two-realm, runtime-metadata, load-to-strings,
 *     fetch-loader, loaded-branch and declared-surface;
 *   - reporting `catalogIdentity: null` for a lookup subset turns ZERO red;
 *   - re-narrowing `isCatalogComplete()` to the constant `true` turns ZERO red.
 *
 * The other seams are not blind and are deliberately not re-tested here: re-narrowing
 * `getCatalogIdentity()` turns 23 red and `getLoadVerification()` turns 24, which is why clause 36
 * needs only its third seam covered rather than a new file for all three.
 *
 * **WHY THE BLINDNESS IS STRUCTURAL RATHER THAN AN OVERSIGHT.** Every SSR test builds its record
 * through a real loader, where the renderer's IANA identity and the loader's agree by construction,
 * the identity of a subset happens never to be read, and every stamped instance is complete because
 * `createSsrStamp` refuses anything else. Each of the three only becomes observable when the two
 * sources are deliberately made to DISAGREE.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { RUNTIME_METADATA } from "../src/internal/runtime-metadata.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { validateStringsManifest } from "../src/load/manifest.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ [`Key.${tag}`]: `hello ${tag}` });

/** Four catalogs, so a lookup subset is a PROPER subset and the two identities could differ. */
function manifest(tags = ["en", "fr", "de", "ja"]) {
  const files = Object.fromEntries(tags.map((tag) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(bodyFor(tag))) }]));
  const draft = {
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: "en", baseUrl: "https://cdn.example/v1/", files, tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

const serve = (/** @type {readonly string[]} */ absent = []) => async (/** @type {string} */ url) => {
  const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
  if (absent.includes(tag)) return { ok: false, status: 404 };
  const bytes = utf8.encode(bodyFor(tag));
  let sent = false;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      cancel: async () => {},
    }) },
  };
};

// ---------------------------------------------------------------------------------------------
// Clause 5 — the manifest carries NO IANA field, and the record's IANA identity is the RENDERER'S.
// ---------------------------------------------------------------------------------------------

test("clause 5: the manifest format carries no IANA field, and one offered is not adopted", () => {
  // Two halves. First, a validated manifest has no IANA key at all — the format does not have the
  // concept, which is why the renderer has to supply it.
  const validated = validateStringsManifest(manifest());
  const ianaKeys = Object.keys(validated).filter((key) => /iana/i.test(key));
  assert.deepEqual(ianaKeys, [], `a manifest must carry no IANA field; found ${ianaKeys.join(", ")}`);

  // Second, and this is the half a "no such key" assertion alone would miss: a publisher who ADDS
  // one must not have it adopted. It is dropped rather than carried, so the projection the
  // fingerprint is computed over cannot be widened by a field the format does not define.
  const offered = /** @type {any} */ ({ ...manifest(), ianaRegistryDate: "2026-01-01" });
  offered.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(offered)).catalogFingerprint;
  const revalidated = validateStringsManifest(offered);
  assert.equal(/** @type {any} */ (revalidated).ianaRegistryDate, undefined,
    "an offered IANA field must not survive validation");
  assert.equal(revalidated.catalogFingerprint, validateStringsManifest(manifest()).catalogFingerprint,
    "and it must not change the identity, or the format would carry it after all");
});

test("clause 5: the record's IANA identity comes from the RENDERER, not from the loaded record", async () => {
  // THE DISCRIMINATING INPUT: a record that CLAIMS a different IANA identity. Through a real loader
  // the two agree by construction, which is exactly why every existing test is blind here — the
  // ablation that reads these fields from `loaded` turns nothing red.
  const m = manifest();
  const loaded = await loadEntireManifest(m, { fetch: serve() });
  assert.equal(loaded.ianaRegistryDate, undefined,
    "the loader does not even emit these fields; the renderer is their only source");

  const claiming = /** @type {any} */ ({
    ...loaded, ianaRegistryDate: "1999-12-31", ianaDataFingerprint: "f".repeat(64),
  });
  const record = createStrings({ loaded: claiming, locale: "en" }).getLoadVerification();

  assert.equal(record?.ianaRegistryDate, RUNTIME_METADATA.ianaRegistryDate);
  assert.equal(record?.ianaDataFingerprint, RUNTIME_METADATA.ianaDataFingerprint);
  assert.notEqual(record?.ianaRegistryDate, "1999-12-31",
    "a record that claimed its own IANA identity must not have been believed");

  // THE CONTROL. Without it the two assertions above are also satisfied by a record that reports
  // nothing at all, or by a build whose metadata happens to be undefined on both sides.
  assert.ok(typeof RUNTIME_METADATA.ianaRegistryDate === "string" && RUNTIME_METADATA.ianaRegistryDate.length > 0,
    "the build must actually carry an IANA identity, or nothing above discriminates");
});

// ---------------------------------------------------------------------------------------------
// Clause 13 — `catalogIdentity` identifies the FULL manifest, even when only a subset is loaded.
// ---------------------------------------------------------------------------------------------

test("clause 13: a lookup subset carries the FULL manifest's identity", async () => {
  const m = manifest();
  const subset = await loadStrings(m, "fr", { fetch: serve() });
  const whole = await loadEntireManifest(m, { fetch: serve() });

  // The anti-vacuity half FIRST: if the subset were not a proper subset, the two identities would
  // agree for a reason that has nothing to do with the clause.
  assert.ok(Object.keys(subset.catalogs).length < Object.keys(whole.catalogs).length,
    `the subset must be PROPER: ${Object.keys(subset.catalogs)} vs ${Object.keys(whole.catalogs)}`);

  assert.deepEqual({ ...subset.catalogIdentity }, { ...whole.catalogIdentity },
    "a subset identifies the same catalog set as the whole manifest");
  assert.equal(subset.catalogIdentity.catalogFingerprint, m.catalogFingerprint,
    "and that identity is the manifest's own declared fingerprint");
  assert.equal(createStrings({ loaded: subset, locale: "fr" }).getCatalogIdentity()?.catalogFingerprint,
    m.catalogFingerprint, "the instance reports it too");
});

test("clause 13: an INCOMPLETE load still identifies the full manifest", async () => {
  // The second way a subset arises — declared coverage that partly failed — and the one where
  // "identify only what you have" is most tempting.
  const m = manifest();
  const partial = await loadEntireManifest(m, { fetch: serve(["de", "ja"]), partialFailure: "allow-partial" });

  assert.equal(partial.complete, false);
  assert.equal(partial.catalogIdentity.catalogFingerprint, m.catalogFingerprint,
    "a partial load identifies the manifest it was planned from, not the files that arrived");
});

// ---------------------------------------------------------------------------------------------
// Clause 36 — the third seam: `isCatalogComplete()` reports the record, not a constant.
// ---------------------------------------------------------------------------------------------

test("clause 36: isCatalogComplete() reports the RECORD's completeness, not a constant", async () => {
  const m = manifest();

  // Arm 1 — the one that discriminates a constant `true`. A partial load's instance must say false.
  const partial = await loadEntireManifest(m, { fetch: serve(["de"]), partialFailure: "allow-partial" });
  const partialStrings = createStrings({ loaded: partial, locale: "en" });
  assert.equal(partialStrings.isCatalogComplete(), false,
    "a partial load's instance must report incomplete; a constant `true` passes everything else");

  // Arm 2 — the one that discriminates a constant `false`, and the reason both arms are needed.
  const whole = await loadEntireManifest(m, { fetch: serve() });
  assert.equal(createStrings({ loaded: whole, locale: "en" }).isCatalogComplete(), true);

  // Arm 3 — direct construction has no record at all and reports complete, which is the documented
  // asymmetry (`types/core/index.d.ts:83`) rather than an accident of the other two arms.
  assert.equal(
    createStrings({ strings: { en: { K: "v" } }, fallbackLocale: "en", locale: "en" }).isCatalogComplete(),
    true, "a directly constructed instance is complete by definition");
});
