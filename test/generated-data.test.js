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

import { IANA_EQUIVALENCES_ARTIFACT, specPath } from "../tools/iana-artifact.mjs";

const root = new URL("../", import.meta.url).pathname;
const specDir = process.env.LOKALIZED_SPEC_DIR ?? resolve(root, "../lokalized-spec");
const vendor = resolve(specDir, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json");
const skip = existsSync(vendor) ? false : `pinned CLDR artifacts not found at ${vendor}`;

// THE PATH COMES FROM ONE PLACE. This line named the retired closure until A30, and a reader whose
// file had moved did not fail — it SKIPPED, which is silent locally and red only under CI's no-skip
// rule. `tools/iana-artifact.mjs` is the one spelling every IANA reader here imports.
const ianaArtifact = specPath(IANA_EQUIVALENCES_ARTIFACT);
const skipIana = existsSync(ianaArtifact) ? false : `pinned IANA artifact not found at ${ianaArtifact}`;

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
 * The IANA modules have their own generator and therefore need their own gate.
 *
 * `tools/gen-iana-data.js --check` encodes lokalized-spec's registry-generated artifact into the two
 * modules in memory, refuses a malformed artifact, a class in two places, a one-way region/variant
 * pair or a projection whose walk could stop early, proves each module decodes back to what it
 * encodes (order included), and compares bytes with what is on disk. `test/negotiate.test.js` checks
 * the decoded FULL table against the artifact separately, so a change to the decode rule is caught
 * as well as a change to the data.
 *
 * Negative-tested: deleting one class from either module makes `--check` exit 1 with `on-disk bytes
 * differ from regeneration`, and this assertion red.
 */
test("the generated IANA modules are current, lossless and reproducible", { skip: skipIana }, () => {
  const run = spawnSync("node", ["tools/gen-iana-data.js", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, `gen-iana-data --check failed:\n${run.stderr || run.stdout}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, "current");
  assert.equal(report.lossless, true);
  // Counts are the artifact's, so none is a literal here; zero in any means the tool checked nothing.
  assert.equal(report.modules, 2, "gen-iana-data checked a different number of modules than it emits");
  for (const field of ["languageKeys", "classes", "identityKeys", "identityClasses", "regionVariantPairs"])
    assert.ok(report[field] > 0, `gen-iana-data reports ${field} ${report[field]}; it checked nothing`);
});
