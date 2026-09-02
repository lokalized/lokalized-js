#!/usr/bin/env node
// @ts-check
/**
 * Runtime-cost measurement for the generated data modules.
 *
 * Plan v7 section 9.2 requires the selected encoding to meet "every independent compressor/runtime
 * constraint". The compressor side is measured by tools/gen-data.js --measure. This is the other
 * half: module import (parse+evaluate), decode(), and retained heap.
 *
 * It also measures the ALTERNATIVE encodings for the tables where the selected one trades bytes for
 * work, because a byte win that costs milliseconds on every construction is not obviously a win.
 *
 * Run with --expose-gc for trustworthy memory figures:
 *   node --expose-gc tools/measure-runtime.js
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "src/data");
const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);
const ITERATIONS = 9;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Import a module with a fresh specifier so the ESM cache does not hide parse cost. */
let cacheBust = 0;
async function timedImport(path) {
  const t0 = performance.now();
  const mod = await import(`${path}?m=${cacheBust++}`);
  return { ms: performance.now() - t0, mod };
}

/**
 * Total heap retained by loading a module AND holding its decoded value, measured from a baseline
 * taken before the module is imported.
 *
 * Measuring only decode() would understate any encoding whose strings are literals in the module
 * source: those are allocated during import, so a decode-only delta reports them as free. Both the
 * constant pool and the decoded structure are charged here.
 */
async function retainedBytes(loadAndDecode) {
  if (!gc) return null;
  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  const held = await loadAndDecode();
  gc(); gc();
  const after = process.memoryUsage().heapUsed;
  if (!held) throw new Error("loadAndDecode() returned nothing");
  return { bytes: after - before, keepAlive: Array.isArray(held) ? held.length : 1 };
}

async function measureModule(file) {
  const path = `file://${join(dataDir, file)}`;
  const imports = [];
  const decodes = [];
  let decoded = null;

  for (let i = 0; i < ITERATIONS; i++) {
    const { ms, mod } = await timedImport(path);
    imports.push(ms);
    const t0 = performance.now();
    decoded = mod.decode();
    decodes.push(performance.now() - t0);
  }

  const retained = await retainedBytes(async () => (await timedImport(path)).mod.decode());

  return {
    file,
    sourceBytes: readFileSync(join(dataDir, file)).length,
    importMs: median(imports),
    decodeMs: median(decodes),
    retainedBytes: retained?.bytes ?? null,
    entries: Array.isArray(decoded) ? decoded.length : null,
  };
}

/** Build an ad-hoc module from source text and measure it the same way, for A/B comparison. */
async function measureAlternative(label, source, expectEntries) {
  const dir = mkdtempSync(join(tmpdir(), "lokalized-alt-"));
  const path = join(dir, "alt.mjs");
  writeFileSync(path, source);
  const imports = [];
  const decodes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { ms, mod } = await timedImport(`file://${path}`);
    imports.push(ms);
    const t0 = performance.now();
    const out = mod.decode();
    decodes.push(performance.now() - t0);
    if (out.length !== expectEntries) throw new Error(`${label}: expected ${expectEntries} entries, got ${out.length}`);
  }
  const retained = await retainedBytes(async () => (await timedImport(`file://${path}`)).mod.decode());
  rmSync(dir, { recursive: true, force: true });
  return { file: label, sourceBytes: Buffer.byteLength(source), importMs: median(imports), decodeMs: median(decodes), retainedBytes: retained?.bytes ?? null, entries: expectEntries };
}

const files = readdirSync(dataDir).filter((f) => f.endsWith(".js") && !["ordinal.js", "ranges.js"].includes(f)).sort();
const rows = [];
for (const file of files) rows.push(await measureModule(file));

const fmt = (n, d = 3) => (n === null ? "n/a" : n.toFixed(d));
const kb = (n) => (n === null ? "n/a" : `${(n / 1024).toFixed(1)}`);

console.log(`runtime cost, ${files.length} data modules, median of ${ITERATIONS} runs${gc ? "" : "  (memory needs --expose-gc)"}\n`);
console.log(`${"module".padEnd(22)}${"entries".padStart(8)}${"raw B".padStart(9)}${"import ms".padStart(11)}${"decode ms".padStart(11)}${"heap KB".padStart(13)}`);
for (const r of rows) {
  console.log(
    r.file.padEnd(22) + String(r.entries ?? "-").padStart(8) + String(r.sourceBytes).padStart(9) +
    fmt(r.importMs).padStart(11) + fmt(r.decodeMs).padStart(11) + kb(r.retainedBytes).padStart(13),
  );
}
console.log("-".repeat(74));
console.log(
  "TOTAL".padEnd(22) + "".padStart(8) + String(rows.reduce((n, r) => n + r.sourceBytes, 0)).padStart(9) +
  fmt(rows.reduce((n, r) => n + r.importMs, 0)).padStart(11) +
  fmt(rows.reduce((n, r) => n + r.decodeMs, 0)).padStart(11) +
  kb(rows.every((r) => r.retainedBytes !== null) ? rows.reduce((n, r) => n + (r.retainedBytes ?? 0), 0) : null).padStart(13),
);
console.log(`\nmodule count: ${rows.length} (one request each if served unbundled)`);

// --- A/B: the one encoding that trades bytes for work -------------------------
const locale = (() => {
  const specDir = process.env.LOKALIZED_SPEC_DIR ?? resolve(root, "../lokalized-spec");
  return JSON.parse(readFileSync(join(specDir, "vendor/lokalized-java/src/build/resources/cldr/cldr-locale-data.json"), "utf8"));
})();
const languages = locale.validity.languages;
const plainArray = `/** @type {string[]} */\nconst S = ${JSON.stringify(languages)};\nexport const decode = () => S.slice();\n`;
const alt = await measureAlternative("valid-languages (JSON array)", plainArray, languages.length);
const selected = rows.find((r) => r.file === "valid-languages.js");

console.log("\nA/B for the one encoding that trades bytes for work:\n");
console.log(`${"encoding".padEnd(32)}${"raw B".padStart(9)}${"import ms".padStart(11)}${"decode ms".padStart(11)}${"heap KB".padStart(13)}`);
for (const r of [selected, alt]) {
  console.log(
    (r.file === "valid-languages.js" ? "valid-languages (bitset, SELECTED)" : r.file).padEnd(32) +
    String(r.sourceBytes).padStart(9) + fmt(r.importMs).padStart(11) + fmt(r.decodeMs).padStart(11) + kb(r.retainedBytes).padStart(13),
  );
}
console.log(
  `\nbitset saves ${(alt.sourceBytes - selected.sourceBytes).toLocaleString()} raw bytes ` +
  `and costs ${(selected.decodeMs - alt.decodeMs).toFixed(3)} ms extra per decode.`,
);
console.log("Decode runs once per process if the caller memoizes; per construction if it does not.");
