#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests `lokalized/parse` against the REAL Java loader.
 *
 * `ParseDiff.java` calls `LocalizedStringLoader.parse(InputStream, Locale, source, handler,
 * loadingOptions)` on the pinned JDK and emits the exact failure message, or the key set plus the
 * warnings the handler actually received, in order. Nothing on the Java side reinterprets the
 * grammar or the diagnostics, so a disagreement is a port defect.
 *
 * This exists because of what the corpus CANNOT check. Every one of its 118 `parse` fixtures carries
 * exactly one defect, so it pins which message a single-defect file produces and nothing about which
 * of SEVERAL a multi-defect file produces — and that choice is the whole of Java's parse ordering.
 * The M5a review found nine such disagreements with a corpus that was fully green, one of them a
 * warning Java delivered to the caller's handler that this port silently dropped. It also covers the
 * two diagnostics no fixture stresses: line/column after multi-byte characters, astral pairs and
 * escapes, and the 4096-character bound on the JSON diagnostic path.
 *
 *   node tools/parse-diff/run.mjs
 *
 * Exits 2 when the pinned JDK or the compiled Java classes are absent, so it can be skipped in an
 * environment that has neither; exits 1 on any disagreement.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const javaDir = process.env.LOKALIZED_JAVA_DIR
  ? resolve(process.env.LOKALIZED_JAVA_DIR)
  : resolve(root, "../lokalized-java");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const classes = join(javaDir, "target/classes");
if (!existsSync(classes)) {
  console.error(`lokalized-java classes not built at ${classes}\nset LOKALIZED_JAVA_DIR, or skip this differential`);
  process.exit(2);
}
if (spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" }).status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}

const encoder = new TextEncoder();
/** @type {{ name: string, locale: string, options: string, bytes: Uint8Array }[]} */
const cases = [];

/**
 * @param {string} name
 * @param {string} text
 * @param {{ locale?: string, options?: string }} [how]
 */
function add(name, text, how) {
  cases.push({
    name,
    locale: how?.locale ?? "en",
    options: how?.options ?? "",
    bytes: encoder.encode(text),
  });
}

/** @param {string} name @param {number[]} octets */
function addBytes(name, octets) {
  cases.push({ name, locale: "en", options: "", bytes: Uint8Array.from(octets) });
}

// --- 1. line and column, where a naive counter drifts --------------------------------------------
const BOM = "\ufeff";
add("lf-line3", '{\n  "a": "b",\n  ?\n}');
add("crlf-line3", '{\r\n  "a": "b",\r\n  ?\r\n}');
add("cr-only-line3", '{\r  "a": "b",\r  ?\r}');
add("lf-then-cr", "{\n\r  ?");
add("cr-after-lf", "{\n\r?");
add("trailing-comma", '{"a":"b",}');
add("eof-in-object", '{"a":');
add("eof-in-string", '{"a":"bc');
add("eof-in-nested-object", '{"a":{"b":');
add("truncated-literal", "nul");
add("literal-typo", '{"a":tru}');
add("leading-zero", '{"a":01}');
add("leading-plus", '{"a":+1}');
add("trailing-decimal-point", '{"a":1.}');
add("empty-exponent", '{"a":1e}');
add("minus-only", '{"a":-}');
add("bad-escape", '{"a":"\\x"}');
add("short-unicode-escape", '{"a":"\\u12"}');
add("bad-hex-digit", '{"a":"\\u12g4"}');
add("control-character-in-string", '{"a":"b\u0001c"}');
add("raw-tab-in-string", '{"a":"b\tc"}');
add("nbsp-document", "\u00a0");
add("nbsp-inside-object", "{\u00a0}");
// A column counted in UTF-8 bytes, or in code points rather than UTF-16 units, breaks on these.
add("column-after-two-byte", '{"\u00e9":?}');
add("column-after-three-byte", '{"\u65e5\u672c\u8a9e\u30c6\u30b9\u30c8":?}');
add("column-after-three-byte-line2", '{\n  "\u65e5\u672c\u8a9e": ?\n}');
add("column-after-astral", '{"\ud834\udd1e\ud834\udd1e":?}');
add("column-after-astral-run", '{"\ud834\udd1e\ud834\udd1e\ud834\udd1e\ud834\udd1e": ?}');
// A column counted over the DECODED string, rather than the source, breaks on these.
add("column-after-unicode-escapes", '{"\\u00e9\\u00e9":?}');
add("column-after-short-escapes", '{\n"\\n\\t\\\\":?}');
add("bad-escape-after-multibyte", '{"\u65e5\u672c": "a\u00e9\\q"}');
add("escaped-newline-does-not-advance-the-line", '{"a":"x\\ny","b":?}');

// --- 2. lone surrogates, reported at the character that opened the pair ---------------------------
add("lone-high-escape", '{"a":"\\ud83d"}');
add("lone-low-escape", '{"a":"\\udc00"}');
add("high-escape-then-text", '{"a":"x\\ud83dy"}');
add("paired-escape-is-valid", '{"a":"\\ud83d\\ude00"}');
add("lone-high-at-end-of-name", '{"ab\\ud83d":"x"}');
add("low-then-high", '{"a":"\\udc00\\ud800"}');
add("high-then-high", '{"a":"\\ud800\\ud800"}');
add("literal-astral-is-valid", '{"a":"\ud834\udd1e"}');
add("literal-high-escaped-low", '{"a":"\ud83d\\ude00"}');
add("escaped-high-literal-low", '{"a":"\\ud83d\ude00"}');

// --- 3. BOM, blankness and the top-level shape ----------------------------------------------------
add("one-bom-is-stripped", `${BOM}{"a":"b"}`);
add("two-boms-are-malformed", `${BOM}${BOM}{"a":"b"}`);
add("bom-only-is-blank", BOM);
add("bom-then-whitespace-is-blank", `${BOM}   \n`);
add("empty-is-blank", "");
add("json-whitespace-only-is-blank", " \t\r\n");
add("top-level-array", "[]");
add("top-level-number", "3");
add("top-level-string", '"x"');
add("top-level-null", "null");
add("top-level-true", "true");
add("trailing-garbage", '{"a":"b"} x');
add("trailing-garbage-line2", '{"a":"b"}\nx');

// --- 4. duplicates, and which layer owns each kind ------------------------------------------------
add("root-key-duplicate", '{"a":"x","a":"y"}');
add("nested-duplicate", '{"a":{"translation":"x","translation":"y"}}');
add("nested-duplicate-deep", '{"a":{"placeholders":{"p":{"value":"v","translations":{"CARDINALITY_ONE":"x","CARDINALITY_ONE":"y"}}},"translation":"t {p}"}}');
add("duplicate-in-array-element", '{"a":{"alternatives":[{"count == 0":{"translation":"x","translation":"y"}}],"translation":"t"}}');
add("duplicate-beats-later-structural-error", '{"a":{"translation":"x","translation":"y"},"b":3}');
add("earlier-structural-error-beats-duplicate", '{"a":3,"b":{"translation":"x","translation":"y"}}');
add("nested-duplicate-beats-root-duplicate", '{"a":{"translation":"x","translation":"y"},"a":"z"}');
add("array-index-in-the-path", '{"a":{"translation":"t","alternatives":[{"count == 0":{"translation":"p"}},{"count == 1":{"translation":"q","translation":"r"}}]}}');
add("null-array-element-still-counts-for-the-index", '{"a":{"translation":"t","alternatives":[null,{"count == 1":{"translation":"q","translation":"r"}}]}}');
add("duplicate-name-is-bounded-at-256", `{"a":{"${"n".repeat(400)}":1,"${"n".repeat(400)}":2}}`);
add("proto-is-an-ordinary-key", '{"__proto__":"x"}');
add("constructor-is-an-ordinary-key", '{"constructor":"x"}');
add("duplicate-proto-is-still-a-duplicate", '{"a":{"__proto__":"x","__proto__":"y","translation":"t"}}');

// --- 5. the bounded JSON diagnostic path ----------------------------------------------------------
/** @param {number} levels @param {number} length */
function chain(levels, length) {
  let inner = '{"z":1,"z":2}';
  for (let index = levels - 1; index >= 0; index--)
    inner = `{"${"k".repeat(length - String(index).length)}${index}":${inner}}`;
  return `{"root":${inner}}`;
}
// Straddling 4096: just under, exactly at, and well past. The last two must produce the same string.
add("path-just-under-the-bound", chain(40, 101), { options: "maximumJsonNestingDepth=128" });
add("path-exactly-at-the-bound", chain(40, 102), { options: "maximumJsonNestingDepth=128" });
add("path-well-past-the-bound", chain(80, 102), { options: "maximumJsonNestingDepth=128" });
add("path-one-name-longer-than-the-budget", `{"root":{"${"m".repeat(9000)}":{"z":1,"z":2}}}`, {
  options: "maximumJsonNestingDepth=128",
});
add(
  "path-through-array-indices",
  `{"root":${(() => {
    let inner = '{"z":1,"z":2}';
    for (let index = 0; index < 50; index++) inner = `{"${"k".repeat(80)}":[${inner}]}`;
    return inner;
  })()}}`,
  { options: "maximumJsonNestingDepth=128" },
);

// --- 6. nesting, counted over the raw text --------------------------------------------------------
add("nesting-past-the-default", `{"a":${"[".repeat(129)}1${"]".repeat(129)}}`);
add("nesting-at-the-default", `{"a":${"[".repeat(126)}1${"]".repeat(126)}}`);
add("too-deep-and-unparseable-reports-the-depth", "[".repeat(200) + "1");
add("braces-inside-a-string-do-not-nest", '{"a":"{{{{{{{{{{"}');
add("escaped-quote-does-not-end-the-string", '{"a":"x\\"{{{{{"}');

// --- 7. fatal UTF-8 -------------------------------------------------------------------------------
addBytes("utf8-invalid-ff", [0x7b, 0xff, 0x7d]);
addBytes("utf8-truncated-three-byte", [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe6, 0x97, 0x22, 0x7d]);
addBytes("utf8-overlong", [0x7b, 0xc0, 0xaf, 0x7d]);
addBytes("utf8-encoded-surrogate", [0x7b, 0xed, 0xa0, 0x80, 0x7d]);
addBytes("utf8-bom-bytes", [0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
addBytes("utf8-bare-continuation", [0x80]);

// --- 8. WHICH failure a resource with several reports ---------------------------------------------
// The corpus cannot reach any of these: each of its fixtures carries exactly one defect.
const warner = (key) =>
  `"${key}":{"translation":"x {{b}}","placeholders":{"b":{"value":"c","translations":` +
  `{"CARDINALITY_ONE":"1","CARDINALITY_OTHER":"o"}}}}`;
const badExpression = (key) => `"${key}":{"translation":"t","alternatives":[{"count ==":{"translation":"y"}}]}`;
const badStructure = (key) => `"${key}":3`;
const nestedDuplicate = (key) => `"${key}":{"translation":"x","translation":"y"}`;
const ru = { locale: "ru" };
const ruBudget = { locale: "ru", options: "maximumWarnings=0" };

add("warning-budget-beats-a-later-bad-expression", `{${warner("A")},${badExpression("B")}}`, ruBudget);
add("warning-budget-beats-a-later-structural-error", `{${warner("A")},${badStructure("B")}}`, ruBudget);
add("warning-budget-beats-a-later-duplicate", `{${warner("A")},${nestedDuplicate("B")}}`, ruBudget);
add("an-earlier-bad-expression-beats-the-budget", `{${badExpression("A")},${warner("B")}}`, ruBudget);
add("an-earlier-structural-error-beats-the-budget", `{${badStructure("A")},${warner("B")}}`, ruBudget);
add("an-earlier-duplicate-beats-the-budget", `{${nestedDuplicate("A")},${warner("B")}}`, ruBudget);
// The warning Java DELIVERED before the later key failed. A port that warns in a later pass drops it.
add("a-warning-survives-a-later-failure", `{${warner("A")},${badExpression("B")}}`, ru);
add("an-earlier-bad-expression-beats-a-later-structural-error", `{${badExpression("A")},${badStructure("B")}}`, ru);
add("an-earlier-structural-error-beats-a-later-bad-expression", `{${badStructure("A")},${badExpression("B")}}`, ru);
add("warning-budget-of-one-admits-one", `{${warner("A")},${warner("B")}}`, { locale: "ru", options: "maximumWarnings=1" });
add("warning-budget-of-two-admits-both", `{${warner("A")},${warner("B")}}`, { locale: "ru", options: "maximumWarnings=2" });
add("warnings-are-delivered-in-declaration-order", `{${warner("Zulu")},${warner("Alpha")}}`, ru);
// WITHIN one key: Java validates each alternative's expression before parsing that alternative.
add(
  "a-bad-expression-beats-a-later-alternative's-structure",
  '{"A":{"translation":"t","alternatives":[{"count ==":{"translation":"y"}},{"count == 1":3}]}}',
  ru,
);
add(
  "an-earlier-alternative's-structure-beats-a-later-bad-expression",
  '{"A":{"translation":"t","alternatives":[{"count == 1":3},{"count ==":{"translation":"y"}}]}}',
  ru,
);
add(
  "a-bad-fragment-expression-beats-a-later-alternative's-structure",
  '{"A":{"translation":"t {{f}}","placeholders":{"f":{"translation":"d","alternatives":[{"count ==":"r"}]}},"alternatives":[{"count == 1":3}]}}',
  ru,
);
add(
  "a-bad-fragment-expression-beats-a-bad-whole-message-expression",
  '{"A":{"translation":"t {{f}}","placeholders":{"f":{"translation":"d","alternatives":[{"count ==":"r"}]}},"alternatives":[{"bogus ==":{"translation":"y"}}]}}',
  ru,
);
add(
  "a-bad-expression-beats-a-malformed-reference-in-the-same-node",
  '{"A":{"translation":"t {{1bad}}","alternatives":[{"count ==":{"translation":"y"}}]}}',
  ru,
);
add(
  "a-nested-bad-expression-beats-a-later-sibling's-structure",
  '{"A":{"translation":"t","alternatives":[{"count == 1":{"translation":"y","alternatives":[{"count ==":{"translation":"z"}}]}},{"count == 2":3}]}}',
  ru,
);

// --- 9. which budget a resource that busts several reports -----------------------------------------
add("node-budget-beats-a-later-structural-error", `{"A":"plain",${badStructure("B")}}`, { options: "maximumTranslationNodes=1" });
add("node-budget-admits-exactly-its-limit", '{"A":"plain","B":"plain"}', { options: "maximumTranslationNodes=2" });
add("node-budget-refuses-one-over", '{"A":"plain","B":"plain"}', { options: "maximumTranslationNodes=1" });
add("node-budget-beats-a-bad-expression", `{${badExpression("A")}}`, { options: "maximumTranslationNodes=1" });
add("per-resource-bytes-beat-the-structure", `{${badStructure("A")}}`, { options: "maximumInputBytes=5" });
add("aggregate-bytes-beat-the-per-resource-limit", `{${badStructure("A")}}`, { options: "maximumInputBytes=5,maximumTotalInputBytes=3" });
add("aggregate-bytes-beat-the-structure", `{${badStructure("A")}}`, { options: "maximumTotalInputBytes=5" });
add("a-resource-exactly-at-the-byte-limit-loads", '{"A":"plain"}', { options: "maximumInputBytes=13" });

// --- 10. documents that must simply agree ---------------------------------------------------------
add("empty-object", "{}");
add("two-plain-keys", '{"a":"x","b":"y"}');
add("object-node", '{"a":{"translation":"t","commentary":"c"}}');
add("unicode-keys", '{"\u65e5\u672c":"x","\u00e9":"y","\ud834\udd1e":"z"}');

const work = mkdtempSync(join(tmpdir(), "lokalized-parsediff-"));
try {
  const inPath = join(work, "inputs.tsv");
  writeFileSync(
    inPath,
    `${cases
      .map((c) => `${c.name}\t${c.locale}\t${c.options}\t${Buffer.from(c.bytes).toString("base64")}`)
      .join("\n")}\n`,
    "utf8",
  );

  const classesOut = join(work, "classes");
  const compile = spawnSync(
    join(JDK, "bin/javac"),
    ["-cp", classes, "-d", classesOut, join(here, "ParseDiff.java")],
    { encoding: "utf8" },
  );
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);

  const oracle = spawnSync(
    join(JDK, "bin/java"),
    ["-cp", `${classes}:${classesOut}`, "ParseDiff", inPath],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (oracle.status !== 0) throw new Error(`oracle execution failed:\n${oracle.stderr}`);

  /** @type {Map<string, string>} */
  const java = new Map();
  for (const line of oracle.stdout.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    java.set(/** @type {string} */ (parts[0]), parts.slice(1).join("\t"));
  }

  const { parseStrings } = await import("../../src/parse/index.js");
  const { ordinalData } = await import("../../src/data/ordinal.js");

  let same = 0;
  /** @type {{ name: string, wanted: string, actual: string }[]} */
  const differences = [];

  for (const testCase of cases) {
    /** @type {Record<string, number>} */
    const limits = {};
    for (const option of testCase.options.split(",")) {
      if (!option) continue;
      const [name, value] = option.split("=");
      limits[/** @type {string} */ (name)] = Number(value);
    }

    /** @type {string[]} */
    const warnings = [];
    let actual;
    try {
      const parsed = parseStrings(testCase.bytes, {
        locale: testCase.locale,
        source: testCase.name,
        ...(Object.keys(limits).length ? { limits } : {}),
        // Java's loader has `Ordinality` on its classpath unconditionally; the JS parser cannot
        // import the table, so the runner supplies it or every ordinality warning would be missing.
        pluralData: { ordinal: ordinalData },
        onWarning: (warning) => warnings.push(warning.message),
      });
      actual = `OK\t${parsed.strings.map((s) => s.key).sort().join(",")}`;
    } catch (error) {
      actual = `ERR\t${error instanceof Error ? error.message : String(error)}`;
    }
    actual = `${actual.replace(/\n/g, "\\n")}\tW[${warnings.join(" | ").replace(/\n/g, "\\n")}]`;

    const wanted = java.get(testCase.name) ?? "<the oracle produced no row>";
    if (actual === wanted) same++;
    else differences.push({ name: testCase.name, wanted, actual });
  }

  console.log(`parse differential against Java on the pinned JDK: ${same}/${cases.length} identical`);

  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const difference of differences.slice(0, 12))
      console.log(`\n  ${difference.name}\n    java ${difference.wanted}\n    js   ${difference.actual}`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
