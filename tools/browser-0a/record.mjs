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
 *   node tools/browser-0a/record.mjs <root.json> <core.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const path = resolve(root, "measurements/scenario-0a.json");
const record = JSON.parse(readFileSync(path, "utf8"));

const captures = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, "utf8")));
if (captures.length === 0) { console.error("usage: record.mjs <capture.json>..."); process.exit(2); }

const agents = new Set(captures.map((c) => c.userAgent));
if (agents.size !== 1) throw new Error(`captures come from ${agents.size} different browsers; 0a records one`);

record.environments = [...new Set([...(record.environments ?? []), "browser"])];
record.browser = {
  userAgent: [...agents][0],
  transferCompression: "none — the harness server does not compress; section 9.2's gzip/brotli ceilings are a separate measure",
  memoryKind: captures[0].memoryKind,
  note: "One variant per page load: measuring both in one document leaves the second with a warm module cache and zero cold-import, resource and transfer figures.",
  variants: captures.flatMap((c) => c.rows.map((r) => ({
    label: r.label,
    resources: r.resources,
    encodedBytes: r.encodedBytes,
    decodedBytes: r.decodedBytes,
    coldImportMs: Number(r.coldImportMs.toFixed(1)),
    importMs: Number(r.importMs.toFixed(3)),
    constructionMs: Number(r.constructionMs.toFixed(4)),
    firstRenderMs: Number(r.firstRenderMs.toFixed(4)),
    firstRender: r.firstRender,
  }))),
};

writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`recorded ${record.browser.variants.length} browser variant(s) into measurements/scenario-0a.json`);
