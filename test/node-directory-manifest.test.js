// @ts-check
/**
 * `createStringsManifestFromDirectory` and `loadStringsFromDirectory` — plan 6.2, clauses 64 and 65.
 *
 * **THESE FIXTURES WERE DESIGNED BY AGENTS THAT WERE FORBIDDEN FROM READING THE IMPLEMENTATION**, and
 * then adversarially re-judged by a second set against the plan text, before any of this existed.
 * That is not ceremony: this project's first standing lesson is that a probe space derived from the
 * thing under test is blind to that thing's gaps, and it has now been paid for four separate times.
 * Six lenses proposed 42 fixtures; 13 were judged vacuous, unreachable or mis-cited and dropped.
 *
 * **THE ORACLE, STATED PLAINLY.** Java has no manifest, no digest and no generator, so the plan is
 * the only specification these two functions have. Where a fixture pins a LITERAL — a digest, an
 * encoded URL — the literal is the oracle, computed independently and checked against `node:crypto`
 * elsewhere. Where it pins agreement between two of this port's own doors, that is an internal
 * consistency check and is labelled as one.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { createSsrStamp } from "../src/ssr/index.js";
import {
  createStringsManifestFromDirectory, loadStringsFromDirectory, readStringsFromDirectory,
} from "../src/node/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";

const utf8 = new TextEncoder();
const root = mkdtempSync(join(tmpdir(), "lokalized-gen-"));
after(() => rmSync(root, { recursive: true, force: true }));

const bodyFor = (/** @type {string} */ tag) => JSON.stringify({ Hi: `hello ${tag}` });
const OPTIONS = { catalogVersion: "2026.09.11", fallbackLocale: "en" };

/** A fresh directory holding the named files. `null` content means "make it a directory". */
function directory(/** @type {Record<string, string | Uint8Array | null>} */ contents, name = "d") {
  const path = mkdtempSync(join(root, `${name}-`));
  for (const [fileName, content] of Object.entries(contents)) {
    if (content === null) mkdirSync(join(path, fileName));
    else writeFileSync(join(path, fileName), content);
  }
  return path;
}

const catalogs = (/** @type {string[]} */ tags) =>
  Object.fromEntries(tags.map((tag) => [`${tag}.json`, bodyFor(tag)]));

// ------------------------------------------------------------ discovery parity with the raw door

test("an unrecognised stem is a SILENT SKIP without .json and FATAL with it", async () => {
  // THE PAIR IS THE FIXTURE. Each half catches one of the two implementations an author actually
  // writes: "skip whatever I cannot resolve" publishes a manifest missing a catalog the publisher
  // wrote, and "fail on any name I cannot resolve" refuses a directory holding a README.
  const silent = directory({ ...catalogs(["en"]), zz: bodyFor("zz"), README: "notes" });
  const manifest = await createStringsManifestFromDirectory(silent, OPTIONS);
  assert.deepEqual(Object.keys(manifest.files), ["en"], "zz and README vanish without a trace");

  const fatal = directory({ ...catalogs(["en"]), "zz.json": bodyFor("zz") });
  await assert.rejects(() => createStringsManifestFromDirectory(fatal, OPTIONS),
    /'zz\.json' ends with \.json but is not named with a valid IETF BCP 47 language tag/);

  // Both doors agree, because both drive the same walk.
  assert.deepEqual(Object.keys(readStringsFromDirectory(silent).catalogs), ["en"]);
  assert.throws(() => readStringsFromDirectory(fatal), /ends with \.json/);
});

test("keys are NORMALIZED TAGS and urls are the names ON DISK", async () => {
  // The two are genuinely different strings, and a generator that derived either from the other
  // would be wrong in opposite directions: `${tag}.json` invents a suffix `fr` does not have, and
  // using the file name as the key publishes `en-US.JSON` as a locale.
  const path = directory({ "en-US.JSON": bodyFor("en-US"), "de.JsOn": bodyFor("de"), fr: bodyFor("fr"), "en.json": bodyFor("en") });
  const manifest = await createStringsManifestFromDirectory(path, OPTIONS);

  assert.deepEqual(Object.keys(manifest.files).sort(), ["de", "en", "en-US", "fr"]);
  const resolved = (/** @type {string} */ tag) => new URL(manifest.files[tag].url, manifest.baseUrl).href;
  assert.ok(resolved("en-US").endsWith("/en-US.JSON"), resolved("en-US"));
  assert.ok(resolved("de").endsWith("/de.JsOn"));
  assert.ok(resolved("fr").endsWith("/fr"), "no .json may be invented for an extensionless catalog");
});

test("two files whose tags are the same locale REFUSE, and the refusals are two different rules", async () => {
  // Rule 1 keys by JDK Locale IDENTITY during the walk and quotes the FILE PATH reached second;
  // rule 2 fires after the sort on two DISTINCT locales that RENDER the same tag, and quotes only
  // the tag. One key cannot serve both arms — measured by ablation during S2b.
  // THE FIRST DRAFT OF THIS FIXTURE WAS UNREACHABLE, which is worth recording rather than quietly
  // fixing: it paired `en-US.json` with `en-US-x-lvariant-POSIX.json`, whose JDK identities are
  // DIFFERENT (variants `[]` vs `["POSIX"]`, measured) — so no rule-1 collision occurred, and the
  // call failed later on the manifest tag rule instead. That is the `zh-123` shape appearing inside
  // a probe written to gate a site. A case-only difference is the reachable collision: two spellings,
  // one identity.
  // A CASE-ONLY PAIR CANNOT BE THE FIXTURE EITHER, and finding that out is why this is measured
  // rather than reasoned: APFS is case-insensitive by default, so `en-US.json` and `EN-us.json` are
  // ONE file and the collision never happens. Suffix presence is the portable collision — two
  // genuinely distinct directory entries that name the same locale.
  const sameIdentity = directory({ "en-US.json": bodyFor("en-US"), "en-US": bodyFor("x"), "en.json": bodyFor("en") });
  await assert.rejects(() => createStringsManifestFromDirectory(sameIdentity, OPTIONS),
    /Duplicate localized strings file for locale/);

  const sameRendering = directory({ "nn-NO.json": bodyFor("nn-NO"), "no-NO-x-lvariant-NY.json": bodyFor("nn"), "en.json": bodyFor("en") });
  await assert.rejects(() => createStringsManifestFromDirectory(sameRendering, OPTIONS),
    /Duplicate locale key rendering as language tag/);

  // The control: distinct locales that neither collide nor co-render publish cleanly.
  const fine = directory(catalogs(["en", "nn-NO"]));
  assert.deepEqual(Object.keys(await createStringsManifestFromDirectory(fine, OPTIONS).then((m) => m.files)).sort(),
    ["en", "nn-NO"]);
});

test("a child DIRECTORY named like a catalog is skipped where the FILE would be fatal", async () => {
  const path = directory({ ...catalogs(["en"]), "zzz-bogus.json": null });
  assert.deepEqual(Object.keys(await createStringsManifestFromDirectory(path, OPTIONS).then((m) => m.files)), ["en"]);
});

test("the walk is SHARED, not re-implemented — structurally", async () => {
  // A behavioural test can only show the two doors agree TODAY. This is the property that keeps them
  // agreeing: there is exactly one directory enumeration in `src/node`, and both doors import it.
  const { readFileSync } = await import("node:fs");
  const { withoutComments } = await import("../tools/graph-walk.mjs");
  const sources = ["directory.js", "manifest-directory.js", "file-loader.js", "discovery.js"];
  // COMMENTS STRIPPED FIRST, with the same helper the graph walk uses. `discovery.js`'s own prose
  // quotes `readdirSync("")` while explaining why the empty path is special — counting the
  // documentation of the rule as a second violation of it is the mistake this line exists to avoid,
  // and the SSR graph gate hit the identical one a slice ago.
  const counts = sources.map((file) => [file,
    withoutComments(readFileSync(new URL(`../src/node/${file}`, import.meta.url), "utf8"))
      .split("readdirSync(").length - 1]);
  assert.deepEqual(counts, [["directory.js", 0], ["manifest-directory.js", 0], ["file-loader.js", 0], ["discovery.js", 1]],
    "exactly one module may enumerate a directory; the measured walk rules live there");

  // **AND BOTH DOORS MUST IMPORT THAT ONE MODULE.** Counting `readdirSync(` alone is defeated by a
  // byte-copy: `discovery2.js` holding an identical walk leaves all four counts unchanged, because
  // the list of files is hard-coded. Found by review. Deriving the importers from the source closes
  // it — a copied module is only dangerous if something imports it, and this asserts exactly which
  // module the two doors reach for.
  const importers = ["directory.js", "manifest-directory.js"].map((file) => [file,
    /from\s+"\.\/(discovery\.js)"/.exec(
      readFileSync(new URL(`../src/node/${file}`, import.meta.url), "utf8"))?.[1] ?? null]);
  assert.deepEqual(importers, [["directory.js", "discovery.js"], ["manifest-directory.js", "discovery.js"]],
    "both directory doors must drive ./discovery.js, not a copy of it");
});

// ------------------------------------------------------------ publication URLs

test("a publicationBaseUrl WITHOUT a trailing slash does not drop its last segment", async () => {
  // Measured: `new URL("en.json", "https://cdn.example/v1/catalogs")` is `.../v1/en.json`. A
  // generator that resolved as given would publish every catalog one directory up, silently.
  const path = directory(catalogs(["en", "fr"]));
  const without = await createStringsManifestFromDirectory(path, { ...OPTIONS, publicationBaseUrl: "https://cdn.example/v1/catalogs" });
  const with_ = await createStringsManifestFromDirectory(path, { ...OPTIONS, publicationBaseUrl: "https://cdn.example/v1/catalogs/" });

  assert.deepEqual(without, with_, "the two spellings must name the same location");
  for (const tag of ["en", "fr"])
    assert.equal(new URL(without.files[tag].url, without.baseUrl).href, `https://cdn.example/v1/catalogs/${tag}.json`);
});

test("the DEFAULT base is the directory's own file: URL, and it resolves to the real files", async () => {
  const path = directory(catalogs(["en", "fr"]));
  const manifest = await createStringsManifestFromDirectory(path, OPTIONS);
  assert.equal(manifest.baseUrl, `${pathToFileURL(path).href}/`);
  for (const tag of ["en", "fr"])
    assert.equal(fileURLToPath(new URL(manifest.files[tag].url, manifest.baseUrl)), join(path, `${tag}.json`));
});

test("a directory name needing percent-encoding round-trips", async () => {
  // `#` is the sharp case: unencoded it starts a fragment and every file URL resolves to the wrong
  // place. A `%` and a space are here because they encode differently from each other.
  const awkward = join(root, "cat # 100% v1");
  mkdirSync(awkward, { recursive: true });
  writeFileSync(join(awkward, "en.json"), bodyFor("en"));
  const manifest = await createStringsManifestFromDirectory(awkward, OPTIONS);
  assert.match(manifest.baseUrl, /%23/, "the # must be encoded, or everything after it is a fragment");
  assert.equal(fileURLToPath(new URL(manifest.files.en.url, manifest.baseUrl)), join(awkward, "en.json"));
});

test("an ordinary catalog name is not gratuitously escaped", async () => {
  // **THIS TEST'S FIRST DRAFT DESCRIBED A CASE IT DID NOT BUILD** — its comment claimed to exercise a
  // name needing percent-encoding and then created `en.json`. Recorded rather than quietly deleted:
  // a comment asserting its own coverage is a claim like any other, and this project has now caught
  // five texts stating the inverse of what they described.
  //
  // The honest position is that no catalog FILE NAME can need encoding: a loadable name is a
  // BCP-47 tag optionally followed by `.json`, and a BCP-47 tag is ASCII alphanumerics and hyphens.
  // The encoding that matters is on the DIRECTORY name, which the test above drives with `#`, `%`
  // and a space. What is left to assert here is the complement — that an ordinary name is passed
  // through unchanged rather than escaped into something the CDN will not serve.
  const path = directory({ "en.json": bodyFor("en"), "en-US.JSON": bodyFor("en-US") });
  const manifest = await createStringsManifestFromDirectory(path, OPTIONS);
  assert.equal(manifest.files.en.url, "en.json");
  assert.equal(manifest.files["en-US"].url, "en-US.JSON");
});

test("loadStringsFromDirectory REFUSES a publication base rather than dropping it", async () => {
  const path = directory(catalogs(["en"]));
  await assert.rejects(
    () => loadStringsFromDirectory(path, /** @type {any} */ ({ ...OPTIONS, publicationBaseUrl: "https://cdn.example/" })),
    /not an option of loadStringsFromDirectory/);
});

// ------------------------------------------------------------ identity and digest

test("the catalog identity is INVARIANT across publication bases and varies with bytes", async () => {
  const path = directory(catalogs(["en", "fr"]));
  const local = await createStringsManifestFromDirectory(path, OPTIONS);
  const cdnA = await createStringsManifestFromDirectory(path, { ...OPTIONS, publicationBaseUrl: "https://a.example/v1/" });
  const cdnB = await createStringsManifestFromDirectory(path, { ...OPTIONS, publicationBaseUrl: "https://b.example/other/" });

  assert.equal(local.catalogFingerprint, cdnA.catalogFingerprint);
  assert.equal(cdnA.catalogFingerprint, cdnB.catalogFingerprint);
  // And the bases really do differ, so the equality above is about EXCLUSION rather than about the
  // three calls happening to be identical.
  assert.notEqual(cdnA.baseUrl, cdnB.baseUrl);
  assert.notEqual(new URL(cdnA.files.en.url, cdnA.baseUrl).href, new URL(cdnB.files.en.url, cdnB.baseUrl).href);

  // One byte of one catalog moves it.
  const moved = directory({ ...catalogs(["en"]), "fr.json": JSON.stringify({ Hi: "bonjour!" }) });
  assert.notEqual((await createStringsManifestFromDirectory(moved, OPTIONS)).catalogFingerprint, local.catalogFingerprint);
});

test("the digest covers the RAW bytes — BOM included, formatting included", async () => {
  // Pinned to literals rather than to "differs from the other one", because only a literal says
  // WHICH representation was hashed. A generator that hashed a re-serialization of the parsed
  // catalog would publish a digest no browser could reproduce, since a browser hashes what it
  // downloaded. The values are this port's own SHA-256, which `test/sha256.test.js` checks against
  // `node:crypto` at every length 0-200.
  const plain = directory({ "en.json": bodyFor("en") });
  assert.equal((await createStringsManifestFromDirectory(plain, OPTIONS)).files.en.sha256,
    "d694b8298173a34bebcf9a717d7e6f3ae26a6730bcf9881c81efd259baf1f9a3");

  const withBom = directory({ "en.json": new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8.encode(bodyFor("en"))]) });
  const bomManifest = await createStringsManifestFromDirectory(withBom, OPTIONS);
  assert.equal(bomManifest.files.en.sha256, "b40b59dc224ec249791946e3378780ea43dce5e2671520ee08748bc3147be89b");
  assert.equal(bomManifest.files.en.decodedBytes, 20, "the BOM is three of the declared bytes");

  // Whitespace the parser would discard still moves the digest.
  const spaced = directory({ "en.json": `  ${bodyFor("en")}  ` });
  assert.notEqual((await createStringsManifestFromDirectory(spaced, OPTIONS)).files.en.sha256,
    "d694b8298173a34bebcf9a717d7e6f3ae26a6730bcf9881c81efd259baf1f9a3");
});

test("tiebreaker ORDER is part of the identity, with the files held constant", async () => {
  const path = directory(catalogs(["en", "fr", "fr-CA"]));
  const a = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: { fr: ["fr", "fr-CA"] } });
  const b = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: { fr: ["fr-CA", "fr"] } });
  assert.deepEqual(a.files, b.files, "the attribution control: only the tiebreaker order differs");
  assert.equal(a.catalogVersion, b.catalogVersion);
  assert.notEqual(a.catalogFingerprint, b.catalogFingerprint);
});

// ------------------------------------------------------------ hash, do not parse

test("the GENERATOR does not parse — and the composed door does", async () => {
  // The governing decision of this slice, made falsifiable. A zero-byte catalog and a malformed one
  // both publish: a digest identifies bytes, and a manifest is a claim about what was published.
  // The same directory through `loadStringsFromDirectory` fails at the PARSE stage, which is where
  // validity belongs.
  const empty = directory({ ...catalogs(["en"]), "de.json": "" });
  const manifest = await createStringsManifestFromDirectory(empty, OPTIONS);
  assert.equal(manifest.files.de.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(manifest.files.de.decodedBytes, 0);

  const error = await loadStringsFromDirectory(empty, OPTIONS).then(() => null, (e) => e);
  assert.equal(error?.name, "StringsLoadingError");
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => f.stage), ["parse"]);

  // And the raw door refuses it outright, because it parses everything it walks. Three doors, three
  // defensible answers to one directory — worth pinning so nobody "fixes" one into another.
  assert.throws(() => readStringsFromDirectory(empty));
});

// ------------------------------------------------------------ the fallback rule

test("a fallbackLocale with no catalog is REFUSED, and an empty directory with it", async () => {
  // Where this door parts company with the raw one, deliberately. Plan 2.2's manifest fallback rule
  // ends "zero or ambiguous FAILS", and a manifest whose fallback has no file cannot produce a
  // LoadedStrings any createStrings will accept — so generating one defers the failure to a worse
  // place.
  const noFallback = directory(catalogs(["fr", "de"]));
  await assert.rejects(() => createStringsManifestFromDirectory(noFallback, OPTIONS),
    /No catalog in .* is the declared fallbackLocale 'en'; the directory holds \[de, fr\]/);

  const empty = directory({});
  await assert.rejects(() => createStringsManifestFromDirectory(empty, OPTIONS), /fallbackLocale 'en'/);

  // THE DIVERGENCE, ASSERTED RATHER THAN DESCRIBED: the raw door answers the same empty directory
  // with an empty map and no error — a measured JDK behaviour with a required corpus case behind it.
  const raw = readStringsFromDirectory(empty);
  assert.deepEqual(Object.keys(raw.catalogs), []);
  assert.deepEqual(raw.warnings, []);
});

// ------------------------------------------------------------ limits

test("limits are validated BEFORE any directory I/O", async () => {
  // A bad limit and a bad path together must report the LIMIT: an out-of-band budget is Java's
  // options-builder refusal, which precedes the loader entirely.
  const missing = join(root, "does-not-exist-at-all");
  await assert.rejects(
    () => createStringsManifestFromDirectory(missing, { ...OPTIONS, maximumDiscoveryEntries: 0 }),
    /maximumDiscoveryEntries must be between 1 and/);
  // BOTH budgets, not one. The docblock claims both are validated before any I/O and in this order;
  // review found the test covered only the discovery knob, so a generator that resolved the seven
  // portable limits lazily would have passed. `maximumJsonNestingDepth: 0` is out of range.
  await assert.rejects(
    () => createStringsManifestFromDirectory(missing, { ...OPTIONS, limits: { maximumJsonNestingDepth: 0 } }),
    /maximumJsonNestingDepth/);
  await assert.rejects(
    () => createStringsManifestFromDirectory(missing, OPTIONS), /does not exist/);
});

test("the byte budgets are charged on RAW BYTES, not characters", async () => {
  // A three-byte character makes the two numbers disagree, which is the only way to tell a generator
  // that measured `text.length` from one that measured the file.
  const wide = JSON.stringify({ Hi: "あ".repeat(30) });
  assert.ok(utf8.encode(wide).length > wide.length);
  const path = directory({ "en.json": wide });
  await assert.rejects(
    () => createStringsManifestFromDirectory(path, { ...OPTIONS, limits: { maximumInputBytes: wide.length } }),
    /bytes exceeds the maximum of/);
  assert.ok(await createStringsManifestFromDirectory(path, {
    ...OPTIONS, limits: { maximumInputBytes: utf8.encode(wide).length },
  }), "the limit is inclusive at the exact byte count");
});

test("the file-count budget counts EMITTED catalogs, not directory entries", async () => {
  // The complement of the discovery budget, which charges every entry. Here two dotfiles and a
  // subdirectory cost nothing, and only the two catalogs count.
  const path = directory({ ...catalogs(["en", "fr"]), ".hidden": "x", ".DS_Store": "x", sub: null, README: "x" });
  await assert.rejects(
    () => createStringsManifestFromDirectory(path, { ...OPTIONS, limits: { maximumLocalizedStringsFiles: 1 } }),
    /more than 1 localized strings files/);
  assert.equal(Object.keys(await createStringsManifestFromDirectory(path, {
    ...OPTIONS, limits: { maximumLocalizedStringsFiles: 2 },
  }).then((m) => m.files)).length, 2);
});

test("the discovery budget charges every entry, including the ones it skips", async () => {
  const path = directory({ ...catalogs(["en"]), ".hidden": "x", sub: null });
  await assert.rejects(
    () => createStringsManifestFromDirectory(path, { ...OPTIONS, maximumDiscoveryEntries: 2 }),
    /exceeds the aggregate maximum of 2 discovery entries/);
  assert.ok(await createStringsManifestFromDirectory(path, { ...OPTIONS, maximumDiscoveryEntries: 3 }));
});

// ------------------------------------------------------------ hostile entries

test("a dangling symlink and a FIFO are refused with the raw door's own diagnostics", async () => {
  const dangling = directory(catalogs(["en"]));
  symlinkSync(join(dangling, "nothing-here.json"), join(dangling, "de.json"));
  await assert.rejects(() => createStringsManifestFromDirectory(dangling, OPTIONS),
    /Unable to determine canonical path for localized strings file/);

  // A FIFO must be classified by stat and never OPENED — opening one blocks forever with no writer,
  // which is why S3's differential needed a timeout for the same shape.
  const fifoDir = directory(catalogs(["en"]));
  execFileSync("mkfifo", [join(fifoDir, "de.json")]);
  await assert.rejects(() => createStringsManifestFromDirectory(fifoDir, OPTIONS), /is not a regular file/);
});

// ------------------------------------------------------------ the composed door

test("loadStringsFromDirectory composes all the way to a rendered string and a stamp", async () => {
  const path = directory(catalogs(["en", "fr", "de"]));
  const loaded = await loadStringsFromDirectory(path, OPTIONS);

  assert.deepEqual(loaded.coverage, { kind: "entire-manifest" });
  assert.equal(loaded.complete, true);
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ e) => e.locale), ["de", "en", "fr"]);

  const strings = createStrings({ loaded, locale: "fr" });
  assert.equal(strings.get("Hi"), "hello fr");

  // The generated manifest's identity survives all the way into the SSR stamp, and the manifest a
  // publisher would ship from the same directory carries the same fingerprint.
  const published = await createStringsManifestFromDirectory(path, { ...OPTIONS, publicationBaseUrl: "https://cdn.example/v1/" });
  assert.equal(createSsrStamp(strings, { kind: "locale", locale: "fr" }).catalogFingerprint,
    published.catalogFingerprint);
});

test("the generated manifest carries the RENDERER's pinned data, not a placeholder", async () => {
  // Not inspected as a field but proved by the chain: `createStrings({ loaded })` compares the
  // result's CLDR identity against its own pinned data and refuses any mismatch, so a generator that
  // invented these values produces a manifest nothing can ever construct from.
  const path = directory(catalogs(["en"]));
  const manifest = await createStringsManifestFromDirectory(path, OPTIONS);
  assert.equal(manifest.cldrVersion, pinnedProvenance().cldrVersion);
  assert.equal(manifest.dataFingerprint, pinnedProvenance().dataFingerprint);
  assert.ok(createStrings({ loaded: await loadStringsFromDirectory(path, OPTIONS), locale: "en" }));
});

test("EVERY FILE IS READ TWICE, and the second read is what makes the digest real", async () => {
  // The composed door hashes during generation and verifies during the load. Caching the first read
  // into the second would halve the I/O and make the digest a tautology — a hash compared against
  // the bytes it was taken from, in the same call. Here the catalog CHANGES between the two halves,
  // and the digest is the only thing that can notice.
  const path = directory(catalogs(["en", "fr"]));
  let served = 0;
  const error = await loadStringsFromDirectory(path, {
    ...OPTIONS,
    readFile: async (/** @type {string} */ url) => {
      ++served;
      // The load half is handed DIFFERENT bytes of the SAME LENGTH than the generation half hashed.
      // Length matters: `decodedBytes` is emitted, so a body of a different size is refused one stage
      // EARLIER, as `limit` — measured, and a good property, but it would leave the digest itself
      // untested. A same-length substitution is exactly what only a digest can catch.
      return utf8.encode(url.endsWith("fr.json") ? JSON.stringify({ Hi: "hello XX" }) : bodyFor("en"));
    },
  }).then(() => null, (e) => e);

  assert.equal(served, 2, "the load half reads every file again; it does not reuse the scan's bytes");
  assert.equal(error?.name, "StringsLoadingError");
  assert.deepEqual(error.failures.map((/** @type {any} */ f) => f.stage), ["digest"]);
  assert.equal(error.failures[0].locale, "fr");
});

// ------------------------------------------------------------ found by adversarial review, S11b

test("the AGGREGATE byte budget is charged, on both sides of the boundary", async () => {
  // One of the three limits plan clause 64 names, and deleting it left all 1048 tests green —
  // review's finding, and the reason a limit needs its boundary tested from both directions rather
  // than merely mentioned in a docblock.
  const body = bodyFor("en");
  const size = utf8.encode(body).length;
  const path = directory({ "en.json": body, "fr.json": bodyFor("fr") });
  const total = size + utf8.encode(bodyFor("fr")).length;

  await assert.rejects(
    () => createStringsManifestFromDirectory(path, { ...OPTIONS, limits: { maximumTotalInputBytes: total - 1 } }),
    /the catalogs total more than/);
  assert.ok(await createStringsManifestFromDirectory(path, { ...OPTIONS, limits: { maximumTotalInputBytes: total } }),
    "the aggregate limit is inclusive at the exact total");
});

test("manifest keys are emitted in NORMALIZED-TAG order, not in filename order", async () => {
  // Plan 6.2: "Discovery and manifest output use normalized-tag order." Every other assertion in this
  // file sorts the keys before comparing, so dropping the sort passed all of them — review's finding.
  // `ZH-hant.json` is the discriminating name: uppercase Z sorts BEFORE lowercase `en` in the walk's
  // UTF-8 byte order, while its rendered tag `zh-Hant` sorts AFTER `en`.
  const path = directory({ "ZH-hant.json": bodyFor("zh"), "en.json": bodyFor("en") });
  const manifest = await createStringsManifestFromDirectory(path, OPTIONS);
  assert.deepEqual(Object.keys(manifest.files), ["en", "zh-Hant"], "not the walk's filename order");
});

test("a ReadonlyMap of tiebreakers is HONOURED, not silently dropped", async () => {
  // Plan 3.2 types the option `Readonly<Record<…>> | ReadonlyMap<…>`; the manifest FIELD is a record,
  // so converting is the generator's job. It did not: a Map passed the validator's object test and
  // then met `Object.entries`, which answers `[]` — so a publisher's declared orders vanished and the
  // manifest fingerprinted EXACTLY as if none had been given. Nothing downstream could detect it.
  const path = directory(catalogs(["en", "fr", "fr-CA"]));
  const viaRecord = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: { fr: ["fr", "fr-CA"] } });
  const viaMap = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: new Map([["fr", ["fr", "fr-CA"]]]) });
  const without = await createStringsManifestFromDirectory(path, OPTIONS);

  assert.deepEqual(viaMap.tiebreakers, viaRecord.tiebreakers);
  assert.equal(viaMap.catalogFingerprint, viaRecord.catalogFingerprint);
  // The anti-vacuity half: the two must differ from declaring none, or the equality above would hold
  // over a generator that dropped BOTH forms.
  assert.notEqual(viaMap.catalogFingerprint, without.catalogFingerprint);
});

test("a non-canonically spelled tiebreaker is normalized, not turned into a self-contradiction", async () => {
  // The fingerprint used to be computed over the caller's spelling while `validateStringsManifest`
  // normalized and RE-derived it — so the generator rejected its own output with "declared X,
  // computed Y" from a single call. Any ordinary lowercase region reached it.
  const path = directory(catalogs(["en", "fr", "fr-CA"]));
  const canonical = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: { fr: ["fr", "fr-CA"] } });
  const sloppy = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: { FR: ["fr", "fr-ca"] } });
  assert.deepEqual(sloppy.tiebreakers, { fr: ["fr", "fr-CA"] });
  assert.equal(sloppy.catalogFingerprint, canonical.catalogFingerprint);
});

test("a fallbackLocale is normalized before it is matched against the catalogs", async () => {
  // `en-us` was refused over a directory holding `en-US.json`, with a message listing `en-US` two
  // words later — the generator compared the caller's spelling against rendered tags. The same
  // spelling was accepted by the manifest validator one line further on.
  const path = directory({ "en-US.json": bodyFor("en-US"), "fr.json": bodyFor("fr") });
  for (const spelling of ["en-US", "en-us", "EN-US"])
    assert.equal((await createStringsManifestFromDirectory(path, { ...OPTIONS, fallbackLocale: spelling })).fallbackLocale,
      "en-US", `${spelling} must name the catalog on disk`);
  await assert.rejects(() => createStringsManifestFromDirectory(path, { ...OPTIONS, fallbackLocale: "de" }),
    /is the declared fallbackLocale 'de'/);
});

test("a malformed tiebreaker is a ConfigurationError, not a bare TypeError from the canonicalizer", async () => {
  // It used to escape from the JCS canonicalizer, because the fingerprint was computed before
  // anything validated the shape: `name: "TypeError"`, no `code`, and for a non-object value it
  // quoted a key the caller never wrote.
  const path = directory(catalogs(["en", "fr"]));
  for (const bad of [{ fr: "fr-CA" }, { fr: [1] }, "fr-CA"]) {
    const error = await createStringsManifestFromDirectory(path, { ...OPTIONS, tiebreakers: /** @type {any} */ (bad) })
      .then(() => null, (e) => e);
    assert.equal(error?.name, "ConfigurationError", `${JSON.stringify(bad)} must be a ConfigurationError`);
    assert.equal(error.code, "CONFIGURATION");
  }
});

test("a locale the raw door loads but no manifest may key on names the FILE", async () => {
  // `en-US-x-lvariant-POSIX.json` renders `en-US-POSIX`, which the walk accepts and the manifest tag
  // rule does not. The refusal used to come from `validateStringsManifest` as "A manifest file key is
  // 'en-US-POSIX'" — true, and useless to someone looking at a directory, since it named neither the
  // file to rename nor the directory it is in.
  const path = directory({ "en.json": bodyFor("en"), "en-US-x-lvariant-POSIX.json": bodyFor("p") });
  assert.deepEqual(Object.keys(readStringsFromDirectory(path).catalogs), ["en", "en-US-POSIX"]);
  await assert.rejects(() => createStringsManifestFromDirectory(path, OPTIONS),
    /en-US-x-lvariant-POSIX\.json in .* a manifest cannot publish: 'en-US-POSIX'/);
});
