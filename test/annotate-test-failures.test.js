// @ts-check
/**
 * CI's unit-test step turns a failure into annotations, because annotations can be read without a
 * GitHub login and a job's log cannot (see tools/annotate-test-failures.mjs). This checks the
 * annotator against REAL TAP from a run that fails, and that the workflow still wires it in: an
 * annotator nothing calls, or a step that stops asking for TAP, would leave every future failure
 * anonymous again without turning anything red.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { escapeMessage, failureAnnotations } from "../tools/annotate-test-failures.mjs";
import { child, parseWorkflow, stepsOf } from "../tools/workflow-yaml.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "lokalized-annotate-"));
after(() => rmSync(work, { recursive: true, force: true }));

writeFileSync(join(work, "sample.test.mjs"), `import test from "node:test";
import assert from "node:assert/strict";
test("passes", () => {});
test("fails with a message", () => { assert.equal(1, 2, "one is not two"); });
test("parent", async (t) => {
  await t.test("child passes", () => {});
  await t.test("child fails", () => { throw new Error("child broke\\nsecond line"); });
});
`);

/** A real TAP log from a run with two failures, one of them a subtest. */
function realTap() {
  // NODE_TEST_CONTEXT is set for the file this runs in, and a child `node --test` that inherits it
  // reports in the runner's internal protocol instead of TAP.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "sample.test.mjs"],
    { cwd: work, encoding: "utf8", env });
  assert.equal(run.status, 1, `the sample run must fail\n${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /^TAP version/m, "the sample run did not print TAP");
  return run.stdout + run.stderr;
}

test("each failing test is named with its location and error; an aggregating parent is not", () => {
  const annotations = failureAnnotations(realTap());
  assert.equal(annotations.length, 2, annotations.join("\n---\n"));
  assert.match(annotations[0], /^fails with a message \[.*sample\.test\.mjs:4:1\]: one is not two/);
  assert.match(annotations[1], /^\(subtest\) child fails \[.*sample\.test\.mjs:7:\d+\]: child broke\nsecond line/);
  assert.ok(!annotations.some((a) => /subtests? failed/.test(a)), "the parent's '1 subtest failed' says nothing and must not take a slot");
});

test("a run whose tests all pass but whose wrapper found leftovers still names the cause", () => {
  // The wrapper's own wording (tools/temp-hygiene.mjs): a headline, one indented line per entry,
  // then advice. The entries are what say which test leaked.
  const log = "TAP version 13\nok 1 - passes\n# pass 1\n# fail 0\n\n" +
    "temp hygiene: `node --test` left 2 entries in its private temp folder:\n  lokalized-x-1\n  lokalized-y-2\n" +
    "Whatever made them must remove what it creates: an `after`/`t.after` hook in a test.\n";
  assert.deepEqual(failureAnnotations(log),
    ["temp hygiene: `node --test` left 2 entries in its private temp folder:\nlokalized-x-1\nlokalized-y-2"]);
});

test("a run that crashed before TAP named anything reports the end of the log", () => {
  const [only, ...rest] = failureAnnotations("npm error code 1\nSyntaxError: Unexpected token\n    at x.mjs:1\n");
  assert.equal(rest.length, 0);
  assert.match(only, /^no failing test was reported; the log ends:\n.*SyntaxError: Unexpected token/s);
});

test("at most ten annotations, the tenth counting the rest", () => {
  const log = Array.from({ length: 12 }, (_, i) =>
    `not ok ${i + 1} - t${i}\n  ---\n  location: '/w/test/a.test.js:${i + 1}:1'\n  error: 'boom ${i}'\n  ...`).join("\n");
  const annotations = failureAnnotations(log);
  assert.equal(annotations.length, 10);
  assert.equal(annotations[8], "t8 [test/a.test.js:9:1]: boom 8");
  assert.equal(annotations[9], "…and 3 more failing test(s); see the log");
});

test("messages are escaped the way GitHub's workflow commands require", () => {
  assert.equal(escapeMessage("50% of\r\nlines"), "50%25 of%0D%0Alines");
});

test("CI's unit-test step asks for TAP and annotates a failure", () => {
  const PATH = ".github/workflows/ci.yml";
  const tree = parseWorkflow(readFileSync(join(root, PATH), "utf8"), PATH);
  const bodies = stepsOf(tree, "verify").map((s) => child(s, "run")?.block ?? child(s, "run")?.value ?? "");
  const unit = bodies.find((b) => /\bnpm test\b/.test(b));
  assert.ok(unit, "no step in the verify job runs npm test");
  assert.match(unit, /npm test -- --test-reporter=tap\b/, "without TAP on every leg the annotator reads nothing on Node 24 and later");
  // The step's shell is `bash -e`: a failing command followed by `; status=$?` ends the step before
  // the log is printed or annotated, which is how two failures went unreadable.
  assert.match(unit, /npm test [^\n]*\|\| status=\$\?/, "the tests' status must be captured with `|| status=$?` under bash -e");
  assert.doesNotMatch(unit, /npm test [^\n|]*; status=\$\?/, "`; status=$?` never runs under bash -e when the tests fail");
  assert.match(unit, /node tools\/annotate-test-failures\.mjs test\.log/, "a failing run no longer annotates its failures");
  assert.match(unit, /annotate-test-failures\.mjs test\.log \|\| true\n\s*exit "\$status"/,
    "the annotator must run before the step exits with the tests' own status, and must not replace it");
});
