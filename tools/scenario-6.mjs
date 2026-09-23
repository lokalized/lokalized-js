#!/usr/bin/env node
// @ts-check
/**
 * Scenario 6 — edge/server full-range negotiation atop the shared validity/IANA closure.
 *
 * Plan v7 section 9.2:2818. Owner M9; the catalogue entry reads "freeze before M9 starts".
 *
 * **IT DID NOT FREEZE BEFORE M9 STARTED, and that is recorded rather than smoothed over.** M9's
 * scope map listed it in its own owed table on 2026-09-13 and three slices landed before this tool
 * existed, so the plan's sequencing rule — ":2801, a later scenario must freeze before its owner's
 * implementation/evidence can count" — was missed knowingly rather than forgotten. What follows from
 * that is the maintainer's to weigh; what this tool can do is freeze it now and make every later
 * comparison mean something.
 *
 * **WHAT "FROZEN" MEANS HERE IS CHECKED, not asserted.** Plan :2795-2797: "Changing the frozen
 * recipe, fixture, environment, method, or threshold creates a reviewed scenario revision and cannot
 * be compared as the same scenario." So the recipe is a DECLARED OBJECT with its own digest, the
 * fixture has its own digest, and the run FAILS when either moves without `revision` moving with it.
 * A recipe digest taken over this file would change when a comment does; taken over the declared
 * object, it changes exactly when the scenario does.
 *
 * **THRESHOLDS: none, by the precedent this project already set twice.** M7's clause 19 was amended
 * to "recorded, ratcheted where a ratchet exists, reported where none does" (A3), and M8's A4 gave
 * scenario 0b the same shape. Freezing a number nobody has a basis for would be the third thing on
 * this project to look like a gate and check nothing.
 *
 *   DETERMINISTIC — modules, source bytes, the IANA data's byte share, requests per render, and the
 *   two digests — RATCHET: growth or drift fails the run until it is re-recorded with a reason.
 *
 * "CLOSURE" in the frozen recipe and in the record's field names is the plan's word (9.2:2818) and
 * the pre-A30 artifact's. Since A30 the IANA data is TWO generated modules — the full registry table
 * behind `lokalized/negotiate` and the direct-match projection in the root — and `closureBytes` /
 * `ianaClosureBytes` sum whichever of them a graph reaches, while `closureClasses` counts the full
 * table's distinct equivalence classes (it counted the old closure's ENTRIES, 818, which is why the
 * re-pin to 369 is a revision and not a comparison).
 *   TIMINGS AND HEAP are machine-dependent and are REPORTED, never gated.
 *
 * **THE PROOF OBLIGATION A3 AND A7 BOTH CREATED IS DISCHARGED AT BIRTH.** Both amendments turned on
 * the same question — does "recorded" mean something a machine re-checks? — and both found a real
 * gap the moment someone asked it (`scenario:2k` was in neither `verify` nor CI; CI ran zero
 * spec-repo gates). This tool is in `npm run verify` and in CI from its first commit, and needs
 * neither a JDK nor a browser.
 *
 *   node --expose-gc tools/scenario-6.mjs [--write --reason "why the baseline moved"]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exampleGraph } from "./example-graph-walk.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);
const median = (/** @type {number[]} */ xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sha256 = (/** @type {string | Uint8Array} */ input) => createHash("sha256").update(input).digest("hex");

/**
 * THE FROZEN RECIPE. Every field here is part of the scenario's identity: change one and the runs
 * either side of the change are not comparable, which is what `revision` exists to say.
 */
const RECIPE = Object.freeze({
  scenario: "6",
  description: "edge/server full-range negotiation atop the shared validity/IANA closure",
  environment: "node",
  iterations: 9,
  fixture: "examples/catalogs",
  variants: Object.freeze([
    Object.freeze({ label: "edge worker", entry: "examples/edge/worker.js" }),
    Object.freeze({ label: "server renderer", entry: "examples/server/server.js" }),
  ]),
  // THE HEADER SET IS PART OF THE RECIPE, not a convenience: negotiation cost depends on how many
  // ranges a header expands to, and the IANA closure is what expands them. One exact tag, one
  // regional fallback, one weighted list, one unmatched, one the closure expands, one refused.
  headers: Object.freeze([
    "fr-CA", "fr-CH", "fr-CA,fr;q=0.9,en;q=0.1", "de", "iw,he;q=0.5", "fr;q=2",
  ]),
  method: "median of 9; graph figures from tools/example-graph-walk.mjs; requests counted over an " +
    "in-memory transport serving the published manifest and catalogs",
});

const recipeSha256 = sha256(JSON.stringify(RECIPE));

/** The fixture's digest: every catalog file, by name, in sorted order. */
function fixtureDigest() {
  const directory = resolve(root, RECIPE.fixture);
  const hash = createHash("sha256");
  for (const name of readdirSync(directory).sort()) {
    hash.update(name);
    hash.update(readFileSync(join(directory, name)));
  }
  return hash.digest("hex");
}

const { publishCatalogs } = await import(new URL("../examples/server/publish.js", import.meta.url).href);
const { handleRequest } = await import(new URL("../examples/edge/worker.js", import.meta.url).href);
const { createLocaleNegotiator, forAcceptLanguage } = await import(new URL("../src/negotiate/index.js", import.meta.url).href);
const { localeConfigurationForManifest } = await import(new URL("../src/load/index.js", import.meta.url).href);
const { decodeLanguageEquivalents } = await import(new URL("../src/data/iana-range-equivalents.js", import.meta.url).href);

const BASE = "https://cdn.example/v1/";
const published = await publishCatalogs({ catalogVersion: "scenario-6", publicationBaseUrl: BASE });
const manifestBytes = new TextEncoder().encode(JSON.stringify(published.manifest));

/** An in-memory transport, so the measurement is of negotiation and loading rather than of a socket. */
function transport() {
  /** @type {string[]} */
  const calls = [];
  const fetchImpl = async (/** @type {any} */ input) => {
    const name = String(input).slice(BASE.length);
    calls.push(name);
    const bytes = name === "manifest.json" ? manifestBytes : published.assets.get(name);
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch: fetchImpl };
}

/** @param {string} header */
async function render(header) {
  const door = transport();
  const response = await handleRequest(
    new Request("https://bookshop.example/", { headers: { "accept-language": header } }),
    { MANIFEST_URL: `${BASE}manifest.json`, fetch: door.fetch });
  await response.text();
  return door.calls.length;
}

// ---- graph figures, deterministic ------------------------------------------------------------

/** Both generated IANA modules (A30): the full table (negotiate) and the direct-match projection (root). */
const IANA_MODULES = ["src/data/iana-range-equivalents.js", "src/data/iana-identity-equivalents.js"];
const ianaBytes = Object.fromEntries(IANA_MODULES.map((module) =>
  [module, Buffer.byteLength(readFileSync(resolve(root, module), "utf8"))]));
const closureBytes = IANA_MODULES.reduce((sum, module) => sum + /** @type {number} */ (ianaBytes[module]), 0);
/** Distinct classes: a class is a member plus its others, so its sorted member set names it. */
const closureClasses = new Set([.../** @type {Map<string, string[]>} */ (decodeLanguageEquivalents())]
  .map(([key, others]) => JSON.stringify([key, ...others].sort()))).size;

/** @type {any[]} */
const variants = [];
for (const variant of RECIPE.variants) {
  const graph = exampleGraph(root, variant.entry);
  const start = performance.now();
  await import(`${new URL(`../${variant.entry}`, import.meta.url).href}?scenario6`);
  const importMs = Number((performance.now() - start).toFixed(4));
  variants.push({
    label: variant.label,
    modules: graph.files.length,
    sourceBytes: graph.bytes,
    nodeBuiltinEdges: graph.builtins.length,
    ianaClosureBytes: IANA_MODULES.filter((module) => graph.files.includes(module))
      .reduce((sum, module) => sum + /** @type {number} */ (ianaBytes[module]), 0),
    importMs,
  });
}

// ---- negotiation and delivery ------------------------------------------------------------------

const configuration = localeConfigurationForManifest(published.manifest);
const negotiator = createLocaleNegotiator(configuration);

// Warm, then measure: the first call through a cold code path measures compilation, not negotiation.
for (const header of RECIPE.headers) forAcceptLanguage(negotiator, header);
/** @type {number[]} */
const negotiateSamples = [];
for (let iteration = 0; iteration < RECIPE.iterations; ++iteration) {
  const start = performance.now();
  for (const header of RECIPE.headers) forAcceptLanguage(negotiator, header);
  negotiateSamples.push((performance.now() - start) / RECIPE.headers.length);
}

/** @type {Record<string, number>} */
const requestsPerRender = {};
for (const header of RECIPE.headers) requestsPerRender[header] = await render(header);

await render(RECIPE.headers[0]);
/** @type {number[]} */
const renderSamples = [];
for (let iteration = 0; iteration < RECIPE.iterations; ++iteration) {
  const start = performance.now();
  await render(RECIPE.headers[0]);
  renderSamples.push(performance.now() - start);
}

let retainedBytes = 0;
if (gc) {
  gc();
  const before = process.memoryUsage().heapUsed;
  const held = [];
  for (const header of RECIPE.headers) held.push(await render(header));
  gc();
  retainedBytes = process.memoryUsage().heapUsed - before;
  void held;
}

const record = {
  scenario: "6",
  revision: 3,
  frozenAt: "2026-09-19",
  note: "No thresholds, by the precedent of M7 clause 19 as amended (A3) and M8's A4: recorded and " +
    "ratcheted where a ratchet exists, reported where none does. Frozen at M9 S4 rather than before " +
    "M9 started, which plan 9.2:2818 asked for; the deviation is the record. " +
    "REVISION 2 (M-R S13): the scenario's own subject -- 'the shared validity/IANA closure' -- was " +
    "re-pinned from the JDK's table to lokalized-java 3.1.0's registry-sourced one, 806 -> 814 " +
    "classes. That is an ENVIRONMENT change by this tool's own rule, so revision 1's figures are " +
    "not comparable with these and the bump says so rather than a rebaseline quietly absorbing it. " +
    "REVISION 3 (A30): the subject moved again, and further -- the IANA data is now GENERATED from the " +
    "pinned registry snapshot with no JDK, as 369 ordered classes in two modules (the full table behind " +
    "lokalized/negotiate, a direct-match projection plus the region/variant substitutions in the root), " +
    "where revision 2 measured an 818-entry probed closure in one. closureClasses now counts classes, " +
    "not entries, and closureBytes sums both modules. Another environment change by this tool's own rule.",
  recipe: RECIPE,
  recipeSha256,
  fixtureSha256: fixtureDigest(),
  closureClasses,
  closureBytes,
  node: variants,
  negotiateMsPerHeader: Number(median(negotiateSamples).toFixed(5)),
  firstRenderMs: Number(median(renderSamples).toFixed(4)),
  retainedBytes,
  requestsPerRender,
  /** @type {{ reason: string, growth: string[] }[]} */
  rebaselines: [],
};

const baselinePath = join(root, "measurements", "scenario-6.json");
/** @type {any} */
let baseline = null;
try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch { baseline = null; }

console.log(`scenario 6 — ${RECIPE.description}`);
console.log(`  recipe   ${recipeSha256.slice(0, 16)}  revision ${record.revision}  frozen ${record.frozenAt}`);
console.log(`  fixture  ${record.fixtureSha256.slice(0, 16)}  (${RECIPE.fixture})`);
console.log(`  closure  ${closureClasses} classes, ${closureBytes} bytes\n`);
console.log(`  ${"variant".padEnd(18)}${"modules".padStart(9)}${"source B".padStart(11)}${"IANA B".padStart(9)}${"node:".padStart(7)}${"import".padStart(11)}`);
for (const variant of variants)
  console.log(`  ${variant.label.padEnd(18)}${String(variant.modules).padStart(9)}` +
    `${String(variant.sourceBytes).padStart(11)}${String(variant.ianaClosureBytes).padStart(9)}` +
    `${String(variant.nodeBuiltinEdges).padStart(7)}${`${variant.importMs} ms`.padStart(11)}`);
console.log(`\n  negotiate ${record.negotiateMsPerHeader} ms/header over ${RECIPE.headers.length} headers` +
  `   first render ${record.firstRenderMs} ms   retained ${retainedBytes} B`);
console.log(`  requests per render: ${Object.entries(requestsPerRender)
  .map(([header, count]) => `${JSON.stringify(header)}=${count}`).join("  ")}`);

// ---- the four exit terms ------------------------------------------------------------------------

/** @type {string[]} */
const growth = [];
/** @type {string[]} */
const frozen = [];

if (baseline) {
  // 1. THE RECIPE. A changed recipe is a new scenario, not a new run of this one.
  if (baseline.recipeSha256 !== recipeSha256 && baseline.revision === record.revision)
    frozen.push(`the frozen recipe changed (${String(baseline.recipeSha256).slice(0, 16)} -> ` +
      `${recipeSha256.slice(0, 16)}) while revision stayed ${record.revision}. Plan 9.2:2796 — ` +
      `changing the recipe creates a reviewed scenario REVISION; bump it, or put the recipe back.`);

  // 2. THE FIXTURE. 2k's lesson, and `conformance.mjs`'s: a baseline measured against one revision
  //    and read back against another has nothing to notice unless the digest is compared.
  if (baseline.fixtureSha256 !== record.fixtureSha256)
    frozen.push(`the fixture changed (${String(baseline.fixtureSha256).slice(0, 16)} -> ` +
      `${record.fixtureSha256.slice(0, 16)}). Every figure below was measured against different bytes.`);

  // 3. THE PINNED IANA DATA. The scenario is defined as being measured ATOP it, so re-pinned data
  //    is a different measurement even when every other input is identical.
  if (baseline.closureClasses !== closureClasses && baseline.revision === record.revision)
    frozen.push(`the IANA closure was re-pinned (${baseline.closureClasses} -> ${closureClasses} classes) ` +
      `while revision stayed ${record.revision}; that is an environment change, so bump it`);

  // 4. DETERMINISTIC GROWTH.
  console.log(`\ndrift against the recorded baseline:`);
  for (const now of variants) {
    const was = baseline.node?.find((/** @type {any} */ entry) => entry.label === now.label);
    if (!was) { console.log(`  ${now.label}: new variant, no baseline`); continue; }
    const pct = (/** @type {number} */ a, /** @type {number} */ b) =>
      (b === 0 ? "n/a" : `${(((a - b) / b) * 100).toFixed(1)}%`);
    console.log(`  ${now.label.padEnd(18)} src ${pct(now.sourceBytes, was.sourceBytes).padStart(7)}` +
      `   import ${pct(now.importMs, was.importMs).padStart(8)}`);
    if (now.sourceBytes > was.sourceBytes)
      growth.push(`${now.label}: source graph grew ${was.sourceBytes} -> ${now.sourceBytes} bytes`);
    if (now.modules > was.modules)
      growth.push(`${now.label}: module count grew ${was.modules} -> ${now.modules}`);
    if (now.ianaClosureBytes > was.ianaClosureBytes)
      growth.push(`${now.label}: the IANA closure's share grew ${was.ianaClosureBytes} -> ${now.ianaClosureBytes} bytes`);
    if (now.nodeBuiltinEdges > was.nodeBuiltinEdges)
      growth.push(`${now.label}: Node built-in edges grew ${was.nodeBuiltinEdges} -> ${now.nodeBuiltinEdges}`);
  }
  for (const [header, count] of Object.entries(requestsPerRender)) {
    const was = baseline.requestsPerRender?.[header];
    if (typeof was === "number" && count > was)
      growth.push(`requests per render for ${JSON.stringify(header)} grew ${was} -> ${count}`);
  }
}

if (process.argv.includes("--write")) {
  const reasonIndex = process.argv.indexOf("--reason");
  const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : null;
  if ((growth.length || frozen.length) && !reason) {
    console.error(`\nrefusing to re-record without --reason "why":`);
    for (const line of [...frozen, ...growth]) console.error(`  ${line}`);
    process.exit(2);
  }
  record.rebaselines = reason
    ? [...(baseline?.rebaselines ?? []), { reason, growth: [...frozen, ...growth] }]
    : (baseline?.rebaselines ?? []);
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to measurements/scenario-6.json${reason ? " (reason recorded)" : ""}`);
  process.exit(0);
}

if (!baseline) {
  // ABSENCE IS NEVER AGREEMENT — 0a and 2k both say so, and 2k had to be taught it.
  console.error(`\nNOT RECORDED: measurements/scenario-6.json does not exist. Scenario 6 is frozen by`);
  console.error(`the presence of that artifact; run with --write to record it.`);
  process.exit(1);
}

if (frozen.length) {
  console.error(`\nFROZEN SCENARIO VIOLATED:`);
  for (const line of frozen) console.error(`  ${line}`);
  process.exit(1);
}
if (growth.length) {
  console.log(`\nGROWTH (deterministic, gated):`);
  for (const line of growth) console.log(`  ${line}`);
  console.log(`Re-record deliberately: node tools/scenario-6.mjs --write --reason "what grew and why"`);
  process.exit(1);
}
console.log(`\nNO THRESHOLDS EXIST, by decision (A3/A4 precedent). Deterministic figures ratchet;`);
console.log(`timings and heap are reported and never gated.`);
