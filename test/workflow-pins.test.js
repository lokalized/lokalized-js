// @ts-check
/**
 * EVERY ACTION IN EVERY WORKFLOW IS PINNED TO A COMMIT, and one action to one commit across all of
 * them.
 *
 * A tag is a pointer its owner can move, and an action runs with whatever its job holds.
 * `publish.yml`'s `setup-node` and `download-artifact` run beside `id-token: write`, so whoever can
 * move either tag can publish as the owner. `ci.yml` hands `actions/checkout` the `SPEC_REPO_TOKEN`
 * secret whenever one is configured. This rule was first written for `publish.yml` alone (M-R S23)
 * and widened the same day, when the reason given for leaving CI on tags — "it holds no
 * credential" — turned out to be false on reading the file.
 *
 * The workflow list is DERIVED from the directory, so a third workflow is covered the day it lands,
 * and job-level `uses:` (a reusable workflow) is read as well as step-level. The version rides in a
 * trailing `# vX.Y.Z` comment, which `tools/workflow-yaml.mjs` strips the way YAML does. That comment
 * is for the reviewer and Dependabot; whether it still names the release its SHA came from needs the
 * network, so nothing here checks it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkflow, child, keys, stepsOf } from "../tools/workflow-yaml.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");
const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort();

/** @type {{ where: string, uses: string }[]} */
const refs = [];
for (const file of files) {
  const tree = parseWorkflow(readFileSync(join(dir, file), "utf8"), file);
  const jobs = child(tree, "jobs");
  for (const job of keys(jobs)) {
    const reusable = child(child(jobs, job), "uses")?.value;
    if (reusable) refs.push({ where: `${file} ${job}`, uses: reusable });
    for (const step of stepsOf(tree, job)) {
      const uses = child(step, "uses")?.value;
      if (uses) refs.push({ where: `${file} ${job}`, uses });
    }
  }
}

test("the census reads the real workflows", () => {
  assert.ok(files.includes("publish.yml") && files.includes("ci.yml"), `workflows found: ${files.join(", ")}`);
  assert.ok(refs.length >= 13, `only ${refs.length} action references were found; the two workflows hold thirteen today`);
});

test("every action is pinned to a full commit SHA", () => {
  const PINNED = /^[A-Za-z0-9-]+\/[A-Za-z0-9._\/-]+@[0-9a-f]{40}$/;
  assert.deepEqual(refs.filter((r) => !PINNED.test(r.uses)).map((r) => `${r.where}: ${r.uses}`), [],
    "a tag or branch is mutable: pin each action to its full commit SHA, with the version as a `# vX.Y.Z` comment");
});

test("one action, one commit — across every workflow", () => {
  /** @type {Map<string, Set<string>>} */
  const commits = new Map();
  for (const { uses } of refs) {
    const [action, sha] = uses.split("@");
    commits.set(action, (commits.get(action) ?? new Set()).add(sha));
  }
  assert.deepEqual([...commits].filter(([, shas]) => shas.size > 1).map(([action, shas]) => `${action}: ${[...shas].join(", ")}`), [],
    "one action pinned to two commits is an upgrade applied to part of the repository — CI would then test with code the release does not run");
});
