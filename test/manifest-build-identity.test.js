// @ts-check
/**
 * **A MANIFEST CARRIED TWO OF THE SEVEN BUILD-IDENTITY FIELDS AND AN SSR STAMP CARRIED ALL SEVEN.**
 *
 * M-D S27 measured the asymmetry and named the consequence: two builds differing only in their
 * pinned IANA closure published INDISTINGUISHABLE manifests and loaded each other's catalogs without
 * complaint. Range equivalence and whole-list matching come from that closure, so the two builds can
 * negotiate one visitor to different catalogs while every file digest matches. `cldrVersion` and
 * `dataFingerprint` were compared; `behavioralVectorsVersion`, `localeDataMode`, `cardinalityMode`,
 * `ianaRegistryDate` and `ianaDataFingerprint` were not carried at all.
 *
 * **THIS FILE IS THE WHOLE ENFORCEMENT OF THE FIVE NEW COMPARISONS, and that is measured rather than
 * assumed.** Deleting any one of them leaves `npm run conformance` at 2,150/0 and the rest of the
 * suite green — Java has no manifest concept, so no corpus case can ever see this, and every other
 * loader fixture spreads one shared build identity and therefore agrees by construction.
 *
 * **EACH FIELD GETS ITS OWN ARM WITH ITS OWN CONTROL.** A single fused "the identity disagrees" probe
 * would be satisfied by an implementation that compares one field and ignores four — the shape this
 * project has recorded as covering a branch without discriminating it. The control half is what
 * makes each arm falsifiable: the same manifest with the field left alone must LOAD.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { computeCatalogIdentity, catalogIdentityInputFor } from "../src/load/identity.js";
import { loadEntireManifest, validateStringsManifest } from "../src/load/index.js";
import { createStringsManifestFromDirectory } from "../src/node/index.js";
import { RUNTIME_METADATA } from "../src/internal/runtime-metadata.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const BODY = JSON.stringify({ Greeting: "hello" });
// COMPUTED, not written down. A hand-copied digest is a constant nothing re-derives, and the first
// draft of this file had one that was simply wrong — the control at the bottom of the before-I/O
// test is what said so, which is the whole reason a control is there.
const SHA = createHash("sha256").update(new TextEncoder().encode(BODY)).digest("hex");

/** A manifest whose declared fingerprint matches its contents, with `overrides` applied. */
function manifest(overrides = {}) {
  const draft = {
    formatVersion: /** @type {1} */ (1),
    catalogVersion: "v1",
    catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY,
    fallbackLocale: "en",
    baseUrl: "https://cdn.example/v1/",
    files: { en: { url: "en.json", sha256: SHA } },
    tiebreakers: {},
    ...overrides,
  };
  draft.catalogFingerprint =
    computeCatalogIdentity(catalogIdentityInputFor(/** @type {any} */ (draft))).catalogFingerprint;
  return draft;
}

/** The five that did not exist in the format before, each with a value this build does not have. */
const NEW_FIELDS = /** @type {[string, unknown, RegExp][]} */ ([
  ["behavioralVectorsVersion", "99.0.0", /published against IANA .* and vectors 99\.0\.0/],
  ["ianaRegistryDate", "jdk-oracle:17.0.1", /published against IANA jdk-oracle:17\.0\.1/],
  ["ianaDataFingerprint", "f".repeat(64), /published against IANA .* and vectors/],
  // The two fixed literals are a different fact from a version disagreement and say so separately:
  // a manifest declaring `localeDataMode: "host"` came from an implementation that classifies
  // through `Intl`, which is not this format at all.
  ["localeDataMode", "host", /localeDataMode must be "pinned"; received "host"/],
  ["cardinalityMode", "approximate", /cardinalityMode must be "exact"; received "approximate"/],
]);

test("every one of the five new identity fields is compared, and each has a passing control", () => {
  for (const [field, wrong, message] of NEW_FIELDS) {
    // CONTROL FIRST. Without it "the manifest was refused" is satisfied by a fixture that is
    // refused for some unrelated reason, which is the `zh-123` shape this project keeps recording.
    assert.doesNotThrow(() => validateStringsManifest(manifest()),
      `the control manifest must validate, or the ${field} arm below proves nothing`);
    assert.throws(() => validateStringsManifest(manifest({ [field]: wrong })), message,
      `a manifest declaring a ${field} this build does not have must be refused`);
  }
  assert.equal(NEW_FIELDS.length, 5, "the field list shrank");
});

test("a MISSING identity field is refused too, not defaulted", () => {
  // The migration hazard, and the one a format change actually produces: every manifest published
  // before this landed carries two fields. Silently defaulting the other five would let exactly the
  // indistinguishable manifests this change exists to separate keep loading.
  for (const [field] of NEW_FIELDS) {
    const partial = /** @type {any} */ ({ ...manifest() });
    delete partial[field];
    assert.throws(() => validateStringsManifest(partial), /must be/,
      `a manifest omitting ${field} must be refused rather than defaulted`);
  }
});

test("the refusal happens BEFORE any I/O — the transport is never invoked", async () => {
  // Plan :1893 puts runtime compatibility "before catalog I/O", and a check that fires after a fetch
  // has already leaked a request is a different guarantee. Gated by NON-INVOCATION, which is the
  // shape the scheme-boundary refusal uses one door over.
  let calls = 0;
  const transport = /** @type {any} */ (async () => { calls += 1; return new Response(BODY); });

  // **ALL FIVE FIELDS, NOT ONE.** The first version of this test perturbed `ianaRegistryDate` alone,
  // and an ablation measured the cost exactly: it went red when that comparison was deleted and
  // stayed GREEN for the other four. Four fields were asserted to be COMPARED and none of them was
  // asserted to be compared BEFORE I/O — true today by construction, since all seven checks sit in
  // one `assertRuntimeCompatible` call, and construction is what a gate exists not to rely on.
  for (const [field, wrong] of NEW_FIELDS) {
    calls = 0;
    await assert.rejects(
      () => loadEntireManifest(/** @type {any} */ (manifest({ [field]: wrong })), { fetch: transport }),
      /must be|published against IANA/);
    assert.equal(calls, 0,
      `a manifest declaring a ${field} this build does not have must be refused before a byte is fetched`);
  }

  // THE CONTROL THAT MAKES THE ZERO READABLE: the same load with the identity left alone DOES fetch.
  await loadEntireManifest(/** @type {any} */ (manifest()), { fetch: transport });
  assert.equal(calls, 1, "the control must reach the transport, or `calls === 0` proves nothing");
});

test("the build identity is NOT folded into the catalog fingerprint", () => {
  // THE EXCLUSION TEST FOR THE NEW FIELDS, one per field with an included-field control, on the
  // pattern S6 established for `baseUrl` and the per-file urls. Plan 6.1's projection is five
  // members ABOUT THE TRANSLATIONS, and `src/load/identity.js` says the fingerprint is "deliberately
  // not of how they were served". Folding build identity in would also make an honest build
  // mismatch indistinguishable from the TAMPER message `manifest-trust-boundary` gates.
  const base = manifest().catalogFingerprint;
  for (const [field, wrong] of NEW_FIELDS)
    assert.equal(manifest({ [field]: wrong }).catalogFingerprint, base,
      `${field} must not move the catalog fingerprint; build identity and catalog identity are separate axes`);

  // THE INCLUDED-FIELD CONTROL. Without it every assertion above is satisfied by a fingerprint that
  // is constant — which is what a broken projection would produce.
  assert.notEqual(manifest({ catalogVersion: "v2" }).catalogFingerprint, base,
    "catalogVersion IS inside the fingerprint; if it were not, the exclusions above prove nothing");
});

test("the generator emits all seven, and its own validator is what proves it", async () => {
  // ANTI-VACUITY FOR THE WHOLE CHANGE. `createStringsManifestFromDirectory` validates its own output
  // as its last statement, so a generator emitting six fields cannot return at all — which is why
  // the two halves had to land together. This asserts the seven are PRESENT and correct rather than
  // merely that the call succeeded.
  const generated = await createStringsManifestFromDirectory("examples/catalogs", {
    catalogVersion: "v1", fallbackLocale: "en", tiebreakers: { fr: ["fr", "fr-CA"] },
  });
  const identity = /** @type {any} */ (generated);
  assert.equal(identity.behavioralVectorsVersion, RUNTIME_METADATA.behavioralVectorsVersion);
  assert.equal(identity.localeDataMode, RUNTIME_METADATA.localeDataMode);
  assert.equal(identity.cardinalityMode, RUNTIME_METADATA.cardinalityMode);
  assert.equal(identity.ianaRegistryDate, RUNTIME_METADATA.ianaRegistryDate);
  assert.equal(identity.ianaDataFingerprint, RUNTIME_METADATA.ianaDataFingerprint);

  // THEY COME FROM THE BUILD, NEVER FROM THE CALLER. A generator option for any of these would let a
  // publisher claim an identity their build does not have, which is the defect this closes.
  assert.equal(identity.ianaRegistryDate, "jdk-oracle:21.0.11",
    "and it is the jdk-oracle pin, not a date — there is no IANA registry snapshot to date");
});
