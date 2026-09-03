#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests the JS expression tokenizer against the REAL Java one.
 *
 * `TokenDiff.java` calls `ExpressionTokenizer.extractTokens` directly on the pinned JDK and emits
 * the token sequence, or the real error message, for each input. Nothing on the Java side
 * reinterprets the grammar, so a disagreement is a genuine port defect rather than a difference
 * between two readings of the source.
 *
 * This exists because during M6 an agent concluded no JDK was available — it checked `java` on PATH
 * rather than the pinned path this project uses — and substituted a second hand-written reference
 * implementation. That was a useful test in its own right, but it is not the oracle. This is.
 *
 *   node tools/tokenizer-diff/run.mjs
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

/** Every expression the corpus actually contains, plus the boundaries a lexer gets wrong. */
function inputs() {
  const corpus = JSON.parse(readFileSync(join(specDir, "generated/behavioral-vectors.json"), "utf8"));
  const set = new Set();
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    for (const [key, item] of Object.entries(value)) {
      if (key === "alternatives" && Array.isArray(item))
        for (const alternative of item)
          if (alternative && typeof alternative === "object" && !Array.isArray(alternative))
            for (const expression of Object.keys(alternative)) set.add(expression);
      walk(item);
    }
  };
  walk(corpus.fixtures);

  // Adhesion and prefix confusions: a constant that is a prefix of another, an operator that is a
  // prefix of another, and word boundaries around the 61 constants.
  for (const form of [
    "GENDER_FEMININE", "GENDER_FEMININEX", "xGENDER_FEMININE", "CARDINALITY_ONE", "PHONETIC_H_SILENT",
    "CASE_DATIVE", "ANIMACY_ANIMATE", "a<b", "a<=b", "a>=b", "a=b", "a==b", "a!=b", "a and b", "a or b",
    "(a)", "((a))", "1.5", "+1", ".5", "5.", "1e10", "1E-3", "-0.0", "a  b", "a\tb", "a\nb", "", "   ",
    "a<<b", "a===b", "a<>b", "_x", "x_1", "x-1", "9007199254740993", "100000000000000000000",
    "true", "false", "__proto__", "constructor",
  ]) set.add(form);
  return [...set];
}

const work = mkdtempSync(join(tmpdir(), "lokalized-tokdiff-"));
try {
  const expressions = inputs();
  const inPath = join(work, "inputs.txt");
  const outPath = join(work, "java.jsonl");
  writeFileSync(inPath, `${expressions.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");

  const classesOut = join(work, "classes");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", classes, "-d", classesOut, join(here, "TokenDiff.java")], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);
  const run = spawnSync(join(JDK, "bin/java"), ["-cp", `${classes}:${classesOut}`, "com.lokalized.TokenDiff", inPath, outPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`oracle execution failed:\n${run.stderr}`);

  const { extractTokens } = await import("../../src/internal/expression-tokenizer.js");
  const rows = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  let same = 0;
  const differences = [];
  for (const row of rows) {
    let actual;
    try {
      actual = { ok: true, tokens: extractTokens(row.in).map((t) => (t.symbol === null || t.symbol === undefined ? `${t.tokenType}` : `${t.tokenType}:${t.symbol}`)) };
    } catch (error) {
      actual = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const wanted = row.ok ? { ok: true, tokens: row.tokens } : { ok: false, error: row.error };
    if (JSON.stringify(actual) === JSON.stringify(wanted)) same++;
    else differences.push({ input: row.in, wanted, actual });
  }

  console.log(`tokenizer differential against Java on the pinned JDK: ${same}/${rows.length} identical`);
  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const d of differences.slice(0, 12))
      console.log(`\n  ${JSON.stringify(d.input)}\n    java ${JSON.stringify(d.wanted)}\n    js   ${JSON.stringify(d.actual)}`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
