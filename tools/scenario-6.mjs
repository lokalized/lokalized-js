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
 *   DETERMINISTIC — modules, source bytes, the IANA data's byte share in each graph and its total,
 *   requests per render, and the two digests — RATCHET: growth or drift fails the run until it is
 *   re-recorded with a reason (a changed recipe or a re-pinned closure needs a new revision).
 *
 * "CLOSURE" in the frozen recipe and in the record's field names is the plan's word (9.2:2818) and
 * the pre-A30 artifact's. Since A30 the IANA data is TWO generated modules — the full registry table
 * behind `lokalized/negotiate` and the direct-match projection in the root — and `closureBytes` /
 * `ianaClosureBytes` sum whichever of them a graph reaches, while `closureClasses` counts the full
 * table's distinct equivalence classes (it counted the old closure's ENTRIES, 818, which is why the
 * re-pin to 369 is a revision and not a comparison).
 *   TIMINGS AND HEAP are machine-dependent and are REPORTED, never compared — and REQUIRED PRESENT
 *   (A33): a record missing one, or holding one that is not a finite number, fails.
 *
 * **THE PROOF OBLIGATION A3 AND A7 BOTH CREATED IS DISCHARGED AT BIRTH.** Both amendments turned on
 * the same question — does "recorded" mean something a machine re-checks? — and both found a real
 * gap the moment someone asked it (`scenario:2k` was in neither `verify` nor CI; CI ran zero
 * spec-repo gates). This tool is in `npm run verify` and in CI from its first commit, and needs
 * neither a JDK nor a browser.
 *
 * **THE RATCHET IS NOT RESET BY DELETING OR RE-WRITING ITS RECORD** (2026-09-26, the proof obligation
 * A33 restates, closed here the way `tools/scenario-0a.mjs` and `tools/subpath-graphs.mjs` closed it
 * the day before). Measured on the tool before the change: grow `src/index.js` by 66 bytes, delete
 * `measurements/scenario-6.json`, run `--write` with NO reason — exit 0, the grown 988,800 / 1,069,130
 * recorded as the baseline, all 24 rebaseline reasons gone, and the next run green. A record that was
 * not JSON read as missing, so a bare `--write` replaced it the same way; a fixture digest edited by
 * hand to match changed catalogs passed at exit 0; and so did a changed recipe once the record's
 * `revision` was edited to 2, because the recipe check compared only at an equal revision. Now:
 *
 *   - a missing or unreadable record FAILS, and `--write` refuses to start one (`--init` is the loud
 *     path for a brand-new tool, refused once an origin or checkpoint is frozen below);
 *   - `rebaselines` is chained (`tools/ratchet-chain.mjs`) from a first entry whose digest is frozen
 *     below, beside a CHECKPOINT that pins every entry up to it — the chain alone cannot see entries
 *     cut from its end;
 *   - each entry records the figures its write stored and the revision, recipe, fixture and closure
 *     they were measured against, and the record may hold no figure above the newest entry's, none
 *     missing, none that is not a count, and no identity other than the newest entry's;
 *   - a write whose ratcheted figures differ from the newest entry's needs `--reason` — a shrink as
 *     much as a growth, so the newest entry always binds what the record holds — and so does a
 *     revision move; a changed recipe or a re-pinned closure under an unmoved revision is refused
 *     outright.
 *
 * AND FOUR MORE, from a review of the above the same day, each measured passing at exit 0 first:
 *
 *   - a variant ROW DUPLICATED in the record, raised copies ahead of the true ones, hid growth: the
 *     binding read the last row of a label and the growth terms the first. A label held by more than
 *     one row is refused rather than read either way;
 *   - `--reason --write` recorded the reason "--write", `--reason " "` recorded a blank, and an
 *     entry after the checkpoint with its reason deleted passed. A reason is now a sentence — not
 *     blank, not the next flag — on the command line and in every entry;
 *   - the timings could be deleted from the record at exit 0. They are compared with nothing, and
 *     they are required present;
 *   - `closureBytes`, the IANA data's total, was recorded and compared with nothing. It ratchets
 *     and is bound like the per-graph figures.
 *
 * WHAT STAYS OPEN, said rather than left to be found: entries appended after the checkpoint are held
 * by the chain and the figures and identity they bind, not by source, until the checkpoint is moved
 * forward (reported every run, not gated); cutting them loses their reasons but not the ratchet,
 * because the figures they bound fail. One of them edited consistently with the record shows only in
 * a diff. The measuring code itself is not digest-frozen: `RECIPE.method` declares it in words, as
 * `tools/0a-recipe.mjs` does for 0a's harness (its `notFrozen`). The graph figures a write records are
 * held to `tools/example-graph-walk.mjs`, the source that method names, by a test computing them
 * independently; the request counts and the timings are held by this code alone, so an edit to how
 * those are computed shows only in a diff. And a changed fixture stays recordable under one revision
 * with a reason, as the `CARDINALITY_MANY` fixture change was (history entry 6).
 * `test/scenario-6-baseline.test.js` runs each rule on a copy.
 *
 *   npm run scenario:6 [-- --write --reason "why the baseline moved"]   (passes --expose-gc)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exampleGraph } from "./example-graph-walk.mjs";
import { chainProblems, chained, checkpointOf, entryDigest, figureProblems } from "./ratchet-chain.mjs";

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

/**
 * The scenario's revision. Moving it says the runs either side are not comparable as the same
 * scenario, and the move is recorded with a reason like any growth.
 */
const REVISION = 3;

/**
 * The digest of the FIRST entry of `rebaselines` — M9 S5's, the oldest reason the record holds — frozen
 * so that a history started over (the record deleted and written again) does not begin where this says
 * it must. The history was chained on 2026-09-26 without re-measuring anything and without dropping a
 * reason. `undefined` only for a brand-new tool: see `--init`.
 * @type {string | undefined}
 */
const REBASELINES_ORIGIN = "4f1b2eb3ceef3f5de7deb859d2b5fdb24445d58c81f4d5c36fa9099e6fdf69b5";

/**
 * THE CHECKPOINT: `rebaselines[index]` must exist and have this digest, which pins every entry up to
 * it — the chain alone cannot see its own end. Frozen at the entry that bound the figures and identity
 * to the history on 2026-09-26. Entries a `--write` appends after it are held by the chain and by what
 * they bind, not by source; each run reports how many there are and prints the value that would freeze
 * them. Move it forward once per landed batch — a deliberate edit, like the origin.
 * @type {{ index: number, sha256: string } | undefined}
 */
const REBASELINES_FROZEN_THROUGH = { index: 33, sha256: "7e567c26828f3871f965dfd3a91fb9f74c3717b263eb008078cd2096d06ff338" };

const RECORD = "measurements/scenario-6.json";
const REQUESTS = "requests per render";
const CLOSURE = "IANA data";
const isCount = (/** @type {unknown} */ n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;
/** A reason is a sentence: a string with something in it, and not the next flag read as one. */
const isReason = (/** @type {unknown} */ text) =>
  typeof text === "string" && text.trim() !== "" && !text.startsWith("--");
const isTime = (/** @type {unknown} */ n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * The ratcheted figures a record holds, by row then measure — what each history entry records. Every
 * figure the growth terms below compare is here, so none can be raised or deleted by hand unnoticed.
 * The rows are keyed by label, so a record holding two rows under one label, or a row under the name
 * of one of the two figure rows below, would be read ambiguously: `rowProblems` refuses both.
 * @param {any} from a record, or the one this run is about to write
 */
const figuresOf = (from) => ({
  ...Object.fromEntries((Array.isArray(from?.node) ? from.node : []).map((/** @type {any} */ row) => [row?.label, {
    modules: row?.modules, sourceBytes: row?.sourceBytes, ianaClosureBytes: row?.ianaClosureBytes,
    nodeBuiltinEdges: row?.nodeBuiltinEdges,
  }])),
  [REQUESTS]: from?.requestsPerRender && typeof from.requestsPerRender === "object" ? { ...from.requestsPerRender } : undefined,
  [CLOSURE]: { closureBytes: from?.closureBytes },
});

/**
 * Rows the record holds that `figuresOf` and the growth terms would read differently. Measured
 * 2026-09-26 by a review: both rows duplicated, the raised copies placed AHEAD of the true ones, and
 * `src/index.js` grown by 187 bytes — exit 0, because the binding read the last row of each label
 * (`Object.fromEntries`) and the growth terms the first (`find`).
 * @param {any} from
 * @returns {string[]}
 */
function rowProblems(from) {
  /** @type {unknown[]} */
  const labels = Array.isArray(from?.node) ? from.node.map((/** @type {any} */ row) => row?.label) : [];
  /** @type {string[]} */
  const problems = [];
  for (const label of new Set(labels)) {
    const count = labels.filter((other) => other === label).length;
    if (count > 1)
      problems.push(`${RECORD} holds ${count} rows labelled ${JSON.stringify(label)}: the history binds the last and ` +
        "the growth terms read the first, so a raised copy ahead of the true row hides growth. Restore it from git");
    else if (label === REQUESTS || label === CLOSURE)
      problems.push(`${RECORD} holds a variant row labelled ${JSON.stringify(label)}, the name of a figure row, so ` +
        "the history cannot bind it; it was added by hand. Restore it from git");
  }
  return problems;
}

/**
 * The timings and heap figure a record holds, which are compared with nothing — A33: "timings are
 * reported and required present". Measured 2026-09-26: every one of them deleted, exit 0. A heap
 * delta may be negative (the record has held one), so `retainedBytes` need only be a finite number.
 * @param {any} from
 * @returns {string[]}
 */
function timingProblems(from) {
  /** @type {Array<[string, unknown, (n: unknown) => boolean]>} */
  const timings = [
    ["negotiateMsPerHeader", from?.negotiateMsPerHeader, isTime],
    ["firstRenderMs", from?.firstRenderMs, isTime],
    ["retainedBytes", from?.retainedBytes, (n) => typeof n === "number" && Number.isFinite(n)],
    ...RECIPE.variants.map((variant) => /** @type {[string, unknown, (n: unknown) => boolean]} */ ([
      `${variant.label} importMs`,
      (Array.isArray(from?.node) ? from.node : []).find((/** @type {any} */ row) => row?.label === variant.label)?.importMs,
      isTime,
    ])),
  ];
  return timings.filter(([, value, valid]) => !valid(value)).map(([name, value]) =>
    `${RECORD} holds ${JSON.stringify(value) ?? "no value"} for ${name}, not a measured figure: timings and heap ` +
    "are reported, never compared, and required present (A33). Restore it from git");
}

/**
 * What the figures were measured AGAINST. The frozen terms below compare the record's copy with this
 * run's, so a copy edited by hand to match a changed input would silence them; each history entry
 * records it, and the record may not differ from its newest entry's.
 * @param {any} from
 */
const identityOf = (from) => ({
  revision: from?.revision, recipeSha256: from?.recipeSha256, fixtureSha256: from?.fixtureSha256,
  closureClasses: from?.closureClasses,
});

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
const { createLocaleMatcher, forAcceptLanguage } = await import(new URL("../src/negotiate/index.js", import.meta.url).href);
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
const negotiator = createLocaleMatcher(configuration);

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
  revision: REVISION,
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
  /** @type {object[]} */
  rebaselines: [],
};

const baselinePath = join(root, "measurements", "scenario-6.json");

/**
 * Three kinds of finding, because they are answered differently:
 *
 *   BROKEN — no write may proceed over it: a record that cannot be read, a history that does not run
 *            from its frozen origin through its checkpoint or holds an entry with no reason, figures or
 *            an identity its newest entry did not record, a label held by two rows, a timing missing,
 *            a revision this tool did not produce, and a changed recipe or re-pinned closure under an
 *            unmoved revision. Each is restored from git or fixed in source; writing over it would
 *            record the defect as the new baseline.
 *   FROZEN — an input moved (fixture, revision): fails the run, recorded only with a reason.
 *   GROWTH — the ratchet's own term: fails the run, recorded only with a reason.
 */
/** @type {string[]} */
const broken = [];
const missing = !existsSync(baselinePath);
/** @type {any} */
let baseline = null;
if (!missing) {
  // An unreadable record is BROKEN, never "missing": it used to read as missing, and a bare `--write`
  // then replaced it — and its history — with whatever this tree measured.
  /** @type {unknown} */
  let parsed;
  try { parsed = JSON.parse(readFileSync(baselinePath, "utf8")); } catch (error) {
    broken.push(`${RECORD} is not valid JSON (${/** @type {Error} */ (error).message}); restore it from git`);
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) baseline = parsed;
  else if (parsed !== undefined) broken.push(`${RECORD} holds ${JSON.stringify(parsed)}, not a record; restore it from git`);
}

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
  `   first render ${record.firstRenderMs} ms   retained ${gc ? `${retainedBytes} B` : "NOT MEASURED (no --expose-gc)"}`);
console.log(`  requests per render: ${Object.entries(requestsPerRender)
  .map(([header, count]) => `${JSON.stringify(header)}=${count}`).join("  ")}`);

// ---- the exit terms -----------------------------------------------------------------------------

/** @type {string[]} */
const growth = [];
/** @type {string[]} */
const frozen = [];

if (baseline) {
  // THE HISTORY, AND WHAT ITS NEWEST ENTRY BINDS. The history runs from the frozen origin through the
  // frozen checkpoint; the figures the record holds are at or below what its newest entry recorded;
  // and the inputs the record says it was measured against are the ones that entry recorded.
  broken.push(...chainProblems(baseline.rebaselines, REBASELINES_ORIGIN, RECORD, REBASELINES_FROZEN_THROUGH));
  // Every entry says why, in a sentence. Entries up to the checkpoint are pinned by digest anyway; the
  // rule is for the ones after it, whose reason the chain does not name.
  if (Array.isArray(baseline.rebaselines))
    baseline.rebaselines.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
      if (entry && typeof entry === "object" && !isReason(entry.reason))
        broken.push(`${RECORD}: history entry ${i} records ${JSON.stringify(entry.reason) ?? "no reason"} as its ` +
          "reason, which says nothing about why the baseline moved; restore the record from git");
    });
  broken.push(...rowProblems(baseline));
  const newest = Array.isArray(baseline.rebaselines) ? baseline.rebaselines.at(-1) : undefined;
  broken.push(...figureProblems(figuresOf(baseline), newest?.recorded, RECORD));
  broken.push(...timingProblems(baseline));
  const bound = newest?.identity;
  if (!bound || typeof bound !== "object" || Array.isArray(bound))
    broken.push(`${RECORD}'s newest history entry records no identity, so the revision, recipe, fixture and ` +
      "closure the record holds are bound to nothing and could be edited to match a changed input; restore " +
      "the record from git");
  else
    for (const [field, value] of Object.entries(identityOf(baseline)))
      if (bound[field] !== value)
        broken.push(`${RECORD}: ${field} is ${JSON.stringify(value)}, and its newest history entry recorded ` +
          `${JSON.stringify(bound[field])}; it was edited by hand. Restore it from git`);

  // THE REVISION. A record this tool could not have written is broken; an older one is a revision
  // move, which is recorded with a reason — a renumber alone included.
  if (!Number.isSafeInteger(baseline.revision) || baseline.revision < 1 || baseline.revision > REVISION)
    broken.push(`${RECORD} is at revision ${JSON.stringify(baseline.revision)}, which this tool (revision ` +
      `${REVISION}) did not produce`);
  else if (baseline.revision < REVISION)
    frozen.push(`the scenario moved from revision ${baseline.revision} to ${REVISION}; figures either side are ` +
      "not comparable as the same scenario, so the move is recorded with a reason");

  // 1. THE RECIPE. A changed recipe is a new scenario, not a new run of this one — so it is not
  //    recordable under the same revision, with a reason or without.
  if (baseline.recipeSha256 !== recipeSha256 && baseline.revision === REVISION)
    broken.push(`the frozen recipe changed (${String(baseline.recipeSha256).slice(0, 16)} -> ` +
      `${recipeSha256.slice(0, 16)}) while revision stayed ${REVISION}. Plan 9.2:2796 — ` +
      `changing the recipe creates a reviewed scenario REVISION; bump it, or put the recipe back.`);

  // 2. THE FIXTURE. 2k's lesson, and `conformance.mjs`'s: a baseline measured against one revision
  //    and read back against another has nothing to notice unless the digest is compared.
  if (baseline.fixtureSha256 !== record.fixtureSha256)
    frozen.push(`the fixture changed (${String(baseline.fixtureSha256).slice(0, 16)} -> ` +
      `${record.fixtureSha256.slice(0, 16)}). Every figure below was measured against different bytes.`);

  // 3. THE PINNED IANA DATA. The scenario is defined as being measured ATOP it, so re-pinned data
  //    is a different measurement even when every other input is identical — which is why revisions
  //    2 and 3 were both bumps for exactly this, and why it is refused under an unmoved revision, with
  //    a reason or without, like the recipe. It used to be recordable with a reason while its own
  //    message said to bump the revision.
  if (baseline.closureClasses !== closureClasses && baseline.revision === REVISION)
    broken.push(`the IANA closure was re-pinned (${baseline.closureClasses} -> ${closureClasses} classes) ` +
      `while revision stayed ${REVISION}; that is an environment change, so bump it`);

  // 4. DETERMINISTIC GROWTH. A row or a header whose figures are missing or are not counts is as
  //    unrecorded as a missing one: compared with `undefined`, or with a string, growth says nothing.
  console.log(`\ndrift against the recorded baseline:`);
  for (const now of variants) {
    const was = Array.isArray(baseline.node)
      ? baseline.node.find((/** @type {any} */ entry) => entry?.label === now.label) : undefined;
    if (!was || !["modules", "sourceBytes", "ianaClosureBytes", "nodeBuiltinEdges"].every((measure) => isCount(was[measure]))) {
      growth.push(`${now.label}: NOT RECORDED — ${RECORD} holds no row with counted figures for it, and ` +
        "absence is not agreement");
      continue;
    }
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
    if (!isCount(was))
      growth.push(`requests per render for ${JSON.stringify(header)}: NOT RECORDED — ${RECORD} holds no count ` +
        "for it, and absence is not agreement");
    else if (count > was)
      growth.push(`requests per render for ${JSON.stringify(header)} grew ${was} -> ${count}`);
  }
  if (!isCount(baseline.closureBytes))
    growth.push(`the IANA data's total: NOT RECORDED — ${RECORD} holds no count for closureBytes, and absence is ` +
      "not agreement");
  else if (closureBytes > baseline.closureBytes)
    growth.push(`the IANA data grew ${baseline.closureBytes} -> ${closureBytes} bytes`);
}

/**
 * THE UNFROZEN TAIL, REPORTED. Entries after the checkpoint are held by the chain and by what they
 * bind, not by source; saying how many there are is what keeps "frozen" from being read as "all".
 * @param {unknown} history
 */
function reportTail(history) {
  if (!Array.isArray(history) || history.length === 0 || !history.every((entry) => entry && typeof entry === "object"))
    return;
  const through = REBASELINES_FROZEN_THROUGH?.index ?? -1;
  const after = history.length - 1 - through;
  console.log(`\nhistory: ${history.length} rebaselines, frozen in this tool through entry ${through}` +
    (after > 0 ? `; ${after} after it held by the chain and what they bind, not by source` : ""));
  if (after > 0) console.log(`  to freeze them: const REBASELINES_FROZEN_THROUGH = ${JSON.stringify(checkpointOf(history))};`);
}

if (process.argv.includes("--write")) {
  // **A RECORD WRITTEN WITHOUT `gc` STORES A ZERO THAT WAS NEVER MEASURED.** `retainedBytes` starts
  // at 0 and is measured only when `globalThis.gc` exists, so a bare `node tools/scenario-6.mjs
  // --write` recorded `retainedBytes: 0` — found by a review on 2026-09-23 in the staged record and in
  // an earlier commit, both written that way, while a measured run is never exactly 0 (how far from
  // it depends on the Node version). The figure is reported and never gated, so nothing else would
  // notice.
  if (!gc) {
    console.error(`\nrefusing to write without --expose-gc: retainedBytes would be recorded as 0 without` +
      ` being measured. Re-record with: npm run scenario:6 -- --write --reason "what grew and why"`);
    process.exit(2);
  }
  const reasonIndex = process.argv.indexOf("--reason");
  const given = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : undefined;
  const reason = isReason(given) ? /** @type {string} */ (given) : null;
  /** @type {string[]} */
  const refusals = [...broken];
  // `--reason --write` used to record the reason "--write", and `--reason " "` a blank.
  if (reasonIndex >= 0 && reason === null)
    refusals.push(`--reason needs a sentence after it saying why the baseline moved, and got ` +
      `${JSON.stringify(given) ?? "nothing"}`);
  const init = process.argv.includes("--init");
  if (!missing && init) refusals.push(`--init starts a first record, and ${RECORD} exists; drop --init`);
  if (missing) {
    // A FIRST RECORD IS A LOUD, EXPLICIT ACT, and it is refused once one has existed. The reset this
    // closes: delete the file, `--write`, and the tree's grown figures become the baseline with no
    // reason asked for and every earlier reason gone.
    if (!init)
      refusals.push(`${RECORD} does not exist, and --write will not start a new baseline over a missing one: it ` +
        `would record whatever this tree measures today. Restore it from git (git checkout -- ${RECORD}).`);
    else if (REBASELINES_ORIGIN !== undefined || REBASELINES_FROZEN_THROUGH !== undefined)
      refusals.push(`--init refused: this tool's history is frozen to start at ` +
        `${REBASELINES_ORIGIN?.slice(0, 12) ?? "an unnamed origin, with a checkpoint"}, so a record has existed. ` +
        `Restore it from git; starting over would launder whatever grew since.`);
    else if (!reason)
      refusals.push(`--init needs --reason "…": the first entry of a history says why it starts`);
  }
  if (refusals.length) {
    console.error(`\nrefusing to write ${RECORD}:`);
    for (const line of refusals) console.error(`  ${line}`);
    process.exit(2);
  }
  // A WRITE THAT MOVES A RATCHETED FIGURE NEEDS A REASON, DOWN AS WELL AS UP. A shrink written with no
  // reason would append nothing and leave the newest entry binding figures ABOVE the record's, so
  // raising the record back to them by hand would pass — re-admitting growth a reason had explained for
  // a graph that has since shrunk. With this, the newest entry always binds exactly what is written.
  const figures = figuresOf(record);
  const newest = baseline?.rebaselines.at(-1);
  const moved = newest !== undefined && entryDigest(figures) !== entryDigest(newest.recorded);
  if ((growth.length || frozen.length || moved) && !reason) {
    console.error(`\nrefusing to re-record without --reason "why":`);
    for (const line of [...frozen, ...growth]) console.error(`  ${line}`);
    if (moved && growth.length === 0 && frozen.length === 0)
      console.error(`  the ratcheted figures differ from the ones the newest history entry recorded (a shrink); ` +
        "recorded with a reason, the entry goes on binding what the record holds");
    process.exit(2);
  }
  // Each entry names the digest of the one before it (`tools/ratchet-chain.mjs`), so an entry deleted,
  // reordered or edited later breaks the chain up to the NEWEST, which nothing names — the checkpoint
  // above pins the history up to it, and `recorded` and `identity` bind what this write stores to the
  // entry that explains it. A write with no reason moved nothing ratcheted, and appends nothing.
  const history = Array.isArray(baseline?.rebaselines) ? baseline.rebaselines : [];
  record.rebaselines = reason
    ? [...history, chained(history, { reason, growth: [...frozen, ...growth], recorded: figures, identity: identityOf(record) })]
    : history;
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to ${RECORD}${reason ? " (reason recorded)" : ""}`);
  reportTail(record.rebaselines);
  if (missing) {
    console.error(`\nA NEW HISTORY WAS STARTED. Freeze its first entry in this tool before anything else:\n` +
      `  const REBASELINES_ORIGIN = "${entryDigest(record.rebaselines[0])}";\n` +
      `Until then every run fails, because an unfrozen history can be started over without anyone noticing.`);
    process.exit(1);
  }
  process.exit(0);
}

reportTail(baseline?.rebaselines);

if (missing) {
  // ABSENCE IS NEVER AGREEMENT. This used to end "run with --write to record it", and that `--write`
  // recorded whatever the tree measured, with every earlier reason gone.
  console.error(`\nNOT RECORDED: ${RECORD} does not exist, so nothing ratchets. Restore it from git ` +
    `(git checkout -- ${RECORD}); --write will not start a new one.`);
  process.exit(1);
}

if (broken.length) {
  console.error(`\nSCENARIO 6 IS NOT WHAT ITS RECORD DESCRIBES (gated):`);
  for (const line of broken) console.error(`  ${line}`);
}
if (frozen.length) {
  console.error(`\nFROZEN SCENARIO VIOLATED:`);
  for (const line of frozen) console.error(`  ${line}`);
}
if (growth.length) {
  console.log(`\nGROWTH (deterministic, gated):`);
  for (const line of growth) console.log(`  ${line}`);
  console.log(`Re-record deliberately: npm run scenario:6 -- --write --reason "what grew and why"`);
}
if (broken.length || frozen.length || growth.length) process.exit(1);
console.log(`\nNO THRESHOLDS EXIST, by decision (A3/A4 precedent). Deterministic figures ratchet;`);
console.log(`timings and heap are reported, compared with nothing, and required present.`);
