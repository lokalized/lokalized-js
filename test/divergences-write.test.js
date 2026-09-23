import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { specDirectory } from "../tools/iana-artifact.mjs";

/**
 * `node tools/divergences.mjs --write` WRITES `DIVERGENCES.md` ONLY FROM A RUN WITH NO PROBLEMS.
 *
 * It used to write first and report afterwards, so a `--write` that failed still rewrote the tracked
 * file. The case that mattered is `npm pack` without the sibling spec: `prepack` runs this tool, the
 * spec's `java-surface-amendments.json` is missing, and the declined-API table came out empty in a
 * file the repository tracks, while the pack itself failed (found by the 2026-09-23 pre-push review).
 * Nothing else runs the tool without the spec (`verify`, CI's packed job and `publish.yml` all have
 * it), so without this file the fix could be reverted with every gate green, which the second
 * review measured.
 *
 * The tool runs on a COPY of the package, so a regression cannot rewrite this repository's own
 * file. The copy is checked twice: with no spec it must fail and leave the document byte-identical,
 * and with the real spec (the control) it must succeed and still leave it byte-identical, because
 * the recorded document is current. The control is what shows the copy holds everything the tool
 * reads, so the failing arm cannot pass because of an incomplete copy.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "lokalized-divergences-write-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const copy = join(workspace, "lokalized-js");
for (const entry of ["src", "tools", "measurements", "DIVERGENCES.md", "package.json"])
  cpSync(join(root, entry), join(copy, entry), { recursive: true });
const original = readFileSync(join(copy, "DIVERGENCES.md"));

const write = (/** @type {string} */ spec) =>
  spawnSync(process.execPath, ["tools/divergences.mjs", "--write"], {
    cwd: copy,
    encoding: "utf8",
    env: { ...process.env, LOKALIZED_SPEC_DIR: spec },
  });

test("with no spec, --write fails and leaves DIVERGENCES.md exactly as it was", () => {
  const run = write(join(workspace, "no-spec-here"));
  assert.equal(run.status, 1, `expected exit 1, got ${run.status}\n${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /DIVERGENCES\.md was NOT written/);
  assert.ok(readFileSync(join(copy, "DIVERGENCES.md")).equals(original),
    "a --write that reported problems still rewrote DIVERGENCES.md");
});

test("the control: with the spec, --write succeeds on the same copy and the document is unchanged", () => {
  const run = write(specDirectory());
  assert.equal(run.status, 0, `expected exit 0, got ${run.status}\n${run.stdout}${run.stderr}`);
  assert.ok(readFileSync(join(copy, "DIVERGENCES.md")).equals(original),
    "the recorded DIVERGENCES.md is not what this build produces; run `npm run divergences` for the cause");
});
