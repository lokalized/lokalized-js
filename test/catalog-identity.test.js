// @ts-check
/**
 * `computeCatalogIdentity` — and specifically WHAT IT IGNORES.
 *
 * The plan's claim is that a catalog's identity is a property of the translations, so "server and CDN
 * manifests can identify the same translations". That claim is only worth anything if the excluded
 * fields are tested ONE AT A TIME — and each exclusion test needs a control that MOVES the digest,
 * because a projection that ignored its whole input would pass every exclusion test ever written.
 * That pairing is the whole design of this file.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogIdentityBytes, catalogIdentityInputFor, computeCatalogIdentity } from "../src/load/identity.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

/** @returns {any} a manifest whose every field is set, so an exclusion test can move exactly one */
const manifest = () => ({
  formatVersion: 1,
  catalogVersion: "2026.09.10",
  catalogFingerprint: "0".repeat(64),
  cldrVersion: "46",
  dataFingerprint: "1".repeat(64),
  fallbackLocale: "en",
  baseUrl: "https://cdn.example/v1/",
  files: {
    en: { url: "https://cdn.example/v1/en.json", sha256: DIGEST_A, decodedBytes: 120 },
    fr: { url: "https://cdn.example/v1/fr.json", sha256: DIGEST_B, decodedBytes: 140 },
  },
  // DELIBERATELY NOT IN SORTED ORDER. A tiebreaker list is an ordered preference, so its order is
  // meaningful — and a fixture whose only array happened to be sorted would let a canonicalizer that
  // SORTED ARRAY ELEMENTS pass every test here. Measured: with `["en", "en-001"]` that ablation
  // changed nothing; with this spelling it turns the pinned bytes red. Covering the array path is
  // not the same as discriminating the order within it.
  tiebreakers: { en: ["en-001", "en"] },
});

const fingerprintOf = (m) => computeCatalogIdentity(catalogIdentityInputFor(m)).catalogFingerprint;

test("the fingerprint is pinned to exact bytes, not merely stable", () => {
  // A self-comparison would pass on any deterministic function of the input, including a wrong one.
  // Pinning the canonical BYTES as well as the digest means a change says WHICH, and a reader can
  // check the projection against the plan's sentence by eye.
  assert.equal(
    new TextDecoder().decode(catalogIdentityBytes(catalogIdentityInputFor(manifest()))),
    '{"catalogVersion":"2026.09.10","formatVersion":1,' +
      `"localeToSha256":{"en":"${DIGEST_A}","fr":"${DIGEST_B}"},` +
      '"resolvedFallbackLocale":"en","tiebreakers":{"en":["en-001","en"]}}',
  );
  assert.equal(fingerprintOf(manifest()),
    "8d3d2323154e6b97124761320d6065bc1e38630a9c317ab15d73a5b6591c3c6d");
});

test("EXCLUDED: transport and provenance fields do not move the fingerprint", () => {
  const baseline = fingerprintOf(manifest());

  const withOtherHost = manifest();
  withOtherHost.baseUrl = "https://other.example/build-9/";
  withOtherHost.files.en.url = "https://other.example/build-9/en.json";
  withOtherHost.files.fr.url = "https://other.example/build-9/fr.json";
  assert.equal(fingerprintOf(withOtherHost), baseline, "a different host is the same catalog");

  const withOtherSizes = manifest();
  withOtherSizes.files.en.decodedBytes = 999;
  delete withOtherSizes.files.fr.decodedBytes;
  assert.equal(fingerprintOf(withOtherSizes), baseline, "decodedBytes is transport-only");

  const withOtherCldr = manifest();
  withOtherCldr.cldrVersion = "47";
  withOtherCldr.dataFingerprint = "2".repeat(64);
  assert.equal(fingerprintOf(withOtherCldr), baseline, "SSR compares CLDR and data fingerprints separately");

  const withOtherSelf = manifest();
  withOtherSelf.catalogFingerprint = "9".repeat(64);
  assert.equal(fingerprintOf(withOtherSelf), baseline, "the fingerprint excludes itself");
});

test("INCLUDED: the controls that must move it", () => {
  // Without these, every assertion above would pass on a function that returned a constant.
  const baseline = fingerprintOf(manifest());

  const otherVersion = manifest();
  otherVersion.catalogVersion = "2026.09.11";
  assert.notEqual(fingerprintOf(otherVersion), baseline, "catalogVersion is part of identity");

  const otherFallback = manifest();
  otherFallback.fallbackLocale = "fr";
  assert.notEqual(fingerprintOf(otherFallback), baseline, "the resolved fallback locale is part of identity");

  const otherBody = manifest();
  otherBody.files.en.sha256 = "c".repeat(64);
  assert.notEqual(fingerprintOf(otherBody), baseline, "a changed translation body must change identity");

  const otherTiebreakers = manifest();
  otherTiebreakers.tiebreakers = { en: ["en"] };
  assert.notEqual(fingerprintOf(otherTiebreakers), baseline, "tiebreakers are part of identity");

  const extraLocale = manifest();
  extraLocale.files.de = { url: "https://cdn.example/v1/de.json", sha256: "d".repeat(64) };
  assert.notEqual(fingerprintOf(extraLocale), baseline, "an added locale must change identity");
});

test("locale order in the manifest does not move the fingerprint", () => {
  // Canonicalization's job. Two publishers emitting the same catalog with their keys in different
  // orders must agree, and JCS property ordering is what makes that true rather than lucky.
  const reordered = manifest();
  const files = reordered.files;
  reordered.files = { fr: files.fr, en: files.en };
  assert.equal(fingerprintOf(reordered), fingerprintOf(manifest()));
});

test("a mis-spelled digest is refused rather than fingerprinted", () => {
  // An uppercase or truncated digest canonicalizes cleanly and would yield a stable, wrong
  // fingerprint that nothing downstream ever compares against anything but itself.
  for (const bad of [DIGEST_A.toUpperCase(), "a".repeat(63), "", 12, null]) {
    const broken = manifest();
    broken.files.en.sha256 = bad;
    assert.throws(() => fingerprintOf(broken), /full lowercase hexadecimal SHA-256/,
      `sha256 ${JSON.stringify(bad)} must be refused`);
  }
});

test("an unexpected member on the input cannot reach the canonical bytes", () => {
  // The projection is built field by field precisely so that an object which merely passed through a
  // reader cannot fingerprint differently from one built by hand.
  const input = /** @type {any} */ (catalogIdentityInputFor(manifest()));
  input.baseUrl = "https://cdn.example/v1/";
  input.somethingElse = { arbitrary: true };
  assert.equal(computeCatalogIdentity(input).catalogFingerprint, fingerprintOf(manifest()));
});
