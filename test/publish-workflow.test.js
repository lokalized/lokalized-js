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
 * test reads `.github/workflows/ci.yml` BY NAME (its line 35), so adding a second workflow neither
 * breaks it nor is covered by it — the one-directional-gate shape this project has closed at the
 * symbol level (M8 S5, S28, S30) and at the documentation level (M-D S27), arriving now at the
 * workflow level.
 *
 * **WHAT IT DOES NOT DO, said here rather than left to be discovered.** There is no YAML parser in
 * this repository and adding one would mean a fourth devDependency in a package that pins three, so
 * these are LINE-ORIENTED assertions over the file's text. They cannot tell you the YAML is valid;
 * GitHub is the first thing that truly parses it. What they can do is fail when a property the
 * header claims stops being present, which is the failure mode that matters.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = ".github/workflows/publish.yml";
const workflow = readFileSync(join(root, PATH), "utf8");
const lines = workflow.split("\n");

/** Lines inside a `run:` body — where a `${{ }}` interpolation becomes shell before the shell sees it. */
const runBodyLines = () => {
  const out = [];
  let inRun = false;
  let indent = 0;
  for (const [i, line] of lines.entries()) {
    if (/^\s*run: \|/.test(line)) { inRun = true; indent = line.search(/\S/); continue; }
    if (inRun) {
      const here = line.search(/\S/);
      if (line.trim() !== "" && here <= indent) { inRun = false; } else { out.push([i + 1, line]); continue; }
    }
    if (/^\s*run: /.test(line)) out.push([i + 1, line]); // single-line run:
  }
  return out;
};

test("the workflow exists and is the file npm's trusted publisher is registered against", () => {
  // The trust relationship on npm names this exact path. Renaming the file silently breaks
  // publishing, with an authentication error that does not mention the filename.
  assert.ok(workflow.length > 0, `${PATH} is empty`);
  assert.match(workflow, /^name: Publish$/m);
});

test("it requests the OIDC token permission, and no more than it needs", () => {
  assert.match(workflow, /^permissions:$/m, "no permissions block: the job would inherit the default");
  assert.match(workflow, /^ {2}id-token: write$/m, "id-token: write is the whole mechanism; without it npm has no token to exchange");
  assert.match(workflow, /^ {2}contents: read$/m, "contents should be read-only");
  assert.doesNotMatch(workflow, /^ {2}contents: write$/m, "a publish workflow has no reason to write to the repository");
  assert.doesNotMatch(workflow, /^ {2}packages: write$/m);
});

/**
 * The file with every comment removed.
 *
 * **BOTH PROHIBITIONS BELOW FIRED ON THIS FILE'S OWN PROSE BEFORE THIS EXISTED.** The header
 * explains that there is deliberately no `NODE_AUTH_TOKEN` and that `--provenance` is deliberately
 * omitted — and a rule reading the whole file cannot tell "this uses a token" from "this explains
 * that it uses none". Left as it was, the gate's only remedy was to delete the explanation, which
 * is the most useful part of the file. Narrowed to what actually executes, and negative-tested
 * below so the narrowing cannot hide a real one.
 */
const executable = lines.map((line) => line.replace(/#.*$/, "")).join("\n");

const CREDENTIALS = ["NODE_AUTH_TOKEN", "NPM_TOKEN", "npm_token", "_authToken"];

test("it carries NO npm credential — that is the point of trusted publishing", () => {
  for (const forbidden of CREDENTIALS) {
    assert.ok(!executable.includes(forbidden),
      `${PATH} uses ${forbidden} in executable text. A stored publish token is a standing ` +
      "credential that can leak; the OIDC exchange exists so there is nothing to steal between releases.");
  }
  assert.doesNotMatch(executable, /secrets\.NPM/, "no npm secret may be referenced");
});

test("...and the narrowing to non-comment text does not hide a real credential", () => {
  // Without this, stripping comments is an untested weakening of the rule above.
  for (const forbidden of CREDENTIALS) {
    const planted = `${workflow}\n        env:\n          ${forbidden}: \${{ secrets.NPM_TOKEN }}\n`;
    const stripped = planted.split("\n").map((line) => line.replace(/#.*$/, "")).join("\n");
    assert.ok(stripped.includes(forbidden),
      `a planted ${forbidden} survives comment-stripping — the rule above would still catch it`);
  }
  // And the converse: the real file's mentions are ALL in comments, which is why it passes.
  assert.ok(CREDENTIALS.some((c) => workflow.includes(c)),
    "the header no longer explains the no-token property; if that prose went, say so deliberately");
});

test("it does NOT pass --provenance, because npm enables it itself under OIDC", () => {
  // Read from the installed npm (lib/utils/oidc.js:145-162): provenance is auto-enabled ONLY when
  // `config.isDefault('provenance')` — passing the flag skips that guarded path, which also checks
  // that the repository and the package are public.
  assert.ok(!executable.includes("--provenance"),
    "passing --provenance skips npm's own guarded auto-enable; omit it and let npm decide");
});

test("the full gate runs BEFORE anything is published", () => {
  const verifyAt = workflow.indexOf("npm run verify");
  const publishAt = workflow.indexOf("npm publish");
  assert.ok(verifyAt !== -1, "the workflow must run `npm run verify`");
  assert.ok(publishAt !== -1, "the workflow must publish");
  assert.ok(verifyAt < publishAt,
    "`npm run verify` must appear before `npm publish`: a publish that skips the gate publishes unverified bytes");
});

test("it refuses to publish bytes whose digest the releaser did not supply", () => {
  // This rests on a measurement: `npm pack` here is reproducible, so CI can prove it built the same
  // artifact a person verified. Without the comparison the sha256 input would be decoration.
  assert.match(workflow, /sha256:\s*$|sha256:/m, "the workflow must take a sha256 input");
  assert.match(workflow, /sha256sum /, "it must compute the digest of what it packed");
  assert.ok(/EXPECTED/.test(workflow) && /!= "\$EXPECTED"/.test(workflow),
    "it must COMPARE the built digest against the supplied one and fail on a mismatch");
});

test("no workflow input reaches a shell except through env:", () => {
  // GitHub interpolates `${{ }}` before the shell parses the line, so an input containing a quote
  // or `$(…)` executes. Routing through `env:` and quoting `"$VAR"` removes the shape entirely.
  const offenders = runBodyLines().filter(([, line]) => /\$\{\{\s*(inputs|github\.event)\./.test(line));
  assert.deepEqual(offenders.map(([n, l]) => `${n}: ${l.trim()}`), [],
    "these interpolate untrusted-shaped input directly into a shell command; pass them via env: instead");
});

test("it is triggered only by a deliberate human act", () => {
  assert.match(workflow, /^ {2}workflow_dispatch:$/m, "publishing must be dispatched, not ambient");
  for (const ambient of ["  push:", "  pull_request:", "  pull_request_target:", "  schedule:"]) {
    assert.ok(!workflow.split("\non:")[1]?.split("\npermissions:")[0]?.includes(ambient),
      `${ambient.trim()} must not trigger a publish: publishing is one-way and npm versions are immutable`);
  }
});

test("the anti-vacuity term: these rules are read against a file that really is the publisher", () => {
  // Every assertion above is a `doesNotMatch` or a presence check over one file. If the file were
  // renamed or gutted, most of them would pass over an empty string. Pin the substance.
  assert.match(workflow, /npm publish /, "the file must actually publish, or this suite guards nothing");
  assert.ok(lines.length > 60, `${PATH} is ${lines.length} lines; it has been gutted`);
});
