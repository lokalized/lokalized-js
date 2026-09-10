#!/usr/bin/env node
// @ts-check
/**
 * The EIGHTH differential: every consumer of the pinned CLDR likely-subtag table, against the real
 * `lokalized-java` on the pinned JDK.
 *
 *   node tools/likely-subtag-diff/run.mjs
 *
 * WHY THIS EXISTS. M7's acceptance row requires "complete likely-subtag consumers", and the
 * close-out audit could not mark it proven for a reason worth quoting exactly: the table is verified
 * complete and lossless (`tools/gen-data.js --check`) and every consumer behaves under the corpus,
 * but no consumer INVENTORY existed and no differential covered the consumer surface, so "complete"
 * was unproven rather than false. `tools/likely-subtag-consumers.mjs` supplies the inventory and
 * gates it against the source each run; this tool supplies the measurement.
 *
 * WHAT IT COMPARES, and why it is five fields rather than one. `lokalized-java` reads
 * `CldrLocaleData.LIKELY_SUBTAGS_BY_TAG` at exactly two sites and the port reads its own table at
 * exactly two — `likelySubtagFor` and `preferredRegionAlias` on both sides. But a differential over
 * `likelySubtagFor` alone would prove only that the two tables are the same bytes; what M7's clause
 * is about is what the LIBRARY does with the answer. So each observable consumer decision is its own
 * column, and a divergence names the consumer:
 *
 *   likelySubtag    `CldrLocaleData.likelySubtagFor`            — the maximization itself
 *   languageScript  `…languageScriptForLikelySubtag`            — the `language-Script` pair the matcher compares
 *   canonicalTag    `…canonicalLanguageTag`                     — reaches the SECOND table read, `preferredRegionAlias`
 *   fallbackChain   `…fallbackLocalesFor`                       — truncation stopped at a likely-script boundary
 *   rightToLeft     `BidiUtils.localeUsesRightToLeftScript`     — script maximization for bidi isolation
 *
 * THE SECOND TABLE READ IS THE ONE NOBODY HAD WRITTEN DOWN, and it is only observable through
 * `canonicalLanguageTag`: a deprecated region subtag with more than one CLDR replacement (there are
 * 23) resolves to the replacement whose likely subtag matches, not to the first. Section (5) of the
 * probe space is generated so that every one of those 23 aliases is crossed with a language whose
 * likely region is EACH of its targets — which is how `hy-SU` -> `hy-AM` (target 2 of 15),
 * `et-SU` -> `et-EE` (target 5) and `mh-PC` -> `mh-MH` (target 2 of 4) get probed rather than only
 * the degenerate `ru-SU` -> `ru-RU`, where first-target-wins and likely-subtag-wins agree and a
 * probe space made of those alone would confirm nothing.
 *
 * IT IS NOT PART OF `npm run verify`, for the reason its seven siblings are not: `verify` has to run
 * in a checkout with no pinned Corretto 21 and no built `lokalized-java`, and a gate that silently
 * passes when its oracle is missing has stopped gating. A green `verify` says nothing about this
 * tool and it must be named separately. The INVENTORY gate — which needs only `src/` — is the half
 * that lives in `verify`.
 *
 * TWO VERDICTS, kept apart the way `tools/direct-tag-diff/` keeps them apart:
 *
 *   WELL-FORMED (the clause). Every field must agree exactly, on both sides.
 *   ILL-FORMED. The three string-in/string-out consumers still must agree exactly — the port takes
 *     the same raw string Java does and there is no decided divergence for them, so this is free
 *     discrimination and it is gated. The two `Locale`-taking consumers reach the table only through
 *     `normalizeTag`, which REFUSES an ill-formed tag by the decision `tools/direct-tag-diff/`'s
 *     `ILL_FORMED_CONTRACT` records; the port must refuse, and an ill-formed tag it ANSWERS fails
 *     the run. Refusing and answering are both gated, so this bucket cannot rot into leniency.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const specDir = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR)
  : resolve(root, "../lokalized-spec");
const javaDir = process.env.LOKALIZED_JAVA_DIR
  ? resolve(process.env.LOKALIZED_JAVA_DIR)
  : resolve(root, "../lokalized-java");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";
const CLASSES = process.env.LOKALIZED_JAVA_CLASSES ?? join(javaDir, "target/classes");

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}
if (!existsSync(join(CLASSES, "com/lokalized/CldrLocaleData.class"))) {
  console.error(
    `compiled lokalized-java classes not found at ${CLASSES}\n` +
      "`CldrLocaleData` and `BidiUtils` are package-private, so the probe must be compiled against " +
      "the real class files; set LOKALIZED_JAVA_CLASSES, or build lokalized-java, or skip this differential",
  );
  process.exit(2);
}

/**
 * THE JAVA-SIDE INVENTORY, asserted rather than assumed.
 *
 * The port's inventory gate (`tools/likely-subtag-consumers.mjs`) derives the JS side from `src/`
 * every run. This is the other half: if `lokalized-java` ever grows a THIRD read of
 * `LIKELY_SUBTAGS_BY_TAG`, or moves one of the two, this tool's column list stops being the consumer
 * surface and every "agrees" below becomes a statement about a smaller surface than the one that
 * exists. A count alone would not catch a MOVE, so the enclosing method is checked too.
 *
 * ONE LIMIT OF THIS GUARD, stated because it is invisible from the assertion itself: it reads the
 * Java SOURCE (`src/main/java/com/lokalized/CldrLocaleData.java`) while the oracle below compiles
 * and runs against `target/classes`. A stale `target/classes` would therefore satisfy this
 * assertion while every comparison ran against different bytecode. Harmless while the reference
 * implementation is pinned at 3.0.0 and rebuilt from that source — which is the project's standing
 * arrangement — but it is an assumption, not something this file checks.
 */
function assertJavaTableReads() {
  const file = join(javaDir, "src/main/java/com/lokalized/CldrLocaleData.java");
  if (!existsSync(file)) {
    console.error(
      `lokalized-java source not found at ${file}\n` +
        "this tool asserts the JAVA-side table-read inventory from it; set LOKALIZED_JAVA_DIR",
    );
    process.exit(2);
  }
  const lines = readFileSync(file, "utf8").split("\n");
  /** @type {string[]} */
  const reads = [];
  let method = "<file scope>";
  for (const [index, line] of lines.entries()) {
    const declaration = /^\s{2}(?:@\w+\s+)*(?:private\s+|public\s+|protected\s+)?static\s.*?\b(\w+)\s*\(/.exec(line);
    if (declaration) method = declaration[1] ?? method;
    if (line.includes("LIKELY_SUBTAGS_BY_TAG.get")) reads.push(`${method}:${index + 1}`);
  }
  const expected = ["likelySubtagFor:189", "preferredRegionAlias:358"];
  if (reads.join(" ") !== expected.join(" ")) {
    console.error(
      "FAILED: the JAVA-side likely-subtag table-read inventory moved.\n" +
        `  expected: ${expected.join(", ")}\n` +
        `  found:    ${reads.join(", ") || "(none)"}\n` +
        "Every column this differential compares was chosen to reach those two reads. Re-derive the " +
        "columns, update `expected` here, and update tools/likely-subtag-consumers.mjs's JAVA_MIRROR.",
    );
    process.exit(2);
  }
  return reads;
}

/**
 * The probe space.
 *
 * Section (1) is the overlap with the corpus — a divergence there and a conformance FAILED are the
 * same defect seen twice. (2) and (3) are the table's own key and value spaces, which is the one
 * exhaustive axis available here and which no other tool sweeps. Everything after is a shape the
 * corpus cannot reach.
 */
function inputs() {
  /** @type {Set<string>} */
  const set = new Set();

  /** @type {{from: string, to: string}[]} */
  const likelySubtags = /** @type {any} */ (likelyTable);
  /** @type {{from: string, to: string}[]} */
  const regionAliases = /** @type {any} */ (regionAliasTable);

  // (1) Every locale tag the corpus actually spells.
  const corpusPath = join(specDir, "generated/behavioral-vectors.json");
  if (existsSync(corpusPath)) {
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
    for (const fixture of Object.values(corpus.fixtures)) {
      for (const tag of Object.keys(/** @type {any} */ (fixture).files ?? {})) set.add(tag);
      for (const tag of Object.keys(/** @type {any} */ (fixture).rawFiles ?? {})) set.add(tag);
      for (const tag of [/** @type {any} */ (fixture).fallbackLocale, /** @type {any} */ (fixture).instanceLocale])
        if (typeof tag === "string") set.add(tag);
    }
    for (const testCase of corpus.cases)
      for (const field of ["locale", "lookupLocale"])
        if (typeof testCase.input?.[field] === "string") set.add(testCase.input[field]);
  }

  // (2) EVERY KEY OF THE TABLE and (3) every value. 3,894 entries, so this axis is exhaustive: a
  // single wrong row anywhere in the generated data is a divergence here. `gen-data --check` already
  // proves the JS table reproduces the Java table entry for entry; this proves the two LOOKUPS agree,
  // which is a different claim — key normalization, candidate order and the maximization merge all
  // sit between the row and the answer.
  for (const { from, to } of likelySubtags) {
    set.add(from);
    set.add(to);
  }

  // (4) THE CANDIDATE LADDER. `likelySubtagCandidateTags` tries seven shapes in a fixed order, and a
  // port that built the ladder in a different order would still answer correctly for every tag that
  // hits on the first rung. These cross language x script x region so that later rungs decide.
  const languages = ["en", "fr", "de", "zh", "ar", "he", "iw", "yi", "ji", "no", "nb", "nn", "sr",
    "sh", "az", "uz", "mn", "pa", "ku", "sd", "ha", "und", "qaa", "tlh", "cmn", "yue", "nan", "mo",
    "tl", "fil", "in", "id", "jv", "ms", "bs", "hr", "sl", "mk", "hy", "et", "ka", "lv", "lt", "uk"];
  const scripts = ["Latn", "Cyrl", "Arab", "Hans", "Hant", "Hebr", "Armn", "Geor", "Mong", "Deva",
    "Qaaa", "Zzzz"];
  const regions = ["US", "GB", "CN", "TW", "IL", "EG", "RS", "ME", "419", "001", "ZZ", "QM"];
  for (const language of languages) {
    set.add(language);
    for (const script of scripts) {
      set.add(`${language}-${script}`);
      for (const region of regions) {
        set.add(`${language}-${script}-${region}`);
        set.add(`und-${script}-${region}`);
      }
    }
    for (const region of regions) set.add(`${language}-${region}`);
  }

  // (5) THE SECOND TABLE READ — `preferredRegionAlias`, generated to be DISCRIMINATING.
  //
  // Its only observable effect is choosing among a deprecated region's replacements, and it fires
  // only when there is more than one. `ru-SU` is the degenerate probe: SU's first replacement is
  // `RU` and `ru`'s likely region is also `RU`, so first-wins and likely-wins agree and the probe
  // proves nothing. So for every multi-target alias, and for EVERY target of it, this finds
  // languages whose likely region is that target and probes them — `hy-SU` (target 2 of 15),
  // `et-SU` (target 5), `ka-SU` (target 6), `mh-PC` (target 2 of 4). Built from the TABLE DATA, not
  // by calling the port's own resolver, so the probe space cannot inherit a port defect.
  /** @type {Map<string, string[]>} */
  const languagesByLikelyRegion = new Map();
  for (const { from, to } of likelySubtags) {
    if (from.includes("-")) continue;
    const region = to.split("-")[2] ?? "";
    if (region.length === 0) continue;
    const list = languagesByLikelyRegion.get(region) ?? [];
    if (list.length < 4) list.push(from);
    languagesByLikelyRegion.set(region, list);
  }
  let multiTargetAliases = 0;
  for (const { from, to } of regionAliases) {
    const targets = String(to).split(" ").filter((value) => value.length > 0);
    if (targets.length > 1) multiTargetAliases++;
    for (const target of targets)
      for (const language of languagesByLikelyRegion.get(target) ?? []) {
        set.add(`${language}-${from}`);
        set.add(`${language}-Latn-${from}`);
      }
    // The control that must NOT move: the alias with no language at all, and with `und`.
    set.add(`und-${from}`);
    set.add(`en-${from}`);
  }
  if (multiTargetAliases === 0)
    throw new Error(
      "no multi-target region alias exists in the pinned data, so `preferredRegionAlias` — the " +
        "SECOND likely-subtag table read — cannot be reached by any probe and this differential " +
        "would be silently comparing four consumers while claiming five.",
    );

  // (6) THE SCRIPT BOUNDARY that stops `fallbackLocalesFor`'s truncation. Each pair is a tag whose
  // explicit script disagrees with its language's likely script (so truncation must STOP) beside one
  // where they agree (so truncation must CONTINUE) — the control without which "the boundary is
  // implemented" and "the boundary never fires" look identical.
  for (const tag of ["zh-Hant-TW", "zh-Hans-TW", "zh-Hant-CN", "zh-Hans-CN", "sr-Latn-RS", "sr-Cyrl-RS",
    "sr-Latn-BA", "sr-Cyrl-BA", "az-Cyrl-AZ", "az-Latn-AZ", "uz-Cyrl-UZ", "uz-Latn-UZ", "uz-Arab-AF",
    "mn-Mong-CN", "mn-Cyrl-MN", "pa-Arab-PK", "pa-Guru-IN", "ha-Arab-NG", "ha-Latn-NG", "ku-Arab-IQ",
    "ku-Latn-TR", "sd-Deva-IN", "sd-Arab-PK", "bs-Cyrl-BA", "bs-Latn-BA", "shi-Latn-MA", "shi-Tfng-MA",
    "vai-Latn-LR", "vai-Vaii-LR", "yue-Hans-CN", "yue-Hant-HK", "ff-Adlm-GN", "ff-Latn-SN",
    "zh-Hant-TW-u-nu-hanidec", "sr-Latn-RS-x-a", "en-Latn-US", "en-Latn-GB", "pt-Latn-BR", "pt-BR"])
    set.add(tag);

  // (7) BIDI. Languages whose RTL-ness is decided by MAXIMIZATION rather than by an explicit script
  // — the branch `bidi-isolation.script.*` pins — each beside the explicit-script spellings that
  // must override it in both directions.
  for (const tag of ["ar", "fa", "he", "iw", "ur", "ps", "sd", "ug", "yi", "ji", "dv", "ckb", "ks",
    "syr", "nqo", "arc", "sam", "mid", "ar-Latn", "fa-Latn", "he-Latn", "ur-Latn", "en-Arab",
    "en-Hebr", "de-Arab", "und-Arab", "und-Hebr", "und-Latn", "ar-EG", "he-IL", "ar-Arab-EG"])
    set.add(tag);

  // (8) THE `x-lvariant` FAMILY, the legacy tags, the extensions and the private-use shapes —
  // the families `tools/direct-tag-diff/` found real defects in, carried through to THESE consumers
  // because agreeing on the TAG is not agreeing on what the table then does with it. That is the
  // exact trap CLAUDE.md records: `diff:direct-tag` was green on the three `x-lvariant` tags while
  // the lookup diverged.
  for (const tag of ["en-US-x-lvariant-POSIX", "en-US-x-lvariant-posix", "ja-JP-x-lvariant-JP",
    "th-TH-x-lvariant-TH", "no-NO-x-lvariant-NY", "de-DE-x-lvariant-1901", "en-x-lvariant-POSIX",
    "en-US-POSIX", "ca-ES-valencia", "sr-Latn-RS-x-lvariant-A", "x-private", "en-x-private",
    "und-x-a", "UND-x-a", "zh-und", "en-u-ca-buddhist", "en-US-u-ca-gregory-nu-latn", "ja-JP-u-ca-japanese",
    "th-TH-u-nu-thai", "en-t-jp", "en-a-bbb-x-a-ccc", "i-klingon", "i-navajo", "art-lojban",
    "cel-gaulish", "no-bok", "no-nyn", "zh-guoyu", "zh-hakka", "zh-min-nan", "zh-xiang", "en-GB-oed",
    "sgn-BE-FR", "sgn-US", "zh-cmn-Hans-CN", "zh-yue", "zh-nan", "no-NO", "nn-NO", "nb-NO", "no",
    "sh", "sh-Latn", "sh-Cyrl-RS", "mo", "mo-MD", "iw-IL", "in-ID", "ji-UA", "tl-PH"])
    set.add(tag);

  // (9) CASE, in every position. `keyFor` lowercases on both sides, so a port that lowercased at a
  // different point in the pipeline would answer correctly for the canonical spelling and wrongly
  // for the others. Applied to a sample rather than to all 40k probes, because the JVM round trip is
  // the run's cost and the sample already crosses every family above.
  const cased = [...set].filter((tag) => /^[A-Za-z0-9-]{1,20}$/.test(tag) && tag.includes("-"));
  for (const tag of cased.slice(0, 4000)) {
    set.add(tag.toUpperCase());
    set.add(tag.toLowerCase());
  }

  // (10) THE ILL-FORMED CLASSES, present ON PURPOSE and gated under the second verdict. Without them
  // this tool could not tell "the port agrees with Java" from "the port agrees with Java and also
  // answers a great deal Java never would".
  for (const tag of ["", " ", "-", "--", "en-", "-en", "en--US", "en-US-", "e", "toolongtag",
    "no-NO-NY", "ja-JP-JP", "th-TH-TH", "en-US-@-x", "en US", "en_US", "en-US-x", "en-*", "*",
    "1", "1-a", "en-123456789", "abcdefghi", "en-Latn-", "en-Latin-US", "en-Latn-AAA", "und-AAA",
    "zh-\u{10400}", "\u{10400}", "fr-é", "中文", "fr;q=0.5", "en,fr", "en-US,en"])
    set.add(tag);

  return [...set];
}

const { decode: decodeLikely } = await import("../../src/data/likely-subtags.js");
const { decode: decodeRegionAliases } = await import("../../src/data/aliases-region.js");
const likelyTable = decodeLikely();
const regionAliasTable = decodeRegionAliases();

/** The five compared columns, each named by the consumer it observes on both sides. */
const COLUMNS = {
  likelySubtag: "CldrLocaleData.likelySubtagFor / locale-cldr.js likelySubtagFor",
  languageScript: "…languageScriptForLikelySubtag / locale-cldr.js languageScriptForLikelySubtag",
  canonicalTag: "…canonicalLanguageTag (reaches preferredRegionAlias) / locale-cldr.js canonicalLanguageTag",
  fallbackChain: "…fallbackLocalesFor (likely-script truncation boundary) / locale-cldr.js fallbackLocaleTagsFor",
  rightToLeft: "BidiUtils.localeUsesRightToLeftScript / bidi.js localeUsesRightToLeftScript",
};

/** Columns whose port side goes through `normalizeTag`, which refuses ill-formed tags by decision. */
const NORMALIZED_COLUMNS = new Set(["fallbackChain", "rightToLeft"]);

const javaReads = assertJavaTableReads();

const work = mkdtempSync(join(tmpdir(), "lokalized-likelydiff-"));
let exitCode = 0;
try {
  const classesOut = join(work, "classes");
  const compile = spawnSync(
    join(JDK, "bin/javac"),
    ["-cp", CLASSES, "-d", classesOut, join(here, "LikelySubtagDiff.java")],
    { encoding: "utf8" },
  );
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);

  const probes = inputs();
  const inPath = join(work, "probes.txt");
  const outPath = join(work, "answers.txt");
  writeFileSync(inPath, `${probes.map((probe) => JSON.stringify(probe)).join("\n")}\n`, "utf8");

  const run = spawnSync(
    join(JDK, "bin/java"),
    ["-cp", `${classesOut}:${CLASSES}`, "com.lokalized.LikelySubtagDiff", inPath, outPath],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  );
  if (run.status !== 0) throw new Error(`oracle execution failed:\n${run.stderr}`);

  const cldr = await import("../../src/internal/locale-cldr.js");
  const { normalizeTag } = await import("../../src/internal/locale.js");
  const { localeUsesRightToLeftScript } = await import("../../src/internal/bidi.js");

  /** @param {() => string} answer */
  const guarded = (answer) => {
    try {
      return answer();
    } catch (error) {
      return ` THROWS:${/** @type {any} */ (error)?.constructor?.name}`;
    }
  };

  const rows = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  let wellFormedProbes = 0;
  let illFormedProbes = 0;
  const agree = { wellFormed: 0, illFormed: 0 };
  /** @type {{column: string, tag: string, wellFormed: boolean, java: string, js: string}[]} */
  const differences = [];
  /** @type {{tag: string, column: string, java: string, js: string}[]} */
  const illFormedAnswered = [];
  let illFormedRefused = 0;
  /** Probes on which `preferredRegionAlias` demonstrably chose a NON-FIRST replacement. */
  const discriminatingRegionAliases = new Set();

  /** @type {Map<string, string[]>} */
  const aliasTargets = new Map();
  for (const { from, to } of /** @type {any} */ (regionAliasTable)) {
    const targets = String(to).split(" ").filter((value) => value.length > 0);
    if (targets.length > 1) aliasTargets.set(from.toUpperCase(), targets);
  }

  for (const row of rows) {
    if (row.wellFormed) wellFormedProbes++;
    else illFormedProbes++;

    /** @type {Record<string, string>} */
    const js = {
      likelySubtag: guarded(() => cldr.likelySubtagFor(row.tag) ?? " none"),
      languageScript: guarded(() => cldr.languageScriptForLikelySubtag(row.tag) ?? " none"),
      canonicalTag: guarded(() => cldr.canonicalLanguageTag(row.tag)),
      fallbackChain: guarded(() => cldr.fallbackLocaleTagsFor(normalizeTag(row.tag)).join("|")),
      rightToLeft: guarded(() => String(localeUsesRightToLeftScript(normalizeTag(row.tag)))),
    };

    // Did this probe exercise the SECOND table read discriminatingly? Only measurable on the Java
    // answer, so the count below is a statement about the oracle, not about the port.
    const region = /-([A-Za-z]{2}|[0-9]{3})(?:-|$)/.exec(row.tag);
    const targets = region ? aliasTargets.get((region[1] ?? "").toUpperCase()) : undefined;
    if (targets && row.canonicalTag && !row.canonicalTag.startsWith(" ")) {
      const chosen = /-([A-Za-z]{2}|[0-9]{3})(?:-|$)/.exec(row.canonicalTag)?.[1] ?? "";
      const index = targets.findIndex((target) => target.toLowerCase() === chosen.toLowerCase());
      if (index > 0) discriminatingRegionAliases.add(`${region?.[1]} -> ${chosen} (target ${index + 1} of ${targets.length}) via ${row.tag}`);
    }

    for (const column of Object.keys(COLUMNS)) {
      const javaAnswer = /** @type {string} */ (row[column]);
      const jsAnswer = /** @type {string} */ (js[column]);

      if (row.wellFormed) {
        if (jsAnswer === javaAnswer) agree.wellFormed++;
        else differences.push({ column, tag: row.tag, wellFormed: true, java: javaAnswer, js: jsAnswer });
        continue;
      }

      if (NORMALIZED_COLUMNS.has(column)) {
        // The decided contract: the port refuses where Java truncates. Refusing is the pass;
        // ANSWERING an ill-formed tag is a failure, so the contract is gated in both directions.
        if (jsAnswer.startsWith(" THROWS:RangeError")) {
          illFormedRefused++;
          agree.illFormed++;
        } else {
          illFormedAnswered.push({ tag: row.tag, column, java: javaAnswer, js: jsAnswer });
        }
        continue;
      }

      if (jsAnswer === javaAnswer) agree.illFormed++;
      else differences.push({ column, tag: row.tag, wellFormed: false, java: javaAnswer, js: jsAnswer });
    }
  }

  const cells = rows.length * Object.keys(COLUMNS).length;

  console.log("likely-subtag consumer differential — port vs. real lokalized-java on the pinned JDK");
  console.log(`  oracle          ${version.stderr.split("\n")[0]}`);
  console.log(`  java table reads ${javaReads.join(", ")} (asserted, CldrLocaleData.java)`);
  console.log(`  probes          ${rows.length}  (well-formed ${wellFormedProbes}, ill-formed ${illFormedProbes})`);
  console.log(`  cells           ${cells} = ${rows.length} probes x ${Object.keys(COLUMNS).length} consumers`);
  console.log("");
  for (const [column, what] of Object.entries(COLUMNS)) {
    const bad = differences.filter((difference) => difference.column === column).length +
      illFormedAnswered.filter((answered) => answered.column === column).length;
    console.log(`  ${bad === 0 ? "OK  " : "DIFF"} ${column.padEnd(15)} ${bad === 0 ? "" : `${bad} differ  `}${what}`);
  }
  console.log("");
  console.log(`  well-formed cells agreeing  ${agree.wellFormed}`);
  console.log(`  ill-formed  cells agreeing  ${agree.illFormed}  (of which ${illFormedRefused} are the port's decided refusal)`);
  console.log(`  preferredRegionAlias probes that chose a NON-FIRST replacement: ${discriminatingRegionAliases.size}`);
  for (const line of [...discriminatingRegionAliases].slice(0, 8)) console.log(`      ${line}`);

  // A probe space that never reaches the second table read would report five green columns while
  // comparing four consumers — the `zh-123` shape at harness level. Gated, not reported.
  if (discriminatingRegionAliases.size === 0) {
    console.error(
      "\nFAILED: no probe made `preferredRegionAlias` choose a non-first replacement, so the SECOND " +
        "of the two likely-subtag table reads was never discriminated. The `canonicalTag` column " +
        "would be green whether or not that read is implemented. Widen section (5) of inputs().",
    );
    exitCode = 1;
  }

  if (differences.length) {
    console.error(`\nFAILED: ${differences.length} cell(s) disagree with lokalized-java.`);
    for (const difference of differences.slice(0, 40))
      console.error(
        `  ${difference.column} ${JSON.stringify(difference.tag)} wellFormed=${difference.wellFormed}\n` +
          `      java ${JSON.stringify(difference.java)}\n      js   ${JSON.stringify(difference.js)}`,
      );
    if (differences.length > 40) console.error(`  … ${differences.length - 40} more`);
    exitCode = 1;
  }

  if (illFormedAnswered.length) {
    console.error(
      `\nFAILED: ${illFormedAnswered.length} ill-formed cell(s) were ANSWERED by the port where the ` +
        "decided contract is refusal (see tools/direct-tag-diff/'s ILL_FORMED_CONTRACT).",
    );
    for (const answered of illFormedAnswered.slice(0, 20))
      console.error(`  ${answered.column} ${JSON.stringify(answered.tag)} -> ${JSON.stringify(answered.js)} (java ${JSON.stringify(answered.java)})`);
    exitCode = 1;
  }

  if (exitCode === 0) console.log("\nOK: every likely-subtag consumer agrees with lokalized-java over the probe space.");
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(exitCode);
