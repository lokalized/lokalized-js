#!/usr/bin/env node
// @ts-check
/**
 * `reference-runtime-lock.json` — plan 8.4's record of the JDK the oracle runs on.
 *
 * Plan 8.4: "M0 records the exact vendor, update/build string, and immutable image digest in
 * `reference-runtime-lock.json`; the archive and parity report repeat them." **The file did not
 * exist.** `find` across all four trees returned zero of that name, and the parity report's
 * `referenceJdkImageDigest` was `null` with nothing to compare against.
 *
 * **WHY ITS ABSENCE WAS MORE THAN A MISSING FILE.** On a CI runner there is no JDK, so the parity
 * report's oracle-derived fields are CARRIED from the record rather than re-measured — and with
 * nothing to carry them AGAINST, a perturbed `referenceJdkVendor` exits 0 there. Measured in M-R
 * S13. CI was embedding the report against a RECORD of the references, not against the references.
 * This lock is the thing a JDK-less run can check, so the carry stops being unfalsifiable.
 *
 * **TWO DIVERGENCES FROM 8.4, RECORDED RATHER THAN PAPERED OVER.**
 *  - The plan pins "a repository-pinned Eclipse Temurin JDK 21 image"; the actual reference is
 *    Amazon Corretto 21.0.11. That is blocker B8 and the maintainer's to resolve; it is stated in
 *    the lock so no reader mistakes the lock for compliance.
 *  - "Immutable image digest" presumes a CONTAINER, and this project runs a JDK installed on the
 *    host. There is no image, so there is no image digest, and inventing a plausible one is the
 *    defect class this project has caught repeatedly. What IS pinnable is the distribution's own
 *    identity: the sha256 of its `release` file, which carries the vendor, version, build string and
 *    the source revision the build came from. It is recorded under its own name — `releaseFileSha256`
 *    — so it can never be read as the image digest the plan asked for.
 *
 *   node tools/reference-runtime-lock.mjs --write   (needs the pinned JDK)
 *   node tools/reference-runtime-lock.mjs           verify; no JDK needed unless one is present
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(root, "measurements/reference-runtime-lock.json");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";
const sha256 = (/** @type {string | Buffer} */ bytes) => createHash("sha256").update(bytes).digest("hex");

/** Read the JDK's own `release` file — the distribution's self-description, not ours. */
function observe() {
  const releasePath = join(JDK, "release");
  if (!existsSync(releasePath)) return null;
  const text = readFileSync(releasePath, "utf8");
  const field = (/** @type {string} */ name) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(text)?.[1] ?? null;
  return {
    vendor: field("IMPLEMENTOR"),
    version: field("JAVA_VERSION"),
    buildString: field("IMPLEMENTOR_VERSION"),
    versionDate: field("JAVA_VERSION_DATE"),
    architecture: field("OS_ARCH"),
    imageDigest: null,
    imageDigestNote: "plan 8.4 asks for an immutable IMAGE digest, which presumes a container. This " +
      "reference is a JDK installed on the host, so there is no image and none is invented. " +
      "`releaseFileSha256` pins the distribution's own identity instead and is named differently so " +
      "it cannot be read as the thing the plan asked for.",
    releaseFileSha256: sha256(text),
    divergenceFromPlan: "plan :2612 pins Eclipse Temurin; this is Amazon Corretto. Blocker B8, the " +
      "maintainer's to resolve. Recorded here so the lock is not mistaken for compliance.",
  };
}

/**
 * THE JAVA REFERENCE IS CARRIED ON CI FOR THE SAME REASON AND NEEDS THE SAME PIN. The clause names
 * four references — Java, CLDR, IANA and JDK. CLDR and IANA are pinned by the spec repo's own locks,
 * which CI checks out. The JDK is pinned above. The Java commit and version were the remaining pair
 * carried from the record with nothing to carry them against.
 */
function observeJava() {
  const java = resolve(root, "../lokalized-java");
  if (!existsSync(join(java, "pom.xml"))) return null;
  const git = { cwd: java, encoding: /** @type {const} */ ("utf8"), stdio: /** @type {const} */ (["ignore", "pipe", "ignore"]) };
  const at = (/** @type {string[]} */ args) => { try { return execFileSync("git", args, git).trim(); } catch { return null; } };
  const pom = readFileSync(join(java, "pom.xml"), "utf8");
  return {
    version: /<version>([^<]+)<\/version>/.exec(pom)?.[1] ?? null,
    commit: at(["rev-parse", "HEAD"]),
  };
}

const write = process.argv.includes("--write");
const observed = observe();
const observedJava = observeJava();

if (write) {
  if (!observed) {
    console.error(`--write needs the pinned JDK and ${JDK} has no \`release\` file.\n` +
      "Set LOKALIZED_ORACLE_JDK. The lock must be written where the reference actually is; writing it " +
      "from a machine without the JDK would record a guess.");
    process.exit(1);
  }
  if (!observedJava) {
    console.error("--write needs ../lokalized-java too: the Java reference is half of what this locks.");
    process.exit(1);
  }
  writeFileSync(LOCK, `${JSON.stringify({ formatVersion: 1, jdk: observed, javaReference: observedJava }, null, 2)}\n`);
  console.log(`recorded measurements/reference-runtime-lock.json — ${observed.vendor} ${observed.buildString}`);
  process.exit(0);
}

const problems = [];
if (!existsSync(LOCK)) {
  console.error("measurements/reference-runtime-lock.json is absent, so nothing pins the reference runtime and " +
    "a JDK-less run cannot tell a correct reference field from a perturbed one. Run --write on the oracle machine.");
  process.exit(1);
}
const lock = JSON.parse(readFileSync(LOCK, "utf8"));

// WHERE THE JDK IS PRESENT, the lock is checked against the real thing. Where it is absent — every CI
// runner — this is skipped and SAID to be skipped, rather than passing silently.
if (observed) {
  for (const key of ["vendor", "version", "buildString", "releaseFileSha256"]) {
    if (lock.jdk?.[key] !== observed[key])
      problems.push(`the lock records ${key} ${JSON.stringify(lock.jdk?.[key])} but the JDK at ${JDK} reports ` +
        `${JSON.stringify(observed[key])}; re-run --write if the reference moved deliberately`);
  }
  console.log(`  the pinned JDK is present and matches the lock (${lock.jdk.vendor} ${lock.jdk.buildString})`);
} else {
  console.log("  the pinned JDK is absent here, so the lock is not re-derived; the parity report is still");
  console.log("  compared against it, which is what makes a JDK-less run able to catch a perturbed field");
}

// THE HALF THAT NEEDS NO JDK, and the reason this file closes anything: the shipped parity
// declaration must REPEAT the lock, which is plan 8.4's own word for it.
const parity = JSON.parse(readFileSync(join(root, "measurements/lokalized-parity.json"), "utf8")).fields;
const repeated = { referenceJdkVendor: "vendor", referenceJdkVersion: "version", referenceJdkRuntimeVersion: "buildString" };
for (const [reportField, lockField] of Object.entries({ javaReferenceVersion: "version", javaReferenceCommit: "commit" })) {
  if (parity[reportField] !== lock.javaReference?.[lockField])
    problems.push(`the parity report's ${reportField} is ${JSON.stringify(parity[reportField])} but the lock ` +
      `records ${JSON.stringify(lock.javaReference?.[lockField])}; the report must repeat the lock`);
}
for (const [reportField, lockField] of Object.entries(repeated)) {
  if (parity[reportField] !== lock.jdk?.[lockField])
    problems.push(`the parity report's ${reportField} is ${JSON.stringify(parity[reportField])} but the lock ` +
      `records ${JSON.stringify(lock.jdk?.[lockField])}. Plan 8.4 requires the report to REPEAT the lock; a ` +
      "report that disagrees with it describes a reference the oracle did not run on.");
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("  the parity declaration repeats the reference-runtime lock exactly");
