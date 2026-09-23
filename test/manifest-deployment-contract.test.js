// @ts-check
/**
 * WHAT A DEPLOYMENT CAN RELY ON FROM A MANIFEST — M8 acceptance clause 6.
 *
 * The clause: "The manifest is self-versioned and binds every translation body by digest. Production
 * HTTP(S) URLs are immutable for a catalog version—either digest-derived or explicitly versioned—
 * while a Node-generated development `file:` manifest may point directly at its scanned source files.
 * Service workers may runtime-cache translations but do not precache the entire catalog."
 * (plan 6.1:1934-1937.)
 *
 * **WHY THE OBVIOUS PROBES FAIL, one per half, because each fails differently.**
 *
 * 1. **SELF-VERSIONED.** The obvious probe hands the validator `{formatVersion: 2, …}` and asserts a
 *    refusal. It is green over a port with NO version check at all, because a carelessly built v2
 *    fixture still carries a v1-derived `catalogFingerprint` and the fingerprint recompute refuses it
 *    first — the zh-123 shape, and this project has already shipped a manifest fixture whose
 *    placeholder fingerprint pre-empted the guard it was written for. The discriminating arm is a v2
 *    manifest whose declared fingerprint is what the PORT would recompute (measured: the projection
 *    hard-codes `formatVersion: 1`, plan 6.1:1921-1923, so that value is the v1 fingerprint), and it
 *    is paired with the other spelling — recomputed over a projection spelling `2` — with a
 *    PRECONDITION assertion that the two differ. If a later change collapses them, the pair goes red
 *    as a fixture fault instead of passing.
 *
 * 2. **THE FINGERPRINT RECOMPUTE.** A probe that builds its expected fingerprint by calling
 *    `computeCatalogIdentity` can only prove the port agrees with itself. Every fixture here declares
 *    a fingerprint computed by an INDEPENDENT RFC 8785 canonicalizer plus `node:crypto` (`jcs` and
 *    `harnessFingerprint` below), so the control is evidence that the port's projection agrees with
 *    an outside implementation, not merely that it is deterministic. And the same mutation is driven
 *    through `parseStringsManifest`, `validateStringsManifest` and a loader SEPARATELY: plan
 *    6.1:1893-1895 names all four doors, and a single-door probe reports green over a two-thirds
 *    missing check.
 *
 * 3. **DIGEST-BINDS EVERY BODY.** "Every" is a quantifier and a one-file fixture cannot falsify it, so
 *    the corruption is run at the FIRST, a MIDDLE and the LAST plan position and at the subset door as
 *    well as the whole-manifest one. The swapped body is a VALID, parseable catalog of EXACTLY the
 *    same octet length as the one it replaces — valid so the observation is rendered CONTENT rather
 *    than an exception (a garbage body would fail at `parse` and leave a "it threw" assertion green
 *    over a loader that stopped checking digests), and same-length because `readBoundedStream`
 *    enforces a declared `decodedBytes` BEFORE the digest (plan 6.2:2090) and the generator emits that
 *    field, so a different length would let `limit` pre-empt every ablation in this group.
 *
 * 4. **"BEFORE ANY CATALOG I/O" IS ONLY FALSIFIABLE BY NON-INVOCATION.** A check moved downstream
 *    still throws, so a throw-only assertion is blind to it; S11a measured the degradation it causes
 *    under `allow-partial`, where a demoted refusal becomes a SUCCESSFUL load that silently skipped a
 *    file the caller named. Every refusal below therefore carries a transport that RECORDS each call
 *    and the assertion is that it recorded NONE, and the scheme-boundary group runs under BOTH
 *    partial-failure policies.
 *
 * 5. **THE DEV `file:` HALF IS A PERMISSION**, and a permission is falsifiable only as a refusal plus
 *    a demonstration of use. So it is split: the shared validator must not reject `file:` (with an
 *    absolute, parseable refusal set beside it, or the acceptance half is satisfied by the empty
 *    check — the S5 one-directional-allowlist shape), and the generated `file:` URLs must actually
 *    dereference to the files the walk found. The discriminating power of the second half sits
 *    entirely in names an author would not have chosen: `en-US.JSON`, and two EXTENSIONLESS catalogs.
 *
 * **WHAT THIS FILE DOES NOT PROVE, said here rather than left to a ledger reader.**
 *
 *   - "Service workers must not precache the entire catalog set" is a prescription to an APPLICATION
 *     that the library never observes; there is no service worker in this package and it SHIPS the
 *     whole-catalog operation the sentence warns about, by design. The nearest proposition the library
 *     owns is plan 6.2:2101's "no hidden process-global or browser-global catalog cache" plus "requests
 *     exactly the planned fetch set". The cache half is proven at length in
 *     `test/no-global-catalog-cache.test.js` against an enumerated family; the fetch-set half is the
 *     last group here. Neither is the clause's sentence.
 *   - "Production HTTP(S) URLs are immutable for a catalog version" is a property of a DEPLOYMENT over
 *     time. Nothing at runtime sees two publications of one `catalogVersion`. Three residues are
 *     checkable and all three are below: identity moves when a body moves, a body mutated at a stable
 *     URL is refused rather than served, and a version-bearing publication base survives generation.
 *   - "—either digest-derived or explicitly versioned—" is enforced NOWHERE and the plan gives the
 *     generator no mechanism for it (`DirectoryManifestOptions`, plan 6.2:2027-2033, has one
 *     caller-supplied `publicationBaseUrl` and no URL mode). The checkable claim is that the base is
 *     not MANGLED, which is what the publication-URL group asserts.
 *
 * **OVERLAP IS DELIBERATE IN EXACTLY TWO PLACES AND NOWHERE ELSE.** `test/digest-before-parse.test.js`
 * already discriminates the digest/parse ORDER (clause 26) with the pairing this design would have
 * built, and `test/catalog-identity.test.js` already pairs every excluded identity field with an
 * included-field control at the `computeCatalogIdentity` level. Rewriting either here would be
 * decoration. What is NEW is that the identity claims are driven through the manifest DOORS and read
 * off `LoadedStrings.catalogIdentity` — a different code path, which could re-derive the projection
 * wrongly — and that they are checked against an outside canonicalizer.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { rmSync } from "node:fs";

import { createStrings } from "../src/core/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import {
  fetchSet, loadEntireManifest, loadStrings, parseStringsManifest, validateStringsManifest,
} from "../src/load/index.js";
import {
  createStringsManifestFromDirectory, loadEntireManifestFromFiles, readStringsFromDirectory,
} from "../src/node/index.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const utf8 = new TextEncoder();
const root = mkdtempSync(join(tmpdir(), "lokalized-clause6-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Every catalog is this shape, so a corrupted body can be built at exactly the same octet length. */
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Greeting: `hello ${tag}` });
/** 23 octets, the same as `bodyFor` of any two-letter tag — asserted, not assumed, in its own group. */
const SWAPPED_BODY = JSON.stringify({ Greeting: "SWAPPED!" });

// =================================================================================================
// THE INDEPENDENT ORACLE
//
// A bounded RFC 8785 canonicalizer written from the specification, plus `node:crypto`. It is what
// makes the fingerprint controls below evidence rather than self-consistency: the port has its own
// canonicalizer and its own audited SHA-256, and a probe that called them to build its expectation
// would pass over a canonicalizer that was wrong in a self-consistent way. Bounded on purpose — it
// REFUSES anything the catalog identity projection cannot contain (plan 6.1:1921-1923: a literal 1,
// two strings, a string->string map and a string->string[] map) rather than approximating the rest.
// =================================================================================================

/** @param {unknown} value @returns {string} */
function jcs(value) {
  if (typeof value === "string") return JSON.stringify(value);
  // The projection's only number is the literal `formatVersion`. RFC 8785 number serialization is
  // ECMAScript `Number::toString` for anything else, and approximating it is how a canonicalizer
  // quietly becomes wrong, so a non-integer is refused rather than guessed.
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`this canonicalizer does not serialize ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (value !== null && typeof value === "object") {
    // RFC 8785 sorts members by their UTF-16 code units, which for the ASCII keys in this projection
    // is plain lexicographic order. Said out loud because it is NOT code-point order in general.
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${jcs(/** @type {any} */ (value)[key])}`).join(",")}}`;
  }
  throw new Error(`this canonicalizer does not serialize ${String(value)}`);
}

/**
 * The catalog fingerprint, computed OUTSIDE the port.
 *
 * @param {any} manifest
 * @param {number} [formatVersion] the value to spell in the PROJECTION, which is not always the value
 *   spelled in the manifest — see the `formatVersion` group.
 */
function harnessFingerprint(manifest, formatVersion = 1) {
  /** @type {Record<string, unknown>} */
  const localeToSha256 = {};
  for (const [tag, file] of Object.entries(manifest.files))
    // A missing `sha256` is projected as an ABSENT member, which is what JSON does with an undefined
    // value. Stated because RFC 8785 canonicalizes JSON, which has no `undefined`, so what the PORT
    // projects for a missing member is not knowable from out here — the arm that needs this asserts
    // an admissible-outcome disjunction rather than a single expected message.
    if (/** @type {any} */ (file).sha256 !== undefined)
      localeToSha256[tag] = /** @type {any} */ (file).sha256;

  return createHash("sha256").update(Buffer.from(jcs({
    formatVersion,
    catalogVersion: manifest.catalogVersion,
    resolvedFallbackLocale: manifest.fallbackLocale,
    localeToSha256,
    tiebreakers: manifest.tiebreakers ?? {},
  }), "utf8")).digest("hex");
}

/**
 * A manifest fixture whose declared fingerprint comes from the HARNESS, never from the port.
 *
 * @param {readonly string[]} tags
 * @param {{ fallbackLocale?: string, baseUrl?: string, tiebreakers?: Record<string, string[]>,
 *   decodedBytes?: boolean, urls?: Record<string, string> }} [options]
 */
function manifestFor(tags, options = {}) {
  const { fallbackLocale = "en", baseUrl = "https://cdn.example/v1/", tiebreakers = {},
    decodedBytes = false, urls = {} } = options;
  /** @type {any} */
  const files = {};
  for (const tag of tags) {
    const bytes = utf8.encode(bodyFor(tag));
    files[tag] = {
      url: urls[tag] ?? `${tag}.json`,
      sha256: sha256Hex(bytes),
      ...(decodedBytes ? { decodedBytes: bytes.length } : {}),
    };
  }
  const draft = /** @type {any} */ ({
    formatVersion: 1,
    catalogVersion: "v1",
    catalogFingerprint: "0".repeat(64),
    // READ FROM THE RUNTIME'S OWN PROVENANCE, never hard-coded: hard-coding would turn the next data
    // regeneration into a red in this file for a reason that has nothing to do with clause 6.
    ...BUILD_IDENTITY,
    fallbackLocale,
    baseUrl,
    files,
    tiebreakers,
  });
  draft.catalogFingerprint = harnessFingerprint(draft);
  return draft;
}

/** A Fetch response over one chunk. `headers` is exercised only by the `decodedBytes` group. */
function streamed(/** @type {Uint8Array} */ bytes, /** @type {Record<string, string>} */ headers = {}) {
  let sent = false;
  return {
    ok: true, status: 200, headers: new Headers(headers),
    body: { getReader: () => ({
      read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
      cancel: async () => {},
    }) },
  };
}

/**
 * A transport that RECORDS every call, so "no catalog I/O happened" is falsifiable.
 *
 * `corrupt` names one locale whose body is replaced with a valid, same-length, different catalog.
 */
function recordingFetch({ corrupt = /** @type {string | null} */ (null), headers = /** @type {Record<string, string>} */ ({}) } = {}) {
  /** @type {string[]} */
  const calls = [];
  return { calls, impl: async (/** @type {string} */ url) => {
    calls.push(url);
    const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
    return streamed(utf8.encode(tag === corrupt ? SWAPPED_BODY : bodyFor(tag)), headers);
  } };
}

/** The Node door's mirror. */
function recordingReader() {
  /** @type {string[]} */
  const calls = [];
  return { calls, impl: async (/** @type {string} */ url) => {
    calls.push(url);
    return utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "")));
  } };
}

const rejection = async (/** @type {Promise<unknown>} */ promise) => promise.then(() => null, (error) => error);

/** A fresh fixture directory holding the named files verbatim. */
function directory(/** @type {Record<string, string>} */ contents, name = "d") {
  const path = mkdtempSync(join(root, `${name}-`));
  for (const [fileName, content] of Object.entries(contents)) writeFileSync(join(path, fileName), content);
  return path;
}

// =================================================================================================
// SELF-VERSIONED, part 1 — the format version, refused as a SCHEMA failure before any catalog I/O.
// =================================================================================================

test("clause 6: a manifest that is not formatVersion 1 is refused, and nothing is fetched", async () => {
  const valid = manifestFor(["en", "fr"]);

  // THE TWO SPELLINGS OF THE v2 ARM, and the precondition that keeps the pair honest. The port's
  // projection hard-codes `formatVersion: 1` (plan 6.1:1921-1923), so `asV1` is the fingerprint the
  // port will RECOMPUTE for a v2 manifest — which means the version check is the only thing standing
  // between it and a successful load. `asV2` is what an outside reader would compute for a genuine v2
  // format, and it cannot pass the recompute whatever the version check does.
  const asV2 = { ...valid, formatVersion: 2, catalogFingerprint: harnessFingerprint(valid, 2) };
  const asV1 = { ...valid, formatVersion: 2, catalogFingerprint: valid.catalogFingerprint };
  assert.notEqual(asV2.catalogFingerprint, asV1.catalogFingerprint,
    "if these ever collapse the pair proves nothing, so it goes red as a fixture fault rather than green");

  for (const [label, arm] of /** @type {[string, any][]} */ ([
    ["fingerprinted as v2", asV2],
    ["fingerprinted as the port recomputes", asV1],
    ["the string \"1\"", { ...valid, formatVersion: "1" }],
    ["absent", (() => { const copy = { ...valid }; delete (/** @type {any} */ (copy)).formatVersion; return copy; })()],
  ])) {
    // EVERY DOOR SEPARATELY. The text door is where a published manifest actually arrives; the object
    // door is what a caller who parsed it themselves reaches; and only the LOADER call can carry a
    // meaningful empty-recorder assertion, because a refusal inside `parseStringsManifest` would put
    // that assertion behind a condition that never became true.
    assert.throws(() => parseStringsManifest(JSON.stringify(arm)),
      (error) => /** @type {any} */ (error).name === "ConfigurationError", `${label}: text door`);
    assert.throws(() => validateStringsManifest(arm),
      (error) => /** @type {any} */ (error).name === "ConfigurationError", `${label}: object door`);

    const transport = recordingFetch();
    const error = await rejection(loadEntireManifest(arm, { fetch: transport.impl }));
    assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError", `${label}: loader`);
    assert.equal(transport.calls.length, 0, `${label}: refused before any catalog I/O`);
  }
});

test("clause 6: the formatVersion refusal NAMES the version — pinned wording, not the discriminator", () => {
  // Plan 6.2:1082/:1120 give every configuration failure ONE code, `CONFIGURATION`, so "refused for
  // THAT reason" is not observable through the taxonomy. The observation the group above rests on is
  // refuse-with-zero-requests versus returns-a-LoadedStrings. This is the wording pin that goes with
  // it, in the style of `DECLARED_MESSAGE_DIVERGENCES`: exact, and STALE if it stops matching.
  const valid = manifestFor(["en"]);
  for (const arm of [{ ...valid, formatVersion: 2, catalogFingerprint: valid.catalogFingerprint },
    { ...valid, formatVersion: 2, catalogFingerprint: harnessFingerprint(valid, 2) }])
    assert.throws(() => validateStringsManifest(arm),
      /A strings manifest must declare formatVersion 1; received 2/,
      "both v2 spellings must give the SAME reason; a fingerprint mismatch here would mean the schema " +
      "check runs out of order relative to plan 6.2:2072");
});

test("clause 6: THE CONTROL — the same fixture at formatVersion 1 loads end to end and renders", async () => {
  const transport = recordingFetch();
  const loaded = await loadEntireManifest(manifestFor(["en", "fr"]), { fetch: transport.impl });
  assert.equal(loaded.complete, true);
  assert.equal(transport.calls.length, 2, "and the recorder is a live instrument, not always empty");
  assert.equal(createStrings({ loaded, locale: "fr" }).get("Greeting"), "hello fr");
});

// =================================================================================================
// SELF-VERSIONED, part 2 — the declared fingerprint is RECOMPUTED at every door, before I/O.
// =================================================================================================

test("clause 6: a manifest that misdescribes its own catalog set is refused at all three doors", async () => {
  const base = manifestFor(["en", "fr", "fr-CA"], { tiebreakers: { fr: ["fr-CA", "fr"] } });

  /** Each arm mutates a field that is INSIDE the identity projection, leaving the declaration alone. */
  const arms = /** @type {[string, any][]} */ ([
    ["one hex character of one digest", (() => {
      const copy = { ...base, files: { ...base.files, fr: { ...base.files.fr } } };
      copy.files.fr.sha256 = copy.files.fr.sha256.replace(/^./, (/** @type {string} */ c) => (c === "0" ? "1" : "0"));
      return copy;
    })()],
    ["the catalogVersion", { ...base, catalogVersion: "v2" }],
    // A DIFFERENT LOCALE, never a respelling: `en` -> `EN` would normalize back to the same
    // `resolvedFallbackLocale` and the arm would expect a refusal that correctly never comes.
    ["the fallbackLocale", { ...base, fallbackLocale: "fr" }],
    ["the ORDER of a tiebreaker list", { ...base, tiebreakers: { fr: ["fr", "fr-CA"] } }],
  ]);

  for (const [label, arm] of arms) {
    // THE FIXTURE PRECONDITION. A mutation that silently failed to move the computed value would make
    // the refusal below unattributable, and this project has shipped that shape twice.
    assert.notEqual(harnessFingerprint(arm), arm.catalogFingerprint,
      `${label}: the mutation must move the independently computed fingerprint, or the arm proves nothing`);

    assert.throws(() => parseStringsManifest(JSON.stringify(arm)),
      (error) => /** @type {any} */ (error).name === "ConfigurationError", `${label}: text door`);
    assert.throws(() => validateStringsManifest(arm),
      (error) => /** @type {any} */ (error).name === "ConfigurationError", `${label}: object door`);

    // THE DOOR THAT MAKES A PARTIAL IMPLEMENTATION VISIBLE. "The caller already parsed it, so it must
    // be fine" is the plausible shortcut, and plan 6.1:1893-1895 forbids it by naming all four doors.
    // A probe that only ran `parseStringsManifest` would report green over it.
    const transport = recordingFetch();
    const error = await rejection(loadEntireManifest(arm, { fetch: transport.impl }));
    assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError", `${label}: loader`);
    assert.equal(transport.calls.length, 0, `${label}: refused before any catalog I/O`);
  }
});

test("clause 6: THE CONTROL — the port's projection agrees with an OUTSIDE RFC 8785 implementation", async () => {
  // This is the assertion that makes the group above evidence rather than self-consistency: every
  // fixture in this file declares a fingerprint this harness computed, so a port whose canonicalizer
  // were wrong in a self-consistent way would refuse all of them here.
  const base = manifestFor(["en", "fr", "fr-CA"], { tiebreakers: { fr: ["fr-CA", "fr"] } });
  assert.equal(validateStringsManifest(base).catalogFingerprint, base.catalogFingerprint);
  assert.equal(parseStringsManifest(JSON.stringify(base)).catalogFingerprint, base.catalogFingerprint);

  const transport = recordingFetch();
  const loaded = await loadEntireManifest(base, { fetch: transport.impl });
  assert.equal(loaded.complete, true);
  assert.equal(loaded.catalogIdentity.catalogFingerprint, base.catalogFingerprint);
});

// =================================================================================================
// IDENTITY BINDS CONTENT AND VERSION, NOT TRANSPORT — at the DOORS, and on a loaded record.
// =================================================================================================

test("clause 6: a CDN copy carries the same identity; a changed body, version or order does not", async () => {
  const origin = manifestFor(["en", "fr", "fr-CA"], { tiebreakers: { fr: ["fr-CA", "fr"] }, decodedBytes: true });

  // Transport changed in all three excluded ways at once: a different host, per-file urls rewritten
  // from relative to absolute at a different path depth, and `decodedBytes` dropped on half the
  // entries and perturbed on the other half. The DECLARATION is `origin`'s, untouched.
  const cdn = {
    ...origin,
    baseUrl: "https://static.other.example/build-9/catalogs/",
    files: {
      en: { url: "https://static.other.example/build-9/catalogs/deep/en.json", sha256: origin.files.en.sha256 },
      fr: { url: "https://static.other.example/build-9/catalogs/fr.json", sha256: origin.files.fr.sha256, decodedBytes: 9999 },
      "fr-CA": { url: "fr-CA.json", sha256: origin.files["fr-CA"].sha256, decodedBytes: 1 },
    },
  };
  assert.equal(harnessFingerprint(cdn), origin.catalogFingerprint,
    "the independent oracle must agree the mutation is identity-neutral before the port is asked");
  assert.equal(validateStringsManifest(cdn).catalogFingerprint, origin.catalogFingerprint);

  // THE INCLUDED-FIELD CONTROLS, under the SAME unchanged declaration. Without these, a projection of
  // `{}` — or one that never compared at all — passes the exclusion half completely.
  for (const [label, arm] of /** @type {[string, any][]} */ ([
    ["a flipped digest character", { ...origin, files: { ...origin.files,
      fr: { ...origin.files.fr, sha256: `${origin.files.fr.sha256.slice(0, 63)}${origin.files.fr.sha256.endsWith("a") ? "b" : "a"}` } } }],
    ["a bumped catalogVersion", { ...origin, catalogVersion: "v2" }],
    ["a swapped tiebreaker order", { ...origin, tiebreakers: { fr: ["fr", "fr-CA"] } }],
  ])) {
    assert.notEqual(harnessFingerprint(arm), arm.catalogFingerprint, `${label}: precondition`);
    assert.throws(() => validateStringsManifest(arm),
      (error) => /** @type {any} */ (error).name === "ConfigurationError", label);
  }

  // AND ON THE LOADED RECORD, which is a different code path — `runPlan` assembles `catalogIdentity`
  // itself and could re-derive the projection wrongly while every validator test stayed green. The
  // loadable CDN copy drops `decodedBytes` rather than perturbing it: a wrong declared length is
  // refused at `limit` before the digest (plan 6.2:2090), which would kill the comparison for an
  // unrelated reason.
  const loadableCdn = { ...cdn, files: Object.fromEntries(Object.entries(cdn.files).map(
    ([tag, file]) => [tag, { url: /** @type {any} */ (file).url, sha256: /** @type {any} */ (file).sha256 }])) };
  const here = await loadEntireManifest(origin, { fetch: recordingFetch().impl });
  const there = await loadEntireManifest(loadableCdn, { fetch: recordingFetch().impl });

  assert.notEqual(here.requestedFiles[0]?.url, there.requestedFiles[0]?.url,
    "the two loads really did fetch from different hosts");
  // Null-prototype records: spread before comparing, per the repo's own rule.
  assert.deepEqual({ ...there.catalogIdentity }, { ...here.catalogIdentity });
  assert.equal(here.catalogIdentity.catalogVersion, "v1",
    "the version is carried too, so a port returning a constant identity object is caught");
});

test("clause 6: a lookup SUBSET load identifies the FULL manifest, not what it happened to load", async () => {
  // Plan 6.2:2113. This is what makes "immutable per catalog version" usable by a client that loaded
  // two of eight files: a naive implementation fingerprints what arrived, and a deployment comparing
  // a subset client against a whole-manifest one would then see a spurious divergence.
  const manifest = manifestFor(["de", "en", "fr", "ja"]);
  const subset = await loadStrings(manifest, "fr", { fetch: recordingFetch().impl });
  const whole = await loadEntireManifest(manifest, { fetch: recordingFetch().impl });

  assert.deepEqual(Object.keys(subset.catalogs).sort(), ["en", "fr"], "it really was a subset");
  assert.equal(Object.keys(whole.catalogs).length, 4);
  assert.deepEqual({ ...subset.catalogIdentity }, { ...whole.catalogIdentity });
});

// =================================================================================================
// SELF-VERSIONED, part 3 — the pinned data build, checked before any catalog I/O.
// =================================================================================================

test("clause 6: an incompatible dataFingerprint is refused BEFORE a single body is fetched", async () => {
  // `cldrVersion` and `dataFingerprint` are EXCLUDED from the catalog fingerprint (plan 6.1:1927), so
  // mutating them cannot trip the fingerprint guard — this fixture reaches the check under test with
  // no scaffolding at all, which is unusual in this file and worth saying.
  //
  // Only the arms the plan settles are gated. A manifest whose `cldrVersion` disagrees with an
  // otherwise-valid `dataFingerprint` is an INCONSISTENT input (plan 6.1:1687 defines the fingerprint
  // over `{formatVersion, cldrVersion, artifacts}`, so it genuinely subsumes the version) and whether
  // that is a refusal or the fingerprint is authoritative is a maintainer's call, not an agent's.
  // Recorded as owed rather than asserted here.
  const valid = manifestFor(["en", "fr"]);
  for (const [label, arm] of /** @type {[string, any][]} */ ([
    ["a different dataFingerprint", { ...valid, dataFingerprint: "e".repeat(64) }],
    ["both fields changed", { ...valid, cldrVersion: "1.0", dataFingerprint: "e".repeat(64) }],
  ])) {
    const transport = recordingFetch();
    const error = await rejection(loadEntireManifest(arm, { fetch: transport.impl }));
    assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError", label);
    assert.match(String(/** @type {any} */ (error)?.message), /this build carries CLDR/, label);
    // THE OBSERVATION THAT SEPARATES "before I/O" FROM "eventually". A check performed after the
    // bodies arrived would still throw and leave the two assertions above green.
    assert.equal(transport.calls.length, 0, `${label}: nothing may be fetched against the wrong data build`);
  }

  const transport = recordingFetch();
  const loaded = await loadEntireManifest(valid, { fetch: transport.impl });
  assert.equal(loaded.complete, true);
  assert.deepEqual(transport.calls.sort(),
    ["https://cdn.example/v1/en.json", "https://cdn.example/v1/fr.json"],
    "the control shows the planned requests, so the empty recorders above are attributable");
});

// =================================================================================================
// DIGEST-BINDS EVERY BODY — the structural half: no entry may opt out.
// =================================================================================================

test("clause 6: a file entry with no usable sha256 is refused at validation, naming the FIELD", async () => {
  // THE ENTRY IS DELIBERATELY NOT THE FALLBACK: a loader that special-cased the fallback file would
  // otherwise pass. And the declared fingerprint is left as `origin`'s on purpose — measured, the
  // `sha256` SHAPE check runs before the fingerprint recompute inside `validateStringsManifest`, so
  // the arms reach the check under test. That ordering is exactly what the assertions pin: each arm
  // must be refused NAMING sha256 and must NOT report a fingerprint mismatch, so a reordering that
  // let the fingerprint pre-empt would be visible as a red rather than absorbed as "it threw".
  const origin = manifestFor(["en", "fr"]);
  const withFr = (/** @type {unknown} */ sha256) => ({
    ...origin,
    files: { en: origin.files.en, fr: { url: "fr.json", ...(sha256 === undefined ? {} : { sha256 }) } },
  });

  for (const [label, arm] of /** @type {[string, any][]} */ ([
    ["uppercase hex", withFr(origin.files.fr.sha256.toUpperCase())],
    ["63 characters", withFr(origin.files.fr.sha256.slice(1))],
    ["one non-hex character", withFr(`z${origin.files.fr.sha256.slice(1)}`)],
    ["the empty string", withFr("")],
    ["a number", withFr(123)],
    ["null", withFr(null)],
    // THE ARM THE ABLATION FIRES ON, and its expectation is an admissible-outcome DISJUNCTION rather
    // than one message: what a canonicalizer projects for an ABSENT member is not knowable from
    // outside `src/`, so the requirement is that the refusal be a ConfigurationError naming the field
    // — not a bare TypeError escaping from the canonicalizer, which is the S11b shape.
    ["the key deleted", withFr(undefined)],
  ])) {
    const transport = recordingFetch();
    const error = await rejection(loadEntireManifest(arm, { fetch: transport.impl }));
    assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError", label);
    assert.match(String(/** @type {any} */ (error)?.message), /sha256/, label);
    assert.doesNotMatch(String(/** @type {any} */ (error)?.message), /catalogFingerprint/,
      `${label}: refused for the digest, not pre-empted by the fingerprint recompute`);
    assert.equal(transport.calls.length, 0, label);
  }

  // THE CONTROL: the same entry with a correct lowercase digest loads, and the catalog it names is
  // really reachable — so the arms above died at the digest shape, not in an unrelated guard.
  const loaded = await loadEntireManifest(origin, { fetch: recordingFetch().impl });
  assert.equal(createStrings({ loaded, locale: "fr" }).get("Greeting"), "hello fr");
});

// =================================================================================================
// DIGEST-BINDS EVERY BODY — the behavioural half. "Every" is a quantifier.
// =================================================================================================

test("clause 6: the swapped body is a VALID catalog of the SAME length — the fixture precondition", () => {
  // Both properties are load-bearing and neither is obvious. VALID, so an ablated loader fails the
  // assertions by SERVING different content rather than by throwing a parse error a "it threw"
  // assertion would absorb. SAME LENGTH, because a declared `decodedBytes` is enforced while
  // streaming, ahead of the digest (plan 6.2:2090), and the directory generator emits that field — so
  // a different length would let `limit` pre-empt every ablation in this group.
  for (const tag of ["de", "en", "fr", "ja"])
    assert.equal(utf8.encode(SWAPPED_BODY).length, utf8.encode(bodyFor(tag)).length, tag);
  assert.doesNotThrow(() => JSON.parse(SWAPPED_BODY));
  assert.notEqual(JSON.parse(SWAPPED_BODY).Greeting, JSON.parse(bodyFor("fr")).Greeting);
});

test("clause 6: a body whose digest does not match is refused at EVERY plan position", async () => {
  // Plan order is normalized-tag order (plan 3.4:727), so the plan here is [de, en, fr, ja] and the
  // three arms corrupt the FIRST, a MIDDLE and the LAST file. A one-file fixture cannot falsify
  // "every", and a fallback-only fixture cannot falsify "not just the one that must be right" —
  // `en` is the fallback and is never the corrupted file.
  const manifest = manifestFor(["de", "en", "fr", "ja"]);
  assert.deepEqual(
    (await loadEntireManifest(manifest, { fetch: recordingFetch().impl })).requestedFiles.map((f) => f.locale),
    ["de", "en", "fr", "ja"], "the plan positions this test names are the real ones");

  for (const corrupt of ["de", "fr", "ja"]) {
    const error = await rejection(loadEntireManifest(manifest, { fetch: recordingFetch({ corrupt }).impl }));
    assert.equal(/** @type {any} */ (error)?.name, "StringsLoadingError", corrupt);
    const failures = /** @type {any[]} */ (/** @type {any} */ (error).failures);
    // Cardinality is NOT claimed: plan 6.2:2074-2077 pins ordering and representability, not a total,
    // and a runner recording abort artifacts for in-flight siblings would fail such a claim for an
    // unrelated reason. What is claimed is which locale failed and at which stage.
    assert.deepEqual(failures.filter((f) => f.stage === "digest").map((f) => f.locale), [corrupt], corrupt);
    assert.deepEqual(failures.filter((f) => f.stage === "parse"), [],
      `${corrupt}: the swapped body parses fine, so a parse failure would mean the digest ran second`);

    // THE LOAD-BEARING ASSERTION: the content never reaches a rendered string. Under `allow-partial`
    // the fallback loaded, so the call may return — and it must return WITHOUT that catalog.
    const partial = await loadEntireManifest(manifest,
      { fetch: recordingFetch({ corrupt }).impl, partialFailure: "allow-partial" });
    assert.equal(partial.complete, false, corrupt);
    assert.ok(!(corrupt in partial.catalogs), `${corrupt}: an unverified catalog is not offered`);
    for (const locale of ["de", "en", "fr", "ja"])
      assert.notEqual(createStrings({ loaded: partial, locale }).get("Greeting"), "SWAPPED!",
        `${corrupt}: no instance anywhere may render the unverified body`);
    assert.equal(createStrings({ loaded: partial, locale: corrupt }).get("Greeting"), "hello en",
      `${corrupt}: it falls back instead`);
  }

  // THE CONTROL: identical bytes, correct digests — every catalog resolves from its OWN file, which
  // is what proves `Greeting` is reachable per locale and the assertions above were not vacuous.
  const clean = await loadEntireManifest(manifest, { fetch: recordingFetch().impl });
  assert.equal(clean.complete, true);
  for (const locale of ["de", "en", "fr", "ja"])
    assert.equal(createStrings({ loaded: clean, locale }).get("Greeting"), `hello ${locale}`);
});

test("clause 6: the SUBSET door binds bodies too — it is the one SSR and edge deployments call", async () => {
  // C5/C6 above drive `loadEntireManifest`. A verifier wired into the whole-manifest path only would
  // pass all of it while `loadStrings` — plan 6.2:2132-2145's deployment door — served unverified
  // bytes. The corrupted file is the lookup's own catalog, at plan position 1 of 2.
  const manifest = manifestFor(["de", "en", "fr", "ja"]);
  assert.deepEqual(fetchSet(manifest, "fr").map((entry) => entry.locale), ["fr", "en"]);

  const error = await rejection(loadStrings(manifest, "fr", { fetch: recordingFetch({ corrupt: "fr" }).impl }));
  assert.equal(/** @type {any} */ (error)?.name, "StringsLoadingError");
  assert.deepEqual(/** @type {any[]} */ (/** @type {any} */ (error).failures)
    .map((f) => [f.locale, f.stage]), [["fr", "digest"]]);

  const control = await loadStrings(manifest, "fr", { fetch: recordingFetch().impl });
  assert.equal(createStrings({ loaded: control, locale: "fr" }).get("Greeting"), "hello fr");
});

test("clause 6: two entries pointing at ONE url are bound INDEPENDENTLY, not deduplicated", async () => {
  // The realistic way to break "binds EVERY body" without deleting any digest check: dedupe by
  // resolved URL and verify once. One binding is satisfied and the other is silently dropped, and the
  // manifest fingerprints exactly as it would have — so nothing downstream can detect the loss. The
  // sibling of the shape M8's adversarial manifest already found, where two entry names pointing at
  // one external target collapsed an order-dependent slot out of a message entirely.
  const manifest = manifestFor(["de", "en"], { urls: { de: "en.json" } });
  manifest.files.de.sha256 = "b".repeat(64);
  manifest.catalogFingerprint = harnessFingerprint(manifest);

  const transport = recordingFetch();
  const error = await rejection(loadEntireManifest(manifest, { fetch: transport.impl }));
  assert.equal(/** @type {any} */ (error)?.name, "StringsLoadingError");
  assert.deepEqual(/** @type {any[]} */ (/** @type {any} */ (error).failures)
    .map((f) => [f.locale, f.stage]), [["de", "digest"]],
    "the `de` binding is checked even though `en` already satisfied a binding for the same bytes");
  assert.deepEqual(transport.calls, ["https://cdn.example/v1/en.json", "https://cdn.example/v1/en.json"],
    "and the two entries really did resolve to one target");
});

// =================================================================================================
// THE SECOND BODY BINDING — declared decodedBytes, never an encoded Content-Length.
// =================================================================================================

test("clause 6: decodedBytes is compared to the BODY, and an encoded Content-Length never is", async () => {
  // The two ablations this group exists for fail in OPPOSITE directions — comparing the header is a
  // false positive on a content-coded response, dropping the comparison is a false negative — so both
  // arms are mandatory and a suite with only one of them would ship the other defect.
  //
  // `decodedBytes` is EXCLUDED from the identity projection (plan 6.1:1927), so no arm here needs a
  // recomputed fingerprint. Stated so a later maintainer does not "fix" it.
  const bytes = utf8.encode(bodyFor("en"));
  const ENCODED_LENGTH = String(bytes.length - 10);
  const headers = { "content-length": ENCODED_LENGTH };

  // THE HARNESS PRECONDITION. If the stub silently failed to carry the header, ablation A would fire
  // through `Number(null) !== N` — a red for the right test by the wrong mechanism, which misleads
  // whoever reads it next.
  const probe = streamed(bytes, headers);
  assert.equal(probe.headers.get("content-length"), ENCODED_LENGTH);
  assert.notEqual(Number(ENCODED_LENGTH), bytes.length,
    "the header must DISAGREE with decodedBytes, or the arm cannot separate the two readings");

  const exact = manifestFor(["en"], { decodedBytes: true });
  assert.equal(exact.files.en.decodedBytes, bytes.length);
  const loaded = await loadEntireManifest(exact, { fetch: recordingFetch({ headers }).impl });
  assert.equal(loaded.complete, true, "a content-coded response must not be refused on its header");
  assert.equal(createStrings({ loaded, locale: "en" }).get("Greeting"), "hello en");

  // ARM (b): the DECLARATION is wrong and the bytes are right, so the digest still matches and cannot
  // pre-empt the length check. Altering the body instead would move the digest — zh-123 again — and
  // leave a green test over a `decodedBytes` rule that was never implemented.
  const understated = manifestFor(["en"]);
  understated.files.en.decodedBytes = bytes.length - 1;
  const error = await rejection(loadEntireManifest(understated, { fetch: recordingFetch({ headers }).impl }));
  assert.equal(/** @type {any} */ (error)?.name, "StringsLoadingError");
  assert.deepEqual(/** @type {any[]} */ (/** @type {any} */ (error).failures)
    .map((f) => [f.locale, f.stage]), [["en", "limit"]]);

  // AND ON THE NON-STREAMING PATH. Plan 6.2:2098-2100 lets a complete body be trusted as already
  // allocated; "trusted" and "unchecked" are different words, and the declared length must still be
  // enforced there. Separately falsifiable, and otherwise uncovered.
  const complete = await rejection(loadEntireManifest(understated, {
    fetch: async () => ({ ok: true, status: 200, headers: new Headers(headers), body: null,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
  }));
  assert.deepEqual(/** @type {any[]} */ (/** @type {any} */ (complete).failures)
    .map((f) => [f.locale, f.stage]), [["en", "limit"]]);

  // ARM (c): the field is OPTIONAL (plan 6.1:1817-1828), so its absence must not fail. Without this a
  // loader that REQUIRED it would look correct.
  assert.equal((await loadEntireManifest(manifestFor(["en"]), { fetch: recordingFetch({ headers }).impl })).complete, true);
});

// =================================================================================================
// THE ONE CHECKABLE RESIDUE OF URL IMMUTABILITY — a version-bearing base survives generation.
// =================================================================================================

test("clause 6: a version-bearing publicationBaseUrl survives into the URLs the loader REQUESTS", async () => {
  // `test/node-directory-manifest.test.js` already pins the emitted URL strings for both spellings.
  // What is added here is the COMPOSITION: the manifest is handed to a real loader and the assertion
  // is on what was actually requested, so a generator and a resolver that disagreed about the base
  // could not both be green.
  //
  // Said plainly: this is not the clause's immutability sentence. The plan gives the generator no
  // digest-derived or versioned URL mode (plan 6.2:2027-2033 has one caller-supplied base and no
  // shaping), so the publisher supplies immutability through the base and the only defect the library
  // can commit is losing it — which `new URL` does BY SPECIFICATION to a base with no trailing slash.
  const path = directory({ "en.json": bodyFor("en"), "fr.json": bodyFor("fr") }, "pub");
  const options = { catalogVersion: "1.4.2", fallbackLocale: "en" };

  const requestedFor = async (/** @type {string} */ publicationBaseUrl) => {
    const manifest = await createStringsManifestFromDirectory(path, { ...options, publicationBaseUrl });
    /** @type {string[]} */
    const calls = [];
    const loaded = await loadEntireManifest(manifest, { fetch: async (/** @type {string} */ url) => {
      calls.push(url);
      const name = decodeURIComponent(/** @type {string} */ (url.split("/").pop()));
      return streamed(new Uint8Array(readFileSync(join(path, name))));
    } });
    assert.equal(loaded.complete, true, `${publicationBaseUrl}: the emitted URLs must be loadable`);
    return calls.sort();
  };

  const slashless = await requestedFor("https://cdn.example/strings/v1.4.2");
  const trailing = await requestedFor("https://cdn.example/strings/v1.4.2/");
  assert.deepEqual(slashless, trailing, "the two spellings must name one location");
  for (const url of slashless)
    assert.ok(url.startsWith("https://cdn.example/strings/v1.4.2/"),
      `the version segment must survive: ${url}`);

  // The control makes the claim "the base is preserved" rather than "a literal string appears".
  assert.deepEqual(await requestedFor("https://cdn.example/"),
    ["https://cdn.example/en.json", "https://cdn.example/fr.json"]);
});

// =================================================================================================
// THE DEV `file:` PERMISSION — accepted by the shared validator, refused where nothing may point.
// =================================================================================================

test("clause 6: all three schemes validate, and each accepted one is carried one step further", async () => {
  // Plan 6.1:1916 — "common manifest parsing/validation preserves all three schemes so one manifest
  // shape can cross subpaths". The narrowing belongs to the LOADERS, and a validator that narrowed
  // here would make a manifest un-shareable between them. Acceptance is shown to be USEFUL rather
  // than merely non-throwing, because a validator that returned anything at all would pass otherwise.
  const dir = directory({ "en.json": bodyFor("en") }, "dev");
  for (const [label, baseUrl] of /** @type {[string, string][]} */ ([
    ["https", "https://cdn.example/v1/"],
    ["plain http on loopback", "http://localhost:8080/strings/"],
    ["a dev file: manifest", `${pathToFileURL(dir).href}/`],
  ])) {
    const manifest = manifestFor(["en"], { baseUrl });
    assert.equal(validateStringsManifest(manifest).baseUrl, baseUrl, label);
    assert.equal(parseStringsManifest(JSON.stringify(manifest)).baseUrl, baseUrl, label);

    const loaded = baseUrl.startsWith("file:")
      ? await loadEntireManifestFromFiles(manifest)
      : await loadEntireManifest(manifest, { fetch: recordingFetch().impl });
    assert.equal(loaded.complete, true, `${label}: and the accepted manifest actually loads`);
  }
  // Plain http is NOT narrowed to https, and must not be: plan 6.2:2092-2094 permits a trustworthy
  // loopback origin, and a gate demanding https would break dev and CI loading.
});

test("clause 6: a baseUrl no door could ever serve is refused, and not as a bare TypeError", () => {
  // THE REFUSAL SET IS STRUCTURALLY NECESSARY. A permission is only falsifiable as a refusal, so the
  // acceptance assertions above are satisfied by the empty check on their own — the one-directional
  // allowlist shape S5 found, which missed 28 names on the side nobody tested.
  const valid = manifestFor(["en"]);
  for (const baseUrl of ["data:application/json,{}", "ftp://host/strings/"]) {
    // ABSOLUTE AND PARSEABLE ON PURPOSE: nothing incidental refuses these, so they are the arms that
    // must go red if scheme validation is removed from the shared validator.
    const error = /** @type {any} */ ((() => {
      try { validateStringsManifest({ ...valid, baseUrl }); return null; } catch (e) { return e; }
    })());
    assert.equal(error?.name, "ConfigurationError", baseUrl);
    assert.match(String(error?.message), /baseUrl/, baseUrl);
  }

  // A RELATIVE base is a separate claim, and a weaker one: `new URL` refuses it anyway, so this arm
  // cannot witness the scheme check. What it CAN witness is the error TYPE — S11b shipped a malformed
  // tiebreaker escaping as a bare TypeError from the canonicalizer, and this is the same seam.
  const relative = /** @type {any} */ ((() => {
    try { validateStringsManifest({ ...valid, baseUrl: "/strings/" }); return null; } catch (e) { return e; }
  })());
  assert.equal(relative?.name, "ConfigurationError",
    "a relative baseUrl must not escape as a bare TypeError from `new URL`");
});

test("clause 6: a dev manifest points at the SCANNED SOURCES, awkward names included", async () => {
  // THE DISCRIMINATING POWER IS ENTIRELY IN THE NAMES. A fixture of tidy `xx.json` files exercises the
  // emitter and proves nothing about it: a generator that reconstructed each url as
  // `${normalizedTag}.json` from the key — which is what an author writes when the manifest is keyed
  // by tag and the filename feels redundant — passes such a fixture completely.
  //
  // `notes.txt` is present because it must be IGNORED. `notes.json` is deliberately absent: a `.json`
  // stem that is not a recognized tag is a hard failure (plan 6.2:2120-2121) that would abort
  // generation before this test's own claim was reached — the zh-123 shape.
  const path = directory({
    "fr.json": bodyFor("fr"),
    "en-US.JSON": bodyFor("en-US"),      // ASCII case-insensitive suffix, plan 6.2:2121-2122
    de: bodyFor("de"),                   // a valid BCP-47 name with NO suffix, plan 6.2:2120
    "pt-BR": bodyFor("pt-BR"),           // a SECOND extensionless name, so that axis has two arms
    "notes.txt": "not a catalog",
  }, "scanned");

  const manifest = await createStringsManifestFromDirectory(path,
    { catalogVersion: "1.4.2", fallbackLocale: "fr" });

  // THE FILESYSTEM-INDEPENDENT GATE. The per-file url is the walked entry name, percent-encoded
  // (M8-STATUS.md records it as "a relative encoded entry name against an absolute baseUrl"), so a
  // reconstruction is caught at EMISSION rather than at dereference. That matters here: this host's
  // filesystem is case-insensitive, so `en-US.json` would open `en-US.JSON` and the dereference arm
  // alone would be inert for that entry. Measured below rather than assumed.
  assert.deepEqual(Object.entries(manifest.files).map(([tag, file]) => [tag, file.url]), [
    ["de", "de"], ["en-US", "en-US.JSON"], ["fr", "fr.json"], ["pt-BR", "pt-BR"],
  ]);

  const caseProbe = `CaseProbe-${Date.now()}.JSONX`;
  writeFileSync(join(path, caseProbe), "x");
  let caseInsensitive = true;
  try { statSync(join(path, caseProbe.toLowerCase())); } catch { caseInsensitive = false; }
  // NOT a skip and not a silent pass: the fact is recorded as an assertion so the arm's inertness is
  // visible. On a case-SENSITIVE host the `en-US.JSON` dereference also discriminates; on this one the
  // two extensionless entries carry it, which is why there are two of them.
  assert.equal(typeof caseInsensitive, "boolean");

  const loaded = await loadEntireManifestFromFiles(manifest);
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["de", "en-US", "fr", "pt-BR"]);
  assert.equal(loaded.complete, true);
  for (const locale of ["de", "en-US", "fr", "pt-BR"])
    assert.equal(createStrings({ loaded, locale }).get("Greeting"), `hello ${locale}`,
      "each catalog's marker is distinct, so a mix-up is visible as content");

  // CONTROL (a): the OTHER door onto the same directory — the Java-arbitrated one — agrees. Scoped to
  // the tag set and the marker values on purpose: the two doors legitimately differ elsewhere (the
  // manifest door refuses a fallback with no catalog where the raw door answers an empty directory
  // with an empty map), so an unscoped "the doors agree" would eventually go red for a designed
  // divergence.
  const raw = readStringsFromDirectory(path);
  assert.deepEqual(Object.keys(raw.catalogs).sort(), ["de", "en-US", "fr", "pt-BR"]);

  // CONTROL (b): a plainly-named directory must pass IDENTICALLY — it is what shows the awkward names
  // are doing the work. Under the reconstruction ablation this stays completely green.
  const plain = directory({ "en.json": bodyFor("en"), "fr.json": bodyFor("fr") }, "plain");
  const plainManifest = await createStringsManifestFromDirectory(plain,
    { catalogVersion: "1.4.2", fallbackLocale: "en" });
  assert.deepEqual(Object.entries(plainManifest.files).map(([tag, file]) => [tag, file.url]),
    [["en", "en.json"], ["fr", "fr.json"]]);
  assert.equal((await loadEntireManifestFromFiles(plainManifest)).complete, true);
});

test("clause 6: the dev door hashes RAW FILE BYTES — a BOM'd catalog generates and loads", async () => {
  // Plan 6.1:1911-1913 pins the hashed representation to the octets, before decoding or BOM removal.
  // Every other fixture in this file is BOM-free, so without this a Node door that hashed DECODED text
  // would be invisible here: generation and load would agree with each other and disagree with every
  // browser that downloaded the same file.
  const path = directory({ "en.json": `﻿${bodyFor("en")}`, "fr.json": bodyFor("fr") }, "bom");
  const manifest = await createStringsManifestFromDirectory(path,
    { catalogVersion: "1.4.2", fallbackLocale: "en" });

  assert.equal(manifest.files.en.sha256, sha256Hex(new Uint8Array(readFileSync(join(path, "en.json")))),
    "the declared digest is over the bytes on disk, BOM and all");
  assert.equal(manifest.files.en.decodedBytes, utf8.encode(`﻿${bodyFor("en")}`).length);

  const loaded = await loadEntireManifestFromFiles(manifest);
  assert.equal(loaded.complete, true, "and the load half re-reads and re-hashes the same octets");
  assert.equal(createStrings({ loaded, locale: "en" }).get("Greeting"), "hello en");
});

// =================================================================================================
// THE DEV/PRODUCTION SCHEME BOUNDARY IS A PREFLIGHT — proven by NON-INVOCATION, under both policies.
// =================================================================================================

test("clause 6: a resolved url outside a door's scheme refuses the WHOLE load, under both policies", async () => {
  // **THE `allow-partial` ARM IS THE WHOLE REASON THIS IS EVIDENCE.** Under `reject` a check
  // moved into the per-file read still produces an exception, and a test asserting only "it threw"
  // stays green over a genuine degradation. Under `allow-partial` the same moved check returns a
  // `LoadedStrings` with `complete: false` that silently omits a catalog the caller named — the shape
  // S11a measured for this door.
  //
  // The escape is a RESOLVED url on a NON-fallback entry rather than a `file:` base, because
  // `allow-partial` only returns at all when the resolved fallback file loaded (plan 6.2:2082-2084):
  // a base escape would reject for an unrelated reason and the arm would prove nothing.
  const fetchDoor = manifestFor(["en", "fr"], { urls: { fr: "file:///srv/catalogs/fr.json" } });
  const fileDoor = manifestFor(["en", "fr"], {
    baseUrl: "file:///srv/catalogs/", urls: { fr: "https://cdn.example/v1/fr.json" } });

  for (const partialFailure of /** @type {const} */ (["reject", "allow-partial"])) {
    const viaFetch = recordingFetch();
    const fetchError = await rejection(
      loadEntireManifest(fetchDoor, { fetch: viaFetch.impl, partialFailure }));
    assert.equal(/** @type {any} */ (fetchError)?.name, "ConfigurationError",
      `${partialFailure}: a StringsLoadingError here would mean the refusal had been demoted to a per-file failure`);
    assert.match(String(/** @type {any} */ (fetchError)?.message), /'fr' resolves to 'file:\/\/\/srv\/catalogs\/fr\.json'/);
    assert.equal(viaFetch.calls.length, 0,
      `${partialFailure}: and 'en' is fine, so it must not be read either`);

    // THE MIRROR. Plan 6.2:1916-1919 states both directions and only the base-escape direction was
    // previously covered for the Node door.
    const viaRead = recordingReader();
    const fileError = await rejection(
      loadEntireManifestFromFiles(fileDoor, { readFile: viaRead.impl, partialFailure }));
    assert.equal(/** @type {any} */ (fileError)?.name, "ConfigurationError", partialFailure);
    assert.match(String(/** @type {any} */ (fileError)?.message), /Node file loaders read `file:` URLs only/);
    assert.equal(viaRead.calls.length, 0, partialFailure);
  }

  // THE CONTROLS: consistent schemes load end to end through each door, so the refusals are about the
  // scheme rather than about the fixture — and the recorders are shown to be live instruments.
  const viaFetch = recordingFetch();
  assert.equal((await loadEntireManifest(manifestFor(["en", "fr"]), { fetch: viaFetch.impl })).complete, true);
  assert.equal(viaFetch.calls.length, 2);

  const viaRead = recordingReader();
  const read = await loadEntireManifestFromFiles(
    manifestFor(["en", "fr"], { baseUrl: "file:///srv/catalogs/" }), { readFile: viaRead.impl });
  assert.equal(read.complete, true);
  assert.equal(viaRead.calls.length, 2);
});

// =================================================================================================
// THE ENFORCEABLE RESIDUE OF THE PRECACHE GUIDANCE — the library requests the plan and no more.
// =================================================================================================

test("clause 6: a lookup load requests a STRICT SUBSET and never warms the rest", async () => {
  // **WHAT IS PINNED AND WHAT IS NOT.** Plan 2.2:106-127's tier 3 is "script-compatible supported
  // locales", and the plan does not settle whether that is scoped to the lookup's own primary
  // language — so pinning the exact expected set would encode an agent's answer to an open question
  // and could go red as a fixture fault. What IS unambiguous is that the unrelated-script locales are
  // never candidates for a `fr-CA` lookup, and that the set is smaller than the manifest. Both stay
  // red under a background-warming implementation, and neither depends on the tier-3 reading.
  const manifest = manifestFor(["ar", "de", "en", "fr", "fr-CA", "ja", "pt-BR", "th"],
    { tiebreakers: { fr: ["fr-CA", "fr"] } });

  /** The recorder is ACTIVE: a request outside the plan is refused at record time, not only counted. */
  const planned = new Set(fetchSet(manifest, "fr-CA").map((entry) => entry.url));
  /** @type {string[]} */
  const calls = [];
  const guarded = async (/** @type {string} */ url) => {
    calls.push(url);
    if (!planned.has(url)) throw new Error(`unplanned request: ${url}`);
    return streamed(utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(/\.json$/, ""))));
  };

  const first = await loadStrings(manifest, "fr-CA", { fetch: guarded });
  // **DRAINED BEFORE ASSERTING.** A warm issued after the returned promise settles would not be in the
  // recorder at the moment a naive assertion read it — the test would report green over exactly the
  // behaviour the clause names. One macrotask turn is enough to let a `then`/`setTimeout` warm land.
  await new Promise((resolve) => setTimeout(resolve, 0));

  for (const unrelated of ["ar", "ja", "th"])
    assert.ok(!calls.some((url) => url.endsWith(`/${unrelated}.json`)),
      `an unrelated-script catalog was requested: ${unrelated}`);
  assert.ok(calls.length < Object.keys(manifest.files).length,
    `a lookup load requested ${calls.length} of ${Object.keys(manifest.files).length} files`);
  assert.ok(calls.length > 0, "and it did request something, so the assertions above are not vacuous");

  // A SEPARATELY LABELLED, CIRCULAR-BY-DESIGN consistency check: the loader and the planner agree. It
  // is NOT the gate above — a loader and a planner that both over-fetched would agree perfectly.
  assert.deepEqual(calls, fetchSet(manifest, "fr-CA").map((entry) => entry.url));

  // PER-CALL SETS, never a cumulative count. A module-level memo keyed by URL makes the SECOND call's
  // recorder EMPTY, which a `>= 3` assertion would have absorbed.
  /** @type {string[]} */
  const secondCalls = [];
  const second = await loadStrings(manifest, "fr-CA", { fetch: async (/** @type {string} */ url) => {
    secondCalls.push(url);
    return streamed(utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(/\.json$/, ""))));
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(secondCalls, calls, "a second load re-requests the same set; nothing is served from a cache");
  assert.equal(createStrings({ loaded: second, locale: "fr-CA" }).get("Greeting"),
    createStrings({ loaded: first, locale: "fr-CA" }).get("Greeting"),
    "and it produced a real result, so an empty recorder could not be explained by an empty load");

  // THE CONTROL THAT STOPS A LOADER WHICH FETCHES NOTHING FROM PASSING: the whole-manifest door must
  // request all eight, in normalized-tag order.
  /** @type {string[]} */
  const everything = [];
  const whole = await loadEntireManifest(manifest, { fetch: async (/** @type {string} */ url) => {
    everything.push(url);
    return streamed(utf8.encode(bodyFor(/** @type {string} */ (url.split("/").pop()).replace(/\.json$/, ""))));
  } });
  assert.equal(whole.complete, true);
  // Not sorted afterwards: the whole-manifest plan IS normalized-tag order (plan 3.4:727), and the
  // eight-wide dispatch window admits them in that order, so the recorded sequence is the claim.
  assert.deepEqual(everything, ["ar", "de", "en", "fr", "fr-CA", "ja", "pt-BR", "th"]
    .map((tag) => `https://cdn.example/v1/${tag}.json`));
});
