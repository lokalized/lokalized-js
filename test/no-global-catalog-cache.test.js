// @ts-check
/**
 * Clause 32 — "There is NO hidden process-global or browser-global catalog cache."
 * (IMPLEMENTATION-PLAN-v7.md:2101; the same prohibition as a scope exclusion at plan 1.3:69.)
 *
 * **WHY THE OBVIOUS PROBE FAILS.** The obvious probe loads twice and compares the two results — and
 * it is green over every cache in the enumeration below, because a correct loader and a cached one
 * return byte-identical `LoadedStrings` content. That is this project's first standing lesson in its
 * purest form: both arms of "have I served this before" are REACHED, and the observation does not
 * differ. So nothing here asserts on a result alone. The observations that do differ between the
 * arms are (a) a ledger at the INJECTED TRANSPORT, (b) the CONTENT of a second load after the bytes
 * at one URL changed, (c) the SHAPE of `globalThis` and of every ambient host the loader touches,
 * (d) COLLECTABILITY after the caller drops the record, and (e) INSTANCE IDENTITY out of
 * `createStrings`.
 *
 * **THE CLAUSE IS A UNIVERSAL NEGATIVE AND THIS FILE DOES NOT PROVE IT.** It falsifies an ENUMERATED
 * family: a module-scoped cache in the shared runner, a global own property, a registered-symbol
 * global, a property hung off an ambient host, a CacheStorage behind the DEFAULT transport, a
 * retained-but-unread map, a per-file-name memo in the raw directory door, a cache that crosses two
 * installed copies, and a compiled-instance cache in core keyed by either catalog version or catalog
 * fingerprint. A ledger entry resting on this file should read PROVEN AGAINST THAT ENUMERATION and
 * carry it; "proven" unqualified would be the fourth text in this project to assert more than it
 * measured. What is NOT probed here is recorded in the deliverable's `deferred`, not hidden.
 *
 * **THE ONE MEMOIZATION THE PLAN PERMITS IS OUT OF SCOPE ON PURPOSE.** Plan 2.2:150-157 allows a
 * per-`Strings` candidate-chain LRU of at most 256 entries and says disabling it is equally
 * conforming. Nothing below observes chain reuse: the retention probe takes its handle on
 * `loaded.catalogs[tag]`, never on a chain entry. Widening any of this to "nothing is retained"
 * would turn a permitted optimization into a false red.
 *
 * **SCOPE READINGS THAT ARE THE MAINTAINER'S, recorded rather than decided.** (1) Whether an
 * in-flight COALESCER — which retains no catalog after settling — violates :2101 is not settled by
 * the plain text, so the concurrency arm below MEASURES and REPORTS and does not gate. (2) Whether
 * handing two callers the SAME compiled `Strings` violates it is a reading too: plan :717/:963 say
 * correctness never DEPENDS ON singleton identity, which forbids depending on it rather than sharing
 * it. The two `createStrings` tests take the reading that a compiled catalog served from hidden
 * shared state is the clause's harm (stale translations), and say so here so a later reader is not
 * handed a verdict as if it were the plain text.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The hosts a cache could be hung off without ever appearing as a NEW global name.
 *
 * The single-host version of this check (`globalThis.crypto` alone) reported green over
 * `(globalThis.fetch.__lokalizedCatalogs__ ??= new Map()).set(url, bytes)` — the reference identity
 * is unchanged, no global name is added, and the property lives one level down. Every host the
 * loader actually touches is therefore enumerated, and the residue (a host not on this list) is
 * recorded as unproven rather than claimed.
 */
const HOSTS = [
  "fetch", "Response", "Request", "Headers", "crypto", "crypto.subtle", "navigator",
  "caches", "localStorage", "sessionStorage", "indexedDB", "Object", "Map", "Promise", "JSON",
];

/** @param {string} path @returns {any} */
const hostAt = (path) =>
  path.split(".").reduce((value, key) => (value == null ? value : value[key]), /** @type {any} */ (globalThis));

/** @param {any} value */
const ownKeys = (value) => ({
  names: Object.getOwnPropertyNames(value).sort(),
  symbols: Object.getOwnPropertySymbols(value).map(String).sort(),
});

/** The shape of the global object and of every ambient host, as one comparable value. */
function globalSnapshot() {
  /** @type {Record<string, { reference: any, keys: { names: string[], symbols: string[] } }>} */
  const hosts = {};
  for (const path of HOSTS) {
    const value = hostAt(path);
    if (value === null || value === undefined) continue;
    hosts[path] = { reference: value, keys: ownKeys(value) };
  }
  return { root: ownKeys(globalThis), hosts };
}

// TAKEN BEFORE ANY LIBRARY MODULE IS EVALUATED, which is why every import below is dynamic: static
// imports are hoisted, so a module that installed a global at evaluation time would already have
// done it by the time a statically-ordered snapshot ran.
const GLOBALS_BEFORE = globalSnapshot();
const REAL_FETCH_DESCRIPTOR = /** @type {PropertyDescriptor} */ (
  Object.getOwnPropertyDescriptor(globalThis, "fetch"));

const { computeCatalogIdentity } = await import("../src/load/index.js");
const { catalogIdentityInputFor } = await import("../src/load/identity.js");
const { decode: pinnedProvenance } = await import("../src/data/provenance.js");
const { loadEntireManifest, loadStrings } = await import("../src/load/fetch-loader.js");
const { createStrings } = await import("../src/core/index.js");
const {
  loadEntireManifestFromFiles, loadStringsFromDirectory, loadStringsFromFiles, readStringsFromDirectory,
} = await import("../src/node/index.js");

/**
 * The exported functions are hosts too — `loadStrings.__cache__` is as hidden as a global one, and
 * is not covered by the `globalThis` delta. Snapshotted after import and before any load, which is
 * the only window in which "before" means anything for an object the import itself creates.
 */
const FUNCTION_HOSTS = /** @type {[string, Function][]} */ ([
  ["loadStrings", loadStrings], ["loadEntireManifest", loadEntireManifest],
  ["loadStringsFromFiles", loadStringsFromFiles],
  ["loadEntireManifestFromFiles", loadEntireManifestFromFiles],
  ["loadStringsFromDirectory", loadStringsFromDirectory],
  ["readStringsFromDirectory", readStringsFromDirectory], ["createStrings", createStrings],
]);
const FUNCTION_HOSTS_BEFORE = FUNCTION_HOSTS.map(([name, value]) => [name, ownKeys(value)]);

/**
 * Global keys a load is ALLOWED to add, each with a written reason.
 *
 * EMPTY TODAY, and the loop below fails on a STALE entry as well as on an unlisted one — this
 * project has three known-gap lists that rotted into lists of excuses, and the rule since is that a
 * list which cannot go stale is not a list.
 *
 * @type {{ key: string, reason: string }[]}
 */
const EXPECTED_GLOBAL_DELTA = [];

const ROOT = new URL("../", import.meta.url);
const SOURCE_ROOT = fileURLToPath(new URL("src/", ROOT));
const utf8 = new TextEncoder();

/** An INDEPENDENT digest oracle: the fixture must not be derived from the code it arbitrates. */
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash("sha256").update(bytes).digest("hex");

const bodyFor = (/** @type {string} */ greeting) => JSON.stringify({ Greeting: greeting });

const scratch = mkdtempSync(join(tmpdir(), "lokalized-clause32-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh directory under this file's scratch root. */
const directoryOf = (/** @type {Record<string, string>} */ files) => {
  const directory = mkdtempSync(join(scratch, "dir-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
  return directory;
};

/**
 * A manifest over the given bodies, NOT frozen.
 *
 * Deliberately mutable: a per-manifest cache property is only INSTALLABLE on an extensible object,
 * so freezing the fixture would make the own-property assertion in the first test decoration — under
 * ESM strict mode the write would throw instead of landing, and an assertion that cannot fail is
 * worse than none.
 *
 * Every test uses its own `catalogVersion` and its own `baseUrl` path segment, so a URL-keyed or
 * version-keyed cache cannot carry state from one test's fixture into another's and turn an
 * unrelated test red — which would make an ablation's report unreadable.
 *
 * @param {{ baseUrl: string, catalogVersion: string, fallbackLocale?: string,
 *   entries: Record<string, { url: string, text: string }> }} spec
 */
function manifestFor(spec) {
  /** @type {Record<string, { url: string, sha256: string, decodedBytes: number }>} */
  const files = {};
  for (const [tag, entry] of Object.entries(spec.entries)) {
    const bytes = utf8.encode(entry.text);
    files[tag] = { url: entry.url, sha256: sha256(bytes), decodedBytes: bytes.length };
  }
  const draft = {
    formatVersion: 1,
    catalogVersion: spec.catalogVersion,
    catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion,
    dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: spec.fallbackLocale ?? "en",
    baseUrl: spec.baseUrl,
    files,
    tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/** A `Response`-shaped answer whose body streams once. */
function responseOf(/** @type {string} */ text) {
  const bytes = utf8.encode(text);
  let sent = false;
  return {
    ok: true, status: 200,
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }),
    },
  };
}

/**
 * An injected fetch that records EVERY absolute URL it is asked for.
 *
 * The ledger is the whole instrument: it holds href STRINGS and never a `Response`, so the probe
 * itself cannot be what retains a catalog in the collectability arm.
 *
 * @param {(href: string, callIndex: number) => string | undefined} bodyAt
 */
function countingFetch(bodyAt) {
  /** @type {string[]} */
  const calls = [];
  const impl = async (/** @type {any} */ input) => {
    const href = new URL(typeof input === "string" ? input : input.url).href;
    const index = calls.length;
    calls.push(href);
    const text = bodyAt(href, index);
    if (text === undefined) throw new Error(`the probe has no body for ${href} (call ${index})`);
    return responseOf(text);
  };
  return { impl, calls };
}

/**
 * An injected `readFile` that serves the REAL bytes on disk.
 *
 * Reading through to the filesystem rather than answering from a table is what keeps a red
 * attributable: the directory door hashes the bytes on disk during generation and verifies that
 * digest during the load, so a stub whose bodies disagreed with the files would reject every load at
 * stage `digest` and the ledger assertion would never be reached.
 */
function countingReader() {
  /** @type {string[]} */
  const reads = [];
  const impl = async (/** @type {string} */ url) => {
    reads.push(url);
    return new Uint8Array(readFileSync(fileURLToPath(url)));
  };
  return { impl, reads };
}

/** The translation a parsed catalog carries, read the same way on both sides of a comparison. */
function translationIn(/** @type {any} */ catalog, key = "Greeting") {
  const entry = catalog?.strings?.find((/** @type {any} */ s) => s.key === key);
  assert.ok(entry, `the parsed catalog carries no '${key}'; the fixture, not the loader, is wrong`);
  return entry.translation;
}

/** A copy of `src/` imported through its own URL: a genuinely separate module graph. */
function realmOf(/** @type {string} */ name) {
  const directory = mkdtempSync(join(scratch, `realm-${name}-`));
  cpSync(fileURLToPath(new URL("src/", ROOT)), join(directory, "src"), { recursive: true });
  return {
    directory,
    import: (/** @type {string} */ path) => import(pathToFileURL(join(directory, "src", path)).href),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 2));

/* ------------------------------------------------------------------------------------------------
 * The ablation-reach precondition.
 * ---------------------------------------------------------------------------------------------- */

test("every manifest door routes through the one shared plan runner", () => {
  // WHY THIS IS HERE AND NOT IN A COMMENT. The re-acquisition tests below cover three doors, and a
  // single cache planted in the shared runner is what makes one mutation reach all three. A tester
  // who assumed that without checking would report an arm as ablated when the mutation never ran in
  // it — "an arm whose counters stay 0 has not been ablated, and its green is NOT evidence".
  // Derived, never listed: a hard-coded list of importers is defeated by a byte-copy of the module.
  const files = readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => join(entry.parentPath, entry.name));
  const importers = files
    .filter((file) => /from "[^"]*\/run-plan\.js"/.test(readFileSync(file, "utf8")))
    .map((file) => relative(SOURCE_ROOT, file).split("\\").join("/"))
    .sort();
  assert.deepEqual(importers, ["load/fetch-loader.js", "node/file-loader.js"],
    "the runner's importers moved; the ablations aimed at run-plan.js may no longer reach every door");

  const exportsIn = (/** @type {string} */ file) => readFileSync(join(SOURCE_ROOT, file), "utf8");
  const browserDoor = exportsIn("load/fetch-loader.js");
  const nodeDoor = exportsIn("node/file-loader.js");
  for (const name of ["loadStrings", "loadEntireManifest"])
    assert.match(browserDoor, new RegExp(`export async function ${name}\\(`), `${name} left the Fetch door`);
  for (const name of ["loadStringsFromFiles", "loadEntireManifestFromFiles", "loadStringsFromDirectory"])
    assert.match(nodeDoor, new RegExp(`export async function ${name}\\(`), `${name} left the Node door`);
});

/* ------------------------------------------------------------------------------------------------
 * C1a — the re-acquisition ledger, at every door.
 * ---------------------------------------------------------------------------------------------- */

test("a second Fetch load of the same manifest acquires every planned file again", async () => {
  const base = "https://cdn.example/c32-fetch-ledger/";
  const m = manifestFor({
    baseUrl: base, catalogVersion: "c32.fetch-ledger",
    entries: { fr: { url: "fr.json", text: bodyFor("FR-ALPHA") }, en: { url: "en.json", text: bodyFor("EN-ALPHA") } },
  });
  // `fr-CA` so the plan is two files in first-use order (fr, then the fallback en) rather than the
  // degenerate one-file plan, which cannot show a dedup-shaped cache at all.
  const before = ownKeys(m);
  const stub = countingFetch((href) => (href.endsWith("fr.json") ? bodyFor("FR-ALPHA") : bodyFor("EN-ALPHA")));

  const first = await loadStrings(m, "fr-CA", { fetch: stub.impl });
  const afterFirst = stub.calls.slice();

  // THE CONTROL, and it is load-bearing rather than ceremonial: a manifest refused at validation
  // acquires nothing, and a bare ratio assertion would then be satisfied by 0 === 2 * 0 and pass
  // vacuously. Pinning the FIRST count at 2 is what converts that into a named red.
  assert.equal(first.complete, true);
  assert.deepEqual(first.failures, []);
  assert.deepEqual(afterFirst, [`${base}fr.json`, `${base}en.json`],
    "the first load must acquire both planned files, or nothing below is measuring a cache");
  assert.equal(createStrings({ loaded: first, locale: "fr-CA" }).get("Greeting"), "FR-ALPHA");

  const second = await loadStrings(m, "fr-CA", { fetch: stub.impl });

  // THE DISCRIMINATING OBSERVATION. Both results are byte-identical in content, so every assertion
  // on `second` is blind to the defect; the ledger is the only thing that differs between a loader
  // that re-acquires and one that serves from a cache at any scope above the injected transport.
  assert.equal(stub.calls.length, 4,
    `expected 4 acquisitions across two loads, saw ${stub.calls.length}: ${stub.calls.join(", ")}`);
  assert.deepEqual(stub.calls.slice(2), afterFirst, "the second load repeats the first load's plan exactly");
  assert.equal(createStrings({ loaded: second, locale: "fr-CA" }).get("Greeting"), "FR-ALPHA");

  // THE SAME MANIFEST OBJECT WAS REUSED, deliberately: it is the worst case for detection, because a
  // cache keyed on manifest identity (a WeakMap) only ever hits when the object is reused. And since
  // the fixture is extensible, a per-manifest cache PROPERTY would land rather than throw.
  assert.equal(Object.isFrozen(m), false, "a frozen fixture would make the next assertion decoration");
  assert.deepEqual(ownKeys(m), before, "a cache was hung off the caller's manifest object");
});

test("the whole-manifest doors re-acquire on a second load too", async () => {
  // S10's seam, one layer over: the whole-manifest planner is a DIFFERENT function from the
  // lookup-subset planner (plan 6.2:2110 gives it normalized-tag order, not fetchSet order), and a
  // memo installed in it alone leaves every lookup-subset probe green.
  const base = "https://cdn.example/c32-whole/";
  const entries = { fr: { url: "fr.json", text: bodyFor("FR-WHOLE") }, en: { url: "en.json", text: bodyFor("EN-WHOLE") } };
  const m = manifestFor({ baseUrl: base, catalogVersion: "c32.whole", entries });
  const stub = countingFetch((href) => (href.endsWith("fr.json") ? bodyFor("FR-WHOLE") : bodyFor("EN-WHOLE")));

  const first = await loadEntireManifest(m, { fetch: stub.impl });
  assert.equal(first.complete, true);
  assert.equal(stub.calls.length, 2, "the first whole-manifest load must acquire both files");

  await loadEntireManifest(m, { fetch: stub.impl });
  assert.equal(stub.calls.length, 4, `whole-manifest re-acquisition: saw ${stub.calls.length} of 4`);

  const directory = directoryOf({ "fr.json": bodyFor("FR-WHOLE"), "en.json": bodyFor("EN-WHOLE") });
  const fileManifest = manifestFor({
    baseUrl: pathToFileURL(`${directory}/`).href, catalogVersion: "c32.whole-files", entries,
  });
  const reader = countingReader();
  const firstFiles = await loadEntireManifestFromFiles(fileManifest, { readFile: reader.impl });
  assert.equal(firstFiles.complete, true);
  assert.equal(reader.reads.length, 2, "the first whole-manifest file load must read both files");
  await loadEntireManifestFromFiles(fileManifest, { readFile: reader.impl });
  assert.equal(reader.reads.length, 4, `whole-manifest file re-acquisition: saw ${reader.reads.length} of 4`);
});

test("a second Node file load acquires every planned file again", async () => {
  const directory = directoryOf({ "fr.json": bodyFor("FR-FILES"), "en.json": bodyFor("EN-FILES") });
  const m = manifestFor({
    baseUrl: pathToFileURL(`${directory}/`).href, catalogVersion: "c32.files",
    entries: { fr: { url: "fr.json", text: bodyFor("FR-FILES") }, en: { url: "en.json", text: bodyFor("EN-FILES") } },
  });
  const reader = countingReader();

  const first = await loadStringsFromFiles(m, "fr-CA", { readFile: reader.impl });
  assert.equal(first.complete, true);
  assert.deepEqual(first.failures, []);
  assert.equal(reader.reads.length, 2, "the first file load must read both planned files");
  assert.equal(createStrings({ loaded: first, locale: "fr-CA" }).get("Greeting"), "FR-FILES");

  await loadStringsFromFiles(m, "fr-CA", { readFile: reader.impl });
  assert.equal(reader.reads.length, 4,
    `expected 4 reads across two loads, saw ${reader.reads.length}: ${reader.reads.join(", ")}`);
});

test("a second directory load acquires every planned file again", async () => {
  // The composed door: it regenerates its internal manifest per call (plan 6.2:2119-2126) and then
  // whole-loads it. The injected reader serves the LOAD half only — the generation half is a
  // directory scan no per-URL reader can express — so the expected count is one read per file per
  // call, and a cache anywhere above the reader shows up as a shortfall just the same.
  const directory = directoryOf({ "fr.json": bodyFor("FR-DIR"), "en.json": bodyFor("EN-DIR") });
  const reader = countingReader();
  const options = { catalogVersion: "c32.dir", fallbackLocale: "en", readFile: reader.impl };

  const first = await loadStringsFromDirectory(directory, options);
  assert.equal(first.complete, true);
  assert.equal(reader.reads.length, 2, "the first directory load must read both catalogs");
  assert.equal(createStrings({ loaded: first, locale: "fr" }).get("Greeting"), "FR-DIR");

  await loadStringsFromDirectory(directory, options);
  assert.equal(reader.reads.length, 4,
    `expected 4 reads across two directory loads, saw ${reader.reads.length}`);
});

test("two lookup locales over one manifest do not serve each other's catalogs", async () => {
  // Plan 6.2:2924 names cache separation and cross-locale cross-talk in one breath. Every other
  // probe in this file loads ONE lookup locale, so a cache keyed on the MANIFEST rather than on the
  // URL — which hands the second caller the first caller's whole record — would show up in them only
  // as a count, never as the wrong language. Here the observation is both.
  const base = "https://cdn.example/c32-locales/";
  /** @type {Record<string, { url: string, text: string }>} */
  const entries = {
    fr: { url: "fr.json", text: bodyFor("FR-CROSS") },
    de: { url: "de.json", text: bodyFor("DE-CROSS") },
    en: { url: "en.json", text: bodyFor("EN-CROSS") },
  };
  const m = manifestFor({ baseUrl: base, catalogVersion: "c32.cross-locale", entries });
  const stub = countingFetch((href) => entries[/** @type {string} */ (href.split("/").pop()).replace(".json", "")]?.text);

  const french = await loadStrings(m, "fr-CA", { fetch: stub.impl });
  assert.deepEqual(Object.keys(french.catalogs).sort(), ["en", "fr"]);
  assert.deepEqual(stub.calls, [`${base}fr.json`, `${base}en.json`]);
  assert.equal(createStrings({ loaded: french, locale: "fr-CA" }).get("Greeting"), "FR-CROSS");

  const german = await loadStrings(m, "de-AT", { fetch: stub.impl });
  assert.deepEqual(Object.keys(german.catalogs).sort(), ["de", "en"],
    "the second lookup was handed the first lookup's catalog set");
  assert.equal(createStrings({ loaded: german, locale: "de-AT" }).get("Greeting"), "DE-CROSS");
  // The fallback file is in BOTH plans, so this is also the one assertion in the file that would
  // catch a cache serving one locale's load from another's rather than from an earlier identical one.
  assert.deepEqual(stub.calls.slice(2), [`${base}de.json`, `${base}en.json`],
    "the fallback catalog was deduplicated ACROSS two loads with different lookups");
});

/* ------------------------------------------------------------------------------------------------
 * C1b — the DEFAULT transport, which no injected-fetch probe can see.
 * ---------------------------------------------------------------------------------------------- */

test("the DEFAULT transport re-acquires, and never consults a CacheStorage that exists", async () => {
  // **A PROBE SPACE DERIVED FROM THE INJECTABLE OPTION IS BLIND TO THE NON-INJECTED PATH.** The
  // cache a real author ships is `options.fetch ?? cachedFetch` — safe, they reason, because the
  // tests inject a fetch. Every ledger test above stays green over it. So this arm passes NO options
  // at all and watches the ambient boundary instead.
  //
  // The module is imported from a COPY of `src/` so that its evaluation genuinely follows the stub
  // installation; sharing this file's already-evaluated modules would make an import-time capture of
  // `globalThis.fetch` show up as an unexplained zero instead of as the named red below.
  const realm = realmOf("default-transport");
  const base = "https://cdn.example/c32-default/";
  const m = manifestFor({
    baseUrl: base, catalogVersion: "c32.default",
    entries: { fr: { url: "fr.json", text: bodyFor("FR-DEFAULT") }, en: { url: "en.json", text: bodyFor("EN-DEFAULT") } },
  });
  const stub = countingFetch((href) => (href.endsWith("fr.json") ? bodyFor("FR-DEFAULT") : bodyFor("EN-DEFAULT")));

  /**
   * A FULLY FUNCTIONAL, INERT CacheStorage that records every property read.
   *
   * Nothing here throws, and that is the repair that makes the observation mean something: a stub
   * whose `open` threw would turn the ablated run red at stage `fetch`, where a red caused by the
   * probe's own instrument cannot be told apart from a red caused by a broken fixture. Inert and
   * always-missing is also the COLD-cache case, which is the one case a call count cannot see — a
   * cold cache misses, so the counts stay at 4 and only this ledger moves.
   */
  /** @type {string[]} */
  const touched = [];
  const cacheObject = new Proxy(/** @type {any} */ ({
    match: async () => undefined, put: async () => undefined, add: async () => undefined,
    addAll: async () => undefined, delete: async () => false, keys: async () => [],
  }), { get(target, property) { touched.push(`cache.${String(property)}`); return target[property]; } });
  const cacheStorage = new Proxy(/** @type {any} */ ({
    open: async () => cacheObject, match: async () => undefined, has: async () => false,
    keys: async () => [], delete: async () => false,
  }), { get(target, property) { touched.push(String(property)); return target[property]; } });

  Object.defineProperty(globalThis, "fetch", { value: stub.impl, configurable: true, writable: true });
  Object.defineProperty(globalThis, "caches", { value: cacheStorage, configurable: true, writable: true });
  try {
    const door = await realm.import("load/fetch-loader.js");
    const first = await door.loadStrings(m, "fr-CA");

    assert.equal(first.complete, true);
    assert.equal(stub.calls.length, 2,
      "the ambient fetch was not reached twice; a loader that captured it at import time reads 0 here");

    await door.loadStrings(m, "fr-CA");
    assert.equal(stub.calls.length, 4,
      `expected 4 ambient acquisitions across two loads, saw ${stub.calls.length}`);
    assert.deepEqual(touched, [],
      `the loader consulted a browser CacheStorage: ${touched.join(", ")}`);
  } finally {
    Object.defineProperty(globalThis, "fetch", REAL_FETCH_DESCRIPTOR);
    delete (/** @type {any} */ (globalThis).caches);
  }
});

/* ------------------------------------------------------------------------------------------------
 * C2 — content mutation: the only instrument that separates a stale PARSE from a stale BYTE.
 * ---------------------------------------------------------------------------------------------- */

test("changed bytes at one URL are observed by the next Fetch load, not served stale", async () => {
  // The two bodies differ in LENGTH as well as in digest, deliberately, so the two cache shapes
  // produce two DISTINGUISHABLE reds: a parsed-catalog cache renders "ALPHA" with `complete: true`
  // and no failures (a silent stale answer), while a bytes cache above the digest check rejects at
  // stage `limit` or `digest`. Same-length bodies would collapse that into one ambiguous rejection.
  const base = "https://cdn.example/c32-content/";
  const alpha = bodyFor("ALPHA");
  const bravo = bodyFor("BRAVO-BRAVO");
  const a = manifestFor({
    baseUrl: base, catalogVersion: "c32.content.1", entries: { en: { url: "en.json", text: alpha } },
  });
  const b = manifestFor({
    baseUrl: base, catalogVersion: "c32.content.2", entries: { en: { url: "en.json", text: bravo } },
  });

  // **THE B-CONTROL, and it is the repair that keeps a red attributable.** Manifest B carries three
  // hand-coordinated fields (`sha256`, `decodedBytes`, and a fingerprint recomputed over them); if
  // any of them is wrong, plan 6.2:2072-2074 refuses it with a thrown `ConfigurationError` before a
  // per-file plan exists — and the staleness assertion below would be red for a reason with nothing
  // to do with caching. So B is first loaded at a URL the staleness sequence never touches.
  const bControl = manifestFor({
    baseUrl: base, catalogVersion: "c32.content.2", entries: { en: { url: "en-control.json", text: bravo } },
  });
  const controlStub = countingFetch(() => bravo);
  const controlLoad = await loadStrings(bControl, "en", { fetch: controlStub.impl });
  assert.equal(controlLoad.complete, true, "manifest B is malformed; the staleness arm below cannot be read");
  assert.equal(createStrings({ loaded: controlLoad, locale: "en" }).get("Greeting"), "BRAVO-BRAVO");

  // Scripted by CALL INDEX rather than by URL, so the stub itself cannot be what deduplicates.
  const stub = countingFetch((_href, index) => (index === 0 ? alpha : bravo));
  const first = await loadStrings(a, "en", { fetch: stub.impl });
  assert.equal(createStrings({ loaded: first, locale: "en" }).get("Greeting"), "ALPHA");

  const second = await loadStrings(b, "en", { fetch: stub.impl }).then((value) => value, (error) => error);
  assert.ok(!(second instanceof Error),
    `the second load rejected — a cache ABOVE the digest check serves bytes the new manifest does not ` +
    `describe: ${second instanceof Error ? second.message : ""} ` +
    `${JSON.stringify(/** @type {any} */ (second)?.failures?.map((/** @type {any} */ f) => [f.stage, f.url]))}`);
  assert.deepEqual(second.failures, []);
  assert.equal(second.complete, true);
  assert.equal(createStrings({ loaded: second, locale: "en" }).get("Greeting"), "BRAVO-BRAVO",
    "the second load served the FIRST load's catalog: a stale answer with no failure to show for it");
});

test("the directory door observes a catalog rewritten between two loads", async () => {
  // The strongest form of the content instrument, because it uses the REAL filesystem with no
  // injection anywhere: the internal manifest is regenerated per call, so the digest follows the
  // bytes and no manifest surgery is needed to make the second load legitimate.
  const directory = directoryOf({ "en.json": bodyFor("ALPHA") });
  const options = { catalogVersion: "c32.dir-content", fallbackLocale: "en" };

  const first = await loadStringsFromDirectory(directory, options);
  assert.equal(first.complete, true);
  assert.equal(createStrings({ loaded: first, locale: "en" }).get("Greeting"), "ALPHA");

  writeFileSync(join(directory, "en.json"), bodyFor("BRAVO-BRAVO"));
  const second = await loadStringsFromDirectory(directory, options).then((value) => value, (error) => error);
  assert.ok(!(second instanceof Error),
    `the second directory load rejected: ${second instanceof Error ? second.message : ""}`);
  assert.equal(second.complete, true);
  assert.equal(createStrings({ loaded: second, locale: "en" }).get("Greeting"), "BRAVO-BRAVO",
    "the second directory load served the first load's catalog");
});

test("readStringsFromDirectory observes rewritten bytes, and two directories do not share a catalog", () => {
  // The Java-ported door: synchronous, no manifest, no digest and NO injectable reader, so content
  // mutation is its only anti-cache instrument. It has no digest stage either, so what it
  // discriminates is exactly the PARSED/returned-object family — not the bytes family arms 1 and 2
  // carry, and it should not be credited with that.
  const directory = directoryOf({ "en.json": bodyFor("ALPHA") });
  const first = readStringsFromDirectory(directory);
  assert.equal(translationIn(first.catalogs.en), "ALPHA");

  writeFileSync(join(directory, "en.json"), bodyFor("BRAVO-BRAVO"));
  const second = readStringsFromDirectory(directory);
  assert.equal(translationIn(second.catalogs.en), "BRAVO-BRAVO",
    "the second read served the first read's catalog");
  assert.notEqual(first.catalogs.en, second.catalogs.en,
    "a memo returned the same catalog object; the rendered text may converge, the identity may not");

  // A SECOND DIRECTORY WITH THE SAME FILE NAME. This is the input that catches a memo keyed on the
  // file name or the locale tag rather than on the absolute path — one directory cannot show the
  // difference, so no amount of re-reading the first one would do.
  //
  // "OMEGA" IS THE SAME LENGTH AS "ALPHA" ON PURPOSE. A memo keyed on name AND size — the cheap
  // staleness heuristic an author writes instead of stat'ing — survives the rewrite above (the two
  // bodies differ in length) and is caught only here. Picking a different-length body would collapse
  // this arm back into the one before it and leave that whole cache shape unprobed.
  const other = directoryOf({ "en.json": bodyFor("OMEGA") });
  const third = readStringsFromDirectory(other);
  assert.equal(translationIn(third.catalogs.en), "OMEGA",
    "a second directory's 'en.json' was answered from the first directory's");
});

/* ------------------------------------------------------------------------------------------------
 * C3 — the SHAPE of the global object, which is the only probe a write-only cache moves.
 * ---------------------------------------------------------------------------------------------- */

test("loading installs no property on globalThis or on any ambient host it uses", async () => {
  // **THE ONLY CONJUNCT THAT CATCHES A RETAINED-BUT-UNREAD CACHE ON A GLOBAL.** A write-only
  // registry — the shape a debugging hook takes right before someone turns it into a read — leaves
  // every behavioural probe in this file green: the counts are right, the content is right, the
  // realms agree. What it changes is the shape of `globalThis`, so that is what is asserted.
  const base = "https://cdn.example/c32-globals/";
  const entries = { fr: { url: "fr.json", text: bodyFor("FR-GLOBAL") }, en: { url: "en.json", text: bodyFor("EN-GLOBAL") } };
  const m = manifestFor({ baseUrl: base, catalogVersion: "c32.globals", entries });
  const stub = countingFetch((href) => (href.endsWith("fr.json") ? bodyFor("FR-GLOBAL") : bodyFor("EN-GLOBAL")));

  // THE CONTROL. A load that threw at validation touches nothing and yields a clean delta — a green
  // that proves the opposite of what this test claims. Both doors must complete and render.
  const fetched = await loadStrings(m, "fr-CA", { fetch: stub.impl });
  assert.equal(fetched.complete, true);
  assert.equal(createStrings({ loaded: fetched, locale: "fr-CA" }).get("Greeting"), "FR-GLOBAL");

  const directory = directoryOf({ "fr.json": bodyFor("FR-GLOBAL"), "en.json": bodyFor("EN-GLOBAL") });
  const read = await loadStringsFromDirectory(directory, { catalogVersion: "c32.globals-dir", fallbackLocale: "en" });
  assert.equal(read.complete, true);
  assert.equal(createStrings({ loaded: read, locale: "fr" }).get("Greeting"), "FR-GLOBAL");

  const after = globalSnapshot();
  const allowed = new Set(EXPECTED_GLOBAL_DELTA.map((entry) => entry.key));
  const addedNames = after.root.names.filter((name) => !GLOBALS_BEFORE.root.names.includes(name));
  const addedSymbols = after.root.symbols.filter((symbol) => !GLOBALS_BEFORE.root.symbols.includes(symbol));

  assert.deepEqual(addedNames.filter((name) => !allowed.has(name)), [],
    `loading installed global propert(ies): ${addedNames.join(", ")}`);
  assert.deepEqual(addedSymbols.filter((symbol) => !allowed.has(symbol)), [],
    `loading installed global symbol(s): ${addedSymbols.join(", ")}`);
  // THE STALENESS HALF: an allowlist that cannot go stale is a list of excuses, not a list.
  for (const entry of EXPECTED_GLOBAL_DELTA)
    assert.ok([...addedNames, ...addedSymbols].includes(entry.key),
      `EXPECTED_GLOBAL_DELTA names '${entry.key}' (${entry.reason}), which no longer appears`);

  // AND ONE LEVEL DOWN. `after.fetch === before.fetch` is true of a host that had a Map hung off it,
  // which is why identity alone was not enough; the own-key lists are what move.
  for (const [path, before] of Object.entries(GLOBALS_BEFORE.hosts)) {
    const now = after.hosts[path];
    assert.ok(now, `the ambient host '${path}' disappeared during the run`);
    assert.equal(now.reference, before.reference, `the ambient '${path}' was replaced`);
    assert.deepEqual(now.keys, before.keys, `a property was hung off the ambient '${path}'`);
  }
  for (const [name, value] of FUNCTION_HOSTS) {
    const before = FUNCTION_HOSTS_BEFORE.find(([candidate]) => candidate === name);
    assert.ok(before, `no 'before' snapshot for the exported '${name}'`);
    assert.deepEqual(ownKeys(value), before[1], `a property was hung off the exported '${name}'`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * C4 — two installed copies, which is what "process-global" literally means.
 * ---------------------------------------------------------------------------------------------- */

test("two module realms do not serve each other's catalogs", async () => {
  // The observation is CONTENT, not a count. A count here would be the same red the single-realm
  // ledger already produces and would carry no attribution: under a module-scoped cache realm B has
  // its own empty map and stays correct, while under a true global one B is served realm A's bytes
  // at the same URL — a red no single-realm probe can produce.
  const realmA = realmOf("a");
  const realmB = realmOf("b");
  const [doorA, coreA] = await Promise.all([realmA.import("load/fetch-loader.js"), realmA.import("core/index.js")]);
  const [doorB, coreB] = await Promise.all([realmB.import("load/fetch-loader.js"), realmB.import("core/index.js")]);

  // TOPOLOGY FIRST — the `ssr-two-realm` precedent. Without it the whole test passes vacuously if
  // the two copies collapse into one module graph.
  assert.notEqual(doorA.loadStrings, doorB.loadStrings, "the two realms are one graph; nothing below means anything");
  assert.notEqual(coreA.createStrings, coreB.createStrings);
  assert.notEqual(doorA.loadStrings, loadStrings, "this file's own modules are a third graph");

  const base = "https://cdn.example/c32-realms/";
  const alpha = bodyFor("ALPHA");
  const bravo = bodyFor("BRAVO-BRAVO");
  const a = manifestFor({ baseUrl: base, catalogVersion: "c32.realm.a", entries: { en: { url: "en.json", text: alpha } } });
  const b = manifestFor({ baseUrl: base, catalogVersion: "c32.realm.b", entries: { en: { url: "en.json", text: bravo } } });
  const stub = countingFetch((_href, index) => (index === 0 ? alpha : bravo));

  const loadedA = await doorA.loadStrings(a, "en", { fetch: stub.impl });
  assert.equal(loadedA.complete, true, "the copied tree does not load; a red below would be about the copy");
  assert.equal(coreA.createStrings({ loaded: loadedA, locale: "en" }).get("Greeting"), "ALPHA");
  assert.equal(stub.calls.length, 1);

  const loadedB = await doorB.loadStrings(b, "en", { fetch: stub.impl }).then((v) => v, (error) => error);
  assert.ok(!(loadedB instanceof Error),
    `realm B rejected — it was served realm A's bytes: ${loadedB instanceof Error ? loadedB.message : ""}`);
  assert.equal(coreB.createStrings({ loaded: loadedB, locale: "en" }).get("Greeting"), "BRAVO-BRAVO",
    "realm B rendered realm A's catalog: the two installed copies share hidden state");
});

/* ------------------------------------------------------------------------------------------------
 * C5 — overlap in time. MEASURED AND REPORTED; the reading is the maintainer's.
 * ---------------------------------------------------------------------------------------------- */

test("concurrent identical loads: measured and reported, not gated", async (t) => {
  // **WHY THIS ARM IS NOT AN ASSERTION.** An in-flight coalescer retains no catalog after settling,
  // so every sequential probe in this file is green over it — only overlapping two loads in time can
  // see it at all. But whether such a registry is a "catalog cache" under :2101 is not settled by
  // the plain text (:2924's "concurrent locales have no cross-talk" is the nearest sentence and is
  // not decisive), and an agent must not pick the reading and then record the clause proven on it.
  // The question for the maintainer, in their own vocabulary: should two simultaneous loads of the
  // same file download it twice, or once?
  //
  // SINGLE-FILE MANIFESTS THROUGHOUT, deliberately. With two planned files per load, a count of 4
  // in flight would require each load to have BOTH acquisitions active at once — and plan 6.2:2087
  // says "at most eight are ACTIVE", a CEILING, not a floor. A loader that acquired its planned
  // files one at a time is conforming and would produce exactly the shortfall this arm would
  // otherwise have blamed on coalescing.
  const base = "https://cdn.example/c32-concurrent/";
  const one = manifestFor({ baseUrl: base, catalogVersion: "c32.conc.1", entries: { en: { url: "en.json", text: bodyFor("EN-ONE") } } });
  const two = manifestFor({ baseUrl: base, catalogVersion: "c32.conc.2", entries: { en: { url: "two.json", text: bodyFor("EN-TWO") } } });

  /** @param {string[]} ledger @param {number} target */
  const waitFor = async (ledger, target) => {
    for (let turn = 0; turn < 100 && ledger.length < target; ++turn) await settle();
    return ledger.length;
  };

  // CONTROL 1 — sequential, ungated: the fixture reaches the transport twice at all.
  const sequential = countingFetch(() => bodyFor("EN-ONE"));
  await loadStrings(one, "en", { fetch: sequential.impl });
  await loadStrings(one, "en", { fetch: sequential.impl });
  assert.equal(sequential.calls.length, 2, "two sequential loads of one file must acquire it twice");

  // CONTROL 2 — two concurrent loads of DIFFERENT files, gated. This proves the gate, the poll and
  // the concurrency all work, so a shortfall in the identical-URL arm cannot be blamed on a stalled
  // gate or on a fixture that never reached the transport.
  /** @type {() => void} */
  let openGate = () => {};
  const gate = new Promise((resolve) => { openGate = () => resolve(undefined); });
  /** @type {string[]} */
  const distinctCalls = [];
  const gatedDistinct = async (/** @type {any} */ input) => {
    const href = new URL(String(input)).href;
    distinctCalls.push(href);
    await gate;
    return responseOf(href.endsWith("two.json") ? bodyFor("EN-TWO") : bodyFor("EN-ONE"));
  };
  const distinctPair = Promise.all([
    loadStrings(one, "en", { fetch: gatedDistinct }),
    loadStrings(two, "en", { fetch: gatedDistinct }),
  ]);
  assert.equal(await waitFor(distinctCalls, 2), 2,
    "two concurrent loads of different files must both reach the transport before either settles");
  openGate();
  for (const loaded of await distinctPair) assert.equal(loaded.complete, true);

  // THE MEASUREMENT — identical URLs, overlapped in time.
  /** @type {() => void} */
  let openSecondGate = () => {};
  const secondGate = new Promise((resolve) => { openSecondGate = () => resolve(undefined); });
  /** @type {string[]} */
  const identicalCalls = [];
  const gatedIdentical = async () => { identicalCalls.push(`${base}en.json`); await secondGate; return responseOf(bodyFor("EN-ONE")); };
  const identicalPair = Promise.all([
    loadStrings(one, "en", { fetch: gatedIdentical }),
    loadStrings(one, "en", { fetch: gatedIdentical }),
  ]);
  const inFlight = await waitFor(identicalCalls, 2);
  openSecondGate();
  const [left, right] = await identicalPair;

  t.diagnostic(`clause 32 / C5 measurement: two simultaneous loads of one URL started ${inFlight} ` +
    `acquisition(s) before either settled (2 = no coalescing, 1 = an in-flight registry served one ` +
    `from the other). RECORDED, NOT GATED — the reading is the maintainer's.`);

  // What IS asserted: both concurrent loads answer correctly whichever reading applies.
  assert.equal(left.complete, true);
  assert.equal(right.complete, true);
  assert.equal(createStrings({ loaded: left, locale: "en" }).get("Greeting"), "EN-ONE");
  assert.equal(createStrings({ loaded: right, locale: "en" }).get("Greeting"), "EN-ONE");
});

/* ------------------------------------------------------------------------------------------------
 * C6 — retention. The residue every behavioural probe above is blind to.
 * ---------------------------------------------------------------------------------------------- */

test("a dropped LoadedStrings is collectable; nothing retains its catalogs", () => {
  // A module-level map that is WRITTEN and never READ is invisible to every count (the transport is
  // still reached), to every content probe (the answer is correct) and to the globals delta (it is
  // not global). Retention is the only observation left, and it needs a forced collection — plan
  // 2.2:152-157 already blesses a forced-GC protocol for the one memoization it permits, so the
  // instrument is the plan's rather than invented.
  //
  // RUN IN A CHILD PROCESS UNDER `--expose-gc`, and it FAILS rather than skips when the flag is
  // unavailable: CI fails on any skip, and a gate that quietly passes when its input is missing has
  // stopped gating. A child also keeps this file's own fixtures out of the measured heap.
  const probe = `
    import { createHash } from "node:crypto";
    import { computeCatalogIdentity } from "${ROOT}src/load/index.js";
    import { catalogIdentityInputFor } from "${ROOT}src/load/identity.js";
    import { decode as pinnedProvenance } from "${ROOT}src/data/provenance.js";
    import { loadStrings } from "${ROOT}src/load/fetch-loader.js";

    if (typeof globalThis.gc !== "function") throw new Error("--expose-gc is required; this probe must fail, never skip");

    const utf8 = new TextEncoder();
    const body = JSON.stringify({ Greeting: "EN-ALPHA" });
    const manifestAt = (base) => {
      const bytes = utf8.encode(body);
      const draft = {
        formatVersion: 1, catalogVersion: "c32.retention", catalogFingerprint: "0".repeat(64),
        cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
        fallbackLocale: "en", baseUrl: base,
        files: { en: { url: "en.json", sha256: createHash("sha256").update(bytes).digest("hex"), decodedBytes: bytes.length } },
        tiebreakers: {},
      };
      draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
      return draft;
    };
    const fetchStub = async () => {
      const bytes = utf8.encode(body);
      let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }) } };
    };

    /** The handle must be a STABLE data property, or the WeakRef watches a throwaway wrapper and the
     *  arm reports collected whether or not the catalog is retained. */
    const handleOf = (loaded) => {
      if (loaded.complete !== true) throw new Error("the load did not complete; the arm proves nothing");
      if (loaded.catalogs.en !== loaded.catalogs.en) throw new Error("WeakRef target is not a stable handle");
      const descriptor = Object.getOwnPropertyDescriptor(loaded.catalogs, "en");
      if (!descriptor || descriptor.get !== undefined || descriptor.value === undefined)
        throw new Error("catalogs.en is not a data property; arm 1 proves nothing");
      return loaded.catalogs.en;
    };

    // The reference is taken INSIDE an inner function that returns only the WeakRef, so no binding
    // to the record survives in an enclosing scope and keeps it reachable.
    const dropped = await (async () => new WeakRef(handleOf(
      await loadStrings(manifestAt("https://cdn.example/c32-dropped/"), "en", { fetch: fetchStub }))))();

    // THE RETAINED CONTROL: the same protocol over a catalog this probe deliberately holds. Without
    // it, a forced collection that simply is not collecting makes the arm above pass vacuously.
    const kept = [];
    const keptRef = await (async () => {
      const catalog = handleOf(await loadStrings(manifestAt("https://cdn.example/c32-kept/"), "en", { fetch: fetchStub }));
      kept.push(catalog);
      return new WeakRef(catalog);
    })();

    for (let round = 0; round < 3; ++round) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      globalThis.gc();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    console.log(JSON.stringify({ droppedCollected: dropped.deref() === undefined, keptAlive: keptRef.deref() !== undefined }));
  `;

  const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", probe],
    { encoding: "utf8" });
  assert.equal(child.status, 0, `the retention probe did not run: ${child.stderr}`);
  const measured = JSON.parse(/** @type {string} */ (child.stdout.trim().split("\n").pop()));

  // THE INSTRUMENT FIRST, as its own named assertion: if the retained control were collected the
  // protocol would be broken and the next line would mean nothing either way.
  assert.equal(measured.keptAlive, true,
    "the retained control was collected: the forced-GC protocol cannot distinguish the two states");
  assert.equal(measured.droppedCollected, true,
    "a dropped LoadedStrings' catalog survived three forced collections: something retains it");
});

/* ------------------------------------------------------------------------------------------------
 * C7 — one layer up: the compiled instance. Every transport probe above is green over this.
 * ---------------------------------------------------------------------------------------------- */

test("two records that share a catalogVersion each compile their own Strings", async () => {
  // **THE S10 SEAM, ONE LAYER UP.** Both loads really happen, both fetch their own distinct URLs and
  // both records are correct, so every ledger and content probe in this file is green over a
  // compiled-instance cache in core. And plan 6.6:2352-2353 INVITES this particular key: "servers
  // keep an immutable instance or bounded set of instances per catalog version", which an author
  // reads as licence to memoize by version.
  //
  // Orthogonal to the content test by construction: that one is ONE url with TWO versions (a
  // URL-keyed loader cache), this one is TWO urls with ONE version (a version-keyed core cache), so
  // neither can be mistaken for covering the other.
  const base = "https://cdn.example/c32-compiled/";
  const shared = "c32.compiled.colliding";
  const a = manifestFor({ baseUrl: base, catalogVersion: shared, entries: { en: { url: "en-a.json", text: bodyFor("ALPHA") } } });
  const b = manifestFor({ baseUrl: base, catalogVersion: shared, entries: { en: { url: "en-b.json", text: bodyFor("BRAVO-BRAVO") } } });
  const stub = countingFetch((href) => (href.endsWith("en-a.json") ? bodyFor("ALPHA") : bodyFor("BRAVO-BRAVO")));

  const loadedA = await loadStrings(a, "en", { fetch: stub.impl });
  const loadedB = await loadStrings(b, "en", { fetch: stub.impl });
  assert.equal(loadedA.complete, true);
  assert.equal(loadedB.complete, true);
  assert.equal(loadedA.catalogIdentity.catalogVersion, loadedB.catalogIdentity.catalogVersion,
    "the two records must COLLIDE on catalogVersion, or this test probes nothing");
  assert.notEqual(loadedA.catalogIdentity.catalogFingerprint, loadedB.catalogIdentity.catalogFingerprint);

  const stringsA = createStrings({ loaded: loadedA, locale: "en" });
  assert.equal(stringsA.get("Greeting"), "ALPHA");
  const stringsB = createStrings({ loaded: loadedB, locale: "en" });

  assert.notEqual(stringsA, stringsB, "one compiled instance was served for both records");
  assert.equal(stringsB.get("Greeting"), "BRAVO-BRAVO",
    "the second construction rendered the first record's catalog");
  assert.equal(stringsB.getCatalogIdentity()?.catalogFingerprint, loadedB.catalogIdentity.catalogFingerprint,
    "the instance reports an identity its own record does not carry");
});

test("two records with the SAME fingerprint compile two distinct Strings", async () => {
  // The key a memoizing author actually reaches for in THIS codebase: `catalogFingerprint` exists to
  // identify a catalog set, so a cache keyed on it collides on exactly the input the test above
  // cannot produce — two records whose fingerprints are equal. Both render the same string, so
  // INSTANCE IDENTITY is the only observation that can discriminate here.
  //
  // Whether sharing one compiled instance violates :2101 is a reading, recorded in the file header
  // and owed to the maintainer: "if two loads produce the same catalogs, may the library hand both
  // callers the same compiled object?"
  const base = "https://cdn.example/c32-fingerprint/";
  const m = manifestFor({
    baseUrl: base, catalogVersion: "c32.fingerprint",
    entries: { en: { url: "en.json", text: bodyFor("ALPHA") } },
  });
  const stub = countingFetch(() => bodyFor("ALPHA"));

  const first = await loadStrings(m, "en", { fetch: stub.impl });
  const second = await loadStrings(m, "en", { fetch: stub.impl });
  assert.equal(first.complete, true);
  assert.equal(second.complete, true);
  assert.equal(first.catalogIdentity.catalogFingerprint, second.catalogIdentity.catalogFingerprint,
    "the two records must share a fingerprint, or a fingerprint-keyed cache is never consulted");

  const stringsFirst = createStrings({ loaded: first, locale: "en" });
  assert.equal(stringsFirst.get("Greeting"), "ALPHA");
  const stringsSecond = createStrings({ loaded: second, locale: "en" });
  assert.equal(stringsSecond.get("Greeting"), "ALPHA");
  assert.notEqual(stringsFirst, stringsSecond,
    "one compiled instance was served to both callers from a fingerprint-keyed cache");
});
