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
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { RUNTIME_METADATA } from "../src/internal/runtime-metadata.js";

const root = new URL("../", import.meta.url);
const specDir = process.env.LOKALIZED_SPEC_DIR ?? resolve(root.pathname, "../lokalized-spec");

const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

/** @type {any} */ let ianaLock = null;
/** @type {string | null} */ let vectorsVersion = null;
try {
  ianaLock = JSON.parse(await readFile(resolve(specDir, "generated/iana-data-lock.json"), "utf8"));
  vectorsVersion = JSON.parse(
    await readFile(resolve(specDir, "generated/behavioral-vectors.json"), "utf8"),
  ).behavioralVectorsVersion;
} catch {
  // Sibling spec checkout absent; the spec-backed assertions skip, the package one still runs.
}
const skip = ianaLock ? false : `lokalized-spec locks not found at ${specDir}`;

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

test("ianaDataFingerprint IS the pinned IANA lock's fingerprint", { skip }, () => {
  assert.equal(RUNTIME_METADATA.ianaDataFingerprint, ianaLock.ianaDataFingerprint);
});

test("ianaRegistryDate reports the pin that EXISTS, and announces that it is not a File-Date", { skip }, () => {
  // THE DIVERGENCE, CHECKED RATHER THAN DESCRIBED. Plan 5.1 wants the registry snapshot's
  // `File-Date`; `lokalized-spec generated/IANA-PROVENANCE.md` records that there is no snapshot and
  // `ianaRegistryFileDate` is null by decision. This asserts both halves of what the port does
  // instead: the value is derived from the lock's real pin, and it is not date-shaped, so nothing
  // downstream can read it as one.
  assert.equal(RUNTIME_METADATA.ianaRegistryDate, `jdk-oracle:${ianaLock.oracle.jdkVersion}`);
  assert.doesNotMatch(RUNTIME_METADATA.ianaRegistryDate, /^\d{4}-\d{2}-\d{2}$/);
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
    "behavioralVectorsVersion", "cardinalityMode", "ianaDataFingerprint", "ianaRegistryDate",
    "localeDataMode", "producerImplementation", "producerVersion",
  ]);
});
