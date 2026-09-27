// @ts-check
/**
 * Scenario 0b's frozen recipe, in its own module because TWO tools need it and a second copy would
 * drift — `tools/graph-walk.mjs`'s reasoning. The first version of the recorder reached into the
 * check's SOURCE and `eval`'d the literal out of it, which is both fragile and the exact shape this
 * project bans under `src/`. This module says what the scenario IS; `tools/0b-checks.mjs` holds the
 * checks both tools apply to a run of it.
 */
import { createHash } from "node:crypto";
import { entryDigest } from "./ratchet-chain.mjs";

const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/**
 * THE FROZEN RECIPE — plan :2860-2862: "scenario 0b freezes its exact pack/import recipe, loader
 * graph, origin/CDN and headers, cache/preload state, region, harness, and host thresholds".
 *
 * Every field is part of the scenario's IDENTITY: change one and the runs either side are not
 * comparable, which is what `revision` exists to say. The digest is taken over this declared object
 * and not over this file, so a comment here does not invalidate a measurement. The HARNESS is the
 * exception, frozen by the digest of its files (`harnessMethodSha256`), because a harness is its
 * source — plan :2789 asks for "harness source and command hashes".
 *
 * **THE SEVENTH ITEM, `hostThresholds`, IS A RATCHET RATHER THAN A NUMBER.** A4 restated 0b's go/no-go
 * thresholds as "recorded and ratcheted", and A7 extended the maintainer's M7 wording — "recorded,
 * ratcheted where a ratchet exists, reported where none does" — to every M8 threshold rather than
 * freeze a number (restated for M8 clauses 84-89 as A33, 2026-09-25, which adds no new waiver).
 * Revisions 1-3 carried the item as `null` with a note saying the clauses could not close by running
 * this; from revision 4 the policy itself is declared here, inside the digest, and the tools READ their
 * ratcheted and reported lists from it, so those lists are the revision's. The CHECKS that apply them
 * are code in `tools/0b-checks.mjs`, outside every digest: tightening or loosening one is an edit
 * reviewed as one, and no revision records it. Clause 82's own restatement of the seven items omits
 * this one; this does not.
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
  // 3 -> 4 (2026-09-25): THREE CHANGES, EACH ONE plan :2795-2797 SAYS IS A NEW REVISION.
  //   - The THRESHOLD: `hostThresholds` gets its value, the ratchet above.
  //   - The METHOD: the mismatched preload's own entry — a harness control a real visitor never sends,
  //     opaque, every size withheld — was counted as revision 3's twelfth request and summed as zero
  //     bytes. It is summed nowhere now, as revision 2 did for the second-load control; the page labels
  //     it and the checker derives the same exclusion from the page's markup. The same capture
  //     re-derives under this method as 11 requests and unchanged bytes. The page counts its preload
  //     control at capture time, over the entries that started before the render, where revisions 1-3
  //     counted it the instant the render returned, when an entry still being buffered could be missed
  //     and a run refused for a control that had in fact discriminated: simulated with every fetch's
  //     entry buffered 30 ms late, that placement reads the mismatched preload's two entries as one, and
  //     this one reads both. And four holes a review of this change found are closed in the method: the
  //     page records the render's return and each entry's start unrounded, so `phase` is recomputed
  //     rather than read; the cold arm requires every counted transfer to EXCEED its encoded body, where
  //     a zero alone was read as a hit; the page records the bytes the second load returned, because its
  //     missing entry is read as a cache hit; and the blind control is the page's own `BLIND`, where the
  //     capture used to name it.
  //   - The ARTIFACT-IDENTITY RULE: the published VERSION leaves the recipe for `SUBJECT` below,
  //     because :2794-2795 says "a new implementation digest identifies a new run without redefining
  //     the scenario". Revision 3 was cut for nothing but rc.1 -> rc.2; under that practice every
  //     release started a new history and the ratchet could never compare two releases, the one
  //     comparison it exists for. What stays frozen is HOW a version is measured. Each run instead
  //     records what :2794 asks a run attestation to record — "the actual tarball, output-graph …
  //     hashes" — measured by the recorder: the registry's integrity for the version, the tarball's
  //     sha256, and the published module graph read out of that tarball, which the run's request
  //     count and decoded bytes must equal.
  revision: 4,
  packRecipe: "the published npm tarball of SUBJECT's version, unmodified, as the code origin serves it. Each run records the npm registry's integrity for that version, the sha256 of the registry's tarball verified against that integrity, and the module graph the tarball's dist/browser/ holds from the two entry points, each module at its size in the tarball",
  importRecipe: "ES module import of dist/browser/lokalized.js and dist/browser/load.js, plus their transitive chunks",
  loaderGraph: "loadStrings(manifest, 'fr') over a four-catalog manifest; requested fr, sibling fr-CA, fallback en",
  // The loader graph above, in the form a check holds a capture to. The ENTRY POINTS are the two
  // modules the page imports; the chunks they import are the published build's to decide, so they are
  // named by nothing here and read, per run, from the subject's verified tarball. The CATALOGS are the
  // three `loadStrings(manifest, 'fr')` plans, each at the size the manifest declares. A run counts
  // exactly those resources, each once and each at its size — so its request count and decoded bytes
  // are its version's, and a lost chunk or a doubled request is refused rather than read as a smaller
  // or a larger figure.
  requiredResources: Object.freeze({
    entryPoints: Object.freeze(["lokalized.js", "load.js"]),
    catalogs: Object.freeze(["fr.json", "fr-CA.json", "en.json"]),
  }),
  // FIRST USABLE RENDER ASSERTS WHAT WAS RENDERED. The expected string is what the page renders from
  // the commit-pinned catalogs; revisions 2 and 3 both recorded it. A raw key coming back is the
  // failure this catches — what M-D S26 measured happening for French at 1,000,000.
  render: Object.freeze({ locale: "fr", key: "Cart.Items", values: Object.freeze({ count: 3 }), expected: "Votre panier contient 3 livres." }),
  streamingLimitArm: "after the scenario and its controls, loadStrings(manifest, 'fr', { limits: { maximumInputBytes } }) twice, each on its own token: one byte under fr's manifest-declared decoded size (must refuse fr alone at stage `limit`) and at it (must load). The limit counts what the loader streams, which on a compressing host is the decoded body, so a wire-byte count would accept both",
  codeOriginRule: "https://cdn.jsdelivr.net/npm/lokalized@<version>/dist/browser/",
  catalogOrigin: "https://cdn.jsdelivr.net/gh/lokalized/lokalized-js@2867bff2ca8867a6fd1984aeb1a5de36c983d4d4/examples/catalogs/",
  requiredHostHeaders: Object.freeze(["timing-allow-origin", "access-control-allow-origin", "content-encoding", "cache-control"]),
  cacheState: "a cold browser HTTP cache over a warm CDN edge, which is what a first-time visitor meets. The page runs from a top-level site this browser has not visited (http://<name>.localhost:8713); Chromium keys its HTTP cache by top-level site, so that partition holds nothing for any URL here, the transitively-imported chunks included. A per-run `?0b=<run>` query additionally busts every URL the page controls. The cold-arm check VERIFIES the result per resource; DNS and connection state are not controlled, so latency is reported and never read as cold.",
  preloadState: "fr and fr-CA preloaded WITH crossorigin (CORS mode matches the loader, so reuse is expected); en preloaded WITHOUT it as the mismatch control, which must NOT be reused. The mismatch control's own entry is a harness arm, never a scenario request, and is summed in no figure",
  region: "RECORDED, never pinned: a CDN answers from the edge nearest the runner and this project does not select one",
  browser: "RECORDED, never pinned: each run keeps its user agent on its history entry. Pinning one would make every browser update a new revision; a ratcheted figure that a browser change moves — its per-response transfer accounting, since the graph fixes the rest — is recorded with its reason like any other growth",
  // `tools/browser-0b/manifest.json` CARRIES THE PUBLISHED CODE'S BUILD IDENTITY, NOT THE WORKING
  // TREE'S — today 1.0.0-rc.2's, `ianaDataFingerprint` 87b3a43b… and `behavioralVectorsVersion`
  // 1.1.0 — and must be EXCLUDED from any sweep that rewrites fingerprint or version literals to
  // the current build's. The page loads the PUBLISHED package of `SUBJECT` below, and
  // `src/load/manifest.js` refuses a manifest whose identity differs from the running build's, so a
  // manifest that follows the working tree breaks the scenario the moment the two diverge. It moves
  // when `SUBJECT` moves, regenerated with that release's own generator; at revision 3 only two of
  // the seven identity fields changed, and the catalog fingerprint did not. Those seven fields are
  // therefore the part of the manifest `harnessMethodSha256` leaves out.
  harness: "tools/browser-0b/{serve.mjs,index.html,manifest.json}, driven in a real browser. The summary covers requests STARTED before the render returns, less the mismatched preload's own entry; the other controls and the streaming-limit arm start after it and are recorded but not summed. harnessMethodSha256 freezes all three files: the page with its CODE constant normalized and the manifest without its seven build-identity fields, because those two follow SUBJECT, and serve.mjs whole",
  harnessMethodSha256: Object.freeze({
    page: "c0c536dbcc7e6760583df8c4a911d4e0a5b5830c615f4dbb9dd3f0afb284e213",
    manifestFixture: "f8073e9df923ff45c974abdd003e888310838385b808d15559de8773e1aaa65f",
    server: "a682139403318050e2a609abb37292e58c0a938b26939cdeb6c9eff088edc195",
  }),
  hostThresholds: Object.freeze({
    rule: "A RATCHET, NOT A NUMBER — A4 and A7 (restated as A33, 2026-09-25): recorded, ratcheted where a ratchet exists, reported where none does. Each run of this revision is compared with the run before it in the record's history and with the last run of its own version; a ratcheted figure that grew over either is recorded only with a stated reason, kept on that run; a reported figure must be present and is never compared. Every run's request count and decoded bytes must also EQUAL its version's published graph and the manifest's planned catalogs, an exit term, so within one version those two cannot move at all, and between versions they move only as the published files do",
    ratcheted: Object.freeze(["requestCount", "decodedBytes", "encodedBytes", "transferBytes"]),
    // THE FOUR RATCHET; ONLY TWO ARE THE HOST'S. Request count and decoded bytes are functions of the
    // version's files, the commit-pinned catalogs and the frozen method, and the `graph` invariant below
    // holds every run to them: revision 3's capture, re-derived under this method, counts rc.2's 8
    // browser files — the modules `lokalized.js` and `load.js` reach in the tarball, 184,494 + 178,080
    // bytes — and the 3 planned catalogs (909 + 876 + 839): 11 requests, 365,198 decoded, to the byte.
    // Encoded and transfer bytes are the host's compression and the browser's accounting, and may fall
    // freely; a rise in them, or in the other two at a release, is what a reason is asked for.
    reported: Object.freeze(["firstUsableRenderMs", "coldImportMs", "loadMs"]),
    // EXIT TERMS AT THEIR CEILING, not ratchets: a run where one slips is not a worse run, it is a run
    // whose figures cannot be read, so no reason admits it. `tools/0b-checks.mjs` enforces each with
    // several checks, and `test/scenario-0b.test.js` attacks each check with an input it exists for
    // and requires every key below to be attacked. How far that reaches — whether the test goes red when
    // a check is deleted, or a condition in one is weakened — is measured only by ablating the code, which
    // the test cannot do to itself; its header says what the last sweeps found.
    invariants: Object.freeze({
      figures: "the four figures re-derived from the capture's resources, which requests are the scenario's re-derived from each one's start and the render's return, and the page's own summary and labels equal to that derivation",
      graph: "the counted resources exactly the subject's published graph from the two entry points, each module once at its size in the tarball, and the three planned catalogs, each once at the manifest's declared size — on every run, the request count and decoded bytes equal to that graph's",
      readable: "every counted resource readable",
      preload: "each matched preload one entry, the mismatched preload two or more",
      secondLoad: "the second load of fr served from the browser cache, having read fr's bytes",
      blind: "the page's own declared blind control, one entry, cross-origin, reading 0 bytes",
      coldArm: "every readable counted resource crossed the network: its transfer exceeds its encoded body, and it is never a cache delivery",
      streamingLimit: "two arms: fr refused alone by the loader at stage limit one byte under its decoded size, and loaded at it, with its wire size under the refused limit",
      render: "the render equal to render.expected, never the key, with all three timings finite, positive and consistent with each other and with the clock the render returned on",
      host: "every required host header present on both probes, each probe's stated length the capture's encoded size for the same file, the code pinned to a version and the catalogs to a commit",
      subject: "the run's version published, its registry integrity verified against the tarball, its graph read from that tarball, and one version never recorded with two digests or two graphs",
    }),
  }),
});
export const recipeSha256 = sha256(JSON.stringify(RECIPE));

/**
 * WHAT IS MEASURED, AS OPPOSED TO HOW — outside the recipe and its digest on purpose (plan
 * :2794-2795). A publish moves it, together with the page's `CODE` constant and the test manifest's
 * seven build-identity fields, and the next run is compared with the last one under the SAME revision:
 * that comparison is what makes a release that grows the download answer for it.
 *
 * **ONLY THE VERSION IS DECLARED.** The tarball's digests and its module graph are MEASURED by the
 * recorder from the npm registry and kept on each run. A digest typed here would look like a
 * measurement and be checked by nothing — the revision-4 draft carried one, and a review found it read
 * in exactly one place, the line that copied it into every run.
 */
export const SUBJECT = Object.freeze({ version: "1.0.0-rc.2" });

/** Where the code of one published version is served from, by the recipe's rule. */
export const codeOriginFor = (/** @type {string} */ version) => RECIPE.codeOriginRule.replace("<version>", version);

/** The page's one `CODE` declaration — the code origin it imports from, which follows `SUBJECT`. */
export const CODE_DECLARATION = /(\bconst\s+CODE\s*=\s*")([^"]*)(")/g;

/** The manifest fields that follow the published build rather than the scenario (see `harness`). */
export const BUILD_IDENTITY_FIELDS = Object.freeze(["cldrVersion", "dataFingerprint", "behavioralVectorsVersion",
  "localeDataMode", "cardinalityMode", "ianaRegistryDate", "ianaDataFingerprint"]);

/**
 * THE HARNESS WITH WHAT FOLLOWS `SUBJECT` TAKEN OUT, so its digest moves only when the method does.
 * The manifest is digested over sorted keys, so regenerating it with a release's own generator — which
 * may write keys in another order — is not mistaken for a new fixture; `serve.mjs` is digested whole.
 * @param {{ page: string, manifestText: string, server: string }} files
 */
export function methodDigests({ page, manifestText, server }) {
  /** @type {unknown} */
  let manifest = null;
  try { manifest = JSON.parse(manifestText); } catch { /* reported as a null digest, which matches nothing */ }
  return {
    page: sha256(page.replace(CODE_DECLARATION, "$1<subject>$3")),
    manifestFixture: manifest && typeof manifest === "object" && !Array.isArray(manifest)
      ? entryDigest(Object.fromEntries(Object.entries(manifest).filter(([key]) => !BUILD_IDENTITY_FIELDS.includes(key))))
      : null,
    server: sha256(server),
  };
}

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
  4: "41bf3f32a25caffaaab811637a4d6cbfd74ce01f584d2f9428ae34b5a2ac8ae5",
});

/**
 * THE FIRST RUN OF EACH REVISION'S HISTORY, FROZEN — `RECIPE_DIGESTS`'s reasoning one level down,
 * through `tools/ratchet-chain.mjs`. A history that lives only in its record can be deleted and started
 * again from a grown run, which then has nothing to be compared with; freezing where the chain starts
 * means the whole chain survives the record. The recorder prints the line to add when it records a
 * revision's first run, and until the line is here the checker fails naming it, and the recorder
 * refuses to append a second run. Revisions 1-3 have none: they predate the history. When a new
 * revision's first run replaces a record, the replaced revision's last run is carried into the record's
 * `priorRevisions` as context, never as a baseline — so revision 4's will hold revision 3's run, and
 * revision 2's lives in git alone. Every run binds that list by its digest, so freezing the first run
 * freezes the list too; what it holds is what the replaced record gave it. A record deleted before a
 * revision's first run would give it nothing, so the recorder refuses that first run whenever an earlier
 * revision's first run is frozen here, over a record older than that revision too, and over a record that
 * is not its revision's history as this table and `HISTORY_CHECKPOINTS` freeze it: a new revision starts
 * from the committed record.
 */
export const HISTORY_ORIGINS = Object.freeze(/** @type {Record<number, string>} */ ({
  // One line per revision, exactly as tools/browser-0b/record.mjs prints it for the revision's first run.
  4: "c459d02c8ea97768ec5afb6825fd6e276ba31dd5e7009c67ef7d7f29dad17403",
}));

/**
 * EACH REVISION'S HISTORY, FROZEN THROUGH ITS NEWEST RUN — `tools/ratchet-chain.mjs`'s `frozenThrough`,
 * GATED the way `tools/scenarios-1-5/check.mjs` gates `HISTORY_NEWEST_ENTRY`. The origin pins the first
 * run; the chain cannot see its own END, so without this the record rolled back from git to any earlier
 * state is a valid chain, and the next run is compared with an older baseline — a review measured a
 * release run of 11 requests recorded with no reason against a rolled-back record, where the true latest
 * run, at 10, refused it — and a run after the checkpoint could have its reason rewritten and every later
 * link recomputed (measured passing, 2026-09-26). `history[index]` must exist and have `sha256`, which pins
 * every run up to it, and `index` must be the NEWEST run: the checker fails until it is, naming the line to
 * set, and the recorder will not append to a record whose newest run is not frozen here. So every recorded
 * run is followed by an edit of this table in source, like the origin, and nothing in the history is held
 * by the chain alone.
 */
export const HISTORY_CHECKPOINTS = Object.freeze(/** @type {Record<number, { index: number, sha256: string }>} */ ({
  // One line per revision, exactly as tools/scenario-0b.mjs and tools/browser-0b/record.mjs print it.
  4: { index: 0, sha256: "c459d02c8ea97768ec5afb6825fd6e276ba31dd5e7009c67ef7d7f29dad17403" },
}));

/**
 * THE RUNS RECORDED BEFORE A RUN CARRIED ITS CAPTURE'S TIMINGS, by revision: for each of those first runs,
 * in order, the digest `timingsOf` in `tools/0b-checks.mjs` gives its capture. From revision 4's second run
 * every history entry carries it as `timingsSha256`, so a capture replayed under a new token and a new
 * site — the same starts and durations, relabelled — is refused as the run it already is (a review
 * recorded r4a-1's capture again as "r4z-1", 2026-09-26). Revision 4's first run was frozen in
 * `HISTORY_ORIGINS` before that field existed and cannot gain it without breaking its digest, so its
 * capture's digest is frozen here instead: the checker holds the record's capture to it while that run is
 * the newest, and both tools refuse a later run that repeats it after its capture has left the record.
 */
export const HISTORY_UNTIMED = Object.freeze(/** @type {Record<number, readonly string[]>} */ ({
  4: Object.freeze(["12e9b16f0b751c9cc087179eb293b09d8e19c1fbc64b692d3887d834fc805599"]),
}));

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
