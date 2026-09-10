#!/usr/bin/env node
// @ts-check
/**
 * Scenario 0a — M2 static integration measurement.
 *
 * Plan v7 section 9.2: two mandatory variants over the same packed artifact and complete M1
 * derivative — the root with a fixed small embedded raw-text catalog, and `lokalized/core` with its
 * fixed already-parsed equivalent — recording bytes, import/decode, construction, first render, and
 * memory. No manifest, Fetch, preload, or network graph.
 *
 * THIS IS A BASELINE, NOT A GATE. The plan has M0 freeze provisional thresholds that M2 then meets;
 * M0 certification was deliberately skipped, so no thresholds were ever frozen and there is nothing
 * to pass or miss. These numbers are what the thresholds would have been frozen FROM. Recording them
 * as a pass would be claiming a gate that does not exist.
 *
 * Because M2 is tracked by engineering measurement, this records a committed baseline and reports
 * drift against it — but it distinguishes what can honestly be gated from what cannot:
 *
 *   SIZE and MODULE COUNT are deterministic, so they RATCHET: growth fails the run until recorded.
 *   TIMINGS and HEAP are noisy and machine-dependent, so they are REPORTED, never gated.
 *
 * Gating a noisy number would produce flaky failures that get ignored, which is worse than not
 * gating it. Reporting a deterministic one would let the graph grow unnoticed.
 *
 * Run with --expose-gc for trustworthy memory figures:
 *   node --expose-gc tools/scenario-0a.mjs [--write]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { graphBytes as walkGraph } from "./graph-walk.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);
const ITERATIONS = 9;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The fixed small catalog. Deliberately small: 0a measures the FLOOR, not a real app.
 *
 * Plan section 9.2 specifies TWO variants over this same content: the root with "a fixed small
 * embedded RAW-TEXT catalog", and `lokalized/core` with "its fixed ALREADY-PARSED equivalent". Until
 * M5a wired the bounded parser into `createStrings`, the raw-text form could not be constructed at
 * all, so both variants were handed the identical object and differed only by entry point — the
 * measurement did not match its own description. It does now.
 */
const CATALOG = {
  en: {
    "Greeting": "Hello, {{name}}",
    "I read {{bookCount}} books": {
      translation: "I read {{bookCount}} {{books}}",
      placeholders: { books: { value: "bookCount", translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" } } },
    },
  },
  "en-001": { "Greeting": "Hello there, {{name}}" },
  fr: { "Greeting": "Bonjour, {{name}}" },
};
const TIEBREAKERS = { en: ["en", "en-001"] };

/**
 * Transitive source bytes of the graph an entry point actually pulls in.
 *
 * The walk itself now lives in `tools/graph-walk.mjs`, because `tools/scenario-2k.mjs` needs the
 * SAME arithmetic to say whether its recorded measurement still describes these source files.
 * Nothing about the ratchet below changed with the move: root reads 25 modules / 777,757 bytes and
 * core 24 / 769,512 either way, checked against a run of this tool taken immediately before it.
 */
const graphBytes = (entry) => walkGraph(root, entry);

let bust = 0;
async function timedImport(spec) {
  const t0 = performance.now();
  const mod = await import(`${spec}?m=${bust++}`);
  return { ms: performance.now() - t0, mod };
}

async function retained(build) {
  if (!gc) return null;
  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  const held = await build();
  gc(); gc();
  const after = process.memoryUsage().heapUsed;
  if (!held) throw new Error("build() returned nothing");
  return after - before;
}

/**
 * @param {string} label
 * @param {string} entry
 * @param {(mod: any) => any} construct
 * @param {(strings: any) => string} render
 */
async function measure(label, entry, construct, render) {
  const url = `file://${resolve(root, entry)}`;
  const imports = [];
  const constructions = [];
  const renders = [];
  let firstRender = null;

  for (let i = 0; i < ITERATIONS; i++) {
    const { ms, mod } = await timedImport(url);
    imports.push(ms);

    const c0 = performance.now();
    const strings = construct(mod);
    constructions.push(performance.now() - c0);

    // FIRST render specifically: any lazy work a construction deferred is charged here, which is
    // where a caller actually feels it.
    const r0 = performance.now();
    firstRender = render(strings);
    renders.push(performance.now() - r0);
  }

  const heap = await retained(async () => construct((await timedImport(url)).mod));
  const { bytes, modules } = graphBytes(entry);

  return {
    label,
    sourceBytes: bytes,
    modules,
    importMs: median(imports),
    constructionMs: median(constructions),
    firstRenderMs: median(renders),
    retainedBytes: heap,
    firstRender,
  };
}

const rows = [
  // Variant 1: the root, parsing a raw-text catalog at construction — the whole point of this
  // variant is that construction pays for parsing, so the catalog is serialized here.
  await measure("root + raw-text catalog", "src/index.js",
    (mod) => mod.createStrings({
      fallbackLocale: "en",
      locale: "en-AU",
      strings: Object.fromEntries(Object.entries(CATALOG).map(([tag, doc]) => [tag, JSON.stringify(doc)])),
      tiebreakers: TIEBREAKERS,
    }),
    (strings) => strings.get("I read {{bookCount}} books", { bookCount: 3 })),

  // Variant 2: lokalized/core with the ALREADY-PARSED equivalent. Same content, same artifact; the
  // differences 0a is comparing are the entry point's graph AND the parsing the caller has already
  // paid for elsewhere.
  await measure("core + parsed equivalent", "src/core/index.js",
    (mod) => mod.createStrings({ fallbackLocale: "en", locale: "en-AU", strings: CATALOG, tiebreakers: TIEBREAKERS }),
    (strings) => strings.get("I read {{bookCount}} books", { bookCount: 3 })),
];

const kb = (n) => (n === null ? "n/a" : (n / 1024).toFixed(1));
console.log(`scenario 0a — Node ${process.version}, median of ${ITERATIONS}${gc ? "" : "   (memory needs --expose-gc)"}\n`);
console.log(`${"variant".padEnd(26)}${"modules".padStart(8)}${"src KB".padStart(9)}${"import ms".padStart(11)}${"construct ms".padStart(14)}${"1st render ms".padStart(15)}${"heap KB".padStart(10)}`);
for (const r of rows)
  console.log(
    r.label.padEnd(26) + String(r.modules).padStart(8) + kb(r.sourceBytes).padStart(9) +
    r.importMs.toFixed(2).padStart(11) + r.constructionMs.toFixed(3).padStart(14) +
    r.firstRenderMs.toFixed(4).padStart(15) + kb(r.retainedBytes).padStart(10),
  );

console.log(`\nrendered: ${JSON.stringify(rows[0].firstRender)}`);
console.log(`(en-AU request, no en-AU catalog: resolves through the CLDR parent chain to en-001, then en)`);
// --- baseline: ratchet the deterministic half, report the noisy half ------------------------------
const baselinePath = resolve(root, "measurements/scenario-0a.json");
const record = {
  scenario: "0a",
  note: "Baseline, not a threshold. M2 is tracked by engineering measurement; no go/no-go line exists.",
  environments: ["node"],
  node: rows.map((r) => ({
    label: r.label, modules: r.modules, sourceBytes: r.sourceBytes,
    importMs: Number(r.importMs.toFixed(3)),
    constructionMs: Number(r.constructionMs.toFixed(4)),
    firstRenderMs: Number(r.firstRenderMs.toFixed(4)),
    retainedBytes: r.retainedBytes,
  })),
};

let baseline = null;
try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch { baseline = null; }

/** @type {string[]} */
const growth = [];
if (baseline) {
  console.log(`\ndrift against the recorded baseline:`);
  for (const now of record.node) {
    const was = baseline.node.find((/** @type {any} */ b) => b.label === now.label);
    if (!was) { console.log(`  ${now.label}: new variant, no baseline`); continue; }
    const pct = (a, b) => (b === 0 ? "n/a" : `${(((a - b) / b) * 100).toFixed(1)}%`);
    console.log(`  ${now.label.padEnd(26)} src ${pct(now.sourceBytes, was.sourceBytes).padStart(7)}` +
      `   import ${pct(now.importMs, was.importMs).padStart(8)}` +
      `   render ${pct(now.firstRenderMs, was.firstRenderMs).padStart(8)}` +
      `   heap ${now.retainedBytes && was.retainedBytes ? pct(now.retainedBytes, was.retainedBytes).padStart(8) : "     n/a"}`);
    // Deterministic measures only.
    if (now.sourceBytes > was.sourceBytes)
      growth.push(`${now.label}: source graph grew ${was.sourceBytes} -> ${now.sourceBytes} bytes`);
    if (now.modules > was.modules)
      growth.push(`${now.label}: module count grew ${was.modules} -> ${now.modules}`);
  }
}

if (process.argv.includes("--write")) {
  // A ratchet anyone can silently reset is not a ratchet. Re-recording an INCREASED graph size now
  // requires a stated reason, which is kept in the artifact — during M4 the baseline was raised
  // without one, which is exactly the signal the ratchet exists to produce.
  const reasonIndex = process.argv.indexOf("--reason");
  const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : null;
  if (growth.length && !reason) {
    console.error(`\nrefusing to re-record an increased baseline without --reason "why":`);
    for (const g of growth) console.error(`  ${g}`);
    process.exit(2);
  }
  if (reason) {
    record.rebaselines = [...(baseline?.rebaselines ?? []), { reason, growth }];
  } else if (baseline?.rebaselines) {
    record.rebaselines = baseline.rebaselines;
  }

  // CARRY THE BROWSER HALF FORWARD. `record` above is built fresh from a Node run and hard-codes
  // `environments: ["node"]`, so without this a `--write` here silently DELETES whatever
  // `tools/browser-0a/record.mjs` measured — and the deletion is invisible, because the next Node
  // run has no way to know a browser figure ever existed. The browser half cannot be re-derived on
  // demand the way these Node rows can (it needs a real browser driven by hand), so losing it costs
  // a measurement nobody can cheaply retake. `rebaselines` is preserved three lines up for exactly
  // this reason; the browser block was simply missed when it was added.
  //
  // It is carried VERBATIM and never synthesized: a Node run must not be able to invent, adjust or
  // freshen a browser number. If the source files have moved since the capture, the stale block is
  // the honest record and re-capturing it is a person's job.
  if (baseline?.browser) {
    record.browser = baseline.browser;
    record.environments = [...new Set([...record.environments, ...(baseline.environments ?? [])])];
  }
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to measurements/scenario-0a.json${reason ? ` (reason recorded)` : ""}`);
} else if (!baseline) {
  console.log(`\nno baseline at measurements/scenario-0a.json — run with --write to record one`);
}

/**
 * The browser half, and whether the recorded one still describes THESE source files.
 *
 * It is not re-derivable from here — it needs a real browser driven against `npm run serve:0a` — so
 * it is reported from the artifact rather than measured. That makes it exactly the kind of record
 * that rots: the Node graph moves, the browser figures stay, and nothing says so. The transfer size
 * the browser observed IS the graph's source bytes (no compression, no bundler in the path), so
 * staleness is DETECTABLE by arithmetic rather than by remembering, and it is printed every run.
 *
 * Printed, deliberately not gated. A green `verify` must not depend on a human re-driving a browser,
 * or the gate becomes something people route around; and the drift is stated loudly enough that
 * quoting a stale figure takes an act of ignoring the output. Whether it should ratchet is a
 * decision for whoever owns the budgets, not one this tool may take on their behalf.
 */
if (baseline?.browser) {
  const b = baseline.browser;
  console.log(`\nbrowser half — RECORDED (${b.userAgent})`);
  console.log(`  ${"variant".padEnd(26)}${"resources".padStart(10)}${"transfer B".padStart(12)}${"cold import".padStart(13)}${"construct".padStart(11)}${"1st render".padStart(12)}`);
  /** @type {string[]} */
  const stale = [];
  for (const v of b.variants ?? []) {
    console.log(`  ${v.label.padEnd(26)}${String(v.resources).padStart(10)}${String(v.decodedBytes).padStart(12)}` +
      `${`${v.coldImportMs} ms`.padStart(13)}${`${v.constructionMs} ms`.padStart(11)}${`${v.firstRenderMs} ms`.padStart(12)}`);
    const now = record.node.find((n) => n.label === v.label);
    if (!now) { stale.push(`${v.label}: no Node variant of this name any more`); continue; }
    if (now.sourceBytes !== v.decodedBytes)
      stale.push(`${v.label}: captured over ${v.decodedBytes} B, the graph is now ${now.sourceBytes} B`);
    if (now.modules !== v.resources)
      stale.push(`${v.label}: captured over ${v.resources} modules, the graph is now ${now.modules}`);
  }
  if (stale.length) {
    console.log(`\n  STALE — the browser capture no longer describes these source files:`);
    for (const s of stale) console.log(`    ${s}`);
    console.log(`  Re-drive it: npm run serve:0a, load /?variant=root and /?variant=core, save each`);
    console.log(`  window.__RESULTS__, then node tools/browser-0a/record.mjs root.json core.json`);
    console.log(`  (reported, never gated — a green verify must not need a human at a browser)`);
  } else {
    console.log(`  fresh: transfer bytes and resource counts match the Node graph exactly in both variants`);
  }
} else {
  console.log(`\nNOT MEASURED: the exact-floor browser half of 0a. Both variants must be measured in a`);
  console.log(`browser before 0a is complete; these are the Node figures only.`);
}
console.log(`NO THRESHOLDS EXIST, by decision: M2 is tracked by engineering measurement. Size and module`);
console.log(`count ratchet against the baseline; timings and heap are reported and never gated.`);

// Growth that has just been recorded WITH a reason is accepted: the ratchet's job is to force the
// decision to be explicit, not to fail forever after it has been made.
const accepted = process.argv.includes("--write") && process.argv.includes("--reason");
if (growth.length && !accepted) {
  console.log(`\nGRAPH GROWTH (deterministic, gated):`);
  for (const g of growth) console.log(`  ${g}`);
  process.exit(1);
}
