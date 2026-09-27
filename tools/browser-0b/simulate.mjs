#!/usr/bin/env node
// @ts-check
/**
 * A SIMULATED RUN OF SCENARIO 0b's PAGE — NEVER A MEASUREMENT. Runs `index.html`'s REAL module script in
 * Node: the library from this checkout's `src/` (the page's two dynamic imports are redirected, and no
 * other line of it is touched), with the network, the DOM and the resource-timing buffer stubbed to
 * behave as revision 3's cold capture shows Chromium behaving — the matched preloads reused, the
 * mismatched one fetched again, the second load served from cache with no entry of its own, the blind
 * control reading 0. The code's sizes are INVENTED (a fixed ratio, 300 bytes of headers), so the capture
 * it writes carries a `simulated` marker, and the checks refuse to record it.
 *
 * **WHY IT EXISTS.** `test/scenario-0b.test.js` builds its captures with its own `pageSide`, a second
 * implementation of the page's labelling, summary and controls — and a second implementation can share
 * a mistake with the checks it is compared to. So the test runs THIS on every `npm test`, holds the
 * page's own output to the checks and `pageSide` to the page, without a browser. It is also the cheapest
 * preflight before a real run, which spends a never-visited site: the page's script runs once here
 * first, and the checks' verdict on its output is printed.
 *
 *   node tools/browser-0b/simulate.mjs <capture.json>     exits 0 when the checks find no problem
 *
 * **WHAT IT SERVES, AND WHY THAT IS NOT THE CHECKOUT'S CATALOGS.** The catalogs are the manifest's
 * PINNED bytes — `tools/browser-0b/catalogs/`, copied from the catalog origin's commit and refused unless
 * each is the sha256 the manifest names — because `examples/catalogs/` is free to move and the scenario
 * does not follow it. And the manifest's seven build-identity fields are served as THIS checkout's, read
 * from `src/core`: the page measures the published build the manifest was generated for, this runs the
 * working tree's, and `src/load/manifest.js` refuses a manifest whose identity is not the running build's.
 * Those seven are exactly what `harnessMethodSha256` leaves out of the method. A change to the manifest
 * FORMAT in `src/` would still stop it, and the test that runs it would then say so.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILD_IDENTITY_FIELDS, RECIPE, methodDigests } from "../0b-recipe.mjs";
import { captureProblems, readHarness } from "../0b-checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const [out] = process.argv.slice(2);
if (!out) {
  console.error("usage: simulate.mjs <capture.json>");
  process.exit(2);
}
const SITE = "http://zb-simulated.localhost:8713";
const TOKEN = "simulated-1";
const files = readHarness(root);
const manifest = JSON.parse(files.manifestText);
const CODE = /\bconst\s+CODE\s*=\s*"([^"]*)"/.exec(files.page)?.[1] ?? "";
const version = /lokalized@([^/]+)\//.exec(CODE)?.[1] ?? "";
// The chunks `load.js` imports, named as the published build of SUBJECT names them. The simulation
// imports `src/`, which has no chunks, so these entries are the ONE part of the loader graph invented
// outright.
const CHUNKS = ["NZVWUS27", "LED5CWLB", "ZSYPX2PV", "7WU4JE3E", "QU3LBEYR", "LNGUQ7KN"];

// THE PINNED CATALOGS, refused unless each is the one the manifest names by its sha256 — the loader
// would refuse different bytes anyway, one step later and less clearly.
/** @type {Map<string, Buffer>} */
const catalogs = new Map();
for (const [locale, file] of Object.entries(/** @type {Record<string, { url: string, sha256: string }>} */ (manifest.files))) {
  if (!RECIPE.requiredResources.catalogs.includes(file.url)) continue;
  const bytes = readFileSync(join(here, "catalogs", file.url));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    console.error(`tools/browser-0b/catalogs/${file.url} is not the pinned ${locale} catalog the manifest names`);
    process.exit(1);
  }
  catalogs.set(file.url, bytes);
}
// THE MANIFEST AS SERVED: the checkout's build identity in place of the published build's (see above).
const core = /** @type {Record<string, unknown>} */ (await import(pathToFileURL(join(root, "src/core/index.js")).href));
const served = JSON.stringify({ ...manifest, ...Object.fromEntries(BUILD_IDENTITY_FIELDS.map((field) => [field, core[field]])) });

/** @type {any[]} */
const buffer = [];
/**
 * An entry as Chromium reports one: invented encoded size, 300 bytes of headers, or all zero when withheld.
 * Its duration is 0: nothing crosses a network here, so each stub's bytes are there the moment they are
 * asked for, and what the page times after that is evaluation. The 1 ms it used to invent left the check
 * that every module arrives before the import that resolves with it a margin of 0.6 to 1.2 ms on the
 * machine that measured it (2026-09-26), which a faster one need not keep.
 */
const entry = (/** @type {string} */ initiatorType, /** @type {string} */ name, /** @type {number} */ decoded, extra = {}) => buffer.push({
  name, initiatorType, startTime: performance.now(), duration: 0, deliveryType: "", responseStatus: decoded > 0 ? 200 : 0,
  decodedBodySize: decoded, encodedBodySize: Math.round(decoded * 0.43),
  transferSize: decoded > 0 ? Math.round(decoded * 0.43) + 300 : 0, ...extra });

const page = files.page.replaceAll("__RUN__", encodeURIComponent(TOKEN));
const links = [...page.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\brel="preload"/.test(tag))
  .map((tag) => ({ href: /\bhref="([^"]+)"/.exec(tag)?.[1] ?? "", crossorigin: /\scrossorigin[\s>]/.test(tag) }));
// PARSE TIME: every preload starts before any module script runs. A matched one carries the body the
// loader will reuse; the mismatched one is a no-CORS request, opaque, every size withheld.
for (const link of links)
  entry("link", link.href, link.crossorigin ? /** @type {Buffer} */ (catalogs.get(new URL(link.href).pathname.split("/").pop() ?? "")).length : 0);
const reusable = new Set(links.filter((link) => link.crossorigin).map((link) => link.href));
const fetched = new Set();

const g = /** @type {any} */ (globalThis);
g.__import = async (/** @type {string} */ file, /** @type {string} */ url) => {
  entry("script", url, file === "lokalized.js" ? 184494 : 20600);
  if (file === "load.js") for (const chunk of CHUNKS) entry("script", `${CODE}chunks/chunk-${chunk}.js`, 1000);
  return import(pathToFileURL(join(root, file === "lokalized.js" ? "src/index.js" : "src/load/index.js")).href);
};
/** @type {string | null} */
let captured = null;
g.fetch = async (/** @type {unknown} */ input, /** @type {any} */ init = {}) => {
  const url = new URL(String(input), SITE).href;
  if (url === `${SITE}/capture`) { captured = String(init.body); return new Response("captured"); }
  if (url === `${SITE}/manifest.json`) {
    entry("fetch", url, served.length, { encodedBodySize: served.length, transferSize: served.length + 300 });
    return new Response(served);
  }
  if (url.startsWith("http://localhost:8714/")) { entry("fetch", url, 0, { responseStatus: 200 }); return new Response("{}"); }
  if (url.startsWith(RECIPE.catalogOrigin)) {
    const body = catalogs.get(new URL(url).pathname.split("/").pop() ?? "");
    if (body === undefined) throw new Error(`the simulation holds no catalog for ${url}`);
    if (reusable.has(url) && !fetched.has(url)) fetched.add(url);   // the preload is reused: no entry of its own
    else if (!fetched.has(url)) { fetched.add(url); entry("fetch", url, body.length); }
    // a memory-cache hit on a second load creates no entry: the page's own note on that control
    return new Response(new Uint8Array(body));
  }
  throw new Error(`the simulation has no answer for ${url}`);
};
g.location = { origin: SITE, search: `?run=${encodeURIComponent(TOKEN)}` };
Object.defineProperty(globalThis, "navigator", { configurable: true,
  value: { userAgent: "lokalized scenario 0b simulation (tools/browser-0b/simulate.mjs), never a measurement" } });
g.window = globalThis;
g.document = {
  getElementById: () => ({ textContent: "" }),
  querySelectorAll: (/** @type {string} */ selector) => {
    if (selector !== 'link[rel="preload"]:not([crossorigin])') throw new Error(`the simulation does not answer ${selector}`);
    return links.filter((link) => !link.crossorigin).map((link) => ({ href: new URL(link.href).href }));
  },
};
const clock = globalThis.performance;
Object.defineProperty(globalThis, "performance", { configurable: true,
  value: { now: () => clock.now(), getEntriesByType: () => [...buffer].sort((a, b) => a.startTime - b.startTime) } });

// THE PAGE'S SCRIPT, with its two imports redirected to `src/` and nothing else changed.
let script = /<script type="module">([\s\S]*)<\/script>/.exec(page)?.[1] ?? "";
for (const file of ["lokalized.js", "load.js"]) {
  const call = `await import(bust(CODE + "${file}"))`;
  if (script.split(call).length !== 2) throw new Error(`the page no longer imports ${file} as ${call}; update the simulation`);
  script = script.replace(call, `await globalThis.__import("${file}", bust(CODE + "${file}"))`);
}
const scratch = mkdtempSync(join(tmpdir(), "lokalized-0b-simulate-"));
try {
  writeFileSync(join(scratch, "page.mjs"), script);
  await import(pathToFileURL(join(scratch, "page.mjs")).href);
} finally { rmSync(scratch, { recursive: true, force: true }); }

const capture = JSON.parse(captured ?? JSON.stringify(g.__RESULTS__));
const problems = captureProblems(capture, { page: files.page, manifestText: files.manifestText, version });
capture.simulated = { by: "tools/browser-0b/simulate.mjs", pageMethodSha256: methodDigests(files).page, version,
  note: "the code's sizes are invented; never a measurement, and never recorded" };
writeFileSync(out, JSON.stringify(capture, null, 2) + "\n");
console.log(`simulated ${version}: ${JSON.stringify(capture.summary)}, rendered ${JSON.stringify(capture.render?.rendered)}`);
console.log(`the checks on the page's own output: ${problems.length === 0 ? "no problems" : `\n  - ${problems.join("\n  - ")}`}`);
process.exit(problems.length === 0 ? 0 : 1);
