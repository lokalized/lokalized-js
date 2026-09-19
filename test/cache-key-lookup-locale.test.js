import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createStrings, forLocale } from "../src/core/index.js";
import { loadStrings } from "../src/load/index.js";
import { createStringsManifestFromDirectory } from "../src/node/index.js";
import { handleRequest } from "../examples/edge/worker.js";

/**
 * M8 CLAUSE 50, THE HALF THAT WAS UNGATED: a direct-locale response is keyed on the NORMALIZED
 * ORIGINAL lookup locale — never on the URL segment as the visitor spelled it, and never on the
 * catalog that happened to supply the text.
 *
 * The clause's other half — "equal selected locale and equal match type are insufficient for
 * whole-list negotiation" — is already gated, by `test/example-edge.test.js`'s `fr-CH`/`fr-BE` pair
 * and the README's `cache-collision` and `cache-key` groups. Measured: this file adds nothing there
 * and deliberately does not repeat it.
 *
 * **WHY THIS FIXTURE IS NOT `examples/catalogs`, and it is the whole reason the file exists.** A
 * first design probed the resolved-catalog defect through `Checkout.Cta` against the shipped
 * catalogs — and was MEASURED INERT against the same defect probed through `App.Title`, because
 * `examples/catalogs/fr-CA.json` HOLDS `App.Title` and omits `Checkout.Cta`. Which key the defect
 * reads decided whether it collided, so the gate discharged the clause for exactly one witness.
 *
 * This fixture removes the choice. `fr-BE.json` overrides NO key the page renders, so EVERY
 * per-key resolved locale for `fr-BE` is `fr` — asserted below, and that assertion is what keeps the
 * file discriminating if the fixture is ever edited. Any key derived from a resolved catalog then
 * collides `/fr-BE/` with `/fr/` whichever key it probes, while the two pages legitimately differ:
 * the direct-locale view names the locale it was asked for.
 *
 * The shipped `examples/catalogs/` is untouched, so `scenario:6`'s fixture digest does not move.
 */

const BASE = "https://cdn.example/v1/";
const MANIFEST_URL = `${BASE}manifest.json`;
/** Every key `renderPage` reads. */
const RENDERED_KEYS = ["App.Title", "Locale.Direct", "Locale.Notice", "Cart.Items", "Checkout.Cta"];

const directory = mkdtempSync(join(tmpdir(), "lokalized-cache-key-"));
cpSync(new URL("../examples/catalogs/", import.meta.url).pathname, directory, { recursive: true });
// A catalog that exists, is loadable, and supplies nothing the page renders.
writeFileSync(join(directory, "fr-BE.json"), JSON.stringify({ "Unused.Key": "jamais rendu" }));

const generated = await createStringsManifestFromDirectory(directory, {
  catalogVersion: "v1",
  fallbackLocale: "en",
  tiebreakers: { fr: ["fr", "fr-BE", "fr-CA"] },
  publicationBaseUrl: BASE,
});

/** @type {Map<string, Uint8Array>} */
const assets = new Map();
/** @type {Record<string, { url: string, sha256: string, decodedBytes?: number }>} */
const files = {};
for (const [locale, entry] of Object.entries(generated.files)) {
  const path = `${locale}.${entry.sha256.slice(0, 8)}.json`;
  files[locale] = { ...entry, url: new URL(path, BASE).href };
  assets.set(path, readFileSync(join(directory, `${locale}.json`)));
}
const manifest = { ...generated, baseUrl: BASE, files };
const MANIFEST_BYTES = new TextEncoder().encode(JSON.stringify(manifest));

/** @type {typeof fetch} */
const transport = /** @type {any} */ (async (/** @type {RequestInfo | URL} */ input) => {
  const name = String(input).slice(BASE.length);
  const bytes = name === "manifest.json" ? MANIFEST_BYTES : assets.get(name);
  return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes);
});

/** @param {string} path */
async function get(path) {
  const response = await handleRequest(new Request(`https://shop.example${path}`), {
    MANIFEST_URL,
    LOCALE_STRATEGY: "redirect",
    fetch: transport,
  });
  return { status: response.status, key: response.headers.get("x-lokalized-cache-key"), body: await response.text() };
}

test("the fixture makes every rendered key of `fr-BE` resolve to `fr` — without this the file proves nothing", async () => {
  // THE ANTI-VACUITY TERM. A resolved-catalog cache key is only WRONG here because no rendered key
  // distinguishes `fr-BE` from `fr`. If a later edit gives `fr-BE.json` one of these keys, the
  // collision below stops being reachable through that key and this file quietly narrows — which is
  // exactly how the first design of this gate came to discharge the clause for one witness only.
  const loaded = await loadStrings(manifest, "fr-BE", { fetch: transport });
  const strings = createStrings({ loaded, locale: "fr-BE" });
  const placeholders = { served: "fr", requested: "fr-BE", count: 2 };

  const resolved = RENDERED_KEYS.map(
    (key) => strings.getResult(key, placeholders, forLocale("fr-BE")).resolvedLocale,
  );

  assert.deepEqual(resolved, RENDERED_KEYS.map(() => "fr"));
  assert.ok(manifest.files["fr-BE"], "the fixture must publish fr-BE, or the two URLs are not both servable");
});

test("`/fr-BE/` and `/fr/` share a resolved catalog and must not share a cache key", async () => {
  const belgian = await get("/fr-BE/");
  const french = await get("/fr/");

  assert.equal(belgian.status, 200);
  assert.equal(french.status, 200);

  // The pages are genuinely different, which is what makes a shared key a defect rather than a
  // harmless coincidence: the direct-locale view names the locale it was asked for.
  assert.notEqual(belgian.body, french.body);
  assert.notEqual(belgian.key, french.key);
  assert.match(/** @type {string} */ (belgian.key), /^lokalized-direct:[0-9a-f]{64}$/);
});

test("three spellings of one locale URL are one page and one cache entry", async () => {
  // The key must be the NORMALIZED tag. Keying on the segment as the visitor spelled it publishes
  // three entries for one page — a cache that is correct and three times larger than it needs to be,
  // which is the failure mode nobody notices until the hit rate is the subject.
  const spellings = await Promise.all(["/fr-CA/", "/fr-ca/", "/FR-ca/"].map(get));

  assert.deepEqual(spellings.map((response) => response.status), [200, 200, 200]);
  assert.equal(new Set(spellings.map((response) => response.body)).size, 1, "one page");
  assert.equal(new Set(spellings.map((response) => response.key)).size, 1, "one cache entry");

  // The control: the key is not a constant. Two locales that really are different pages differ.
  const english = await get("/en/");
  assert.notEqual(english.key, spellings[0]?.key);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
