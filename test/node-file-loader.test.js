// @ts-check
/**
 * `lokalized/node`'s manifest-mediated file loaders — plan section 6.2's Node door.
 *
 * **THE ORACLE, STATED FIRST.** Java has no manifest, no digest and no file-URL loader, so nothing
 * here is corpus-arbitrated: the plan is the only specification these functions have. What this file
 * can do honestly is (a) check the rules the plan states in words, and (b) check that this door and
 * the Fetch door — which share a runner and differ only in transport — actually agree, which is an
 * internal consistency property and is labelled as one where it is asserted.
 *
 * **THE SCHEME BOUNDARY IS TESTED BY NON-INVOCATION, not by the error.** Plan 6.2 says these loaders
 * "reject any resolved non-`file:` URL". An implementation that checked the scheme inside its reader
 * would produce the same rejection while having already read every other file — so the reader here
 * RECORDS EVERY CALL and the assertion is that it recorded none.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import {
  loadEntireManifestFromFiles, loadStringsFromFiles, readStringsManifest,
} from "../src/node/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();
const root = mkdtempSync(join(tmpdir(), "lokalized-files-"));
after(() => rmSync(root, { recursive: true, force: true }));

const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Hi: `hello ${tag}` });

/**
 * Write a catalog per tag into a fresh directory and return a manifest pointing at it.
 * @param {string[]} tags @param {{ corrupt?: string, omit?: string, big?: string }} [flaws]
 */
function directoryManifest(tags, flaws = {}) {
  const directory = mkdtempSync(join(root, "m-"));
  /** @type {Record<string, any>} */
  const files = {};
  for (const tag of tags) {
    const text = flaws.big === tag ? JSON.stringify({ Hi: "x".repeat(200_000) }) : bodyFor(tag);
    const bytes = utf8.encode(text);
    if (flaws.omit !== tag) writeFileSync(join(directory, `${tag}.json`), text);
    files[tag] = {
      url: `${tag}.json`,
      // A corrupt entry declares a digest for DIFFERENT bytes, so the file on disk is intact and the
      // manifest's claim about it is not — which is the failure a digest exists to catch.
      sha256: flaws.corrupt === tag ? sha256Hex(utf8.encode("something else")) : sha256Hex(bytes),
    };
  }
  const draft = {
    formatVersion: 1, catalogVersion: "2026.09.11", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: "en", baseUrl: pathToFileURL(`${directory}/`).href, files, tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return { directory, manifest: /** @type {any} */ (draft) };
}

test("a whole-manifest file load constructs a Strings, through the DEFAULT streaming reader", async () => {
  const { manifest } = directoryManifest(["fr", "en", "de"]);
  const loaded = await loadEntireManifestFromFiles(manifest);

  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ e) => e.locale), ["de", "en", "fr"]);
  assert.equal(loaded.complete, true);
  assert.deepEqual(loaded.coverage, { kind: "entire-manifest" });

  const strings = createStrings({ loaded, locale: "fr" });
  assert.equal(strings.get("Hi"), "hello fr");
  assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr"]);
});

test("a lookup-subset file load plans and records exactly what the browser door would", async () => {
  const { manifest } = directoryManifest(["fr", "en", "de"]);
  const loaded = await loadStringsFromFiles(manifest, "FR");
  assert.deepEqual(loaded.coverage, { kind: "lookup", lookupLocale: "fr" });
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ e) => e.locale), ["fr", "en"]);
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);
});

test("the default reader handles a body far larger than one filesystem chunk", async () => {
  // 200 KB through the streaming path: the digest is accumulated chunk by chunk, so a reader that
  // reassembled badly or hashed only the first chunk fails here rather than silently in production.
  const { manifest } = directoryManifest(["en"], { big: "en" });
  const loaded = await loadEntireManifestFromFiles(manifest, {
    limits: { maximumInputBytes: 1_000_000, maximumTotalInputBytes: 1_000_000 },
  });
  assert.equal(loaded.complete, true);
});

test("the incremental digest is the whole body's, however the reader chunks it", async () => {
  // One byte at a time. The hash is fed by `onChunk` while the bounded reader accumulates, so this
  // is the direct test that the incremental path agrees with a one-shot hash of the same bytes.
  const { manifest } = directoryManifest(["en"]);
  /** @type {string[]} */
  const calls = [];
  const loaded = await loadEntireManifestFromFiles(manifest, {
    readFile: async (url) => {
      calls.push(url);
      const bytes = utf8.encode(bodyFor("en"));
      return (async function* () { for (const byte of bytes) yield new Uint8Array([byte]); })();
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(loaded.complete, true);
});

// ------------------------------------------------------------- the scheme boundary

test("a non-file: URL is refused BEFORE the reader is invoked even once", async () => {
  const { manifest } = directoryManifest(["en", "fr"]);
  const remote = { ...manifest, files: { ...manifest.files, fr: { ...manifest.files.fr, url: "https://cdn.example/fr.json" } } };

  /** @type {string[]} */
  const calls = [];
  await assert.rejects(
    () => loadEntireManifestFromFiles(/** @type {any} */ (remote), {
      readFile: async (url) => { calls.push(url); return utf8.encode(bodyFor("en")); },
    }),
    /read `file:` URLs only, and 'fr' resolves to 'https:\/\/cdn\.example\/fr\.json'/);

  // **THE ASSERTION THIS TEST EXISTS FOR.** The rejection is not enough: a loader that checked the
  // scheme inside its reader would produce the identical error having already read `en`.
  assert.deepEqual(calls, [], "no file may be read when any entry resolves off the file: scheme");

  // **AND UNDER `allow-partial` IT MUST STILL REFUSE THE WHOLE LOAD.** This is where a scheme check
  // placed inside the reader stops being a wording difference and becomes a defect: the `https:`
  // entry would degrade into one `LoadFailure`, the partial policy would accept the rest, and the
  // caller would receive a successful load that had silently skipped a file it asked for. Measured
  // by ablation — moving the check into `read` produces exactly `StringsLoadingError: 1 catalog
  // file(s) failed to load` here instead of a refusal.
  await assert.rejects(
    () => loadEntireManifestFromFiles(/** @type {any} */ (remote), { partialFailure: "allow-partial" }),
    /read `file:` URLs only/);

  // The control: the same manifest with every entry on `file:` reads exactly its two files.
  const ok = [];
  await loadEntireManifestFromFiles(manifest, {
    readFile: async (url) => { ok.push(url); return utf8.encode(bodyFor(url.endsWith("fr.json") ? "fr" : "en")); },
  });
  assert.equal(ok.length, 2);
});

test("network options are refused rather than ignored, before any read", async () => {
  const { manifest } = directoryManifest(["en"]);
  for (const networkOnly of ["fetch", "request"]) {
    const calls = [];
    await assert.rejects(
      () => loadEntireManifestFromFiles(manifest, /** @type {any} */ ({
        [networkOnly]: () => { throw new Error("unreachable"); },
        readFile: async (url) => { calls.push(url); return utf8.encode(bodyFor("en")); },
      })),
      new RegExp(`\`${networkOnly}\` is not an option of the Node file loaders`));
    assert.deepEqual(calls, []);
  }
});

// ------------------------------------------------------------- failures

test("a digest that does not match the file on disk fails at the DIGEST stage", async () => {
  const { manifest } = directoryManifest(["en"], { corrupt: "en" });
  const error = await loadEntireManifestFromFiles(manifest).then(() => null, (e) => e);
  assert.equal(error?.name, "StringsLoadingError");
  assert.equal(error.failures.length, 1);
  assert.equal(error.failures[0].stage, "digest");
});

test("a missing file fails at the READ stage, and a limit refusal stays a LIMIT", async () => {
  const { manifest } = directoryManifest(["en", "fr"], { omit: "fr" });
  const missing = await loadEntireManifestFromFiles(manifest).then(() => null, (e) => e);
  assert.equal(missing.failures[0].stage, "read", "an absent file is I/O, not a parse problem");

  // A body over the byte cap is a `limit` failure, NOT a read failure: the taxonomy keeps them apart
  // and the transport must not relabel a classified throw as its own default stage.
  const { manifest: big } = directoryManifest(["en"], { big: "en" });
  const over = await loadEntireManifestFromFiles(big, { limits: { maximumInputBytes: 500 } })
    .then(() => null, (e) => e);
  assert.equal(over.failures[0].stage, "limit");
});

test("allow-partial keeps a load whose fallback arrived, and refuses one whose fallback did not", async () => {
  const { manifest } = directoryManifest(["en", "fr"], { omit: "fr" });
  const partial = await loadEntireManifestFromFiles(manifest, { partialFailure: "allow-partial" });
  assert.equal(partial.complete, false);
  assert.deepEqual(Object.keys(partial.catalogs), ["en"]);
  assert.equal(partial.failures.length, 1);
  // And it still constructs — the loaded branch accepts an incomplete result, and refuses to stamp it.
  assert.equal(createStrings({ loaded: partial, locale: "en" }).get("Hi"), "hello en");

  const { manifest: noFallback } = directoryManifest(["en", "fr"], { omit: "en" });
  await assert.rejects(
    () => loadEntireManifestFromFiles(noFallback, { partialFailure: "allow-partial" }),
    /resolved fallback-locale file is among them/);
});

test("an already-aborted signal stops the load before anything is read", async () => {
  const { manifest } = directoryManifest(["en"]);
  const controller = new AbortController();
  controller.abort();
  const calls = [];
  await assert.rejects(() => loadEntireManifestFromFiles(manifest, {
    signal: controller.signal,
    readFile: async (url) => { calls.push(url); return utf8.encode(bodyFor("en")); },
  }));
  assert.deepEqual(calls, []);
});

// ------------------------------------------------------------- readStringsManifest

test("readStringsManifest accepts a path and a file: URL, and refuses a network one", async () => {
  const { directory, manifest } = directoryManifest(["en", "fr"]);
  const path = join(directory, "strings.manifest.json");
  writeFileSync(path, JSON.stringify(manifest));

  const fromPath = await readStringsManifest(path);
  const fromUrl = await readStringsManifest(pathToFileURL(path));
  assert.deepEqual(fromPath, fromUrl);
  assert.equal(fromPath.catalogFingerprint, manifest.catalogFingerprint);

  await assert.rejects(() => readStringsManifest("https://cdn.example/strings.manifest.json"),
    /reads a filesystem path or a `file:` URL/);
  // The remedy is named, because the alternative is a real one the plan points at.
  await assert.rejects(() => readStringsManifest("https://cdn.example/m.json"), /parseStringsManifest/);
});

test("readStringsManifest is bounded by the same byte limit a catalog is", async () => {
  const { directory, manifest } = directoryManifest(["en"]);
  const path = join(directory, "big.manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  await assert.rejects(() => readStringsManifest(path, { limits: { maximumInputBytes: 32 } }),
    /manifest is \d+ bytes, over the maximum of 32/);
});

test("a manifest read from disk loads through the same door it describes", async () => {
  const { directory, manifest } = directoryManifest(["en", "fr"]);
  const path = join(directory, "strings.manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  const loaded = await loadEntireManifestFromFiles(await readStringsManifest(path));
  assert.equal(createStrings({ loaded, locale: "fr" }).get("Hi"), "hello fr");
});

// ------------------------------------------------------------- the two doors agree

test("the file door and the Fetch door produce the SAME result from the same manifest", async () => {
  // **AN INTERNAL CONSISTENCY CHECK, not external evidence.** Both doors drive one runner, so this
  // proves the two transports deliver the same bytes and classify them the same way — it says
  // nothing about whether the shared rules are right. What it WOULD catch is a transport that
  // reordered, renamed or re-staged anything, which is the whole risk of adding a second one.
  const { manifest } = directoryManifest(["fr", "en", "de"]);
  const viaFiles = await loadEntireManifestFromFiles(manifest);
  const viaFetch = await loadEntireManifest(manifest, {
    fetch: async (/** @type {string} */ url) => {
      const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
      let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({
        read: async () => (sent ? { done: true } : (sent = true, { done: false, value: utf8.encode(bodyFor(tag)) })),
        cancel: async () => {},
      }) } };
    },
  });

  for (const field of ["requestedFiles", "catalogIdentity", "manifestLocaleConfiguration", "coverage", "complete"])
    assert.deepEqual(/** @type {any} */ (viaFiles)[field], /** @type {any} */ (viaFetch)[field], field);
  assert.deepEqual(Object.keys(viaFiles.catalogs), Object.keys(viaFetch.catalogs));

  // And the identical lookup subset, where the plan is a candidate walk rather than a sort.
  const subsetFiles = await loadStringsFromFiles(manifest, "fr-BE");
  const subsetFetch = await loadStrings(manifest, "fr-BE", {
    fetch: async (/** @type {string} */ url) => {
      const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
      let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({
        read: async () => (sent ? { done: true } : (sent = true, { done: false, value: utf8.encode(bodyFor(tag)) })),
        cancel: async () => {},
      }) } };
    },
  });
  assert.deepEqual(subsetFiles.requestedFiles, subsetFetch.requestedFiles);
  assert.deepEqual(subsetFiles.coverage, subsetFetch.coverage);
});
