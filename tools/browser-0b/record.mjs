#!/usr/bin/env node
// @ts-check
/**
 * Merges a scenario 0b browser capture into `measurements/scenario-0b.json`.
 *
 * **THE HOST'S OWN RESPONSE FACTS ARE GATHERED HERE, NOT IN THE PAGE**, because a browser cannot
 * read `content-encoding` on a cross-origin response — it is not among the CORS-safelisted headers
 * — and "the host's actual content encoding" is one of the six things plan :2812 requires 0b to
 * record. So this fetches them from Node at record time and carries them in the artifact, which is
 * also what keeps `scenario:0b` free of the network.
 *
 * Plan :2826 is the reason both halves are kept: the decision "uses the actual-host transfer/latency
 * threshold, not merely the observed content-encoding LABEL". The label is `br` here and so is the
 * repo's own; the byte counts are 18% apart, and only the numbers show that.
 *
 *   node tools/browser-0b/record.mjs <capture.json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPE, harnessDigests, recipeProblems, recipeSha256, tieProblems } from "../0b-recipe.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const [capturePath] = process.argv.slice(2);
if (!capturePath) { console.error("usage: record.mjs <capture.json>"); process.exit(2); }

const capture = JSON.parse(readFileSync(capturePath, "utf8"));

// NOTHING IS WRITTEN FROM A RUN THE CHECKER WOULD REFUSE, and every refusal comes before the network.
// The recipe must be the one frozen for its revision (tools/0b-recipe.mjs), an existing record at a
// LATER revision means this checkout is behind what was measured, and the capture, page and manifest
// must be of what the recipe names.
const recordPath = join(root, "measurements/scenario-0b.json");
const page = readFileSync(join(here, "index.html"), "utf8");
const manifestText = readFileSync(join(here, "manifest.json"), "utf8");
const refusals = [...recipeProblems(), ...tieProblems({ capture, page, manifest: JSON.parse(manifestText) })];
if (existsSync(recordPath)) {
  const was = JSON.parse(readFileSync(recordPath, "utf8")).recipe?.revision;
  if (typeof was === "number" && was > RECIPE.revision)
    refusals.push(`the existing record is revision ${was}, newer than this recipe's ${RECIPE.revision}`);
}
if (refusals.length > 0) {
  console.error("refusing to record:\n" + refusals.map((r) => `  - ${r}`).join("\n"));
  process.exit(1);
}

/** The host facts a browser cannot see. Fetched from the same URLs the capture measured. */
const probe = async (/** @type {string} */ url) => {
  const response = await fetch(url, { headers: { "accept-encoding": "br, gzip" } });
  await response.arrayBuffer();
  return Object.fromEntries(["content-encoding", "timing-allow-origin", "access-control-allow-origin",
    "cache-control", "x-jsd-version-type"].map((h) => [h, response.headers.get(h)]));
};
const codeHeaders = await probe(RECIPE.codeOrigin + "lokalized.js");
const catalogHeaders = await probe(RECIPE.catalogOrigin + "fr.json");

const record = {
  formatVersion: 1,
  note: "Scenario 0b, measured against the real production host. REPORTED, never thresholded — A7 " +
    "declined to freeze any, so this cannot close M8 clauses 84-87. Re-checked by tools/scenario-0b.mjs, " +
    "which touches no network.",
  recipe: RECIPE,
  recipeSha256,
  // The page and manifest this run was taken with, so a later edit to either reads as a stale record.
  harnessSha256: harnessDigests(page, manifestText),
  hostPreconditions: {
    contentEncoding: codeHeaders["content-encoding"],
    code: codeHeaders,
    catalogs: catalogHeaders,
    // The catalog origin must be pinned to a COMMIT, not a branch: a branch ref would let the bytes
    // under a recorded measurement change without the record noticing.
    catalogsPinnedToCommit: catalogHeaders["x-jsd-version-type"] === "commit",
  },
  capture,
};
if (!record.hostPreconditions.catalogsPinnedToCommit)
  console.error("WARNING: the catalog origin did not report x-jsd-version-type: commit");

writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
console.log(`recorded measurements/scenario-0b.json (recipe ${recipeSha256.slice(0, 12)}, host encoding ${record.hostPreconditions.contentEncoding})`);
