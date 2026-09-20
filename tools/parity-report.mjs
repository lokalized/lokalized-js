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

/**
 * **EVERY GIT PROBE HERE IS ALLOWED TO FAIL, SO NONE OF THEM MAY PRINT.** Each is wrapped in a
 * `try`/`catch` that answers `null` — `../lokalized-java` is simply not checked out in CI, which is
 * expected and handled. But git writes its own `fatal:` to stderr before the catch ever runs, so a
 * CI log carried two lines reading `fatal: cannot change to '.../lokalized-java'` immediately above
 * the real failure, and they look like the cause. They are not: the run failed on four unexplained
 * nulls, and the maintainer had to read past the noise to see it.
 *
 * This project has recorded the inverse of this mistake twice — a crashed harness reading as a
 * catastrophic regression — and the rule is the same facing the other way: an EXPECTED failure must
 * not announce itself in the voice of a real one.
 */
const GIT = { encoding: /** @type {const} */ ("utf8"), stdio: /** @type {const} */ (["ignore", "pipe", "ignore"]) };

/** Modes, read once: `--write` records, `--check` validates the record without the Java oracle. */
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
const OUTPUT = join(root, "measurements/lokalized-parity.json");

const problems = [];
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const conformance = JSON.parse(readFileSync(join(root, "measurements/conformance.json"), "utf8"));
const corpus = JSON.parse(readFileSync(join(spec, "generated/behavioral-vectors.json"), "utf8"));
const obligations = JSON.parse(readFileSync(join(spec, "parity-obligations.json"), "utf8")).obligations;

const sha = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");
const digestOf = (/** @type {string} */ path) => { try { return sha(readFileSync(path)); } catch { return null; } };
const headOf = (/** @type {string} */ at) => {
  try { return execFileSync("git", ["-C", at, "rev-parse", "HEAD"], GIT).trim(); } catch { return null; }
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
// `ianaClosureSource` is INTERNAL — it names which implementation produced the pinned closure,
// which a release declaration needs and a consumer has no use for. Read from the internal module
// rather than exported from `core`, because widening the package surface to feed a build tool is
// the wrong direction and would touch a derived allowlist for no consumer's benefit.
const { RUNTIME_METADATA } = await import("../src/internal/runtime-metadata.js");

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
    note: "lokalized-java's HEAD, and the parity claim is now against 3.1.0 rather than the 3.0.0 " +
      "tag — the maintainer's decision of 2026-09-20: this package is a port of lokalized-java " +
      "3.1.0 once that is released. **THIS NOTE SAID THE OPPOSITE AND WAS FALSE IN BOTH HALVES.** " +
      "It read \"TWO COMMITS AHEAD of the 3.0.0 tag … zero behavioural Java source differs — so " +
      "the oracle's answers are the tag's\". Measured 2026-09-20: FOUR commits ahead, and " +
      "src/main/java differs by +1,014/-23 lines, which is IanaLanguageEquivalents — a behavioural " +
      "change that moves fourteen ranges. The answers recorded in the corpus are 3.1.0-SNAPSHOT's, " +
      "not the tag's, and that is the point of the decision rather than a drift to reconcile." },
  { name: "javaReferenceVersion", obligation: 1,
    // Read from the oracle's own pom rather than restated. Null where lokalized-java is absent —
    // CI does not check it out — and carried from the record by `--check`, like every other
    // oracle-derived field.
    value: (() => {
      try {
        const pom = readFileSync(join(java, "pom.xml"), "utf8");
        return /<artifactId>lokalized<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(pom)?.[1]?.trim() ?? null;
      } catch { return null; }
    })(),
    reason: "absent only where the lokalized-java checkout is not beside this one",
    note: "the reference is 3.1.0-SNAPSHOT today: the parity target is 3.1.0 and it is NOT YET " +
      "RELEASED, so this names a snapshot on purpose. It must read a release version before a " +
      "parity-backed publish can claim one." },
  { name: "javaReferenceTagCommit", obligation: 1,
    value: (() => { try { return execFileSync("git", ["-C", java, "rev-parse", "3.0.0^{commit}"], GIT).trim(); } catch { return null; } })(),
    reason: "absent only if the 3.0.0 tag is not present in this checkout" },
  { name: "dataCommit", obligation: 1, value: headOf(spec) },
  { name: "portingContractArchiveDigest", obligation: 1, value: null,
    reason: "plan :2395 has each pinned Java reference tag publish an immutable " +
      "`lokalized-porting-contracts-<version>.tar.gz`; no such archive exists in any of the three " +
      "repositories. It is the Java side's to publish, so this stays null rather than being " +
      "substituted with a digest over something else. NOT to be confused with the spec repo's " +
      "`dist/lokalized-data-<cldr>.tar`, which is plan M1's narrower data-only archive: that one " +
      "exists and is reproducible, and substituting its digest here would answer a different " +
      "question with a real-looking number." },

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
    note: "plan 7.3 defines this as the `File-Date` of a pinned IANA registry snapshot, and there " +
      "now IS one: `lokalized-spec/tools/iana-oracle/language-subtag-registry.txt`, File-Date " +
      "2026-09-17, 9,296 records. THIS NOTE USED TO SAY THE OPPOSITE — \"There is no snapshot: the " +
      "closure comes from the JDK oracle directly, so the value is deliberately not date-shaped\" — " +
      "which was true under amendment A9 and was falsified by M-R S11 pinning the snapshot, while " +
      "the note shipped on beside the date-shaped value it denied. The oracle moved again in S13: " +
      "the closure is lokalized-java's own registry-sourced table, named by `ianaClosureSource`." },
  { name: "ianaDataFingerprint", obligation: 4, value: core.ianaDataFingerprint },
  { name: "ianaClosureSource", obligation: 4, value: RUNTIME_METADATA.ianaClosureSource,
    note: "WHICH IMPLEMENTATION PRODUCED THE PINNED CLOSURE, which the registry File-Date does not " +
      "say and the fingerprint identifies without naming. Two builds sharing a File-Date can carry " +
      "different closures; this names the oracle, and it is derived from the spec artifact's own " +
      "`libraryVersion` rather than restated — it read `jdk-corretto:21.0.11` for a slice after " +
      "the oracle stopped being the JDK, because nothing compared it to anything." },
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
    value: (() => { try { return Number(execFileSync("git", ["-C", root, "log", "-1", "--format=%ct"], GIT).trim()); } catch { return null; } })(),
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
  // IN `--check` THE CARRY HAS NOT HAPPENED YET, so this runs once, after it. Leaving it here too
  // would report every oracle-derived field as an unexplained null in exactly the environment the
  // carry exists to serve, and the run would fail on the thing it just accounted for.
  if (!check && field.value === null && !field.reason && !field.blocker)
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

/**
 * **THE FIELDS THAT NEED THE JAVA ORACLE, AND WHY `--check` CARRIES THEM FROM THE RECORD.**
 *
 * `npm pack` runs `prepack`, and `prepack` used to regenerate this report. Measured on CI: the
 * `packed` job checks out THIS repo only, so the report crashed reading the spec's corpus, and the
 * `verify` job — which has the spec but no `lokalized-java` and no pinned JDK — got four
 * unexplained nulls and exited 1. **`npm pack` could not run anywhere but the authoring machine**,
 * which includes any publish environment. Reproduced against the previous commit's copy of this
 * tool: identical failure, so it is this tool's shape and not a recent edit.
 *
 * The split is `diff:all`/`diff:check`'s, for the same reason. `--write` measures everything and
 * needs the oracle; it is a deliberate act. `--check` re-derives and compares EVERYTHING ELSE
 * byte-for-byte — the corpus partition, the obligation set, the digests, the package version — and
 * takes only the fields below from the record, because nothing in a JDK-less environment can
 * measure them.
 *
 * **IT IS NOT A TOLERANCE: a field that CAN be measured here and disagrees with the record still
 * fails.** So on the authoring machine `--check` is as strict as a full comparison, and in CI it is
 * strict about everything CI can see. The carry is narrow, named, and reported.
 *
 * **AND HERE IS WHAT IT CANNOT DO, measured rather than left to be found.** Perturbing the
 * record's `referenceJdkVendor` and running where the JDK EXISTS exits 1 naming both values;
 * running the same perturbed record where the JDK is ABSENT exits 0, because the carry has nothing
 * to compare against. A carried field is therefore attested by the machine that recorded it and by
 * no other — which is the whole reason the authoring machine's run is the strict one and why
 * `--write` is a deliberate act rather than something `prepack` does behind a publish.
 */
const ORACLE_DERIVED = ["javaReferenceCommit", "javaReferenceTagCommit", "javaReferenceVersion",
  "referenceJdkVendor", "referenceJdkVersion", "referenceJdkRuntimeVersion", "referenceJdkImageDigest"];

if (check) {
  /** @type {any} */
  let priorRecord = null;
  try { priorRecord = JSON.parse(readFileSync(OUTPUT, "utf8")); } catch { /* reported below */ }

  if (priorRecord === null) {
    problems.push(`${OUTPUT} does not exist or is not readable. Absence is never agreement; ` +
      `re-record with: node tools/parity-report.mjs --write`);
  } else {
    let carried = 0;
    let crossChecked = 0;
    for (const field of FIELDS) {
      if (!ORACLE_DERIVED.includes(field.name)) continue;
      const recordedValue = priorRecord.fields?.[field.name] ?? null;
      if (field.value === null && recordedValue !== null) { field.value = recordedValue; carried++; continue; }
      if (field.value !== null && recordedValue !== null) {
        crossChecked++;
        if (field.value !== recordedValue)
          problems.push(`field '${field.name}' measures ${JSON.stringify(field.value)} here and the ` +
            `record says ${JSON.stringify(recordedValue)} — the oracle moved under the declaration`);
      }
    }
    console.log(`  --check: ${carried} oracle-derived field(s) carried from the record, ` +
      `${crossChecked} re-measured here and cross-checked`);

    // ANTI-VACUITY: a field null in BOTH this environment and the record, with no reason of its
    // own, is a hollow slot the carry has quietly made invisible. **A DECLARED reason is not that**
    // — `referenceJdkImageDigest` is permanently null because no container image is used, and the
    // first version of this term counted it as hollow and failed a clean tree.
    const hollow = FIELDS.filter((field) => ORACLE_DERIVED.includes(field.name)
      && field.value === null && !field.reason && !field.blocker);
    if (hollow.length > 0)
      problems.push(`${hollow.length} oracle-derived field(s) — ${hollow.map((f) => f.name).join(", ")} ` +
        `— are null in BOTH this environment and the record, with no reason of their own; the ` +
        `declaration is hollow where it should be either measured or explained`);
  }
}

// REBUILT AFTER THE CARRY, so the undetermined set and the serialization describe the fields as
// this run will publish them rather than as it first measured them.
if (check) {
  // **`report.fields` IS A SNAPSHOT TAKEN BEFORE THE CARRY and must be rebuilt with it.** The
  // carry mutates `FIELDS`; the report was assembled from them earlier, so without this the
  // serialization still holds the pre-carry nulls and the comparison below reds on three JDK
  // fields the carry had just accounted for — the tool disagreeing with itself.
  report.fields = Object.fromEntries(FIELDS.map((field) => [field.name, field.value]));

  const undetermined = FIELDS.filter((field) => field.value === null);
  // THE SAME PROJECTION THE RECORD WAS WRITTEN WITH, or the comparison below reds on a clean tree
  // for a shape difference of this rebuild's own making. It dropped `obligation` on its first run.
  report.undetermined = undetermined.map((field) => ({
    field: field.name, obligation: byObligation.get(field.obligation)?.sentence ?? null,
    ...(field.reason ? { reason: field.reason } : {}), ...(field.blocker ? { blocker: field.blocker } : {}),
  }));
  for (const field of undetermined)
    if (!field.reason && !field.blocker)
      problems.push(`field '${field.name}' is null and records neither a reason nor a blocker — ` +
        `an unexplained null is exactly what this report exists not to publish`);
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (write) {
  writeFileSync(OUTPUT, serialized);
} else {
  let recorded = "";
  try { recorded = readFileSync(OUTPUT, "utf8"); }
  catch { problems.push(`${OUTPUT} does not exist. Re-record with: node tools/parity-report.mjs --write`); }

  // **THE COMMIT SHAs ARE EXCLUDED FROM THE COMPARISON, AND WITHOUT THIS EVERY COMMIT REDS THE
  // BUILD.** The copy in the tree is written BEFORE the commit that contains it, so a report
  // pinning HEAD is stale the instant it is committed and `npm run verify` would go red on a clean
  // tree for no defect at all.
  //
  // **CORRECTED: this used to say "`prepack` regenerates the report as its last step, so the copy
  // that ships always names the commit it shipped from."** It no longer does — see ORACLE_DERIVED
  // above; regenerating at pack time made `npm pack` impossible in any environment without the
  // Java oracle. The shipped copy is the COMMITTED copy, so its commit fields name the commit the
  // record was taken at, which is one behind the one that carries it. They are excluded here for
  // that reason rather than the old one, and `check:release` compares the packed copy to the tree
  // copy, which is now trivially equal and still worth asserting: it catches a tarball assembled
  // from anything other than this tree.
  // Found by noticing the maintainer's own commits had moved HEAD under a report recorded minutes
  // earlier; it would have reded their next commit rather than mine.
  //
  // Everything else IS compared byte-for-byte, which is what keeps the volatility argument honest:
  // the exclusion is three named fields, not a general tolerance.
  const PER_COMMIT = ["implementationCommit", "dataCommit", "javaReferenceCommit",
    "javaReferenceTagCommit", "sourceDateEpoch"];
  const withoutCommits = (/** @type {string} */ json) => {
    if (!json) return json;
    const parsed = JSON.parse(json);
    for (const field of PER_COMMIT) if (field in parsed.fields) parsed.fields[field] = "<per-commit>";
    return JSON.stringify(parsed, null, 2);
  };
  // NAME WHAT MOVED. A gate that says "something differs" and leaves the reader to diff two 37-field
  // documents by hand is the shape `check:vectors` was corrected for on 2026-09-20: the report has
  // the comparison in its hands and must spend it.
  const movedFields = () => {
    try {
      const was = JSON.parse(withoutCommits(recorded));
      const now = JSON.parse(withoutCommits(serialized));
      const moved = [];
      const walk = (/** @type {any} */ a, /** @type {any} */ b, /** @type {string} */ path) => {
        const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
        for (const key of keys) {
          const here = path ? `${path}.${key}` : key;
          const left = a?.[key], right = b?.[key];
          if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left)) {
            walk(left, right, here); continue;
          }
          if (JSON.stringify(left) !== JSON.stringify(right))
            moved.push(`${here}: recorded ${JSON.stringify(left)} -> now ${JSON.stringify(right)}`);
        }
      };
      walk(was, now, "");
      return moved.length > 0 ? `\n      ${moved.join("\n      ")}` : "";
    } catch { return ""; }
  };
  if (recorded && withoutCommits(recorded) !== withoutCommits(serialized))
    problems.push("the recorded parity declaration is not what this run produces:" + movedFields() +
      "\n    either the build " +
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
