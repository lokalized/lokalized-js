// @ts-check
/**
 * WHICH URLs EACH DOOR WILL READ, AND WHAT IT DOES WITH LIMIT OVERRIDES — M8 clauses 10, 14 and 33.
 *
 * Three propositions an ablation sweep found ungated, each for a different reason.
 *
 * **CLAUSE 10 WAS HALF UNIMPLEMENTED.** Plan 6.2 states the rule once for both doors — "Fetch loaders
 * reject base or resolved URLs outside http:/https: and Node file loaders reject anything outside
 * file:" — and only the Node half had code. Measured before the fix: a manifest whose `baseUrl` is
 * `file:///srv/catalogs/` loaded through the FETCH door and invoked the transport with
 * `file:///srv/catalogs/en.json`, while the Node door refused the mirror-image `https:` manifest with
 * zero reader invocations. The asymmetry was invisible because no test ever handed a door the other
 * door's scheme.
 *
 * **CLAUSES 14 AND 33 WERE BLIND, AND THE ABLATIONS SAY SO.** Making the loaded branch fall back to
 * DEFAULT limits instead of the loader's frozen record turned ZERO tests red across eight files; so
 * did returning the caller's raw overrides instead of the complete normalized record. Both are
 * invisible while every fixture uses default limits, because then the raw overrides, the normalized
 * record and the defaults are all the same numbers.
 *
 * **THE REFUSALS ARE PROVEN BY NON-INVOCATION, not by the error alone.** Proving a read did NOT happen
 * needs an instrument that would notice if it did, so every transport here records each call and the
 * assertion is that it recorded NONE — the shape S8 established for the WebCrypto preflight.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest } from "../src/load/fetch-loader.js";
import { loadEntireManifestFromFiles } from "../src/node/file-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ [`Key.${tag}`]: `hello ${tag}` });

function manifest(baseUrl, tags = ["en", "fr"]) {
  const files = Object.fromEntries(tags.map((tag) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(bodyFor(tag))) }]));
  const draft = {
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: "en", baseUrl, files, tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/** A transport that records every call, so "no I/O happened" is falsifiable. */
function recordingFetch() {
  const calls = [];
  return { calls, impl: async (/** @type {string} */ url) => {
    calls.push(url);
    const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
    const bytes = utf8.encode(bodyFor(tag));
    let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      cancel: async () => {},
    }) } };
  } };
}
function recordingReader() {
  const calls = [];
  return { calls, impl: async (/** @type {string} */ url) => {
    calls.push(url);
    return utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "")));
  } };
}

// ---------------------------------------------------------------------------------------------
// Clause 10 — each door refuses the other's scheme, BEFORE any catalog I/O.
// ---------------------------------------------------------------------------------------------

test("clause 10: the FETCH door refuses a file: manifest and reads nothing", async () => {
  const transport = recordingFetch();
  const error = await loadEntireManifest(manifest("file:///srv/catalogs/"), { fetch: transport.impl })
    .then(() => null, (e) => e);

  assert.equal(error?.name, "ConfigurationError");
  assert.match(String(error?.message), /Fetch loaders read `http:` and `https:` URLs only/);
  assert.equal(transport.calls.length, 0, "no catalog may be fetched from a scheme this door cannot serve");
});

test("clause 10: the NODE door refuses an https: manifest and reads nothing", async () => {
  const transport = recordingReader();
  const error = await loadEntireManifestFromFiles(manifest("https://cdn.example/v1/"), { readFile: transport.impl })
    .then(() => null, (e) => e);

  assert.equal(error?.name, "ConfigurationError");
  assert.match(String(error?.message), /Node file loaders read `file:` URLs only/);
  assert.equal(transport.calls.length, 0);
});

test("clause 10: THE CONTROLS — each door loads its own scheme end to end", async () => {
  // Without these, both refusals above are equally satisfied by a door that refuses everything. The
  // two manifests are the same catalog set — identity covers neither `baseUrl` nor any file URL — so
  // the only variable across all four tests in this group is the scheme.
  const served = manifest("https://cdn.example/v1/");
  const onDisk = manifest("file:///srv/catalogs/");
  assert.equal(served.catalogFingerprint, onDisk.catalogFingerprint,
    "the two manifests must differ ONLY in scheme, or the refusals are not attributable to it");

  const viaFetch = recordingFetch();
  const loaded = await loadEntireManifest(served, { fetch: viaFetch.impl });
  assert.equal(loaded.complete, true);
  assert.equal(viaFetch.calls.length, 2);

  const viaRead = recordingReader();
  const read = await loadEntireManifestFromFiles(onDisk, { readFile: viaRead.impl });
  assert.equal(read.complete, true);
  assert.equal(viaRead.calls.length, 2);
});

test("clause 10: a RESOLVED url outside the scheme is refused, not just the base", async () => {
  // The clause says "base or resolved". A per-file absolute url overrides the base, so a manifest
  // with an http base and one file: entry is the input that separates the two readings — a door that
  // checked only `baseUrl` would fetch it.
  const m = manifest("https://cdn.example/v1/");
  m.files.fr.url = "file:///srv/catalogs/fr.json";
  m.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(m)).catalogFingerprint;

  const transport = recordingFetch();
  const error = await loadEntireManifest(m, { fetch: transport.impl }).then(() => null, (e) => e);
  assert.match(String(error?.message), /'fr' resolves to 'file:\/\/\/srv\/catalogs\/fr\.json'/);
  assert.equal(transport.calls.length, 0, "and still before any I/O — `en` is fine and must not be read");
});

// ---------------------------------------------------------------------------------------------
// Clauses 14 and 33 — one normalized limits record, produced once and reused.
// ---------------------------------------------------------------------------------------------

const SEVEN_LIMITS = [
  "maximumInputBytes", "maximumReaderCharacters", "maximumJsonNestingDepth", "maximumTotalInputBytes",
  "maximumLocalizedStringsFiles", "maximumTranslationNodes", "maximumWarnings",
];

test("clause 14: a loader returns the COMPLETE frozen normalized limits, not the caller's overrides", async () => {
  // ONE override supplied. A loader that handed back what it was given would return an object with a
  // single key — indistinguishable from the normalized record while every fixture uses defaults,
  // which is exactly why this was blind.
  const transport = recordingFetch();
  const loaded = await loadEntireManifest(manifest("https://cdn.example/v1/"), {
    fetch: transport.impl, limits: { maximumWarnings: 3 },
  });

  assert.deepEqual(Object.keys(loaded.loadingLimits).sort(), [...SEVEN_LIMITS].sort(),
    "all seven limits are present, with the defaults filled in");
  assert.equal(loaded.loadingLimits.maximumWarnings, 3, "the override survives");
  assert.ok(loaded.loadingLimits.maximumInputBytes > 0, "and the defaults are real values, not undefined");
  assert.ok(Object.isFrozen(loaded.loadingLimits), "the record is frozen");
  assert.throws(() => { /** @type {any} */ (loaded.loadingLimits).maximumWarnings = 9; }, TypeError);
});

test("clause 33: the loaded branch reuses THOSE limits — a relaxed load is not spuriously refused", async () => {
  // THE DISCRIMINATING CASE, and it needs a catalog that the DEFAULT limits would refuse and the
  // relaxed ones admit. A nesting depth of 3 is under the default ceiling, so the separator is a
  // deliberately tiny `maximumJsonNestingDepth` that the load itself was performed under: construction
  // revalidates, and revalidating under the DEFAULTS would silently accept what the loader refused —
  // while revalidating under a FRESH read of the caller's options would refuse what the loader
  // accepted. Both are wrong; reusing the loader's own frozen record is the rule.
  const relaxed = { maximumWarnings: 1, maximumTranslationNodes: 4 };
  const transport = recordingFetch();
  const loaded = await loadEntireManifest(manifest("https://cdn.example/v1/"), {
    fetch: transport.impl, limits: relaxed,
  });

  assert.equal(loaded.loadingLimits.maximumTranslationNodes, 4);
  assert.doesNotThrow(() => createStrings({ loaded, locale: "en" }),
    "construction revalidates under the loader's own record, so the load is not re-judged");

  // THE OTHER DIRECTION: a FABRICATED record cannot widen the limits construction applies. The record
  // claims a translation-node budget of 1, which its own catalogs exceed, so construction must refuse
  // — a branch that ignored the record's limits in favour of the defaults would accept it.
  const understated = { ...loaded, loadingLimits: Object.freeze({ ...loaded.loadingLimits, maximumTranslationNodes: 1 }) };
  assert.throws(() => createStrings({ loaded: understated, locale: "en" }),
    /translation node/i, "the record's limits are the ones construction obeys");
});
