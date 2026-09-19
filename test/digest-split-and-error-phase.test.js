// @ts-check
/**
 * TWO DIGESTS WITH DIFFERENT JOBS, AND WHICH ERROR EACH PHASE RAISES — M8 clauses 4, 15 and 27.
 *
 * **CLAUSE 4 IS A SEPARATION, and one fixture proves both halves at once.** `lokalized/load` owns a
 * small audited SYNCHRONOUS SHA-256 so catalog IDENTITY stays synchronous in a browser, while catalog
 * BODY hashing uses asynchronous WebCrypto. Remove `globalThis.crypto` and the two halves come apart
 * visibly: identity still computes, and a body load fails closed. A test that only checked "identity
 * works" would pass over an implementation that used WebCrypto for both and happened to be called in
 * an async context.
 *
 * **CLAUSE 15's DUPLICATE-MEMBER ARM WAS UNGATED, and the sweep found it.** Reporting a duplicate
 * manifest member as a `ConfigurationError` instead of a `StringsParseError` turned ZERO tests red:
 * `manifest.test.js` asserts the duplicate is REFUSED and matches its message, but never its TYPE,
 * and the neighbouring "fails as a parse error, not a configuration error" test drives a different
 * arm — malformed JSON, not a duplicate member. The phase taxonomy is only meaningful if the type is
 * asserted at each phase, because the two reach different catch blocks in a consumer.
 *
 * **CLAUSE 27's DISCRIMINATING HALF is the injected reader**: a complete `Uint8Array` is TRUSTED as
 * already allocated — the loader does not re-stream it — and is still rejected before parsing when it
 * is over the limit. "Trusted" and "unchecked" are different words and only a fixture that is over
 * the limit separates them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, parseStringsManifest, validateStringsManifest } from "../src/load/index.js";
import { loadEntireManifestFromFiles } from "../src/node/file-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ [`Key.${tag}`]: `hello ${tag}` });

function manifest(baseUrl = "https://cdn.example/v1/", tags = ["en"]) {
  const files = Object.fromEntries(tags.map((tag) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(bodyFor(tag))) }]));
  const draft = /** @type {any} */ ({
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY,
    fallbackLocale: "en", baseUrl, files, tiebreakers: {},
  });
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return draft;
}

const withoutWebCrypto = async (/** @type {() => Promise<void> | void} */ body) => {
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try { await body(); } finally { Object.defineProperty(globalThis, "crypto", { value: real, configurable: true }); }
};

// ---------------------------------------------------------------------------------------------
// Clause 4 — identity is synchronous and self-owned; body hashing is WebCrypto.
// ---------------------------------------------------------------------------------------------

test("clause 4: identity is SYNCHRONOUS — it returns a value, not a promise", () => {
  const identity = computeCatalogIdentity(catalogIdentityInputFor(manifest()));
  assert.equal(typeof (/** @type {any} */ (identity).then), "undefined",
    "a thenable here would make every caller async, which is the thing the audited sync hash exists to avoid");
  assert.match(identity.catalogFingerprint, /^[0-9a-f]{64}$/);
});

test("clause 4: with NO WebCrypto at all, identity still computes and a body load fails closed", async () => {
  // THE SEPARATION, in one fixture. Both halves must be observed together: identity alone would pass
  // over an implementation that used WebCrypto for everything, and the failure alone would pass over
  // one that used the sync hash for everything.
  await withoutWebCrypto(async () => {
    const m = manifest();
    assert.match(computeCatalogIdentity(catalogIdentityInputFor(m)).catalogFingerprint, /^[0-9a-f]{64}$/,
      "identity does not depend on the host's WebCrypto");

    const error = await loadEntireManifest(m, { fetch: async () => { throw new Error("unreached"); } })
      .then(() => null, (e) => e);
    assert.equal(error?.code, "DIGEST_UNAVAILABLE",
      "catalog BODY hashing does depend on it, and fails closed rather than skipping verification");
  });

  // THE CONTROL: with WebCrypto present the same manifest loads, so the failure above is attributable
  // to its absence and not to the fixture.
  const loaded = await loadEntireManifest(manifest(), {
    fetch: async (/** @type {string} */ url) => {
      const bytes = utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "")));
      let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }) } };
    },
  });
  assert.equal(loaded.complete, true);
});

// ---------------------------------------------------------------------------------------------
// Clause 15 — which error class each PHASE raises.
// ---------------------------------------------------------------------------------------------

test("clause 15: raw manifest SYNTAX is a StringsParseError — including a duplicate member", () => {
  // The duplicate arm is the one the sweep found ungated: `manifest.test.js` asserts the refusal and
  // its message but never its TYPE, so re-raising it as a ConfigurationError turned zero tests red.
  const text = JSON.stringify(manifest());

  for (const [label, broken] of /** @type {[string, string][]} */ ([
    ["malformed JSON", "{ not json"],
    ["a duplicate root member", text.replace('"cldrVersion"', '"catalogVersion":"other","cldrVersion"')],
  ])) {
    const error = (() => { try { parseStringsManifest(broken); return null; } catch (e) { return e; } })();
    assert.equal(/** @type {any} */ (error)?.name, "StringsParseError", label);
    assert.equal(/** @type {any} */ (error)?.code, "STRINGS_PARSE", label);
  }
});

test("clause 15: a SCHEMA or fingerprint failure is a ConfigurationError, before any plan exists", () => {
  // Same door, different phase: the bytes parse, and what fails is the manifest's own consistency.
  // Pairing it with the test above is what makes the taxonomy a distinction rather than two labels.
  const wrongFingerprint = manifest();
  wrongFingerprint.catalogFingerprint = "9".repeat(64);
  const text = JSON.stringify(wrongFingerprint);

  for (const raise of [() => parseStringsManifest(text), () => validateStringsManifest(wrongFingerprint)]) {
    const error = (() => { try { raise(); return null; } catch (e) { return e; } })();
    assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError");
    assert.equal(/** @type {any} */ (error)?.code, "CONFIGURATION");
  }
});

test("clause 15: after a valid plan, a per-file failure is a StringsLoadingError", async () => {
  const m = manifest("https://cdn.example/v1/", ["en", "fr"]);
  const error = await loadEntireManifest(m, {
    fetch: async (/** @type {string} */ url) =>
      (url.endsWith("fr.json") ? { ok: false, status: 404 } : (() => {
        const bytes = utf8.encode(bodyFor("en"));
        let sent = false;
        return { ok: true, status: 200, body: { getReader: () => ({
          read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
          cancel: async () => {},
        }) } };
      })()),
  }).then(() => null, (e) => e);

  assert.equal(error?.name, "StringsLoadingError");
  assert.equal(error?.code, "STRINGS_LOADING");
  assert.equal(error?.failures?.length, 1, "and it carries the per-file failures the phase is named for");
});

// ---------------------------------------------------------------------------------------------
// Clause 27 — an injected complete Uint8Array is trusted as allocated, and still bounded.
// ---------------------------------------------------------------------------------------------

test("clause 27: an injected Uint8Array over the limit is refused BEFORE parsing", async () => {
  // "Trusted as already allocated" and "unchecked" are different words, and only an over-limit body
  // separates them. The body is VALID JSON, so a loader that skipped the bound would parse it
  // happily — which is what makes the refusal attributable to the limit rather than to the content.
  const big = JSON.stringify({ Key: "x".repeat(4096) });
  const m = manifest("file:///srv/catalogs/");
  m.files.en.sha256 = sha256Hex(utf8.encode(big));
  m.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(m)).catalogFingerprint;

  const error = await loadEntireManifestFromFiles(m, {
    readFile: async () => utf8.encode(big),
    limits: { maximumInputBytes: 1024 },
  }).then(() => null, (e) => e);

  assert.equal(error?.name, "StringsLoadingError");
  assert.equal(error?.failures?.[0]?.stage, "limit",
    "refused at the LIMIT stage, which is before parse in the stage order");

  // THE CONTROL: the same injected array under a limit that admits it loads and parses.
  const loaded = await loadEntireManifestFromFiles(m, {
    readFile: async () => utf8.encode(big),
    limits: { maximumInputBytes: 65_536 },
  });
  assert.equal(loaded.complete, true, "so the refusal above is the bound, not the body");
});
