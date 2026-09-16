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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(root, "README.md");
const source = readFileSync(readmePath, "utf8");
const lines = source.split("\n");

/** @type {Map<string, { code: string[], assertions: number }>} */
const groups = new Map();
/** @type {string[]} */
const problems = [];
/** Blocks with no `<!-- example: … -->` marker — reported, never silently skipped. */
let unmarkedBlocks = 0;
let totalAssertions = 0;

/** `expr;  // => JSON` and a lone `// => JSON`. */
const INLINE = /^(?<expr>.*?;)\s*\/\/\s*=>\s*(?<want>.+)$/;
const LONE = /^\s*\/\/\s*=>\s*(?<want>.+)$/;

/** @type {string | null} */
let pending = null;
for (let index = 0; index < lines.length; ++index) {
  const line = /** @type {string} */ (lines[index]);
  const marker = /^<!--\s*example:\s*([A-Za-z0-9_-]+)\s*-->\s*$/.exec(line);
  if (marker) { pending = /** @type {string} */ (marker[1]); continue; }
  if (!/^```js\s*$/.test(line)) continue;

  const start = index + 1;
  let end = start;
  while (end < lines.length && !/^```\s*$/.test(/** @type {string} */ (lines[end]))) ++end;
  const body = lines.slice(start, end);
  index = end;

  if (pending === null) { unmarkedBlocks++; continue; }
  const name = pending;
  pending = null;

  if (!groups.has(name)) groups.set(name, { code: [], assertions: 0 });
  const group = /** @type {{ code: string[], assertions: number }} */ (groups.get(name));
  group.code.push(`// --- README line ${start} ---`);

  for (let offset = 0; offset < body.length; ++offset) {
    const text = /** @type {string} */ (body[offset]);
    const inline = INLINE.exec(text);
    if (inline?.groups) {
      group.code.push(expect(inline.groups.expr ?? "", inline.groups.want ?? "", start + offset + 1, name));
      group.assertions++;
      continue;
    }
    const lone = LONE.exec(text);
    if (lone?.groups) {
      // THE EXPRESSION IS THE PREVIOUS EMITTED LINE, and it must exist. A `// =>` floating free
      // would otherwise assert nothing while looking exactly like an assertion.
      const previous = group.code.pop();
      if (previous === undefined || !/;\s*$/.test(previous) || previous.startsWith("//")) {
        problems.push(`README:${start + offset + 1}: a '// =>' comment with no single-line ` +
          `expression before it. Put the expression and its expectation on one line, or end the ` +
          `expression with ';' on the line above.`);
        if (previous !== undefined) group.code.push(previous);
        continue;
      }
      group.code.push(expect(previous, lone.groups.want ?? "", start + offset + 1, name));
      group.assertions++;
      continue;
    }
    group.code.push(text);
  }
}

/**
 * @param {string} expr @param {string} want @param {number} line @param {string} name
 */
function expect(expr, want, line, name) {
  const trimmed = expr.trim().replace(/;$/, "");
  return `__expect(${trimmed}, ${want.trim()}, ${JSON.stringify(`${name} (README:${line})`)});`;
}

const PREAMBLE = `import { deepStrictEqual } from "node:assert/strict";
let __checked = 0;
const __expect = (actual, expected, where) => { deepStrictEqual(actual, expected, where); ++__checked; };
`;

const work = mkdtempSync(join(tmpdir(), "lokalized-readme-"));
/** @type {string[]} */
const ran = [];
try {
  for (const [name, group] of groups) {
    totalAssertions += group.assertions;
    // Written INSIDE the repo so `import "lokalized"` resolves through the package's own exports,
    // which is the resolution a reader gets and therefore the one worth testing.
    const file = join(root, `.readme-example-${name}.mjs`);
    writeFileSync(file, `${PREAMBLE}${group.code.join("\n")}\nprocess.stdout.write(String(__checked));\n`);
    try {
      const out = execFileSync(process.execPath, [file], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      ran.push(`  ok    ${name.padEnd(14)} ${out.trim()} assertion(s)`);
    } catch (error) {
      const detail = /** @type {{ stderr?: string, stdout?: string }} */ (error);
      problems.push(`example '${name}' failed:\n${(detail.stderr ?? detail.stdout ?? "").trim().split("\n").slice(0, 12).map((l) => `      ${l}`).join("\n")}`);
    } finally {
      rmSync(file, { force: true });
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`README examples — ${groups.size} group(s), ${totalAssertions} asserted output(s)`);
for (const line of ran) console.log(line);
if (unmarkedBlocks > 0)
  console.log(`  ${unmarkedBlocks} \`\`\`js block(s) carry no <!-- example: … --> marker and were NOT run`);

// THE ANTI-VACUITY TERMS. A checker that finds nothing must say so rather than exit 0.
if (groups.size === 0) problems.push("no example groups found — every README sample is unexecuted");
if (totalAssertions === 0) problems.push("no '// =>' expectations found — the samples run but claim nothing");

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("\nevery executed sample produced exactly what the README says it produces.");
