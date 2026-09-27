// @ts-check
/**
 * `npm run scenario:6`'s ratchet must not be resettable by deleting or re-writing its record, and its
 * frozen inputs must not be silenced by editing the record's copy of them.
 *
 * MEASURED BEFORE THE RULES LANDED (2026-09-26), on the tool as it stood: grow `src/index.js` by 66
 * bytes, delete `measurements/scenario-6.json`, run `--write` with NO reason — exit 0, the grown
 * 988,800 / 1,069,130 recorded as the baseline, all 24 rebaseline reasons gone, and the next run green.
 * A record that was not JSON read as missing and a bare `--write` replaced it; the fixture digest
 * edited by hand to match changed catalogs passed at exit 0; and a changed recipe passed at exit 0 once
 * the record's `revision` was edited to 2. M-R clause 8 rests on this scenario among others, and
 * `verify` and CI only ever see the intact record, so nothing but this file runs the rules against a
 * tampered one — each rule could be reverted with both of them green.
 *
 * A REVIEW OF THOSE RULES THE SAME DAY found four more escapes, each measured at exit 0 on the tool as
 * first chained: both variant rows duplicated with raised copies ahead of the true ones, then
 * `src/index.js` grown by 187 bytes; `--reason --write`, which recorded the reason "--write"; every
 * timing deleted from the record; and `closureBytes` raised or deleted, which nothing compared. And
 * the re-pinned-closure term had no test at all. Each has an arm below.
 *
 * Every arm runs the REAL tool on its own copy of exactly what the tool reads — `src/`, `examples/`,
 * the four tool modules, the record and `package.json` (the examples import the package by its own
 * name) — so no mutation can touch this repository. The control runs first and must exit 0.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { exampleGraph } from "../tools/example-graph-walk.mjs";
import { chained } from "../tools/ratchet-chain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "lokalized-scenario-6-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const RECORD = "measurements/scenario-6.json";
const TOOL = "tools/scenario-6.mjs";

let copies = 0;
/** A fresh copy of what the tool reads. Each test mutates its own. */
function copy() {
  const dir = join(workspace, `copy-${copies++}`);
  for (const tree of ["src", "examples"]) cpSync(join(root, tree), join(dir, tree), { recursive: true });
  for (const file of [TOOL, "tools/example-graph-walk.mjs", "tools/graph-walk.mjs", "tools/ratchet-chain.mjs", RECORD, "package.json"]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(root, file), join(dir, file));
  }
  return dir;
}

/** @param {string} dir @param {string[]} args */
function run(dir, ...args) {
  const result = spawnSync(process.execPath, ["--expose-gc", TOOL, ...args], { cwd: dir, encoding: "utf8" });
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
  const line = /^const REBASELINES_FROZEN_THROUGH = .*;$/m;
  assert.ok(line.test(text), "the tool must freeze a checkpoint");
  writeFileSync(path, text.replace(line, `const REBASELINES_FROZEN_THROUGH = ${value};`));
  assert.ok(readFileSync(path, "utf8").includes(`const REBASELINES_FROZEN_THROUGH = ${value};`), "the checkpoint did not move");
}

/** Both example graphs reach the package root, so this grows both variants. */
const grow = (/** @type {string} */ dir) =>
  writeFileSync(join(dir, "src/index.js"), `${readFileSync(join(dir, "src/index.js"), "utf8")}// grown\n`);
const FREEZE = /to freeze them: const REBASELINES_FROZEN_THROUGH = (\{"index":\d+,"sha256":"[0-9a-f]{64}"\});/;
/** A byte-level change to one fixture catalog that keeps it valid JSON and the same catalog. */
function changeFixture(/** @type {string} */ dir) {
  const path = join(dir, "examples/catalogs/fr.json");
  const before = readFileSync(path, "utf8");
  writeFileSync(path, `${JSON.stringify(JSON.parse(before), null, 4)}\n`);
  assert.notEqual(readFileSync(path, "utf8"), before, "the fixture did not change");
}
/** The IANA data grows without re-pinning it: a comment in the root's generated module. */
const growIana = (/** @type {string} */ dir) => writeFileSync(join(dir, "src/data/iana-identity-equivalents.js"),
  `${readFileSync(join(dir, "src/data/iana-identity-equivalents.js"), "utf8")}// grown\n`);
/** The IANA data re-pinned: one more equivalence class in the full table, of two reserved subtags. */
const repin = (/** @type {string} */ dir) => edit(join(dir, "src/data/iana-range-equivalents.js"),
  '["zsm","ms-zsm"]];', '["zsm","ms-zsm"],["qaa","qab"]];');

test("the control: an unmodified copy passes, with its history frozen through its newest entry", () => {
  const result = run(copy());
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /history: \d+ rebaselines, frozen in this tool through entry \d+\n/);
  assert.doesNotMatch(result.out, /after it held by the chain/);
});

test("a deleted record fails, and neither --write, --write --reason nor --write --init starts a new one", () => {
  const dir = copy();
  rmSync(join(dir, RECORD));
  const check = run(dir);
  assert.equal(check.status, 1, check.out);
  assert.match(check.out, /NOT RECORDED: measurements\/scenario-6\.json does not exist/);
  for (const args of [["--write"], ["--write", "--reason", "a fresh start"]]) {
    const write = run(dir, ...args);
    assert.equal(write.status, 2, `${args.join(" ")}\n${write.out}`);
    assert.match(write.out, /--write will not start a new baseline over a missing one/);
  }
  const init = run(dir, "--write", "--init", "--reason", "a fresh start");
  assert.equal(init.status, 2, init.out);
  assert.match(init.out, /--init refused: this tool's history is frozen to start at [0-9a-f]{12}/);
  assert.equal(existsSync(join(dir, RECORD)), false, "a refused write created the record");
});

test("the measured reset: grown source, record deleted, a bare --write — refused, and the next run still fails", () => {
  const dir = copy();
  grow(dir);
  rmSync(join(dir, RECORD));
  const write = run(dir, "--write");
  assert.equal(write.status, 2, write.out);
  assert.equal(existsSync(join(dir, RECORD)), false, "the grown figures were recorded as a baseline");
  assert.equal(run(dir).status, 1);
});

test("a record that is not JSON, or not a record, fails and is not written over", () => {
  const dir = copy();
  for (const text of ["{ not json", "[]", "null", "42"]) {
    writeFileSync(join(dir, RECORD), text);
    const result = run(dir);
    assert.equal(result.status, 1, `${text}\n${result.out}`);
    assert.match(result.out, /is not valid JSON|not a record/);
    assert.doesNotMatch(result.out, /NOT RECORDED/, "an unreadable record is broken, not missing");
    assert.equal(run(dir, "--write").status, 2, `${text}: a bare --write`);
    assert.equal(run(dir, "--write", "--reason", "write over it").status, 2, text);
    assert.equal(readFileSync(join(dir, RECORD), "utf8"), text, "a refused --write still rewrote the record");
  }
});

test("a record written again from scratch does not start at the frozen origin", () => {
  const dir = copy();
  const record = readRecord(dir);
  const newest = record.rebaselines.at(-1);
  record.rebaselines = [chained([], { reason: "a fresh start", growth: [], recorded: newest.recorded, identity: newest.identity })];
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /history does not start at the entry frozen for it/);
  assert.equal(run(dir, "--write", "--reason", "carry it forward").status, 2);
});

test("an edited, deleted or dropped history entry breaks the chain, and --write will not carry it forward", () => {
  const dir = copy();
  const intact = readRecord(dir);
  assert.ok(intact.rebaselines.length > 12, "the arms below index into the recorded history");

  const edited = structuredClone(intact);
  edited.rebaselines[10].reason += " (reworded)";
  writeRecord(dir, edited);
  const before = readFileSync(join(dir, RECORD));
  const editedRun = run(dir);
  assert.equal(editedRun.status, 1, editedRun.out);
  assert.match(editedRun.out, /history entry 11 does not follow entry 10/);
  assert.equal(run(dir, "--write", "--reason", "carry it forward").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const deleted = structuredClone(intact);
  deleted.rebaselines.splice(5, 1);
  writeRecord(dir, deleted);
  assert.match(run(dir).out, /history entry 5 does not follow entry 4/);

  const first = structuredClone(intact);
  first.rebaselines.shift();
  writeRecord(dir, first);
  assert.match(run(dir).out, /does not start at the entry frozen for it/);

  const none = structuredClone(intact);
  none.rebaselines = [];
  writeRecord(dir, none);
  const noneRun = run(dir);
  assert.equal(noneRun.status, 1, noneRun.out);
  assert.match(noneRun.out, /carries no history/);
  assert.equal(run(dir, "--write", "--reason", "start the history again").status, 2);
});

test("the END of the history is frozen too: a cut, dropped or edited tail fails, and is not written over", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const through = Number(readFileSync(join(dir, TOOL), "utf8").match(/const REBASELINES_FROZEN_THROUGH = \{ index: (\d+),/)?.[1]);
  assert.equal(intact.rebaselines.length - 1, through, "the record's newest entry is the frozen checkpoint");

  const firstOnly = structuredClone(intact);
  firstOnly.rebaselines = firstOnly.rebaselines.slice(0, 1);
  writeRecord(dir, firstOnly);
  const cut = run(dir);
  assert.equal(cut.status, 1, cut.out);
  assert.match(cut.out, new RegExp(`history ends at entry 0, and its tool freezes it through entry ${through}`));
  const before = readFileSync(join(dir, RECORD));
  assert.equal(run(dir, "--write", "--reason", "routine").status, 2, "a --write must not carry a cut history forward");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const dropped = structuredClone(intact);
  dropped.rebaselines.pop();
  writeRecord(dir, dropped);
  assert.match(run(dir).out, new RegExp(`history ends at entry ${through - 1}`));

  const edited = structuredClone(intact);
  edited.rebaselines.at(-1).reason += " (reworded)";
  writeRecord(dir, edited);
  const editedRun = run(dir);
  assert.equal(editedRun.status, 1, editedRun.out);
  assert.match(editedRun.out, new RegExp(`history entry ${through} is not the entry its tool freezes`));
});

test("growth fails and is refused without a reason; with one it is recorded, chained, bound, and passes", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  grow(dir);
  const grown = run(dir);
  assert.equal(grown.status, 1, grown.out);
  assert.match(grown.out, /GROWTH \(deterministic, gated\):[\s\S]*edge worker: source graph grew/);
  const bare = run(dir, "--write");
  assert.equal(bare.status, 2, bare.out);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const recorded = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(recorded.status, 0, recorded.out);
  const written = readRecord(dir);
  const entry = written.rebaselines.at(-1);
  assert.equal(entry.reason, "a deliberate growth");
  assert.ok(entry.growth.some((/** @type {string} */ line) => /source graph grew/.test(line)));
  assert.deepEqual(entry.recorded, {
    ...Object.fromEntries(written.node.map((/** @type {any} */ row) => [row.label, {
      modules: row.modules, sourceBytes: row.sourceBytes, ianaClosureBytes: row.ianaClosureBytes,
      nodeBuiltinEdges: row.nodeBuiltinEdges,
    }])),
    "requests per render": written.requestsPerRender,
    "IANA data": { closureBytes: written.closureBytes },
  }, "the entry binds the figures it wrote");
  assert.deepEqual(entry.identity, {
    revision: written.revision, recipeSha256: written.recipeSha256, fixtureSha256: written.fixtureSha256,
    closureClasses: written.closureClasses,
  }, "the entry binds what the figures were measured against");
  const next = run(dir);
  assert.equal(next.status, 0, `the chained entry must satisfy the next run\n${next.out}`);
});

test("a shrink is written only with a reason, so the newest entry keeps binding what the record holds", () => {
  const dir = copy();
  const original = readFileSync(join(dir, "src/index.js"), "utf8");
  grow(dir);
  assert.equal(run(dir, "--write", "--reason", "a deliberate growth").status, 0);
  writeFileSync(join(dir, "src/index.js"), original);
  const shrunk = run(dir);
  assert.equal(shrunk.status, 0, `a shrink is not a failure\n${shrunk.out}`);
  const before = readFileSync(join(dir, RECORD));
  const bare = run(dir, "--write");
  assert.equal(bare.status, 2, bare.out);
  assert.match(bare.out, /the ratcheted figures differ from the ones the newest history entry recorded \(a shrink\)/);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
  const recorded = run(dir, "--write", "--reason", "the growth was reverted");
  assert.equal(recorded.status, 0, recorded.out);
  const written = readRecord(dir);
  assert.equal(written.rebaselines.at(-1).recorded["edge worker"].sourceBytes, written.node[0].sourceBytes);
  // And a write that moves nothing ratcheted needs no reason, and appends nothing.
  const length = written.rebaselines.length;
  assert.equal(run(dir, "--write").status, 0);
  assert.equal(readRecord(dir).rebaselines.length, length, "a write that moved nothing appended an entry");
});

test("entries after the checkpoint are reported; cutting one fails on the figures it bound, then as growth", () => {
  const dir = copy();
  const checkpoint = readRecord(dir).rebaselines.at(-1);
  grow(dir);
  assert.equal(run(dir, "--write", "--reason", "a deliberate growth").status, 0);
  const afterWrite = run(dir);
  assert.equal(afterWrite.status, 0, afterWrite.out);
  assert.match(afterWrite.out, /; 1 after it held by the chain and what they bind, not by source/);
  assert.ok(afterWrite.out.match(FREEZE), afterWrite.out);

  const record = readRecord(dir);
  record.rebaselines.pop();
  writeRecord(dir, record);
  const cut = run(dir);
  assert.equal(cut.status, 1, cut.out);
  assert.match(cut.out, /edge worker sourceBytes is \d+, above the \d+ its newest history entry recorded/);
  for (const row of record.node) Object.assign(row, checkpoint.recorded[row.label]);
  writeRecord(dir, record);
  const regrown = run(dir);
  assert.equal(regrown.status, 1, regrown.out);
  assert.doesNotMatch(regrown.out, /newest history entry recorded/);
  assert.match(regrown.out, /GROWTH[\s\S]*edge worker: source graph grew/);
  assert.equal(run(dir, "--write").status, 2, "the growth needs its reason again");
});

test("moving the checkpoint forward is a paste of the value the tool prints, and then pins the new entry", () => {
  const dir = copy();
  grow(dir);
  const written = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(written.status, 0, written.out);
  const freeze = written.out.match(FREEZE)?.[1];
  assert.ok(freeze, written.out);
  freezeThrough(dir, freeze);
  const frozen = run(dir);
  assert.equal(frozen.status, 0, frozen.out);
  assert.doesNotMatch(frozen.out, /after it held by the chain/);
  const record = readRecord(dir);
  record.rebaselines.pop();
  writeRecord(dir, record);
  assert.match(run(dir).out, /history ends at entry \d+, and its tool freezes it through entry/);
});

test("a variant's figures deleted, not counts, or raised by hand fail, and no --write records over them", () => {
  const dir = copy();
  const intact = readRecord(dir);
  grow(dir);
  /** @type {Array<[string, (row: any) => void, RegExp]>} */
  const arms = [
    ["deleted", (row) => { delete row.sourceBytes; delete row.modules; }, /edge worker sourceBytes is undefined, not a count/],
    ["a string", (row) => { row.sourceBytes = String(row.sourceBytes + 50); }, /edge worker sourceBytes is "\d+", not a count/],
    ["raised", (row) => { row.sourceBytes += 100000; }, /edge worker sourceBytes is \d+, above the \d+ its newest history entry recorded; it was raised by hand/],
    ["IANA bytes raised", (row) => { row.ianaClosureBytes += 1; }, /edge worker ianaClosureBytes is \d+, above the \d+/],
    ["built-in edges raised", (row) => { row.nodeBuiltinEdges += 1; }, /edge worker nodeBuiltinEdges is 1, above the 0/],
  ];
  for (const [name, change, message] of arms) {
    const record = structuredClone(intact);
    change(record.node.find((/** @type {any} */ row) => row.label === "edge worker"));
    writeRecord(dir, record);
    const before = readFileSync(join(dir, RECORD));
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, message, name);
    // The drift comparison says so too, rather than comparing with `undefined` or a string and seeing
    // no growth: it is what refuses a bare --write if the binding above were ever lost.
    if (name === "deleted" || name === "a string") assert.match(result.out, /edge worker: NOT RECORDED/, name);
    assert.equal(run(dir, "--write").status, 2, `${name}: a bare --write`);
    assert.equal(run(dir, "--write", "--reason", "record it").status, 2, `${name}: a --write with a reason`);
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${name}: a refused --write still rewrote the record`);
  }
});

test("requests per render are bound too: a header's count deleted or raised fails, and is not written over", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const deleted = structuredClone(intact);
  delete deleted.requestsPerRender.de;
  writeRecord(dir, deleted);
  const gone = run(dir);
  assert.equal(gone.status, 1, gone.out);
  assert.match(gone.out, /requests per render de is undefined, not a count/);
  assert.match(gone.out, /requests per render for "de": NOT RECORDED/);
  assert.equal(run(dir, "--write", "--reason", "re-create it").status, 2);

  const raised = structuredClone(intact);
  raised.requestsPerRender.de += 5;
  writeRecord(dir, raised);
  const up = run(dir);
  assert.equal(up.status, 1, up.out);
  assert.match(up.out, /requests per render de is \d+, above the \d+ its newest history entry recorded/);

  const none = structuredClone(intact);
  delete none.requestsPerRender;
  writeRecord(dir, none);
  assert.match(run(dir).out, /holds no requests per render row, which its newest history entry recorded/);
});

test("a deleted variant row is not a reset: it fails, and no --write re-creates it", () => {
  const dir = copy();
  const record = readRecord(dir);
  record.node = record.node.filter((/** @type {any} */ row) => row.label !== "server renderer");
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /server renderer: NOT RECORDED/);
  assert.match(result.out, /holds no server renderer row, which its newest history entry recorded/);
  assert.equal(run(dir, "--write").status, 2);
  assert.equal(run(dir, "--write", "--reason", "re-create it").status, 2);
});

test("the frozen fixture: a change fails and is recorded only with a reason; a digest edited to match it is refused", () => {
  const recorded = copy();
  changeFixture(recorded);
  const changed = run(recorded);
  assert.equal(changed.status, 1, changed.out);
  assert.match(changed.out, /FROZEN SCENARIO VIOLATED:[\s\S]*the fixture changed \([0-9a-f]{16} -> [0-9a-f]{16}\)/);
  assert.equal(run(recorded, "--write").status, 2, "a changed fixture must need a reason");
  const written = run(recorded, "--write", "--reason", "the fixture changed");
  assert.equal(written.status, 0, written.out);
  const digest = readRecord(recorded).fixtureSha256;
  assert.equal(readRecord(recorded).rebaselines.at(-1).identity.fixtureSha256, digest, "the entry binds the new digest");
  assert.equal(run(recorded).status, 0);

  // The measured bypass: the record's copy of the digest edited to the changed fixture's.
  const edited = copy();
  changeFixture(edited);
  const record = readRecord(edited);
  assert.notEqual(record.fixtureSha256, digest);
  record.fixtureSha256 = digest;
  writeRecord(edited, record);
  const silenced = run(edited);
  assert.equal(silenced.status, 1, silenced.out);
  assert.doesNotMatch(silenced.out, /the fixture changed/, "the edit silences the fixture term, which is the bypass");
  assert.match(silenced.out, /fixtureSha256 is "[0-9a-f]{64}", and its newest history entry recorded "[0-9a-f]{64}"; it was edited by hand/);
  assert.equal(run(edited, "--write", "--reason", "record it").status, 2);
});

test("the frozen recipe: a change under an unmoved revision is refused outright, and editing the record's revision does not skip it", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  edit(join(dir, TOOL), "  iterations: 9,\n", "  iterations: 7,\n");
  const changed = run(dir);
  assert.equal(changed.status, 1, changed.out);
  assert.match(changed.out, /the frozen recipe changed \([0-9a-f]{16} -> [0-9a-f]{16}\) while revision stayed 3/);
  assert.equal(run(dir, "--write", "--reason", "record the new recipe").status, 2, "a changed recipe is a revision, not a rebaseline");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  // The measured bypass: the recipe check compared only at an equal revision.
  const record = readRecord(dir);
  record.revision = 2;
  writeRecord(dir, record);
  const bypass = run(dir);
  assert.equal(bypass.status, 1, bypass.out);
  assert.match(bypass.out, /revision is 2, and its newest history entry recorded 3; it was edited by hand/);
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2);
});

test("a revision move, a renumber alone included, is recorded only with a reason; a revision the tool did not produce is refused", () => {
  const dir = copy();
  edit(join(dir, TOOL), "const REVISION = 3;", "const REVISION = 4;");
  const moved = run(dir);
  assert.equal(moved.status, 1, moved.out);
  assert.match(moved.out, /the scenario moved from revision 3 to 4/);
  assert.equal(run(dir, "--write").status, 2, "a revision move must need a reason");
  const recorded = run(dir, "--write", "--reason", "revision 4");
  assert.equal(recorded.status, 0, recorded.out);
  assert.equal(readRecord(dir).revision, 4);
  assert.equal(readRecord(dir).rebaselines.at(-1).identity.revision, 4);
  assert.equal(run(dir).status, 0);

  const ahead = copy();
  const record = readRecord(ahead);
  record.revision = 4;
  writeRecord(ahead, record);
  const result = run(ahead);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /is at revision 4, which this tool \(revision 3\) did not produce/);
  assert.equal(run(ahead, "--write", "--reason", "record it").status, 2);
});

test("a first record is a loud, explicit act: --init, a reason, and a failing run until its origin is frozen", () => {
  const dir = copy();
  const origin = readFileSync(join(dir, TOOL), "utf8").match(/const REBASELINES_ORIGIN = ("[0-9a-f]{64}");/)?.[1];
  assert.ok(origin, "the tool must freeze its history's origin");
  assert.equal(run(dir, "--write", "--init", "--reason", "x").status, 2, "--init over an existing record must be refused");

  edit(join(dir, TOOL), `const REBASELINES_ORIGIN = ${origin};`, "const REBASELINES_ORIGIN = undefined;");
  rmSync(join(dir, RECORD));
  const checkpointed = run(dir, "--write", "--init", "--reason", "the first record");
  assert.equal(checkpointed.status, 2, "--init must be refused while a checkpoint is frozen, origin or not");
  freezeThrough(dir, "undefined");
  const noReason = run(dir, "--write", "--init");
  assert.equal(noReason.status, 2, noReason.out);
  assert.match(noReason.out, /--init needs --reason/);

  const started = run(dir, "--write", "--init", "--reason", "the first record");
  assert.equal(started.status, 1, started.out);
  assert.match(started.out, /A NEW HISTORY WAS STARTED[\s\S]*const REBASELINES_ORIGIN = "[0-9a-f]{64}";/);
  const first = readRecord(dir).rebaselines;
  assert.equal(first.length, 1);
  assert.ok(first[0].recorded && first[0].identity, "the first entry binds the figures and identity too");
  const next = run(dir);
  assert.equal(next.status, 1, next.out);
  assert.match(next.out, /has no frozen first entry; freeze "[0-9a-f]{64}" in its tool/);
});

test("a label held by two rows is refused rather than read: the measured laundering, and a row named like a figure row", () => {
  const dir = copy();
  const intact = readRecord(dir);
  grow(dir);
  // The measured escape: raised copies AHEAD of the true rows. The binding read the last row of each
  // label and the growth terms the first, so the grown source passed at exit 0.
  const doubled = structuredClone(intact);
  doubled.node = [
    ...doubled.node.map((/** @type {any} */ row) => ({ ...row, sourceBytes: row.sourceBytes + 100000, modules: row.modules + 50 })),
    ...doubled.node,
  ];
  writeRecord(dir, doubled);
  const before = readFileSync(join(dir, RECORD));
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /holds 2 rows labelled "edge worker": the history binds the last and the growth terms read the first/);
  assert.match(result.out, /holds 2 rows labelled "server renderer"/);
  assert.equal(run(dir, "--write").status, 2);
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  // The same rows behind the true ones: refused too, not merely caught as growth.
  const behind = structuredClone(intact);
  behind.node = [...behind.node, ...behind.node.map((/** @type {any} */ row) => ({ ...row }))];
  writeRecord(dir, behind);
  assert.match(run(dir).out, /holds 2 rows labelled "edge worker"/);

  // A variant row under a figure row's name is overwritten by that row when the figures are read.
  for (const label of ["requests per render", "IANA data"]) {
    const named = structuredClone(intact);
    named.node.push({ ...named.node[0], label });
    writeRecord(dir, named);
    const out = run(dir);
    assert.equal(out.status, 1, `${label}\n${out.out}`);
    assert.match(out.out, new RegExp(`holds a variant row labelled "${label}", the name of a figure row`), label);
  }
});

test("--reason must be a sentence: a flag, a blank or nothing after it is refused, and nothing is written", () => {
  const dir = copy();
  grow(dir);
  const before = readFileSync(join(dir, RECORD));
  // `--reason --write` recorded the reason "--write" before this rule, at exit 0.
  for (const args of [["--reason", "--write"], ["--write", "--reason", " "], ["--write", "--reason", ""], ["--write", "--reason"]]) {
    const result = run(dir, ...args);
    assert.equal(result.status, 2, `${JSON.stringify(args)}\n${result.out}`);
    assert.match(result.out, /--reason needs a sentence after it saying why the baseline moved/, JSON.stringify(args));
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${JSON.stringify(args)}: a refused --write still rewrote the record`);
  }
  // A write that moves nothing needs no reason, and a bad one is refused there too rather than ignored.
  const still = copy();
  assert.equal(run(still, "--write", "--reason", "  ").status, 2);
  const recorded = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(recorded.status, 0, recorded.out);
  assert.equal(readRecord(dir).rebaselines.at(-1).reason, "a deliberate growth");
});

test("every history entry carries a reason: the newest, after the checkpoint, with its reason gone, blank or a flag fails", () => {
  const dir = copy();
  grow(dir);
  assert.equal(run(dir, "--write", "--reason", "a deliberate growth").status, 0);
  const intact = readRecord(dir);
  const index = intact.rebaselines.length - 1;
  for (const [name, change] of /** @type {Array<[string, (entry: any) => void]>} */ ([
    ["deleted", (entry) => { delete entry.reason; }],
    ["blank", (entry) => { entry.reason = "   "; }],
    ["a flag", (entry) => { entry.reason = "--write"; }],
    ["not a string", (entry) => { entry.reason = 42; }],
  ])) {
    const record = structuredClone(intact);
    change(record.rebaselines[index]);
    writeRecord(dir, record);
    const before = readFileSync(join(dir, RECORD));
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, new RegExp(`history entry ${index} records .* as its reason, which says nothing`), name);
    assert.equal(run(dir, "--write", "--reason", "carry it forward").status, 2, name);
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${name}: a refused --write still rewrote the record`);
  }
});

test("timings and heap are required present: each deleted, or not a finite number, fails and is not written over", () => {
  const dir = copy();
  const intact = readRecord(dir);
  assert.ok(typeof intact.retainedBytes === "number", "the control holds a measured heap figure");
  /** @type {Array<[string, (record: any) => void, string]>} */
  const arms = [
    ["negotiate deleted", (record) => { delete record.negotiateMsPerHeader; }, "negotiateMsPerHeader"],
    ["first render a string", (record) => { record.firstRenderMs = "fast"; }, "firstRenderMs"],
    ["first render negative", (record) => { record.firstRenderMs = -1; }, "firstRenderMs"],
    ["heap null", (record) => { record.retainedBytes = null; }, "retainedBytes"],
    ["heap deleted", (record) => { delete record.retainedBytes; }, "retainedBytes"],
    ["import deleted", (record) => { delete record.node.find((/** @type {any} */ row) => row.label === "edge worker").importMs; }, "edge worker importMs"],
    ["import not finite", (record) => { record.node.find((/** @type {any} */ row) => row.label === "server renderer").importMs = "Infinity"; }, "server renderer importMs"],
  ];
  for (const [name, change, field] of arms) {
    const record = structuredClone(intact);
    change(record);
    writeRecord(dir, record);
    const before = readFileSync(join(dir, RECORD));
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, new RegExp(`for ${field}, not a measured figure: timings and heap are reported, never compared, and required present`), name);
    assert.equal(run(dir, "--write", "--reason", "record it").status, 2, name);
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${name}: a refused --write still rewrote the record`);
  }
});

test("the IANA data's total is bound and ratchets: raised or deleted by hand fails, and grown it is growth", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const raised = structuredClone(intact);
  raised.closureBytes += 1000;
  writeRecord(dir, raised);
  const up = run(dir);
  assert.equal(up.status, 1, up.out);
  assert.match(up.out, /IANA data closureBytes is \d+, above the \d+ its newest history entry recorded; it was raised by hand/);
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2);

  const deleted = structuredClone(intact);
  delete deleted.closureBytes;
  writeRecord(dir, deleted);
  const gone = run(dir);
  assert.equal(gone.status, 1, gone.out);
  assert.match(gone.out, /IANA data closureBytes is undefined, not a count/);
  assert.match(gone.out, /the IANA data's total: NOT RECORDED/);

  const grown = copy();
  growIana(grown);
  const result = run(grown);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, new RegExp(`GROWTH[\\s\\S]*the IANA data grew ${intact.closureBytes} -> \\d+ bytes`));
  assert.equal(run(grown, "--write").status, 2, "the growth needs a reason");
  assert.equal(run(grown, "--write", "--reason", "the generated IANA module grew").status, 0);
  const written = readRecord(grown);
  assert.ok(written.closureBytes > intact.closureBytes);
  assert.equal(written.rebaselines.at(-1).recorded["IANA data"].closureBytes, written.closureBytes, "the entry binds the new total");
  assert.equal(run(grown).status, 0);
});

test("a re-pinned closure under an unmoved revision is refused outright; with the revision moved it is recorded with a reason", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const revision = Number(readFileSync(join(dir, TOOL), "utf8").match(/^const REVISION = (\d+);$/m)?.[1]);
  assert.equal(intact.revision, revision, "the record is at the tool's revision");
  repin(dir);
  const before = readFileSync(join(dir, RECORD));
  const repinned = run(dir);
  assert.equal(repinned.status, 1, repinned.out);
  assert.match(repinned.out, new RegExp(`SCENARIO 6 IS NOT WHAT ITS RECORD DESCRIBES[\\s\\S]*the IANA closure was re-pinned ` +
    `\\(${intact.closureClasses} -> ${intact.closureClasses + 1} classes\\) while revision stayed ${revision}`));
  assert.equal(run(dir, "--write", "--reason", "record the re-pin").status, 2, "a re-pin is a revision, not a rebaseline");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  edit(join(dir, TOOL), `const REVISION = ${revision};`, `const REVISION = ${revision + 1};`);
  const moved = run(dir);
  assert.equal(moved.status, 1, moved.out);
  assert.doesNotMatch(moved.out, /the IANA closure was re-pinned/, "across a revision the closure is not compared");
  assert.match(moved.out, new RegExp(`the scenario moved from revision ${revision} to ${revision + 1}`));
  assert.equal(run(dir, "--write").status, 2, "a revision move needs a reason");
  assert.equal(run(dir, "--write", "--reason", "the closure was re-pinned").status, 0);
  const written = readRecord(dir);
  assert.equal(written.closureClasses, intact.closureClasses + 1);
  assert.deepEqual(written.rebaselines.at(-1).identity, {
    revision: revision + 1, recipeSha256: written.recipeSha256, fixtureSha256: written.fixtureSha256,
    closureClasses: intact.closureClasses + 1,
  });
  assert.equal(run(dir).status, 0);
});

test("the graph figures a write records are the shared walker's, as the recipe's method says, not the harness's own arithmetic", () => {
  // The measuring code is not digest-frozen (0a's harness is not either), so an edit to it — measured:
  // `sourceBytes: graph.bytes - 1000`, exit 0 — shows only in a diff. What CAN be held is that the
  // figures a write stores are the ones tools/example-graph-walk.mjs measures for the same tree,
  // which RECIPE.method names as their source. Computed here independently of the tool's code.
  const dir = copy();
  grow(dir);
  const written = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(written.status, 0, written.out);
  const record = readRecord(dir);
  const iana = ["src/data/iana-range-equivalents.js", "src/data/iana-identity-equivalents.js"];
  const size = (/** @type {string} */ file) => Buffer.byteLength(readFileSync(join(dir, file), "utf8"));
  assert.equal(record.closureBytes, iana.reduce((sum, file) => sum + size(file), 0), "closureBytes");
  for (const variant of record.recipe.variants) {
    const graph = exampleGraph(dir, variant.entry);
    const row = record.node.find((/** @type {any} */ entry) => entry.label === variant.label);
    assert.deepEqual(
      { modules: row.modules, sourceBytes: row.sourceBytes, nodeBuiltinEdges: row.nodeBuiltinEdges, ianaClosureBytes: row.ianaClosureBytes },
      { modules: graph.files.length, sourceBytes: graph.bytes, nodeBuiltinEdges: graph.builtins.length,
        ianaClosureBytes: iana.filter((file) => graph.files.includes(file)).reduce((sum, file) => sum + size(file), 0) },
      variant.label);
  }
});
