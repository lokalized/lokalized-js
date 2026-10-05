#!/usr/bin/env node
// @ts-check
/**
 * SCENARIO 0b — M8 network delivery, measured against the real production host.
 *
 * Plan :2811-2813: "production-host root plus `load`, manifest, and realistic requested/fallback
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
 * browser happens in `tools/browser-0b/`, and the host's own response facts and the published
 * tarball's digests are measured there and carried in the record — the `diff:all`/`diff:check`
 * split, applied a fourth time, so a gate never depends on a third party being up. The checks
 * themselves live in `tools/0b-checks.mjs`, because the recorder applies the same ones before it
 * writes anything.
 *
 * **RATCHETED, NOT THRESHOLDED — A4 and A7 (restated as A33, 2026-09-25).** A4 restated 0b's go/no-go
 * thresholds as "recorded and ratcheted", and A7 extended "recorded, ratcheted where a ratchet exists,
 * reported where none does" to every M8 threshold rather than freeze a number; recipe revision 4
 * declares that policy as its `hostThresholds`. So the record keeps every run of a revision in
 * `history`: the request count and the decoded, encoded and transfer bytes are RE-DERIVED here from the
 * capture's resources and RATCHET — a run whose figure grew over the run before it, or over its own
 * version's last run, stands only with its reason — and the three timings are REPORTED: required present,
 * never compared. Every run's request
 * count and decoded bytes must also EQUAL its version's published graph, which the recorder reads out
 * of the verified tarball, and the manifest's planned catalogs: within one version those two cannot
 * move, and a lost or doubled resource is refused rather than read as a smaller or a larger figure.
 * That, each control, the cold arm, the streaming-limit boundary, the render, and the host's headers
 * and pins are exit terms at their ceiling, not ratchets: a run where one slips cannot be read at all.
 * Writing a threshold from 0b's own first run is still the one outcome the design pass singled out as
 * worse than having none; a ratchet needs no number, only the previous run.
 *
 *   node tools/scenario-0b.mjs [record.json]    re-check the record (default measurements/scenario-0b.json)
 *   npm run serve:0b                            then drive the browser half; see tools/browser-0b/record.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPE, SUBJECT, recipeSha256 } from "./0b-recipe.mjs";
import { RATCHETED, RECORD_NAME, REPORTED, checkRecord, deriveCapture, readHarness, unfrozenTail } from "./0b-checks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordPath = process.argv[2] ? resolve(process.argv[2]) : join(root, RECORD_NAME);
const files = readHarness(root);
/** @type {any} */
let record = null;
if (existsSync(recordPath)) {
  try { record = JSON.parse(readFileSync(recordPath, "utf8")); } catch (error) {
    console.error(`${recordPath} is not readable JSON: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
const problems = checkRecord(record, files);
const say = (/** @type {string} */ line) => console.log(line);

say("scenario 0b — production-host network delivery");
say(`  recipe          revision ${RECIPE.revision}, digest ${recipeSha256.slice(0, 12)}; SUBJECT lokalized@${SUBJECT.version}`);
if (record) {
  // EVERY LABEL BELOW IS THE RECORD'S OWN REVISION, not the recipe's: a record of another revision is
  // a run of a different scenario, and printing it under this recipe's number would say otherwise.
  const revision = record.recipe?.revision;
  const current = record.recipeSha256 === recipeSha256;
  const capture = record.capture ?? {};
  const history = Array.isArray(record.history) ? record.history : [];
  const latest = history.at(-1);
  say(`  record          revision ${revision}, digest ${String(record.recipeSha256).slice(0, 12)}, formatVersion ${record.formatVersion}` +
    (current ? "" : " — NOT this recipe's; re-record"));
  say(`  code origin     ${capture.origins?.code ?? "— (not recorded)"}`);
  say(`  catalog origin  ${capture.origins?.catalogs ?? "— (not recorded)"}`);
  say(`  page origin     ${capture.origins?.page ?? "— (not recorded)"}, run ${capture.cacheBuster?.value ?? "—"}`);
  say("");
  const figures = current
    ? deriveCapture(capture, { page: files.page, version: latest?.subject?.version ?? SUBJECT.version }).figures
    : capture.summary ?? {};
  say(current ? `  figures, re-derived from the capture's counted resources (revision ${revision}'s method):`
    : `  figures as revision ${revision}'s own page summed them (never compared with this recipe's):`);
  for (const f of RATCHETED) say(`    ${f.padEnd(24)} ${Number(figures[f]).toLocaleString()}`);
  for (const f of REPORTED) say(`    ${f.padEnd(24)} ${capture.render?.[f] ?? "—"} ms   (reported, never compared)`);
  const [below, at] = capture.streamingLimits?.arms ?? [];
  say(`    streaming limit          ${below?.maximumInputBytes ?? "—"} ${below?.outcome ?? "—"}, ${at?.maximumInputBytes ?? "—"} ${at?.outcome ?? "—"}`);
  say(`    rendered                 ${JSON.stringify(capture.render?.rendered ?? null)}`);
  say(`    host content encoding    ${record.hostPreconditions?.contentEncoding ?? "—"}`);
  const controls = capture.controls ?? {};
  say("    controls                 preload matched " + JSON.stringify(controls.preload?.matched ?? null) +
    ", mismatched " + JSON.stringify(controls.preload?.mismatched ?? null) +
    ", second load cached " + String(controls.secondLoad?.servedFromCache) + ", blind " + String(controls.blind?.isBlind));
  say("");
  if (history.length === 0) say(`  history, revision ${revision}: none (formatVersion ${record.formatVersion} predates the ratchet)`);
  else {
    say(`  history, revision ${revision} — ${RATCHETED.join(", ")} ratchet; ${REPORTED.join(", ")} reported`);
    for (const [i, entry] of history.entries()) {
      const graph = entry?.subject?.graph && typeof entry.subject.graph === "object" ? Object.keys(entry.subject.graph).length : "—";
      say(`    ${String(i).padStart(2)}  ${String(entry?.run).padEnd(40)} ${String(entry?.subject?.version).padEnd(12)}` +
        `${String(graph).padStart(3)} modules` +
        RATCHETED.map((f) => String(entry?.ratcheted?.[f]?.toLocaleString() ?? "—").padStart(10)).join("") +
        `  ${String(entry?.reported?.firstUsableRenderMs ?? "—").padStart(7)} ms  ` +
        (i === 0 ? "(first run)" : entry?.grew?.length ? `grew [${entry.grew}]: ${entry.reason}`
          : `no growth${entry?.reason ? `; ${entry.reason}` : ""}`));
    }
    // HOW FAR THE FROZEN LINES REACH, and the line that would reach the rest; a run they do not reach
    // also fails the check below (`historyProblems`). Only for a record of this recipe, whose history the
    // frozen lines describe.
    if (current) for (const line of unfrozenTail(history, revision)) say(`  ${line}`);
  }
  const prior = Array.isArray(record.priorRevisions) ? record.priorRevisions : [];
  if (prior.length > 0) say("  earlier revisions — a different scenario (plan :2796-2797), kept as context and never compared:");
  for (const p of prior)
    say(`    revision ${p?.revision}, ${p?.run}: ` + RATCHETED.map((f) => p?.figures?.[f]).join(" / ") + " under its own method");
}
say("");
say("  RATCHETED, NOT THRESHOLDED — A4 and A7 (restated as A33, 2026-09-25): a ratcheted figure may grow only");
say("  on a run recorded with its reason; the request count and decoded bytes are always the version's published");
say("  graph's; the timings are recorded and never compared. Exit terms at their ceiling:");
say(`  ${Object.keys(RECIPE.hostThresholds.invariants).join(", ")}.`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
say("\nthe recorded 0b run is current, its figures re-derive from its resources and are its version's published graph, " +
  "every control discriminated, its cold arm is clean, and its history ratchets from the run frozen for its revision and is " +
  "frozen through its newest run.");
