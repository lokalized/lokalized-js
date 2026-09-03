#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests the JS escape grammar and bidi isolation against the REAL Java ones.
 *
 * `InterpolateDiff.java` calls `StringInterpolator.interpolate` (lenient), `BidiUtils.isolate` and
 * `BidiUtils.localeUsesRightToLeftScript` directly on the pinned JDK. Nothing on the Java side
 * reinterprets a rule, so a disagreement is a port defect rather than a difference between two
 * readings of the source.
 *
 * Three of the rules here are ones a careful reader gets wrong, which is why this exists in addition
 * to the corpus replay:
 *
 * - an escaped opening scans forward to the NEXT `}}` ANYWHERE in the string, not to a matching one,
 *   so it swallows a following real placeholder whole;
 * - the contents of an escaped region are copied in one pass with NO escape processing, so a doubled
 *   backslash inside one stays doubled and an escaped close inside one does not protect it;
 * - `isolate` repairs isolate structure while copying — dropping unmatched pops, balancing unclosed
 *   initiators — and returns an already-isolated value untouched, but only when the run covers the
 *   whole value.
 *
 * The corpus pins each of these on one shape. This sweeps the neighbourhood around them, where an
 * off-by-one in the index advance lives.
 *
 *   node tools/interpolate-diff/run.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const javaDir = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(root, "../lokalized-java");
const specDir = process.env.LOKALIZED_SPEC_DIR ? resolve(process.env.LOKALIZED_SPEC_DIR) : resolve(root, "../lokalized-spec");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const classes = join(javaDir, "target/classes");
const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}

const FSI = "⁨";
const PDI = "⁩";
const LRI = "⁦";
const RLI = "⁧";

/** Every key and translation the corpus contains that carries an escape, plus the boundaries. */
function lenientInputs() {
  const corpus = JSON.parse(readFileSync(join(specDir, "generated/behavioral-vectors.json"), "utf8"));
  const set = new Set();

  // Real corpus material first: any string anywhere in a fixture or a case input that contains a
  // delimiter or a backslash is a template some author actually wrote.
  const walk = (value) => {
    if (typeof value === "string") {
      if (value.includes("{{") || value.includes("}}") || value.includes("\\")) set.add(value);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const item of Array.isArray(value) ? value : Object.values(value)) walk(item);
  };
  walk(corpus.fixtures);
  for (const testCase of corpus.cases) walk(testCase.input);

  // Backslash-run parity, the index advance at every branch's end of string, and the delimiter
  // confusions. Three is the shortest run at which parity handling can go wrong.
  for (const input of [
    "\\", "\\\\", "\\\\\\", "\\\\\\\\", "\\\\\\\\\\",
    "\\{{name}}", "\\\\{{name}}", "\\\\\\{{name}}", "\\\\\\\\{{name}}",
    "}}", "{{", "{{}}", "{{ }}", "{{-x}}", "{{x-y}}", "{{9x}}", "{{__proto__}}", "{{constructor}}",
    "{{prototype}}", "\\}}", "\\{{", "\\{{unclosed", "\\{{a}}\\{{b}}", "\\{{}}", "{{x}}}}",
    "{{name}}{{name}}", "{{empty}}|", "{{zero}}|", "{{nul}}|", "{{missing}}|", "{{name}",
    "}}{{name}}", "{{{{name}}}}", "pre \\{{ mid }} post {{name}}", "a\\tb", "\\n", "\\{{a \\\\ b}}",
    "\\{{a \\}} b}} tail", "{{name}}\\", "\\{{name}}\\", "x\\", "\\x", "",
    // An escaped opening whose region CONTAINS a `{{` before the next `}}`, followed by a
    // resolvable placeholder. This is the only shape that separates the two readings of the escape
    // branch: "scan to the next `}}` anywhere, then resume" versus "give up and copy the rest".
    // Every escaped input above has an inert tail, so both readings agree on all of them, and a
    // scan that stopped at the inner opening survived this differential and the unit suite until
    // these rows were added. Java resumes: `\{{a {{name}} b}} {{name}}` is `{{a {{name}} b}} Ada`.
    "\\{{a {{name}} b}} {{name}}", "\\{{a {{name}} b}}", "\\{{ {{name}} }}{{name}}",
    "\\{{{{name}}}}{{name}}", "x\\{{y {{name}}", "\\{{a {{b}}", "\\{{{{name}}}}",
    "\\{{a {{name}}}} {{name}}", "\\{{{{ }}}}{{name}}", "\\{{a {{name}} }}{{missing}}{{name}}",
  ]) set.add(input);

  return [...set];
}

/** Every isolate shape `BidiUtils.isolate` decides differently, plus the guards' boundaries. */
function isolateInputs() {
  return [
    "", "a", "Sarah", "مرحبا", "Sarah مرحبا",
    FSI, PDI, LRI, RLI, `${FSI}${PDI}`, `${LRI}${PDI}`, `${RLI}${PDI}`,
    `${FSI}Sarah${PDI}`, `${LRI}Sarah${PDI}`, `${RLI}Sarah${PDI}`,
    `${FSI}a${PDI}b`, `b${FSI}a${PDI}`, `a${PDI}b`, `${PDI}abc`, `abc${PDI}`,
    `${RLI}ab`, `${RLI}${LRI}ab`, `a${FSI}b${PDI}c`, `${FSI}a${PDI}${PDI}`,
    `${FSI}a${FSI}b${PDI}${PDI}`, `a${PDI}${PDI}b`, `${LRI}a${RLI}b${PDI}${PDI}`,
    `${FSI}${FSI}${PDI}${PDI}`, `${FSI}${PDI}${FSI}${PDI}`, "0", "false", "\t", "\n",
    // Non-BMP and combining input. Java copies UTF-16 CODE UNITS one at a time and only ever
    // special-cases four BMP characters, so a surrogate pair must survive being taken apart and put
    // back together; a port that iterated code POINTS, or normalized, would diverge only here.
    "😀", `${FSI}😀${PDI}`, "😀a😀", "𝕊arah", "áb", "‏abc‎", `😀${PDI}b`,
  ];
}

/** Both branches of `localeUsesRightToLeftScript`, over RTL and LTR tags of each shape. */
function rtlInputs() {
  return [
    "ar", "ar-Latn", "ar-EG", "ar-Arab-EG", "he", "he-IL", "en", "en-Arab", "en-arab", "en-ARAB",
    "fa-IR", "ckb", "yi", "ur", "ps", "dv", "sd", "ug", "ku", "nqo", "syr", "am", "ti", "mt", "ha",
    "wo", "ks", "pa-Arab", "uz-Arab", "az-Arab", "bal", "rhg", "de", "ja", "zh-TW", "ru", "el", "hi",
    "und", "root",
  ];
}

const work = mkdtempSync(join(tmpdir(), "lokalized-interpdiff-"));
try {
  /** @type {[string, string][]} */
  const rows = [
    ...lenientInputs().map((input) => /** @type {[string, string]} */ (["lenient", input])),
    ...isolateInputs().map((input) => /** @type {[string, string]} */ (["isolate", input])),
    ...rtlInputs().map((input) => /** @type {[string, string]} */ (["rtl", input])),
  ];

  const inPath = join(work, "inputs.txt");
  const outPath = join(work, "java.jsonl");
  writeFileSync(inPath, `${rows.map(([section, input]) => `${section}\t${JSON.stringify(input)}`).join("\n")}\n`, "utf8");

  const classesOut = join(work, "classes");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", classes, "-d", classesOut, join(here, "InterpolateDiff.java")], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);
  const run = spawnSync(join(JDK, "bin/java"), ["-cp", `${classes}:${classesOut}`, "com.lokalized.InterpolateDiff", inPath, outPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`oracle execution failed:\n${run.stderr}`);

  const { interpolateFailureKey } = await import("../../src/internal/interpolate.js");
  const { isolate, localeUsesRightToLeftScript } = await import("../../src/internal/bidi.js");
  const { normalizeTag } = await import("../../src/internal/locale.js");

  // The same bag `InterpolateDiff` builds on the Java side, including the two falsy-but-present
  // values and the explicit null, which are the three the port must not collapse into "absent".
  const context = { name: "Ada", realName: "Ada", esc: "ESCVAL", a: "AVAL", x: "XVAL", empty: "", zero: 0, nul: null };

  const javaRows = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const counts = { lenient: 0, isolate: 0, rtl: 0 };
  const differences = [];

  for (const row of javaRows) {
    let actual;
    try {
      if (row.section === "lenient") actual = { ok: true, out: interpolateFailureKey(row.in, context, false) };
      else if (row.section === "isolate") actual = { ok: true, out: isolate(row.in) };
      else actual = { ok: true, out: String(localeUsesRightToLeftScript(safeTag(row.in))) };
    } catch (error) {
      actual = { ok: false, error: error instanceof Error ? error.constructor.name : String(error) };
    }

    const wanted = row.ok ? { ok: true, out: row.out } : { ok: false, error: row.error };
    if (JSON.stringify(actual) === JSON.stringify(wanted)) counts[row.section]++;
    else differences.push({ section: row.section, input: row.in, wanted, actual });
  }

  /** @param {string} tag */
  function safeTag(tag) {
    try {
      return normalizeTag(tag);
    } catch {
      return tag;
    }
  }

  const total = javaRows.length;
  const same = counts.lenient + counts.isolate + counts.rtl;
  console.log(`interpolation/bidi differential against Java on the pinned JDK: ${same}/${total} identical`);
  console.log(`  lenient escape grammar  ${counts.lenient}`);
  console.log(`  BidiUtils.isolate       ${counts.isolate}`);
  console.log(`  RTL script detection    ${counts.rtl}`);
  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const d of differences.slice(0, 12))
      console.log(`\n  [${d.section}] ${JSON.stringify(d.input)}\n    java ${JSON.stringify(d.wanted)}\n    js   ${JSON.stringify(d.actual)}`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
