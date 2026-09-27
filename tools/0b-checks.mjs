// @ts-check
/**
 * SCENARIO 0b's CHECKS — ONE SET, applied by `tools/scenario-0b.mjs` to the record and by
 * `tools/browser-0b/record.mjs` to a run BEFORE it writes anything.
 *
 * **WHY THEY LIVE HERE AND NOT IN THE CHECKER.** Until 2026-09-25 the capture checks lived in the
 * checker alone, while the recorder's header said "NOTHING IS WRITTEN FROM A RUN THE CHECKER WOULD
 * REFUSE". Two reviews measured that sentence false with the network stubbed: a warm run was written
 * at exit 0 and refused by the checker afterwards, and so was a capture whose mismatched preload
 * reported reuse and whose blind control read a size — and neither tool noticed that one of those
 * captures carried no summary and no render at all. With a history that is append-only by design that
 * is not a cosmetic gap: a run written in error is a baseline forever. So the recorder applies these
 * same functions, and last of all `checkRecord` over the exact object it is about to write.
 *
 * **EVERY FIGURE IS RE-DERIVED FROM THE CAPTURE'S RESOURCES**, never read from the summary the page
 * wrote; the summary and the page's per-resource labels are checked against the derivation instead,
 * and a capture whose summary is absent or differs is refused. A review measured four edits to the
 * record that the checker let through at exit 0 — the summary deleted, `transferBytes` set to 1,
 * `requestCount` set to 99, a timing deleted — and against the ratchet's first prototype, a capture
 * whose code resources had gone blind recorded decoded bytes of 2,624 against 365,198 as "no growth".
 * A counted resource that reads zero is now a refusal, because a measurement going blind must never
 * read as an improvement.
 *
 * **WHICH REQUESTS ARE THE SCENARIO'S IS RE-DERIVED TOO.** A request is the scenario's when it STARTED
 * before the render returned; the page records each entry's start and the render's return unrounded
 * on one clock, and `phase` is recomputed from the two. Until a review of this change, the render's
 * time was not in the capture and the label was taken as written: relabelling one chunk
 * `after-render` recorded a release run of 10 requests with no reason.
 *
 * **AND WHICH RESOURCES A RUN MUST COUNT IS THE SUBJECT'S, NOT THE CAPTURE'S.** A re-derivation sees
 * only the resources the page REPORTED, so a lost chunk used to read as a smaller build. The recorder
 * reads the published module graph out of the subject's verified tarball — the two entry points and
 * every module they import — and keeps it on the run; every run must count exactly that graph and the
 * three catalogs the manifest plans, each once and each at its size. So a run's request count and
 * decoded bytes are its version's, by an exit term: within one version they cannot move at all, and a
 * lost chunk or a doubled request is refused rather than admitted with a reason.
 *
 * **WHAT THESE CANNOT SEE.** A capture fabricated consistently — resources, times and all — is the
 * same trust boundary as fabricating the record by hand; what is refused is a capture whose parts
 * contradict each other, and a capture that repeats an earlier run's timings EXACTLY under a new name —
 * the same timings shifted by any amount are a consistent fabrication like any other. The host
 * facts, the registry digests and the graph are measured by the recorder, over the network, at record
 * time: this module checks that they are present, well-formed and consistent with the capture and with
 * each other, never that they are still true. Every recorded run is frozen in source through
 * `HISTORY_CHECKPOINTS`, and the checker fails until the newest one is, so a run's reason rewritten, or
 * the record rolled back over a run, is refused rather than re-linked. What freezing cannot see is the
 * edit made WITH the frozen line — a reviewed change to source. And these rules are CODE, not part of the
 * recipe: the recipe's digest freezes the policy's lists and wording, while loosening a check here is an
 * edit reviewed as one, which no revision records.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chainProblems, checkpointOf, entryDigest } from "./ratchet-chain.mjs";
import { CODE_DECLARATION, HISTORY_CHECKPOINTS, HISTORY_ORIGINS, HISTORY_UNTIMED, RECIPE, RECIPE_DIGESTS, SUBJECT, codeOriginFor,
  methodDigests, recipeProblems, recipeSha256 } from "./0b-recipe.mjs";

const sha256 = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/** The ratcheted and reported figures, READ from the recipe's policy so the rule is the revision's. */
export const RATCHETED = RECIPE.hostThresholds.ratcheted;
export const REPORTED = RECIPE.hostThresholds.reported;

/** Where the record lives, named in messages. */
export const RECORD_NAME = "measurements/scenario-0b.json";

/**
 * Every header the recorder asks of the host: the recipe's required ones, jsDelivr's statement of what
 * a URL is pinned to, and the length of the body the host sent. The record keeps each probe's answer to
 * every one of them, `null` where the host sent none, so what was probed is on the record.
 */
export const PROBED_HEADERS = Object.freeze([...RECIPE.requiredHostHeaders, "x-jsd-version-type", "content-length"]);

/**
 * An exact published version. A dist-tag or a range names different bytes on different days, and a
 * run of "whatever `next` was" cannot be compared with anything.
 */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** npm's integrity for a tarball: sha512, base64, 88 characters. */
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** A module of the published graph, by its path under `dist/browser/`: no `..`, no empty segment. */
const MODULE_PATH = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.js$/;

/**
 * The files a run is taken with. `manifestText` is the manifest's bytes: a record binds itself to
 * those, and the method digest reads them without the build identity.
 * @typedef {{ page: string, manifestText: string, server: string }} HarnessFiles
 * @typedef {{ index: number, sha256: string }} Checkpoint
 * @typedef {{ subject?: { version: string }, origins?: Record<number, string>, checkpoints?: Record<number, Checkpoint>,
 *   untimed?: Record<number, readonly string[]> }} Context
 */

/** The three harness files, as a checkout holds them. @param {string} root the `lokalized-js` directory */
export const readHarness = (root) => ({
  page: readFileSync(join(root, "tools/browser-0b/index.html"), "utf8"),
  manifestText: readFileSync(join(root, "tools/browser-0b/manifest.json"), "utf8"),
  server: readFileSync(join(root, "tools/browser-0b/serve.mjs"), "utf8"),
});

const hrefOf = (/** @type {unknown} */ url) => {
  try { return typeof url === "string" ? new URL(url).href : null; } catch { return null; }
};
const originOf = (/** @type {unknown} */ url) => {
  try { return typeof url === "string" ? new URL(url).origin : null; } catch { return null; }
};
const pathOf = (/** @type {string} */ href) => new URL(href).pathname;
const isFiniteNumber = (/** @type {unknown} */ value) => typeof value === "number" && Number.isFinite(value);
const isCount = (/** @type {unknown} */ value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
const nonEmpty = (/** @type {unknown} */ value) => typeof value === "string" && value.trim() !== "";
const isPlainObject = (/** @type {unknown} */ value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** Whether `value` is an object with exactly `keys`, in any order. @param {unknown} value @param {readonly string[]} keys */
const hasExactly = (value, keys) => isPlainObject(value) &&
  JSON.stringify(Object.keys(/** @type {object} */ (value)).sort()) === JSON.stringify([...keys].sort());

/**
 * The page's `<link rel=preload>` tags, parsed from its SOURCE: the matched arms carry `crossorigin`,
 * the mismatch control does not. Attribute values are blanked before `crossorigin` is looked for, so a
 * URL that happened to contain the word could not make an arm look matched.
 * @param {string} page
 */
export function preloadArms(page) {
  return [...page.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => /\brel\s*=\s*"?preload\b/.test(tag))
    .map((tag) => {
      const href = tag.match(/\bhref\s*=\s*"([^"]+)"/)?.[1] ?? "(no href)";
      const crossorigin = /\scrossorigin(?=[\s=>])/.test(tag.replace(/"[^"]*"/g, '""'));
      return { href, crossorigin, file: (href.split("?")[0] ?? "").split("/").pop() ?? "" };
    });
}

/** The page's one `BLIND` declaration: the blind control's URL, on an origin that is not the page's. */
const BLIND_DECLARATION = /\bconst\s+BLIND\s*=\s*"([^"]*)"/g;
/** The blind control's URL as the page declares it, or null unless it declares exactly one. @param {string} page */
export const blindOf = (page) => {
  const found = [...page.matchAll(BLIND_DECLARATION)].map((m) => m[1]);
  return found.length === 1 ? hrefOf(found[0]) : null;
};

/**
 * THE PLANNED CATALOGS' SIZES, as the manifest declares them: `{ "fr.json": 909, … }` for each catalog
 * the recipe's loader graph plans, `null` where the manifest declares none. The manifest's catalog
 * entries are part of the frozen method (`harnessMethodSha256.manifestFixture`), so every run of a
 * revision is held to the same sizes.
 * @param {string} manifestText
 * @returns {Record<string, number | null>}
 */
export function catalogSizes(manifestText) {
  /** @type {any} */
  let manifest = null;
  try { manifest = JSON.parse(manifestText); } catch { /* every size null, which harnessProblems reports */ }
  /** @type {any[]} */
  const entries = isPlainObject(manifest?.files) ? Object.values(manifest.files) : [];
  return Object.fromEntries(RECIPE.requiredResources.catalogs.map((file) => {
    const declared = entries.filter((entry) => entry?.url === file);
    const size = declared.length === 1 ? declared[0].decodedBytes : null;
    return [file, Number.isSafeInteger(size) && size > 0 ? size : null];
  }));
}

/**
 * THE HARNESS FILES AGAINST THE RECIPE AND THE SUBJECT: the page imports the subject's code, declares
 * the three preload arms under the catalog origin with exactly one of them the mismatch control and
 * one blind control, the manifest's base is the catalog origin and it declares every planned catalog's
 * size, and the three files' METHOD is the one frozen for this revision. Checked for every run and
 * every record, whatever the capture says.
 * @param {HarnessFiles} files
 * @param {{ version: string }} [subject]
 */
export function harnessProblems({ page, manifestText, server }, subject = SUBJECT) {
  /** @type {string[]} */
  const problems = [];
  if (!EXACT_VERSION.test(subject.version))
    problems.push(`SUBJECT.version ${subject.version} is not an exact version; a tag or range names different bytes on different days`);
  const code = [...page.matchAll(CODE_DECLARATION)].map((m) => m[2]);
  if (code.length !== 1)
    problems.push(`tools/browser-0b/index.html declares CODE ${code.length} time(s); exactly one is expected`);
  else if (code[0] !== codeOriginFor(subject.version))
    problems.push(`tools/browser-0b/index.html loads code from ${code[0]}, not SUBJECT's ${codeOriginFor(subject.version)}`);
  const arms = preloadArms(page);
  if (arms.length !== 3)
    problems.push(`tools/browser-0b/index.html has ${arms.length} preload(s); the recipe's preload state names three`);
  for (const arm of arms)
    if (!arm.href.startsWith(RECIPE.catalogOrigin))
      problems.push(`tools/browser-0b/index.html preloads ${arm.href}, which is not under the recipe's catalog origin`);
  if (arms.filter((arm) => !arm.crossorigin).length !== 1)
    problems.push("tools/browser-0b/index.html must declare exactly one preload WITHOUT crossorigin, the mismatch control; " +
      `it declares ${arms.filter((arm) => !arm.crossorigin).length}`);
  // THE BLIND CONTROL IS THE PAGE'S, not the capture's to name: a capture naming some other zero-sized
  // entry as its blind control — the mismatched preload's opaque one reads 0 too — would otherwise pass.
  if (blindOf(page) === null)
    problems.push("tools/browser-0b/index.html must declare the blind control's URL exactly once (const BLIND = \"…\")");
  // THE PAGE MAKES THE CALLS THE RECIPE'S `render` DESCRIBES. The capture's render is held to the
  // recipe's locale, key and expected text; the values it was rendered with are held here, the only
  // place a check reads them. (Not every recipe field is read by a check: its prose — the cache and
  // preload state, the region, the browser, among others — is frozen by the digest and read by people.)
  const { locale, key, values } = RECIPE.render;
  const renderCalls = [`loadStrings(manifest, ${JSON.stringify(locale)})`, `createStrings({ loaded, localeResolver: () => ${JSON.stringify(locale)} })`,
    `strings.get(${JSON.stringify(key)}, { ${Object.entries(values).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} })`];
  for (const call of renderCalls)
    if (page.split(call).length !== 2) problems.push(`tools/browser-0b/index.html does not make the recipe's render call ${call} exactly once`);
  /** @type {any} */
  let manifest = null;
  try { manifest = JSON.parse(manifestText); } catch { problems.push("tools/browser-0b/manifest.json is not JSON"); }
  if (manifest && manifest.baseUrl !== RECIPE.catalogOrigin)
    problems.push(`tools/browser-0b/manifest.json's baseUrl ${manifest.baseUrl} is not the recipe's catalog origin`);
  for (const [file, size] of Object.entries(catalogSizes(manifestText)))
    if (size === null)
      problems.push(`tools/browser-0b/manifest.json declares no single decoded size for ${file}, which the recipe's loader graph plans`);
  const method = methodDigests({ page, manifestText, server });
  for (const part of /** @type {const} */ (["page", "manifestFixture", "server"]))
    if (method[part] !== RECIPE.harnessMethodSha256[part])
      problems.push(`the harness's ${part} has changed beyond what follows SUBJECT (${RECIPE.harnessMethodSha256[part].slice(0, 12)} -> ` +
        `${String(method[part]).slice(0, 12)}): a changed method is a new revision (plan :2795-2797), not a new run`);
  return problems;
}

/** What a record binds itself to: the exact bytes of the three harness files the run was taken with. */
export const harnessBinding = (/** @type {HarnessFiles} */ { page, manifestText, server }) =>
  ({ page: sha256(page), manifest: sha256(manifestText), server: sha256(server) });

/** Which run a capture is: the top-level site it ran from — a cold run needs a new one — and its token. */
export const runOf = (/** @type {any} */ capture) => `${capture?.origins?.page} ${capture?.cacheBuster?.value}`;

/**
 * WHAT A CAPTURE'S TIMELINE IS, whatever it is called: the digest of every resource's start and duration,
 * as a set, so neither a new token and site nor a reordered list makes a replayed capture a new run. Two
 * real runs agree on every one of some twenty entries' timings, to the page's precision, by no plausible
 * chance; a capture replayed under a new name agrees on all of them. The history keeps it per run
 * (`timingsSha256`) so the capture can leave the record without its run becoming repeatable.
 * @param {any} capture
 */
export const timingsOf = (capture) => entryDigest((Array.isArray(capture?.resources) ? capture.resources : [])
  .map((/** @type {any} */ r) => JSON.stringify([r?.startMs ?? null, r?.durationMs ?? null])).sort());

/**
 * THE SITE a run's cache partition is keyed by, taken no finer than Chromium takes it. Chromium keys its
 * HTTP cache by top-level SITE — the scheme and the registrable domain, the public suffix plus one label
 * — which a PORT is not part of: a review measured a run from a used host on another port accepted as a
 * new site while this compared origins. Nor is a SUBDOMAIN part of it, where the suffix is a real one:
 * `www.zb-a.localhost` after `zb-a.localhost` was then accepted too (second review, 2026-09-25). This
 * reads a host's last two labels as its site, with no public-suffix list: never finer than Chromium's
 * site, which has at least two labels or is the whole host, and coarser only where a suffix has more
 * labels than one (`co.uk`, `github.io`), which costs a new name rather than reading a warm run as cold.
 * An IPv4 address is its own site; an IPv6 one, as a URL serializes it, has no dot to split on. For the
 * `zb-*.localhost` names the runbook uses, each is its own site: revisions 2 and 3's cold runs were each
 * taken from a new such name, and a re-run on a used one was warm.
 * @param {unknown} run
 */
export const siteOf = (run) => {
  const origin = String(run).split(" ")[0] ?? "";
  try {
    const { protocol, hostname } = new URL(origin);
    const address = /^\d+(?:\.\d+){3}$/.test(hostname);
    return `${protocol}//${address ? hostname : hostname.split(".").slice(-2).join(".")}`;
  } catch { return origin; }
};

/**
 * THE CAPTURE, RE-DERIVED — which resources count, the four figures, and each control's verdict, all
 * from `capture.resources`, the render's time and the page's own markup, never from what the page
 * concluded.
 *
 * A resource's PHASE is `scenario` when its `startMs` is before `render.renderedAtMs`, both recorded
 * unrounded on the page's one clock, exactly the comparison the page makes; `after-render` otherwise.
 * A resource COUNTS when its parsed URL is under the subject's code origin or the catalog origin, its
 * derived phase is `scenario`, and it is not the mismatched preload's own `link` entry — identified by
 * the preload tags in the page source with the run's token substituted, exactly as `serve.mjs`
 * substitutes it. Each counted resource is named by its FILE, its path under its origin without the
 * query, which is what the graph and the manifest name. The code origin is the capture's version's, so
 * a record stays re-derivable after `SUBJECT` moves on: the revision-4 draft read the checkout's, and a
 * simulated release made the previous run's code resources vanish from its own figures (12 requests
 * as 4).
 *
 * @param {any} capture
 * @param {{ page: string, version: string }} with
 */
export function deriveCapture(capture, { page, version }) {
  const code = codeOriginFor(version);
  const token = capture?.cacheBuster?.value;
  const arms = preloadArms(page).map((arm) => ({ ...arm,
    url: nonEmpty(token) ? hrefOf(arm.href.replaceAll("__RUN__", encodeURIComponent(token))) : null }));
  const mismatched = new Set(arms.filter((arm) => !arm.crossorigin).map((arm) => arm.url));
  const renderedAt = capture?.render?.renderedAtMs;
  /** @type {any[]} */
  const resources = Array.isArray(capture?.resources) ? capture.resources : [];
  /**
   * @type {{ r: any, at: string | null, kind: "code" | "catalog" | null, file: string | null, phase: string | null,
   *   host: boolean, control: boolean, counted: boolean }[]}
   */
  const rows = resources.map((r) => {
    const at = hrefOf(r?.url);
    const kind = at === null ? null : at.startsWith(code) ? "code" : at.startsWith(RECIPE.catalogOrigin) ? "catalog" : null;
    const file = at === null || kind === null ? null : pathOf(at).slice(pathOf(kind === "code" ? code : RECIPE.catalogOrigin).length);
    const phase = isFiniteNumber(r?.startMs) && isFiniteNumber(renderedAt) ? (r.startMs < renderedAt ? "scenario" : "after-render") : null;
    const control = at !== null && r?.initiatorType === "link" && mismatched.has(at);
    return { r, at, kind, file, phase, host: kind !== null, control, counted: kind !== null && phase === "scenario" && !control };
  });
  const counted = rows.filter((row) => row.counted);
  const sum = (/** @type {string} */ field) => counted.reduce((n, row) => n + (isFiniteNumber(row.r[field]) ? row.r[field] : NaN), 0);
  const figures = { requestCount: counted.length, decodedBytes: sum("decodedBodySize"),
    encodedBytes: sum("encodedBodySize"), transferBytes: sum("transferSize") };
  // THE WHOLE SUMMARY THE PAGE WRITES, not only its four figures: its two counts of what it left out
  // are claims about the same resources, and a summary whose exclusions do not add up is not one run's.
  const summary = { ...figures,
    requestsAfterRenderExcluded: rows.filter((row) => row.host && row.phase === "after-render").length,
    controlsExcluded: rows.filter((row) => row.control).length };

  // PRELOAD REUSE, per file: the scenario-phase entries for it. The page counts the same entries —
  // at capture time, over those that started before the render returned — so the two can differ
  // only if one of them is wrong.
  const scenario = rows.filter((row) => row.phase === "scenario");
  const perFile = (/** @type {string} */ file) => scenario.filter((row) => row.kind === "catalog" && row.file === file).length;
  const preload = {
    matched: Object.fromEntries(arms.filter((arm) => arm.crossorigin).map((arm) => [arm.file, perFile(arm.file)])),
    mismatched: Object.fromEntries(arms.filter((arm) => !arm.crossorigin).map((arm) => [arm.file, perFile(arm.file)])),
  };
  // THE SECOND LOAD re-fetches the URL the loader used for fr, token and all; a memory-cache hit often
  // creates no entry, so absence is itself the cache signal (the page's own note on the control) —
  // which is why the page also records the bytes it read, and they must be fr's.
  const fr = counted.find((row) => row.kind === "catalog" && row.file === "fr.json");
  const again = fr ? rows.filter((row) => row.phase === "after-render" && row.at === fr.at) : [];
  const secondLoad = { entries: again.length, servedFromCache: fr !== undefined && (again.length === 0 || again[0]?.r.transferSize === 0),
    readFr: fr !== undefined && capture?.controls?.secondLoad?.bytesRead === fr.r.decodedBodySize };
  // THE BLIND CONTROL: the URL the PAGE declares, which the capture must name; its ONE entry must exist,
  // on an origin that is not the page's, and read 0 bytes. The page fetches it once, so a second entry
  // is not the control's: with two, which one a verdict reads would be a choice, and a review's second
  // entry reading a size passed behind a first reading 0.
  const blindAt = blindOf(page);
  const blindRows = blindAt === null ? [] : rows.filter((row) => row.at === blindAt);
  const blindRow = blindRows[0];
  const blind = { named: blindAt !== null && hrefOf(capture?.origins?.blindControl) === blindAt, present: blindRow !== undefined,
    entries: blindRows.length, answered: blindRow !== undefined && blindRow.r.responseStatus === 200,
    crossOrigin: blindAt !== null && originOf(blindAt) !== originOf(capture?.origins?.page),
    readsZero: blindRow !== undefined && blindRow.r.encodedBodySize === 0 && blindRow.r.decodedBodySize === 0 };
  // THE COLD ARM, the page's own rule: every READABLE counted entry must have crossed the network, its
  // transfer size EXCEEDING its encoded body by the response's headers, and never a cache delivery. A
  // revalidation transfers its headers alone, and a transfer smaller than the body did not bring it;
  // `index.html` says what this rule still cannot see. An unreadable counted entry's zero says nothing
  // about the cache, and it is refused on its own account (`captureProblems`).
  const examined = counted.filter((row) => row.r.encodedBodySize > 0 || row.r.decodedBodySize > 0);
  const cached = examined.filter((row) => row.r.deliveryType === "cache" || !(row.r.transferSize > row.r.encodedBodySize));
  return { rows, counted, figures, summary, preload, secondLoad, blind, fr, coldArm: { examined: examined.length, cached } };
}

/**
 * THE CAPTURE'S OWN VALIDITY, for the version it measured. Everything here is an exit term: a run
 * failing any of it is not a worse run but one whose figures cannot be read, so no reason admits it.
 * Needs no network, so the recorder applies all of it before fetching anything.
 * @param {any} capture
 * @param {{ page: string, manifestText: string, version: string }} with
 */
export function captureProblems(capture, { page, manifestText, version }) {
  if (!capture || typeof capture !== "object") return ["the record holds no capture"];
  /** @type {string[]} */
  const problems = [];
  const code = codeOriginFor(version);
  const pageOrigin = originOf(capture.origins?.page);

  // WHERE IT RAN AND WHAT IT LOADED. Every resource is examined whatever the page labelled it.
  if (capture.origins?.code !== code)
    problems.push(`the capture loaded code from ${capture.origins?.code ?? "(not recorded)"}, not ${version}'s ${code}`);
  if (capture.origins?.catalogs !== RECIPE.catalogOrigin)
    problems.push(`the capture loaded catalogs from ${capture.origins?.catalogs ?? "(not recorded)"}, not the recipe's ${RECIPE.catalogOrigin}`);
  if (pageOrigin === null || pageOrigin === "null")
    problems.push(`the capture does not record the site it ran from (${capture.origins?.page}), which is what makes the cold arm cold`);
  if (!nonEmpty(capture.cacheBuster?.value) || capture.cacheBuster?.parameter !== "0b")
    problems.push("the capture carries no run token, so its run cannot be named and its cache-buster cannot be checked");
  if (!nonEmpty(capture.userAgent)) problems.push("the capture records no user agent; the browser is recorded, never pinned, so it must be there");
  if (capture.simulated !== undefined)
    problems.push(`the capture is a simulation (${capture.simulated?.by ?? "marked simulated"}): its sizes are invented, and it is ` +
      "never a measurement");
  if (!Array.isArray(capture.resources) || capture.resources.length === 0)
    return [...problems, "the capture holds no resources, so nothing it summarises can be re-derived"];
  const malformed = capture.resources.filter((/** @type {any} */ r) => !r || typeof r !== "object" || !nonEmpty(r.url) ||
    !["scenario", "after-render"].includes(r.phase) || typeof r.readable !== "boolean" || !(isFiniteNumber(r.startMs) && r.startMs >= 0) ||
    !(isFiniteNumber(r.durationMs) && r.durationMs >= 0) || !["transferSize", "encodedBodySize", "decodedBodySize"].every((f) => isCount(r[f])));
  if (malformed.length > 0)
    problems.push(`${malformed.length} captured resource(s) are malformed (no url, phase, start time, duration, readability or ` +
      `sizes), e.g. ${JSON.stringify(malformed[0])?.slice(0, 120)}`);
  if (!(isFiniteNumber(capture.render?.renderedAtMs) && capture.render.renderedAtMs > 0))
    problems.push(`the capture does not record when the render returned (render.renderedAtMs is ` +
      `${JSON.stringify(capture.render?.renderedAtMs ?? null)}), so which requests were the scenario's cannot be re-derived`);
  const blindAt = blindOf(page);
  const outside = capture.resources.filter((/** @type {any} */ r) => {
    const at = hrefOf(r?.url);
    return at === null || !(originOf(at) === pageOrigin || at === blindAt || at.startsWith(code) || at.startsWith(RECIPE.catalogOrigin));
  });
  if (outside.length > 0)
    problems.push(`${outside.length} captured resource(s) came from neither recipe origin nor the page's own, e.g. ${outside[0]?.url}`);

  const derived = deriveCapture(capture, { page, version });
  // THE PAGE'S LABELS AND SUMMARY ARE CLAIMS, held to the derivation. Absent is not agreement.
  const misphased = derived.rows.filter((row) => row.phase !== null && row.r?.phase !== row.phase);
  if (misphased.length > 0)
    problems.push(`${misphased.length} resource(s) are labelled with a phase their own start and the render's return contradict, ` +
      `e.g. ${misphased[0]?.r?.url} labelled ${misphased[0]?.r?.phase}: which requests are the scenario's is re-derived, never ` +
      "taken as written");
  const mislabelled = derived.rows.filter((row) => row.r?.counted !== row.counted ||
    row.r?.control !== (row.control ? "mismatched-preload" : null));
  if (mislabelled.length > 0)
    problems.push(`${mislabelled.length} resource(s) are labelled counted or control differently from — or not at all — what the ` +
      `page's markup and the recipe's origins derive, e.g. ${mislabelled[0]?.r?.url}: a harness control summed as a scenario ` +
      "figure is what revision 4 removed");
  const misread = derived.rows.filter((row) => row.r?.origin !== (row.host ? "production-host" : "local-control") ||
    row.r?.readable !== (row.r?.encodedBodySize > 0 || row.r?.decodedBodySize > 0));
  if (misread.length > 0)
    problems.push(`${misread.length} resource(s) carry an origin or readability label their own URL and sizes contradict, e.g. ` +
      `${misread[0]?.r?.url}`);
  for (const [f, figure] of Object.entries(derived.summary)) {
    const claimed = capture.summary?.[f];
    const derivedFrom = /** @type {readonly string[]} */ (RATCHETED).includes(f) ? "counted resources sum to" : "resources show";
    if (claimed !== figure) problems.push(`the capture's own summary says ${f} ${claimed ?? "(absent)"}; its ${derivedFrom} ${figure}`);
  }
  // A MEASUREMENT GOING BLIND MUST NEVER READ AS AN IMPROVEMENT. Every counted resource has real sizes,
  // checked here rather than taken from the page's `readable`.
  const blindCounted = derived.counted.filter((row) => !(row.r.readable === true && row.r.encodedBodySize > 0 && row.r.decodedBodySize > 0));
  if (blindCounted.length > 0)
    problems.push(`${blindCounted.length} counted resource(s) are unreadable, e.g. ${blindCounted[0]?.r.url}: their zeros would be ` +
      "summed, and a measurement going blind would read as a smaller one. Timing-Allow-Origin may have gone");
  // EACH COUNTED RESOURCE WAS ANSWERED, AND ASKED FOR THE WAY THE SCENARIO ASKS: a code module by the
  // module loader (`script`), a catalog by its preload (`link`) or by the loader's own `fetch`. A counted
  // entry answered with anything but 200, or initiated by something the page never does, is not the
  // scenario's request whatever its sizes say: a review's chunk answered 404, and an entry point
  // initiated by `img`, each passed (2026-09-26).
  const misrequested = derived.counted.filter((row) => row.r.responseStatus !== 200 ||
    !(row.kind === "code" ? row.r.initiatorType === "script" : ["link", "fetch"].includes(row.r.initiatorType)));
  if (misrequested.length > 0)
    problems.push(`${misrequested.length} counted resource(s) were not answered 200, or not requested the way the scenario ` +
      `requests them — code by a module import, a catalog by its preload or the loader's fetch — e.g. ${misrequested[0]?.r.url} ` +
      `(status ${misrequested[0]?.r.responseStatus}, initiator ${misrequested[0]?.r.initiatorType})`);
  // …AND EACH ARRIVED BEFORE THE RENDER THAT NEEDED IT. A request is the scenario's when it STARTED before
  // the render returned, and the render needs every one: the imports resolve only once every module has
  // arrived, and the loader returns only once every catalog has. So each counted entry completed — its
  // start plus its duration, which the page rounds to 0.1 ms — before the render returned. A review's
  // catalog completing 88 ms after the render that used it passed (2026-09-26).
  const renderedAt = capture.render?.renderedAtMs;
  if (isFiniteNumber(renderedAt)) {
    const late = derived.counted.filter((row) => !(row.r.startMs + row.r.durationMs <= renderedAt + 0.05 + 1e-9));
    if (late.length > 0)
      problems.push(`${late.length} counted resource(s) completed after the render returned, e.g. ${late[0]?.r.url}, started at ` +
        `${late[0]?.r.startMs} ms for ${late[0]?.r.durationMs} ms against a render returned at ${renderedAt} ms: the render ` +
        "needed it, so it cannot have arrived after");
  }

  // THE LOADER GRAPH, AS FAR AS IT IS KNOWN WITHOUT THE NETWORK: each file counted once — nothing the
  // scenario asks for is fetched twice, the mismatch control being no longer counted — the two entry
  // points by their exact paths, and the planned catalogs, and only those, each at the size the
  // manifest declares. The chunks the entry points import are the subject's graph, which only its
  // tarball names; `historyProblems` holds the run to that.
  /** @type {Map<string, number>} */
  const times = new Map();
  for (const row of derived.counted) times.set(`${row.kind}:${row.file}`, (times.get(`${row.kind}:${row.file}`) ?? 0) + 1);
  const twice = [...times].filter(([, n]) => n > 1).map(([key]) => key.slice(key.indexOf(":") + 1));
  if (twice.length > 0)
    problems.push(`the capture counts ${twice.join(", ")} more than once; the scenario fetches each of its files once, so a second ` +
      "counted entry is a request no visitor makes");
  for (const file of RECIPE.requiredResources.entryPoints)
    if (!times.has(`code:${file}`))
      problems.push(`the capture counts no ${file} from ${code}, which the page imports; a lost resource would read as a smaller figure`);
  const sizes = catalogSizes(manifestText);
  for (const file of RECIPE.requiredResources.catalogs) {
    const row = derived.counted.find((row) => row.kind === "catalog" && row.file === file);
    if (row === undefined)
      problems.push(`the capture counts no ${file} from ${RECIPE.catalogOrigin}, which the loader graph fetches; a lost resource ` +
        "would read as a smaller figure");
    else if (row.r.decodedBodySize !== sizes[file])
      problems.push(`the capture's ${file} decoded ${row.r.decodedBodySize} bytes, not the ${sizes[file]} the manifest declares for it`);
  }
  const unplanned = derived.counted.filter((row) => row.kind === "catalog" &&
    !(/** @type {readonly (string | null)[]} */ (RECIPE.requiredResources.catalogs)).includes(row.file));
  if (unplanned.length > 0)
    problems.push(`the capture counts ${unplanned[0]?.file} from the catalog origin, which loadStrings(manifest, 'fr') does not plan`);

  // THE TIMINGS' START, on the resource entries' clock. The page reads its clock once before the imports and
  // takes all three timings from that reading — `coldImportMs` = import − start, `loadMs` = load − import,
  // `firstUsableRenderMs` = render − start, each rounded to 0.1 ms — and records the render's return
  // unrounded as `renderedAtMs`. So the start is `renderedAtMs` less the first usable render, to within that
  // figure's rounding of 0.05 ms; the preload rule and the timeline rules below both place entries against it.
  const render = capture.render ?? {};
  const [renderMs, importMs, loadMs] = [render.firstUsableRenderMs, render.coldImportMs, render.loadMs];
  const start = isFiniteNumber(renderMs) && renderMs > 0 && isFiniteNumber(render.renderedAtMs) ? render.renderedAtMs - renderMs : null;

  // THE CONTROLS ARE EXIT TERMS, not decoration. Each exists because the measurement above it is
  // unfalsifiable without an arm that must come back DIFFERENT; each is re-derived, and the page's
  // own verdict must agree with the derivation.
  const controls = capture.controls ?? {};
  if (entryDigest(controls.preload ?? null) !== entryDigest(derived.preload))
    problems.push(`the page's preload control ${JSON.stringify(controls.preload ?? null)} is not what its resources show, ` +
      JSON.stringify(derived.preload));
  if (!Object.values(derived.preload.matched).every((n) => n === 1) || Object.keys(derived.preload.matched).length !== 2)
    problems.push("the matched preloads did not report one entry each, so preload reuse was not observed");
  if (!Object.values(derived.preload.mismatched).every((n) => n >= 2) || Object.keys(derived.preload.mismatched).length !== 1)
    problems.push("the MISMATCHED preload did not report a second entry. Without an arm that is NOT reused, " +
      "one-entry-per-url is equally satisfied by a loader that never fetched — M-D S22's lesson.");
  // AND EACH MATCHED FILE'S ONE ENTRY IS THE PRELOAD'S. One entry per matched file is also what a run shows
  // in which the preload was never issued and the loader fetched the file itself: a review relabelled both
  // matched `link` entries as fetches started at 189.8 ms, and the run passed printing "preload matched"
  // (2026-09-26). M-D S22's standard for the property was one entry, initiated by the `link`, issued before
  // the loader ran. The page's preloads are in its markup, and "the browser begins fetching a parse-time
  // preload before any module script runs" (`index.html`, measured when rewriting them fired every catalog
  // twice) — so each is issued before the script reads the clock the timings start from, and therefore
  // before the loader, which the page calls after the imports and which asks for nothing before them (the
  // timeline rules below). A preload issued at 189.9 ms, 0.1 ms before the loader asked at 190, passed the
  // rule that compared it with the loader alone (review, 2026-09-26). The start is known only to the
  // first usable render's rounding, 0.05 ms. That the entry arrived before the render is the rule on every
  // counted entry, above.
  const catalogRows = derived.rows.filter((row) => row.phase === "scenario" && row.kind === "catalog");
  const matchedEntries = Object.keys(derived.preload.matched).map((file) => catalogRows.filter((row) => row.file === file))
    .filter((entries) => entries.length === 1).map(([row]) => row);
  const unlinked = matchedEntries.filter((row) => row?.r.initiatorType !== "link");
  if (unlinked.length > 0)
    problems.push(`the matched preload's one entry for ${unlinked[0]?.file} was initiated by ${JSON.stringify(unlinked[0]?.r.initiatorType)}, ` +
      "not by its link: one entry per file is equally a preload never issued and a loader that fetched the file itself");
  const unparsed = start === null ? [] : matchedEntries.filter((row) => !(row !== undefined && row.r.startMs <= start + 0.05 + 1e-9));
  if (unparsed.length > 0)
    problems.push(`the matched preload's entry for ${unparsed[0]?.file} started at ${unparsed[0]?.r.startMs} ms, after the timings' ` +
      `start at ${+Number(start).toFixed(2)} ms: the page's markup issues its preloads as it is parsed, before its script reads that ` +
      "clock, so an entry issued later is not the preload the loader reused");
  if (controls.secondLoad?.servedFromCache !== derived.secondLoad.servedFromCache)
    problems.push(`the page's second-load verdict (servedFromCache ${controls.secondLoad?.servedFromCache}) is not what its ` +
      `resources show (${derived.secondLoad.servedFromCache})`);
  if (!derived.secondLoad.servedFromCache)
    problems.push("the second-load control did not report cache delivery, so the capture is not observing delivery at all");
  // ABSENCE OF AN ENTRY READS AS A CACHE HIT, so the load must be shown to have happened: a control that
  // never fetched would otherwise read exactly like one served from cache.
  if (!derived.secondLoad.readFr)
    problems.push(`the second-load control read ${JSON.stringify(controls.secondLoad?.bytesRead ?? null)} bytes, not fr's ` +
      `${derived.fr?.r.decodedBodySize ?? "(fr not counted)"}, so its missing entry cannot be read as a cache hit`);
  if (!derived.blind.named)
    problems.push(`the capture names its blind control ${capture.origins?.blindControl ?? "(not recorded)"}, not the page's ` +
      `${blindAt ?? "(none declared)"}: any other zero-sized entry — the mismatched preload's opaque one reads 0 too — would pass as blind`);
  if (!derived.blind.present) problems.push("the blind control left no resource entry, so nothing proves the capture reads real sizes");
  else {
    if (derived.blind.entries !== 1)
      problems.push(`the blind control left ${derived.blind.entries} resource entries; the page fetches it once, so all but one are ` +
        "not the control's, and which one its verdict reads would be a choice");
    if (controls.blind?.isBlind !== derived.blind.readsZero)
      problems.push(`the page's blind verdict (isBlind ${controls.blind?.isBlind}) is not what its resources show (${derived.blind.readsZero})`);
    if (!derived.blind.readsZero)
      problems.push("the blind control reported a readable size. A cross-origin resource with no Timing-Allow-Origin must read 0; " +
        "if it does not, the capture is not reading what it believes it is.");
    // …AND ITS FETCH SUCCEEDED, or its zero proves nothing: a fetch that failed reads 0 bytes too. A review's
    // `fetched: false`, and a blind entry answered with status 0, each passed as a control that discriminated
    // (2026-09-26).
    if (controls.blind?.fetched !== true || !derived.blind.answered)
      problems.push(`the blind control's fetch did not succeed (fetched ${JSON.stringify(controls.blind?.fetched ?? null)}, status ` +
        `${JSON.stringify(derived.rows.find((row) => row.at === blindAt)?.r.responseStatus ?? null)}): a fetch that failed reads 0 ` +
        "bytes too, so its zero proves nothing about the capture");
    if (!derived.blind.crossOrigin)
      problems.push("the blind control ran on the page's own origin, where withholding Timing-Allow-Origin withholds nothing, so it " +
        "could never have read other than its real size");
  }

  // THE COLD ARM. It fails the run — a warm figure recorded as a cold one is the specific way this
  // scenario would mislead, and jsDelivr's year-long immutable cache makes it the DEFAULT outcome.
  const cached = derived.coldArm.cached;
  if (cached.length > 0)
    problems.push(`${cached.length} counted resource(s) did not cross the network — served from the browser cache, or a ` +
      `transfer no larger than the encoded body — e.g. ${cached[0]?.r.url}, so the recorded transfer figure is not a cold one. ` +
      "Re-run from a top-level site this browser has not visited — Chromium keys its HTTP cache by top-level site — with a new " +
      "`serve-0b-*` launch entry.");
  if (capture.coldArm?.contaminated !== (cached.length > 0) || capture.coldArm?.examined !== derived.coldArm.examined)
    problems.push(`the page's cold-arm verdict (contaminated ${capture.coldArm?.contaminated}, examined ${capture.coldArm?.examined}) ` +
      `is not what its resources show (${cached.length > 0}, ${derived.coldArm.examined})`);

  // STREAMING LIMITS — plan :2813 names them among what 0b records.
  const limits = capture.streamingLimits;
  const [below, at] = Array.isArray(limits?.arms) ? limits.arms : [];
  if (!limits) problems.push("no streaming-limit arm was recorded, and plan :2813 names streaming limits among what 0b records");
  else {
    // THE TWO ARMS THE PAGE RUNS, and only those: a third arm is not the recipe's, and one that loaded
    // at a byte passed unread beside the two (second review, 2026-09-25).
    if (!Array.isArray(limits.arms) || limits.arms.length !== 2)
      problems.push(`the capture records ${Array.isArray(limits.arms) ? limits.arms.length : "no list of"} streaming-limit arm(s); ` +
        "the recipe runs two, one byte under fr's decoded size and at it");
    if (!(below?.outcome === "refused" && below.failures?.length === 1 &&
          below.failures[0].locale === "fr" && below.failures[0].stage === "limit"))
      problems.push("the streaming-limit arm under the boundary did not refuse fr, and fr alone, at stage limit");
    // …and refused BY THE LOADER: the page lists `error.failures`, which only the loader's own refusal
    // carries, so any other error names a failure list the page did not read from the loader.
    else if (below.error !== "StringsLoadingError")
      problems.push(`the streaming-limit arm under the boundary was refused by ${JSON.stringify(below.error ?? null)}, not the ` +
        "loader's StringsLoadingError, whose failures are the ones it lists");
    if (at?.outcome !== "loaded")
      problems.push("the streaming-limit arm at the boundary did not load, so the refusal is not located there");
    // THE ARM DISCRIMINATES ONLY IF THE WIRE SIZE SITS UNDER THE REFUSED LIMIT AND THE BOUNDARY IS THE
    // DECODED SIZE. Re-derived from the capture's own counted entry for fr, never from the page's
    // verdict: were the host to stop compressing, or the catalog to shrink under the limit, both arms
    // could still pass while no longer telling wire bytes from decoded ones.
    const fr = derived.fr?.r;
    if (!fr) problems.push("fr.json has no counted entry, so the limit arm's premise cannot be checked");
    else if (!(fr.encodedBodySize <= below?.maximumInputBytes &&
               at?.maximumInputBytes === below.maximumInputBytes + 1 && at.maximumInputBytes === fr.decodedBodySize))
      problems.push(`the streaming-limit arm does not separate wire bytes from decoded bytes: fr is ${fr.encodedBodySize} ` +
        `encoded / ${fr.decodedBodySize} decoded against limits ${below?.maximumInputBytes} / ${at?.maximumInputBytes}`);
    // THE LIMITS THE SCENARIO LOADED UNDER, AND THE ARM'S SUBJECT, ARE CLAIMS TOO. The scenario loaded every
    // counted catalog under `inEffect`, so its byte limit is at least the largest of them; and the arm was
    // derived from fr at the size the manifest declares. A review deleted `inEffect`, set its limit to one
    // byte beside a 909-byte fr, and set the subject to 5 bytes, and each passed (2026-09-26).
    const largest = Math.max(0, ...derived.counted.filter((row) => row.kind === "catalog").map((row) => row.r.decodedBodySize));
    if (!(Number.isSafeInteger(limits.inEffect?.maximumInputBytes) && limits.inEffect.maximumInputBytes >= largest))
      problems.push(`the capture's limits in effect (maximumInputBytes ${JSON.stringify(limits.inEffect?.maximumInputBytes ?? null)}) ` +
        `are not limits the scenario could have loaded its catalogs under: the largest it loaded decoded ${largest} bytes`);
    if (limits.subject?.locale !== "fr" || limits.subject?.manifestDecodedBytes !== sizes["fr.json"])
      problems.push(`the streaming-limit arm's subject ${JSON.stringify(limits.subject ?? null)} is not fr at the ` +
        `${sizes["fr.json"]} bytes the manifest declares, which is what its two limits are derived from`);
  }

  if (!Array.isArray(capture.problems)) problems.push("the capture carries no problems list; absence is not agreement");
  else for (const problem of capture.problems) problems.push(`the capture reported: ${problem}`);

  // FIRST USABLE RENDER: what was rendered, then when.
  if (render.locale !== RECIPE.render.locale || render.key !== RECIPE.render.key)
    problems.push(`the capture rendered ${render.key} in ${render.locale}, not the recipe's ${RECIPE.render.key} in ${RECIPE.render.locale}`);
  if (render.rendered === RECIPE.render.key || render.renderedTheKeyBack !== false)
    problems.push("the render returned the raw key (or does not say it did not), so nothing usable was rendered");
  else if (render.rendered !== RECIPE.render.expected)
    problems.push(`the capture rendered ${JSON.stringify(render.rendered ?? null)}, not the recipe's ${JSON.stringify(RECIPE.render.expected)}`);
  // THE TIMINGS ARE REPORTED, NEVER COMPARED with a number or with another run — but their absence fails,
  // because absence is never agreement, and so does a set of them that the capture's own clock and resources
  // contradict. The page takes all three from one start (above) and rounds each to 0.1 ms. So unrounded,
  // render >= import + load; each rounding moves a figure by at most 0.05, so the rounded figures can
  // fall short of that by at most 0.15, and anything further is not one run's timings.
  for (const [name, value] of /** @type {const} */ ([["firstUsableRenderMs", renderMs], ["coldImportMs", importMs], ["loadMs", loadMs]]))
    if (!(isFiniteNumber(value) && value > 0))
      problems.push(`the capture's ${name} is ${JSON.stringify(value ?? null)}; it is reported and never gated, but it must be ` +
        "a finite, positive time");
  if ([renderMs, importMs, loadMs].every((v) => isFiniteNumber(v) && v > 0) && renderMs + 0.15 + 1e-9 < importMs + loadMs)
    problems.push(`the capture's timings are inconsistent: first usable render ${renderMs} ms is less than cold import ${importMs} + ` +
      `load ${loadMs} ms beyond the page's rounding, and all three are measured from one start`);
  // AND THE RENDER'S DURATION CANNOT EXCEED THE CLOCK IT WAS READ FROM. `renderedAtMs` is the page's clock
  // when the render returned, unrounded, and the start the timings are taken from is a later reading of
  // the same clock, so the rounded first usable render is at most 0.05 ms beyond it: a review's
  // 999,999 ms beside a render returned at 195.53 was accepted.
  if (isFiniteNumber(renderMs) && isFiniteNumber(render.renderedAtMs) && renderMs > render.renderedAtMs + 0.05 + 1e-9)
    problems.push(`the capture's first usable render ${renderMs} ms is longer than the ${render.renderedAtMs} ms the page's clock had ` +
      "run when the render returned, and both are read from that clock");
  // AND THE TIMINGS ARE THE CAPTURE'S OWN TIMELINE'S, placed on the resource entries' clock from the start
  // above. The page reads its start and THEN imports the code, so the start is no later than the first code
  // request; the imports resolve only once every module has arrived, so the start plus the cold import is no
  // earlier than the last code entry's completion; the page calls the loader only once the imports have
  // resolved, so the import ended no later than the loader's first request, a counted catalog it fetched; and
  // the loader returns only once every catalog it planned has arrived, so the start plus the cold import plus
  // the load is no earlier than the last counted catalog's completion. Each comparison allows the roundings
  // it stands on, 0.05 ms apiece: the render's, then the import's, the load's and an entry's duration. A
  // review's 2.1 / 1 / 1 ms, whose start falls after a code request made at 22.4 ms, passed; so did
  // 210.8 / 200 / 10.8, an import ending at 222.2 ms after a loader that asked at 190, and 210.8 / 156.6 / 1,
  // a load ending at 179.8 ms before the catalog it waited for completed at 211.9 (2026-09-26).
  if (start !== null) {
    const codeRows = derived.counted.filter((row) => row.kind === "code");
    if (codeRows.length > 0) {
      const firstCode = Math.min(...codeRows.map((row) => row.r.startMs));
      if (start > firstCode + 0.05 + 1e-9)
        problems.push(`the capture's timings start after its own requests: the render returned at ${render.renderedAtMs} ms, ` +
          `${renderMs} ms after the timings' start, which is therefore at ${+start.toFixed(2)} ms — later than the first code request, ` +
          `made at ${firstCode} ms, which the page makes only after that start`);
      const lastCode = Math.max(...codeRows.map((row) => row.r.startMs + row.r.durationMs));
      if (isFiniteNumber(importMs) && importMs > 0 && start + importMs + 0.15 + 1e-9 < lastCode)
        problems.push(`the capture's cold import ended before its code arrived: from the timings' start at ${+start.toFixed(2)} ms it ` +
          `took ${importMs} ms, and the last code entry completed at ${+lastCode.toFixed(2)} ms`);
    }
    const imported = isFiniteNumber(importMs) && importMs > 0 ? start + importMs : null;
    const loaderRows = derived.counted.filter((row) => row.kind === "catalog" && row.r.initiatorType === "fetch");
    if (imported !== null && loaderRows.length > 0) {
      const asked = Math.min(...loaderRows.map((row) => row.r.startMs));
      if (imported > asked + 0.1 + 1e-9)
        problems.push(`the capture's cold import ended after its loader asked for a catalog: from the timings' start at ` +
          `${+start.toFixed(2)} ms it took ${importMs} ms, ending at ${+imported.toFixed(2)} ms, and the loader — which the page calls ` +
          `only once the imports have resolved — fetched a catalog at ${asked} ms`);
    }
    const catalogCounted = derived.counted.filter((row) => row.kind === "catalog");
    if (imported !== null && isFiniteNumber(loadMs) && loadMs > 0 && catalogCounted.length > 0) {
      const lastCatalog = Math.max(...catalogCounted.map((row) => row.r.startMs + row.r.durationMs));
      if (imported + loadMs + 0.2 + 1e-9 < lastCatalog)
        problems.push(`the capture's load ended before its catalogs arrived: it took ${loadMs} ms from the import's end at ` +
          `${+imported.toFixed(2)} ms, ending at ${+(imported + loadMs).toFixed(2)} ms, and the last counted catalog completed at ` +
          `${+lastCatalog.toFixed(2)} ms — the loader returns only once every catalog it planned has arrived`);
    }
  }
  return problems;
}

/**
 * THE HOST FACTS a browser cannot read, fetched by the recorder from the same URLs the capture
 * measured. Required, never merely printed: every header the recipe names present on both probes,
 * every header asked for recorded (`null` where the host sent none), the code pinned to an exact
 * version and the catalogs to a commit — a branch ref would let the bytes under a recorded measurement
 * change without the record noticing, which the recorder used to print as a WARNING and record anyway.
 * @param {any} host
 * @param {string} version
 */
export function hostProblems(host, version) {
  if (!host || typeof host !== "object")
    return ["the record carries no host preconditions; the host's actual content encoding is one of the things plan :2813 requires 0b to record"];
  /** @type {string[]} */
  const problems = [];
  if (!hasExactly(host, ["contentEncoding", "code", "catalogs", "codePinnedToVersion", "catalogsPinnedToCommit"]))
    problems.push(`the host preconditions carry [${Object.keys(host).sort()}], not the five the recorder writes; they were edited by hand`);
  const probes = { code: codeOriginFor(version) + "lokalized.js", catalogs: RECIPE.catalogOrigin + "fr.json" };
  for (const [name, url] of Object.entries(probes)) {
    const probe = host[name];
    if (probe?.url !== url) problems.push(`the ${name} host probe was taken at ${probe?.url ?? "(not recorded)"}, not ${url}`);
    if (!hasExactly(probe?.headers, PROBED_HEADERS))
      problems.push(`the ${name} host probe records [${Object.keys(probe?.headers ?? {}).sort()}], not every header the recorder ` +
        `asks for [${[...PROBED_HEADERS].sort()}]; what was probed must be on the record`);
    for (const header of RECIPE.requiredHostHeaders)
      if (!nonEmpty(probe?.headers?.[header]))
        problems.push(`the ${name} origin sent no ${header}, which the recipe requires of the host (probed at ${probe?.url ?? "(not recorded)"})`);
  }
  if (!nonEmpty(host.contentEncoding) || host.contentEncoding !== host.code?.headers?.["content-encoding"])
    problems.push(`the recorded content encoding ${JSON.stringify(host.contentEncoding ?? null)} is not the code probe's ` +
      `${JSON.stringify(host.code?.headers?.["content-encoding"] ?? null)}`);
  // ONE HOST, ONE CONTENT ENCODING ON THE RECORD, so the catalog probe names it too — otherwise the record's
  // encoding describes the code alone: a review's catalog probe reading `identity`, and `gzip`, beside the
  // code's `br` each passed (2026-09-26). A host that answers the two routes differently is refused here
  // rather than recorded under one label.
  if (host.catalogs?.headers?.["content-encoding"] !== host.contentEncoding)
    problems.push(`the catalog probe was sent ${JSON.stringify(host.catalogs?.headers?.["content-encoding"] ?? null)}, not the ` +
      `host's recorded ${JSON.stringify(host.contentEncoding ?? null)}: the record keeps one content encoding for the host, and it ` +
      "must describe the catalogs the scenario loaded as well as its code");
  const codeVersioned = host.code?.headers?.["x-jsd-version-type"] === "version";
  if (host.codePinnedToVersion !== codeVersioned || !codeVersioned)
    problems.push("the code origin did not report x-jsd-version-type: version, so the code under measurement is not pinned to " +
      "an exact published version");
  const catalogsCommitted = host.catalogs?.headers?.["x-jsd-version-type"] === "commit";
  if (host.catalogsPinnedToCommit !== catalogsCommitted || !catalogsCommitted)
    problems.push("the catalog origin did not report x-jsd-version-type: commit, so the catalogs are not pinned to a commit and " +
      "the bytes under the measurement could change without the record noticing");
  return problems;
}

/**
 * THE PROBES ARE OF THE BYTES THE BROWSER WAS SENT, where the host says how many. A probe's
 * `content-length` is the length of the encoded body it was sent, which must be the capture's encoded
 * size for the same file: otherwise the recorded content encoding describes some other response than
 * the one measured — a review had a probe answer `gzip` beside a capture whose `lokalized.js` was
 * `br`-sized, and it was accepted. A host that states no length ties nothing, and that is on the record
 * as `null`; jsDelivr stated 64,728 for rc.2's `lokalized.js` on 2026-09-25, the size revision 3's
 * capture measured. And a probe sent its file with NO content coding — `identity` — was sent the decoded
 * bytes, so the capture's file must be as large encoded as decoded, whether or not a length was stated:
 * without this, the host's label rewritten to `identity` on the record, both probes and the newest run,
 * beside a capture whose bytes are compressed, passed every other check (measured 2026-09-26).
 * @param {any} host
 * @param {ReturnType<typeof deriveCapture>} derived
 */
export function probeTieProblems(host, derived) {
  /** @type {string[]} */
  const problems = [];
  for (const [name, kind, file] of /** @type {const} */ ([["code", "code", "lokalized.js"], ["catalogs", "catalog", "fr.json"]])) {
    const row = derived.counted.find((row) => row.kind === kind && row.file === file);
    if (row === undefined) continue;
    const stated = host?.[name]?.headers?.["content-length"];
    const encoding = host?.[name]?.headers?.["content-encoding"];
    if (stated !== null && stated !== undefined && String(stated) !== String(row.r.encodedBodySize))
      problems.push(`the ${name} probe was sent ${stated} bytes of ${encoding} for ${file}, and ` +
        `the capture's ${file} is ${row.r.encodedBodySize} encoded: the probe did not see the response the browser measured`);
    if (encoding === "identity" && row.r.encodedBodySize !== row.r.decodedBodySize)
      problems.push(`the ${name} probe was sent ${file} with no content coding (identity), and the capture's ${file} is ` +
        `${row.r.encodedBodySize} encoded / ${row.r.decodedBodySize} decoded: the probe did not see the response the browser measured`);
  }
  return problems;
}

/**
 * A published graph's shape: `{ "<path under dist/browser/>": <bytes> }`, holding both entry points.
 * @param {unknown} graph
 */
const graphShaped = (graph) => isPlainObject(graph) &&
  Object.entries(/** @type {object} */ (graph)).length > 0 &&
  Object.entries(/** @type {object} */ (graph)).every(([file, size]) => MODULE_PATH.test(file) && Number.isSafeInteger(size) && size > 0) &&
  RECIPE.requiredResources.entryPoints.every((file) => Object.hasOwn(/** @type {object} */ (graph), file));

/**
 * The request count and decoded bytes a run of `graph` must record: its modules and the planned
 * catalogs, each once, at their sizes.
 * @param {Record<string, number>} graph @param {Record<string, number | null>} catalogs
 */
export const graphFigures = (graph, catalogs) => ({
  requestCount: Object.keys(graph).length + Object.keys(catalogs).length,
  decodedBytes: [...Object.values(graph), ...Object.values(catalogs)].reduce((/** @type {number} */ n, size) => n + (size ?? NaN), 0),
});

/** A subject as the recorder measures it: the version, its registry integrity, its tarball's sha256, its graph. */
const subjectShapeProblems = (/** @type {any} */ subject, /** @type {string} */ name) => {
  /** @type {string[]} */
  const problems = [];
  if (!hasExactly(subject, ["version", "integrity", "tarballSha256", "graph"]))
    problems.push(`${name}'s subject carries [${Object.keys(subject ?? {}).sort()}], not the version, integrity, tarball digest ` +
      "and graph the recorder measures; a field nothing measured would look like a measurement");
  if (!EXACT_VERSION.test(String(subject?.version))) problems.push(`${name} names no exact version (${subject?.version})`);
  if (!INTEGRITY.test(String(subject?.integrity))) problems.push(`${name} carries no sha512 registry integrity for its tarball`);
  if (!HEX64.test(String(subject?.tarballSha256))) problems.push(`${name} carries no sha256 of its tarball`);
  if (!graphShaped(subject?.graph))
    problems.push(`${name} carries no published graph — modules under dist/browser/ with their sizes, both entry points among them`);
  return problems;
};

/**
 * The keys a history entry has, every one computed by the recorder except `reason`. A run recorded before
 * entries carried `timingsSha256` has the others alone, and its capture's digest is frozen in
 * `HISTORY_UNTIMED` instead.
 */
const ENTRY_KEYS = ["run", "subject", "userAgent", "contentEncoding", "ratcheted", "reported", "grew", "reason",
  "priorRevisionsSha256", "timingsSha256", "previousSha256"];
const UNTIMED_ENTRY_KEYS = ENTRY_KEYS.filter((key) => key !== "timingsSha256");

/**
 * The newest run in `history` that measured `version`, which need not be the run before the newest: a
 * record can measure a release and then return to an earlier version.
 * @param {readonly any[]} history @param {string} version
 */
export const lastRunOf = (history, version) => history.findLast((entry) => entry?.subject?.version === version);

/**
 * THE RUNS A NEW RUN IS COMPARED WITH: the run before it, and the last run of its own version when that
 * is another run — when the record measured another version in between. The neighbour alone let a
 * review grow one version's encoded bytes with no reason by ALTERNATING versions: rc.2, a release 500
 * bytes worse recorded with its reason, then rc.2 again 50 bytes worse than rc.2's own last run, which
 * read as no growth because its neighbour was bigger (2026-09-25). A return to an older, bigger version
 * after a smaller release still grew over its neighbour, and still needs its reason.
 * @param {readonly any[]} earlier the history before the run @param {any} entry
 * @returns {any[]}
 */
export function baselinesOf(earlier, entry) {
  const previous = earlier.at(-1);
  if (previous === undefined) return [];
  const last = lastRunOf(earlier, entry?.subject?.version);
  return last === undefined || last === previous ? [previous] : [previous, last];
}

/**
 * WHICH RATCHETED FIGURES GREW, over either baseline — computed, never supplied, and recomputed by the
 * checker, so a reason cannot be attached to one figure while another grew.
 * @param {readonly any[]} earlier the history before the run @param {any} entry
 */
export const grewOver = (earlier, entry) =>
  RATCHETED.filter((f) => baselinesOf(earlier, entry).some((run) => entry?.ratcheted?.[f] > run?.ratcheted?.[f]));

/** The two figures a version's published graph fixes, and a reason therefore cannot admit a change in. */
export const FIXED_PER_VERSION = /** @type {const} */ (["requestCount", "decodedBytes"]);

/**
 * ONE VERSION, ONE GRAPH — BEFORE THE NETWORK. A run of a version already in the history must count what
 * that version's last run counted, because both are that version's published graph: the checker holds
 * every run to its graph, and one version to one graph. The recorder applies this before it fetches the
 * tarball, so a lost or doubled resource on a version already measured is refused offline and never told
 * that a reason would admit it. It compares with the version's LAST run, not the history's: a review's
 * route past a rule that compared only neighbours measured a release at 10 requests and then the first
 * version again at 10, one chunk short of its own 11, recorded with no reason.
 * @param {readonly any[]} history @param {{ subject: { version: string }, ratcheted: Record<string, number> }} run
 */
export function versionFigureProblems(history, run) {
  const last = lastRunOf(history, run.subject.version);
  if (last === undefined) return [];
  const moved = FIXED_PER_VERSION.filter((f) => run.ratcheted[f] !== last.ratcheted?.[f]);
  return moved.length === 0 ? [] : [`lokalized@${run.subject.version} was measured by ${last.run} at ` +
    moved.map((f) => `${f} ${last.ratcheted?.[f]}`).join(" and ") + ", and this capture counts " +
    moved.map((f) => `${f} ${run.ratcheted[f]}`).join(" and ") + ": one published version's graph cannot move, so " +
    "the capture lost a resource or counts one its graph does not hold, which no reason admits"];
}

/**
 * WHAT CHANGED BETWEEN TWO PUBLISHED GRAPHS, module by module.
 * @param {any} was @param {any} now
 */
const graphChange = (was, now) => {
  /** @type {Record<string, number>} */
  const a = isPlainObject(was) ? was : {}, b = isPlainObject(now) ? now : {};
  const changes = [...Object.keys(b).filter((f) => !Object.hasOwn(a, f)).map((f) => `${f} added (${b[f]} bytes)`),
    ...Object.keys(a).filter((f) => !Object.hasOwn(b, f)).map((f) => `${f} removed (${a[f]} bytes)`),
    ...Object.keys(b).filter((f) => Object.hasOwn(a, f) && a[f] !== b[f]).map((f) => `${f} ${a[f]} -> ${b[f]} bytes`)];
  return changes.length > 0 ? changes.join(", ") : "no module changed";
};

/**
 * WHO MOVED A FIGURE, read off what did NOT move. Printed with the refusal so the reason the operator
 * writes starts from the right cause; it never excuses anything by itself. The page's method is frozen
 * by the recipe and the request count and decoded bytes are the version's graph, so those two move only
 * at a release; encoded bytes move with the host's compression and transfer bytes with the browser's
 * accounting. Before the network the new run's graph is not yet read, so the release is named without it.
 * @param {any} was @param {any} now
 */
export function growthCauses(was, now) {
  const r0 = was?.ratcheted ?? {}, r1 = now?.ratcheted ?? {};
  const up = (/** @type {string} */ f) => r1[f] > r0[f];
  const same = (/** @type {string} */ f) => r1[f] === r0[f];
  const v0 = was?.subject?.version, v1 = now?.subject?.version;
  /** @type {string[]} */
  const causes = [];
  if (up("requestCount") || up("decodedBytes")) {
    const moved = [up("requestCount") ? `requests ${r0.requestCount} -> ${r1.requestCount}` : null,
      up("decodedBytes") ? `decoded ${r0.decodedBytes} -> ${r1.decodedBytes}` : null].filter(Boolean).join(", ");
    causes.push(`${moved}: ` + (v0 === v1
      ? `that run measured ${v1} too, and one version's graph cannot move, so the capture counts a resource its version's ` +
        "graph does not hold"
      : `the published files of ${v1} differ from ${v0}'s` +
        (isPlainObject(now?.subject?.graph) ? ` — ${graphChange(was?.subject?.graph, now.subject.graph)}` : "")));
  }
  if (up("encodedBytes")) causes.push(`encoded ${r0.encodedBytes} -> ${r1.encodedBytes}` + (same("decodedBytes") && same("requestCount")
    ? `: the decoded bytes did not move, so the HOST compressed the same files differently` +
      (now?.contentEncoding !== undefined && was?.contentEncoding !== now.contentEncoding
        ? ` (content-encoding ${was?.contentEncoding} -> ${now.contentEncoding})` : "")
    : ""));
  if (up("transferBytes")) causes.push(`transfer ${r0.transferBytes} -> ${r1.transferBytes}` + (same("encodedBytes") && same("requestCount")
    ? ": encoded bytes and requests did not move, so the browser's per-response accounting did" +
      (now?.userAgent !== undefined && was?.userAgent !== now.userAgent ? " (the user agent changed)" : "")
    : ""));
  return causes;
}

/**
 * WHAT GREW, OVER WHICH RUN, AND WHO LIKELY MOVED IT: one clause per baseline the run grew over, each
 * naming that run, and the version's last run named as such. Empty when nothing grew.
 * @param {readonly any[]} earlier the history before the run @param {any} entry
 */
export const growthOver = (earlier, entry) => baselinesOf(earlier, entry)
  .map((run) => ({ run, causes: growthCauses(run, entry) }))
  .filter(({ causes }) => causes.length > 0)
  .map(({ run, causes }) => `over ${run.run}${run === earlier.at(-1) ? "" : ` (the last run of ${entry?.subject?.version})`} — ` +
    causes.join("; "))
  .join("; and ");

/**
 * The line that freezes `history` through its newest run, as `HISTORY_CHECKPOINTS` holds it.
 * @param {readonly object[]} history @param {number} revision
 */
export const checkpointLine = (history, revision) => `  ${revision}: ${JSON.stringify(checkpointOf(history))},`;

/**
 * THE NEWEST RUN, AGAINST THE CHECKPOINT FROZEN IN SOURCE: the checkpoint must name it. A checkpoint that
 * names no entry, a later one or an edited one is `chainProblems`' to report; this is the one it does not,
 * a checkpoint behind the newest run, or none at all — which is how a recorded run looks until its line is
 * set, and how a run written or rewritten by hand looks for as long as nobody sets one.
 * @param {readonly object[]} history @param {number} revision @param {Checkpoint | undefined} checkpoint
 * @returns {string[]}
 */
function newestRunProblems(history, revision, checkpoint) {
  const last = history.length - 1;
  const set = `set this inside HISTORY_CHECKPOINTS in tools/0b-recipe.mjs:\n${checkpointLine(history, revision)}`;
  if (checkpoint === undefined)
    return [`revision ${revision}'s newest run is frozen by no checkpoint, so it could be rewritten, or the record rolled back over ` +
      `it, and still pass. After reviewing the record's diff, ${set}`];
  if (Number.isSafeInteger(checkpoint.index) && checkpoint.index >= 0 && checkpoint.index < last)
    return [`${RECORD_NAME}'s history has ${last - checkpoint.index} run(s) after run ${checkpoint.index}, the newest ` +
      `HISTORY_CHECKPOINTS freezes: recorded, and not yet reviewed into source. Review the record's diff, then ${set}\n` +
      `— or restore the committed record (git checkout HEAD -- ${RECORD_NAME})`];
  return [];
}

/**
 * A RENUMBERED RECIPE: this revision's recipe with nothing changed but its number, which is an earlier
 * revision's recipe under a new one. A new revision starts a new history compared with nothing (plan
 * :2796-2797), so a renumber alone would let a grown run escape the ratchet as a first run: a review bumped
 * `revision` 4 -> 5, froze its digest, and a run 5,000 bytes heavier then passed the recorder and the
 * checker with no reason (2026-09-26).
 * Read against every earlier revision's FROZEN digest rather than a record's copy of its recipe, so it
 * holds whatever record, if any, is replaced.
 * @param {{ revision: number, [field: string]: unknown }} [recipe] @param {Record<number, string>} [digests]
 * @returns {string[]}
 */
export function renumberProblems(recipe = RECIPE, digests = RECIPE_DIGESTS) {
  const same = Object.keys(digests).map(Number).filter((revision) => revision < recipe.revision &&
    sha256(JSON.stringify({ ...recipe, revision })) === digests[revision]);
  return same.map((revision) => `recipe revision ${recipe.revision} is revision ${revision}'s recipe with nothing changed but its ` +
    `number: a renumber is not a new scenario, and runs under it would escape comparison with revision ${revision}'s. Put ` +
    "RECIPE.revision back, or change what the new revision is for");
}

/**
 * THE HISTORY'S OWN CONSISTENCY, for a record at this recipe's revision. The chain starts where
 * `HISTORY_ORIGINS` says and each run names the digest of the one before it (`tools/ratchet-chain.mjs`),
 * so no run can be removed from the middle, reordered or edited, nor the history started again; the
 * newest run is bound to the capture the record holds, so it cannot be cut off without the capture going
 * with it; every growth carries a reason; every run's request count and decoded bytes are its own
 * graph's; runs and sites are unique, because a second run from one site cannot be cold; and one
 * version is never recorded with two digests or two graphs. Earlier revisions are CONTEXT (plan
 * :2796-2797), each naming its own frozen recipe, and are never compared — but they are BOUND: every run
 * carries the digest of the `priorRevisions` the record held when it was written, which the recorder
 * sets once, at a revision's first run, and never changes, so the frozen first run freezes them too. A
 * review emptied the list by hand and the checker passed it, and the recorder then accepted a run from
 * revision 3's spent site (2026-09-25).
 *
 * **THE CHAIN CANNOT SEE ITS OWN END, SO THE NEWEST RUN IS FROZEN IN SOURCE — GATED.** The record as it
 * stood at an earlier run — history cut back to that run, capture and host facts with it — is a valid
 * chain, and so is a run edited and every later link recomputed: a review measured a release run of 11
 * requests recorded with no reason against a rolled-back record, which the true latest run, at 10,
 * refused, and a grown run's reason rewritten to another sentence passing (2026-09-26). So the checkpoint
 * frozen in `HISTORY_CHECKPOINTS` must name the NEWEST run, as `tools/scenarios-1-5/check.mjs` requires
 * of `HISTORY_NEWEST_ENTRY`: until it does this fails naming the line to set, and once it does, a history
 * cut before it, or any run up to it edited, is refused. Every refusal of the chain names the COMMITTED
 * record as the remedy, because an older state from git is exactly this rollback.
 *
 * **AND NO RUN REPEATS ANOTHER'S TIMELINE.** Each run carries `timingsOf` its capture, the newest held to
 * the record's capture; two runs carrying one timeline are one capture recorded twice under two names, and
 * so is a run carrying the timeline of an earlier revision's run that `priorRevisions` keeps.
 * @param {any} record
 * @param {ReturnType<typeof deriveCapture>} derived the record's capture, re-derived
 * @param {{ origins: Record<number, string>, checkpoints: Record<number, Checkpoint>, untimed: Record<number, readonly string[]>,
 *   catalogs: Record<string, number | null> }} context
 */
export function historyProblems(record, derived, { origins, checkpoints, untimed, catalogs }) {
  const revision = record?.recipe?.revision;
  const history = record?.history;
  /** @type {string[]} */
  const problems = [];
  const origin = origins[revision];
  // A checkpoint line set to `null` is read as no line at all, and refused as one: `chainProblems` would
  // otherwise throw on it, and a checker that throws reads as a red for the wrong reason.
  const checkpoint = checkpoints[revision] ?? undefined;
  const shaped = Array.isArray(history) && history.length > 0 && history.every(isPlainObject);
  if (shaped && origin === undefined)
    problems.push(`revision ${revision}'s history has no frozen first run. Add this line inside HISTORY_ORIGINS in tools/0b-recipe.mjs:\n` +
      `  ${revision}: "${entryDigest(history[0])}",`);
  problems.push(...chainProblems(history, origin ?? (shaped ? entryDigest(history[0]) : undefined), RECORD_NAME, checkpoint)
    .map((p) => p.replaceAll("Restore the record from git", `Restore the committed record (git checkout HEAD -- ${RECORD_NAME})`)));
  if (!shaped) return problems;
  problems.push(...newestRunProblems(history, revision, checkpoint));

  const prior = Array.isArray(record.priorRevisions) ? record.priorRevisions : null;
  if (prior === null) problems.push("the record carries no priorRevisions list");
  const priorSha256 = entryDigest(record.priorRevisions ?? null);
  const unbound = history.findIndex((/** @type {any} */ entry) => entry.priorRevisionsSha256 !== priorSha256);
  if (unbound >= 0)
    problems.push(`run ${unbound} (${history[unbound].run}) was recorded beside other priorRevisions than the record holds ` +
      `(${String(history[unbound].priorRevisionsSha256).slice(0, 12)} -> ${priorSha256.slice(0, 12)}): they were edited after the ` +
      `history started. Restore the committed record (git checkout HEAD -- ${RECORD_NAME})`);
  const catalogsKnown = Object.values(catalogs).every((size) => size !== null);
  /** @type {Map<string, string>} */
  const subjectOf = new Map();
  const runs = new Set(), sites = new Set();
  for (const p of prior ?? []) { runs.add(p?.run); sites.add(siteOf(p?.run)); }
  // THE TIMELINE EACH RUN WAS TAKEN WITH: its own `timingsSha256`, or for a run recorded before entries
  // carried one, the digest frozen for it in `HISTORY_UNTIMED`.
  const frozenTimings = untimed[revision] ?? [];
  /** @type {unknown[]} */
  const timings = history.map((/** @type {any} */ entry, /** @type {number} */ i) => i < frozenTimings.length ? frozenTimings[i] : entry.timingsSha256);
  // …AND EACH EARLIER REVISION'S RUNS, whose captures left the record when it was replaced: the recorder keeps
  // their timelines on the context entry it carries forward (`timings`), which every run here binds.
  /** @type {Map<unknown, number>} */
  const earlierTimings = new Map();
  for (const p of prior ?? []) for (const t of Array.isArray(p?.timings) ? p.timings : []) earlierTimings.set(t, p.revision);
  history.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
    const name = `run ${i} (${entry.run})`;
    const keys = i < frozenTimings.length ? UNTIMED_ENTRY_KEYS : ENTRY_KEYS;
    if (!hasExactly(entry, keys))
      problems.push(`${name} has keys [${Object.keys(entry).sort()}], not [${keys}]; every field but the reason is computed`);
    if (i >= frozenTimings.length && !HEX64.test(String(entry.timingsSha256)))
      problems.push(`${name} records no digest of its capture's timings, so a replay of it could not be told from a new run`);
    const repeated = timings.indexOf(timings[i]);
    if (repeated < i)
      problems.push(`${name} carries the capture timings of run ${repeated} (${history[repeated]?.run}): every start and duration ` +
        "the same is one capture recorded twice under two names, not a new run");
    else if (earlierTimings.has(timings[i]))
      problems.push(`${name} carries the capture timings of a run of revision ${earlierTimings.get(timings[i])}, kept in ` +
        "priorRevisions: every start and duration the same is that run's capture recorded again under another name, not a new run");
    if (!nonEmpty(entry.run) || !String(entry.run).includes(" ")) problems.push(`${name} names no run`);
    if (runs.has(entry.run)) problems.push(`${name} appears twice; one run cannot be compared with itself`);
    else if (sites.has(siteOf(entry.run))) problems.push(`${name} ran from a site an earlier run used, so it cannot have been cold`);
    runs.add(entry.run); sites.add(siteOf(entry.run));
    const subjectProblems = subjectShapeProblems(entry.subject, name);
    problems.push(...subjectProblems);
    const known = subjectOf.get(entry.subject?.version);
    if (known !== undefined && known !== entryDigest(entry.subject ?? null))
      problems.push(`${name} records ${entry.subject?.version} with digests or a graph an earlier run recorded differently; a ` +
        "published version never changes");
    subjectOf.set(entry.subject?.version, entryDigest(entry.subject ?? null));
    if (!nonEmpty(entry.userAgent)) problems.push(`${name} records no user agent`);
    if (!nonEmpty(entry.contentEncoding)) problems.push(`${name} records no content encoding`);
    if (!hasExactly(entry.ratcheted, RATCHETED))
      problems.push(`${name} records ratcheted figures [${Object.keys(entry.ratcheted ?? {}).sort()}], not [${[...RATCHETED].sort()}]`);
    for (const f of RATCHETED)
      if (!isCount(entry.ratcheted?.[f])) problems.push(`${name} records no ${f}`);
    if (!hasExactly(entry.reported, REPORTED))
      problems.push(`${name} records reported figures [${Object.keys(entry.reported ?? {}).sort()}], not [${[...REPORTED].sort()}]`);
    for (const f of REPORTED)
      if (!(isFiniteNumber(entry.reported?.[f]) && entry.reported[f] > 0))
        problems.push(`${name} records no ${f}; it is reported and never gated, but it must be there`);
    // EVERY RUN IS ITS VERSION'S GRAPH, not only the newest: an earlier run's two fixed figures are
    // re-derived from the graph it recorded and the manifest's catalogs.
    if (subjectProblems.length === 0 && catalogsKnown) {
      const expected = graphFigures(entry.subject.graph, catalogs);
      for (const f of /** @type {const} */ (["requestCount", "decodedBytes"]))
        if (entry.ratcheted?.[f] !== expected[f])
          problems.push(`${name} records ${f} ${entry.ratcheted?.[f]}; lokalized@${entry.subject.version}'s published graph and the ` +
            `planned catalogs make ${expected[f]}`);
    }
    const earlier = history.slice(0, i);
    const grew = grewOver(earlier, entry);
    if (JSON.stringify(entry.grew ?? null) !== JSON.stringify(grew))
      problems.push(`${name} records growth in [${entry.grew ?? "nothing"}] while its figures grew in [${grew}]`);
    if (!(entry.reason === null || nonEmpty(entry.reason))) problems.push(`${name}'s reason is neither null nor a sentence`);
    // A REVISION'S FIRST RUN BESIDE AN EARLIER REVISION'S RUN SAYS WHY THE REVISION WAS CUT: it is compared with
    // nothing, so it is where a grown figure would otherwise pass unexplained. The recorder refuses it without one,
    // and this holds a record written without the recorder to the same. A run from before runs carried their
    // timelines — revision 4's first, frozen in `HISTORY_UNTIMED` — also predates this rule, and carries none.
    if (i === 0 && i >= frozenTimings.length && (prior ?? []).length > 0 && !nonEmpty(entry.reason))
      problems.push(`${name} starts revision ${revision}'s history beside revision ${prior?.at(-1)?.revision}'s run and is compared ` +
        "with nothing, but records no reason why the revision was cut");
    if (grew.length > 0 && !nonEmpty(entry.reason))
      problems.push(`${name} grew with no recorded reason ${growthOver(earlier, entry)}`);
  });

  // THE LAST RUN IS THE CAPTURE, and the capture is its own resources. This is also what holds the END
  // of the chain, which no later entry names: cut the newest run off and the record's capture is no
  // longer the newest run's, unless it is rolled back with it (above).
  const latest = history[history.length - 1];
  const capture = record.capture;
  if (latest.run !== runOf(capture))
    problems.push(`the history's last run is ${latest.run}, but the record holds the capture of ${runOf(capture)}`);
  if (capture?.origins?.code !== codeOriginFor(latest.subject?.version))
    problems.push(`the history's last run measured ${latest.subject?.version}, but the capture loaded code from ${capture?.origins?.code}`);
  for (const f of RATCHETED) {
    const figure = /** @type {Record<string, number>} */ (derived.figures)[f];
    if (latest.ratcheted?.[f] !== figure)
      problems.push(`the history's last run records ${f} ${latest.ratcheted?.[f]}; the capture's counted resources sum to ${figure}`);
  }
  for (const f of REPORTED)
    if (latest.reported?.[f] !== capture?.render?.[f])
      problems.push(`the history's last run records ${f} ${latest.reported?.[f]}; the capture says ${capture?.render?.[f]}`);
  if (latest.userAgent !== capture?.userAgent) problems.push("the history's last run names a user agent the capture does not");
  if (timings.at(-1) !== timingsOf(capture))
    problems.push(`the history's last run was taken with capture timings ${String(timings.at(-1)).slice(0, 12)}; the record's ` +
      `capture's resources give ${timingsOf(capture).slice(0, 12)}`);
  if (latest.contentEncoding !== record.hostPreconditions?.contentEncoding)
    problems.push("the history's last run names a content encoding the host preconditions do not");
  // THE CAPTURE COUNTS EXACTLY ITS VERSION'S GRAPH: every module the tarball's entry points reach, and
  // nothing else from the code origin, each at the size the tarball holds it.
  const graph = latest.subject?.graph;
  if (graphShaped(graph)) {
    const code = derived.counted.filter((row) => row.kind === "code");
    const v = latest.subject.version;
    for (const file of Object.keys(graph).filter((file) => !code.some((row) => row.file === file)))
      problems.push(`the capture does not count ${file}, which lokalized@${v}'s published graph holds; a lost resource would read ` +
        "as a smaller figure");
    for (const row of code.filter((row) => row.file === null || !Object.hasOwn(graph, row.file)))
      problems.push(`the capture counts ${row.file} from the code origin, which lokalized@${v}'s published graph does not hold`);
    for (const row of code.filter((row) => row.file !== null && Object.hasOwn(graph, row.file) && row.r.decodedBodySize !== graph[row.file]))
      problems.push(`the capture's ${row.file} decoded ${row.r.decodedBodySize} bytes; lokalized@${v}'s tarball holds it at ` +
        `${graph[/** @type {string} */ (row.file)]}`);
  }

  // EARLIER REVISIONS ARE CONTEXT, NEVER A BASELINE (plan :2796-2797), and each names its own recipe. The
  // timelines a context entry keeps, where it keeps any, are digests: an entry written before the recorder
  // kept them has none.
  let before = 0;
  for (const p of prior ?? []) {
    if (!(Number.isInteger(p?.revision) && p.revision > before && p.revision < revision) ||
        p.recipeSha256 !== /** @type {Record<number, string>} */ (RECIPE_DIGESTS)[p.revision] || p.comparable !== false)
      problems.push(`priorRevisions holds a run attributed to revision ${p?.revision} that is out of order, not that ` +
        "revision's frozen recipe, or not marked incomparable");
    if (p?.timings !== undefined && !(Array.isArray(p.timings) && p.timings.every((/** @type {unknown} */ t) => HEX64.test(String(t)))))
      problems.push(`priorRevisions holds revision ${p?.revision}'s run with timings ${JSON.stringify(p.timings)}, which are not ` +
        "digests of captures' timelines");
    before = Number.isInteger(p?.revision) ? p.revision : before;
  }
  return problems;
}

/** The keys a record has, every one written by the recorder. */
const RECORD_KEYS = ["formatVersion", "note", "recipe", "recipeSha256", "harnessSha256", "hostPreconditions", "history",
  "priorRevisions", "capture"];

/**
 * A RECORD'S OWN VALIDITY, whatever this checkout now measures: its format, its copy of its recipe,
 * its capture, its host facts and its history. The checker adds currency on top (`checkRecord`). The
 * recorder requires this of a record before it appends to it, and of the currency terms the one a new
 * run cannot move — the record's recipe being this checkout's — because the new run would inherit
 * either break: a review had it append to a record whose copy of its recipe was ANOTHER self-consistent
 * recipe at the same revision, which the checker refuses. The other currency terms, the harness files
 * and the subject, are what a new run moves, so they are not asked of the record it is appended to.
 * @param {any} record
 * @param {HarnessFiles} files
 * @param {{ origins: Record<number, string>, checkpoints: Record<number, Checkpoint>, untimed: Record<number, readonly string[]> }}
 *   frozen the first run, the checkpoint and the untimed runs' timings frozen for each revision
 */
export function recordProblems(record, files, { origins, checkpoints, untimed }) {
  /** @type {string[]} */
  const problems = [];
  if (!hasExactly(record, RECORD_KEYS))
    problems.push(`the record carries [${Object.keys(record).sort()}], not the keys the recorder writes [${[...RECORD_KEYS].sort()}]`);
  if (record.formatVersion !== 2)
    problems.push(`the record is formatVersion ${record.formatVersion}; revision ${RECIPE.revision} records formatVersion 2`);
  if (!nonEmpty(record.note)) problems.push("the record carries no note saying what it is");
  if (sha256(JSON.stringify(record.recipe)) !== record.recipeSha256)
    problems.push("the record's copy of its recipe does not hash to its own recipeSha256; it was edited");
  const latest = Array.isArray(record.history) ? record.history.at(-1) : undefined;
  const version = EXACT_VERSION.test(String(latest?.subject?.version)) ? latest.subject.version : SUBJECT.version;
  problems.push(...captureProblems(record.capture, { page: files.page, manifestText: files.manifestText, version }));
  problems.push(...hostProblems(record.hostPreconditions, version));
  const derived = deriveCapture(record.capture, { page: files.page, version });
  problems.push(...probeTieProblems(record.hostPreconditions, derived));
  problems.push(...historyProblems(record, derived, { origins, checkpoints, untimed, catalogs: catalogSizes(files.manifestText) }));
  return problems;
}

/**
 * THE CHECKER'S WHOLE VERDICT on a record: the recipe is the one frozen for its revision, the harness
 * files are the recipe's and the subject's, the record is of this recipe, bound to these harness files
 * and of this subject — and then valid in itself (`recordProblems`). A record of another recipe is not
 * examined further: it is re-recorded, and its history compares runs of a different scenario.
 *
 * `record.mjs` runs this over the exact object it is about to write. The problems it tolerates are the
 * lines only that run can supply: the checkpoint that freezes it in `HISTORY_CHECKPOINTS`, and on a new
 * revision's first run the digest `HISTORY_ORIGINS` freezes. The checker keeps failing, naming each line,
 * until it is set.
 *
 * @param {any} record
 * @param {HarnessFiles} files
 * @param {Context} [context] the subject, and the frozen origins, checkpoints and untimed runs to check against; the tests
 *   inject their own
 */
export function checkRecord(record, files, { subject = SUBJECT, origins = HISTORY_ORIGINS, checkpoints = HISTORY_CHECKPOINTS,
  untimed = HISTORY_UNTIMED } = {}) {
  const problems = [...recipeProblems(), ...renumberProblems(), ...harnessProblems(files, subject)];
  if (!record || typeof record !== "object")
    return [...problems, `${RECORD_NAME} is absent. Absence is never agreement: run the browser half ` +
      "(tools/browser-0b/record.mjs's header says how)."];
  // A MOVED RECIPE WITH AN UNMOVED REVISION is two different scenarios wearing one name — scenario 6's
  // rule, and the reason the digest exists at all. The record is held to the recipe, with a remedy that
  // depends on which of the two is newer.
  if (record.recipeSha256 !== recipeSha256) {
    const was = record.recipe?.revision;
    const from = `${String(record.recipeSha256).slice(0, 12)} -> ${recipeSha256.slice(0, 12)}`;
    problems.push(typeof was === "number" && was > RECIPE.revision
      ? `the record is revision ${was}, newer than this checkout's recipe (revision ${RECIPE.revision}); update the ` +
        "checkout rather than re-recording, which tools/browser-0b/record.mjs refuses"
      : was === RECIPE.revision
        ? `the record's recipe (${from}) differs from this checkout's at the same revision ${was}`
        : `the record is revision ${was} and the recipe is revision ${RECIPE.revision} (${from}). Re-record 0b: ` +
          "a new revision starts a new history (tools/browser-0b/record.mjs).");
    return problems;
  }
  // THE RECORD IS OF THESE FILES AND THIS SUBJECT. A publish moves `SUBJECT`, the page's CODE and the
  // manifest's identity together, and the record is then a run of the previous release: a new RUN is
  // owed, not a new revision.
  const now = harnessBinding(files);
  for (const file of /** @type {const} */ (["page", "manifest", "server"])) {
    const recorded = record.harnessSha256?.[file];
    const path = { page: "index.html", manifest: "manifest.json", server: "serve.mjs" }[file];
    if (recorded === undefined) problems.push(`the record does not say which ${path} it was taken with (harnessSha256.${file}); re-record`);
    else if (recorded !== now[file])
      problems.push(`tools/browser-0b/${path} has changed since the recorded run ` +
        `(${String(recorded).slice(0, 12)} -> ${now[file].slice(0, 12)}); re-run 0b`);
  }
  const latest = Array.isArray(record.history) ? record.history.at(-1) : undefined;
  if (latest?.subject?.version !== subject.version)
    problems.push(`SUBJECT is ${subject.version} and the record's last run measured ${latest?.subject?.version ?? "(nothing)"}: ` +
      "a publish is a new RUN of this revision, compared with the last one — run 0b");
  problems.push(...recordProblems(record, files, { origins, checkpoints, untimed }));
  return problems;
}

/**
 * WHERE THE HISTORY IS FROZEN, for the checker to print. Every run is frozen in source once
 * `HISTORY_CHECKPOINTS` names the newest, and until then the checker FAILS naming the line
 * (`historyProblems`); this says how far the frozen lines reach, so "frozen" is not read as "all" while a
 * recorded run awaits its line, and prints that line again beside the count. Nothing is said of a history
 * whose first run is not frozen: the checker already fails naming that line.
 * @param {unknown} history
 * @param {number} revision
 * @param {{ origins?: Record<number, string>, checkpoints?: Record<number, Checkpoint> }} [frozen]
 * @returns {string[]} the lines to print
 */
export function unfrozenTail(history, revision, { origins = HISTORY_ORIGINS, checkpoints = HISTORY_CHECKPOINTS } = {}) {
  if (origins[revision] === undefined || !Array.isArray(history) || history.length === 0 || !history.every(isPlainObject)) return [];
  const through = Math.max(checkpoints[revision]?.index ?? 0, 0);
  // A history that does not reach its checkpoint was cut, which the checker refuses; the report says so too.
  if (through > history.length - 1)
    return [`history: ${history.length} run(s), which does not reach run ${through}, the one tools/0b-recipe.mjs freezes it through`];
  const after = history.length - 1 - through;
  const lines = [`history: ${history.length} run(s), frozen in tools/0b-recipe.mjs through run ${through}` +
    (after > 0 ? `; ${after} after it, which the check refuses until the checkpoint is moved over them` : "")];
  if (after > 0) lines.push("to freeze them, set this inside HISTORY_CHECKPOINTS in tools/0b-recipe.mjs:", checkpointLine(history, revision));
  return lines;
}
