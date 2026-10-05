// @ts-check
/**
 * SCENARIOS 1-5's VERDICTS, as pure functions over a measured run and a record — so that
 * `test/scenarios-1-5.test.js` can show each rule failing on a synthetic record in milliseconds, which
 * is the only way to know a rule CAN fail. `tools/scenarios-1-5.mjs` measures, prints and hands each
 * verdict to its exit status; everything that decides pass or fail is here.
 *
 * Findings come in five kinds, and the kind is the whole policy:
 *
 *   problem      always fails, and `--write` is refused over it: a frozen digest moved, a recipe that
 *                measures nothing, containment, an unclassified data module, a wrong render, unordered
 *                columns, a rebuild that is not the shipped artifact, a sample that crashed, a runtime
 *                figure missing or not finite in the run or the record, a history that does not chain
 *                or whose newest entry is not the one frozen in source;
 *   growth       fails unless it is re-recorded with `--write --reason`, whose reason the chained
 *                history keeps: a ratcheted column grew, a module entered a graph, a compressed column
 *                grew beyond its tolerance, the record omits or carries a scenario the run does not, a
 *                scenario or the suite is at another revision;
 *   stale        reported: a shrink, compressed movement inside the tolerance, a data row that moved;
 *   moved        reported: a figure that moved where no comparison applies — another scenario revision,
 *                another compressor version — old -> new, so the write that absorbs it keeps it in the
 *                history instead of dropping it;
 *   notCompared  reported: which compressed columns another compressor version kept out of comparison.
 *
 * **THIS FILE IS IN NO RECIPE DIGEST, ON PURPOSE** (`recipe.mjs` says why), so nothing but tests holds
 * these rules: each is seen failing in `test/scenarios-1-5.test.js`, `tolerance` against literal numbers
 * at every figure the record holds, and the runner's hand-off of each verdict to its exit status by a
 * pin on its source — a rule the runner stopped calling would otherwise fail nothing at all.
 */
import { chainProblems, chained, entryDigest } from "../ratchet-chain.mjs";
import { METHOD } from "./recipe.mjs";

export const RECORD_NAME = "measurements/scenarios-1-5.json";
/** Where the frozen tables live, for the messages that ask for a paste into them. */
const RECIPE_FILE = "tools/scenarios-1-5/recipe.mjs";

/**
 * @typedef {{ rawSource: number, rawModules: number, preMinify: number, minified: number, gzip9: number,
 *   brotliQ11: number, brotliQ5: number, requests: number }} Columns
 * @typedef {{ form: string, files: string[], columns: Columns, dataRows: Record<string, number>,
 *   includedGraph: string[], runtime?: unknown }} Variant
 * @typedef {{ title?: string, revision: number, recipeSha256: string, fixtureSha256: string,
 *   variants: Record<string, Variant> }} Scenario
 * @typedef {{ suite: { revision: number, sha256: string }, compressors: Record<string, string>,
 *   scenarios: Record<string, Scenario> }} Run
 * @typedef {{ revisions: Record<string, number>, recipe: Record<string, string>,
 *   fixture: Record<string, string>, suite: { revision: number, sha256: string } }} Current
 * @typedef {{ recipeDigests: Readonly<Record<string, Readonly<Record<number, string>>>>,
 *   fixtureDigests: Readonly<Record<string, Readonly<Record<number, string>>>>,
 *   suiteDigests: Readonly<Record<number, string>> }} Frozen
 */

const short = (/** @type {unknown} */ digest) => String(digest).slice(0, 12);

// ============================================================================ the frozen suite

/**
 * The recipes and fixtures as they are now, against the digests frozen in SOURCE for their revisions.
 * Frozen in source rather than read from the record, so deleting and re-writing the record cannot
 * launder a change under an unmoved revision.
 * @param {Current} current @param {Frozen} frozen @returns {string[]}
 */
export function frozenProblems(current, frozen) {
  /** @type {string[]} */
  const problems = [];
  const ids = Object.keys(current.revisions);
  if (ids.length === 0)
    problems.push("RECIPES is empty, so the suite measures nothing and every comparison below would agree with it");
  /** @type {[Frozen["recipeDigests"], string, Record<string, string>, string][]} */
  const tables = [[frozen.recipeDigests, "RECIPE_DIGESTS", current.recipe, "recipe"],
    [frozen.fixtureDigests, "FIXTURE_DIGESTS", current.fixture, "fixture"]];
  for (const [table, name, now, what] of tables) {
    // A FROZEN SCENARIO THAT NO RECIPE MEASURES WAS DELETED. Walking only the recipes that exist — as
    // the prototype did — let deleting scenario 5, or emptying RECIPES, exit 0 (review item A).
    for (const id of Object.keys(table))
      if (!ids.includes(id))
        problems.push(`scenario ${id} is frozen in ${name} and no recipe measures it: a frozen scenario was deleted`);
    for (const id of ids) {
      const revision = /** @type {number} */ (current.revisions[id]);
      const want = table[id]?.[revision];
      if (want === undefined)
        problems.push(`scenario ${id} revision ${revision} has no frozen ${what} digest in ${name}; freeze "${now[id]}" for it`);
      else if (want !== now[id])
        problems.push(`scenario ${id}'s ${what} changed (${short(want)} -> ${short(now[id])}) while its revision stayed ` +
          `${revision}. Bump the revision and freeze the new digests beside the old, or put the ${what} back: ` +
          "runs either side of the change are not the same scenario (plan 9.2:2795-2797)");
    }
  }
  const suite = frozen.suiteDigests[current.suite.revision];
  if (suite === undefined)
    problems.push(`suite revision ${current.suite.revision} has no frozen digest in SUITE_DIGESTS; freeze "${current.suite.sha256}"`);
  else if (suite !== current.suite.sha256)
    problems.push(`the suite changed (${short(suite)} -> ${short(current.suite.sha256)}) while SUITE_REVISION stayed ` +
      `${current.suite.revision}. Plan 9.3:2855-2860's suite revision is immutable and changes only through a reviewed ` +
      "rebaseline: bump SUITE_REVISION and freeze the new digest beside the old");
  return problems;
}

/**
 * A RECIPE THAT MEASURES NOTHING IS NOT A SCENARIO, whatever its digests say. The frozen tables hold a
 * recipe to ITSELF across a revision, so they cannot tell a scenario from its husk: a review set scenario
 * 5 to `variants: []` at revision 2, froze the new digests as this tool's own messages said to, and
 * `--write`, the check and every test passed (2026-09-25). What a scenario IS — which forms, reaching
 * which modules — is pinned by `test/scenarios-1-5.test.js`; this is the part a run can judge alone.
 * @param {Readonly<Record<string, any>>} recipes @param {Readonly<Record<string, string>>} entries
 */
export function recipeShapeProblems(recipes, entries) {
  /** @type {string[]} */
  const problems = [];
  for (const [id, recipe] of Object.entries(recipes)) {
    const at = `scenario ${id}`;
    const variants = Array.isArray(recipe?.variants) ? recipe.variants : [];
    if (variants.length === 0) problems.push(`${at} declares no variant, so it measures nothing`);
    if (!Array.isArray(recipe?.mustReach) || recipe.mustReach.length === 0)
      problems.push(`${at} must reach no module, so containment cannot say what it measures`);
    if (!Array.isArray(recipe?.mustNotReach)) problems.push(`${at} declares no mustNotReach list`);
    else for (const module of recipe.mustNotReach)
      if (recipe.mustReach?.includes(module)) problems.push(`${at} both must and must not reach ${module}`);
    if (recipe?.input !== "raw" && recipe?.input !== "parsed")
      problems.push(`${at}'s input is ${JSON.stringify(recipe?.input)}; the harness knows "raw" and "parsed"`);
    if (typeof recipe?.fixture !== "string" || recipe.fixture === "") problems.push(`${at} names no fixture`);
    /** @type {Set<unknown>} */ const labels = new Set();
    for (const variant of variants) {
      const where = `${at} ${variant?.label}`;
      if (typeof variant?.label !== "string" || variant.label === "") problems.push(`${at} has a variant with no label`);
      else if (labels.has(variant.label)) problems.push(`${at} has two variants labelled ${variant.label}`);
      labels.add(variant?.label);
      if (variant?.form === "no-build") {
        if (!Array.isArray(variant.files) || variant.files.length === 0)
          problems.push(`${where} is a no-build form that fetches no file`);
      } else if (variant?.form === "bundler") {
        if (typeof entries[variant.entry] !== "string")
          problems.push(`${where} compiles entry ${JSON.stringify(variant.entry)}, which ENTRIES does not define`);
      } else problems.push(`${where}'s form is ${JSON.stringify(variant?.form)}; the runner knows "no-build" and "bundler"`);
      if (variant?.data !== undefined && (typeof variant.data?.option !== "string" || typeof variant.data?.export !== "string"))
        problems.push(`${where} hands the page optional data with no option or export name`);
    }
  }
  return problems;
}

/**
 * Every frozen scenario and variant was measured, and nothing else was.
 * @param {Readonly<Record<string, { variants: readonly { label: string }[] }>>} recipes @param {Run} run
 */
export function measuredProblems(recipes, run) {
  /** @type {string[]} */
  const problems = [];
  for (const [id, recipe] of Object.entries(recipes))
    for (const { label } of recipe.variants)
      if (!run.scenarios[id]?.variants?.[label]) problems.push(`scenario ${id} ${label} is frozen and was not measured`);
  for (const [id, scenario] of Object.entries(run.scenarios))
    for (const label of Object.keys(scenario.variants))
      if (!recipes[id]?.variants.some((variant) => variant.label === label))
        problems.push(`scenario ${id} ${label} was measured and no frozen recipe names it`);
  return problems;
}

// ================================================================================== the record

/**
 * The part of a record its history vouches for: every compared figure and what it was measured under.
 * The run attestation and the runtime timings are not in it — they are reported, never compared.
 * @param {any} record
 */
export function baselineSha256(record) {
  const scenarios = Object.fromEntries(Object.entries(record?.scenarios ?? {}).map(([id, s]) => [id, {
    revision: /** @type {any} */ (s)?.revision, recipeSha256: /** @type {any} */ (s)?.recipeSha256,
    fixtureSha256: /** @type {any} */ (s)?.fixtureSha256,
    variants: Object.fromEntries(Object.entries(/** @type {any} */ (s)?.variants ?? {}).map(([label, v]) => [label, {
      form: v?.form, files: v?.files, columns: v?.columns, dataRows: v?.dataRows, includedGraph: v?.includedGraph }])),
  }]));
  return entryDigest({ suite: record?.suite, compressors: record?.compressors, scenarios });
}

/**
 * THE NEWEST ENTRY, AGAINST THE ONE FROZEN IN SOURCE. The chain names every entry but the newest, so on
 * its own it cannot see its end: a review wrote a second entry, then added 5,000 bytes to every figure
 * and recomputed ONLY that entry's `baselineSha256`, and the check passed — and passed again over 14
 * real bytes of source growth, with the history still saying nothing moved (2026-09-25). Freezing the
 * newest entry pins every one before it, because each entry's digest covers the link to the one before.
 * So a `--write` is not finished until its entry is pasted into `recipe.mjs`, and until then this fails
 * naming the paste — which is also what refuses a second write on top of an unreviewed entry. It GATES
 * an entry after the frozen one rather than reporting it: reported, a hand-written entry vouching for
 * inflated figures would pass every run until somebody moved the pin, which is the hole this closes.
 * @param {unknown} history @param {{ index: number, sha256: string } | undefined} newest
 * @returns {string[]}
 */
export function newestEntryProblems(history, newest) {
  // An absent, empty or hand-mangled history is `chainProblems`' to name; repeating it adds nothing.
  if (!Array.isArray(history) || history.length === 0 ||
    history.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) return [];
  const last = history.length - 1;
  const paste = `HISTORY_NEWEST_ENTRY = Object.freeze(${JSON.stringify({ index: last, sha256: entryDigest(history[last]) })})`;
  if (newest === undefined)
    return [`${RECORD_NAME}'s newest history entry is frozen nowhere, so it could be rewritten with the figures it vouches ` +
      `for; after review, freeze ${paste} in ${RECIPE_FILE}`];
  if (!Number.isSafeInteger(newest?.index) || newest.index < 0 || typeof newest?.sha256 !== "string")
    return [`${RECIPE_FILE} freezes the newest history entry as ${JSON.stringify(newest)}, which is not an entry index ` +
      `and a digest; freeze ${paste} after review`];
  if (last < newest.index)
    return [`${RECORD_NAME}'s history ends at entry ${last} and ${RECIPE_FILE} freezes it through entry ${newest.index}: ` +
      "entries were cut from its end. Restore the record from git"];
  if (entryDigest(history[newest.index]) !== newest.sha256)
    return [`${RECORD_NAME}: history entry ${newest.index} is not the entry ${RECIPE_FILE} freezes (${short(newest.sha256)}); ` +
      "it, or an entry before it, was edited, replaced or deleted. Restore the record from git"];
  if (last > newest.index)
    return [`${RECORD_NAME}'s history has ${last - newest.index} entr${last - newest.index === 1 ? "y" : "ies"} after entry ` +
      `${newest.index}, the newest ${RECIPE_FILE} freezes: written by --write or by hand, and not yet reviewed into source. ` +
      `Review the record's diff, then freeze ${paste} there — or restore the record from git`];
  return [];
}

/**
 * The record's own integrity, and whether it describes the scenarios this run measured. A missing record
 * is NOT RECORDED, a problem: absence is never agreement.
 * @param {any} record @param {Run} run
 * @param {{ origin: string | undefined, newest: { index: number, sha256: string } | undefined }} frozen the
 *   history's first entry's digest and its newest entry, both frozen in `recipe.mjs`
 * @returns {{ problems: string[], growth: string[] }}
 */
export function recordFindings(record, run, { origin, newest }) {
  /** @type {string[]} */ const problems = [];
  /** @type {string[]} */ const growth = [];
  if (record === null || record === undefined)
    return { problems: [`NOT RECORDED: ${RECORD_NAME} does not exist, and absence is never agreement`], growth };
  if (record.formatVersion !== 1) problems.push(`${RECORD_NAME} has formatVersion ${record?.formatVersion}; this tool reads 1`);
  // THE RECORDED RUNTIME IS REQUIRED PRESENT TOO, though its history does not vouch for it (it is never
  // compared): deleting `runtime.importMs` from all 8 variants exited 0 before this (a review, 2026-09-26).
  problems.push(...runtimeProblems(RECORD_NAME, record?.scenarios).map((line) => `${line}; restore the record from git`));

  // THE HISTORY. Chained, with its first and newest entries frozen in source, so the baseline survives
  // deletion of the record — a re-written record starts a history that does not begin at the frozen
  // origin — and an edit to its newest entry, which is the one thing a chain cannot see.
  problems.push(...chainProblems(record?.history, origin, RECORD_NAME), ...newestEntryProblems(record?.history, newest));
  if (Array.isArray(record?.history) && record.history.length > 0) {
    record.history.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
      if (typeof entry?.reason !== "string" || entry.reason.trim() === "")
        problems.push(`${RECORD_NAME}: history entry ${i} carries no reason; every baseline must say why it moved`);
    });
    // THE LAST ENTRY VOUCHES FOR THE FIGURES. Without this, editing a figure in place and leaving the
    // history alone would pass: the chain would be intact and describe some other baseline.
    const last = record.history[record.history.length - 1];
    if (last?.baselineSha256 !== baselineSha256(record))
      problems.push(`${RECORD_NAME}'s figures are not the ones its last history entry recorded ` +
        `(${short(last?.baselineSha256)} recorded, ${short(baselineSha256(record))} now): they were edited by hand. ` +
        "Restore the record from git; a baseline moves only through --write --reason");
  }

  if (record?.suite?.revision === run.suite.revision && record.suite.sha256 !== run.suite.sha256)
    problems.push(`${RECORD_NAME} was taken under suite ${short(record.suite.sha256)} and this is ` +
      `${short(run.suite.sha256)}, at the same suite revision ${run.suite.revision}`);
  else if (record?.suite?.revision !== run.suite.revision)
    growth.push(`the suite is at revision ${run.suite.revision} and the record at ${record?.suite?.revision}: ` +
      "not comparable, so it is re-recorded deliberately");

  for (const [id, now] of Object.entries(run.scenarios)) {
    const was = record?.scenarios?.[id];
    if (!was) { growth.push(`scenario ${id}: NOT RECORDED, and a new scenario is recorded deliberately`); continue; }
    if (was.revision !== now.revision) {
      growth.push(`scenario ${id} is at revision ${now.revision} and the record at ${was.revision}: not comparable, ` +
        "so it is re-recorded deliberately");
      continue;
    }
    for (const what of /** @type {const} */ (["recipeSha256", "fixtureSha256"]))
      if (was[what] !== now[what])
        problems.push(`scenario ${id}: the record was taken under ${what.replace("Sha256", "")} ${short(was[what])} and ` +
          `this is ${short(now[what])}, at the same revision ${now.revision}`);
    for (const label of Object.keys(now.variants))
      if (!was.variants?.[label]) growth.push(`scenario ${id} ${label}: NOT RECORDED`);
    for (const label of Object.keys(was.variants ?? {}))
      if (!now.variants[label]) growth.push(`scenario ${id} ${label}: the record carries it and this run did not measure it`);
  }
  for (const id of Object.keys(record?.scenarios ?? {}))
    if (!run.scenarios[id]) growth.push(`scenario ${id}: the record carries it and this run did not measure it`);
  return { problems, growth };
}

/** A runtime figure's name, and whether a value is one: each timing a finite, positive time, heap finite bytes. */
const RUNTIME_FIGURES = Object.freeze({
  importMs: (/** @type {unknown} */ v) => Number.isFinite(v) && /** @type {number} */ (v) > 0,
  constructMs: (/** @type {unknown} */ v) => Number.isFinite(v) && /** @type {number} */ (v) > 0,
  firstRenderMs: (/** @type {unknown} */ v) => Number.isFinite(v) && /** @type {number} */ (v) > 0,
  retainedBytes: (/** @type {unknown} */ v) => Number.isFinite(v),
});

/**
 * THE RUNTIME IS REPORTED AND REQUIRED PRESENT — A33 (4). Its figures are never compared, so a slower
 * run passes; what fails is a variant whose runtime is missing or holds a figure that is not a finite
 * number (each timing a positive one). Measured 2026-09-26 by a review, before this: `const runtime =
 * sampled.runtime;` in the runner changed to `null` exited 0 with every timing printed as a dash, and
 * `test/scenarios-1-5.test.js` stayed green. The runner hands this the run it is about to record, whatever happened
 * between the sample and the record, and `recordFindings` hands it the record.
 * @param {string} where how to name the owner in a message: the run, or the record
 * @param {unknown} scenarios a run's or a record's `scenarios`
 * @returns {string[]}
 */
export function runtimeProblems(where, scenarios) {
  /** @type {string[]} */
  const problems = [];
  for (const [id, scenario] of Object.entries(scenarios && typeof scenarios === "object" ? scenarios : {}))
    for (const [label, v] of Object.entries(/** @type {any} */ (scenario)?.variants ?? {})) {
      const at = `${where}: scenario ${id} ${label}`;
      const runtime = /** @type {any} */ (v)?.runtime;
      if (!runtime || typeof runtime !== "object") {
        problems.push(`${at} carries no runtime sample; its timings and heap are reported, never compared, and required present`);
        continue;
      }
      if (!Number.isSafeInteger(runtime.samples) || runtime.samples < 1)
        problems.push(`${at}'s runtime is aggregated from ${JSON.stringify(runtime.samples)} samples, not a count of them`);
      for (const [figure, holds] of Object.entries(RUNTIME_FIGURES))
        if (!holds(runtime[figure]))
          problems.push(`${at}'s runtime ${figure} is ${String(runtime[figure])}, not a finite ` +
            `${figure === "retainedBytes" ? "number of bytes" : "positive time"}; reported, never compared, and required present`);
    }
  return problems;
}

/** The compressed columns' tolerance on a recorded value. @param {number} was */
export const tolerance = (was) =>
  Math.max(METHOD.tolerance.compressedBytes, Math.ceil(was * METHOD.tolerance.compressedFraction));

/**
 * Every figure that differs between two measurements of a variant, old -> new, graph membership included.
 * @param {string} at @param {any} was @param {any} now @param {readonly string[]} columns @param {boolean} graph
 */
function moves(at, was, now, columns, graph) {
  /** @type {string[]} */
  const lines = [];
  for (const column of columns) {
    const [a, b] = [was.columns?.[column], now.columns?.[column]];
    if (a === b) continue;
    const delta = typeof a === "number" && typeof b === "number" ? ` (${b > a ? "+" : ""}${b - a})` : "";
    lines.push(`${at}: ${column} ${a ?? "(none)"} -> ${b ?? "(none)"}${delta}`);
  }
  if (graph) {
    const entered = (now.includedGraph ?? []).filter((/** @type {string} */ m) => !(was.includedGraph ?? []).includes(m));
    const left = (was.includedGraph ?? []).filter((/** @type {string} */ m) => !(now.includedGraph ?? []).includes(m));
    if (entered.length) lines.push(`${at}: ${entered.length} module(s) entered the included graph: ${entered.join(", ")}`);
    if (left.length) lines.push(`${at}: ${left.length} module(s) left the included graph: ${left.join(", ")}`);
  }
  return lines;
}

/**
 * THE RATCHET AND THE TOLERANCE. Only scenarios at the record's revision and variants in both are
 * compared; the rest are `recordFindings`' business — but what MOVED across a revision or a compressor
 * version is still listed, in `moved`, so the write that absorbs it records it. Without that, one bumped
 * revision took 14 bytes of minified growth into the history as nothing but "not comparable" (a review,
 * 2026-09-25) — and every edit to `COMMON`, `METHOD` or the measuring code moves all five revisions, so a
 * prose fix could have absorbed suite-wide growth without a trace.
 *
 * **WHY THE COMPRESSED COLUMNS GET A BAND AND NOT THE RATCHET.** Compressed size is not monotone in its
 * input: measured on the prototype, a source change that SHRANK every minified output by 32 bytes GREW
 * brotli-q11 on 6 of 8 variants, by 2 to 72 bytes. A zero-tolerance ratchet there fails changes that make
 * the package smaller. With NO comparison, though, the columns could never fail at all: a review shuffled
 * 9,537 characters of one data literal, length kept, and brotli-q11 grew 51 to 415 bytes on every variant
 * while every ratcheted column stood still. The band sits between those two measurements.
 *
 * @param {any} record @param {Run} run
 * @returns {{ growth: string[], stale: string[], moved: string[], notCompared: string[] }}
 */
export function compareMeasurements(record, run) {
  /** @type {string[]} */ const growth = [];
  /** @type {string[]} */ const stale = [];
  /** @type {string[]} */ const moved = [];
  /** @type {Set<string>} */ const skipped = new Set();
  const compression = /** @type {Record<string, { library: string }>} */ (METHOD.compression);
  const allColumns = [...METHOD.ratcheted, ...Object.keys(compression)];
  for (const [id, now] of Object.entries(run.scenarios)) {
    const was = record?.scenarios?.[id];
    if (!was) continue;
    for (const [label, v] of Object.entries(now.variants)) {
      const w = was.variants?.[label];
      if (!w) continue;
      const at = `scenario ${id} ${label}`;
      if (was.revision !== now.revision) {
        moved.push(...moves(`${at}, revision ${was.revision} -> ${now.revision}`, w, v, allColumns, true));
        continue;
      }
      for (const column of METHOD.ratcheted) {
        const [a, b] = [w.columns?.[column], /** @type {any} */ (v.columns)[column]];
        if (typeof a !== "number") growth.push(`${at}: ${column} has no recorded figure`);
        else if (b > a) growth.push(`${at}: ${column} grew ${a} -> ${b}`);
        else if (b < a) stale.push(`${at}: ${column} ${a} -> ${b}`);
      }
      // A MODULE ENTERING THE GRAPH IS GROWTH EVEN AT EQUAL BYTES: the graph is what the scenario ships.
      const entered = v.includedGraph.filter((module) => !(w.includedGraph ?? []).includes(module));
      const left = (w.includedGraph ?? []).filter((/** @type {string} */ module) => !v.includedGraph.includes(module));
      if (entered.length) growth.push(`${at}: ${entered.length} module(s) entered the included graph: ${entered.join(", ")}`);
      if (left.length) stale.push(`${at}: ${left.length} module(s) left the included graph: ${left.join(", ")}`);
      for (const [column, { library }] of Object.entries(compression)) {
        // ONLY ON THE COMPRESSOR VERSION IT WAS RECORDED WITH — the rule this suite was built to, and a
        // CONSERVATIVE one, measured 2026-09-25 on dist/browser/lokalized.js's 184,494 bytes: gzip-9 is
        // 66,601 under four different zlib version strings (1.3.1-e00f703, 1.3.0.1-motley-82a5fec,
        // 1.3.1-470d3a2, 1.3.2.1-motley-42c2f19) and 66,129 under 1.2.12 and 1.2.13.1-motley, and brotli
        // 1.0.9, 1.1.0 and 1.2.0 give identical q11 and q5. So a version string does not name an output:
        // the rule declines some comparisons that would have agreed, and still catches the one that would
        // not. Whatever it declines is listed in `moved`, old -> new, and a write keeps it.
        if (record?.compressors?.[library] !== run.compressors[library]) {
          skipped.add(library);
          moved.push(...moves(`${at}, ${library} ${record?.compressors?.[library]} -> ${run.compressors[library]}`, w, v, [column], false));
          continue;
        }
        const [a, b] = [w.columns?.[column], /** @type {any} */ (v.columns)[column]];
        if (typeof a !== "number") { growth.push(`${at}: ${column} has no recorded figure`); continue; }
        const band = tolerance(a);
        if (b - a > band) growth.push(`${at}: ${column} grew ${a} -> ${b} (+${b - a}), beyond its tolerance of ${band}`);
        else if (b !== a) stale.push(`${at}: ${column} ${a} -> ${b} (${b > a ? "+" : ""}${b - a}, within ${band})`);
      }
      for (const row of new Set([...Object.keys(w.dataRows ?? {}), ...Object.keys(v.dataRows)]))
        if (w.dataRows?.[row] !== v.dataRows[row]) stale.push(`${at}: data row "${row}" ${w.dataRows?.[row] ?? 0} -> ${v.dataRows[row] ?? 0}`);
    }
  }
  const notCompared = [...skipped].sort().map((library) => {
    const columns = Object.entries(compression).filter(([, c]) => c.library === library).map(([column]) => column);
    return `${columns.join(", ")} not compared ` +
      `(recorded with ${library} ${record?.compressors?.[library]}, running ${library} ${run.compressors[library]})`;
  });
  return { growth, stale, moved, notCompared };
}

/**
 * The record `--write` produces: this run's figures, and the history with one entry appended that says
 * why and vouches for them.
 * @param {any} previous the record on disk, or null
 * @param {Run} run
 * @param {{ note: string, attestation: object, reason: string, date: string, changes: string[] }} write
 */
export function nextRecord(previous, run, { note, attestation, reason, date, changes }) {
  /** @type {any} */
  const record = { formatVersion: 1, note, suite: run.suite, compressors: run.compressors, run: attestation, scenarios: run.scenarios };
  /** @type {object[]} */
  const history = Array.isArray(previous?.history) ? previous.history : [];
  record.history = [...history, chained(history, { reason, date, suite: run.suite, baselineSha256: baselineSha256(record), changes })];
  return record;
}

/**
 * What a `--write` records as having moved since the record it replaces: every growth line, every STALE
 * line, every figure that moved where no comparison applied, and which columns another compressor kept
 * out of comparison — so the history keeps what the write absorbed, not only that it happened.
 * @param {any} record the record being replaced, or null for the first
 * @param {{ growth: string[], stale: string[], moved: string[], notCompared: string[] }} findings
 */
export const writeChanges = (record, { growth, stale, moved, notCompared }) => (record
  ? [...growth.map((line) => `GROWTH: ${line}`), ...stale.map((line) => `STALE: ${line}`),
    ...moved.map((line) => `MOVED, NOT COMPARED: ${line}`), ...notCompared]
  : ["the first record of the frozen suite"]);

/**
 * Whether this is CI, for `writeRefusal`: any non-empty `CI`, `CI=false` included. Refusing a write that
 * was allowed is the safe error, and a person who set `CI=false` can unset it.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export const underCi = (env) => typeof env.CI === "string" && env.CI !== "";

/**
 * Why `--write` must not write, or null. Every write appends a history entry, and an entry with no
 * reason is exactly what the history exists to prevent, so a reason is required on every write — which
 * covers growth, a moved tolerance and a first record alike. An unreviewed newest entry is one of the
 * `problems`, so a second write cannot bury it in the middle of the chain.
 *
 * **A WRITE ON ANOTHER COMPRESSOR VERSION NEEDS `--compressors-moved`.** The record's zlib and brotli
 * versions are the ones a CI leg must be running for its compressed columns to be compared at all, so
 * the Node that writes decides which legs compare them: without this, one routine re-record from
 * another Node could move comparison off every leg and leave only MOVED lines in the history to say so
 * (a review, 2026-09-25). The flag makes that move a decision; the history keeps the lines either way.
 * @param {{ ci: boolean, reason: string | null, problems: string[], record: any, origin: string | undefined,
 *   newest: { index: number, sha256: string } | undefined, compressors: Readonly<Record<string, string>>,
 *   compressorsMoved: boolean }} state
 * @returns {null | { status: number, message: string }}
 */
export function writeRefusal({ ci, reason, problems, record, origin, newest, compressors, compressorsMoved }) {
  if (ci) return { status: 2, message: "--write is refused under CI: a baseline moves on a machine a person chose, with a reason" };
  if (!reason || !reason.trim())
    return { status: 2, message: '--write needs --reason "what moved and why"; the reason is kept in the chained history' };
  if (problems.length)
    return { status: 1, message: `refusing to write over ${problems.length} problem(s); a baseline cannot record a run that failed` };
  if (!record && (origin !== undefined || newest !== undefined))
    return { status: 1, message: `${RECORD_NAME} is missing and its history is frozen in ${RECIPE_FILE} ` +
      "(HISTORY_ORIGIN_SHA256, HISTORY_NEWEST_ENTRY). Restore it from git: a new record would start a new history, " +
      "which is the reset the frozen history exists to refuse" };
  const moved = record ? Object.keys(compressors).filter((library) => record.compressors?.[library] !== compressors[library]) : [];
  if (moved.length && !compressorsMoved)
    return { status: 2, message: `the record was taken with ${moved.map((l) => `${l} ${record.compressors?.[l]}`).join(" and ")} ` +
      `and this Node runs ${moved.map((l) => `${l} ${compressors[l]}`).join(" and ")}. The record's versions decide which ` +
      "CI legs compare the compressed columns, so writing them is a decision: write from a Node whose versions match, " +
      "or pass --compressors-moved and say why in the reason" };
  return null;
}

/**
 * The tarball's file name from `npm pack --json`, whose output is NOT only JSON: this package's
 * `prepack` prints its lifecycle banners to stdout first. The array is found from the END — the shortest
 * suffix starting at a `[` that parses as npm's array — so nothing printed before it, whatever brackets
 * it holds, can be taken for it. `tools/release-check.mjs`'s pattern takes the FIRST `[` followed by a
 * `{` instead (a review showed a banner holding `[ {` breaks it). Null when there is no array.
 * @param {string} output
 * @returns {string | null}
 */
export function packedFilename(output) {
  for (let at = output.lastIndexOf("["); at >= 0; at = at === 0 ? -1 : output.lastIndexOf("[", at - 1)) {
    try {
      const parsed = JSON.parse(output.slice(at));
      if (Array.isArray(parsed) && typeof parsed[0]?.filename === "string") return parsed[0].filename;
    } catch {
      // not where the array starts; keep walking back
    }
  }
  return null;
}

// ============================================================================== the measurement

/**
 * THE REBUILD MUST BE THE SHIPPED ARTIFACT, in both directions. A rebuilt file the tarball does not
 * ship, a shipped file the rebuild does not produce (review item D: the prototype walked only the
 * rebuilt set), and any byte of difference each fail — otherwise the pre-minification column describes
 * some other build.
 * @param {ReadonlyMap<string, Uint8Array>} shipped @param {ReadonlyMap<string, Uint8Array>} rebuilt
 */
export function identityProblems(shipped, rebuilt) {
  /** @type {string[]} */
  const problems = [];
  if (shipped.size === 0) problems.push("the tarball ships no dist/browser file, so there is nothing to be identical to");
  for (const [path, bytes] of rebuilt) {
    const theirs = shipped.get(path);
    if (!theirs) problems.push(`the recipe's rebuild produces ${path}, which the tarball does not ship`);
    else if (Buffer.compare(Buffer.from(theirs), Buffer.from(bytes)) !== 0)
      problems.push(`rebuilding ${path} does not reproduce the shipped bytes (${theirs.length} shipped, ${bytes.length} rebuilt)`);
  }
  for (const path of shipped.keys())
    if (!rebuilt.has(path)) problems.push(`the tarball ships ${path}, which the recipe's rebuild does not produce`);
  return problems;
}

/**
 * THE ANTI-VACUITY TERM: each column is a further transformation of the one before it, so the order is
 * fixed by construction. A column that is not ordered is not measuring what it names.
 * @param {string} at @param {Columns} c
 */
export function soundnessProblems(at, c) {
  // q5 STRICTLY above q11: equal is what brotli-q5 computed at quality 11 looks like (a review's
  // ablation, 2026-09-25), and on this package q5 is 6,673 to 7,186 bytes larger on every variant.
  const ordered = c.rawSource > c.preMinify && c.preMinify > c.minified && c.minified > c.gzip9 &&
    c.gzip9 > c.brotliQ11 && c.brotliQ5 > c.brotliQ11 && c.rawModules > 0 && c.requests > 0;
  return ordered ? [] : [`${at}: the columns are not ordered raw > pre-minify > minified > gzip-9 > brotli-q11 < brotli-q5 ` +
    `(${c.rawSource}, ${c.preMinify}, ${c.minified}, ${c.gzip9}, ${c.brotliQ11}, ${c.brotliQ5}), or count nothing: something is not measuring`];
}

/**
 * @param {string} at @param {{ mustReach: readonly string[], mustNotReach: readonly string[] }} recipe
 * @param {readonly string[]} graph the included graph
 */
export function containmentProblems(at, recipe, graph) {
  return [
    ...recipe.mustReach.filter((module) => !graph.includes(module)).map((module) => `${at}: must reach ${module} and does not`),
    ...recipe.mustNotReach.filter((module) => graph.includes(module)).map((module) => `${at}: reaches ${module}, which this scenario excludes`),
  ];
}

/**
 * The data rows a graph's src/data bytes fall into, and the modules that fall into none.
 * @param {ReadonlyMap<string, number>} graph module -> bytes in the output
 * @param {Readonly<Record<string, readonly string[]>>} rows
 */
export function classifyDataRows(graph, rows) {
  /** @type {Record<string, number>} */ const sums = {};
  /** @type {string[]} */ const unclassified = [];
  for (const [module, bytes] of graph) {
    if (!module.startsWith("src/data/")) continue;
    const row = Object.entries(rows).find(([, names]) => names.includes(module.slice("src/data/".length, -".js".length)))?.[0];
    if (row === undefined) unclassified.push(module);
    else sums[row] = (sums[row] ?? 0) + bytes;
  }
  return { rows: sums, unclassified };
}

/**
 * The row table against the package: every src/data module shipped sits in exactly one row, and every
 * name in the table is a module that exists.
 * @param {readonly string[]} shippedDataModules e.g. "src/data/cardinal.js"
 * @param {Readonly<Record<string, readonly string[]>>} rows
 */
export function dataRowTableProblems(shippedDataModules, rows) {
  /** @type {string[]} */
  const problems = [];
  const names = shippedDataModules.map((module) => module.slice("src/data/".length, -".js".length));
  for (const name of names) {
    const homes = Object.entries(rows).filter(([, members]) => members.includes(name)).map(([row]) => row);
    if (homes.length === 0) problems.push(`src/data/${name}.js ships and is in no DATA_ROWS row, so its bytes would enter a scenario unweighed`);
    if (homes.length > 1) problems.push(`src/data/${name}.js is in ${homes.length} DATA_ROWS rows (${homes.join(", ")})`);
  }
  for (const [row, members] of Object.entries(rows))
    for (const name of members)
      if (!names.includes(name)) problems.push(`DATA_ROWS "${row}" names ${name}, and the tarball ships no src/data/${name}.js`);
  if (names.length === 0) problems.push("the tarball ships no src/data module, so the row table is checked against nothing");
  return problems;
}

/**
 * One runtime sample's outcome from a `spawnSync` result. A crash, a timeout and a silent exit are each
 * a NAMED problem rather than a stack, because a crashed harness has read as a regression here before.
 * @param {string} at @param {number} index @param {number} timeoutMs
 * @param {{ status: number | null, signal?: string | null, error?: Error & { code?: string }, stdout?: string, stderr?: string }} result
 * @returns {{ sample: any } | { problem: string }}
 */
export function sampleOutcome(at, index, timeoutMs, result) {
  // THE ERROR LINE, NOT THE LAST LINE. An uncaught error ends with Node's version banner, so the first
  // crash ablation reported its cause as "Node.js v24.18.0". The harness prints what it catches on a line
  // of its own (`harness.mjs` says why); the pattern also finds Node's own report of anything it could not.
  const lines = String(result.stderr ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const cause = (lines.find((line) => /^(?:Uncaught )?[A-Za-z]*(?:Error|Exception)(?: \[\w+\])?: /.test(line)) ??
    lines.filter((line) => !/^Node\.js v/.test(line)).pop() ?? "(no output)").slice(0, 240);
  if (result.error?.code === "ETIMEDOUT" || (result.signal && result.status === null && result.error))
    return { problem: `${at}: runtime sample ${index} timed out after ${timeoutMs} ms` };
  if (result.error) return { problem: `${at}: runtime sample ${index} did not start: ${result.error.message}` };
  if (result.status !== 0)
    return { problem: `${at}: runtime sample ${index} crashed (${result.signal ? `signal ${result.signal}` : `exit ${result.status}`}): ${cause}` };
  try {
    const sample = JSON.parse(String(result.stdout ?? ""));
    // Every figure, not only the import: a sample missing its heap still yields a median from the other
    // four, so the aggregate alone cannot see one bad sample.
    if (typeof sample?.rendered !== "string" || Object.keys(RUNTIME_FIGURES).some((figure) => !Number.isFinite(sample?.[figure])))
      return { problem: `${at}: runtime sample ${index} printed a result without its fields` };
    return { sample };
  } catch {
    return { problem: `${at}: runtime sample ${index} exited 0 and printed no result` };
  }
}

/** Every sample must render the fixture's expected string. @param {string} at @param {{ rendered: string }[]} samples @param {string} expected */
export function renderProblems(at, samples, expected) {
  const wrong = samples.filter((sample) => sample.rendered !== expected);
  return wrong.length === 0 ? [] : [`${at}: ${wrong.length} of ${samples.length} sample(s) rendered ` +
    `${JSON.stringify(wrong[0]?.rendered)}, expected ${JSON.stringify(expected)}`];
}
