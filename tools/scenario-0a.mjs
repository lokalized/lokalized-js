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

/** Transitive source bytes of the graph an entry point actually pulls in. */
/**
 * Strips comments before the import walk below reads a file.
 *
 * Two reasons, and the second is why this is not merely tidiness. (1) A JSDoc type import —
 * `@typedef {import("../internal/catalog.js").Definition}` — is erased at runtime and must NOT count
 * as a graph edge; `src/` is full of them. (2) Without stripping, the dynamic-import pattern below
 * could not be used at all, because every `import("...")` in this codebase today lives inside a
 * comment. Stripping lets the walk match real dynamic imports without inventing false edges.
 *
 * The `//` rule deliberately refuses to fire after `:`, a quote or a backslash, so a `https://` inside
 * a string literal does not truncate the rest of the line.
 */
const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

/**
 * Every shape of relative import that puts a module in the runtime graph.
 *
 * `from "…"` alone is NOT enough, and the gap was silent rather than theoretical. Measured: inserting
 * `import "../data/iana-range-equivalents.js";` at the top of `src/core/index.js` left this walk
 * reporting 25 root modules and `test/pinned-data-only.test.js` 4/4 GREEN, while the 23 KB 806-class
 * table was genuinely in the root graph at runtime — the containment claim these gates exist to make.
 * The same line written `import { decode } from "…"` was caught, which is the control that makes the
 * first measurement mean something. A dynamic `import("…")` had the identical hole.
 *
 * Adding the two patterns changes no measurement: root stays 25 modules / 690,207 bytes and core 24 /
 * 681,962, verified before landing them. They can only ever ADD an edge that was always really there.
 */
const IMPORT_PATTERNS = [
  /from\s+"(\.[^"]+)"/g,
  /(?:^|[^.\w])import\s+"(\.[^"]+)"/gm,
  /import\(\s*"(\.[^"]+)"/g,
];

function graphBytes(entry) {
  const seen = new Set();
  const queue = [resolve(root, entry)];
  let bytes = 0;
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    bytes += Buffer.byteLength(text);
    const scannable = withoutComments(text);
    for (const pattern of IMPORT_PATTERNS)
      for (const m of scannable.matchAll(pattern)) queue.push(resolve(dirname(file), m[1]));
  }
  return { bytes, modules: seen.size };
}

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
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to measurements/scenario-0a.json${reason ? ` (reason recorded)` : ""}`);
} else if (!baseline) {
  console.log(`\nno baseline at measurements/scenario-0a.json — run with --write to record one`);
}

console.log(`\nNOT MEASURED: the exact-floor browser half of 0a. Both variants must be measured in a`);
console.log(`browser before 0a is complete; these are the Node figures only.`);
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
