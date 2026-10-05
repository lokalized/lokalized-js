#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests `lokalized/negotiate`'s `parseLanguageRanges` against the REAL
 * lokalized-java 3.1.0 `LocaleMatcher#parseLanguageRanges` on the pinned JDK.
 *
 * **RE-AIMED AT AMENDMENT A30.** Until then the oracle was `java.util.Locale.LanguageRange.parse`,
 * because the port's public parse modelled the JDK's own table. A30 made the pinned IANA registry the
 * source of the equivalences for every port; lokalized-java 3.1.0 ships a public
 * `parseLanguageRanges` that reads it (its default `LanguageRangeEquivalents.IANA_REGISTRY` setting)
 * and the port models THAT. So the oracle is the library's public method on a default `Strings`, from
 * the jar `tools/oracle-jar.mjs` resolves, and the JDK's own parse is still emitted beside it — as
 * `jdk` on every row — only so the run can COUNT the probes where the registry and the running JDK
 * disagree (`registryVsJdk` in the `##diff-facts` line). That count is the anti-vacuity term: zero
 * would mean the probe space never reaches a tag JDK 21's table lacks, and the re-aim proved nothing.
 *
 * WHY THIS EXISTS, when 2,303 recorded cases already run. A4 is the one slice the corpus cannot
 * verify. `sun.util.locale.LocaleEquivalentMaps.regionVariantEquivMap` rewrites a REGION or VARIANT
 * subtag — `de-DE` gains `de-dd`, `fr-FR` gains `fr-fx`, `ja-heploc` gains `ja-alalc97` — and NO
 * fixture in the corpus loads such a catalog and NO case supplies such a range. Delete the whole map
 * and every recorded row stays green. The same is true of the map's ITERATION ORDER, which decides
 * the answer for a range carrying two of its subtags, and of `getExtentionKeyIndex`, which suppresses
 * it inside a singleton extension. Each of those is a silent answer change in a real request handler.
 *
 * So the oracle here is the Java method itself, on the probe space the corpus does not reach:
 *
 *   node tools/language-range-diff/run.mjs
 *
 * IT IS NOT PART OF `npm run verify`, deliberately, and for the same reason its four siblings are not:
 * `verify` has to be runnable in a checkout that has no pinned Corretto 21, and a gate that silently
 * passes when its oracle is missing has stopped gating. A JDK-dependent check that skipped itself
 * would be worse than one that is run on purpose. (An earlier revision of this comment gave a SECOND
 * reason — that the run exited non-zero on four triaged data defects. That reason is retired: the
 * defects are fixed and the run exits 0. Only the JDK-availability reason stands, so a green
 * `npm run verify` still says nothing about this tool and it must be named separately.)
 *
 * WHAT IT HAS ALREADY CAUGHT, and the reason the probe space is shaped the way it is. The space used
 * to be derived from the pinned artifact itself, and widening it to the JDK's own equivalence keys
 * immediately found four ranges the artifact was missing — `cmn-hans`, `cmn-hant`, `lv-lvs`,
 * `lv-ltg` — two of which ADDED a member the JDK does not return and two of which LOST one it does.
 * Every corpus row stayed green throughout, before and after.
 *
 * Those four were CLOSED at the source, in the spec's probe space and then the artifact it produced
 * (806 classes where there had been 802), and `OPEN_PORT_DEFECTS` emptied as a result — the four
 * entries had to be deleted in the same change, because their own staleness check fails the run once
 * they stop diverging. Since A30 there is no probed artifact at all: the table is GENERATED from the
 * registry, so a gap in a probe space can only hide a defect in a CHECK, never put one in the data —
 * and this space is seeded from the artifact's, the library's and the JDK's keys together.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeRegionVariantEquivalents } from "../../src/data/iana-identity-equivalents.js";
import { IANA_EQUIVALENCES_ARTIFACT, specPath } from "../iana-artifact.mjs";
import { oracleFieldProblems, recordingOracleRows } from "../oracle-field-coverage.mjs";
import { oracleJar } from "../oracle-jar.mjs";

/** Emitted by the oracle and deliberately not compared, each with the reason. Checked both ways. */
const UNCOMPARED_ORACLE_FIELDS = {};

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const specDir = process.env.LOKALIZED_SPEC_DIR ? resolve(process.env.LOKALIZED_SPEC_DIR) : resolve(root, "../lokalized-spec");
const javaDir = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(root, "../lokalized-java");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}
// The oracle is a LIBRARY method now, so an absent or ambiguous jar names its own remedy here rather
// than surfacing as a compiler error about a missing symbol (`lookup-diff`'s lesson).
const { jar: JAR, problem: JAR_PROBLEM } = oracleJar(javaDir);
if (JAR_PROBLEM !== null) {
  console.error(`the oracle jar could not be resolved: ${JAR_PROBLEM}`);
  process.exit(2);
}
const LIBRARY = basename(/** @type {string} */ (JAR), ".jar");

/**
 * **THE JAR MUST BE AT LEAST AS NEW AS THE SOURCES IT IS RECORDED AS.** The run records lokalized-java's
 * `librarySourcesSha256` (below), computed from `src/main`, while it EXECUTES the jar — and nothing
 * tied the two: a source edit with no `mvn package` would run the old bytes and record them under the
 * new sources' digest, green. The spec builder found the jar dated Sep 19 behind the 3.1.0 sources once
 * already. So any file under `src/main` modified after the jar refuses the run, naming it and the
 * remedy. A modification time is a proxy — it cannot see a jar built from OTHER sources — but it is
 * the failure that has actually happened, and the recorded digest is what a reader compares.
 */
{
  const jarTime = statSync(/** @type {string} */ (JAR)).mtimeMs;
  /** @type {string[]} */
  const newer = [];
  const walk = (/** @type {string} */ directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (statSync(path).mtimeMs > jarTime) newer.push(path);
    }
  };
  walk(join(javaDir, "src/main"));
  if (newer.length > 0) {
    console.error(`the oracle jar ${JAR} is OLDER than ${newer.length} lokalized-java source file(s), e.g. ` +
      `${newer.slice(0, 3).join(", ")}.\nIt would run the old bytes and record them under the new sources' digest. ` +
      `Rebuild it ('mvn -o package' in ${javaDir}) and re-run.`);
    process.exit(2);
  }
}

/**
 * lokalized-java's `librarySourcesSha256`, by lokalized-spec's recipe (`tools/vector-oracle/build.mjs`,
 * `tools/iana-oracle/build.mjs`): the digest of the JCS list of `{path, sha256}` over
 * `src/main/java/com/lokalized`. Recorded in `##diff-facts`, so the differential record names the Java
 * build it ran against in the same terms the corpus does, and `diff:check` can hold the two equal.
 */
const LIBRARY_SOURCES_SHA256 = (() => {
  const sha256 = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");
  const sources = join(javaDir, "src/main/java/com/lokalized");
  const listing = readdirSync(sources).sort().map((file) => `{"path":${JSON.stringify(file)},"sha256":${JSON.stringify(sha256(readFileSync(join(sources, file))))}}`);
  return sha256(Buffer.from(`[${listing.join(",")}]`, "utf8"));
})();

/**
 * The fourteen region/variant subtags, which is what the corpus never reaches.
 *
 * Hand-typed, but no longer TRUSTED: section (2c) below re-derives this list from the JDK's own
 * `regionVariantEquivMap` on every run and aborts if it has drifted. Before that check existed this
 * array and the port's table were two independent transcriptions verified once by hand — the same
 * "probe space is a guess" shape as the four language keys this tool caught, and one that had already
 * been mis-enumerated once as thirteen subtags with `-zr` missing.
 */
const REGION_VARIANT = ["-alalc97", "-bu", "-cd", "-dd", "-de", "-fr", "-fx", "-heploc", "-mm", "-tl", "-tp", "-yd", "-ye", "-zr"];

/**
 * The port's region/variant substitutions, in attempt order.
 *
 * IMPORTED since A30. They were a module-private source literal in `src/negotiate/index.js`, which
 * this tool regex-read rather than export a symbol `symbol-allowlist.json` does not permit; A30
 * generated them into `src/data/iana-identity-equivalents.js` from lokalized-spec's artifact, whose
 * decoder is an internal module export and not a package export, so importing it costs no surface.
 * THROWS on an empty list: a check that compares against nothing has stopped checking.
 *
 * @returns {[string, string][]}
 */
function portRegionVariantEquivalents() {
  const pairs = decodeRegionVariantEquivalents();
  if (pairs.length === 0)
    throw new Error("src/data/iana-identity-equivalents.js decoded to zero region/variant pairs");
  return pairs;
}

/**
 * Every string the corpus hands to a range parse, plus the probes it never reaches.
 *
 * @param {string[]} jdkKeys every key of the JDK's own equivalence tables, from the oracle itself
 * @param {string[]} libraryKeys every key of lokalized-java's registry table, from the oracle itself
 */
function inputs(jdkKeys, libraryKeys) {
  const corpus = JSON.parse(readFileSync(join(specDir, "generated/behavioral-vectors.json"), "utf8"));
  /** @type {Set<string>} */
  const set = new Set();

  // (1) Every header the corpus actually records — `matchFor` string inputs, `acceptLanguage`
  // headers, and the ambient suppliers' `ranges`. These are the rows the runner must also pass, so a
  // disagreement here and a conformance FAILED are the same defect seen twice.
  for (const testCase of corpus.cases) {
    const ranges = testCase.input?.languageRanges;
    if (typeof ranges === "string") set.add(ranges);
    if (typeof testCase.input?.header === "string") set.add(testCase.input.header);
  }
  for (const fixture of Object.values(corpus.fixtures)) {
    for (const spec of [fixture.localeSupplier, fixture.localeMatchSupplier])
      if (spec && typeof spec.ranges === "string") set.add(spec.ranges);
  }

  // (2) THREE KEY SETS, bare and suffixed: every member of the spec artifact's registry classes (what
  // the port's table is generated from), every key of lokalized-java's own table (the oracle's), and
  // every key of the JDK's (what a JDK-shaped caller sends, and where `registryVsJdk` comes from).
  // Until A30 the first was the 818-entry probed closure's keys; the artifact replaced it.
  //
  // Deriving the probe space from ONE implementation's table is the `zh-123` shape at the level of the
  // harness: a key that table is MISSING is a key the differential never asks about. It happened
  // twice, once in each direction (`cmn-hans`/`cmn-hant`/`lv-lvs`/`lv-ltg` unprobed while the JDK was
  // the oracle, `dyl`/`sgn-dyl`/`zhk`/`sgn-zhk` once the library was), so no table names the space
  // alone.
  //
  // `-hans`/`-hant` are scripts that are THEMSELVES part of longer keys (`cmn-hans`), which is how the
  // prefix walk's early return becomes observable; `-us`, `-1901` and `-x-a` are a region, a variant
  // and a singleton extension, where no longer key exists and the walk must fall through; and each
  // region/variant subtag makes the NESTED substitution — a language equivalent AND a region rewrite
  // in one range (`mgp-bu` -> `mrd-mm`) — observable.
  const artifact = JSON.parse(readFileSync(specPath(IANA_EQUIVALENCES_ARTIFACT), "utf8"));
  if (!Array.isArray(artifact.languageEquivalenceClasses) || artifact.languageEquivalenceClasses.length === 0)
    throw new Error(`${specPath(IANA_EQUIVALENCES_ARTIFACT)} carries no languageEquivalenceClasses; ` +
      "the probe space would silently lose the port's own table");
  const artifactKeys = artifact.languageEquivalenceClasses.flat();

  for (const key of [...artifactKeys, ...libraryKeys, ...jdkKeys])
    for (const suffix of ["", "-hans", "-hant", "-us", "-1901", "-x-a", ...REGION_VARIANT]) set.add(key + suffix);

  // (3) The region/variant map, which is the whole reason this differential exists: every subtag on
  // a plain language, on a language that also carries a script, behind a singleton extension (where
  // `getExtentionKeyIndex` must suppress it), in front of one, and doubled up with a SECOND map
  // subtag — which is what makes the map's HashMap iteration order observable.
  for (const subtag of REGION_VARIANT) {
    for (const prefix of ["de", "en", "fr", "ja", "zh", "sgn", "iw", "cmn", "no-bok", "und-hepburn"]) {
      set.add(prefix + subtag);
      set.add((prefix + subtag).toUpperCase());
      set.add(`${prefix}-latn${subtag}`);
      set.add(`${prefix}-x-a${subtag}`);
      set.add(`${prefix}${subtag}-x-a`);
      set.add(`${prefix}${subtag}-1901`);
    }
    for (const second of REGION_VARIANT) set.add(`sgn${subtag}${second}`);
    set.add(`x${subtag}`);
    set.add(subtag.slice(1));
  }

  // (4) The header grammar itself: the global space strip, the prefix strip, the weight forms Java
  // accepts and JavaScript does not (and the reverse), the dedup rule in both orders, the sort, and
  // the shapes `String.split(",")` treats specially.
  for (const header of [
    "", " ", "  ", "\t", "\n", " ", ",", ",,", ",,,", "fr,", ",fr", "fr,,de", "fr , de",
    "not a header!", "accept-language: fr", "ACCEPT-LANGUAGE:fr;q=0.5", "accept-language:", "accept-language:,",
    "fr;q=1.5", "fr;q=abc", "fr;q=", "fr;q=1", "fr;q=1.0", "fr;q=0", "fr;q=0.0", "fr;q=-0.0", "fr;q=-1",
    "fr;q=NaN", "fr;q=Infinity", "fr;q=-Infinity", "fr;q=1d", "fr;q=1f", "fr;q=0x1p-1", "fr;q=.5", "fr;q=5.",
    "fr;q=0x10", "fr;q= 0.5", "fr;q=0.5 ", "fr;q=+0.5", "fr;q=1e-3", "fr;q=1E0", "fr;q=2", "fr;q=1e10",
    "fr;q=0.5;q=0.9", "fr;;q=0.5", "iw;q=0.9,he;q=0.4", "he;q=0.4,iw;q=0.9", "de,fr", "fr,de",
    "fr;q=0.5,fr;q=0.9", "es,fr,de", "de;q=0.8,fr;q=0.9,en;q=0.7", "*", "*-ch", "de-*", "x-foo-*",
    "en-*;q=1,en-US;q=0", "de;q=0.8,\tfr;q=0.9", " de;q=0.8, fr;q=0.9", "\tfr\t,de;q=0.1", "\nfr",
    "de;q=0.8,f\tr;q=0.9", "abcdefghi", "ab-cdefghij", "a", "a-b", "1", "1-a", "a-1", "zh-123",
    // A RANGE OF HYPHENS ONLY splits to NO subtags in Java, and the JDK 21 constructor's `subtags[0]`
    // throws `ArrayIndexOutOfBoundsException` — the one refusal here that is not `range=…`. Added at
    // A30, when the spec's model and the port were found to disagree on exactly `-` and `---`.
    "-", "---", "-a", "a-", "fr,-", "-;q=0.5",
    "he,id,yi,cmn,yue,nan,hak,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.1",
    "he,id,yi,cmn,yue,nan,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.9,de;q=0.8,es;q=0.7,it;q=0.6",
  ]) set.add(header);

  // (5) THE MEMBER-COUNT BOUNDARY, spelled explicitly rather than left to the two expanding headers
  // above. `parse` itself caps NOTHING — the 32-member limit is `matchFor`'s and `bestMatchFor…`'s,
  // applied to `parse`'s OUTPUT — so what this differential owes at the boundary is that the member
  // list is exactly as long as Java says it is. An off-by-one here reaches the caller as a spurious
  // `At most 32 language ranges are supported` or as a silently accepted 33rd.
  const simple = (count) => Array.from({ length: count }, (_, index) =>
    `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`).join(",");
  for (const count of [31, 32, 33, 34]) set.add(simple(count));

  // (6) THE LENGTH BOUNDARY. Again the 4096 cap is the caller's, and the caller applies it to the RAW
  // value — so `parse` must still agree at and past that size. The commas-plus-`fr` shape is the one
  // the A4 brief names: normalization deletes the commas, so a cap applied after normalization would
  // answer `fr` on both sides of the boundary and see nothing.
  for (const length of [4095, 4096, 4097]) {
    set.add(",".repeat(length - 2) + "fr");
    set.add("fr" + ",".repeat(length - 2));
    set.add("a".repeat(length));
  }
  set.add(`fr;q=0.${"0".repeat(300)}1`);
  set.add(`${"a-".repeat(64)}b`);

  // (7) NON-ASCII AND ASTRAL. `parse` lowercases the WHOLE header before it does anything else —
  // `LocaleMatcher:441` is `ranges.replace(" ", "").toLowerCase(Locale.ROOT)` — and the port spells
  // that as JavaScript's `String#toLowerCase`, which is also locale-independent. So the Turkish-I
  // hazard is NOT live (checked: the JDK passes `Locale.ROOT`, not the default-locale overload), but
  // the two runtimes' UNICODE VERSIONS still have to case-map alike, and that is a real environment
  // fact that drifts under this tool as Node's ICU and the pinned JDK move apart.
  //
  // These are chosen to be exactly the shapes a naive lowercasing gets wrong, and ablation confirms
  // all ten: `İ` (U+0130) is the length-CHANGING mapping (1 char -> `i` + U+0307), `ẞ` and `Σ` are
  // SpecialCasing rows, `ﬁ` is a ligature that must NOT decompose, and U+10400 -> U+10428 is an astral
  // mapping a code-unit-wise loop cannot see. Each reaches the port through a MESSAGE the conformance
  // runner compares verbatim (`range=…`, `weight="…"`), so a mismatch here is a wrong recorded string.
  // The space strip is `" "` alone, so NBSP and the ideographic space must SURVIVE it and be refused
  // by the grammar instead, and the lone surrogates check that neither side sanitizes its input.
  for (const header of [
    "É", "é", "fr-é", "İ", "İstanbul", "ẞ", "ﬁ", "Σ", "ΑΣ", "中文", "zh-中文", "עברית", "ру", "РУ",
    " ", "fr de", "　fr", "fr de", "fr​de", "fr﻿de",
    "\u{10400}", "zh-\u{10400}", "\u{1d400}", "😀", "fr-😀", "fr;q=0.\u{10400}", "\u{10428}",
    "\ud800", "fr\ud800", "\udfff", "fr-\ud83d", "é", "É",
  ]) set.add(header);

  return [...set];
}

/**
 * Divergences that are DELIBERATE AND CORRECT — a port decision the JDK does not share.
 *
 * It is empty, and that is a result rather than an oversight. It used to hold `cmn-hans`, described as
 * "the JDK drops the derived `zh-guoyu-hans` as ill-formed". That reason is FALSE and was retired by
 * direct measurement on the pinned JDK: `new Locale.LanguageRange("zh-guoyu-hans")` constructs without
 * complaint, `parse("zh-guoyu-hans")` returns three members, and `cmn-cyrl`, `cmn-latn`, `cmn-us` and
 * `cmn-1901` all KEEP their `zh-guoyu-*` member. Nothing is being dropped for ill-formedness. The row
 * was a port defect wearing a divergence's clothes, and it is now in `OPEN_PORT_DEFECTS` below.
 *
 * Anything added here needs a Java-source or JDK-measured argument for why the port is RIGHT to
 * differ. "The corpus stays green" is not one — the corpus is blind to every row in this file.
 *
 * @type {Record<string, string>}
 */
const KNOWN_DIVERGENCES = {};

/**
 * Measured PORT DEFECTS: the port is wrong, the fix is known, and it is not made here.
 *
 * This is deliberately NOT `KNOWN_DIVERGENCES`. Entries here do not excuse anything and do not make
 * the run green — they are listed so the failure prints its own root cause instead of arriving as a
 * handful of anonymous mismatches, and so a reviewer can tell a triaged defect from a fresh
 * regression. The run exits non-zero while any of them stands. A table that let a known defect pass
 * is the "known-gap lists rot into a list of excuses" failure `../../../CLAUDE.md` names.
 *
 * IT IS EMPTY, AND THAT EMPTINESS IS THE RECORD OF A WIN rather than a table nobody ever filled in.
 * It held four families — `cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg`, 24 diverging probes between
 * them. One root cause: `lokalized-spec/tools/iana-oracle/candidates.mjs` built the closure's probe
 * space from CLDR alone — `validity.languages`, the alias tables, and `<prefix>-<language>` for
 * twelve hard-coded macrolanguage prefixes — which is a GUESS at the shape of the JDK's table. The
 * JDK keys on 769 ranges and 4 were outside that guess (`cmn-hans`/`cmn-hant` are
 * prefix-plus-SCRIPT; `lv-lvs`/`lv-ltg` need an `lv` prefix the list lacked), so they were never
 * probed and never reached the artifact. The generator's losslessness check could not catch it: it
 * verifies that every PROBED range reconstructs, so a range nobody probed is outside what it checks.
 *
 * THE FIX, landed in the spec repo at the time and measured rather than argued: the probed closure's
 * candidate space was seeded from the JDK's own equivalence-map keys and every one of the 769 was
 * asserted to produce an entry. Re-extracting added exactly those 4 entries (802 -> 806) and changed
 * or removed nothing else. (A30 has since retired the probed closure: the data is generated from the
 * registry snapshot, and this history is kept for the shape of the mistake, which recurs.)
 *
 * The machinery below stays, empty, for the next one. Each entry is a FAMILY, not a single string:
 * a missing key poisons every longer range that walks through it, so `cmn-hans` owned `cmn-hans-us`,
 * `cmn-hans-1901` and the rest. Matching on the family keeps 24 rows of one defect from reading as
 * 24 defects, and every member is still printed, so a DIFFERENT defect that happened to share the
 * prefix would show up in the listing rather than hide behind it. Staleness is per family: an entry
 * is stale when NOTHING in its family diverges any more, which is what forced these four to be
 * deleted in the same change that fixed them.
 *
 * @type {Record<string, string>}
 */
const OPEN_PORT_DEFECTS = {};

/** The family an input belongs to, or `null`. `x` belongs to `key` when it IS `key` or extends it. */
const defectFamily = (/** @type {string} */ input) =>
  Object.keys(OPEN_PORT_DEFECTS).find((key) => input === key || input.startsWith(`${key}-`)) ?? null;

const work = mkdtempSync(join(tmpdir(), "lokalized-rangediff-"));
// REMOVED ON `exit`, NOT IN A `finally`. This run ends in `process.exit`, which skips `finally`,
// and until 2026-09-23 a `finally` after this block held the removal — so EVERY run left its work
// directory in the system temp folder (120 `lokalized-rangediff-*` were counted there). The block
// is the old `try` body, kept as a block so its bindings stay scoped.
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
{
  const classesOut = join(work, "classes");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", /** @type {string} */ (JAR), "-d", classesOut, join(here, "LanguageRangeDiff.java")], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);

  // `LocaleEquivalentMaps` is JDK-internal, so reading its key set needs the module opened. Both flags
  // are required: `--add-exports` to name the class, `--add-opens` for `setAccessible`. The library's
  // own table is package-private in `com.lokalized`, which is why the harness lives in that package.
  const OPENS = ["--add-exports", "java.base/sun.util.locale=ALL-UNNAMED", "--add-opens", "java.base/sun.util.locale=ALL-UNNAMED"];
  const classpath = `${classesOut}:${JAR}`;
  const keysPath = join(work, "jdk-keys.txt");
  const regionPath = join(work, "jdk-region-variant.txt");
  const libraryKeysPath = join(work, "library-keys.txt");
  const libraryRegionPath = join(work, "library-region-variant.txt");
  const keyRun = spawnSync(join(JDK, "bin/java"), [...OPENS, "-cp", classpath, "com.lokalized.LanguageRangeDiff",
    "--keys", keysPath, regionPath, libraryKeysPath, libraryRegionPath], { encoding: "utf8" });
  if (keyRun.status !== 0) throw new Error(`could not read the JDK's and the library's equivalence keys, so the probe space would be incomplete:\n${keyRun.stderr}`);
  const jdkKeys = readFileSync(keysPath, "utf8").split("\n").filter(Boolean);
  // A SET, never an order: the library's table is a `HashMap`, so its iteration order means nothing.
  const libraryKeys = readFileSync(libraryKeysPath, "utf8").split("\n").filter(Boolean).sort();

  // (2c) THE THIRD EQUIVALENCE TABLE, re-derived rather than transcribed.
  //
  // `jdkKeys` above covers `singleEquivMap` and `multiEquivsMap` — the LANGUAGE tables. Widening the
  // probe space to those is what caught the four missing closure classes. `regionVariantEquivMap` was
  // left out of that widening and stayed a hand-typed literal in TWO places: `REGION_VARIANT` here,
  // and `REGION_VARIANT_EQUIVALENTS` in the port. Neither was re-derived by anything on any run, so a
  // JDK that added a fifteenth pair or reordered the fourteen would leave every gate green — the
  // identical failure mode, in the identical file, left open next to the fix for it.
  //
  // WHAT EACH HALF OF THIS CHECK IS WORTH, measured by ablation rather than argued:
  //
  //  - The PORT-TABLE comparison is largely redundant, and this comment says so rather than letting
  //    the check look sharper than it is. Mis-pairing `-bu` with `-cd`, or swapping two pairs to
  //    change the iteration order, is ALREADY caught by the probes (`fr-bu` and `sgn-tl-bu` diverge).
  //    It is kept because it names the cause — a one-line table drift instead of a puzzling 6031/6037.
  //
  //  - The PROBE-SPACE comparison is the one that closes a real hole, and the hole was silent.
  //    Removing the `-heploc`/`-alalc97` pair from BOTH this list and the port's table, with these
  //    two checks disabled, leaves this differential reporting `5864/5864 identical` and EXIT 0 —
  //    while the port answers `ja-heploc` with one member where Java answers two. The probes are
  //    generated FROM `REGION_VARIANT`, so a pair missing from it is a question never asked. That is
  //    the same shape as the four missing language keys this tool caught, in the same file, left open
  //    beside the fix for it: a JDK that added a fifteenth pair would leave every gate green.
  //
  // The port's table is compared as an ORDERED list of PAIRS, not as a key set, because both halves
  // are load-bearing: `getEquivalentForRegionAndVariant` returns on the first key found in the range,
  // so order decides the answer for `sgn-de-fr`, and the value decides it for every range at all.
  const jdkRegionVariant = readFileSync(regionPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => /** @type {[string, string]} */ (/** @type {unknown} */ (line.split("\t"))));

  if (jdkRegionVariant.length === 0)
    throw new Error("the JDK dumped no region/variant equivalences; the port's table would be checked against nothing");

  const jdkRegionKeys = jdkRegionVariant.map(([key]) => key);
  const probeSpaceKeys = [...jdkRegionKeys].sort();
  if (JSON.stringify(probeSpaceKeys) !== JSON.stringify([...REGION_VARIANT].sort()))
    throw new Error(
      `this tool's REGION_VARIANT list has drifted from the pinned JDK's regionVariantEquivMap.\n` +
        `  JDK  (${jdkRegionKeys.length}): ${probeSpaceKeys.join(" ")}\n` +
        `  here (${REGION_VARIANT.length}): ${[...REGION_VARIANT].sort().join(" ")}\n` +
        `the probe space would miss whatever the JDK gained, which is exactly the defect the language ` +
        `half of this file was rewritten to close`,
    );

  // THREE ORDERED LISTS MUST BE ONE since A30, and they are three INDEPENDENT derivations: the
  // port's generated pairs (from the spec artifact, whose order is authored in lokalized-spec's
  // `tools/iana-oracle/jdk-compatibility.json`, taken from the JDK's own map); lokalized-java's
  // `REGION_VARIANT_EQUIVALENTS` (derived independently by its own generator from its vendored
  // registry copy, as a model of the JDK's HashMap iteration order — it reads no spec file); and the
  // JDK's own map. The port disagreeing alone is a stale generated module or authored input;
  // lokalized-java disagreeing alone is its model of the JDK's order going wrong.
  const libraryRegionVariant = readFileSync(libraryRegionPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => /** @type {[string, string]} */ (/** @type {unknown} */ (line.split("\t"))));
  const portRegionVariant = portRegionVariantEquivalents();
  for (const [name, pairs] of /** @type {[string, [string, string][]][]} */ ([["lokalized-java", libraryRegionVariant], ["the pinned JDK", jdkRegionVariant]]))
    if (JSON.stringify(portRegionVariant) !== JSON.stringify(pairs))
      throw new Error(
        `src/data/iana-identity-equivalents.js's region/variant substitutions do not match ${name}'s, ` +
          `compared as an ordered list of pairs.\n` +
          `  ${name} (${pairs.length}): ${pairs.map((p) => p.join("=")).join(" ")}\n` +
          `  port (${portRegionVariant.length}): ${portRegionVariant.map((p) => p.join("=")).join(" ")}`,
      );

  const probes = inputs(jdkKeys, libraryKeys);

  // BOTH TABLES ARE CHECKED AGAINST THE PROBE SPACE BEFORE ANYTHING RUNS, because the staleness
  // machinery below can only see a key the probe space actually contains.
  //
  // 1. An entry for an input nobody probes is never compared, never stale, and still counted in the
  //    headline as a known divergence. Measured, not theorised: `"de-de"` (a real probe) correctly
  //    reports STALE, while `"de-DE"` — a spelling `inputs()` never emits, since it produces
  //    lowercase and full-uppercase and never mixed — was silently reported as `1 known
  //    divergence(s)` and checked against nothing. That is the "known-gap lists rot" failure
  //    `../../../CLAUDE.md` names, in the file that claims to have made it structural.
  //
  // 2. `KNOWN_DIVERGENCES` silently OUTRANKS `OPEN_PORT_DEFECTS` in the loop below: the `deliberate`
  //    arm is taken before the `family` arm, so an exact-input entry excuses one member of a triaged
  //    defect family and merely shrinks its probe count, with no warning that it did. Adding all 24
  //    members would turn this run green while every defect stood. An input inside a defect family
  //    may not also be a deliberate divergence — the family is the disposition.
  const probeSet = new Set(probes);
  for (const key of Object.keys(KNOWN_DIVERGENCES)) {
    if (!probeSet.has(key))
      throw new Error(`KNOWN_DIVERGENCES names ${JSON.stringify(key)}, which is not in the probe space, ` +
        `so nothing would ever check it. Fix the spelling or widen inputs().`);
    if (defectFamily(key) !== null)
      throw new Error(`KNOWN_DIVERGENCES names ${JSON.stringify(key)}, which falls inside the ` +
        `OPEN_PORT_DEFECTS family ${JSON.stringify(defectFamily(key))}. A triaged defect may not be ` +
        `excused member by member; delete the entry and repair the family.`);
  }
  for (const key of Object.keys(OPEN_PORT_DEFECTS))
    if (!probes.some((p) => p === key || p.startsWith(`${key}-`)))
      throw new Error(`OPEN_PORT_DEFECTS names the family ${JSON.stringify(key)}, which no probe reaches, ` +
        `so its staleness check could never fire. Fix the spelling or widen inputs().`);

  const inPath = join(work, "inputs.txt");
  const outPath = join(work, "java.jsonl");
  writeFileSync(inPath, `${probes.map((p) => JSON.stringify(p)).join("\n")}\n`, "utf8");

  const run = spawnSync(join(JDK, "bin/java"), ["-cp", classpath, "com.lokalized.LanguageRangeDiff", inPath, outPath], { encoding: "utf8", maxBuffer: 64e6 });
  if (run.status !== 0) throw new Error(`oracle execution failed:\n${run.stderr}`);

  const { parseLanguageRanges } = await import("../../src/negotiate/index.js");
  // THE GATE THAT WOULD HAVE CAUGHT S31's DEFECT, wired into the tool that had it. `errorType` was
  // emitted on every refusal row from the day this tool was written and read by nothing; the fix
  // above compares it now, and this makes the NEXT dropped column fail instead of waiting for
  // someone to ablate the instrument. Proven retrospectively: reverting the comparison to
  // `{ok, error}` makes this gate name `errorType` and exit 1.
  const recorder = recordingOracleRows(
    readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const rows = recorder.rows;

  let same = 0;
/**
 * Java's refusal class, mapped to the JS name the port raises for it. An UNMAPPED type reaches the
 * comparison verbatim and fails the run loudly rather than being waved through, which is the half that
 * keeps this from rotting into an always-true test. TWO entries since A30: a range of hyphens only
 * throws `ArrayIndexOutOfBoundsException` from the JDK 21 `LanguageRange` constructor, and the
 * fail-soft door catches both classes as the parser's own refusals, so the port raises `RangeError`
 * for both, with Java's message.
 */
const JS_CLASS_FOR_JAVA = {
  "java.lang.IllegalArgumentException": "RangeError",
  "java.lang.ArrayIndexOutOfBoundsException": "RangeError",
};
  /** Probes where lokalized-java's registry parse and the JDK's own parse answer differently. */
  let registryVsJdk = 0;

  const differences = [];
  /** @type {{input: string, wanted: unknown, actual: unknown, family: string}[]} */
  const defects = [];
  /** @type {string[]} */
  const stale = [];
  for (const row of rows) {
    let actual;
    try {
      actual = {
        ok: true,
        ranges: parseLanguageRanges(row.in).map((member) => ({ range: member.range, weight: doubleText(member.weight) })),
      };
    } catch (error) {
      actual = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        // THE REFUSAL CLASS, WHICH THIS RUNNER DROPPED. The oracle has emitted `errorType` — the
        // exception's `getClass().getName()` — on every refusal row since it was written
        // (`LanguageRangeDiff.java:56`), and nothing here read it: `wanted` was built as
        // `{ok, error}` and `grep -c errorType run.mjs` answered 0. **Measured 2026-09-14: changing
        // every `throw new RangeError(` in `src/negotiate/index.js` to `throw new TypeError(`, with
        // every message byte-identical, left this run at 6037/6037 identical, exit 0.** That is the
        // exact mirror of the defect `diff:lookup` once had — it emitted the class AND the message
        // and dropped the MESSAGE; this one emitted both and dropped the CLASS.
        //
        // THE CONSEQUENCE IS AT THE PUBLIC DOOR, and was demonstrated rather than argued: the
        // one-sided form of that rename (throw sites only, the two `instanceof RangeError` guards
        // left behind — what a careless refactor actually produces) turns the negotiator's FAIL-SOFT
        // Accept-Language handling into a thrown exception. `bestMatchForAcceptLanguage("fr;q=2")`
        // answers `"en"` unablated and THROWS under it, which is the hazard the comment at
        // `src/negotiate/index.js:967` names two lines above the guard, and M9's own fail-soft
        // requirement. The behaviour is not unguarded — `test/negotiate.test.js` pins
        // `{ name: "RangeError" }` and goes 10-of-32 red under the same ablation, inside `npm test` —
        // but it was unguarded HERE, in the instrument whose subject it is.
        //
        // COMPARED AS A MAPPING, NOT ROW-AGAINST-ROW, and the difference matters: Java throws
        // exactly ONE class across all 71 refusals in this 6,037-probe space, so an equality check on
        // `errorType` would discriminate nothing. The project's standing rule is Java's SHAPE with
        // the JS name, so the assertion is the PAIR — and the Java half is asserted too, which is
        // what stops the mapping going stale if a future JDK throws something else.
        errorClass: error instanceof Error ? error.constructor.name : "not an Error",
      };
    }
    const wanted = row.ok
      ? { ok: true, ranges: row.ranges }
      : { ok: false, error: row.error, errorClass: JS_CLASS_FOR_JAVA[row.errorType] ?? `UNMAPPED:${row.errorType}` };
    // The JDK's own parse is COUNTED, never compared: the port does not model it (A30), and the count
    // is what says this probe space reaches the tags where the registry and JDK 21 part company.
    const jdk = row.jdk;
    const library = row.ok ? { ok: true, ranges: row.ranges } : { ok: false, error: row.error, errorType: row.errorType };
    if (JSON.stringify(jdk) !== JSON.stringify(library)) registryVsJdk += 1;
    const deliberate = Object.hasOwn(KNOWN_DIVERGENCES, row.in);
    const family = defectFamily(row.in);
    if (JSON.stringify(actual) === JSON.stringify(wanted)) {
      // A deliberate divergence that stopped diverging is STALE immediately and fails the run, on the
      // phonetic differential's precedent. Defect FAMILIES are judged after the loop, since one member
      // agreeing proves nothing while its siblings still differ. Without staleness these tables become
      // lists of excuses for behavior the port has already fixed — the failure `../../../CLAUDE.md`
      // names. A repaired defect must delete its row; that deletion is the record of the win.
      if (deliberate) stale.push(row.in);
      else same++;
      continue;
    }
    if (deliberate) {
      console.log(`expected divergence ${JSON.stringify(row.in)}: ${KNOWN_DIVERGENCES[row.in]}`);
      continue;
    }
    if (family !== null) {
      defects.push({ input: row.in, wanted, actual, family });
      continue;
    }
    differences.push({ input: row.in, wanted, actual });
  }

  for (const key of Object.keys(OPEN_PORT_DEFECTS))
    if (!defects.some((d) => d.family === key)) stale.push(key);

  const known = Object.keys(KNOWN_DIVERGENCES).length - stale.filter((i) => Object.hasOwn(KNOWN_DIVERGENCES, i)).length;
  const families = Object.keys(OPEN_PORT_DEFECTS).filter((k) => defects.some((d) => d.family === k));
  console.log(`LocaleMatcher#parseLanguageRanges differential against ${LIBRARY} on the pinned JDK: ` +
    `${same}/${rows.length} identical, ${known} known divergence(s), ` +
    `${families.length} open port defect(s) over ${defects.length} probe(s), ${differences.length} unexplained; ` +
    `${registryVsJdk} probe(s) where the registry and the JDK's own LanguageRange.parse differ`);
  // FACTS for `diff:check` (no JDK): `registryVsJdk` of ZERO would mean the re-aim changed nothing
  // this space can see, and `regionVariantPairs` of zero that the ordered-pair check compared nothing.
  // `oracle` names the Java build: `diff:check` requires its `librarySourcesSha256` to be the corpus's.
  console.log(`##diff-facts ${JSON.stringify({
    exercised: { probes: rows.length, registryVsJdk, regionVariantPairs: portRegionVariant.length },
    defects: { unexplained: differences.length },
    oracle: { library: LIBRARY, librarySourcesSha256: LIBRARY_SOURCES_SHA256 },
  })}`);

  const show = (/** @type {{input: string, wanted: unknown, actual: unknown}} */ d) =>
    console.log(`\n  ${JSON.stringify(d.input)}\n    java ${JSON.stringify(d.wanted)}\n    js   ${JSON.stringify(d.actual)}`);

  if (defects.length) {
    console.log(`\nOPEN PORT DEFECTS (${families.length}) — triaged, root cause known, NOT fixed here.`);
    console.log(`See OPEN_PORT_DEFECTS in this file for each family's root cause.`);
    for (const key of families) {
      const members = defects.filter((d) => d.family === key);
      console.log(`\n[${key}] ${OPEN_PORT_DEFECTS[key]}`);
      console.log(`  ${members.length} diverging probe(s) in this family:`);
      for (const d of members) show(d);
    }
  }
  if (differences.length) {
    console.log(`\nDIFFERENCES (${differences.length}):`);
    for (const d of differences.slice(0, 12)) show(d);
  }
  for (const input of stale)
    console.log(`STALE: ${JSON.stringify(input)} no longer diverges — remove it from its table`);
  const fieldProblems = oracleFieldProblems("language-range", recorder, UNCOMPARED_ORACLE_FIELDS);
  if (fieldProblems.length) {
    console.log(`\nORACLE FIELD COVERAGE (${fieldProblems.length}):`);
    for (const problem of fieldProblems) console.log(`  ${problem}`);
  }

  process.exit(differences.length === 0 && defects.length === 0 && stale.length === 0
    && fieldProblems.length === 0 ? 0 : 1);
}

/**
 * `Double.toString`, re-spelled here rather than imported.
 *
 * The module under test spells it too, for the `weight=…` message the corpus records verbatim. If
 * this differential imported that copy, a wrong `Double.toString` would agree with itself on both
 * sides and the check would confirm nothing — the `zh-123` shape, in the harness rather than in the
 * input. Two independent spellings is the point.
 *
 * @param {number} value
 * @returns {string}
 */
function doubleText(value) {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  const magnitude = Math.abs(value);
  if (magnitude === 0) return `${sign}0.0`;
  if (magnitude >= 1e-3 && magnitude < 1e7) {
    const text = String(magnitude);
    return sign + (text.includes(".") ? text : `${text}.0`);
  }
  const [mantissa, exponent] = magnitude.toExponential().split("e");
  return `${sign}${String(mantissa).includes(".") ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
}
