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

test("generated data is current, lossless and reproducible", { skip }, () => {
  const run = spawnSync("node", ["tools/gen-data.js", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, `gen-data --check failed:\n${run.stderr || run.stdout}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, "current");
  assert.equal(report.lossless, true);
  assert.ok(report.modules > 0, "no data modules were checked");
});
