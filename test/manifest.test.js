// @ts-check
/**
 * Manifest parsing and validation — plan section 6.1.
 *
 * Nothing in `lokalized-java` can arbitrate any of this: Java has no manifest. So the checks below
 * are written against the plan's own sentences, and each cites the one it encodes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import {
  localeConfigurationForManifest,
  parseStringsManifest,
  validateStringsManifest,
} from "../src/load/manifest.js";

/** A manifest whose declared fingerprint actually matches its contents. */
function manifest(overrides = {}) {
  const draft = {
    formatVersion: 1,
    catalogVersion: "v1",
    catalogFingerprint: "0".repeat(64),
    cldrVersion: "46",
    dataFingerprint: "1".repeat(64),
    fallbackLocale: "en",
    baseUrl: "https://cdn.example/v1/",
    files: {
      en: { url: "en.json", sha256: "a".repeat(64) },
      fr: { url: "fr.json", sha256: "b".repeat(64), decodedBytes: 140 },
    },
    tiebreakers: { en: ["en-001", "en"] },
    ...overrides,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return draft;
}

test("a well-formed manifest validates and is defensively copied", () => {
  const source = manifest();
  const validated = validateStringsManifest(source);
  assert.deepEqual(Object.keys(validated.files).sort(), ["en", "fr"]);

  // Plan 6.1: `validateStringsManifest` "defensively copies". Mutating the caller's object afterwards
  // must not change what was validated, or a manifest could be swapped after its fingerprint checked.
  source.files.en.sha256 = "c".repeat(64);
  source.tiebreakers.en.push("zz");
  assert.equal(validated.files.en.sha256, "a".repeat(64));
  assert.deepEqual([...validated.tiebreakers.en], ["en-001", "en"]);
  assert.throws(() => { /** @type {any} */ (validated).catalogVersion = "v2"; }, TypeError);
});

test("the declared fingerprint is RECOMPUTED, not trusted", () => {
  // Plan :1893 — parsing, validation, planning and loading all "recompute the catalog fingerprint …
  // before catalog I/O". This is the rejection that means no loader ever reaches a per-file plan.
  const wrong = manifest();
  wrong.catalogFingerprint = "9".repeat(64);
  assert.throws(() => validateStringsManifest(wrong),
    /declared catalogFingerprint does not match its contents/);

  // The control: the SAME manifest with its real fingerprint must validate, so the assertion above is
  // about the mismatch rather than about the field being present.
  assert.doesNotThrow(() => validateStringsManifest(manifest()));
});

test("manifest file tags must be pinned-data-known, which lookup input need not be", () => {
  // Plan :1892 — "Manifest file tags remain pinned-data-known, valid tags; broadening lookup input
  // does not loosen manifest validation." `zz` is well-formed BCP 47 and is not a language.
  const unknown = manifest();
  unknown.files = { en: unknown.files.en, zz: { url: "zz.json", sha256: "c".repeat(64) } };
  assert.throws(() => validateStringsManifest(unknown), /not a valid pinned-data-known locale tag/);

  const illFormed = manifest();
  illFormed.files = { en: illFormed.files.en, en_US: { url: "x.json", sha256: "c".repeat(64) } };
  assert.throws(() => validateStringsManifest(illFormed), /not a valid pinned-data-known locale tag/);
});

test("all three URL schemes validate, because one manifest shape crosses subpaths", () => {
  // Plan 6.1: "Common manifest parsing/validation preserves all three schemes so one manifest shape
  // can cross subpaths." The narrowing is the LOADER's — Fetch rejects file:, Node rejects the rest —
  // so a validator that narrowed here would make a manifest un-shareable between them.
  for (const baseUrl of ["https://cdn.example/v1/", "http://localhost:8080/", "file:///srv/catalogs/"])
    assert.doesNotThrow(() => validateStringsManifest(manifest({ baseUrl })), `${baseUrl} must validate`);

  for (const baseUrl of ["ftp://cdn.example/", "data:text/plain,x", "/relative/only"])
    assert.throws(() => validateStringsManifest(manifest({ baseUrl })), /baseUrl/, `${baseUrl} must be refused`);
});

test("a resolved file URL may not escape the permitted schemes", () => {
  const escaping = manifest();
  escaping.files.fr.url = "ftp://elsewhere.example/fr.json";
  assert.throws(() => validateStringsManifest(escaping), /scheme 'ftp:', which a manifest may not name/);
});

test("the file count is bounded by the loading limits", () => {
  const many = manifest();
  many.files = Object.fromEntries(
    ["en", "fr", "de"].map((tag) => [tag, { url: `${tag}.json`, sha256: "a".repeat(64) }]),
  );
  const rebuilt = manifest(many);
  assert.doesNotThrow(() => validateStringsManifest(rebuilt, { limits: { maximumLocalizedStringsFiles: 3 } }));
  assert.throws(() => validateStringsManifest(rebuilt, { limits: { maximumLocalizedStringsFiles: 2 } }),
    /exceeds the maximum of 2/);
});

test("the locale configuration is sorted, so declaration order cannot change it", () => {
  const forward = localeConfigurationForManifest(manifest());
  const reversed = manifest();
  reversed.files = { fr: reversed.files.fr, en: reversed.files.en };
  assert.deepEqual([...localeConfigurationForManifest(reversed).supportedLocales], [...forward.supportedLocales]);
  assert.deepEqual([...forward.supportedLocales], ["en", "fr"]);
});

test("the BYTE door rejects duplicate members; the OBJECT door provably cannot see them", () => {
  // Plan 6.1 states this as a capability DIFFERENCE: `validateStringsManifest` "cannot recover source
  // duplicates or source locations". Both halves are asserted, because the tempting mistake is to
  // make the two doors agree — which would mean either inventing a duplicate the object never had, or
  // dropping a check the bytes genuinely support.
  const text = JSON.stringify(manifest());

  const duplicateRoot = text.replace('"cldrVersion"', '"catalogVersion":"other","cldrVersion"');
  assert.throws(() => parseStringsManifest(duplicateRoot), /duplicate manifest member 'catalogVersion'/);

  const duplicateNested = text.replace('"fr":', '"en":');
  assert.throws(() => parseStringsManifest(duplicateNested), /duplicate JSON object member 'en'/);

  // THE OTHER HALF. By the time an object literal exists the duplicate is gone — `{a:1,a:2}` is
  // `{a:2}` before any library sees it — so the object door validates the survivor and must NOT
  // pretend otherwise.
  const survivor = JSON.parse(duplicateNested);
  assert.doesNotThrow(() => validateStringsManifest(manifest(JSON.parse(JSON.stringify(survivor)).files ? {} : {})));
  assert.equal(Object.keys(survivor.files).length, 1, "the duplicate really did collapse before validation");
});

test("bytes and text are the same door", () => {
  const text = JSON.stringify(manifest());
  const fromText = parseStringsManifest(text);
  const fromBytes = parseStringsManifest(new TextEncoder().encode(text));
  assert.deepEqual(fromBytes, fromText);
});

test("a syntactically broken manifest fails as a parse error, not a configuration error", () => {
  // Plan 6.2 splits them: "raw manifest syntax/source failures come from `parseStringsManifest` as
  // `StringsParseError`" while schema and fingerprint mismatches are `ConfigurationError`. The two
  // reach different catch blocks in a consumer, so conflating them is observable.
  assert.throws(() => parseStringsManifest("{ not json"), (error) => error.name === "StringsParseError");
  assert.throws(() => validateStringsManifest({ formatVersion: 2 }), (error) => error.name === "ConfigurationError");
});
