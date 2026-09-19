// @ts-check
/**
 * `npm run verify` AND THE CI JOB THAT MIRRORS IT, COMPARED — the drift this repository has recorded
 * THREE TIMES and never gated.
 *
 * The workflow's own comment says it: "THE STEPS BELOW MIRROR `npm run verify`, IN ITS ORDER, AND THE
 * LIST IS LOAD-BEARING … they DRIFTED: `size:graph`, `likely-subtag-consumers` and
 * `spike:placeholders` were all in `verify` and in none of these steps, so they executed on the
 * authoring machine and nowhere else. If a step is added to `verify`, add it here." That sentence has
 * been true and unenforced since it was written. M9 S1 found the SECOND drift — `npm run declarations`
 * and `npm run diff:check`, the only consumer-facing TypeScript channel and the differential record
 * gate, in `verify` and in neither CI list — and noted that `check:examples` "would have been the
 * fourth".
 *
 * A comment asking a human to remember is not a mechanism. This is, and it is two rules:
 *
 * 1. every step `verify` runs is a step the CI job runs, and every step the CI job runs is one
 *    `verify` runs — a gate CI runs and `verify` does not is the same drift facing the other way;
 * 2. in the SAME ORDER, because the order is behaviour rather than style: `npm run types` emits the
 *    declarations that `declarations`, `check:readonly` and the surface tests then read, so a CI job
 *    that ran them first would be asking about the previous build.
 *
 * The one deliberate difference is the unit-test step, which CI wraps to assert that nothing SKIPPED
 * — an assertion `verify` has no way to make, and the reason this job does not simply call
 * `npm run verify`. It is still `npm test`, so it compares equal here.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

/**
 * Steps that run in one list and deliberately not the other, each with the reason. An entry naming a
 * step that is in both, or in neither, FAILS — the shape every declared-exception table in this
 * repository has to have, or it rots into a list of excuses.
 *
 * @type {{ step: string, side: "verify-only" | "ci-only", why: string }[]}
 */
const DECLARED_EXCEPTIONS = [];

/** `npm run verify`'s own list, in order. `npm test` is spelled without `run`. */
const verifySteps = (() => {
  const script = manifest.scripts.verify;
  assert.ok(script, "package.json has no `verify` script");
  return script
    .split("&&")
    .map((part) => part.trim())
    .map((part) => (part === "npm test" ? "npm test" : /^npm run ([\w:-]+)$/.exec(part)?.[1] ?? null))
    .map((name, index) => {
      assert.ok(name !== null, `verify's step ${index + 1} is not a plain \`npm run <name>\``);
      return name;
    });
})();

/**
 * The CI `verify` job's list, in order, taken from the job's own text rather than from a YAML parse:
 * the package has no dependencies and may not grow one for a test.
 *
 * **A STEP WITH ITS OWN `working-directory` IS A DIFFERENT PACKAGE'S GATE AND IS NOT COMPARED.** The
 * job's last step runs five `lokalized-spec` scripts — `check:snapshot` and its siblings — which are
 * scripts of the sibling repository, not of this one, and `npm run verify` here has no business
 * calling them. The first run of this file reported `check:snapshot` as "run by CI and not by
 * verify", which was the parser reading another package's script list as this one's.
 */
const ciSteps = (() => {
  const start = workflow.indexOf("\n  verify:");
  assert.notEqual(start, -1, "ci.yml has no `verify` job");
  const after = workflow.indexOf("\n  packed:", start);
  const body = workflow.slice(start, after === -1 ? undefined : after);
  const steps = body.split(/\n {6}- /).slice(1);
  const ours = steps.filter((step) => !/^\s*working-directory:/m.test(step));
  assert.ok(steps.length > ours.length,
    "no CI step declares a `working-directory`, so this filter is inert and the spec-repo gates it " +
    "exists to exclude have either moved or stopped running");
  // COMMENT LINES ARE STRIPPED FIRST, and the second run of this file is why. The workflow's own
  // comment reads "This job deliberately does NOT call `npm run verify`" — so a comment-blind scan
  // reported `verify` twice as a CI step, which is the shape M-D S35 recorded when a comment-blind
  // grep counted four `Intl` references in a directory that has none.
  const executable = (step) => step.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  return ours.flatMap((step) =>
    [...executable(step).matchAll(/npm (?:run ([\w:-]+)|(test))\b/g)].map((match) => match[1] ?? "npm test"));
})();

describe("`npm run verify` and the CI job that mirrors it", () => {
  it("is not comparing two empty lists", () => {
    // THE ANTI-VACUITY TERM, and it is not decoration: both lists are derived by pattern, and a
    // pattern that stops matching would make two empty lists compare equal and this file green over
    // a workflow that runs nothing at all. The floors are today's counts.
    assert.ok(verifySteps.length >= 21, `verify runs ${verifySteps.length} steps, expected at least 21`);
    assert.ok(ciSteps.length >= 21, `the CI verify job runs ${ciSteps.length} steps, expected at least 21`);
    assert.ok(verifySteps.includes("npm test"), "verify does not run the unit tests");
    assert.ok(ciSteps.includes("npm test"), "the CI verify job does not run the unit tests");
  });

  it("runs the same steps, in the same order", () => {
    const excused = new Set(DECLARED_EXCEPTIONS.map((entry) => entry.step));
    const inVerify = verifySteps.filter((step) => !excused.has(step));
    const inCi = ciSteps.filter((step) => !excused.has(step));
    const missingFromCi = inVerify.filter((step) => !inCi.includes(step));
    const missingFromVerify = inCi.filter((step) => !inVerify.includes(step));

    assert.deepEqual(missingFromCi, [],
      `in \`npm run verify\` and in no CI step: ${missingFromCi.join(", ")}. ` +
      "Add it to .github/workflows/ci.yml, or declare it in DECLARED_EXCEPTIONS with a reason.");
    assert.deepEqual(missingFromVerify, [],
      `run by CI and not by \`npm run verify\`: ${missingFromVerify.join(", ")}. ` +
      "A gate CI runs and a local `verify` does not is the same drift facing the other way.");
    assert.deepEqual(inCi, inVerify,
      "the two lists hold the same steps in a DIFFERENT ORDER. `npm run types` emits the " +
      "declarations that `declarations`, `check:readonly` and the surface tests read, so the order " +
      "decides which build they are asking about.");
  });

  it("declares no exception that is not real", () => {
    for (const entry of DECLARED_EXCEPTIONS) {
      const inVerify = verifySteps.includes(entry.step);
      const inCi = ciSteps.includes(entry.step);
      assert.ok(entry.why.length > 20, `${entry.step} is excused without a reason`);
      if (entry.side === "verify-only") {
        assert.ok(inVerify && !inCi, `${entry.step} is declared verify-only and is not`);
      } else {
        assert.ok(inCi && !inVerify, `${entry.step} is declared CI-only and is not`);
      }
    }
  });
});
