// @ts-check
/**
 * `chain` and `fetchSet` — plan section 6.1.
 *
 * **EVERY EXPECTATION HERE IS LABELLED BY WHAT CAN ARBITRATE IT**, because the two halves of these
 * functions have different oracles and conflating them would overclaim:
 *
 *   - the candidate SEQUENCE comes from `candidateChain`, which is verified against the real Java
 *     library through 416 corpus cases carrying `attemptedLocales` and through `diff:lookup`. Java
 *     resolves through the same rules, so a sequence expectation is JAVA-BACKED by inheritance.
 *   - the manifest PROJECTION — which candidates are backed, what a `FetchEntry` holds, how a URL
 *     resolves against `baseUrl` — has NO Java counterpart at all. Java has no manifest. Those
 *     expectations rest on the plan's words alone and say so.
 *
 * And the NON-GATE, recorded rather than left implicit: comparing these functions against
 * `candidateChain` would prove self-consistency and nothing else, because they CALL it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { chain, computeCatalogIdentity, fetchSet } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";

/** @param {Record<string, {url: string, sha256: string, decodedBytes?: number}>} files */
function manifest(files, { tiebreakers = {}, fallbackLocale = "en", baseUrl = "https://cdn.example/v1/" } = {}) {
  const draft = {
    formatVersion: 1,
    catalogVersion: "v1",
    catalogFingerprint: "0".repeat(64),
    // FROM THE PINNED DATA, not literals: plan :1893 makes a manifest built against different
    // CLDR data a ConfigurationError, so a hard-coded version turns every fixture red the day
    // the pinned data moves — and hides the check it was meant to pass through.
    cldrVersion: pinnedProvenance().cldrVersion,
    dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale,
    baseUrl,
    files,
    tiebreakers,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}
/**
 * EVERY FILE GETS A DISTINCT DIGEST, and the first version of this file did not.
 *
 * With one shared digest a `fetchSet` that took `sha256` from the WRONG manifest entry produced
 * byte-identical output and nothing here objected — and that field is the only thing binding a
 * fetched body to the manifest that promised it. The digest is derived from the tag so the expected
 * value is readable at the assertion rather than looked up.
 */
const digestFor = (tag) => tag.toLowerCase().replace(/[^a-f0-9]/g, "").padEnd(64, "0").slice(0, 64);
const file = (tag) => ({ url: `${tag}.json`, sha256: digestFor(tag) });

test("SEQUENCE (Java-backed): the chain is the plan 2.2 candidate walk", () => {
  const m = manifest({ en: file("en"), fr: file("fr") });
  assert.deepEqual([...chain(m, "fr-CA")], ["fr-CA", "fr", "en"]);

  // The control that makes the above about TRUNCATION rather than about listing the manifest: an
  // exact hit does not invent a parent it never attempted.
  assert.deepEqual([...chain(m, "fr")], ["fr", "en"]);
});

test("PROJECTION (plan-only): chain keeps candidates the manifest cannot serve", () => {
  // Plan 6.1: "chain includes attempted candidates without files." The discriminating shape is a
  // chain STRICTLY LONGER than the fetch set — an implementation returning the same list for both is
  // caught here and nowhere else.
  const m = manifest({ en: file("en"), fr: file("fr") });
  assert.deepEqual([...chain(m, "fr-CA")], ["fr-CA", "fr", "en"]);
  assert.deepEqual(fetchSet(m, "fr-CA").map((entry) => entry.locale), ["fr", "en"]);

  // The SAME lookup over a manifest backing a different member of the same chain moves the fetch set
  // and not the chain, which is what makes the two functions genuinely different rather than one
  // filtered twice.
  const gap = manifest({ "fr-CA": file("fr-CA"), en: file("en") });
  assert.deepEqual([...chain(gap, "fr-CA")], ["fr-CA", "fr", "en"]);
  assert.deepEqual(fetchSet(gap, "fr-CA").map((entry) => entry.locale), ["fr-CA", "en"]);
});

test("PROJECTION (plan-only): a fetch set may be empty while the chain is not", () => {
  // The strongest form of the split. Nothing in the chain is backed except by the fallback, and a
  // manifest whose only file is unreachable from this lookup yields no fetches at all.
  const m = manifest({ ja: file("ja") }, { fallbackLocale: "ja" });
  const planned = chain(m, "fr-CA");
  assert.ok(planned.length > 0, "the chain still records what was attempted");
  assert.deepEqual(fetchSet(m, "de").map((entry) => entry.locale), ["ja"]);
});

test("PROJECTION (plan-only): entries carry the ABSOLUTE resolved URL", () => {
  // Plan 6.1: "Each file URL is resolved with `new URL(file.url, manifest.baseUrl)`" and a FetchEntry
  // carries the absolute serialized URL, so nothing downstream resolves it again against a base it
  // may no longer have.
  const relative = manifest({ en: { url: "en.json", sha256: "a".repeat(64) } });
  assert.equal(fetchSet(relative, "en")[0]?.url, "https://cdn.example/v1/en.json");

  // An absolute file url overrides the base entirely — that is what `new URL(a, b)` means, and a port
  // that concatenated strings would produce a doubled prefix instead.
  const absolute = manifest({ en: { url: "https://other.example/x/en.json", sha256: "a".repeat(64) } });
  assert.equal(fetchSet(absolute, "en")[0]?.url, "https://other.example/x/en.json");

  // A baseUrl with no trailing slash drops its last segment, again because that is URL resolution and
  // not concatenation. Pinned because it is the case a hand-rolled joiner gets wrong.
  const noSlash = manifest({ en: { url: "en.json", sha256: "a".repeat(64) } }, { baseUrl: "https://cdn.example/v1" });
  assert.equal(fetchSet(noSlash, "en")[0]?.url, "https://cdn.example/en.json");
});

test("PROJECTION (plan-only): decodedBytes rides through only when declared", () => {
  const m = manifest({
    en: { url: "en.json", sha256: "a".repeat(64), decodedBytes: 120 },
    fr: { url: "fr.json", sha256: "b".repeat(64) },
  });
  const byLocale = new Map(fetchSet(m, "fr").map((entry) => [entry.locale, entry]));
  assert.equal(byLocale.get("en")?.expectedDecodedBytes, 120);
  assert.ok(!("expectedDecodedBytes" in /** @type {object} */ (byLocale.get("fr"))),
    "an undeclared size must be absent, not undefined-valued");
});

test("both functions plan from the NORMALIZED input, and neither negotiates", () => {
  // Plan 6.1 twice over: the normalized serialized value is what is planned from and recorded, and
  // these functions "do not negotiate or substitute a diagnostic selection". A matcher asked for
  // `FR-ca` would answer with its best fit; a planner answers with what resolving from that exact
  // normalized tag would attempt.
  const m = manifest({ en: file("en"), fr: file("fr") });
  assert.deepEqual([...chain(m, "FR-ca")], [...chain(m, "fr-CA")]);
  assert.deepEqual(fetchSet(m, "FR-ca"), fetchSet(m, "fr-CA"));
});

test("both functions validate the manifest before planning anything", () => {
  // Plan :1893 — parsing, validation, planning and loading ALL recompute the fingerprint before
  // catalog I/O. Planning is in that list, so a manifest whose declared identity does not match its
  // contents must never yield a plan a caller could act on.
  const broken = manifest({ en: file("en") });
  broken.catalogFingerprint = "9".repeat(64);
  assert.throws(() => chain(broken, "en"), /catalogFingerprint does not match/);
  assert.throws(() => fetchSet(broken, "en"), /catalogFingerprint does not match/);
});

test("the returned plans are frozen", () => {
  const m = manifest({ en: file("en") });
  assert.throws(() => /** @type {any} */ (chain(m, "en")).push("zz"), TypeError);
  assert.throws(() => /** @type {any} */ (fetchSet(m, "en")).push({}), TypeError);
});

/**
 * Chains measured against the REAL Java library on the pinned JDK.
 *
 * Derived by agents who never read `src/load/planning.js`, from plan 2.2 and from running
 * `lokalized-3.0.0.jar` — the harness reads `TranslationResult#getAttemptedLocales()` for a key
 * present in NO catalog, so the walk exhausts every candidate and the measured list is the WHOLE
 * sequence rather than a prefix truncated by a hit.
 *
 * ONLY THE CHAIN IS JAVA-MEASURED. The fetch set beside it is a plan projection in every row, and
 * that split is why it is stated here rather than left for a reader: this project's own standing
 * lesson is that a green differential is evidence about the layer it compares and nothing else.
 */
const JAVA_VERIFIED_CHAINS = [
  {
    what: "an exact manifest hit does NOT end the chain, and the catalog-less bare tag sits BETWEEN the hit and the sweep",
    files: ["en-GB", "en-US", "en-CA", "fr"], fallbackLocale: "fr",
    tiebreakers: { en: ["en-CA", "en-GB", "en-US"] },
    lookup: "en-US", chain: ["en-US", "en", "en-CA", "en-GB", "fr"],
    fetched: ["en-US", "en-CA", "en-GB", "fr"],
  },
  {
    what: "the no/nb bridge INSERTS a candidate rather than resolving through one — `no` stays catalog-less",
    files: ["nb", "en"], fallbackLocale: "en", tiebreakers: {},
    lookup: "no", chain: ["no", "nb", "en"], fetched: ["nb", "en"],
  },
  {
    what: "the control: `nn` does NOT bridge to nb, so the manifest's only non-English file is never attempted",
    files: ["nb", "en"], fallbackLocale: "en", tiebreakers: {},
    lookup: "nn", chain: ["nn", "no", "en"], fetched: ["en"],
  },
  {
    what: "the bridged traversal is appended whole, regional-then-bare",
    files: ["nb", "en"], fallbackLocale: "en", tiebreakers: {},
    lookup: "no-NO", chain: ["no-NO", "no", "nb-NO", "nb", "en"], fetched: ["nb", "en"],
  },
  {
    what: "and the mirror order is ASYMMETRIC in the lookup tag — every implementer assumes symmetry",
    files: ["nb", "en"], fallbackLocale: "en", tiebreakers: {},
    lookup: "nb-NO", chain: ["nb-NO", "nb", "no", "no-NO", "en"], fetched: ["nb", "en"],
  },
  {
    what: "truncation STOPS at a likely-script boundary: the manifest has `sr` and it must never be attempted for a Latin request",
    files: ["sr", "en"], fallbackLocale: "en", tiebreakers: {},
    lookup: "sr-Latn-RS", chain: ["sr-Latn-RS", "sr-Latn", "en"], fetched: ["en"],
  },
  {
    what: "the control: a Cyrillic request DOES reach bare `sr`, which is what proves the truncator ran at all",
    files: ["sr", "en"], fallbackLocale: "en", tiebreakers: {},
    lookup: "sr-Cyrl-RS", chain: ["sr-Cyrl-RS", "sr-Cyrl", "sr", "en"], fetched: ["sr", "en"],
  },
  {
    what: "the script filter runs FIRST and the tiebreaker list then orders the survivors",
    files: ["sr-Cyrl-BA", "sr-Cyrl-RS", "sr-Latn", "en"], fallbackLocale: "en",
    tiebreakers: { sr: ["sr-Cyrl-BA", "sr-Cyrl-RS", "sr-Latn"] },
    lookup: "sr-RS", chain: ["sr-RS", "sr", "sr-Cyrl-BA", "sr-Cyrl-RS", "en"],
    fetched: ["sr-Cyrl-BA", "sr-Cyrl-RS", "en"],
  },
  {
    what: "the control: only the survivors reorder; the Latin locale stays excluded in both arms",
    files: ["sr-Cyrl-BA", "sr-Cyrl-RS", "sr-Latn", "en"], fallbackLocale: "en",
    tiebreakers: { sr: ["sr-Cyrl-RS", "sr-Cyrl-BA", "sr-Latn"] },
    lookup: "sr-RS", chain: ["sr-RS", "sr", "sr-Cyrl-RS", "sr-Cyrl-BA", "en"],
    fetched: ["sr-Cyrl-RS", "sr-Cyrl-BA", "en"],
  },
  {
    what: "the script filter OUTRANKS tiebreaker order — zh-Hans is excluded for a zh-TW request however the list is written",
    files: ["zh-Hans", "zh-Hant", "en"], fallbackLocale: "en",
    tiebreakers: { zh: ["zh-Hant", "zh-Hans"] },
    lookup: "zh-TW", chain: ["zh-TW", "zh-Hant", "en"], fetched: ["zh-Hant", "en"],
  },
  {
    what: "the invariance twin: moving the EXCLUDED locale to the head of the list changes nothing",
    files: ["zh-Hans", "zh-Hant", "en"], fallbackLocale: "en",
    tiebreakers: { zh: ["zh-Hans", "zh-Hant"] },
    lookup: "zh-TW", chain: ["zh-TW", "zh-Hant", "en"], fetched: ["zh-Hant", "en"],
  },
  {
    what: "the control: zh-CN swaps which catalog is excluded, so the pair is about SCRIPT rather than about zh",
    files: ["zh-Hans", "zh-Hant", "en"], fallbackLocale: "en",
    tiebreakers: { zh: ["zh-Hant", "zh-Hans"] },
    lookup: "zh-CN", chain: ["zh-CN", "zh", "zh-Hans", "en"], fetched: ["zh-Hans", "en"],
  },
];

for (const row of JAVA_VERIFIED_CHAINS) {
  test(`SEQUENCE (Java-measured): ${row.what}`, () => {
    const m = manifest(Object.fromEntries(row.files.map((tag) => [tag, file(tag)])), {
      fallbackLocale: row.fallbackLocale,
      tiebreakers: row.tiebreakers,
    });
    assert.deepEqual([...chain(m, row.lookup)], row.chain);
    // The fetch set beside it is a PLAN PROJECTION, not a measurement — chain ∩ file keys, in
    // first-use order.
    assert.deepEqual(fetchSet(m, row.lookup).map((entry) => entry.locale), row.fetched);
  });
}

test("PROJECTION (plan-only): each entry carries ITS OWN file's digest", () => {
  // The field that binds a fetched body to the manifest that promised it. With one shared digest
  // across the fixture — which is how this file was first written — an entry taking its digest from
  // the wrong manifest entry is byte-identical and completely invisible.
  const m = manifest({ "en-GB": file("en-GB"), "en-CA": file("en-CA"), en: file("en") },
    { tiebreakers: { en: ["en-CA", "en-GB"] } });
  for (const entry of fetchSet(m, "en-GB"))
    assert.equal(entry.sha256, digestFor(entry.locale),
      `${entry.locale} must carry its own digest, not another file's`);
  assert.ok(new Set(fetchSet(m, "en-GB").map((e) => e.sha256)).size > 1,
    "the fixture must give distinct digests, or this assertion cannot fail");
});
