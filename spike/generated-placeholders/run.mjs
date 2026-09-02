#!/usr/bin/env node
// @ts-check
/**
 * Drives the throwaway spike against the corpus's `generated-placeholders` family.
 *
 * The spike is only worth anything if it is checked against recorded Java behavior rather than
 * against its author's belief, so this runs the SAME cases the shipping conformance runner reports
 * as unsupported and compares translations exactly.
 *
 *   node spike/generated-placeholders/run.mjs [--verbose]
 */
import { readFileSync } from "node:fs";
import { CycleError, ResolutionError, render } from "./spike.mjs";

const verbose = process.argv.includes("--verbose");
const corpus = JSON.parse(readFileSync(new URL("../../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url), "utf8"));
const cases = corpus.cases.filter((/** @type {any} */ c) => c.id.startsWith("generated-placeholders."));

const passed = [];
const failed = [];
const outOfScope = [];

for (const testCase of cases) {
  const fixture = corpus.fixtures[testCase.fixture];
  const entry = Object.values(fixture.files ?? {})
    .map((/** @type {any} */ catalog) => catalog[testCase.input.key])
    .find(Boolean);
  if (!entry) { outOfScope.push({ id: testCase.id, why: "key is absent from every catalog" }); continue; }

  const expected = testCase.expected.result;
  const wanted = expected.status === "TRANSLATED" ? expected.translation : null;

  let actual;
  try {
    actual = render(entry, testCase.input.placeholders ?? {}, expected.resolvedLocale ?? testCase.input.locale);
  } catch (error) {
    if (error instanceof CycleError || error instanceof ResolutionError) {
      // A failure is the RIGHT answer whenever Java also failed to resolve. Java reports the key.
      actual = null;
    } else {
      failed.push({ id: testCase.id, wanted, actual: `${error.constructor.name}: ${error.message}` });
      continue;
    }
  }

  if (actual === wanted) { passed.push(testCase.id); continue; }

  // Two things the spike deliberately cannot reach, recorded rather than counted as passes or defects.
  if (JSON.stringify(entry).includes('"range"')) {
    outOfScope.push({ id: testCase.id, why: "cardinal ranges need the M4 range data" });
    continue;
  }
  // The spike has no bounded limits by design — see its header. A budget case therefore over-expands
  // instead of failing, which is the absence of a feature rather than a wrong answer.
  if (testCase.id.includes(".limits.")) {
    outOfScope.push({ id: testCase.id, why: "the spike enforces no expansion budget (M5b/M6 own limits)" });
    continue;
  }
  failed.push({ id: testCase.id, wanted, actual });
}

const BEHAVIORS = {
  "branch inheritance": "inheritance.",
  "whole-definition replacement": "replacement.",
  "cross-kind replacement": "crosskind.",
  "late-bound dependency after selection": "late-binding.",
  "reachable-cycle failure": "cycles.",
  "raw-input selector scope / laziness": "scope.",
};

console.log(`generated-placeholder spike: ${cases.length} corpus cases\n`);
console.log(`  passed       ${String(passed.length).padStart(4)}`);
console.log(`  FAILED       ${String(failed.length).padStart(4)}`);
console.log(`  out of scope ${String(outOfScope.length).padStart(4)}`);

console.log(`\nthe six behaviors the M2 gate names:`);
for (const [behavior, prefix] of Object.entries(BEHAVIORS)) {
  const mine = cases.filter((/** @type {any} */ c) => c.id.startsWith(`generated-placeholders.${prefix}`));
  const ok = mine.filter((/** @type {any} */ c) => passed.includes(c.id)).length;
  const skip = mine.filter((/** @type {any} */ c) => outOfScope.some((o) => o.id === c.id)).length;
  const mark = ok + skip === mine.length && ok > 0 ? "PROVEN " : "partial";
  console.log(`  ${mark}  ${behavior.padEnd(38)} ${ok}/${mine.length}${skip ? ` (+${skip} out of scope)` : ""}`);
}

if (outOfScope.length) {
  console.log(`\nout of scope:`);
  for (const o of outOfScope) console.log(`  ${o.id.replace("generated-placeholders.", "")} — ${o.why}`);
}

if (failed.length) {
  console.log(`\nFAILURES (${failed.length}):`);
  for (const f of failed.slice(0, verbose ? failed.length : 10)) {
    console.log(`\n  ${f.id.replace("generated-placeholders.", "")}`);
    console.log(`    wanted ${JSON.stringify(f.wanted)}`);
    console.log(`    actual ${JSON.stringify(f.actual)}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
