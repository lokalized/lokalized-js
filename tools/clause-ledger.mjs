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

/**
 * EVERY MILESTONE'S LEDGER, not M8's alone.
 *
 * The first version hard-coded `measurements/m8-clauses.json` and the count 93, which was right
 * while M8 was the only milestone with a ledger and became a hazard the moment M9 needed one: a
 * second artifact would have been written, run by nothing, and believed. The list is declared here
 * rather than globbed so that a ledger going MISSING is a failure rather than a smaller tally —
 * the same reason the clause ids are checked for gaps below.
 *
 * `expected` is the milestone's own clause count, taken from its plan/scope document. A ledger that
 * silently covered forty of ninety-three would otherwise report a tidy table.
 */
const scripts = new Set(Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {}));

/** @type {string[]} */
const problems = [];
/** @type {string[]} */
const report = [];

const LEDGERS = [
  { milestone: "M8", file: "measurements/m8-clauses.json", expected: 93 },
  { milestone: "M9", file: "measurements/m9-clauses.json", expected: 34 },
  // M-D's sixteen are the plan row's own three obligations decomposed: four named quickstarts,
  // eleven named documentation topics, and the unfamiliar-reader acceptance condition. The row is
  // the clause set, so a row that grows an obligation grows this count — which is why
  // `lokalized-spec/scripts/documentation-topics.mjs` now FAILS on a sentence in that row it cannot
  // read, rather than extracting the ones it knows and leaving the rest invisible.
  { milestone: "M-D", file: "measurements/md-clauses.json", expected: 16 },
  // M-R's fourteen are plan :2927's own five sentences decomposed — sentence 3 alone states eight
  // things that "block release". Verdicted by agents who did not write the slices, because all
  // thirteen were one author's; M-D S30 recorded that as the independence a self-derived ledger
  // lacks, and then M-R accumulated the same debt one milestone on.
  { milestone: "M-R", file: "measurements/mr-clauses.json", expected: 14 },
];


/**
 * **A DEFERRAL IS A CLAIM, AND UNTIL M-D S20 NOTHING RE-DERIVED IT.**
 *
 * Every other list in this project fails on a stale entry — `coverage-dispositions`,
 * `BY_DESIGN_UNSUPPORTED`, `DECLARED_MESSAGE_DIVERGENCES`, `UNDELIVERED_CATEGORIES`, the construct-
 * and define-refusal tables. This tool enforced two real rules for a PROVEN clause and NOTHING for a
 * DEFERRED one: a verdict plus a sentence, re-read by nobody. That is this project's own "known-gap
 * lists rot" lesson sitting inside the instrument built to stop it, and it cost exactly what the
 * lesson predicts.
 *
 * **MEASURED: clause 51 had expired.** Its reason named M-D as the onward milestone — "documentation
 * for M-D, not code" — and M-D arrived three slices earlier. It was found by a hand audit of all
 * seventeen deferrals, which is the thing this block exists to stop being necessary. Had it carried
 * `untilMilestone: "M-D"`, this run would have failed the day M-D started.
 *
 * So a DEFERRED clause must now carry a FALSIFIABLE ground, of one of two kinds:
 *
 *   - `untilMilestone` — the onward milestone the work moves to. Fails the moment that milestone is
 *     current or past, which is the rule clause 51 needed.
 *   - `whileTrue` — the name of a predicate below, re-evaluated on every run. Fails when the fact the
 *     deferral rests on stops holding.
 *
 * A deferral with NEITHER fails: a ground nothing can falsify is an excuse, which is the sentence
 * this whole file is about.
 */
const MILESTONE_ORDER = [
  "M0", "M1", "M2", "M3a", "M3b", "M4", "M5a", "M5b", "M6", "M7", "M8", "M9", "M-D", "M-R",
];

/**
 * The milestone whose slices are being worked NOW. One deliberate edit when a milestone starts, and
 * every deferral aimed at it fails on the next run — which is the whole mechanism.
 */
// **M-R AS OF 2026-09-18, AND THE FLIP IS ITSELF THE FIRST SLICE OF IT.** Measured before it was
// made: changing this one line took `npm run verify` to exit 1 with THIRTEEN problems, one per clause
// deferred `untilMilestone: "M-R"` — M8 67-70, 79, 82-88 and M9 21. That is S21's mechanism working
// as built: a deferral is a promise with an expiry, and the expiry is now. All thirteen were
// re-verdicted NOT-PROVEN in the same change, each with an evidence line naming what it needs and
// which M-R-PLAN.md blocker holds it.
//
// **M-D IS NOT CLOSED, and this line must not be read as claiming it is.** Its one remaining clause
// is the acceptance condition — a person who does not know the implementation walking the quickstart
// — which no agent can discharge and which the maintainer owns. M-R work proceeds in parallel
// because plan 10.2's dependency is on M-D's DELIVERABLES, all of which shipped, rather than on that
// person's calendar.
const CURRENT_MILESTONE = "M-R";

/**
 * **THE CURRENT MILESTONE MUST HAVE A LEDGER, and this term exists because twice it did not.**
 *
 * M-D S30 found `LEDGERS` naming M8 and M9 while `CURRENT_MILESTONE` read "M-D", with nineteen
 * slices landed against obligations nothing had verdicted. It added M-D's ledger and did NOT add
 * the rule — so when the constant moved to "M-R" the same hole opened again, and thirteen more
 * slices accumulated before an assessment noticed. Twice is a pattern, and the repair for a
 * pattern is a term rather than a third correction.
 *
 * Retrospective proof is the only kind worth having here: with the M-R entry above removed, this
 * fails naming "M-R", which is exactly the state the repository was in this morning.
 */
if (!LEDGERS.some((ledger) => ledger.milestone === CURRENT_MILESTONE))
  problems.push(
    `CURRENT_MILESTONE is "${CURRENT_MILESTONE}" and LEDGERS declares no ledger for it, so every ` +
    `slice landing against that milestone's obligations is unverdicted. Derive its clauses from ` +
    `the plan's own row and add { milestone: "${CURRENT_MILESTONE}", file: ` +
    `"measurements/${CURRENT_MILESTONE.toLowerCase().replace("-", "")}-clauses.json", expected: N }.`);

const specDir = resolve(root, "..", "lokalized-spec");
/** A spec-repo artifact, or a loud failure. A predicate that cannot read its input has not held. */
function specJson(/** @type {string} */ relative) {
  const path = join(specDir, relative);
  if (!existsSync(path))
    throw new Error(
      `${relative} is not readable at ${path}. A deferral predicate cannot be evaluated without the ` +
      `sibling lokalized-spec checkout, and a predicate that cannot run has NOT been shown to hold. ` +
      `Clone lokalized-spec beside this repository.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The facts a deferral may rest on. Each returns true while the deferral still stands.
 *
 * Deliberately few and deliberately cheap. The point is not to model every reason a clause could be
 * deferred; it is that a reason nobody can falsify does not count as one.
 */
const DEFERRAL_GROUNDS = {
  // **`noPackedBrowserArtifact` WAS HERE AND IS DELETED, BY THIS FILE'S OWN RULE.** It grounded the
  // four clauses deferred on the packed browser build. When `CURRENT_MILESTONE` moved to "M-R" on
  // 2026-09-18 those four came due and were re-verdicted NOT-PROVEN, which left the ground consulted
  // by nothing — and the rule below fails an unconsulted ground as dead machinery, which is exactly
  // what it did on the first run after the flip. The fact it re-derived (no `dist/`, no build script)
  // now lives in the four clauses' evidence lines, where it is read rather than merely re-computed.
  // It goes back if something is ever deferred on it again.

  /**
   * A25: scenario 0b measures the PUBLISHED package served from a real host, so it cannot run
   * until there is one.
   *
   * **A GROUND THAT IS AN EVENT RATHER THAN A DATE OR A MILESTONE, and it re-derives.** A6 cut 0b
   * to M-R on the ground that no production host was named; A25 declines to name one today,
   * because a host chosen for an unpublished package produces exactly the stand-in figure 0b
   * exists to replace. The falsifiable fact is that nothing is published — read from the package's
   * own version, which is the same field the first publish must change.
   *
   * It fails the moment the version leaves 0.0.0, which is when 0b becomes runnable and these
   * clauses come due. That is the point: the deferral expires on the event it waits for.
   */
  packageUnpublished: () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return pkg.version === "0.0.0";
  },

  /** D4/D5: evidence closure has no reviewed requirement to attach to. */
  registryAllUnreviewed: () => {
    const registry = specJson("pre-m0/bootstrap.requirements.candidate.json");
    const rows = Array.isArray(registry) ? registry : (registry.requirements ?? registry.rows ?? []);
    return rows.length > 0 && rows.every((/** @type {any} */ row) => row.reviewStatus === "unreviewed");
  },

  /** D4/D5, the other half: with no requirementId on any case, closure would have no edges. */
  corpusCarriesNoRequirementIds: () => {
    const corpus = specJson("generated/behavioral-vectors.json");
    return corpus.cases.length > 0 &&
      corpus.cases.every((/** @type {any} */ testCase) => (testCase.requirementIds ?? []).length === 0);
  },

  /** M9 blocker 2: the IANA closure is pinned to a JDK build, not to a registry release. */
  // **`ianaRegistryAxisAbsent` WAS HERE AND IS DELETED, BY THIS FILE'S OWN RULE.** It grounded M9
  // clause 33's deferral: no registry snapshot, no File-Date, no override rows. M-R S11 pinned the
  // snapshot and recorded 156 overrides, the predicate went false on the next run and named the
  // clause, and clause 33 was re-verdicted NOT-PROVEN — which left this ground consulted by
  // nothing, and the rule below fails an unconsulted ground as dead machinery. That is the second
  // time this has happened (see `noPackedBrowserArtifact` above), and both times the sequence was
  // the same: the ground fires, the clause moves, the ground retires. The fact it re-derived now
  // lives in clause 33's evidence line, where it is read rather than merely re-computed.

};

if (!MILESTONE_ORDER.includes(CURRENT_MILESTONE))
  problems.push(`CURRENT_MILESTONE ${JSON.stringify(CURRENT_MILESTONE)} is not in MILESTONE_ORDER`);

/** Milestones that have already started, so a deferral aimed at one of them has expired. */
const arrived = new Set(MILESTONE_ORDER.slice(0, MILESTONE_ORDER.indexOf(CURRENT_MILESTONE) + 1));
/** Grounds an actual clause consulted, so dead machinery is visible. */
const consultedGrounds = new Set();

/** A bare path: no spaces, and a source-file extension. Prose mentioning a path is not a path. */
const PATH_LIKE = /^[\w./-]+\.(?:js|mjs|json)$/;
const isFile = (/** @type {string} */ gate) => PATH_LIKE.test(gate) && existsSync(join(root, gate));
const isScript = (/** @type {string} */ gate) => scripts.has(gate.replace(/^npm run /, ""));
const VERDICTS = new Set(["PROVEN", "NOT-PROVEN", "DEFERRED", "OUT-OF-SCOPE"]);

for (const { milestone, file, expected } of LEDGERS) {
  if (!existsSync(join(root, file))) {
    problems.push(`${milestone}: ${file} does not exist. A declared ledger that is missing is a ` +
      `failure, not a smaller tally.`);
    continue;
  }
  const ledger = JSON.parse(readFileSync(join(root, file), "utf8"));
  const clauses = ledger.clauses ?? [];

  if (ledger.milestone !== milestone)
    problems.push(`${file} declares milestone ${JSON.stringify(ledger.milestone)}, not ${milestone}`);

  // The clause set is the PLAN's, so a row appearing or vanishing is a defect rather than an edit.
  const ids = clauses.map((/** @type {any} */ clause) => clause.id);
  if (clauses.length !== expected)
    problems.push(`${milestone}: the ledger carries ${clauses.length} clauses; ${milestone} has ${expected}`);
  for (let id = 1; id <= expected; ++id)
    if (!ids.includes(id)) problems.push(`${milestone}: clause ${id} is missing from the ledger`);

  for (const clause of clauses) {
    const at = `${milestone} clause ${clause.id}`;
    if (!VERDICTS.has(clause.verdict)) {
      problems.push(`${at}: unknown verdict ${JSON.stringify(clause.verdict)}`);
      continue;
    }
    if (typeof clause.statement !== "string" || clause.statement.trim().length === 0)
      problems.push(`${at}: no statement`);
    if (typeof clause.evidenceLine !== "string" || clause.evidenceLine.trim().length === 0)
      problems.push(`${at}: no evidence line; every verdict must say what it rests on`);

    if (clause.verdict === "DEFERRED") {
      const ground = clause.deferral ?? {};
      const until = ground.untilMilestone;
      const whileTrue = ground.whileTrue;

      if (until === undefined && whileTrue === undefined) {
        problems.push(
          `${at} is DEFERRED with no falsifiable ground. Give it an \`untilMilestone\` (the onward ` +
          `milestone the work moves to) or a \`whileTrue\` (a named predicate in DEFERRAL_GROUNDS); ` +
          `a reason nothing can falsify is an excuse, which is what this tool exists to refuse.`);
      }

      if (until !== undefined) {
        if (!MILESTONE_ORDER.includes(until))
          problems.push(`${at} defers until ${JSON.stringify(until)}, which is not a known milestone`);
        else if (arrived.has(until))
          problems.push(
            `${at} is DEFERRED until ${until}, and ${until} has arrived (current: ${CURRENT_MILESTONE}). ` +
            `Re-verdict it, or move the deferral onward and say why in the evidence line.`);
      }

      if (whileTrue !== undefined) {
        const predicate = DEFERRAL_GROUNDS[whileTrue];
        if (typeof predicate !== "function") {
          // The same rule the gate column already has: a NAME is not a check.
          problems.push(`${at} defers while ${JSON.stringify(whileTrue)}, which is not a predicate in DEFERRAL_GROUNDS`);
        } else {
          consultedGrounds.add(whileTrue);
          // A predicate that THROWS is reported as a problem rather than left to crash the run. A
          // missing sibling checkout is the likely cause and the message says so — but a stack trace
          // reads as a broken tool, and this project has twice mistaken one for a catastrophic
          // regression. It is still a FAILURE: a predicate that cannot run has not been shown to hold.
          let holds;
          try {
            holds = predicate();
          } catch (error) {
            problems.push(`${at} defers while ${whileTrue}, which could not be evaluated: ${/** @type {Error} */ (error).message}`);
            continue;
          }
          if (!holds)
            problems.push(
              `${at} is DEFERRED while ${whileTrue}, and that is no longer true. The ground the ` +
              `deferral rests on has gone; re-verdict the clause.`);
        }
      }
      continue;
    }

    // A NAMED GATE MUST RESOLVE WHATEVER THE VERDICT, and this is checked BEFORE the PROVEN filter
    // below. MEASURED 2026-09-17: two M-D clauses named
    // `lokalized-spec/scripts/documentation-topics.mjs`, which resolves from nowhere — paths here are
    // relative to this repository and the spec is a SIBLING — and the ledger was green, because gates
    // were validated for PROVEN clauses only. It surfaced the moment one of the two was upgraded, by
    // which time the wrong path had been sitting in the record for a slice. A gate that cannot be
    // opened is wrong while the clause is open too; that is when somebody is most likely to go
    // looking for it.
    for (const gate of clause.gates ?? [])
      if (PATH_LIKE.test(gate) && !isFile(gate))
        problems.push(`${at} names gate '${gate}', which does not exist`);

    if (clause.verdict !== "PROVEN") continue;

    // THE RULE THIS TOOL EXISTS FOR.
    if (!Array.isArray(clause.gates) || clause.gates.length === 0)
      problems.push(`${at} is PROVEN with no named gate`);
    if (typeof clause.ablation !== "string" || clause.ablation.trim().length === 0)
      problems.push(
        `${at} is PROVEN with no recorded ablation. A gate that runs is not a gate that would catch ` +
        `a defect; say which test goes red when the behaviour is removed, or mark it NOT-PROVEN`);

    // A NAMED GATE MUST BE A REAL THING — checked above, for every verdict. `src/core/index.js`
    // once named `test/construction-ingress.test.js` as what gated five checks, and that file did
    // not exist; this is that defect, gated.
    //
    // AND AT LEAST ONE MUST BE RESOLVABLE, which is this tool's own anti-vacuity check. The first
    // version only validated entries that LOOKED like paths, so `gates: ["the non-invocation test"]`
    // satisfied it completely — a gate that would have accepted prose as evidence, in the tool
    // written to stop prose being evidence. Found by reading its own output rather than by it failing.
    const resolvable = (clause.gates ?? []).filter(
      (/** @type {string} */ gate) => isFile(gate) || isScript(gate));
    if (resolvable.length === 0)
      problems.push(
        `${at} is PROVEN but none of its gates [${(clause.gates ?? []).join(", ")}] is a file that ` +
        `exists or an npm script; a description of a gate is not a gate`);
  }

  /** @type {Record<string, number>} */
  const tally = {};
  for (const clause of clauses) tally[clause.verdict] = (tally[clause.verdict] ?? 0) + 1;

  report.push(`${milestone} acceptance clauses — ${clauses.length} total`);
  for (const verdict of ["PROVEN", "NOT-PROVEN", "DEFERRED", "OUT-OF-SCOPE"])
    report.push(`  ${verdict.padEnd(12)} ${String(tally[verdict] ?? 0).padStart(3)}`);

  // The tally the artifact CLAIMS is re-derived rather than trusted: a hand-edited header that
  // drifts from its own rows is the same defect one layer up.
  for (const [verdict, count] of Object.entries(ledger.tally ?? {}))
    if ((tally[verdict] ?? 0) !== count)
      problems.push(`${milestone}: the recorded tally says ${verdict} ${count}; the rows say ${tally[verdict] ?? 0}`);
}

// Dead machinery is a defect here too: a predicate no clause consults is a rule nobody is subject to.
for (const name of Object.keys(DEFERRAL_GROUNDS))
  if (!consultedGrounds.has(name))
    problems.push(`DEFERRAL_GROUNDS.${name} is consulted by no clause; delete it or attach it`);
if (consultedGrounds.size === 0)
  problems.push("no deferral consults a predicate, so DEFERRAL_GROUNDS is inert");

report.push("");
report.push(`deferrals: current milestone ${CURRENT_MILESTONE}; ` +
  `${consultedGrounds.size} of ${Object.keys(DEFERRAL_GROUNDS).length} ground(s) consulted and holding`);

for (const line of report) console.log(line);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("\nevery PROVEN clause names a gate that exists and an ablation that was performed,\nand every DEFERRED clause rests on a ground this run re-derived.");
