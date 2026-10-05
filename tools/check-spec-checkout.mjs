// @ts-check
/**
 * FAIL HERE, NAMING THE CAUSE, rather than ten minutes later as anonymous skips or a partition count
 * nobody reads as a checkout problem.
 *
 * A checkout that SUCCEEDS says the ref resolved, not that it carried what the gates read.
 * Before the spec was promoted to main, its default branch held only LICENSE and README. Checking
 * out that branch silently produced an empty-looking spec, which is how a first attempt at the CI
 * fix still skipped 44 tests.
 *
 * **AND CARRYING THE FILES IS NOT CARRYING THE RIGHT REVISION.** The presence checks pass over ANY
 * revision that has the files, which is every revision of that branch — so a stale ref sails through.
 * Measured 2026-09-20: a run resolved a spec 16 cases behind, reported `2137/2137` where the tree
 * records 2153, and the first red was `check:readme:packed`. Three gates were queued to fail for one
 * cause and none of them named it. `measurements/conformance.json#corpusSha256` is this repository's
 * own record of WHICH corpus every ratchet here was measured against, so the equality is asserted at
 * checkout, where an outdated checkout can be corrected before attempting a conformance re-record.
 *
 * **THIS FILE EXISTS BECAUSE TWO WORKFLOWS NEED IT.** It was 46 lines of shell inside `ci.yml`, and
 * `publish.yml` copied the CHECKOUT without it — so the release path, the one that produces immutable
 * bytes, had the weaker check. A second copy would have drifted; this is the `graph-walk.mjs`
 * reasoning applied to a workflow step.
 *
 * Run from `lokalized-js` with the spec checked out as a SIBLING. CI and publishing check out main.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { IANA_SPEC_FILES } from "./iana-artifact.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = join(root, "..", "lokalized-spec");

/**
 * The artifacts the gates actually read. Absent means the REF is wrong, not that the spec is broken.
 *
 * The IANA half comes from `tools/iana-artifact.mjs`, the one place every IANA reader here takes its
 * paths from. It named the retired 818-entry closure until A30, and two of its readers degraded
 * SILENTLY when that file moved — so the list a checkout is held to is the list the readers import.
 */
const REQUIRED = [
  "generated/behavioral-vectors.json",
  ...IANA_SPEC_FILES,
  "symbol-allowlist.json",
  // `tools/divergences.mjs` takes its declined-Java-API rows from it (A30's declined JDK setting).
  "java-surface-amendments.json",
  "vendor/lokalized-java/src/build/resources/cldr/cldr-conformance-vectors.json",
  "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json",
];

const missing = REQUIRED.filter((r) => !existsSync(join(spec, r)));
if (missing.length > 0) {
  for (const r of missing) console.error(`::error::lokalized-spec checked out but ${r} is missing`);
  console.error(`Spec checkout: ${spec}`);
  console.error("Confirm lokalized-spec/main contains the shared artifacts and update the checkout.");
  process.exit(1);
}

const recorded = JSON.parse(readFileSync(join(root, "measurements/conformance.json"), "utf8")).corpusSha256;
const live = createHash("sha256")
  .update(readFileSync(join(spec, "generated/behavioral-vectors.json")))
  .digest("hex");

if (recorded !== live) {
  console.error("::error::the spec checkout is not the corpus this build's records were made against");
  console.error(`  spec checkout:      ${spec}`);
  console.error(`  corpus recorded:    ${recorded}`);
  console.error(`  corpus checked out: ${live}`);
  console.error("");
  console.error("Update the spec checkout from main, or re-record conformance if this repository");
  console.error("is deliberately adopting a changed corpus.");
  process.exit(1);
}

console.log(`corpus checkout OK — ${live.slice(0, 8)}, the revision this build records against`);
