#!/usr/bin/env node
// @ts-check
/**
 * Records one scenario 0b browser run: appends it to its recipe revision's history in
 * `measurements/scenario-0b.json`, or starts that revision's history.
 *
 * **EACH RUN IS COMPARED WITH THE ONE BEFORE IT, AND WITH ITS VERSION'S LAST RUN.** The four ratcheted
 * figures the recipe's `hostThresholds` names — requests, decoded, encoded and transfer bytes, all
 * re-derived from the capture's resources — may grow over either only with `--reason`, and the reason
 * is kept on that run's line.
 * `grew` is computed here and recomputed by the checker, never supplied. The request count and decoded
 * bytes must moreover EQUAL the subject's published graph, read below from its tarball, and the planned
 * catalogs — an exit term no reason admits, so within one version those two cannot move, and a lost or
 * doubled resource is refused: before the network when the history has measured the version already,
 * against its last run, and after it otherwise, against the tarball. The timings are reported: required
 * present, never compared. Earlier revisions are kept in `priorRevisions` as context and are never
 * compared (plan :2796-2797); a new revision starts a new history — from the committed record, its
 * revision's history exactly as `HISTORY_ORIGINS` and `HISTORY_CHECKPOINTS` freeze it, whose last run it
 * keeps as that context along with every run's timeline, and with `--reason` saying why the revision was
 * cut, because its first run is compared with nothing. A revision that changes nothing but its number is
 * refused outright.
 *
 * **NOTHING IS WRITTEN THAT THE CHECKER WOULD REFUSE, BUT FOR THE LINES THAT FREEZE IT.** The checks in
 * `tools/0b-checks.mjs` that need no network — the recipe and whether it is only a renumber, the
 * harness, the capture's figures, labels and summary, its controls, cold arm, streaming-limit arm,
 * render and timings, and the existing record's own validity, recipe and frozen newest run — and the
 * ratchet's own rules for the new run — the run's, the site's and the timeline's uniqueness, a version
 * already measured counting other than its last run, growth without a reason, a new revision started
 * from no record, from a record that is not its revision's frozen history, or without a reason — refuse
 * BEFORE anything is fetched. After the registry and host
 * facts are fetched, `checkRecord`, the checker's whole verdict, runs over the exact object about to be
 * written, and any problem refuses it; that is also where what only the finished record shows is judged:
 * the capture against the version's published graph, the probes against the capture's bytes, the
 * version's digests against earlier runs.
 * The exceptions are the lines only the written run can supply: the checkpoint that freezes it in
 * `HISTORY_CHECKPOINTS`, and on a new revision's first run the digest `HISTORY_ORIGINS` freezes. Both are
 * printed, and the checker fails naming each until it is set — so every recorded run is reviewed into
 * source before the next can be appended. This header used to claim no exception at all, and two reviews
 * measured it false — a warm run, a run whose mismatched preload reported reuse, and a capture with no
 * render were each recorded at exit 0.
 *
 * **THE HOST'S OWN RESPONSE FACTS ARE GATHERED HERE, NOT IN THE PAGE**, because a browser cannot
 * read `content-encoding` on a cross-origin response — it is not among the CORS-safelisted headers
 * — and "the host's actual content encoding" is one of the things plan :2813 requires 0b to record.
 * So this fetches them from Node at record time, records WHAT was probed (each URL and every header
 * asked for, `null` where none came back), and carries them in the artifact, which is also what keeps
 * `scenario:0b` free of the network. Plan :2826 is the reason both halves are kept: the decision "uses the actual-host
 * transfer/latency threshold, not merely the observed content-encoding LABEL". The label is `br`
 * here and so is the repo's own; jsDelivr served revision 3's `lokalized.js` in 64,728 bytes, where
 * Node's quality-11 brotli of the same 184,494 (`measurements/release-rehearsal.json`) is 54,979 —
 * 17.7% larger — and only the numbers show that.
 *
 * **THE SUBJECT'S DIGESTS AND GRAPH ARE MEASURED, NOT DECLARED.** Plan :2794 wants each run to record
 * "the actual tarball, output-graph … hashes". This reads `SUBJECT.version`'s document from the public
 * npm registry, fetches the tarball it names (only from the registry's own tarball path), refuses
 * unless its sha512 is the registry's `dist.integrity`, and records that integrity, the tarball's
 * sha256, and the module graph its `dist/browser/` holds from the recipe's two entry points — walked by
 * `tools/graph-walk.mjs`, the shared walker whose own guard throws on an import spelling it does not
 * recognise — each module at its size in the tarball. The checker then holds every run to one subject
 * per version, because a published version never changes, and the capture to exactly that graph.
 *
 * THE PROCEDURE, in outline (the scenario is only as cold as its site is new):
 *   0. preflight, spending nothing: `node tools/browser-0b/simulate.mjs <out.json>` runs the page's own
 *      script in Node and prints the checks' verdict on its output, which must be "no problems";
 *   1. add a launch entry for `node lokalized-js/tools/browser-0b/serve.mjs` whose url is a
 *      NEVER-VISITED site, `http://zb-<name>.localhost:8713`, and start it; the bare origin measures
 *      nothing, by design (`serve.mjs` refuses to run the page without `?run=`);
 *   2. warm the jsDelivr edge from Node — fetch every code and catalog URL once — because the recipe
 *      measures a cold BROWSER cache over a warm EDGE;
 *   3. load `http://zb-<name>.localhost:8713/?run=<token>` once; the page POSTs its capture to
 *      `tools/browser-0b/capture.json` (gitignored — the input, not the record);
 *   4. node tools/browser-0b/record.mjs tools/browser-0b/capture.json [--reason "what grew and why"]
 *   5. review the record's diff, then set the printed line in `HISTORY_CHECKPOINTS` in `tools/0b-recipe.mjs`,
 *      which pins every run so far — and on a revision's first run also add the printed line to
 *      `HISTORY_ORIGINS`; until they are set the checker fails, and this refuses to append another run;
 *   6. npm run scenario:0b.
 *
 *   node tools/browser-0b/record.mjs <capture.json> [--reason "what grew and why"] [--record <path>]
 *
 * `--record` names another record to append to (default `measurements/scenario-0b.json`), so a run
 * can be tried against a copy first.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { graphBytes } from "../graph-walk.mjs";
import { chainProblems, chained, checkpointOf, entryDigest } from "../ratchet-chain.mjs";
import { HISTORY_CHECKPOINTS, HISTORY_ORIGINS, HISTORY_UNTIMED, RECIPE, SUBJECT, codeOriginFor, recipeProblems, recipeSha256 }
  from "../0b-recipe.mjs";
import { PROBED_HEADERS, RATCHETED, RECORD_NAME, REPORTED, captureProblems, checkRecord, checkpointLine, deriveCapture, grewOver,
  growthOver, harnessBinding, harnessProblems, readHarness, recordProblems, renumberProblems, runOf, siteOf, timingsOf,
  versionFigureProblems } from "../0b-checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

export const NOTE = "Scenario 0b, measured against the real production host. RECORDED AND RATCHETED, never " +
  "thresholded — A4 and A7 (restated as A33, 2026-09-25): each run of a revision is compared with the run " +
  "before it in `history` and with its version's last run, a ratcheted figure that grew carries its reason there, " +
  "every run's request count and decoded bytes are its version's published graph, and the timings are reported, " +
  "never compared. Re-checked by tools/scenario-0b.mjs, which touches no network.";

const REGISTRY = "https://registry.npmjs.org/lokalized/";
/** Where a published tarball keeps the browser build the code origin serves. */
const BROWSER_BUILD = "package/dist/browser/";

const pick = (/** @type {any} */ from, /** @type {readonly string[]} */ fields) =>
  Object.fromEntries(fields.map((f) => [f, from?.[f] ?? null]));
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * An earlier revision's last run, kept as CONTEXT: its figures as THAT revision's method summed them
 * (revision 3's summary counted the mismatch control as its twelfth request), marked incomparable. It also
 * keeps the TIMELINE of every run the replaced record holds — each run's `timingsSha256`, the ones frozen in
 * `HISTORY_UNTIMED` for runs that predate it, or for a record with no history its capture's — because those
 * captures leave the record here, and a run replayed after them would otherwise be new to it.
 * @param {any} record @param {Record<number, readonly string[]>} untimed
 */
const priorFrom = (record, untimed) => {
  /** @type {any[]} */
  const history = record.formatVersion === 2 && Array.isArray(record.history) ? record.history : [];
  const last = history.at(-1) ?? null;
  const frozen = untimed[record.recipe?.revision] ?? [];
  const timings = history.length > 0 ? history.map((entry, i) => (i < frozen.length ? frozen[i] : entry?.timingsSha256))
    : Array.isArray(record.capture?.resources) && record.capture.resources.length > 0 ? [timingsOf(record.capture)] : [];
  return {
    revision: record.recipe?.revision ?? null,
    recipeSha256: record.recipeSha256 ?? null,
    run: last?.run ?? runOf(record.capture),
    userAgent: last?.userAgent ?? record.capture?.userAgent ?? null,
    figures: last?.ratcheted ?? pick(record.capture?.summary, RATCHETED),
    reported: last?.reported ?? pick(record.capture?.render, REPORTED),
    comparable: false,
    timings,
  };
};

/**
 * THE FILES OF AN npm TARBALL, by path: a gzipped ustar archive, read here rather than by a dependency
 * this package does not have. Regular files only; a pax `path` record renames the entry after it, as
 * npm writes one for a path ustar cannot hold. What it is handed was already verified against the
 * registry's integrity, so this is a reader, not a validator — but a malformed archive throws rather
 * than yielding a partial listing, which would read as a smaller graph.
 * @param {Uint8Array} gzipped
 * @returns {Map<string, Uint8Array>}
 */
export function tarballFiles(gzipped) {
  const tar = gunzipSync(gzipped);
  const text = (/** @type {Uint8Array} */ bytes) => {
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  };
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  /** @type {string | null} */
  let paxPath = null;
  let at = 0;
  for (; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(text(header.subarray(124, 136)).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > tar.length)
      throw new Error(`the tarball's entry at byte ${at} declares a size it does not hold`);
    const type = header[156] === 0 ? "0" : String.fromCharCode(/** @type {number} */ (header[156]));
    const name = text(header.subarray(0, 100));
    const prefix = text(header.subarray(257, 263)).startsWith("ustar") ? text(header.subarray(345, 500)) : "";
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") { paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(body))?.[1] ?? null; continue; }
    if (type === "g") continue;
    const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    if (type === "0" || type === "7") files.set(path, body);
  }
  if (at + 512 > tar.length) throw new Error("the tarball ends without its end-of-archive blocks; it is truncated");
  return files;
}

/**
 * THE PUBLISHED MODULE GRAPH: every module the entry points reach in the tarball's browser build, by
 * its path under `dist/browser/`, at its size in the tarball — what the capture must count, each once.
 * The walk is `tools/graph-walk.mjs`'s, run over the build written to a private directory and removed
 * after, so the two import rules that walker learned from silent misses, and its refusal of a spelling
 * it does not recognise, apply here unchanged. Measured on the rc.2 tarball: `lokalized.js` alone and
 * `load.js` with six chunks, 8 modules and 184,494 + 178,080 bytes — revision 3's capture, to the byte.
 * @param {Map<string, Uint8Array>} files the tarball's, by path
 * @param {readonly string[]} entryPoints paths under `dist/browser/`
 * @returns {Record<string, number>}
 */
export function publishedGraph(files, entryPoints) {
  const scratch = mkdtempSync(join(tmpdir(), "lokalized-0b-graph-"));
  try {
    for (const [path, bytes] of files) {
      if (!path.startsWith(BROWSER_BUILD)) continue;
      const under = path.slice(BROWSER_BUILD.length);
      // A PATH THAT CLIMBS OUT would be written outside the private directory; the registry's tarball
      // never holds one, and one that did is refused rather than followed.
      if (under.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
        throw new Error(`the tarball holds ${path}, a path this reader will not write`);
      mkdirSync(dirname(join(scratch, under)), { recursive: true });
      writeFileSync(join(scratch, under), bytes);
    }
    /** @type {Record<string, number>} */
    const graph = {};
    for (const entry of entryPoints) {
      if (!files.has(BROWSER_BUILD + entry)) throw new Error(`the tarball holds no dist/browser/${entry}, which the page imports`);
      for (const module of graphBytes(scratch, entry).files) {
        const under = relative(scratch, module).split(sep).join("/");
        const bytes = files.get(BROWSER_BUILD + under);
        if (bytes === undefined) throw new Error(`dist/browser/${entry} imports ${under}, which the tarball does not hold`);
        graph[under] = bytes.length;
      }
    }
    return Object.fromEntries(Object.entries(graph).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The facts a browser cannot give: the registry's statement of the subject's tarball, verified against
 * the tarball itself, the published graph read out of it, and the host's response headers on the two
 * URLs the capture measured.
 * @param {typeof globalThis.fetch} fetchImpl
 * @param {string} version
 */
async function measureHost(fetchImpl, version) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{ version: string, integrity: string | null, tarballSha256: string | null, graph: Record<string, number> | null }} */
  let subject = { version, integrity: null, tarballSha256: null, graph: null };
  try {
    const response = await fetchImpl(REGISTRY + encodeURIComponent(version), { headers: { accept: "application/json" } });
    if (!response.ok) problems.push(`the npm registry answered ${response.status} for lokalized@${version}; SUBJECT must name a published version`);
    else {
      const doc = await response.json();
      const tarball = doc?.dist?.tarball;
      if (doc?.name !== "lokalized" || doc?.version !== version)
        problems.push(`the npm registry's document is ${doc?.name}@${doc?.version}, not lokalized@${version}`);
      else if (typeof tarball !== "string" || !tarball.startsWith(REGISTRY + "-/"))
        problems.push(`the npm registry names its tarball at ${tarball}, which is not under ${REGISTRY}-/, so it is not fetched`);
      else {
        const fetched = await fetchImpl(tarball);
        const bytes = new Uint8Array(await fetched.arrayBuffer());
        const integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
        if (!fetched.ok) problems.push(`the npm registry answered ${fetched.status} for the tarball at ${tarball}`);
        else if (integrity !== doc.dist.integrity)
          problems.push(`the tarball fetched from ${tarball} hashes to ${integrity.slice(0, 24)}…, not the integrity the registry ` +
            `states for lokalized@${version} (${String(doc.dist.integrity).slice(0, 24)}…)`);
        else {
          try {
            subject = { version, integrity, tarballSha256: sha256(bytes),
              graph: publishedGraph(tarballFiles(bytes), RECIPE.requiredResources.entryPoints) };
          } catch (error) {
            problems.push(`the published graph of lokalized@${version} could not be read from its tarball: ${/** @type {Error} */ (error).message}`);
          }
        }
      }
    }
  } catch (error) {
    problems.push(`the npm registry could not be read for lokalized@${version}: ${/** @type {Error} */ (error).message}`);
  }
  /** @param {string} url */
  const probe = async (url) => {
    try {
      const response = await fetchImpl(url, { headers: { "accept-encoding": "br, gzip" } });
      await response.arrayBuffer();
      return { url, headers: Object.fromEntries(PROBED_HEADERS.map((h) => [h, response.headers.get(h)])) };
    } catch (error) {
      problems.push(`the host could not be probed at ${url}: ${/** @type {Error} */ (error).message}`);
      return { url, headers: Object.fromEntries(PROBED_HEADERS.map((h) => [h, null])) };
    }
  };
  const code = await probe(codeOriginFor(version) + "lokalized.js");
  const catalogs = await probe(RECIPE.catalogOrigin + "fr.json");
  const host = {
    contentEncoding: code.headers["content-encoding"],
    code,
    catalogs,
    // The code must be served as an exact published version, and the catalogs from a COMMIT, not a
    // branch: a branch ref would let the bytes under a recorded measurement change without the record
    // noticing. Both are refusals; the second used to be a printed WARNING, recorded anyway.
    codePinnedToVersion: code.headers["x-jsd-version-type"] === "version",
    catalogsPinnedToCommit: catalogs.headers["x-jsd-version-type"] === "commit",
  };
  return { subject, host, problems };
}

/**
 * ONE RUN, RECORDED OR REFUSED. Pure but for `fetch`, which is only called once every check that
 * needs no network has passed; the tests hand it a stub and count the calls.
 *
 * @param {{ capture: any, existing: any, files: import("../0b-checks.mjs").HarnessFiles, reason: string | null,
 *   fetch: typeof globalThis.fetch, subject?: { version: string }, origins?: Record<number, string>,
 *   checkpoints?: Record<number, import("../0b-checks.mjs").Checkpoint>, untimed?: Record<number, readonly string[]> }} run
 * @returns {Promise<{ refusals: string[], fetched: boolean } | { record: any, entry: any, first: boolean }>}
 */
export async function recordRun({ capture, existing, files, reason, fetch, subject = SUBJECT, origins = HISTORY_ORIGINS,
  checkpoints = HISTORY_CHECKPOINTS, untimed = HISTORY_UNTIMED }) {
  const revision = RECIPE.revision;
  const refusals = [...recipeProblems(), ...renumberProblems(), ...harnessProblems(files, subject),
    ...captureProblems(capture, { page: files.page, manifestText: files.manifestText, version: subject.version })
      .map((p) => `the capture: ${p}`)];

  // THE EXISTING RECORD. A LATER revision means this checkout is behind what was measured. The SAME
  // revision is appended to, and nothing is appended to a history the checker refuses: the new run
  // would inherit the break, and its predecessor could not be trusted to compare with. An EARLIER one
  // is closed: its last run becomes context, and this run starts a new history.
  const was = existing?.recipe?.revision;
  if (existing && typeof was !== "number")
    refusals.push(`the existing ${RECORD_NAME} names no recipe revision; restore the committed record ` +
      `(git checkout HEAD -- ${RECORD_NAME})`);
  else if (was > revision) refusals.push(`the existing record is revision ${was}, newer than this recipe's ${revision}`);
  const same = was === revision;
  if (same) refusals.push(...recordProblems(existing, files, { origins, checkpoints, untimed }).map((p) => `the existing record: ${p}`));
  // …AND OF THIS RECIPE, the one currency term a new run cannot move. `recordProblems` checks only that the
  // record's copy of its recipe hashes to its own digest, which another self-consistent recipe at the same
  // number does too: a review had a run appended to such a record, the recipe copy silently replaced by
  // this checkout's, while the checker refused the record it came from (2026-09-25).
  if (same && existing.recipeSha256 !== recipeSha256)
    refusals.push(`the existing record's recipe (${String(existing.recipeSha256).slice(0, 12)}) is not the one frozen for ` +
      `revision ${revision} (${recipeSha256.slice(0, 12)}): its runs were taken under another recipe, so this one cannot be ` +
      `compared with them. Restore the committed record (git checkout HEAD -- ${RECORD_NAME})`);
  /** @type {any[]} */
  const history = same && Array.isArray(existing.history) ? existing.history : [];
  // A REVISION'S HISTORY STARTS ONCE. With its first run frozen — or a checkpoint, which only a history
  // that exists can have — a record that no longer holds that run was deleted or replaced, and starting
  // over would launder whatever grew since. The remedy names the COMMITTED record: an older state from git
  // is a valid chain too as far as the checkpoint, and would compare this run with an older baseline
  // (`historyProblems` in tools/0b-checks.mjs says why the chain cannot see that).
  const frozen = origins[revision];
  if (history.length === 0 && (frozen !== undefined || checkpoints[revision] !== undefined))
    refusals.push(`revision ${revision}'s history is frozen ` +
      `${frozen !== undefined ? `to start at ${frozen.slice(0, 12)}` : "through a checkpoint"} ` +
      `and this record does not hold it; restore the committed record (git checkout HEAD -- ${RECORD_NAME}) rather than ` +
      "starting the history again");
  /** @type {any[]} */
  const priorRevisions = same ? (Array.isArray(existing.priorRevisions) ? existing.priorRevisions : [])
    : existing && typeof was === "number" ? [...(Array.isArray(existing.priorRevisions) ? existing.priorRevisions : []),
      priorFrom(existing, untimed)] : [];
  // A NEW REVISION STARTS FROM THE COMMITTED RECORD. Its first run is compared with nothing (plan :2796-2797),
  // so starting it over no record — or over a record older than the newest revision whose first run is
  // frozen — would drop that revision's runs from the context every run of this one binds: a review deleted
  // the record and renumbered the recipe, and a heavier run then passed as a first run with no trace of
  // revision 4's (2026-09-26).
  const newestFrozen = Math.max(-Infinity, ...Object.keys(origins).map(Number).filter((r) => r < revision));
  if (!same && newestFrozen > -Infinity && !(typeof was === "number" && was >= newestFrozen))
    refusals.push(`revision ${newestFrozen}'s history is frozen in HISTORY_ORIGINS, and ${existing ? `this record is revision ${was}` :
      "no record holds it"}: a new revision's first run replaces the committed record and keeps its last run as context. Restore ` +
      `the committed record (git checkout HEAD -- ${RECORD_NAME}) rather than starting from nothing`);
  // …AND THE COMMITTED RECORD IS ITS REVISION'S FROZEN HISTORY, not merely a record carrying that revision's
  // number. Nothing after this run sees the replaced record again: its last run and its context become what
  // every run of this revision binds. A review's hand-written stub — revision 4's number and digest, an empty
  // history and an empty `priorRevisions` — was accepted as the record replaced, and the record written over
  // it passed the checker with revision 3's and 4's runs erased; so was the live record with run 0's reason
  // edited (2026-09-26). So a replaced record that keeps a history must be the one `HISTORY_ORIGINS` and
  // `HISTORY_CHECKPOINTS` freeze for its revision, through its newest run, beside the context each of its runs
  // was recorded with. A record from before histories (revision 3's) has none to hold, and a newer revision's
  // frozen origin already refuses it (above).
  if (!same && existing && typeof was === "number" && was < revision && (origins[was] !== undefined || existing.history !== undefined)) {
    /** @type {any} */
    const old = existing.history;
    const checkpoint = checkpoints[was] ?? undefined;
    const broken = origins[was] === undefined ? [`HISTORY_ORIGINS freezes no first run for revision ${was}`]
      : chainProblems(old, origins[was], RECORD_NAME, checkpoint).map((p) => p.replace(/\.? ?Restore the record from git.*$/, ""));
    if (broken.length === 0 && checkpoint?.index !== old.length - 1)
      broken.push(`HISTORY_CHECKPOINTS does not freeze its newest run, run ${old.length - 1}`);
    const context = entryDigest(existing.priorRevisions ?? null);
    if (broken.length === 0 && old.some((/** @type {any} */ entry) => entry.priorRevisionsSha256 !== context))
      broken.push("its priorRevisions are not the ones its runs were recorded beside");
    if (broken.length > 0)
      refusals.push(`the record this run replaces is not revision ${was}'s frozen history (${broken.join("; ")}): a new revision ` +
        `starts from the committed record. Restore it (git checkout HEAD -- ${RECORD_NAME})`);
  }
  // …AND SAYS WHY IT WAS CUT. Being compared with nothing, a new revision's first run is where a grown figure
  // would otherwise pass unexplained, so it carries a reason whenever an earlier revision's run exists.
  const explained = typeof reason === "string" && reason.trim() !== "";
  if (!same && priorRevisions.length > 0 && !explained)
    refusals.push(`this run starts revision ${revision}'s history beside revision ${priorRevisions.at(-1)?.revision}'s run ` +
      `${priorRevisions.at(-1)?.run}, and is compared with nothing: re-run with --reason "why revision ${revision} was cut and ` +
      'what it changes"');

  // A RUN IS RECORDED ONCE, and a SITE once: re-feeding a capture adds no evidence, and a second run
  // from a site this browser has visited cannot be cold, whichever revision the first belonged to.
  const run = runOf(capture);
  const earlier = [...history, ...priorRevisions];
  if (earlier.some((e) => e?.run === run))
    refusals.push(`${run} is already in the record; a new run needs a new token, and a cold one a new site`);
  else if (earlier.some((e) => siteOf(e?.run) === siteOf(run)))
    refusals.push(`${siteOf(run)} already ran a recorded run, so this one cannot have been cold: use a site this browser has never visited`);
  // …AND A TIMELINE ONCE: a capture replayed under a new token and a new site is the run it already was. Its
  // timings are held against every earlier run of this revision, the ones frozen in `HISTORY_UNTIMED` among
  // them, and every earlier revision's run whose timeline the context keeps — the replaced record's, on a new
  // revision's first run. The capture a committed record holds is its newest run's, so it is one of those: the
  // checker holds a record's capture to its newest run's timeline, and `priorFrom` keeps that timeline.
  const timings = timingsOf(capture);
  if ([...(untimed[revision] ?? []), ...history.map((e) => e?.timingsSha256),
    ...priorRevisions.flatMap((p) => (Array.isArray(p?.timings) ? p.timings : []))].includes(timings))
    refusals.push("this capture's resource timings — every start and duration — are an earlier run's: it is that run replayed " +
      "under a new token and site, not a new one");

  // THE RATCHET, before the network: the figures are the capture's own. Whether they are also its
  // version's graph is known only once the tarball is read, and is judged in the verdict below — except
  // for a version this history has already measured, whose graph its last run counted: a run of it that
  // counts other than that is refused here, whatever the reason, and is not also told that a reason
  // would admit it.
  const ratcheted = pick(deriveCapture(capture, { page: files.page, version: subject.version }).figures, RATCHETED);
  const draft = { ratcheted, subject: { version: subject.version }, userAgent: capture?.userAgent };
  const grew = grewOver(history, draft);
  const fixed = versionFigureProblems(history, draft);
  refusals.push(...fixed);
  if (fixed.length === 0 && grew.length > 0 && !explained)
    refusals.push(`this run grew ${growthOver(history, draft)}. ` +
      "A ratcheted figure grows only with a stated reason: re-run with --reason \"what grew and why\"");
  if (refusals.length > 0) return { refusals, fetched: false };

  const measured = await measureHost(fetch, subject.version);
  if (measured.problems.length > 0) return { refusals: measured.problems, fetched: true };
  const entry = chained(history, {
    run,
    subject: measured.subject,
    userAgent: capture.userAgent,
    contentEncoding: measured.host.contentEncoding,
    ratcheted,
    reported: pick(capture.render, REPORTED),
    grew,
    reason: reason ?? null,
    // THE CONTEXT THIS HISTORY WAS STARTED BESIDE, bound on every run: the list is set at a revision's first
    // run and copied unchanged after it, so the frozen first run freezes it.
    priorRevisionsSha256: entryDigest(priorRevisions),
    timingsSha256: timings,
  });
  const record = {
    formatVersion: 2,
    note: NOTE,
    recipe: RECIPE,
    recipeSha256,
    // The exact harness files this run was taken with, so a later edit to any reads as a stale record.
    harnessSha256: harnessBinding(files),
    hostPreconditions: measured.host,
    history: [...history, entry],
    priorRevisions,
    capture,
  };
  // THE CHECKER'S OWN VERDICT over what is about to be written, round-tripped through JSON exactly as it
  // will be read back. The run is checked as if already frozen through itself — and a new revision's first
  // run as if its origin were — because those lines are the only things this run cannot have yet.
  const asWritten = JSON.parse(JSON.stringify(record));
  const first = history.length === 0;
  const verdict = checkRecord(asWritten, files, { subject, origins: first ? { ...origins, [revision]: entryDigest(entry) } : origins,
    checkpoints: { ...checkpoints, [revision]: checkpointOf(asWritten.history) }, untimed });
  if (verdict.length > 0) return { refusals: verdict.map((p) => `the record it would write: ${p}`), fetched: true };
  return { record: asWritten, entry, first };
}

/**
 * Whether this file is the entry point, compared by REAL path — `tools/temp-hygiene.mjs`'s reasoning:
 * macOS's `/tmp` and `/var` are symlinks, and a start through one compared unequal.
 */
const isEntryPoint = (() => {
  try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isEntryPoint) {
  const args = process.argv.slice(2);
  // A FLAG'S VALUE IS THE ARGUMENT AFTER IT, and never another flag: `--reason --record x` used to keep
  // "--record" as the reason, a sentence nobody wrote, in a record whose reasons are append-only.
  /** @param {string} flag */
  const valueOf = (flag) => {
    const at = args.indexOf(flag);
    const value = at >= 0 ? (args[at + 1] ?? "").trim() : null;
    return value?.startsWith("--") ? "" : value;
  };
  const reason = valueOf("--reason");
  const recordArg = valueOf("--record");
  if (reason === "" || recordArg === "") {
    console.error("--reason and --record each need a value; a reason is kept in the record");
    process.exit(2);
  }
  const flagValues = new Set(["--reason", "--record"].map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  const positional = args.filter((arg, i) => !arg.startsWith("--") && !flagValues.has(i));
  // AN UNKNOWN FLAG IS REFUSED, never ignored: `--migrate`, which the ratchet's first prototype had, would
  // otherwise go on to record the capture it was handed — the silently-ignored-option class M-D S33 removed
  // from the library's public doors.
  const unknown = args.filter((arg, i) => arg.startsWith("--") && !flagValues.has(i) && !["--reason", "--record"].includes(arg));
  const [capturePath] = positional;
  if (positional.length !== 1 || capturePath === undefined || unknown.length > 0) {
    if (unknown.length > 0) console.error(`unknown option(s): ${unknown.join(" ")}`);
    console.error("usage: record.mjs <capture.json> [--reason \"what grew and why\"] [--record <path>]");
    process.exit(2);
  }
  const recordPath = recordArg ? resolve(recordArg) : join(root, RECORD_NAME);
  /** @param {string} path */
  const readJson = (path) => {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) {
      console.error(`${path} is not readable JSON: ${/** @type {Error} */ (error).message}`);
      return process.exit(2);
    }
  };
  const capture = readJson(capturePath);
  const existing = existsSync(recordPath) ? readJson(recordPath) : null;
  const result = await recordRun({ capture, existing, files: readHarness(root), reason, fetch: globalThis.fetch });
  if ("refusals" in result) {
    console.error(`refusing to record${result.fetched ? "" : " (nothing was fetched)"}:\n` + result.refusals.map((r) => `  - ${r}`).join("\n"));
    process.exit(1);
  }
  writeFileSync(recordPath, JSON.stringify(result.record, null, 2) + "\n");
  const { entry } = result;
  console.log(`recorded ${recordPath === join(root, RECORD_NAME) ? RECORD_NAME : recordPath}: run ` +
    `${result.record.history.length - 1} of revision ${RECIPE.revision} (${entry.run}), lokalized@${entry.subject.version} ` +
    `(tarball ${entry.subject.tarballSha256.slice(0, 12)}, ${Object.keys(entry.subject.graph).length} modules), host encoding ` +
    `${entry.contentEncoding}` + (entry.grew.length > 0 ? `, grew in [${entry.grew}] for the reason given` : ", no growth"));
  if (result.first)
    console.log(`this run starts revision ${RECIPE.revision}'s history. Freeze it — add this line inside HISTORY_ORIGINS in ` +
      `tools/0b-recipe.mjs:\n  ${RECIPE.revision}: "${entryDigest(entry)}",`);
  // EVERY RUN IS FROZEN THROUGH ITS CHECKPOINT, and the checker fails until it is: print the line.
  console.log("review the record's diff, then set this inside HISTORY_CHECKPOINTS in tools/0b-recipe.mjs, in place of the " +
    `revision's line if it has one:\n${checkpointLine(result.record.history, RECIPE.revision)}`);
}
