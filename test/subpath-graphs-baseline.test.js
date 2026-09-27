// @ts-check
/**
 * `npm run subpath:graphs`'s ratchet must not be resettable by deleting its record.
 *
 * MEASURED BEFORE THE RULE LANDED (2026-09-25): with `measurements/subpath-graphs.json` deleted the
 * tool printed "no baseline yet" and exited 0, and the `--write --reason` it suggested recorded
 * today's graphs as the baseline, so any growth since the last record passed as a first measurement.
 * M-R clause 8 rests on this ratchet among others. `verify` and CI only ever see the intact record, so
 * nothing but this file runs the rules against a tampered one. An adversarial review of the first
 * version of those rules measured three more resets at exit 0 — a history cut from its END, a row's
 * figures deleted, and a row's figures raised by hand, the last two each letting growth through — and
 * each has an arm below.
 *
 * Every arm runs the REAL tool on its own copy — the package's `src/`, the three tool modules, the
 * record, and the spec's allowlist beside it where the tool looks for it — so no mutation can touch
 * this repository. The control runs first and must exit 0.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chained } from "../tools/ratchet-chain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "lokalized-subpath-graphs-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const RECORD = "measurements/subpath-graphs.json";
const TOOL = "tools/subpath-graphs.mjs";
// The tool reads the allowlist from the SIBLING spec checkout, so the copy carries it at that place.
const ALLOWLIST = "lokalized-spec/symbol-allowlist.json";

let copies = 0;
/** A fresh copy of what the tool reads. Each test mutates its own. */
function copy() {
  const dir = join(workspace, `copy-${copies++}`, "lokalized-js");
  cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
  for (const file of [TOOL, "tools/graph-walk.mjs", "tools/ratchet-chain.mjs", RECORD, "package.json"]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(root, file), join(dir, file));
  }
  mkdirSync(dirname(join(dir, "..", ALLOWLIST)), { recursive: true });
  cpSync(join(root, "..", ALLOWLIST), join(dir, "..", ALLOWLIST));
  return dir;
}

/** @param {string} dir @param {string[]} args */
function run(dir, ...args) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** Replace exactly one occurrence, and prove the mutation landed rather than trusting the anchor. */
function edit(/** @type {string} */ path, /** @type {string} */ from, /** @type {string} */ to) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.split(from).length - 1, 1, `the anchor ${JSON.stringify(from)} must occur exactly once in ${path}`);
  writeFileSync(path, text.replace(from, to));
  assert.ok(readFileSync(path, "utf8").includes(to), `the mutation did not land in ${path}`);
}

const readRecord = (/** @type {string} */ dir) => JSON.parse(readFileSync(join(dir, RECORD), "utf8"));
const writeRecord = (/** @type {string} */ dir, /** @type {any} */ record) =>
  writeFileSync(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`);

/** The checkpoint line in the copy's tool, replaced whole, as a maintainer moving it forward would. */
function freezeThrough(/** @type {string} */ dir, /** @type {string} */ value) {
  const path = join(dir, TOOL);
  const text = readFileSync(path, "utf8");
  const line = /^const HISTORY_FROZEN_THROUGH = .*;$/m;
  assert.ok(line.test(text), "the tool must freeze a checkpoint");
  writeFileSync(path, text.replace(line, `const HISTORY_FROZEN_THROUGH = ${value};`));
  assert.ok(readFileSync(path, "utf8").includes(`const HISTORY_FROZEN_THROUGH = ${value};`), "the checkpoint did not move");
}

const growSsr = (/** @type {string} */ dir) =>
  writeFileSync(join(dir, "src/ssr/index.js"), `${readFileSync(join(dir, "src/ssr/index.js"), "utf8")}// grown\n`);
const FREEZE = /to freeze them: const HISTORY_FROZEN_THROUGH = (\{"index":\d+,"sha256":"[0-9a-f]{64}"\});/;

test("the control: an unmodified copy passes", () => {
  const result = run(copy());
  assert.equal(result.status, 0, result.out);
});

test("a deleted record fails, and neither --write nor --write --init starts a new one", () => {
  const dir = copy();
  rmSync(join(dir, RECORD));
  const check = run(dir);
  assert.equal(check.status, 1, check.out);
  assert.match(check.out, /NOT RECORDED: measurements\/subpath-graphs\.json does not exist/);
  const write = run(dir, "--write", "--reason", "a fresh start");
  assert.equal(write.status, 2, write.out);
  assert.match(write.out, /--write will not start a new baseline over a missing one/);
  const init = run(dir, "--write", "--init", "--reason", "a fresh start");
  assert.equal(init.status, 2, init.out);
  assert.match(init.out, /--init refused: this tool's history is frozen to start at [0-9a-f]{12}/);
  assert.equal(existsSync(join(dir, RECORD)), false, "a refused write created the record");
});

test("a record that is not JSON, or not a record, fails and is not written over", () => {
  const dir = copy();
  for (const text of ["{ not json", "[]", "null", "42"]) {
    writeFileSync(join(dir, RECORD), text);
    const result = run(dir);
    assert.equal(result.status, 1, `${text}\n${result.out}`);
    assert.match(result.out, /is not valid JSON|not a record/);
    assert.equal(run(dir, "--write", "--reason", "write over it").status, 2, text);
    assert.equal(readFileSync(join(dir, RECORD), "utf8"), text, "a refused --write still rewrote the record");
  }
});

test("a record written again from scratch does not start at the frozen origin", () => {
  const dir = copy();
  const record = readRecord(dir);
  record.history = [chained([], { reason: "a fresh start" })];
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /history does not start at the entry frozen for it/);
  assert.equal(run(dir, "--write", "--reason", "carry it forward").status, 2);
});

test("an edited, deleted or dropped history entry breaks the chain, and --write will not carry it forward", () => {
  const dir = copy();
  const intact = readRecord(dir);
  assert.ok(intact.history.length > 12, "the arms below index into the recorded history");

  const edited = structuredClone(intact);
  edited.history[10].reason += " (reworded)";
  writeRecord(dir, edited);
  const before = readFileSync(join(dir, RECORD));
  const editedRun = run(dir);
  assert.equal(editedRun.status, 1, editedRun.out);
  assert.match(editedRun.out, /history entry 11 does not follow entry 10/);
  assert.equal(run(dir, "--write", "--reason", "carry it forward").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const deleted = structuredClone(intact);
  deleted.history.splice(5, 1);
  writeRecord(dir, deleted);
  assert.match(run(dir).out, /history entry 5 does not follow entry 4/);

  const first = structuredClone(intact);
  first.history.shift();
  writeRecord(dir, first);
  assert.match(run(dir).out, /does not start at the entry frozen for it/);

  const none = structuredClone(intact);
  delete none.history;
  writeRecord(dir, none);
  const noneRun = run(dir);
  assert.equal(noneRun.status, 1, noneRun.out);
  assert.match(noneRun.out, /carries no history/);
});

test("the END of the history is frozen too: a cut, dropped or edited tail fails, and is not written over", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const through = Number(readFileSync(join(dir, TOOL), "utf8").match(/const HISTORY_FROZEN_THROUGH = \{ index: (\d+),/)?.[1]);
  assert.equal(intact.history.length - 1, through, "the record's newest entry is the frozen checkpoint");

  const firstOnly = structuredClone(intact);
  firstOnly.history = firstOnly.history.slice(0, 1);
  writeRecord(dir, firstOnly);
  const cut = run(dir);
  assert.equal(cut.status, 1, cut.out);
  assert.match(cut.out, new RegExp(`history ends at entry 0, and its tool freezes it through entry ${through}`));
  const before = readFileSync(join(dir, RECORD));
  assert.equal(run(dir, "--write", "--reason", "routine").status, 2, "a --write must not carry a cut history forward");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const dropped = structuredClone(intact);
  dropped.history.pop();
  writeRecord(dir, dropped);
  assert.match(run(dir).out, new RegExp(`history ends at entry ${through - 1}`));

  const edited = structuredClone(intact);
  edited.history.at(-1).reason += " (reworded)";
  writeRecord(dir, edited);
  const editedRun = run(dir);
  assert.equal(editedRun.status, 1, editedRun.out);
  assert.match(editedRun.out, new RegExp(`history entry ${through} is not the entry its tool freezes`));
});

test("entries after the checkpoint are reported; cutting one fails on the figures it bound, then as growth", () => {
  const dir = copy();
  const checkpoint = readRecord(dir).history.at(-1);
  growSsr(dir);
  assert.equal(run(dir, "--write", "--reason", "a deliberate growth").status, 0);
  const after = run(dir);
  assert.equal(after.status, 0, after.out);
  assert.match(after.out, /; 1 after it held by the chain and the figures they bind, not by source/);
  const freeze = after.out.match(FREEZE)?.[1];
  assert.ok(freeze, after.out);

  const record = readRecord(dir);
  record.history.pop();
  writeRecord(dir, record);
  const cut = run(dir);
  assert.equal(cut.status, 1, cut.out);
  assert.match(cut.out, /lokalized\/ssr bytes is \d+, above the \d+ its newest history entry recorded/);
  record.subpaths = structuredClone(checkpoint.recorded);
  writeRecord(dir, record);
  const regrown = run(dir);
  assert.equal(regrown.status, 1, regrown.out);
  assert.doesNotMatch(regrown.out, /newest history entry recorded/);
  assert.match(regrown.out, /GRAPH GROWTH[\s\S]*lokalized\/ssr: source graph grew/);

  // And pasting the printed value moves the checkpoint, after which the same cut names the frozen end.
  const moved = copy();
  growSsr(moved);
  const written = run(moved, "--write", "--reason", "a deliberate growth");
  freezeThrough(moved, /** @type {string} */ (written.out.match(FREEZE)?.[1]));
  const frozen = run(moved);
  assert.equal(frozen.status, 0, frozen.out);
  assert.doesNotMatch(frozen.out, /after it held by the chain/);
  const movedRecord = readRecord(moved);
  movedRecord.history.pop();
  writeRecord(moved, movedRecord);
  assert.match(run(moved).out, /history ends at entry \d+, and its tool freezes it through entry/);
});

test("a row's figures deleted, not counts, or raised by hand fail, and no --write records over them", () => {
  const dir = copy();
  const intact = readRecord(dir);
  growSsr(dir);
  /** @type {Array<[string, (row: any) => void, RegExp]>} */
  const arms = [
    ["deleted", (row) => { delete row.bytes; delete row.modules; }, /lokalized\/ssr bytes is undefined, not a count/],
    ["a string", (row) => { row.bytes = String(row.bytes + 50); }, /lokalized\/ssr bytes is "\d+", not a count/],
    ["raised", (row) => { row.bytes += 100000; }, /lokalized\/ssr bytes is \d+, above the \d+ its newest history entry recorded; it was raised by hand/],
  ];
  for (const [name, change, message] of arms) {
    const record = structuredClone(intact);
    change(record.subpaths["lokalized/ssr"]);
    writeRecord(dir, record);
    const before = readFileSync(join(dir, RECORD));
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, message, name);
    // The drift comparison says so too, rather than comparing with `undefined` or a string and seeing
    // no growth: it is what refuses a bare --write if the binding above were ever lost.
    if (name !== "raised") assert.match(result.out, /lokalized\/ssr: NOT RECORDED/, name);
    assert.equal(run(dir, "--write", "--reason", "record it").status, 2, `${name}: a --write with a reason`);
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${name}: a refused --write still rewrote the record`);
  }
});

test("a deleted subpath row fails as unrecorded, and no --write re-creates it", () => {
  const dir = copy();
  const record = readRecord(dir);
  delete record.subpaths["lokalized/ssr"];
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /lokalized\/ssr: NOT RECORDED/);
  assert.match(result.out, /holds no lokalized\/ssr row, which its newest history entry recorded/);
  assert.equal(run(dir, "--write", "--reason", "re-create it").status, 2);
});

test("growth fails and --write refuses it without a reason; with one it is recorded, chained, and passes", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  writeFileSync(join(dir, "src/ssr/index.js"), `${readFileSync(join(dir, "src/ssr/index.js"), "utf8")}// grown\n`);
  const grown = run(dir);
  assert.equal(grown.status, 1, grown.out);
  assert.match(grown.out, /GRAPH GROWTH[\s\S]*lokalized\/ssr: source graph grew/);
  const bare = run(dir, "--write");
  assert.equal(bare.status, 2, bare.out);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const recorded = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(recorded.status, 0, recorded.out);
  const written = readRecord(dir);
  assert.equal(written.history.at(-1).reason, "a deliberate growth");
  assert.deepEqual(written.history.at(-1).recorded, written.subpaths, "the entry binds the figures it wrote");
  const after = run(dir);
  assert.equal(after.status, 0, `the chained entry must satisfy the next run\n${after.out}`);
});

test("a first record is a loud, explicit act: --init, and a failing run until its origin is frozen", () => {
  const dir = copy();
  const origin = readFileSync(join(dir, TOOL), "utf8").match(/const HISTORY_ORIGIN = ("[0-9a-f]{64}");/)?.[1];
  assert.ok(origin, "the tool must freeze its history's origin");
  assert.equal(run(dir, "--write", "--init", "--reason", "x").status, 2, "--init over an existing record must be refused");

  edit(join(dir, TOOL), `const HISTORY_ORIGIN = ${origin};`, "const HISTORY_ORIGIN = undefined;");
  rmSync(join(dir, RECORD));
  assert.equal(run(dir, "--write", "--init", "--reason", "x").status, 2, "--init must be refused while a checkpoint is frozen, origin or not");
  freezeThrough(dir, "undefined");
  const started = run(dir, "--write", "--init", "--reason", "the first record");
  assert.equal(started.status, 1, started.out);
  assert.match(started.out, /A NEW HISTORY WAS STARTED[\s\S]*const HISTORY_ORIGIN = "[0-9a-f]{64}";/);
  assert.equal(readRecord(dir).history.length, 1);
  assert.ok(readRecord(dir).history[0].recorded, "the first entry binds the figures too");
  const next = run(dir);
  assert.equal(next.status, 1, next.out);
  assert.match(next.out, /has no frozen first entry; freeze "[0-9a-f]{64}" in its tool/);
});
