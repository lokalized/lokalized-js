#!/usr/bin/env node
// @ts-check
/**
 * EVERY CODE SAMPLE IN `README.md` IS EXECUTED, AND EVERY OUTPUT IT CLAIMS IS ASSERTED.
 *
 * **WHY THIS EXISTS, in one sentence: a README is the largest prose surface this project has, and
 * prose asserting its own correctness is the defect class it has caught fourteen times.** A comment
 * naming a test file that did not exist; an allowlist generator whose comment said "recorded
 * verbatim" while its code deleted the names; a conformance runner claiming a review of 35 cases
 * over a table holding 4. Each was written in good faith and each was wrong the moment the code
 * moved. A README full of hand-written snippets is that failure mode with a public audience.
 *
 * Writing the samples taught the same lesson twice before this tool existed. A draft passed
 * `"GENDER_FEMININE"` as a string, which is not the tagged constant the resolver wants — the sample
 * rendered the KEY back and nothing but running it would have said so. A second draft destructured
 * `readStringsFromDirectory`'s return as a catalog map when it returns `{ catalogs, warnings }`, and
 * a third hit a real construction refusal for undeclared tiebreakers. All three are now in the
 * README *because* they were measured, and the third is documented as a feature.
 *
 * THE CONVENTION, which keeps the README readable:
 *
 *   <!-- example: cart -->        marks the next ```js block as part of the group `cart`
 *   expression;   // => <JSON>    asserts the expression deep-equals that JSON
 *   expression;
 *   // => <JSON>                  the same, when the line would be too long
 *
 * Blocks sharing a group name are concatenated in document order into ONE module, so a later block
 * may use a binding an earlier one declared — which is what lets a walkthrough read as a walkthrough
 * instead of repeating its setup. A ```js block with no preceding marker is NOT executed and is
 * reported, so an un-run sample is a visible decision rather than an oversight.
 *
 * THREE ANTI-VACUITY TERMS, because a checker that silently finds nothing is worse than none:
 * no groups, no assertions, or a `// =>` with no expression in front of it each fail the run.
 *
 * **A SAMPLE MAY NOT LEAVE ANYTHING IN THE TEMP FOLDER.** Each group runs with its own private temp
 * folder and fails, named, if an entry is left there (`tools/temp-hygiene.mjs` decides what counts).
 * A reader copies these samples. MEASURED 2026-09-23: `csp-dual` made a `lokalized-second-*` copy of
 * the package and never removed it — once per run of this check and once per `check:readme:packed`,
 * 632 of them in this machine's temp folder — and every gate here was green.
 *
 * **AND THE LIMIT, MEASURED THE DAY AFTER THIS SHIPPED: THIS GATE DOES NOT CHECK PROSE.** The first
 * README went out with two false sentences, both OUTSIDE any code block and therefore invisible
 * here: it said the root exports constants across ELEVEN axes (there are ten — `Object.values` of
 * the namespace filtered by `$lokalized` gives 61 forms over 10 distinct `axis` values), and it told
 * a reader to pass `{ onFailure: THROW_EXCEPTION }`, which is a `TypeError` because `onFailure` must
 * be a FUNCTION and `THROW_EXCEPTION` is a value a handler RETURNS. Six agents re-deriving the
 * remaining sections by running the library found both.
 *
 * The repair is not a cleverer checker — a general "is this sentence true" gate does not exist. It
 * is to move every checkable claim INTO a block: the axis count is now derived by a sample that
 * counts them, and the failure-handling shapes are now three executed calls. **A claim that can be
 * executed and is left in prose is a claim nothing checks**, and that is the rule this file exists
 * to enforce, one level up from where it started.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleFor, parseReadme } from "./readme-blocks.mjs";
import { leftoversIn, temporaryEnvironment } from "./temp-hygiene.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(root, "README.md");
const { groups, htmlModules, catalogs, unmarkedBlocks, problems } = parseReadme(readFileSync(readmePath, "utf8"));

let totalAssertions = 0;

const work = mkdtempSync(join(tmpdir(), "lokalized-readme-"));
/** @type {string[]} */
const ran = [];
try {
  for (const [name, group] of groups) {
    totalAssertions += group.assertions;
    // Written INSIDE the repo so `import "lokalized"` resolves through the package's own exports,
    // which is the resolution a reader gets and therefore the one worth testing.
    const file = join(root, `.readme-example-${name}.mjs`);
    writeFileSync(file, moduleFor(group));
    const temporary = join(work, name);
    mkdirSync(temporary);
    try {
      const out = execFileSync(process.execPath, [file],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: temporaryEnvironment(temporary) });
      ran.push(`  ok    ${name.padEnd(14)} ${out.trim()} assertion(s)`);
    } catch (error) {
      const detail = /** @type {{ stderr?: string, stdout?: string }} */ (error);
      problems.push(`example '${name}' failed:\n${(detail.stderr ?? detail.stdout ?? "").trim().split("\n").slice(0, 12).map((l) => `      ${l}`).join("\n")}`);
    } finally {
      rmSync(file, { force: true });
    }
    const left = leftoversIn(temporary);
    if (left.length > 0)
      problems.push(`example '${name}' left ${left.join(", ")} in the temp folder; a sample a reader copies must remove what it creates`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`README examples — ${groups.size} group(s), ${totalAssertions} asserted output(s)`);
for (const line of ran) console.log(line);
if (unmarkedBlocks > 0)
  console.log(`  ${unmarkedBlocks} fenced block(s) carry no <!-- example: … --> marker and were NOT run`);
if (catalogs.size > 0)
  console.log(`  ${catalogs.size} catalog file(s) published for readers — executed by \`npm run check:readme:packed\``);
for (const [name, dropped] of htmlModules)
  console.log(`  '${name}' is a browser sample: its <script type="module"> ran with ${dropped} ` +
    `host-only statement(s) dropped`);

// THE ANTI-VACUITY TERMS. A checker that finds nothing must say so rather than exit 0.
if (groups.size === 0) problems.push("no example groups found — every README sample is unexecuted");
if (totalAssertions === 0) problems.push("no '// =>' expectations found — the samples run but claim nothing");

// AND THE TERMS ABOVE ARE GLOBAL, WHICH MEASURABLY IS NOT ENOUGH. They ask whether ANYTHING runs, so
// the document can lose a whole sample and stay green: MEASURED 2026-09-17, un-marking the two
// `alternatives` blocks takes this run from 51 groups / 289 outputs to 50 / 285, leaves
// `test/readme-topics.test.js` green as well, and reports the loss only in the un-gated
// "N fenced block(s) … were NOT run" line. That is the same shape as the security section a previous
// slice measured could be deleted entirely at exit 0.
//
// So the executed surface has FLOORS, at today's count, in the house style — not exact equality,
// because growing the document must stay free. Raising them is a one-line deliberate edit; a sample
// that silently stops being executed is not.
const MINIMUM_GROUPS = 53;
const MINIMUM_ASSERTIONS = 305;
// RAISED FROM 1 TO 3 BY M-R S9, deliberately and with the three named. The browser section now
// documents three routes, and two of its blocks cannot be ```js samples: the two ```html import
// maps are JSON-in-HTML with no module body to run, and the classic-`<script src>` block is not a
// module at all, so `readme-blocks.mjs`'s marked-html arm — which requires a
// `<script type="module">` — cannot execute it. The classic-script block is NOT left unchecked:
// `test/browser-global.test.js` extracts it from this README and runs it against a real build of
// `dist/browser/lokalized.global.js` in a browser-shaped sandbox.
const MAXIMUM_UNMARKED = 3;
if (groups.size < MINIMUM_GROUPS)
  problems.push(`${groups.size} executed group(s), and this README had ${MINIMUM_GROUPS}. A sample ` +
    `stopped being executed; if that was deliberate, lower MINIMUM_GROUPS and say why`);
if (totalAssertions < MINIMUM_ASSERTIONS)
  problems.push(`${totalAssertions} asserted output(s), and this README had ${MINIMUM_ASSERTIONS}. ` +
    `Claims stopped being checked; if that was deliberate, lower MINIMUM_ASSERTIONS and say why`);
if (unmarkedBlocks > MAXIMUM_UNMARKED)
  problems.push(`${unmarkedBlocks} fenced block(s) carry no marker, and this README had ` +
    `${MAXIMUM_UNMARKED}. A sample nothing runs is the state M-D exists to end — mark it, or raise ` +
    `MAXIMUM_UNMARKED deliberately and say what the new one is`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("\nevery executed sample produced exactly what the README says it produces.");
