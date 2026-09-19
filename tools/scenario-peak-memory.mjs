#!/usr/bin/env node
// @ts-check
/**
 * SCENARIO: CONSTRUCTION PEAK MEMORY — plan 9.3's "construction peak and retained memory", the half
 * that was measured NOWHERE.
 *
 * RETAINED memory is recorded by `scenario:0a`, `scenario:2k` and `scenario:6`. **PEAK is not the
 * same quantity and was not measured at all**, which M-D S23 established while mapping 9.3's seven
 * measurements onto the scenarios that exist.
 *
 * **WHY A HEAP CAP AND NOT A HEAP SAMPLE.** Construction is synchronous, so a sampler on the same
 * thread cannot observe its own peak — it runs before or after, never during. `heapUsed` deltas were
 * tried for a neighbouring clause (M8 S26, clause 78) and measured UNSOUND: four ~1.5 MB catalogs
 * deliberately KEPT moved `heapUsed` by ~490 KB against a ~1.4 MB budget, and the instrument was
 * deleted rather than tuned. What this tool measures instead is an OPERATIONAL peak: the smallest
 * `--max-old-space-size` under which construction still completes, found by bisection in a child
 * process. That is a fact about what the work needs rather than about when a collector happened to
 * run, and it is reproducible — every arm below was stable or within 1 MB across repeated runs.
 *
 * **THE NUMBERS ARE REPORTED, NEVER GATED**, per the A3/A4 no-thresholds decision that 0a, 2k and
 * scenario 6 all follow: heap and timings are machine-dependent. What IS gated is the recipe, the
 * fixture, and the one precondition that makes the measurement mean anything.
 *
 * **THAT PRECONDITION IS THE WHOLE DIFFERENCE BETWEEN THIS AND S26's DELETED INSTRUMENTS.** Node
 * alone needs 8 MB on this machine, and a measurement that returned 8 MB for every arm would be
 * measuring node's floor while looking exactly like a result. So the largest catalog's cap MUST
 * exceed the import-only arm's, and the run fails if it does not.
 *
 *   node tools/scenario-peak-memory.mjs [--write --reason "why the baseline moved"]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const root = resolve(dirname(here), "..");
const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/** The catalog, derived rather than authored: key i takes shape i % 2 and embeds its own index. */
function catalogFor(/** @type {number} */ keys) {
  /** @type {Record<string, unknown>} */
  const catalog = {};
  for (let i = 0; i < keys; ++i)
    catalog[`K${i}`] = i % 2 === 0
      ? `en:${i}`
      : {
          translation: `en:${i}:{{n}} {{p}}`,
          placeholders: { p: { value: "n", translations: { CARDINALITY_ONE: `one${i}`, CARDINALITY_OTHER: `other${i}` } } },
        };
  return catalog;
}

// ---------------------------------------------------------------------------------------------
// CHILD MODE. One file, so the thing being measured cannot drift from the thing describing it.
// ---------------------------------------------------------------------------------------------
const childIndex = process.argv.indexOf("--child");
if (childIndex >= 0) {
  const keys = Number(process.argv[childIndex + 1]);
  // -1 is the RUNTIME-ONLY arm: it imports nothing of the library, so the difference between it and
  // the import-only arm is what importing this library costs. Without it the tool would report a
  // floor and say nothing about whose floor it is.
  if (keys < 0) { process.stdout.write("OK"); process.exit(0); }
  const { createStrings } = await import("../src/core/index.js");
  if (keys > 0) {
    const strings = createStrings({ strings: { en: catalogFor(keys) }, fallbackLocale: "en", locale: "en" });
    if (strings.get("K0") !== "en:0") throw new Error("the child did not construct what it claims to");
  }
  process.stdout.write("OK");
  process.exit(0);
}

/** THE FROZEN RECIPE. Change one field and the runs either side are not comparable. */
const RECIPE = Object.freeze({
  description: "smallest --max-old-space-size (MB) under which construction completes, by bisection",
  arms: Object.freeze([
    Object.freeze({ label: "node alone, nothing imported", keys: -1 }),
    Object.freeze({ label: "import only, no catalog", keys: 0 }),
    Object.freeze({ label: "1 key", keys: 1 }),
    Object.freeze({ label: "2,000 keys", keys: 2000 }),
    Object.freeze({ label: "20,000 keys", keys: 20000 }),
  ]),
  bisect: Object.freeze({ lowMb: 2, highMb: 256 }),
  runsPerArm: 2,
  reading: "the MAX across runs — the cap under which construction succeeded every time",
  derivation: "key i takes shape i % 2 and embeds its own index; no RNG, no seed",
});
const recipeSha256 = sha256(JSON.stringify(RECIPE));
const fixtureSha256 = sha256(JSON.stringify(RECIPE.arms.map((arm) => catalogFor(Math.max(0, Math.min(arm.keys, 8))))));

const fits = (/** @type {number} */ keys, /** @type {number} */ mb) => {
  try {
    return execFileSync(process.execPath, [`--max-old-space-size=${mb}`, here, "--child", String(keys)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).includes("OK");
  } catch { return false; }
};

let probes = 0;
function smallestCap(/** @type {number} */ keys) {
  const { lowMb, highMb } = RECIPE.bisect;
  probes += 1;
  if (!fits(keys, highMb)) return null;
  let low = lowMb, high = highMb;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    probes += 1;
    if (fits(keys, mid)) high = mid; else low = mid + 1;
  }
  return low;
}

const started = performance.now();
const arms = RECIPE.arms.map((arm) => {
  const runs = Array.from({ length: RECIPE.runsPerArm }, () => smallestCap(arm.keys));
  const capMb = runs.includes(null) ? null : Math.max(.../** @type {number[]} */ (runs));
  return { ...arm, runs, capMb };
});
const elapsedMs = performance.now() - started;

const runtimeOnly = arms[0];
const floor = arms[1];
const largest = arms[arms.length - 1];

/** @type {string[]} */
const problems = [];
for (const arm of arms)
  if (arm.capMb === null)
    problems.push(`${arm.label}: did not construct even at ${RECIPE.bisect.highMb} MB, so its cap is unmeasured`);
// THE SOUNDNESS PRECONDITION. Without it a run that returned node's own floor for every arm would
// look exactly like a result — which is the shape of both instruments S26 deleted.
if (floor.capMb !== null && largest.capMb !== null && largest.capMb <= floor.capMb)
  problems.push(
    `${largest.label} needs ${largest.capMb} MB and ${floor.label} needs ${floor.capMb} MB, so this ` +
    `run is measuring the runtime's floor rather than the construction. A peak-memory number that ` +
    `does not move with the catalog is not a peak-memory number.`);

const record = {
  scenario: "peak-memory",
  revision: 1,
  frozenAt: "2026-09-16",
  note: "Caps are REPORTED, never gated (A3/A4). What gates is the recipe, the fixture, and the soundness precondition.",
  recipe: RECIPE,
  recipeSha256,
  fixtureSha256,
  arms: arms.map(({ label, keys, runs, capMb }) => ({ label, keys, runs, capMb })),
  floorMb: floor.capMb,
  rebaselines: [],
};

console.log(`scenario peak-memory — ${RECIPE.description}`);
console.log(`  recipe ${recipeSha256.slice(0, 16)}  revision ${record.revision}  fixture ${fixtureSha256.slice(0, 16)}`);
console.log(`  ${probes} child processes in ${(elapsedMs / 1000).toFixed(1)}s\n`);
const over = (/** @type {number | null} */ cap) => {
  if (cap === null || floor.capMb === null) return "—";
  const delta = cap - floor.capMb;
  return delta === 0 ? "0" : `${delta > 0 ? "+" : ""}${delta}`;
};
console.log(`  arm                            cap MB   vs import-only   runs`);
for (const arm of arms)
  console.log(`  ${arm.label.padEnd(29)} ${String(arm.capMb ?? "—").padStart(6)}   ` +
    `${over(arm.capMb).padStart(14)}   ${JSON.stringify(arm.runs)}`);
const importCost = floor.capMb !== null && runtimeOnly.capMb !== null ? floor.capMb - runtimeOnly.capMb : null;
console.log(`\n  importing this library costs ${importCost === null ? "?" : `${importCost} MB`} over the bare runtime — the first two rows are`);
console.log(`  the whole of that claim, and 1 MB is the bisection's own granularity, so that figure`);
console.log(`  moves between runs and the catalog's ${largest.capMb !== null && floor.capMb !== null ? `+${largest.capMb - floor.capMb}` : "?"} MB does not. What moves is the catalog.`);

const baselinePath = join(root, "measurements/scenario-peak-memory.json");
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
/** @type {string[]} */
const frozen = [];

if (baseline) {
  if (baseline.recipeSha256 !== recipeSha256 && baseline.revision === record.revision)
    frozen.push(`the frozen recipe changed (${String(baseline.recipeSha256).slice(0, 16)} -> ` +
      `${recipeSha256.slice(0, 16)}) while revision stayed ${record.revision}. Bump it, or put the recipe back.`);
  if (baseline.fixtureSha256 !== fixtureSha256)
    frozen.push(`the fixture derivation changed (${String(baseline.fixtureSha256).slice(0, 16)} -> ` +
      `${fixtureSha256.slice(0, 16)}). Every figure here was measured against a different catalog.`);
}

if (process.argv.includes("--write")) {
  const reasonIndex = process.argv.indexOf("--reason");
  const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : null;
  if ((frozen.length || problems.length) && !reason) {
    console.error(`\nrefusing to re-record without --reason "why":`);
    for (const line of [...frozen, ...problems]) console.error(`  ${line}`);
    process.exit(2);
  }
  record.rebaselines = reason ? [...(baseline?.rebaselines ?? []), { reason }] : (baseline?.rebaselines ?? []);
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to measurements/scenario-peak-memory.json${reason ? " (reason recorded)" : ""}`);
  process.exit(0);
}

if (!baseline) {
  console.error(`\nNOT RECORDED: measurements/scenario-peak-memory.json does not exist. Absence is never`);
  console.error(`agreement; run with --write to record it.`);
  process.exit(1);
}
if (frozen.length) {
  console.error(`\nFROZEN SCENARIO VIOLATED:`);
  for (const line of frozen) console.error(`  ${line}`);
  process.exit(1);
}
if (problems.length) {
  console.error(`\nMEASUREMENT UNSOUND (gated):`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`\nNO THRESHOLDS EXIST, by decision (A3/A4). The caps are reported; what is gated is the`);
console.log(`recipe, the fixture, and that the largest catalog costs more than the runtime's floor.`);
