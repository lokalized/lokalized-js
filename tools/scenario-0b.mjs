#!/usr/bin/env node
// @ts-check
/**
 * SCENARIO 0b — M8 network delivery, measured against the real production host.
 *
 * Plan :2811-2812: "production-host root plus `load`, manifest, and realistic requested/fallback
 * catalogs. It records request count, encoded and decoded bytes, preload reuse, streaming limits,
 * first usable render, and the host's actual content encoding."
 *
 * **WHY IT COULD NOT RUN BEFORE, AND WHY IT CAN NOW.** A6 cut 0b rather than run it against a
 * stand-in, "because that produces exactly the number it exists to replace"; A25 sequenced it to the
 * first publish. `lokalized@1.0.0-rc.1` went to npm on 2026-09-21, so jsDelivr serves it, and the
 * catalogs — which npm does NOT ship — come from the same CDN's `/gh/` route pinned to an immutable
 * commit. Both halves are the real host. Nothing here is a stand-in, and the capture records the
 * origin of every row so that claim is checkable rather than asserted.
 *
 * **THIS TOOL TOUCHES NO NETWORK.** It re-checks a RECORD. Everything requiring the host or a
 * browser happens in `tools/browser-0b/`, and the host's own response facts are captured there and
 * carried in the record — the `diff:all`/`diff:check` split, applied a fourth time, so a gate never
 * depends on a third party being up.
 *
 * **NO THRESHOLDS, AND THE ABSENCE IS DELIBERATE.** A7 declined to freeze any, because that would
 * revoke the 2026-09-01 no-thresholds decision. So running this CANNOT close M8 clauses 84-87, which
 * require 0b to MEET a frozen request/transfer/latency/preload threshold. It closes 82 and 83 only,
 * and it says so below rather than letting a green run imply otherwise. Writing a threshold from
 * 0b's own first run is the one outcome the design pass singled out as worse than having none.
 *
 *   node tools/scenario-0b.mjs              re-check the record
 *   npm run serve:0b                        then drive the browser half; see tools/browser-0b/
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPE, recipeSha256 } from "./0b-recipe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = join(root, "measurements/scenario-0b.json");



const problems = [];
const say = (/** @type {string} */ line) => console.log(line);

if (!existsSync(RECORD)) {
  console.error("measurements/scenario-0b.json is absent. Absence is never agreement: run the browser\n" +
    "half (npm run serve:0b, load /?run=<token>, then node tools/browser-0b/record.mjs <capture.json>).");
  process.exit(1);
}
const record = JSON.parse(readFileSync(RECORD, "utf8"));

// A MOVED RECIPE WITH AN UNMOVED REVISION is two different scenarios wearing one name — scenario 6's
// rule, and the reason the digest exists at all.
if (record.recipeSha256 !== recipeSha256) {
  problems.push(`the recipe has changed (${String(record.recipeSha256).slice(0, 12)} -> ${recipeSha256.slice(0, 12)}) ` +
    `while revision stayed ${record.recipe?.revision}. Bump RECIPE.revision and re-record: runs either side of a ` +
    "recipe change are not comparable.");
}

const capture = record.capture ?? {};
const controls = capture.controls ?? {};

// THE CONTROLS ARE EXIT TERMS, not decoration. Each exists because the measurement above it is
// unfalsifiable without an arm that must come back DIFFERENT.
if (!(controls.preload?.matched?.["fr.json"] === 1 && controls.preload?.matched?.["fr-CA.json"] === 1))
  problems.push("the matched preloads did not report one entry each, so preload reuse was not observed");
if (!(controls.preload?.mismatched?.["en.json"] >= 2))
  problems.push("the MISMATCHED preload did not report a second entry. Without an arm that is NOT reused, " +
    "one-entry-per-url is equally satisfied by a loader that never fetched — M-D S22's lesson.");
if (controls.secondLoad?.servedFromCache !== true)
  problems.push("the second-load control did not report cache delivery, so the capture is not observing delivery at all");
if (controls.blind?.isBlind !== true)
  problems.push("the blind control reported a readable size. A cross-origin resource with no Timing-Allow-Origin " +
    "must read 0; if it does not, the capture is not reading what it believes it is.");

// THE COLD ARM. Reported, and it fails the run — a warm figure recorded as a cold one is the
// specific way this scenario would mislead, and jsDelivr's year-long immutable cache makes it the
// DEFAULT outcome rather than an unlucky one.
if (capture.coldArm?.contaminated)
  problems.push(`${capture.coldArm.cachedResources?.length} first-occurrence resource(s) were served from the browser ` +
    "cache, so the recorded transfer figure is not a cold one. Re-run from a top-level site this browser " +
    "has not visited — Chromium keys its HTTP cache by top-level site — with a new `serve-0b-*` launch entry.");

// STREAMING LIMITS — plan :2813 names them among what 0b records. Revision 1 had no arm at all,
// while the ledger line describing it said all six measurements were recorded.
const limits = capture.streamingLimits;
const [below, at] = limits?.arms ?? [];
const frScenario = (capture.resources ?? []).find((r) => r.phase === "scenario" && r.readable &&
  r.origin === "production-host" && new URL(r.url).pathname.endsWith("/fr.json"));
if (!limits) problems.push("no streaming-limit arm was recorded, and plan :2813 names streaming limits among what 0b records");
else {
  if (!(below?.outcome === "refused" && below.failures?.length === 1 &&
        below.failures[0].locale === "fr" && below.failures[0].stage === "limit"))
    problems.push("the streaming-limit arm under the boundary did not refuse fr, and fr alone, at stage limit");
  if (at?.outcome !== "loaded")
    problems.push("the streaming-limit arm at the boundary did not load, so the refusal is not located there");
  // THE ARM DISCRIMINATES ONLY IF THE WIRE SIZE SITS UNDER THE REFUSED LIMIT AND THE BOUNDARY IS THE
  // DECODED SIZE. Re-derived from the capture's own resource entry, never from the page's verdict:
  // were the host to stop compressing, or the catalog to shrink under the limit, both arms could
  // still pass while no longer telling wire bytes from decoded ones.
  if (!frScenario) problems.push("fr.json has no readable scenario entry, so the limit arm's premise cannot be checked");
  else if (!(frScenario.encodedBodySize <= below.maximumInputBytes &&
             at.maximumInputBytes === below.maximumInputBytes + 1 &&
             at.maximumInputBytes === frScenario.decodedBodySize))
    problems.push(`the streaming-limit arm does not separate wire bytes from decoded bytes: fr is ` +
      `${frScenario.encodedBodySize} encoded / ${frScenario.decodedBodySize} decoded against limits ` +
      `${below?.maximumInputBytes} / ${at?.maximumInputBytes}`);
}

for (const problem of capture.problems ?? []) problems.push(`the capture reported: ${problem}`);

const s = capture.summary ?? {};
say("scenario 0b — production-host network delivery");
say(`  recipe revision ${RECIPE.revision}, digest ${recipeSha256.slice(0, 12)}`);
say(`  code origin     ${RECIPE.codeOrigin}`);
say(`  catalog origin  ${RECIPE.catalogOrigin}`);
say("");
say(`  request count            ${s.requestCount ?? "—"}`);
say(`  encoded bytes            ${(s.encodedBytes ?? 0).toLocaleString()}`);
say(`  decoded bytes            ${(s.decodedBytes ?? 0).toLocaleString()}`);
say(`  transfer bytes           ${(s.transferBytes ?? 0).toLocaleString()}`);
say(`  first usable render      ${capture.render?.firstUsableRenderMs ?? "—"} ms   (reported, never gated)`);
say(`  streaming limit          fr ${frScenario?.encodedBodySize ?? "—"} B on the wire, ${frScenario?.decodedBodySize ?? "—"} decoded: ` +
    `${below?.maximumInputBytes ?? "—"} ${below?.outcome ?? "—"}, ${at?.maximumInputBytes ?? "—"} ${at?.outcome ?? "—"}`);
say(`  page origin              ${capture.origins?.page ?? "— (not recorded)"}`);
say(`  rendered                 ${JSON.stringify(capture.render?.rendered ?? null)}`);
say(`  host content encoding    ${record.hostPreconditions?.contentEncoding ?? "—"}`);
say("");
say("  controls: preload matched " + JSON.stringify(controls.preload?.matched ?? null) +
    ", mismatched " + JSON.stringify(controls.preload?.mismatched ?? null) +
    ", secondLoad cached " + String(controls.secondLoad?.servedFromCache) +
    ", blind " + String(controls.blind?.isBlind));
say("");
say("  NO THRESHOLDS. A7 declined to freeze any, so M8 clauses 84-87 cannot close by running this;");
say("  82 (the freeze) and 83 (the run and its record) are what 0b can discharge today.");

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
say("\nthe recorded 0b run is current, its controls all discriminated, and its cold arm is clean.");
