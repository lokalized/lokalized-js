#!/usr/bin/env node
// @ts-check
/**
 * `DIVERGENCES.md` — where this port deliberately answers differently from lokalized-java 3.1.0.
 *
 * **PLAN 8.5 SAYS THIS IS "generated from the xfail/unsupported records" AND THAT SOURCE IS EMPTY.**
 * Measured: zero of the corpus's 2,363 cases carry an `xfail` field — the mechanism was never built
 * — and "unsupported" is ambiguous between the 0 the runner prints (nothing left to implement) and
 * the 213 the artifact records (43 refused by design + 170 with no JVM counterpart). Generating
 * literally would publish a document asserting this port has NO divergences from Java, which is
 * false about roughly ninety declared ones. So the document is generated from the DECLARED RECORDS
 * instead, and the deviation is amendment A22 rather than a quiet reinterpretation of the sentence.
 *
 * **EVERY ROW IS DERIVED FROM A TABLE THAT ALREADY GATES SOMETHING.** Nothing here is authored
 * prose about behaviour: the message divergences are the ones `tools/conformance.mjs` compares
 * against Java case by case, the JVM-only reasons are the ones it refuses to count, and the refusal
 * adaptations are the ones whose Java pair is checked byte-for-byte. A divergence that stops being
 * true fails those gates, not this document.
 *
 * `tools/conformance.mjs --dump-divergences` prints its tables and exits before any case runs, so
 * that file stays their single owner and this one cannot hold a second copy that drifts.
 *
 * **TWO SECTIONS HAVE NO CORPUS CASE BEHIND THEM, AND GATE THEMSELVES HERE INSTEAD.** A Java public
 * API this port declines (sourced from lokalized-spec's `java-surface-amendments.json`, which
 * `scripts/java-surface-audit.mjs` holds to Java's real surface) and a JDK-version-dependent answer
 * (the port models JDK 21) are deliberate differences no recorded case exercises. Each row carries a
 * probe of THIS package's behaviour, run every time this file runs; a row whose probe no longer holds
 * is STALE and fails, so neither section can outlive the divergence it states.
 *
 *   node tools/divergences.mjs            regenerate and CHECK the committed DIVERGENCES.md
 *   node tools/divergences.mjs --write    re-record it
 */
import { execFileSync } from "node:child_process";
import { openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { CONSTRUCT_REFUSAL_ADAPTATIONS } from "./construct-refusals.mjs";
import { DEFINE_REFUSAL_ADAPTATIONS } from "./define-refusals.mjs";
import { specPath } from "./iana-artifact.mjs";
import * as rootEntry from "../src/index.js";
import * as coreEntry from "../src/core/index.js";
import * as negotiateEntry from "../src/negotiate/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(root, "DIVERGENCES.md");
const problems = [];

/**
 * THE TABLES ARRIVE THROUGH A FILE, NOT THROUGH A PIPE, AND THE REASON IS A LIVE DEFECT THIS
 * REPLACES.
 *
 * `execFileSync(..., { encoding: "utf8" })` TRUNCATES THIS PAYLOAD AT EXACTLY 8192 BYTES ON NODE 20
 * AND 22, and does not on 24. Measured 2026-09-22 across five installed runtimes: the dump is 9,273
 * bytes, so node 20 and 22 both die with `SyntaxError: Unterminated string in JSON at position
 * 8192` while 24 succeeds. `maxBuffer` was already 32 MB and is irrelevant — this is the pipe, not
 * the buffer cap.
 *
 * **IT BROKE `prepack`, AND THEREFORE PACKING, ON THE DECLARED `engines.node` FLOOR.** Every gate
 * that runs `npm pack` — `check:release`, `check:readme:packed`, `check:bundle` — sits in CI's
 * matrix job on node 20, 22, 24 and current. The payload grew past 8 KiB as divergence declarations
 * were added, and nothing announced the crossing.
 *
 * The shell-out itself is KEPT deliberately: M-R S10 put these tables in `conformance.mjs` and gave
 * it `--dump-divergences` precisely so a reviewer reads `git diff tools/conformance.mjs` for
 * weakened rules, and a 153-line relocation would read like one. Only the transport changes.
 */
const dumpPath = join(tmpdir(), `lokalized-divergences-${process.pid}.json`);
try {
  execFileSync("node", [join(root, "tools/conformance.mjs"), "--dump-divergences"],
    { stdio: ["ignore", openSync(dumpPath, "w"), "inherit"] });
  var tables = JSON.parse(readFileSync(dumpPath, "utf8"));
} finally {
  rmSync(dumpPath, { force: true });
}

const conformance = JSON.parse(readFileSync(join(root, "measurements/conformance.json"), "utf8"));

/** `a | b | c` with the pipes escaped, because a Java message may contain one. */
const cell = (/** @type {unknown} */ value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

const sections = [];

/* ------------------------------------------------------------------ 1. no JVM counterpart */
sections.push({
  heading: "Features with no counterpart here",
  intro: "These are JVM-only by construction. They can never be ported, and the corpus records them " +
    `as such: ${conformance.nonportableIds.length} of its cases exercise them.`,
  table: { head: ["Java entry point", "why it cannot port"],
    rows: Object.values(tables.NO_JS_COUNTERPART).map((/** @type {any} */ e) => [`\`${e.java}\``, e.why]) },
});

/* ------------------------------------------------- 2. refused by design under the fixed limits */
sections.push({
  heading: "Behaviour this package refuses by design",
  intro: `${conformance.byDesignIds.length} corpus cases record a Java answer that depends on a ` +
    "runtime-limit override. This package fixes v1's limits, so those answers are unreachable here " +
    "— not unimplemented.",
  table: { head: ["reason", "why"],
    rows: Object.entries(tables.BY_DESIGN_UNSUPPORTED).map(([reason, e]) =>
      [reason, /** @type {any} */ (e).why]) },
});

/* -------------------------------------------------------------------- 3. message divergences */
{
  // The KEY is Java's message: these tables are keyed on what Java says so the runner can select a
  // row by it. Reading the key as an id and looking for a `java` field — which is what the first
  // version of this file did — leaves the Java column blank on every row.
  const rows = [
    ...Object.entries(tables.DECLARED_MESSAGE_DIVERGENCES)
      .map(([java, e]) => [java, /** @type {any} */ (e).js, /** @type {any} */ (e).why]),
    ...tables.DECLARED_CAUSE_MESSAGE_DIVERGENCES.map((/** @type {any} */ e) => [e.java, e.js, e.why]),
  ];
  sections.push({
    heading: "Messages that differ",
    intro: "The failure is the same one; the sentence is not. Every row is compared against Java " +
      "case by case, so a divergence that stops diverging fails `npm run conformance` rather than " +
      "silently outliving this document.",
    table: { head: ["Java says", "this package says", "why"], rows },
  });
}

/* ----------------------------------------------------------- 4. refusal type/message adaptations */
{
  const all = [...CONSTRUCT_REFUSAL_ADAPTATIONS, ...DEFINE_REFUSAL_ADAPTATIONS];
  const rows = all.map((/** @type {any} */ a) =>
    [`\`${a.jsType}\``, a.site, a.javaMessage, a.jsMessage]);
  const sameSentence = all.filter((/** @type {any} */ a) => a.javaMessage === a.jsMessage).length;
  sections.push({
    heading: "Refusals: the same failure, a different class",
    intro: "Java raises `java.lang.IllegalArgumentException` from all of these; JavaScript names them " +
      `apart. **This is a mapping per site, not a general rule** — ${new Set(all.map((/** @type {any} */ a) => a.jsType)).size} ` +
      "different JS classes come out of that one Java class depending on which door you came " +
      `through, and ${sameSentence} of these ${all.length} keep Java's sentence exactly while changing ` +
      "the class. A migrating `catch` block has to be read against this table, not translated once.",
    table: { head: ["this package raises", "Java site", "Java says", "this package says"], rows },
  });
}

/* ---------------------------------------------------- 5. host enumeration order (not a decision) */
sections.push({
  heading: "Directory enumeration order",
  intro: "Java enumerates a directory in the filesystem's order; this package sorts by UTF-8 bytes. " +
    "Where a directory is ambiguous — two files claiming one locale, or a limit reached mid-walk — " +
    "the two can pick differently. These are the recorded cases.",
  table: { head: ["case", "what differs"],
    rows: Object.entries(tables.HOST_ENUMERATION_ORDER_DEPENDENT).map(([id, why]) => [`\`${id}\``, why]) },
});

/* ------------------------------------------- 6. the language boundary, measured against real Java */
sections.push({
  heading: "Numbers interpolate differently, and it cannot be fixed",
  intro: "JavaScript has one number type where Java has `Integer`, `Long`, `Double` and `Float`, so " +
    "this package cannot know whether `1` meant Java's `Integer 1` or `Double 1.0`. Measured on the " +
    "pinned JDK 21 against this package:",
  table: { head: ["you pass", "Java `Double` renders", "this package renders"],
    rows: [["`1.0`", "`1.0`", "`1`"], ["`1e21`", "`1.0E21`", "`1e+21`"], ["`1e-4`", "`1.0E-4`", "`0.0001`"],
      ["`1000000.0`", "`1000000.0`", "`1000000`"], ["`0.5`", "`0.5`", "`0.5`"], ["`1` (integer)", "`1`", "`1`"]] },
  after: "If your catalogs render a Java `Double`, format it yourself before interpolating.",
});

/* ------------------------------------------ 7. Java API this package declines (spec-declared) */
/**
 * **A DECLINED JAVA FEATURE IS A DIVERGENCE, AND THIS DOCUMENT OMITTED ONE.** A30 gave lokalized-java
 * 3.1.0 a public `LanguageRangeEquivalents` setting whose `JDK` value switches its language-range
 * equivalences back to the running JDK's table, and the maintainer declined it for JavaScript (A30
 * resolution 5). The README's migration table and the spec's `java-surface-amendments.json` both named
 * it; this file, which says every deliberate difference is listed, did not, because every section
 * above is corpus-backed and a declined API has no corpus case.
 *
 * The ROWS come from the spec's record: each amendment row dispositioned "No JavaScript counterpart"
 * is a row here. The mapping below adds only what that record does not carry — the Java entry points
 * the type reaches, and a probe of THIS package that is true while the counterpart is absent. A row
 * with no mapping, a mapping with no row, and a probe that stops holding each fail the run.
 */
const DECLINED_JAVA_API = {
  LanguageRangeEquivalents: {
    java: "`Strings.Builder#languageRangeEquivalents(LanguageRangeEquivalents)`, `LanguageRangeEquivalents.JDK`",
    /** @returns {string | null} null while the counterpart is still absent; otherwise what changed */
    stillAbsent: () => {
      const base = { strings: { en: { K: "a" } }, fallbackLocale: "en", locale: "en" };
      try { rootEntry.createStrings(base); } catch (error) {
        return `the control construction itself failed (${/** @type {Error} */ (error).message}); the probe proves nothing`;
      }
      try {
        rootEntry.createStrings({ ...base, languageRangeEquivalents: "JDK" });
        return "createStrings now ACCEPTS a languageRangeEquivalents option";
      } catch (error) {
        if (!String(/** @type {Error} */ (error).message).includes("languageRangeEquivalents"))
          return `createStrings refused the option for another reason: ${/** @type {Error} */ (error).message}`;
      }
      const exported = [rootEntry, coreEntry, negotiateEntry].flatMap((entry) => Object.keys(entry))
        .filter((name) => /languagerangeequivalents/i.test(name));
      return exported.length > 0 ? `this package now exports ${exported.join(", ")}` : null;
    },
  },
};
{
  const amendmentsPath = specPath("java-surface-amendments.json");
  /** @type {any[]} */
  let amendmentRows = [];
  try { amendmentRows = JSON.parse(readFileSync(amendmentsPath, "utf8")).rows ?? []; } catch (error) {
    problems.push(`${amendmentsPath} cannot be read (${/** @type {Error} */ (error).message}); the declined-API rows come from it, and absence is not "none declined"`);
  }
  const declined = amendmentRows.filter((row) => /^No JavaScript counterpart/.test(String(row?.disposition)));
  const mapping = /** @type {Record<string, { java: string, stillAbsent: () => string | null }>} */ (DECLINED_JAVA_API);
  const rows = [];
  for (const row of declined) {
    const entry = mapping[row.type];
    if (!entry) { problems.push(`java-surface-amendments.json declines ${row.type} (${row.amendment}) and DECLINED_JAVA_API has no entry for it`); continue; }
    const stale = entry.stillAbsent();
    if (stale !== null) problems.push(`STALE declined-API row ${row.type}: ${stale}. Re-derive the row or the spec's disposition`);
    rows.push([entry.java, `${row.disposition} (${row.amendment}, ${row.since})`]);
  }
  for (const type of Object.keys(mapping))
    if (!declined.some((row) => row.type === type))
      problems.push(`DECLINED_JAVA_API names ${type}, which java-surface-amendments.json no longer declines; the mapping outlived its row`);
  sections.push({
    heading: "Java API this package declines",
    intro: "Public Java API with no counterpart here, by decision rather than by construction. Each row " +
      "comes from lokalized-spec's `java-surface-amendments.json`, and `npm run divergences` fails if " +
      "this package grows the counterpart while the row still says it has none.",
    table: { head: ["Java", "why there is no counterpart"], rows },
  });
}

/* ------------------------------------------------------- 8. JDK-version-dependent, modelled at 21 */
/**
 * **lokalized-java ANSWERS WITH WHATEVER JDK IT RUNS ON; THIS PACKAGE MODELS JDK 21.** Where the answer
 * depends on the JDK version, a Java deployment on a newer JDK differs from this package even though
 * both are correct for their pinned JDK. The Java column is MEASURED (Corretto 17, 21, 25, 26 and 27,
 * 2026-09-23, `java.util.Locale.LanguageRange#parse`, which lokalized-java's own javadoc names as
 * failing the same way); the "this package" column is re-measured every run and a row whose answer
 * has moved is STALE.
 */
const JDK_VERSION_DEPENDENT = [
  {
    input: "a range made only of hyphens, e.g. `parseLanguageRanges(\"-\")`",
    java: "JDK 17 and 21: `ArrayIndexOutOfBoundsException` `Index 0 out of bounds for length 0`; JDK 25, 26 and 27: `IllegalArgumentException` `range=-`",
    expected: "RangeError: Index 0 out of bounds for length 0",
    observe: () => {
      try { negotiateEntry.parseLanguageRanges("-"); return "no refusal"; } catch (error) {
        return `${/** @type {Error} */ (error).name}: ${/** @type {Error} */ (error).message}`;
      }
    },
  },
];
{
  const rows = [];
  for (const row of JDK_VERSION_DEPENDENT) {
    const observed = row.observe();
    if (observed !== row.expected)
      problems.push(`STALE JDK-version row (${row.input}): this package now answers ${JSON.stringify(observed)}, not ${JSON.stringify(row.expected)}`);
    rows.push([row.input, row.java, `\`${row.expected.split(": ")[0]}\` \`${row.expected.split(": ").slice(1).join(": ")}\` (JDK 21's answer)`]);
  }
  sections.push({
    heading: "Answers that depend on the JDK version",
    intro: "This package models JDK 21, the JDK every check here pins. lokalized-java answers with the JDK " +
      "it runs on, so on a different JDK these differ.",
    table: { head: ["input", "lokalized-java, by JDK", "this package"], rows },
  });
}

/* ------------------------------------------------------------------------------- anti-vacuity */
const totalRows = sections.reduce((sum, s) => sum + s.table.rows.length, 0);
// **A ROW COUNT VOUCHES FOR A ROW THAT SAYS NOTHING, and the first version of this file proved it:**
// 45 rows passed the floor with 31 of them carrying a blank or `[object Object]` cell, because the
// section builders guessed at field names instead of reading the records. A document is not its
// row count.
for (const section of sections)
  for (const row of section.table.rows)
    for (const [column, value] of row.entries()) {
      const text = String(value ?? "").trim();
      if (text === "")
        problems.push(`'${section.heading}' has an EMPTY '${section.table.head[column]}' cell — ` +
          `the record's field is named something else and this builder guessed`);
      if (text.includes("[object Object]"))
        problems.push(`'${section.heading}' renders an object into its '${section.table.head[column]}' ` +
          `column instead of a field of it`);
    }
if (sections.some((s) => s.table.rows.length === 0))
  problems.push(`section(s) ${sections.filter((s) => !s.table.rows.length).map((s) => `'${s.heading}'`).join(", ")} ` +
    `have no rows — a heading with nothing under it reads as "none of these exist"`);
// FLOORS AT TODAY'S COUNT, in the house style. A record family that stops being read must fail here
// rather than quietly shrinking the document a consumer relies on.
if (sections.length < 8) problems.push(`${sections.length} section(s); this document had 8`);
if (totalRows < 53) problems.push(`${totalRows} row(s) across all sections; this document had 53`);

const body = [
  "# Divergences from lokalized-java",
  "",
  "<!-- GENERATED by tools/divergences.mjs. Do not edit: every row comes from a table that already",
  "     gates something, so a divergence that stops being true fails a check rather than outliving",
  "     this file. Regenerate with `node tools/divergences.mjs --write`. -->",
  "",
  // **3.0.0 UNTIL 2026-09-20, AND THE BEHAVIOURS IT COUNTS WERE NEVER 3.0.0's.** The corpus has
  // been recorded against 3.1.0-SNAPSHOT since M-R S12/S13, and at least nine of the behaviours
  // counted here — the `iana-equivalence.registry-gap.*` rows, all required and all passing —
  // exist only because 3.1.0 answers differently from 3.0.0. The maintainer's decision: this is a
  // port of 3.1.0 once that is released. The version is stated rather than derived because this
  // file must run where lokalized-java is absent, which is every CI job.
  "This package is a port of [lokalized-java](https://github.com/lokalized/lokalized-java) 3.1.0 and",
  `matches it on ${conformance.passedIds.length} recorded behaviours. Where it does not, the`,
  "difference is deliberate and listed here.",
  "",
  ...sections.flatMap((s) => [
    `## ${s.heading}`, "", s.intro, "",
    `| ${s.table.head.join(" | ")} |`,
    `|${s.table.head.map(() => "---").join("|")}|`,
    ...s.table.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
    "", ...(s.after ? [s.after, ""] : []),
  ]),
].join("\n");

const serialized = `${body}\n`;
const write = process.argv.includes("--write");
// **WRITTEN ONLY BY A RUN WITH NO PROBLEMS.** This used to write first and report afterwards, so a
// `--write` that failed — `npm pack` without the sibling spec, for one — still rewrote the tracked
// DIVERGENCES.md with its declined-API table emptied, then exited 1 (found by the 2026-09-23
// pre-push review). A deliberate shrink goes through the floors above, which are code.
if (write && problems.length === 0) writeFileSync(OUTPUT, serialized);
else if (write) problems.push(`${OUTPUT} was NOT written: a run with problems does not re-record the document`);
else {
  let recorded = "";
  try { recorded = readFileSync(OUTPUT, "utf8"); } catch { problems.push(`${OUTPUT} does not exist. Run: node tools/divergences.mjs --write`); }
  if (recorded && recorded !== serialized)
    problems.push("DIVERGENCES.md is not what this measurement produces — a declared divergence moved " +
      "and the document must be re-recorded deliberately");
}

console.log(`DIVERGENCES.md — ${sections.length} section(s), ${totalRows} row(s)`);
for (const s of sections) console.log(`  ${String(s.table.rows.length).padStart(3)}  ${s.heading}`);
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exit(1);
}
