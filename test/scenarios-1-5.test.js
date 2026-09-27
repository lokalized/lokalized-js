// @ts-check
/**
 * `npm run scenario:1-5`'s rules, each seen failing on a SYNTHETIC record in milliseconds.
 *
 * The tool itself packs the tarball, rebuilds `dist/browser` and runs 48 cold child processes, so it
 * cannot be ablated once per rule inside `npm test`. Every pass/fail decision it makes is a pure
 * function in `tools/scenarios-1-5/check.mjs`, and this file hands each one the input that must fail —
 * growth without a reason, a reason removed, a broken chain, a scenario omitted or invented, a fixture or
 * recipe moved under an unmoved revision, compressed growth either side of its tolerance, a compressor
 * version that does not match, a missing record, an unclassified data module, a wrong render, a rebuild
 * compared in one direction only, the newest history entry rewritten with its figures, a scenario
 * hollowed out under a new revision, a column taken another way, a rebaseline that drops what moved, a
 * write that moves the compressor versions, a runtime missing or not finite in the run or the record —
 * beside the control that must pass, and for the runtime a slower run that must pass too, because it is
 * reported and never compared. A rule nothing has seen fail is a claim, and a gate whose rules are
 * claims is decoration.
 *
 * `check.mjs` is in no recipe digest, so two things here stand in for one: the tolerance held to its
 * rule with LITERAL numbers at every figure the record holds, and the runner's source pinned to hand
 * every verdict to its exit status. A review widened the band and deleted the containment call, and
 * both exited 0 with every earlier test green (2026-09-25).
 *
 * The tests under "the real frozen suite" read the checked-in recipes, fixtures, measuring code, runner
 * and record, because those are what a hand edit would break and all of them are cheap: a few small
 * files and one JSON document. Nothing here creates a temp directory.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import { chained, entryDigest } from "../tools/ratchet-chain.mjs";
import {
  RECORD_NAME, baselineSha256, classifyDataRows, compareMeasurements, containmentProblems, dataRowTableProblems,
  frozenProblems, identityProblems, measuredProblems, newestEntryProblems, nextRecord, packedFilename,
  recipeShapeProblems, recordFindings, renderProblems, runtimeProblems, sampleOutcome, soundnessProblems, tolerance, underCi,
  writeChanges, writeRefusal,
} from "../tools/scenarios-1-5/check.mjs";
import * as check from "../tools/scenarios-1-5/check.mjs";
import { closure, weigh } from "../tools/scenarios-1-5/measure.mjs";
import {
  DATA_ROWS, ENTRIES, FIXTURE_DIGESTS, HARNESS_PATH, HISTORY_NEWEST_ENTRY, HISTORY_ORIGIN_SHA256, MEASURE_PATH, METHOD,
  RECIPES, RECIPE_DIGESTS, SUITE_DIGESTS, currentDigests, recipeDigestInput, recipeSha256,
} from "../tools/scenarios-1-5/recipe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------------------ synthetic material

/** Columns that satisfy the soundness order, scaled by a whole number so each variant differs. @param {number} k */
const columns = (k = 1) => ({ rawSource: 700000 * k, rawModules: 30, preMinify: 350000 * k, minified: 180000 * k,
  gzip9: 66000 * k, brotliQ11: 55000 * k, brotliQ5: 62000 * k, requests: 1 });
/** A runtime aggregate as `measureRuntime` returns one. @param {number} k */
const runtime = (k = 1) => ({ samples: 5, importMs: 8.3 * k, constructMs: 1.9, firstRenderMs: 1.9, retainedBytes: 2600000 * k });
/** @param {number} k */
const variant = (k = 1) => ({ form: "bundler", files: ["(one bundle)"], columns: columns(k),
  dataRows: { "rendering locale/cardinal": 48000 }, includedGraph: ["src/core/index.js", "src/index.js"], runtime: runtime(k) });

/** A two-scenario run, the second with two variants. @returns {import("../tools/scenarios-1-5/check.mjs").Run} */
function makeRun() {
  return {
    suite: { revision: 1, sha256: "s".repeat(64) },
    compressors: { zlib: "1.3.1", brotli: "1.2.0" },
    scenarios: {
      1: { title: "one", revision: 1, recipeSha256: "r1".repeat(32), fixtureSha256: "f1".repeat(32), variants: { a: variant(1) } },
      2: { title: "two", revision: 1, recipeSha256: "r2".repeat(32), fixtureSha256: "f2".repeat(32),
        variants: { b: variant(2), c: { ...variant(3), form: "no-build", columns: { ...columns(3), requests: 7 } } } },
    },
  };
}
const WRITE = { note: "n", attestation: { tarballSha256: "t" }, date: "2026-09-25", changes: ["the first record of the frozen suite"] };
/** The newest entry of a history, as a tool would freeze it after review. @param {any} record */
const newestOf = (record) => ({ index: record.history.length - 1, sha256: entryDigest(record.history[record.history.length - 1]) });
/** A record as `--write` makes it, and the origin and newest entry a tool would have frozen for it. */
function recorded(run = makeRun()) {
  const record = nextRecord(null, run, { ...WRITE, reason: "first record" });
  const origin = entryDigest(record.history[0]);
  return { record, origin, newest: newestOf(record), frozen: { origin, newest: newestOf(record) } };
}
const clone = (/** @type {any} */ value) => structuredClone(value);
const RECIPE_SHAPE = { 1: { variants: [{ label: "a" }] }, 2: { variants: [{ label: "b" }, { label: "c" }] } };

// ============================================================================ the real frozen suite

test("the checked-in recipes and fixtures are the ones frozen for their revisions, and the suite with them", () => {
  assert.deepEqual(frozenProblems(currentDigests(),
    { recipeDigests: RECIPE_DIGESTS, fixtureDigests: FIXTURE_DIGESTS, suiteDigests: SUITE_DIGESTS }), []);
  // The anti-vacuity half: the suite is plan 9.2's five, each frozen, and a table is not empty.
  assert.deepEqual(Object.keys(RECIPES), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(Object.keys(RECIPE_DIGESTS), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(Object.keys(FIXTURE_DIGESTS), ["1", "2", "3", "4", "5"]);
});

test("the checked-in record's history chains from the frozen origin and vouches for its figures", () => {
  const path = join(root, RECORD_NAME);
  assert.ok(existsSync(path), `${RECORD_NAME} is missing; absence is never agreement`);
  assert.equal(typeof HISTORY_ORIGIN_SHA256, "string", "HISTORY_ORIGIN_SHA256 is not frozen, so the history can be started over");
  assert.ok(HISTORY_NEWEST_ENTRY, "HISTORY_NEWEST_ENTRY is not frozen, so the newest entry can be rewritten with its figures");
  const record = JSON.parse(readFileSync(path, "utf8"));
  const run = { suite: record.suite, compressors: record.compressors, scenarios: record.scenarios };
  assert.deepEqual(recordFindings(record, run, { origin: HISTORY_ORIGIN_SHA256, newest: HISTORY_NEWEST_ENTRY }),
    { problems: [], growth: [] });
  assert.equal(record.suite.sha256, currentDigests().suite.sha256, "the record was taken under another suite");
});

const DATA = { ordinal: "src/data/ordinal-rules.js", ranges: "src/data/cardinal-ranges.js", fullRange: "src/data/iana-range-equivalents.js" };

test("the five scenarios are the ones decided for this suite, variant by variant, and each measures something", () => {
  // A SECOND COPY ON PURPOSE. The frozen tables hold a recipe to itself across a revision, so a scenario
  // hollowed out under a new revision passed every gate (a review, 2026-09-25). What each scenario IS
  // was decided when the suite was built; changing it is a decision, and this is where it shows.
  const definition = Object.fromEntries(Object.entries(RECIPES).map(([id, recipe]) => [id, {
    input: recipe.input, fixture: recipe.fixture,
    variants: recipe.variants.map((/** @type {any} */ v) => ({ form: v.form,
      ...(v.form === "no-build" ? { files: [...v.files] } : { entry: v.entry }),
      ...(v.data ? { data: { ...v.data } } : {}) })),
    mustReach: [...recipe.mustReach].sort(), mustNotReach: [...recipe.mustNotReach].sort(),
  }]));
  assert.deepEqual(definition, {
    1: { input: "raw", fixture: "base", variants: [{ form: "no-build", files: ["lokalized.js"] }],
      mustReach: ["src/index.js"], mustNotReach: [DATA.ranges, DATA.fullRange, DATA.ordinal].sort() },
    2: { input: "raw", fixture: "base", variants: [{ form: "bundler", entry: "root" }],
      mustReach: ["src/index.js"], mustNotReach: [DATA.ranges, DATA.fullRange, DATA.ordinal].sort() },
    3: { input: "parsed", fixture: "base", variants: [{ form: "bundler", entry: "core" }, { form: "no-build", files: ["core.js"] }],
      mustReach: ["src/core/index.js"], mustNotReach: ["src/index.js", DATA.ranges, DATA.fullRange, DATA.ordinal].sort() },
    4: { input: "raw", fixture: "ordinal", variants: [{ form: "bundler", entry: "ordinal" },
      { form: "no-build", files: ["core.js", "data/ordinal.js"], data: { option: "ordinal", export: "ordinalData" } }],
    mustReach: [DATA.ordinal, "src/index.js"].sort(), mustNotReach: [DATA.ranges, DATA.fullRange].sort() },
    5: { input: "raw", fixture: "ranges", variants: [{ form: "bundler", entry: "ranges" },
      { form: "no-build", files: ["core.js", "data/ranges.js"], data: { option: "ranges", export: "cardinalRangeData" } }],
    mustReach: [DATA.ranges, "src/index.js"].sort(), mustNotReach: [DATA.ordinal, DATA.fullRange].sort() },
  });
  // The consumer entries import what their scenario names, and nothing a neighbour's does.
  const imports = (/** @type {string} */ source) => [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports(ENTRIES.root), ["lokalized"]);
  assert.deepEqual(imports(ENTRIES.core), ["lokalized/core"]);
  assert.deepEqual(imports(ENTRIES.ordinal), ["lokalized", "lokalized/data/ordinal"]);
  assert.deepEqual(imports(ENTRIES.ranges), ["lokalized", "lokalized/data/ranges"]);
  assert.deepEqual(recipeShapeProblems(RECIPES, ENTRIES), []);
});

/**
 * A source file as the wiring test reads it: comments gone (the runner's JSDoc casts are block
 * comments), and every run of whitespace one space, so re-wrapping a line changes nothing.
 * @param {string} path
 */
const codeOf = (path) => readFileSync(join(root, path), "utf8")
  .replace(/\/\*[^]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\s+/g, " ");

test("the runner hands every verdict to its exit status (it is in no digest and no other test runs it)", () => {
  // A REVIEW MEASURED WHY: with `containmentProblems`' one call deleted, the run exited 0, and with core
  // then importing the root, `--write --reason` recorded it as 30 lines of growth and, once its entry was
  // pasted, the check passed — the containment `recipe.mjs` says cannot be re-recorded away (2026-09-25).
  const runner = codeOf("tools/scenarios-1-5.mjs");
  /** @type {[string, string][]} what each fragment guards, and the fragment */
  const wiring = [
    ["frozen digests", "problems.push(...frozenProblems("],
    ["recipe shape", "problems.push(...recipeShapeProblems("],
    ["rebuild identity", "const identity = identityProblems("],
    ["rebuild identity, which stops the run", "if (identity.length) { problems.push(...identity); stop("],
    ["the data-row table", "problems.push(...dataRowTableProblems("],
    ["containment", "problems.push(...containmentProblems("],
    ["unclassified data modules", "const { rows, unclassified } = classifyDataRows("],
    ["unclassified data modules, as problems", "for (const module of unclassified) problems.push("],
    ["column order", "problems.push(...soundnessProblems("],
    ["runtime samples and renders", "const sampled = measureRuntime("],
    ["runtime samples and renders, as problems", "problems.push(...sampled.problems)"],
    // A REVIEW MEASURED WHY (2026-09-26): with this line's value replaced by `null`, the run exited 0
    // with every timing printed as a dash and every test here green.
    ["the runtime sample, as the run records it", "const runtime = sampled.runtime;"],
    // AND A SECOND REVIEW MEASURED WHY THE NEXT TWO ARE WHOLE STATEMENTS (2026-09-26): with only a prefix
    // pinned, `runtimeProblems("this run", {})` beside `runtime: null` in the assembly exited 0 with every
    // test green; and `columns: { ...measured.columns, rawSource: measured.columns.rawSource - 20 }` hid 12
    // bytes of growth at exit 0, reported only STALE. Each is what the record is built from.
    ["each variant, assembled from its measurement unchanged",
      "variants[variant.label] = { form: variant.form, files: measured.files, columns: measured.columns, dataRows: rows, includedGraph, runtime };"],
    ["completeness", "problems.push(...measuredProblems("],
    ["every variant's runtime, present and finite", "problems.push(...runtimeProblems(\"this run\", run.scenarios));"],
    ["a missing record, judged unless a write creates it", "if (!unreadable && (record || !write)) {"],
    ["the record", "const findings = recordFindings("],
    ["the record, as problems", "problems.push(...findings.problems)"],
    ["the ratchet and the tolerance", "const compared = compareMeasurements("],
    ["growth, from the record and the comparison", "growth = [...findings.growth, ...compared.growth]"],
    ["the write refusals", "const refusal = writeRefusal("],
    // A33 (4)'s "reported": the runtime table reads each variant's runtime as recorded. The same review
    // replaced this with `null` and every figure printed as a dash at exit 0.
    ["every runtime figure, printed", "const rt = (v.runtime);"],
  ];
  const missing = wiring.filter(([, fragment]) => !runner.includes(fragment)).map(([what]) => what);
  assert.deepEqual(missing, [], `tools/scenarios-1-5.mjs no longer hands these verdicts on: ${missing.join("; ")}`);
  assert.match(runner, /if \(refusal\) \{.*?process\.exit\(refusal\.status\); \}/, "a refused write must exit with its status");
  assert.match(runner, /if \(problems\.length \|\| growth\.length\) \{.*?process\.exit\(1\); \}/, "problems and growth must exit 1");
  // Completeness: every function check.mjs exports is called somewhere — by the runner, by measure.mjs
  // (inside every digest), or inside check.mjs itself — so a new verdict cannot ship unwired.
  const callers = [runner, codeOf("tools/scenarios-1-5/measure.mjs"), codeOf("tools/scenarios-1-5/check.mjs")].join(" ");
  const uncalled = Object.entries(check).filter(([, value]) => typeof value === "function").map(([name]) => name)
    .filter((name) => callers.split(`${name}(`).length - callers.split(`function ${name}(`).length < 1);
  assert.deepEqual(uncalled, [], `check.mjs exports verdicts nothing calls: ${uncalled.join(", ")}`);
});

test("every recipe digest covers the bytes of the code that takes its measurements", () => {
  // A REVIEW MEASURED WHY: while the column code sat outside every digest, brotli-q5 taken at quality 11
  // and requests counted from entry files alone each exited 0, reported STALE (2026-09-25).
  const sha = (/** @type {string} */ path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(join(root, METHOD.harness.file), HARNESS_PATH);
  assert.equal(join(root, METHOD.measure.file), MEASURE_PATH);
  for (const id of Object.keys(RECIPES)) {
    const input = recipeDigestInput(id);
    assert.equal(input.harnessSha256, sha(HARNESS_PATH), `scenario ${id}`);
    assert.equal(input.measureSha256, sha(MEASURE_PATH), `scenario ${id}`);
    assert.equal(recipeSha256(id), entryDigest(input), `scenario ${id}`);
  }
});

// ================================================================================ the frozen tables

const frozenFor = (/** @type {ReturnType<typeof currentDigests>} */ current) => ({
  recipeDigests: Object.fromEntries(Object.keys(current.revisions).map((id) => [id, { 1: current.recipe[id] }])),
  fixtureDigests: Object.fromEntries(Object.keys(current.revisions).map((id) => [id, { 1: current.fixture[id] }])),
  suiteDigests: { 1: current.suite.sha256 },
});
const synthetic = () => ({ revisions: { 1: 1, 2: 1 }, recipe: { 1: "a".repeat(64), 2: "b".repeat(64) },
  fixture: { 1: "c".repeat(64), 2: "d".repeat(64) }, suite: { revision: 1, sha256: "e".repeat(64) } });

test("frozen: the control passes, and a table with no digest for a revision names the one to freeze", () => {
  assert.deepEqual(frozenProblems(synthetic(), frozenFor(synthetic())), []);
  const frozen = frozenFor(synthetic());
  delete frozen.recipeDigests[2][1];
  assert.match(frozenProblems(synthetic(), frozen).join("\n"),
    new RegExp(`scenario 2 revision 1 has no frozen recipe digest.*freeze "${"b".repeat(64)}"`));
});

test("frozen: a recipe that moved while its revision stayed fails", () => {
  const now = { ...synthetic(), recipe: { 1: "a".repeat(64), 2: "9".repeat(64) } };
  assert.match(frozenProblems(now, frozenFor(synthetic())).join("\n"),
    /scenario 2's recipe changed \(bbbbbbbbbbbb -> 999999999999\) while its revision stayed 1/);
});

test("frozen: a FIXTURE that moved while its revision stayed fails — from source, so no record is needed to see it", () => {
  // Review item B: the prototype compared the fixture only against the RECORD, so changing the fixture,
  // deleting the record and writing a new one exited 0 at the old revision. Nothing here reads a record.
  const now = { ...synthetic(), fixture: { 1: "7".repeat(64), 2: "d".repeat(64) } };
  const problems = frozenProblems(now, frozenFor(synthetic()));
  assert.match(problems.join("\n"), /scenario 1's fixture changed \(cccccccccccc -> 777777777777\) while its revision stayed 1/);
});

test("frozen: a bumped revision with its digests frozen passes; bumping without freezing does not", () => {
  const now = { ...synthetic(), revisions: { 1: 2, 2: 1 }, recipe: { 1: "7".repeat(64), 2: "b".repeat(64) } };
  const frozen = frozenFor(synthetic());
  assert.match(frozenProblems(now, frozen).join("\n"), /scenario 1 revision 2 has no frozen recipe digest/);
  frozen.recipeDigests[1] = { ...frozen.recipeDigests[1], 2: "7".repeat(64) };
  frozen.fixtureDigests[1] = { ...frozen.fixtureDigests[1], 2: "c".repeat(64) };
  assert.deepEqual(frozenProblems(now, frozen), []);
});

test("frozen: DELETING a scenario from the recipes fails, and so does emptying them (review item A)", () => {
  const frozen = frozenFor(synthetic());
  const without2 = { revisions: { 1: 1 }, recipe: { 1: "a".repeat(64) }, fixture: { 1: "c".repeat(64) }, suite: synthetic().suite };
  assert.match(frozenProblems(without2, frozen).join("\n"), /scenario 2 is frozen in RECIPE_DIGESTS and no recipe measures it/);
  assert.match(frozenProblems(without2, frozen).join("\n"), /scenario 2 is frozen in FIXTURE_DIGESTS/);
  const empty = { revisions: {}, recipe: {}, fixture: {}, suite: synthetic().suite };
  assert.match(frozenProblems(empty, frozen).join("\n"), /RECIPES is empty/);
});

test("frozen: the suite digest moving under an unmoved SUITE_REVISION fails, and so does a missing one", () => {
  const now = { ...synthetic(), suite: { revision: 1, sha256: "f".repeat(64) } };
  assert.match(frozenProblems(now, frozenFor(synthetic())).join("\n"), /the suite changed .* while SUITE_REVISION stayed 1/);
  assert.match(frozenProblems({ ...synthetic(), suite: { revision: 2, sha256: "f".repeat(64) } }, frozenFor(synthetic())).join("\n"),
    /suite revision 2 has no frozen digest/);
});

test("the real suite digest covers every scenario's recipe and fixture digest, so each one moves it", () => {
  const current = currentDigests();
  assert.equal(current.suite.sha256, SUITE_DIGESTS[current.suite.revision]);
  assert.equal(current.suite.sha256, entryDigest({ scenarios: Object.fromEntries(Object.keys(current.revisions).map((id) =>
    [id, { revision: current.revisions[id], recipeSha256: current.recipe[id], fixtureSha256: current.fixture[id] }])) }));
});

test("shape: a recipe hollowed out under a new revision fails however its digests were frozen", () => {
  const recipe = { input: "raw", fixture: "base", mustReach: ["src/index.js"], mustNotReach: [],
    variants: [{ label: "esbuild", form: "bundler", entry: "root" }] };
  const entries = { root: "import x from 'lokalized';" };
  assert.deepEqual(recipeShapeProblems({ 5: recipe }, entries), []);
  // The review's ablation: scenario 5 at `variants: []`, every frozen table updated as told.
  assert.deepEqual(recipeShapeProblems({ 5: { ...recipe, variants: [] } }, entries), ["scenario 5 declares no variant, so it measures nothing"]);
  assert.match(recipeShapeProblems({ 5: { ...recipe, mustReach: [] } }, entries).join(), /must reach no module/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, mustNotReach: ["src/index.js"] } }, entries).join(),
    /both must and must not reach src\/index.js/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, input: "text" } }, entries).join(), /input is "text"/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, fixture: "" } }, entries).join(), /names no fixture/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, variants: [{ label: "x", form: "bundler", entry: "gone" }] } }, entries).join(),
    /compiles entry "gone", which ENTRIES does not define/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, variants: [{ label: "x", form: "no-build", files: [] }] } }, entries).join(),
    /no-build form that fetches no file/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, variants: [{ label: "x", form: "cdn" }] } }, entries).join(), /form is "cdn"/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, variants: [recipe.variants[0], recipe.variants[0]] } }, entries).join(),
    /two variants labelled esbuild/);
  assert.match(recipeShapeProblems({ 5: { ...recipe, variants: [{ ...recipe.variants[0], data: { option: "ranges" } }] } }, entries).join(),
    /optional data with no option or export name/);
});

// ================================================================================== completeness

test("measured: every frozen variant must be measured, and nothing else", () => {
  assert.deepEqual(measuredProblems(RECIPE_SHAPE, makeRun()), []);
  const run = makeRun();
  delete run.scenarios[2].variants.c;
  assert.deepEqual(measuredProblems(RECIPE_SHAPE, run), ["scenario 2 c is frozen and was not measured"]);
  const extra = makeRun();
  extra.scenarios[3] = clone(extra.scenarios[1]);
  assert.deepEqual(measuredProblems(RECIPE_SHAPE, extra), ["scenario 3 a was measured and no frozen recipe names it"]);
});

// ======================================================================================== the record

test("record: a missing record is NOT RECORDED, never agreement", () => {
  assert.deepEqual(recordFindings(null, makeRun(), { origin: undefined, newest: undefined }).problems,
    [`NOT RECORDED: ${RECORD_NAME} does not exist, and absence is never agreement`]);
});

test("record: what --write makes is clean against the run it was made from", () => {
  const { record, frozen, newest } = recorded();
  assert.deepEqual(recordFindings(record, makeRun(), frozen), { problems: [], growth: [] });
  assert.deepEqual(compareMeasurements(record, makeRun()), { growth: [], stale: [], moved: [], notCompared: [] });
  assert.equal(record.history[0].baselineSha256, baselineSha256(makeRun()), "the entry vouches for exactly the run's figures");
  assert.match(recordFindings(record, makeRun(), { origin: undefined, newest }).problems.join("\n"), /has no frozen first entry; freeze/);
  assert.match(recordFindings(record, makeRun(), { ...frozen, newest: undefined }).problems.join("\n"),
    /newest history entry is frozen nowhere.*freeze HISTORY_NEWEST_ENTRY = Object\.freeze\(\{"index":0,/);
});

test("record: DELETED AND WRITTEN AGAIN with grown figures does not start at the frozen origin", () => {
  const { frozen, origin, newest } = recorded();
  const grown = makeRun();
  grown.scenarios[1].variants.a.columns.minified += 1000;
  const rewritten = nextRecord(null, grown, { ...WRITE, reason: "first record" });
  const problems = recordFindings(rewritten, grown, frozen).problems.join("\n");
  assert.match(problems, /does not start at the entry frozen for it/);
  assert.match(problems, /history entry 0 is not the entry tools\/scenarios-1-5\/recipe\.mjs freezes/);
  // ...and the write itself is refused while the record is missing and its history is frozen.
  const refusal = writeRefusal({ ci: false, reason: "why", problems: [], record: null, origin, newest,
    compressors: grown.compressors, compressorsMoved: false });
  assert.equal(refusal?.status, 1);
  assert.match(String(refusal?.message), /Restore it from git/);
});

test("record: an entry deleted, reordered or edited breaks the chain", () => {
  const { record: first, origin } = recorded();
  const run = makeRun();
  const second = nextRecord(first, run, { ...WRITE, reason: "second" });
  const third = nextRecord(second, run, { ...WRITE, reason: "third" });
  const frozen = { origin, newest: newestOf(third) };
  assert.deepEqual(recordFindings(third, run, frozen).problems, []);
  const dropped = { ...clone(third), history: [third.history[0], third.history[2]] };
  assert.match(recordFindings(dropped, run, frozen).problems.join("\n"), /entry 1 does not follow entry 0/);
  const edited = clone(third);
  edited.history[1].changes = ["nothing to see"];
  assert.match(recordFindings(edited, run, frozen).problems.join("\n"), /entry 2 does not follow entry 1/);
});

test("record: a REASON removed from an entry is named, beside the chain it breaks", () => {
  const { record: first, origin } = recorded();
  const second = nextRecord(first, makeRun(), { ...WRITE, reason: "grew on purpose" });
  const frozen = { origin, newest: newestOf(second) };
  const blanked = clone(second);
  blanked.history[1].reason = "";
  const problems = recordFindings(blanked, makeRun(), frozen).problems.join("\n");
  assert.match(problems, /history entry 1 carries no reason/);
  // Re-linking the blanked entry is not a way round it: the reason check does not depend on the chain,
  // or on the newest entry being frozen — here it is frozen AS BLANKED, and the reason is still named.
  const relinked = clone(first);
  relinked.history = [first.history[0], chained([first.history[0]], { ...second.history[1], reason: "", previousSha256: undefined })];
  assert.match(recordFindings(relinked, makeRun(), { origin, newest: newestOf(relinked) }).problems.join("\n"),
    /history entry 1 carries no reason/);
});

test("record: a figure edited in place, history untouched, is not vouched for", () => {
  const { record, frozen } = recorded();
  const edited = clone(record);
  edited.scenarios[1].variants.a.columns.minified += 5000;
  assert.match(recordFindings(edited, makeRun(), frozen).problems.join("\n"), /not the ones its last history entry recorded/);
});

test("record: a scenario or variant the record OMITS, or carries and the run does not, is growth until re-recorded", () => {
  const { record, frozen } = recorded();
  const omits = clone(record);
  delete omits.scenarios[2];
  // Edited records fail the history too; the growth line is what names the gap.
  assert.match(recordFindings(omits, makeRun(), frozen).growth.join("\n"), /scenario 2: NOT RECORDED/);
  const omitsVariant = clone(record);
  delete omitsVariant.scenarios[2].variants.c;
  assert.match(recordFindings(omitsVariant, makeRun(), frozen).growth.join("\n"), /scenario 2 c: NOT RECORDED/);
  const invents = clone(record);
  invents.scenarios[9] = clone(record.scenarios[1]);
  assert.match(recordFindings(invents, makeRun(), frozen).growth.join("\n"), /scenario 9: the record carries it and this run did not measure it/);
  const inventsVariant = clone(record);
  inventsVariant.scenarios[1].variants.z = clone(record.scenarios[1].variants.a);
  assert.match(recordFindings(inventsVariant, makeRun(), frozen).growth.join("\n"), /scenario 1 z: the record carries it/);
});

test("record: taken under another recipe or fixture at the SAME revision is a problem; at another revision it is not comparable", () => {
  const { record, frozen } = recorded();
  const moved = makeRun();
  moved.scenarios[2].fixtureSha256 = "9".repeat(64);
  assert.match(recordFindings(record, moved, frozen).problems.join("\n"),
    /scenario 2: the record was taken under fixture f2f2f2f2f2f2 and this is 999999999999, at the same revision 1/);
  const bumped = makeRun();
  bumped.scenarios[2].revision = 2;
  const findings = recordFindings(record, bumped, frozen);
  assert.deepEqual(findings.problems, []);
  assert.match(findings.growth.join("\n"), /scenario 2 is at revision 2 and the record at 1: not comparable/);
  assert.deepEqual(compareMeasurements(record, { ...bumped, scenarios: { 2: { ...bumped.scenarios[2], variants: {
    b: { ...variant(9), includedGraph: ["src/elsewhere.js"] }, c: variant(9) } } } }).growth, [], "a new revision is not compared with the old");
});

test("record: a suite revision that moved is not comparable; a suite digest that moved at the same revision is a problem", () => {
  const { record, frozen } = recorded();
  assert.match(recordFindings(record, { ...makeRun(), suite: { revision: 2, sha256: "x".repeat(64) } }, frozen).growth.join("\n"),
    /the suite is at revision 2 and the record at 1/);
  assert.match(recordFindings(record, { ...makeRun(), suite: { revision: 1, sha256: "x".repeat(64) } }, frozen).problems.join("\n"),
    /was taken under suite ssssssssssss and this is xxxxxxxxxxxx, at the same suite revision 1/);
});

test("newest: the newest entry rewritten WITH the figures it vouches for fails once it is frozen (a review's ablation)", () => {
  const { record: first, origin } = recorded();
  const run = makeRun();
  const second = nextRecord(first, run, { ...WRITE, reason: "second entry, nothing moved" });
  const frozen = { origin, newest: newestOf(second) };
  assert.deepEqual(recordFindings(second, run, frozen).problems, []);
  // The review's hand edit: +5,000 on every byte column and +3 on the counts, then ONLY the newest
  // entry's baselineSha256 recomputed. No entry added, no reason given.
  const inflated = clone(second);
  for (const scenario of Object.values(inflated.scenarios))
    for (const v of Object.values(/** @type {any} */ (scenario).variants))
      for (const column of Object.keys(v.columns)) v.columns[column] += column === "rawModules" || column === "requests" ? 3 : 5000;
  inflated.history[1].baselineSha256 = baselineSha256(inflated);
  // THE LIMIT IT CLOSES: the chain and the figure check both pass it, and the review's 14 bytes of real
  // growth then reads as a shrink.
  assert.deepEqual(recordFindings(inflated, run, { origin, newest: undefined }).problems.filter((p) => !/frozen nowhere/.test(p)), []);
  const grown = makeRun();
  grown.scenarios[1].variants.a.columns.minified += 14;
  assert.deepEqual(compareMeasurements(inflated, grown).growth, []);
  assert.match(recordFindings(inflated, grown, frozen).problems.join("\n"),
    /history entry 1 is not the entry tools\/scenarios-1-5\/recipe\.mjs freezes \([0-9a-f]{12}\); it, or an entry before it, was edited/);
});

test("newest: an unfrozen entry after the frozen one, a history cut short, and an earlier entry relinked all fail", () => {
  const { record: first, origin } = recorded();
  const run = makeRun();
  const second = nextRecord(first, run, { ...WRITE, reason: "second" });
  const third = nextRecord(second, run, { ...WRITE, reason: "third" });
  // Frozen through entry 1, and entry 2 appended: a --write not yet reviewed into source.
  assert.match(newestEntryProblems(third.history, newestOf(second)).join(),
    /1 entry after entry 1, the newest .* freezes: written by --write or by hand.*"index":2/);
  // Frozen through entry 2, and entry 2 cut off with its figures rolled back: entries were cut.
  assert.match(newestEntryProblems(second.history, newestOf(third)).join(), /ends at entry 1 and .* freezes it through entry 2: entries were cut/);
  // Entry 1 edited and every later link recomputed: a valid chain from the origin's side, and the frozen
  // newest entry's digest still moves, because it covers the links.
  /** @type {object[]} */
  const relinked = [];
  for (const [i, entry] of third.history.entries()) {
    const { previousSha256: _, ...content } = /** @type {any} */ (entry);
    relinked.push(chained(relinked, i === 1 ? { ...content, reason: "rewritten" } : content));
  }
  assert.deepEqual(recordFindings({ ...clone(third), history: relinked }, run, { origin, newest: undefined }).problems
    .filter((p) => !/frozen nowhere/.test(p)), [], "the chain alone passes a relinked history");
  assert.match(newestEntryProblems(relinked, newestOf(third)).join(), /history entry 2 is not the entry .* freezes/);
  // A frozen value that is not an index and a digest is named, not crashed on.
  assert.match(newestEntryProblems(third.history, /** @type {any} */ ({ sha256: "x" })).join(), /is not an entry index and a digest/);
  // A mangled or missing history is chainProblems' to name, not repeated here.
  assert.deepEqual(newestEntryProblems(undefined, newestOf(third)), []);
  assert.deepEqual(newestEntryProblems([null], newestOf(third)), []);
});

// ========================================================================== ratchet and tolerance

test("ratchet: every ratcheted column fails on a single byte of growth and reports a shrink", () => {
  const { record } = recorded();
  for (const column of METHOD.ratcheted) {
    const run = makeRun();
    /** @type {any} */ (run.scenarios[1].variants.a.columns)[column] += 1;
    assert.match(compareMeasurements(record, run).growth.join("\n"), new RegExp(`scenario 1 a: ${column} grew`), column);
    const shrunk = makeRun();
    /** @type {any} */ (shrunk.scenarios[1].variants.a.columns)[column] -= 1;
    const verdict = compareMeasurements(record, shrunk);
    assert.deepEqual(verdict.growth, [], column);
    assert.match(verdict.stale.join("\n"), new RegExp(`scenario 1 a: ${column}`), column);
  }
  assert.deepEqual(METHOD.ratcheted, ["rawSource", "rawModules", "preMinify", "minified", "requests"]);
});

test("ratchet: a module ENTERING the included graph is growth even at equal bytes; one leaving is reported", () => {
  const { record } = recorded();
  const entered = makeRun();
  entered.scenarios[1].variants.a.includedGraph = [...entered.scenarios[1].variants.a.includedGraph, "src/data/ordinal-rules.js"];
  assert.match(compareMeasurements(record, entered).growth.join("\n"), /1 module\(s\) entered the included graph: src\/data\/ordinal-rules.js/);
  const left = makeRun();
  left.scenarios[1].variants.a.includedGraph = ["src/index.js"];
  const verdict = compareMeasurements(record, left);
  assert.deepEqual(verdict.growth, []);
  assert.match(verdict.stale.join("\n"), /left the included graph: src\/core\/index.js/);
});

test("tolerance: max(256 bytes, 0.5%) of the recorded value", () => {
  assert.equal(tolerance(10000), 256);
  assert.equal(tolerance(51200), 256);
  assert.equal(tolerance(51201), 257, "0.5% rounds UP, so the band leaves 256 one byte above 51,200");
  assert.equal(tolerance(55000), 275);
  assert.equal(tolerance(53695), 269);
  assert.equal(tolerance(1000000), 5000);
});

test("tolerance: the rule is stated in the frozen METHOD, and holds in LITERAL numbers at every figure the record holds", () => {
  // LITERAL ON PURPOSE. `tolerance` reads METHOD and lives in check.mjs, which is in no digest, so an
  // expectation computed from either agrees with any edit to both. A review added `was >= 60000 ? 2000 : 0`
  // to the band: every earlier test stayed green, because each one sits below 60,000 or computes its
  // expectation with `tolerance`, and item C's shuffle then grew gzip-9 by 518 to 608 bytes on all 8
  // variants with none of it failing (2026-09-25).
  assert.deepEqual(METHOD.tolerance, {
    compressedBytes: 256, compressedFraction: 0.005,
    rule: "growth fails beyond max(compressedBytes, ceil(recorded value * compressedFraction)) bytes; " +
      "smaller movement, either way, is reported",
  });
  const record = JSON.parse(readFileSync(join(root, RECORD_NAME), "utf8"));
  /** @type {[string, string, string, number][]} */
  const figures = [];
  for (const [id, scenario] of Object.entries(record.scenarios))
    for (const [label, v] of Object.entries(/** @type {any} */ (scenario).variants))
      for (const column of ["gzip9", "brotliQ11", "brotliQ5"]) figures.push([id, label, column, v.columns[column]]);
  assert.ok(figures.length >= 24, `the record holds ${figures.length} compressed figures; 8 variants hold 24`);
  for (const [id, label, column, was] of figures) {
    const at = `scenario ${id} ${label} ${column} ${was}`;
    const band = Math.max(256, Math.ceil(was * 0.005));
    assert.equal(tolerance(was), band, at);
    // ...and the comparison applies exactly that band at that magnitude, on the record's own versions.
    const run = { suite: record.suite, compressors: record.compressors, scenarios: clone(record.scenarios) };
    run.scenarios[id].variants[label].columns[column] = was + band;
    assert.deepEqual(compareMeasurements(record, run).growth, [], `${at}: +${band} is within it`);
    run.scenarios[id].variants[label].columns[column] = was + band + 1;
    assert.equal(compareMeasurements(record, run).growth.length, 1, `${at}: +${band + 1} is beyond it`);
  }
});

test("tolerance: compressed growth BEYOND it fails, growth within it and any shrink are reported", () => {
  const { record } = recorded();
  for (const column of ["gzip9", "brotliQ11", "brotliQ5"]) {
    const was = /** @type {any} */ (record.scenarios[1].variants.a.columns)[column];
    const band = tolerance(was);
    const beyond = makeRun();
    /** @type {any} */ (beyond.scenarios[1].variants.a.columns)[column] = was + band + 1;
    assert.match(compareMeasurements(record, beyond).growth.join("\n"),
      new RegExp(`${column} grew ${was} -> ${was + band + 1} \\(\\+${band + 1}\\), beyond its tolerance of ${band}`));
    const within = makeRun();
    /** @type {any} */ (within.scenarios[1].variants.a.columns)[column] = was + band;
    assert.deepEqual(compareMeasurements(record, within).growth, [], `${column} at exactly its tolerance`);
    assert.match(compareMeasurements(record, within).stale.join("\n"),
      new RegExp(`${column} ${was} -> ${was + band} \\(\\+${band}, within ${band}\\)`));
    const shrunk = makeRun();
    /** @type {any} */ (shrunk.scenarios[1].variants.a.columns)[column] = was - 5000;
    assert.deepEqual(compareMeasurements(record, shrunk).growth, []);
    assert.match(compareMeasurements(record, shrunk).stale.join("\n"), new RegExp(`${column} ${was} -> ${was - 5000}`));
  }
});

test("tolerance: review item C's shuffle — +415 on a 53,695-byte q11 fails, +51 does not", () => {
  const run = makeRun();
  run.scenarios[1].variants.a.columns.brotliQ11 = 53695;
  const { record } = recorded(run);
  const shuffled = makeRun();
  shuffled.scenarios[1].variants.a.columns.brotliQ11 = 53695 + 415;
  assert.match(compareMeasurements(record, shuffled).growth.join("\n"), /brotliQ11 grew 53695 -> 54110 \(\+415\), beyond its tolerance of 269/);
  shuffled.scenarios[1].variants.a.columns.brotliQ11 = 53695 + 51;
  assert.deepEqual(compareMeasurements(record, shuffled).growth, []);
});

test("tolerance: a compressed column recorded on ANOTHER compressor version is not compared at all", () => {
  const { record } = recorded();
  const run = { ...makeRun(), compressors: { zlib: "1.2.12", brotli: "1.2.0" } };
  run.scenarios[1].variants.a.columns.gzip9 += 100000;
  const verdict = compareMeasurements(record, run);
  assert.deepEqual(verdict.growth, [], "a different zlib is a different instrument");
  assert.deepEqual(verdict.notCompared, ["gzip9 not compared (recorded with zlib 1.3.1, running zlib 1.2.12)"]);
  const brotli = { ...makeRun(), compressors: { zlib: "1.3.1", brotli: "1.1.0" } };
  brotli.scenarios[2].variants.b.columns.brotliQ5 += 100000;
  const both = compareMeasurements(record, brotli);
  assert.deepEqual(both.growth, []);
  assert.deepEqual(both.notCompared, ["brotliQ11, brotliQ5 not compared (recorded with brotli 1.2.0, running brotli 1.1.0)"]);
  // The control: the SAME growth on the same version fails.
  const same = makeRun();
  same.scenarios[1].variants.a.columns.gzip9 += 100000;
  assert.match(compareMeasurements(record, same).growth.join("\n"), /gzip9 grew/);
});

test("moved: a write across a scenario REVISION keeps what moved, old -> new, where it was not compared (a review's ablation)", () => {
  const { record } = recorded();
  const bumped = makeRun();
  bumped.scenarios[1].revision = 2;
  bumped.scenarios[1].variants.a.columns.minified += 14;
  bumped.scenarios[1].variants.a.includedGraph = [...bumped.scenarios[1].variants.a.includedGraph, "src/data/ordinal-rules.js"];
  const verdict = compareMeasurements(record, bumped);
  assert.deepEqual(verdict.growth, [], "a new revision is not compared with the old");
  assert.deepEqual(verdict.moved, [
    "scenario 1 a, revision 1 -> 2: minified 180000 -> 180014 (+14)",
    "scenario 1 a, revision 1 -> 2: 1 module(s) entered the included graph: src/data/ordinal-rules.js",
  ]);
  const changes = writeChanges(record, { ...verdict, growth: [...verdict.growth, "scenario 1 is at revision 2 and the record at 1"] });
  assert.ok(changes.includes("MOVED, NOT COMPARED: scenario 1 a, revision 1 -> 2: minified 180000 -> 180014 (+14)"), changes.join("\n"));
  assert.deepEqual(writeChanges(null, verdict), ["the first record of the frozen suite"]);
});

test("moved: a write on ANOTHER compressor version keeps the compressed growth it did not compare", () => {
  const { record } = recorded();
  const run = { ...makeRun(), compressors: { zlib: "1.3.2", brotli: "1.2.0" } };
  run.scenarios[1].variants.a.columns.gzip9 += 518;
  const verdict = compareMeasurements(record, run);
  assert.deepEqual(verdict.growth, []);
  assert.deepEqual(verdict.moved, ["scenario 1 a, zlib 1.3.1 -> 1.3.2: gzip9 66000 -> 66518 (+518)"]);
  assert.deepEqual(writeChanges(record, verdict), [
    "MOVED, NOT COMPARED: scenario 1 a, zlib 1.3.1 -> 1.3.2: gzip9 66000 -> 66518 (+518)",
    "gzip9 not compared (recorded with zlib 1.3.1, running zlib 1.3.2)",
  ]);
});

// ================================================================================== --write refusals

test("write: refused under CI, without a reason, and over problems; allowed with a reason otherwise", () => {
  const { record, origin, newest } = recorded();
  const state = { ci: false, reason: "why", problems: [], record, origin, newest, compressors: record.compressors, compressorsMoved: false };
  assert.equal(writeRefusal({ ...state, ci: true })?.status, 2);
  assert.equal(writeRefusal({ ...state, reason: null })?.status, 2);
  assert.equal(writeRefusal({ ...state, reason: "  " })?.status, 2);
  assert.equal(writeRefusal({ ...state, problems: ["containment"] })?.status, 1);
  assert.equal(writeRefusal(state), null);
  assert.equal(writeRefusal({ ...state, reason: "first", record: null, origin: undefined, newest: undefined }), null,
    "the first record is written before its history can be frozen");
  assert.equal(writeRefusal({ ...state, record: null, origin: undefined })?.status, 1,
    "a frozen newest entry alone also refuses a new history");
  // CI is any non-empty value, `CI=false` included: refusing a write is the safe error.
  assert.equal(underCi({ CI: "true" }), true);
  assert.equal(underCi({ CI: "false" }), true);
  assert.equal(underCi({ CI: "" }), false);
  assert.equal(underCi({}), false);
});

test("write: on another zlib or brotli than the record's, refused unless --compressors-moved says it is meant", () => {
  // The record's versions decide which CI legs compare the compressed columns, so the Node that writes
  // decides it too; without this, a routine re-record could move comparison off every leg (a review).
  const { record, origin, newest } = recorded();
  const state = { ci: false, reason: "why", problems: [], record, origin, newest, compressors: record.compressors, compressorsMoved: false };
  assert.equal(writeRefusal(state), null, "the control: the record's own versions");
  const zlib = writeRefusal({ ...state, compressors: { ...record.compressors, zlib: "1.2.12" } });
  assert.equal(zlib?.status, 2);
  assert.match(String(zlib?.message), /taken with zlib 1\.3\.1 and this Node runs zlib 1\.2\.12\..*--compressors-moved/);
  const both = writeRefusal({ ...state, compressors: { zlib: "1.2.12", brotli: "1.1.0" } });
  assert.match(String(both?.message), /taken with zlib 1\.3\.1 and brotli 1\.2\.0 and this Node runs zlib 1\.2\.12 and brotli 1\.1\.0/);
  assert.equal(writeRefusal({ ...state, compressors: { zlib: "1.2.12", brotli: "1.1.0" }, compressorsMoved: true }), null);
  assert.equal(writeRefusal({ ...state, record: null, origin: undefined, newest: undefined, compressors: { zlib: "1.2.12", brotli: "1.1.0" } }),
    null, "a first record has no versions to move");
  // It comes after the refusals that are not about versions: CI and a missing reason still say so first.
  assert.match(String(writeRefusal({ ...state, ci: true, compressors: { zlib: "1.2.12", brotli: "1.2.0" } })?.message), /under CI/);
});

test("write: GROWTH is recorded with its reason, and the result is clean against the grown run", () => {
  const { record, origin } = recorded();
  const grown = makeRun();
  grown.scenarios[2].variants.b.columns.minified += 64;
  const { growth } = compareMeasurements(record, grown);
  assert.equal(growth.length, 1);
  const next = nextRecord(record, grown, { ...WRITE, reason: "a real feature", changes: growth });
  assert.equal(next.history.length, 2);
  assert.equal(next.history[1].reason, "a real feature");
  assert.deepEqual(next.history[1].changes, growth);
  // Not clean until its newest entry is reviewed into source: the check names the paste.
  assert.match(recordFindings(next, grown, { origin, newest: newestOf(record) }).problems.join("\n"),
    /1 entry after entry 0, the newest .* freezes.*freeze HISTORY_NEWEST_ENTRY = Object\.freeze\(\{"index":1,/);
  assert.deepEqual(recordFindings(next, grown, { origin, newest: newestOf(next) }), { problems: [], growth: [] });
  assert.deepEqual(compareMeasurements(next, grown).growth, []);
});

// ======================================================================================= measurement

test("weigh: each column is its own compressor at the level its name says, per response, summed", () => {
  // THE NAME IS THE CONTRACT: gzip-9, brotli-q11, brotli-q5. Pinned here independently of METHOD, so
  // taking a column at another level fails whatever the digests say.
  assert.deepEqual(METHOD.compression, {
    gzip9: { library: "zlib", gzipLevel: 9 },
    brotliQ11: { library: "brotli", brotliQuality: 11, sizeHint: "the input's length" },
    brotliQ5: { library: "brotli", brotliQuality: 5, sizeHint: "the input's length" },
  });
  const parts = [readFileSync(join(root, "src/index.js")), Buffer.from("export const x = 1;\n".repeat(40))];
  const br = (/** @type {Buffer} */ part, /** @type {number} */ quality) => brotliCompressSync(part, { params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: quality, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: part.length } }).length;
  const sum = (/** @type {(part: Buffer) => number} */ f) => parts.reduce((total, part) => total + f(part), 0);
  const columns = weigh(parts);
  assert.deepEqual(columns, {
    minified: sum((part) => part.length), gzip9: sum((part) => gzipSync(part, { level: 9 }).length),
    brotliQ11: sum((part) => br(part, 11)), brotliQ5: sum((part) => br(part, 5)),
  });
  assert.ok(columns.brotliQ5 > columns.brotliQ11, "q5 and q11 differ on real input, which soundness relies on");
});

test("closure: a no-build form's requests are its entry files and every chunk they import, transitively", () => {
  const build = new Map([
    ["core.js", { imports: ["chunks/a.js", "chunks/b.js"] }],
    ["data/ordinal.js", { imports: ["chunks/b.js"] }],
    ["chunks/a.js", { imports: ["chunks/c.js"] }],
    ["chunks/b.js", { imports: [] }],
    ["chunks/c.js", { imports: ["chunks/a.js"] }],
    ["unrelated.js", { imports: [] }],
  ]);
  assert.deepEqual(closure(build, ["core.js", "data/ordinal.js"]),
    ["chunks/a.js", "chunks/b.js", "chunks/c.js", "core.js", "data/ordinal.js"]);
  assert.deepEqual(closure(build, ["chunks/b.js"]), ["chunks/b.js"]);
});

test("pack: the tarball's name is read from the array at the END of npm's output, whatever a banner before it holds", () => {
  const array = JSON.stringify([{ id: "lokalized@1.0.0", filename: "lokalized-1.0.0.tgz", files: [{ path: "a" }], bundled: [] }], null, 2);
  assert.equal(packedFilename(array), "lokalized-1.0.0.tgz", "output that is only the array");
  const banners = "\n> lokalized@1.0.0 prepack\n> npm run types\n\nwrote [ {\"not\": \"it\"} ] and [1, 2]\n";
  assert.equal(packedFilename(`${banners}${array}\n`), "lokalized-1.0.0.tgz");
  // The pattern this replaced took the FIRST `[ {` to the end, and the banner above breaks it.
  const firstBracket = /\[\s*\{[^]*\}\s*\]\s*$/.exec(`${banners}${array}\n`);
  assert.throws(() => JSON.parse(/** @type {RegExpExecArray} */ (firstBracket)[0]));
  assert.equal(packedFilename(`${banners}no array at all\n`), null);
  assert.equal(packedFilename(""), null);
});

test("identity: the rebuild is compared in BOTH directions and byte for byte (review item D)", () => {
  const a = new Uint8Array([1, 2, 3]);
  const shipped = new Map([["lokalized.js", a], ["core.js", a]]);
  assert.deepEqual(identityProblems(shipped, new Map(shipped)), []);
  assert.deepEqual(identityProblems(shipped, new Map([["lokalized.js", a]])),
    ["the tarball ships core.js, which the recipe's rebuild does not produce"]);
  assert.deepEqual(identityProblems(new Map([["lokalized.js", a]]), new Map(shipped)),
    ["the recipe's rebuild produces core.js, which the tarball does not ship"]);
  assert.match(identityProblems(shipped, new Map([["lokalized.js", a], ["core.js", new Uint8Array([1, 2, 4])]])).join(),
    /rebuilding core.js does not reproduce the shipped bytes/);
  assert.match(identityProblems(new Map(), new Map()).join(), /ships no dist\/browser file/);
});

test("soundness: unordered columns, or columns that count nothing, fail", () => {
  assert.deepEqual(soundnessProblems("x", columns()), []);
  assert.match(soundnessProblems("x", { ...columns(), preMinify: columns().minified }).join(), /not ordered/);
  assert.match(soundnessProblems("x", { ...columns(), brotliQ5: 1 }).join(), /not ordered/);
  // q5 EQUAL to q11 is what q5 taken at quality 11 looks like (a review's ablation), so it fails too.
  assert.match(soundnessProblems("x", { ...columns(), brotliQ5: columns().brotliQ11 }).join(), /not ordered/);
  assert.match(soundnessProblems("x", { ...columns(), gzip9: 1, brotliQ11: 1 }).join(), /not ordered/);
  assert.match(soundnessProblems("x", { ...columns(), requests: 0 }).join(), /count nothing/);
});

test("containment: a module the scenario must reach, or must not, is named", () => {
  const recipe = { mustReach: ["src/data/ordinal-rules.js"], mustNotReach: ["src/data/cardinal-ranges.js"] };
  assert.deepEqual(containmentProblems("4 x", recipe, ["src/data/ordinal-rules.js"]), []);
  assert.deepEqual(containmentProblems("4 x", recipe, ["src/data/cardinal-ranges.js"]), [
    "4 x: must reach src/data/ordinal-rules.js and does not",
    "4 x: reaches src/data/cardinal-ranges.js, which this scenario excludes",
  ]);
});

test("data rows: a module in no row fails in a graph and in the package; a row naming no module fails", () => {
  const { rows, unclassified } = classifyDataRows(
    new Map([["src/data/cardinal.js", 10], ["src/data/new-table.js", 5], ["src/index.js", 99]]), DATA_ROWS);
  assert.deepEqual(rows, { "rendering locale/cardinal": 10 });
  assert.deepEqual(unclassified, ["src/data/new-table.js"]);
  const shipped = Object.values(DATA_ROWS).flat().map((name) => `src/data/${name}.js`);
  assert.deepEqual(dataRowTableProblems(shipped, DATA_ROWS), []);
  assert.match(dataRowTableProblems([...shipped, "src/data/new-table.js"], DATA_ROWS).join(), /new-table.js ships and is in no DATA_ROWS row/);
  assert.match(dataRowTableProblems(shipped.filter((m) => !m.endsWith("/rtl.js")), DATA_ROWS).join(),
    /names rtl, and the tarball ships no src\/data\/rtl.js/);
  assert.match(dataRowTableProblems(shipped, { ...DATA_ROWS, twice: ["cardinal"] }).join(), /cardinal.js is in 2 DATA_ROWS rows/);
  assert.match(dataRowTableProblems([], DATA_ROWS).join(), /checked against nothing/);
});

test("render: one sample off the fixture's expected string fails, naming what it rendered", () => {
  assert.deepEqual(renderProblems("1 x", [{ rendered: "I read 3 books" }], "I read 3 books"), []);
  assert.deepEqual(renderProblems("1 x", [{ rendered: "I read 3 books" }, { rendered: "I read 3 book" }], "I read 3 books"),
    ['1 x: 1 of 2 sample(s) rendered "I read 3 book", expected "I read 3 books"']);
});

test("samples: a crash, a timeout and a silent exit are each a NAMED problem, never a stack", () => {
  const ok = JSON.stringify({ importMs: 1, constructMs: 1, firstRenderMs: 1, retainedBytes: 1, rendered: "r" });
  assert.deepEqual(sampleOutcome("x", 1, 30000, { status: 0, stdout: ok }), { sample: JSON.parse(ok) });
  assert.deepEqual(sampleOutcome("x", 2, 30000, { status: 1, stderr: "at foo\nTypeError: boom\n" }),
    { problem: "x: runtime sample 2 crashed (exit 1): TypeError: boom" });
  // Node's real shape: the file, the minified source line, a caret, the error, its stack, a version banner.
  const uncaught = `file:///w/bundle.mjs:1\n${"x".repeat(5000)}\n    ^\n\nError: ablation: construction crashed\n` +
    "    at Qo (file:///w/bundle.mjs:1:9)\n\nNode.js v24.18.0\n";
  assert.deepEqual(sampleOutcome("x", 1, 30000, { status: 1, stderr: uncaught }),
    { problem: "x: runtime sample 1 crashed (exit 1): Error: ablation: construction crashed" });
  const timedOut = Object.assign(new Error("spawnSync node ETIMEDOUT"), { code: "ETIMEDOUT" });
  assert.deepEqual(sampleOutcome("x", 3, 30000, { status: null, signal: "SIGTERM", error: timedOut }),
    { problem: "x: runtime sample 3 timed out after 30000 ms" });
  assert.deepEqual(sampleOutcome("x", 4, 30000, { status: null, signal: "SIGKILL" }),
    { problem: "x: runtime sample 4 crashed (signal SIGKILL): (no output)" });
  assert.deepEqual(sampleOutcome("x", 5, 30000, { status: 0, stdout: "" }), { problem: "x: runtime sample 5 exited 0 and printed no result" });
  assert.deepEqual(sampleOutcome("x", 6, 30000, { status: 0, stdout: "{}" }), { problem: "x: runtime sample 6 printed a result without its fields" });
  // Every figure, not only the import: one sample missing its heap still leaves a median from the rest.
  for (const figure of ["importMs", "constructMs", "firstRenderMs", "retainedBytes"]) {
    const partial = JSON.parse(ok);
    delete partial[figure];
    assert.deepEqual(sampleOutcome("x", 7, 30000, { status: 0, stdout: JSON.stringify(partial) }),
      { problem: "x: runtime sample 7 printed a result without its fields" }, figure);
  }
  assert.deepEqual(sampleOutcome("x", 8, 30000, { status: 0, stdout: ok.replace('"retainedBytes":1', '"retainedBytes":null') }),
    { problem: "x: runtime sample 8 printed a result without its fields" }, "NaN reaches JSON as null");
});

// ======================================================================================== the runtime

test("runtime: every variant carries one, each timing a finite positive time and the heap finite — in the run", () => {
  assert.deepEqual(runtimeProblems("this run", makeRun().scenarios), []);
  const gone = makeRun();
  gone.scenarios[2].variants.c.runtime = /** @type {any} */ (null);
  assert.deepEqual(runtimeProblems("this run", gone.scenarios),
    ["this run: scenario 2 c carries no runtime sample; its timings and heap are reported, never compared, and required present"]);
  // The review's ablation, every variant at once: `const runtime = null;` in the runner.
  const none = makeRun();
  for (const scenario of Object.values(none.scenarios))
    for (const v of Object.values(scenario.variants)) delete (/** @type {any} */ (v)).runtime;
  assert.equal(runtimeProblems("this run", none.scenarios).length, 3, "one per variant");
  /** @type {Array<[string, unknown, RegExp]>} */
  const arms = [
    ["importMs", NaN, /runtime importMs is NaN, not a finite positive time/],
    ["importMs", undefined, /runtime importMs is undefined/],
    ["constructMs", 0, /runtime constructMs is 0, not a finite positive time/],
    ["firstRenderMs", null, /runtime firstRenderMs is null/],
    ["retainedBytes", undefined, /runtime retainedBytes is undefined, not a finite number of bytes/],
    ["retainedBytes", Infinity, /runtime retainedBytes is Infinity/],
    ["samples", 0, /aggregated from 0 samples, not a count of them/],
  ];
  for (const [figure, value, message] of arms) {
    const run = makeRun();
    /** @type {any} */ (run.scenarios[1].variants.a.runtime)[figure] = value;
    const problems = runtimeProblems("this run", run.scenarios);
    assert.equal(problems.length, 1, `${figure} ${String(value)}`);
    assert.match(String(problems[0]), message);
  }
});

test("runtime: every timing is required positive and finite BY NAME, the heap finite, and samples a whole count", () => {
  // A review weakened each rule in turn and this file stayed green (2026-09-26): an import time of 0, a
  // first render of 0, a first render that is any number, and samples no longer required whole. So each
  // figure is shown each value that must fail, named here rather than read from `check.mjs`.
  for (const figure of ["importMs", "constructMs", "firstRenderMs"])
    for (const value of [0, -1, NaN, Infinity, "8.3", null, undefined]) {
      const run = makeRun();
      /** @type {any} */ (run.scenarios[1].variants.a.runtime)[figure] = value;
      assert.equal(runtimeProblems("this run", run.scenarios).length, 1, `${figure} ${String(value)}`);
    }
  for (const value of [NaN, Infinity, -Infinity, "2600000", null, undefined]) {
    const run = makeRun();
    /** @type {any} */ (run.scenarios[1].variants.a.runtime).retainedBytes = value;
    assert.equal(runtimeProblems("this run", run.scenarios).length, 1, `retainedBytes ${String(value)}`);
  }
  for (const samples of [0, -1, 1.5, "5", null, undefined]) {
    const run = makeRun();
    /** @type {any} */ (run.scenarios[1].variants.a.runtime).samples = samples;
    assert.equal(runtimeProblems("this run", run.scenarios).length, 1, `samples ${String(samples)}`);
  }
  // Only finiteness is gated for the heap: it is never compared, so a negative figure is present.
  const negativeHeap = makeRun();
  /** @type {any} */ (negativeHeap.scenarios[1].variants.a.runtime).retainedBytes = -4096;
  assert.deepEqual(runtimeProblems("this run", negativeHeap.scenarios), []);
});

test("runtime: the RECORD's is required present too, though its history does not vouch for it", () => {
  const { record, frozen } = recorded();
  const deleted = clone(record);
  for (const scenario of Object.values(deleted.scenarios))
    for (const v of Object.values(/** @type {any} */ (scenario).variants)) delete v.runtime.importMs;
  // The review's ablation: runtime.importMs deleted from every variant, which exited 0.
  const problems = recordFindings(deleted, makeRun(), frozen).problems;
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /measurements\/scenarios-1-5\.json: scenario 1 a's runtime importMs is undefined, .*; restore the record from git/);
  const dropped = clone(record);
  delete dropped.scenarios[2].variants.b.runtime;
  assert.match(recordFindings(dropped, makeRun(), frozen).problems.join("\n"), /scenario 2 b carries no runtime sample/);
  // The figures the history vouches for did not move, so that is the ONLY problem.
  assert.deepEqual(recordFindings(dropped, makeRun(), frozen).problems.filter((p) => !/runtime/.test(p)), []);
});

test("runtime: a slower run, or a larger heap, passes — the runtime is reported, never compared", () => {
  const { record, frozen } = recorded();
  const slower = makeRun();
  for (const scenario of Object.values(slower.scenarios))
    for (const v of Object.values(scenario.variants))
      Object.assign(/** @type {any} */ (v).runtime, { importMs: 9000, constructMs: 900, firstRenderMs: 900, retainedBytes: 9e9 });
  assert.deepEqual(runtimeProblems("this run", slower.scenarios), []);
  assert.deepEqual(recordFindings(record, slower, frozen), { problems: [], growth: [] });
  assert.deepEqual(compareMeasurements(record, slower), { growth: [], stale: [], moved: [], notCompared: [] });
  assert.equal(baselineSha256(slower), baselineSha256(makeRun()), "the history vouches for no runtime figure");
});
