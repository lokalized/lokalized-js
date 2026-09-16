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
 *
 * WHAT THIS COMPARES, AND WHY IT IS MORE THAN THE TOKEN SEQUENCES. Two things the oracle already had
 * in hand were not being emitted, and both are the shape this project has now found in three
 * separate differentials (`diff:lookup` dropped the refusal MESSAGE, `diff:language-range` dropped
 * the refusal CLASS, `diff:direct-tag` printed a truncation and compared it to nothing):
 *
 *   - `TokenType` ITSELF — its 74 members in declaration order, its 71 fixed symbols, and the 71
 *     reverse entries. A per-probe comparison can only see a token type some probe PRODUCES, and
 *     this probe set produces 30 of 74 (derived and printed on every run below). The other 44 were
 *     compared against nothing at all.
 *   - THE REFUSAL CLASS. The harness caught a `RuntimeException`, printed `getMessage()` and threw
 *     `getClass()` away, so a port that refused with the right words and the wrong type was
 *     indistinguishable from a correct one.
 *
 * ABLATION — four port-side perturbations, each run TWICE in a throwaway copy of the tree, once
 * with the PRISTINE tool and once with this one (2026-09-15, pinned JDK). Every number below was
 * read from the run; none is an estimate.
 *
 *   | port-side perturbation, in `src/internal/expression-tokenizer.js` | pristine | this tool             |
 *   |------------------------------------------------------------------|----------|-----------------------|
 *   | swap CLUSIVITY_INCLUSIVE/CLUSIVITY_EXCLUSIVE in `TokenType`       | 0, 373/373 | 1, INVENTORY (2)    |
 *   | delete BOOLEAN_RESULT from `TokenType`                            | 0, 373/373 | 1, INVENTORY (72)   |
 *   | rebind CLASSIFIER_FLAT's symbol to "CLASSIFIER_FLAT2"             | 0, 373/373 | 1, INVENTORY (3)    |
 *   | refuse with `RangeError`, message byte-identical                  | 0, 373/373 | 1, DIFFERENCES (5)  |
 *
 * In all four the pristine tool reported exit 0 and `373/373 identical`; both controls (pristine and
 * this one, unablated) are exit 0. The first three are invisible to the token sequences because no
 * probe produces those constants — the run prints how many it does produce, below. The fourth is
 * invisible because only the message was ever emitted, and it is the same shape S31 measured in
 * `diff:language-range`.
 *
 * AND THE CORPUS IS BLIND TO ALL FOUR. `node tools/conformance.mjs` under each of them, with the
 * ablation's presence in `src/` asserted by digest at the moment it ran, produced a report
 * BYTE-IDENTICAL to the unablated control — exit 0, 2,117 passed, 0 FAILED. That is not a claim that
 * these mutations are harmless: it is the measurement that says this differential, and not the
 * corpus, is what stands between them and a release.
 *
 * AND THE NEW GATES WERE NEGATIVE-TESTED THEMSELVES, because a harness that fails loudly needs the
 * same scepticism as the gate it tests. Five instrument-side mutations, each in the copy, each
 * restored (2026-09-15):
 *
 *   - oracle stops emitting the preamble row -> `INVENTORY (1): ... saw 0; the token type tables
 *     were NOT compared`, exit 1. Absence is never read as agreement.
 *   - `errorType` dropped from the comparison, exactly as `diff:language-range` had it -> this tool
 *     still reports `373/373 identical` and `ORACLE FIELD COVERAGE` names the field, exit 1. The
 *     column I added is itself under the gate that exists for columns like it.
 *   - every refusing probe filtered out of `inputs()` -> `DEGENERATE (2)`: the refusal bucket, and
 *     the stale `JS_CLASS_FOR_JAVA` row that no longer has anything to describe.
 *   - a bogus `JS_CLASS_FOR_JAVA` row -> `DEGENERATE (1)` naming it, exit 1.
 *   - only a refusing probe in `inputs()` -> `DEGENERATE (1)`: no probe accepted, so the token
 *     sequences are compared over nothing.
 *
 * One of the five DID NOT FIRE on the first attempt and the run said so rather than reading green:
 * the filter that was supposed to remove every refusing probe missed one, because the corpus spells
 * `count == 0` with U+00A0 rather than a space, and the headline duly printed `1 refused`. A gate
 * that cannot be shown to fail has not been tested.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { oracleFieldProblems, recordingOracleRows } from "../oracle-field-coverage.mjs";

/**
 * Emitted by the Java oracle and deliberately NOT compared, each with the reason it cannot be.
 * Checked in BOTH directions by `oracleFieldProblems`: an entry for a field the comparison does
 * read fails, and so does one the oracle no longer emits.
 *
 * Empty, and that is the honest state: every field the oracle emits — `kind`, `in`, `ok`, `tokens`,
 * `error`, `errorType`, `tokenTypes`, `symbolsByTokenType`, `tokenTypesBySymbol` — reaches a
 * comparison below.
 */
const UNCOMPARED_ORACLE_FIELDS = {};

/**
 * Java's refusal class, mapped to the JS name the port raises for it.
 *
 * ONE ENTRY, WHICH IS THE POINT: Java raises exactly one class across this whole probe space, so a
 * row-against-row equality on `errorType` would discriminate nothing — it would be green over any
 * port at all. The comparison is therefore a MAPPING, asserting the PAIR, on the project's standing
 * "Java's SHAPE with the JS name" rule and on `tools/language-range-diff/run.mjs:408`'s precedent,
 * which is where the dropped-class defect was first found and fixed.
 *
 * An UNMAPPED Java type reaches the comparison as `UNMAPPED:<class>` and fails the run loudly rather
 * than being waved through. A mapping row that NO probe exercises is stale and also fails — see the
 * degenerate-set gate below; this project has three known-gap lists that rotted before anyone made
 * them fail on stale entries.
 */
const JS_CLASS_FOR_JAVA = { "com.lokalized.ExpressionEvaluationException": "ExpressionEvaluationError" };

/**
 * @param {string} javaClass the `errorType` the oracle emitted
 * @returns {string} the JS class name the port must raise, or a loud `UNMAPPED:` marker
 */
function jsClassFor(javaClass) {
  return Object.hasOwn(JS_CLASS_FOR_JAVA, javaClass)
    ? /** @type {Record<string, string>} */ (JS_CLASS_FOR_JAVA)[javaClass]
    : `UNMAPPED:${javaClass}`;
}

/**
 * THE ORACLE'S TOKEN TYPE INVENTORY AGAINST THE PORT'S, member by member.
 *
 * The port's three tables are hand-maintained: 74 names in Java's DECLARATION ORDER
 * (`src/internal/expression-tokenizer.js:48-123`), 71 fixed symbols (`:286-298`), and the 71 reverse
 * entries (`:306-312`) that `tokenFor` consults to decide whether a matched identifier becomes a
 * language-form constant (`:479-483`). None of the three is generated, so each is exactly the kind
 * of table that drifts silently from its source. This compares them against Java on every run.
 *
 * @param {Record<string, unknown>} row the oracle's inventory row
 * @param {{ tokenTypes: Record<string, string>, symbolsByTokenType: Record<string, string>, tokenTypeBySymbol: Record<string, string> }} port
 * @returns {string[]} problems, each naming the offending member; empty when the tables agree
 */
function inventoryProblems(row, port) {
  const problems = [];
  const javaNames = /** @type {string[]} */ (row.tokenTypes);
  const portNames = Object.keys(port.tokenTypes);
  // ORDER IS COMPARED, NOT JUST MEMBERSHIP. `expression-tokenizer.js:384-403` builds the alternation
  // by walking the port's own table, and both engines are leftmost-alternative, so declaration order
  // is behaviour rather than style — the module's own docblock says so at `:12-30`.
  for (let i = 0; i < Math.max(javaNames.length, portNames.length); i++)
    if (javaNames[i] !== portNames[i])
      problems.push(`TokenType[${i}]: Java declares ${JSON.stringify(javaNames[i] ?? null)}` +
        ` and the port declares ${JSON.stringify(portNames[i] ?? null)}`);
  // The port's VALUES are what appear in an emitted token, and the check above reads only its KEYS,
  // so a key/value disagreement would leave it green while every token carried the other spelling.
  for (const name of portNames)
    if (port.tokenTypes[name] !== name)
      problems.push(`TokenType.${name} is bound to ${JSON.stringify(port.tokenTypes[name])}, not to its own name`);
  problems.push(...tableProblems("symbolsByTokenType",
    /** @type {Record<string, string>} */ (row.symbolsByTokenType), port.symbolsByTokenType));
  problems.push(...tableProblems("tokenTypesBySymbol",
    /** @type {Record<string, string>} */ (row.tokenTypesBySymbol), port.tokenTypeBySymbol));
  return problems;
}

/**
 * Both directions of one map: an entry Java has and the port lacks, an entry they disagree on, and
 * an entry the port has and Java does not. The third direction is not decoration — the port builds
 * `TOKEN_TYPE_BY_SYMBOL` by inverting its own symbol table, so an EXTRA port entry is exactly what a
 * mis-bound symbol produces.
 *
 * @param {string} label
 * @param {Record<string, string>} java
 * @param {Record<string, string>} port
 * @returns {string[]}
 */
function tableProblems(label, java, port) {
  const problems = [];
  for (const [key, value] of Object.entries(java)) {
    if (!Object.hasOwn(port, key)) problems.push(`${label}: Java maps ${JSON.stringify(key)} -> ${JSON.stringify(value)} and the port has no such entry`);
    else if (port[key] !== value) problems.push(`${label}: ${JSON.stringify(key)} -> ${JSON.stringify(value)} in Java, ${JSON.stringify(port[key])} in the port`);
  }
  for (const [key, value] of Object.entries(port))
    if (!Object.hasOwn(java, key)) problems.push(`${label}: the port maps ${JSON.stringify(key)} -> ${JSON.stringify(value)} and Java has no such entry`);
  return problems;
}

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

  const { extractTokens, TokenType, SYMBOL_BY_TOKEN_TYPE, TOKEN_TYPE_BY_SYMBOL } =
    await import("../../src/internal/expression-tokenizer.js");
  const recorder = recordingOracleRows(
    readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const rows = recorder.rows;

  let same = 0;
  let probes = 0;
  let inventories = 0;
  let accepted = 0;
  let refused = 0;
  /** Java refusal classes this run actually observed, for the stale-mapping gate. @type {Set<string>} */
  const javaErrorTypesSeen = new Set();
  /** Token types some probe actually PRODUCED, for the derived blind-spot line. @type {Set<string>} */
  const producedTokenTypes = new Set();
  /** @type {string[]} */
  let javaTokenTypeNames = [];
  const differences = [];
  /** @type {string[]} */
  const tableFaults = [];

  for (const row of rows) {
    // TWO ROW SHAPES, DISCRIMINATED BY `kind` — and read here rather than sniffed from the presence
    // of another field, so the field-coverage recorder below observes it like any other column.
    if (row.kind === "inventory") {
      inventories++;
      javaTokenTypeNames = /** @type {string[]} */ (row.tokenTypes) ?? [];
      tableFaults.push(...inventoryProblems(row, {
        tokenTypes: TokenType, symbolsByTokenType: SYMBOL_BY_TOKEN_TYPE, tokenTypeBySymbol: TOKEN_TYPE_BY_SYMBOL,
      }));
      continue;
    }
    probes++;
    let actual;
    try {
      const tokens = extractTokens(row.in);
      for (const token of tokens) producedTokenTypes.add(token.tokenType);
      actual = { ok: true, tokens: tokens.map((t) => (t.symbol === null || t.symbol === undefined ? `${t.tokenType}` : `${t.tokenType}:${t.symbol}`)) };
    } catch (error) {
      // `constructor.name` rather than `name`: the port sets `name` as a plain own property on every
      // error it raises, so comparing it would be comparing a string the port chose about itself.
      // The CLASS is the thing a consumer's `instanceof` keys on.
      actual = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        errorClass: error instanceof Error ? error.constructor.name : "not an Error",
      };
    }
    if (row.ok) accepted++;
    else {
      refused++;
      javaErrorTypesSeen.add(/** @type {string} */ (row.errorType));
    }
    const wanted = row.ok
      ? { ok: true, tokens: row.tokens }
      : { ok: false, error: row.error, errorClass: jsClassFor(/** @type {string} */ (row.errorType)) };
    if (JSON.stringify(actual) === JSON.stringify(wanted)) same++;
    else differences.push({ input: row.in, wanted, actual });
  }

  console.log(`tokenizer differential against Java on the pinned JDK: ${same}/${probes} identical`);
  // DERIVED EVERY RUN, NOT QUOTED FROM A COMMENT: how much of `TokenType` the probe sequences can
  // actually see. This is the size of the blind spot the inventory row exists to cover, and printing
  // it is what stops the justification above from becoming another self-asserting text.
  if (javaTokenTypeNames.length)
    console.log(`  probe sequences produce ${producedTokenTypes.size} of Java's ${javaTokenTypeNames.length}` +
      ` declared token types; the inventory row is what covers the other ${javaTokenTypeNames.length - producedTokenTypes.size}` +
      ` — ${accepted} probes accepted, ${refused} refused`);
  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const d of differences.slice(0, 12))
      console.log(`\n  ${JSON.stringify(d.input)}\n    java ${JSON.stringify(d.wanted)}\n    js   ${JSON.stringify(d.actual)}`);
    process.exit(1);
  }

  // ANTI-VACUITY FOR THE INVENTORY. An oracle that stopped emitting the preamble row would leave the
  // three tables compared against nothing, and a green run is indistinguishable from a checked one.
  if (inventories !== 1)
    tableFaults.unshift(`expected exactly one inventory row from the oracle, saw ${inventories};` +
      ` the token type tables were NOT compared`);
  if (tableFaults.length) {
    console.log(`\nTOKEN TYPE INVENTORY (${tableFaults.length}):`);
    for (const fault of tableFaults) console.log(`  ${fault}`);
    process.exit(1);
  }

  // DEGENERATE-SET GATE, on `tools/load-diff/run.mjs:337-360`'s shape, and it is load-bearing here
  // for a reason `tools/oracle-field-coverage.mjs` names as its own known limit: that recorder is
  // per-FIELD, not per-BUCKET. `tokens` is only ever read on an accepting row and `error`/
  // `errorType` only on a refusing one, so a probe set that lost one of the two buckets would leave
  // half these columns compared over nothing while the field-coverage check stayed perfectly green.
  // Measured today: 368 accepted, 5 refused, 74 declared token types, 71 symbols.
  const degenerate = [];
  if (accepted === 0) degenerate.push("no probe is ACCEPTED by Java — the token sequences are compared over nothing");
  if (refused === 0) degenerate.push("no probe is REFUSED by Java — the message and refusal class are compared over nothing");
  if (javaTokenTypeNames.length === 0) degenerate.push("Java declared NO token types — the inventory comparison is vacuous");
  if (Object.keys(/** @type {Record<string, string>} */ (SYMBOL_BY_TOKEN_TYPE)).length === 0)
    degenerate.push("the port declares NO fixed symbols — the symbol tables are compared over nothing");
  // STALE MAPPING: a `JS_CLASS_FOR_JAVA` row no probe reaches is a claim about Java nothing checks.
  for (const javaClass of Object.keys(JS_CLASS_FOR_JAVA))
    if (!javaErrorTypesSeen.has(javaClass))
      degenerate.push(`JS_CLASS_FOR_JAVA declares ${JSON.stringify(javaClass)} and no probe made Java raise it;` +
        ` delete the row, or add a probe that reaches it — the deletion is the record`);
  if (degenerate.length) {
    console.log(`\nDEGENERATE PROBE SET (${degenerate.length}) — the comparison cannot mean what it claims:`);
    for (const reason of degenerate) console.log(`  ${reason}`);
    process.exit(1);
  }

  // THE ORACLE'S OWN FIELDS, OBSERVED RATHER THAN ASSUMED — see tools/oracle-field-coverage.mjs.
  const fieldProblems = oracleFieldProblems("tokenizer", recorder, UNCOMPARED_ORACLE_FIELDS);
  if (fieldProblems.length) {
    console.log(`\nORACLE FIELD COVERAGE (${fieldProblems.length}):`);
    for (const problem of fieldProblems) console.log(`  ${problem}`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
