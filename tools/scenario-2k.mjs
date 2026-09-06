#!/usr/bin/env node
// @ts-check
/**
 * Scenario 2k — the 2,000-key performance and memory measurement.
 *
 * WHY THIS IS A SEPARATE TOOL, NOT A BIGGER `scenario-0a.mjs`.
 * Scenario 0a measures the FLOOR: a fixed 3-locale / 2-key literal, and its `sourceBytes` and module
 * count RATCHET against `measurements/scenario-0a.json`. Stretching its catalog to 2,000 keys would
 * change what every historical row in that artifact means and break the comparability the ratchet
 * exists for. So 0a keeps its literal and this tool answers the other question: what does a catalog
 * of realistic size cost to build, to render from, and to hold.
 *
 * WHAT IS AND IS NOT CLAIMED HERE.
 * This is a MEASUREMENT, not a gate. No threshold is asserted, nothing ratchets, and the process
 * exits 0 unless the harness itself fails. The plan's M7 acceptance row speaks of "budgets accepted";
 * accepting a budget means choosing a number, which is not a thing a measuring instrument may do for
 * you. This tool exists so that whoever chooses has something real to choose from.
 *
 * Timings on a shared developer machine are noisy. Every timing row therefore reports median, min,
 * max and relative spread ((max-min)/median) over N iterations rather than a single figure, so a
 * reader can see how much of a difference between two runs is signal.
 *
 * WHERE THE STEADY-STATE NUMBER GOES, so nobody has to re-derive it from surprise.
 * A lookup here costs tens of MICROseconds, not the tens of nanoseconds a Map read would, and that
 * is not catalog size — measured at 1, 10, 100, 500, 2,000 and 8,000 keys, the per-lookup cost of
 * repeatedly reading ONE key is flat at ~23-24 us, so nothing in the port is O(catalog). It is
 * locale negotiation, re-run on every single `get`. A CPU profile of 200,000 repeats of one plain
 * key with no placeholders puts ~75% of self time in `locale-cldr.js` alias application and
 * canonicalization plus `locale-jdk-tag.js` tag splitting, reached through `matchForRanges` and
 * `candidateChain`.
 *
 * THAT IS A DELIBERATE DESIGN DECISION, NOT A DEFECT, and `test/cache-bounds.test.js` states it:
 * plan 3.4 blesses exactly one cache — "a constant instance locale may cache that result" — and the
 * port declines it, so that the plan's harder half ("resolver and per-call locale values are
 * normalized and recomputed on every use") holds by construction rather than by discipline. What
 * was never measured is what declining it costs. Priced by ABLATION against a scratch copy of
 * `src/` carrying that one blessed memo, catalog and rendered output identical on both sides:
 *
 *              request en-AU (full walk)      request en (direct hit)
 *   as shipped        82,985 ns/lookup             44,003 ns/lookup
 *   memoized          33,819 ns/lookup             24,228 ns/lookup
 *   declined cache   -49,166 ns  (-59%)           -19,775 ns  (-45%)
 *
 * The ablation is recorded here as a PRICE, not a proposal: taking that cache back is a plan
 * decision about `3.4`, not a tuning change, and no part of this tool argues for it.
 *
 * Run with --expose-gc, or the memory rows report n/a:
 *   node --expose-gc tools/scenario-2k.mjs [--write] [--keys 2000] [--iterations 9]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);

const argOf = (flag, fallback) =>
  process.argv.includes(flag) ? Number(process.argv[process.argv.indexOf(flag) + 1]) : fallback;

const KEYS = argOf("--keys", 2000);
const ITERATIONS = argOf("--iterations", 9);
if (!Number.isInteger(KEYS) || KEYS < 4) throw new Error("--keys must be an integer >= 4");
if (!Number.isInteger(ITERATIONS) || ITERATIONS < 3) throw new Error("--iterations must be >= 3");

/* ------------------------------------------------------------------ the catalog, and how it is made
 *
 * REPRODUCIBILITY IS THE POINT, so there is no random number generator here and no seed to remember.
 * The catalog is a pure function of the key INDEX: key `i` gets shape `i % 4`, and every string it
 * contains is that index formatted. Two runs on two machines build byte-identical input, and the
 * FNV-1a digest printed below is the proof rather than the promise — a number that is quoted with
 * a different digest beside it was not measured on this catalog.
 *
 * The four shapes are chosen to keep every layer of the port on the hot path, because a 2,000-key
 * figure taken over 2,000 plain strings would measure a Map lookup and nothing else:
 *
 *   0  plain          no placeholders at all: the cheapest path, and the control
 *   1  placeholder    one `{{name}}` substitution: interpolation without classification
 *   2  plural         a GENERATED placeholder over CARDINALITY_ONE/OTHER: the CLDR cardinal rule
 *                     engine and the plural tables run for every render
 *   3  alternatives   an `alternatives` expression: the tokenizer + compiler + evaluator run
 *
 * Exactly a quarter of the keys take each shape (KEYS is required to be >= 4; a KEYS not divisible
 * by 4 simply leaves the last group short, and the printed shape census says so).
 */
const pad = (i) => String(i).padStart(5, "0");

/** @param {number} i */
function definitionFor(i) {
  switch (i % 4) {
    case 0:
      return `Value ${pad(i)}`;
    case 1:
      return `Hello, {{name}} — item ${pad(i)}`;
    case 2:
      return {
        translation: `You have {{count}} {{units}} in slot ${pad(i)}`,
        placeholders: {
          units: {
            value: "count",
            translations: { CARDINALITY_ONE: "message", CARDINALITY_OTHER: "messages" },
          },
        },
      };
    default:
      return {
        translation: `Item ${pad(i)} for {{name}}`,
        alternatives: [{ [`count > ${i % 97}`]: `Item ${pad(i)} for {{name}} (bulk)` }],
      };
  }
}

/** The argument set every key can be rendered with; one object reused so arg construction is not timed. */
const ARGS = { name: "Ada", count: 3 };

const KEY_NAMES = Array.from({ length: KEYS }, (_, i) => `key.${pad(i)}`);

/**
 * Three locales, so the measurement runs a REAL fallback walk rather than a direct hit.
 *
 * `en` carries all KEYS. `en-001` and `fr` carry only every tenth key, which is what a partially
 * translated catalog actually looks like — and it means the default request below misses in `en-001`
 * nine times out of ten and falls through to `en`, exercising the walk, the attempted-locale dedup
 * and the failure policy on the majority of lookups. The `en` request measured alongside it is the
 * direct-hit control: the difference between the two rows IS the cost of the walk.
 */
function buildCatalog() {
  /** @type {Record<string, Record<string, unknown>>} */
  const catalog = { en: {}, "en-001": {}, fr: {} };
  for (let i = 0; i < KEYS; i++) {
    const key = KEY_NAMES[i];
    catalog.en[key] = definitionFor(i);
    if (i % 10 === 0) {
      catalog["en-001"][key] = `Value ${pad(i)} (en-001)`;
      catalog.fr[key] = `Valeur ${pad(i)}`;
    }
  }
  return catalog;
}

const CATALOG = buildCatalog();
const TIEBREAKERS = { en: ["en", "en-001"] };
/** The root entry point takes raw text and pays for parsing at construction; core takes it parsed. */
const RAW = Object.fromEntries(Object.entries(CATALOG).map(([tag, doc]) => [tag, JSON.stringify(doc)]));
const RAW_BYTES = Object.values(RAW).reduce((n, s) => n + Buffer.byteLength(s), 0);

/** FNV-1a over the canonical serialization, so a quoted number can be tied to the input it came from. */
function digest(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const CATALOG_DIGEST = digest(JSON.stringify(RAW));

/* ------------------------------------------------------------------------------------ statistics */

/**
 * Median, min, max and relative spread of a sample.
 *
 * Reporting the spread beside the median is not decoration: on this class of machine a construction
 * median moves by a few percent between runs and by tens of percent under load, and a reader
 * comparing two recorded numbers has no way to tell those apart from the median alone.
 */
function stats(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { median, min, max, spread: median === 0 ? 0 : (max - min) / median, n: xs.length };
}

let bust = 0;
async function timedImport(url) {
  const t0 = performance.now();
  const mod = await import(`${url}?m=${bust++}`);
  return { ms: performance.now() - t0, mod };
}

/**
 * Heap retained by something, measured from a baseline taken with the same module already imported.
 *
 * The "already imported" part is what makes the number mean what its label says. A cache-busted
 * import pulls a fresh copy of the ~192 KB of generated CLDR/IANA tables into the heap, so measuring
 * across the import would charge those tables to the catalog and report a 2,000-key instance as
 * costing hundreds of KB it does not own. Scenario 0a deliberately measures the other thing (module
 * + instance, because at 2 keys the module IS the cost); this measures the instance alone.
 */
async function retained(build) {
  if (!gc) return null;
  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  const held = await build();
  gc(); gc();
  const after = process.memoryUsage().heapUsed;
  if (!held) throw new Error("build() returned nothing");
  return { bytes: after - before, held };
}

/* -------------------------------------------------------------------------------- the measurement */

/**
 * @param {string} label
 * @param {string} entry repository-relative entry point
 * @param {(mod: any, locale: string) => any} construct
 */
async function measure(label, entry, construct) {
  const url = `file://${resolve(root, entry)}`;

  // COLD construction: a freshly imported module every iteration, so no JIT state, no warm ESM
  // cache and no shared internal cache carries between them. Import is timed separately because a
  // bundled app pays it once at load and construction once per instance; adding them would hide
  // which of the two a change moved.
  const imports = [];
  const constructions = [];
  const firstRenders = [];
  /** @type {string | null} */
  let sample = null;
  for (let i = 0; i < ITERATIONS; i++) {
    const { ms, mod } = await timedImport(url);
    imports.push(ms);

    const c0 = performance.now();
    const strings = construct(mod, "en-AU");
    constructions.push(performance.now() - c0);

    // FIRST render on a cold instance: whatever construction deferred is charged here.
    const r0 = performance.now();
    sample = strings.get(KEY_NAMES[1], ARGS);
    firstRenders.push(performance.now() - r0);
  }

  // STEADY STATE: one warm instance, swept key by key. Two request locales, because the fallback
  // walk is most of what a real app's misses cost and a direct-hit-only number would flatter it.
  const { mod } = await timedImport(url);
  /** @param {string} locale */
  const sweepOf = (locale) => {
    const strings = construct(mod, locale);
    for (let w = 0; w < 3; w++) for (const key of KEY_NAMES) strings.get(key, ARGS); // warm + JIT
    const perSweep = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      for (const key of KEY_NAMES) strings.get(key, ARGS);
      perSweep.push(performance.now() - t0);
    }
    return stats(perSweep.map((ms) => (ms * 1e6) / KEYS)); // nanoseconds per lookup
  };
  const steadyFallback = sweepOf("en-AU");
  const steadyDirect = sweepOf("en");

  // MEMORY, on an already-imported module (see `retained`). Two points: straight after construction,
  // and after every key has been rendered once, which is when the instance's caches are as full as
  // this catalog can make them. The second is the number a long-lived instance actually holds.
  const afterConstruction = await retained(async () => construct(mod, "en-AU"));
  const afterSweep = await retained(async () => {
    const strings = construct(mod, "en-AU");
    for (const key of KEY_NAMES) strings.get(key, ARGS);
    return strings;
  });

  return {
    label,
    entry,
    importMs: stats(imports),
    constructionMs: stats(constructions),
    firstRenderMs: stats(firstRenders),
    steadyLookupNsFallback: steadyFallback,
    steadyLookupNsDirect: steadyDirect,
    retainedAfterConstructionBytes: afterConstruction?.bytes ?? null,
    retainedAfterSweepBytes: afterSweep?.bytes ?? null,
    sample,
  };
}

const rows = [
  await measure("root + raw-text catalog", "src/index.js", (mod, locale) =>
    mod.createStrings({ fallbackLocale: "en", locale, strings: RAW, tiebreakers: TIEBREAKERS })),
  await measure("core + parsed equivalent", "src/core/index.js", (mod, locale) =>
    mod.createStrings({ fallbackLocale: "en", locale, strings: CATALOG, tiebreakers: TIEBREAKERS })),
];

/* ------------------------------------------------------------------------------------- reporting */

const census = [0, 1, 2, 3].map((s) => KEY_NAMES.filter((_, i) => i % 4 === s).length);
const kb = (n) => (n === null ? "n/a" : `${(n / 1024).toFixed(1)} KB`);
const ms = (s, d = 3) => `${s.median.toFixed(d)} (${s.min.toFixed(d)}–${s.max.toFixed(d)}, ±${(s.spread * 100).toFixed(0)}%)`;
const ns = (s) => `${s.median.toFixed(0)} ns (${s.min.toFixed(0)}–${s.max.toFixed(0)}, ±${(s.spread * 100).toFixed(0)}%)`;

console.log(`scenario 2k — Node ${process.version}, ${process.platform}/${process.arch}, median of ${ITERATIONS}${gc ? "" : "   (memory needs --expose-gc)"}`);
console.log(`\ncatalog: ${KEYS} keys × {en: all, en-001: every 10th, fr: every 10th} — index-derived, no RNG`);
console.log(`  shapes: ${census[0]} plain · ${census[1]} placeholder · ${census[2]} plural(generated) · ${census[3]} alternatives`);
console.log(`  raw JSON ${(RAW_BYTES / 1024).toFixed(1)} KB across 3 locales · FNV-1a digest ${CATALOG_DIGEST}`);
console.log(`  request locale en-AU with no en-AU catalog: every lookup walks en-AU -> en-001 -> en`);

for (const r of rows) {
  console.log(`\n${r.label}   (${r.entry})`);
  console.log(`  cold import          ${ms(r.importMs)} ms`);
  console.log(`  cold construction    ${ms(r.constructionMs)} ms          <- ${KEYS} keys parsed+validated`);
  console.log(`  first render         ${ms(r.firstRenderMs, 4)} ms`);
  console.log(`  steady lookup        ${ns(r.steadyLookupNsFallback)}/key   en-AU, full walk`);
  console.log(`  steady lookup        ${ns(r.steadyLookupNsDirect)}/key   en, direct hit (control)`);
  console.log(`  retained, built      ${kb(r.retainedAfterConstructionBytes)}   instance only; module already imported`);
  console.log(`  retained, swept      ${kb(r.retainedAfterSweepBytes)}   after every key rendered once`);
}

console.log(`\nrendered sample: ${JSON.stringify(rows[0].sample)}`);
// `--keys` is offered for scaling experiments, and a small value quietly stops measuring the thing
// the row is labelled with: at 8 keys a whole sweep is under a millisecond, so loop entry and
// `performance.now()` itself are a visible share of it and the per-lookup figure reads HIGH. Said
// out loud rather than left for the reader to rediscover — a number that is wrong for a reason the
// tool knows about is the tool's job to flag.
if (KEYS < 500)
  console.log(`\nCAUTION: --keys ${KEYS} is too small for the steady-state row to mean what it says; a sweep\nthat short is dominated by loop and timer overhead. Use it for scaling shape, not for a figure.`);
if (rows[0].sample !== rows[1].sample)
  console.error(`\nWARNING: root and core rendered different strings; the two variants are not measuring the same content`);

console.log(`
NO THRESHOLDS EXIST HERE, by the same decision that governs scenario 0a: M2/M7 sizing is tracked by
engineering measurement and no go/no-go line was ever frozen. Nothing above ratchets and this run
cannot fail on a number. Timings are machine- and load-dependent; the parenthesised range and ±
spread are how far this machine moved during THIS run, and are not a confidence interval.
Node-only: it says nothing about a browser, where module fetch, parse and GC all differ.`);

if (process.argv.includes("--write")) {
  const path = resolve(root, "measurements/scenario-2k.json");
  const record = {
    scenario: "2k",
    note: "Measurement, not a threshold. Nothing here ratchets; see the tool header.",
    generatedBy: "tools/scenario-2k.mjs",
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    catalog: {
      keys: KEYS,
      locales: { en: KEYS, "en-001": Math.ceil(KEYS / 10), fr: Math.ceil(KEYS / 10) },
      shapeCensus: { plain: census[0], placeholder: census[1], pluralGenerated: census[2], alternatives: census[3] },
      rawJsonBytes: RAW_BYTES,
      digest: CATALOG_DIGEST,
      derivation: "key i takes shape i % 4 and embeds its own index; no RNG, no seed",
      requestLocale: "en-AU (walks en-AU -> en-001 -> en); 'en' measured alongside as the direct-hit control",
    },
    iterations: ITERATIONS,
    variants: rows.map((r) => ({
      label: r.label,
      entry: r.entry,
      importMs: r.importMs,
      constructionMs: r.constructionMs,
      firstRenderMs: r.firstRenderMs,
      steadyLookupNsFallback: r.steadyLookupNsFallback,
      steadyLookupNsDirect: r.steadyLookupNsDirect,
      retainedAfterConstructionBytes: r.retainedAfterConstructionBytes,
      retainedAfterSweepBytes: r.retainedAfterSweepBytes,
    })),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nwritten to measurements/scenario-2k.json`);
} else {
  console.log(`\n(run with --write to record measurements/scenario-2k.json)`);
}
