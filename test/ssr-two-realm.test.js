// @ts-check
/**
 * Two separately evaluated entry graphs — plan 3.4:736 and 6.4, clauses 47 and 42.
 *
 * **THIS IS A TEST-TOPOLOGY REQUIREMENT, AND A SINGLE-REALM SUITE CANNOT DISCHARGE IT.** Plan
 * 3.4:736 asks for exactly this: "Package tests load root and SSR through separately evaluated entry
 * graphs and prove the accepted loaded case, the rejected direct-construction case, and a
 * deliberately different-helper-version case whose stamp still describes the rendering `Strings`
 * instance." Everything in `test/ssr-stamp.test.js` runs in one module registry, where the helper and
 * the renderer are guaranteed to agree about everything because they ARE the same modules — so the
 * property those tests cannot see is the only one this file is about.
 *
 * **THE TOPOLOGY IS ASSERTED, NOT DESCRIBED.** This project has already found a source comment naming
 * a test file that did not exist, so "these run in two realms" is a claim like any other: the tests
 * below check that the two module registries are genuinely distinct, and that the copy's constants
 * genuinely differ from the renderer's, before asserting anything about a stamp. Without the second
 * check the whole file would pass vacuously against a helper that read its own constants.
 *
 * The second realm is a COPY OF `src/` ON DISK, imported by a different URL. That is what Node means
 * by a separate graph — a different specifier resolves to a different module instance — and it is
 * also the only way to give the helper different constants, which is the point.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { parseStrings } from "../src/parse/index.js";
import { createSsrStamp as localCreateSsrStamp } from "../src/ssr/index.js";
import { RUNTIME_METADATA } from "../src/internal/runtime-metadata.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";

const root = new URL("../", import.meta.url).pathname;

/** The second installed copy: the whole of `src/`, with its identity constants rewritten. */
const otherCopy = mkdtempSync(join(tmpdir(), "lokalized-other-copy-"));
after(() => rmSync(otherCopy, { recursive: true, force: true }));
cpSync(join(root, "src"), join(otherCopy, "src"), { recursive: true });

/** Rewrite one literal in the copy, and FAIL if the text to replace was not there. */
function rewriteInCopy(/** @type {string} */ file, /** @type {string} */ from, /** @type {string} */ to) {
  const path = join(otherCopy, file);
  const before = readFileSync(path, "utf8");
  assert.ok(before.includes(from), `the copy of ${file} must contain ${from} to be perturbable`);
  writeFileSync(path, before.replaceAll(from, to));
}

const OTHER_VERSION = "99.99.99-other-copy";
const OTHER_IANA = "f".repeat(64);
rewriteInCopy("src/internal/runtime-metadata.js", `producerVersion: "${RUNTIME_METADATA.producerVersion}"`,
  `producerVersion: "${OTHER_VERSION}"`);
rewriteInCopy("src/internal/runtime-metadata.js", RUNTIME_METADATA.ianaDataFingerprint, OTHER_IANA);
rewriteInCopy("src/internal/runtime-metadata.js", RUNTIME_METADATA.ianaRegistryDate, "jdk-oracle:0.0.0");
rewriteInCopy("src/internal/runtime-metadata.js",
  `behavioralVectorsVersion: "${RUNTIME_METADATA.behavioralVectorsVersion}"`,
  'behavioralVectorsVersion: "0.0.0-other-copy"');
rewriteInCopy("src/data/provenance.js", pinnedProvenance().dataFingerprint, "e".repeat(64));

const otherUrl = (/** @type {string} */ path) => pathToFileURL(join(otherCopy, path)).href;
const otherSsr = await import(otherUrl("src/ssr/index.js"));
const otherCore = await import(otherUrl("src/core/index.js"));
const otherMetadata = (await import(otherUrl("src/internal/runtime-metadata.js"))).RUNTIME_METADATA;

const en = parseStrings(JSON.stringify({ Hi: "hello" }), { locale: "en" });
const fr = parseStrings(JSON.stringify({ Hi: "bonjour" }), { locale: "fr" });

const loaded = () => ({
  catalogs: { fr, en },
  tiebreakers: {},
  fallbackLocale: "en",
  manifestLocaleConfiguration: { fallbackLocale: "en", supportedLocales: ["en", "fr"], tiebreakers: {} },
  catalogIdentity: { catalogVersion: "2026.09.11", catalogFingerprint: "a".repeat(64) },
  cldrVersion: pinnedProvenance().cldrVersion,
  dataFingerprint: pinnedProvenance().dataFingerprint,
  loadingLimits: {},
  coverage: { kind: "entire-manifest" },
  requestedFiles: [{ locale: "en" }, { locale: "fr" }],
  failures: [],
  warnings: [],
  complete: true,
});

const CONTEXT = /** @type {const} */ ({ kind: "locale", locale: "fr" });

test("the topology itself: two distinct module registries, with genuinely different constants", () => {
  assert.notEqual(otherCore.createStrings, createStrings,
    "the copy must be a separate module instance, or nothing below means anything");
  assert.notEqual(otherSsr.createSsrStamp, localCreateSsrStamp);

  // THE ANTI-VACUITY CHECK. If the copy's constants matched the renderer's, every assertion in this
  // file would pass against a helper that read its own — which is the exact defect it exists to
  // catch.
  assert.notEqual(otherMetadata.producerVersion, RUNTIME_METADATA.producerVersion);
  assert.notEqual(otherMetadata.ianaDataFingerprint, RUNTIME_METADATA.ianaDataFingerprint);
  assert.notEqual(otherMetadata.ianaRegistryDate, RUNTIME_METADATA.ianaRegistryDate);
  assert.notEqual(otherMetadata.behavioralVectorsVersion, RUNTIME_METADATA.behavioralVectorsVersion);
});

test("clause 47: the ACCEPTED loaded case stamps across the boundary", () => {
  const strings = createStrings({ loaded: loaded(), locale: "fr" });
  const stamp = otherSsr.createSsrStamp(strings, CONTEXT);
  assert.equal(stamp.lookupLocale, "fr");
  assert.deepEqual(stamp.localeMatch, { locale: "fr", matchType: "exact" });
});

test("clause 47: the REJECTED direct-construction case is rejected across the boundary", () => {
  const direct = createStrings({ strings: { en, fr }, fallbackLocale: "en", locale: "fr" });
  assert.throws(() => otherSsr.createSsrStamp(direct, CONTEXT), /constructed directly/);
});

test("clause 42/47: a DIFFERENT-VERSION helper stamps the RENDERING instance, not itself", () => {
  // **THE DISCRIMINATING CASE OF THE WHOLE FILE.** The helper doing the stamping believes it is
  // version 99.99.99 with a different IANA identity, a different corpus version and different pinned
  // CLDR bytes. Every one of those fields in the stamp must be the RENDERER's, because the page was
  // rendered by the renderer — plan 6.4: the fields come "from that verified record, never from the
  // SSR module's own constants", and plan 3.4:731 gives the reason for the IANA pair specifically:
  // automatic direct-locale match diagnostics are rendering-observable and must not drift between
  // server and client.
  const strings = createStrings({ loaded: loaded(), locale: "fr" });
  const stamp = otherSsr.createSsrStamp(strings, CONTEXT);

  assert.equal(stamp.producerVersion, RUNTIME_METADATA.producerVersion);
  assert.equal(stamp.ianaDataFingerprint, RUNTIME_METADATA.ianaDataFingerprint);
  assert.equal(stamp.ianaRegistryDate, RUNTIME_METADATA.ianaRegistryDate);
  assert.equal(stamp.behavioralVectorsVersion, RUNTIME_METADATA.behavioralVectorsVersion);
  assert.equal(stamp.dataFingerprint, pinnedProvenance().dataFingerprint);

  // And not the helper's, spelled separately so a future change that made the two equal could not
  // satisfy this test by accident.
  assert.notEqual(stamp.producerVersion, otherMetadata.producerVersion);
  assert.notEqual(stamp.ianaDataFingerprint, otherMetadata.ianaDataFingerprint);

  // BYTE-FOR-BYTE the stamp the renderer's own copy of the helper produces. The helper contributes
  // nothing of itself at all.
  assert.deepEqual(stamp, localCreateSsrStamp(strings, CONTEXT));
});

test("clause 42: the copy's own renderer produces a DIFFERENT stamp, which is the control", () => {
  // Without this the test above could pass on an implementation where the perturbation never reached
  // a stamp field at all. Here the copy renders AND stamps, and its stamp carries its own identity —
  // so the fields are demonstrably reachable, and the previous test's result is about WHOSE they are.
  const theirs = otherCore.createStrings({
    loaded: { ...loaded(), dataFingerprint: "e".repeat(64) },
    locale: "fr",
  });
  const stamp = otherSsr.createSsrStamp(theirs, CONTEXT);
  assert.equal(stamp.producerVersion, otherMetadata.producerVersion);
  assert.equal(stamp.ianaDataFingerprint, otherMetadata.ianaDataFingerprint);
  assert.notEqual(stamp.dataFingerprint, pinnedProvenance().dataFingerprint);
});

test("a renderer and a helper from different copies still REFUSE incompatible pinned data", () => {
  // The other direction of the same boundary: the copy's CORE will not build a `Strings` from a
  // loader result produced against this core's data, because plan 3.4 requires exact equality. The
  // duplication-safety is about the STAMP channel, not about mixing data.
  assert.throws(() => otherCore.createStrings({ loaded: loaded(), locale: "fr" }),
    /produced against CLDR|this core carries CLDR/);
});
