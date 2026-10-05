// @ts-check
/**
 * `npm run scenario:2k`'s one gate — the catalog digest — must not disappear with its record.
 *
 * MEASURED BEFORE THE RULES LANDED (2026-09-26), on the tool as it stood: with
 * `measurements/scenario-2k.json` deleted a run printed "(run with --write to record …)" and exited 0,
 * so the digest check went with the file; and with the catalog changed, `--write --keys 8` recorded an
 * 8-key catalog, after which the default run compared nothing (the check ran only when `--keys`
 * equalled the record's) and exited 0 over the changed catalog. M-R clause 8 cites this scenario, and
 * `verify` and CI only ever see the intact record, so nothing but this file runs the rules against a
 * missing or re-written one. A review the same day then deleted `variants` and `graph` from the record,
 * exit 0: what is reported is now required present too (A33).
 *
 * Every arm runs the REAL tool on its own copy — `src/`, the tool, the graph walker, the record and
 * `package.json` — so no mutation can touch this repository. Runs that measure use the smallest
 * iteration count the tool accepts: the checks under test are decided before anything is measured, and
 * a timing is never compared. The control runs first and must exit 0.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "lokalized-scenario-2k-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const RECORD = "measurements/scenario-2k.json";
const TOOL = "tools/scenario-2k.mjs";

let copies = 0;
/** A fresh copy of what the tool reads. Each test mutates its own. */
function copy() {
  const dir = join(workspace, `copy-${copies++}`);
  cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
  for (const file of [TOOL, "tools/graph-walk.mjs", RECORD, "package.json"]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(root, file), join(dir, file));
  }
  return dir;
}

/** @param {string} dir @param {string[]} args */
function run(dir, ...args) {
  const result = spawnSync(process.execPath, ["--expose-gc", TOOL, "--iterations", "3", ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** Replace exactly one occurrence, and prove the mutation landed rather than trusting the anchor. */
function edit(/** @type {string} */ path, /** @type {string} */ from, /** @type {string} */ to) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.split(from).length - 1, 1, `the anchor ${JSON.stringify(from)} must occur exactly once in ${path}`);
  writeFileSync(path, text.replace(from, to));
  assert.ok(readFileSync(path, "utf8").includes(to), `the mutation did not land in ${path}`);
}

/** The frozen digest line in the copy's tool, replaced whole, as a maintainer re-freezing it would. */
function freeze(/** @type {string} */ dir, /** @type {string} */ value) {
  const path = join(dir, TOOL);
  const text = readFileSync(path, "utf8");
  const line = /^const FROZEN_CATALOG_DIGEST = .*;$/m;
  assert.ok(line.test(text), "the tool must freeze its catalog digest");
  writeFileSync(path, text.replace(line, `const FROZEN_CATALOG_DIGEST = ${value};`));
  assert.ok(readFileSync(path, "utf8").includes(`const FROZEN_CATALOG_DIGEST = ${value};`), "the digest did not move");
}

const readRecord = (/** @type {string} */ dir) => JSON.parse(readFileSync(join(dir, RECORD), "utf8"));
const writeRecord = (/** @type {string} */ dir, /** @type {any} */ record) =>
  writeFileSync(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`);
/** One shape of the catalog changes, so the scenario's catalog is no longer the frozen one. */
const changeCatalog = (/** @type {string} */ dir) =>
  edit(join(dir, TOOL), "return `Value ${pad(i)}`;", "return `Value, changed, ${pad(i)}`;");

test("the control: an unmodified copy passes, and says the recorded medians describe this catalog", () => {
  const result = run(copy());
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /catalog {8}digest [0-9a-f]{8} unchanged/);
});

test("a deleted record fails before measuring, and neither --write nor --write --init starts a new one", () => {
  const dir = copy();
  rmSync(join(dir, RECORD));
  const check = run(dir);
  assert.equal(check.status, 1, check.out);
  assert.match(check.out, /NOT RECORDED: measurements\/scenario-2k\.json does not exist/);
  assert.match(check.out, /nothing was measured/);
  // A scaling run consults the record too: `--keys` does not turn the gate off.
  const scaling = run(dir, "--keys", "40");
  assert.equal(scaling.status, 1, scaling.out);
  assert.match(scaling.out, /NOT RECORDED/);
  const write = run(dir, "--write");
  assert.equal(write.status, 2, write.out);
  assert.match(write.out, /does not exist, and --write will not start a new one/);
  const init = run(dir, "--write", "--init");
  assert.equal(init.status, 2, init.out);
  assert.match(init.out, /--init refused: this tool freezes the catalog digest [0-9a-f]{8}/);
  assert.equal(existsSync(join(dir, RECORD)), false, "a refused write created the record");
});

test("a record that is not JSON, or not a record, fails and is not written over", () => {
  const dir = copy();
  for (const text of ["{ not json", "[]", "null", "42"]) {
    writeFileSync(join(dir, RECORD), text);
    const result = run(dir);
    assert.equal(result.status, 1, `${text}\n${result.out}`);
    assert.match(result.out, /is not valid JSON|not a record/);
    assert.doesNotMatch(result.out, /NOT RECORDED/, "an unreadable record is broken, not missing");
    assert.equal(run(dir, "--write").status, 2, text);
    assert.equal(readFileSync(join(dir, RECORD), "utf8"), text, "a refused --write still rewrote the record");
  }
});

test("a record describing another catalog fails until --write re-records it", () => {
  const dir = copy();
  const intact = readRecord(dir);
  for (const [name, change] of /** @type {Array<[string, (record: any) => void]>} */ ([
    ["digest", (record) => { record.catalog.digest = "00000000"; }],
    ["keys", (record) => { record.catalog.keys = 8; }],
    ["no catalog", (record) => { delete record.catalog; }],
  ])) {
    const record = structuredClone(intact);
    change(record);
    writeRecord(dir, record);
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, /the recorded measurement describes a different catalog/, name);
  }
  const rewritten = run(dir, "--write");
  assert.equal(rewritten.status, 0, rewritten.out);
  assert.equal(readRecord(dir).catalog.digest, intact.catalog.digest);
  assert.equal(run(dir).status, 0);
});

test("--write records only the scenario's own catalog: a scaling run passes, and a scaling write is refused", () => {
  const dir = copy();
  const scaling = run(dir, "--keys", "40");
  assert.equal(scaling.status, 0, scaling.out);
  assert.match(scaling.out, /this run measured --keys 40, so none of its timings compare with it, and --write is refused/);
  const before = readFileSync(join(dir, RECORD));
  const write = run(dir, "--write", "--keys", "40");
  assert.equal(write.status, 2, write.out);
  assert.match(write.out, /--write records the scenario's 2000-key catalog, and --keys 40 measures another one/);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("the measured hole: a changed catalog fails whatever --keys says, and is recorded only after re-freezing its digest", () => {
  const dir = copy();
  changeCatalog(dir);
  const before = readFileSync(join(dir, RECORD));
  const changed = run(dir);
  assert.equal(changed.status, 1, changed.out);
  assert.match(changed.out, /this tool builds a different 2000-key catalog \(digest [0-9a-f]{8}\) from the one frozen in it/);
  // The old escape: record an 8-key catalog so the default run compares nothing.
  assert.equal(run(dir, "--write", "--keys", "8").status, 2);
  assert.equal(run(dir, "--keys", "8").status, 1, "a scaling run still checks the scenario's catalog");
  // Re-recording over it is refused too, until the new digest is frozen in source.
  const write = run(dir, "--write");
  assert.equal(write.status, 2, write.out);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const digest = changed.out.match(/freeze "([0-9a-f]{8})" as FROZEN_CATALOG_DIGEST/)?.[1];
  assert.ok(digest, changed.out);
  freeze(dir, `"${digest}"`);
  const refrozen = run(dir);
  assert.equal(refrozen.status, 1, refrozen.out);
  assert.match(refrozen.out, /the recorded measurement describes a different catalog/);
  assert.equal(run(dir, "--write").status, 0);
  assert.equal(readRecord(dir).catalog.digest, digest);
  assert.equal(run(dir).status, 0);
});

test("a first record is a loud, explicit act: --init, and a failing run until its digest is frozen", () => {
  const dir = copy();
  assert.equal(run(dir, "--write", "--init").status, 2, "--init over an existing record must be refused");
  freeze(dir, "undefined");
  const unfrozen = run(dir);
  assert.equal(unfrozen.status, 1, unfrozen.out);
  assert.match(unfrozen.out, /this tool freezes no catalog digest/);

  rmSync(join(dir, RECORD));
  assert.equal(run(dir, "--write").status, 2, "a first record needs --init");
  const started = run(dir, "--write", "--init");
  assert.equal(started.status, 1, started.out);
  const digest = started.out.match(/A FIRST RECORD WAS WRITTEN[\s\S]*const FROZEN_CATALOG_DIGEST = "([0-9a-f]{8})";/)?.[1];
  assert.ok(digest, started.out);
  assert.equal(run(dir).status, 1, "every run fails until the digest is frozen");
  freeze(dir, `"${digest}"`);
  assert.equal(run(dir).status, 0);
});

test("timings, heap figures and source graphs are required present: a record missing one fails, and --write re-records it", () => {
  const dir = copy();
  const intact = readRecord(dir);
  /** @type {Array<[string, (record: any) => void, RegExp]>} */
  const arms = [
    // The measured escape: both deleted, and the run exited 0 printing "NOT RECORDED" for the graph.
    ["variants and graph deleted", (record) => { delete record.variants; delete record.graph; },
      /holds 0 rows for "root \+ raw-text catalog", not one[\s\S]*holds no source graph for src\/index\.js/],
    ["one row twice", (record) => { record.variants.push(structuredClone(record.variants[1])); },
      /holds 2 rows for "core \+ parsed equivalent", not one/],
    ["a timing deleted", (record) => { delete record.variants[0].constructionMs; }, /holds no measured constructionMs for "root \+ raw-text catalog"/],
    ["a median not a number", (record) => { record.variants[1].steadyLookupNsDirect.median = "fast"; },
      /holds no measured steadyLookupNsDirect for "core \+ parsed equivalent"/],
    ["a heap figure null", (record) => { record.variants[0].retainedAfterSweepBytes = null; },
      /holds no measured retainedAfterSweepBytes for "root \+ raw-text catalog"/],
    ["one graph's bytes deleted", (record) => { delete record.graph["src/core/index.js"].bytes; }, /holds no source graph for src\/core\/index\.js/],
  ];
  for (const [name, change, message] of arms) {
    const record = structuredClone(intact);
    change(record);
    writeRecord(dir, record);
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, /FAILED before measuring \(nothing was measured\)/, name);
    assert.match(result.out, message, name);
  }
  const rewritten = run(dir, "--write");
  assert.equal(rewritten.status, 0, rewritten.out);
  assert.equal(readRecord(dir).variants.length, 2);
  assert.equal(run(dir).status, 0, "the re-recorded record carries everything it reports");
});

test("--write without --expose-gc is refused before measuring: it would record both heap figures as null", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  const result = spawnSync(process.execPath, [TOOL, "--iterations", "3", "--write"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /--write needs --expose-gc/);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});
