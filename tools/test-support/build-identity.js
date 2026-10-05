// @ts-check
/**
 * The seven build-identity fields a `StringsManifestV1` carries, for fixtures that hand-build one.
 *
 * **WHY THIS EXISTS AT ALL.** A manifest carried TWO of these until M-D S33 — `cldrVersion` and
 * `dataFingerprint` — while an SSR stamp carried seven, so two builds differing only in their pinned
 * IANA closure published indistinguishable manifests and loaded each other's catalogs without
 * complaint (M-D S27 measured it). Widening the format to seven turned twenty-three hand-built
 * fixtures across twenty test files into manifests the validator refuses, and twenty-three separate
 * hand-edits is twenty-three chances to write a slightly different manifest. One spread is one
 * chance.
 *
 * **DERIVED, NEVER LITERAL.** Every value comes from the same constants the validator compares
 * against, so a fixture cannot drift from the build and cannot pin a stale spelling. That makes the
 * agreement a tautology *for these fixtures* — deliberately, because it is not their job to check
 * it. `test/runtime-metadata.test.js` is what holds each constant against the artifact it claims to
 * describe, and `test/manifest-build-identity.test.js` is what holds the manifest doors to reading
 * all seven. A fixture that wants to DISAGREE spreads this and then overrides the one field it is
 * about, which is exactly what the mismatch fixtures do.
 */
import { decode as pinnedProvenance } from "../../src/data/provenance.js";
import { RUNTIME_METADATA } from "../../src/internal/runtime-metadata.js";

/** @type {Readonly<{ cldrVersion: string, dataFingerprint: string, behavioralVectorsVersion: string, localeDataMode: "pinned", cardinalityMode: "exact", ianaRegistryDate: string, ianaDataFingerprint: string }>} */
export const BUILD_IDENTITY = Object.freeze({
  cldrVersion: pinnedProvenance().cldrVersion,
  dataFingerprint: pinnedProvenance().dataFingerprint,
  behavioralVectorsVersion: RUNTIME_METADATA.behavioralVectorsVersion,
  localeDataMode: RUNTIME_METADATA.localeDataMode,
  cardinalityMode: RUNTIME_METADATA.cardinalityMode,
  ianaRegistryDate: RUNTIME_METADATA.ianaRegistryDate,
  ianaDataFingerprint: RUNTIME_METADATA.ianaDataFingerprint,
});
