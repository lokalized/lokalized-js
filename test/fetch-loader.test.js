// @ts-check
/**
 * `loadStrings` / `loadEntireManifest` — plan section 6.2.
 *
 * **THE INJECTED FETCH MISBEHAVES ON PURPOSE, and that is the entire design of this file.** A stub
 * that resolves in order, returns the right bytes and always ends makes most of section 6.2
 * unfalsifiable: "failures are ordered by fetch-plan order, NOT completion order" cannot fail if
 * nothing ever completes out of order, and "byte limits are enforced while streaming" cannot fail if
 * every body ends. So the fetches here resolve backwards, stream forever, abort mid-flight and lie
 * about their digests. This project has already shipped one instrument that passed because its probe
 * was too well behaved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, loadStrings, StringsLoadingError } from "../src/load/fetch-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();
const bodyFor = (tag) => JSON.stringify({ [`Key.${tag}`]: `hello ${tag}` });

function manifest(tags, { fallbackLocale = "en", decoded = false } = {}) {
  const files = Object.fromEntries(tags.map((tag) => {
    const bytes = utf8.encode(bodyFor(tag));
    return [tag, { url: `${tag}.json`, sha256: sha256Hex(bytes), ...(decoded ? { decodedBytes: bytes.length } : {}) }];
  }));
  const draft = {
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale, baseUrl: "https://cdn.example/v1/", files, tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/**
 * A response whose body streams the given chunks, or never ends.
 *
 * `cancelled` is observable on purpose. A body that never ends must be CANCELLED when the loader
 * walks away from it, and a no-op `cancel` makes that unfalsifiable: the limit refusal looks
 * identical whether the reader was released or left open forever. Measured gap — the assertion below
 * was added when S11a moved this read loop behind an async generator, where the release depends on a
 * `finally` that nothing had ever checked.
 */
function streamed(chunks, { neverEnds = false } = {}) {
  let index = 0;
  const state = { cancelled: 0 };
  return {
    ok: true, status: 200,
    cancelState: state,
    body: {
      getReader: () => ({
        read: async () => {
          if (neverEnds) return { done: false, value: chunks[0] };
          if (index >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[index++] };
        },
        cancel: async () => { ++state.cancelled; },
      }),
    },
  };
}

/** An injected fetch. `order: "reverse"` settles the LAST request first. */
function injectedFetch(behaviour = {}) {
  const calls = [];
  let active = 0;
  let peakActive = 0;
  const impl = async (url, init) => {
    calls.push({ url, init });
    ++active;
    peakActive = Math.max(peakActive, active);
    try {
      // Deliberately settle late for early plan positions, so completion order is the REVERSE of
      // plan order. Without this the ordering assertions below cannot fail.
      const position = calls.length - 1;
      const delay = behaviour.order === "reverse" ? (behaviour.total ?? 2) - position : 0;
      await new Promise((resolve) => setTimeout(resolve, delay * 5));
      return behaviour.respond(url, position);
    } finally { --active; }
  };
  return { impl, calls, peak: () => peakActive };
}

const okBody = (url) => {
  const tag = /** @type {string} */ (url.split("/").pop()).replace(".json", "");
  return streamed([utf8.encode(bodyFor(tag))]);
};

test("a clean load returns catalogs, coverage and complete:true", async () => {
  const m = manifest(["en", "fr"]);
  const fetchImpl = injectedFetch({ respond: okBody });
  const loaded = await loadStrings(m, "fr", { fetch: fetchImpl.impl });
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);
  assert.equal(loaded.complete, true);
  assert.deepEqual(loaded.coverage, { kind: "lookup", lookupLocale: "fr" });
  assert.equal(loaded.catalogIdentity.catalogFingerprint, m.catalogFingerprint);
});

test("failures are in FETCH-PLAN order even when responses arrive backwards", async () => {
  // The assertion that a well-behaved stub cannot make. Every request fails, and the LAST planned
  // file settles FIRST — so an implementation appending failures on arrival reports them reversed.
  const m = manifest(["fr", "en"], { fallbackLocale: "en" });
  const fetchImpl = injectedFetch({
    order: "reverse", total: 2,
    respond: () => ({ ok: false, status: 503 }),
  });
  const error = await loadStrings(m, "fr", { fetch: fetchImpl.impl }).then(() => null, (e) => e);
  assert.ok(error instanceof StringsLoadingError, `expected StringsLoadingError, got ${error}`);
  assert.deepEqual(error.failures.map((f) => f.locale), ["fr", "en"],
    "plan order is fr then en; completion order was the reverse");
  assert.deepEqual(error.failures.map((f) => f.stage), ["fetch", "fetch"]);
});

test("a body that never ends fails on the byte LIMIT rather than exhausting memory", async () => {
  const m = manifest(["en"]);
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  let response = null;
  const fetchImpl = injectedFetch({ respond: () => (response = streamed([chunk], { neverEnds: true })) });
  const error = await loadStrings(m, "en", {
    fetch: fetchImpl.impl,
    limits: { maximumInputBytes: 256 * 1024 },
  }).then(() => null, (e) => e);
  assert.ok(error instanceof StringsLoadingError);
  assert.equal(error.failures[0].stage, "limit");
  // AND THE READER IS RELEASED. Without this the test passes over a loader that abandoned an
  // infinite stream still open, which on a real connection is a socket that is never returned.
  assert.equal(/** @type {any} */ (response).cancelState.cancelled, 1);
});

test("a wrong digest fails at DIGEST, before the body is parsed", async () => {
  // The body below is valid JSON, so a loader that parsed first would succeed and never notice. The
  // stage is what proves the order.
  const m = manifest(["en"]);
  const fetchImpl = injectedFetch({ respond: () => streamed([utf8.encode('{"Other.Key":"different"}')]) });
  const error = await loadStrings(m, "en", { fetch: fetchImpl.impl }).then(() => null, (e) => e);
  assert.ok(error instanceof StringsLoadingError);
  assert.equal(error.failures[0].stage, "digest");
  assert.match(String(error.failures[0].cause.message), /does not match the manifest's/);
});

test("a declared decodedBytes mismatch fails while streaming", async () => {
  const m = manifest(["en"], { decoded: true });
  // One byte too many, and the digest would also be wrong — the LIMIT stage must win, because the
  // length is checked as the body streams and the digest only after it completes.
  const fetchImpl = injectedFetch({ respond: () => streamed([utf8.encode(bodyFor("en") + " ")]) });
  const error = await loadStrings(m, "en", { fetch: fetchImpl.impl }).then(() => null, (e) => e);
  assert.equal(error.failures[0].stage, "limit");
});

test("allow-partial returns successes ONLY when the fallback file loaded", async () => {
  const m = manifest(["fr", "en"], { fallbackLocale: "en" });
  const failFr = (url) => (url.endsWith("fr.json") ? { ok: false, status: 404 } : okBody(url));
  const partial = await loadStrings(m, "fr", {
    fetch: injectedFetch({ respond: failFr }).impl,
    partialFailure: "allow-partial",
  });
  assert.equal(partial.complete, false, "a partial result makes no parity claim");
  assert.deepEqual(Object.keys(partial.catalogs), ["en"]);
  assert.deepEqual(partial.failures.map((f) => f.locale), ["fr"]);

  // THE OTHER ARM: fallback-file failure always rejects, even under allow-partial. Without this the
  // test above would pass on a loader that never rejects at all.
  const failEn = (url) => (url.endsWith("en.json") ? { ok: false, status: 500 } : okBody(url));
  const error = await loadStrings(m, "fr", {
    fetch: injectedFetch({ respond: failEn }).impl,
    partialFailure: "allow-partial",
  }).then(() => null, (e) => e);
  assert.ok(error instanceof StringsLoadingError);
  assert.match(error.message, /fallback-locale file is among them/);
});

test("abort rejects and is never converted into partial success", async () => {
  const m = manifest(["fr", "en"], { fallbackLocale: "en" });
  const controller = new AbortController();
  const fetchImpl = injectedFetch({
    respond: (url) => { controller.abort(new Error("caller aborted")); return okBody(url); },
  });
  const error = await loadStrings(m, "fr", {
    fetch: fetchImpl.impl, signal: controller.signal, partialFailure: "allow-partial",
  }).then((value) => value, (e) => e);
  assert.ok(error instanceof Error, "an aborted load must reject, not resolve to a partial result");
  assert.ok(!(error && /** @type {any} */ (error).complete === false), "abort is not a partial success");
});

test("at most eight catalog reads are active at once", async () => {
  const tags = ["en", "fr", "de", "es", "it", "pt", "nl", "sv", "da", "fi", "pl"];
  const m = manifest(tags, { fallbackLocale: "en" });
  const fetchImpl = injectedFetch({
    respond: async (url) => { await new Promise((r) => setTimeout(r, 5)); return okBody(url); },
  });
  await loadEntireManifest(m, { fetch: fetchImpl.impl });
  assert.ok(fetchImpl.peak() <= 8, `peak concurrency was ${fetchImpl.peak()}, which exceeds the cap of 8`);
  assert.ok(fetchImpl.peak() > 1, "the fixture must actually run work in parallel, or the cap is untested");
});

test("request defaults are applied identically to every planned request", async () => {
  const m = manifest(["en", "fr"]);
  const fetchImpl = injectedFetch({ respond: okBody });
  await loadEntireManifest(m, { fetch: fetchImpl.impl, request: { credentials: "include" } });
  assert.equal(fetchImpl.calls.length, 2);
  for (const call of fetchImpl.calls) {
    assert.equal(call.init.mode, "cors", "the default mode survives a partial override");
    assert.equal(call.init.credentials, "include", "the bounded override is applied to every request");
  }
});

test("WebCrypto absence fails CLOSED, before any catalog is fetched", async () => {
  // The non-invocation half is the point: proving a request did NOT happen needs an instrument that
  // would notice if it did. The injected fetch records every call, and the assertion is that it
  // recorded none.
  const m = manifest(["en"]);
  const fetchImpl = injectedFetch({ respond: okBody });
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    const error = await loadStrings(m, "en", { fetch: fetchImpl.impl }).then(() => null, (e) => e);
    assert.equal(error?.name, "DigestUnavailableError");
    assert.equal(error?.code, "DIGEST_UNAVAILABLE");
    assert.equal(fetchImpl.calls.length, 0, "no catalog may be fetched when its digest cannot be checked");
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
  }
});

test("a manifest that does not validate never reaches the network", async () => {
  const broken = manifest(["en"]);
  broken.catalogFingerprint = "9".repeat(64);
  const fetchImpl = injectedFetch({ respond: okBody });
  await assert.rejects(() => loadStrings(broken, "en", { fetch: fetchImpl.impl }),
    /catalogFingerprint does not match/);
  assert.equal(fetchImpl.calls.length, 0, "planning refuses before any catalog I/O");
});
