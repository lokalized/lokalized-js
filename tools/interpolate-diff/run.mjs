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
 * A LENIENT ROW IS COMPARED ON TWO COLUMNS: the rendered string, and `names` — the set of
 * placeholder names the lenient scan REACHED, in first-occurrence order. The rendered column is the
 * weaker of the two and is blind by construction to a whole family of scan defects, because every
 * branch that declines to treat something as a placeholder re-emits the bytes it consumed: an
 * escape region that stops at an inner `{{`, and an identifier rule that accepts a leading digit,
 * both render BYTE-IDENTICALLY and reach a different set. `ESCAPE_REGION_ONLY_NAMES` further down
 * fails the run if the probes that separate those readings ever leave the probe space.
 *
 *   node tools/interpolate-diff/run.mjs
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
 */
const UNCOMPARED_ORACLE_FIELDS = {};

/**
 * WHAT THE `names` COLUMN NEEDS IN THE PROBE SPACE IN ORDER TO DISCRIMINATE ANYTHING.
 *
 * A column is only worth the probes that make two plausible implementations disagree over it, and
 * this project has repeatedly found a probe space that covered both arms of a branch while carrying
 * no input that CHOOSES between them — `rtlInputs` below carries its own paragraph about exactly
 * that, because those probes were green while the port isolated `ar-Zzzz` and Java did not. So the
 * four properties the new column rests on are CHECKED against the Java rows every run rather than
 * assumed, and each fails the run when its discriminating input disappears:
 *
 *   1. the column is not CONSTANT — some lenient probe reaches a name and some reaches none, so a
 *      port answering `[]` for every input, or one that treats every delimiter pair as a
 *      placeholder, is not identical to Java here. Measured 2026-09-15: 500 of 571 lenient probes
 *      reach at least one name;
 *   2. some probe reaches MORE THAN ONE name in an order other than the sorted one, so
 *      first-occurrence ORDER is discriminated and not merely set membership. Java accumulates into
 *      a `LinkedHashSet` (`StringInterpolator.java:105/189/289`) and the port into an array
 *      (`src/internal/interpolate.js:383`); a port that sorted, or that collected into an unordered
 *      set, would pass a membership-only comparison. Measured: 43 probes reach two or more names,
 *      16 of them unsorted, and 15 of those 16 are corpus templates rather than hand-written
 *      probes, so this arm does not rest on one line of this file;
 *   3. DEDUPE has a direction, and exactly ONE probe in the space shows it. A name that recurs must
 *      keep its FIRST position (`unresolved.includes` before `push`, Java's `Set.add`); a port that
 *      moved a repeat to its last occurrence answers the same MEMBERSHIP and a different order.
 *      Measured: of the 43 multi-name probes only `{{zed}} {{alpha}} {{zed}}` carries a repeat
 *      alongside another name — and a last-occurrence port answers `["alpha", "zed"]`, which is
 *      also the sorted answer, so this probe separates three readings at once. Because it is the
 *      only one, its expected answer is pinned below rather than inferred;
 *   4. the escaped region is NOT scanned for names. Each entry in `ESCAPE_REGION_ONLY_NAMES` is a
 *      probe whose escaped region holds a placeholder name appearing nowhere else in that probe, so
 *      Java's set must not contain it. This is the only shape that separates "scan to the next `}}`
 *      anywhere" from "stop at the inner `{{`": both render the same bytes.
 *
 * (3) and (4) are checked in BOTH directions, the way `DECLARED_MESSAGE_DIVERGENCES` is one layer
 * up: a declared probe that has left the probe set fails, and so does one whose Java answer has
 * changed — which would mean the entry describes a rule the oracle no longer has. Three known-gap
 * lists in this project rotted before anyone made them fail on stale entries.
 *
 * @type {[input: string, nameOnlyInsideTheEscapedRegion: string][]}
 */
const ESCAPE_REGION_ONLY_NAMES = [
  ["\\{{a {{missing}} b}}", "missing"],
  ["\\{{ {{missing}} }}", "missing"],
  ["{{missing}} \\{{a {{other}} b}}", "other"],
];

/**
 * The single probe that separates first-occurrence dedupe from last-occurrence dedupe, with the
 * answer Java gives for it — see (3) above for why it is pinned by value and not derived.
 *
 * @type {[input: string, javaNames: string[]]}
 */
const ORDER_AND_DEDUPE_PROBE = ["{{zed}} {{alpha}} {{zed}}", ["zed", "alpha"]];

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
    // THE NAME COLUMN NEEDS PROBES OF ITS OWN. Every escaped row above spells the name inside the
    // escaped region `name`, and the tail spells it too — so a scan that stops at the inner `{{`
    // and one that runs to the next `}}` reach the SAME set on all of them, and the column would be
    // satisfied by either reading. These put a name inside the escaped region that appears NOWHERE
    // else in the probe: they render byte-identically under both readings and differ only in the
    // set. Declared in `ESCAPE_REGION_ONLY_NAMES`, which fails the run if they are dropped.
    "\\{{a {{missing}} b}}", "\\{{ {{missing}} }}", "\\{{{{missing}}}}",
    "{{missing}} \\{{a {{other}} b}}",
    // DEDUPE HAS A DIRECTION, and measured over this whole probe space (2026-09-15) this is the
    // ONLY row that shows it: 43 lenient probes reach two or more names and this is the one where a
    // name RECURS beside another. Java answers `["zed", "alpha"]`; a port that let a repeat move to
    // its last occurrence answers `["alpha", "zed"]`, which is also the sorted answer, so one row
    // separates first-occurrence dedupe, last-occurrence dedupe and a sorted set at once. Pinned by
    // value in `ORDER_AND_DEDUPE_PROBE`, because a lone discriminator is exactly what goes missing.
    "{{zed}} {{alpha}} {{zed}}",
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

/**
 * Both branches of `localeUsesRightToLeftScript`, over RTL and LTR tags of each shape.
 *
 * THE `Zzzz` ROW EXISTS BECAUSE THIS LIST DID NOT HAVE IT, and that omission is worth keeping
 * visible. These 40 probes were green while the port isolated `ar-Zzzz` and Java did not: the two
 * branches were both covered, and the input that decides WHICH branch is taken — a script subtag
 * spelled with CLDR's unknown-script placeholder, which `Locale#getScript()` preserves and
 * `CldrLocaleData.TagParts:577` elides — was in neither the corpus nor this list. It took
 * `tools/likely-subtag-diff/`, whose probe space is the likely-subtag table's own key space, to
 * reach it. A green differential is evidence about the probe space it carries and nothing else.
 */
function rtlInputs() {
  return [
    "ar", "ar-Latn", "ar-EG", "ar-Arab-EG", "he", "he-IL", "en", "en-Arab", "en-arab", "en-ARAB",
    "fa-IR", "ckb", "yi", "ur", "ps", "dv", "sd", "ug", "ku", "nqo", "syr", "am", "ti", "mt", "ha",
    "wo", "ks", "pa-Arab", "uz-Arab", "az-Arab", "bal", "rhg", "de", "ja", "zh-TW", "ru", "el", "hi",
    "und", "root",
    // The placeholder family, with the controls beside it: the same languages WITHOUT `Zzzz` must
    // still isolate, or "agrees with Java" and "isolates nothing" become the same measurement.
    "ar-Zzzz", "ar-Zzzz-EG", "he-Zzzz", "fa-Zzzz", "und-Zzzz-IL", "en-Zzzz", "ar-ZZ", "ar-Zzzz-ZZ",
    "ar-zzzz", "AR-ZZZZ", "de-Hebr",
  ];
}

/**
 * The four checks `ESCAPE_REGION_ONLY_NAMES`' docblock documents, run against the Java rows.
 *
 * Java's answers are the right side to check: these are claims about what the PROBE SPACE can
 * separate, and the probe space plus the oracle is all that determines that. Running them against
 * the port's answers would make the gate agree with whatever the port does, which is the shape of
 * vacuity this file is trying not to add.
 *
 * @param {readonly Record<string, any>[]} rows every Java row, proxied by `recordingOracleRows`
 * @returns {string[]} problems; empty while the probe space still discriminates the name column
 */
function nameColumnProblems(rows) {
  /** @type {string[]} */
  const problems = [];
  const lenient = rows.filter((row) => row.section === "lenient" && row.ok === true);

  const reaching = lenient.filter((row) => row.names.length > 0).length;
  if (reaching === 0 || reaching === lenient.length)
    problems.push(`the name column is CONSTANT over the probe space: ${reaching} of` +
      ` ${lenient.length} lenient probes reach a name. A port that answers [] for every input, or` +
      ` one that treats every delimiter pair as a placeholder, would be identical here.`);

  const multiple = lenient.filter((row) => row.names.length > 1);
  if (!multiple.some((row) => JSON.stringify(row.names) !== JSON.stringify([...row.names].sort())))
    problems.push(`no lenient probe reaches two or more names in an order other than the sorted` +
      ` one (${multiple.length} probe(s) reach two or more), so a port that SORTS the set, or` +
      ` collects it into an unordered one, is indistinguishable from Java's first-occurrence` +
      ` LinkedHashSet. The order half of this comparison would be decoration.`);

  const [dedupeInput, dedupeNames] = ORDER_AND_DEDUPE_PROBE;
  const dedupeRow = lenient.find((candidate) => candidate.in === dedupeInput);
  if (!dedupeRow)
    problems.push(`${JSON.stringify(dedupeInput)} is the only probe in the space that carries a` +
      ` repeated name beside another name, and it is no longer in the lenient probe set. Without` +
      ` it, first-occurrence dedupe and last-occurrence dedupe give the same answer everywhere.`);
  else if (JSON.stringify(dedupeRow.names) !== JSON.stringify(dedupeNames))
    problems.push(`${JSON.stringify(dedupeInput)} is pinned to ${JSON.stringify(dedupeNames)} as` +
      ` the shape separating first-occurrence dedupe from last-occurrence dedupe, and Java now` +
      ` answers ${JSON.stringify(dedupeRow.names)}. The pin is STALE — re-derive it before` +
      ` trusting the order half of this column.`);

  if (ESCAPE_REGION_ONLY_NAMES.length === 0)
    problems.push("ESCAPE_REGION_ONLY_NAMES is empty, so nothing checks that the column separates" +
      " the two readings of the escape branch — which is the defect it was added to catch.");

  for (const [input, absent] of ESCAPE_REGION_ONLY_NAMES) {
    const row = lenient.find((candidate) => candidate.in === input);
    if (!row)
      problems.push(`${JSON.stringify(input)} is declared as a probe that holds` +
        ` ${JSON.stringify(absent)} only inside its escaped region, and it is no longer in the` +
        ` lenient probe set (or Java no longer renders it). Restore it or delete the entry —` +
        ` without one of these the escape branch is compared on rendered bytes alone.`);
    else if (row.names.includes(absent))
      problems.push(`${JSON.stringify(input)} is declared to hold ${JSON.stringify(absent)} only` +
        ` inside its escaped region, and Java now reports it: ${JSON.stringify(row.names)}. The` +
        ` entry is STALE — either the oracle scans escaped regions after all, or the probe was` +
        ` edited and no longer means what the entry says.`);
  }

  return problems;
}

const work = mkdtempSync(join(tmpdir(), "lokalized-interpdiff-"));
// REMOVED ON `exit`, NOT IN A `finally`. A red run ends in `process.exit` inside this block, which
// skips `finally`, and until 2026-09-23 a `finally` after the block held the removal — so every RED
// run left its work directory in the system temp folder. The block is the old `try` body, kept as a
// block so its bindings stay scoped.
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
{
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

  /**
   * HOW THE PORT'S LENIENT NAME SET IS OBSERVED WITHOUT AN EXPORT MADE FOR THIS TOOL.
   *
   * `placeholderNamesInLeniently` is module-private in `src/internal/interpolate.js:427` and has
   * exactly ONE consumer: `interpolateFailureKey` iterates it to build the interpolation context,
   * one `lookup(name)` per name, in order, before it renders anything (`interpolate.js:467-468`,
   * the port of `DefaultStrings.java:1403-1411`). So a `Map` that records what it is asked for IS
   * that iteration, observed at the only place production code consumes it. Widening the module's
   * exports to let a differential see a private helper would put a name in `src/` that only this
   * tool needs, and would compare something no caller reaches.
   *
   * TWO PRECONDITIONS, both checked rather than assumed:
   *
   *   - the iteration must be complete. `interpolateFailureKey` wraps the whole body in
   *     `catch { return key; }` (`interpolate.js:457/471-473`, Java's `:1415-1417`), so a throw
   *     partway through would leave a truncated record. The recorded render is compared to Java's
   *     like any other row, so a truncated record shows up as a difference rather than as a shorter
   *     set that happens to agree;
   *   - the recorder must not change what is rendered. `lookupFor` takes the `Map` branch for a Map
   *     and the `Object.hasOwn` branch for a record (`interpolate.js:583-585`), so the recorded run
   *     and the plain-object run go down DIFFERENT branches of the lookup. They are both performed
   *     and compared per row below; `{{__proto__}}` and `{{constructor}}` are already in the probe
   *     set and are exactly where those two branches could part.
   */
  class RecordingContext extends Map {
    /** @param {[string, unknown][]} entries */
    constructor(entries) {
      super(entries);
      /** @type {string[]} the names `interpolateFailureKey` asked for, in the order it asked */
      this.asked = [];
    }

    /** @param {string} name */
    get(name) {
      this.asked.push(name);
      return super.get(name);
    }
  }

  /** Rows where the recording lookup rendered something the plain-object lookup did not. */
  const channelProblems = [];

  const recorder = recordingOracleRows(
    readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)));
  const javaRows = recorder.rows;
  const counts = { lenient: 0, isolate: 0, rtl: 0 };
  const differences = [];

  for (const row of javaRows) {
    let actual;
    try {
      if (row.section === "lenient") {
        const recording = new RecordingContext(Object.entries(context));
        const out = interpolateFailureKey(row.in, recording, false);
        const plain = interpolateFailureKey(row.in, context, false);
        if (out !== plain)
          channelProblems.push(`${JSON.stringify(row.in)}: recording lookup rendered` +
            ` ${JSON.stringify(out)}, record lookup rendered ${JSON.stringify(plain)}`);
        actual = { ok: true, out, names: recording.asked };
      } else if (row.section === "isolate") actual = { ok: true, out: isolate(row.in) };
      else actual = { ok: true, out: String(localeUsesRightToLeftScript(safeTag(row.in))) };
    } catch (error) {
      actual = { ok: false, error: error instanceof Error ? error.constructor.name : String(error) };
    }

    // A lenient row carries the name set as well, compared element-wise AND in order by the
    // whole-object `JSON.stringify` below — the key order here matches `actual` above so the two
    // serialisations line up. `isolate` and `rtl` rows keep their one-column shape.
    const wanted = row.ok
      ? row.section === "lenient"
        ? { ok: true, out: row.out, names: row.names }
        : { ok: true, out: row.out }
      : { ok: false, error: row.error };
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
  console.log(`  lenient escape grammar  ${counts.lenient}  (rendered output AND name set)`);
  console.log(`  BidiUtils.isolate       ${counts.isolate}`);
  console.log(`  RTL script detection    ${counts.rtl}`);
  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const d of differences.slice(0, 12))
      console.log(`\n  [${d.section}] ${JSON.stringify(d.input)}\n    java ${JSON.stringify(d.wanted)}\n    js   ${JSON.stringify(d.actual)}`);
  }

  // THE OBSERVATION CHANNEL'S OWN PRECONDITION. If this fires, `names` above describes a scan other
  // than the one whose output was compared, and the column means nothing until it is fixed.
  if (channelProblems.length) {
    console.log(`\nNAME-SET CHANNEL UNSOUND (${channelProblems.length}):`);
    for (const problem of channelProblems) console.log(`  ${problem}`);
  }

  // THE ORACLE'S OWN FIELDS, OBSERVED RATHER THAN ASSUMED — see tools/oracle-field-coverage.mjs.
  const fieldProblems = oracleFieldProblems("interpolate", recorder, UNCOMPARED_ORACLE_FIELDS);
  if (fieldProblems.length) {
    console.log(`\nORACLE FIELD COVERAGE (${fieldProblems.length}):`);
    for (const problem of fieldProblems) console.log(`  ${problem}`);
  }

  // CAN THIS PROBE SPACE STILL SEE A NAME-SET DEFECT? — see `ESCAPE_REGION_ONLY_NAMES`' docblock.
  const discriminationProblems = nameColumnProblems(javaRows);
  if (discriminationProblems.length) {
    console.log(`\nNAME SET NO LONGER DISCRIMINATED (${discriminationProblems.length}):`);
    for (const problem of discriminationProblems) console.log(`  ${problem}`);
  }

  // Every term is computed and PRINTED before any of them exits, so an ablation that reds the
  // comparison still reports whether the instrument's own checks held. The status is unchanged:
  // any one of the four fails the run.
  const failed = differences.length + channelProblems.length
    + fieldProblems.length + discriminationProblems.length;
  if (failed) process.exit(1);
}
