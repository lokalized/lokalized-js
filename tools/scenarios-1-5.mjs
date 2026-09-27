#!/usr/bin/env node
// @ts-check
/**
 * SCENARIOS 1-5 — plan 9.2:2814-2817's consumer scenarios, one frozen, recorded, ratcheted suite.
 *
 *   1  self-contained no-build browser root         dist/browser/lokalized.js
 *   2  bundler import of `lokalized`                 esbuild over the installed tarball
 *   3  `lokalized/core`, already parsed catalog      esbuild, and the no-build core.js graph
 *   4  root plus ordinal data                        esbuild, and no-build core.js + data/ordinal.js
 *   5  root plus range data                          esbuild, and no-build core.js + data/ranges.js
 *
 * The no-build forms of 4 and 5 still reach the ROOT: `src/data/ordinal.js` and `src/data/ranges.js`
 * import `../index.js`, so that graph is module for module the bundled root plus its data (34 modules
 * each, recorded). `core.js` is only where a chunked page gets `createStrings`; the recipe module says
 * why the single-file root is not paired with a data entry instead.
 *
 * The recipes, fixtures, method and every frozen digest are in `tools/scenarios-1-5/recipe.mjs`; the
 * code that takes each column is `tools/scenarios-1-5/measure.mjs` and the code that takes each runtime
 * sample is `tools/scenarios-1-5/harness.mjs`, both inside every recipe digest; every verdict on a
 * measurement or a record is a pure function in `tools/scenarios-1-5/check.mjs`, which
 * `test/scenarios-1-5.test.js` shows failing. This file packs, orchestrates, prints and writes. It stops
 * before measuring when there is nothing sound to measure — a pack that fails, or a rebuild that fails
 * or is not the shipped artifact — and a variant that does not build is a named problem, not a stack.
 *
 * **ONE `npm pack` OF THE WORKING TREE, EXTRACTED TWICE.** Outside `node_modules` for the rebuild,
 * because esbuild's `legalComments: "eof"` lists the paths of inputs under `node_modules` and a rebuild
 * there came out 517 bytes off the shipped root (measured). Inside a `node_modules/lokalized` for the
 * bundler forms, because that is where a consumer's bundler finds the package. The work directory is
 * `realpath`'d: macOS's temp folder is a symlink, and esbuild resolving through it changed every chunk
 * hash (measured, 47 identity problems).
 *
 * **THE REBUILD IS THE SHIPPED ARTIFACT OR NOTHING IS MEASURED.** `dist/browser` is rebuilt from the
 * tarball's own `src/` with `tools/build-browser.mjs`'s options, reproduced in `measure.mjs`. With
 * `minify: true` it must equal every shipped file byte for byte and produce no other, in both directions;
 * only then does the same build with `minify: false` count as the no-build forms' pre-minification
 * column. A mismatch stops the run before measuring, naming each file.
 *
 * **WHAT FAILS, WHAT IS REPORTED** (the rules and their reasons are in `check.mjs`):
 *
 *   ALWAYS      a frozen digest that moved, a recipe with no variant or no module it must reach, a frozen
 *               scenario or variant not measured (or one measured that nothing froze), containment, a
 *               src/data module in no data row, a render that is not the fixture's expected string,
 *               unordered columns, the rebuild, a sample that crashed or timed out, a variant whose
 *               runtime is missing or not finite in the run or the record, a history that does
 *               not chain from the frozen origin or whose newest entry is not the one frozen, figures that
 *               entry does not vouch for, and a missing record — absence is never agreement.
 *   RATCHETED   rawSource, rawModules, preMinify, minified, requests and included-graph MEMBERSHIP: any
 *               growth fails until re-recorded with `--write --reason`.
 *   TOLERANCE   gzip-9, brotli-q11, brotli-q5, compared only on the compressor version they were recorded
 *               with: growth beyond max(256 B, 0.5%) of the recorded value fails the same way; anything
 *               smaller, either way, is reported STALE; another version is reported NOT COMPARED.
 *   MOVED       every figure that moved where no comparison applies — another scenario revision, another
 *               compressor version — old -> new; reported, and kept in the history by a write.
 *   REPORTED    import, construction and first-render time and retained heap, from cold child processes:
 *               never compared, and required present (A33 (4)).
 *
 * **WHICH LEGS COMPARE THE COMPRESSED COLUMNS FLOATS WITH NODE.** The record names the zlib and brotli
 * it was taken with, and a leg running another version compares no column of that library. On the
 * local builds of each (2026-09-25), against a record taken on Node 24.18.0 (zlib 1.3.1-e00f703, brotli
 * 1.2.0): 20.20.2 matches zlib only, 22.14.0 neither, 24.15.0 both, 24.20.0 brotli only. CI resolves the
 * newest release of each line, so which of its legs compare which column moves as Node ships; the step
 * prints NOT COMPARED rather than going quiet. The WRITER's Node moves it too, so a `--write` on other
 * versions than the record's is refused without `--compressors-moved`.
 *
 * **THE TOLERANCE CREEPS, and that is stated rather than discovered.** Each `--write` moves the baseline
 * to the figures of that run, so a compressed column can climb by just under its tolerance on every
 * write, indefinitely, with every step inside the band. Nothing mechanical bounds it, and the ratcheted
 * columns do not either: the review's shuffle grew gzip-9 and brotli-q11 on every variant with minified
 * unchanged. What stands against it is the reason every write must give and the STALE lines it records
 * beside it, kept in the chained history.
 *
 * **THE HISTORY SURVIVES ITS RECORD, AND ITS NEWEST ENTRY IS FROZEN.** `measurements/scenarios-1-5.json`
 * keeps every rebaseline as a chained entry (`tools/ratchet-chain.mjs`); its first entry's digest and its
 * newest entry are frozen in the recipe module, and the newest vouches for the recorded figures. With the
 * record deleted, `--write` refuses to start a new history, and one written any other way does not begin
 * at the frozen origin. A `--write` prints the newest entry to freeze, and the check fails until it is
 * pasted — so every rebaseline carries a one-line source change, which is its review. Without that pin, a
 * review rewrote the newest entry together with the figures it vouches for and the check passed.
 *
 * **FROZEN LATE**: plan 9.2 says "freeze at M2 exit" and this was first frozen on 2026-09-25, on scenario
 * 6's precedent. **NO THRESHOLDS**, by A3 and A4/A7 (restated as A33, 2026-09-25). Both are in the record.
 *
 *   npm run scenario:1-5                                     check against the record
 *   npm run scenario:1-5 -- --write --reason "what moved and why"   re-record (refused under CI)
 *     [--compressors-moved]                                  ...on other zlib/brotli versions than the record's
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { browserEntries } from "./browser-entries.mjs";
import { entryDigest } from "./ratchet-chain.mjs";
import {
  RECORD_NAME, baselineSha256, classifyDataRows, compareMeasurements, containmentProblems, dataRowTableProblems,
  frozenProblems, identityProblems, measuredProblems, nextRecord, packedFilename, recipeShapeProblems, recordFindings,
  runtimeProblems, soundnessProblems, underCi, writeChanges, writeRefusal,
} from "./scenarios-1-5/check.mjs";
import { measureRuntime, measureVariant, rebuild, shippedBrowserFiles, walk } from "./scenarios-1-5/measure.mjs";
import {
  COMMON, DATA_ROWS, ENTRIES, FIXTURE_DIGESTS, HISTORY_NEWEST_ENTRY, HISTORY_ORIGIN_SHA256, RECIPES, RECIPE_DIGESTS,
  SUITE_DIGESTS, currentDigests, fixturePath,
} from "./scenarios-1-5/recipe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (/** @type {string | Uint8Array} */ input) => createHash("sha256").update(input).digest("hex");
const write = process.argv.includes("--write");
const reason = process.argv.includes("--reason") ? process.argv[process.argv.indexOf("--reason") + 1] ?? null : null;
const started = performance.now();
const esbuild = await import("esbuild");

/** @type {string[]} */ const problems = [];
/** @type {string[]} */ let growth = [];
/** @type {string[]} */ let stale = [];
/** @type {string[]} */ let moved = [];
/** @type {string[]} */ let notCompared = [];

/** Print every problem so far and stop: the run cannot go on to measure anything meaningful. */
function stop(/** @type {string} */ why) {
  console.error(`\n${why}`);
  console.error(`${problems.length} problem(s):`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}

// ------------------------------------------------------------------------------- 1. the frozen suite
// Every verdict below is handed to `problems` (or `growth`) in a statement of its own, the shape
// `test/scenarios-1-5.test.js` pins: this file is in no digest and no unit test runs it, so a deleted
// call would otherwise fail nothing.
const current = currentDigests();
problems.push(...frozenProblems(current, { recipeDigests: RECIPE_DIGESTS, fixtureDigests: FIXTURE_DIGESTS, suiteDigests: SUITE_DIGESTS }));
problems.push(...recipeShapeProblems(RECIPES, ENTRIES));

// ------------------------------------------------------------------------------------- 2. the artifact
const work = realpathSync(mkdtempSync(join(tmpdir(), "lokalized-scenarios-1-5-")));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
const tPack = performance.now();
let tarball;
try {
  // `prepack` PRINTS TO STDOUT, so `--json` output is lifecycle banners followed by the array, and
  // `packedFilename` finds the array from the end (its docblock says why not from the first bracket).
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", work], { cwd: root, encoding: "utf8" });
  const filename = packedFilename(packOutput);
  if (filename === null) throw new Error(`npm pack --json printed no JSON array: ${packOutput.slice(-300)}`);
  tarball = join(work, filename);
} catch (error) {
  problems.push(`npm pack of the working tree failed: ${String(/** @type {any} */ (error).message ?? error).split("\n")[0]}`);
  stop("there is no artifact to measure.");
}
const packMs = performance.now() - tPack;
const pkgDir = join(work, "pkg");
const site = join(work, "site");
const installed = join(site, "node_modules", "lokalized");
for (const directory of [pkgDir, installed]) {
  mkdirSync(directory, { recursive: true });
  execFileSync("tar", ["-xzf", /** @type {string} */ (tarball), "-C", directory, "--strip-components", "1"]);
}
writeFileSync(join(site, "package.json"), '{ "type": "module" }\n');
const distDir = join(pkgDir, "dist", "browser");
const buildManifestText = readFileSync(join(distDir, "build-manifest.json"), "utf8");
const identityModule = await import(pathToFileURL(join(pkgDir, "src/core/index.js")).href);

// ------------------------------------------------------------------ 3. the rebuild, and its identity
const entries = browserEntries(JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).exports)
  .map((entry) => ({ ...entry, source: join(pkgDir, entry.source) }));
const targets = JSON.parse(buildManifestText).targets;
const tBuild = performance.now();
/** @type {Awaited<ReturnType<typeof rebuild>>} */ let shippedBuild;
/** @type {Awaited<ReturnType<typeof rebuild>>} */ let unminifiedBuild;
try {
  shippedBuild = await rebuild(esbuild, { pkgDir, distDir, entries, targets, minify: true });
  unminifiedBuild = await rebuild(esbuild, { pkgDir, distDir, entries, targets, minify: false });
} catch (error) {
  problems.push(`rebuilding dist/browser from the tarball failed: ${String(/** @type {any} */ (error).message ?? error).split("\n")[0]}`);
  stop("there is no rebuild to hold the shipped files to.");
}
const shippedFiles = shippedBrowserFiles(distDir);
const identity = identityProblems(shippedFiles, new Map([...shippedBuild].map(([path, output]) => [path, output.bytes])));
if (identity.length) {
  problems.push(...identity);
  stop("the recipe's rebuild is not the shipped dist/browser, so tools/build-browser.mjs and measure.mjs have drifted " +
    "apart and every pre-minification figure would describe some other build:");
}

// ----------------------------------------------------------------------------------- 4. the data rows
const shippedDataModules = walk(join(pkgDir, "src", "data")).filter((path) => path.endsWith(".js")).map((path) => `src/data/${path}`);
problems.push(...dataRowTableProblems(shippedDataModules, DATA_ROWS));

// ------------------------------------------------------------------------------------ 5. each variant
const context = { pkgDir, distDir, site, installed, work, shippedBuild, unminifiedBuild };

/** @type {import("./scenarios-1-5/check.mjs").Run} */
const run = {
  suite: current.suite,
  compressors: { zlib: /** @type {string} */ (process.versions.zlib), brotli: /** @type {string} */ (process.versions.brotli) },
  scenarios: {},
};
const tStatic = performance.now();
let runtimeMs = 0;
for (const [id, recipe] of Object.entries(RECIPES)) {
  const fixture = JSON.parse(readFileSync(fixturePath(recipe.fixture), "utf8"));
  /** @type {Record<string, any>} */ const variants = {};
  for (const variant of recipe.variants) {
    const at = `scenario ${id} ${variant.label}`;
    let measured;
    try { measured = await measureVariant(esbuild, context, id, variant); }
    catch (error) {
      problems.push(`${at}: did not build: ${String(/** @type {any} */ (error).message ?? error).split("\n")[0]}`);
      continue;
    }
    const includedGraph = [...measured.graph.keys()].sort();
    problems.push(...containmentProblems(at, recipe, includedGraph));
    const { rows, unclassified } = classifyDataRows(measured.graph, DATA_ROWS);
    for (const module of unclassified) problems.push(`${at}: ${module} is in the included graph and in no data row`);
    problems.push(...soundnessProblems(at, /** @type {any} */ (measured.columns)));
    const tRuntime = performance.now();
    const sampled = measureRuntime(at, { fixture: fixturePath(recipe.fixture), input: recipe.input, form: variant.form,
      modules: measured.modules, data: /** @type {any} */ (variant).data ?? null }, fixture.expected);
    problems.push(...sampled.problems);
    const runtime = sampled.runtime;
    runtimeMs += performance.now() - tRuntime;
    variants[variant.label] = { form: variant.form, files: measured.files, columns: measured.columns, dataRows: rows, includedGraph, runtime };
  }
  run.scenarios[id] = { title: recipe.title, revision: recipe.revision, recipeSha256: /** @type {string} */ (current.recipe[id]),
    fixtureSha256: /** @type {string} */ (current.fixture[id]), variants };
}
problems.push(...measuredProblems(RECIPES, run));
problems.push(...runtimeProblems("this run", run.scenarios));

const attestation = {
  tarballSha256: sha256(readFileSync(/** @type {string} */ (tarball))),
  outputGraphSha256: sha256(buildManifestText),
  dataFingerprint: identityModule.dataFingerprint,
  ianaDataFingerprint: identityModule.ianaDataFingerprint,
  identityRebuild: `${shippedFiles.size} of ${shippedFiles.size} shipped dist/browser files byte-identical`,
  resultSha256: baselineSha256(run),
  environment: { node: process.version, v8: process.versions.v8, esbuild: esbuild.version, platform: process.platform,
    arch: process.arch, cpu: cpus()[0]?.model ?? null },
};

// ------------------------------------------------------------------------------------ 6. the record
const recordPath = join(root, RECORD_NAME);
/** @type {any} */ let record = null;
let unreadable = false;
if (existsSync(recordPath)) {
  try { record = JSON.parse(readFileSync(recordPath, "utf8")); }
  catch (error) { unreadable = true; problems.push(`${RECORD_NAME} is not valid JSON: ${/** @type {any} */ (error).message}`); }
}
// A missing record is judged too — NOT RECORDED, a problem — except by the write that creates it, which
// `writeRefusal` decides.
if (!unreadable && (record || !write)) {
  const findings = recordFindings(record, run, { origin: HISTORY_ORIGIN_SHA256, newest: HISTORY_NEWEST_ENTRY });
  problems.push(...findings.problems);
  const compared = compareMeasurements(record, run);
  growth = [...findings.growth, ...compared.growth];
  stale = compared.stale;
  moved = compared.moved;
  notCompared = compared.notCompared;
}

// ------------------------------------------------------------------------------------------- output
const n = (/** @type {number} */ x) => x.toLocaleString("en-US");
console.log(`scenarios 1-5 — suite revision ${run.suite.revision} (${run.suite.sha256.slice(0, 12)}) — ${process.version}, ` +
  `esbuild ${esbuild.version}, zlib ${run.compressors.zlib}, brotli ${run.compressors.brotli}`);
console.log(`  tarball ${attestation.tarballSha256.slice(0, 12)}  output graph ${attestation.outputGraphSha256.slice(0, 12)}  ` +
  `data ${String(attestation.dataFingerprint).slice(0, 12)}  ${attestation.identityRebuild}\n`);
console.log(`  ${"scenario / variant".padEnd(40)}${"raw src".padStart(10)}${"mods".padStart(6)}${"pre-min".padStart(10)}` +
  `${"minified".padStart(10)}${"gzip-9".padStart(9)}${"br-q11".padStart(9)}${"br-q5".padStart(9)}${"req".padStart(5)}` +
  `${"graph".padStart(7)}`);
for (const [id, scenario] of Object.entries(run.scenarios))
  for (const [label, v] of Object.entries(scenario.variants)) {
    const c = v.columns;
    console.log(`  ${`${id} ${label}`.padEnd(40)}${n(c.rawSource).padStart(10)}${String(c.rawModules).padStart(6)}` +
      `${n(c.preMinify).padStart(10)}${n(c.minified).padStart(10)}${n(c.gzip9).padStart(9)}${n(c.brotliQ11).padStart(9)}` +
      `${n(c.brotliQ5).padStart(9)}${String(c.requests).padStart(5)}${String(v.includedGraph.length).padStart(7)}`);
  }
console.log(`\n  data rows (bytes in the minified output, by esbuild's own accounting):`);
for (const [id, scenario] of Object.entries(run.scenarios))
  for (const [label, v] of Object.entries(scenario.variants))
    console.log(`    ${`${id} ${label}`.padEnd(38)} ${Object.entries(v.dataRows).map(([row, bytes]) => `${row} ${n(bytes)}`).join(" · ")}`);
// EVERY RUNTIME FIGURE THIS RUN TOOK IS PRINTED — A33 (4)'s "reported" — where the import time and heap
// alone were before (2026-09-26). A variant without one prints a dash here and is a problem above
// (`runtimeProblems`); the statement reading `v.runtime` is pinned by the test.
console.log(`\n  runtime (median of cold child processes; reported, never compared, required present):`);
console.log(`  ${"scenario / variant".padEnd(40)}${"samples".padStart(8)}${"import ms".padStart(11)}${"construct ms".padStart(14)}` +
  `${"1st render ms".padStart(15)}${"retained B".padStart(12)}`);
for (const [id, scenario] of Object.entries(run.scenarios))
  for (const [label, v] of Object.entries(scenario.variants)) {
    const rt = /** @type {any} */ (v.runtime);
    const shown = (/** @type {string} */ figure, /** @type {number} */ width) =>
      (rt ? (figure === "retainedBytes" && typeof rt[figure] === "number" ? n(rt[figure]) : String(rt[figure])) : "—").padStart(width);
    console.log(`  ${`${id} ${label}`.padEnd(40)}${shown("samples", 8)}${shown("importMs", 11)}${shown("constructMs", 14)}` +
      `${shown("firstRenderMs", 15)}${shown("retainedBytes", 12)}`);
  }
console.log(`\n  result sha256 ${attestation.resultSha256}`);
console.log(`  timing: pack ${Math.round(packMs)} ms, rebuild ${Math.round(tStatic - tBuild)} ms, ` +
  `static ${Math.round(performance.now() - tStatic - runtimeMs)} ms, runtime children ${Math.round(runtimeMs)} ms, ` +
  `whole run ${Math.round(performance.now() - started)} ms`);
if (stale.length) { console.log(`\n  STALE (reported, not gated):`); for (const line of stale) console.log(`    ${line}`); }
if (moved.length) { console.log(`\n  MOVED, NOT COMPARED (reported; a --write keeps them):`); for (const line of moved) console.log(`    ${line}`); }
if (notCompared.length) { console.log(`\n  NOT COMPARED (reported):`); for (const line of notCompared) console.log(`    ${line}`); }

// -------------------------------------------------------------------------------------------- write
if (write) {
  const refusal = writeRefusal({ ci: underCi(process.env), reason, problems, record,
    origin: HISTORY_ORIGIN_SHA256, newest: HISTORY_NEWEST_ENTRY,
    compressors: run.compressors, compressorsMoved: process.argv.includes("--compressors-moved") });
  if (refusal) {
    for (const line of problems) console.error(`  - ${line}`);
    console.error(`\n${refusal.message}`);
    process.exit(refusal.status);
  }
  const next = nextRecord(record, run, {
    note: `${COMMON.thresholdsNote} Frozen late: plan 9.2:2814-2817 says scenarios 1-5 "freeze at M2 exit"; this ` +
      "suite was first frozen on 2026-09-25, on scenario 6's precedent (freeze now, and make every later comparison mean " +
      "something). The deviation is the record.",
    attestation, reason: /** @type {string} */ (reason), date: new Date().toISOString().slice(0, 10),
    changes: writeChanges(record, { growth, stale, moved, notCompared }),
  });
  writeFileSync(recordPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  const newest = next.history.length - 1;
  console.log(`\nrecord written to ${RECORD_NAME}, history entry ${newest} (reason kept). Review its diff, then freeze`);
  console.log(`in tools/scenarios-1-5/recipe.mjs — until then the check fails naming it:`);
  if (HISTORY_ORIGIN_SHA256 === undefined) console.log(`  HISTORY_ORIGIN_SHA256 = "${entryDigest(next.history[0])}"`);
  console.log(`  HISTORY_NEWEST_ENTRY = Object.freeze(${JSON.stringify({ index: newest, sha256: entryDigest(next.history[newest]) })})`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------ verdict
if (problems.length || growth.length) {
  if (problems.length) { console.error(`\n${problems.length} problem(s):`); for (const line of problems) console.error(`  - ${line}`); }
  if (growth.length) {
    console.error(`\nGROWTH (${growth.length}, gated):`);
    for (const line of growth) console.error(`  - ${line}`);
    console.error(`Re-record deliberately: npm run scenario:1-5 -- --write --reason "what grew and why"`);
  }
  process.exit(1);
}
console.log(`\n  NO THRESHOLDS (A3; A4/A7, restated as A33): ratcheted columns and graphs cannot grow, compressed columns`);
console.log(`  cannot grow beyond their tolerance, without a recorded reason; timings and heap are reported, never`);
console.log(`  compared, and required present.`);
