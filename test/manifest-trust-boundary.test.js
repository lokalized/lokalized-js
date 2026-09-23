import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { loadEntireManifest } from "../src/load/index.js";
import { createStringsManifestFromDirectory } from "../src/node/index.js";

/**
 * M8 CLAUSE 7 — WHAT THE DIGESTS ACTUALLY PROTECT, DEMONSTRATED RATHER THAN DESCRIBED.
 *
 * The clause was carried as "documentation-shaped", on M8-PLAN.md:255's "nothing executable … its
 * only proof is that the documentation says it". **That premise is wrong, and this file is the
 * measurement.** The proposition — consistency and corruption detection, NOT authenticity against an
 * attacker who can replace the manifest as well as the files — is a PAIR of loads over one door with
 * opposite outcomes, which is the ordinary shape of a discriminating probe:
 *
 *   - replace only the catalog BYTES and the load is refused at stage `digest`;
 *   - replace the MANIFEST too and the load succeeds and serves the attacker's words.
 *
 * The second arm is the clause. The manifest is the trust root and **nothing in this library verifies
 * it** — a caller who obtains it over an untrusted channel has no protection at all, which is why the
 * production guidance is a trusted HTTPS origin or an application-owned pin. Both remedies are
 * exercised below rather than recommended.
 *
 * **THE TAMPERED BODY IS THE SAME LENGTH AS THE HONEST ONE, and that is not a detail.** A first
 * version of this probe used names of different lengths; the load was refused at stage `limit`,
 * because the manifest's declared `expectedDecodedBytes` is checked before any hash is computed. It
 * "proved" the digest check while never reaching it — so the equal length is asserted here, and
 * without that assertion the arm below means nothing.
 */

const BASE = "https://cdn.example/v1/";
/** Two payees, deliberately the same number of octets. */
const HONEST = "pay alice.example";
const ATTACKER = "pay molly.example";

/** A published manifest plus the exact bytes it describes. */
async function publish(payee) {
  const directory = mkdtempSync(join(tmpdir(), "lokalized-trust-"));
  const body = JSON.stringify({ "Pay.To": payee });
  try {
    writeFileSync(join(directory, "en.json"), body);
    const manifest = await createStringsManifestFromDirectory(directory, {
      catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: BASE,
    });
    return { manifest, bytes: new TextEncoder().encode(body) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const honest = await publish(HONEST);
const attacker = await publish(ATTACKER);

/** @param {Uint8Array} bytes */
const serving = (bytes) => /** @type {typeof fetch} */ (/** @type {any} */ (async () => new Response(bytes)));

/** @param {any} manifest @param {Uint8Array} bytes */
async function load(manifest, bytes) {
  try {
    const loaded = await loadEntireManifest(manifest, { fetch: serving(bytes) });
    return {
      ok: /** @type {const} */ (true),
      served: createStrings({ loaded, locale: "en" }).get("Pay.To"),
      fingerprint: loaded.catalogIdentity.catalogFingerprint,
    };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    return {
      ok: /** @type {const} */ (false),
      name: failure.constructor.name,
      stages: failure.failures?.map((/** @type {any} */ f) => `${f.locale}:${f.stage}`) ?? null,
      message: String(failure.message),
    };
  }
}

test("the two bodies are the same length, so a refusal cannot be the byte-count guard", () => {
  assert.equal(HONEST.length, ATTACKER.length);
  assert.equal(honest.bytes.length, attacker.bytes.length);
  assert.notDeepEqual([...honest.bytes], [...attacker.bytes]);
});

test("tampering with the catalog BYTES alone is caught at the digest", async () => {
  // The control first: the honest pair loads and serves the honest words. Without it a refusal below
  // could as easily mean the fixture never worked.
  const control = await load(honest.manifest, honest.bytes);
  assert.deepEqual([control.ok, control.served], [true, HONEST]);

  const tampered = await load(honest.manifest, attacker.bytes);

  assert.equal(tampered.ok, false);
  assert.equal(tampered.name, "StringsLoadingError");
  assert.deepEqual(tampered.stages, ["en:digest"]);
});

test("tampering with the MANIFEST TOO is not caught, and that is the boundary", async () => {
  // THE CLAUSE. An attacker who controls the channel replaces both, and the load is clean: the
  // digests bind the catalogs to the manifest, and nothing binds the manifest to anything.
  const forged = await load(attacker.manifest, attacker.bytes);

  assert.equal(forged.ok, true);
  assert.equal(forged.served, ATTACKER);

  // What the application CAN do about it, and the reason `getCatalogIdentity()` is worth pinning: the
  // forged manifest cannot reproduce the honest fingerprint, so a value the deployment carries out of
  // band separates the two.
  assert.notEqual(forged.fingerprint, honest.manifest.catalogFingerprint);
  assert.equal(forged.fingerprint, attacker.manifest.catalogFingerprint);
});

test("the attacker cannot simply drop or blank the digests instead of regenerating them", async () => {
  const stripped = structuredClone(honest.manifest);
  delete (/** @type {any} */ (stripped).files.en.sha256);
  const withoutDigest = await load(stripped, attacker.bytes);

  assert.equal(withoutDigest.ok, false);
  assert.equal(withoutDigest.name, "ConfigurationError");
  assert.match(withoutDigest.message ?? "", /must be a full lowercase hexadecimal SHA-256/);

  const zeroed = structuredClone(honest.manifest);
  /** @type {any} */ (zeroed).files.en.sha256 = "0".repeat(64);
  const withBlankDigest = await load(zeroed, attacker.bytes);

  // Refused by the manifest's OWN self-consistency check, before any body is fetched: the declared
  // `catalogFingerprint` is computed over the per-file digests, so editing one invalidates it.
  assert.equal(withBlankDigest.ok, false);
  assert.equal(withBlankDigest.name, "ConfigurationError");
  assert.match(withBlankDigest.message ?? "", /declared catalogFingerprint does not match its contents/);
});

test("`lokalized/load` reads exactly these caller options, and none of them is a trust anchor", () => {
  // THE STALENESS HALF, derived rather than guessed. An earlier draft of this gate named three
  // plausible option spellings for a caller-supplied trust root and was measured blind to a fourth:
  // a real one spelled `options.integrity` left every other arm green. Deriving the whole option
  // surface from source removes the guess — the day `lokalized/load` grows an option, this fails and
  // somebody has to say whether the new one changes the boundary above.
  const directory = new URL("../src/load/", import.meta.url).pathname;
  /** @type {Set<string>} */
  const names = new Set();
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".js")))
    for (const match of readFileSync(join(directory, file), "utf8").matchAll(/\boptions\??\.([A-Za-z_][A-Za-z0-9_]*)/g))
      names.add(/** @type {string} */ (match[1]));

  assert.ok(names.has("fetch"), "a derivation that found nothing would pass vacuously");
  assert.deepEqual([...names].sort(), ["fetch", "limits", "partialFailure", "request", "signal", "source"]);
});

test("the README carries the production guidance, and names both remedies", () => {
  // `npm run check:readme` EXECUTES the samples in that section, but its anti-vacuity terms are
  // GLOBAL — no groups at all, no assertions at all — so deleting one whole section leaves it at
  // exit 0. Measured. This assertion is the only thing that can see the section disappear, which is
  // what makes the clause's second sentence ratcheted rather than merely written down once.
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf("### What the digests protect");
  assert.notEqual(start, -1, "the digest scope-limit section is gone from the README");

  const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
  assert.match(section, /not\s+authenticity/i);
  assert.match(section, /https/i, "the trusted-origin remedy must be named");
  assert.match(section, /getCatalogIdentity\(\)/, "the application-owned pin must be named");
  assert.ok(section.includes("<!-- example: security-digests -->"),
    "the section's claims must stay inside EXECUTED blocks rather than drifting back into prose");
});
