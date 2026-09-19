#!/usr/bin/env node
// @ts-check
/**
 * SCENARIO: NODE SERVER CONCURRENCY WITH PER-CALL LOCALES — plan 9.3's sixth measurement, and the
 * one its list had no recorded scenario for.
 *
 * 9.3 names seven measurements. Six are recorded: cold decode/parse/compile and warm `get`
 * throughput and the fallback chain by `scenario:2k`, construction memory by 0a and 2k, the browser
 * request graph by 0a's browser half, partial and failed load cleanup by
 * `test/load-retention.test.js` (M8 clause 78). **"Node server concurrency with per-call locales" had
 * none** — the only numbers for it lived in a README sentence, which is measurement nobody re-runs.
 *
 * **WHAT IS GATED IS THE CORRECTNESS, NOT THE SPEED**, and that division is the point. Under
 * interleaving, every request must see ONLY its own locale; the three server shapes must produce
 * byte-identical output; and the resolver must be consulted exactly once per lookup, never at
 * construction and never for inspection. Those are deterministic and they FAIL the run. The
 * milliseconds are machine-dependent and are REPORTED, never gated — the A3/A4 no-thresholds
 * decision, the same rule 0a, 2k and scenario 6 follow.
 *
 * **AND THE NEGATIVE CONTROL IS WHAT MAKES THE POSITIVE ONE MEAN ANYTHING.** A fourth shape holds
 * "the current locale" in a module-level variable — the thing a reader writes before they have been
 * bitten — and it MUST come back wrong. If it does not, the requests did not actually interleave and
 * every assertion above passed vacuously. That is asserted, not hoped for.
 *
 *   node tools/scenario-concurrency.mjs [--write --reason "why the baseline moved"]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createStrings, forLocale, forLocaleMatch } from "../src/core/index.js";
import { createLocaleNegotiator, forAcceptLanguage } from "../src/negotiate/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "measurements/scenario-concurrency.json");
const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/**
 * THE FROZEN RECIPE. Change one field and the runs either side are not comparable, which is what
 * `revision` exists to say.
 */
const RECIPE = Object.freeze({
  description: "one process-wide Strings, N interleaved requests, each with its own per-call locale",
  locales: Object.freeze(["en", "fr", "ja", "de", "es"]),
  keys: 40,
  requests: 50,
  lookupsPerRequest: 3,
  // A DETERMINISTIC interleave: request i yields for (i * 7) % 11 turns of the microtask queue, so
  // completion order differs from start order without an RNG and without a wall-clock delay.
  yieldPattern: "(i * 7) % 11",
  iterations: 5,
  shapes: Object.freeze(["rebuild-per-request", "shared + forLocale", "shared + forLocaleMatch"]),
  negativeControl: "shared + a module-level 'current locale' variable",
});
const recipeSha256 = sha256(JSON.stringify(RECIPE));

/** The catalog, derived rather than authored: key i takes shape i % 2 and embeds its own index. */
function catalogFor(/** @type {string} */ locale) {
  /** @type {Record<string, unknown>} */
  const catalog = {};
  for (let i = 0; i < RECIPE.keys; ++i)
    catalog[`K${i}`] = i % 2 === 0
      ? `${locale}:${i}`
      : { translation: `${locale}:${i}:{{n}}`, placeholders: {} };
  return catalog;
}
const strings = Object.fromEntries(RECIPE.locales.map((locale) => [locale, catalogFor(locale)]));
const fixtureSha256 = sha256(JSON.stringify(strings));

const BASE = Object.freeze({ strings, fallbackLocale: "en" });
/** Request i asks for locale i % locales.length — deterministic, and every locale is exercised. */
const localeFor = (/** @type {number} */ i) => RECIPE.locales[i % RECIPE.locales.length];
const expected = (/** @type {number} */ i) => `${localeFor(i)}:0`;

const turns = (/** @type {number} */ i) => (i * 7) % 11;
const yieldTurns = async (/** @type {number} */ count) => { for (let t = 0; t < count; ++t) await Promise.resolve(); };

let resolverCalls = 0;
let constructions = 0;
const build = (/** @type {Record<string, unknown>} */ extra) => { constructions += 1; return createStrings({ ...BASE, ...extra }); };

/**
 * One request: three lookups, each of which DECIDES its locale, yields, and only then reads.
 *
 * **The yield between deciding and reading is the whole fixture.** A handler that decided and read in
 * the same synchronous turn cannot be corrupted by a neighbour no matter how it stores the decision,
 * so a probe without it would report the module-level-variable shape as correct — measured, on the
 * first run of this tool, and caught by the negative control rather than by reading.
 */
async function request(/** @type {number} */ i, /** @type {(index: number) => Promise<string>} */ lookup) {
  await yieldTurns(turns(i));
  /** @type {string[]} */
  const seen = [];
  for (let n = 0; n < RECIPE.lookupsPerRequest; ++n) seen.push(await lookup(i));
  return seen;
}

const shared = build({ locale: "en" });
const negotiator = createLocaleNegotiator(shared.getLocaleConfiguration());
const matchFor = (/** @type {number} */ i) => forAcceptLanguage(negotiator, localeFor(i)).localeMatch;
const matches = RECIPE.locales.map((_, i) => matchFor(i));

/** The shapes, each a function from a request index to the string it renders. */
const SHAPES = {
  "rebuild-per-request": async (/** @type {number} */ i) => {
    const instance = build({ locale: localeFor(i) });
    await yieldTurns(1);
    return instance.get("K0");
  },
  "shared + forLocale": async (/** @type {number} */ i) => {
    const options = forLocale(localeFor(i));
    await yieldTurns(1);
    return shared.get("K0", undefined, options);
  },
  "shared + forLocaleMatch": async (/** @type {number} */ i) => {
    const options = forLocaleMatch(matches[i % matches.length]);
    await yieldTurns(1);
    return shared.get("K0", undefined, options);
  },
};

/** @type {Record<string, { correct: boolean, medianMsPerRequest: number }>} */
const shapeResults = {};
/** @type {string[]} */
const problems = [];

for (const [label, lookup] of Object.entries(SHAPES)) {
  const samples = [];
  let correct = true;
  for (let iteration = 0; iteration < RECIPE.iterations; ++iteration) {
    const start = performance.now();
    const answers = await Promise.all(
      Array.from({ length: RECIPE.requests }, (_, i) => request(i, lookup)));
    samples.push((performance.now() - start) / RECIPE.requests);
    for (const [i, seen] of answers.entries())
      if (seen.some((value) => value !== expected(i))) correct = false;
  }
  samples.sort((a, b) => a - b);
  shapeResults[label] = { correct, medianMsPerRequest: Number(samples[Math.floor(samples.length / 2)].toFixed(4)) };
  if (!correct) problems.push(`${label}: a request saw a locale that was not its own`);
}

// THE NEGATIVE CONTROL. It must be WRONG, or the requests never interleaved and nothing above holds.
let current = forLocale("en");
const negative = await Promise.all(Array.from({ length: RECIPE.requests }, (_, i) =>
  request(i, async (index) => {
    current = forLocale(localeFor(index));
    await yieldTurns(1);
    return shared.get("K0", undefined, current);
  })));
const negativeWrong = negative.some((seen, i) => seen.some((value) => value !== expected(i)));
if (!negativeWrong)
  problems.push(
    "the module-level-variable control answered CORRECTLY, so the requests did not interleave and " +
    "every correctness assertion above passed vacuously");

// RESOLVER ACCOUNTING, deterministic: never at construction, never for inspection, once per lookup,
// and skipped entirely when the call carries its own locale.
resolverCalls = 0;
const ambient = { locale: "en" };
const resolved = build({ localeResolver: () => { resolverCalls += 1; return ambient.locale; } });
const atConstruction = resolverCalls;
resolved.getSupportedLocales();
const afterInspection = resolverCalls;
for (let i = 0; i < RECIPE.requests; ++i) { ambient.locale = localeFor(i); resolved.get("K0"); }
const afterLookups = resolverCalls;
resolved.get("K0", undefined, forLocale("fr"));
const afterPerCallLocale = resolverCalls;

if (atConstruction !== 0) problems.push(`the resolver ran ${atConstruction} time(s) at construction`);
if (afterInspection !== 0) problems.push(`getSupportedLocales() consulted the resolver`);
if (afterPerCallLocale !== afterLookups) problems.push(`a per-call locale still consulted the resolver`);
const resolverCallsPerLookup = (afterLookups - afterInspection) / RECIPE.requests;

const record = {
  scenario: "concurrency",
  revision: 1,
  frozenAt: "2026-09-16",
  note: "Correctness is GATED; milliseconds are reported and never gated (A3/A4 no-thresholds decision).",
  recipe: RECIPE,
  recipeSha256,
  fixtureSha256,
  shapes: shapeResults,
  negativeControlAnsweredWrong: negativeWrong,
  resolver: { atConstruction, afterInspection, callsPerLookup: resolverCallsPerLookup },
  instancesConstructed: constructions,
  rebaselines: [],
};

console.log(`scenario concurrency — ${RECIPE.description}`);
console.log(`  recipe ${recipeSha256.slice(0, 16)}  revision ${record.revision}  fixture ${fixtureSha256.slice(0, 16)}`);
console.log(`  ${RECIPE.requests} interleaved requests over ${RECIPE.locales.length} locales, ` +
  `${RECIPE.lookupsPerRequest} lookups each, ${RECIPE.iterations} iterations\n`);
console.log(`  shape                       correct   ms/request`);
for (const [label, result] of Object.entries(shapeResults))
  console.log(`  ${label.padEnd(26)} ${String(result.correct).padEnd(9)} ${result.medianMsPerRequest.toFixed(4)}`);
console.log(`\n  negative control answered wrong: ${negativeWrong}  (it must, or nothing interleaved)`);
console.log(`  resolver: ${atConstruction} at construction, ${afterInspection} after inspection, ` +
  `${resolverCallsPerLookup} per lookup`);

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
/** @type {string[]} */
const frozen = [];
/** @type {string[]} */
const growth = [];

if (baseline) {
  if (baseline.recipeSha256 !== recipeSha256 && baseline.revision === record.revision)
    frozen.push(`the frozen recipe changed (${String(baseline.recipeSha256).slice(0, 16)} -> ` +
      `${recipeSha256.slice(0, 16)}) while revision stayed ${record.revision}. Bump it, or put the recipe back.`);
  if (baseline.fixtureSha256 !== fixtureSha256)
    frozen.push(`the fixture changed (${String(baseline.fixtureSha256).slice(0, 16)} -> ` +
      `${fixtureSha256.slice(0, 16)}). Every figure here was measured against different bytes.`);
  // The one DETERMINISTIC ratchet: a resolver consulted more often per lookup is a regression no
  // timing would show, because it is cheap and correct and simply happens more.
  if (typeof baseline.resolver?.callsPerLookup === "number" &&
      resolverCallsPerLookup > baseline.resolver.callsPerLookup)
    growth.push(`the resolver is consulted ${resolverCallsPerLookup} time(s) per lookup, was ` +
      `${baseline.resolver.callsPerLookup}`);
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
  console.log(`\nbaseline written to measurements/scenario-concurrency.json${reason ? " (reason recorded)" : ""}`);
  process.exit(0);
}

if (!baseline) {
  console.error(`\nNOT RECORDED: measurements/scenario-concurrency.json does not exist. Absence is never`);
  console.error(`agreement; run with --write to record it.`);
  process.exit(1);
}
// THE FROZEN INPUTS ARE CHECKED FIRST, and the order was chosen from an ablation rather than by
// taste: changing the fixture also changes what the correctness assertions expect, so with the other
// order a changed input reported itself as "a request saw a locale that was not its own" — a true
// failure under a misleading name, which is the class of thing this project spends its time undoing.
if (frozen.length) {
  console.error(`\nFROZEN SCENARIO VIOLATED:`);
  for (const line of frozen) console.error(`  ${line}`);
  process.exit(1);
}
if (problems.length) {
  console.error(`\nCORRECTNESS FAILED (gated):`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
if (growth.length) {
  console.log(`\nGROWTH (deterministic, gated):`);
  for (const line of growth) console.log(`  ${line}`);
  console.log(`Re-record deliberately: node tools/scenario-concurrency.mjs --write --reason "what grew and why"`);
  process.exit(1);
}
console.log(`\nNO THRESHOLDS EXIST, by decision (A3/A4). Correctness and the resolver's call rate are`);
console.log(`gated; milliseconds are reported and never gated.`);
