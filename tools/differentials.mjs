#!/usr/bin/env node
// @ts-check
/**
 * THE NINE JAVA DIFFERENTIALS, AND THE RECORD THEY DID NOT HAVE.
 *
 * Every other instrument in this repository leaves an artifact a later run re-checks: conformance
 * ratchets its passing-ID set, `scenario:0a` ratchets modules and source bytes, `scenario:2k` gates
 * a catalog digest, `subpath:graphs` ratchets per-subpath size, the clause ledger IS an artifact.
 * **The differentials leave nothing.** MEASURED 2026-09-14: all nine `writeFileSync` calls across
 * the nine tools write PROBE INPUTS into a temporary working directory for the Java side, and not
 * one of them records a result. So a green `diff:lookup` is a fact about whenever a human last typed
 * the command, and nothing anywhere says when that was or what source it described.
 *
 * That matters more here than it would elsewhere, because **none of the nine runs in `npm run
 * verify` or in CI** — they need the pinned JDK, which CI does not have — and several are the SOLE
 * enforcement for defects the 2,363-case corpus is structurally blind to. `../CLAUDE.md` says so of
 * one outright: "`test/attempted-locale-refusal.test.js`, `test/lookup-differential-findings.test.js`
 * and `diff:lookup` are the whole enforcement".
 *
 * TWO COMMANDS, AND THE SPLIT IS THE POINT:
 *
 *   npm run diff:all      runs all nine against the real Java and REWRITES the record. Needs the JDK.
 *   npm run diff:check    re-checks the record and needs no Java at all, so it runs inside `verify`
 *                         and inside CI.
 *
 * WHAT `diff:check` GATES, and what it only reports:
 *
 *   - a MISSING record fails. Absence is never read as agreement — the rule `scenario:0a` already
 *     applies to a missing graph.
 *   - a recorded NONZERO exit fails. A differential that was red when it was last run cannot be left
 *     recorded and forgotten.
 *   - a TOOL whose digest has moved since the record fails. This is the arm that needs no Java and
 *     cannot be argued with: editing a differential and not re-running it is exactly how an
 *     instrument drifts away from what it claims to compare, and this project has twice found a
 *     green differential that had gone inert on its own axis.
 *   - a differential that LEFT ANYTHING in its temp folder fails. `--run` gives each one a private
 *     temp folder (`tools/temp-hygiene.mjs`) and records how many entries it left there; a missing
 *     count fails too. MEASURED 2026-09-23: seven of the nine removed their work directory in a
 *     `finally` around a `process.exit`, which never runs — four on every run, three on every red
 *     one — and `diff:load` had no removal at all. 206 of their directories were counted in the
 *     system temp folder, and nothing here could see it.
 *   - PORT SOURCE that has moved since the record is REPORTED STALE and does not fail, on
 *     `scenario:0a`'s browser-half reasoning: refreshing means running Java, which a CI box does not
 *     have, and a gate that cannot be satisfied where it runs is a gate that gets disabled.
 *
 *   node tools/differentials.mjs --run | --check
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { specPath } from "./iana-artifact.mjs";
import { leftoversIn, privateTemporaryDirectory, temporaryEnvironment } from "./temp-hygiene.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordPath = join(root, "measurements/differentials.json");

/** The nine, in the order `../CLAUDE.md` names them. */
const DIFFERENTIALS = ["load", "likely-subtag", "lookup", "direct-tag", "language-range",
  "tokenizer", "parse", "interpolate", "phonetic"];

/** Digest a directory's file CONTENT, sorted by path so the result is order-independent. */
function digestTree(directory, filter = () => true) {
  const hash = createHash("sha256");
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (filter(path)) hash.update(path.slice(root.length)).update(readFileSync(path));
    }
  };
  if (!existsSync(directory)) return null;
  walk(directory);
  return hash.digest("hex");
}

const toolDigest = (name) => digestTree(join(root, `tools/${name}-diff`));
const sourceDigest = () => digestTree(join(root, "src"), (path) => path.endsWith(".js"));

if (process.argv.includes("--run")) {
  const record = { recordedAt: new Date().toISOString(), sourceSha256: sourceDigest(), differentials: {} };
  let failed = 0;
  for (const name of DIFFERENTIALS) {
    let exit = 0;
    let output = "";
    const temporary = privateTemporaryDirectory();
    try {
      output = execFileSync("npm", ["run", `diff:${name}`],
        { cwd: root, encoding: "utf8", maxBuffer: 256e6, env: temporaryEnvironment(temporary) });
    } catch (error) {
      exit = /** @type {any} */ (error).status ?? -1;
      output = `${/** @type {any} */ (error).stdout ?? ""}${/** @type {any} */ (error).stderr ?? ""}`;
    }
    const temporaryLeft = leftoversIn(temporary);
    rmSync(temporary, { recursive: true, force: true });
    // THE HEADLINE IS RECORDED VERBATIM, NOT PARSED INTO FIELDS — a parser here would be a second
    // claim about nine tools that each phrase their summary differently, and this project has found
    // ten texts asserting the inverse of what they described.
    //
    // The first draft took the LAST line carrying a ratio, and two of the nine then recorded prose:
    // `diff:load` recorded an empty string and `diff:lookup` recorded a sentence out of a comment
    // about how many sites it covers. So the patterns are ORDERED by how much of a summary they are,
    // and an EMPTY headline FAILS the run — a record whose summary field is blank looks identical to
    // one nobody checked.
    // ORDERED BY HOW MUCH OF A SUMMARY EACH IS, and verified against all nine captured outputs
    // rather than assumed: seven print a banner carrying a ratio, `phonetic` prints the ratio alone,
    // `likely-subtag` prints a cell count (its banner has no numbers), and `load` prints "N identical".
    const PATTERNS = [/differential.*\d+\s*\/\s*\d+/, /\d+\s*\/\s*\d+ identical/, /^\s*\d+ identical\b/,
      /^\s*cells\s+\d+/, /\d+ probe\(s\) against/];
    const lines = output.split("\n");
    let headline = "";
    for (const pattern of PATTERNS) {
      const hit = lines.find((line) => pattern.test(line));
      if (hit) { headline = hit; break; }
    }
    if (!headline.trim())
      throw new Error(`diff:${name} printed no recognisable summary line; the record would carry an` +
        ` empty headline, which is indistinguishable from a run nobody read`);
    // FACTS A TOOL RECORDS ABOUT ITS OWN RUN, so that `diff:check` can ask a question a headline
    // cannot answer WITHOUT a JDK. M8 clause 66 was held twice on exactly that gap: `diff:load`
    // needs Java, so reverting its instrument while leaving the tests in place left `npm test` green
    // and this gate at exit 0 — nothing could tell a WIRED instrument from an INERT one. A tool
    // opts in by printing one `##diff-facts {…}` line; the numbers it declares are then carried
    // into a run that has no Java at all. A tool printing none records none, which is why the
    // check below asks whether a fact that was recorded has gone to zero rather than demanding
    // every tool have them.
    //
    // THE SHAPE IS TWO-PART BECAUSE A DIFFERENTIAL HAS TWO KINDS OF NUMBER, and collapsing them
    // would make the gate meaningless in one direction or the other:
    //   exercised — what the run actually put through the comparison. ZERO means the instrument
    //               went inert, which is the failure this exists to catch.
    //   defects   — what it found. NON-ZERO means a recorded red that a green headline would hide.
    // Neither is checked here, where Java is available and the tool's own exit status already
    // covers it; both are checked in `--check`, which is the run that has no Java.
    const factsLine = lines.filter((line) => line.startsWith("##diff-facts ")).pop();
    let facts;
    if (factsLine) {
      try {
        facts = JSON.parse(factsLine.slice("##diff-facts ".length));
      } catch (error) {
        throw new Error(`diff:${name} printed a ##diff-facts line that is not JSON: ${factsLine.slice(0, 120)}`);
      }
    }
    record.differentials[name] = {
      exit,
      headline: headline.trim().slice(0, 200),
      toolSha256: toolDigest(name),
      temporaryEntriesLeft: temporaryLeft.length,
      ...(facts ? { facts } : {}),
    };
    if (exit !== 0) failed++;
    console.log(`  ${exit === 0 ? "ok  " : "FAIL"}  diff:${name.padEnd(14)} ${headline.trim().slice(0, 96)}`);
    if (temporaryLeft.length > 0) {
      failed++;
      console.log(`        LEFT ${temporaryLeft.length} temp entr${temporaryLeft.length === 1 ? "y" : "ies"}: ${temporaryLeft.join(", ")}`);
    }
  }
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nrecorded ${DIFFERENTIALS.length} differentials to measurements/differentials.json`);
  process.exit(failed === 0 ? 0 : 1);
}

// --- --check: no Java, runs in verify and in CI ---------------------------------------------------
if (!existsSync(recordPath)) {
  console.error(`no record at measurements/differentials.json — run \`npm run diff:all\` on a host with the` +
    `\npinned JDK. A missing record is NOT the same as agreement, which is why this fails rather than skips.`);
  process.exit(1);
}
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const problems = [];
/**
 * THE JAVA BUILD A DIFFERENTIAL RAN AGAINST, HELD TO THE CORPUS'S. A tool that records
 * `facts.oracle.librarySourcesSha256` (diff:language-range, since A30) must name the same lokalized-java
 * sources `generated/behavioral-vectors.json` was recorded against, or the record and the corpus
 * describe two libraries and a green run proves nothing about the one the corpus specifies. Read with
 * no JDK, so the binding holds in CI.
 */
/**
 * The differentials whose Java side is the LIBRARY, and so must record which build. For these an ABSENT
 * `facts.oracle` block is a failure: the comparison below only ran when the field was present, so
 * deleting the block from the record passed the check it exists to feed (found in the A30 follow-up
 * review, measured). A tool whose oracle is the JDK alone records no library and is not listed.
 */
const LIBRARY_ORACLE_DIFFERENTIALS = ["language-range"];
for (const name of LIBRARY_ORACLE_DIFFERENTIALS)
  if (!DIFFERENTIALS.includes(name)) throw new Error(`LIBRARY_ORACLE_DIFFERENTIALS names diff:${name}, which is not a differential`);
let corpusLibrary = null;
try {
  corpusLibrary = JSON.parse(readFileSync(specPath("generated/behavioral-vectors.json"), "utf8")).oracle?.librarySourcesSha256 ?? null;
} catch (error) {
  problems.push(`the corpus could not be read for its librarySourcesSha256: ${/** @type {Error} */ (error).message}`);
}
for (const name of DIFFERENTIALS) {
  const entry = record.differentials?.[name];
  if (!entry) { problems.push(`diff:${name} has no recorded run`); continue; }
  const oracleLibrary = entry.facts?.oracle?.librarySourcesSha256;
  if (LIBRARY_ORACLE_DIFFERENTIALS.includes(name) && typeof oracleLibrary !== "string")
    problems.push(`diff:${name} records no facts.oracle.librarySourcesSha256, so nothing says which lokalized-java ` +
      `build it ran against; re-run \`npm run diff:all\` rather than editing the record`);
  else if (oracleLibrary !== undefined && oracleLibrary !== corpusLibrary)
    problems.push(`diff:${name} ran against lokalized-java sources ${String(oracleLibrary).slice(0, 8)} and the corpus ` +
      `was recorded against ${String(corpusLibrary).slice(0, 8)}; re-run \`npm run diff:all\` against the build the corpus names`);
  if (entry.exit !== 0) problems.push(`diff:${name} was recorded RED (exit ${entry.exit})`);
  if (typeof entry.temporaryEntriesLeft !== "number")
    problems.push(`diff:${name} records no temporaryEntriesLeft, so nothing says whether its run cleaned up after ` +
      `itself; re-run \`npm run diff:all\``);
  else if (entry.temporaryEntriesLeft !== 0)
    problems.push(`diff:${name} left ${entry.temporaryEntriesLeft} entr${entry.temporaryEntriesLeft === 1 ? "y" : "ies"} ` +
      `in its private temp folder when it was last run — every run of it leaks into the real one`);
  for (const [fact, value] of Object.entries(entry.facts?.exercised ?? {})) {
    if (typeof value !== "number")
      problems.push(`diff:${name} recorded a non-numeric '${fact}' among its exercised facts`);
    else if (value === 0)
      problems.push(`diff:${name} recorded '${fact}' as ZERO — it ran and exercised nothing on that` +
        ` axis, which a green headline cannot tell you and is the shape a wired instrument going` +
        ` INERT actually has`);
  }
  for (const [fact, value] of Object.entries(entry.facts?.defects ?? {})) {
    if (value !== 0)
      problems.push(`diff:${name} recorded ${value} '${fact}' — a finding its headline does not carry`);
  }
  const digest = toolDigest(name);
  if (digest !== entry.toolSha256)
    problems.push(`diff:${name}'s tool has changed since it was last run against Java` +
      ` (${String(entry.toolSha256).slice(0, 8)} -> ${String(digest).slice(0, 8)}); re-run \`npm run diff:all\``);
}
const extra = Object.keys(record.differentials ?? {}).filter((name) => !DIFFERENTIALS.includes(name));
for (const name of extra) problems.push(`the record carries diff:${name}, which this tool does not name`);

console.log(`differential record: ${DIFFERENTIALS.length} differentials, recorded ${record.recordedAt}`);
const movedSource = record.sourceSha256 !== sourceDigest();
if (movedSource)
  console.log(`  STALE: src/ has moved since the record` +
    ` (${String(record.sourceSha256).slice(0, 8)} -> ${String(sourceDigest()).slice(0, 8)}).` +
    `\n  Reported, not gated: re-running needs the pinned JDK. \`npm run diff:all\` refreshes it.`);

if (problems.length) {
  console.error(`\nDIFFERENTIAL RECORD PROBLEMS (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`  ok: every differential recorded green, every tool unchanged since its run`);
