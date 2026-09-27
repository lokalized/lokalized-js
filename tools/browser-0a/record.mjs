#!/usr/bin/env node
// @ts-check
/**
 * Merges browser measurements into `measurements/scenario-0a.json`.
 *
 * The browser half cannot run headless from `npm run scenario:0a` the way the Node half does, so it
 * is driven interactively (`npm run serve:0a`, then load `/?variant=root` and `/?variant=core` and
 * read `window.__RESULTS__`) and recorded here. Keeping it in the same artifact means 0a is one
 * record with both environments, rather than a Node number and a browser number nobody reconciles.
 *
 * **A CAPTURE IS A WRITE LIKE ANY OTHER** (2026-09-26): it replaces recorded 0a figures, so it needs a
 * reason and appends a chained entry to the record's `rebaselines`, as every `--write` of
 * `tools/scenario-0a.mjs` does — carrying the Node figures the newest entry already binds, which a
 * capture does not touch, and binding the browser half it writes by its digest (`browserSha256`), which
 * `tools/scenario-0a.mjs` then requires the record to hold unedited. And it writes no browser half
 * `tools/scenario-0a.mjs` would refuse: a row per recipe variant, with its counts and finite timings
 * (`browserHalfProblems`), each named rather than crashed on.
 *
 *   node tools/browser-0a/record.mjs <root.json> <core.json> --reason "why"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { browserHalfProblems } from "../0a-recipe.mjs";
import { chained, entryDigest } from "../ratchet-chain.mjs";

const root = resolve(new URL("../..", import.meta.url).pathname);
const path = resolve(root, "measurements/scenario-0a.json");
const record = JSON.parse(readFileSync(path, "utf8"));

const args = process.argv.slice(2);
const reasonIndex = args.indexOf("--reason");
const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : null;
const files = args.filter((_, i) => reasonIndex < 0 || (i !== reasonIndex && i !== reasonIndex + 1));
if (files.length === 0) { console.error('usage: record.mjs <capture.json>... --reason "why"'); process.exit(2); }
// A reason is a sentence: not blank, and not the next flag read as one (`--reason --x` would record "--x").
if (typeof reason !== "string" || !reason.trim() || reason.startsWith("--")) {
  console.error('refusing to record without --reason "why": a capture replaces recorded 0a figures, and every write ' +
    "that does appends a chained history entry saying why");
  process.exit(2);
}
const captures = files.map((p) => JSON.parse(readFileSync(p, "utf8")));

const agents = new Set(captures.map((c) => c.userAgent));
if (agents.size !== 1) throw new Error(`captures come from ${agents.size} different browsers; 0a records one`);

/** A timing rounded as the record keeps it, or left as it came so that the check names it. */
const rounded = (/** @type {unknown} */ n, /** @type {number} */ digits) => (typeof n === "number" ? Number(n.toFixed(digits)) : n);

const browser = {
  userAgent: [...agents][0],
  transferCompression: "none — the harness server does not compress; section 9.2's gzip/brotli ceilings are a separate measure",
  memoryKind: captures[0].memoryKind,
  note: "One variant per page load: measuring both in one document leaves the second with a warm module cache and zero cold-import, resource and transfer figures.",
  variants: captures.flatMap((c) => c.rows.map((r) => ({
    label: r.label,
    resources: r.resources,
    encodedBytes: r.encodedBytes,
    decodedBytes: r.decodedBytes,
    coldImportMs: rounded(r.coldImportMs, 1),
    importMs: rounded(r.importMs, 3),
    constructionMs: rounded(r.constructionMs, 4),
    firstRenderMs: rounded(r.firstRenderMs, 4),
    firstRender: r.firstRender,
  }))),
};
const problems = browserHalfProblems(browser);
if (problems.length) {
  console.error("refusing to record a browser half tools/scenario-0a.mjs would refuse (nothing was written):");
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

record.environments = [...new Set([...(record.environments ?? []), "browser"])];
record.browser = browser;
const history = Array.isArray(record.rebaselines) ? record.rebaselines : [];
record.rebaselines = [...history, chained(history,
  { reason, growth: [], recorded: history.at(-1)?.recorded, browserHalf: true, browserSha256: entryDigest(browser) })];

writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`recorded ${record.browser.variants.length} browser variant(s) into measurements/scenario-0a.json, ` +
  `history entry ${record.rebaselines.length - 1} (reason recorded)`);
