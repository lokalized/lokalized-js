// @ts-check
/**
 * `npm run scenario:0a`'s ratchet must not be resettable, and its recipe must not move under an
 * unmoved revision.
 *
 * MEASURED BEFORE THE RULES LANDED (2026-09-25): with `measurements/scenario-0a.json` deleted the tool
 * printed "run with --write to record one" and exited 0, and that `--write` recorded whatever the
 * tree measured as the new baseline — so a grown graph could be laundered by deleting one file. And
 * the scenario had no declared recipe at all, where scenario 6 and 0b freeze theirs per revision.
 * Nothing but this file runs those rules against a record that has been tampered with: `verify` and
 * CI only ever see the intact one, so without it every rule below could be reverted with both of them
 * green.
 *
 * AND AN ADVERSARIAL REVIEW OF THOSE RULES FOUND WHAT THEY MISSED, each measured at exit 0: a history
 * cut from its END (the chain names every entry but the newest), a row's figures deleted or raised
 * by hand, the harness handing the root variant parsed objects, `package.json#exports` no longer
 * resolving a declared specifier to the file measured, a record claiming a revision with no frozen
 * digest, and the browser half deleted. Each has an arm below.
 *
 * AND A SECOND REVIEW (2026-09-26) FOUND THE METHOD ITSELF UNHELD, each measured at exit 0: the
 * harness's `graphBytes(entry)` changed to `graphBytes("src/core/index.js")` left the recipe digest
 * unmoved and a bare `--write` stored core's graph as the root's with no reason and no entry; a NaN
 * import timer ran and `--write` stored `importMs: null`; and the record's timings deleted passed. So
 * the measuring code's bytes are in the recipe, each row's graph is walked again from the declared
 * entry, every write needs a reason (a browser capture included), and every timing is required
 * present — each with an arm below, and the timings with one that shows a slower run still passes,
 * because they are never compared.
 *
 * AND A REVIEW OF THAT WORK (the same day) FOUND TWO MORE, each measured at exit 0: an offset in the
 * orchestrator's copy of the rows into the record, beside 5 real bytes of growth, printed the browser
 * half "fresh"; and the browser half edited by hand to match a grown graph printed "fresh" too. So the
 * rows a run records are walked again as well, and the browser half is bound to the newest entry by its
 * digest. It also weakened rules this file then did not see — browser timings dropped from the list,
 * counts cut to one, a timing held only to being a number — so those are named one by one below.
 *
 * Every arm runs the REAL tool on its own copy of exactly what the tool reads, so no mutation can
 * touch this repository. The control runs first on an unmodified copy and must exit 0, which is what
 * shows the copy holds everything and that a red arm is red for its mutation.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import * as RECIPE_MODULE from "../tools/0a-recipe.mjs";
import { graphBytes } from "../tools/graph-walk.mjs";

/** The recipe revision the working tree is at; every bump below is relative to it. */
const CURRENT = RECIPE_MODULE.RECIPE.revision;
import { chained, entryDigest } from "../tools/ratchet-chain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "lokalized-scenario-0a-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const RECORD = "measurements/scenario-0a.json";
const TOOL = "tools/scenario-0a.mjs";
const RECIPE = "tools/0a-recipe.mjs";
const MEASURE = "tools/0a-measure.mjs";
const BROWSER_RECORDER = "tools/browser-0a/record.mjs";

let copies = 0;
/** A fresh copy of what the tool reads. Each test mutates its own. */
function copy() {
  const dir = join(workspace, `copy-${copies++}`);
  cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
  for (const file of [TOOL, RECIPE, MEASURE, BROWSER_RECORDER, "tools/graph-walk.mjs", "tools/ratchet-chain.mjs", RECORD, "package.json"]) {
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

/** The same, WITHOUT `--expose-gc`, so no retained heap can be measured. @param {string} dir @param {string[]} args */
function runWithoutGc(dir, ...args) {
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
  const line = /^const REBASELINES_FROZEN_THROUGH = .*;$/m;
  assert.ok(line.test(text), "the tool must freeze a checkpoint");
  writeFileSync(path, text.replace(line, `const REBASELINES_FROZEN_THROUGH = ${value};`));
  assert.ok(readFileSync(path, "utf8").includes(`const REBASELINES_FROZEN_THROUGH = ${value};`), "the checkpoint did not move");
}

/** Every figure the record's Node rows hold, raised or replaced by `change`. */
function editRows(/** @type {string} */ dir, /** @type {(row: any) => void} */ change) {
  const record = readRecord(dir);
  for (const row of record.node) change(row);
  writeRecord(dir, record);
}

/** Grow past the recorded baseline even when the working source has shrunk since it was recorded. */
function grow(/** @type {string} */ dir, /** @type {string} */ file) {
  const path = resolve(dir, file);
  const recorded = readRecord(dir).rebaselines.at(-1).recorded;
  const affected = RECIPE_MODULE.RECIPE.variants
    .map((variant) => ({ variant, graph: graphBytes(dir, variant.entry) }))
    .filter(({ graph }) => graph.files.includes(path));
  assert.ok(affected.length > 0, `${file} must be reachable from a measured variant`);
  const padding = Math.max(0, ...affected.map(({ variant, graph }) => recorded[variant.label].sourceBytes - graph.bytes));
  writeFileSync(path, `${readFileSync(path, "utf8")}// grown${"x".repeat(padding)}\n`);
}

/**
 * Moves the copy's recipe to revision `to` (2 unless said) after `change`, and freezes that
 * revision's digest from the tool's own message — the path a maintainer takes, so the test cannot pass
 * on a digest it computed some other way.
 * @param {string} dir @param {() => void} change @param {number} [to]
 */
function bumpRevision(dir, change, to = CURRENT + 1) {
  change();
  edit(join(dir, RECIPE), `  revision: ${CURRENT},`, `  revision: ${to},`);
  const unfrozen = run(dir);
  const digest = unfrozen.out.match(new RegExp(`recipe revision ${to} has no frozen digest in RECIPE_DIGESTS; freeze "([0-9a-f]{64})"`))?.[1];
  assert.ok(digest, `expected the tool to name revision ${to}'s digest\n${unfrozen.out}`);
  edit(join(dir, RECIPE), "export const RECIPE_DIGESTS = Object.freeze({\n", `export const RECIPE_DIGESTS = Object.freeze({\n  ${to}: "${digest}",\n`);
}

test("the control: an unmodified copy passes, at the current recipe revision", () => {
  const dir = copy();
  const result = run(dir);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, new RegExp(`recipe [0-9a-f]{16} {2}revision ${CURRENT}\\b`));
});

test("a changed recipe under an unmoved revision fails, and no --write records over it", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  edit(join(dir, RECIPE), `description: "M2 static integration: `, `description: "M2 static integration (edited): `);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, new RegExp(`the recipe has changed \\([0-9a-f]{12} -> [0-9a-f]{12}\\) while revision stayed ${CURRENT}`));
  const write = run(dir, "--write", "--reason", "try to record over it");
  assert.equal(write.status, 2, write.out);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("a changed fixture fails, and declaring its new digest without a revision still fails", () => {
  const dir = copy();
  edit(join(dir, RECIPE), `fr: { "Greeting": "Bonjour, {{name}}" },`, `fr: { "Greeting": "Salut, {{name}}" },`);
  const changed = run(dir);
  assert.equal(changed.status, 1, changed.out);
  const declared = [...changed.out.matchAll(/: the fixture changed \([0-9a-f]{12} -> [0-9a-f]{12}\) and the recipe still declares the old digest\. A changed fixture is a changed recipe: declare "([0-9a-f]{64})"/g)];
  assert.equal(declared.length, 2, `both variants carry the catalogs, so both must report the change\n${changed.out}`);

  // The maintainer's next move, minus the revision bump: the recipe's own digest now moves instead.
  // The variants are reported in recipe order, which is the order their digests appear in the file.
  const olds = [...readFileSync(join(dir, RECIPE), "utf8").matchAll(/fixtureSha256: "([0-9a-f]{64})"/g)].map((m) => m[1]);
  assert.equal(olds.length, 2);
  olds.forEach((old, i) =>
    edit(join(dir, RECIPE), `fixtureSha256: "${old}"`, `fixtureSha256: "${/** @type {string} */ (declared[i]?.[1])}"`));
  const declaredOnly = run(dir);
  assert.equal(declaredOnly.status, 1, declaredOnly.out);
  assert.doesNotMatch(declaredOnly.out, /the fixture changed/);
  assert.match(declaredOnly.out, new RegExp(`the recipe has changed .* while revision stayed ${CURRENT}`));
});

test("a deleted record fails, and neither --write nor --write --init starts a new one", () => {
  const dir = copy();
  rmSync(join(dir, RECORD));
  const check = run(dir);
  assert.equal(check.status, 1, check.out);
  assert.match(check.out, /NOT RECORDED: measurements\/scenario-0a\.json does not exist/);
  const bare = run(dir, "--write");
  assert.equal(bare.status, 2, bare.out);
  assert.match(bare.out, /--write will not start a new baseline over a missing one/);
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
  record.rebaselines = [chained([], { reason: "a fresh start", growth: [] })];
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
  delete none.rebaselines;
  writeRecord(dir, none);
  const noneRun = run(dir);
  assert.equal(noneRun.status, 1, noneRun.out);
  assert.match(noneRun.out, /carries no history/);
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

test("entries after the checkpoint are reported; cutting one fails on the figures it bound, then as growth", () => {
  const dir = copy();
  const checkpoint = readRecord(dir).rebaselines.at(-1);
  grow(dir, "src/core/index.js");
  assert.equal(run(dir, "--write", "--reason", "a deliberate growth").status, 0);
  const after = run(dir);
  assert.equal(after.status, 0, after.out);
  assert.match(after.out, /; 1 after it held by the chain and the figures they bind, not by source/);
  const freeze = after.out.match(/to freeze them: const REBASELINES_FROZEN_THROUGH = (\{"index":\d+,"sha256":"[0-9a-f]{64}"\});/)?.[1];
  assert.ok(freeze, after.out);

  // Cut the unfrozen entry: the record's grown figures are now above what the newest entry recorded.
  const record = readRecord(dir);
  record.rebaselines.pop();
  writeRecord(dir, record);
  const cut = run(dir);
  assert.equal(cut.status, 1, cut.out);
  assert.match(cut.out, /core \+ parsed equivalent sourceBytes is \d+, above the \d+ its newest history entry recorded/);
  // Put the figures back down to match, and the growth the cut entry explained fails AS GROWTH.
  editRows(dir, (row) => Object.assign(row, checkpoint.recorded[row.label]));
  const regrown = run(dir);
  assert.equal(regrown.status, 1, regrown.out);
  assert.doesNotMatch(regrown.out, /newest history entry recorded/);
  assert.match(regrown.out, /GRAPH GROWTH[\s\S]*core \+ parsed equivalent: source graph grew/);
  assert.equal(run(dir, "--write").status, 2, "the growth needs its reason again");
});

test("moving the checkpoint forward is a paste of the value the tool prints, and then pins the new entry", () => {
  const dir = copy();
  grow(dir, "src/core/index.js");
  const written = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(written.status, 0, written.out);
  const freeze = written.out.match(/to freeze them: const REBASELINES_FROZEN_THROUGH = (\{"index":\d+,"sha256":"[0-9a-f]{64}"\});/)?.[1];
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

test("a row's figures deleted, not counts, or raised by hand fail, and no --write records over them", () => {
  const dir = copy();
  const intact = readRecord(dir);
  grow(dir, "src/index.js");
  /** @type {Array<[string, (row: any) => void, RegExp]>} */
  const arms = [
    ["deleted", (row) => { delete row.sourceBytes; delete row.modules; }, /root \+ raw-text catalog sourceBytes is undefined, not a count/],
    ["a string", (row) => { row.sourceBytes = String(row.sourceBytes + 50); }, /root \+ raw-text catalog sourceBytes is "\d+", not a count/],
    ["raised", (row) => { row.sourceBytes += 100000; }, /root \+ raw-text catalog sourceBytes is \d+, above the \d+ its newest history entry recorded; it was raised by hand/],
  ];
  for (const [name, change, message] of arms) {
    const record = structuredClone(intact);
    change(record.node.find((/** @type {any} */ row) => row.label === "root + raw-text catalog"));
    writeRecord(dir, record);
    const before = readFileSync(join(dir, RECORD));
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    assert.match(result.out, message, name);
    // The drift comparison says so too, rather than comparing with `undefined` or a string and seeing
    // no growth: it is what refuses a bare --write if the binding above were ever lost.
    if (name !== "raised") assert.match(result.out, /root \+ raw-text catalog: NOT RECORDED/, name);
    assert.equal(run(dir, "--write").status, 2, `${name}: a bare --write`);
    assert.equal(run(dir, "--write", "--reason", "record it").status, 2, `${name}: a --write with a reason`);
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${name}: a refused --write still rewrote the record`);
  }
});

test("a deleted browser half fails, and no --write records over it", () => {
  const dir = copy();
  const record = readRecord(dir);
  assert.ok(record.browser, "the record carries a browser half");
  delete record.browser;
  record.environments = ["node"];
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /holds no browser half, and its newest history entry recorded one/);
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2);
});

test("the harness is held to the recipe: the options it hands createStrings and the specifiers package.json resolves", () => {
  // Each harness edit is made under a properly frozen new revision, so the recipe digest — which
  // carries the harness's bytes — is not what refuses it; the handed options are.
  const parsed = copy();
  bumpRevision(parsed, () => edit(join(parsed, MEASURE), "localizedStringSupplier: () => (catalogsFor(variant)),", `localizedStringSupplier: () => (catalogsFor({ catalogInput: "parsed" })),`));
  const handed = run(parsed);
  assert.equal(handed.status, 1, handed.out);
  assert.doesNotMatch(handed.out, /while revision stayed/);
  assert.match(handed.out, /root \+ raw-text catalog: the harness handed createStrings a fixture hashing [0-9a-f]{12}, not the [0-9a-f]{12} the recipe declares for its raw-text input/);
  assert.doesNotMatch(handed.out, /core \+ parsed equivalent: the harness handed/, "the core variant is handed what it declares either way");
  assert.equal(run(parsed, "--write", "--reason", "record it").status, 2);

  const options = copy();
  bumpRevision(options, () => edit(join(options, MEASURE), "fallbackLocale: RECIPE.construction.fallbackLocale,", `fallbackLocale: "fr",`));
  assert.match(run(options).out, /the harness handed construction options \{"fallbackLocale":"fr","localeSupplierAnswers":"en-AU"\}, not the recipe's/);

  // The resolver is CALLED BACK, not trusted: one answering another tag is the same defect.
  const answers = copy();
  bumpRevision(answers, () => edit(join(answers, MEASURE), "localeSupplier: () => RECIPE.construction.localeSupplierAnswers,", `localeSupplier: () => "en-GB",`));
  assert.match(run(answers).out, /the harness handed construction options \{"fallbackLocale":"en","localeSupplierAnswers":"en-GB"\}, not the recipe's/);

  const exported = copy();
  const pkg = JSON.parse(readFileSync(join(exported, "package.json"), "utf8"));
  pkg.exports["."].import = "./src/core/index.js";
  writeFileSync(join(exported, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const moved = run(exported);
  assert.equal(moved.status, 1, moved.out);
  assert.match(moved.out, /the recipe measures src\/index\.js as 'lokalized', and package\.json#exports\['\.'\]\.import is "\.\/src\/core\/index\.js"/);
});

test("a record claiming a revision with no frozen digest fails, and is not written over", () => {
  const dir = copy();
  const record = readRecord(dir);
  record.revision = 0;
  delete record.recipeSha256;
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, new RegExp(`is at recipe revision 0, which this tool \\(revision ${CURRENT}\\) did not produce`));
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2);

  // An EARLIER revision the tool never froze — reachable once a recipe skips one, as here from
  // CURRENT to CURRENT + 2. With no `recipeSha256` in the record and no digest for the one skipped, the comparison was
  // `undefined === undefined`, and passing it made the move look like an ordinary revision bump.
  const skipped = copy();
  bumpRevision(skipped, () => edit(join(skipped, RECIPE), `description: "M2 static integration: `, `description: "M2 static integration, revised: `), CURRENT + 2);
  const claim = readRecord(skipped);
  claim.revision = CURRENT + 1;
  delete claim.recipeSha256;
  writeRecord(skipped, claim);
  const skippedRun = run(skipped);
  assert.equal(skippedRun.status, 1, skippedRun.out);
  assert.match(skippedRun.out, new RegExp(`claims revision ${CURRENT + 1} under recipe undefined, which is not the digest frozen for that revision \\(undefined\\)`));
  assert.equal(run(skipped, "--write", "--reason", "record it").status, 2);
});

test("a deleted variant row is not a reset: it fails, and no --write re-creates it", () => {
  const dir = copy();
  const record = readRecord(dir);
  record.node = record.node.filter((/** @type {any} */ row) => row.label !== "core + parsed equivalent");
  writeRecord(dir, record);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /core \+ parsed equivalent: NOT RECORDED/);
  assert.match(result.out, /holds no core \+ parsed equivalent row, which its newest history entry recorded/);
  assert.equal(run(dir, "--write").status, 2, "re-creating a deleted row with no reason");
  assert.equal(run(dir, "--write", "--reason", "re-create it").status, 2, "the newest entry recorded the row, so it is restored from git");
});

test("a duplicated variant row is refused: a raised copy ahead of the true row cannot hide growth", () => {
  const dir = copy();
  const record = readRecord(dir);
  const at = record.node.findIndex((/** @type {any} */ row) => row.label === "root + raw-text catalog");
  // The history binds the LAST row of a label (`figuresOf`) and the growth terms read the FIRST, so a
  // raised copy placed ahead of the true row passed both before `rowProblems`: measured on scenario 6.
  record.node.splice(at, 0, { ...record.node[at], sourceBytes: record.node[at].sourceBytes + 100000 });
  writeRecord(dir, record);
  grow(dir, "src/index.js");
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /holds 2 rows labelled "root \+ raw-text catalog": the history binds the last and the growth terms read the first/);
  assert.equal(run(dir, "--write", "--reason", "write over it").status, 2, "a duplicated row is restored from git, not written over");
});

test("a reason is a sentence: a blank, or the next flag read as one, is refused on the command line and in the history", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  edit(join(dir, "src/core/index.js"), " * M2 walking skeleton. ", " * M2 skeleton. ");
  const flag = run(dir, "--reason", "--write");
  assert.equal(flag.status, 2, `"--reason --write" read the flag as the reason\n${flag.out}`);
  assert.match(flag.out, /refusing to write measurements\/scenario-0a\.json without --reason "why" \(a sentence, not blank and not the next flag\)/);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  // An entry after the checkpoint is named by nothing, so blanking its reason leaves the chain intact:
  // only the rule that every entry carries a sentence can see it.
  assert.equal(run(dir, "--write", "--reason", "a deliberate shrink").status, 0);
  const record = readRecord(dir);
  record.rebaselines.at(-1).reason = "  ";
  writeRecord(dir, record);
  const blanked = run(dir);
  assert.equal(blanked.status, 1, blanked.out);
  assert.match(blanked.out, new RegExp(`history entry ${record.rebaselines.length - 1} carries no reason \\("  "\\)`));

  const intact = readRecord(copy());
  const [rootRow, coreRow] = intact.browser.variants;
  /** @param {any[]} rows */
  const capture = (rows) => JSON.stringify({ userAgent: intact.browser.userAgent, memoryKind: intact.browser.memoryKind, rows });
  writeFileSync(join(dir, "root.json"), capture([rootRow]));
  writeFileSync(join(dir, "core.json"), capture([coreRow]));
  const browserFlag = spawnSync(process.execPath, [BROWSER_RECORDER, "root.json", "core.json", "--reason", "--x"], { cwd: dir, encoding: "utf8" });
  assert.equal(browserFlag.status, 2, `the browser recorder read a flag as the reason\n${browserFlag.stdout}${browserFlag.stderr}`);
});

test("growth fails and is refused without a reason; with one it is recorded, chained, and passes", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  grow(dir, "src/core/index.js");
  const grown = run(dir);
  assert.equal(grown.status, 1, grown.out);
  assert.match(grown.out, /GRAPH GROWTH[\s\S]*source graph grew/);
  const bare = run(dir, "--write");
  assert.equal(bare.status, 2, bare.out);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const recorded = run(dir, "--write", "--reason", "a deliberate growth");
  assert.equal(recorded.status, 0, recorded.out);
  const written = readRecord(dir);
  const history = written.rebaselines;
  assert.equal(history.at(-1).reason, "a deliberate growth");
  assert.ok(history.at(-1).growth.some((/** @type {string} */ line) => /source graph grew/.test(line)));
  assert.deepEqual(history.at(-1).recorded, Object.fromEntries(written.node.map(
    (/** @type {any} */ row) => [row.label, { modules: row.modules, sourceBytes: row.sourceBytes }])), "the entry binds the figures it wrote");
  assert.equal(history.at(-1).browserHalf, true);
  const after = run(dir);
  assert.equal(after.status, 0, `the chained entry must satisfy the next run\n${after.out}`);
});

test("a revision bump is recorded only with a reason, and then passes", () => {
  const dir = copy();
  bumpRevision(dir, () => edit(join(dir, RECIPE), `description: "M2 static integration: `, `description: "M2 static integration, revised: `));
  const moved = run(dir);
  assert.equal(moved.status, 1, moved.out);
  assert.match(moved.out, new RegExp(`the recipe moved from revision ${CURRENT} to ${CURRENT + 1}`));
  assert.equal(run(dir, "--write").status, 2, "a revision move must need a reason");
  const recorded = run(dir, "--write", "--reason", `revision ${CURRENT + 1}`);
  assert.equal(recorded.status, 0, recorded.out);
  assert.equal(readRecord(dir).revision, CURRENT + 1);
  assert.equal(run(dir).status, 0);
});

test("a first render that is not the recipe's is refused, not recorded", () => {
  const dir = copy();
  bumpRevision(dir, () => edit(join(dir, RECIPE), `expected: "I read 3 books"`, `expected: "I read three books"`));
  const before = readFileSync(join(dir, RECORD));
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /the first render was "I read 3 books", not the recipe's "I read three books"/);
  assert.equal(run(dir, "--write", "--reason", "record it anyway").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
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
  assert.equal(readRecord(dir).rebaselines.length, 1);
  assert.ok(readRecord(dir).rebaselines[0].recorded, "the first entry binds the figures too");
  const next = run(dir);
  assert.equal(next.status, 1, next.out);
  assert.match(next.out, /has no frozen first entry; freeze "[0-9a-f]{64}" in its tool/);
});

test("the measuring code is inside the recipe: a comment in it, or another graph, is a new revision, and nothing records over it", () => {
  const comment = copy();
  const before = readFileSync(join(comment, RECORD));
  edit(join(comment, MEASURE), "let bust = 0;", "// a comment, and nothing else\nlet bust = 0;");
  const commented = run(comment);
  assert.equal(commented.status, 1, commented.out);
  assert.match(commented.out, new RegExp(`the recipe has changed \\([0-9a-f]{12} -> [0-9a-f]{12}\\) while revision stayed ${CURRENT} — its declared object, or the bytes of tools/0a-measure\\.mjs`));
  assert.equal(run(comment, "--write", "--reason", "record over it").status, 2);
  assert.ok(readFileSync(join(comment, RECORD)).equals(before), "a refused --write still rewrote the record");

  // The review's ablation, in the file the code lives in now: both holds see it.
  const other = copy();
  edit(join(other, MEASURE), "graphBytes(root, variant.entry)", `graphBytes(root, "src/core/index.js")`);
  const moved = run(other);
  assert.equal(moved.status, 1, moved.out);
  assert.match(moved.out, new RegExp(`the recipe has changed .* while revision stayed ${CURRENT}`));
  assert.match(moved.out, /root \+ raw-text catalog: the harness returned \d+ modules \/ \d+ bytes, and the recipe's entry src\/index\.js walks to \d+ \/ \d+: some other graph/);
  assert.equal(run(other, "--write").status, 2, "a bare --write");
  assert.equal(run(other, "--write", "--reason", "record it").status, 2, "a --write with a reason");
  assert.ok(readFileSync(join(other, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("each row's graph is walked again from the recipe's entry: the orchestrator handing the harness another entry fails", () => {
  // tools/scenario-0a.mjs is in no digest, so the re-derivation is the one hold that sees this.
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  edit(join(dir, TOOL), "await measureVariant(root, variant);", `await measureVariant(root, { ...variant, entry: "src/core/index.js" });`);
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.doesNotMatch(result.out, /the recipe has changed/);
  assert.match(result.out, /root \+ raw-text catalog: the harness returned \d+ modules \/ \d+ bytes, and the recipe's entry src\/index\.js walks to \d+ \/ \d+: some other graph/);
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("measuredGraphProblems: the rows are the recipe's variants, one each, in its order, each its own entry's graph", () => {
  const walk = (/** @type {string} */ entry) => ({ bytes: entry.length * 1000, modules: entry.length });
  const good = RECIPE_MODULE.RECIPE.variants.map((variant) =>
    ({ label: variant.label, sourceBytes: walk(variant.entry).bytes, modules: walk(variant.entry).modules }));
  assert.deepEqual(RECIPE_MODULE.measuredGraphProblems(good, walk), []);
  assert.match(RECIPE_MODULE.measuredGraphProblems([good[1], good[0]], walk).join("\n"),
    /the harness returned "core \+ parsed equivalent" as row 0, and the recipe's variant 0 is "root \+ raw-text catalog": some other scenario/);
  assert.match(RECIPE_MODULE.measuredGraphProblems(good.slice(0, 1), walk).join("\n"), /the harness returned 1 row\(s\) for the recipe's 2 variants/);
  assert.match(RECIPE_MODULE.measuredGraphProblems([...good, good[0]], walk).join("\n"), /the harness returned 3 row\(s\)/);
  assert.match(RECIPE_MODULE.measuredGraphProblems([good[0], { ...good[1], sourceBytes: Number(good[1]?.sourceBytes) + 1 }], walk).join("\n"),
    /core \+ parsed equivalent: the harness returned \d+ modules \/ \d+ bytes, and the recipe's entry src\/core\/index\.js walks to/);
  assert.match(RECIPE_MODULE.measuredGraphProblems([good[0], { ...good[1], modules: Number(good[1]?.modules) - 1 }], walk).join("\n"),
    /: some other graph/);
  // The same rule names the rows a run is about to record, which tools/scenario-0a.mjs holds as well.
  assert.match(RECIPE_MODULE.measuredGraphProblems([good[0], { ...good[1], sourceBytes: 1 }], walk, "this run records").join("\n"),
    /^core \+ parsed equivalent: this run records \d+ modules \/ 1 bytes, and the recipe's entry src\/core\/index\.js walks to \d+ \/ \d+: some other graph$/);
});

test("a timing that is not finite is refused, under a properly frozen revision too, and no --write stores it", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  bumpRevision(dir, () => edit(join(dir, MEASURE), "return { ms: performance.now() - t0, mod };", "return { ms: NaN, mod };"));
  const result = run(dir);
  assert.equal(result.status, 1, result.out);
  assert.doesNotMatch(result.out, /while revision stayed/);
  assert.match(result.out, /this run: root \+ raw-text catalog importMs is NaN; timings are reported and never compared, but each must be a finite, positive time/);
  assert.match(result.out, /this run: core \+ parsed equivalent importMs is NaN/);
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2, "the review measured this storing importMs: null");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("retained heap is required too: a run without --expose-gc fails, and cannot be written", () => {
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  const result = runWithoutGc(dir);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /this run: root \+ raw-text catalog retainedBytes is null; retained heap is reported and never compared, but it must be a finite number of bytes, which needs --expose-gc/);
  assert.equal(runWithoutGc(dir, "--write", "--reason", "record it").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("the record's timings are required present: deleted from a row, or the browser half thinned, fails and is not written over", () => {
  const dir = copy();
  const intact = readRecord(dir);
  /** @type {Array<[string, (record: any) => void, RegExp[]]>} */
  const arms = [
    ["every Node timing deleted", (record) => { for (const row of record.node) for (const key of ["importMs", "constructionMs", "firstRenderMs", "retainedBytes"]) delete row[key]; },
      [/measurements\/scenario-0a\.json: root \+ raw-text catalog importMs is undefined; .*; restore it from git/,
        /core \+ parsed equivalent constructionMs is undefined/, /root \+ raw-text catalog firstRenderMs is undefined/,
        /core \+ parsed equivalent retainedBytes is undefined/]],
    ["a Node timing null", (record) => { record.node[0].importMs = null; }, [/root \+ raw-text catalog importMs is null/]],
    ["a browser row deleted", (record) => { record.browser.variants.pop(); },
      [/the browser half holds no core \+ parsed equivalent row; it was deleted/]],
    ["a browser timing deleted", (record) => { delete record.browser.variants[0].coldImportMs; },
      [/the browser half's root \+ raw-text catalog coldImportMs is undefined; .*; restore it from git/]],
    ["a browser count not a count", (record) => { record.browser.variants[1].resources = "31"; },
      [/the browser half's core \+ parsed equivalent resources is "31", not a count/]],
  ];
  for (const [name, change, messages] of arms) {
    const record = structuredClone(intact);
    change(record);
    writeRecord(dir, record);
    const before = readFileSync(join(dir, RECORD));
    const result = run(dir);
    assert.equal(result.status, 1, `${name}\n${result.out}`);
    for (const message of messages) assert.match(result.out, message, name);
    assert.equal(run(dir, "--write", "--reason", "record it").status, 2, `${name}: a --write with a reason`);
    assert.ok(readFileSync(join(dir, RECORD)).equals(before), `${name}: a refused --write still rewrote the record`);
  }
});

test("timings are never compared: a record whose timings are far smaller, or far larger, than this run's passes", () => {
  const dir = copy();
  editRows(dir, (row) => Object.assign(row, { importMs: 0.0001, constructionMs: 0.0001, firstRenderMs: 0.0001, retainedBytes: 1 }));
  const grew = run(dir);
  assert.equal(grew.status, 0, `every timing grew against the record, which is reported only\n${grew.out}`);
  editRows(dir, (row) => Object.assign(row, { importMs: 1e6, constructionMs: 1e6, firstRenderMs: 1e6, retainedBytes: 1e12 }));
  const shrank = run(dir);
  assert.equal(shrank.status, 0, shrank.out);
});

test("timingProblems and browserHalfProblems gate presence and finiteness, never the value", () => {
  const row = { label: "r", importMs: 0.3, constructionMs: 0.1, firstRenderMs: 0.3, retainedBytes: 90000 };
  assert.deepEqual(RECIPE_MODULE.timingProblems([row], "x"), []);
  assert.deepEqual(RECIPE_MODULE.timingProblems([{ ...row, importMs: 1e9, retainedBytes: -5 }], "x"), [], "any finite value: it is never compared");
  /** @type {Array<[string, unknown]>} */
  const bad = [["importMs", NaN], ["constructionMs", undefined], ["firstRenderMs", 0], ["importMs", null], ["importMs", "0.3"],
    ["constructionMs", -1], ["retainedBytes", null], ["retainedBytes", Infinity]];
  for (const [key, value] of bad)
    assert.equal(RECIPE_MODULE.timingProblems([{ ...row, [key]: value }], "x").length, 1, `${key} ${String(value)}`);
  assert.match(RECIPE_MODULE.timingProblems(undefined, "x").join(), /holds no Node rows/);

  const browser = JSON.parse(readFileSync(join(root, RECORD), "utf8")).browser;
  assert.deepEqual(RECIPE_MODULE.browserHalfProblems(browser), []);
  // A coarsened browser timer can read 0, so 0 is present; a negative or missing one is not.
  const zeroed = structuredClone(browser);
  zeroed.variants[0].constructionMs = 0;
  assert.deepEqual(RECIPE_MODULE.browserHalfProblems(zeroed), []);
  const negative = structuredClone(browser);
  negative.variants[0].firstRenderMs = -0.1;
  assert.match(RECIPE_MODULE.browserHalfProblems(negative).join(), /firstRenderMs is -0\.1/);
  assert.equal(RECIPE_MODULE.browserHalfProblems({ variants: [] }).length, 2, "a row per recipe variant");
  assert.equal(RECIPE_MODULE.browserHalfProblems(undefined).length, 2);
});

test("every --write needs a reason, a shrink included, and appends an entry that binds what it wrote", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const checkpoint = intact.rebaselines.at(-1);
  const before = readFileSync(join(dir, RECORD));
  edit(join(dir, "src/core/index.js"), " * M2 walking skeleton. ", " * M2 skeleton. ");
  const shrunk = run(dir);
  assert.equal(shrunk.status, 0, `a shrink is reported, not gated\n${shrunk.out}`);
  const bare = run(dir, "--write");
  assert.equal(bare.status, 2, `the review measured a bare shrink write at exit 0, appending nothing\n${bare.out}`);
  assert.match(bare.out, /refusing to write measurements\/scenario-0a\.json without --reason/);
  assert.equal(run(dir, "--write", "--reason", "  ").status, 2, "a blank reason is no reason");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");

  const written = run(dir, "--write", "--reason", "a deliberate shrink");
  assert.equal(written.status, 0, written.out);
  const record = readRecord(dir);
  assert.equal(record.rebaselines.length, intact.rebaselines.length + 1, "the shrink appended an entry");
  const entry = record.rebaselines.at(-1);
  assert.equal(entry.reason, "a deliberate shrink");
  assert.deepEqual(entry.growth, []);
  assert.deepEqual(entry.recorded, Object.fromEntries(record.node.map(
    (/** @type {any} */ row) => [row.label, { modules: row.modules, sourceBytes: row.sourceBytes }])), "the entry binds the figures it wrote");
  assert.equal(entry.browserSha256, entryDigest(record.browser), "and the browser half it carried");
  assert.ok(entry.recorded["core + parsed equivalent"].sourceBytes < checkpoint.recorded["core + parsed equivalent"].sourceBytes);
  assert.equal(run(dir).status, 0);

  // THE HOLE THIS CLOSES: with no entry for the shrink, the figures it replaced could be put back by
  // hand and passed, re-admitting growth. The newest entry now records the shrunk figures.
  editRows(dir, (row) => Object.assign(row, checkpoint.recorded[row.label]));
  const raised = run(dir);
  assert.equal(raised.status, 1, raised.out);
  assert.match(raised.out, /core \+ parsed equivalent sourceBytes is \d+, above the \d+ its newest history entry recorded; it was raised by hand/);
});

test("a browser capture is a write like any other: it needs a reason, appends an entry, and a half the check would refuse is not written", () => {
  const dir = copy();
  const intact = readRecord(dir);
  const before = readFileSync(join(dir, RECORD));
  /** @param {any[]} rows */
  const capture = (rows) => JSON.stringify({ userAgent: intact.browser.userAgent, memoryKind: intact.browser.memoryKind, rows });
  const [rootRow, coreRow] = intact.browser.variants;
  writeFileSync(join(dir, "root.json"), capture([rootRow]));
  writeFileSync(join(dir, "core.json"), capture([coreRow]));
  writeFileSync(join(dir, "core-untimed.json"), capture([{ ...coreRow, firstRenderMs: null }]));
  const uncounted = { ...coreRow };
  delete uncounted.resources;
  writeFileSync(join(dir, "core-uncounted.json"), capture([uncounted]));
  writeFileSync(join(dir, "core-string-count.json"), capture([{ ...coreRow, decodedBytes: String(coreRow.decodedBytes) }]));
  /** @param {string[]} args */
  const record = (...args) => {
    const result = spawnSync(process.execPath, [BROWSER_RECORDER, ...args], { cwd: dir, encoding: "utf8" });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  const bare = record("root.json", "core.json");
  assert.equal(bare.status, 2, bare.out);
  assert.match(bare.out, /refusing to record without --reason/);
  const thin = record("root.json", "--reason", "only the root");
  assert.equal(thin.status, 1, thin.out);
  assert.match(thin.out, /the browser half holds no core \+ parsed equivalent row/);
  const untimed = record("root.json", "core-untimed.json", "--reason", "a timing missing");
  assert.equal(untimed.status, 1, untimed.out);
  assert.match(untimed.out, /the browser half's core \+ parsed equivalent firstRenderMs is null/);
  // A review filtered the "not a count" lines out of the recorder's refusal and this test stayed green.
  const uncountedRun = record("root.json", "core-uncounted.json", "--reason", "a count missing");
  assert.equal(uncountedRun.status, 1, uncountedRun.out);
  assert.match(uncountedRun.out, /the browser half's core \+ parsed equivalent resources is undefined, not a count/);
  const stringCount = record("root.json", "core-string-count.json", "--reason", "a count as text");
  assert.equal(stringCount.status, 1, stringCount.out);
  assert.match(stringCount.out, /the browser half's core \+ parsed equivalent decodedBytes is "\d+", not a count/);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused capture still rewrote the record");

  const recorded = record("root.json", "core.json", "--reason", "re-captured");
  assert.equal(recorded.status, 0, recorded.out);
  const written = readRecord(dir);
  assert.equal(written.rebaselines.length, intact.rebaselines.length + 1, "the capture appended an entry");
  assert.equal(written.rebaselines.at(-1).reason, "re-captured");
  assert.deepEqual(written.rebaselines.at(-1).recorded, intact.rebaselines.at(-1).recorded, "it carries the Node figures forward");
  assert.equal(written.rebaselines.at(-1).browserHalf, true);
  assert.equal(written.rebaselines.at(-1).browserSha256, entryDigest(written.browser), "it binds the half it wrote");
  const next = run(dir);
  assert.equal(next.status, 0, `the capture's entry satisfies the next run\n${next.out}`);
});

test("the rows this run records are walked again too: an offset in the copy into the record fails, beside growth or alone", () => {
  // A SECOND REVIEW MEASURED WHY (2026-09-26): while only the harness's rows were walked again, an offset
  // in tools/scenario-0a.mjs's copy of them into the record — `sourceBytes: r.sourceBytes - 5`, in no
  // digest — beside 5 real bytes appended to src/internal/locale.js ran at exit 0 with the browser half
  // printed "fresh", and every test here stayed green.
  const dir = copy();
  const before = readFileSync(join(dir, RECORD));
  edit(join(dir, TOOL), "label: r.label, modules: r.modules, sourceBytes: r.sourceBytes,",
    "label: r.label, modules: r.modules, sourceBytes: r.sourceBytes - 5,");
  const alone = run(dir);
  assert.equal(alone.status, 1, alone.out);
  assert.match(alone.out, /root \+ raw-text catalog: this run records \d+ modules \/ \d+ bytes, and the recipe's entry src\/index\.js walks to \d+ \/ \d+: some other graph/);
  assert.match(alone.out, /core \+ parsed equivalent: this run records \d+ modules \/ \d+ bytes, and the recipe's entry src\/core\/index\.js walks to/);
  assert.doesNotMatch(alone.out, /the harness returned/, "the harness's rows are right: only the copy moved");

  const locale = join(dir, "src/internal/locale.js");
  writeFileSync(locale, `${readFileSync(locale, "utf8")}//55\n`);
  const hidden = run(dir);
  assert.equal(hidden.status, 1, hidden.out);
  assert.doesNotMatch(hidden.out, /GRAPH GROWTH/, "the offset hides the growth from the ratchet, as the review measured");
  assert.match(hidden.out, /root \+ raw-text catalog: this run records .*: some other graph/, "and the walk sees it");
  assert.equal(run(dir, "--write").status, 2, "a bare --write");
  assert.equal(run(dir, "--write", "--reason", "record it").status, 2, "a --write with a reason");
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
});

test("the browser half is bound to the newest entry by its digest: a hand edit fails, one that fakes freshness too", () => {
  // A SECOND REVIEW MEASURED WHY (2026-09-26): whole and finite is not unedited. With the half STALE
  // after a recorded growth, its root row's transfer bytes raised by hand to the new graph's and its cold
  // import changed from 25 to 2.5 ms, the run printed "fresh" at exit 0.
  const dir = copy();
  const intact = readRecord(dir);
  // The newest entry binds the half itself (every write since 2026-09-26 records `browserSha256`); for an
  // older checkpoint entry that predates the binding, the digest the tool freezes stands in. Either way
  // a hand edit is refused.
  const retimed = structuredClone(intact);
  retimed.browser.variants[0].coldImportMs = 2.5;
  writeRecord(dir, retimed);
  const before = readFileSync(join(dir, RECORD));
  const atCheckpoint = run(dir);
  assert.equal(atCheckpoint.status, 1, atCheckpoint.out);
  assert.match(atCheckpoint.out, /browser half is not the one its newest history entry bound \([0-9a-f]{12}\): it was edited by hand/);
  assert.equal(run(dir, "--write", "--reason", "record over it").status, 2);
  assert.ok(readFileSync(join(dir, RECORD)).equals(before), "a refused --write still rewrote the record");
  writeRecord(dir, intact);
  assert.equal(run(dir).status, 0, "the intact half passes at the checkpoint");

  // After a write the entry binds the half itself, and the review's fake is refused.
  grow(dir, "src/index.js");
  const grew = run(dir, "--write", "--reason", "grew");
  assert.equal(grew.status, 0, grew.out);
  const stale = run(dir);
  assert.equal(stale.status, 0, stale.out);
  assert.match(stale.out, /STALE — the browser capture no longer describes these source files/);
  const record = readRecord(dir);
  assert.equal(record.rebaselines.at(-1).browserSha256, entryDigest(record.browser));
  // EVERY row is faked, not only the grown one: whether the other rows are already fresh depends on how
  // recently someone re-drove the browser, and a test must not.
  const faked = structuredClone(record);
  faked.browser.variants.forEach((variant, i) => Object.assign(variant, {
    decodedBytes: record.node[i].sourceBytes, encodedBytes: record.node[i].sourceBytes,
    resources: record.node[i].modules, coldImportMs: 2.5,
  }));
  writeRecord(dir, faked);
  const freshened = run(dir);
  assert.equal(freshened.status, 1, freshened.out);
  assert.match(freshened.out, /fresh: transfer bytes and resource counts match/, "the fake does look fresh");
  assert.match(freshened.out, /browser half is not the one its newest history entry bound/);

  // An entry after the checkpoint that binds no browser half is refused rather than read as agreement.
  const unbound = structuredClone(record);
  delete unbound.rebaselines.at(-1).browserSha256;
  writeRecord(dir, unbound);
  const bare = run(dir);
  assert.equal(bare.status, 1, bare.out);
  assert.match(bare.out, /newest history entry binds no browser half \(no browserSha256\)/);
});

test("every browser count and timing is required BY NAME, and a timing that is not finite is refused", () => {
  // A review weakened each rule in turn and this file stayed green (2026-09-26): the browser timing list
  // without importMs, or without constructionMs; the count list cut to resources alone; and a Node
  // timing held only to being a number, which Infinity is. The names are listed here, not read from
  // tools/0a-recipe.mjs, so a list that loses one cannot agree with itself.
  const browser = JSON.parse(readFileSync(join(root, RECORD), "utf8")).browser;
  for (const key of ["resources", "encodedBytes", "decodedBytes", "coldImportMs", "importMs", "constructionMs", "firstRenderMs"])
    for (const i of [0, 1]) {
      const thinned = structuredClone(browser);
      delete thinned.variants[i][key];
      const problems = RECIPE_MODULE.browserHalfProblems(thinned);
      assert.equal(problems.length, 1, `${key} deleted from row ${i}`);
      assert.ok(problems[0]?.includes(`the browser half's ${thinned.variants[i].label} ${key} is undefined`), problems[0]);
    }
  for (const key of ["coldImportMs", "importMs", "constructionMs", "firstRenderMs"])
    for (const value of [Infinity, NaN, "0.5"]) {
      const odd = structuredClone(browser);
      odd.variants[1][key] = value;
      assert.equal(RECIPE_MODULE.browserHalfProblems(odd).length, 1, `browser ${key} ${String(value)}`);
    }
  const row = { label: "r", importMs: 0.3, constructionMs: 0.1, firstRenderMs: 0.3, retainedBytes: 90000 };
  for (const key of ["importMs", "constructionMs", "firstRenderMs", "retainedBytes"])
    for (const value of [Infinity, -Infinity, NaN])
      assert.equal(RECIPE_MODULE.timingProblems([{ ...row, [key]: value }], "x").length, 1, `${key} ${String(value)}`);
});
