// @ts-check
/**
 * `RUNTIME_METADATA` — the pin behind the constants.
 *
 * **WHY THIS FILE EXISTS AT ALL.** `src/` may not touch a Node built-in, so the rendering core's
 * identity has to be written into source as literals. Literals drift. Every value in
 * `src/internal/runtime-metadata.js` claims to describe an artifact that lives somewhere else —
 * `package.json`, `lokalized-spec`'s two locks — and this file is the only thing that compares the
 * claim to the artifact. Without it the constants would be a description of the build rather than a
 * property of it, which is the exact shape of the four texts this project has now caught asserting
 * the inverse of what they described.
 *
 * Each assertion below fails in BOTH directions on purpose: the constant moving, and the artifact
 * moving under it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { RUNTIME_METADATA } from "../src/internal/runtime-metadata.js";
import { IANA_DATA_LOCK, IANA_EQUIVALENCES_ARTIFACT, specDirectory, specPath } from "../tools/iana-artifact.mjs";

const root = new URL("../", import.meta.url);
const specDir = specDirectory();

const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

/** @type {any} */ let ianaLock = null;
/** @type {any} */ let ianaArtifact = null;
/** @type {string | null} */ let vectorsVersion = null;
try {
  ianaLock = JSON.parse(await readFile(specPath(IANA_DATA_LOCK), "utf8"));
  ianaArtifact = JSON.parse(await readFile(specPath(IANA_EQUIVALENCES_ARTIFACT), "utf8"));
  vectorsVersion = JSON.parse(
    await readFile(resolve(specDir, "generated/behavioral-vectors.json"), "utf8"),
  ).behavioralVectorsVersion;
} catch {
  // Sibling spec checkout absent; the spec-backed assertions skip, the package one still runs.
}
const skip = ianaLock && ianaArtifact ? false : `lokalized-spec IANA artifacts not found at ${specDir}`;

const sha256 = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * RFC 8785 JCS for the values a lock projection holds: strings, safe integers, arrays and plain
 * objects with sorted keys. Anything else THROWS rather than being serialized some plausible way,
 * because a canonicalizer that guesses is a fingerprint that silently disagrees.
 * @param {unknown} value @returns {string}
 */
function jcs(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(/** @type {any} */ (value)[key])}`).join(",")}}`;
  throw new TypeError(`jcs: ${JSON.stringify(value)} is outside the lock projection's value space`);
}

/**
 * Plan 5.1 :1680-1682's fingerprint projection of a lock: exactly these six fields, with each
 * artifact entry projected to `{path, sha256}` (":1681 — artifact entries are path/hash records").
 * The lock also carries `note`, `generator`, `inputs` and each artifact's `inputsSha256`; none of
 * them is fingerprinted, which is what lets a generator's own source move without moving the data's
 * identity.
 * @param {any} lock
 */
function ianaFingerprintProjection(lock) {
  const fields = ["formatVersion", "ianaRegistryDate", "sourceSha256", "closureSchemaVersion", "artifacts",
    "compatibilityOverridesSha256"];
  const missing = fields.filter((field) => !(field in lock));
  // NAMED, not skipped: a lock that does not carry the projection cannot be recomputed, and falling
  // back to copying its recorded digest is how this test would stop checking anything.
  if (missing.length > 0) throw new Error(`the IANA lock lacks plan :1680's field(s) ${missing.join(", ")}`);
  return {
    formatVersion: lock.formatVersion,
    ianaRegistryDate: lock.ianaRegistryDate,
    sourceSha256: lock.sourceSha256,
    closureSchemaVersion: lock.closureSchemaVersion,
    artifacts: lock.artifacts.map((/** @type {any} */ { path, sha256: digest }) => ({ path, sha256: digest })),
    compatibilityOverridesSha256: lock.compatibilityOverridesSha256,
  };
}

test("producerVersion IS package.json's version", () => {
  // Plan 6.4 compares this field EXACTLY across the hydration boundary, so a release that bumps the
  // package and not this constant would ship stamps claiming the previous build.
  assert.equal(RUNTIME_METADATA.producerVersion, pkg.version);
});

test("producerImplementation is the plan's literal, NOT the package name", () => {
  // Plan 6.4 fixes the wire value; `package.json` names the package. They are deliberately
  // different strings, and asserting the difference is what stops a later "tidy-up" collapsing them.
  assert.equal(RUNTIME_METADATA.producerImplementation, "lokalized-js");
  assert.equal(pkg.name, "lokalized");
  assert.notEqual(RUNTIME_METADATA.producerImplementation, pkg.name);
});

/**
 * **RECOMPUTED, NOT COPIED.** Until A30 this compared the constant with the lock's recorded digest,
 * which proves the two were copied from each other and nothing about what the digest is OF. The lock
 * is format 2 now and carries plan 5.1 :1680-1682's projection, so the fingerprint is recomputed from
 * it here; and each artifact the projection names is re-hashed from disk, so the recorded
 * `artifacts[].sha256` cannot drift from the file either. A re-pinned snapshot, a reordered
 * compatibility row or a regenerated artifact moves the digest, and this fails until the constant
 * moves with it.
 */
test("ianaDataFingerprint recomputes from the lock's plan :1680 projection", { skip }, async () => {
  const recomputed = sha256(jcs(ianaFingerprintProjection(ianaLock)));
  assert.equal(recomputed, ianaLock.ianaDataFingerprint,
    "the lock's ianaDataFingerprint is not the digest of its own projection");
  assert.equal(RUNTIME_METADATA.ianaDataFingerprint, recomputed);

  assert.ok(ianaLock.artifacts.length > 0, "the lock names no artifact, so the fingerprint binds no data");
  for (const { path, sha256: recorded } of ianaLock.artifacts)
    assert.equal(sha256(await readFile(resolve(specDir, path))), recorded, `${path} is not the bytes the lock records`);
  assert.ok(ianaLock.artifacts.some((/** @type {any} */ entry) => entry.path === IANA_EQUIVALENCES_ARTIFACT),
    `the lock does not name ${IANA_EQUIVALENCES_ARTIFACT}, the artifact this package is generated from`);
  assert.equal(sha256(await readFile(specPath(ianaArtifact.registry.path))), ianaLock.sourceSha256,
    "the lock's sourceSha256 is not the registry snapshot the artifact names");
});

test("ianaRegistryDate IS the pinned registry snapshot's File-Date", { skip }, () => {
  // **DERIVED, NEVER A LITERAL.** Plan 5.1 defines the field as the snapshot's `File-Date`; the
  // artifact generated from the snapshot records it and so does the lock, and both must agree with
  // the constant. A snapshot re-fetch moves all three together or fails this.
  assert.equal(RUNTIME_METADATA.ianaRegistryDate, ianaArtifact.registry.fileDate);
  assert.equal(RUNTIME_METADATA.ianaRegistryDate, ianaLock.ianaRegistryDate);
  assert.match(RUNTIME_METADATA.ianaRegistryDate, /^\d{4}-\d{2}-\d{2}$/,
    "the field is defined as a File-Date and must be date-shaped");
  assert.equal(ianaArtifact.registry.sha256, ianaLock.sourceSha256,
    "the artifact and the lock name different registry snapshots");
});

/**
 * **THE ONE AUTHORED INPUT IS NAMED BY THE ARTIFACT AND HASHED BY THE LOCK.** The registry states
 * the region/variant substitutions one way and in no order; their ORDER is authored once, in the
 * spec's `tools/iana-oracle/jdk-compatibility.json`. What the date alone cannot say is that the data
 * is the registry PLUS that file, so the link is asserted three ways: the bytes on disk hash to what
 * the artifact records, to what the lock fingerprints, and the pairs the file authors ARE the pairs
 * the artifact publishes, in order.
 */
test("the artifact names its JDK-compatibility input and the lock hashes it", { skip }, async () => {
  const { path, sha256: recorded } = ianaArtifact.jdkCompatibility;
  const bytes = await readFile(specPath(path));
  assert.equal(sha256(bytes), recorded, `${path} is not the bytes the artifact records`);
  assert.equal(recorded, ianaLock.compatibilityOverridesSha256,
    "the lock fingerprints a different compatibility input than the artifact was generated from");

  const authored = JSON.parse(bytes.toString("utf8")).regionVariantEquivalents.pairs;
  assert.ok(authored.length > 0, "the compatibility input authors no substitution");
  assert.deepEqual(ianaArtifact.regionVariantEquivalents, authored,
    "the artifact's region/variant substitutions are not the authored ones, in order");
});

test("behavioralVectorsVersion IS the corpus's own version", { skip }, () => {
  assert.equal(RUNTIME_METADATA.behavioralVectorsVersion, vectorsVersion);
});

test("the two mode fields describe what this build actually does", () => {
  // Not a tautology: plan 6.4 lets strict hydration accept ONLY this pair, so these two literals are
  // the reason any stamp this build produces is hydratable at all. The constraints they encode are
  // enforced elsewhere — `test/pinned-data-only.test.js` for `pinned`, the exact selector's corpus
  // for `exact` — and this is where the CLAIM is written down next to them.
  assert.equal(RUNTIME_METADATA.localeDataMode, "pinned");
  assert.equal(RUNTIME_METADATA.cardinalityMode, "exact");
});

test("the record is frozen and carries exactly the declared fields", () => {
  assert.ok(Object.isFrozen(RUNTIME_METADATA));
  assert.deepEqual(Object.keys(RUNTIME_METADATA).sort(), [
    // `ianaClosureSource` joined in M-R S11 to name the implementation the probed closure was
    // recorded from, and LEFT at A30: the data is generated from the registry snapshot, so no
    // implementation produces it, and the snapshot is named by `ianaRegistryDate` and bound by
    // `ianaDataFingerprint` (plan :1680 fingerprints `sourceSha256`).
    "behavioralVectorsVersion", "cardinalityMode", "ianaDataFingerprint",
    "ianaRegistryDate", "localeDataMode", "producerImplementation", "producerVersion",
  ]);
});
