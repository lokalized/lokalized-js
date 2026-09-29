#!/usr/bin/env node
// @ts-check
/**
 * Every published subpath's module graph — its CONTAINMENT and its SIZE.
 *
 * WHY THIS EXISTS, measured rather than supposed. Before it, `lokalized/load`, `lokalized/ssr` and
 * `lokalized/node` were gated by NOTHING on either axis: appending 20 KB to `src/load/index.js`
 * leaves `npm run scenario:0a` byte-identical (`src 0.0%` in both variants), `npm run size:graph`
 * exit 0 and all 906 tests green. `tools/graph-size.mjs` cannot even be aimed at them — it copies
 * the graph to a temp directory and imports `src/core/index.js` by name, so it exits 1 with
 * ERR_MODULE_NOT_FOUND on any other entry. M8 builds most of its remaining work in exactly those
 * three subpaths, so its entire code volume would have landed unwatched.
 *
 * THE CONTAINMENT RULE IS DERIVED, NOT DECLARED. `lokalized-spec/symbol-allowlist.json` already
 * records, per subpath, whether it is reachable from a browser, an edge runtime and Node — and
 * `lokalized/node` is the only one marked `browser: false`. So the rule falls out of data the plan
 * already owns: a subpath a browser can import must not reach territory that only the Node-only
 * subpath owns. Nothing here hand-lists which module belongs to whom, which is the difference
 * between a rule that keeps holding and a list that rots.
 *
 * Sizes ratchet the way scenario 0a's do — module count AND source bytes, failing on any growth —
 * because these subpaths are about to grow a great deal and the point is that each increase is
 * deliberate. Re-record once per landed slice batch:
 *   node tools/subpath-graphs.mjs --write --reason "why the graph grew"
 *
 * **THE RATCHET IS NOT RESET BY DELETING OR RE-WRITING ITS RECORD** (2026-09-25, the proof
 * obligation A4/A7 carry — restated as A33). Measured before the change: with
 * `measurements/subpath-graphs.json` deleted this printed "no baseline yet" and exited 0, and the
 * `--write --reason` it suggested recorded today's graphs as the baseline with a history of ONE entry
 * — the 59 recorded reasons gone — so any growth since the last record passed as a first measurement.
 * Now a missing or unreadable record FAILS and `--write` will not start one; the `history` is chained
 * (`tools/ratchet-chain.mjs`) from a first entry whose digest is frozen below, beside a CHECKPOINT
 * that pins every entry up to it, because the chain alone cannot see entries cut from its end — a
 * review measured a history cut back to its first entry passing at exit 0; and each entry records the
 * figures its write stored, which the record may not exceed, drop, or hold as anything but counts —
 * the same review measured a row's deleted figures, and a row's figures raised by hand, each letting
 * growth through at exit 0. What stays open: entries after the checkpoint are held by the chain and
 * the figures they bind, not by source, until it moves forward (reported every run, not gated), so
 * cutting them loses their reasons but not the ratchet; and one of them edited consistently with the
 * record shows only in a diff. `test/subpath-graphs-baseline.test.js` runs each rule.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { graphBytes } from "./graph-walk.mjs";
import { chainProblems, chained, checkpointOf, entryDigest, figureProblems } from "./ratchet-chain.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const baselinePath = join(root, "measurements/subpath-graphs.json");
const RECORD = "measurements/subpath-graphs.json";

/**
 * The digest of the FIRST entry of `history` — the M8 S2/S3 initial baseline — frozen so that a history
 * started over (the record deleted and written again) does not begin where this says it must. The
 * history was chained on 2026-09-25 without re-measuring anything and without dropping a reason.
 * `undefined` only for a brand-new tool: see `--init`.
 * @type {string | undefined}
 */
const HISTORY_ORIGIN = "348eea727da03e20c728cddb2317d7a864060b888f3383aa66395fffd2157156";

/**
 * THE CHECKPOINT: `history[index]` must exist and have this digest, which pins every entry up to it —
 * the chain alone cannot see its own end. Frozen at the entry that bound the figures to the history on
 * 2026-09-25. Entries appended after it are held by the chain and by the figures they bind, not by
 * source; each run reports how many there are and prints the value that would freeze them. Move it
 * forward once per landed batch — a deliberate edit, like the origin.
 * @type {{ index: number, sha256: string } | undefined}
 */
const HISTORY_FROZEN_THROUGH = { index: 63, sha256: "a525d24c143f756efc2c3e9bda7bbd0582ada9ca6e353fd9b474dcfeacca8ddb" };

const isCount = (/** @type {unknown} */ n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const allowlistPath = join(root, "..", "lokalized-spec/symbol-allowlist.json");
if (!existsSync(allowlistPath)) {
  console.error(`the symbol allowlist is missing at ${allowlistPath}\n` +
    `This gate derives its containment rule from the allowlist's own browser/edge/node flags, so it ` +
    `cannot run without it. A gate that quietly passes when its input is absent has stopped gating.`);
  process.exit(2);
}
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

/** subpath specifier -> its declared runtime reachability. */
const flagsBySubpath = new Map(
  allowlist.subpaths.map((row) => [row.subpath, { browser: row.browser, edge: row.edge, node: row.node }]),
);

/** `./load` in the export map is `lokalized/load` in the allowlist. */
const specifierFor = (exportKey) => (exportKey === "." ? "lokalized" : `lokalized/${exportKey.slice(2)}`);

const entries = [];
for (const [exportKey, target] of Object.entries(pkg.exports)) {
  if (exportKey === "./package.json") continue;
  const specifier = specifierFor(exportKey);
  const flags = flagsBySubpath.get(specifier);
  if (!flags) {
    console.error(`package.json publishes '${exportKey}' but the allowlist declares no '${specifier}'`);
    process.exit(2);
  }
  entries.push({ specifier, entry: /** @type {{ import: string }} */ (target).import.replace(/^\.\//, ""), flags });
}

// The territory a browser may not enter: the directory of every entry point whose subpath is not
// browser-reachable. Derived from the flags, so adding a second Node-only subpath needs no edit here.
const nodeOnlyTerritory = entries
  .filter((row) => !row.flags.browser)
  .map((row) => `${dirname(join(root, row.entry))}/`);

const measured = entries.map((row) => {
  const graph = graphBytes(root, row.entry);
  const trespass = row.flags.browser
    ? graph.files.filter((file) => nodeOnlyTerritory.some((territory) => file.startsWith(territory)))
    : [];
  return { ...row, ...graph, trespass };
});

console.log(`subpath graphs — ${measured.length} published entry points\n`);
console.log(`  ${"subpath".padEnd(24)}${"modules".padStart(8)}${"source KB".padStart(11)}   runtimes`);
for (const row of measured) {
  const runtimes = [row.flags.browser && "browser", row.flags.edge && "edge", row.flags.node && "node"]
    .filter(Boolean).join("/");
  console.log(
    `  ${row.specifier.padEnd(24)}${String(row.modules).padStart(8)}` +
    `${(row.bytes / 1024).toFixed(1).padStart(11)}   ${runtimes}`,
  );
}

const trespassers = measured.filter((row) => row.trespass.length);
if (trespassers.length) {
  console.log(`\nCONTAINMENT VIOLATIONS (${trespassers.length}) — a browser-reachable subpath entered Node-only territory:`);
  for (const row of trespassers) {
    console.log(`  ${row.specifier} (declared browser-reachable) reaches:`);
    for (const file of row.trespass) console.log(`      ${relative(root, file)}`);
  }
  console.log(`The allowlist marks these subpaths browser-reachable, so a Node-only module in their` +
    `\ngraph is a packaging defect, not a style question.`);
}

// BROKEN findings refuse a write as well as failing the run: writing over a broken history would
// carry the damage forward as if it were the record.
/** @type {string[]} */
const broken = [];
const missing = !existsSync(baselinePath);
/** @type {any} */
let baseline = null;
if (!missing) {
  /** @type {unknown} */
  let parsed;
  try { parsed = JSON.parse(readFileSync(baselinePath, "utf8")); } catch (error) {
    broken.push(`${RECORD} is not valid JSON (${/** @type {Error} */ (error).message}); restore it from git`);
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) baseline = parsed;
  else if (parsed !== undefined) broken.push(`${RECORD} holds ${JSON.stringify(parsed)}, not a record; restore it from git`);
}
const growth = [];
const shrank = [];
if (baseline) {
  broken.push(...chainProblems(baseline.history, HISTORY_ORIGIN, RECORD, HISTORY_FROZEN_THROUGH));
  // THE FIGURES ARE BOUND TO THE NEWEST ENTRY: none above what it recorded, none missing, all counts.
  const figures = baseline.subpaths && typeof baseline.subpaths === "object" && !Array.isArray(baseline.subpaths)
    ? baseline.subpaths : {};
  const newest = Array.isArray(baseline.history) ? baseline.history.at(-1) : undefined;
  broken.push(...figureProblems(figures, newest?.recorded, RECORD));
  for (const row of measured) {
    const was = figures[row.specifier];
    // A row whose figures are missing or are not counts is as unrecorded as a missing row: compared
    // with `undefined`, or with a string, growth says nothing.
    if (!was || !isCount(was.modules) || !isCount(was.bytes)) {
      growth.push(`${row.specifier}: NOT RECORDED — a newly published subpath must be recorded deliberately, ` +
        "and a recorded one needs counted figures");
      continue;
    }
    if (row.modules > was.modules)
      growth.push(`${row.specifier}: module count grew ${was.modules} -> ${row.modules}`);
    if (row.bytes > was.bytes)
      growth.push(`${row.specifier}: source graph grew ${was.bytes} -> ${row.bytes} bytes`);
    // A SHRINK IS NOT A FAILURE AND IT IS NOT NOTHING. This ratchet only ever asked "did it grow",
    // so a graph that got SMALLER left the artifact describing a tree that no longer exists, in
    // silence. Measured 2026-09-17: the record read 872,639 bytes for `lokalized` against a live
    // 872,635 — four bytes, from a comment reworded one slice earlier — and nothing anywhere said
    // so. It was found by `tools/bundle-sizes.mjs` running a real bundler over the same graph and
    // disagreeing with the RECORD while agreeing with the tree. Reported, not gated, on
    // `scenario:0a`'s reasoning: re-recording is a deliberate act with a reason attached.
    if (row.modules < was.modules || row.bytes < was.bytes)
      shrank.push(`${row.specifier}: ${was.modules} -> ${row.modules} modules, ` +
        `${was.bytes} -> ${row.bytes} bytes`);
  }
  // A recorded subpath that is no longer published is the same kind of fact as a shrink.
  for (const specifier of Object.keys(figures))
    if (!measured.some((row) => row.specifier === specifier))
      shrank.push(`${specifier}: recorded, and no longer published`);
}

if (shrank.length) {
  console.log(`\n  STALE — the recorded graph is larger than the tree it describes:`);
  for (const line of shrank) console.log(`    ${line}`);
  console.log(`  Reported, not gated. Re-record with --write --reason "…" when the shrink is` +
    `\n  deliberate, so the artifact stops describing source that is gone.`);
}

if (growth.length) {
  console.log(`\nGRAPH GROWTH (deterministic, gated):`);
  for (const line of growth) console.log(`  ${line}`);
  console.log(`Re-record deliberately, once per landed slice batch:` +
    `\n  node tools/subpath-graphs.mjs --write --reason "what grew and why"`);
}

/**
 * THE UNFROZEN TAIL, REPORTED. Entries after the checkpoint are held by the chain and the figures they
 * bind, not by source; saying how many there are is what keeps "frozen" from being read as "all".
 * @param {unknown} history
 */
function reportTail(history) {
  if (!Array.isArray(history) || history.length === 0 || !history.every((entry) => entry && typeof entry === "object"))
    return;
  const through = HISTORY_FROZEN_THROUGH?.index ?? -1;
  const after = history.length - 1 - through;
  console.log(`\nhistory: ${history.length} entries, frozen in this tool through entry ${through}` +
    (after > 0 ? `; ${after} after it held by the chain and the figures they bind, not by source` : ""));
  if (after > 0) console.log(`  to freeze them: const HISTORY_FROZEN_THROUGH = ${JSON.stringify(checkpointOf(history))};`);
}

if (process.argv.includes("--write")) {
  const reasonIndex = process.argv.indexOf("--reason");
  const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : null;
  if (!reason) {
    console.error(`\n--write needs --reason "…". A ratchet anyone can silently reset is not a ratchet.`);
    process.exit(2);
  }
  /** @type {string[]} */
  const refusals = [...broken];
  const init = process.argv.includes("--init");
  if (!missing && init) refusals.push(`--init starts a first record, and ${RECORD} exists; drop --init`);
  // A FIRST RECORD IS A LOUD, EXPLICIT ACT, and it is refused once one has existed. The reset this
  // closes: delete the file, `--write --reason`, and today's grown graphs become the baseline.
  if (missing && !init)
    refusals.push(`${RECORD} does not exist, and --write will not start a new baseline over a missing one: it ` +
      `would record whatever this tree measures today. Restore it from git (git checkout -- ${RECORD}).`);
  else if (missing && (HISTORY_ORIGIN !== undefined || HISTORY_FROZEN_THROUGH !== undefined))
    refusals.push(`--init refused: this tool's history is frozen to start at ` +
      `${HISTORY_ORIGIN?.slice(0, 12) ?? "an unnamed origin, with a checkpoint"}, so a record has existed. ` +
      `Restore it from git; starting over would launder whatever grew since.`);
  if (refusals.length) {
    console.error(`\nrefusing to write ${RECORD}:`);
    for (const line of refusals) console.error(`  ${line}`);
    process.exit(2);
  }
  // Each entry names the digest of the one before it, so an entry deleted, reordered or edited later
  // breaks the chain up to the NEWEST, which nothing names — the checkpoint above pins the history up
  // to it, and `recorded` binds the figures this write stores to the entry that explains them.
  const history = Array.isArray(baseline?.history) ? baseline.history : [];
  const subpaths = Object.fromEntries(measured.map((row) => [row.specifier, { modules: row.modules, bytes: row.bytes }]));
  const record = {
    note: "Per-subpath module graphs. Module count and source bytes ratchet; growth needs a reason.",
    generatedBy: "tools/subpath-graphs.mjs",
    history: [...history, chained(history, { reason, recorded: subpaths })],
    subpaths,
  };
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to ${RECORD} (reason recorded)`);
  reportTail(record.history);
  if (missing) {
    console.error(`\nA NEW HISTORY WAS STARTED. Freeze its first entry in this tool before anything else:\n` +
      `  const HISTORY_ORIGIN = "${entryDigest(record.history[0])}";\n` +
      `Until then every run fails, because an unfrozen history can be started over without anyone noticing.`);
    process.exit(1);
  }
  process.exit(trespassers.length === 0 ? 0 : 1);
}

reportTail(baseline?.history);

if (missing) {
  // ABSENCE IS NEVER AGREEMENT. This used to print "no baseline yet" and exit 0.
  console.error(`\nNOT RECORDED: ${RECORD} does not exist, so nothing ratchets. Restore it from git ` +
    `(git checkout -- ${RECORD}); --write will not start a new one.`);
  process.exit(1);
}
if (broken.length) {
  console.error(`\nTHE RECORD IS BROKEN (gated):`);
  for (const line of broken) console.error(`  ${line}`);
}

process.exit(trespassers.length === 0 && growth.length === 0 && broken.length === 0 ? 0 : 1);
