// @ts-check
/**
 * The generated data modules must be current with the pinned upstream artifacts and lossless.
 *
 * Skips when the sibling lokalized-spec checkout is absent, so a standalone clone still runs its
 * own suite. `tools/gen-data.js --check` does the real work: it regenerates in memory, compares
 * bytes against what is on disk, and proves every module round-trips to the source's canonical JCS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const specDir = process.env.LOKALIZED_SPEC_DIR ?? resolve(root, "../lokalized-spec");
const vendor = resolve(specDir, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json");
const skip = existsSync(vendor) ? false : `pinned CLDR artifacts not found at ${vendor}`;

const ianaArtifact = resolve(specDir, "generated/iana-language-range-equivalents.json");
const skipIana = existsSync(ianaArtifact) ? false : `pinned IANA closure not found at ${ianaArtifact}`;

test("generated data is current, lossless and reproducible", { skip }, () => {
  const run = spawnSync("node", ["tools/gen-data.js", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, `gen-data --check failed:\n${run.stderr || run.stdout}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, "current");
  assert.equal(report.lossless, true);
  assert.ok(report.modules > 0, "no data modules were checked");

  // THE M1 NON-RUNTIME-OMISSION CLAUSE, revalidated on this run rather than asserted.
  //
  // Plan M1 requires justified omissions to be enumerated and the M7 row requires each one to be
  // revalidated against the final consumer graph. That used to rest on a prose list printed only by
  // `--measure`, which no gate read — and `verifyLossless` could not have caught drift anyway, since
  // it compares `decode()` against the already-PROJECTED source. `--check` now walks each upstream
  // sub-tree against its projection and fails if the dropped-field set differs from the declaration
  // in EITHER direction. Negative-tested three ways, each exiting 1 with the control at 0: a field
  // that stops being omitted, a new upstream field silently dropped, and a declaration gone stale.
  assert.ok(report.omissionsRevalidated > 0, "no non-runtime omissions were revalidated");
});

/**
 * The IANA closure has its own generator and therefore needs its own gate.
 *
 * `test/negotiate.test.js` already decodes `src/data/iana-range-equivalents.js` and compares it
 * against the spec artifact entry for entry, so a CONTENT drift is caught inside `npm run verify`.
 * What that comparison cannot see is the half `gen-iana-data.js` actually promises: that the module
 * still REPRODUCES from the artifact byte for byte, banner and formatting included. Until this test
 * existed the generator's two stated guarantees were checked only when a human happened to run it.
 *
 * Negative-tested: deleting one class from `src/data/iana-range-equivalents.js` makes `--check` exit
 * 1 with `on-disk bytes differ from regeneration`, and this assertion red.
 */
test("the generated IANA closure is current, lossless and reproducible", { skip: skipIana }, () => {
  const run = spawnSync("node", ["tools/gen-iana-data.js", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, `gen-iana-data --check failed:\n${run.stderr || run.stdout}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, "current");
  assert.equal(report.lossless, true);
  assert.ok(report.entries > 0, "no IANA equivalence classes were checked");
});
