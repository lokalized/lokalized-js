// @ts-check
/**
 * **THE README MAKES CLAIMS ABOUT SOFTWARE THIS PACKAGE CANNOT DEPEND ON, so they are derived.**
 *
 * The plan obliges the documentation to cover "i18next differences". It was DECLINED once, for a
 * reason that was right in form and wrong in fact: that writing it would be "recollection about
 * software this machine does not have". i18next 26.4.2 installs and runs here, so the section is
 * written the way everything else in this README is — by executing both libraries.
 *
 * **WHICH MOVES THE HAZARD RATHER THAN REMOVING IT.** `npm run check:readme` executes the lokalized
 * column of that section; nothing executes the i18next column, because `lokalized` has zero
 * dependencies and `test/package-shape.test.js` enforces it. So the i18next column is a set of
 * numbers and strings a human could type — which is the failure mode of every comparison section
 * ever written, and this project's own most-recorded defect class aimed at a competitor.
 *
 * This file closes that: **every i18next figure the README states must appear in
 * `measurements/i18next.json`**, which `tools/i18next-diff/run.mjs` writes from a real run and
 * `npm run check:i18next` re-checks on every build.
 *
 * **AN ADVERSARIAL PASS OVER THE FIRST DRAFT IS WHY THIS EXISTS RATHER THAN BEING A PRECAUTION.** It
 * found a headline transcript that the design's own code could not have produced (an Arabic word in
 * the output that appeared in neither catalog), a probe that configured i18next with no fallback
 * catalog and then reported it failing, and a claim that lokalized exports nothing for formatting
 * when a sweep returns six hits. None of those reach a reader through a derived section.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const record = JSON.parse(readFileSync(join(root, "measurements", "i18next.json"), "utf8"));

const SECTION = "## How this differs from i18next";
const section = readme.slice(readme.indexOf(SECTION), readme.indexOf("## Entry points"));
const probe = (/** @type {string} */ axis) => {
  const found = record.probes.find((/** @type {any} */ p) => p.axis === axis);
  assert.ok(found, `the record carries no probe '${axis}' — the derivation is broken, not the prose`);
  return found;
};

test("the derivation is not vacuous", () => {
  assert.ok(section.length > 2000, "the i18next section was not found, or collapsed");
  assert.ok(record.probes.length >= 7, `only ${record.probes.length} probe(s) recorded`);
  assert.equal(record.formatVersion, 1);
});

test("every i18next figure the README states is one the recorded run produced", () => {
  // Each of these is a value a reader will act on, and each is pasted into the prose above by the
  // generator rather than typed. If the record moves and the README does not, this fails.
  const stated = [
    record.i18nextVersion,
    record.node,
    probe("formatting a number, currency or date inside a translation").i18next.number,
    probe("formatting a number, currency or date inside a translation").i18next.currency,
    probe("an interpolated value containing HTML").i18next.rendered,
    probe("a catalog missing a plural form the language requires").i18next.renderAtMillion,
    String(probe("cold start: import, construct, render one string").i18next.millisecondsToFirstString),
    String(probe("cardinal plural selection, both catalogs complete").i18next.agree),
  ];
  for (const value of stated)
    assert.ok(section.includes(value),
      `the README states an i18next figure the record does not carry, or has fallen behind it: ${value}`);
});

test("the lokalized column the README states is the recorded one too", () => {
  // The SAME rule pointed the other way. A comparison that derives only the competitor's half and
  // hand-writes its own is exactly as capable of flattering itself.
  for (const value of [
    probe("an interpolated value containing HTML").lokalized.rendered,
    probe("formatting a number, currency or date inside a translation").lokalized.raw,
    probe("a catalog missing a plural form the language requires").lokalized.renderAtMillion,
    String(probe("where the plural rules come from").lokalized.filesUsingIntlInCodeUnderSrc),
  ])
    assert.ok(section.includes(value), `the README's lokalized column has drifted from the record: ${value}`);
});

test("every figure in the section's TABLES traces to the record", () => {
  // **`includes` OVER THE WHOLE SECTION IS NOT ENOUGH, and an ablation is what said so.** Changing a
  // TABLE CELL from "Hi <script>x</script>" to "Hi (escaped)" left the two rules above GREEN,
  // because the same string also appears in the executed block below and `includes` found it there.
  // A reader looking at the table would have been told something the run never produced.
  //
  // So the tables are read as tables: every backticked cell must be a value the record carries, or
  // be declared below as prose. `check:readme` gates the executed block; this gates the part of the
  // section a sample cannot reach.
  // **AGAINST THE RECORD'S VALUES, NOT ITS SERIALIZED JSON, and the first version got this wrong.**
  // `JSON.stringify` escapes a non-breaking space to `\u00a0`, so the recorded currency cell
  // `Preis: 1.234,50\u00a0€` — a real measurement — read as unexplained prose. Walking the values
  // compares what the run produced rather than how it is stored.
  /** @type {string[]} */
  const values = [];
  (function walk(/** @type {unknown} */ node) {
    if (typeof node === "string") values.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  })(record);
  assert.ok(values.length >= 20, `only ${values.length} recorded value(s) — the derivation is broken`);

  /** Cells that are TEMPLATE SYNTAX rather than measurements. Checked for rot below. */
  const PROSE = ['"Summe: {{v, number}}"', '"Preis: {{v, currency(EUR)}}"'];

  const cells = [...section.matchAll(/^\|.*\|$/gm)]
    .flatMap((row) => row[0].split("|"))
    .flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()))
    .filter(Boolean);
  assert.ok(cells.length >= 8, `only ${cells.length} table cell(s) were parsed — the derivation is broken`);

  const unexplained = cells.filter((cell) =>
    !values.some((value) => value.includes(cell)) && !PROSE.includes(cell));
  assert.deepEqual(unexplained, [],
    "these table cells state a value the recorded run did not produce; re-run " +
    "`npm run diff:i18next` and regenerate the section, or add genuinely prose cells to PROSE");

  // THE KNOWN-GAP LIST IS CHECKED FOR ROT, on this project's standing rule that three of them have
  // outlived their reasons here. A PROSE entry no cell uses is dead machinery hiding the next one.
  for (const allowed of PROSE)
    assert.ok(cells.includes(allowed), `PROSE declares '${allowed}', which no table cell uses`);
});

test("the section does not claim a win the record does not record", () => {
  // **THE ANTI-FLATTERY TERM, and it is the reason this file is worth its maintenance.** The census
  // is the record's own; if the section ever reads as a sweep for this library, the census will say
  // otherwise and this fails. Today i18next wins more axes than lokalized does, and the section
  // opens by saying so.
  const better = record.census["I18NEXT-BETTER"] ?? 0;
  const stricter = record.census["LOKALIZED-STRICTER"] ?? 0;
  assert.ok(better >= 1,
    "no probe found i18next better — a comparison in which the competitor never wins is not a result");
  assert.ok(section.includes("i18next is the better choice"),
    "the record has i18next ahead and the section must say so in its opening");
  assert.ok(better > stricter,
    `the record has i18next better on ${better} axes and lokalized stricter on ${stricter}; if that ` +
    "ever inverts, rewrite the section's opening rather than leaving it claiming the opposite");
});

test("the section names the reasons to choose this library, and they are the real ones", () => {
  // Without this the section could be an unqualified recommendation of the competitor, which is a
  // different kind of dishonest. The three reasons are the ones the project actually exists for.
  for (const reason of ["lokalized-java", "host's ICU", "definiteness"])
    assert.ok(section.includes(reason), `the section must name '${reason}' as a reason to choose this`);
});
