// @ts-check
/**
 * THE PUBLISH WORKFLOW'S SECURITY PROPERTIES, GATED — because every one of them is a line a later
 * edit could remove while the workflow still appears to work.
 *
 * `.github/workflows/publish.yml` publishes to npm with NO stored credential: it exchanges a
 * short-lived GitHub OIDC token for a scoped npm one at the moment of publishing. That property is
 * invisible to any behavioural test — a workflow that quietly grew a `NODE_AUTH_TOKEN` would still
 * publish, and would publish just as successfully with a standing secret that can leak.
 *
 * **THIS FILE EXISTS BECAUSE `verify-ci-parity.test.js` CANNOT SEE THIS WORKFLOW.** Measured: that
 * test reads `.github/workflows/ci.yml` BY NAME, so adding a second workflow neither breaks it nor
 * is covered by it — the one-directional-gate shape this project has closed at the symbol level
 * (M8 S5, S28, S30) and at the documentation level (M-D S27), arriving now at the workflow level.
 *
 * **IT IS STRUCTURAL, AND THE PREVIOUS VERSION WAS NOT.** The first draft was line-oriented and a
 * 62-agent review measured what that cost: five permission rules anchored at two-space indent and
 * therefore blind to a job-level `permissions:` block, which REPLACES the workflow-level set; a
 * trigger rule that was a DENYLIST of four event names, so `workflow_call:` and the inline form
 * `on: [push]` both passed; an ordering rule comparing `indexOf` positions in text INCLUDING
 * comments, whose first `npm run verify` hit was a comment; and a `run:` collector that could not
 * match `- run: npm ci`, so the rule against interpolating inputs into a shell examined no one-line
 * step at all. All of them returned GREEN. `tools/workflow-yaml.mjs` is the repair: it reads the
 * structure and REFUSES what it cannot parse, and its own refusals are asserted below, because four
 * new patterns nothing executes are four typos that pass forever (the M-D S14 lesson).
 *
 * **WHAT IT STILL CANNOT SEE, said here rather than left to be discovered.** Which BRANCH this file
 * is on — and `workflow_dispatch` does not register until it is on the default branch. Whether the
 * `npm-publish` environment has any protection rules configured. Those are recorded in the workflow
 * header as external preconditions. And whether a pinned commit is still the release its trailing
 * `# v4.x.y` comment names — the comment is for the reviewer and Dependabot, and checking it needs
 * the network. What IS gated: the credentialed job's action set cannot grow (below), and every action
 * in every workflow is pinned to a full commit, one action to one commit
 * (`test/workflow-pins.test.js`, which reads the whole directory so CI is covered too).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkflow, at, child, items, keys, runBodies, stepsOf, effectivePermissions, triggers }
  from "../tools/workflow-yaml.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = ".github/workflows/publish.yml";
const workflow = readFileSync(join(root, PATH), "utf8");
const lines = workflow.split("\n");
const tree = parseWorkflow(workflow, PATH);

/** The job holding `id-token: write` — the one whose every step can mint a publish credential. */
const jobNames = keys(child(tree, "jobs"));
const credentialed = jobNames.filter((j) => effectivePermissions(tree, j)?.permissions["id-token"] === "write");

test("the workflow exists, parses structurally, and is the file npm's trusted publisher names", () => {
  // The trust relationship on npm names this exact path. Renaming the file silently breaks
  // publishing, with an authentication error that does not mention the filename.
  assert.ok(workflow.length > 0, `${PATH} is empty`);
  assert.equal(child(tree, "name")?.value, "Publish");
  assert.deepEqual(jobNames.length > 1, true, "the build/publish split is the security property; see the header");
});

test("it is triggered ONLY by a deliberate human act", () => {
  // An ALLOWLIST, not a denylist. The previous rule banned four event names and let every other
  // ambient trigger through, `workflow_call:` included — which would have turned the publisher into
  // a subroutine any other workflow in the repository could call.
  assert.deepEqual(triggers(tree), ["workflow_dispatch"],
    "publishing is one-way and npm versions are immutable: nothing ambient may trigger it");
});

test("permissions are resolved PER JOB, and only one job can mint a credential", () => {
  const top = child(tree, "permissions");
  assert.ok(top, "no workflow-level permissions block: a job that names none would inherit the repository default");
  assert.ok(!keys(top).includes("id-token"),
    "id-token must not be granted workflow-wide: a job added later would inherit the ability to publish");

  assert.equal(credentialed.length, 1, `exactly one job may hold id-token: write; found ${credentialed.length}`);
  const perms = effectivePermissions(tree, credentialed[0])?.permissions ?? {};
  assert.deepEqual(Object.keys(perms).sort(), ["contents", "id-token"],
    "the credentialed job may hold nothing beyond contents:read and id-token:write");
  assert.equal(perms.contents, "read");

  for (const job of jobNames) {
    const p = effectivePermissions(tree, job)?.permissions ?? {};
    assert.notEqual(p.contents, "write", `${job}: a publish workflow has no reason to write to the repository`);
    assert.equal(p.packages, undefined, `${job}: no package registry write`);
  }
});

test("THE CREDENTIALED JOB RUNS NO REPOSITORY CODE AND NO DEPENDENCY CODE", () => {
  // This is the finding the review existed to produce. `id-token: write` is JOB-wide and GitHub
  // exports the OIDC request variables to EVERY step of that job; npm's exchange is two HTTP calls
  // needing nothing else. So anything that executes there can publish as the owner. The first draft
  // ran `npm ci` (esbuild has an install script), a second repository's install, and all of
  // `verify` inside it. Publishing a TARBALL runs no lifecycle script, which is what makes the
  // split possible at all.
  const steps = stepsOf(tree, credentialed[0]);
  assert.ok(steps.length > 0, "the credentialed job has no steps");

  const USES_ALLOWED = ["actions/download-artifact", "actions/setup-node"];
  for (const step of steps) {
    const uses = child(step, "uses")?.value;
    if (!uses) continue;
    assert.ok(USES_ALLOWED.some((a) => uses.startsWith(a + "@")),
      `${credentialed[0]} uses ${uses}, which is not one of ${USES_ALLOWED.join(", ")}. Every action in ` +
      "this job runs with the OIDC variables in its environment; adding one widens that to its author.");
    assert.ok(!/checkout/.test(uses), "the credentialed job must not check out the repository");
  }

  // npm and node are ALLOWLISTED by subcommand, because a denylist of dangerous ones is the shape
  // this project keeps finding holes in.
  const NPM_ALLOWED = new Set(["view", "publish", "--version"]);
  for (const { line, body } of runBodies(tree).filter(({ line }) => steps.some((s) => within(s, line)))) {
    // Prose inside a body is not code. A full-line `#` (shell) or `//` (the inline `node -e`) is a
    // comment in both languages, and this rule fired on the phrase "the npm it most needed to
    // reject" before the narrowing existed. Only FULL-line comments are dropped, so nothing
    // executable can hide behind one.
    const code = body.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");
    for (const [, sub] of code.matchAll(/\bnpm\s+([-\w]+)/g)) {
      assert.ok(NPM_ALLOWED.has(sub),
        `${PATH}:${line} runs \`npm ${sub}\` in the credentialed job. Allowed: ${[...NPM_ALLOWED].join(", ")}. ` +
        "Anything that installs or runs a script executes third-party code beside a publish credential.");
    }
    for (const [, arg] of body.matchAll(/\bnode\s+(\S+)/g)) {
      assert.ok(arg === "-e" || arg === "-p",
        `${PATH}:${line} runs \`node ${arg}\` in the credentialed job; only inline -e/-p is allowed, ` +
        "because a script FILE is repository code and this job must not execute any.");
    }
  }
});

/** Is this line inside this step's span? Steps are sequence items; the next item starts the next span. */
function within(step, line) {
  const all = stepsOf(tree, credentialed[0]);
  const i = all.indexOf(step);
  const end = i + 1 < all.length ? all[i + 1].line : Infinity;
  return line >= step.line && line < end;
}

test("the full gate runs in the OTHER job, and publishing DEPENDS on it", () => {
  // Structural, not textual. The previous rule compared `indexOf` over the file including comments
  // and the first `npm run verify` in the file was a comment, so it compared a comment's position
  // to a command's.
  const builder = jobNames.find((j) => !credentialed.includes(j) &&
    runBodies(at(tree, "jobs", j) ?? tree).some(({ body }) => /\bnpm run verify\b/.test(body)));
  assert.ok(builder, "no job runs `npm run verify`: a publish that skips the gate publishes unverified bytes");

  const needs = at(tree, "jobs", credentialed[0], "needs");
  const declared = needs?.flow ?? (needs?.value ? [needs.value] : items(needs).map((n) => n.value));
  assert.ok(declared.includes(builder),
    `the publishing job must declare \`needs: [${builder}]\`, or it can run without the gate`);

  // And inside the builder: verify, then pack. IDENTIFIED BY WHAT THE STEP RUNS, not by its name —
  // an ablation moving `npm run verify` after the pack step DID NOT FIRE against the first version
  // of this rule, because it looked for a step whose NAME matched /verify/i and found "Verify the
  // corpus checkout carries what the gates read", which is a different step and always earlier. A
  // label is prose; the command is the thing being ordered.
  const buildSteps = stepsOf(tree, builder);
  const ranAt = (re) => buildSteps.findIndex((s) => re.test(child(s, "run")?.block ?? child(s, "run")?.value ?? ""));
  const verifyAt = ranAt(/\bnpm run verify\b/);
  const packAt = ranAt(/\bnpm pack\b/);
  assert.ok(verifyAt !== -1, "no step runs `npm run verify`");
  assert.ok(packAt !== -1, "no step runs `npm pack`");
  assert.ok(verifyAt < packAt,
    `verify must run before the release artifact is built (verify at step ${verifyAt}, pack at ${packAt})`);
  assert.ok(buildSteps.some((s) => /upload-artifact/.test(child(s, "uses")?.value ?? "")),
    "the build job must hand the tarball over as an artifact, or the split publishes something else");
});

/**
 * The file with FULL-LINE comments removed — and only those.
 *
 * **BOTH PROHIBITIONS BELOW FIRED ON THIS FILE'S OWN PROSE BEFORE THIS EXISTED.** The header
 * explains that there is deliberately no `NODE_AUTH_TOKEN`, and a rule reading the whole file cannot
 * tell "this uses a token" from "this explains that it uses none".
 *
 * **THE FIRST NARROWING WAS `line.replace(/#.*$/, "")` AND IT DELETED EXECUTING SHELL.** `#` is not
 * a comment introducer inside a YAML block scalar, and in bash it only starts a comment at the start
 * of a word — so an inline strip silently removed shell, in the direction that turns the rule green.
 * A full-line strip is unambiguous in both contexts: a line whose first non-space character is `#`
 * is a comment to YAML at the structural level and to the shell inside a `run:` body. The test below
 * pins BOTH directions — that a planted credential survives, and that the old form loses code.
 */
const executable = lines.filter((line) => !/^\s*#/.test(line)).join("\n");

const CREDENTIAL_SHAPES = [
  /NODE_AUTH_TOKEN/, /NPM_TOKEN/i, /_authToken/i, /\b_auth\b/i,
  /npm_config__auth/i, /secrets\.NPM/, /always-auth/i,
];

test("it carries NO npm credential — that is the point of trusted publishing", () => {
  for (const shape of CREDENTIAL_SHAPES) {
    assert.doesNotMatch(executable, shape,
      `${PATH} names ${shape} in executable text. A stored publish token is a standing credential ` +
      "that can leak; the OIDC exchange exists so there is nothing to steal between releases.");
  }
});

test("...and the narrowing to non-comment text is sound in BOTH directions", () => {
  const strip = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  // (a) a planted credential survives stripping, so the rule above would catch it.
  for (const spelling of ["NODE_AUTH_TOKEN", "NPM_CONFIG__AUTH", "_authToken"]) {
    const planted = `${workflow}\n        env:\n          ${spelling}: \${{ secrets.REGISTRY_CREDENTIAL }}\n`;
    assert.ok(CREDENTIAL_SHAPES.some((s) => s.test(strip(planted))),
      `a planted ${spelling} does not survive stripping — the rule above would miss it`);
  }

  // (b) stripping removes no executing text. Demonstrated against the form this replaced: an inline
  // `#` strip loses the rest of the line, and `#` is not a comment there.
  const shell = `      - run: |\n          echo "digest#$EXPECTED"\n`;
  assert.ok(strip(shell).includes("$EXPECTED"), "full-line stripping must keep executing shell");
  assert.ok(!shell.split("\n").map((l) => l.replace(/#.*$/, "")).join("\n").includes("$EXPECTED"),
    "the inline form this replaced must be shown to lose it, or the repair is unmotivated");

  // And the converse: the real file's mentions are ALL in comments, which is why it passes.
  assert.ok(CREDENTIAL_SHAPES.some((s) => s.test(workflow)),
    "the header no longer explains the no-token property; if that prose went, say so deliberately");
});

test("it REQUESTS provenance rather than hoping npm enables it", () => {
  // This assertion is the inverse of the one it replaces, and the reversal was measured. npm's
  // auto-enable (lib/utils/oidc.js:144-168) sits entirely inside a try/catch that only logs, so
  // every way it can miss leaves provenance unset and publishes anyway — an immutable, unattested
  // version. With the flag, `ensureProvenanceGeneration` (libnpmpublish/lib/publish.js:178-228)
  // throws EUSAGE inside `buildMetadata`, awaited at :44, before the PUT at :54. And the flag costs
  // nothing in authentication: the token exchange at oidc.js:113-142 is outside that guard.
  const publishCmd = runBodies(tree).map(({ body }) => body).find((b) => /\bnpm publish\b/.test(b));
  assert.ok(publishCmd, "the workflow must publish, or this suite guards nothing");
  assert.match(publishCmd, /--provenance\b/,
    "omitting --provenance makes provenance FAIL OPEN: the publish proceeds unattested and the " +
    "version is immutable by the time anyone reads the report");
  assert.match(publishCmd, /--access public\b/,
    "keeps the provenance prerequisite off a registry visibility lookup that can throw");
});

test("it publishes a TARBALL, which is what makes the credentialed job safe at all", () => {
  // The split rests on one fact about npm: a tarball spec runs NO lifecycle script, because
  // lib/commands/publish.js:99 and :215 gate prepublishOnly/publish/postpublish on
  // `spec.type === 'directory'` and libnpmpack/lib/index.js:19 gates prepack the same way. Drop the
  // argument and `npm publish` publishes the DIRECTORY — which both executes repository scripts
  // inside the OIDC environment and makes the digest the releaser typed meaningless, since the
  // bytes would be built here rather than checked. Nothing asserted this until the review asked
  // what the sha256 input actually constrains.
  const publishCmd = runBodies(tree).map(({ body }) => body).find((b) => /\bnpm publish\b/.test(b));
  assert.match(publishCmd ?? "", /npm publish\s+"[^"]*\.tgz"/,
    "npm publish must be given the .tgz explicitly; publishing the directory runs lifecycle scripts " +
    "beside a live publish credential and bypasses the digest the releaser supplied");
});

test("the dist-tag is constrained, because --tag disables package.json's own safety net", () => {
  // A CLI flag REMOVES the matching key from publishConfig before it is flattened
  // (lib/commands/publish.js:294-305), so passing --tag discards `publishConfig: {"tag": "next"}`.
  // npm will not catch a wrong value either: semver.validRange("latest") is null, so publish.js:88's
  // range guard does not fire and `latest` on a release candidate is accepted.
  // Selected by what it READS and what it can DO — `$TAG` plus a nonzero exit. Searching for the
  // phrase "dist-tag" instead found the reporting step, whose `npm view … dist-tags` matches it.
  const guard = runBodies(tree).map(({ body }) => body).find((b) => /\$TAG\b/.test(b) && /exit\(1\)|exit 1/.test(b));
  assert.ok(guard, "no step validates the tag input; `latest` on a prerelease would become the default install");
  assert.match(guard, /"next"|'next'/);
  assert.match(guard, /"latest"|'latest'/);
  assert.match(guard, /prerelease|includes\("-"\)/,
    "the guard must refuse `latest` for a prerelease version specifically, not merely spell-check the tag");
});

test("it refuses to publish bytes whose digest the releaser did not supply — in BOTH jobs, fatally", () => {
  // This rests on a measurement: `npm pack` here is reproducible, so CI can prove it built the same
  // artifact a person verified. The SECOND check is the load-bearing one — it means what reaches the
  // registry is the byte sequence whose digest a person typed, whatever the build job did.
  assert.ok(at(tree, "on", "workflow_dispatch", "inputs", "sha256"), "the workflow must take a sha256 input");

  const comparisons = runBodies(tree).filter(({ body }) => /\$EXPECTED/.test(body) && /sha256sum/.test(body));
  assert.ok(comparisons.length >= 2,
    `expected a digest comparison in both jobs; found ${comparisons.length}`);
  for (const { line, body } of comparisons) {
    assert.match(body, /!= "\$EXPECTED"/, `${PATH}:${line} must COMPARE against the supplied digest`);
    assert.match(body, /\n\s*exit 1\b/,
      `${PATH}:${line} compares the digest but does not EXIT on a mismatch — an ::error:: annotation ` +
      "does not fail a step, only a non-zero status does");
  }
  const jobsWithACheck = new Set(jobNames.filter((j) =>
    comparisons.some(({ line }) => {
      const job = at(tree, "jobs", j);
      const next = jobNames[jobNames.indexOf(j) + 1];
      const end = next ? (at(tree, "jobs", next)?.line ?? Infinity) : Infinity;
      return job && line >= job.line && line < end;
    })));
  assert.equal(jobsWithACheck.size, 2, "the digest must be checked in the building job AND in the publishing one");
});

test("no workflow input reaches a shell except through env:", () => {
  // GitHub interpolates `${{ }}` before the shell parses the line, so an input containing a quote or
  // `$(…)` executes. Routing through `env:` and quoting "$VAR" removes the shape entirely. The
  // previous collector could not see `- run: …` at all, so this rule had never examined a one-line
  // step; `tools/workflow-yaml.mjs` collects block, folded and inline bodies alike.
  const offenders = runBodies(tree)
    .filter(({ body }) => /\$\{\{\s*(inputs|github\.event)\./.test(body))
    .map(({ line }) => `${PATH}:${line}`);
  assert.deepEqual(offenders, [],
    "these interpolate untrusted-shaped input directly into a shell command; pass them via env: instead");
});

test("the reader REFUSES constructs it cannot parse, rather than returning a plausible answer", () => {
  // Four new patterns nothing executes are four typos that pass forever. Each of these is a spelling
  // that would otherwise be read as something it is not.
  for (const [why, src] of [
    ["a tab", "a:\n\tb: 1"],
    ["an anchor", "a: &x 1"],
    ["an alias", "b: *x"],
    ["a nested inline sequence", "steps:\n  - - run: x"],
    ["a flow sequence spanning lines", "node: [20,\n 22]"],
  ]) {
    assert.throws(() => parseWorkflow(src, "probe"), /cannot be parsed structurally/,
      `the reader accepted ${why}; a reader that guesses is a gate that has stopped gating`);
  }
  // And the constructs it must SEE, each of which defeated the line-oriented version.
  assert.deepEqual(triggers(parseWorkflow("on: [push, workflow_dispatch]\njobs:\n  a:\n    runs-on: x")),
    ["push", "workflow_dispatch"], "the inline sequence form of `on:` must be visible");
  assert.deepEqual(triggers(parseWorkflow("on: push\njobs:\n  a:\n    runs-on: x")), ["push"]);
  const three = parseWorkflow("jobs:\n  a:\n    steps:\n      - run: one\n      - run: |\n          two\n      - run: >\n          three\n");
  assert.equal(runBodies(three).length, 3, "inline, block and folded run bodies must all be collected");
  const jobLevel = parseWorkflow("permissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      id-token: write\n    runs-on: x");
  assert.deepEqual(effectivePermissions(jobLevel, "a")?.permissions, { "id-token": "write" },
    "a job-level permissions block REPLACES the workflow-level set and must be read as such");
});

test("the reader removes a trailing comment the way YAML does, and nowhere else", () => {
  // Without this a pinned `uses:` reads as `…@<sha> # v4.4.0` and the pinning rule refuses every
  // correctly pinned line. Each case is a place the obvious implementation gets it wrong.
  const read = (/** @type {string} */ src) => child(parseWorkflow(src, "probe"), "a")?.value;
  assert.equal(read("a: x/y@0123 # v4.4.0"), "x/y@0123", "an action's version comment is not part of the value");
  assert.equal(read("a: write   # why"), "write");
  assert.equal(read("a: x#y"), "x#y", "a # with no whitespace before it is content, not a comment");
  assert.equal(read('a: "x # y"'), '"x # y"', "a # inside a quoted value is content");
  assert.equal(read("a: 'x' # y"), "'x'", "a comment after a quoted value is removed");
  assert.equal(read("a: # nothing but a comment"), null);
  assert.throws(() => parseWorkflow('a: "x \\" y" # z', "probe"), /cannot be parsed structurally/,
    "an escaped quote followed by a comment is refused, not guessed at");
  const bodies = runBodies(parseWorkflow("jobs:\n  j:\n    steps:\n      - run: | # note\n          body\n"));
  assert.deepEqual(bodies.map((b) => b.body.trim()), ["body"], "a block scalar's indicator may carry a comment");
});

test("the anti-vacuity term: these rules are read against a file that really is the publisher", () => {
  // Every assertion above is a prohibition or a presence check over one file. If the file were
  // renamed or gutted, most of them would pass over an empty string. Pin the substance.
  assert.match(workflow, /npm publish /, "the file must actually publish, or this suite guards nothing");
  assert.ok(lines.length > 120, `${PATH} is ${lines.length} lines; it has been gutted`);
  assert.ok(runBodies(tree).length >= 8, "too few run steps for this to be the release path");
});
