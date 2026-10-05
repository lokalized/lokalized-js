#!/usr/bin/env node
// @ts-check
/**
 * Turns a failed `npm test` log into GitHub error annotations. CI only.
 *
 * **WHY.** A job's log can only be downloaded by a signed-in GitHub account, and the agents working
 * on this repository have none: twice in a row a unit-test step failed on one Node leg and all
 * anybody outside the browser could see was "Process completed with exit code 1". Annotations are
 * different: the check-runs annotations API answers without a login for a public repository. So
 * each failing test becomes one `::error::` line carrying its name, its location and the first
 * lines of its error. The log itself is unchanged, and this adds nothing when the tests pass.
 *
 * It reads TAP, which is why CI passes `--test-reporter=tap` on every Node leg: Node 20 and 22 print
 * TAP when stdout is not a terminal and later versions do not, and one format is one parser. A
 * failing test's `not ok` line is followed by a YAML block holding `location` and `error`. A parent
 * whose only failure is a failing child reports "N subtests failed", which says nothing, so those
 * are skipped in favour of the child. If the run crashed before TAP could name anything, the last
 * lines of the log are annotated instead, and the temp-hygiene wrapper's leftover report is
 * annotated whenever it appears, because that fails the step with every test passing.
 *
 * GitHub keeps ten error annotations per step, so at most nine tests are named and a tenth says how
 * many more there were.
 *
 *   node tools/annotate-test-failures.mjs <test.log>
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_TESTS = 9;

/**
 * @param {string} log
 * @returns {string[]} one message per annotation, unescaped
 */
export function failureAnnotations(log) {
  const lines = log.split("\n");
  /** @type {string[]} */
  const failures = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)not ok \d+ - (.*)$/.exec(lines[i]);
    if (!head) continue;
    const indent = head[1];
    // The YAML block sits between `---` and `...`, indented two more spaces than the `not ok`.
    /** @type {string[]} */
    const block = [];
    if (lines[i + 1]?.trim() === "---") {
      for (let j = i + 2; j < lines.length && lines[j].trim() !== "..."; j++) block.push(lines[j]);
    }
    const location = block.map((l) => /^\s*location: '?(.*?)'?$/.exec(l)?.[1]).find(Boolean) ?? "";
    const error = errorText(block);
    if (/^\d+ subtests? failed$/.test(error)) continue;
    const where = location.replace(/^.*?\/(test|tools|src)\//, "$1/");
    failures.push(`${indent.length > 0 ? "(subtest) " : ""}${head[2]}${where ? ` [${where}]` : ""}: ${error || "(no error text)"}`);
  }
  /** @type {string[]} */
  const out = failures.slice(0, MAX_TESTS);
  if (failures.length > MAX_TESTS) out.push(`…and ${failures.length - MAX_TESTS} more failing test(s); see the log`);
  // The wrapper's leftover report: its headline, then one indented line per entry left behind.
  const at = lines.findIndex((l) => /^temp hygiene: .* left \d+/.test(l));
  if (at !== -1) {
    const names = [];
    for (let k = at + 1; k < lines.length && /^ {2}\S/.test(lines[k]) && names.length < 5; k++) names.push(lines[k].trim());
    out.push([lines[at], ...names].join("\n"));
  }
  if (out.length === 0) out.push(`no failing test was reported; the log ends:\n${lines.filter((l) => l.trim()).slice(-8).join("\n")}`);
  return out;
}

/** The `error:` value of a TAP YAML block — a quoted scalar or a `|-` block — cut to six lines. */
function errorText(/** @type {string[]} */ block) {
  const at = block.findIndex((l) => /^\s*error: /.test(l));
  if (at === -1) return "";
  const first = block[at].replace(/^\s*error: /, "");
  /** @type {string[]} */
  let text;
  if (/^[|>]-?$/.test(first)) {
    const indent = /^(\s*)/.exec(block[at])?.[1].length ?? 0;
    text = [];
    for (let k = at + 1; k < block.length && (/^\s*$/.test(block[k]) || (/^(\s*)/.exec(block[k])?.[1].length ?? 0) > indent); k++)
      text.push(block[k].trim());
  } else text = [first.replace(/^'(.*)'$/, "$1").replace(/''/g, "'").replace(/^"(.*)"$/, "$1")];
  return text.filter(Boolean).slice(0, 6).join("\n");
}

/** GitHub's workflow-command escaping for an annotation message. */
export const escapeMessage = (/** @type {string} */ text) =>
  text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path] = process.argv.slice(2);
  if (!path) { console.error("usage: node tools/annotate-test-failures.mjs <test.log>"); process.exit(2); }
  for (const message of failureAnnotations(readFileSync(path, "utf8")))
    console.log(`::error title=Unit tests::${escapeMessage(message)}`);
}
