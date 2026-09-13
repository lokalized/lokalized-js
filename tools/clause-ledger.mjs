#!/usr/bin/env node
// @ts-check
/**
 * The M8 acceptance-clause ledger, and the rule that a verdict cannot certify itself.
 *
 * **WHY THIS EXISTS.** M8's close-out was going to be a clause-by-clause verdict table in prose, and
 * this project has now caught FIVE texts asserting the inverse of the fact they described — including
 * a source comment that named a test file which did not exist. A close-out that reads its own prose
 * back to itself is that failure mode with a milestone riding on it. So the verdicts live in a
 * machine-readable artifact and this tool enforces what a verdict has to carry:
 *
 *   PROVEN requires (a) at least one named GATE, (b) a recorded ABLATION stating what went red, and
 *   (c) every named gate that looks like a path to EXIST on disk.
 *
 * Anything else is NOT-PROVEN. "Nothing contradicts it" is not a verdict, and neither is confident
 * prose — the ledger was DERIVED from `planning/M8-STATUS.md` by agents told to downgrade whatever
 * the record does not actually support, rather than transcribed from the slice summaries.
 *
 * **IT MADE THE NUMBER WORSE, WHICH IS THE POINT.** The derivation knocked several verdicts down that
 * the slice records read as settled. The clearest: S8 recorded "Six ablations, all firing" and listed
 * them, but named no red test for any one of them — a summary claim, where S11b and S14 carry a table
 * naming the test each ablation turns red. Same word, different evidence, and only the second kind
 * survives this gate.
 *
 * The artifact is deliberately NOT a ratchet. A verdict may move in either direction — work lands, or
 * a re-read finds a claim the record never supported — and freezing it would make the honest
 * direction the expensive one.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = join(root, "measurements/m8-clauses.json");

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const scripts = new Set(Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}));

/** A bare path: no spaces, and a source-file extension. Prose mentioning a path is not a path. */
const PATH_LIKE = /^[\w./-]+\.(?:js|mjs|json)$/;
const isFile = (/** @type {string} */ gate) => PATH_LIKE.test(gate) && existsSync(join(root, gate));
const isScript = (/** @type {string} */ gate) => scripts.has(gate.replace(/^npm run /, ""));
const clauses = ledger.clauses ?? [];
const VERDICTS = new Set(["PROVEN", "NOT-PROVEN", "DEFERRED", "OUT-OF-SCOPE"]);

/** @type {string[]} */
const problems = [];

// The clause set is the PLAN's, so a row appearing or vanishing is a defect rather than an edit.
// 93 is M8-PLAN.md's own count; a ledger that silently covered 40 would otherwise report a tidy tally.
const ids = clauses.map((c) => c.id);
if (clauses.length !== 93)
  problems.push(`the ledger carries ${clauses.length} clauses; M8 has 93`);
for (let expected = 1; expected <= 93; ++expected)
  if (!ids.includes(expected)) problems.push(`clause ${expected} is missing from the ledger`);

for (const clause of clauses) {
  const at = `clause ${clause.id}`;
  if (!VERDICTS.has(clause.verdict)) {
    problems.push(`${at}: unknown verdict ${JSON.stringify(clause.verdict)}`);
    continue;
  }
  if (typeof clause.statement !== "string" || clause.statement.trim().length === 0)
    problems.push(`${at}: no statement`);
  if (typeof clause.evidenceLine !== "string" || clause.evidenceLine.trim().length === 0)
    problems.push(`${at}: no evidence line; every verdict must say what it rests on`);

  if (clause.verdict !== "PROVEN") continue;

  // THE RULE THIS TOOL EXISTS FOR.
  if (!Array.isArray(clause.gates) || clause.gates.length === 0)
    problems.push(`${at} is PROVEN with no named gate`);
  if (typeof clause.ablation !== "string" || clause.ablation.trim().length === 0)
    problems.push(
      `${at} is PROVEN with no recorded ablation. A gate that runs is not a gate that would catch a ` +
      `defect; say which test goes red when the behaviour is removed, or mark it NOT-PROVEN`);

  // A NAMED GATE MUST BE A REAL THING. `src/core/index.js` once named
  // `test/construction-ingress.test.js` as what gated five checks, and that file did not exist —
  // this is that defect, gated.
  //
  // AND AT LEAST ONE MUST BE RESOLVABLE, which is this tool's own anti-vacuity check. The first
  // version only validated entries that LOOKED like paths, so `gates: ["the non-invocation test"]`
  // satisfied it completely — a gate that would have accepted prose as evidence, in the tool written
  // to stop prose being evidence. Found by reading its own output rather than by it failing.
  const resolvable = (clause.gates ?? []).filter((gate) => isFile(gate) || isScript(gate));
  if (resolvable.length === 0)
    problems.push(
      `${at} is PROVEN but none of its gates [${(clause.gates ?? []).join(", ")}] is a file that ` +
      `exists or an npm script; a description of a gate is not a gate`);
  for (const gate of clause.gates ?? [])
    if (PATH_LIKE.test(gate) && !isFile(gate))
      problems.push(`${at} names gate '${gate}', which does not exist`);
}

/** @type {Record<string, number>} */
const tally = {};
for (const clause of clauses) tally[clause.verdict] = (tally[clause.verdict] ?? 0) + 1;

console.log(`M8 acceptance clauses — ${clauses.length} total`);
for (const verdict of ["PROVEN", "NOT-PROVEN", "DEFERRED", "OUT-OF-SCOPE"])
  console.log(`  ${verdict.padEnd(12)} ${String(tally[verdict] ?? 0).padStart(3)}`);

// The tally the artifact CLAIMS is re-derived rather than trusted: a hand-edited header that drifts
// from its own rows is the same defect one layer up.
for (const [verdict, count] of Object.entries(ledger.tally ?? {}))
  if ((tally[verdict] ?? 0) !== count)
    problems.push(`the recorded tally says ${verdict} ${count}; the rows say ${tally[verdict] ?? 0}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("\nevery PROVEN clause names a gate that exists and an ablation that was performed.");
