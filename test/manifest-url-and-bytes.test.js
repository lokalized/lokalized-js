// @ts-check
/**
 * URL RESOLUTION AND TRANSPORT BYTE SEMANTICS — M8 clause 9 (plan 6.1:1909-1914).
 *
 * Five separately falsifiable propositions live in that one paragraph: file URLs are resolved with
 * `new URL(file.url, manifest.baseUrl)`; `decodedBytes` is the EXACT post-content-coding body length
 * and a mismatch fails; the digest covers the bytes the body exposed, after content coding and before
 * UTF-8 decoding or BOM removal; Node hashes raw file bytes; and an encoded HTTP `Content-Length` is
 * NEVER compared for equality to `decodedBytes`. Each obvious probe for them fails for a different
 * reason, and naming those reasons is most of what this file is:
 *
 * **THE OBVIOUS URL PROBE IS A DIFFERENTIAL AGAINST ITSELF.** Recomputing `new URL(file.url, baseUrl)`
 * inside the test asserts that the port calls the API the test calls — green over swapped arguments,
 * green over a base the planner mangled before resolving. Every expected URL below is a LITERAL. And
 * the ablation that matters is not `base + url`: it is the SLASH-NORMALIZING JOINER a careful author
 * writes while fixing that, which is byte-identical to `new URL` on a trailing-slash base with a bare
 * filename and wrong on all four shapes here.
 *
 * **THE OBVIOUS LENGTH PROBE IS AN OVER-LONG BODY, AND THAT HALF IS ALREADY CREDITED.** Clause 23 is
 * PROVEN on an ablation that drops the streaming byte-limit check over a never-ending body — an
 * OVERRUN instrument, structurally incapable of failing for an under-run. A check written inside the
 * chunk loop (`if (total > expected) fail`), which is exactly what "enforced while streaming" invites,
 * passes every overrun probe and cannot see a short body. "Exact" is two-directional and needs two.
 *
 * **THE OBVIOUS `Content-Length` PROBE IS A SIMULATED HEADER.** A negative proposition is only
 * falsifiable on an input where obeying and disobeying it differ, and identity coding is not one — a
 * body whose length equals its header cannot see an equality check at all. A stub header that merely
 * disagrees is the cheap version and it exists one file over (`manifest-deployment-contract.test.js`,
 * "clause 6: decodedBytes is compared to the BODY…", measured: it goes red under this file's
 * `content-length-equality-checked` ablation). What is added here is the REAL article — a loopback
 * server with a genuine `Content-Encoding: gzip`, driven through the host's own `fetch` — plus the
 * MIRROR the stub version does not carry. 9g and 9h are each other's mirror: a loader that trusts the
 * header passes 9h and fails 9g, one that ignores `decodedBytes` passes 9g and fails 9c/9d/9h, and
 * only a loader that compares the declaration to the streamed octet count passes both.
 *
 * **THE OBVIOUS DEREFERENCE PROBE IS RELATIONAL.** Comparing the requested string to planning's own
 * output is green whenever the planner and the transport share one wrong joiner, so the recorded
 * requests here are compared to the same LITERALS the planning tests use.
 *
 * **EVERY BODY IS SERVED IN THREE CHUNKS.** On a single chunk a counter that measures only the first,
 * or only the current, chunk equals the total — so a one-chunk fixture cannot tell an accumulator from
 * either, and both `9c` and `9d` would be green over a loader that never accumulates.
 *
 * THE PERTURBATION RULE THIS FILE OBEYS, and it is what keeps every probe reaching the check it names:
 * plan 6.1:1927 excludes `baseUrl`, per-file `url` and `decodedBytes` from the identity projection, and
 * plan 6.1:1893 has parsing, validation, planning AND loading recompute the catalog fingerprint before
 * any catalog I/O. **Those three fields are therefore the ONLY ones a fixture here may edit.** Touching
 * `sha256` would move the fingerprint and the manifest would be refused before a single byte was read —
 * the probe would "reject", the assertion would pass, and nothing under test would have run. Where a
 * probe needs different bytes it changes the BYTES ON DISK and regenerates the manifest.
 *
 * WHAT IS CITED RATHER THAN RE-PROVED: the digest's decode/BOM scope and its ordering before parsing
 * are gated by `test/digest-before-parse.test.js` (clause 26, PROVEN) on both doors; the resolved-URL
 * scheme refusal is `test/load-door-boundaries.test.js` (clause 10). What is NOT reachable at the
 * digest is the phrase "after content coding": `response.body` exposes only post-coding octets, so a
 * loader cannot hash the encoded representation even by mistake. Its falsifiable residue is in the
 * LENGTH channel (9g, 9h) and in one reachable digest-adjacent arm — a loader that applies its OWN
 * content decoding to an already-decoded body, which the 9g fixtures discriminate.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { catalogIdentityInputFor, computeCatalogIdentity } from "../src/load/identity.js";
import { createStrings } from "../src/core/index.js";
import { createStringsManifestFromDirectory } from "../src/node/manifest-directory.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { fetchSet } from "../src/load/planning.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { loadEntireManifestFromFiles, loadStringsFromFiles } from "../src/node/file-loader.js";
import { validateStringsManifest } from "../src/load/manifest.js";
import { wholeManifestPlan } from "../src/load/run-plan.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const utf8 = new TextEncoder();

// =================================================================================================
// PART ONE — 9a and 9b: which string is planned, and which string is dereferenced.
// Synchronous where it can be: the resolved URL is a VALUE, so most of this needs no I/O at all.
// =================================================================================================

const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Hi: `hello ${tag}` });

/**
 * A hand-built manifest whose per-file `url`s are given verbatim.
 *
 * The digests come from `node:crypto` rather than from the port's own `sha256Hex`, so the fixture's
 * oracle is not the module the fixture is aimed at.
 *
 * @param {string} baseUrl @param {Record<string, string>} urls
 */
function manifestWith(baseUrl, urls) {
  const files = Object.fromEntries(Object.entries(urls).map(([tag, url]) =>
    [tag, { url, sha256: createHash("sha256").update(utf8.encode(bodyFor(tag))).digest("hex") }]));
  const draft = /** @type {any} */ ({
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY,
    fallbackLocale: "en", baseUrl, files, tiebreakers: {},
  });
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return draft;
}

/**
 * ONE BASE CARRYING EVERY DIVERGENCE AT ONCE: an uppercase scheme and host, an explicit default port,
 * and a path with NO trailing slash. Combining them is the repair for a probe that would otherwise be
 * contingent — if some layer had already normalized `baseUrl`, a serialization-only probe would be
 * green under the joiner ablation, because the joiner would then be handed an already-lowercased
 * string. With the missing trailing slash folded in, the probe is red under the joiner either way.
 */
const SPLAYED_BASE = "HTTPS://CDN.Example.TEST:443/v1/catalogs";

const SPLAYED = manifestWith(SPLAYED_BASE, {
  en: "en.json",                                   // the base's last segment is REPLACED
  fr: "/static/fr.json",                           // root-relative: the base PATH is discarded
  es: "../shared/es.json",                         // a dot segment, resolved and normalized away
  de: "https://mirror.example.test/de.json",       // absolute: the base must not win
});

/** The literals. Never `new URL(...)` recomputed here — see the header. */
const RESOLVED = Object.freeze({
  en: "https://cdn.example.test/v1/en.json",
  fr: "https://cdn.example.test/static/fr.json",
  es: "https://cdn.example.test/shared/es.json",
  de: "https://mirror.example.test/de.json",
});

/**
 * The case every candidate implementation agrees on, and the base the two guards below use.
 *
 * `es`'s entry is the exact string this port's OWN generator emits for a catalog named
 * `es#draft.json` (`encodeURIComponent`, measured) — chosen after a percent-encoded NON-ASCII name
 * was measured NOT to discriminate: `new URL` re-encodes `é` to the identical `e%CC%81`, so
 * decode-then-resolve is a fixed point there and the probe would have been decoration. An encoded
 * DELIMITER is not a fixed point, and getting it wrong is not cosmetic — the decoded spelling turns
 * the rest of the name into a URL fragment and fetches a different file.
 */
const TIDY = manifestWith("https://cdn.example.test/v1/", {
  en: "en.json", fr: "fr.json?v=2", es: "es%23draft.json", de: "de.json",
});

/**
 * The URL `fetchSet` planned for `tag`, found BY LOCALE.
 *
 * By locale and not by index: `fetchSet` returns only the files on that lookup's candidate chain
 * (plan 6.1:1889-1890), so a single lookup over four locales yields two entries, not four. Indexing a
 * five-shape table into one call would read `undefined` for three of them — or, written as a silent
 * find, would assert nothing at all.
 *
 * @param {any} manifest @param {string} tag
 */
function plannedUrlFor(manifest, tag) {
  const planned = fetchSet(manifest, tag);
  assert.equal(planned.length, tag === "en" ? 1 : 2,
    `fetchSet('${tag}') plans the candidate chain, which is [${tag}] or [${tag}, en]; it returned ` +
    `[${planned.map((entry) => entry.locale).join(", ")}]`);
  const entry = planned.find((candidate) => candidate.locale === tag);
  assert.ok(entry, `fetchSet('${tag}') must carry an entry for '${tag}'`);
  return entry.url;
}

test("9a: a base whose path has no trailing slash replaces its last segment", () => {
  // RFC 3986 reference resolution, which a joiner gets exactly backwards: `catalogs` is a FILE-shaped
  // last segment and is dropped, so a bare `en.json` publishes one directory UP from the base.
  assert.equal(plannedUrlFor(SPLAYED, "en"), RESOLVED.en);
});

test("9a: a root-relative entry discards the base path", () => {
  assert.equal(plannedUrlFor(SPLAYED, "fr"), RESOLVED.fr);
});

test("9a: a dot-segment entry is resolved and normalized", () => {
  const planned = plannedUrlFor(SPLAYED, "es");
  assert.equal(planned, RESOLVED.es);
  assert.ok(!planned.includes(".."), "a resolved reference carries no literal dot segment");
});

test("9a: an absolute cross-origin entry is not re-based", () => {
  // A manifest may point one locale at a different host — a mirror, a per-locale CDN. This is also
  // the probe that catches swapped arguments: `new URL(baseUrl, file.url)` throws loudly for the
  // three relative entries and SILENTLY answers the bare base for this one.
  assert.equal(plannedUrlFor(SPLAYED, "de"), RESOLVED.de);
});

test("9a: the planned URL is the SERIALIZED form, and validation keeps baseUrl verbatim", () => {
  for (const [tag, expected] of Object.entries(RESOLVED)) {
    const planned = plannedUrlFor(SPLAYED, tag);
    assert.equal(planned, expected);
    assert.ok(!planned.includes("CDN.Example.TEST"), "the host is serialized lowercase");
    assert.ok(!planned.includes(":443"), "a default port is dropped from the serialization");
  }

  // WHICH LAYER NORMALIZES, recorded rather than assumed — the plan states normalization for the
  // recorded `lookupLocale` (6.1:1886) and says nothing about `baseUrl`. Measured: validation keeps
  // the caller's spelling verbatim and the serialization happens at RESOLUTION. That is why the probe
  // above folds the missing trailing slash in; were this to change, the probes stay red under the
  // joiner and this assertion goes red on its own, naming the move.
  assert.equal(validateStringsManifest(SPLAYED).baseUrl, SPLAYED_BASE);
});

test("9a CONTROL: a trailing-slash base with a bare filename is the case every implementation agrees on", () => {
  // Without this the reds above are equally satisfied by a broken fixture or a planner that refuses
  // everything. It must stay GREEN under the joiner ablation: that is what makes the other four
  // attributable to the resolution rule rather than to the manifest.
  assert.equal(plannedUrlFor(TIDY, "en"), "https://cdn.example.test/v1/en.json");
  assert.equal(plannedUrlFor(TIDY, "de"), "https://cdn.example.test/v1/de.json");
});

test("9a: a query survives resolution verbatim", () => {
  // On a trailing-slash base this is invisible to the joiner ablation, so it is gated by its own:
  // `origin + pathname`, the shape an implementer writes when normalizing a resolved URL.
  assert.equal(plannedUrlFor(TIDY, "fr"), "https://cdn.example.test/v1/fr.json?v=2");
});

test("9a: an already-percent-encoded name is not double-encoded or decoded", () => {
  // Its own ablation is a `decodeURIComponent` before resolving — what an author reaches for on
  // seeing a percent sign in a manifest. Decoded, `es%23draft.json` becomes `es.json#draft.json`:
  // a request for a DIFFERENT catalog with a fragment attached, and a fragment is not sent.
  assert.equal(plannedUrlFor(TIDY, "es"), "https://cdn.example.test/v1/es%23draft.json");
});

test("9a: whole-manifest planning resolves URLs the same way", () => {
  // `fetchSet` plans a CHAIN; `wholeManifestPlan` plans every declared locale. They are separate
  // functions in separate modules, so a fetchSet-only assertion leaves the whole-manifest planner
  // free to re-implement resolution for locales no chain reaches.
  const planned = wholeManifestPlan(validateStringsManifest(SPLAYED));
  assert.deepEqual(
    Object.fromEntries(planned.map((entry) => [entry.locale, entry.url])),
    { ...RESOLVED },
  );
});

/** Splits a body into `count` parts — see the header on why one chunk is not enough. */
function sliceInto(/** @type {Uint8Array} */ bytes, /** @type {number} */ count) {
  if (bytes.length === 0) return [bytes];
  const size = Math.max(1, Math.ceil(bytes.length / count));
  /** @type {Uint8Array[]} */
  const parts = [];
  for (let at = 0; at < bytes.length; at += size)
    parts.push(bytes.subarray(at, Math.min(at + size, bytes.length)));
  return parts;
}

/** The locale a requested string names, read off the file name so a stub survives a mangled path. */
function localeOf(/** @type {string} */ requested) {
  const match = /([A-Za-z0-9-]+)\.json(?:\?|$)/.exec(requested);
  assert.ok(match, `the stub cannot tell which catalog '${requested}' asks for`);
  return /** @type {string} */ (match[1]);
}

/**
 * A recording transport that serves each body in three chunks.
 *
 * It records the REQUESTED STRING verbatim and normalizes only the string-vs-Request question, so the
 * assertion stays neutral about which of the two the loader passes.
 *
 * @param {Record<string, Uint8Array>} bytesByLocale
 * @param {{ headersFor?: (locale: string) => Record<string, string>, statusFor?: (locale: string) => number, chunkCount?: number }} [options]
 */
function servingFetch(bytesByLocale, options = {}) {
  const { headersFor = () => ({}), statusFor = () => 200, chunkCount = 3 } = options;
  /** @type {string[]} */
  const calls = [];
  /** @type {{ locale: string, response: any }[]} */
  const served = [];

  const impl = async (/** @type {any} */ url) => {
    const requested = typeof url === "string" ? url : (url?.url ?? String(url));
    calls.push(requested);
    const locale = localeOf(requested);
    const status = statusFor(locale);
    if (status !== 200) {
      const response = { ok: false, status, headers: new Headers() };
      served.push({ locale, response });
      return response;
    }
    const bytes = bytesByLocale[locale];
    assert.ok(bytes, `the stub has no body for '${locale}'`);
    const parts = sliceInto(bytes, chunkCount);
    let index = 0;
    const response = {
      ok: true, status: 200,
      headers: new Headers(headersFor(locale)),
      body: {
        getReader: () => ({
          read: async () =>
            (index < parts.length ? { done: false, value: parts[index++] } : { done: true, value: undefined }),
          cancel: async () => {},
        }),
      },
    };
    served.push({ locale, response });
    return response;
  };

  return { calls, served, impl };
}

const SPLAYED_BODIES = Object.fromEntries(
  ["en", "fr", "es", "de"].map((tag) => [tag, utf8.encode(bodyFor(tag))]));

test("9b: the recorded request URLs are exactly the planned absolute URLs", async () => {
  // THE S10 SEAM. Planning is gated (clause 11) and the door's SCHEME check is gated (clause 10, on
  // the transport's argument), and nothing compared the DEREFERENCED string to the PLANNED one over a
  // base where resolution is non-trivial. A transport that re-joined would still ask for an https URL,
  // so every clause-10 assertion stays green while the wrong file is fetched.
  const transport = servingFetch(SPLAYED_BODIES);
  const loaded = await loadEntireManifest(SPLAYED, { fetch: transport.impl });

  // The count FIRST: `complete === true` with zero requests would read as a pass.
  assert.equal(transport.calls.length, 4, "four declared locales, four requests");
  // Compared as a set. The ORDER of requests is plan order, which is a different clause's
  // proposition; what clause 9 owns is which strings they are.
  assert.deepEqual([...transport.calls].sort(), Object.values(RESOLVED).sort());

  assert.equal(loaded.complete, true, "and the fixture is otherwise fully working end to end");
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["de", "en", "es", "fr"]);

  // Plan 6.1:1832 — `FetchEntry.url` is an "absolute serialized URL", and the record a caller reads
  // back carries the same strings.
  for (const entry of loaded.requestedFiles) {
    assert.equal(entry.url, /** @type {any} */ (RESOLVED)[entry.locale]);
    assert.equal(new URL(entry.url).href, entry.url, "absolute and already serialized");
  }
});

test("9b: a LoadFailure carries the absolute serialized URL, not the manifest entry", async () => {
  // Plan 6.1:1962 annotates `LoadFailure.url` "absolute serialized URL". `fr`'s manifest entry is
  // `/static/fr.json`; a record echoing that would be useless to someone diagnosing a deployment and
  // is the shape a reporter written against the manifest produces.
  const transport = servingFetch(SPLAYED_BODIES, { statusFor: (locale) => (locale === "fr" ? 404 : 200) });
  const error = await loadEntireManifest(SPLAYED, { fetch: transport.impl }).then(() => null, (e) => e);

  assert.equal(error?.name, "StringsLoadingError");
  // Pinned BEFORE index 0 is read: failures are in plan order (6.2:2077), so an unexpected second
  // failure would otherwise be read through the wrong slot.
  assert.equal(error?.failures?.length, 1);
  assert.equal(error?.failures?.[0]?.locale, "fr");
  assert.equal(error?.failures?.[0]?.url, RESOLVED.fr);
  assert.equal(new URL(error.failures[0].url).href, error.failures[0].url);
});

// =================================================================================================
// PART TWO — 9c-9j: the byte channel.
//
// Every fixture below is generated from REAL BYTES ON DISK by the port's own publisher, and the
// harness re-derives both declared numbers with `node:crypto` before any probe runs. That is what
// makes each probe SINGLE-FAULT: the digest always describes the bytes actually served, so a
// rejection cannot be the hash. It also measures the file-door half of "the publisher hashes the same
// representation" (plan 6.1:1913) end to end, which is otherwise written off as unobservable.
// =================================================================================================

const root = mkdtempSync(join(tmpdir(), "lokalized-clause9-"));
after(() => rmSync(root, { recursive: true, force: true }));

const concat = (/** @type {Uint8Array[]} */ ...parts) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

const PLAIN_EN = utf8.encode(JSON.stringify({ Hi: "hello en" }));
const PLAIN_FR = utf8.encode(JSON.stringify({ Hi: "bonjour le monde entier" }));
/** Three BOM octets in front of the same document. */
const BOM_FR = concat(new Uint8Array([0xef, 0xbb, 0xbf]), utf8.encode(JSON.stringify({ Hi: "bonjour" })));

function directoryOf(/** @type {Record<string, Uint8Array>} */ contents, /** @type {string} */ name) {
  const path = join(root, name);
  mkdirSync(path);
  for (const [fileName, bytes] of Object.entries(contents)) writeFileSync(join(path, fileName), bytes);
  return path;
}

const PLAIN_FILES = { "en.json": PLAIN_EN, "fr.json": PLAIN_FR };
const BOM_FILES = { "en.json": PLAIN_EN, "fr.json": BOM_FR };
const PLAIN_DIR = directoryOf(PLAIN_FILES, "plain");
const BOM_DIR = directoryOf(BOM_FILES, "bom");

/**
 * Publish a directory and CHECK THE PUBLISHER, independently, before anything uses the result.
 *
 * If the generator and the loader ever shared a wrong convention about what `decodedBytes` counts,
 * this precondition goes red rather than a probe going quietly green.
 *
 * @param {string} path @param {Record<string, Uint8Array>} bytesByFile @param {string} [publicationBaseUrl]
 */
async function publish(path, bytesByFile, publicationBaseUrl) {
  const manifest = await createStringsManifestFromDirectory(path, {
    catalogVersion: "2026.09.13", fallbackLocale: "en",
    ...(publicationBaseUrl === undefined ? {} : { publicationBaseUrl }),
  });
  for (const [fileName, bytes] of Object.entries(bytesByFile)) {
    const tag = fileName.replace(/\.json$/, "");
    const file = /** @type {any} */ (manifest.files)[tag];
    assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"),
      `the published digest for '${tag}' must be the SHA-256 of the exact bytes on disk`);
    assert.equal(file.decodedBytes, bytes.byteLength,
      `the published decodedBytes for '${tag}' must be the raw byte length of the file`);
  }
  return manifest;
}

/** @type {Map<string, Promise<any>>} */
const publications = new Map();
const published = (/** @type {string} */ key, /** @type {() => Promise<any>} */ build) => {
  const existing = publications.get(key);
  if (existing !== undefined) return existing;
  const fresh = build();
  publications.set(key, fresh);
  return fresh;
};

const CDN_BASE = "https://cdn.example.test/v1/";
const cdnPlain = () => published("cdn-plain", () => publish(PLAIN_DIR, PLAIN_FILES, CDN_BASE));
const filePlain = () => published("file-plain", () => publish(PLAIN_DIR, PLAIN_FILES));
const cdnBom = () => published("cdn-bom", () => publish(BOM_DIR, BOM_FILES, CDN_BASE));
const fileBom = () => published("file-bom", () => publish(BOM_DIR, BOM_FILES));

/**
 * The SAME manifest with one transport-only field changed, and proof that identity did not move.
 *
 * `undefined` deletes the declaration. The fingerprint assertion is the anti-`zh-123` guard: if
 * `decodedBytes` ever entered the identity projection, `validateStringsManifest` would refuse every
 * fixture here before a byte was read and each probe would "reject" for a reason it does not name.
 *
 * @param {any} manifest @param {string} tag @param {number | undefined} decodedBytes
 */
function declaring(manifest, tag, decodedBytes) {
  const file = manifest.files[tag];
  const perturbed = validateStringsManifest({
    ...manifest,
    files: {
      ...manifest.files,
      [tag]: decodedBytes === undefined
        ? { url: file.url, sha256: file.sha256 }
        : { url: file.url, sha256: file.sha256, decodedBytes },
    },
  });
  assert.equal(perturbed.catalogFingerprint, manifest.catalogFingerprint,
    "decodedBytes is transport-only (plan 6.1:1927), so perturbing it must not move catalog identity");
  return perturbed;
}

/** Plan 6.2:2072-2079 — a byte failure keeps the `limit` stage; only `fetch`/`read` are defaults. */
function assertLimitFailure(/** @type {any} */ error, /** @type {string} */ locale) {
  assert.equal(error?.name, "StringsLoadingError");
  assert.equal(error?.failures?.length, 1);
  assert.equal(error?.failures?.[0]?.locale, locale);
  // The STAGE, not merely "it rejected": `limit` is what distinguishes the length rule firing from
  // the hash firing. Plan 6.2:2072-2074 names byte-limit among the rejecting causes and :2078-2079
  // keeps later byte failures at their named stage. If the port ever charged a decodedBytes mismatch
  // to another stage that is a FINDING for the maintainer, never a reason to relax this line — this
  // project has already absorbed one real exactness defect by widening an attribution rule.
  assert.equal(error?.failures?.[0]?.stage, "limit");
}

test("9c: a body longer than the declared decodedBytes is refused at the limit stage", async () => {
  const manifest = await cdnPlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  const error = await loadEntireManifest(declaring(manifest, "fr", actual - 4), { fetch: transport.impl })
    .then(() => null, (e) => e);

  assertLimitFailure(error, "fr");
  assert.equal(transport.calls.length, 2, "and the refusal happened while reading, not before I/O");

  // THE CONTROL: the one perturbation reverted, everything else identical. The served bytes are the
  // ones the manifest's digest describes, so the ONLY fault in the probe was the declared length.
  const clean = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  const loaded = await loadEntireManifest(manifest, { fetch: clean.impl });
  assert.equal(loaded.complete, true);
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);
});

test("9c: under allow-partial the overrun is still a limit failure and the fallback still loads", async () => {
  // `allow-partial` is the arm where a length rule that silently gave up would be least visible: the
  // load would SUCCEED, carrying a catalog whose bytes disagree with what the publisher declared.
  const manifest = await cdnPlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  const loaded = await loadStrings(declaring(manifest, "fr", actual - 4), "fr",
    { fetch: transport.impl, partialFailure: "allow-partial" });

  assert.equal(loaded.complete, false);
  assert.equal(loaded.failures.length, 1);
  assert.equal(loaded.failures[0]?.locale, "fr");
  assert.equal(loaded.failures[0]?.stage, "limit");
  assert.deepEqual(Object.keys(loaded.catalogs), ["en"], "the fallback loaded; fr did not");
});

test("9d: a body shorter than the declared decodedBytes is refused at the limit stage", async () => {
  // THE DIRECTION A CHECK WRITTEN INSIDE THE STREAMING LOOP CANNOT SEE. Plan 6.2:2090 says the rule is
  // "enforced while streaming", and `if (total > expected) fail` inside the loop obeys that sentence,
  // passes 9c, and is structurally incapable of noticing a body that simply stops early.
  const manifest = await cdnPlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  const error = await loadEntireManifest(declaring(manifest, "fr", actual + 4), { fetch: transport.impl })
    .then(() => null, (e) => e);

  assertLimitFailure(error, "fr");

  const clean = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  assert.equal((await loadEntireManifest(manifest, { fetch: clean.impl })).complete, true);
});

test("9d CONTROL: with decodedBytes absent the same body loads — no expectation is synthesized", async () => {
  // The field is OPTIONAL (plan 6.1:1911). A loader that invented an expectation when the publisher
  // declared none would refuse a perfectly good manifest. The stub sends no headers at all, which is
  // what keeps this control independent of the Content-Length propositions below.
  const manifest = await cdnPlain();
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  const loaded = await loadEntireManifest(declaring(manifest, "fr", undefined), { fetch: transport.impl });

  assert.equal(loaded.complete, true);
  assert.equal(/** @type {any} */ (loaded.requestedFiles.find((e) => e.locale === "fr")).expectedDecodedBytes,
    undefined, "the plan carries no expectation, so none can be compared");
});

test("9e: the declared length counts the BOM the transport delivered", async () => {
  // The length half of "before UTF-8 decoding or BOM removal" (plan 6.1:1912). Clause 26 gates the
  // BOM for the DIGEST on both doors; nothing gated it for the COUNTER, and they are different lines
  // feeding different comparisons — one a hash, one an integer.
  const manifest = await cdnBom();
  const declared = /** @type {any} */ (manifest.files).fr.decodedBytes;
  assert.equal(declared, BOM_FR.byteLength, "the publisher counted all three BOM octets");

  const transport = servingFetch({ en: PLAIN_EN, fr: BOM_FR });
  const error = await loadEntireManifest(declaring(manifest, "fr", declared - 3), { fetch: transport.impl })
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");
});

test("9e CONTROL: a BOM-prefixed catalog loads and no U+FEFF survives in a key or a value", async () => {
  // THE OPPOSITE DIRECTION ON THE SAME THREE BYTES. An ablation that counts after BOM removal makes
  // the probe above succeed where it must fail AND makes this control fail where it must succeed —
  // a signature no message-only or already-dead-field explanation survives.
  //
  // It depends on the bounded parser stripping a leading BOM at DECODE, which plan 6.1:1912
  // presupposes by naming the removal. A red here is a parser finding, not a clause-9 verdict.
  const manifest = await cdnBom();
  const transport = servingFetch({ en: PLAIN_EN, fr: BOM_FR });
  const loaded = await loadEntireManifest(manifest, { fetch: transport.impl });
  assert.equal(loaded.complete, true);

  const strings = createStrings({ loaded, locale: "fr" });
  assert.equal(strings.get("Hi"), "bonjour");
  for (const key of strings.getKeysForLocale("fr"))
    assert.ok(!key.includes("﻿"), `no BOM may survive into a key; saw ${JSON.stringify(key)}`);
});

test("9f: the file door refuses an over-long body at the limit stage", async () => {
  // THE RULE IS THE SHARED RUNNER'S, NOT THE FETCH TRANSPORT'S. Plan 6.2:2090 sits in a Required-
  // behavior list that names the Node door explicitly at :2078, and the two doors hash by different
  // mechanisms (:2094-2099: one-shot WebCrypto over an assembled body vs. incremental node:crypto
  // over onChunk) — so a green Fetch suite is evidence about the Fetch transport and nothing else.
  // These four tests read from the REAL filesystem through the door's own streaming reader.
  const manifest = await filePlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const error = await loadEntireManifestFromFiles(declaring(manifest, "fr", actual - 4))
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");
});

test("9f: the file door refuses an under-long body at the limit stage", async () => {
  const manifest = await filePlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const error = await loadEntireManifestFromFiles(declaring(manifest, "fr", actual + 4))
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");
});

test("9f: loadStringsFromFiles enforces it on the lookup subset too", async () => {
  // The other Node entry point drives the same runner with the same transport, but through
  // `fetchSet` rather than `wholeManifestPlan`; both are stated as obeying the rule.
  const manifest = await filePlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const error = await loadStringsFromFiles(declaring(manifest, "fr", actual + 4), "fr")
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");
});

test("9f CONTROL: the unperturbed file: manifest loads, and both doors carry the same identity", async () => {
  const onDisk = await filePlain();
  const served = await cdnPlain();
  // The cross-door control: the two manifests are the same catalogs published at two locations, so
  // outcomes are comparable rather than two unrelated fixtures. Identity excludes `baseUrl` and every
  // per-file `url` (plan 6.1:1927), which is exactly why this equality holds.
  assert.equal(onDisk.catalogFingerprint, served.catalogFingerprint);

  const loaded = await loadEntireManifestFromFiles(onDisk);
  assert.equal(loaded.complete, true);
  assert.deepEqual(loaded.failures, []);
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);

  const viaFetch = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR });
  assert.equal((await loadEntireManifest(served, { fetch: viaFetch.impl })).complete, true);
});

test("9e: the Node door counts the BOM in the declared length too", async () => {
  const manifest = await fileBom();
  const declared = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const error = await loadEntireManifestFromFiles(declaring(manifest, "fr", declared - 3))
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");
});

test("9i: the Node door hashes RAW FILE BYTES — a BOM-carrying catalog verifies and parses", async () => {
  // "Node hashes raw file bytes" (plan 6.1:1913) gets its own control rather than being inferred from
  // a BOM ablation recorded under clause 26, whose own statement is about parse ORDER. The publisher
  // hashed the octets including the BOM; a door that hashed the decoded text would disagree with it
  // on this file and on no other, which is what makes the file the instrument.
  const manifest = await fileBom();
  const loaded = await loadEntireManifestFromFiles(manifest);
  assert.equal(loaded.complete, true);
  assert.equal(createStrings({ loaded, locale: "fr" }).get("Hi"), "bonjour");
});

// ------------------------------------------------------------------- the Content-Length channel

/** The encoded size a gzip content coding would advertise for a body. */
const gzippedLength = (/** @type {Uint8Array} */ bytes) => gzipSync(Buffer.from(bytes)).byteLength;

test("9g: a content-coded response whose Content-Length disagrees with decodedBytes loads", async () => {
  // THE CLAUSE'S ONE NEGATIVE PROPOSITION (plan 6.1:1914), and the reason it has stayed invisible:
  // every other fixture in this repo is identity-coded, so header and body length agree and an
  // equality check against `decodedBytes` never fires. The shape here is the one a browser exposes
  // after transparent decoding — headers as sent, body already decoded.
  const manifest = await cdnPlain();
  const declared = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const encodedLength = gzippedLength(PLAIN_FR);

  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR }, {
    headersFor: (locale) => (locale === "fr"
      ? { "content-type": "application/json", "content-encoding": "gzip", "content-length": String(encodedLength) }
      : { "content-type": "application/json" }),
  });
  const loaded = await loadEntireManifest(manifest, { fetch: transport.impl });

  assert.equal(transport.calls.length, 2, "asserted first: a completed load with zero fetches is not a pass");
  assert.equal(loaded.complete, true, "an encoded Content-Length is never compared for equality to decodedBytes");
  assert.equal(createStrings({ loaded, locale: "fr" }).get("Hi"), "bonjour le monde entier");

  // ANTI-VACUITY, read off the response object the LOADER actually received rather than a locally
  // built twin — as written the other way round, these assert the fixture and not what was seen.
  const seen = /** @type {any} */ (transport.served.find((row) => row.locale === "fr")).response;
  const header = seen.headers.get("content-length");
  assert.ok(header !== null, "the probe is vacuous unless the loader saw a Content-Length");
  assert.notEqual(Number(header), declared,
    "and unless it DISAGREES with decodedBytes — equal numbers exercise nothing");
  assert.equal(seen.headers.get("content-encoding"), "gzip");
});

test("9g CONTROL: an identity-coded response whose Content-Length agrees loads", async () => {
  // Its job is to PASS under the equality-check ablation. That is what attributes the red above to
  // the header disagreeing rather than to header handling in general or to the stub.
  const manifest = await cdnPlain();
  const declared = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR }, {
    headersFor: (locale) => (locale === "fr" ? { "content-length": String(declared) } : {}),
  });
  assert.equal((await loadEntireManifest(manifest, { fetch: transport.impl })).complete, true);
});

test("9g: a REAL gzip response over loopback loads, digest and length taken over the decoded bytes", async () => {
  // The end-to-end instrument: no injected transport, the host's own fetch, a real content coding.
  // It is also the only evidence available that the digest covers POST-coding bytes — through
  // `response.body` an implementation cannot obtain the encoded octets at all, so the "hashed the
  // encoded representation" arm is unreachable rather than merely untested.
  const server = createServer((request, response) => {
    const name = (request.url ?? "").split("/").pop() ?? "";
    const bytes = /** @type {any} */ (PLAIN_FILES)[name];
    if (bytes === undefined) { response.writeHead(404); response.end(); return; }
    const encoded = gzipSync(Buffer.from(bytes));
    response.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": String(encoded.byteLength),
    });
    response.end(encoded);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));

  try {
    const port = /** @type {any} */ (server.address()).port;
    const manifest = await publish(PLAIN_DIR, PLAIN_FILES, `http://127.0.0.1:${port}/v1/`);
    const declared = /** @type {any} */ (manifest.files).fr.decodedBytes;

    // THE HOST PRECONDITION, EXECUTABLE AND FAILING RATHER THAN SKIPPING (S3's rule). Measured on
    // this host: undici decompresses the body and still reports the ENCODED content-length, so the
    // probe is live. If a runtime ever stops exposing it, this assertion goes red and says the probe
    // has become inert — it must never report green by accident.
    const probe = await fetch(`http://127.0.0.1:${port}/v1/fr.json`);
    const header = probe.headers.get("content-length");
    const body = new Uint8Array(await probe.arrayBuffer());
    assert.ok(header !== null,
      "this host no longer exposes Content-Length on a decompressed response, so this probe is INERT " +
      "for the Content-Length proposition; the injected-fetch probe above is where it is discriminated");
    assert.notEqual(Number(header), declared, "the header describes the encoded representation");
    assert.equal(body.byteLength, declared, "and the body exposes the decoded one");

    const loaded = await loadEntireManifest(manifest);
    assert.equal(loaded.complete, true);
    assert.equal(createStrings({ loaded, locale: "fr" }).get("Hi"), "bonjour le monde entier",
      "the digest declared over the PLAIN bytes verified against what the body exposed");
  } finally {
    server.close();
  }
});

test("9h: a header that AGREES does not excuse a body that is longer", async () => {
  // 9g's mirror, and neither alone is sufficient: a loader that trusts the header passes this and
  // fails 9g; one that ignores decodedBytes passes 9g and fails this, 9c and 9d. Only a loader that
  // compares the declaration to the STREAMED OCTET COUNT and never to a header passes all four —
  // which is plan 4.2:1527-1528 ("the streamed decoded count remains authoritative") made falsifiable.
  //
  // Nothing here is hand-edited except `decodedBytes`: the body is the real file, its digest matches,
  // and the header is set to the same wrong number the manifest declares.
  const manifest = await cdnPlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const understated = actual - 5;
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR }, {
    headersFor: (locale) => (locale === "fr" ? { "content-length": String(understated) } : {}),
  });

  const error = await loadEntireManifest(declaring(manifest, "fr", understated), { fetch: transport.impl })
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");
});

test("9h: a header that AGREES does not excuse a body that is shorter", async () => {
  const manifest = await cdnPlain();
  const actual = /** @type {any} */ (manifest.files).fr.decodedBytes;
  const overstated = actual + 5;
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR }, {
    headersFor: (locale) => (locale === "fr" ? { "content-length": String(overstated) } : {}),
  });

  const error = await loadEntireManifest(declaring(manifest, "fr", overstated), { fetch: transport.impl })
    .then(() => null, (e) => e);
  assertLimitFailure(error, "fr");

  // THE CONTROL for both halves: header and declaration corrected to the true streamed length.
  const clean = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR }, {
    headersFor: (locale) => (locale === "fr" ? { "content-length": String(actual) } : {}),
  });
  assert.equal((await loadEntireManifest(manifest, { fetch: clean.impl })).complete, true);
});

test("9j: with decodedBytes absent, a content-length is not synthesized into an expectation", async () => {
  // THE INPUT EVERY OTHER CONJUNCT LEAVES OPEN. 9g's rule is about a DECLARED length; with none
  // declared, a loader that adopted a finite Content-Length as the decoded expectation would violate
  // plan 4.2:1525-1526 ("never a decoded-limit enforcement signal") and pass every other test here.
  // The header is the gzipped length, so adopting it refuses a catalog that is entirely correct.
  const manifest = await cdnPlain();
  const transport = servingFetch({ en: PLAIN_EN, fr: PLAIN_FR }, {
    headersFor: (locale) => (locale === "fr"
      ? { "content-encoding": "gzip", "content-length": String(gzippedLength(PLAIN_FR)) }
      : {}),
  });

  const loaded = await loadEntireManifest(declaring(manifest, "fr", undefined), { fetch: transport.impl });
  assert.equal(transport.calls.length, 2);
  assert.equal(loaded.complete, true);
  assert.notEqual(gzippedLength(PLAIN_FR), PLAIN_FR.byteLength,
    "the fixture is only meaningful while the encoded and decoded lengths differ");
});
