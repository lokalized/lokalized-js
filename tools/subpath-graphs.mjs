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
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { graphBytes } from "./graph-walk.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const baselinePath = join(root, "measurements/subpath-graphs.json");

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

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
const growth = [];
if (baseline) {
  for (const row of measured) {
    const was = baseline.subpaths?.[row.specifier];
    if (!was) {
      growth.push(`${row.specifier}: NOT RECORDED — a newly published subpath must be recorded deliberately`);
      continue;
    }
    if (row.modules > was.modules)
      growth.push(`${row.specifier}: module count grew ${was.modules} -> ${row.modules}`);
    if (row.bytes > was.bytes)
      growth.push(`${row.specifier}: source graph grew ${was.bytes} -> ${row.bytes} bytes`);
  }
} else {
  console.log(`\n  no baseline yet; run with --write --reason "…" to record one`);
}

if (growth.length) {
  console.log(`\nGRAPH GROWTH (deterministic, gated):`);
  for (const line of growth) console.log(`  ${line}`);
  console.log(`Re-record deliberately, once per landed slice batch:` +
    `\n  node tools/subpath-graphs.mjs --write --reason "what grew and why"`);
}

if (process.argv.includes("--write")) {
  const reasonIndex = process.argv.indexOf("--reason");
  const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : null;
  if (!reason) {
    console.error(`\n--write needs --reason "…". A ratchet anyone can silently reset is not a ratchet.`);
    process.exit(2);
  }
  const record = {
    note: "Per-subpath module graphs. Module count and source bytes ratchet; growth needs a reason.",
    generatedBy: "tools/subpath-graphs.mjs",
    history: [...(baseline?.history ?? []), { reason }],
    subpaths: Object.fromEntries(measured.map((row) => [row.specifier, { modules: row.modules, bytes: row.bytes }])),
  };
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nbaseline written to measurements/subpath-graphs.json (reason recorded)`);
  process.exit(trespassers.length === 0 ? 0 : 1);
}

process.exit(trespassers.length === 0 && growth.length === 0 ? 0 : 1);
