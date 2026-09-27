// @ts-check
/**
 * SCENARIOS 1-5's FROZEN SUITE — plan 9.2:2814-2817's catalogue entries, as declared objects with
 * digests — in its own module because the runner and the tests both read it and a second copy would
 * drift, which is why `tools/0b-recipe.mjs` exists.
 *
 * **WHAT IS FROZEN, AND WHERE THE DIGEST OF EACH LIVES.** Plan 9.2:2795-2797: "Changing the frozen
 * recipe, fixture, environment, method, or threshold creates a reviewed scenario revision and cannot
 * be compared as the same scenario." So:
 *
 *   RECIPE     each scenario's declared object below, plus `COMMON`, `METHOD`, the consumer entry
 *              sources it compiles and the bytes of the two files that take its measurements,
 *              `harness.mjs` and `measure.mjs` — `recipeSha256`, frozen per scenario AND REVISION in
 *              `RECIPE_DIGESTS`;
 *   FIXTURE    the bytes of the file under `fixtures/` it renders — `fixtureSha256`, frozen the same way
 *              in `FIXTURE_DIGESTS`;
 *   SUITE      every scenario's revision and both digests — `currentDigests().suite`, frozen per
 *              `SUITE_REVISION` in `SUITE_DIGESTS`. Plan 9.3:2856-2857 asks for "exactly one immutable M7
 *              scenario-suite revision" and says "Its hash is recorded"; this is that hash, recorded in
 *              every history entry, and it also covers the SET of scenarios, so deleting one moves it.
 *
 * All three survive the record: they are in SOURCE, so deleting `measurements/scenarios-1-5.json` and
 * writing it again cannot launder a changed recipe or fixture under an unmoved revision — the hole
 * `RECIPE_DIGESTS` in `tools/0b-recipe.mjs` records closing for 0b, which the prototype of this tool
 * reopened for its fixture. What none of them can stop is someone editing a frozen digest along with
 * the thing it freezes: a deliberate edit to a line whose only job is not to change, which a reviewer
 * sees.
 *
 * **`check.mjs` IS IN NO DIGEST, DELIBERATELY.** It judges the figures and takes none of them, so a rule
 * changing there changes no figure's meaning; and freezing it would make every edit to a rule a
 * revision of all five scenarios, which the ratchet does not compare across — tightening a rule would
 * switch comparison off for the write that lands it. Its rules are held by `test/scenarios-1-5.test.js`
 * instead, each seen failing. The one rule that is a threshold, the compressed columns' tolerance, is
 * also stated in `METHOD.tolerance`, inside every digest, and a test holds the code to that statement
 * with literal numbers at every figure the record holds.
 *
 * **THE RECORD'S HISTORY IS FROZEN AT BOTH ENDS.** `HISTORY_ORIGIN_SHA256` pins its first entry and
 * `HISTORY_NEWEST_ENTRY` its newest, and because every entry's digest covers the link to the one before
 * it, the newest pins them all. The newest is the one line here that DOES change — once per `--write`,
 * by a reviewed paste of what the write prints — and that is its point: without it, editing the newest
 * entry together with the figures it vouches for left a valid chain, and a review inflated every figure
 * that way and then grew the source by 14 bytes, both at exit 0 (2026-09-25).
 *
 * **FROZEN LATE, AND THE DEVIATION IS THE RECORD.** Plan 9.2:2814-2817 says scenarios 1-5 "freeze at M2
 * exit". They were first frozen on 2026-09-25, during M-R and long after M7 closed: M8 clause 89 names
 * them among the scenarios that must meet "its frozen threshold and tolerance", A4/A7 (restated as A33,
 * 2026-09-25) read that as "recorded, ratcheted where a ratchet exists, reported where none does", and
 * none of the five had ever been built. Scenario 6 set the precedent (`tools/scenario-6.mjs:8-13`):
 * freeze it now and make every later comparison mean something.
 *
 * **NO THRESHOLDS**, by A3 (M7 clause 19) and A4/A7 (restated as A33): recorded, ratcheted where a
 * ratchet exists, reported where none does. The ratchet and the tolerance below are that shape.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { entryDigest } from "../ratchet-chain.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (/** @type {string | Uint8Array} */ input) => createHash("sha256").update(input).digest("hex");

/** The file every runtime sample runs, whose bytes are inside every recipe digest. */
export const HARNESS_PATH = join(here, "harness.mjs");
/** The file that computes every other column, whose bytes are inside every recipe digest too. */
export const MEASURE_PATH = join(here, "measure.mjs");
/** A fixture's checked-in file. @param {string} name */
export const fixturePath = (name) => join(here, "fixtures", `${name}.json`);

/**
 * THE MANIFEST FIELDS plan 9.2:2787-2792 names, shared by all five. Where the plan asks for a value
 * this project does not have, the field says so rather than being omitted.
 */
export const COMMON = Object.freeze({
  profileIds: Object.freeze(["strict-parity-0.x-draft"]),
  owner: "M7",
  freezeDeadline: "M2 exit (plan 9.2:2814-2817); MISSED — first frozen 2026-09-25, scenario 6's precedent",
  repeatedAt: "M-R",
  packRecipe: "npm pack of the working tree, whose prepack runs types, build:browser --write and divergences --write",
  artifactIdentity: "the tarball's sha256, its dist/browser/build-manifest.json's sha256 and the build's dataFingerprint " +
    "and ianaDataFingerprint, recorded per run: a new digest is a new RUN of the same scenario, never a new scenario",
  runtime: Object.freeze({
    environment: "node, no browser: every compared column is a property of the bytes",
    cache: "cold: one fresh process per sample",
    warmUp: 1,
    samples: 5,
    concurrency: 1,
    aggregation: "median (p50)",
    timeoutMs: 30000,
    failedSample: "a sample that crashes, times out, prints no result or renders the wrong string fails the run; none is dropped",
  }),
  hardware: "recorded per run (platform, architecture, cpu) and never compared. Plan 9.3:2862-2863 has CI use the " +
    "manifest's exact hardware; CI here is ubuntu on four Node versions, so the record is compared across machines. " +
    "Measured 2026-09-25: gzip-9, brotli-q11 and brotli-q5 of each of the 17 dist/browser scripts were identical on " +
    "darwin-arm64, linux-arm64 and emulated linux-x64 for the same zlib and brotli versions, and a compressed column " +
    "is compared only on the version it was recorded with",
  thresholds: null,
  thresholdsNote: "No thresholds, by A3 (M7 clause 19) and A4/A7 (restated as A33, 2026-09-25): recorded, " +
    "ratcheted where a ratchet exists, reported where none does. A green run shows the figures cannot grow " +
    "unnoticed; it does not show that any of them meets a number.",
  proxyInventory: null,
  proxyNote: "Not applicable: the complete graph exists. Plan 9.2:2827's future-code proxies were an M2 device.",
});

/**
 * HOW EACH COLUMN IS TAKEN, as data the runner reads rather than prose beside code that could say
 * otherwise. Every field is inside every recipe digest, and so is every byte of the two files that take
 * the measurements, `harness.mjs` and `measure.mjs`, so changing a compression level, the bundler's
 * options, a tolerance or the code that takes a column is a new revision, not a quieter comparison. The
 * code that COMPARES — `check.mjs`, the tolerance's arithmetic included — is not, and the module header
 * says why and what holds it instead.
 */
export const METHOD = Object.freeze({
  harness: Object.freeze({
    file: "tools/scenarios-1-5/harness.mjs",
    command: "node --expose-gc tools/scenarios-1-5/harness.mjs <job JSON>",
  }),
  measure: Object.freeze({
    file: "tools/scenarios-1-5/measure.mjs",
    role: "the dist/browser rebuild, each variant's fetch graph and columns, and the runtime samples' aggregation",
  }),
  /** A consumer's bundler, over the tarball extracted to node_modules/lokalized. `minify` is the one switch. */
  bundler: Object.freeze({ bundle: true, minify: true, format: "esm", platform: "browser" }),
  columns: Object.freeze({
    rawSource: "bytes of every package module esbuild parsed to produce the variant's outputs, read from the tarball",
    rawModules: "how many modules that is",
    preMinify: "the same build with minify false and nothing else changed; for a no-build form, the rebuild of " +
      "dist/browser that is verified byte-identical to the shipped files when minify is true",
    minified: "the shipped dist/browser bytes a page fetches (a no-build form), or the bundler's output (a bundler form)",
    requests: "files a page fetches: the entry files and every chunk they import; 1 for a bundle",
    includedGraph: "modules esbuild reports putting bytes into the minified output",
    dataRows: "those modules' bytes in src/data, summed by DATA_ROWS (plan 9.2:2782-2785's separate rows); reported",
  }),
  /** Each response compressed alone, then summed. The library is what a column is compared on. */
  compression: Object.freeze({
    gzip9: Object.freeze({ library: "zlib", gzipLevel: 9 }),
    brotliQ11: Object.freeze({ library: "brotli", brotliQuality: 11, sizeHint: "the input's length" }),
    brotliQ5: Object.freeze({ library: "brotli", brotliQuality: 5, sizeHint: "the input's length" }),
  }),
  /** Zero tolerance for growth: a byte more fails until it is re-recorded with a reason. */
  ratcheted: Object.freeze(["rawSource", "rawModules", "preMinify", "minified", "requests"]),
  /**
   * Plan 9.2:2792's "regression tolerances", for the compressed columns only, and only on the compressor
   * version they were recorded with. `rule` is what `tolerance` in `check.mjs` must compute, and the test
   * that holds it there uses literal numbers, not these fields. Why a band rather than the ratchet is in
   * `check.mjs`.
   */
  tolerance: Object.freeze({
    compressedBytes: 256, compressedFraction: 0.005,
    rule: "growth fails beyond max(compressedBytes, ceil(recorded value * compressedFraction)) bytes; " +
      "smaller movement, either way, is reported",
  }),
});

/** The optional data. Scenarios 1-3 may reach none of it; 4 and 5 must reach one and may reach no other. */
const OPTIONAL_DATA = Object.freeze({
  ordinal: "src/data/ordinal-rules.js",
  ranges: "src/data/cardinal-ranges.js",
  fullRange: "src/data/iana-range-equivalents.js",
});

/**
 * The consumer entries a bundler compiles. The fixture is supplied at RUN time, so it is never in the
 * bytes being weighed.
 */
export const ENTRIES = Object.freeze({
  root: 'import { createStrings } from "lokalized";\nexport const construct = (options) => createStrings(options);\n',
  core: 'import { createStrings } from "lokalized/core";\nexport const construct = (options) => createStrings(options);\n',
  ordinal: 'import { createStrings } from "lokalized";\nimport { ordinalData } from "lokalized/data/ordinal";\n' +
    "export const construct = (options) => createStrings({ ...options, pluralData: { ordinal: ordinalData } });\n",
  ranges: 'import { createStrings } from "lokalized";\nimport { cardinalRangeData } from "lokalized/data/ranges";\n' +
    "export const construct = (options) => createStrings({ ...options, pluralData: { ranges: cardinalRangeData } });\n",
});

/**
 * THE FROZEN RECIPES. A variant's `form` is "no-build" (the files a page fetches from dist/browser,
 * entry files plus every chunk they import) or "bundler" (one esbuild output of an `ENTRIES` source).
 * `mustReach` and `mustNotReach` are containment the scenario is DEFINED by, checked on the included
 * graph every run.
 *
 * **Scenario 1 is `dist/browser/lokalized.js`, the single-file root, and NOT the classic global.**
 * `lokalized.global.js` is all eight browser entries in one IIFE (A21), and the prototype's containment
 * rule fired on it: it reaches the ordinal, range and full-range data. `check:bundle` reports it.
 *
 * **The no-build forms of 4 and 5 are `core.js` plus the data entry, not `lokalized.js` plus it.** The
 * single-file root shares no chunk with anything, so pairing it with a data entry ships the rendering
 * data twice — the prototype measured 374,813 minified and 9 requests — which is what the README's "Do
 * not mix the root with another subpath" (README.md:2769) warns against. And `src/data/ordinal.js` and
 * `src/data/ranges.js` both import `../index.js`, so this graph DOES reach the root: it is module for
 * module the bundled root plus that data (34 modules each), which is why it is still "root plus ordinal
 * data" in substance. `core.js` is in it only because the chunked graph has no root entry to import
 * `createStrings` from.
 *
 * **Scenario 3 must not reach `src/index.js`.** It is `lokalized/core`, and a core that came to import
 * the root would quietly become scenario 2: the ratchet would call the new module growth, which a
 * `--write --reason` accepts, where containment is what the scenario IS and cannot be re-recorded away.
 * That holds only while the runner applies it, so `test/scenarios-1-5.test.js` pins the runner handing
 * every verdict to the run's verdict: with the call deleted, a review re-recorded exactly that growth.
 */
export const RECIPES = Object.freeze({
  1: Object.freeze({
    revision: 1, title: "self-contained no-build browser root", input: "raw", fixture: "base",
    variants: Object.freeze([
      Object.freeze({ label: "root module", form: "no-build", files: Object.freeze(["lokalized.js"]) }),
    ]),
    mustReach: Object.freeze(["src/index.js"]),
    mustNotReach: Object.freeze([OPTIONAL_DATA.ordinal, OPTIONAL_DATA.ranges, OPTIONAL_DATA.fullRange]),
  }),
  2: Object.freeze({
    revision: 1, title: "bundler import of `lokalized`", input: "raw", fixture: "base",
    variants: Object.freeze([Object.freeze({ label: "esbuild", form: "bundler", entry: "root" })]),
    mustReach: Object.freeze(["src/index.js"]),
    mustNotReach: Object.freeze([OPTIONAL_DATA.ordinal, OPTIONAL_DATA.ranges, OPTIONAL_DATA.fullRange]),
  }),
  3: Object.freeze({
    revision: 1, title: "`lokalized/core` with an already parsed catalog", input: "parsed", fixture: "base",
    variants: Object.freeze([
      Object.freeze({ label: "esbuild", form: "bundler", entry: "core" }),
      Object.freeze({ label: "no-build core.js", form: "no-build", files: Object.freeze(["core.js"]) }),
    ]),
    mustReach: Object.freeze(["src/core/index.js"]),
    mustNotReach: Object.freeze(["src/index.js", OPTIONAL_DATA.ordinal, OPTIONAL_DATA.ranges, OPTIONAL_DATA.fullRange]),
  }),
  4: Object.freeze({
    revision: 1, title: "root plus ordinal data", input: "raw", fixture: "ordinal",
    variants: Object.freeze([
      Object.freeze({ label: "esbuild", form: "bundler", entry: "ordinal" }),
      Object.freeze({ label: "no-build core.js + data/ordinal.js", form: "no-build",
        files: Object.freeze(["core.js", "data/ordinal.js"]),
        data: Object.freeze({ option: "ordinal", export: "ordinalData" }) }),
    ]),
    mustReach: Object.freeze([OPTIONAL_DATA.ordinal, "src/index.js"]),
    mustNotReach: Object.freeze([OPTIONAL_DATA.ranges, OPTIONAL_DATA.fullRange]),
  }),
  5: Object.freeze({
    revision: 1, title: "root plus range data", input: "raw", fixture: "ranges",
    variants: Object.freeze([
      Object.freeze({ label: "esbuild", form: "bundler", entry: "ranges" }),
      Object.freeze({ label: "no-build core.js + data/ranges.js", form: "no-build",
        files: Object.freeze(["core.js", "data/ranges.js"]),
        data: Object.freeze({ option: "ranges", export: "cardinalRangeData" }) }),
    ]),
    mustReach: Object.freeze([OPTIONAL_DATA.ranges, "src/index.js"]),
    mustNotReach: Object.freeze([OPTIONAL_DATA.ordinal, OPTIONAL_DATA.fullRange]),
  }),
});

/**
 * PLAN 9.2:2782-2785's SEPARATE DATA ROWS, by module name under src/data. Every src/data module the
 * tarball ships must sit in exactly one row and every name here must exist, or the run fails: a new data
 * module cannot enter a graph unweighed, and a row cannot outlive its module.
 *
 * Deliberately OUTSIDE the recipe digests: this table sorts bytes the run has already measured into
 * named rows and changes no compared column, so extending it for a new module is not a new scenario.
 */
export const DATA_ROWS = Object.freeze({
  "rendering locale/cardinal": Object.freeze(["aliases-language", "aliases-region", "aliases-script",
    "aliases-variant", "cardinal", "likely-subtags", "parents", "rtl", "provenance"]),
  "validity/IANA identity": Object.freeze(["valid-languages", "valid-regions", "valid-scripts", "valid-variants",
    "iana-identity-equivalents"]),
  "optional ordinal": Object.freeze(["ordinal-rules"]),
  "optional range": Object.freeze(["cardinal-ranges"]),
  "full-range solver data": Object.freeze(["iana-range-equivalents"]),
  "data API code": Object.freeze(["ordinal", "ranges"]),
});

// ================================================================================= the digests

/**
 * What a scenario's recipe NAMES: its declared object, the shared manifest and method, the entry sources
 * it compiles, and the bytes of the harness it runs and of the code that measures it.
 * @param {string} id
 */
export function recipeDigestInput(id) {
  const recipe = /** @type {any} */ (RECIPES)[id];
  return {
    recipe, common: COMMON, method: METHOD,
    harnessSha256: sha256(readFileSync(HARNESS_PATH)), measureSha256: sha256(readFileSync(MEASURE_PATH)),
    entries: Object.fromEntries(recipe.variants.filter((/** @type {any} */ v) => v.entry)
      .map((/** @type {any} */ v) => [v.entry, /** @type {any} */ (ENTRIES)[v.entry]])),
  };
}

/** @param {string} id */
export const recipeSha256 = (id) => entryDigest(recipeDigestInput(id));

/** The bytes of the fixture a scenario renders. @param {string} id */
export const fixtureSha256 = (id) => sha256(readFileSync(fixturePath(/** @type {any} */ (RECIPES)[id].fixture)));

/** Every scenario's revision and digests, as they are in this checkout. */
export function currentDigests() {
  /** @type {Record<string, number>} */ const revisions = {};
  /** @type {Record<string, string>} */ const recipe = {};
  /** @type {Record<string, string>} */ const fixture = {};
  for (const [id, declared] of Object.entries(RECIPES)) {
    revisions[id] = declared.revision;
    recipe[id] = recipeSha256(id);
    fixture[id] = fixtureSha256(id);
  }
  const suite = entryDigest({ scenarios: Object.fromEntries(Object.keys(revisions)
    .map((id) => [id, { revision: revisions[id], recipeSha256: recipe[id], fixtureSha256: fixture[id] }])) });
  return { revisions, recipe, fixture, suite: { revision: SUITE_REVISION, sha256: suite } };
}

// ============================================================================ the frozen tables
//
// Each line below exists NOT to change. A revision names one recipe and one fixture; change either and
// the revision must move with it, and the new revision's digests are added beside the old ones.

/** @type {Readonly<Record<string, Readonly<Record<number, string>>>>} */
export const RECIPE_DIGESTS = Object.freeze({
  1: Object.freeze({ 1: "3f41582f933a4dc821e99eb9782fc5c5c355981cc182efa097a581ab455e4c1f" }),
  2: Object.freeze({ 1: "7f5af5b3153a0e66820a91d0ecaff0e7d92295b89910053f58fb702d5e8631af" }),
  3: Object.freeze({ 1: "8eafa50ef953b5a72ca5bb0b8fc78a88f041ba3a2b0558850105ce2e98bce90f" }),
  4: Object.freeze({ 1: "b6a8322ff7e302268843ec8bd7a11742d0509664892eca7702db859911787df1" }),
  5: Object.freeze({ 1: "5b19e25e2408d242b82e04b4a3db5f0ff4e78eb6a8ab4e293105f3a7aa3cf03f" }),
});

/** @type {Readonly<Record<string, Readonly<Record<number, string>>>>} */
export const FIXTURE_DIGESTS = Object.freeze({
  1: Object.freeze({ 1: "879413e921644b0372133b1fb8b64eab67bdb0771c146f140bde99b96c4e5d55" }),
  2: Object.freeze({ 1: "879413e921644b0372133b1fb8b64eab67bdb0771c146f140bde99b96c4e5d55" }),
  3: Object.freeze({ 1: "879413e921644b0372133b1fb8b64eab67bdb0771c146f140bde99b96c4e5d55" }),
  4: Object.freeze({ 1: "08aaf60d391b58ece02ca4b5d15137ee28974f14e119d0ec82d91eddab9d435c" }),
  5: Object.freeze({ 1: "e58cdbf2da4bfe47eea335c15eec1a5a31936216766c49950f8efe87a5db5ad4" }),
});

export const SUITE_REVISION = 1;
/** @type {Readonly<Record<number, string>>} */
export const SUITE_DIGESTS = Object.freeze({
  1: "4894b2608203bb6b17dc91cc26140ab2a002e3c83ff87d8bfabe7563b23914db",
});

/**
 * The digest of the first entry in `measurements/scenarios-1-5.json`'s history. With it frozen here, a
 * deleted and re-written record starts a history that does not begin where this says, so the ratchet
 * cannot be reset by removing its record (`tools/ratchet-chain.mjs`).
 * @type {string | undefined}
 */
export const HISTORY_ORIGIN_SHA256 = "f4c6a3d54ea213823931e84b4f40115fa95305c391812ff0e58935da5f384557";

// ==================================================================== the one line that moves
//
// Unlike everything above, this changes on every `--write`: the write prints the value, and pasting it
// here is the review. Until it is pasted the check fails naming it, and a second `--write` is refused,
// so no write can bury an unreviewed newest entry — its own, or a hand edit's — in the middle of the
// chain, where only this line would ever have pinned it. It GATES rather than reports, so every
// re-record, the one that follows a merge included, is finished by this one-line paste.

/**
 * The newest entry of `measurements/scenarios-1-5.json`'s history: its index and its digest. The chain
 * alone cannot see its own end — nothing names the newest entry — so without this, rewriting that entry
 * along with the figures it vouches for passes (`newestEntryProblems` in `check.mjs`).
 * @type {Readonly<{ index: number, sha256: string }> | undefined}
 */
export const HISTORY_NEWEST_ENTRY = Object.freeze({ index: 0, sha256: "f4c6a3d54ea213823931e84b4f40115fa95305c391812ff0e58935da5f384557" });
