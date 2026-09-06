#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests `lokalized/negotiate`'s `parseLanguageRanges` against the REAL
 * `java.util.Locale.LanguageRange.parse` on the pinned JDK.
 *
 * WHY THIS EXISTS, when 2,303 recorded cases already run. A4 is the one slice the corpus cannot
 * verify. `sun.util.locale.LocaleEquivalentMaps.regionVariantEquivMap` rewrites a REGION or VARIANT
 * subtag — `de-DE` gains `de-dd`, `fr-FR` gains `fr-fx`, `ja-heploc` gains `ja-alalc97` — and NO
 * fixture in the corpus loads such a catalog and NO case supplies such a range. Delete the whole map
 * and every recorded row stays green. The same is true of the map's ITERATION ORDER, which decides
 * the answer for a range carrying two of its subtags, and of `getExtentionKeyIndex`, which suppresses
 * it inside a singleton extension. Each of those is a silent answer change in a real request handler.
 *
 * So the oracle here is the JDK method itself, on the probe space the corpus does not reach:
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
 * Those four are now CLOSED at the source: `lokalized-spec/tools/iana-oracle/candidates.mjs` seeds
 * its probe space from the same JDK keys, `build.mjs` asserts that every one of them produced a
 * closure entry, and the re-pinned artifact carries 806 classes instead of 802. `OPEN_PORT_DEFECTS`
 * is empty as a result, and its emptiness is a measurement — the four entries had to be deleted in
 * the same change, because their own staleness check fails the run once they stop diverging.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const specDir = process.env.LOKALIZED_SPEC_DIR ? resolve(process.env.LOKALIZED_SPEC_DIR) : resolve(root, "../lokalized-spec");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}

/**
 * The fourteen region/variant subtags, which is what the corpus never reaches.
 *
 * Hand-typed, but no longer TRUSTED: section (2c) below re-derives this list from the JDK's own
 * `regionVariantEquivMap` on every run and aborts if it has drifted. Before that check existed this
 * array and the port's `REGION_VARIANT_EQUIVALENTS` were two independent transcriptions verified once
 * by hand — the same "probe space is a guess" shape as the four language keys this tool caught, and
 * one that had already been mis-enumerated once as thirteen subtags with `-zr` missing.
 */
const REGION_VARIANT = ["-alalc97", "-bu", "-cd", "-dd", "-de", "-fr", "-fx", "-heploc", "-mm", "-tl", "-tp", "-yd", "-ye", "-zr"];

/**
 * The port's `REGION_VARIANT_EQUIVALENTS`, read out of its source text.
 *
 * Read rather than imported because the table is module-private in `src/negotiate/index.js` and must
 * stay that way — exporting it to make this check convenient would add a public symbol that
 * `symbol-allowlist.json` does not permit, which is a worse trade than parsing a literal. THROWS if
 * the literal cannot be found: a check that silently compares against an empty list has stopped
 * checking, which is the failure this whole section exists to prevent.
 *
 * @returns {[string, string][]}
 */
function portRegionVariantEquivalents() {
  const source = readFileSync(join(root, "src/negotiate/index.js"), "utf8");
  const literal = /const REGION_VARIANT_EQUIVALENTS = \[([\s\S]*?)\];/.exec(source);
  if (!literal)
    throw new Error(
      "could not find `const REGION_VARIANT_EQUIVALENTS = [...]` in src/negotiate/index.js; " +
        "this differential's region/variant check would compare against nothing",
    );

  const pairs = [...literal[1].matchAll(/\["(-[a-z0-9]+)",\s*"(-[a-z0-9]+)"\]/g)].map(
    (match) => /** @type {[string, string]} */ ([match[1], match[2]]),
  );
  if (pairs.length === 0)
    throw new Error("REGION_VARIANT_EQUIVALENTS was found but parsed to zero pairs");

  return pairs;
}

/**
 * Every string the corpus hands to `LanguageRange.parse`, plus the probes it never reaches.
 *
 * @param {string[]} jdkKeys every key of the JDK's own equivalence tables, from the oracle itself
 */
function inputs(jdkKeys) {
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

  // (2) The pinned closure, bare and suffixed. `-hans`, `-us`, `-1901` and `-x-a` are a script, a
  // region, a variant and a singleton extension — the four shapes that make the prefix walk, the
  // region/variant map and `getExtentionKeyIndex` disagree with each other.
  const closure = JSON.parse(readFileSync(join(specDir, "generated/iana-language-range-equivalents.json"), "utf8"));
  const keys = Object.keys(closure.equivalents ?? closure);

  // (2b) AND the JDK's OWN keys, which is not the same set and is the one that matters.
  //
  // Deriving the probe space from the pinned artifact alone is the `zh-123` shape at the level of the
  // harness: a key the artifact is MISSING is a key the differential never asks about, so the one
  // failure mode the artifact actually has is the one failure mode the space cannot see. It had four.
  // The JDK's table is the oracle, so the oracle names the probes.
  for (const key of [...keys, ...jdkKeys]) {
    set.add(key);
    // `-hans`/`-hant` are scripts that are THEMSELVES part of longer keys (`cmn-hans`), which is how
    // the prefix walk's early return becomes observable; `-us`, `-1901` and `-x-a` are a region, a
    // variant and a singleton extension, where no longer key exists and the walk must fall through.
    for (const suffix of ["-hans", "-hant", "-us", "-1901", "-x-a"]) set.add(key + suffix);
  }

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
 * THE FIX, landed in the spec repo and measured rather than argued: `candidates.mjs` now seeds its
 * space from the JDK's own equivalence-map keys — the same reflection this differential does, on the
 * JDK's INPUT data rather than on the artifact under test — and `build.mjs` now ASSERTS that every
 * one of the 769 produced a closure entry, so the artifact can no longer be blind to its own gaps.
 * Re-extracting added exactly those 4 entries (802 -> 806, raw closure 18,371 -> 18,375) and changed
 * or removed nothing else. `lokalized-js/tools/gen-iana-data.js` re-emits
 * `src/data/iana-range-equivalents.js` from the re-pinned artifact.
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
try {
  const classesOut = join(work, "classes");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-d", classesOut, join(here, "LanguageRangeDiff.java")], { encoding: "utf8" });
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);

  // `LocaleEquivalentMaps` is JDK-internal, so reading its key set needs the module opened. Both flags
  // are required: `--add-exports` to name the class, `--add-opens` for `setAccessible`.
  const OPENS = ["--add-exports", "java.base/sun.util.locale=ALL-UNNAMED", "--add-opens", "java.base/sun.util.locale=ALL-UNNAMED"];
  const keysPath = join(work, "jdk-keys.txt");
  const regionPath = join(work, "jdk-region-variant.txt");
  const keyRun = spawnSync(join(JDK, "bin/java"), [...OPENS, "-cp", classesOut, "com.lokalized.LanguageRangeDiff", "--keys", keysPath, regionPath], { encoding: "utf8" });
  if (keyRun.status !== 0) throw new Error(`could not read the JDK's own equivalence keys, so the probe space would be incomplete:\n${keyRun.stderr}`);
  const jdkKeys = readFileSync(keysPath, "utf8").split("\n").filter(Boolean);

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

  const portRegionVariant = portRegionVariantEquivalents();
  if (JSON.stringify(portRegionVariant) !== JSON.stringify(jdkRegionVariant))
    throw new Error(
      `src/negotiate/index.js's REGION_VARIANT_EQUIVALENTS does not match the pinned JDK's ` +
        `regionVariantEquivMap, compared as an ordered list of pairs.\n` +
        `  JDK  (${jdkRegionVariant.length}): ${jdkRegionVariant.map((p) => p.join("=")).join(" ")}\n` +
        `  port (${portRegionVariant.length}): ${portRegionVariant.map((p) => p.join("=")).join(" ")}`,
    );

  const probes = inputs(jdkKeys);

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

  const run = spawnSync(join(JDK, "bin/java"), ["-cp", classesOut, "com.lokalized.LanguageRangeDiff", inPath, outPath], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`oracle execution failed:\n${run.stderr}`);

  const { parseLanguageRanges } = await import("../../src/negotiate/index.js");
  const rows = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  let same = 0;
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
      actual = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const wanted = row.ok ? { ok: true, ranges: row.ranges } : { ok: false, error: row.error };
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
  console.log(`Locale.LanguageRange.parse differential against Java on the pinned JDK: ` +
    `${same}/${rows.length} identical, ${known} known divergence(s), ` +
    `${families.length} open port defect(s) over ${defects.length} probe(s), ${differences.length} unexplained`);

  const show = (/** @type {{input: string, wanted: unknown, actual: unknown}} */ d) =>
    console.log(`\n  ${JSON.stringify(d.input)}\n    java ${JSON.stringify(d.wanted)}\n    js   ${JSON.stringify(d.actual)}`);

  if (defects.length) {
    console.log(`\nOPEN PORT DEFECTS (${families.length}) — triaged, root cause known, NOT fixed here.`);
    console.log(`Root cause: lokalized-spec/tools/iana-oracle/candidates.mjs never probes these ranges,`);
    console.log(`so they are missing from the pinned closure. See OPEN_PORT_DEFECTS in this file.`);
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
  process.exit(differences.length === 0 && defects.length === 0 && stale.length === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
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
