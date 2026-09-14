// @ts-check
/**
 * WHAT THE IDENTITY PROJECTION DROPS, AND WHO MAY CONSTRUCT A LIBRARY ERROR — M8 clauses 2 and 75.
 *
 * **CLAUSE 2's EXCLUSIONS WERE TESTED ONE LAYER TOO LOW.** `computeCatalogIdentity` hashes whatever
 * projection it is handed, and `src/load/identity.js:110` says so outright: it "cannot exclude
 * `baseUrl` or a per-file `url`, because they never reach it: this is the function that drops them".
 * The function that drops them is `catalogIdentityInputFor`, and nothing tested it. Measured:
 * adding `baseUrl` to that projection turns ZERO tests red across catalog-identity, manifest, sha256,
 * both loader files and three more; so does adding `cldrVersion`. Only the per-file `url` exclusion
 * is gated today, and incidentally — folding the url into the per-locale digest changes the hashed
 * VALUE, which the pinned-bytes test catches for a reason that has nothing to do with exclusion.
 *
 * The clause's consequence is concrete: a manifest served from a CDN and the same manifest on the
 * origin differ in `baseUrl` and in nothing else, and must identify the same translations.
 *
 * **CLAUSE 75 CLOSES IN S29, AND THE BLOCKER THIS FILE RECORDED WAS WRONG.** The paragraph below said
 * the remaining half "needs `DigestUnavailableError` exported from `lokalized/load`, which is an
 * allowlist decision and is deliberately not taken here". **Plan 3.5:1092-1100 had already taken it:**
 * it declares NINE error classes as package exports of the form `const X: CatchOnlyErrorClass<X>`,
 * `DigestUnavailableError` among them at :1099, and :1107 says those runtime values "are public for
 * catching and `instanceof`" while the declarations "expose no constructor or extension signature".
 * Plan 3.1's `load` row permits it under the "loading errors" category `StringsLoadingError` already
 * occupies. There was no widening to decide — only an undelivered promise, invisible because the
 * allowlist is generated from section **3.1 alone** and the plan declares these in **3.5**.
 *
 * **CLAUSE 75 IS TESTED HERE FOR THE HALF THAT NOW HOLDS.** `StringsParseError` has refused consumer
 * construction since M5; `StringsLoadingError` shipped without that guard and `DigestUnavailableError`
 * was not a class at all — a plain `Error` with `name` and `code` assigned afterwards, recognisable
 * only by string comparison. Both now mirror `StringsParseError`. The remaining half of the clause —
 * that a CONSUMER can catch them by `instanceof` — needs `DigestUnavailableError` exported from
 * `lokalized/load`, which is an allowlist decision and is deliberately not taken here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifest, StringsLoadingError } from "../src/load/fetch-loader.js";
import { sha256Hex } from "../src/internal/sha256.js";

const utf8 = new TextEncoder();
const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ [`Key.${tag}`]: `hello ${tag}` });

function draftManifest(overrides = {}) {
  const files = Object.fromEntries(["en", "fr"].map((tag) =>
    [tag, { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(bodyFor(tag))) }]));
  return /** @type {any} */ ({
    formatVersion: 1, catalogVersion: "v1", catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion, dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: "en", baseUrl: "https://cdn.example/v1/", files, tiebreakers: {},
    ...overrides,
  });
}
const fingerprintOf = (/** @type {any} */ manifest) =>
  computeCatalogIdentity(catalogIdentityInputFor(manifest)).catalogFingerprint;

// ---------------------------------------------------------------------------------------------
// Clause 2 — the projection keeps five fields and drops everything else.
// ---------------------------------------------------------------------------------------------

test("clause 2: the projection keeps EXACTLY the five identity fields", () => {
  // Asserted as an exact key set rather than "does not contain baseUrl", so a field ADDED later is
  // caught as well as one that should have been dropped. This is the assertion the ablations that
  // turned zero red were missing.
  //
  // **AND IT IS THE ONLY ASSERTION THAT CATCHES A WIDENED PROJECTION, which was measured rather than
  // assumed.** The canonicalizer IGNORES a member it does not know — `computeCatalogIdentity({...the
  // five, baseUrl})` produces byte-identical output — so adding a field to the projection changes no
  // fingerprint and no downstream behaviour at all. That silence is a second line of defence and it
  // is also why the end-to-end "two origins" test below does NOT go red under that mutation: the
  // width of this projection is guarded HERE or nowhere.
  assert.deepEqual(Object.keys(catalogIdentityInputFor(draftManifest())).sort(),
    ["catalogVersion", "formatVersion", "localeToSha256", "resolvedFallbackLocale", "tiebreakers"]);
});

test("clause 2: the SAME translations served from two origins identify identically", () => {
  // The clause's own justification, as a test: "so server and CDN manifests identify the same
  // translations". Everything transport-only differs; everything identifying is equal.
  const origin = draftManifest({ baseUrl: "https://origin.internal/catalogs/" });
  const cdn = draftManifest({ baseUrl: "https://cdn.example/v1/" });
  cdn.files = { en: { ...cdn.files.en, url: "hashed/en.abc123.json", decodedBytes: 42 }, fr: cdn.files.fr };

  assert.notEqual(origin.baseUrl, cdn.baseUrl, "the fixture must actually differ in transport fields");
  assert.notEqual(origin.files.en.url, cdn.files.en.url);
  assert.equal(fingerprintOf(origin), fingerprintOf(cdn));
});

test("clause 2: each excluded field, one at a time, with an INCLUDED control", () => {
  // One arm per exclusion. Without the control arms the whole test is satisfied by a projection that
  // ignores its input entirely and returns a constant.
  const base = fingerprintOf(draftManifest());

  for (const [label, overrides] of /** @type {[string, any][]} */ ([
    ["baseUrl", { baseUrl: "https://elsewhere.example/x/" }],
    ["cldrVersion is not re-declared here", {}],
    ["the manifest's own declared fingerprint", { catalogFingerprint: "9".repeat(64) }],
  ]))
    assert.equal(fingerprintOf(draftManifest(overrides)), base, `${label} must not move the identity`);

  // decodedBytes and per-file url, changed on ONE file only.
  const transportOnly = draftManifest();
  transportOnly.files = {
    ...transportOnly.files,
    en: { ...transportOnly.files.en, url: "somewhere/else/en.json", decodedBytes: 999 },
  };
  assert.equal(fingerprintOf(transportOnly), base, "per-file url and decodedBytes must not move it");

  // THE CONTROLS — the four fields that MUST move it. A projection that dropped one of these would
  // pass every arm above.
  assert.notEqual(fingerprintOf(draftManifest({ catalogVersion: "v2" })), base, "catalogVersion");
  assert.notEqual(fingerprintOf(draftManifest({ fallbackLocale: "fr" })), base, "fallbackLocale");
  assert.notEqual(fingerprintOf(draftManifest({ tiebreakers: { en: ["en"] } })), base, "tiebreakers");

  const otherBytes = draftManifest();
  otherBytes.files = { ...otherBytes.files, en: { ...otherBytes.files.en, sha256: "a".repeat(64) } };
  assert.notEqual(fingerprintOf(otherBytes), base, "a catalog's own digest");
});

// ---------------------------------------------------------------------------------------------
// Clause 75 — the library's errors are classes nobody outside the package may construct.
// ---------------------------------------------------------------------------------------------

test("clause 75: StringsLoadingError is a real Error subclass a consumer cannot construct", async () => {
  // The control FIRST: the class must still be thrown and catchable by `instanceof`, or "not
  // constructible" would be satisfied by a class that is simply unusable.
  const manifest = draftManifest();
  manifest.files.en.sha256 = "b".repeat(64);
  manifest.catalogFingerprint = fingerprintOf(manifest);
  const thrown = await loadEntireManifest(manifest, {
    fetch: async (/** @type {string} */ url) => {
      const tag = /** @type {string} */ (url.split("/").pop()).replace(/\.json$/, "");
      const bytes = utf8.encode(bodyFor(tag));
      let sent = false;
      return { ok: true, status: 200, body: { getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }) } };
    },
  }).then(() => null, (e) => e);

  assert.ok(thrown instanceof StringsLoadingError, "the loader really does throw this class");
  assert.ok(thrown instanceof Error, "and it is a genuine Error");
  assert.equal(thrown.code, "STRINGS_LOADING");

  // THE REFUSAL. A consumer who could construct one could fabricate a load failure that every
  // `instanceof` check in an application would believe.
  assert.throws(() => new /** @type {any} */ (StringsLoadingError)("fake", []),
    /not constructible/, "direct construction");
  assert.throws(() => { class Mine extends StringsLoadingError {} ; new /** @type {any} */ (Mine)("fake", []); },
    /not constructible/, "and subclassing, which is refused at instantiation rather than discouraged");
});

test("clause 75: DigestUnavailableError is a class, not an Error with a name assigned to it", async () => {
  // It used to be `const error = new Error(...); error.name = "DigestUnavailableError";` — which no
  // `instanceof` can recognise. The name and code are unchanged by the fix, which is what keeps every
  // string-matching consumer and every recorded message working.
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    // The manifest's declared fingerprint must be CORRECT, or validation refuses with a
    // ConfigurationError before the preflight runs and the probe measures the wrong guard entirely.
    const valid = draftManifest();
    valid.catalogFingerprint = fingerprintOf(valid);
    const error = await loadEntireManifest(valid, { fetch: async () => { throw new Error("unreached"); } })
      .then(() => null, (e) => e);
    assert.equal(error?.name, "DigestUnavailableError");
    assert.equal(error?.code, "DIGEST_UNAVAILABLE");
    assert.notEqual(Object.getPrototypeOf(error), Error.prototype,
      "a plain Error with a name assigned is exactly what this clause forbids");
    assert.ok(error instanceof Error);
    assert.throws(() => new /** @type {any} */ (error.constructor)("fake"), /not constructible/);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Clause 75, closed — the two classes plan 3.5 declared and nothing exported.
// ---------------------------------------------------------------------------------------------

test("clause 75: the newly exported classes are CATCHABLE and NOT CONSTRUCTIBLE", async () => {
  // Driven through the PUBLIC subpaths, not through internal modules: the proposition is that a
  // CONSUMER can catch these, and a consumer only has the nine entry points.
  const { DigestUnavailableError } = await import("../src/load/index.js");
  const { ExpressionEvaluationError, createStrings } = await import("../src/core/index.js");

  for (const [label, ErrorClass, code] of /** @type {[string, any, string][]} */ ([
    ["DigestUnavailableError", DigestUnavailableError, "DIGEST_UNAVAILABLE"],
    ["ExpressionEvaluationError", ExpressionEvaluationError, "EXPRESSION_EVALUATION"],
  ])) {
    assert.equal(typeof ErrorClass, "function", `${label} must be exported as a value, not a type`);
    assert.ok(Object.prototype.isPrototypeOf.call(Error, ErrorClass), `${label} extends Error`);
    assert.throws(() => new ErrorClass("fake"), /not constructible/, `${label}: direct construction`);
    assert.throws(() => { class Mine extends ErrorClass {} ; new Mine("fake"); },
      /not constructible/, `${label}: subclass instantiation`);
    assert.equal(ErrorClass.prototype.constructor, ErrorClass);
    assert.equal(typeof code, "string");
  }

  // THE CONTROL, and the half "not constructible" alone would be satisfied by an unusable class: a
  // real library operation still throws one, and `instanceof` on the EXPORTED binding recognises it.
  const thrown = (() => {
    try {
      // THE PROBE WAS WRONG ON ITS FIRST ATTEMPT and the control is what said so -- `{{v, ,}}` is
      // refused by the PLACEHOLDER guard, which raises a plain configuration error, so it never
      // reached the evaluator at all. The `zh-123` shape, inside the fixture written to check it.
      createStrings({
        strings: { en: { K: { translation: "t", alternatives: [{ "a<==b": { translation: "y" } }] } } },
        fallbackLocale: "en", locale: "en",
      });
      return null;
    } catch (error) { return error; }
  })();
  assert.ok(thrown instanceof ExpressionEvaluationError,
    "a real construction failure must be catchable through the exported class");
  assert.equal(/** @type {any} */ (thrown).code, "EXPRESSION_EVALUATION");
});

test("clause 75: plan 3.5 declares nine of these, and the record says which are still owed", async () => {
  // THE ANTI-VACUITY HALF. The two tests above prove two classes behave; they say nothing about the
  // seven others the plan declares, and a reader would take "clause 75 closed" for all nine. This
  // asserts the CURRENT SPLIT so the day one of the remaining six lands, this test goes red and the
  // record is forced to move with it.
  const core = await import("../src/core/index.js");
  const parse = await import("../src/parse/index.js");
  const load = await import("../src/load/index.js");
  const exported = new Set([...Object.keys(core), ...Object.keys(parse), ...Object.keys(load)]);

  // Plan 3.5:1092-1100, in the plan's own order.
  const DECLARED = ["LokalizedError", "MissingTranslationError", "UnsupportedLocaleError",
    "ExpressionEvaluationError", "ResolutionError", "StringsParseError", "StringsLoadingError",
    "DigestUnavailableError", "ConfigurationError"];

  assert.deepEqual(DECLARED.filter((name) => exported.has(name)).sort(),
    ["DigestUnavailableError", "ExpressionEvaluationError", "MissingTranslationError",
      "StringsLoadingError", "StringsParseError"],
    "five of plan 3.5's nine error classes are exported; changing that must change this record");

  // The three that have no class at all, measured rather than assumed — `UnsupportedLocaleError`
  // exists in `src/internal/plural.js` and is a DIFFERENT case from these, so it is named apart.
  assert.deepEqual(DECLARED.filter((name) => !exported.has(name)).sort(),
    ["ConfigurationError", "LokalizedError", "ResolutionError", "UnsupportedLocaleError"]);
});
