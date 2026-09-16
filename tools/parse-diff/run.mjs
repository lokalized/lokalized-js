#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests `lokalized/parse` against the REAL Java loader.
 *
 * `ParseDiff.java` calls `LocalizedStringLoader.parse(InputStream, Locale, source, handler,
 * loadingOptions)` on the pinned JDK and emits the exact failure message AND the exception's class,
 * or the key set and the DECODED CONTENT of every parsed node, plus the warnings the handler
 * actually received, in order. Nothing on the Java side reinterprets the grammar or the diagnostics,
 * so a disagreement is a port defect.
 *
 * TWO of those five columns are new, and both closed a hole the rest of this project could not see.
 * They are described at their comparison sites — search `THE DECODED CONTENT` and `THE REFUSAL
 * CLASS` below — because a header is the wrong place for a claim a reader must be able to check
 * against the code that makes it.
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
 * environment that has neither. Exits 1 on any disagreement, on an UNMAPPED Java refusal class, on
 * a STALE class mapping no probe reaches, and on a DEGENERATE probe set — the last three because a
 * comparison that cannot fail is the thing this file exists to avoid becoming. An oracle row whose
 * shape this runner does not unpack throws, so that too leaves with a non-zero status (measured:
 * exit 1, naming the column count) rather than being quietly ignored.
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
/** @type {{ name: string, locale: string, options: string, bytes: Uint8Array, text?: string }[]} */
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
    // Retained only so the degenerate-set gate at the bottom can ask whether any probe that Java
    // ACCEPTS spells a `\u` escape. That question is about the source text, not about the bytes.
    text,
  });
}

/** @param {string} name @param {number[]} octets */
function addBytes(name, octets) {
  cases.push({ name, locale: "en", options: "", bytes: Uint8Array.from(octets) });
}

/**
 * Escape a rendered value for the row format, exactly as `ParseDiff.escape` does. The backslash goes
 * first so an escaped newline in the source cannot render as a real one, and the tab matters because
 * `raw-tab-in-string` below proves one can reach a string — an unescaped tab would invent a column.
 *
 * @param {string} value
 */
function escape(value) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

/** @param {string | undefined} value absent renders as a bare `-`, so a value that IS "-" differs. */
function optional(value) {
  return value === undefined ? "-" : `<${escape(value)}>`;
}

/**
 * The decoded content of one parsed node, in `ParseDiff.project`'s rendering.
 *
 * Java's alternative is a `LocalizedString` whose KEY is the expression where the port's carries an
 * `expression` field, which is why the label is passed in rather than read off the node.
 *
 * @param {string} label
 * @param {{ translation?: string, commentary?: string,
 *   placeholders?: Readonly<Record<string, any>>, alternatives?: readonly any[] }} node
 */
function project(label, node) {
  const placeholders = Object.entries(node.placeholders ?? {}).map(
    ([name, definition]) => `${escape(name)}=${projectPlaceholder(definition)}`,
  );
  const alternatives = (node.alternatives ?? []).map((alternative) =>
    project(alternative.expression, alternative),
  );
  return (
    `{${escape(label)} T=${optional(node.translation)} C=${optional(node.commentary)}` +
    ` P=[${placeholders.join(",")}] A=[${alternatives.join(",")}]}`
  );
}

/** @param {any} definition one generated-placeholder definition, tagged by its `kind`. */
function projectPlaceholder(definition) {
  if (definition.kind === "language-form") {
    const range = definition.range
      ? `<${escape(definition.range.start)}>..<${escape(definition.range.end)}>`
      : "-";
    const translations = Object.entries(definition.translations).map(
      ([form, translation]) => `${escape(form)}=<${escape(/** @type {string} */ (translation))}>`,
    );
    return `LF{V=${optional(definition.value)} R=${range} T=[${translations.join(",")}]}`;
  }
  if (definition.kind === "expression") {
    const alternatives = (definition.alternatives ?? []).map(
      (/** @type {{ expression: string, translation: string }} */ alternative) =>
        `<${escape(alternative.expression)}>=><${escape(alternative.translation)}>`,
    );
    return `EX{T=<${escape(definition.translation)}> A=[${alternatives.join(",")}]}`;
  }
  throw new Error(`unhandled placeholder definition kind: ${String(definition.kind)}`);
}

/**
 * Java's refusal class, mapped to the JS name the port raises for it.
 *
 * COMPARED AS A MAPPING, NOT ROW-AGAINST-ROW, on `diff:language-range`'s precedent: an equality
 * check between a Java class name and a JS one can never hold, and the project's standing rule is
 * Java's SHAPE with the JS name. The Java half of each pair is asserted too — a class this table
 * does not name reaches `UNMAPPED JAVA REFUSAL CLASSES` and fails the run rather than being waved
 * through, and a pair NO probe reaches is reported STALE, so the table cannot outlive the refusals
 * that justify it.
 *
 * ONE ENTRY, and that is a measurement rather than an economy: across the 101 probes Java refuses
 * here it raises `LocalizedStringLoadingException` every time, so a row-against-row equality on the
 * Java class alone would discriminate nothing. The discrimination is entirely on the JS side of the
 * pair, which is why the port's `constructor.name` is what the comparison reads.
 */
const JS_CLASS_FOR_JAVA = {
  "com.lokalized.LocalizedStringLoadingException": "StringsParseError",
};

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

// --- 11. the DECODED content, which a key set cannot see ------------------------------------------
// These exist for the `V[...]` column and nothing else: every one of them PARSES, so the key column
// and the message column agree trivially and only the content can tell the two sides apart.
//
// `paired-escape-is-valid` and `literal-astral-is-valid` in section 2 become load-bearing here for
// the first time: both parse to the single key `a` and differ from each other only in the value
// behind it, so before this column they asserted nothing beyond "neither refuses".
add("value-literal-bmp-widths", '{"a":"A\u00e9\u65e5"}');
add("value-escaped-bmp-widths", '{"a":"\\u0041\\u00e9\\u65e5"}');
add("value-escaped-astral-pair", '{"a":"\\ud83d\\ude00\\ud834\\udd1e"}');
add("value-short-escapes", '{"a":"x\\ny\\tz\\rw\\b\\f"}');
add("value-escaped-backslash", '{"a":"\\\\"}');
add("value-escaped-quote-and-solidus", '{"a":"\\"\\/"}');
add("value-renderer-metacharacters", '{"a":"},=<>[]| -"}');
add("value-is-a-bare-dash", '{"a":"-"}');
add("value-empty-string", '{"a":""}');
add("key-carries-escapes-too", '{"\\u00e9\\ud83d\\ude00":"v"}');
add("commentary-survives", '{"a":{"translation":"t\\u00e9","commentary":"c\\ud83d\\ude00"}}');
add("translation-absent-commentary-present", '{"a":{"commentary":"c only"}}');

// Both placeholder families, their optional members, and the DECLARATION ORDER of each map.
/** @param {string} translations */
const lf = (translations) =>
  `{"a":{"translation":"t {{p}}","placeholders":{"p":{"value":"v","translations":${translations}}}}}`;
add("language-form-placeholder", lf('{"CARDINALITY_ONE":"one \u00e9","CARDINALITY_OTHER":"other"}'));
add("language-form-translations-declaration-order", lf('{"CARDINALITY_OTHER":"other","CARDINALITY_ONE":"one"}'));
add(
  "language-form-placeholder-gender",
  '{"a":{"translation":"t {{p}}","placeholders":{"p":{"value":"v","translations":{"GENDER_MASCULINE":"m","GENDER_FEMININE":"f"}}}}}',
);
add(
  "range-placeholder",
  '{"a":{"translation":"t {{p}}","placeholders":{"p":{"range":{"start":"lo","end":"hi"},"translations":{"CARDINALITY_ONE":"one","CARDINALITY_OTHER":"other"}}}}}',
);
add(
  "expression-placeholder-with-alternatives",
  '{"a":{"translation":"t {{p}}","placeholders":{"p":{"translation":"d","alternatives":[{"x == 1":"f1"},{"x == 2":"f2"}]}}}}',
);
add(
  "expression-placeholder-translation-only",
  '{"a":{"translation":"t {{p}}","placeholders":{"p":{"translation":"d"}}}}',
);
add(
  "placeholder-declaration-order",
  '{"a":{"translation":"t {{z}} {{b}}","placeholders":{"z":{"translation":"dz"},"b":{"translation":"db"}}}}',
);
add(
  "whole-message-alternatives",
  '{"a":{"translation":"t","alternatives":[{"x == 0":{"translation":"zero","commentary":"cz"}},{"x == 1":{"translation":"one"}}]}}',
);
add(
  "nested-whole-message-alternatives",
  '{"a":{"translation":"t","alternatives":[{"x == 0":{"translation":"zero","alternatives":[{"y == 0":{"translation":"deep"}}]}}]}}',
);
add(
  "alternative-carrying-its-own-placeholder",
  '{"a":{"translation":"t","alternatives":[{"x == 0":{"translation":"zero {{q}}","placeholders":{"q":{"translation":"dq"}}}}]}}',
);

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
    // `com.lokalized.ParseDiff`, not `ParseDiff`: the harness sits in the library's own package so
    // that the language-form names it prints come from `LocalizedStringUtils`, which is
    // package-private, rather than from a prefix table re-typed on the Java side.
    ["-cp", `${classes}:${classesOut}`, "com.lokalized.ParseDiff", inPath],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (oracle.status !== 0) throw new Error(`oracle execution failed:\n${oracle.stderr}`);

  /** @type {Map<string, { outcome: string, payload: string, errorClass: string, values: string, warnings: string }>} */
  const java = new Map();
  for (const line of oracle.stdout.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    // A POSITIONAL row has no named fields, so `tools/oracle-field-coverage.mjs` cannot observe
    // which of them a comparison reads — its premise is a named oracle field, and wiring it here
    // would be a green check over nothing, which is the failure it exists to prevent. The
    // instrument a positional row CAN carry is a pinned COLUMN COUNT: a column added on the Java
    // side and never unpacked here fails loudly instead of being silently ignored, which is
    // precisely how the `V[...]` and `X[...]` values below could have been emitted and dropped.
    // Six: <name> <OK|ERR> <keys|message> <X[class]> <V[content]> <W[warnings]>.
    if (parts.length !== 6)
      throw new Error(
        `the oracle emitted ${parts.length} columns, not the 6 this comparison unpacks: ${line}`,
      );
    const [name, outcome, payload, errorColumn, values, warnings] = /** @type {string[]} */ (parts);
    java.set(name, {
      outcome,
      payload,
      errorClass: errorColumn.slice(2, -1),
      values,
      warnings,
    });
  }

  const { parseStrings } = await import("../../src/parse/index.js");
  const { ordinalData } = await import("../../src/data/ordinal.js");

  let same = 0;
  /** @type {{ name: string, wanted: string, actual: string }[]} */
  const differences = [];
  /** @type {{ name: string, javaClass: string }[]} */
  const unmapped = [];
  /** @type {Set<string>} */
  const reachedJavaClasses = new Set();

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
    let outcome;
    let payload;
    let errorClass;
    let values;
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
      outcome = "OK";
      payload = parsed.strings.map((s) => escape(s.key)).sort().join(",");
      errorClass = "-";
      // THE DECODED CONTENT, WHICH THE KEY SET CANNOT SEE. `V[...]` rebuilds, independently on each
      // side, what every parsed node actually holds: `getTranslation()`, `getCommentary()`, both
      // placeholder families (tagged LF/EX, with value/range/translations-by-language-form and the
      // expression alternatives) and `getAlternatives()`, recursively, keyed by the alternative's
      // expression. Before it, this tool compared a SORTED LIST OF KEYS and a failure message, so
      // every question of the form "what did the parser decode into that key?" was unasked here.
      //
      // WHY IT WAS WORTH EMITTING: nothing else in the project asks it either. Measured
      // 2026-09-15 — of the 584 files under `lokalized-spec/fixtures`, exactly ONE contains a
      // `\uXXXX` escape (`loader-smoke-lone-surrogate.json`), and its recorded expectation is
      // `failed: true`. So `src/internal/json-parse.js`'s escape decoder and surrogate-pair
      // assembly had its OUTPUT observed by no corpus case at all — only its REFUSAL was.
      //
      // ABLATION A — the escape decoder, measured 2026-09-15. `readEscape`'s `\u` arm in
      // `src/internal/json-parse.js` gains `escaped = escaped & 0xff;`, which corrupts every code
      // point above U+00FF while leaving the parser's control flow intact:
      //   improved tool  exit 1, 123/136 identical, DIFFERENCES (13)
      //   pristine tool  exit 1, 106/114 identical, DIFFERENCES (8)
      //   conformance    exit 1, 2,116 passed, 1 FAILED
      // FOUR of those thirteen rows are caught ONLY by this column, with the outcome, key/message,
      // class and warning columns BYTE-IDENTICAL on both sides: `paired-escape-is-valid` (a
      // PRE-EXISTING probe from section 2), `value-escaped-bmp-widths`, `value-escaped-astral-pair`
      // and `commentary-survives`. The pristine tool sees the other rows only because a corrupted
      // escape happens to derail a diagnostic elsewhere, which is luck, not coverage — and the
      // corpus, with 2,363 cases, catches exactly ONE.
      //
      // ABLATION B — CONTENT-ONLY, so the key column and the message column CANNOT move. In
      // `src/internal/parse-file.js`'s `projectNode`, `...(node.commentary === null ? {} :
      // { commentary: node.commentary })` becomes `...(true ? {} : ...)`, i.e. a port that silently
      // drops commentary from EVERY node it projects:
      //   improved tool  exit 1, 133/136 identical, DIFFERENCES (3) — `object-node`,
      //                  `commentary-survives`, `whole-message-alternatives`
      //   pristine tool  exit 0, 114/114 identical — TOTALLY BLIND
      //   conformance    exit 0, 2,117 passed, 0 FAILED, report BYTE-IDENTICAL to the baseline
      // `object-node` is a PRE-EXISTING probe from section 10, which is what shows the column is
      // load-bearing over the old fixture set and not only over the ones added with it.
      values = `V[${parsed.strings.map((s) => project(s.key, s)).sort().join(",")}]`;
    } catch (error) {
      outcome = "ERR";
      payload = escape(error instanceof Error ? error.message : String(error));
      // THE REFUSAL CLASS, WHICH THIS HARNESS THREW AWAY. `ParseDiff.java` caught `Exception e` and
      // emitted `e.getMessage()` alone, so for every refusing probe the two sides agreed on the
      // sentence and nothing compared WHAT WAS RAISED. That is the exact shape S31 found in
      // `diff:language-range` — an oracle that had the class and a runner that never read it — and
      // it is worse here, because this harness did not even emit it: `grep -c getClass ParseDiff.java`
      // answered 0. Both halves are new, the emission and the comparison.
      //
      // The pair is compared through `JS_CLASS_FOR_JAVA` above rather than for equality, and its
      // Java side is asserted: an unmapped class is reported and fails the run, and a mapping no
      // probe reaches is reported STALE.
      //
      // ABLATION C — `StringsParseError.raise` in `src/internal/parse-diagnostics.js` returns
      // `new RangeError(message)`, so every refusal keeps its sentence and loses its identity:
      //   improved tool  exit 1, 35/136 identical, DIFFERENCES (101) — X[...] is the ONLY column
      //                  that moves on any of them
      //   pristine tool  exit 0, 114/114 identical
      //   conformance    exit 1, 1,951 passed, 166 FAILED
      // So the corpus DOES see that one, through the instance's `name` string, and saying otherwise
      // would overclaim. It was unguarded HERE, in the instrument whose subject it is.
      //
      // ABLATION C2 is the version nothing else can see, and it is S34's exact shape — the class
      // BINDING renamed while `this.name = "StringsParseError"` is left behind, so the failure can
      // still be matched by string and by nothing else:
      //   improved tool  exit 1, 35/136 identical, DIFFERENCES (101), again X[...] alone
      //   pristine tool  exit 0, 114/114 identical — BLIND
      //   conformance    exit 0, 2,117 passed, 0 FAILED, report BYTE-IDENTICAL to the baseline
      // `error.constructor.name`, not `error.name`, is what makes C2 visible: the two are the same
      // string on a healthy class and come apart on exactly the defect this project has now fixed
      // three times (`ConfigurationError`, `DigestUnavailableError`, `StringsLoadingError`).
      errorClass = error instanceof Error ? error.constructor.name : "not an Error";
      // Java produced nothing, so there is no content to project.
      values = "V[]";
    }

    const row = java.get(testCase.name);
    if (row === undefined) {
      differences.push({
        name: testCase.name,
        wanted: "<the oracle produced no row>",
        actual: `${outcome}\t${payload}\tX[${errorClass}]\t${values}\tW[${escape(warnings.join(" | "))}]`,
      });
      continue;
    }

    let wantedClass;
    if (row.outcome === "OK") {
      wantedClass = "-";
    } else {
      wantedClass = JS_CLASS_FOR_JAVA[row.errorClass];
      if (wantedClass === undefined) {
        // Never waved through: an unmapped Java class is its own exit term, not a silent pass and
        // not a row buried among the message diffs.
        unmapped.push({ name: testCase.name, javaClass: row.errorClass });
        continue;
      }
      reachedJavaClasses.add(row.errorClass);
    }

    const actual = `${outcome}\t${payload}\tX[${errorClass}]\t${values}\tW[${escape(warnings.join(" | "))}]`;
    const wanted = `${row.outcome}\t${row.payload}\tX[${wantedClass}]\t${row.values}\t${row.warnings}`;
    if (actual === wanted) same++;
    else differences.push({ name: testCase.name, wanted, actual });
  }

  /**
   * A probe set that never sees two different answers has established nothing.
   *
   * Both new columns are only as good as the inputs that reach them, and each is structurally
   * narrow in a way worth stating rather than leaving to be discovered: `V[...]` is `V[]` on every
   * probe Java REFUSES, so it discriminates over the accepted ones alone; `X[...]` is `-` on every
   * probe Java ACCEPTS, so it discriminates over the refusing ones alone. Each arm of this gate
   * fires when the input that makes some part of that discrimination possible disappears from the
   * probe set — the `Zzzz` lesson made structural, since covering a rendering arm is not
   * discriminating the input that chooses it.
   */
  const observed = cases.map((c) => ({ testCase: c, row: java.get(c.name) })).filter((o) => o.row);
  const accepted = observed.filter((o) => /** @type {any} */ (o.row).outcome === "OK");
  const refused = observed.filter((o) => /** @type {any} */ (o.row).outcome === "ERR");
  const content = accepted.map((o) => /** @type {any} */ (o.row).values).join("");

  /** @type {string[]} */
  const degenerate = [];
  if (!accepted.length) degenerate.push("no probe is ACCEPTED, so V[...] is empty on every row");
  if (!refused.length) degenerate.push("no probe is REFUSED, so X[...] is `-` on every row");
  if (!accepted.some((o) => (o.testCase.text ?? "").includes("\\u")))
    degenerate.push("no ACCEPTED probe spells a `\\u` escape — the decoder's OUTPUT is unobserved, " +
      "which is the hole this column was built to close");
  if (!content.includes("C=<")) degenerate.push("no accepted probe carries a COMMENTARY");
  if (!content.includes("LF{")) degenerate.push("no accepted probe carries a LANGUAGE-FORM placeholder");
  if (!content.includes("EX{")) degenerate.push("no accepted probe carries an EXPRESSION placeholder");
  if (!content.includes(">..<")) degenerate.push("no accepted probe carries a placeholder RANGE");
  if (!content.includes("A=[{")) degenerate.push("no accepted probe carries a whole-message ALTERNATIVE");
  // Nesting is derived rather than scanned. The rendering CANNOT be parsed structurally — a decoded
  // value may itself contain brackets and braces, which `value-renderer-metacharacters` exists to
  // prove travels — so this counts non-empty alternatives lists in a row holding exactly ONE key,
  // where two of them can only mean one inside the other. A key containing a comma would drop its
  // row from the count, which fails toward reporting degeneracy rather than away from it.
  if (!accepted.some((o) => {
    const row = /** @type {any} */ (o.row);
    return !row.payload.includes(",") && row.values.split("A=[{").length - 1 >= 2;
  }))
    degenerate.push("no accepted probe carries a NESTED alternative — the recursion is unexercised");

  /** @type {string[]} */
  const stale = Object.keys(JS_CLASS_FOR_JAVA).filter((javaClass) => !reachedJavaClasses.has(javaClass));

  console.log(`parse differential against Java on the pinned JDK: ${same}/${cases.length} identical`);
  console.log(`  ${accepted.length} accepted (compared by decoded content), ` +
    `${refused.length} refused (compared by message AND class)`);

  if (unmapped.length) {
    console.log(`\nUNMAPPED JAVA REFUSAL CLASSES (${unmapped.length}) — declare a counterpart or fix the probe:`);
    for (const row of unmapped) console.log(`  ${row.name}: ${row.javaClass}`);
  }

  if (stale.length) {
    console.log(`\nSTALE CLASS MAPPINGS (${stale.length}) — no probe raises these, so the pair is unasserted:`);
    for (const javaClass of stale) console.log(`  ${javaClass} -> ${JS_CLASS_FOR_JAVA[javaClass]}`);
  }

  if (degenerate.length) {
    console.log(`\nDEGENERATE PROBE SET (${degenerate.length}) — the comparison cannot mean what it claims:`);
    for (const reason of degenerate) console.log(`  ${reason}`);
  }

  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const difference of differences.slice(0, 12))
      console.log(`\n  ${difference.name}\n    java ${difference.wanted}\n    js   ${difference.actual}`);
  }

  if (differences.length || unmapped.length || stale.length || degenerate.length) process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
