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
 * This is a MEASUREMENT, not a gate. No threshold is asserted and nothing about a TIMING ratchets.
 *
 * WHAT CAN FAIL THIS RUN IS THE CATALOG'S IDENTITY (and, since 2026-09-26, a record missing what it
 * reports — see below), never a number anyone chose: if the catalog this tool builds no longer
 * digests to what `measurements/scenario-2k.json` recorded, the medians in
 * that artifact were measured on a DIFFERENT catalog and quoting them is simply false. The header
 * below already staked the tool's claims on that digest — "a number that is quoted with a different
 * digest beside it was not measured on this catalog" — so enforcing it asserts the tool's own stated
 * rule rather than importing a threshold. It is deterministic and machine-independent, which is
 * precisely what a timing is not.
 *
 * **AND THAT GATE DID NOT SURVIVE ITS RECORD** (2026-09-26, the proof obligation A33 restates).
 * Measured on the tool before the change: with `measurements/scenario-2k.json` deleted a run printed
 * "(run with --write to record …)" and exited 0, so the digest check disappeared with the file; and
 * with the catalog changed, a scaling write (`--write --keys 8`) recorded an 8-key catalog, after which
 * the default run compared nothing — the digest check ran only when `--keys` equalled the record's —
 * and exited 0 over the changed catalog. Now the scenario's catalog is FROZEN here (`SCENARIO_KEYS`
 * and the digest of the catalog that size builds, `FROZEN_CATALOG_DIGEST`), and every run checks it,
 * whatever `--keys` says: a missing or unreadable record FAILS, and `--write` will not start one or
 * write over one; a tool whose catalog no longer digests to the frozen value fails and refuses to
 * write until the digest is re-frozen in source — a deliberate edit; a record describing any other
 * catalog fails until `--write` re-records it; and `--write` records only the scenario's own catalog.
 * These are decided before anything is measured. There is no history here to chain: nothing but the
 * digest is gated, and the digest is frozen in source rather than carried by the record.
 *
 * **AND WHAT IS REPORTED IS REQUIRED PRESENT** (A33: "timings are reported and required present").
 * Measured the same day, after the rules above: `variants` and `graph` deleted from the record, exit 0
 * — the source graph printed "NOT RECORDED" and nothing failed. Every timing, both heap figures and
 * both source graphs must be in the record, each a finite number, or the run fails before measuring;
 * `--write` is the remedy, because the record is re-derived from a run in full. A write without
 * `--expose-gc` is refused, because it would record both heap figures as null and the next run would
 * refuse the record it wrote. `test/scenario-2k-record.test.js` runs each rule on a copy.
 *
 * Source-graph movement is REPORTED STALE and deliberately NOT gated, on scenario 0a's reasoning for
 * its browser half: the recorded timings describe the code as it stood, staleness is detectable by
 * arithmetic rather than by remembering, and it is printed every run — but re-recording is a
 * MEASUREMENT on a particular machine, so a gate demanding it would push machine-dependent numbers
 * into the artifact from whatever host happened to go red. A reader is told; nobody is coerced.
 *
 * This is what M7 clause 19 was amended to rest on. The clause originally read that the budgets
 * "are accepted", which asks an instrument to choose a number; as amended it reads that they are
 * recorded, ratcheted where a ratchet exists, and reported where none does. "Recorded" then has to
 * mean something a machine re-checks, or the clause rests on a JSON file somebody wrote once. The plan's M7 acceptance row speaks of "budgets accepted";
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { graphBytes } from "./graph-walk.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);

const argOf = (flag, fallback) =>
  process.argv.includes(flag) ? Number(process.argv[process.argv.indexOf(flag) + 1]) : fallback;

/** The scenario's catalog size: the "2k". `--keys` measures other sizes; only this one is recorded. */
const SCENARIO_KEYS = 2000;

/**
 * THE DIGEST OF THE CATALOG `SCENARIO_KEYS` BUILDS, frozen so that neither a deleted record nor a
 * re-written one can carry a different catalog past the check. Changing the catalog on purpose means
 * re-freezing this — a deliberate edit, which the diff shows — and then re-recording. `undefined`
 * only for a brand-new tool: see `--init`.
 * @type {string | undefined}
 */
const FROZEN_CATALOG_DIGEST = "84280c24";

const KEYS = argOf("--keys", SCENARIO_KEYS);
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

const keyName = (/** @type {number} */ i) => `key.${pad(i)}`;
const KEY_NAMES = Array.from({ length: KEYS }, (_, i) => keyName(i));

/**
 * Three locales, so the measurement runs a REAL fallback walk rather than a direct hit.
 *
 * `en` carries all KEYS. `en-001` and `fr` carry only every tenth key, which is what a partially
 * translated catalog actually looks like — and it means the default request below misses in `en-001`
 * nine times out of ten and falls through to `en`, exercising the walk, the attempted-locale dedup
 * and the failure policy on the majority of lookups. The `en` request measured alongside it is the
 * direct-hit control: the difference between the two rows IS the cost of the walk.
 */
/** @param {number} keys */
function buildCatalog(keys) {
  /** @type {Record<string, Record<string, unknown>>} */
  const catalog = { en: {}, "en-001": {}, fr: {} };
  for (let i = 0; i < keys; i++) {
    const key = keyName(i);
    catalog.en[key] = definitionFor(i);
    if (i % 10 === 0) {
      catalog["en-001"][key] = `Value ${pad(i)} (en-001)`;
      catalog.fr[key] = `Valeur ${pad(i)}`;
    }
  }
  return catalog;
}

const CATALOG = buildCatalog(KEYS);
const TIEBREAKERS = { en: ["en", "en-001"] };
/** @param {Record<string, Record<string, unknown>>} catalog */
const rawOf = (catalog) => Object.fromEntries(Object.entries(catalog).map(([tag, doc]) => [tag, JSON.stringify(doc)]));
/** The root entry point takes raw text and pays for parsing at construction; core takes it parsed. */
const RAW = rawOf(CATALOG);
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
/** The digest of the SCENARIO's catalog, whatever size this run measures: what the checks below hold. */
const SCENARIO_DIGEST = KEYS === SCENARIO_KEYS ? CATALOG_DIGEST : digest(JSON.stringify(rawOf(buildCatalog(SCENARIO_KEYS))));

/** The two variants, named here so the record can be checked for them before anything is measured. */
const VARIANTS = Object.freeze([
  Object.freeze({ label: "root + raw-text catalog", entry: "src/index.js", strings: RAW }),
  Object.freeze({ label: "core + parsed equivalent", entry: "src/core/index.js", strings: CATALOG }),
]);
/** What a record holds per variant: timings as median/min/max/spread over n, heap as bytes. */
const TIMINGS = ["importMs", "constructionMs", "firstRenderMs", "steadyLookupNsFallback", "steadyLookupNsDirect"];
const HEAP = ["retainedAfterConstructionBytes", "retainedAfterSweepBytes"];
const isNumber = (/** @type {unknown} */ n) => typeof n === "number" && Number.isFinite(n);
const isCount = (/** @type {unknown} */ n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;
const isTiming = (/** @type {any} */ s) => Boolean(s) && typeof s === "object" &&
  ["median", "min", "max", "spread"].every((field) => isNumber(s[field])) && Number.isSafeInteger(s.n) && s.n >= 3;

/**
 * Everything the record reports and nothing compares: each variant's timings and heap figures, and each
 * entry's source graph. Required present, never compared — a record missing one fails, and `--write`
 * re-records it.
 * @param {any} from
 * @returns {string[]}
 */
function unrecordedProblems(from) {
  /** @type {string[]} */
  const problems = [];
  const rows = Array.isArray(from.variants) ? from.variants : [];
  for (const variant of VARIANTS) {
    const matching = rows.filter((/** @type {any} */ row) => row?.label === variant.label);
    if (matching.length !== 1) {
      problems.push(`NOT RECORDED: ${RECORD} holds ${matching.length} rows for "${variant.label}", not one, so its ` +
        "timings and heap figures are missing or ambiguous. Timings are reported and required present (A33); " +
        "re-record with --write");
    } else {
      for (const field of TIMINGS)
        if (!isTiming(matching[0][field]))
          problems.push(`NOT RECORDED: ${RECORD} holds no measured ${field} for "${variant.label}" ` +
            `(${JSON.stringify(matching[0][field]) ?? "nothing"}); timings are reported and required present (A33). ` +
            "Re-record with --write");
      for (const field of HEAP)
        if (!isNumber(matching[0][field]))
          problems.push(`NOT RECORDED: ${RECORD} holds no measured ${field} for "${variant.label}" ` +
            `(${JSON.stringify(matching[0][field]) ?? "nothing"}); heap figures are reported and required present. ` +
            "Re-record with --write under --expose-gc");
    }
    const graph = from.graph && typeof from.graph === "object" ? from.graph[variant.entry] : undefined;
    if (!graph || !isCount(graph.bytes) || !isCount(graph.modules))
      problems.push(`NOT RECORDED: ${RECORD} holds no source graph for ${variant.entry}, so whether its timings ` +
        "describe this source cannot be said. Re-record with --write");
  }
  return problems;
}

/* ----------------------------------------------------------------- the record, before any measuring
 *
 * Decided before a single timing is taken, because none of it depends on one, and a run that fails
 * here has nothing its timings could be compared with. Two kinds of finding:
 *
 *   BROKEN — no write may proceed: a record that cannot be read (restore it from git), and a tool whose
 *            catalog no longer digests to the frozen value (re-freeze it in source first, deliberately).
 *   STALE  — the record describes another catalog than the scenario's, or lacks a timing, a heap
 *            figure or a source graph: fails the run, and `--write` is the remedy, because the record is
 *            re-derived from this run in full.
 */
const RECORD = "measurements/scenario-2k.json";
const recordedPath = resolve(root, RECORD);
const writing = process.argv.includes("--write");
const init = process.argv.includes("--init");
/** @type {string[]} */
const broken = [];
/** @type {string[]} */
const stale = [];
const missing = !existsSync(recordedPath);
/** @type {any} */
let recorded = null;
if (!missing) {
  // An unreadable record is BROKEN, never "missing", and never agreement: it used to read as absent.
  /** @type {unknown} */
  let parsed;
  try { parsed = JSON.parse(readFileSync(recordedPath, "utf8")); } catch (error) {
    broken.push(`${RECORD} is not valid JSON (${/** @type {Error} */ (error).message}); restore it from git`);
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) recorded = parsed;
  else if (parsed !== undefined) broken.push(`${RECORD} holds ${JSON.stringify(parsed)}, not a record; restore it from git`);
}
if (FROZEN_CATALOG_DIGEST !== undefined && SCENARIO_DIGEST !== FROZEN_CATALOG_DIGEST)
  broken.push(`this tool builds a different ${SCENARIO_KEYS}-key catalog (digest ${SCENARIO_DIGEST}) from the one ` +
    `frozen in it (${FROZEN_CATALOG_DIGEST}): a changed catalog is a changed scenario, and every recorded median ` +
    `describes the old one. If the change is deliberate, freeze "${SCENARIO_DIGEST}" as FROZEN_CATALOG_DIGEST, ` +
    `then re-record with --write`);
if (recorded && (recorded.catalog?.keys !== SCENARIO_KEYS || recorded.catalog?.digest !== SCENARIO_DIGEST))
  stale.push(`the recorded measurement describes a different catalog (${JSON.stringify(recorded.catalog?.keys)} ` +
    `keys, digest ${JSON.stringify(recorded.catalog?.digest)}; the scenario's is ${SCENARIO_KEYS} keys, digest ` +
    `${SCENARIO_DIGEST}). Every median in ${RECORD} was produced against it, so quoting them alongside today's ` +
    `catalog states something false. Re-record deliberately — node --expose-gc tools/scenario-2k.mjs --write — ` +
    "and say in the commit what changed the catalog, because every historical comparison breaks");
if (recorded) stale.push(...unrecordedProblems(recorded));

if (writing) {
  /** @type {string[]} */
  const refusals = [...broken];
  if (!gc)
    refusals.push("--write needs --expose-gc: without it both heap figures would be recorded as null, and the next " +
      "run would refuse the record this write produced");
  if (KEYS !== SCENARIO_KEYS)
    refusals.push(`--write records the scenario's ${SCENARIO_KEYS}-key catalog, and --keys ${KEYS} measures another ` +
      "one: its record would describe a catalog this scenario is not, and the next run would refuse it");
  if (!missing && init) refusals.push(`--init starts a first record, and ${RECORD} exists; drop --init`);
  if (missing) {
    // A FIRST RECORD IS A LOUD, EXPLICIT ACT, and it is refused once the tool freezes a digest.
    if (!init)
      refusals.push(`${RECORD} does not exist, and --write will not start a new one: it would record ` +
        `whatever catalog this tree builds today. Restore it from git (git checkout -- ${RECORD}).`);
    else if (FROZEN_CATALOG_DIGEST !== undefined)
      refusals.push(`--init refused: this tool freezes the catalog digest ${FROZEN_CATALOG_DIGEST}, so a record ` +
        "has existed. Restore it from git");
  }
  if (refusals.length) {
    console.error(`refusing to write ${RECORD} (nothing was measured):`);
    for (const line of refusals) console.error(`  ${line}`);
    process.exit(2);
  }
} else {
  // ABSENCE IS NEVER AGREEMENT. This used to print "(run with --write to record …)" and exit 0.
  /** @type {string[]} */
  const problems = [...broken, ...stale];
  if (missing)
    problems.unshift(`NOT RECORDED: ${RECORD} does not exist, so the catalog digest is checked against nothing. ` +
      `Restore it from git (git checkout -- ${RECORD}); --write will not start a new one.`);
  if (FROZEN_CATALOG_DIGEST === undefined)
    problems.push(`this tool freezes no catalog digest, so a record written again could carry any catalog; freeze ` +
      `"${SCENARIO_DIGEST}" as FROZEN_CATALOG_DIGEST`);
  if (problems.length) {
    console.error(`scenario 2k — FAILED before measuring (nothing was measured):`);
    for (const line of problems) console.error(`  ${line}`);
    process.exit(1);
  }
}

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

/** @type {Awaited<ReturnType<typeof measure>>[]} */
const rows = [];
for (const variant of VARIANTS)
  rows.push(await measure(variant.label, variant.entry, (mod, locale) =>
    mod.createStrings({ fallbackLocale: "en", localeSupplier: () => locale, localizedStringSupplier: () => (variant.strings), tiebreakerLocalesByLanguageCode: TIEBREAKERS })));

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

/**
 * Does `measurements/scenario-2k.json` still describe THIS catalog and THESE source files?
 *
 * Split deliberately into a gate and a report, because the two questions have different answers.
 * The catalog is derived with no RNG and no seed, so its digest is a fact about the code alone and a
 * mismatch is never noise: it means the recorded medians belong to a catalog that no longer exists.
 * That half is decided above, before anything was measured, and a run that reaches this point has
 * passed it. The source graph is equally deterministic, but what goes stale WITH it is a set of
 * timings that only a re-run on some particular machine can refresh — so that half is printed, never
 * enforced.
 */
const GRAPH = Object.fromEntries(rows.map((r) => [r.entry, graphBytes(root, r.entry)]));

if (recorded && !writing && KEYS !== SCENARIO_KEYS) {
  console.log(`\nagainst ${RECORD}: the record describes the scenario's ${SCENARIO_KEYS}-key catalog (checked above);`);
  console.log(`  this run measured --keys ${KEYS}, so none of its timings compare with it, and --write is refused`);
} else if (recorded && !writing) {
  console.log(`\nagainst ${RECORD}:`);
  console.log(`  catalog        digest ${CATALOG_DIGEST} unchanged — the recorded medians describe THIS catalog`);

  // Both entries' recorded graphs were required present before anything was measured, so a missing
  // one has already failed the run rather than being read here as "fresh". It used to print
  // "NOT RECORDED" at this point and exit 0.
  const moved = rows
    .map((r) => ({ entry: r.entry, was: recorded.graph[r.entry], now: GRAPH[r.entry] }))
    .filter((g) => g.was.bytes !== g.now.bytes || g.was.modules !== g.now.modules);
  if (moved.length === 0) {
    console.log(`  source graph   unchanged in both variants — the recorded timings describe THIS source`);
  } else {
    console.log(`  source graph   STALE in ${moved.length} variant(s); the timings above were measured on different code:`);
    for (const g of moved)
      console.log(`                 ${g.entry}  ${g.was.bytes} B / ${g.was.modules} modules -> ${g.now.bytes} B / ${g.now.modules} modules`);
    console.log(`                 REPORTED, NOT GATED (see the header): refresh with`);
    console.log(`                 node --expose-gc tools/scenario-2k.mjs --write`);
  }
}

console.log(`
NO THRESHOLDS EXIST HERE, by the same decision that governs scenario 0a: M2/M7 sizing is tracked by
engineering measurement and no go/no-go line was ever frozen. Nothing above ratchets and this run
cannot fail on a TIMING — what fails it is the catalog's identity: a record that is missing or
unreadable, or a catalog, the tool's or the record's, that is not the one frozen in this tool, which is
a staleness fact, not a budget — and a record that lacks a timing, a heap figure or a source graph,
which are reported and required present, never compared. Timings are machine- and load-dependent; the
parenthesised range and ± spread are how far this machine moved during THIS run, and are not a
confidence interval. Node-only: it says nothing about a browser, where module fetch, parse and GC all
differ.`);

if (writing) {
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
    // Recorded so a later run can say whether these timings still describe the shipping source.
    // Same arithmetic scenario 0a ratchets on, via the walker both tools now share.
    graph: GRAPH,
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
  mkdirSync(dirname(recordedPath), { recursive: true });
  writeFileSync(recordedPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nwritten to ${RECORD}`);
  if (FROZEN_CATALOG_DIGEST === undefined) {
    console.error(`\nA FIRST RECORD WAS WRITTEN. Freeze its catalog in this tool before anything else:\n` +
      `  const FROZEN_CATALOG_DIGEST = "${CATALOG_DIGEST}";\n` +
      `Until then every run fails, because a record written again could carry any catalog.`);
    process.exit(1);
  }
}
