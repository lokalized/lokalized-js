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
 * **THE RATCHET IS NOT RESET BY DELETING OR RE-WRITING ITS RECORD** (2026-09-25, the proof
 * obligation A4/A7 carry — restated as A33). Until then a missing `measurements/scenario-0a.json`
 * printed "run with --write to record one" and exited 0, and that `--write` recorded whatever the
 * tree measured as the new baseline. Measured on the pre-change tool: delete the file, grow
 * `src/internal/locale.js` by 9 bytes, run `--write` with NO reason — exit 0, the grown 777,047
 * recorded, all 71 rebaseline reasons and the browser half gone, and the next run green. Now:
 *
 *   - a missing or unreadable record FAILS, and `--write` refuses to start one;
 *   - the `rebaselines` history is chained (`tools/ratchet-chain.mjs`), its first entry's digest is
 *     frozen below, and so is a CHECKPOINT that pins every entry up to it — the chain alone cannot
 *     see entries cut from its end, which a review measured passing at exit 0;
 *   - each entry records the figures its write stored and whether a browser half was held, and the
 *     record may hold no figure above the newest entry's, none missing and none that is not a count,
 *     nor drop a browser half it recorded;
 *   - the recipe and fixture are declared in `tools/0a-recipe.mjs` with a digest frozen per revision,
 *     as scenario 6's and 0b's are, and the harness is held to them: the options it hands
 *     `createStrings` must hash to the declared fixture, and `package.json#exports` must resolve each
 *     declared specifier to the file measured;
 *   - THE METHOD IS HELD TOO (2026-09-26). The code that takes the measurements is
 *     `tools/0a-measure.mjs`, and its bytes are inside the recipe digest, so editing it is a revision;
 *     and each row's modules and source bytes — as the harness returned them AND as this file copies
 *     them into the record — are walked again here from the recipe's declared entry, apart from the
 *     harness. Before, a review changed the harness's `graphBytes(entry)` to
 *     `graphBytes("src/core/index.js")`, then in this file: exit 0 with the digest unmoved, and a bare
 *     `--write` stored core's graph as the root's with no reason and no history entry. A second review
 *     then offset the copy into the record (`r.sourceBytes - 5`), in no digest, and 5 bytes of real
 *     growth passed at exit 0 with the browser half printed "fresh";
 *   - EVERY `--write` NEEDS A REASON AND APPENDS A CHAINED ENTRY, a shrink or no movement included, so
 *     the newest entry always records the figures the record holds. Before, a no-reason write appended
 *     nothing, so the newest entry could hold figures above the record's and raising the record back
 *     up to them by hand passed — re-admitting growth a reason had already explained. A browser
 *     capture (`tools/browser-0a/record.mjs`) replaces recorded figures too, and follows the same rule;
 *   - THE BROWSER HALF IS BOUND TO THE NEWEST ENTRY by its digest (`browserSha256`), as the Node figures
 *     are by `recorded`, so only a capture or a `--write` carrying it verbatim places it. Before, with
 *     the half reported STALE after recorded growth, raising its transfer bytes to the new graph's by
 *     hand and changing a timing printed "fresh" at exit 0 (a review, 2026-09-26);
 *   - EVERY TIMING IS REQUIRED PRESENT (A33 (4)): each row, measured and recorded, carries finite
 *     timings and heap, and the browser half a row per variant with its counts and timings. Before, a
 *     NaN import timer ran at exit 0 and `--write` stored `importMs: null`. Timings are still never
 *     compared.
 *
 * WHAT STAYS OPEN, said rather than left to be found: entries appended after the checkpoint are held
 * by the chain and the figure binding, not by source, until the checkpoint is moved forward (reported
 * every run, not gated); cutting them loses their reasons but not the ratchet, because the figures
 * they bound fail. An entry after the checkpoint edited consistently with the record — its figures or
 * its browser digest — shows only in a diff. And `tools/graph-walk.mjs`, shared with other tools, is in
 * no digest, nor is this file (the recipe's `notFrozen` says why). Each rule has a test in
 * `test/scenario-0a-recipe.test.js` that runs this tool on a copy.
 *
 * Retained heap needs --expose-gc, and a run without it fails:
 *   node --expose-gc tools/scenario-0a.mjs [--write --reason "why"]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureVariant } from "./0a-measure.mjs";
import { graphBytes as walkGraph } from "./graph-walk.mjs";
import { chainProblems, chained, checkpointOf, entryDigest, figureProblems } from "./ratchet-chain.mjs";
import {
  RECIPE, RECIPE_DIGESTS, browserHalfProblems, exportProblems, handedProblems, measuredGraphProblems, recipeProblems,
  recipeSha256, timingProblems,
} from "./0a-recipe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);
const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/**
 * The digest of the FIRST entry of `rebaselines`, frozen so that a history started over — the
 * record deleted and written again — does not begin where this says it must. It is M4's entry, the
 * oldest reason the record holds; the history was chained on 2026-09-25 without re-measuring
 * anything and without dropping a reason. `undefined` only for a brand-new tool: see `--init`.
 * @type {string | undefined}
 */
const REBASELINES_ORIGIN = "3e4ec0720d93393a367a55bdf6473784444e1d963828d47bbac8f0c2c3883ac2";

/**
 * THE CHECKPOINT: `rebaselines[index]` must exist and have this digest, which pins every entry up to
 * it — the chain alone cannot see its own end. Frozen at the entry that bound the figures to the
 * history on 2026-09-25. Entries a `--write` appends after it are protected by the chain and by the
 * figures they bind, not by source; each run reports how many there are and prints the value that
 * would freeze them. Move it forward once per landed batch — a deliberate edit, like the origin.
 * @type {{ index: number, sha256: string } | undefined}
 */
const REBASELINES_FROZEN_THROUGH = { index: 74, sha256: "d698bbe8eb55d48f816304fd403737cf0c7be3026d57bffc5115a8707cfed5e8" };

/**
 * The digest of the browser half entry 71 bound, frozen here because that entry — the checkpoint above
 * — predates binding the browser half to the history (2026-09-26) and carries no `browserSha256`. Every
 * entry a write appends after it records its own. Consulted only while entry 71 is the newest.
 */
const BROWSER_HALF_AT_ENTRY = { index: 71, sha256: "d6c284010377182ec210e3e79fece7e6881bb3f437bdd662502486f3a870da84" };

const isCount = (/** @type {unknown} */ n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;
/**
 * A reason is a sentence: a string with something in it, and not the next flag read as one. Measured
 * 2026-09-26 on scenario 6, which had the same parsing: `--reason --write` recorded the reason
 * "--write", and `--reason " "` recorded a blank.
 */
const isReason = (/** @type {unknown} */ text) =>
  typeof text === "string" && text.trim() !== "" && !text.startsWith("--");

/** The ratcheted half of a record's Node rows, by label: what each history entry records. */
const figuresOf = (/** @type {unknown} */ node) => Object.fromEntries((Array.isArray(node) ? node : [])
  .map((/** @type {any} */ row) => [row?.label, { modules: row?.modules, sourceBytes: row?.sourceBytes }]));

/**
 * ONE ROW PER LABEL. `figuresOf` keys by label and so keeps the LAST row of a label, while the growth
 * terms below `find` the FIRST: a record holding a raised copy of a row ahead of the true one binds the
 * true figures to the history and compares growth against the raised ones, so growth passes. Measured
 * on scenario 6's identical split (2026-09-26): duplicate rows plus growth, exit 0.
 * @param {unknown} node
 * @returns {string[]}
 */
function rowProblems(node) {
  const labels = Array.isArray(node) ? node.map((/** @type {any} */ row) => row?.label) : [];
  return [...new Set(labels)].filter((label) => labels.filter((other) => other === label).length > 1)
    .map((label) => `${RECORD} holds ${labels.filter((other) => other === label).length} rows labelled ` +
      `${JSON.stringify(label)}: the history binds the last and the growth terms read the first, so a raised copy ` +
      "ahead of the true row hides growth. Restore it from git");
}

// Each variant is measured by `tools/0a-measure.mjs`, whose bytes are inside the recipe digest; what
// it returns is held to the recipe below rather than trusted — the options it handed `createStrings`
// (`handedProblems`), each row's graph walked again from the declared entry (`measuredGraphProblems`,
// which also sees THIS loop, in no digest, hand it another entry), and every timing (`timingProblems`).
/** @type {any[]} */
const rows = [];
/** @type {string[]} */
const harnessProblems = [];
for (const variant of RECIPE.variants) {
  const { row, handed } = await measureVariant(root, variant);
  rows.push(row);
  harnessProblems.push(...handedProblems(variant, handed));
}
const walk = (/** @type {string} */ entry) => walkGraph(root, entry);
harnessProblems.push(...measuredGraphProblems(rows, walk));

const kb = (n) => (n === null ? "n/a" : (n / 1024).toFixed(1));
console.log(`scenario 0a — Node ${process.version}, median of ${RECIPE.iterations}${gc ? "" : "   (memory needs --expose-gc)"}`);
console.log(`  recipe ${recipeSha256.slice(0, 16)}  revision ${RECIPE.revision}\n`);
console.log(`${"variant".padEnd(26)}${"modules".padStart(8)}${"src KB".padStart(9)}${"import ms".padStart(11)}${"construct ms".padStart(14)}${"1st render ms".padStart(15)}${"heap KB".padStart(10)}`);
const fixed = (/** @type {unknown} */ n, /** @type {number} */ digits) => (typeof n === "number" ? n.toFixed(digits) : String(n));
for (const r of rows)
  console.log(
    r.label.padEnd(26) + String(r.modules).padStart(8) + kb(r.sourceBytes).padStart(9) +
    fixed(r.importMs, 2).padStart(11) + fixed(r.constructionMs, 3).padStart(14) +
    fixed(r.firstRenderMs, 4).padStart(15) + kb(r.retainedBytes).padStart(10),
  );

console.log(`\nrendered: ${JSON.stringify(rows[0].firstRender)}`);
console.log(`(en-AU request, no en-AU catalog: resolves through the CLDR parent chain to en-001, then en)`);
// --- baseline: ratchet the deterministic half, report the noisy half ------------------------------
const baselinePath = resolve(root, "measurements/scenario-0a.json");
const RECORD = "measurements/scenario-0a.json";
/** @type {Record<string, any>} */
const record = {
  scenario: "0a",
  revision: RECIPE.revision,
  note: "Baseline, not a threshold. M2 is tracked by engineering measurement; no go/no-go line exists.",
  recipe: RECIPE,
  recipeSha256,
  environments: ["node"],
  node: rows.map((r) => ({
    label: r.label, modules: r.modules, sourceBytes: r.sourceBytes,
    importMs: Number(fixed(r.importMs, 3)),
    constructionMs: Number(fixed(r.constructionMs, 4)),
    firstRenderMs: Number(fixed(r.firstRenderMs, 4)),
    retainedBytes: r.retainedBytes,
  })),
};

/**
 * Three kinds of finding, because they are answered differently:
 *
 *   BROKEN   — no write may proceed over it. A changed recipe, fixture or measuring code, or a harness
 *              or export map that no longer matches them — rows, returned or about to be recorded, that
 *              are not the recipe's variants or not their entries' graphs, a timing that is missing or
 *              not finite — is fixed in SOURCE or by running with --expose-gc; a broken or unreadable
 *              history, figures the newest entry did not record (raised, deleted, not counts, a row or
 *              the browser half gone), a browser half it did not bind (edited by hand), or a recorded
 *              timing gone, is restored from git; a render that is not the recipe's measured a failure
 *              path. Writing over any of them would record the defect as the new baseline.
 *   GROWTH   — the ratchet's own term: fails the run, and `--write` records it only with a reason.
 *              A variant the record does not hold counts here as well — a recipe revision that adds
 *              one is recorded deliberately — so deleting a ROW is no more a reset than deleting the
 *              file.
 *   REPORTED — timing and heap VALUES, a shrink, and the browser half's staleness: printed, never
 *              compared. A shrink still needs a reason to be written, as every write does.
 */
// THE ROWS THIS RUN RECORDS ARE HELD, not only the rows the harness returned: the copy into `record.node`
// above is in no digest, and a review offset one figure in it (`r.sourceBytes - 5`) to let 5 bytes of real
// growth through at exit 0. What the ratchet compares and a write stores is what is walked again here.
/** @type {string[]} */
const broken = [...recipeProblems(), ...harnessProblems, ...measuredGraphProblems(record.node, walk, "this run records"),
  ...timingProblems(record.node, "this run")];
try {
  broken.push(...exportProblems(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))));
} catch (error) {
  broken.push(`package.json could not be read (${/** @type {Error} */ (error).message}), so no specifier is known to resolve`);
}
/** @type {string[]} */
const growth = [];

const missing = !existsSync(baselinePath);
/** @type {any} */
let baseline = null;
if (!missing) {
  // An unreadable record is BROKEN, never "missing": a missing one fails with its own remedy below,
  // and either way nothing is compared against a baseline that could not be read.
  /** @type {unknown} */
  let parsed;
  try { parsed = JSON.parse(readFileSync(baselinePath, "utf8")); } catch (error) {
    broken.push(`${RECORD} is not valid JSON (${/** @type {Error} */ (error).message}); restore it from git`);
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) baseline = parsed;
  else if (parsed !== undefined) broken.push(`${RECORD} holds ${JSON.stringify(parsed)}, not a record; restore it from git`);
}

for (const r of rows)
  if (r.firstRender !== RECIPE.render.expected)
    broken.push(`${r.label}: the first render was ${JSON.stringify(r.firstRender)}, not the recipe's ` +
      `${JSON.stringify(RECIPE.render.expected)}, so the timings describe a failure path`);

if (baseline) {
  broken.push(...chainProblems(baseline.rebaselines, REBASELINES_ORIGIN, RECORD, REBASELINES_FROZEN_THROUGH));
  broken.push(...rowProblems(baseline.node));
  // EVERY ENTRY'S REASON IS A SENTENCE. The chain pins the entries up to the checkpoint; after it, a reason
  // blanked or replaced by a flag read as one would still link, so the text itself is held.
  if (Array.isArray(baseline.rebaselines))
    baseline.rebaselines.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
      if (entry && typeof entry === "object" && !isReason(entry.reason))
        broken.push(`${RECORD}: history entry ${i} carries no reason (${JSON.stringify(entry.reason)}); restore it from git`);
    });
  // THE FIGURES ARE BOUND TO THE NEWEST ENTRY. Measured 2026-09-25 by an adversarial review, before
  // this: deleting a row's `sourceBytes` and `modules` let 28 bytes of growth through at exit 0 (the
  // comparison with `undefined` said nothing) and a bare `--write` recorded it with no reason; raising
  // both rows' `sourceBytes` by 100,000 let growth through at exit 0 too; and cutting the history back
  // to its first entry passed. Each now fails here, and none can be written over.
  const newest = Array.isArray(baseline.rebaselines) ? baseline.rebaselines.at(-1) : undefined;
  broken.push(...figureProblems(figuresOf(baseline.node), newest?.recorded, RECORD));
  // The recorded timings are reported and never compared, but they are required present (A33 (4)):
  // deleting them from the record's rows exited 0 before this.
  broken.push(...timingProblems(baseline.node, RECORD).map((line) => `${line}; restore it from git`));
  // The browser half is reported and never gated, but it is not DELETABLE: it cannot be re-derived
  // here, and losing it was half the harm of the reset this closes. Nor may it be thinned — a row
  // gone, a count or a timing deleted.
  if (newest?.browserHalf === true && !baseline.browser)
    broken.push(`${RECORD} holds no browser half, and its newest history entry recorded one; it was deleted. ` +
      "Restore it from git — a Node run cannot re-derive it");
  if (baseline.browser) broken.push(...browserHalfProblems(baseline.browser).map((line) => `${RECORD}: ${line}; restore it from git`));
  // AND IT IS BOUND TO THE NEWEST ENTRY BY ITS DIGEST, as the Node figures are by `recorded`: whole and
  // finite is not unedited. Measured 2026-09-26 by a review, before this: with the half STALE after a
  // recorded growth, its transfer bytes raised by hand to the new graph's and a cold import changed from
  // 25 to 2.5 ms printed "fresh" at exit 0. Only a capture, with a reason and an entry of its own,
  // replaces it now; a `--write` carries it verbatim and binds it again.
  const newestIndex = Array.isArray(baseline.rebaselines) ? baseline.rebaselines.length - 1 : -1;
  const boundBrowser = typeof newest?.browserSha256 === "string" ? newest.browserSha256
    : newestIndex === BROWSER_HALF_AT_ENTRY.index ? BROWSER_HALF_AT_ENTRY.sha256 : undefined;
  if (boundBrowser === undefined)
    broken.push(`${RECORD}'s newest history entry binds no browser half (no browserSha256), so the one the record ` +
      "holds could have been edited by hand; restore the record from git");
  else if (entryDigest(baseline.browser ?? null) !== boundBrowser)
    broken.push(`${RECORD}'s browser half is not the one its newest history entry bound (${boundBrowser.slice(0, 12)}): ` +
      "it was edited by hand. Restore it from git, or re-capture it with tools/browser-0a/record.mjs --reason");
  if (!Number.isSafeInteger(baseline.revision) || baseline.revision < 1 || baseline.revision > RECIPE.revision)
    broken.push(`${RECORD} is at recipe revision ${JSON.stringify(baseline.revision)}, which this tool (revision ` +
      `${RECIPE.revision}) did not produce`);
  else if (baseline.revision < RECIPE.revision) {
    const was = /** @type {Record<number, string>} */ (RECIPE_DIGESTS)[baseline.revision];
    // `was` is checked for itself: with no digest frozen for the claimed revision — possible once a
    // recipe skips one, since only the CURRENT revision must be frozen — a record carrying no
    // `recipeSha256` would otherwise match `undefined` with `undefined`. (Revision 0, the review's
    // probe, is refused by the range check above before it gets here.)
    if (was === undefined || baseline.recipeSha256 !== was)
      broken.push(`${RECORD} claims revision ${baseline.revision} under recipe ${String(baseline.recipeSha256).slice(0, 12)}, ` +
        `which is not the digest frozen for that revision (${String(was).slice(0, 12)})`);
    growth.push(`the recipe moved from revision ${baseline.revision} to ${RECIPE.revision}; figures either side ` +
      `are not comparable as the same scenario, so the move is recorded with a reason`);
  } else if (baseline.recipeSha256 !== recipeSha256 || sha256(JSON.stringify(baseline.recipe ?? null)) !== baseline.recipeSha256)
    broken.push(`${RECORD} was recorded under recipe ${String(baseline.recipeSha256).slice(0, 12)} at revision ` +
      `${RECIPE.revision}, and the recipe is now ${recipeSha256.slice(0, 12)} at the same revision: the frozen ` +
      `digest or the record was edited by hand`);

  console.log(`\ndrift against the recorded baseline:`);
  const recorded = Array.isArray(baseline.node) ? baseline.node : [];
  for (const now of record.node) {
    const was = recorded.find((/** @type {any} */ b) => b?.label === now.label);
    // A row whose figures are missing or are not counts is as unrecorded as a missing row: compared
    // with `undefined`, or with a string, growth says nothing.
    if (!was || !isCount(was.sourceBytes) || !isCount(was.modules)) {
      growth.push(`${now.label}: NOT RECORDED — ${RECORD} holds no row with counted figures for it, and ` +
        `absence is not agreement`);
      continue;
    }
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
  for (const was of recorded)
    if (!record.node.some((/** @type {any} */ now) => now.label === was?.label))
      growth.push(`${was?.label}: ${RECORD} holds a row the recipe does not measure`);
}

const writing = process.argv.includes("--write");
const reasonIndex = process.argv.indexOf("--reason");
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : null;
let initialized = false;

if (writing) {
  /** @type {string[]} */
  const refusals = [...broken];
  if (!missing && process.argv.includes("--init"))
    refusals.push(`--init starts a first record, and ${RECORD} exists; drop --init`);
  if (missing) {
    // A FIRST RECORD IS A LOUD, EXPLICIT ACT, and it is refused once one has existed. The reset this
    // closes: delete the file, `--write`, and the tree's grown figures become the baseline with no
    // reason asked for.
    if (!process.argv.includes("--init"))
      refusals.push(`${RECORD} does not exist, and --write will not start a new baseline over a missing one: it ` +
        `would record whatever this tree measures today. Restore it from git (git checkout -- ${RECORD}).`);
    else if (REBASELINES_ORIGIN !== undefined || REBASELINES_FROZEN_THROUGH !== undefined)
      refusals.push(`--init refused: this tool's history is frozen to start at ` +
        `${REBASELINES_ORIGIN?.slice(0, 12) ?? "an unnamed origin, with a checkpoint"}, so a record has existed. ` +
        `Restore it from git; starting over would launder whatever grew since.`);
    else if (!isReason(reason))
      refusals.push(`--init needs --reason "…": the first entry of a history says why it starts`);
  }
  if (refusals.length) {
    console.error(`\nrefusing to write ${RECORD}:`);
    for (const line of refusals) console.error(`  ${line}`);
    process.exit(2);
  }
  // A ratchet anyone can silently reset is not a ratchet. EVERY write needs a stated reason, which is
  // kept in the chained entry it appends — during M4 the baseline was raised without one, which is
  // exactly the signal the ratchet exists to produce. It was growth only until 2026-09-26, and a
  // write with no growth appended nothing: a shrink written that way left the newest entry holding
  // figures above the record's, so raising the record back up to them by hand passed.
  if (!isReason(reason)) {
    console.error(`\nrefusing to write ${RECORD} without --reason "why" (a sentence, not blank and not the next ` +
      `flag): every write appends a chained history ` +
      `entry that says why it was written${growth.length ? ", and this one records growth:" : ""}`);
    for (const g of growth) console.error(`  ${g}`);
    process.exit(2);
  }
  initialized = missing;

  // CARRY THE BROWSER HALF FORWARD. `record` above is built fresh from a Node run and hard-codes
  // `environments: ["node"]`, so without this a `--write` here silently DELETES whatever
  // `tools/browser-0a/record.mjs` measured — and the deletion is invisible, because the next Node
  // run has no way to know a browser figure ever existed. The browser half cannot be re-derived on
  // demand the way these Node rows can (it needs a real browser driven by hand), so losing it costs
  // a measurement nobody can cheaply retake. `rebaselines` is carried forward just below for exactly
  // this reason; the browser block was simply missed when it was added.
  //
  // It is carried VERBATIM and never synthesized: a Node run must not be able to invent, adjust or
  // freshen a browser number. If the source files have moved since the capture, the stale block is
  // the honest record and re-capturing it is a person's job.
  if (baseline?.browser) {
    record.browser = baseline.browser;
    record.environments = [...new Set([...record.environments, ...(baseline.environments ?? [])])];
  }
  // Each entry names the digest of the one before it (`tools/ratchet-chain.mjs`), so an entry deleted,
  // reordered or edited later breaks the chain up to the NEWEST, which nothing names — the checkpoint
  // above pins the history up to it, and `recorded` and `browserSha256` bind the figures and the browser
  // half this write stores to the entry that explains them. Every write appends one, since every write
  // has a reason.
  const history = Array.isArray(baseline?.rebaselines) ? baseline.rebaselines : [];
  record.rebaselines = [...history,
    chained(history, { reason, growth, recorded: figuresOf(record.node), browserHalf: Boolean(record.browser),
      browserSha256: entryDigest(record.browser ?? null) })];
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to ${RECORD} (reason recorded)`);
  if (initialized)
    console.error(`\nA NEW HISTORY WAS STARTED. Freeze its first entry in this tool before anything else:\n` +
      `  const REBASELINES_ORIGIN = "${entryDigest(record.rebaselines[0])}";\n` +
      `Until then every run fails, because an unfrozen history can be started over without anyone noticing.`);
}

// THE UNFROZEN TAIL, REPORTED. Entries after the checkpoint are held by the chain and the figures
// they bind, not by source; saying how many there are is what keeps "frozen" from being read as "all".
const finalHistory = writing ? record.rebaselines : baseline?.rebaselines;
if (Array.isArray(finalHistory) && finalHistory.length > 0 && finalHistory.every((entry) => entry && typeof entry === "object")) {
  const through = REBASELINES_FROZEN_THROUGH?.index ?? -1;
  const after = finalHistory.length - 1 - through;
  console.log(`\nhistory: ${finalHistory.length} rebaselines, frozen in this tool through entry ${through}` +
    (after > 0 ? `; ${after} after it held by the chain and the figures they bind, not by source` : ""));
  if (after > 0)
    console.log(`  to freeze them: const REBASELINES_FROZEN_THROUGH = ${JSON.stringify(checkpointOf(finalHistory))};`);
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
    console.log(`  window.__RESULTS__, then node tools/browser-0a/record.mjs root.json core.json --reason "…"`);
    console.log(`  (reported, never gated — a green verify must not need a human at a browser)`);
  } else {
    console.log(`  fresh: transfer bytes and resource counts match the Node graph exactly in both variants`);
  }
} else {
  console.log(`\nNOT MEASURED: the exact-floor browser half of 0a. Both variants must be measured in a`);
  console.log(`browser before 0a is complete; these are the Node figures only.`);
}
console.log(`NO THRESHOLDS EXIST, by decision: M2 is tracked by engineering measurement. Size and module`);
console.log(`count ratchet against the baseline; timings and heap are reported, never compared, and`);
console.log(`required present.`);

if (missing && !writing) {
  // ABSENCE IS NEVER AGREEMENT. This line used to be advice ("run with --write to record one") and
  // the run exited 0, which is how a deleted record reset the ratchet.
  console.error(`\nNOT RECORDED: ${RECORD} does not exist, so nothing ratchets. Restore it from git ` +
    `(git checkout -- ${RECORD}); --write will not start a new one.`);
  process.exit(1);
}
if (initialized) process.exit(1);

// Growth that has just been recorded WITH a reason is accepted: the ratchet's job is to force the
// decision to be explicit, not to fail forever after it has been made. It is printed BEFORE a broken
// record is reported, so a run that is both says both.
const accepted = writing && Boolean(reason);
if (growth.length && !accepted) {
  console.log(`\nGRAPH GROWTH (deterministic, gated):`);
  for (const g of growth) console.log(`  ${g}`);
}
if (broken.length) {
  console.error(`\nSCENARIO 0a IS NOT WHAT ITS RECORD DESCRIBES (gated):`);
  for (const line of broken) console.error(`  ${line}`);
}
if (broken.length || (growth.length && !accepted)) process.exit(1);
