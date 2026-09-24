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
  // 2 -> 3 (2026-09-24): the code under measurement moves from the published 1.0.0-rc.1 to the
  // published 1.0.0-rc.2, the first release built and attested by `publish.yml`. The page, the
  // loader graph, the catalogs (same commit, same bytes) and every arm are unchanged; the test
  // manifest's build identity moves with the code, because rc.2 refuses rc.1's (see below).
  revision: 3,
  packRecipe: "the published npm tarball, unmodified: lokalized@1.0.0-rc.2, sha256 702833b0…, published by .github/workflows/publish.yml from d754c98 with a provenance attestation whose subject digest equals the locally verified build's",
  importRecipe: "ES module import of dist/browser/lokalized.js and dist/browser/load.js, plus their transitive chunks",
  loaderGraph: "loadStrings(manifest, 'fr') over a four-catalog manifest; requested fr, sibling fr-CA, fallback en",
  streamingLimitArm: "after the scenario and its controls, loadStrings(manifest, 'fr', { limits: { maximumInputBytes } }) twice, each on its own token: one byte under fr's manifest-declared decoded size (must refuse fr alone at stage `limit`) and at it (must load). The limit counts what the loader streams, which on a compressing host is the decoded body, so a wire-byte count would accept both",
  codeOrigin: "https://cdn.jsdelivr.net/npm/lokalized@1.0.0-rc.2/dist/browser/",
  catalogOrigin: "https://cdn.jsdelivr.net/gh/lokalized/lokalized-js@2867bff2ca8867a6fd1984aeb1a5de36c983d4d4/examples/catalogs/",
  requiredHostHeaders: Object.freeze(["timing-allow-origin", "access-control-allow-origin", "content-encoding", "cache-control"]),
  cacheState: "a cold browser HTTP cache over a warm CDN edge, which is what a first-time visitor meets. The page runs from a top-level site this browser has not visited (http://<name>.localhost:8713); Chromium keys its HTTP cache by top-level site, so that partition holds nothing for any URL here, the transitively-imported chunks included. A per-run `?0b=<run>` query additionally busts every URL the page controls. The cold-arm check VERIFIES the result per resource; DNS and connection state are not controlled, so latency is reported and never read as cold.",
  preloadState: "fr and fr-CA preloaded WITH crossorigin (CORS mode matches the loader, so reuse is expected); en preloaded WITHOUT it as the mismatch control, which must NOT be reused",
  region: "RECORDED, never pinned: a CDN answers from the edge nearest the runner and this project does not select one",
  // `tools/browser-0b/manifest.json` CARRIES THE PUBLISHED CODE'S BUILD IDENTITY, NOT THE WORKING
  // TREE'S — today 1.0.0-rc.2's, `ianaDataFingerprint` 87b3a43b… and `behavioralVectorsVersion`
  // 1.1.0 — and must be EXCLUDED from any sweep that rewrites fingerprint or version literals to
  // the current build's. The page loads the PUBLISHED package from `codeOrigin` above, and
  // `src/load/manifest.js` refuses a manifest whose identity differs from the running build's, so a
  // manifest that follows the working tree breaks the scenario the moment the two diverge. It moves
  // when a publish re-records 0b, regenerated with that release's own generator; at revision 3 only
  // those two fields changed, and the catalog fingerprint did not.
  harness: "tools/browser-0b/{serve.mjs,index.html,manifest.json}, driven in a real browser. The summary covers requests STARTED before the render returns; the controls and the streaming-limit arm start after it and are recorded but not summed",
  hostThresholds: null,
  hostThresholdsNote: "A7 declined to freeze any threshold, so plan :2861's seventh freeze item has no value. M8 clauses 84-87 therefore cannot close by running this, and nothing here should be read as meeting a number.",
});
export const recipeSha256 = sha256(JSON.stringify(RECIPE));

/**
 * EVERY REVISION'S DIGEST, FROZEN. A revision names one recipe: change the recipe and the revision
 * must move with it. The rule used to live in the RECORD alone, so deleting the record and
 * re-recording laundered a changed recipe under its old number (second review, 2026-09-24). Here it
 * survives the record. What it cannot stop is someone editing a revision's digest below along with the
 * recipe; that is a deliberate, reviewable edit to a line whose only job is not to change.
 */
export const RECIPE_DIGESTS = Object.freeze({
  2: "af65c158595cd9e1caca22dfbb108eb196075be1e1e8cd2d66570de0f2579612",
  3: "9c06237a3f5acc9eca17ff204e3fd642b0cd6c4b5680fb4e9cd59631f35ffe66",
});

/** The recipe's own consistency: its revision is known and its digest is the one frozen for it. */
export function recipeProblems() {
  const frozen = /** @type {Record<number, string>} */ (RECIPE_DIGESTS)[RECIPE.revision];
  if (frozen === undefined)
    return [`recipe revision ${RECIPE.revision} has no frozen digest in RECIPE_DIGESTS; add ${recipeSha256} for it`];
  if (frozen !== recipeSha256)
    return [`the recipe has changed (${frozen.slice(0, 12)} -> ${recipeSha256.slice(0, 12)}) while revision stayed ` +
      `${RECIPE.revision}. Bump RECIPE.revision (and freeze its digest), or put the recipe back: runs either side ` +
      "of a recipe change are not comparable."];
  return [];
}

/**
 * THE RUN MUST BE OF WHAT THE RECIPE NAMES, checked by the recorder BEFORE it writes and by the
 * checker after. The published version under measurement lives in three places — `codeOrigin`, the
 * page's `CODE` constant and the test manifest's build identity — and a review showed an rc.1
 * capture recorded under the rc.2 recipe passing. URLs are PARSED, so a path that climbs out of an
 * origin is caught, and every captured resource is examined whatever the page labelled it.
 *
 * @param {{ capture?: any, page: string, manifest: any }} run
 */
export function tieProblems({ capture, page, manifest }) {
  /** @type {string[]} */
  const problems = [];
  const code = [...page.matchAll(/\bconst\s+CODE\s*=\s*"([^"]*)"/g)];
  if (code.length !== 1)
    problems.push(`tools/browser-0b/index.html declares CODE ${code.length} time(s); exactly one is expected`);
  else if (code[0][1] !== RECIPE.codeOrigin)
    problems.push(`tools/browser-0b/index.html loads code from ${code[0][1]}, not the recipe's ${RECIPE.codeOrigin}`);
  const preloads = [...page.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\brel\s*=\s*"?preload\b/.test(tag));
  if (preloads.length !== 3)
    problems.push(`tools/browser-0b/index.html has ${preloads.length} preload(s); the recipe's preload state names three`);
  for (const tag of preloads) {
    const href = tag.match(/\bhref\s*=\s*"([^"]+)"/)?.[1] ?? "(no href)";
    if (!href.startsWith(RECIPE.catalogOrigin))
      problems.push(`tools/browser-0b/index.html preloads ${href}, which is not under the recipe's catalog origin`);
  }
  if (manifest?.baseUrl !== RECIPE.catalogOrigin)
    problems.push(`tools/browser-0b/manifest.json's baseUrl ${manifest?.baseUrl} is not the recipe's catalog origin`);
  if (!capture) return problems;

  if (capture.origins?.code !== RECIPE.codeOrigin)
    problems.push(`the capture loaded code from ${capture.origins?.code ?? "(not recorded)"}, not the recipe's ${RECIPE.codeOrigin}`);
  if (capture.origins?.catalogs !== RECIPE.catalogOrigin)
    problems.push(`the capture loaded catalogs from ${capture.origins?.catalogs ?? "(not recorded)"}, not the recipe's ${RECIPE.catalogOrigin}`);
  const href = (/** @type {string} */ url) => { try { return new URL(url).href; } catch { return null; } };
  const pageOrigin = capture.origins?.page ? new URL(capture.origins.page).origin : null;
  const blind = capture.origins?.blindControl ? href(capture.origins.blindControl) : null;
  /** @type {string[]} */
  const outside = [];
  let fromCode = 0, fromCatalogs = 0;
  for (const resource of capture.resources ?? []) {
    const at = href(resource.url);
    if (at === null) { outside.push(resource.url); continue; }
    if (new URL(at).origin === pageOrigin || at === blind) continue;
    if (at.startsWith(RECIPE.codeOrigin)) fromCode += resource.phase === "scenario" ? 1 : 0;
    else if (at.startsWith(RECIPE.catalogOrigin)) fromCatalogs += resource.phase === "scenario" ? 1 : 0;
    else outside.push(resource.url);
  }
  if (outside.length > 0)
    problems.push(`${outside.length} captured resource(s) came from neither recipe origin nor the page's own, e.g. ${outside[0]}`);
  if (fromCode === 0) problems.push("no scenario resource came from the recipe's code origin, so the code under measurement was not observed");
  if (fromCatalogs === 0) problems.push("no scenario resource came from the recipe's catalog origin");
  return problems;
}

/** What a record binds itself to: the page and manifest bytes the run was taken with. */
export const harnessDigests = (/** @type {string} */ page, /** @type {string} */ manifest) =>
  ({ page: sha256(page), manifest: sha256(manifest) });
