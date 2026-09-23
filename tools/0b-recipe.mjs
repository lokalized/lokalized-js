// @ts-check
/**
 * Scenario 0b's frozen recipe, in its own module because TWO tools need it and a second copy would
 * drift — `tools/graph-walk.mjs`'s reasoning. The first version of the recorder reached into the
 * check's SOURCE and `eval`'d the literal out of it, which is both fragile and the exact shape this
 * project bans under `src/`.
 */
import { createHash } from "node:crypto";

const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/**
 * THE FROZEN RECIPE — plan :2860-2861: "scenario 0b freezes its exact pack/import recipe, loader
 * graph, origin/CDN and headers, cache/preload state, region, harness, and host thresholds".
 *
 * Every field is part of the scenario's IDENTITY: change one and the runs either side are not
 * comparable, which is what `revision` exists to say. The digest is taken over this declared object
 * and not over the file, so a comment does not invalidate a measurement.
 *
 * **ONE ITEM OF THE PLAN'S SEVEN IS ABSENT AND IT IS NAMED RATHER THAN DROPPED**: `hostThresholds`.
 * A7 declined to freeze any threshold. Clause 82's own restatement of this list silently omits the
 * item; this does not.
 */
export const RECIPE = Object.freeze({
  // 1 -> 2 (2026-09-22): no valid revision-1 record exists — its only run was contaminated — so
  // nothing is orphaned. Changed: how the cold arm is reached (a fresh top-level site, not a cold
  // profile), which requests count as the scenario's (controls were summed in), and the
  // streaming-limit arm plan :2813 names and revision 1 did not have.
  revision: 2,
  packRecipe: "the published npm tarball, unmodified: lokalized@1.0.0-rc.1, sha256 dbe58b36…, verified byte-identical to the locally gated build",
  importRecipe: "ES module import of dist/browser/lokalized.js and dist/browser/load.js, plus their transitive chunks",
  loaderGraph: "loadStrings(manifest, 'fr') over a four-catalog manifest; requested fr, sibling fr-CA, fallback en",
  streamingLimitArm: "after the scenario and its controls, loadStrings(manifest, 'fr', { limits: { maximumInputBytes } }) twice, each on its own token: one byte under fr's manifest-declared decoded size (must refuse fr alone at stage `limit`) and at it (must load). The limit counts what the loader streams, which on a compressing host is the decoded body, so a wire-byte count would accept both",
  codeOrigin: "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.1/dist/browser/",
  catalogOrigin: "https://cdn.jsdelivr.net/gh/lokalized/lokalized-js@2867bff2ca8867a6fd1984aeb1a5de36c983d4d4/examples/catalogs/",
  requiredHostHeaders: Object.freeze(["timing-allow-origin", "access-control-allow-origin", "content-encoding", "cache-control"]),
  cacheState: "a cold browser HTTP cache over a warm CDN edge, which is what a first-time visitor meets. The page runs from a top-level site this browser has not visited (http://<name>.localhost:8713); Chromium keys its HTTP cache by top-level site, so that partition holds nothing for any URL here, the transitively-imported chunks included. A per-run `?0b=<run>` query additionally busts every URL the page controls. The cold-arm check VERIFIES the result per resource; DNS and connection state are not controlled, so latency is reported and never read as cold.",
  preloadState: "fr and fr-CA preloaded WITH crossorigin (CORS mode matches the loader, so reuse is expected); en preloaded WITHOUT it as the mismatch control, which must NOT be reused",
  region: "RECORDED, never pinned: a CDN answers from the edge nearest the runner and this project does not select one",
  // `tools/browser-0b/manifest.json` CARRIES 1.0.0-rc.1's BUILD IDENTITY ON PURPOSE —
  // `ianaDataFingerprint` 42a658b3… and `behavioralVectorsVersion` 1.0.0 — and must be EXCLUDED from
  // any sweep that rewrites fingerprint or version literals to this build's. The page loads the
  // PUBLISHED rc.1 from `codeOrigin` above, and `src/load/manifest.js` refuses a manifest whose
  // identity differs from the running build's, so rewriting it to amendment A30's 87b3a43b… would make
  // the published code refuse it and break the scenario. It moves when the next publish re-records 0b.
  harness: "tools/browser-0b/{serve.mjs,index.html,manifest.json}, driven in a real browser. The summary covers requests STARTED before the render returns; the controls and the streaming-limit arm start after it and are recorded but not summed",
  hostThresholds: null,
  hostThresholdsNote: "A7 declined to freeze any threshold, so plan :2861's seventh freeze item has no value. M8 clauses 84-87 therefore cannot close by running this, and nothing here should be read as meeting a number.",
});
export const recipeSha256 = sha256(JSON.stringify(RECIPE));
