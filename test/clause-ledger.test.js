// @ts-check
/**
 * `tools/clause-ledger.mjs` requires every path-like gate a clause names to exist, WHATEVER THE
 * VERDICT — and until 2026-09-25 it did not, for DEFERRED clauses.
 *
 * The existence check sat after the DEFERRED branch, whose `continue` skipped it, while the comment
 * above the check said "WHATEVER THE VERDICT". Measured: planting `tools/does-not-exist.mjs` on M8
 * clause 92, a DEFERRED clause, left `npm run clause:ledger` at exit 0. The real ledgers never carry
 * a missing gate, so `verify` and CI cannot tell the rule from its absence; this file plants one.
 *
 * An adversarial review then found the same rule defeated by SHAPE: `gates` given as a string is
 * iterable, so it was read one character at a time and a DEFERRED clause carrying
 * `"tools/does-not-exist.mjs"` passed at exit 0 (and a PROVEN one crashed the run). So the rule is
 * planted on every verdict, and in both shapes.
 *
 * The tool runs on a copy of the repository parts its gates name (a clause's gate may be any file
 * under `src/`, `test/`, `tools/`, `examples/` or `measurements/`) with the spec checkout linked
 * beside it read-only, because the deferral predicates and several gates live there. Only the copy's
 * ledger is edited. The control runs first on the unmodified copy and must exit 0, which is what shows
 * the copy holds every gate the real ledgers name.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "lokalized-clause-ledger-"));
// `rmSync` unlinks the spec link without following it.
after(() => rmSync(workspace, { recursive: true, force: true }));

const copy = join(workspace, "lokalized-js");
for (const entry of ["src", "test", "tools", "examples", "measurements", "package.json"])
  cpSync(join(root, entry), join(copy, entry), { recursive: true });
symlinkSync(resolve(root, "..", "lokalized-spec"), join(workspace, "lokalized-spec"), "dir");

const run = () => {
  const result = spawnSync(process.execPath, ["tools/clause-ledger.mjs"], { cwd: copy, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

/** The ledgers the tool declares, read from the copy so a planted gate goes into the copy alone. */
const LEDGERS = ["m8", "m9", "md", "mr"].map((id) => join(copy, "measurements", `${id}-clauses.json`));

test("the control: the copy's ledgers pass as the repository's do", () => {
  const result = run();
  assert.equal(result.status, 0, result.out);
});

/**
 * The first clause of `verdict` in the copy's ledgers, edited by `change` for the length of `body`
 * and then put back byte for byte.
 * @param {string} verdict @param {(clause: any, ledger: any) => void} change
 * @param {(clause: any, ledger: any) => void} body
 */
function withClause(verdict, change, body) {
  const found = LEDGERS.map((path) => ({ path, ledger: JSON.parse(readFileSync(path, "utf8")) }))
    .flatMap(({ path, ledger }) => ledger.clauses
      .filter((/** @type {any} */ clause) => clause.verdict === verdict)
      .map((/** @type {any} */ clause) => ({ path, ledger, clause })));
  // The tool fails when no deferral consults a DEFERRAL_GROUNDS predicate ("DEFERRAL_GROUNDS is
  // inert"), so while the control passes there is a DEFERRED clause to plant on; NOT-PROVEN is M8's
  // open clauses. If either stops being true this arm must be rewritten, not skipped.
  assert.ok(found.length > 0, `no ledger holds a ${verdict} clause to plant a gate on`);
  const { path, ledger, clause } = /** @type {{ path: string, ledger: any, clause: any }} */ (found[0]);
  const original = readFileSync(path);
  change(clause, ledger);
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  try {
    body(clause, ledger);
  } finally {
    writeFileSync(path, original);
  }
}

const plant = (/** @type {any} */ clause) => { clause.gates = [...(clause.gates ?? []), "tools/does-not-exist.mjs"]; };
const named = (/** @type {any} */ ledger, /** @type {any} */ clause) =>
  new RegExp(`${ledger.milestone} clause ${clause.id} names gate 'tools/does-not-exist\\.mjs', which does not exist`);

test("a DEFERRED clause naming a gate that does not exist fails the ledger", () => {
  withClause("DEFERRED", plant, (clause, ledger) => {
    const result = run();
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, named(ledger, clause));
  });
});

test("so does a NOT-PROVEN clause, and an OUT-OF-SCOPE one — which is otherwise checked for nothing", () => {
  withClause("NOT-PROVEN", plant, (clause, ledger) => {
    const result = run();
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, named(ledger, clause));
  });
  // No ledger holds an OUT-OF-SCOPE clause, so one is made in the copy — tally included, and shown to
  // pass on its own before the gate is planted, so the red below is the gate's.
  const outOfScope = (/** @type {any} */ clause, /** @type {any} */ ledger) => {
    clause.verdict = "OUT-OF-SCOPE";
    ledger.tally["NOT-PROVEN"] -= 1;
    ledger.tally["OUT-OF-SCOPE"] = (ledger.tally["OUT-OF-SCOPE"] ?? 0) + 1;
  };
  withClause("NOT-PROVEN", outOfScope, () => {
    const result = run();
    assert.equal(result.status, 0, result.out);
  });
  withClause("NOT-PROVEN", (clause, ledger) => { outOfScope(clause, ledger); plant(clause); }, (clause, ledger) => {
    const result = run();
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, named(ledger, clause));
  });
});

test("gates given as a string is refused, not read one character at a time", () => {
  withClause("DEFERRED", (clause) => { clause.gates = "tools/does-not-exist.mjs"; }, (clause, ledger) => {
    const result = run();
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, new RegExp(`${ledger.milestone} clause ${clause.id}: gates is "tools/does-not-exist\\.mjs", not a list of gate names`));
  });
  withClause("PROVEN", (clause) => { clause.gates = clause.gates.join(""); }, (clause, ledger) => {
    const result = run();
    assert.equal(result.status, 1, result.out);
    assert.doesNotMatch(result.out, /TypeError/, "a string on a PROVEN clause once crashed the run");
    assert.match(result.out, new RegExp(`${ledger.milestone} clause ${clause.id}: gates is ".*", not a list of gate names`));
  });
});
