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
import { existsSync, readFileSync } from "node:fs";
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

/**
 * **A STEP REMOVED FROM BOTH LISTS AT ONCE REDDENED NOTHING.** The comparison above gates drift
 * BETWEEN `verify` and CI, never whether a step is there at all. Measured 2026-09-26: with
 * `npm run scenario:1-5` removed from package.json#verify and from ci.yml together, this file,
 * `test/scenarios-1-5.test.js` and `test/clause-ledger.test.js` passed at exit 0, and so did
 * `npm run clause:ledger`. M-R clause 8 rests on plan 9.2:2829 — M-R "reruns/evaluates every scenario
 * applicable to the selected release profile" — and a scenario that no longer runs is re-checked by
 * nothing, however carefully its record is kept.
 *
 * **THE REQUIRED SET IS DERIVED, NOT LISTED:** every package.json script whose name starts with
 * `scenario:`, so a scenario added later is required the day its script exists, plus the three size
 * and graph ratchets that are not scenarios by name. Those three are required BY NAME, so a renamed
 * one fails the rule as missing rather than leaving it. A renamed scenario would instead drop out of
 * the prefix without a word, so `CITED_SCENARIOS` is the derivation's anti-vacuity floor — and it is
 * itself held to the M-R ledger: every script that runs a tool clause 8 cites as a gate must be in the
 * floor or among the size ratchets. That check exists because the floor's first version omitted the
 * scripts of two of the six tools the ledger cited, `scenario:concurrency` and `scenario:peak-memory`,
 * while this comment said it named them; renaming either out of the prefix then left the whole suite
 * green. Both lists are checked, and no DECLARED_EXCEPTIONS entry excuses either: an exception that
 * let a scenario run in one list only is the escape this rule is for.
 *
 * **BEING LISTED IS NOT BEING ABLE TO FAIL, so three more rules, each measured escaping first** by a
 * review of the rule above: the scenario 6 CI step given `continue-on-error: true`, or `if: false`, or
 * a run line ending `|| true` — all green here, the first with the whole of `npm test` green too; and
 * `"scenario:1-5": "node -e 0"`, a script body that runs nothing, green. So each required step's CI
 * step must be a `name:` and a bare `run: npm run <name>` and nothing else, the job itself may carry
 * no `continue-on-error:` or `if:`, and each required script's body must run a tool that exists
 * under `tools/`, through `tools/temp-hygiene.mjs` or directly, joined by `&&` alone. What that cannot
 * see is a tool that runs and checks nothing, or arguments that ask it not to; the tools' own tests
 * are what hold those.
 *
 * **THE RULES ARE ONE PURE FUNCTION, TESTED BY BREAKING ITS INPUT.** The rest of this file is checked
 * only against the tree as it stands, so deleting one of its rules leaves it green. Here each escape
 * above is replayed on a mutated copy of the real inputs and must be named.
 */
const SIZE_RATCHETS = ["subpath:graphs", "check:bundle", "size:graph"];
const CITED_SCENARIOS = [
  "scenario:0a", "scenario:0b", "scenario:1-5", "scenario:2k", "scenario:6", "scenario:concurrency", "scenario:peak-memory",
];

/**
 * The tools a script body runs, or `null` when a part of it does not have the shape of running one.
 * `size:graph` runs its tool twice, joined by `&&`.
 * @param {string} body
 * @returns {string[] | null}
 */
function toolsRunBy(body) {
  const tools = [];
  for (const part of body.split("&&").map((text) => text.trim())) {
    const match = /^node(?: tools\/temp-hygiene\.mjs node)?(?: --[\w-]+)* (tools\/[\w./-]+\.mjs)(?: [\w./:=-]+)*$/.exec(part);
    if (!match || match[1] === "tools/temp-hygiene.mjs") return null;
    tools.push(match[1]);
  }
  return tools;
}

/**
 * The CI verify job as text: its own keys, and each step with comment lines dropped and the sibling
 * repo's steps excluded, exactly as `ciSteps` above reads them.
 * @param {string} text the workflow
 * @returns {{ header: string, steps: string[] }}
 */
function ciVerifyJob(text) {
  const start = text.indexOf("\n  verify:");
  assert.notEqual(start, -1, "ci.yml has no `verify` job");
  const end = text.indexOf("\n  packed:", start);
  const executable = (/** @type {string} */ part) => part.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n").trim();
  const [header, ...steps] = text.slice(start, end === -1 ? undefined : end).split(/\n {6}- /);
  return {
    header: executable(header),
    steps: steps.filter((step) => !/^\s*working-directory:/m.test(step)).map(executable),
  };
}

const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Everything wrong with how the scenarios and size ratchets run, as sentences.
 * @param {{ scripts: Record<string, string>, verifySteps: string[], job: { header: string, steps: string[] },
 *   toolExists: (path: string) => boolean }} input
 * @returns {string[]}
 */
function requiredStepProblems({ scripts, verifySteps, job, toolExists }) {
  /** @type {string[]} */
  const problems = [];
  const scenarios = Object.keys(scripts).filter((name) => name.startsWith("scenario:"));
  for (const name of CITED_SCENARIOS)
    if (!scenarios.includes(name))
      problems.push(`the derivation does not see ${name}: it is not a package.json script named scenario:*, so a ` +
        "renamed or deleted scenario would leave this rule without saying so");
  if (/^\s*(?:continue-on-error|if):/m.test(job.header))
    problems.push("the CI verify job itself carries `continue-on-error:` or `if:`, so no step in it can be relied on " +
      "to fail the workflow");
  for (const name of [...scenarios, ...SIZE_RATCHETS]) {
    const body = scripts[name];
    if (typeof body !== "string") {
      problems.push(`${name} is required by name and package.json has no such script; a renamed size ratchet is ` +
        "renamed in SIZE_RATCHETS too");
    } else {
      const tools = toolsRunBy(body);
      if (tools === null)
        problems.push(`${name}'s script ${JSON.stringify(body)} does not have the shape of running a tool: ` +
          "`node [tools/temp-hygiene.mjs node] [--flag…] tools/<file>.mjs [args]`, joined by `&&` alone");
      else
        for (const tool of tools.filter((path) => !toolExists(path)))
          problems.push(`${name}'s script runs ${tool}, which does not exist`);
    }
    if (!verifySteps.includes(name))
      problems.push(`not a step of \`npm run verify\`: ${name}. A scenario or size ratchet that verify does not run ` +
        "is re-checked by nothing; add it back, in its place in the list");
    const running = job.steps.filter((step) => new RegExp(`\\bnpm run ${escape(name)}(?![\\w:-])`).test(step));
    if (running.length === 0)
      problems.push(`not a step of the CI verify job: ${name}. Every scenario and size ratchet runs in CI as well, ` +
        "whatever DECLARED_EXCEPTIONS says");
    for (const step of running)
      if (!new RegExp(`^(?:name: [^\\n]*\\n\\s*)?run: npm run ${escape(name)}$`).test(step))
        problems.push(`${name}: its CI step is not a \`name:\` and a bare \`run: npm run ${name}\` alone. Any other key or a ` +
          "longer run line is refused rather than judged, because `continue-on-error`, `if` and `|| true` were each " +
          `measured letting a failing step pass: ${JSON.stringify(step)}`);
  }
  return problems;
}

describe("every scenario and size ratchet runs in `npm run verify` and in CI, and can fail it", () => {
  const job = ciVerifyJob(workflow);
  /** The real inputs. Each test below hands the rule a copy of them with one thing changed. */
  const real = () => ({
    scripts: /** @type {Record<string, string>} */ ({ ...manifest.scripts }),
    verifySteps: [...verifySteps],
    job: { header: job.header, steps: [...job.steps] },
    toolExists: (/** @type {string} */ path) => existsSync(join(root, path)),
  });
  /** @param {ReturnType<typeof real>} input @param {RegExp} expected @param {string} what */
  const fires = (input, expected, what) => {
    const problems = requiredStepProblems(input);
    assert.ok(problems.some((line) => expected.test(line)),
      `${what}: expected a problem matching ${expected}, got ${JSON.stringify(problems, null, 2)}`);
  };
  /** Drop a required step from both lists, as the measured escape did. */
  const dropped = (/** @type {string} */ name, input = real()) => ({
    ...input,
    verifySteps: input.verifySteps.filter((step) => step !== name),
    job: { ...input.job, steps: input.job.steps.filter((step) => !step.endsWith(`run: npm run ${name}`)) },
  });

  it("reads the same CI job the comparison above reads", () => {
    const names = job.steps.flatMap((step) => [...step.matchAll(/npm (?:run ([\w:-]+)|(test))\b/g)].map((match) => match[1] ?? "npm test"));
    assert.deepEqual(names, ciSteps, "two readings of one CI job disagree, so one of them is reading something else");
  });

  it("holds for this tree", () => {
    assert.deepEqual(requiredStepProblems(real()), []);
  });

  it("names in its floor every scenario M-R clause 8 cites", () => {
    const ledger = JSON.parse(readFileSync(join(root, "measurements/mr-clauses.json"), "utf8"));
    const clause = ledger.clauses.find((/** @type {any} */ entry) => entry.id === 8);
    assert.ok(clause && Array.isArray(clause.gates), "measurements/mr-clauses.json has no clause 8 with gates");
    const cited = Object.entries(/** @type {Record<string, string>} */ (manifest.scripts))
      .filter(([, body]) => (toolsRunBy(body) ?? []).some((tool) => clause.gates.includes(tool)))
      .map(([name]) => name);
    // Anti-vacuity: the ledger row cites at least 0a, 2k and the subpath graphs today.
    for (const name of ["scenario:0a", "scenario:2k", "subpath:graphs"])
      assert.ok(cited.includes(name), `no script found running the tool clause 8 cites for ${name}; the derivation broke`);
    const unnamed = cited.filter((name) => !CITED_SCENARIOS.includes(name) && !SIZE_RATCHETS.includes(name));
    assert.deepEqual(unnamed, [],
      "M-R clause 8 cites a tool these scripts run, and neither CITED_SCENARIOS nor SIZE_RATCHETS names them");
  });

  it("fails on a required step removed from both lists: each scenario and each size ratchet", () => {
    for (const name of [...CITED_SCENARIOS, ...SIZE_RATCHETS]) {
      fires(dropped(name), new RegExp(`not a step of \`npm run verify\`: ${escape(name)}\\.`), name);
      fires(dropped(name), new RegExp(`not a step of the CI verify job: ${escape(name)}\\.`), name);
    }
    // One list at a time, too: each is required on its own.
    const ciOnly = real();
    ciOnly.verifySteps = ciOnly.verifySteps.filter((step) => step !== "scenario:6");
    fires(ciOnly, /not a step of `npm run verify`: scenario:6\./, "verify only");
  });

  it("fails on a scenario renamed or deleted out of the prefix, which would otherwise shrink the derived set", () => {
    for (const name of CITED_SCENARIOS) {
      const renamed = dropped(name);
      renamed.scripts[`perf:${name.slice("scenario:".length)}`] = renamed.scripts[name];
      delete renamed.scripts[name];
      fires(renamed, new RegExp(`the derivation does not see ${escape(name)}:`), name);
      assert.ok(requiredStepProblems(renamed).every((line) => !line.startsWith(`not a step`)),
        `${name}: once renamed it is no longer required, which is exactly why the floor must name it`);
    }
    const sizeRenamed = dropped("size:graph");
    sizeRenamed.scripts["size:graphs-root"] = sizeRenamed.scripts["size:graph"];
    delete sizeRenamed.scripts["size:graph"];
    fires(sizeRenamed, /size:graph is required by name and package\.json has no such script/, "size ratchet renamed");
  });

  it("fails on a CI step, or the job, that cannot fail", () => {
    const step = job.steps.findIndex((text) => text.endsWith("run: npm run scenario:6"));
    assert.notEqual(step, -1, "the scenario 6 step is not where the arms below expect it");
    for (const [what, change] of /** @type {Array<[string, (text: string) => string]>} */ ([
      ["continue-on-error", (text) => text.replace("run: npm run scenario:6", "continue-on-error: true\n        run: npm run scenario:6")],
      ["if: false", (text) => text.replace("run: npm run scenario:6", "if: false\n        run: npm run scenario:6")],
      ["|| true", (text) => `${text} || true`],
      ["a shell that runs nothing", (text) => text.replace("run: npm run scenario:6", "shell: bash -c \"exit 0\" {0}\n        run: npm run scenario:6")],
    ])) {
      const input = real();
      input.job.steps[step] = change(input.job.steps[step]);
      assert.notEqual(input.job.steps[step], job.steps[step], `${what}: the mutation did not land`);
      fires(input, /scenario:6: its CI step is not a `name:` and a bare `run: npm run scenario:6` alone/, what);
    }
    for (const key of ["continue-on-error: true", "if: false"]) {
      const input = real();
      input.job.header = `${input.job.header}\n    ${key}`;
      fires(input, /the CI verify job itself carries `continue-on-error:` or `if:`/, `job ${key}`);
    }
  });

  it("fails on a script body that does not run its tool", () => {
    for (const [what, body, expected] of /** @type {Array<[string, string, RegExp]>} */ ([
      ["neutered", "node -e 0", /scenario:1-5's script "node -e 0" does not have the shape of running a tool/],
      ["the wrapper around no tool", "node tools/temp-hygiene.mjs node -e 0", /does not have the shape of running a tool/],
      ["the wrapper as its own tool", "node tools/temp-hygiene.mjs", /does not have the shape of running a tool/],
      ["unable to fail", "node tools/temp-hygiene.mjs node tools/scenarios-1-5.mjs || true", /does not have the shape of running a tool/],
      ["two commands, one that cannot fail", "node tools/scenarios-1-5.mjs; true", /does not have the shape of running a tool/],
      ["a tool that is not there", "node tools/temp-hygiene.mjs node tools/scenarios-1-6.mjs", /scenario:1-5's script runs tools\/scenarios-1-6\.mjs, which does not exist/],
    ])) {
      const input = real();
      input.scripts["scenario:1-5"] = body;
      fires(input, expected, what);
    }
  });
});

/**
 * **THE SIBLING REPO'S GATE LIST, WHICH THE COMPARISON ABOVE DELIBERATELY DOES NOT COVER — AND THE
 * HOLE THAT LEFT.**
 *
 * The `verify` comparison skips any CI step carrying a `working-directory`, correctly: those run
 * `lokalized-spec`'s scripts, and `npm run verify` here has no business calling them. But that left
 * the spec-repo list gated by nothing. Measured at M-R S13: the workflow's own comment read "SIX OF
 * THE TWELVE" while the spec's `check` had grown to fifteen, and TWO CI-runnable gates were absent
 * — `check:iana-registry`, which had never been there, and `check:provenance`, added that day.
 *
 * So the drift this workflow's comment has warned about four times was gated on THIS repo's list
 * and on nothing else. Both directions now: every `check:*` the spec's `npm run check` runs must
 * appear in the CI step or in `SPEC_GATE_EXCLUSIONS` with a reason, and an exclusion naming a gate
 * the spec no longer has is stale and fails.
 *
 * **WHAT THIS CANNOT DO IS RUN THEM.** Whether a gate NEEDS the plan or the JDK is measured by
 * running it with those pointing nowhere, which belongs in a slice and not in a unit test. The
 * reasons below are therefore declared, with the date they were measured — the check is that every
 * gate is accounted for, not that its excuse is true.
 */
const SPEC_GATE_EXCLUSIONS = [
  { gate: "check:allowlist", why: "resolves the plan through scripts/planning-path.mjs; exits 2 when it is absent" },
  { gate: "check:surface", why: "resolves the plan through scripts/planning-path.mjs; exits 2 when it is absent" },
  { gate: "check:registry", why: "resolves the plan through scripts/planning-path.mjs; exits 2 when it is absent" },
  { gate: "check:documentation-topics", why: "derives the obligation from the plan's milestone rows; exits 2 without it" },
  { gate: "check:parity-obligations", why: "derives plan 8.5's bullets from the plan text; exits 2 without it" },
  // Since A30 `check:iana` is the JDK CHECK on data a JDK-free generator produced (that generator's
  // own `--check` is `check:iana-registry`, which CI runs). Re-measured 2026-09-23: exit 2, status
  // `cannot-run`, naming the JDK path — it used to exit 1.
  { gate: "check:iana", why: "drives the pinned JDK against lokalized-java's classes and the registry-generated artifact; exits 2 (status cannot-run) naming the JDK path" },
  { gate: "check:vectors", why: "drives the pinned JDK to re-emit the corpus; exits 1 naming the JDK path" },
  { gate: "check:datalock", why: "hashes real source files out of the sibling lokalized-java, which CI does not check out; exits 1 with ENOENT naming GeneratedCldrLocaleData.java" },
];

describe("the sibling spec repo's gate list, and the CI step that mirrors it", () => {
  const specPackage = JSON.parse(
    readFileSync(new URL("../../lokalized-spec/package.json", import.meta.url), "utf8"));

  const specGates = specPackage.scripts.check
    .split("&&").map((/** @type {string} */ part) => part.trim().replace(/^npm run /, ""))
    .filter((/** @type {string} */ name) => name.startsWith("check:"));

  /**
   * Every step the comparison above filters out: the ones declaring `working-directory:
   * lokalized-spec`.
   *
   * **ALL OF THEM, not the first.** The first version took `indexOf` and read to the next blank
   * line, which was correct while exactly one step ran there — and broke the moment an
   * `npm ci` step was added ahead of the gates, because it then read the INSTALL step, found no
   * `check:` scripts, and reported every spec gate as unaccounted. A parser that assumes "there is
   * one of these" fails the first time there are two, and it fails by describing the workflow as
   * empty rather than by saying it could not parse.
   */
  const ciSpecGates = (() => {
    const steps = workflow.split(/\n {6}- /).slice(1)
      .filter((step) => /^\s*working-directory: lokalized-spec\s*$/m.test(step));
    assert.notEqual(steps.length, 0, "no CI step runs in lokalized-spec; the spec-repo gates have moved");
    const executable = (step) => step.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
    return steps.flatMap((step) =>
      [...executable(step).matchAll(/npm run (check:[\w:-]+)/g)].map((match) => match[1]));
  })();

  it("is not comparing two empty lists", () => {
    // **THE FLOORS ARE DELIBERATELY WELL BELOW TODAY'S COUNTS, and the first draft had them AT
    // them (15 and 8).** That made this term fire on any legitimate removal and, worse, it fired
    // FIRST — masking the accounting rule below, which is the one that names the offending gate.
    // An anti-vacuity term exists to catch a broken PARSER, not to restate the policy rule beside
    // it. An empty `specGates` is the dangerous direction: it makes the accounting rule silently
    // green, where an empty `ciSpecGates` makes it fail loudly on its own.
    assert.ok(specGates.length >= 5,
      `only ${specGates.length} spec check gate(s) parsed out of package.json; the script shape moved`);
    assert.ok(ciSpecGates.length >= 1,
      "no spec gate parsed out of the CI step; the workflow's shape moved and nothing below is real");
  });

  it("accounts for every gate the spec's own `check` runs", () => {
    const excused = new Set(SPEC_GATE_EXCLUSIONS.map((entry) => entry.gate));
    const unaccounted = specGates.filter(
      (/** @type {string} */ gate) => !ciSpecGates.includes(gate) && !excused.has(gate));

    assert.deepEqual(unaccounted, [],
      "spec gates that CI does not run and nothing excuses. Measure whether each needs the plan or " +
      "the pinned JDK — run it with LOKALIZED_PLANNING_DIR and LOKALIZED_ORACLE_JDK pointing " +
      "nowhere — then add it to the CI step or to SPEC_GATE_EXCLUSIONS with the reason.");
  });

  /**
   * **THE RULE ABOVE SAYS WHICH GATES ARE LISTED; THIS ONE SAYS THEY CAN RUN.** They are different
   * questions and the difference is what broke CI on 2026-09-20: `check:schemas` imports `ajv`, a
   * devDependency of lokalized-spec, and the only `npm ci` in the job runs in lokalized-js. The
   * gate had been listed since A7 and had never once executed — the job died earlier every time,
   * so nothing revealed it until the steps ahead were fixed.
   *
   * Found as a DID-NOT-FIRE while ablating the rule above: deleting the install step left this
   * file green, because listing a gate and being able to run it are not the same claim.
   */
  it("installs the spec's dependencies if it runs any gate that could need them", () => {
    const hasDeps = Object.keys(specPackage.devDependencies ?? {}).length > 0
      || Object.keys(specPackage.dependencies ?? {}).length > 0;
    if (!hasDeps || ciSpecGates.length === 0) {
      assert.ok(true, "nothing to install or nothing to run");
      return;
    }

    const installs = workflow.split(/\n {6}- /).slice(1)
      .filter((step) => /^\s*working-directory: lokalized-spec\s*$/m.test(step))
      .filter((step) => /npm (ci|install)\b/.test(step.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")));

    assert.ok(installs.length > 0,
      `CI runs ${ciSpecGates.length} lokalized-spec gate(s) and never installs that package's ` +
      `dependencies (it declares ${Object.keys(specPackage.devDependencies ?? {}).join(", ")}). ` +
      "A gate that cannot resolve its imports has never run — add a step with " +
      "`working-directory: lokalized-spec` running `npm ci || npm install` BEFORE the gates.");
  });

  it("runs nothing CI cannot, and excuses nothing that is gone", () => {
    const invented = ciSpecGates.filter((/** @type {string} */ gate) => !specGates.includes(gate));
    assert.deepEqual(invented, [], "CI runs spec gates the spec's own `check` does not");

    const stale = SPEC_GATE_EXCLUSIONS.filter((entry) => !specGates.includes(entry.gate));
    assert.deepEqual(stale.map((entry) => entry.gate), [],
      "excused spec gates that no longer exist; an excuse outliving its gate is how these lists rot");

    // An exclusion for a gate CI ALSO runs is a contradiction, and the likelier direction of drift:
    // somebody adds the gate to CI and leaves the excuse behind.
    const both = SPEC_GATE_EXCLUSIONS.filter((entry) => ciSpecGates.includes(entry.gate));
    assert.deepEqual(both.map((entry) => entry.gate), [],
      "gates that are both run by CI and excused from it");

    for (const entry of SPEC_GATE_EXCLUSIONS)
      assert.ok(entry.why.length > 20, `${entry.gate} is excused without a reason`);
  });
});
