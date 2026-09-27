// @ts-check
/**
 * SCENARIO 0b's CHECKS, ATTACKED — the ablations run as tests, offline and deterministic.
 *
 * `tools/scenario-0b.mjs` re-checks the browser run's record and `tools/browser-0b/record.mjs` writes
 * it; both apply `tools/0b-checks.mjs`. Before this file, every 0b ablation lived in a shell script in
 * somebody's scratch directory, and two reviews found the checker weaker than the ledger line
 * describing it: a deleted summary, a summary claiming 99 requests, a deleted render and a catalog
 * origin on a branch all passed at exit 0, and the recorder wrote runs the checker then refused.
 * Here each of those — and each way of attacking the run history — must be refused WITH ITS OWN
 * PROBLEM, by the checker and, where it applies, by the recorder, and the recorder must refuse a bad
 * capture before it touches the network. An intact record must pass, or every refusal below could be
 * the same unconditional one. A review then removed each problem push of the checks' first version in
 * turn and found 47 whose removal left this file green. Every problem push, early return of a problem
 * list, refusal, thrown refusal and exit in `tools/0b-checks.mjs`, `tools/browser-0b/record.mjs` and
 * `tools/scenario-0b.mjs` now has a test here that goes red when it alone is removed, and so does each
 * rule a review found too weak, reverted to its weaker form — measured the same way, one mutation per
 * throwaway copy, each asserted to have landed: 171 of 172 on 2026-09-25, the one left a weakening that
 * the one-entry rule on the blind control makes unobservable. A second review WEAKENED each condition
 * instead — a conjunct or a disjunct dropped, a comparison flipped or moved across its boundary, a
 * negation removed, `some` for `every`, one arm of a conditional kept — and showed 13 of them accepting
 * an input the original refuses; each such input is refused here now. Of 886 such mutants over the four
 * 0b tools, 800 turn this file red; the other 86 were each READ, not demonstrated, and judged to change
 * no verdict: forms no input tells apart, conditions another check already refuses the same input by,
 * guards that only keep a second message from repeating the first, the words of a refusal that name its
 * likely cause, and what the checker prints. The rules a third review's findings added on 2026-09-26 — the
 * timings held to the capture's own timeline, each matched preload's entry the preload's, every counted
 * entry answered, asked for as the scenario asks and complete before the render, the blind control's fetch
 * succeeding, the limits in effect and the arm's subject, the catalog probe's encoding, the timeline no
 * earlier run's, the newest run frozen in source, and a new revision neither a renumber nor started from
 * nothing nor unexplained — were swept the same way when they landed; a review of that sweep then weakened
 * them and found ten weakenings this file let through, and two rules holding half of what they said: the
 * timings held to the code and not to the loader, and the record a new revision replaces held to its
 * revision's number and not to its revision's frozen history. With those closed — the loader asking after
 * the import and returning after every catalog, each matched preload issued before the page's clock
 * started, the replaced record its revision's frozen history, every replaced run's timeline kept and no run
 * repeating one, a first run's reason required by the checker too, a reason of spaces no reason, and a
 * `null` checkpoint line refused rather than crashed on — 94 mutations of the final tree on 2026-09-26 (each
 * new rule removed alone, a condition dropped from each that joins several, each allowance widened, the
 * earlier sweep's mutations wherever their rule survives, and the review's weakenings re-aimed at the final
 * code) turned this file red but one, which changes no verdict: a catalog probe with no content encoding at
 * all let past the rule tying it to the host's, which the required-header rule refuses first. The file is
 * judged by those sweeps, not by its count.
 *
 * **NOTHING HERE READS THE LIVE RECORD OR THE NETWORK.** `measurements/scenario-0b.json` is re-recorded
 * in a real browser at each release, and a test that depended on it would move with it. The captures
 * below are SYNTHETIC — shaped like the page's output, sized from revision 3's cold run — and so are the
 * registry and the tarball the recorder reads, a real gzipped ustar archive built here whose browser
 * build has rc.2's module sizes. Runs are recorded through the real `recordRun` with a stub `fetch`,
 * and the frozen first-run digests, checkpoints and untimed runs' timings are injected, so this file passes
 * whether the live record is a revision-3 record awaiting its re-record or a frozen revision-4 history. Where
 * a rule needs the one real run's clock, its timeline is copied here as a fixture. The harness files ARE the
 * real ones: the checks are about them. And the page's own script runs too, through
 * `tools/browser-0b/simulate.mjs`, so the second reading of the page below is held to the page.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { after, describe, test } from "node:test";

import { chained, checkpointOf, entryDigest } from "../tools/ratchet-chain.mjs";
import { CODE_DECLARATION, HISTORY_ORIGINS, RECIPE, RECIPE_DIGESTS, SUBJECT, codeOriginFor, recipeSha256 } from "../tools/0b-recipe.mjs";
import { PROBED_HEADERS, captureProblems, checkRecord as checkRecordAt, checkpointLine, deriveCapture, grewOver, readHarness,
  renumberProblems, siteOf, timingsOf, unfrozenTail } from "../tools/0b-checks.mjs";
import { publishedGraph, recordRun as recordRunAt, tarballFiles } from "../tools/browser-0b/record.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = readHarness(root);

// NO FROZEN LINE BUT THE ONES A TEST INJECTS. The frozen first runs are always injected below; the checkpoints
// and the untimed runs' timings must be too, because the ones `tools/0b-recipe.mjs` freezes for the live record
// name a live run's digests, which no synthetic history holds — without this, the live freeze would turn this
// file red. A checkpoint must name the NEWEST run (`historyProblems`), so by default each record checked — and
// each record appended to — is taken as frozen through its own newest run, as it would be once the printed
// line is set: that keeps every other rule's test about that rule, and the checkpoint's own tests below
// inject theirs. A context member passed as `undefined` is dropped rather than left to reach a default
// that would be the LIVE one.
/** @param {any} record */
const pinnedAt = (record) => (Array.isArray(record?.history) && record.history.length > 0 &&
  record.history.every((/** @type {unknown} */ e) => e !== null && typeof e === "object" && !Array.isArray(e))
  ? { [revisionOf(record)]: checkpointOf(record.history) } : {});
/** The revision a record's history is frozen under: its own, or this recipe's. @param {any} record */
const revisionOf = (record) => (typeof record?.recipe?.revision === "number" ? record.recipe.revision : RECIPE.revision);
/** `context` without its undefined members. @template {object} T @param {T} context @returns {T} */
const defined = (context) => /** @type {T} */ (Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined)));
/** @type {typeof checkRecordAt} */
const checkRecord = (record, harness, context = {}) =>
  checkRecordAt(record, harness, { checkpoints: pinnedAt(record), untimed: {}, ...defined(context) });
/** @type {typeof recordRunAt} */
const recordRun = (run) => recordRunAt({ checkpoints: pinnedAt(run.existing), untimed: {}, ...defined(run) });
const REVISION = RECIPE.revision;
const scratch = mkdtempSync(join(tmpdir(), "lokalized-0b-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------------
// A SYNTHETIC CAPTURE, shaped like `tools/browser-0b/index.html`'s output. The sizes are revision 3's
// cold run (transfer / encoded / decoded), and the code's decoded sizes are rc.2's files; they are a
// fixture here, never a measurement.

const CATALOGS = /** @type {Record<string, number[]>} */ ({
  "fr.json": [687, 387, 909], "fr-CA.json": [671, 371, 876], "en.json": [659, 359, 839] });
/** @type {[string, number, number, number][]} */
const CODE = [["lokalized.js", 65028, 64728, 184494], ["load.js", 7731, 7431, 20600],
  ["chunks/chunk-NZVWUS27.js", 1501, 1201, 2481], ["chunks/chunk-LED5CWLB.js", 994, 694, 1355],
  ["chunks/chunk-ZSYPX2PV.js", 552, 252, 347], ["chunks/chunk-7WU4JE3E.js", 23067, 22767, 75744],
  ["chunks/chunk-QU3LBEYR.js", 779, 479, 659], ["chunks/chunk-LNGUQ7KN.js", 33342, 33042, 76894]];
/** @type {[string, number, number, number]} */
const EXTRA = ["chunks/chunk-EXTRA123.js", 552, 252, 347];
const DROPPED = "chunks/chunk-QU3LBEYR.js";
const BLIND = "http://localhost:8714/no-timing-allow-origin.json";
const USER_AGENT = "Mozilla/5.0 (synthetic test capture) Chrome/152.0.0.0";
/** When the render returned, on the page's clock: every scenario request starts before it, every control after. */
const RENDERED_AT = 195.53;
/**
 * A release that SPLITS `chunk-LNGUQ7KN.js` in two: one request more, and every byte figure smaller — a
 * release that grows the request count alone, which only the request count's own ratchet can see.
 * @type {[string, number, number, number][]}
 */
const SPLIT = [["chunks/chunk-AAAA1111.js", 16800, 16500, 38100], ["chunks/chunk-BBBB2222.js", 16300, 16000, 38000]];
const SPLIT_FROM = "chunks/chunk-LNGUQ7KN.js";

/** @param {{ extraChunk?: boolean, dropChunk?: boolean, split?: boolean }} graph */
const codeOf = ({ extraChunk = false, dropChunk = false, split = false } = {}) =>
  [...CODE.filter(([file]) => !(dropChunk && file === DROPPED) && !(split && file === SPLIT_FROM)), ...(split ? SPLIT : []),
    ...(extraChunk ? [EXTRA] : [])];

/**
 * @param {string} url @param {string} initiatorType @param {number[]} sizes transfer, encoded, decoded
 * @param {object} [extra]
 */
const row = (url, initiatorType, [transferSize, encodedBodySize, decodedBodySize], extra = {}) => ({
  url, origin: "", phase: "", control: null, counted: false, startMs: 0, initiatorType, transferSize, encodedBodySize,
  decodedBodySize, deliveryType: "", responseStatus: 200, readable: false, durationMs: 1, ...extra });

/**
 * THE PAGE'S SIDE, recomputed the way `index.html` computes it — each entry's phase from its start and
 * the render's return, the labels, the summary, the three controls' verdicts and the cold arm — from
 * the resources and the page's MARKUP. Written here independently of `tools/0b-checks.mjs`, so the
 * checks are compared with a second reading rather than with themselves; the simulation test at the
 * end holds this reading to the page's own script. `bytesRead` is what the page's second load READ,
 * an input the capture supplies, and is kept.
 * @param {any} capture
 */
function pageSide(capture) {
  const token = encodeURIComponent(capture.cacheBuster.value);
  const renderedAt = capture.render.renderedAtMs;
  const mismatched = new Set([...files.page.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => /rel="preload"/.test(tag) && !/\scrossorigin\s/.test(tag))
    .map((tag) => (/href="([^"]+)"/.exec(tag)?.[1] ?? "").replaceAll("__RUN__", token)));
  for (const r of capture.resources) {
    const production = r.url.startsWith("https://cdn.jsdelivr.net/");
    r.phase = r.startMs < renderedAt ? "scenario" : "after-render";
    r.origin = production ? "production-host" : "local-control";
    r.control = r.initiatorType === "link" && mismatched.has(r.url) ? "mismatched-preload" : null;
    r.counted = production && r.phase === "scenario" && r.control === null;
    r.readable = r.encodedBodySize > 0 || r.decodedBodySize > 0;
  }
  const all = /** @type {any[]} */ (capture.resources);
  const counted = all.filter((r) => r.counted);
  const perUrl = (/** @type {string} */ file) =>
    all.filter((r) => r.startMs < renderedAt && new URL(r.url).pathname.endsWith("/" + file)).length;
  const frUrl = `${RECIPE.catalogOrigin}fr.json?0b=${token}`;
  const again = all.filter((r) => r.startMs >= renderedAt && r.url === frUrl);
  const blind = all.find((r) => r.url.startsWith("http://localhost:8714/"));
  const examined = counted.filter((r) => r.readable);
  const cached = examined.filter((r) => r.deliveryType === "cache" || !(r.transferSize > r.encodedBodySize));
  capture.controls = {
    preload: { matched: { "fr.json": perUrl("fr.json"), "fr-CA.json": perUrl("fr-CA.json") },
      mismatched: { "en.json": perUrl("en.json") } },
    secondLoad: { newEntries: again.length, transferSize: again[0]?.transferSize ?? null,
      servedFromCache: again.length === 0 || again[0].transferSize === 0, bytesRead: capture.controls?.secondLoad?.bytesRead ?? null },
    blind: blind ? { fetched: true, encodedBodySize: blind.encodedBodySize, decodedBodySize: blind.decodedBodySize,
      isBlind: blind.encodedBodySize === 0 && blind.decodedBodySize === 0 } : { fetched: true, entry: null, isBlind: null },
  };
  capture.coldArm = { contaminated: cached.length > 0, examined: examined.length,
    cachedResources: cached.map((r) => ({ url: r.url, encodedBodySize: r.encodedBodySize })), noteOnLimits: "synthetic" };
  capture.summary = {
    requestCount: counted.length,
    requestsAfterRenderExcluded: all.filter((r) => r.origin === "production-host" && r.phase !== "scenario").length,
    controlsExcluded: all.filter((r) => r.control !== null).length,
    encodedBytes: counted.reduce((n, r) => n + r.encodedBodySize, 0),
    decodedBytes: counted.reduce((n, r) => n + r.decodedBodySize, 0),
    transferBytes: counted.reduce((n, r) => n + r.transferSize, 0),
  };
  return capture;
}

/**
 * A whole run. `site` is the top-level site it ran from, `token` its `?run=`, `extraChunk` adds one
 * published chunk — a release whose graph grew — `dropChunk` loses one from the capture, and `split` is the
 * release that splits a chunk in two.
 *
 * ITS TIMELINE is the page's order: the preloads and the manifest, then the code — requested after the
 * timings' start, which the render's return less the first usable render puts at 20.03 ms — then, once the
 * cold import has ended at 167.23 ms, the loader's fetch at 170 ms, each entry 1 ms long and every one complete
 * before the load returns at 191.03 ms and the render at 195.53. Every start is offset by a fraction of a
 * millisecond derived from the run's site and token, so the runs here do not share a timeline: one timeline
 * recorded twice is one capture replayed under two names, which is refused.
 * @param {{ site: string, token: string, version?: string, extraChunk?: boolean, dropChunk?: boolean, split?: boolean }} run
 */
function syntheticCapture({ site, token, version = SUBJECT.version, extraChunk = false, dropChunk = false, split = false }) {
  const code = codeOriginFor(version), catalogs = RECIPE.catalogOrigin, t = `?0b=${encodeURIComponent(token)}`;
  const limit = (/** @type {number} */ n) => `?0b=${encodeURIComponent(`${token}-limit-${n}`)}`;
  const before = [
    row(catalogs + "fr.json" + t, "link", /** @type {number[]} */ (CATALOGS["fr.json"])),
    row(catalogs + "fr-CA.json" + t, "link", /** @type {number[]} */ (CATALOGS["fr-CA.json"])),
    row(catalogs + "en.json" + t, "link", [0, 0, 0], { responseStatus: 0 }),
    row(site + "/manifest.json", "fetch", [1651, 1351, 1351]),
    ...codeOf({ extraChunk, dropChunk, split }).map(([file, ...sizes]) =>
      row(code + file + (file.startsWith("chunks/") ? "" : t), "script", sizes)),
    row(catalogs + "en.json" + t, "fetch", /** @type {number[]} */ (CATALOGS["en.json"])),
  ];
  const afterRender = [
    row(catalogs + "fr.json" + t, "fetch", [0, 387, 909], { deliveryType: "cache" }),
    row(BLIND, "fetch", [0, 0, 0]),
    ...[908, 909].flatMap((n) => ["fr.json", "fr-CA.json", "en.json"].map((file) =>
      row(catalogs + file + limit(n), "fetch", /** @type {number[]} */ (CATALOGS[file])))),
  ];
  const skew = [...`${site} ${token}`].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7) / 1000;
  before.forEach((r, i) => { r.startMs = 1.25 + i * 3 + (i >= 4 ? 25 : 0) + skew; });
  /** @type {any} */ (before.at(-1)).startMs = 170 + skew;
  afterRender.forEach((r, i) => { r.startMs = RENDERED_AT + 10.5 + i * 3 + skew; });
  return pageSide({
    userAgent: USER_AGENT,
    origins: { page: site, code, catalogs, blindControl: BLIND },
    resources: [...before, ...afterRender], controls: { secondLoad: { bytesRead: 909 } },
    render: { locale: "fr", key: "Cart.Items", rendered: RECIPE.render.expected, renderedTheKeyBack: false,
      coldImportMs: 147.2, loadMs: 23.8, firstUsableRenderMs: 175.5, renderedAtMs: RENDERED_AT },
    problems: [],
    cacheBuster: { parameter: "0b", value: token, appliedTo: "every production-host URL" },
    streamingLimits: {
      inEffect: { maximumInputBytes: 8388608 },
      subject: { locale: "fr", manifestDecodedBytes: 909 },
      arms: [
        { maximumInputBytes: 908, outcome: "refused", error: "StringsLoadingError",
          failures: [{ locale: "fr", stage: "limit", message: "fr: body exceeds the maximum of 908 bytes" }] },
        { maximumInputBytes: 909, outcome: "loaded", failures: [] },
      ],
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// A PUBLISHED TARBALL, as npm packs one: gzipped ustar, the browser build under `package/dist/browser/`.
// Each module is padded to its rc.2 size with a comment, and `load.js` imports its chunks the way the
// minified build does. `core.js` and its chunk are there so that the graph is shown to be WALKED from
// the entry points, not every file in the build.

/**
 * @param {([string, string | Uint8Array] | [string, string | Uint8Array, string])[]} entries path, content and type flag ("0" if absent)
 * @param {{ end?: boolean }} [options]
 */
function ustar(entries, { end = true } = {}) {
  /** @type {Buffer[]} */
  const blocks = [];
  for (const [path, content, type = "0"] of entries) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(path, 0, 100);
    header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136); header.write("        ", 148); header.write(type, 156);
    header.write("ustar\0", 257); header.write("00", 263);
    const sum = header.reduce((n, byte) => n + byte, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  if (end) blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** `text` followed by a comment filling it to `size` bytes. @param {string} text @param {number} size */
const padded = (text, size) => text + "/*" + " ".repeat(size - text.length - 4) + "*/";

/** @param {{ extraChunk?: boolean, dropChunk?: boolean, split?: boolean, loadImports?: string }} [graph] */
function publishedTarball({ extraChunk = false, dropChunk = false, split = false, loadImports } = {}) {
  const modules = codeOf({ extraChunk, dropChunk, split });
  const imports = loadImports ?? modules.filter(([file]) => file.startsWith("chunks/")).map(([file]) => `import"./${file}";`).join("");
  return ustar([
    ["package/package.json", '{"name":"lokalized"}'],
    ...modules.map(([file, , , size]) => /** @type {[string, string]} */ ([`package/dist/browser/${file}`,
      padded(file === "load.js" ? imports : "", size)])),
    ["package/dist/browser/core.js", padded('import"./chunks/chunk-2QVQLAF6.js";', 896)],
    ["package/dist/browser/chunks/chunk-2QVQLAF6.js", padded("", 1482)],
  ]);
}
const TARBALL = publishedTarball();
const integrityOf = (/** @type {Uint8Array} */ bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
const REGISTRY = "https://registry.npmjs.org/lokalized/";

// ---------------------------------------------------------------------------------------------------
// A STUB NETWORK: the npm registry, its tarball and the two host probes, answering as the real ones did.
// It counts its calls, which is how "refused before the network" is observed rather than asserted.

/**
 * @typedef {{ catalogsPinnedTo?: string, codePinnedTo?: string, drop?: string, integrity?: string, registryStatus?: number,
 *   tarballStatus?: number, tarball?: Uint8Array, doc?: (doc: any) => any, headers?: (url: string, h: Record<string, string>) => void,
 *   fail?: (url: string) => boolean }} Stub
 * @param {Stub} [options]
 */
function stubNetwork({ catalogsPinnedTo = "commit", codePinnedTo = "version", drop, integrity, registryStatus = 200, tarballStatus = 200,
  tarball = TARBALL, doc = (d) => d, headers: edit = () => {}, fail = () => false } = {}) {
  /** @type {string[]} */
  const calls = [];
  const fetch = /** @type {typeof globalThis.fetch} */ (async (/** @type {any} */ input) => {
    const url = String(input);
    calls.push(url);
    if (fail(url)) throw new Error(`stub: ${url} is unreachable`);
    if (url.startsWith(REGISTRY + "-/")) return new Response(new Uint8Array(tarball), { status: tarballStatus });
    if (url.startsWith(REGISTRY)) {
      const version = decodeURIComponent(url.slice(REGISTRY.length));
      return new Response(JSON.stringify(doc({ name: "lokalized", version,
        dist: { integrity: integrity ?? integrityOf(tarball), tarball: `${REGISTRY}-/lokalized-${version}.tgz` } })),
      { status: registryStatus, headers: { "content-type": "application/json" } });
    }
    const catalog = url.includes("/gh/");
    /** @type {Record<string, string>} */
    const headers = { "content-encoding": "br", "timing-allow-origin": "*", "access-control-allow-origin": "*",
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "x-jsd-version-type": catalog ? catalogsPinnedTo : codePinnedTo, "content-length": catalog ? "387" : "64728" };
    if (drop) delete headers[drop];
    edit(url, headers);
    return new Response("stub", { headers });
  });
  return { fetch, calls };
}

/**
 * A record built the only honest way, through the recorder: each step is one run; the first run's
 * digest is frozen as `HISTORY_ORIGINS` would be, and returned with the record. A refused step is
 * RETURNED, not thrown: the fixtures below are built at load, and a throw there would crash the file
 * into one anonymous failure — the shape this project has mistaken for a finding more than once. The
 * first test names it instead.
 * @param {{ capture: any, reason?: string, subject?: { version: string }, files?: typeof files, network?: Stub }[]} steps
 * @param {any} [start] an existing record to start from
 * @param {Record<number, string>} [startOrigins] the origins frozen for `start`
 */
async function recorded(steps, start = null, startOrigins = {}) {
  let record = start;
  let origins = startOrigins;
  for (const step of steps) {
    const result = await recordRun({ capture: step.capture, existing: record, files: step.files ?? files,
      reason: step.reason ?? null, fetch: stubNetwork(step.network).fetch, subject: step.subject, origins });
    if ("refusals" in result) return { record, origins, refusals: result.refusals };
    record = result.record;
    if (result.first) origins = { ...origins, [REVISION]: entryDigest(result.entry) };
  }
  return { record, origins, refusals: [] };
}

const site = (/** @type {string} */ name) => `http://zb-test-${name}.localhost:8713`;
const run = (/** @type {string} */ name, extra = {}) => syntheticCapture({ site: site(name), token: `${name}-1`, ...extra });
const clone = (/** @type {any} */ value) => structuredClone(value);
/** The capture's first resource whose URL holds `part`. @param {any} c @param {string} part */
const at = (c, part) => c.resources.find((/** @type {any} */ r) => r.url.includes(part));
/** Keeps the capture's resources `accept` accepts. @param {any} c @param {(r: any) => boolean} accept */
const keep = (c, accept) => { c.resources = c.resources.filter(accept); };
/** Every chunk served from the browser cache: a warm run. @param {any} c */
const warmChunks = (c) => {
  for (const r of c.resources) if (r.url.includes("/chunks/")) Object.assign(r, { transferSize: 0, deliveryType: "cache" });
};
/** `text` escaped for a regular expression — for the version, which moves at every release. */
const literally = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const V = literally(SUBJECT.version);
const NEXT = { version: "9.9.9" };
const nextFiles = { ...files, page: files.page.replace(CODE_DECLARATION, `$1${codeOriginFor(NEXT.version)}$3`) };

/**
 * The HOST compressing the same files worse: `lokalized.js` 50 bytes bigger on the wire, decoded
 * unchanged — the change a re-run of one version can honestly show.
 * @param {any} capture
 */
function compressedWorse(capture) {
  const main = capture.resources.find((/** @type {any} */ r) => r.url.includes("/lokalized.js"));
  main.encodedBodySize += 50; main.transferSize += 50;
  return pageSide(capture);
}
/** The host's probe of that run, stating the length it sent — which the recorder ties to the capture's. */
const WORSE = /** @type {Stub} */ ({ headers: (url, h) => { if (url.includes("/npm/")) h["content-length"] = "64778"; } });

/**
 * The same run taken `k` times slower: every start and duration, the render's return and the three timings,
 * scaled together, so the capture stays one run's and only its latency moved.
 * @param {any} capture @param {number} k
 */
function slower(capture, k) {
  for (const r of capture.resources) { r.startMs *= k; r.durationMs *= k; }
  for (const f of ["renderedAtMs", "firstUsableRenderMs", "coldImportMs", "loadMs"]) capture.render[f] *= k;
  return pageSide(capture);
}

/**
 * `capture`'s timeline under another run's name — a new site and token, every start and duration the same:
 * what a review recorded as a new run by string-replacing a capture's token and site (2026-09-26).
 * @param {any} capture @param {string} name
 */
function replayed(capture, name) {
  const copy = run(name);
  copy.resources.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    r.startMs = capture.resources[i].startMs; r.durationMs = capture.resources[i].durationMs; });
  return pageSide(copy);
}

/**
 * REVISION 4's RECORDED RUN, r4a-1, AS A TIMELINE: each scenario entry's start and duration as the page wrote
 * them, and the render's clock. A FIXTURE copied from `measurements/scenario-0b.json`, never read from it: the
 * timeline rules must pass the one real cold run there is, and refuse the review's timings on its clock.
 */
const R4A_TIMELINE = /** @type {Record<string, [number, number]>} */ ({
  "fr.json link": [7.700000002980232, 88.4], "fr-CA.json link": [7.899999998509884, 87.9], "en.json link": [7.899999998509884, 69.4],
  "manifest.json fetch": [11.600000001490116, 8.6], "lokalized.js script": [22.399999998509884, 64],
  "load.js script": [103.80000000447035, 18.7], "chunk-NZVWUS27.js script": [124.10000000149012, 18.1],
  "chunk-QU3LBEYR.js script": [124.20000000298023, 24.5], "chunk-7WU4JE3E.js script": [124.20000000298023, 27.7],
  "chunk-ZSYPX2PV.js script": [124.30000000447035, 22.3], "chunk-LNGUQ7KN.js script": [124.39999999850988, 27.3],
  "chunk-LED5CWLB.js script": [124.5, 22.1], "en.json fetch": [190, 21.9],
});
const R4A_RENDER = { renderedAtMs: 233, firstUsableRenderMs: 210.8, coldImportMs: 156.6, loadMs: 37.9 };
/** A synthetic run moved onto r4a-1's clock: its timeline, its render's, and every control after it. @param {any} capture */
function onR4aClock(capture) {
  let after = 0;
  for (const r of capture.resources) {
    const timed = r.startMs < RENDERED_AT ? R4A_TIMELINE[`${new URL(r.url).pathname.split("/").pop()} ${r.initiatorType}`] : undefined;
    if (timed) [r.startMs, r.durationMs] = timed;
    else r.startMs = R4A_RENDER.renderedAtMs + 0.5 + 3 * after++;
  }
  Object.assign(capture.render, R4A_RENDER);
  return pageSide(capture);
}

/**
 * A revision-3 record, as the live one was before revision 4's first run: a formatVersion-1 record with no
 * history. A run recorded over it starts revision 4's history, so its version has no earlier run to be
 * held to and only the tarball can judge its graph.
 * @param {string} name the site its one run ran from
 */
const revision3Record = (name) => ({ formatVersion: 1, recipe: { revision: 3 }, recipeSha256: RECIPE_DIGESTS[3],
  capture: { origins: { page: site(name) }, cacheBuster: { value: `${name}-1` }, userAgent: USER_AGENT,
    summary: { requestCount: 12, decodedBytes: 365198, encodedBytes: 131711, transferBytes: 135011 },
    render: { rendered: RECIPE.render.expected, firstUsableRenderMs: 175.5, coldImportMs: 147.2, loadMs: 23.8 } } });

/**
 * A record with a history, relabelled as revision 3's: what a new revision's first run replaces once the revision
 * before it keeps a history — revision 5's over revision 4's committed record, here one revision down, because a
 * test cannot move `RECIPE.revision`. Its history is frozen for revision 3 by the test that uses it, with the same
 * digests it had under this revision: the relabelling touches the record's recipe, never an entry.
 * @param {any} record
 */
const asRevision3 = (record) => ({ ...clone(record), recipe: { ...record.recipe, revision: 3 }, recipeSha256: RECIPE_DIGESTS[3] });

/** The reason a revision's first run over an earlier revision's record gives: it is compared with nothing. */
const FIRST_RUN_REASON = "test: revision 4's first run, cut from revision 3 for the ratchet and a method that no longer counts a control";

/** Revision 2's run as a `priorRevisions` entry would carry it: context from a record that already carried context. */
const REVISION_2_RUN = { revision: 2, recipeSha256: RECIPE_DIGESTS[2], run: `${site("r2")} r2-1`, userAgent: USER_AGENT,
  figures: { requestCount: 13, decodedBytes: 365198, encodedBytes: 131711, transferBytes: 135011 },
  reported: { firstUsableRenderMs: 180.1, coldImportMs: 150.3, loadMs: 25.1 }, comparable: false };

/**
 * The intact histories every ablation starts from: one run, and three runs of one version — the second
 * grown in its encoded and transfer bytes, with a reason, and the third back where the first was, which
 * needs none, because those two figures are the host's and may fall freely.
 */
const one = await recorded([{ capture: run("a") }]);
const three = await recorded([
  { capture: run("a") },
  { capture: compressedWorse(run("b")), network: WORSE, reason: "test: the host compressed lokalized.js 50 bytes worse" },
  { capture: run("c") },
]);

/**
 * The digest a fixture's first run is frozen under, as HISTORY_ORIGINS would hold it.
 * @param {{ origins: Record<number, string> }} fixture
 */
const originOf = (fixture) => /** @type {string} */ (fixture.origins[REVISION]);

/**
 * A history edited and then RE-LINKED, with its first run re-frozen: what an attacker who edits the
 * record AND the frozen line gets. Isolates a history rule from the chain, which otherwise fires first.
 * @param {any} record @param {(history: any[]) => void} edit
 */
function rechained(record, edit) {
  const copy = clone(record);
  edit(copy.history);
  /** @type {any[]} */
  const history = [];
  for (const entry of copy.history) { const { previousSha256: _, ...rest } = entry; history.push(chained(history, rest)); }
  copy.history = history;
  return { record: copy, origins: { [REVISION]: entryDigest(history[0]) } };
}

/**
 * `priorRevisions` edited and every run RE-BOUND to the edit, then re-linked and re-frozen: isolates an order or
 * recipe rule on the list from the binding, which otherwise fires first.
 * @param {any} record @param {(prior: any[]) => void} edit
 */
function reprior(record, edit) {
  const copy = clone(record);
  edit(copy.priorRevisions);
  const bound = entryDigest(copy.priorRevisions);
  return rechained(copy, (h) => { for (const entry of h) entry.priorRevisionsSha256 = bound; });
}

/**
 * @param {any} record @param {Record<number, string>} origins @param {RegExp} expected
 * @param {{ subject?: { version: string }, files?: typeof files,
 *   checkpoints?: Record<number, { index: number, sha256: string }>, untimed?: Record<number, readonly string[]> }} [options]
 */
function refusedByChecker(record, origins, expected, options = {}) {
  const problems = checkRecord(record, options.files ?? files,
    { origins, subject: options.subject, checkpoints: options.checkpoints, untimed: options.untimed });
  assert.ok(problems.some((p) => expected.test(p)),
    `expected a problem matching ${expected}; the checker said:\n  ${problems.join("\n  ") || "(nothing)"}`);
  return problems;
}

/**
 * @param {any} capture @param {RegExp} expected
 * @param {{ network?: Stub, fetched?: boolean, existing?: any, origins?: Record<number, string>, reason?: string | null,
 *   subject?: { version: string }, files?: typeof files, checkpoints?: Record<number, { index: number, sha256: string }>,
 *   untimed?: Record<number, readonly string[]> }} [options]
 */
async function refusedByRecorder(capture, expected, { network, fetched = false, existing = three.record, origins = three.origins,
  reason = null, subject, files: harness = files, checkpoints = pinnedAt(existing), untimed } = {}) {
  const stub = stubNetwork(network);
  const before = JSON.stringify(existing);
  const result = await recordRun({ capture, existing, files: harness, reason, fetch: stub.fetch, origins, subject, checkpoints, untimed });
  assert.ok("refusals" in result, "the recorder recorded a run it must refuse");
  assert.ok(result.refusals.some((p) => expected.test(p)),
    `expected a refusal matching ${expected}; the recorder said:\n  ${result.refusals.join("\n  ")}`);
  assert.equal(result.fetched, fetched,
    fetched ? "this refusal needs the network's facts" : "a run refusable offline must be refused before the network");
  assert.equal(stub.calls.length > 0, fetched);
  assert.equal(JSON.stringify(existing), before, "the existing record was mutated");
  return result.refusals;
}

describe("an intact revision history passes, so every refusal below is its own", () => {
  test("the synthetic capture re-derives as revision 3's bytes less the mismatched preload's control entry", () => {
    // Revision 3's cold run summed 12 requests: the eleven the scenario fetched and the opaque `link`
    // entry of the preload declared without `crossorigin`, which is a harness control. Revision 4 counts
    // eleven, with every byte figure unchanged because that entry read zero; 11 x 300 bytes of
    // per-response overhead is the whole of transfer minus encoded.
    const { figures } = deriveCapture(run("a"), { page: files.page, version: SUBJECT.version });
    assert.deepEqual(figures, { requestCount: 11, decodedBytes: 365198, encodedBytes: 131711, transferBytes: 135011 });
    assert.equal(figures.transferBytes - figures.encodedBytes, 11 * 300);
    assert.deepEqual(captureProblems(run("a"), { ...files, version: SUBJECT.version }), []);
  });

  test("a one-run and a three-run history pass the checker, and the growth in the middle carries its reason", () => {
    assert.deepEqual([...one.refusals, ...three.refusals], [], "the recorder refused the intact fixtures' own runs");
    assert.deepEqual(checkRecord(one.record, files, { origins: one.origins }), []);
    assert.deepEqual(checkRecord(three.record, files, { origins: three.origins }), []);
    assert.deepEqual(three.record.history.map((/** @type {any} */ e) => e.grew), [[], ["encodedBytes", "transferBytes"], []]);
    assert.equal(three.record.history[0].subject.integrity, integrityOf(TARBALL));
    assert.equal(three.record.history[0].userAgent, USER_AGENT);
    assert.deepEqual(Object.keys(three.record.hostPreconditions.code.headers).sort(), [...PROBED_HEADERS].sort());
  });

  test("the graph is READ from the tarball, walked from the two entry points: rc.2's eight modules, not the whole build", () => {
    assert.deepEqual(one.record.history[0].subject.graph, Object.fromEntries(CODE.map(([file, , , size]) => [file, size]).sort()));
    assert.equal(Object.hasOwn(one.record.history[0].subject.graph, "core.js"), false);
    const paths = Object.keys(one.record.history[0].subject.graph);
    assert.deepEqual(paths, [...paths].sort(), "the graph is written in path order, so two runs' graphs read alike");
  });

  test("an entry that started at the page's time origin is well-formed: a start is malformed only below it", () => {
    const capture = run("origin");
    capture.resources[0].startMs = 0;
    assert.deepEqual(captureProblems(capture, { ...files, version: SUBJECT.version }), []);
  });

  test("an entry that started exactly as the render returned is after-render, by the page's strict comparison", () => {
    const capture = run("edge");
    at(capture, "chunk-LED5CWLB").startMs = RENDERED_AT;
    pageSide(capture);
    assert.equal(at(capture, "chunk-LED5CWLB").phase, "after-render");
    assert.deepEqual(captureProblems(capture, { ...files, version: SUBJECT.version }), []);
    assert.equal(deriveCapture(capture, { page: files.page, version: SUBJECT.version }).figures.requestCount, 10);
  });

  test("a run the host served in fewer bytes needs no reason, and one given anyway is kept", async () => {
    const { record, origins, refusals } = await recorded([{ capture: compressedWorse(run("a")), network: WORSE }, { capture: run("b") },
      { capture: run("c"), reason: "test: a note on an unchanged run" }]);
    assert.deepEqual(refusals, []);
    assert.deepEqual(checkRecord(record, files, { origins }), []);
    assert.equal(record.history[2].reason, "test: a note on an unchanged run");
  });
});

/**
 * THE ABLATIONS. Each names the recipe invariant it attacks (`RECIPE.hostThresholds.invariants`), the
 * problem it must produce, and whether the recorder must refuse it too — before the network, or after
 * it for what only the network can show. `capture` ablations mutate a capture: the checker sees it in
 * place of the three-run record's own, the recorder as a fresh fourth run. `refresh` recomputes the
 * page's side afterwards, so the page is consistent and only the property under attack is wrong.
 * `record` ablations edit the three-run record; `history` ones edit its history and re-link it, so the
 * rule under attack fires and not merely the chain. `network` ablations are the recorder's alone. A
 * `reason` is given to the recorder where the attack also grows a figure, so that the run reaches the
 * rule under attack rather than the growth rule before it. A `first` ablation is recorded as the first
 * run of the revision, over a revision-3 record: a version the history has already measured is refused
 * before the network by its last run's figures (`the ratchet` below), so only a version new to the
 * history reaches the tarball's judgement, which is what these attack.
 *
 * @typedef {{ name: string, invariant: string, expected: RegExp, capture?: (c: any) => void, refresh?: boolean,
 *   record?: (r: any) => void, history?: (h: any[]) => void, network?: Stub, recorder: boolean, fetched?: boolean,
 *   reason?: string, first?: boolean }} Ablation
 * @type {Ablation[]}
 */
const ABLATIONS = [
  // THE FIGURES: re-derived, and the page's claims held to the derivation.
  { name: "the page's summary falsified", invariant: "figures", recorder: true,
    capture: (c) => { c.summary.transferBytes = 1; }, expected: /own summary says transferBytes 1; its counted resources sum to 135011/ },
  { name: "the page's summary absent", invariant: "figures", recorder: true,
    capture: (c) => { delete c.summary; }, expected: /own summary says requestCount \(absent\)/ },
  { name: "the summary claiming 99 requests", invariant: "figures", recorder: true,
    capture: (c) => { c.summary.requestCount = 99; }, expected: /own summary says requestCount 99; its counted resources sum to 11/ },
  { name: "the summary's count of excluded controls falsified", invariant: "figures", recorder: true,
    capture: (c) => { c.summary.controlsExcluded = 0; }, expected: /own summary says controlsExcluded 0; its resources show 1/ },
  { name: "a resource's readability label contradicting its sizes", invariant: "figures", recorder: true,
    capture: (c) => { c.resources.find((/** @type {any} */ r) => r.url === BLIND).readable = true; },
    expected: /1 resource\(s\) carry an origin or readability label their own URL and sizes contradict, e\.g\. http:\/\/localhost:8714/ },
  { name: "a resource's origin label contradicting its URL", invariant: "figures", recorder: true,
    capture: (c) => { c.resources[3].origin = "production-host"; },
    expected: /1 resource\(s\) carry an origin or readability label their own URL and sizes contradict, e\.g\. http:\/\/zb-test/ },
  { name: "the mismatched preload counted as the twelfth request, as revision 3 did", invariant: "figures", recorder: true,
    capture: (c) => {
      const control = c.resources.find((/** @type {any} */ r) => r.control !== null);
      Object.assign(control, { control: null, counted: true });
      c.summary.requestCount = 12;
    },
    expected: /labelled counted or control differently .*revision 4 removed/ },
  { name: "a chunk relabelled after-render, its start still before the render", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "chunk-7WU4JE3E").phase = "after-render"; },
    expected: /1 resource\(s\) are labelled with a phase their own start and the render's return contradict, e\.g\. .*chunk-7WU4JE3E/ },
  { name: "the render's return not recorded", invariant: "figures", recorder: true,
    capture: (c) => { delete c.render.renderedAtMs; },
    expected: /does not record when the render returned \(render\.renderedAtMs is null\)/ },
  { name: "the render's return at the clock's origin", invariant: "figures", recorder: true,
    capture: (c) => { c.render.renderedAtMs = 0; }, expected: /does not record when the render returned \(render\.renderedAtMs is 0\)/ },
  { name: "the render's return not a number", invariant: "figures", recorder: true,
    capture: (c) => { c.render.renderedAtMs = String(RENDERED_AT); },
    expected: /does not record when the render returned \(render\.renderedAtMs is "195\.53"\)/ },
  { name: "a resource with no start time", invariant: "figures", recorder: true,
    capture: (c) => { delete c.resources[5].startMs; }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource with a negative size", invariant: "figures", recorder: true,
    capture: (c) => { c.resources[5].transferSize = -1; }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource that is not an object", invariant: "figures", recorder: true,
    capture: (c) => { c.resources.push(null); }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource with no URL", invariant: "figures", recorder: true,
    capture: (c) => { c.resources[5].url = ""; }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource labelled with no phase the page writes", invariant: "figures", recorder: true,
    capture: (c) => { c.resources[5].phase = "during"; }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource whose readability is not a yes or a no", invariant: "figures", recorder: true,
    capture: (c) => { c.resources[5].readable = "yes"; }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource that started before the page's clock did", invariant: "figures", recorder: true,
    capture: (c) => { c.resources[5].startMs = -0.5; }, expected: /1 captured resource\(s\) are malformed/ },
  { name: "a resource with no duration", invariant: "figures", recorder: true,
    capture: (c) => { delete at(c, BLIND).durationMs; }, expected: /1 captured resource\(s\) are malformed \(no url, phase, start time, duration/ },
  { name: "a counted resource answered 404", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "chunk-LED5CWLB").responseStatus = 404; },
    expected: /1 counted resource\(s\) were not answered 200, .* e\.g\. .*chunk-LED5CWLB\.js \(status 404, initiator script\)/ },
  { name: "a counted resource answered with no status at all", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "chunk-LED5CWLB").responseStatus = 0; },
    expected: /1 counted resource\(s\) were not answered 200, .* e\.g\. .*chunk-LED5CWLB\.js \(status 0, initiator script\)/ },
  { name: "an entry point initiated by an image, not a module import", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "/lokalized.js").initiatorType = "img"; },
    expected: /1 counted resource\(s\) were not answered 200, .* e\.g\. .*lokalized\.js.* \(status 200, initiator img\)/ },
  { name: "an entry point fetched, as a catalog is, not imported", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "/lokalized.js").initiatorType = "fetch"; },
    expected: /1 counted resource\(s\) were not answered 200, .* e\.g\. .*lokalized\.js.* \(status 200, initiator fetch\)/ },
  { name: "a catalog initiated by neither its preload nor the loader's fetch", invariant: "figures", recorder: true,
    capture: (c) => { c.resources.find((/** @type {any} */ r) => r.url.includes("/en.json") && r.initiatorType === "fetch").initiatorType = "other"; },
    expected: /1 counted resource\(s\) were not answered 200, .* e\.g\. .*en\.json.* \(status 200, initiator other\)/ },
  { name: "a counted catalog completing after the render that needed it", invariant: "figures", recorder: true,
    capture: (c) => { c.resources.find((/** @type {any} */ r) => r.url.includes("/en.json") && r.initiatorType === "fetch").durationMs = 150; },
    expected: /1 counted resource\(s\) completed after the render returned, e\.g\. .*en\.json.* for 150 ms against a render returned at 195\.53/ },
  { name: "a counted module completing after the render that needed it", invariant: "figures", recorder: true,
    capture: (c) => { const chunk = at(c, "chunk-LED5CWLB"); chunk.durationMs = RENDERED_AT + 1 - chunk.startMs; },
    expected: /1 counted resource\(s\) completed after the render returned, e\.g\. .*chunk-LED5CWLB\.js, started at/ },
  { name: "no resources at all", invariant: "figures", recorder: true,
    capture: (c) => { c.resources = []; }, expected: /holds no resources, so nothing it summarises can be re-derived/ },
  { name: "a resource from an origin the recipe does not name", invariant: "figures", recorder: true,
    capture: (c) => { c.resources.push({ ...c.resources[4], url: "https://unpkg.com/lokalized@1.0.0-rc.2/dist/browser/x.js" }); },
    expected: /1 captured resource\(s\) came from neither recipe origin nor the page's own, e\.g\. https:\/\/unpkg\.com/ },
  { name: "code loaded from another version than the run's", invariant: "figures", recorder: true,
    capture: (c) => { c.origins.code = codeOriginFor("1.0.0-rc.1"); }, expected: /the capture loaded code from .*1\.0\.0-rc\.1.*, not / },
  { name: "catalogs loaded from another origin", invariant: "figures", recorder: true,
    capture: (c) => { c.origins.catalogs = "https://cdn.example/catalogs/"; },
    expected: /the capture loaded catalogs from https:\/\/cdn\.example/ },
  { name: "the site the run ran from not recorded", invariant: "figures", recorder: true,
    capture: (c) => { delete c.origins.page; }, expected: /does not record the site it ran from/ },
  { name: "the run's token absent", invariant: "figures", recorder: true,
    capture: (c) => { c.cacheBuster.parameter = "v"; }, expected: /carries no run token/ },
  { name: "the run's token empty", invariant: "figures", recorder: true,
    capture: (c) => { c.cacheBuster.value = " "; }, expected: /carries no run token/ },
  { name: "no user agent", invariant: "figures", recorder: true,
    capture: (c) => { delete c.userAgent; }, expected: /the capture records no user agent/ },
  { name: "a simulation offered as a run", invariant: "figures", recorder: true,
    capture: (c) => { c.simulated = { by: "tools/browser-0b/simulate.mjs" }; },
    expected: /the capture is a simulation \(tools\/browser-0b\/simulate\.mjs\)/ },
  { name: "the resources not a list", invariant: "figures", recorder: true,
    capture: (c) => { c.resources = { 0: c.resources[0] }; }, expected: /holds no resources, so nothing it summarises can be re-derived/ },
  { name: "a resource whose URL does not parse", invariant: "figures", recorder: true,
    capture: (c) => { c.resources.push({ ...c.resources[4], url: "http://[not a url" }); },
    expected: /1 captured resource\(s\) came from neither recipe origin nor the page's own, e\.g\. http:\/\/\[not a url/ },
  { name: "the site an opaque origin, which names no site", invariant: "figures", recorder: true,
    capture: (c) => { c.origins.page = "data:text/html,0b"; }, expected: /does not record the site it ran from \(data:text\/html,0b\)/ },
  { name: "a counted resource labelled a control, its counted label left alone", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "/lokalized.js").control = "mismatched-preload"; },
    expected: /1 resource\(s\) are labelled counted or control differently .* e\.g\. .*lokalized\.js/ },
  { name: "a counted resource labelled not counted, its control label left alone", invariant: "figures", recorder: true,
    capture: (c) => { at(c, "/lokalized.js").counted = false; },
    expected: /1 resource\(s\) are labelled counted or control differently .* e\.g\. .*lokalized\.js/ },
  { name: "the last run's figure differing from its capture's re-derivation", invariant: "figures", recorder: false,
    history: (h) => { h.at(-1).ratcheted.encodedBytes += 1; },
    expected: /last run records encodedBytes 131712; the capture's counted resources sum to 131711/ },
  // THE GRAPH: the subject's modules and the planned catalogs, each once at its size.
  { name: "a resource counted twice", invariant: "graph", recorder: true, refresh: true,
    capture: (c) => { c.resources.splice(6, 0, { ...c.resources.find((/** @type {any} */ r) => r.url.includes("chunk-7WU4JE3E")) }); },
    expected: /counts chunks\/chunk-7WU4JE3E\.js more than once/ },
  { name: "an entry point the page imports missing, a chunk named like it standing in", invariant: "graph", recorder: true, refresh: true,
    capture: (c) => { const load = c.resources.find((/** @type {any} */ r) => r.url.includes("/dist/browser/load.js"));
      load.url = load.url.replace("/dist/browser/load.js", "/dist/browser/chunks/load.js").split("?")[0]; },
    expected: /counts no load\.js from .*, which the page imports/ },
  { name: "a planned catalog missing", invariant: "graph", recorder: true, refresh: true,
    capture: (c) => keep(c, (r) => !(r.startMs < RENDERED_AT && r.url.includes("/en.json") && r.initiatorType === "fetch")),
    expected: /counts no en\.json from .*, which the loader graph fetches/ },
  { name: "a catalog at another size than the manifest declares", invariant: "graph", recorder: true, refresh: true,
    capture: (c) => { c.resources.find((/** @type {any} */ r) => r.url.includes("/fr-CA.json")).decodedBodySize = 875; },
    expected: /the capture's fr-CA\.json decoded 875 bytes, not the 876 the manifest declares for it/ },
  { name: "a catalog the loader does not plan", invariant: "graph", recorder: true, refresh: true,
    capture: (c) => { c.resources.splice(6, 0, { ...c.resources[1], url: c.resources[1].url.replace("fr-CA.json", "es.json"),
      initiatorType: "fetch" }); },
    expected: /counts es\.json from the catalog origin, which loadStrings\(manifest, 'fr'\) does not plan/ },
  { name: "a chunk of the published graph lost from the capture", invariant: "graph",
    recorder: true, fetched: true, refresh: true, first: true,
    capture: (c) => { c.resources = c.resources.filter((/** @type {any} */ r) => !r.url.includes(DROPPED)); },
    expected: /does not count chunks\/chunk-QU3LBEYR\.js, which lokalized@.*'s published graph holds/ },
  { name: "a module the published graph does not hold", invariant: "graph", recorder: true, fetched: true, refresh: true, first: true,
    capture: (c) => { c.resources.splice(6, 0, { ...c.resources[6], url: codeOriginFor(SUBJECT.version) + EXTRA[0] }); },
    expected: /counts chunks\/chunk-EXTRA123\.js from the code origin, which lokalized@.*'s published graph does not hold/ },
  { name: "a module at another size than the tarball holds it", invariant: "graph",
    recorder: true, fetched: true, refresh: true, first: true,
    capture: (c) => { c.resources.find((/** @type {any} */ r) => r.url.includes("chunk-LED5CWLB")).decodedBodySize = 1356; },
    expected: /the capture's chunks\/chunk-LED5CWLB\.js decoded 1356 bytes; lokalized@.*'s tarball holds it at 1355/ },
  { name: "an earlier run's figures not its graph's", invariant: "graph", recorder: false,
    history: (h) => { h[1].subject.graph["chunks/chunk-LED5CWLB.js"] += 1; h[0].subject.graph["chunks/chunk-LED5CWLB.js"] += 1; },
    expected: /run 1 \(.*\) records decodedBytes 365198; lokalized@.*'s published graph and the planned catalogs make 365199/ },
  // READABLE.
  { name: "a counted resource gone blind — decoded falling to a smaller figure", invariant: "readable", recorder: true, refresh: true,
    capture: (c) => { Object.assign(c.resources.find((/** @type {any} */ r) => r.url.includes("/lokalized.js")),
      { transferSize: 300, encodedBodySize: 0, decodedBodySize: 0 }); },
    expected: /1 counted resource\(s\) are unreadable, e\.g\. .*lokalized\.js/ },
  { name: "a counted resource with an encoded size that decoded nothing", invariant: "readable", recorder: true, refresh: true,
    capture: (c) => { at(c, "chunk-LED5CWLB").decodedBodySize = 0; },
    expected: /1 counted resource\(s\) are unreadable, e\.g\. .*chunk-LED5CWLB/ },
  { name: "a counted resource with a decoded size that encoded nothing", invariant: "readable", recorder: true, refresh: true,
    capture: (c) => { at(c, "chunk-LED5CWLB").encodedBodySize = 0; },
    expected: /1 counted resource\(s\) are unreadable, e\.g\. .*chunk-LED5CWLB/ },
  // THE CONTROLS.
  { name: "the matched preload reporting two entries", invariant: "preload", recorder: true, refresh: true,
    capture: (c) => { c.resources.splice(1, 0, { ...c.resources[0], initiatorType: "fetch", startMs: 2 }); },
    expected: /matched preloads did not report one entry each/ },
  { name: "the mismatched preload reported as reused", invariant: "preload", recorder: true, refresh: true,
    capture: (c) => { c.resources = c.resources.filter((/** @type {any} */ r) => r.control === null); },
    expected: /MISMATCHED preload did not report a second entry/ },
  { name: "a matched preload's one entry initiated by a fetch, at the preload's own time", invariant: "preload", recorder: true, refresh: true,
    capture: (c) => { c.resources[0].initiatorType = "fetch"; },
    expected: /matched preload's one entry for fr\.json was initiated by "fetch", not by its link/ },
  { name: "the other matched preload's one entry initiated by a fetch", invariant: "preload", recorder: true, refresh: true,
    capture: (c) => { c.resources[1].initiatorType = "fetch"; },
    expected: /matched preload's one entry for fr-CA\.json was initiated by "fetch", not by its link/ },
  { name: "a matched preload issued after the page's script read its clock, just before the loader asked", invariant: "preload",
    recorder: true, refresh: true,
    capture: (c) => { c.resources[1].startMs = 169.5; },
    expected: /matched preload's entry for fr-CA\.json started at 169\.5 ms, after the timings' start at 20\.03 ms: the page's markup/ },
  { name: "the page's preload verdict disagreeing with its resources", invariant: "preload", recorder: true,
    capture: (c) => { c.controls.preload.mismatched["en.json"] = 3; }, expected: /preload control .* is not what its resources show/ },
  { name: "the second load crossing the network", invariant: "secondLoad", recorder: true, refresh: true,
    capture: (c) => { Object.assign(c.resources.find((/** @type {any} */ r) => r.startMs > RENDERED_AT && r.deliveryType === "cache"),
      { transferSize: 687, deliveryType: "" }); },
    expected: /second-load control did not report cache delivery/ },
  { name: "the second load crossing the network, listed behind another after-render entry", invariant: "secondLoad", recorder: true,
    refresh: true,
    capture: (c) => {
      // The first after-render entry is then the blind control's, which transfers 0: a second load read from any entry but
      // fr's own would look served from cache.
      const i = c.resources.findIndex((/** @type {any} */ r) => r.startMs > RENDERED_AT && r.deliveryType === "cache");
      const [second] = c.resources.splice(i, 1);
      Object.assign(second, { transferSize: 687, deliveryType: "" });
      const b = c.resources.findIndex((/** @type {any} */ r) => r.url === BLIND);
      c.resources.splice(b + 1, 0, { ...second, startMs: c.resources[b].startMs + 1 });
    },
    expected: /second-load control did not report cache delivery/ },
  { name: "the page's second-load verdict disagreeing with its resources", invariant: "secondLoad", recorder: true,
    capture: (c) => { c.controls.secondLoad.servedFromCache = false; },
    expected: /second-load verdict \(servedFromCache false\) is not what its resources show \(true\)/ },
  { name: "the second load reading other bytes than fr's", invariant: "secondLoad", recorder: true,
    capture: (c) => { c.controls.secondLoad.bytesRead = 0; }, expected: /second-load control read 0 bytes, not fr's 909/ },
  { name: "the blind control reading a size", invariant: "blind", recorder: true, refresh: true,
    capture: (c) => { Object.assign(at(c, BLIND), { encodedBodySize: 90, decodedBodySize: 90 }); },
    expected: /blind control reported a readable size/ },
  { name: "the blind control reading a decoded size only", invariant: "blind", recorder: true, refresh: true,
    capture: (c) => { at(c, BLIND).decodedBodySize = 90; }, expected: /blind control reported a readable size/ },
  { name: "the blind control reading an encoded size only", invariant: "blind", recorder: true, refresh: true,
    capture: (c) => { at(c, BLIND).encodedBodySize = 90; }, expected: /blind control reported a readable size/ },
  { name: "a second blind entry that read a size, behind one that read 0", invariant: "blind", recorder: true, refresh: true,
    capture: (c) => { const b = c.resources.findIndex((/** @type {any} */ r) => r.url === BLIND);
      c.resources.splice(b + 1, 0, { ...c.resources[b], encodedBodySize: 90, decodedBodySize: 90, startMs: c.resources[b].startMs + 1 }); },
    expected: /the blind control left 2 resource entries; the page fetches it once/ },
  { name: "the blind control's fetch failing, its zero read anyway", invariant: "blind", recorder: true,
    capture: (c) => { c.controls.blind.fetched = false; },
    expected: /blind control's fetch did not succeed \(fetched false, status 200\)/ },
  { name: "the blind control not saying whether its fetch succeeded", invariant: "blind", recorder: true,
    capture: (c) => { delete c.controls.blind.fetched; },
    expected: /blind control's fetch did not succeed \(fetched null, status 200\)/ },
  { name: "the blind control's entry answered with no status", invariant: "blind", recorder: true, refresh: true,
    capture: (c) => { at(c, BLIND).responseStatus = 0; },
    expected: /blind control's fetch did not succeed \(fetched true, status 0\)/ },
  { name: "the page's blind verdict disagreeing with its resources", invariant: "blind", recorder: true,
    capture: (c) => { c.controls.blind.isBlind = false; },
    expected: /page's blind verdict \(isBlind false\) is not what its resources show \(true\)/ },
  { name: "the blind control leaving no entry", invariant: "blind", recorder: true, refresh: true,
    capture: (c) => { c.resources = c.resources.filter((/** @type {any} */ r) => r.url !== BLIND); },
    expected: /blind control left no resource entry/ },
  { name: "the capture naming the mismatched preload's opaque entry as its blind control", invariant: "blind",
    recorder: true, refresh: true,
    capture: (c) => { c.origins.blindControl = c.resources.find((/** @type {any} */ r) => r.control !== null).url;
      c.resources = c.resources.filter((/** @type {any} */ r) => r.url !== BLIND); },
    expected: /names its blind control https:\/\/cdn\.jsdelivr\.net\/.*en\.json.*, not the page's http:\/\/localhost:8714/ },
  { name: "the blind control on the page's own origin", invariant: "blind", recorder: true,
    capture: (c) => { c.origins.page = "http://localhost:8714"; }, expected: /blind control ran on the page's own origin/ },
  { name: "a warm run: the chunks served from the browser cache", invariant: "coldArm", recorder: true, refresh: true,
    capture: warmChunks,
    expected: /6 counted resource\(s\) did not cross the network/ },
  { name: "every counted transfer 1 byte, which cannot hold a body", invariant: "coldArm", recorder: true, refresh: true,
    capture: (c) => { for (const r of c.resources) if (r.startMs < RENDERED_AT && r.transferSize > 0) r.transferSize = 1; },
    expected: /1[01] counted resource\(s\) did not cross the network/ },
  { name: "a revalidation's shape: lokalized.js transferring its headers alone", invariant: "coldArm", recorder: true, refresh: true,
    capture: (c) => { c.resources.find((/** @type {any} */ r) => r.url.includes("/lokalized.js")).transferSize = 300; },
    expected: /1 counted resource\(s\) did not cross the network .* e\.g\. .*lokalized\.js/ },
  { name: "the chunks transferring exactly their encoded body, with no headers", invariant: "coldArm", recorder: true, refresh: true,
    capture: (c) => { for (const r of c.resources) if (r.url.includes("/chunks/")) r.transferSize = r.encodedBodySize; },
    expected: /6 counted resource\(s\) did not cross the network/ },
  { name: "the page calling a warm run cold", invariant: "coldArm", recorder: true,
    capture: warmChunks,
    expected: /page's cold-arm verdict \(contaminated false, examined 11\) is not what its resources show \(true, 11\)/ },
  { name: "a counted cache delivery that reports a transfer", invariant: "coldArm", recorder: true, refresh: true,
    capture: (c) => { at(c, "/lokalized.js").deliveryType = "cache"; },
    expected: /1 counted resource\(s\) did not cross the network .* e\.g\. .*lokalized\.js/ },
  { name: "the page's count of examined entries falsified", invariant: "coldArm", recorder: true,
    capture: (c) => { c.coldArm.examined = 3; },
    expected: /page's cold-arm verdict \(contaminated false, examined 3\) is not what its resources show \(false, 11\)/ },
  { name: "the limit arm under the boundary loading", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[0] = { maximumInputBytes: 908, outcome: "loaded", failures: [] }; },
    expected: /under the boundary did not refuse fr, and fr alone, at stage limit/ },
  { name: "the limit arm under the boundary refused at another stage", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[0].failures[0].stage = "digest"; },
    expected: /under the boundary did not refuse fr, and fr alone, at stage limit/ },
  { name: "the limit arm under the boundary refusing another locale", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[0].failures[0].locale = "en"; },
    expected: /under the boundary did not refuse fr, and fr alone, at stage limit/ },
  { name: "the limit arm under the boundary refusing fr and another", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[0].failures.push({ locale: "fr-CA", stage: "limit", message: "fr-CA: body exceeds" }); },
    expected: /under the boundary did not refuse fr, and fr alone, at stage limit/ },
  { name: "the limit arm under the boundary refused by another error than the loader's", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[0].error = "TypeError"; },
    expected: /under the boundary was refused by "TypeError", not the loader's StringsLoadingError/ },
  { name: "a third limit arm, which loaded at one byte", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms.push({ maximumInputBytes: 1, outcome: "loaded", failures: [] }); },
    expected: /records 3 streaming-limit arm\(s\); the recipe runs two/ },
  { name: "the limit arms not a list, however list-like", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms = { length: 2, 0: c.streamingLimits.arms[0], 1: c.streamingLimits.arms[1] }; },
    expected: /records no list of streaming-limit arm\(s\)/ },
  { name: "the limit arm at the boundary refusing", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[1].outcome = "refused"; },
    expected: /at the boundary did not load, so the refusal is not located there/ },
  { name: "the host no longer compressing, so the arm cannot tell wire from decoded bytes", invariant: "streamingLimit",
    recorder: true, refresh: true,
    capture: (c) => { Object.assign(c.resources[0], { encodedBodySize: 909, transferSize: 1209 }); },
    expected: /does not separate wire bytes from decoded bytes: fr is 909 encoded \/ 909 decoded/ },
  { name: "the limit arms one byte off fr's decoded size, so the boundary they find is not the decoded body's", invariant: "streamingLimit",
    recorder: true,
    capture: (c) => { c.streamingLimits.arms[0].maximumInputBytes = 907; c.streamingLimits.arms[1].maximumInputBytes = 908; },
    expected: /does not separate wire bytes from decoded bytes: fr is 387 encoded \/ 909 decoded against limits 907 \/ 908/ },
  { name: "the limit arms not one byte apart, so no boundary is located between them", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.arms[0].maximumInputBytes = 800; },
    expected: /does not separate wire bytes from decoded bytes: fr is 387 encoded \/ 909 decoded against limits 800 \/ 909/ },
  { name: "the limits in effect not recorded", invariant: "streamingLimit", recorder: true,
    capture: (c) => { delete c.streamingLimits.inEffect; },
    expected: /limits in effect \(maximumInputBytes null\) are not limits the scenario could have loaded its catalogs under: .* 909/ },
  { name: "the limits in effect a byte, beside a scenario that loaded 909", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.inEffect.maximumInputBytes = 1; },
    expected: /limits in effect \(maximumInputBytes 1\) are not limits the scenario could have loaded/ },
  { name: "the limit arm's subject another size than the manifest declares", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.subject.manifestDecodedBytes = 5; },
    expected: /streaming-limit arm's subject \{"locale":"fr","manifestDecodedBytes":5\} is not fr at the 909 bytes the manifest/ },
  { name: "the limit arm's subject another locale", invariant: "streamingLimit", recorder: true,
    capture: (c) => { c.streamingLimits.subject.locale = "en"; },
    expected: /streaming-limit arm's subject \{"locale":"en",/ },
  { name: "no streaming-limit arm", invariant: "streamingLimit", recorder: true,
    capture: (c) => { delete c.streamingLimits; }, expected: /no streaming-limit arm was recorded/ },
  { name: "fr not counted, so the limit arm's premise has nothing to stand on", invariant: "streamingLimit", recorder: true, refresh: true,
    capture: (c) => keep(c, (r) => !(r.startMs < RENDERED_AT && r.url.includes("/fr.json"))),
    expected: /fr\.json has no counted entry, so the limit arm's premise cannot be checked/ },
  // THE RENDER.
  { name: "the render wrong", invariant: "render", recorder: true,
    capture: (c) => { c.render.rendered = "Votre panier contient 3 livre."; },
    expected: /rendered "Votre panier contient 3 livre\.", not the recipe's/ },
  { name: "the render returning the key", invariant: "render", recorder: true,
    capture: (c) => { Object.assign(c.render, { rendered: "Cart.Items", renderedTheKeyBack: true }); },
    expected: /render returned the raw key/ },
  { name: "the render of another key or locale", invariant: "render", recorder: true,
    capture: (c) => { c.render.locale = "en"; }, expected: /rendered Cart\.Items in en, not the recipe's Cart\.Items in fr/ },
  { name: "the render of another key", invariant: "render", recorder: true,
    capture: (c) => { c.render.key = "Cart.Other"; }, expected: /rendered Cart\.Other in fr, not the recipe's Cart\.Items in fr/ },
  { name: "the render not saying it did not return the key", invariant: "render", recorder: true,
    capture: (c) => { delete c.render.renderedTheKeyBack; }, expected: /render returned the raw key \(or does not say it did not\)/ },
  { name: "the render returning the key while saying it did not", invariant: "render", recorder: true,
    capture: (c) => { c.render.rendered = "Cart.Items"; }, expected: /render returned the raw key \(or does not say it did not\)/ },
  { name: "a timing absent", invariant: "render", recorder: true,
    capture: (c) => { delete c.render.loadMs; },
    expected: /loadMs is null; it is reported and never gated, but it must be a finite, positive time/ },
  { name: "a timing zero", invariant: "render", recorder: true,
    capture: (c) => { c.render.coldImportMs = 0; }, expected: /coldImportMs is 0; it is reported and never gated/ },
  { name: "a timing that is not finite", invariant: "render", recorder: true,
    capture: (c) => { c.render.loadMs = Infinity; }, expected: /loadMs is null; it is reported and never gated/ },
  { name: "a timing that is not a number", invariant: "render", recorder: true,
    capture: (c) => { c.render.coldImportMs = "147.2"; }, expected: /coldImportMs is "147\.2"; it is reported and never gated/ },
  { name: "a first usable render longer than the page's clock had run", invariant: "render", recorder: true,
    capture: (c) => { c.render.firstUsableRenderMs = 999999; },
    expected: /first usable render 999999 ms is longer than the 195\.53 ms the page's clock had run when the render returned/ },
  { name: "the timings inconsistent beyond the page's rounding", invariant: "render", recorder: true,
    capture: (c) => { c.render.firstUsableRenderMs = 170.8; }, expected: /timings are inconsistent: first usable render 170\.8 ms/ },
  { name: "the timings starting after the page's first code request", invariant: "render", recorder: true,
    capture: (c) => { Object.assign(c.render, { firstUsableRenderMs: 60, coldImportMs: 10, loadMs: 40 }); },
    expected: /timings start after its own requests: .* therefore at 135\.53 ms — later than the first code request, made at 3[89]\.\d+ ms/ },
  { name: "a cold import ending before the code it imported had arrived", invariant: "render", recorder: true,
    capture: (c) => { c.render.coldImportMs = 20; },
    expected: /cold import ended before its code arrived: from the timings' start at 20\.03 ms it took 20 ms, and the last code entry/ },
  { name: "the page reporting a problem of its own", invariant: "render", recorder: true,
    capture: (c) => { c.problems.push("synthetic page problem"); }, expected: /the capture reported: synthetic page problem/ },
  { name: "the page's problems list absent", invariant: "render", recorder: true,
    capture: (c) => { delete c.problems; }, expected: /carries no problems list; absence is not agreement/ },
  // THE HOST.
  { name: "a required host header missing", invariant: "host", recorder: true, fetched: true, network: { drop: "timing-allow-origin" },
    record: (r) => { r.hostPreconditions.catalogs.headers["timing-allow-origin"] = null; },
    expected: /the (catalogs|code) origin sent no timing-allow-origin/ },
  { name: "the catalogs served from a branch, not a commit", invariant: "host",
    recorder: true, fetched: true, network: { catalogsPinnedTo: "branch" },
    record: (r) => {
      r.hostPreconditions.catalogs.headers["x-jsd-version-type"] = "branch"; r.hostPreconditions.catalogsPinnedToCommit = false;
    },
    expected: /catalogs are not pinned to a commit/ },
  { name: "the code served from a tag, not an exact version", invariant: "host",
    recorder: true, fetched: true, network: { codePinnedTo: "tag" },
    record: (r) => { r.hostPreconditions.code.headers["x-jsd-version-type"] = "tag"; r.hostPreconditions.codePinnedToVersion = false; },
    expected: /code under measurement is not pinned to an exact published version/ },
  { name: "the code pin recorded false beside a version header", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions.codePinnedToVersion = false; }, expected: /code under measurement is not pinned to an exact/ },
  { name: "the catalog pin recorded false beside a commit header", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions.catalogsPinnedToCommit = false; }, expected: /catalogs are not pinned to a commit/ },
  { name: "the content encoding not what was probed", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions.contentEncoding = "identity"; },
    expected: /recorded content encoding "identity" is not the code probe's "br"/ },
  { name: "the catalog probe naming another content encoding than the host's", invariant: "host",
    recorder: true, fetched: true, network: { headers: (url, h) => { if (url.includes("/gh/")) h["content-encoding"] = "gzip"; } },
    record: (r) => { r.hostPreconditions.catalogs.headers["content-encoding"] = "gzip"; },
    expected: /catalog probe was sent "gzip", not the host's recorded "br": the record keeps one content encoding/ },
  { name: "the host relabelled identity everywhere, beside compressed bytes", invariant: "host",
    recorder: true, fetched: true, network: { headers: (_url, h) => { h["content-encoding"] = "identity"; } },
    record: (r) => {
      r.hostPreconditions.contentEncoding = "identity";
      for (const probe of ["code", "catalogs"]) r.hostPreconditions[probe].headers["content-encoding"] = "identity";
      r.history.at(-1).contentEncoding = "identity";
    },
    expected: /the (code|catalogs) probe was sent (lokalized\.js|fr\.json) with no content coding \(identity\), and the capture's .* is (64728|387) encoded \/ (184494|909) decoded/ },
  { name: "a probe taken at another URL", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions.code.url += "?x"; }, expected: /the code host probe was taken at .*lokalized\.js\?x, not / },
  { name: "a probe not recording every header it asked for", invariant: "host", recorder: false,
    record: (r) => { delete r.hostPreconditions.code.headers["content-length"]; },
    expected: /the code host probe records \[.*\], not every header/ },
  { name: "the host preconditions carrying a field the recorder never writes", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions.region = "fra"; },
    expected: /host preconditions carry \[.*region.*\], not the five the recorder writes/ },
  { name: "no host preconditions", invariant: "host", recorder: false,
    record: (r) => { delete r.hostPreconditions; }, expected: /carries no host preconditions/ },
  { name: "host preconditions recorded as null", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions = null; }, expected: /carries no host preconditions/ },
  { name: "a probe whose headers are null", invariant: "host", recorder: false,
    record: (r) => { r.hostPreconditions.code.headers = null; }, expected: /the code host probe records \[\], not every header/ },
  { name: "a probe sent another length than the browser measured — gzip beside a br-sized capture", invariant: "host",
    recorder: true, fetched: true,
    network: { headers: (url, h) => {
      if (url.includes("/npm/")) Object.assign(h, { "content-encoding": "gzip", "content-length": "71234" });
    } },
    record: (r) => { r.hostPreconditions.catalogs.headers["content-length"] = "400"; },
    expected: /probe was sent (71234|400) bytes of (gzip|br) for (lokalized\.js|fr\.json), and the capture's .* is (64728|387) encoded/ },
  // THE SUBJECT.
  { name: "the tarball not matching the registry's integrity", invariant: "subject", recorder: true, fetched: true,
    network: { integrity: "sha512-" + "A".repeat(86) + "==" }, expected: /hashes to sha512-.*not the integrity the registry states/ },
  { name: "an unpublished subject", invariant: "subject", recorder: true, fetched: true, network: { registryStatus: 404 },
    expected: /answered 404 for lokalized@.*; SUBJECT must name a published version/ },
  { name: "the registry's document for another package", invariant: "subject", recorder: true, fetched: true,
    network: { doc: (d) => ({ ...d, name: "not-lokalized" }) },
    expected: /the npm registry's document is not-lokalized@.*, not lokalized@/ },
  { name: "the registry's document for another version", invariant: "subject", recorder: true, fetched: true,
    network: { doc: (d) => ({ ...d, version: "1.0.0-rc.1" }) }, expected: /document is lokalized@1\.0\.0-rc\.1, not lokalized@/ },
  { name: "the registry naming a tarball off its own path", invariant: "subject", recorder: true, fetched: true,
    network: { doc: (d) => ({ ...d, dist: { ...d.dist, tarball: "https://evil.example/lokalized.tgz" } }) },
    expected: /names its tarball at https:\/\/evil\.example\/lokalized\.tgz, which is not under/ },
  { name: "the tarball not served", invariant: "subject", recorder: true, fetched: true, network: { tarballStatus: 500 },
    expected: /the npm registry answered 500 for the tarball/ },
  { name: "the registry unreachable", invariant: "subject", recorder: true, fetched: true,
    network: { fail: (url) => url.startsWith(REGISTRY) },
    expected: /the npm registry could not be read for lokalized@.*: stub: .* is unreachable/ },
  { name: "a tarball whose browser build is not a graph the walker can read", invariant: "subject", recorder: true, fetched: true,
    network: { tarball: publishedTarball({ loadImports: 'import ( "./chunks/chunk-NZVWUS27.js");' }) },
    expected: /graph of lokalized@.* could not be read from its tarball: .*in a spelling tools\/graph-walk\.mjs does not recognise/ },
  { name: "one version recorded with two digests", invariant: "subject", recorder: false,
    history: (h) => { h.at(-1).subject.tarballSha256 = "0".repeat(64); },
    expected: /run 2 .* with digests or a graph an earlier run recorded differently/ },
  { name: "one version recorded with two graphs", invariant: "subject", recorder: false,
    history: (h) => { h[0].subject.graph = { ...h[0].subject.graph, "chunks/chunk-LED5CWLB.js": 1354, "chunks/chunk-ZSYPX2PV.js": 348 }; },
    expected: /run 1 .* with digests or a graph an earlier run recorded differently/ },
  { name: "a subject carrying a field nothing measured", invariant: "subject", recorder: false,
    history: (h) => { h.at(-1).subject.provenance = "attested by publish.yml"; },
    expected: /run 2 .*'s subject carries \[.*provenance.*\], not the version/ },
  { name: "a subject with no integrity", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) e.subject.integrity = "sha1-x"; },
    expected: /run 0 .* carries no sha512 registry integrity for its tarball/ },
  { name: "a subject with no tarball digest", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) e.subject.tarballSha256 = "x"; }, expected: /run 0 .* carries no sha256 of its tarball/ },
  { name: "a subject naming no exact version", invariant: "subject", recorder: false,
    history: (h) => { h[0].subject.version = "next"; }, expected: /run 0 .* names no exact version \(next\)/ },
  { name: "a subject whose graph lacks an entry point", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) delete e.subject.graph["load.js"]; }, expected: /run 0 .* carries no published graph/ },
  { name: "a subject whose graph climbs out of the build", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) e.subject.graph["../package.json"] = 20; }, expected: /run 0 .* carries no published graph/ },
  { name: "a subject whose graph holds a module of no size", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) e.subject.graph["load.js"] = 0; }, expected: /run 0 .* carries no published graph/ },
  { name: "a subject whose graph holds a module of a fractional size", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) e.subject.graph["load.js"] = 20600.5; }, expected: /run 0 .* carries no published graph/ },
  { name: "a subject with no graph at all", invariant: "subject", recorder: false,
    history: (h) => { for (const e of h) delete e.subject.graph; }, expected: /run 0 .* carries no published graph/ },
];

describe("each ablation is refused with its own problem", () => {
  for (const ablation of ABLATIONS) {
    // An ablation of what only the network shows — the registry's answer — has no record to attack:
    // the recorder, which fetches it, is its whole subject.
    if (ablation.capture || ablation.record || ablation.history)
      test(`checker: ${ablation.name}`, () => {
        if (ablation.history) {
          const { record, origins } = rechained(three.record, ablation.history);
          refusedByChecker(record, origins, ablation.expected);
          return;
        }
        const record = clone(three.record);
        if (ablation.capture) {
          ablation.capture(record.capture);
          if (ablation.refresh) pageSide(record.capture);
        }
        ablation.record?.(record);
        refusedByChecker(record, three.origins, ablation.expected);
      });
    if (ablation.recorder)
      test(`recorder: ${ablation.name}`, async () => {
        const capture = run("d");
        if (ablation.capture) {
          ablation.capture(capture);
          if (ablation.refresh) pageSide(capture);
        }
        // A revision's first run over an earlier revision's record says why the revision was cut: without it the
        // run is refused for that before the network, and never reaches the rule the ablation attacks.
        await refusedByRecorder(capture, ablation.expected, { network: ablation.network, fetched: ablation.fetched ?? false,
          reason: ablation.reason ?? (ablation.first ? FIRST_RUN_REASON : null),
          ...(ablation.first ? { existing: revision3Record("r3-ablation"), origins: {} } : {}) });
      });
  }

  test("every invariant the recipe declares is attacked by an ablation above", () => {
    const attacked = new Set(ABLATIONS.map((a) => a.invariant));
    assert.deepEqual(Object.keys(RECIPE.hostThresholds.invariants).filter((key) => !attacked.has(key)), []);
    assert.deepEqual([...attacked].filter((key) => !(key in RECIPE.hostThresholds.invariants)), []);
  });

  test("the timing rule allows exactly the page's rounding: 0.15 ms short passes, 0.2 does not", () => {
    for (const [renderMs, ok] of /** @type {const} */ ([[170.85, true], [170.8, false]])) {
      const record = clone(three.record);
      record.capture.render.firstUsableRenderMs = renderMs;
      record.history.at(-1).reported.firstUsableRenderMs = renderMs;
      const problems = checkRecord(record, files, { origins: three.origins });
      assert.equal(problems.some((p) => /timings are inconsistent/.test(p)), !ok, `${renderMs}: ${problems.join("; ")}`);
    }
  });

  test("the render's duration may exceed the clock it was read from by the page's rounding alone: 0.05 ms passes, 0.1 does not", () => {
    for (const [over, ok] of /** @type {const} */ ([[0.05, true], [0.1, false]])) {
      const capture = run("clock");
      capture.render.firstUsableRenderMs = RENDERED_AT + over;
      const problems = captureProblems(capture, { ...files, version: SUBJECT.version });
      assert.equal(problems.some((p) => /longer than the 195\.53 ms the page's clock had run/.test(p)), !ok,
        `${over}: ${problems.join("; ")}`);
    }
  });

  test("the timings are held to the capture's own timeline: r4a-1's pass, and the reviews' sets on its clock do not", () => {
    const version = SUBJECT.version;
    assert.deepEqual(captureProblems(onR4aClock(run("r4")), { ...files, version }), [], "the recorded run's own timeline");
    const starts = /the capture's timings start after its own requests/;
    const imports = /the capture's cold import ended before its code arrived/;
    const asked = /the capture's cold import ended after its loader asked for a catalog: .* fetched a catalog at 190 ms/;
    const loaded = /the capture's load ended before its catalogs arrived: .* the last counted catalog completed at 211\.9 ms/;
    const parsed = /the matched preload's entry for fr\.json started at 7\.7\d* ms, after the timings' start at 0\.1 ms/;
    // Each consistent with itself and with the render's clock — what the rules before these checked — and not with the
    // resources, which place the start at 22.2 ms, the code's last byte at 151.7, the loader's first fetch at 190 and the
    // last catalog's last byte at 211.9: 2.1 / 1 / 1 starts the timings at 230.9 ms, after a code request made at 22.4 and a
    // loader fetch at 190; 210.8 / 200 / 10.8 ends the import at 222.2, after that fetch; 210.8 / 156.6 / 1 ends the load at
    // 179.8, before en.json arrived; 232.9 / 232.7 / 0.1 starts the clock at 0.1 ms, before the preloads the page's markup
    // issued at 7.7 and 7.9. Each set is refused by exactly the rules named for it, so each rule is shown refusing alone.
    for (const [renderMs, importMs, loadMs, expected, name] of /** @type {const} */ ([
      [2.1, 1, 1, [starts, asked], "2.1/1/1"], [60, 10, 40, [starts], "60/10/40"], [200, 190, 0.5, [starts, asked], "200/190/0.5"],
      [210.8, 100, 110.8, [imports], "210.8/100/110.8"], [210.8, 200, 10.8, [asked], "210.8/200/10.8"],
      [210.8, 156.6, 1, [loaded], "210.8/156.6/1"], [232.9, 232.7, 0.1, [asked, parsed], "232.9/232.7/0.1"]])) {
      const capture = onR4aClock(run("r4"));
      Object.assign(capture.render, { firstUsableRenderMs: renderMs, coldImportMs: importMs, loadMs });
      const problems = captureProblems(capture, { ...files, version });
      assert.deepEqual(problems.filter((p) => !expected.some((rule) => rule.test(p))), [], `${name}: only its own rules refuse it`);
      for (const rule of expected) assert.ok(problems.some((p) => rule.test(p)), `${name}: ${rule} did not refuse it: ${problems.join("; ")}`);
      assert.equal(problems.length, expected.length, `${name}: ${problems.join("; ")}`);
    }
  });

  test("the timeline rules allow exactly the page's rounding: a start 0.05 ms after the first request passes, 0.1 does not; an " +
    "import 0.15 ms short of its code passes, 0.2 does not", () => {
    const version = SUBJECT.version;
    const capture = run("round");
    const code = capture.resources.filter((/** @type {any} */ r) => r.initiatorType === "script");
    const first = Math.min(...code.map((/** @type {any} */ r) => r.startMs));
    const last = Math.max(...code.map((/** @type {any} */ r) => r.startMs + r.durationMs));
    for (const [over, ok] of /** @type {const} */ ([[0.05, true], [0.1, false]])) {
      const moved = clone(capture);
      moved.render.renderedAtMs = first + over + moved.render.firstUsableRenderMs;
      pageSide(moved);
      const problems = captureProblems(moved, { ...files, version });
      assert.equal(problems.some((p) => /timings start after its own requests/.test(p)), !ok, `${over}: ${problems.join("; ")}`);
    }
    const start = capture.render.renderedAtMs - capture.render.firstUsableRenderMs;
    for (const [short, ok] of /** @type {const} */ ([[0.15, true], [0.2, false]])) {
      const moved = clone(capture);
      moved.render.coldImportMs = +(last - start - short).toFixed(6);
      const problems = captureProblems(moved, { ...files, version });
      assert.equal(problems.some((p) => /cold import ended before its code arrived/.test(p)), !ok, `${short}: ${problems.join("; ")}`);
    }
  });

  test("the loader's rules allow exactly the page's rounding: its first fetch 0.1 ms before the import's end passes, 0.15 does not; " +
    "a catalog completing 0.2 ms after the load's end passes, 0.25 does not; a preload 0.05 ms after the clock's start passes, 0.1 does " +
    "not", () => {
    const version = SUBJECT.version;
    const capture = run("loader");
    const start = capture.render.renderedAtMs - capture.render.firstUsableRenderMs;
    const imported = start + capture.render.coldImportMs;
    const loaderOf = (/** @type {any} */ c) => c.resources.find((/** @type {any} */ r) => r.url.includes("/en.json") && r.initiatorType === "fetch");
    for (const [early, ok] of /** @type {const} */ ([[0.1, true], [0.15, false]])) {
      const moved = clone(capture);
      loaderOf(moved).startMs = imported - early;
      const problems = captureProblems(moved, { ...files, version });
      assert.equal(problems.some((p) => /cold import ended after its loader asked for a catalog/.test(p)), !ok, `${early}: ${problems.join("; ")}`);
    }
    // It is the loader's FIRST request that the import must precede, not its last: a second catalog it fetched before the
    // import ended is refused beside the one it fetched after.
    const twice = clone(capture);
    Object.assign(twice.resources[1], { initiatorType: "fetch", startMs: imported - 0.15 });
    assert.ok(captureProblems(twice, { ...files, version }).some((p) => /ended after its loader asked for a catalog: .* fetched a catalog at /
      .test(p)));
    // The load waits for every catalog it planned, the preloads it reused among them: here the matched fr-CA preload's.
    for (const [over, ok] of /** @type {const} */ ([[0.2, true], [0.25, false]])) {
      const moved = clone(capture);
      const preload = moved.resources[1];
      preload.durationMs = imported + moved.render.loadMs + over - preload.startMs;
      const problems = captureProblems(moved, { ...files, version });
      assert.equal(problems.some((p) => /load ended before its catalogs arrived/.test(p)), !ok, `${over}: ${problems.join("; ")}`);
      if (ok) assert.deepEqual(problems, []);
    }
    for (const [over, ok] of /** @type {const} */ ([[0.05, true], [0.1, false]])) {
      const moved = clone(capture);
      moved.resources[1].startMs = start + over;
      const problems = captureProblems(moved, { ...files, version });
      assert.equal(problems.some((p) => /matched preload's entry for fr-CA\.json started at .* after the timings' start/.test(p)), !ok,
        `${over}: ${problems.join("; ")}`);
    }
  });

  test("a counted resource may complete as the render returns, within the duration's rounding: 0.05 ms after passes, 0.1 does not",
    () => {
      for (const [over, ok] of /** @type {const} */ ([[0.05, true], [0.1, false]])) {
        const capture = run("done");
        const loader = capture.resources.find((/** @type {any} */ r) => r.url.includes("/en.json") && r.initiatorType === "fetch");
        loader.durationMs = RENDERED_AT + over - loader.startMs;
        const problems = captureProblems(capture, { ...files, version: SUBJECT.version });
        assert.equal(problems.some((p) => /completed after the render returned/.test(p)), !ok, `${over}: ${problems.join("; ")}`);
      }
    });

  test("the review's two preload probes on r4a-1's clock are refused: neither preload issued, and one arriving after the render", () => {
    const version = SUBJECT.version;
    // The matched link entries relabelled as the loader's fetches at 189.8 ms, their durations kept: a run in which neither
    // preload was issued, which passed printing "preload matched".
    const fetched = onR4aClock(run("r4f"));
    for (const [i, start] of /** @type {const} */ ([[0, 189.8], [1, 189.85]])) Object.assign(fetched.resources[i], { initiatorType: "fetch", startMs: start });
    pageSide(fetched);
    assert.deepEqual(fetched.controls.preload.matched, { "fr.json": 1, "fr-CA.json": 1 }, "the count still reads as reuse");
    const first = captureProblems(fetched, { ...files, version });
    assert.ok(first.some((p) => /matched preload's one entry for fr\.json was initiated by "fetch", not by its link/.test(p)), first.join("\n"));
    // …and with a duration that lands before the render, so only the preload rules can see it.
    for (const r of fetched.resources.slice(0, 2)) r.durationMs = 20;
    const landed = captureProblems(fetched, { ...files, version });
    assert.deepEqual(landed.map((p) => p.replace(/for fr(-CA)?\.json/, "for …")), [
      "the matched preload's one entry for … was initiated by \"fetch\", not by its link: one entry per file is equally a preload " +
      "never issued and a loader that fetched the file itself",
      "the matched preload's entry for … started at 189.8 ms, after the timings' start at 22.2 ms: the page's markup issues its " +
      "preloads as it is parsed, before its script reads that clock, so an entry issued later is not the preload the loader reused"]);
    // …and a `link` entry issued there, 0.1 ms before the loader asked at 190: the rule that compared a preload with the loader
    // alone passed it (review, 2026-09-26).
    const linked = onR4aClock(run("r4l"));
    Object.assign(linked.resources[0], { startMs: 189.9, durationMs: 20 });
    pageSide(linked);
    assert.deepEqual(captureProblems(linked, { ...files, version }), ["the matched preload's entry for fr.json started at 189.9 ms, after " +
      "the timings' start at 22.2 ms: the page's markup issues its preloads as it is parsed, before its script reads that clock, so an " +
      "entry issued later is not the preload the loader reused"]);
    // Initiator "other", started at 232.9 ms, 88 ms long: after the loader's fetch at 190, and complete after the render.
    const late = onR4aClock(run("r4o"));
    for (const i of [0, 1]) Object.assign(late.resources[i], { initiatorType: "other", startMs: 232.9, durationMs: 88 });
    pageSide(late);
    const second = captureProblems(late, { ...files, version });
    for (const expected of [/initiated by "other", not by its link/, /started at 232\.9 ms, after the timings' start at 22\.2 ms/,
      /completed after the render returned/, /not requested the way the scenario requests them/, /load ended before its catalogs arrived/])
      assert.ok(second.some((p) => expected.test(p)), `${expected}:\n${second.join("\n")}`);
  });

  test("the limit arm still separates wire from decoded bytes with fr's wire size AT the refused limit, and not one byte over", () => {
    for (const [encoded, ok] of /** @type {const} */ ([[908, true], [909, false]])) {
      const capture = run("wire");
      Object.assign(capture.resources[0], { encodedBodySize: encoded, transferSize: encoded + 300 });
      pageSide(capture);
      const problems = captureProblems(capture, { ...files, version: SUBJECT.version });
      assert.equal(problems.some((p) => /does not separate wire bytes from decoded bytes/.test(p)), !ok,
        `${encoded}: ${problems.join("; ")}`);
    }
  });

  test("the limits in effect may be exactly the largest catalog the scenario loaded, and not one byte less", () => {
    for (const [limit, ok] of /** @type {const} */ ([[909, true], [908, false]])) {
      const capture = run("effect");
      capture.streamingLimits.inEffect.maximumInputBytes = limit;
      const problems = captureProblems(capture, { ...files, version: SUBJECT.version });
      assert.equal(problems.some((p) => /limits in effect \(maximumInputBytes 908\) are not limits the scenario could have loaded/.test(p)),
        !ok, `${limit}: ${problems.join("; ")}`);
      if (ok) assert.deepEqual(problems, []);
    }
  });

  test("each probe is tied to its own file, whatever order the capture lists its resources in", () => {
    const record = clone(three.record);
    record.capture.resources.reverse();
    assert.deepEqual(checkRecord(record, files, { origins: three.origins }), []);
  });

  test("a host that states no length ties nothing, and is recorded as not having stated one", async () => {
    const { record, origins, refusals } = await recorded([{ capture: run("d"), network: { drop: "content-length" } }],
      three.record, three.origins);
    assert.deepEqual(refusals, []);
    assert.equal(record.hostPreconditions.code.headers["content-length"], null);
    assert.deepEqual(checkRecord(record, files, { origins }), []);
  });
});

describe("the record's own shape", () => {
  /** @type {[string, (r: any) => void, RegExp][]} */
  const edits = [
    ["no capture", (r) => { r.capture = null; }, /the record holds no capture/],
    ["a capture that is not an object", (r) => { r.capture = "a capture"; }, /the record holds no capture/],
    ["a history that is not a list", (r) => { r.history = {}; }, /carries no history/],
    ["a history that is a string", (r) => { r.history = "run 0"; }, /carries no history/],
    ["a history holding an entry that is not an object", (r) => { r.history.push(null); }, /holds an entry that is not an object/],
    ["host preconditions that are not an object", (r) => { r.hostPreconditions = "br"; }, /carries no host preconditions/],
    ["a key the recorder never writes",
      (r) => { r.figures = { requestCount: 11 }; }, /the record carries \[.*figures.*\], not the keys the recorder writes/],
    ["another format", (r) => { r.formatVersion = 1; }, /the record is formatVersion 1; revision \d+ records formatVersion 2/],
    ["no note", (r) => { r.note = " "; }, /carries no note saying what it is/],
    ["its copy of the recipe edited",
      (r) => { r.recipe = { ...r.recipe, region: "fra" }; }, /copy of its recipe does not hash to its own recipeSha256/],
    ["no priorRevisions", (r) => { delete r.priorRevisions; }, /carries no priorRevisions list/],
    ["the harness binding absent", (r) => { delete r.harnessSha256.server; }, /does not say which serve\.mjs it was taken with/],
    ["taken with another page",
      (r) => { r.harnessSha256.page = "0".repeat(64); }, /tools\/browser-0b\/index\.html has changed since the recorded run/],
    ["a newer revision", (r) => { r.recipeSha256 = "f".repeat(64); r.recipe = { ...r.recipe, revision: REVISION + 1 }; },
      new RegExp(`the record is revision ${REVISION + 1}, newer than this checkout's recipe`)],
    ["another recipe at the same revision",
      (r) => { r.recipeSha256 = "f".repeat(64); },
      /the record's recipe \(ffffffffffff -> .*\) differs from this checkout's at the same revision/],
  ];
  for (const [name, edit, expected] of edits)
    test(name, () => { const record = clone(three.record); edit(record); refusedByChecker(record, three.origins, expected); });

  test("an absent record is never agreement", () => {
    refusedByChecker(null, three.origins, /measurements\/scenario-0b\.json is absent\. Absence is never agreement/);
  });

  test("a record under ANOTHER self-consistent recipe at this revision is refused, and the recorder will not append to it", async () => {
    // Its copy of its recipe hashes to its own digest, which is all the record's own validity can ask; only the currency
    // term sees it. A review had the recorder append to it, the recipe copy silently replaced with this checkout's.
    const other = clone(three.record);
    other.recipe = { ...other.recipe, region: "pinned to one edge" };
    other.recipeSha256 = createHash("sha256").update(JSON.stringify(other.recipe)).digest("hex");
    refusedByChecker(other, three.origins, /the record's recipe \(.*\) differs from this checkout's at the same revision/);
    await refusedByRecorder(run("d"), new RegExp(`existing record's recipe \\(${other.recipeSha256.slice(0, 12)}\\) is not the one ` +
      `frozen for revision ${REVISION} .*Restore the committed record \\(git checkout HEAD`), { existing: other });
  });
});

describe("the history's own rules", () => {
  /** @type {[string, (h: any[]) => void, RegExp][]} */
  const edits = [
    ["an entry carrying a key the recorder never writes", (h) => { h[1].note = "x"; }, /run 1 .* has keys \[.*note.*\], not \[/],
    ["an entry naming no run", (h) => { h[1].run = "nameless"; }, /run 1 \(nameless\) names no run/],
    ["an entry naming a blank run", (h) => { h[1].run = " "; }, /run 1 \( \) names no run/],
    ["a reported figure of no time", (h) => { h[0].reported.loadMs = 0; }, /run 0 .* records no loadMs; it is reported and never gated/],
    ["a reported figure that is not a number",
      (h) => { h[0].reported.coldImportMs = "147.2"; }, /run 0 .* records no coldImportMs; it is reported and never gated/],
    ["an entry naming no user agent", (h) => { h[1].userAgent = ""; }, /run 1 .* records no user agent/],
    ["an entry naming no content encoding", (h) => { h[0].contentEncoding = null; }, /run 0 .* records no content encoding/],
    ["a ratcheted figure beside the four",
      (h) => { h[0].ratcheted.extraFigure = 1; }, /run 0 .* records ratcheted figures \[.*extraFigure.*\], not \[/],
    ["a ratcheted figure that is not a count", (h) => { h[0].ratcheted.transferBytes = 1.5; }, /run 0 .* records no transferBytes$/],
    ["a reported figure beside the three",
      (h) => { h[0].reported.ttfbMs = 1; }, /run 0 .* records reported figures \[.*ttfbMs.*\], not \[/],
    ["a reported figure absent", (h) => { delete h[0].reported.loadMs; }, /run 0 .* records no loadMs; it is reported and never gated/],
    ["a reason that is not a sentence", (h) => { h[2].reason = ""; }, /run 2 .*'s reason is neither null nor a sentence/],
    ["growth recorded with no reason",
      (h) => { h[1].reason = null; },
      /run 1 .* grew with no recorded reason over http:\/\/zb-test-a\.localhost:8713 a-1 — encoded 131711 -> 131761: the decoded/],
  ];
  for (const [name, edit, expected] of edits)
    test(name, () => { const { record, origins } = rechained(three.record, edit); refusedByChecker(record, origins, expected); });

  test("`grew` is recomputed: an entry claiming less growth than its figures show is refused", () => {
    const { record, origins } = rechained(three.record, (h) => { h[1].grew = ["encodedBytes"]; });
    refusedByChecker(record, origins,
      /run 1 .* records growth in \[encodedBytes\] while its figures grew in \[encodedBytes,transferBytes\]/);
  });

  test("the newest run cut off the end — a valid chain — is refused, because the capture is no longer its run's", () => {
    const record = clone(three.record);
    record.history.pop();
    refusedByChecker(record, three.origins, /the history's last run is .*b-1, but the record holds the capture of .*c-1/);
    const problems = checkRecord(record, files, { origins: three.origins });
    assert.ok(problems.some((p) => /last run records encodedBytes 131761; the capture's counted resources sum to 131711/.test(p)),
      problems.join("\n"));
  });

  test("the newest run's other ties to its capture: version, timings, user agent, encoding", () => {
    /** @type {[(h: any[]) => void, RegExp][]} */
    const ties = [
      [(h) => { h[2].reported.coldImportMs = 147.3; }, /last run records coldImportMs 147\.3; the capture says 147\.2/],
      [(h) => { h[2].userAgent = "Mozilla/5.0 Firefox"; }, /last run names a user agent the capture does not/],
      [(h) => { h[2].contentEncoding = "gzip"; }, /last run names a content encoding the host preconditions do not/],
    ];
    for (const [edit, expected] of ties) {
      const { record, origins } = rechained(three.record, edit);
      refusedByChecker(record, origins, expected);
    }
    const other = rechained(three.record, (h) => { h[2].subject.version = "1.0.0-rc.9"; });
    refusedByChecker(other.record, other.origins, /last run measured 1\.0\.0-rc\.9, but the capture loaded code from .*1\.0\.0-rc\.2/);
  });

  test("a run, or a site, is recorded once — and neither a port nor a subdomain is a new site", async () => {
    await refusedByRecorder(run("c"), /zb-test-c\.localhost:8713 c-1 is already in the record/);
    await refusedByRecorder(syntheticCapture({ site: site("c"), token: "c-2" }),
      /already ran a recorded run, so this one cannot have been cold/);
    await refusedByRecorder(syntheticCapture({ site: "http://zb-test-c.localhost:9999", token: "c-port" }),
      /http:\/\/zb-test-c\.localhost already ran a recorded run/);
    assert.equal(siteOf("http://zb-test-c.localhost:9999 x"), siteOf("http://zb-test-c.localhost:8713 y"));
    assert.notEqual(siteOf("http://zb-test-c.localhost:8713 x"), siteOf("https://zb-test-c.localhost:8713 x"));
    // …nor a subdomain: Chromium's site is the registrable domain, and this reads a host's last two labels, never finer.
    await refusedByRecorder(syntheticCapture({ site: "http://www.zb-test-c.localhost:8713", token: "c-www" }),
      /http:\/\/zb-test-c\.localhost already ran a recorded run/);
    assert.equal(siteOf("http://www.zb-test-c.localhost:8713 x"), siteOf("http://zb-test-c.localhost:8713 y"));
    // An IPv4 address is its own site: its last two labels name no domain.
    assert.notEqual(siteOf("http://10.0.0.1:8713 x"), siteOf("http://10.1.0.1:8713 x"));
    assert.equal(siteOf("http://10.0.0.1:9999 x"), "http://10.0.0.1");
    const doubled = rechained(three.record, (h) => { h.push({ ...h[2] }); });
    refusedByChecker(doubled.record, doubled.origins, /run 3 .* appears twice/);
    // The CHECKER's own site rule, apart from the recorder's: a last run relabelled onto run 0's site.
    const reused = rechained(three.record, (h) => { h[2].run = `${site("a")} c-1`; });
    reused.record.capture.origins.page = site("a");
    refusedByChecker(reused.record, reused.origins, /run 2 \(http:\/\/zb-test-a\.localhost:8713 c-1\) ran from a site an earlier run used/);
  });

  test("an earlier revision's run is context, never a baseline, and its own recipe's — and the new revision says why", async () => {
    const earlier = revision3Record("r3");
    // A run whose encoded bytes grew over revision 3's grew over nothing in THIS revision, which is exactly why a revision's
    // first run carries a reason whatever its figures: renumbering the recipe would otherwise admit any growth unexplained.
    await refusedByRecorder(compressedWorse(run("a")), new RegExp(`this run starts revision ${REVISION}'s history beside revision 3's ` +
      "run http://zb-test-r3\\.localhost:8713 r3-1, and is compared with nothing: re-run with --reason"),
    { existing: earlier, origins: {}, network: WORSE });
    const { record, origins, refusals } = await recorded([{ capture: compressedWorse(run("a")), network: WORSE,
      reason: FIRST_RUN_REASON }], earlier);
    assert.deepEqual(refusals, []);
    assert.deepEqual([record.history[0].grew, record.history[0].reason], [[], FIRST_RUN_REASON], "the reason is kept on the run");
    assert.deepEqual(record.priorRevisions.map((/** @type {any} */ p) => [p.revision, p.figures.requestCount, p.comparable]),
      [[3, 12, false]]);
    assert.deepEqual(checkRecord(record, files, { origins }), []);
    await refusedByRecorder(syntheticCapture({ site: site("r3"), token: "r3-2" }), /cannot have been cold/, { existing: record, origins });
    // EACH RULE ON THE LIST ALONE, the list re-bound so the binding does not fire first: its recipe, its incomparability, and
    // its order — before this revision, ascending, one run per revision, an integer.
    const order = /priorRevisions holds a run attributed to revision \S+ that is out of order, not that revision's frozen recipe/;
    for (const forge of [(/** @type {any[]} */ p) => { p[0].recipeSha256 = RECIPE_DIGESTS[2]; },
      (/** @type {any[]} */ p) => { p[0].comparable = true; },
      (/** @type {any[]} */ p) => { Object.assign(p[0], { revision: REVISION, recipeSha256: RECIPE_DIGESTS[REVISION] }); },
      (/** @type {any[]} */ p) => { p[0].revision = String(p[0].revision); },
      (/** @type {any[]} */ p) => { p.push({ ...p[0], run: `${site("r3x")} r3x-1` }); },
      (/** @type {any[]} */ p) => { p.push(REVISION_2_RUN); }]) {
      const forged = reprior(record, forge);
      refusedByChecker(forged.record, forged.origins, order);
    }
    // …and the same list in order passes, so each refusal above is its rule's.
    const ordered = reprior(record, (p) => { p.unshift(REVISION_2_RUN); });
    assert.deepEqual(checkRecord(ordered.record, files, { origins: ordered.origins }), []);
    // THE CHECKER HOLDS THE FIRST RUN TO ITS REASON TOO, for a record written without the recorder: the reason removed and the
    // first run re-frozen is refused — unless the run predates runs carrying their timelines, as revision 4's own first did.
    const unexplained = rechained(record, (h) => { h[0].reason = null; });
    refusedByChecker(unexplained.record, unexplained.origins, new RegExp(`run 0 .* starts revision ${REVISION}'s history beside ` +
      "revision 3's run and is compared with nothing, but records no reason why the revision was cut"));
    const predating = rechained(record, (h) => { h[0].reason = null; delete h[0].timingsSha256; });
    assert.deepEqual(checkRecord(predating.record, files, { origins: predating.origins,
      untimed: { [REVISION]: [timingsOf(record.capture)] } }), []);
  });

  test("the context is BOUND to the history: priorRevisions emptied or edited is refused, and a spent site stays spent", async () => {
    const { record, origins, refusals } = await recorded([{ capture: run("a"), reason: FIRST_RUN_REASON }], revision3Record("r3"));
    assert.deepEqual(refusals, []);
    const bound = /run 0 \(.*\) was recorded beside other priorRevisions than the record holds .* Restore the committed record/;
    const emptied = clone(record);
    emptied.priorRevisions = [];
    refusedByChecker(emptied, origins, bound);
    const edited = clone(record);
    edited.priorRevisions[0].figures.requestCount = 1;
    refusedByChecker(edited, origins, bound);
    // A review emptied the list and then recorded a run from revision 3's spent site; the recorder refuses the record first.
    await refusedByRecorder(syntheticCapture({ site: site("r3"), token: "r3-2" }),
      /existing record: .*recorded beside other priorRevisions/,
      { existing: emptied, origins });
    // Re-binding every run to the edit changes the first run, which is frozen: the edit then needs a source edit too.
    const rebound = reprior(record, (p) => { p.length = 0; });
    refusedByChecker(rebound.record, origins, /does not start at the entry frozen for it/);
  });

  test("an earlier revision's own context is carried forward with it when a new revision starts", async () => {
    const carrying = { ...revision3Record("r3"), priorRevisions: [REVISION_2_RUN] };
    const { record, origins, refusals } = await recorded([{ capture: run("a"), reason: FIRST_RUN_REASON }], carrying);
    assert.deepEqual(refusals, []);
    assert.deepEqual(record.priorRevisions.map((/** @type {any} */ p) => p.revision), [2, 3]);
    assert.deepEqual(checkRecord(record, files, { origins }), []);
    await refusedByRecorder(syntheticCapture({ site: site("r2"), token: "r2-2" }), /zb-test-r2\.localhost already ran a recorded run/,
      { existing: record, origins });
  });
});

describe("the ratchet", () => {
  test("a grown run without --reason is refused before the network, naming what grew and the likely cause", async () => {
    const refusals = await refusedByRecorder(compressedWorse(run("d")),
      /grew over http:\/\/zb-test-c\.localhost:8713 c-1 — encoded 131711 -> 131761: the decoded bytes did not move, so the HOST/);
    // …once: the run before it is also its version's last run, and one run is one clause.
    assert.deepEqual(refusals.filter((p) => /grew over/.test(p)).map((p) => p.split(" over ").length - 1), [1]);
    const agent = run("d");
    for (const r of agent.resources) if (r.url.includes("/chunks/")) r.transferSize += 10;
    agent.userAgent = "Mozilla/5.0 (synthetic) Chrome/153.0.0.0";
    await refusedByRecorder(pageSide(agent),
      /transfer 135011 -> 135071: encoded bytes and requests did not move, so the browser's .* accounting did \(the user agent changed\)/);
  });

  test("a reason of nothing but spaces is no reason: a growth, and a new revision's first run, are refused before the network", async () => {
    await refusedByRecorder(compressedWorse(run("d")), /this run grew over .*re-run with --reason "what grew and why"/, { reason: "   " });
    await refusedByRecorder(run("a"), /this run starts revision \d+'s history beside revision 3's run .*re-run with --reason/,
      { existing: revision3Record("r3"), origins: {}, reason: " " });
  });

  test("one version's graph cannot move: a lost, an added or a resized module is refused BEFORE the network, whatever the reason",
    async () => {
      const measured = new RegExp(`lokalized@${V} was measured by http://zb-test-c\\.localhost:8713 c-1 at `);
      const noReason = /one published version's graph cannot move, so the capture lost a resource or counts one its graph does not hold/;
      for (const [capture, figures] of /** @type {const} */ ([
        [run("d", { dropChunk: true }),
          /requestCount 11 and decodedBytes 365198, and this capture counts requestCount 10 and decodedBytes 364539/],
        [run("d", { extraChunk: true }),
          /requestCount 11 and decodedBytes 365198, and this capture counts requestCount 12 and decodedBytes 365545/],
      ])) {
        const refusals = await refusedByRecorder(capture, figures, { reason: "test: a reason cannot admit a lost or a doubled resource" });
        assert.ok(refusals.some((p) => measured.test(p) && noReason.test(p)), refusals.join("\n"));
        // …and, with no reason, it is not ALSO told that a reason would admit it.
        const bare = await refusedByRecorder(capture, noReason);
        assert.equal(bare.some((p) => /--reason/.test(p)), false, bare.join("\n"));
      }
      const resized = run("d");
      resized.resources.find((/** @type {any} */ r) => r.url.includes("chunk-LED5CWLB")).decodedBodySize = 1356;
      await refusedByRecorder(pageSide(resized), /at decodedBytes 365198, and this capture counts decodedBytes 365199/, { reason: "test" });
      // The checker's own message for such growth, on a history edited to hold it: the same cause, named from the record.
      const { record, origins } = rechained(three.record, (h) => { h[2].ratcheted.requestCount += 1; });
      refusedByChecker(record, origins,
        new RegExp(`run 2 .* grew with no recorded reason over http://zb-test-b\\.localhost:8713 b-1 — requests 11 -> 12: that run ` +
          `measured ${V} too, and one version's graph cannot move`));
    });

  test("a release that adds a chunk: its growth needs a reason, and the graph says which module", async () => {
    const tarball = publishedTarball({ extraChunk: true });
    const capture = syntheticCapture({ site: site("rel"), token: "rel-1", version: NEXT.version, extraChunk: true });
    await refusedByRecorder(capture, /requests 11 -> 12, decoded 365198 -> 365545: the published files of 9\.9\.9 differ from/,
      { subject: NEXT, files: nextFiles, network: { tarball } });
    const { record, origins, refusals } = await recorded([{ capture, subject: NEXT, files: nextFiles, network: { tarball },
      reason: "test: 9.9.9 adds a chunk" }], three.record, three.origins);
    assert.deepEqual(refusals, []);
    assert.deepEqual(checkRecord(record, nextFiles, { origins, subject: NEXT }), []);
    // The newest run is named by no later one, so its reason can be removed without breaking the chain: the growth rule is what refuses it.
    const reasonless = clone(record);
    reasonless.history.at(-1).reason = null;
    refusedByChecker(reasonless, origins,
      new RegExp("run 3 .* grew with no recorded reason over http://zb-test-c\\.localhost:8713 c-1 — requests 11 -> 12, " +
        "decoded 365198 -> 365545: " +
        `the published files of 9\\.9\\.9 differ from ${V}'s — chunks/chunk-EXTRA123\\.js added \\(347 bytes\\)`),
      { files: nextFiles, subject: NEXT });
    // …and until that run exists, a moved SUBJECT fails the old record as stale, not as broken.
    refusedByChecker(three.record, three.origins, new RegExp(`SUBJECT is 9\\.9\\.9 and the record's last run measured ${V}`),
      { subject: NEXT, files: nextFiles });
  });

  test("a release that adds a request while every byte figure falls — a chunk split in two — needs a reason for the request alone",
    async () => {
      // The one change that can grow the request count without growing a byte: nothing but `requestCount` in the growth rule
      // can see it, and a review found no fixture here that would fail without it (2026-09-26).
      const tarball = publishedTarball({ split: true });
      const capture = syntheticCapture({ site: site("split"), token: "split-1", version: NEXT.version, split: true });
      const { figures } = deriveCapture(capture, { page: nextFiles.page, version: NEXT.version });
      const was = three.record.history.at(-1).ratcheted;
      assert.equal(figures.requestCount, was.requestCount + 1);
      for (const f of /** @type {const} */ (["decodedBytes", "encodedBytes", "transferBytes"]))
        assert.ok(figures[f] < was[f], `${f}: ${figures[f]} is not below ${was[f]}`);
      await refusedByRecorder(capture, new RegExp("this run grew over http://zb-test-c\\.localhost:8713 c-1 — requests 11 -> 12: the " +
        `published files of 9\\.9\\.9 differ from ${V}'s\\. A ratcheted figure grows only with a stated reason`),
      { subject: NEXT, files: nextFiles, network: { tarball } });
      const { record, origins, refusals } = await recorded([{ capture, subject: NEXT, files: nextFiles, network: { tarball },
        reason: "test: 9.9.9 splits a chunk in two" }], three.record, three.origins);
      assert.deepEqual(refusals, []);
      assert.deepEqual(record.history.at(-1).grew, ["requestCount"]);
      assert.deepEqual(checkRecord(record, nextFiles, { origins, subject: NEXT }), []);
      const reasonless = rechained(record, (h) => { h[3].reason = null; });
      refusedByChecker(reasonless.record, reasonless.origins, new RegExp("run 3 .* grew with no recorded reason over " +
        `http://zb-test-c\\.localhost:8713 c-1 — requests 11 -> 12: the published files of 9\\.9\\.9 differ from ${V}'s — ` +
        "chunks/chunk-AAAA1111\\.js added \\(38100 bytes\\), chunks/chunk-BBBB2222\\.js added \\(38000 bytes\\), " +
        "chunks/chunk-LNGUQ7KN\\.js removed \\(76894 bytes\\)$"), { files: nextFiles, subject: NEXT });
    });

  test("the timings are reported and never compared: a later run slower in all three needs no reason, and nothing grew", async () => {
    // A33: latency cannot block a release. A ratchet on the timings, or a fixed threshold, would make this run need a reason
    // or refuse it. A thousand times slower — a first usable render of nearly three minutes — so that no ceiling a
    // threshold could plausibly be set at lets it through: a review's 400 ms ceiling passed a run only twice as slow.
    const slow = slower(run("slow"), 1000);
    for (const f of /** @type {const} */ (["firstUsableRenderMs", "coldImportMs", "loadMs"]))
      assert.ok(slow.render[f] > three.record.capture.render[f], `${f} did not grow`);
    assert.ok(slow.render.firstUsableRenderMs > 170_000, String(slow.render.firstUsableRenderMs));
    const result = await recordRun({ capture: slow, existing: three.record, files, reason: null, fetch: stubNetwork().fetch,
      origins: three.origins });
    assert.ok("record" in result, "refusals" in result ? result.refusals.join("\n") : "");
    assert.deepEqual([result.entry.grew, result.entry.reason], [[], null]);
    assert.deepEqual(grewOver(three.record.history, result.entry), []);
    assert.deepEqual(checkRecord(result.record, files, { origins: three.origins }), []);
  });

  test("a capture replayed under a new token and a new site is refused: its timeline is an earlier run's", async () => {
    // The record's own capture, and run 0's, whose capture has left the record and whose timeline its entry keeps.
    await refusedByRecorder(replayed(three.record.capture, "z"),
      /this capture's resource timings — every start and duration — are an earlier run's: it is that run replayed/);
    await refusedByRecorder(replayed(run("a"), "y"), /are an earlier run's/);
    // …and the capture of the record a new revision's first run replaces, which no history of the new revision holds.
    const refusals = await refusedByRecorder(replayed(one.record.capture, "q"), /are an earlier run's/,
      { existing: asRevision3(one.record), origins: { 3: originOf(one) }, reason: FIRST_RUN_REASON });
    assert.equal(refusals.length, 1, refusals.join("\n"));
    // …and ANY run of that record, whose captures leave the record with it: the context the new revision keeps holds every
    // run's timeline, so neither the first run nor a later one can replay one (a review found only the replaced record's
    // own capture held, 2026-09-26) — and the checker holds every run of the new revision to them too.
    const earlier = { 3: originOf(three) };
    await refusedByRecorder(replayed(run("a"), "p"), /are an earlier run's/,
      { existing: asRevision3(three.record), origins: earlier, reason: FIRST_RUN_REASON });
    const started = await recorded([{ capture: run("d"), reason: FIRST_RUN_REASON }, { capture: run("e") }], asRevision3(three.record), earlier);
    assert.deepEqual(started.refusals, []);
    assert.deepEqual(started.record.priorRevisions.at(-1).timings, three.record.history.map((/** @type {any} */ e) => e.timingsSha256));
    await refusedByRecorder(replayed(run("b"), "o"), /are an earlier run's/, { existing: started.record, origins: started.origins });
    const carried = rechained(started.record, (h) => { h[0].timingsSha256 = three.record.history[1].timingsSha256; });
    refusedByChecker(carried.record, carried.origins,
      /run 0 .* carries the capture timings of a run of revision 3, kept in priorRevisions: every start and duration the same/);
    const malformed = reprior(started.record, (p) => { p[0].timings = ["timings"]; });
    refusedByChecker(malformed.record, malformed.origins, /priorRevisions holds revision 3's run with timings \["timings"\], which are not/);
    // Every entry carries the digest, and the checker holds the history to it: two runs sharing one, the newest not the
    // capture's, and an entry with none.
    const twice = rechained(three.record, (h) => { h[1].timingsSha256 = h[0].timingsSha256; });
    refusedByChecker(twice.record, twice.origins,
      /run 1 .* carries the capture timings of run 0 \(http:\/\/zb-test-a\.localhost:8713 a-1\): every start and duration the same/);
    // …and two runs apart, not only neighbours: the newest carrying run 0's.
    const apart = rechained(three.record, (h) => { h[2].timingsSha256 = h[0].timingsSha256; });
    refusedByChecker(apart.record, apart.origins,
      /run 2 .* carries the capture timings of run 0 \(http:\/\/zb-test-a\.localhost:8713 a-1\): every start and duration the same/);
    const unbound = rechained(three.record, (h) => { h[2].timingsSha256 = "0".repeat(64); });
    refusedByChecker(unbound.record, unbound.origins,
      /the history's last run was taken with capture timings 000000000000; the record's capture's resources give/);
    const none = rechained(three.record, (h) => { h[1].timingsSha256 = "timings"; });
    refusedByChecker(none.record, none.origins, /run 1 .* records no digest of its capture's timings/);
    assert.equal(three.record.history[2].timingsSha256, timingsOf(three.record.capture));
    // The digest is the timeline's as a set: the same entries listed in another order are the same capture.
    const reordered = clone(three.record.capture);
    reordered.resources.reverse();
    assert.equal(timingsOf(reordered), timingsOf(three.record.capture));
  });

  test("the context a new revision keeps holds each replaced run's timeline: the frozen one for a run that predates the field, and a " +
    "history-less record's capture's", async () => {
    // Revision 4's own run 0 is such a run: its timeline is frozen in HISTORY_UNTIMED, not on its entry.
    const untimedRun = rechained(one.record, (h) => { delete h[0].timingsSha256; });
    const frozen = timingsOf(one.record.capture);
    const kept = await recordRun({ capture: run("d"), existing: asRevision3(untimedRun.record), files, reason: FIRST_RUN_REASON,
      fetch: stubNetwork().fetch, origins: { 3: originOf(untimedRun) }, untimed: { 3: [frozen] } });
    assert.ok("record" in kept, "refusals" in kept ? kept.refusals.join("\n") : "");
    assert.deepEqual(kept.record.priorRevisions.at(-1).timings, [frozen]);
    const historyless = { ...revision3Record("r3"), capture: run("r3") };
    const fromCapture = await recordRun({ capture: run("d"), existing: historyless, files, reason: FIRST_RUN_REASON,
      fetch: stubNetwork().fetch, origins: {} });
    assert.ok("record" in fromCapture, "refusals" in fromCapture ? fromCapture.refusals.join("\n") : "");
    assert.deepEqual(fromCapture.record.priorRevisions.at(-1).timings, [timingsOf(run("r3"))]);
    // …and a capture with no resources has no timeline to keep.
    const empty = await recorded([{ capture: run("d"), reason: FIRST_RUN_REASON }], revision3Record("r3"));
    assert.deepEqual(empty.record.priorRevisions.at(-1).timings, []);
  });

  test("a run recorded before runs carried their timings is held to the digest frozen for it, while its capture is the record's and after",
    async () => {
      const untimedRun = rechained(one.record, (h) => { delete h[0].timingsSha256; });
      const frozen = { [REVISION]: [timingsOf(one.record.capture)] };
      assert.deepEqual(checkRecord(untimedRun.record, files, { origins: untimedRun.origins, untimed: frozen }), []);
      // Unfrozen it is a run missing a field; frozen wrongly, its capture is not the run's; and a run the list does not
      // cover carries the field.
      refusedByChecker(untimedRun.record, untimedRun.origins, /run 0 .* has keys \[.*\], not \[.*timingsSha256/);
      refusedByChecker(untimedRun.record, untimedRun.origins, /the history's last run was taken with capture timings 000000000000/,
        { untimed: { [REVISION]: ["0".repeat(64)] } });
      refusedByChecker(one.record, one.origins, /run 0 .* has keys \[.*timingsSha256.*\], not \[/, { untimed: frozen });
      // Once a later run replaces its capture in the record, a replay of it is still refused: the frozen digest names it.
      const two = await recordRun({ capture: run("b"), existing: untimedRun.record, files, reason: null, fetch: stubNetwork().fetch,
        origins: untimedRun.origins, untimed: frozen });
      assert.ok("record" in two, "refusals" in two ? two.refusals.join("\n") : "");
      assert.deepEqual(checkRecord(two.record, files, { origins: untimedRun.origins, untimed: frozen }), []);
      await refusedByRecorder(replayed(one.record.capture, "y"), /are an earlier run's/,
        { existing: two.record, origins: untimedRun.origins, untimed: frozen });
      const repeated = rechained(two.record, (h) => { h[1].timingsSha256 = frozen[REVISION]?.[0]; });
      refusedByChecker(repeated.record, repeated.origins, /run 1 .* carries the capture timings of run 0/, { untimed: frozen });
    });

  test("a release's first run that lost a chunk is refused: the tarball names it", async () => {
    await refusedByRecorder(syntheticCapture({ site: site("rel"), token: "rel-1", version: NEXT.version, dropChunk: true }),
      /does not count chunks\/chunk-QU3LBEYR\.js, which lokalized@9\.9\.9's published graph holds/,
      { subject: NEXT, files: nextFiles, fetched: true });
  });

  test("a smaller release needs no reason — and a lost chunk on a return to the older version is still refused", async () => {
    const smaller = publishedTarball({ dropChunk: true });
    const capture = syntheticCapture({ site: site("rel"), token: "rel-1", version: NEXT.version, dropChunk: true });
    const { record, origins, refusals } = await recorded([{ capture, subject: NEXT, files: nextFiles, network: { tarball: smaller } }],
      three.record, three.origins);
    assert.deepEqual(refusals, []);
    assert.equal(record.history.at(-1).ratcheted.requestCount, 10);
    assert.deepEqual(checkRecord(record, nextFiles, { origins, subject: NEXT }), []);
    // Back to the first version, 10 requests short of its own graph: a review's alternating-versions route past a rule that
    // compared only neighbours. The run before it measured 10; the version's LAST run, two back, measured 11.
    await refusedByRecorder(run("back", { dropChunk: true }),
      new RegExp(`lokalized@${V} was measured by http://zb-test-c\\.localhost:8713 c-1 at requestCount 11 and decodedBytes 365198`),
      { existing: record, origins });
  });

  test("a version's growth is held to that version's last run too: alternating versions does not launder the host's", async () => {
    // A review's route past a rule that compared only neighbours: rc.2, a release 500 bytes worse recorded with its reason,
    // then rc.2 again 50 bytes worse than rc.2's own last run — smaller than its neighbour, so it read as no growth.
    /** @param {any} capture @param {number} by */
    const worse = (capture, by) => {
      const main = capture.resources.find((/** @type {any} */ r) => r.url.includes("/lokalized.js"));
      main.encodedBodySize += by; main.transferSize += by;
      return pageSide(capture);
    };
    const stating = (/** @type {number} */ length) => /** @type {Stub} */ ({ headers: (url, h) => {
      if (url.includes("/npm/")) h["content-length"] = String(length); } });
    const release = worse(syntheticCapture({ site: site("alt"), token: "alt-1", version: NEXT.version }), 500);
    const { record, origins, refusals } = await recorded([{ capture: release, subject: NEXT, files: nextFiles, network: stating(65228),
      reason: "test: 9.9.9, which the host compressed 500 bytes worse" }], three.record, three.origins);
    assert.deepEqual(refusals, []);
    await refusedByRecorder(worse(run("back"), 50), new RegExp(`this run grew over http://zb-test-c\\.localhost:8713 c-1 \\(the last ` +
      `run of ${V}\\) — encoded 131711 -> 131761: the decoded bytes did not move, so the HOST compressed the same files differently`),
    { existing: record, origins, network: stating(64778) });
    // With its reason it is recorded, and both figures the host moved are named.
    const kept = await recorded([{ capture: worse(run("back"), 50), network: stating(64778),
      reason: "test: rc.2 compressed 50 bytes worse than its own last run" }], record, origins);
    assert.deepEqual(kept.refusals, []);
    assert.deepEqual(kept.record.history.at(-1).grew, ["encodedBytes", "transferBytes"]);
    assert.deepEqual(checkRecord(kept.record, files, { origins }), []);
    // The checker recomputes it: that run as the neighbour-only rule wrote it — no growth, no reason — is refused.
    const laundered = rechained(kept.record, (h) => { Object.assign(h[4], { grew: [], reason: null }); });
    refusedByChecker(laundered.record, laundered.origins,
      /run 4 .* records growth in \[\] while its figures grew in \[encodedBytes,transferBytes\]/);
    // Its growth is named against the one run it grew over: its neighbour, the release, was bigger in both figures.
    const reasonless = rechained(kept.record, (h) => { h[4].reason = null; });
    const problems = refusedByChecker(reasonless.record, reasonless.origins, new RegExp(`run 4 .* grew with no recorded reason over ` +
      `http://zb-test-c\\.localhost:8713 c-1 \\(the last run of ${V}\\) — encoded 131711 -> 131761: the decoded bytes did not ` +
      "move, so the HOST compressed the same files differently; transfer 135011 -> 135061$"));
    assert.equal(problems.some((p) => /alt-1/.test(p)), false, problems.join("\n"));
  });

  test("a revision's history must start at its frozen first run: an unfrozen origin names the exact line to add", async () => {
    const problems = checkRecord(one.record, files, { origins: {} });
    assert.deepEqual(problems, [`revision ${REVISION}'s history has no frozen first run. Add this line inside HISTORY_ORIGINS in ` +
      `tools/0b-recipe.mjs:\n  ${REVISION}: "${entryDigest(one.record.history[0])}",`]);
    await refusedByRecorder(run("d"), /existing record: .*no frozen first run/, { existing: one.record, origins: {} });
  });

  test("the chain: a deleted, reordered, edited or replaced run is refused", () => {
    const mutate = (/** @type {(h: any[]) => any[]} */ edit) => ({ ...clone(three.record), history: edit(clone(three.record.history)) });
    refusedByChecker(mutate((h) => [h[0], h[2]]), three.origins, /history entry 1 does not follow entry 0/);
    refusedByChecker(mutate((h) => [h[0], h[2], h[1]]), three.origins, /does not follow/);
    refusedByChecker(mutate((h) => { h[1].reason = "rewritten later"; return h; }),
      three.origins, /history entry 2 does not follow entry 1/);
    refusedByChecker(mutate((h) => h.slice(1)), three.origins, /does not start at the entry frozen for it/);
    refusedByChecker(mutate((h) => { h[0].ratcheted.transferBytes -= 1; return h; }),
      three.origins, /does not start at the entry frozen for it/);
    refusedByChecker(mutate(() => []), three.origins, /carries no history/);
    refusedByChecker(mutate(() => []), {}, /carries no history/);
  });

  test("a deleted record cannot restart the history: the recorder refuses before the network, naming the committed record", async () => {
    await refusedByRecorder(run("d", { extraChunk: true }),
      /history is frozen to start at .* restore the committed record \(git checkout HEAD -- measurements\/scenario-0b\.json\)/,
      { existing: null, reason: "start over" });
  });

  test("a new revision starts from the committed record: over none, or an older one, while an earlier revision is frozen, it is refused",
    async () => {
      // A review deleted the record and renumbered the recipe, and a heavier run then passed as the new revision's first run
      // with no trace of the revision before it (2026-09-26). Here revision 3 keeps a history — the three-run one, relabelled —
      // whose first run is frozen as HISTORY_ORIGINS would freeze it.
      const earlier = { 3: originOf(three) };
      await refusedByRecorder(run("d"), /revision 3's history is frozen in HISTORY_ORIGINS, and no record holds it: .* Restore the committed record/,
        { existing: null, origins: earlier, reason: "test: starting over" });
      const revision2 = { ...revision3Record("r2"), recipe: { revision: 2 }, recipeSha256: RECIPE_DIGESTS[2] };
      await refusedByRecorder(run("d"), /revision 3's history is frozen in HISTORY_ORIGINS, and this record is revision 2: /,
        { existing: revision2, origins: earlier, reason: "test: starting from an older record" });
      // …and over that revision's own record, frozen through its newest run, it starts, keeping that run as its context.
      const { record, refusals } = await recorded([{ capture: run("d"), reason: FIRST_RUN_REASON }], asRevision3(three.record), earlier);
      assert.deepEqual(refusals, []);
      assert.deepEqual(record.priorRevisions.map((/** @type {any} */ p) => [p.revision, p.run]), [[3, `${site("c")} c-1`]]);
    });

  test("the record a new revision replaces must be its revision's frozen history, not a record carrying its number", async () => {
    // A review's hand-written stub — revision 4's number and digest, an empty history, an empty context — was accepted as the
    // record replaced, and the record written over it erased revision 3's and 4's runs; so was the live record with run 0's
    // reason edited (2026-09-26). One revision down here: the three-run history, relabelled revision 3 and frozen for it.
    const earlier = { 3: originOf(three) };
    const through = { 3: checkpointOf(three.record.history) };
    const not = /the record this run replaces is not revision 3's frozen history \(/;
    const HEAD = /a new revision starts from the committed record\. Restore it \(git checkout HEAD -- measurements\/scenario-0b\.json\)$/;
    const stub = { formatVersion: 2, recipe: { revision: 3 }, recipeSha256: RECIPE_DIGESTS[3], history: [], priorRevisions: [] };
    const forged = await refusedByRecorder(run("d"), new RegExp(`${not.source}.*carries no history`),
      { existing: stub, origins: earlier, checkpoints: through, reason: FIRST_RUN_REASON });
    assert.ok(forged.some((p) => not.test(p) && HEAD.test(p)), forged.join("\n"));
    const edited = asRevision3(three.record);
    edited.history[0].reason = "test: a reason written after the run";
    await refusedByRecorder(run("d"), new RegExp(`${not.source}.*does not start at the entry frozen for it`),
      { existing: edited, origins: earlier, checkpoints: through, reason: FIRST_RUN_REASON });
    // A later run's reason rewritten and every later link recomputed: a valid chain from the frozen first run, which the
    // checkpoint frozen for the history as recorded refuses.
    const rewritten = asRevision3(rechained(three.record, (h) => { h[1].reason = "test: a different sentence, written later"; }).record);
    await refusedByRecorder(run("d"), new RegExp(`${not.source}.*history entry 2 is not the entry its tool freezes`),
      { existing: rewritten, origins: earlier, checkpoints: through, reason: FIRST_RUN_REASON });
    // The history cut back to its first two runs, and a checkpoint behind the newest run: both leave a run nothing froze.
    await refusedByRecorder(run("d"), new RegExp(`${not.source}.*entries were cut from its end`),
      { existing: asRevision3({ ...three.record, history: three.record.history.slice(0, 2) }), origins: earlier, checkpoints: through,
        reason: FIRST_RUN_REASON });
    for (const checkpoint of [checkpointOf(three.record.history.slice(0, 2)), null])
      await refusedByRecorder(run("d"), new RegExp(`${not.source}HISTORY_CHECKPOINTS does not freeze its newest run, run 2\\)`),
        { existing: asRevision3(three.record), origins: earlier, checkpoints: { 3: /** @type {any} */ (checkpoint) }, reason: FIRST_RUN_REASON });
    // A history its revision never froze, and a context its runs were not recorded beside.
    await refusedByRecorder(run("d"), new RegExp(`${not.source}HISTORY_ORIGINS freezes no first run for revision 3\\)`),
      { existing: asRevision3(three.record), origins: {}, checkpoints: through, reason: FIRST_RUN_REASON });
    await refusedByRecorder(run("d"), new RegExp(`${not.source}its priorRevisions are not the ones its runs were recorded beside\\)`),
      { existing: { ...asRevision3(three.record), priorRevisions: [REVISION_2_RUN] }, origins: earlier, checkpoints: through,
        reason: FIRST_RUN_REASON });
    // …and the same record, intact and frozen through its newest run, starts the history: each refusal above is its own.
    const result = await recordRun({ capture: run("d"), existing: asRevision3(three.record), files, reason: FIRST_RUN_REASON,
      fetch: stubNetwork().fetch, origins: earlier, checkpoints: through });
    assert.ok("record" in result, "refusals" in result ? result.refusals.join("\n") : "");
  });

  test("a revision that renumbers the recipe and changes nothing else is refused, by the checker and by the recorder", async () => {
    assert.deepEqual(renumberProblems(), [], "this recipe is not a renumber");
    const renumbered = new RegExp(`recipe revision ${REVISION + 1} is revision ${REVISION}'s recipe with nothing changed but its number`);
    assert.match(renumberProblems({ ...RECIPE, revision: REVISION + 1 }).join("\n"), renumbered);
    // Every earlier revision is compared, not only the one before it; and a revision that changes anything else is a new
    // scenario, which this does not judge.
    assert.match(renumberProblems({ ...RECIPE, revision: REVISION + 2 }).join("\n"), new RegExp(`is revision ${REVISION}'s recipe`));
    assert.deepEqual(renumberProblems({ ...RECIPE, revision: REVISION + 1, region: "RECORDED per run" }), []);
    // THROUGH THE TOOLS: a copy whose recipe is renumbered and its digest frozen, which is all the review's renumber was.
    const copy = mkdtempSync(join(scratch, "renumbered-"));
    for (const file of ["tools/0b-recipe.mjs", "tools/0b-checks.mjs", "tools/ratchet-chain.mjs", "tools/graph-walk.mjs",
      "tools/browser-0b/record.mjs"]) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(root, file), join(copy, file));
    }
    const recipePath = join(copy, "tools/0b-recipe.mjs");
    const recipe = readFileSync(recipePath, "utf8");
    const digest = createHash("sha256").update(JSON.stringify({ ...RECIPE, revision: REVISION + 1 })).digest("hex");
    const frozenLine = `  ${REVISION}: "${recipeSha256}",\n`;
    const text = recipe.replace(`revision: ${REVISION},`, `revision: ${REVISION + 1},`)
      .replace(frozenLine, `${frozenLine}  ${REVISION + 1}: "${digest}",\n`);
    assert.equal(text.split(`revision: ${REVISION + 1},`).length, 2, "the renumber did not land");
    assert.equal(text.split(digest).length, 2, "the renumbered digest was not frozen");
    writeFileSync(recipePath, text);
    const tools = /** @type {{ recipeProblems: () => string[] }} */ (await import(pathToFileURL(recipePath).href));
    assert.deepEqual(tools.recipeProblems(), [], "the copy's recipe is frozen for its revision, so only the renumber rule can see it");
    const { checkRecord: checkCopy } = await import(pathToFileURL(join(copy, "tools/0b-checks.mjs")).href);
    assert.ok(checkCopy(null, files).some((/** @type {string} */ p) => renumbered.test(p)));
    const { recordRun: recordCopy } = await import(pathToFileURL(join(copy, "tools/browser-0b/record.mjs")).href);
    const stub = stubNetwork();
    const result = await recordCopy({ capture: compressedWorse(run("rn")), existing: three.record, files, reason: null, fetch: stub.fetch,
      origins: three.origins, checkpoints: pinnedAt(three.record), untimed: {} });
    assert.ok("refusals" in result && result.refusals.some((/** @type {string} */ p) => renumbered.test(p)), JSON.stringify(result));
    assert.deepEqual(stub.calls, [], "refused before the network");
  });

  test("the recorder refuses to append to a history the checker refuses, or to a record it cannot place", async () => {
    const broken = clone(three.record);
    broken.history[1].reason = "edited by hand";
    await refusedByRecorder(run("d"), /existing record: .*entry 2 does not follow entry 1/, { existing: broken });
    await refusedByRecorder(run("d"),
      /names no recipe revision; restore the committed record \(git checkout HEAD -- measurements\/scenario-0b\.json\)/,
      { existing: { note: "?" } });
    const newer = { ...clone(three.record), recipe: { ...three.record.recipe, revision: REVISION + 1 } };
    await refusedByRecorder(run("d"), new RegExp(`existing record is revision ${REVISION + 1}, newer than this recipe's ${REVISION}`),
      { existing: newer });
  });

  test("the recorder refuses what only the finished record shows, after the network, and writes nothing", async () => {
    await refusedByRecorder(run("d"), /the record it would write: the code origin sent no content-encoding/,
      { fetched: true, network: { headers: (url, h) => { if (url.includes("/npm/")) h["content-encoding"] = ""; } } });
    await refusedByRecorder(run("d"), /the host could not be probed at .*fr\.json: stub: .* is unreachable/,
      { fetched: true, network: { fail: (url) => url.includes("/gh/") } });
  });
});

describe("the checkpoint: the end of the chain, pinned in source", () => {
  // The review's rollback: the true latest run is a release measured at 10 requests; the record rolled back from git to
  // the three-run state it had before that run is a valid chain, and a release run at 11 then records with no reason.
  const smaller = publishedTarball({ dropChunk: true });
  const latest = recorded([{ capture: syntheticCapture({ site: site("x7a"), token: "x7a-1", version: NEXT.version, dropChunk: true }),
    subject: NEXT, files: nextFiles, network: { tarball: smaller } }], three.record, three.origins);
  const eleven = () => syntheticCapture({ site: site("x7b"), token: "x7b-1", version: NEXT.version });
  const HEAD = /Restore the committed record \(git checkout HEAD -- measurements\/scenario-0b\.json\)/;

  test("a checkpoint through the newest run passes, and the record rolled back before it is refused, naming the COMMITTED record",
    async () => {
      const four = await latest;
      assert.deepEqual(four.refusals, []);
      const through3 = { [REVISION]: checkpointOf(four.record.history) };
      assert.deepEqual(checkRecord(four.record, nextFiles, { origins: four.origins, subject: NEXT, checkpoints: through3 }), []);
      const problems = refusedByChecker(three.record, three.origins,
        /history ends at entry 2, and its tool freezes it through entry 3: entries were cut from its end/, { checkpoints: through3 });
      assert.ok(problems.some((p) => /cut from its end/.test(p) && HEAD.test(p)), problems.join("\n"));
      const refusals = await refusedByRecorder(eleven(), /existing record: .*entries were cut from its end/,
        { existing: three.record, origins: three.origins, checkpoints: through3, subject: NEXT, files: nextFiles });
      assert.ok(refusals.some((p) => HEAD.test(p)), refusals.join("\n"));
    });

  test("THE CHECKPOINT MUST NAME THE NEWEST RUN: one behind it fails the check, naming the line, and the recorder will not append",
    async () => {
      const four = await latest;
      const through2 = { [REVISION]: checkpointOf(three.record.history) };
      // The state the rollback needed — the true latest run recorded and the checkpoint still behind it — is itself refused.
      const problems = refusedByChecker(four.record, four.origins, /history has 1 run\(s\) after run 2, the newest HISTORY_CHECKPOINTS /,
        { checkpoints: through2, subject: NEXT, files: nextFiles });
      assert.ok(problems.some((p) => p.includes(checkpointLine(four.record.history, REVISION))), problems.join("\n"));
      await refusedByRecorder(eleven(), /existing record: .*history has 1 run\(s\) after run 2/,
        { existing: four.record, origins: four.origins, checkpoints: through2, subject: NEXT, files: nextFiles });
      // …and so is a history frozen nowhere past its origin, which is what every revision's did before this was gated.
      refusedByChecker(three.record, three.origins, /revision \d+'s newest run is frozen by no checkpoint, so it could be rewritten/,
        { checkpoints: {} });
      await refusedByRecorder(eleven(), /existing record: .*newest run is frozen by no checkpoint/,
        { existing: three.record, origins: three.origins, checkpoints: {}, subject: NEXT, files: nextFiles });
      // With the line set, the rollback the gate closes — the record back at run 2, and a release run of 11 recorded over it
      // with no reason where the true latest run measured 10 — is refused before the network.
      const through3 = { [REVISION]: checkpointOf(four.record.history) };
      await refusedByRecorder(eleven(), /existing record: .*entries were cut from its end/,
        { existing: three.record, origins: three.origins, checkpoints: through3, subject: NEXT, files: nextFiles });
    });

  test("a run's reason rewritten and every later link recomputed is refused: every recorded run is frozen", () => {
    // Run 1 GREW, and its reason is rewritten to another sentence with every later link recomputed: a valid chain, which the
    // checkpoint set for the history as recorded refuses. Only the frozen line edited with it — a reviewed source edit — passes.
    const rewritten = rechained(three.record, (h) => { h[1].reason = "a different sentence, written later"; });
    assert.equal(rewritten.origins[REVISION], three.origins[REVISION], "the first run, which the origin pins, was not touched");
    const frozen = { [REVISION]: checkpointOf(three.record.history) };
    refusedByChecker(rewritten.record, three.origins, /history entry 2 is not the entry its tool freezes .*git checkout HEAD/,
      { checkpoints: frozen });
    assert.deepEqual(checkRecord(rewritten.record, files, { origins: three.origins, checkpoints: pinnedAt(rewritten.record) }), [],
      "with the frozen line edited to match, the only thing that sees the rewrite is the diff");
  });

  test("a checkpoint whose run was edited, or that names no entry, is refused", () => {
    refusedByChecker(three.record, three.origins, /history entry 1 is not the entry its tool freezes \(000000000000\).*git checkout HEAD/,
      { checkpoints: { [REVISION]: { index: 1, sha256: "0".repeat(64) } } });
    refusedByChecker(three.record, three.origins, /freezes its history through \{"index":-1,"sha256":"x"\}, which is not an entry index/,
      { checkpoints: { [REVISION]: { index: -1, sha256: "x" } } });
    // A line set to null is no line, and is refused as none rather than crashing the checker.
    refusedByChecker(three.record, three.origins, /revision \d+'s newest run is frozen by no checkpoint/,
      { checkpoints: { [REVISION]: /** @type {any} */ (null) } });
  });

  test("a history deleted under a frozen checkpoint cannot start again, even with no origin frozen", async () => {
    await refusedByRecorder(run("d"), /history is frozen through a checkpoint and this record does not hold it; restore the committed/,
      { existing: null, origins: {}, checkpoints: { [REVISION]: checkpointOf(three.record.history) } });
  });

  test("the runs after it are reported with the line that freezes them, and refused until that line, pasted, does", () => {
    assert.deepEqual(unfrozenTail(three.record.history, REVISION, { origins: {}, checkpoints: {} }), [],
      "nothing is said of a history whose first run is not frozen: the checker names that line");
    for (const unreadable of [[], {}, [null], [[]], [three.record.history[0], "run 1"]])
      assert.deepEqual(unfrozenTail(unreadable, REVISION, { origins: three.origins, checkpoints: {} }), [], JSON.stringify(unreadable));
    const lines = unfrozenTail(three.record.history, REVISION, { origins: three.origins, checkpoints: {} });
    assert.equal(lines[0], "history: 3 run(s), frozen in tools/0b-recipe.mjs through run 0; 2 after it, which the check refuses until " +
      "the checkpoint is moved over them");
    assert.equal(lines[1], "to freeze them, set this inside HISTORY_CHECKPOINTS in tools/0b-recipe.mjs:");
    const line = /^ {2}(\d+): (\{.*\}),$/.exec(lines[2] ?? "");
    assert.ok(line, lines.join("\n"));
    assert.equal(Number(line[1]), REVISION);
    const pasted = { [REVISION]: JSON.parse(line[2] ?? "null") };
    assert.deepEqual(pasted[REVISION], { index: 2, sha256: entryDigest(three.record.history[2]) });
    const problems = refusedByChecker(three.record, three.origins, /history has 2 run\(s\) after run 0, the newest HISTORY_CHECKPOINTS freezes/,
      { checkpoints: { [REVISION]: checkpointOf(three.record.history.slice(0, 1)) } });
    assert.ok(problems.some((p) => p.includes(lines[2] ?? "(no line)")), "the refusal names the same line");
    assert.deepEqual(checkRecord(three.record, files, { origins: three.origins, checkpoints: pasted }), []);
    assert.deepEqual(unfrozenTail(three.record.history, REVISION, { origins: three.origins, checkpoints: pasted }),
      ["history: 3 run(s), frozen in tools/0b-recipe.mjs through run 2"]);
    assert.deepEqual(unfrozenTail(three.record.history.slice(0, 2), REVISION, { origins: three.origins, checkpoints: pasted }),
      ["history: 2 run(s), which does not reach run 2, the one tools/0b-recipe.mjs freezes it through"]);
  });
});

describe("the harness files and the subject", () => {
  /** @type {[string, (f: typeof files) => typeof files, RegExp][]} */
  const harness = [
    ["CODE declared twice",
      (f) => ({ ...f, page: f.page.replace(/(const CODE = "[^"]*";)/, "$1\n$1") }), /declares CODE 2 time\(s\); exactly one is expected/],
    ["a preload removed",
      (f) => ({ ...f, page: f.page.replace(/<link rel="preload"[^>]*fr-CA\.json[^>]*>\n/, "") }),
      /has 2 preload\(s\); the recipe's preload state names three/],
    ["a preload off the catalog origin", (f) => ({ ...f, page: f.page.replace("/examples/catalogs/fr-CA.json", "/other/fr-CA.json") }),
      /preloads .*\/other\/fr-CA\.json.*, which is not under the recipe's catalog origin/],
    ["the mismatch control given crossorigin",
      (f) => ({ ...f, page: f.page.replace(/(<link rel="preload" as="fetch") (href="[^"]*en\.json)/, "$1 crossorigin $2") }),
      /exactly one preload WITHOUT crossorigin, the mismatch control; it declares 0/],
    ["the blind control declared twice",
      (f) => ({ ...f, page: f.page.replace(/(const BLIND = "[^"]*";)/, "$1\n$1") }), /must declare the blind control's URL exactly once/],
    ["the render made with other values",
      (f) => ({ ...f, page: f.page.replace('strings.get("Cart.Items", { count: 3 })', 'strings.get("Cart.Items", { count: 4 })') }),
      /does not make the recipe's render call strings\.get\("Cart\.Items", \{ count: 3 \}\) exactly once/],
    ["the manifest not JSON", (f) => ({ ...f, manifestText: "{" }), /tools\/browser-0b\/manifest\.json is not JSON/],
    ["the manifest's base off the catalog origin",
      (f) => ({ ...f, manifestText: f.manifestText.replace(/"baseUrl": "[^"]*"/, '"baseUrl": "https://cdn.example/"') }),
      /manifest\.json's baseUrl https:\/\/cdn\.example\/ is not the recipe's catalog origin/],
    ["the manifest declaring no size for a planned catalog",
      (f) => ({ ...f, manifestText: f.manifestText.replace('"decodedBytes": 876', '"decodedBytes": 0') }),
      /declares no single decoded size for fr-CA\.json/],
    ["the manifest's fixture changed beyond its build identity",
      (f) => ({ ...f, manifestText: f.manifestText.replace('"fallbackLocale": "en"', '"fallbackLocale": "es"') }),
      /harness's manifestFixture has changed beyond what follows SUBJECT/],
    ["the page's method changed",
      (f) => ({ ...f, page: f.page.replace("setTimeout(resolve, 250)", "setTimeout(resolve, 251)") }),
      /harness's page has changed beyond what follows SUBJECT/],
    ["the server's method changed",
      (f) => ({ ...f, server: f.server + "\n// one byte of method\n" }), /harness's server has changed beyond what follows SUBJECT/],
  ];
  for (const [name, edit, expected] of harness)
    test(name, async () => {
      const changed = edit(files);
      assert.notEqual(JSON.stringify(changed), JSON.stringify(files), "the mutation did not land");
      refusedByChecker(three.record, three.origins, expected, { files: changed });
      await refusedByRecorder(run("d"), expected, { files: changed });
    });

  test("SUBJECT not an exact version, and the page not loading SUBJECT's code", async () => {
    refusedByChecker(three.record, three.origins, /SUBJECT\.version next is not an exact version/, { subject: { version: "next" } });
    refusedByChecker(three.record, three.origins, /index\.html loads code from .*1\.0\.0-rc\.2.*, not SUBJECT's .*9\.9\.9/,
      { subject: NEXT });
    await refusedByRecorder(run("d"), /SUBJECT\.version next is not an exact version/, { subject: { version: "next" } });
  });

  test("the recipe changed while its revision stayed, and a revision with no frozen digest", async () => {
    // The recipe is frozen in the module this file imports, so the two refusals are exercised on a copy.
    const copy = mkdtempSync(join(scratch, "recipe-"));
    const recipe = readFileSync(join(root, "tools/0b-recipe.mjs"), "utf8");
    writeFileSync(join(copy, "ratchet-chain.mjs"), readFileSync(join(root, "tools/ratchet-chain.mjs")));
    const variants = /** @type {const} */ ([
      ["changed.mjs", recipe.replace('region: "RECORDED, never pinned', 'region: "RECORDED, rarely pinned'),
        new RegExp(`the recipe has changed \\(.*\\) while revision stayed ${REVISION}\\. Bump RECIPE\\.revision`)],
      ["unfrozen.mjs", recipe.replace(`revision: ${REVISION},`, `revision: ${REVISION + 1},`),
        new RegExp(`recipe revision ${REVISION + 1} has no frozen digest in RECIPE_DIGESTS`)],
    ]);
    for (const [name, text, expected] of variants) {
      assert.notEqual(text, recipe, "the mutation did not land");
      writeFileSync(join(copy, name), text);
      const { recipeProblems } = await import(pathToFileURL(join(copy, name)).href);
      assert.match(recipeProblems().join("\n"), expected);
    }
  });
});

describe("the published graph, read from a tarball", () => {
  test("a pax path record names the entry after it; a directory and a global header name nothing", () => {
    // A pax record is "<length> path=<value>\n", its length counting its own digits.
    const record = (/** @type {string} */ path) => {
      const body = ` path=${path}\n`;
      let n = body.length + 1;
      while (String(n).length + body.length !== n) n += 1;
      return `${n}${body}`;
    };
    const listed = tarballFiles(ustar([["PaxHeader/g", record("ignored"), "g"], ["package/dist/", "", "5"],
      ["PaxHeader/x", record("package/dist/browser/lokalized.js"), "x"], ["PaxHeader/g", record("ignored"), "g"], ["short", "export{};"]]));
    assert.deepEqual([...listed.keys()], ["package/dist/browser/lokalized.js"]);
    assert.equal(new TextDecoder().decode(listed.get("package/dist/browser/lokalized.js")), "export{};");
  });

  test("a ustar prefix names the entry's directory, and only in a ustar header; a full-length name and a contiguous file are read", () => {
    const raw = gunzipSync(ustar([["lokalized.js", "export{};"]]));
    raw.write("package/dist/browser", 345);
    assert.deepEqual([...tarballFiles(gzipSync(raw)).keys()], ["package/dist/browser/lokalized.js"]);
    // No ustar magic: an old header, whose bytes past its name are not a prefix.
    raw.fill(0, 257, 265);
    assert.deepEqual([...tarballFiles(gzipSync(raw)).keys()], ["lokalized.js"]);
    // A name filling all 100 bytes of its field has no terminating NUL, and loses no character.
    const full = `package/dist/browser/${"a".repeat(76)}.js`;
    assert.equal(full.length, 100);
    assert.deepEqual([...tarballFiles(ustar([[full, "x"]])).keys()], [full]);
    assert.deepEqual([...tarballFiles(ustar([["package/dist/browser/lokalized.js", "x", "7"]])).keys()],
      ["package/dist/browser/lokalized.js"]);
    // An old archive's regular file carries a NUL type flag, not "0".
    assert.deepEqual([...tarballFiles(ustar([["package/dist/browser/lokalized.js", "x", "\0"]])).keys()],
      ["package/dist/browser/lokalized.js"]);
    // One end block, where POSIX writes two, ends the archive as surely: nothing is missing from it.
    const single = gunzipSync(ustar([["package/dist/browser/lokalized.js", "x"]], { end: false }));
    assert.deepEqual([...tarballFiles(gzipSync(Buffer.concat([single, Buffer.alloc(512)]))).keys()], ["package/dist/browser/lokalized.js"]);
  });

  test("a truncated archive, an entry point it lacks, a module an entry point imports that it lacks, and a path that climbs out", () => {
    assert.throws(() => tarballFiles(ustar([["package/dist/browser/lokalized.js", "x"]], { end: false })), /truncated/);
    // …and so is one whose last block is an empty file's header, which holds the whole of that entry.
    assert.throws(() => tarballFiles(ustar([["package/dist/browser/lokalized.js", ""]], { end: false })), /truncated/);
    const listed = (/** @type {[string, string][]} */ entries) => tarballFiles(ustar(entries));
    assert.throws(() => publishedGraph(listed([["package/dist/browser/lokalized.js", ""]]), ["lokalized.js", "load.js"]),
      /holds no dist\/browser\/load\.js/);
    // A module the build does not hold is not there to walk: the shared walker's own read fails.
    assert.throws(() => publishedGraph(listed([["package/dist/browser/load.js", 'import"./chunks/gone.js";']]), ["load.js"]),
      /ENOENT/);
    const climbing = listed([["package/dist/browser/../../evil.js", ""], ["package/dist/browser/load.js", ""]]);
    assert.throws(() => publishedGraph(climbing, ["load.js"]),
      /a path this reader will not write/);
    // …and neither does a `.` or an empty segment, which name the same file twice.
    for (const odd of ["package/dist/browser/./load.js", "package/dist/browser//load.js"])
      assert.throws(() => publishedGraph(listed([[odd, ""], ["package/dist/browser/load.js", ""]]), ["load.js"]),
        /a path this reader will not write/, odd);
  });

  test("an entry size the archive does not hold is refused, never read as a shorter file", () => {
    // The size field of the first header, rewritten to more octal bytes than the archive has. Nothing checks a ustar
    // header's checksum here, so this is exactly what a corrupt download that still gunzips looks like.
    const tar = gunzipSync(ustar([["package/dist/browser/lokalized.js", "export{};"]]));
    tar.write("77777777777\0", 124);
    assert.throws(() => tarballFiles(gzipSync(tar)), /the tarball's entry at byte 0 declares a size it does not hold/);
    // …and so is one that is not an octal number at all, or is less than none.
    for (const size of ["zzzzzzzzzzz\0", "-0000000001\0"]) {
      tar.write(size, 124);
      assert.throws(() => tarballFiles(gzipSync(tar)), /the tarball's entry at byte 0 declares a size it does not hold/, size);
    }
  });

  test("an import that climbs out of the build is refused, not walked into a module the tarball does not hold", () => {
    // The walk runs in a private directory beside this file's own under the temp directory, so `../<this file's>/…` is a
    // real file OUTSIDE the build, which the shared walker reads like any other.
    writeFileSync(join(scratch, "outside.js"), "export{};");
    const load = `import"../${basename(scratch)}/outside.js";`;
    assert.throws(() => publishedGraph(tarballFiles(ustar([["package/dist/browser/load.js", load]])), ["load.js"]),
      new RegExp(`dist/browser/load\\.js imports \\.\\./${basename(scratch)}/outside\\.js, which the tarball does not hold`));
  });
});

describe("the page's own script, run by tools/browser-0b/simulate.mjs", () => {
  const out = join(scratch, "simulated.json");
  const simulated = spawnSync(process.execPath, ["tools/browser-0b/simulate.mjs", out], { cwd: root, encoding: "utf8" });

  test("its output passes every capture check but the one that says it is a simulation", () => {
    assert.equal(simulated.status, 0, simulated.stdout + simulated.stderr);
    const capture = JSON.parse(readFileSync(out, "utf8"));
    const version = SUBJECT.version;
    assert.deepEqual(captureProblems(capture, { ...files, version }).map((p) => p.replace(/\(.*\)/, "(…)")),
      ["the capture is a simulation (…): its sizes are invented, and it is never a measurement"]);
    delete capture.simulated;
    assert.deepEqual(captureProblems(capture, { ...files, version }), []);
  });

  test("this file's reading of the page is the page's: every label, the summary, the controls and the cold arm", () => {
    const capture = JSON.parse(readFileSync(out, "utf8"));
    const reread = pageSide(clone(capture));
    for (const field of ["resources", "summary", "controls", "coldArm"])
      assert.deepEqual(field === "coldArm" ? { ...reread.coldArm, noteOnLimits: null } : reread[field],
        field === "coldArm" ? { ...capture.coldArm, noteOnLimits: null } : capture[field], field);
  });

  test("the recorder refuses it before the network", async () => {
    const capture = JSON.parse(readFileSync(out, "utf8"));
    await refusedByRecorder(capture, /the capture is a simulation/);
  });
});

describe("the two command lines", () => {
  /** @param {string[]} args */
  const node = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  const revision3 = revision3Record("cli3");

  test("the checker labels a record with the RECORD's revision and asks for a re-record", () => {
    const path = join(scratch, "revision-3.json");
    writeFileSync(path, JSON.stringify(revision3));
    const result = node(["tools/scenario-0b.mjs", path]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /record {10}revision 3, digest 9c06237a3f5a/);
    assert.match(result.stdout, /history, revision 3: none/);
    assert.match(result.stdout, /figures as revision 3's own page summed them .*\n {4}requestCount {13}12\n/);
    assert.doesNotMatch(result.stdout, /earlier revisions/);
    assert.doesNotMatch(result.stdout, new RegExp(`history, revision ${REVISION}`));
    assert.match(result.stderr, new RegExp(`the record is revision 3 and the recipe is revision ${REVISION} .* Re-record 0b`));
  });

  test("the recorder refuses a bad capture before the network and leaves the record byte-identical", () => {
    const recordPath = join(scratch, "untouched.json");
    writeFileSync(recordPath, JSON.stringify(revision3));
    const before = readFileSync(recordPath);
    const capturePath = join(scratch, "warm.json");
    const warm = run("cliw");
    for (const r of warm.resources) if (r.url.includes("/chunks/")) Object.assign(r, { transferSize: 0, deliveryType: "cache" });
    writeFileSync(capturePath, JSON.stringify(pageSide(warm)));
    const trap = join(scratch, "no-network.mjs");
    writeFileSync(trap, "globalThis.fetch = async (url) => { throw new Error(`NETWORK TOUCHED ${url}`); };\n");
    const result = node(["--import", pathToFileURL(trap).href, "tools/browser-0b/record.mjs", capturePath, "--record", recordPath]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /refusing to record \(nothing was fetched\)/);
    assert.match(result.stderr, /did not cross the network/);
    assert.doesNotMatch(result.stderr, /NETWORK TOUCHED/);
    assert.deepEqual(readFileSync(recordPath), before);
    // An option the recorder does not know is refused, never ignored.
    const unknown = node(["--import", pathToFileURL(trap).href, "tools/browser-0b/record.mjs", capturePath, "--record", recordPath,
      "--migrate"]);
    assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
    assert.match(unknown.stderr, /unknown option\(s\): --migrate/);
    assert.deepEqual(readFileSync(recordPath), before);
    // A named record that does not exist is no record, not an unreadable one: the capture's own refusal, before the network.
    const absent = join(scratch, "no-such-record-yet.json");
    const none = node(["--import", pathToFileURL(trap).href, "tools/browser-0b/record.mjs", capturePath, "--record", absent]);
    assert.equal(none.status, 1, none.stdout + none.stderr);
    assert.match(none.stderr, /refusing to record \(nothing was fetched\)[\s\S]*did not cross the network/);
    assert.throws(() => readFileSync(absent), /ENOENT/);
  });

  test("the recorder refuses a flag with no value, a flag's value that is another flag, and input that is not JSON", () => {
    const recordPath = join(scratch, "untouched-2.json");
    writeFileSync(recordPath, JSON.stringify(revision3));
    const before = readFileSync(recordPath);
    const capturePath = join(scratch, "cold-2.json");
    writeFileSync(capturePath, JSON.stringify(run("cliv")));
    const garbled = join(scratch, "garbled.json");
    writeFileSync(garbled, "{ not json");
    const trap = join(scratch, "no-network-2.mjs");
    writeFileSync(trap, "globalThis.fetch = async (url) => { throw new Error(`NETWORK TOUCHED ${url}`); };\n");
    const record = (/** @type {string[]} */ args) => node(["--import", pathToFileURL(trap).href, "tools/browser-0b/record.mjs", ...args]);
    /** @type {[string[], RegExp][]} */
    const refused = [
      [[capturePath, "--record", recordPath, "--reason"], /--reason and --record each need a value/],
      [[capturePath, "--record", recordPath, "--reason", " "], /--reason and --record each need a value/],
      [[capturePath, "--reason", "--record", recordPath], /--reason and --record each need a value/],
      [[capturePath, "--record"], /--reason and --record each need a value/],
      [[garbled, "--record", recordPath], /garbled\.json is not readable JSON/],
      [[capturePath, "--record", garbled], /garbled\.json is not readable JSON/],
      [[capturePath, capturePath, "--record", recordPath], /usage: record\.mjs <capture\.json>/],
    ];
    for (const [args, expected] of refused) {
      const result = record(args);
      assert.equal(result.status, 2, `${args.join(" ")}:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, expected);
      assert.doesNotMatch(result.stderr, /NETWORK TOUCHED|unknown option/);
    }
    assert.deepEqual(readFileSync(recordPath), before);
    assert.equal(readFileSync(garbled, "utf8"), "{ not json");
  });

  test("the checker refuses a record that is not JSON, and an absent one", () => {
    const garbled = join(scratch, "garbled-record.json");
    writeFileSync(garbled, "{ not json");
    const result = node(["tools/scenario-0b.mjs", garbled]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /garbled-record\.json is not readable JSON/);
    // …and stops there: a record it cannot read is not an ABSENT one, and is not checked as if it were.
    assert.doesNotMatch(result.stderr, /is absent/);
    const absent = node(["tools/scenario-0b.mjs", join(scratch, "no-such-record.json")]);
    assert.equal(absent.status, 1, absent.stdout + absent.stderr);
    assert.match(absent.stderr, /measurements\/scenario-0b\.json is absent\. Absence is never agreement/);
  });

  test("the recorder starts a revision's history from an earlier revision's record, the checker asks only for the freeze, and the " +
    "printed line, pasted, passes", async () => {
    const capturePath = join(scratch, "cold.json");
    writeFileSync(capturePath, JSON.stringify(run("clic")));
    const tarballPath = join(scratch, "published.tgz");
    writeFileSync(tarballPath, TARBALL);
    const stub = join(scratch, "stub-network.mjs");
    writeFileSync(stub, `import { readFileSync } from "node:fs";
const tarball = readFileSync(${JSON.stringify(tarballPath)});
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.startsWith("${REGISTRY}-/")) return new Response(tarball);
  if (url.startsWith("${REGISTRY}")) {
    const version = decodeURIComponent(url.slice(${REGISTRY.length}));
    return new Response(JSON.stringify({ name: "lokalized", version, dist: { integrity: ${JSON.stringify(integrityOf(TARBALL))},
      tarball: "${REGISTRY}-/lokalized-" + version + ".tgz" } }));
  }
  return new Response("stub", { headers: { "content-encoding": "br", "timing-allow-origin": "*", "access-control-allow-origin": "*",
    "cache-control": "public, max-age=31536000, immutable", "x-jsd-version-type": url.includes("/gh/") ? "commit" : "version" } });
};
`);
    // THE LIVE TOOLS, once their first run is frozen: no record may start this revision's history again.
    if (/** @type {Record<number, string>} */ (HISTORY_ORIGINS)[REVISION] !== undefined) {
      const recordPath = join(scratch, "fresh-live.json");
      writeFileSync(recordPath, JSON.stringify(revision3));
      const live = node(["--import", pathToFileURL(stub).href, "tools/browser-0b/record.mjs", capturePath, "--record", recordPath]);
      assert.equal(live.status, 1, live.stdout + live.stderr);
      assert.match(live.stderr, /history is frozen to start at .* restore the committed record/);
    }
    // THE SUCCESS PATH, WHATEVER THE LIVE FREEZE: the same tools copied with this revision's frozen lines taken out — which a
    // review measured this file losing once the real first run was frozen — and run once at a named record and once at the
    // copy's default one, whose paths the two command lines resolve by different arms.
    const copy = join(scratch, "unfrozen");
    for (const file of ["tools/0b-recipe.mjs", "tools/0b-checks.mjs", "tools/ratchet-chain.mjs", "tools/graph-walk.mjs",
      "tools/scenario-0b.mjs", "tools/browser-0b/record.mjs", "tools/browser-0b/index.html", "tools/browser-0b/manifest.json",
      "tools/browser-0b/serve.mjs"]) {
      mkdirSync(dirname(join(copy, file)), { recursive: true });
      copyFileSync(join(root, file), join(copy, file));
    }
    const recipePath = join(copy, "tools/0b-recipe.mjs");
    const frozenBlocks = /(export const HISTORY_(?:ORIGINS|CHECKPOINTS|UNTIMED) = [^\n]*\n)([\s\S]*?)(\n\}\)\);)/g;
    const unfreeze = (/** @type {string} */ text) => text.replace(frozenBlocks, (_, head, body, tail) =>
      head + body.split("\n").filter((/** @type {string} */ line) => !/^\s*\d+\s*:/.test(line)).join("\n") + tail);
    writeFileSync(recipePath, unfreeze(readFileSync(recipePath, "utf8")));
    const copied = await import(pathToFileURL(recipePath).href);
    assert.equal(copied.HISTORY_ORIGINS[REVISION], undefined, "the copy's first run is still frozen: the mutation did not land");
    assert.equal(copied.HISTORY_CHECKPOINTS[REVISION], undefined, "the copy's checkpoint is still frozen: the mutation did not land");
    assert.equal(copied.HISTORY_UNTIMED[REVISION], undefined, "the copy's untimed first run is still frozen: the mutation did not land");
    assert.equal(copied.recipeSha256, RECIPE_DIGESTS[REVISION], "the copy is not this recipe");
    const named = join(scratch, "fresh.json");
    writeFileSync(named, JSON.stringify(revision3));
    const defaultPath = join(copy, "measurements/scenario-0b.json");
    mkdirSync(dirname(defaultPath));
    writeFileSync(defaultPath, JSON.stringify(revision3));
    const untouched = readFileSync(defaultPath);
    // A revision's first run beside an earlier revision's says why the revision was cut, and the reason is kept on it.
    const cut = "test: the command line's first run of this revision";
    // The flag BEFORE the capture, once: a flag is read wherever it stands.
    const freezes = [["--record", named, "--reason", cut, capturePath], [capturePath, "--reason", cut]].map((args, i) => {
      const result = node(["--import", pathToFileURL(stub).href, join(copy, "tools/browser-0b/record.mjs"), ...args]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      if (i === 0) assert.deepEqual(readFileSync(defaultPath), untouched, "a run at a named record wrote the default one");
      const recorded = i === 0 ? literally(named) : "measurements/scenario-0b\\.json";
      assert.match(result.stdout, new RegExp(`^recorded ${recorded}: run 0 of revision ${REVISION} ` +
        `\\(http://zb-test-clic\\.localhost:8713 clic-1\\), lokalized@${V} \\(tarball [0-9a-f]{12}, 8 modules\\), ` +
        "host encoding br, no growth\\n"));
      // TWO LINES TO SET: the first run's digest in HISTORY_ORIGINS, and the checkpoint through it in HISTORY_CHECKPOINTS.
      const freeze = /\n {2}(\d+): "([0-9a-f]{64})",\n[^\n]*HISTORY_CHECKPOINTS[^\n]*\n {2}(\d+): (\{.*\}),\n$/.exec(result.stdout);
      assert.ok(freeze, `the recorder printed no lines to freeze:\n${result.stdout}`);
      return freeze;
    });
    // The two records are one run, so the same lines freeze both.
    assert.deepEqual(freezes[0]?.slice(1), freezes[1]?.slice(1));
    const [, revision, digest, checkpointRevision, checkpoint] = /** @type {RegExpExecArray} */ (freezes[0]);
    assert.equal(checkpointRevision, revision);
    assert.deepEqual(JSON.parse(checkpoint ?? "null"), { index: 0, sha256: digest });
    for (const path of [named, defaultPath]) {
      const written = JSON.parse(readFileSync(path, "utf8"));
      assert.deepEqual(written.priorRevisions.map((/** @type {any} */ p) => p.revision), [3]);
      assert.equal(entryDigest(written.history[0]), digest);
      assert.equal(written.history[0].reason, cut, "the run's --reason was not kept on it");
    }
    const check = (/** @type {string[]} */ args) => node([join(copy, "tools/scenario-0b.mjs"), ...args]);
    for (const checked of [check([named]), check([])]) {
      assert.equal(checked.status, 1, checked.stdout + checked.stderr);
      assert.match(checked.stderr, /^\n2 problem\(s\):\n {2}- revision \d+'s history has no frozen first run/);
      assert.ok(checked.stderr.includes(`${revision}: "${digest}",`), checked.stderr);
      assert.ok(checked.stderr.includes(`${revision}: ${checkpoint},`), checked.stderr);
      assert.match(checked.stdout, /figures, re-derived from the capture's counted resources .*\n {4}requestCount {13}11\n/);
      assert.match(checked.stdout, /  0  http:\/\/zb-test-clic\.localhost:8713 clic-1 .*  8 modules/);
      assert.match(checked.stdout, /earlier revisions .*\n {4}revision 3, http:\/\/zb-test-cli3\.localhost:8713 cli3-1: 12 \/ 365198 /);
    }
    // AND THE PRINTED LINES, PASTED WHERE THE RECORDER SAYS, ARE THE CHECKER'S WHOLE REMEDY: exit 0, one run frozen through run 0.
    const anchor = "  // One line per revision, exactly as tools/browser-0b/record.mjs prints it for the revision's first run.\n";
    const checkpointAnchor = "  // One line per revision, exactly as tools/scenario-0b.mjs and tools/browser-0b/record.mjs print it.\n";
    const recipe = readFileSync(recipePath, "utf8");
    assert.equal(recipe.split(anchor).length, 2);
    assert.equal(recipe.split(checkpointAnchor).length, 2);
    writeFileSync(recipePath, recipe.replace(anchor, `${anchor}  ${revision}: "${digest}",\n`)
      .replace(checkpointAnchor, `${checkpointAnchor}  ${revision}: ${checkpoint},\n`));
    for (const pasted of [check([named]), check([])]) {
      assert.equal(pasted.status, 0, pasted.stdout + pasted.stderr);
      assert.match(pasted.stdout, /\n {2}history: 1 run\(s\), frozen in tools\/0b-recipe\.mjs through run 0\n/);
      assert.match(pasted.stdout, /\nthe recorded 0b run is current, its figures re-derive from its resources/);
    }
  });
});
