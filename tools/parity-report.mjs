#!/usr/bin/env node
// @ts-check
/**
 * THE RELEASE PARITY DECLARATION — plan 8.5's `lokalized-parity.json`.
 *
 * **WHAT MAKES THIS DIFFERENT FROM A SUMMARY IS THAT IT SAYS WHAT IT CANNOT SAY.** A release report
 * that silently omits a field it could not compute is worse than no report: a reader cannot tell an
 * absent field from an absent problem. So every obligation plan 8.5 states is represented here, and
 * a field that cannot be discharged today carries `null` beside a recorded reason and the artifact
 * or person it waits on.
 *
 * **THE OBLIGATION LIST IS DERIVED, NEVER TRANSCRIBED.** `lokalized-spec/parity-obligations.json` is
 * generated from the plan's own section 8.5, hashes each requirement over its exact bytes, and fails
 * on a sentence in 8.5 it cannot read. Each field below DECLARES which obligation it discharges, and
 * `test/parity-obligations.test.js` checks that every obligation is claimed and that no field cites
 * one whose wording has moved. That split is `scripts/documentation-topics.mjs`'s: the judgement of
 * what discharges an obligation belongs with the artifact, the obligation belongs with the plan.
 *
 * **NOTHING VOLATILE IS IN THE CANONICAL REPORT, which 8.5 requires in as many words** — "volatile
 * wall-clock run times remain CI attestation metadata outside the canonical packed report, so they
 * do not defeat reproducible tarballs". There is no timestamp, no host name, no temp path and no
 * duration. `sourceDateEpoch` is the commit's own date, never the clock's, and `--check`
 * regenerates and compares byte-for-byte, so a volatile field added later fails on the next run.
 *
 *   node tools/parity-report.mjs            regenerate and CHECK the recorded copy
 *   node tools/parity-report.mjs --write    re-record `measurements/lokalized-parity.json`
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = resolve(root, "../lokalized-spec");
const java = resolve(root, "../lokalized-java");
const OUTPUT = join(root, "measurements/lokalized-parity.json");

const problems = [];
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const conformance = JSON.parse(readFileSync(join(root, "measurements/conformance.json"), "utf8"));
const corpus = JSON.parse(readFileSync(join(spec, "generated/behavioral-vectors.json"), "utf8"));
const obligations = JSON.parse(readFileSync(join(spec, "parity-obligations.json"), "utf8")).obligations;

const sha = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");
const digestOf = (/** @type {string} */ path) => { try { return sha(readFileSync(path)); } catch { return null; } };
const headOf = (/** @type {string} */ at) => {
  try { return execFileSync("git", ["-C", at, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
};

/** Every id in a corpus partition, sorted, so the set is a value rather than an enumeration order. */
const partition = (/** @type {string} */ name) =>
  corpus.cases.filter((/** @type {any} */ c) => c.partition === name).map((/** @type {any} */ c) => c.id).sort();

const requiredPortableIds = partition("requiredPortableIds");
const requiredImplementationIds = partition("requiredImplementationIds");
const passedIds = [...conformance.passedIds].sort();

/**
 * **THE ID SETS ARE CARRIED VERBATIM AND AS A DIGEST, AND THE FIRST VERSION CARRIED ONLY THE
 * DIGEST, WHICH WAS WRONG TWICE OVER.**
 *
 * Wrong on substance: a digest-only report is unfalsifiable by its own audience. The corpus is not
 * in the tarball, so nobody who runs `npm install lokalized` can re-derive the 2,137 ids a digest
 * covers — which makes the strict-parity claim uncheckable by exactly the people it is published
 * for. Verbatim costs +302,673 bytes, 2.51% of the shipped tarball, measured.
 *
 * Wrong on the digest itself: `sha256(ids.join("\n"))` hashes the EMPTY SET and `[""]` to the same
 * `e3b0c442…`, and THREE of the six sets here are empty — so for exactly the sets whose emptiness
 * is the claim, the digest asserted nothing. `JSON.stringify` distinguishes them (`4f53cda1` vs
 * `055539df`). The digest stays because it is what CI compares and what prose can quote.
 */
const idSet = (/** @type {string[]} */ ids) => ({ count: ids.length, sha256: sha(JSON.stringify(ids)), ids });

/** The pinned reference JDK, read from its own `release` file rather than from a comment. */
const referenceJdk = (() => {
  const home = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";
  try {
    const release = readFileSync(join(home, "release"), "utf8");
    const field = (/** @type {string} */ name) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(release)?.[1] ?? null;
    return { vendor: field("IMPLEMENTOR"), version: field("JAVA_VERSION"),
      runtimeVersion: field("IMPLEMENTOR_VERSION"), imageDigest: null };
  } catch { return { vendor: null, version: null, runtimeVersion: null, imageDigest: null }; }
})();

const core = await import("../src/core/index.js");

/**
 * Every field, with the obligation it discharges and — where it is null — why.
 *
 * `blocker` names what a PERSON must supply. `reason` alone means the plan itself expects null, or
 * the artifact does not exist and nobody is being asked for it. The distinction matters: a release
 * report that files "the plan says null here" beside "nobody has approved this yet" tells its
 * reader nothing about what is left to do.
 */
const FIELDS = [
  { name: "implementationVersion", obligation: 0, value: pkg.version },
  { name: "packageName", obligation: 0, value: pkg.name },
  { name: "packageVersion", obligation: 0, value: pkg.version,
    note: "8.5's first bullet names TWO versions, implementation and package. For a JavaScript " +
      "package these coincide — the implementation IS the package and there is no second version " +
      "anywhere in the repository — so both slots are filled from the same key and the coincidence " +
      "is stated rather than left to look like a duplicated field." },

  { name: "implementationCommit", obligation: 1, value: headOf(root) },
  { name: "javaReferenceCommit", obligation: 1, value: headOf(java),
    note: "this is lokalized-java's HEAD, which is TWO COMMITS AHEAD of the 3.0.0 tag the parity " +
      "claim is about. Measured across those two commits: the only changes are build tooling and " +
      "two generated CLDR resources, and zero behavioural Java source differs — so the oracle's " +
      "answers are the tag's. That is a coincidence of these two commits, not a rule, which is why " +
      "both are recorded." },
  { name: "javaReferenceTagCommit", obligation: 1,
    value: (() => { try { return execFileSync("git", ["-C", java, "rev-parse", "3.0.0^{commit}"], { encoding: "utf8" }).trim(); } catch { return null; } })(),
    reason: "absent only if the 3.0.0 tag is not present in this checkout" },
  { name: "dataCommit", obligation: 1, value: headOf(spec) },
  { name: "portingContractArchiveDigest", obligation: 1, value: null,
    reason: "plan :2395 has each pinned Java reference tag publish an immutable " +
      "`lokalized-porting-contracts-<version>.tar.gz`; no such archive exists in any of the three " +
      "repositories. It is the Java side's to publish, so this stays null rather than being " +
      "substituted with a digest over something else." },

  { name: "requirementsSha256", obligation: 2, value: digestOf(join(spec, "pre-m0/bootstrap.requirements.candidate.json")),
    note: "plan 8.6's `requirements.json` is `pre-m0/bootstrap.requirements.candidate.json` here: " +
      "the successor registry revision 8.6 describes has not been produced, so this is the digest " +
      "of the candidate the project actually has." },
  { name: "selectedReleaseProfileId", obligation: 2,
    value: JSON.parse(readFileSync(join(spec, "pre-m0/selection-record.draft.json"), "utf8")).selectedProfileId,
    note: "read from a selection record whose own `status` is `draft-unapproved`; the id is " +
      "selected, the selection is not approved. See `releaseProfileApproved`." },
  { name: "releaseProfileApproved", obligation: 2, value: false,
    blocker: "`pre-m0/selection-record.draft.json` has all five approval fields null and four " +
      "blockingReasons, two of which are that no human reviewer and no human decision owner are " +
      "assigned. Those two are the maintainer's to fill; the other two are completeness of the " +
      "profile inventory and of the requirement candidates." },
  { name: "profileRegistrySha256", obligation: 2, value: digestOf(join(spec, "pre-m0/release-profiles.draft.json")),
    note: "the selection record carries null for this; it is computable from the file that exists " +
      "and is computed here rather than copied from the null." },
  { name: "selectionRecordSha256", obligation: 2, value: digestOf(join(spec, "pre-m0/selection-record.draft.json")),
    note: "SELF-SUPERSEDING, and nothing else records that. The selection record must itself carry " +
      "`profileRegistrySha256` and `bootstrapRequirementsSha256`, which are null today; filling " +
      "them with their computed values changes this digest. So this value is guaranteed to move " +
      "when the record is completed, and a reader comparing it later must expect that." },
  { name: "activeRequirementIds", obligation: 2,
    value: (() => {
      // BOTH READINGS, because both are computable and the first version wrote null on the grounds
      // that one of them was blocked. "Active" can mean activation-frontier-arrived or
      // reviewed-and-registered; which governs is a person's call, and a report that answers
      // neither is less useful than one that answers both and names the fork.
      const registry = JSON.parse(readFileSync(join(spec, "pre-m0/bootstrap.requirements.candidate.json"), "utf8"));
      const rows = Array.isArray(registry) ? registry : (registry.requirements ?? registry.rows ?? []);
      return {
        byActivationFrontier: rows.length,
        byReviewStatus: rows.filter((/** @type {any} */ r) => r.reviewStatus !== "unreviewed").length,
        total: rows.length,
      };
    })(),
    note: "which reading governs `active` is undecided: every activation milestone has arrived by " +
      "M-R, so the frontier reading admits all of them, while zero rows are reviewed, so the " +
      "review reading admits none. Recorded as both rather than as one number that would be right " +
      "by accident. Also measured: 0 of these ids match plan 8.6's mandated immutable form " +
      "`LJ-<AREA>-NNN` — every one is `BOOT-M0-NNNN`." },
  { name: "activeEvidenceIds", obligation: 2, value: null,
    reason: "evidence closure would have no edges: zero of the corpus's cases carry a " +
      "`requirementIds` value, so there is nothing linking a requirement to what discharges it. " +
      "Measured, not inferred." },

  { name: "cldrVersion", obligation: 3, value: core.cldrVersion },
  { name: "lokalizedCldrVersion", obligation: 3, value: null,
    reason: "plan 7.3's own field table defines this as \"Shared pipeline release; null until " +
      "extraction\". Null is the specified value here, not a gap." },
  { name: "behavioralVectorsVersion", obligation: 3, value: core.behavioralVectorsVersion },
  { name: "dataFingerprint", obligation: 3, value: core.dataFingerprint },

  { name: "ianaRegistryDate", obligation: 4, value: core.ianaRegistryDate,
    note: "plan 7.3 defines this as the `File-Date` of a pinned IANA registry snapshot. There is no " +
      "snapshot: the closure comes from the JDK oracle directly, so the value is deliberately not " +
      "date-shaped. Keeping `jdk-oracle:<version>` rather than inventing a plausible date is " +
      "amendment A9's decision." },
  { name: "ianaDataFingerprint", obligation: 4, value: core.ianaDataFingerprint },
  { name: "referenceJdkVendor", obligation: 4, value: referenceJdk.vendor,
    note: "plan :2612 pins an Eclipse Temurin image and every oracle recording in this project was " +
      "made on Amazon Corretto. The value is what was actually used; the divergence is the point of " +
      "recording it." },
  { name: "referenceJdkVersion", obligation: 4, value: referenceJdk.version },
  { name: "referenceJdkRuntimeVersion", obligation: 4, value: referenceJdk.runtimeVersion },
  { name: "referenceJdkImageDigest", obligation: 4, value: null,
    reason: "no container image is used; the JDK is an unpacked directory on the build host, so " +
      "there is no image to digest." },

  { name: "requiredPortableIds", obligation: 5, value: idSet(requiredPortableIds) },
  { name: "requiredImplementationIds", obligation: 5, value: idSet(requiredImplementationIds),
    note: "empty BY CONSTRUCTION rather than by outcome: no corpus case uses that partition, and " +
      "the schema's conditional for it has never executed. An empty set here is not a pass." },
  { name: "passedIds", obligation: 5, value: idSet(passedIds) },
  { name: "failedIds", obligation: 5, value: idSet([...conformance.failedIds].sort()) },
  { name: "xfailedIds", obligation: 5, value: idSet([]),
    note: "empty because THERE IS NO XFAIL MECHANISM, not because nothing is xfailed: zero of the " +
      "corpus's cases carry an `xfail` field. \"No failures\" and \"no mechanism\" are different " +
      "facts and a release report must not blur them." },
  { name: "unsupportedIds", obligation: 5, value: idSet([...conformance.notImplementedIds].sort()),
    note: "\"unsupported\" here is the NOT-IMPLEMENTED-YET bucket, which is what `npm run " +
      "conformance` reports and what 8.5's strict-partition rule is about. The artifact's own " +
      "`unsupportedIds` field is a wider 213 = 43 refused by design + 170 with no JVM counterpart; " +
      "both are carried separately below so the two senses cannot be confused." },
  { name: "refusedByDesignIds", obligation: 5, value: idSet([...conformance.byDesignIds].sort()) },
  { name: "noCounterpartIds", obligation: 5, value: idSet([...conformance.nonportableIds].sort()) },

  { name: "xfailMetadata", obligation: 6, value: [],
    note: "no xfail mechanism exists, so there is no metadata to carry. See `xfailedIds`." },
  { name: "sourceDateEpoch", obligation: 6,
    value: (() => { try { return Number(execFileSync("git", ["-C", root, "log", "-1", "--format=%ct"], { encoding: "utf8" }).trim()); } catch { return null; } })(),
    note: "derived from the COMMIT, because the package is at 0.0.0 with no release tag. When a " +
      "release tag exists this should prefer it; recorded here rather than left to be discovered." },
];



/**
 * THE STRICT PARITY GATE, computed rather than asserted, with its arithmetic shown.
 *
 * Plan 8.5: "The strict required partition must show zero failed, xfailed, and unsupported IDs."
 * Every sense of "unsupported" is checked, because the artifact uses the word more widely than the
 * runner prints it and a rule keyed on one sense would pass over the other.
 */
const strictPartition = (() => {
  const required = new Set(requiredPortableIds);
  const overlap = (/** @type {string[]} */ ids) => ids.filter((id) => required.has(id)).sort();
  const notPassing = requiredPortableIds.filter((id) => !new Set(passedIds).has(id));
  const buckets = {
    failed: overlap(conformance.failedIds),
    xfailed: [],
    notImplemented: overlap(conformance.notImplementedIds),
    refusedByDesign: overlap(conformance.byDesignIds),
    noCounterpart: overlap(conformance.nonportableIds),
  };
  const met = notPassing.length === 0 && Object.values(buckets).every((ids) => ids.length === 0);
  return { met, requiredCount: requiredPortableIds.length, passingCount: requiredPortableIds.length - notPassing.length,
    notPassing, ...Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])) };
})();

/* ------------------------------------------------------------------------------- the assembly */
const byObligation = new Map(obligations.map((/** @type {any} */ o) => [o.index, o]));
for (const field of FIELDS) {
  if (!byObligation.has(field.obligation))
    problems.push(`field '${field.name}' claims obligation ${field.obligation}, which plan 8.5 does not state`);
  if (field.value === null && !field.reason && !field.blocker)
    problems.push(`field '${field.name}' is null and records neither a reason nor a blocker — ` +
      `an unexplained null is exactly what this report exists not to publish`);
}
/**
 * **THE FIVE OBLIGATIONS 8.5 STATES IN PROSE ARE BEHAVIOURS, NOT FIELDS, AND THEY MUST STILL BE
 * DISCHARGED BY SOMETHING NAMED.** The first version of this check required a field only for the
 * seven `content` bullets, so it passed with the other five discharged by nothing at all — the
 * report claimed twelve obligations and answered seven. That is the shape this project keeps
 * finding: a completeness term that checks the half you were thinking about.
 *
 * Each entry names a MECHANISM that must exist on disk. A mechanism whose file is missing fails
 * here rather than being taken on the word of this table.
 */
const MECHANISMS = {
  embedded: { by: "package.json#files carries the report and DIVERGENCES.md; tools/release-check.mjs asserts both are in the packed tarball",
    requires: ["measurements/lokalized-parity.json", "DIVERGENCES.md"] },
  byteIdentity: { by: "tools/release-check.mjs compares the tarball's copy to the working tree's and to a regeneration",
    requires: ["tools/release-check.mjs"] },
  strictPartition: { by: "the `strictPartition` block below, computed from the corpus partitions and the conformance record, which fails this tool when not met",
    requires: ["measurements/conformance.json"] },
  divergences: { by: "tools/divergences.mjs generates DIVERGENCES.md from the declared divergence records",
    requires: ["tools/divergences.mjs", "DIVERGENCES.md"] },
  volatileOutside: { by: "this tool's `--check` arm regenerates and compares byte-for-byte, so any volatile field fails on the next run",
    requires: [] },
};

for (const obligation of obligations) {
  if (obligation.kind === "content") {
    if (!FIELDS.some((f) => f.obligation === obligation.index))
      problems.push(`plan 8.5 states an obligation no field discharges: ${obligation.sentence}`);
    continue;
  }
  const mechanism = MECHANISMS[/** @type {keyof typeof MECHANISMS} */ (obligation.kind)];
  if (!mechanism) {
    problems.push(`plan 8.5 states a '${obligation.kind}' obligation and nothing discharges it: ${obligation.sentence}`);
    continue;
  }
  for (const path of mechanism.requires)
    if (digestOf(join(root, path)) === null)
      problems.push(`the '${obligation.kind}' obligation is discharged by ${path}, which does not exist`);
}

// THE STRICT PARTITION IS A RELEASE GATE, not a reported number. Plan 8.5 says it "must show zero".
if (!strictPartition.met)
  problems.push(`the strict required partition is NOT met: ${strictPartition.notPassing.length} of ` +
    `${strictPartition.requiredCount} required case(s) are not passing`);

const report = {
  $comment: "GENERATED by tools/parity-report.mjs from plan section 8.5's derived obligation list. " +
    "Do not edit. A null value is always accompanied by a reason or a blocker.",
  formatVersion: 1,
  planSection: "8.5",
  status: FIELDS.some((f) => f.blocker) ? "incomplete" : "complete",
  fields: Object.fromEntries(FIELDS.map((f) => [f.name, f.value])),
  undetermined: FIELDS.filter((f) => f.value === null).map((f) => ({
    field: f.name, obligation: byObligation.get(f.obligation)?.sentence ?? null,
    ...(f.reason ? { reason: f.reason } : {}), ...(f.blocker ? { blocker: f.blocker } : {}),
  })),
  notes: Object.fromEntries(FIELDS.filter((f) => f.note).map((f) => [f.name, f.note])),
  strictPartition,
  obligations: obligations.map((/** @type {any} */ o) => ({
    index: o.index, kind: o.kind, statementSha256: o.statementSha256,
    dischargedBy: o.kind === "content"
      ? FIELDS.filter((f) => f.obligation === o.index).map((f) => f.name)
      : [MECHANISMS[/** @type {keyof typeof MECHANISMS} */ (o.kind)]?.by ?? "NOTHING"],
  })),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
const write = process.argv.includes("--write");
if (write) {
  writeFileSync(OUTPUT, serialized);
} else {
  let recorded = "";
  try { recorded = readFileSync(OUTPUT, "utf8"); }
  catch { problems.push(`${OUTPUT} does not exist. Re-record with: node tools/parity-report.mjs --write`); }
  if (recorded && recorded !== serialized)
    problems.push("the recorded parity declaration is not what this run produces — either the build " +
      "moved and it must be re-recorded deliberately, or something non-deterministic has entered it");
}

console.log(`release parity declaration — ${pkg.name}@${pkg.version}, ${report.status}`);
console.log(`  strict required partition: ${strictPartition.passingCount}/${strictPartition.requiredCount} passing, ` +
  `${strictPartition.failed} failed, ${strictPartition.xfailed} xfailed, ${strictPartition.notImplemented} unsupported` +
  ` — ${strictPartition.met ? "MET" : "NOT MET"}`);
console.log(`  ${FIELDS.length} field(s) across ${obligations.length} obligation(s); ` +
  `${report.undetermined.length} undetermined, ${FIELDS.filter((f) => f.blocker).length} waiting on a person`);
if (write) console.log(`  re-recorded ${OUTPUT.replace(`${root}/`, "")}`);
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exit(1);
}
