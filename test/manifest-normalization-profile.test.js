// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { normalizeManifestTag } from "../src/load/manifest-locale.js";
import { normalizeTag } from "../src/internal/locale.js";
import { validateStringsManifest, parseStringsManifest, localeConfigurationForManifest } from "../src/load/manifest.js";
import { catalogIdentityInputFor, catalogIdentityBytes, computeCatalogIdentity } from "../src/load/identity.js";
import { chain, fetchSet } from "../src/load/planning.js";
import { loadStrings } from "../src/load/fetch-loader.js";
import { createStrings } from "../src/core/index.js";
import { createSsrStamp, validateSsrStamp } from "../src/ssr/index.js";
import { wholeManifestPlan } from "../src/load/run-plan.js";

const bytes = readFileSync(new URL("./fixtures/manifest-normalization-v1.1.json", import.meta.url));
const profile = JSON.parse(bytes.toString("utf8"));
assert.equal(profile.profileID, "manifest-normalization-v1.1");
assert.equal(createHash("sha256").update(bytes).digest("hex"), "9fb02c5a607e6288ef46e49a9161a4bc0d0d23aed98931f7c0482a21a8714162");

/** @param {any} manifest */
function identityObservation(manifest) {
  const input = catalogIdentityInputFor(manifest);
  const canonical = catalogIdentityBytes(input);
  return { input, identity: computeCatalogIdentity(input), projection: JSON.parse(Buffer.from(canonical).toString("utf8")),
    canonicalBytesBase64: Buffer.from(canonical).toString("base64"), byteCount: canonical.length,
    sha256: createHash("sha256").update(canonical).digest("hex") };
}
/** @param {any} row */
function observe(row) {
  try {
    const input = row.input;
    let value;
    switch (row.operation) {
    case "normalize": {
      const normalized = normalizeManifestTag(input.tag);
      value = { normalized, repeated: normalizeManifestTag(normalized), coreProjection: normalizeTag(input.tag) };
      break;
    }
    case "roundTrip": {
      const authored = JSON.parse(input.manifestJSON);
      const validated = validateStringsManifest(authored);
      value = { validated, parsedText: parseStringsManifest(input.manifestJSON),
        parsedBytes: parseStringsManifest(new TextEncoder().encode(input.manifestJSON)),
        revalidated: validateStringsManifest(validateStringsManifest(validated)),
        configuration: localeConfigurationForManifest(validated), identity: identityObservation(validated),
        chain: chain(validated, "de"), fetchSet: fetchSet(validated, "de"), wholePlan: wholeManifestPlan(validated),
        lookupAuthored: fetchSet(validated, input.lookupLocale), lookupCanonical: fetchSet(validated, validated.fallbackLocale) };
      break;
    }
    case "validateStringsManifest": value = validateStringsManifest(JSON.parse(input.manifestJSON)); break;
    case "parseStringsManifest": value = input.documentBase64 === undefined ? parseStringsManifest(input.manifestJSON)
      : parseStringsManifest(new Uint8Array(Buffer.from(input.documentBase64, "base64"))); break;
    case "chain": value = chain(JSON.parse(input.manifestJSON), input.lookupLocale); break;
    case "identityForManifest": value = identityObservation(JSON.parse(input.manifestJSON)); break;
    default: throw new Error("Unregistered profile operation");
    }
    return { outcome: "returned", value };
  } catch (error) {
    assert.ok(error instanceof Error);
    return { outcome: "threw", error: { name: error.name, message: error.message, code: /** @type {any} */ (error).code } };
  }
}
for (const row of [...profile.cases, ...profile.archiveCorrections]) {
  test(row.id, () => assert.deepEqual(JSON.parse(JSON.stringify(observe(row))), row.expected));
}


test("fetch coverage records the same stable planning input", async () => {
  const row = profile.cases.find((/** @type {any} */ r) => r.id === "m8k.round-trip.upper");
  const authored = JSON.parse(row.input.manifestJSON);
  const body = new TextEncoder().encode('{"Hello":"Hello"}');
  const file = authored.files["UND-x-foo"];
  file.sha256 = createHash("sha256").update(body).digest("hex");
  file.decodedBytes = body.length;
  const normalized = { ...authored, fallbackLocale: "x-foo", files: { "x-foo": file } };
  authored.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(normalized)).catalogFingerprint;
  for (const lookup of ["UND-x-foo", "und-x-foo", "x-foo", "zh-und-x-foo"]) {
    const loaded = await loadStrings(authored, lookup, { fetch: async () => new Response(body) });
    assert.equal(loaded.complete, true);
    assert.deepEqual(loaded.coverage, { kind: "lookup", lookupLocale: "x-foo" });
    assert.deepEqual(Object.keys(loaded.catalogs), ["x-foo"]);
    const strings = createStrings({ loaded, localeSupplier: () => lookup });
    assert.equal(strings.get("Hello"), "Hello");
    for (const equivalent of ["UND-x-foo", "und-x-foo", "x-foo", "zh-und-x-foo"]) {
      assert.equal(strings.get("Hello", {}, { locale: equivalent }), "Hello");
      const context = /** @type {const} */ ({ kind: "locale", locale: equivalent });
      const stamp = createSsrStamp(strings, context);
      assert.equal(stamp.lookupLocale, normalizeTag(equivalent));
      assert.doesNotThrow(() => validateSsrStamp(stamp, strings, context));
    }
    assert.throws(() => strings.get("Hello", {}, { locale: "de" }), /loaded for lookup/);
    assert.throws(() => createSsrStamp(strings, { kind: "locale", locale: "de" }), /load covers lookup/);
  }
});
