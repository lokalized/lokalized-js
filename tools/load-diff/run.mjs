#!/usr/bin/env node
// @ts-check
/**
 * `diff:load` — the NINTH differential, and the first that drives a real filesystem.
 *
 * WHAT IT COMPARES AND WHY THE CORPUS CANNOT. The 145 `load` cases record this same Java method, so
 * the obvious question is what a differential adds. Seven answers, each MEASURED rather than supposed:
 *
 *   1. the discovery-budget charge on entries that are then SKIPPED;
 *   2. the child-directory skip — no corpus fixture contains a child directory at all;
 *   3. the syntactic tag pre-filter — ablating it turns 0 required cases red;
 *   4. cross-file budget aggregation — no case combines multiple warnings with multiple files, and
 *      every byte/translation-node fixture is single-file, so a port using a FRESH session per file
 *      scores identically on all 145;
 *   5. cross-file warning ORDER — no case has more than one distinct warning source;
 *   6. THE PATH CONVENTION. `VectorOracle.withoutTemporaryPaths` scrubs every absolute path in every
 *      recorded diagnostic to `<fixtures>/`, which is right for a byte-stable artifact and which
 *      erases the three different renderings Java uses in ONE load. Ablating `toRealPath` out of a
 *      prototype left the corpus at 140/145. Here BOTH SIDES ARE HANDED THE SAME DIRECTORY, so
 *      nothing needs scrubbing and the paths are compared verbatim.
 *   7. THE PARSED CONTENT BEHIND EACH KEY — `contentByLocale`, the newest column. Every other column
 *      is about WHICH files were read and what the loader SAID about them; not one of them looks at
 *      what was actually parsed, so a port that agreed on every locale, key, warning and refusal
 *      message could still have built a different message behind the key and this tool printed
 *      `40 identical`.
 *
 * **THE EVIDENCE THAT COLUMN 7 IS LOAD-BEARING RATHER THAN DECORATION, measured 2026-09-15 on the
 * pinned JDK.** Five port-side mutations of `projectNode` in `src/internal/parse-file.js` — dropping
 * `commentary`, dropping a language-form placeholder's `range`, rebuilding the placeholder map in
 * sorted order, sorting the whole-message alternative list, and sorting a placeholder's per-form
 * translations — were each applied ALONE, in a copy of the tree:
 *
 *   - with THIS tool: exit 1, `MISMATCHES (1)`, naming `parsed-content-is-compared`, all five;
 *   - with the tool AS IT WAS BEFORE the column, same mutation still in place: exit 0,
 *     `40 identical`, all five. That is what makes the blind spot real rather than asserted;
 *   - `npm run conformance` under each: exit 0, 2,117 passed / 0 FAILED, and BYTE-IDENTICAL to the
 *     un-ablated run (`diff` empty, all five). The corpus cannot see any of them.
 *
 * Controls, both sides: pristine source reads exit 0 / `40 identical` on the old tool and exit 0 /
 * `41 identical` on this one.
 *
 * **AND THE COLUMN DISCRIMINATES ONLY OVER THE GRAPH A PROBE ACTUALLY LOADS**, which is a narrower
 * claim than "41 probes agree" and is why `CONTENT_DISCRIMINATORS` below fails the run when a
 * discriminating input leaves the probe space. Ablated: deleting the one rich probe leaves the other
 * 40 comparing normally and exits 1 with `DEGENERATE PROBE SET (8)`.
 *
 * THE HARD CONSTRAINT, stated at the top because violating it produces exactly the instrument this
 * project has been burned by. Java's enumeration order is the filesystem's, not sorted, and the
 * loader is EAGER and single-pass — so in a directory with MORE THAN ONE fault, whichever the walk
 * reaches first decides the outcome, and no JS runtime reproduces that order. **Every probe here
 * must be SINGLE-FAULT.** A probe whose answer depends on visit order would be green or red
 * according to the host filesystem, which is not a comparison at all.
 *
 * **SINGLE-FAULTEDNESS IS A CONVENTION HERE, NOT AN ENFORCEMENT, and this sentence used to say the
 * opposite.** It ended "`assertSingleFault` below is the enforcement, not the convention" and there
 * was no such function — one grep hit, in the comment claiming it existed. That is the eighth text
 * in this project found asserting its own enforcement, the same shape as `src/core/index.js` once
 * naming a test file that did not exist.
 *
 * **A MECHANICAL ENFORCEMENT WAS ATTEMPTED AND MEASURED INERT, which is why none ships.** The
 * candidate was: re-materialize every probe with its directory entries created in REVERSE order and
 * require the port's observation to be byte-identical. It runs clean over all 40 probes — and it
 * stays clean when the port's own `entries.sort(byUtf8Bytes)` is ABLATED AWAY, because `readdirSync`
 * on this host returns a stable order regardless of creation order. A check that cannot fail on the
 * machine that runs it is worse than none, so it was removed rather than shipped green.
 *
 * What remains is each probe's `discriminates` line, which says why it is single-fault where that is
 * not obvious. Whoever finds a real enforcement should replace this paragraph with it.
 *
 * **THE SCOPE OF WHAT THIS TOOL MAY ASSERT, which plan :2585 bounds and which belongs here rather
 * than being discovered when a comparison goes red.** The sentence is: "a full Java catalog compared
 * with the exact JS loaded set ONLY where both have the same candidate availability. Arbitrary
 * full-vs-subset equality is not claimed."
 *
 * Availability is equal here BY CONSTRUCTION, and that is worth stating precisely rather than
 * trusting: both sides are handed ONE directory and both read ALL of it — Java through
 * `loadFromFilesystem`, the port through `readStringsFromDirectory`. The port's SUBSET doors
 * (`loadStrings` and its siblings) fetch a candidate chain and nothing else, and comparing one of
 * those against a full Java load is exactly the equality the plan declines. Two things hold the
 * construction, because "by construction" is a claim like any other:
 *
 *   - PER PROBE, the two loaded catalog SETS are compared FIRST, and a divergence is reported as OUT
 *     OF SCOPE with both sets named — the content columns are not consulted at all. Before this, a
 *     difference in availability arrived as several content mismatches, which is the tool asserting
 *     precisely what the plan says it may not;
 *   - STRUCTURALLY, the run fails if this file calls a subset door at all, which is the edit that
 *     would break the bound everywhere at once rather than probe by probe.
 *
 * **AND THE COUNT IS RECORDED, WHICH IS THE HALF TWO EARLIER ATTEMPTS AT THIS CLAUSE LACKED.** This
 * tool needs the JDK, so it runs in neither `verify` nor CI; S17's attempt was rejected because
 * reverting the instrument while leaving its test in place left `npm test` green and `diff:check` at
 * exit 0 — **nothing could tell a wired instrument from an inert one.** The `##diff-facts` line below
 * carries `scopeChecked` into `measurements/differentials.json`, and `diff:check` — which has no Java
 * and IS in `verify` and CI — fails when an exercised count reaches zero. Measured 2026-09-17:
 * 21 of the 41 probes have both sides loading, so 21 is the in-scope population and the other 20 are
 * refusals, where availability is not a question anyone can ask.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PROBES } from "./probes.mjs";
import { oracleFieldProblems, recordingOracleRows } from "../oracle-field-coverage.mjs";

/**
 * Emitted by the Java oracle and deliberately NOT compared, each with the reason it cannot be.
 * Checked in BOTH directions by `oracleFieldProblems`.
 */
const UNCOMPARED_ORACLE_FIELDS = {};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const javaDir = join(root, "..", "lokalized-java");
const JAR = process.env.LOKALIZED_JAR ?? join(javaDir, "target/lokalized-3.0.0.jar");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}
if (!existsSync(JAR)) {
  console.error(`the oracle jar is missing at ${JAR}\nbuild lokalized-java, or set LOKALIZED_JAR`);
  process.exit(2);
}

/**
 * The Java-side surface this tool models, asserted rather than assumed.
 *
 * `diff:likely-subtag` does the same thing for its two table reads, and the reason is the same: a
 * differential silently stops testing what it claims the moment the oracle moves underneath it.
 * Each entry is a substring that MUST still appear in the Java source; a miss exits 2 naming it,
 * rather than producing a green run over a method that no longer exists.
 */
const JAVA_INVENTORY = [
  ["LocalizedStringLoader.java", "loadFromFilesystem(@NonNull Path directory"],
  ["LocalizedStringLoader.java", "exists but is not a directory"],
  // NOTE the `%s`: the suffix in this sentence is INTERPOLATED from a lowercase constant, not from
  // the file's own spelling — which is why `ZZ.JSON` still reads "ends with .json". A port echoing
  // the actual suffix would diverge on every uppercase name, and the first draft of this inventory
  // asserted the rendered sentence and so failed against the source it claimed to model.
  ["LocalizedStringLoader.java", "ends with %s but is not named with a valid IETF BCP 47 language tag"],
  ["LocalizedStringLoader.java", "Duplicate localized strings file for locale"],
  ["LocalizedStringLoader.java", "Duplicate locale key rendering as language tag"],
  ["LocalizedStringLoader.java", "discovery entries"],
  ["LocalizedStringLoader.java", "is not a regular file"],
  // THE THREE ORDER CLAIMS the parsed-content column rests on. `LoadDiff.describe` emits placeholders,
  // per-form translations and both alternative lists as ARRAYS precisely because Java preserves the
  // file's declaration order in each; if any of these became a sorted or hashed map on the Java side,
  // the column would be comparing an order the oracle no longer has and would still print `identical`.
  ["LocalizedStringLoader.java", "Map<@NonNull String, @NonNull PlaceholderDefinition> placeholderDefinitions = new LinkedHashMap<>();"],
  ["LocalizedStringLoader.java", "Map<@NonNull LanguageForm, @NonNull String> translationsByLanguageForm = new LinkedHashMap<>();"],
  ["LocalizedStringLoader.java", "array order defines first-match precedence"],
  // AND THE ONE ORDER THAT IS NOT A CLAIM: the loader collects a file's strings into a HashSet, which
  // is why `describe`'s rows are keyed in sorted key order rather than in the set's iteration order.
  ["LocalizedStringLoader.java", "Set<@NonNull LocalizedString> localizedStrings = new HashSet<>();"],
  // The file-format spellings `LoadDiff.fileFormatName` emits. `LocalizedStringUtils` is
  // package-private, so the harness carries its own instanceof chain; these assert that chain has not
  // gone stale. A moved prefix would otherwise make both sides agree on a name no file format uses.
  ["LocalizedStringUtils.java", 'CARDINALITY_NAME_PREFIX = "CARDINALITY_"'],
  ["LocalizedStringUtils.java", 'ORDINALITY_NAME_PREFIX = "ORDINALITY_"'],
  ["LocalizedStringUtils.java", 'GENDER_NAME_PREFIX = "GENDER_"'],
  ["LocalizedStringUtils.java", 'GRAMMATICAL_CASE_NAME_PREFIX = "CASE_"'],
  ["LocalizedStringUtils.java", 'DEFINITENESS_NAME_PREFIX = "DEFINITENESS_"'],
  ["LocalizedStringUtils.java", 'CLASSIFIER_NAME_PREFIX = "CLASSIFIER_"'],
  ["LocalizedStringUtils.java", 'FORMALITY_NAME_PREFIX = "FORMALITY_"'],
  ["LocalizedStringUtils.java", 'CLUSIVITY_NAME_PREFIX = "CLUSIVITY_"'],
  ["LocalizedStringUtils.java", 'ANIMACY_NAME_PREFIX = "ANIMACY_"'],
  ["LocalizedStringUtils.java", 'PHONETIC_NAME_PREFIX = "PHONETIC_"'],
];

for (const [file, fragment] of JAVA_INVENTORY) {
  const path = join(javaDir, "src/main/java/com/lokalized", file);
  if (!existsSync(path) || !readFileSync(path, "utf8").includes(fragment)) {
    console.error(`JAVA INVENTORY MISS — ${file} no longer contains:\n  ${fragment}\n` +
      `This tool models a surface that has moved; fix the model rather than the assertion.`);
    process.exit(2);
  }
}

/**
 * Java raises ONE exception type for every loading failure; the port raises its JS-named equivalent.
 * Declared here rather than compared loosely — an unmapped Java type is a failure, never a pass.
 */
const FAILURE_COUNTERPART = {
  "com.lokalized.LocalizedStringLoadingException": "StringsParseError",
  "java.lang.IllegalArgumentException": "RangeError",
  "java.lang.NullPointerException": "TypeError",
};

const workRoot = mkdtempSync(join(tmpdir(), "lokalized-load-diff-"));

/**
 * Bodies that live OUTSIDE any probe directory, so two entries can resolve to ONE real path.
 *
 * This is what makes the cross-file budget probes order-INDEPENDENT, and it replaces a narrowing.
 * An aggregate budget refuses at whichever file the walk reached second and interpolates THAT file's
 * resolved path — an order-dependent slot, since Java enumerates in filesystem order and no JS
 * runtime reproduces it. Point both names at one external target and both resolve to the same
 * realpath, so the message is identical whichever was visited second: the slot stops being a
 * variable instead of being masked out of the comparison. The locale still comes from the FILE NAME,
 * so the probe is still two locales — it is one inode, not one entry.
 */
const payloadRoot = join(workRoot, "_payloads");
mkdirSync(payloadRoot, { recursive: true });

/** Materialize one probe. Files whose body is `null` become DIRECTORIES; `@->target` becomes a symlink. */
function materialize(probe) {
  for (const [name, body] of Object.entries(probe.payloads ?? {}))
    writeFileSync(join(payloadRoot, `${probe.name}-${name}`), body);

  const directory = join(workRoot, probe.name);
  mkdirSync(directory, { recursive: true });
  for (const [name, body] of Object.entries(probe.files)) {
    const path = join(directory, name);
    if (body === null) mkdirSync(path, { recursive: true });
    else if (typeof body === "string" && body.startsWith("@payload:"))
      symlinkSync(join(payloadRoot, `${probe.name}-${body.slice("@payload:".length)}`), path);
    else if (typeof body === "string" && body.startsWith("@->")) symlinkSync(body.slice(3), path);
    else writeFileSync(path, body);
  }
  return directory;
}

/**
 * The path actually handed to the loader.
 *
 * Usually the probe directory itself, but a probe may name a `root` INSIDE it — which is the only
 * way to exercise the two directory-level preconditions and the symlinked-root case, since those
 * need the argument to be something other than a plain readable directory.
 */
const loadTargetFor = (probe, directory) => (probe.root ? join(directory, probe.root) : directory);

const compiled = join(workRoot, "classes");
mkdirSync(compiled, { recursive: true });
const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", JAR, "-d", compiled, join(here, "LoadDiff.java")],
  { encoding: "utf8" });
if (compile.status !== 0) {
  console.error(`could not compile the Java half:\n${compile.stderr}`);
  process.exit(2);
}

const directories = new Map(PROBES.map((probe) => [probe.name, materialize(probe)]));
const specPath = join(workRoot, "probes.tsv");
writeFileSync(
  specPath,
  PROBES.map((probe) => [
    probe.name,
    loadTargetFor(probe, /** @type {string} */ (directories.get(probe.name))),
    Object.entries(probe.options ?? {}).map(([k, v]) => `${k}=${v}`).join(","),
  ].join("\t")).join("\n") + "\n",
  "utf8",
);

const javaRun = spawnSync(join(JDK, "bin/java"), ["-cp", `${compiled}:${JAR}`, "LoadDiff", specPath],
  { encoding: "utf8", maxBuffer: 1 << 28 });
if (javaRun.status !== 0) {
  console.error(`the Java half failed:\n${javaRun.stderr}`);
  process.exit(2);
}
// THE ORACLE'S OWN FIELDS, OBSERVED RATHER THAN ASSUMED — see tools/oracle-field-coverage.mjs. The
// defect it guards against has been found in three separate differentials, always the same shape:
// the Java side emits a column and the runner never reads it, so the tool is green over a real
// divergence in the behaviour it was built to guard.
const loadRecorder = recordingOracleRows(
  javaRun.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
const javaByName = new Map(loadRecorder.rows.map((row) => [row.name, row]));

const { readStringsFromDirectory } = await import(join(root, "src/node/index.js"));
const { ordinalData } = await import(join(root, "src/data/ordinal.js"));

/**
 * The port's model of ONE loaded string, in the SAME shape `LoadDiff.describe` emits.
 *
 * REBUILT INDEPENDENTLY rather than serialized from the port's own projection, which is the point of
 * a differential: `src/internal/parse-file.js` and this function are two descriptions of the same
 * graph, and only the Java side arbitrates between them.
 *
 * ABSENT-VS-NULL IS NORMALIZED HERE AND NOWHERE ELSE. The port OMITS an optional member it does not
 * have (`projectNode` spreads conditionally) while Java writes an explicit `null`, and `canonical`
 * sorts object keys without reconciling a missing key against a null one. So every optional member is
 * written out explicitly — `translation`, `commentary`, `value`, `range` — rather than spread.
 *
 * The four declaration ORDERS are lists, matching the Java half, because `canonical` sorts object
 * keys and an order carried by a map would not be compared at all.
 */
function describePort(node) {
  const placeholders = [];
  for (const [name, placeholder] of Object.entries(node.placeholders ?? {})) {
    if (placeholder.kind === "language-form")
      placeholders.push({
        name,
        kind: "language-form",
        value: placeholder.value ?? null,
        range: placeholder.range ? { start: placeholder.range.start, end: placeholder.range.end } : null,
        translations: Object.entries(placeholder.translations).map(([form, translation]) => ({ form, translation })),
      });
    else
      placeholders.push({
        name,
        kind: "expression",
        translation: placeholder.translation,
        alternatives: (placeholder.alternatives ?? []).map((alternative) => ({
          expression: alternative.expression,
          translation: alternative.translation,
        })),
      });
  }
  return {
    translation: node.translation ?? null,
    commentary: node.commentary ?? null,
    placeholders,
    alternatives: (node.alternatives ?? []).map((alternative) => ({
      expression: alternative.expression,
      ...describePort(alternative),
    })),
  };
}

/** The port's observation, in the SAME shape the Java half emits. */
function portObservation(probe, directory) {
  const warnings = [];
  const collect = (warning) => warnings.push({
    type: warning.type,
    source: warning.source,
    locale: warning.locale ?? null,
    key: warning.key ?? null,
    placeholder: warning.placeholder ?? null,
    missingLanguageForms: [...(warning.missingLanguageForms ?? [])].sort(),
    message: warning.message,
  });
  const { maximumDiscoveryEntries, ...limits } = probe.options ?? {};
  try {
    const loaded = readStringsFromDirectory(directory, {
      ...(Object.keys(limits).length ? { limits } : {}),
      ...(maximumDiscoveryEntries === undefined ? {} : { maximumDiscoveryEntries }),
      pluralData: { ordinal: ordinalData },
      onWarning: collect,
    });
    const locales = Object.keys(loaded.catalogs).sort();
    return {
      failed: false,
      failureType: null,
      failureMessage: null,
      locales,
      keysByLocale: Object.fromEntries(
        locales.map((tag) => [tag, loaded.catalogs[tag].strings.map((s) => s.key).sort()]),
      ),
      contentByLocale: Object.fromEntries(
        locales.map((tag) => [
          tag,
          Object.fromEntries(loaded.catalogs[tag].strings.map((s) => [s.key, describePort(s)])),
        ]),
      ),
      warnings,
    };
  } catch (error) {
    return {
      failed: true,
      failureType: error instanceof Error ? error.name : String(error),
      failureMessage: error instanceof Error ? error.message : String(error),
      locales: [],
      keysByLocale: {},
      contentByLocale: {},
      warnings,
    };
  }
}

/**
 * Mask the ONE thing in an aggregate-budget refusal that is genuinely undefined: WHICH file it names.
 *
 * An aggregate budget refuses at whichever file the walk reaches when the counter is already at the
 * limit, so the interpolated path is a function of enumeration order — and Java's order is the
 * filesystem's, which no JS runtime reproduces. Everything ELSE in the message is determinate: the
 * template, the limit value, and the fact that the load failed at all. Those are what discriminate a
 * shared session from a per-file one; a port with a fresh session per file does not produce a
 * different file name here, it SUCCEEDS.
 *
 * So this narrows one field rather than relaxing the comparison, and it carries its own guard: the
 * named path must be one of the probe's OWN files. A port that named something else — a stale path,
 * a directory, a file it never read — fails, because `named` comes back null and the probe reports
 * an unmasked message that cannot match.
 */
function maskOrderDependentFile(message, directory, probe) {
  if (message == null) return { masked: null, named: null };
  const resolved = realpathSync(directory);
  for (const name of Object.keys(probe.files)) {
    for (const prefix of new Set([directory, resolved])) {
      const full = join(prefix, name);
      if (message.includes(full))
        return { masked: message.split(full).join(`${prefix}/<file the walk reached second>`), named: name };
    }
  }
  return { masked: message, named: null };
}

const canonical = (value) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner);

let compared = 0;
const mismatches = [];
/** Probes whose two sides loaded DIFFERENT catalog sets — outside what plan :2585 lets this claim. */
const availabilityDivergences = [];
/** Probes where both sides loaded and the sets were compared and AGREED: the in-scope population. */
let scopeChecked = 0;
const unmapped = [];

for (const probe of PROBES) {
  const directory = /** @type {string} */ (directories.get(probe.name));
  const java = javaByName.get(probe.name);
  if (!java) {
    console.error(`the Java half produced no row for probe '${probe.name}'`);
    process.exit(2);
  }
  const port = portObservation(probe, loadTargetFor(probe, directory));
  ++compared;

  const counterpart = java.failureType === null ? null : FAILURE_COUNTERPART[java.failureType];
  if (java.failureType !== null && counterpart === undefined) {
    unmapped.push({ probe: probe.name, javaType: java.failureType });
    continue;
  }

  // Both sides saw the SAME directory, so paths are compared VERBATIM. Nothing is scrubbed here —
  // that is the whole reason this instrument can see the path convention the corpus cannot.
  let javaMessage = java.failureMessage;
  let portMessage = port.failureMessage;
  if (probe.namesAnOrderDependentFile) {
    // No probe sets this any more — the one-inode construction removed the need. Kept because a
    // future probe may genuinely need it, and it fails loudly if the named file is not the probe's.
    const fromJava = maskOrderDependentFile(javaMessage, directory, probe);
    const fromPort = maskOrderDependentFile(portMessage, directory, probe);
    if (fromJava.named === null || fromPort.named === null) {
      mismatches.push({
        probe: probe.name,
        discriminates: `${probe.discriminates} — AND the refusal must name one of this probe's own files`,
        wanted: { namedFile: fromJava.named, message: javaMessage },
        actual: { namedFile: fromPort.named, message: portMessage },
      });
      continue;
    }
    javaMessage = fromJava.masked;
    portMessage = fromPort.masked;
  }

  // THE SCOPE BOUND, CHECKED BEFORE ANYTHING DERIVED FROM IT. Plan :2585 permits "a full Java
  // catalog compared with the exact JS loaded set ONLY where both have the same candidate
  // availability", and refuses arbitrary full-vs-subset equality. Two loads that read different
  // catalogs have nothing comparable behind their keys, so a divergence HERE is reported as what it
  // is and the content columns are not consulted at all — where before it arrived as several content
  // mismatches the tool had no standing to claim. Only the both-loaded case is in scope: if one side
  // REFUSED and the other did not, that is a real disagreement about the load and belongs below.
  if (!java.failed && !port.failed && canonical(java.locales) !== canonical(port.locales)) {
    availabilityDivergences.push({
      probe: probe.name,
      discriminates: probe.discriminates,
      java: java.locales,
      port: port.locales,
    });
    continue;
  }
  if (!java.failed && !port.failed) scopeChecked++;

  const wanted = {
    failed: java.failed,
    failureType: counterpart,
    failureMessage: javaMessage,
    locales: java.locales,
    keysByLocale: java.keysByLocale,
    contentByLocale: java.contentByLocale,
    warnings: java.warnings,
  };
  const actual = { ...port, failureMessage: portMessage, failureType: port.failed ? port.failureType : null };

  if (canonical(actual) !== canonical(wanted))
    mismatches.push({ probe: probe.name, discriminates: probe.discriminates, wanted, actual });
}

/**
 * A probe set that never sees two different answers has established nothing.
 *
 * This is the `diff:interpolate` lesson made structural: that tool compared a predicate DIRECTLY
 * against the JDK, covered both branches of it, and was still green over a live defect because no
 * probe spelled `Zzzz`. Covering both arms is not discriminating the input that chooses between
 * them. So the run FAILS if the probe set is degenerate — if every probe succeeded, or every one
 * failed, or no probe produced a warning — because in each case a whole channel went unexercised.
 */
const observations = PROBES.map((probe) => javaByName.get(probe.name)).filter(Boolean);
const degenerate = [];
if (!observations.some((row) => row.failed)) degenerate.push("no probe makes Java REFUSE the load");
if (!observations.some((row) => !row.failed)) degenerate.push("no probe makes Java ACCEPT the load");
if (!observations.some((row) => row.warnings.length > 0)) degenerate.push("no probe produces a WARNING");
if (!observations.some((row) => row.locales.length > 1)) degenerate.push("no probe loads MORE THAN ONE locale");
if (!observations.some((row) => row.failed && row.warnings.length > 0))
  degenerate.push("no probe delivers a warning and THEN fails — the streaming rule is unexercised");

/**
 * THE PARSED-CONTENT COLUMN DISCRIMINATES ONLY OVER THE GRAPH THE PROBE SPACE ACTUALLY LOADS, and
 * that is a narrower thing than "41 probes agree".
 *
 * MEASURED, not supposed: delete `parsed-content-is-compared` from `probes.mjs` and the run exits 1
 * with `DEGENERATE PROBE SET (8)` — EIGHT of the nine terms below fire at once. The one that survives
 * is `a PLACEHOLDER`, from the warning fixtures. Commentary, ranges, both alternative lists and every
 * non-alphabetical declaration order are absent from the rest of the probe space entirely, so those
 * members of the column would be `null`/`[]` on both sides of all 40 other comparisons and would
 * agree for free. That is the `Zzzz` lesson — covering a branch is not discriminating it — and it is
 * why these are nine specific terms rather than one "some probe has content" check.
 *
 * EACH ROW IS THE STALE LINE FOR ONE MEASURED ABLATION. The five port-side ablations that prove this
 * column participates each need one specific input present, and each row below fires the moment that
 * input leaves the probe space:
 *
 *   commentary dropped                       needs a string carrying a COMMENTARY
 *   range member dropped                     needs a RANGE-driven placeholder
 *   placeholder map rebuilt in sorted order  needs two placeholders declared OUT of alphabetical order
 *   alternative list sorted                  needs two alternatives declared OUT of sorted order
 *   per-form translations sorted             needs two forms declared OUT of alphabetical order
 *
 * Declaration order is the subtle one: a probe whose placeholders happen to be declared `a` then `b`
 * is IDENTICAL under a port that sorts them, so "two placeholders" is not enough and "two
 * placeholders the wrong way round" is what the ablation needs. `declaredOutOfOrder` is that test.
 */
const contentEntries = (row) => {
  const entries = [];
  const walk = (entry) => {
    entries.push(entry);
    for (const alternative of entry.alternatives) walk(alternative);
  };
  for (const keyed of Object.values(row.contentByLocale ?? {}))
    for (const entry of Object.values(keyed)) walk(entry);
  return entries;
};

/** True when a declared sequence is long enough AND not in ascending order — see above. */
const declaredOutOfOrder = (names) =>
  names.length > 1 && names.some((name, index) => index > 0 && names[index - 1] > name);

const CONTENT_DISCRIMINATORS = [
  ["a PLACEHOLDER", (entry) => entry.placeholders.length > 0],
  ["a COMMENTARY", (entry) => entry.commentary !== null],
  ["a RANGE-driven placeholder", (entry) => entry.placeholders.some((row) => row.range !== null)],
  ["a WHOLE-MESSAGE ALTERNATIVE", (entry) => entry.alternatives.length > 0],
  ["a generated-placeholder FRAGMENT ALTERNATIVE",
    (entry) => entry.placeholders.some((row) => (row.alternatives ?? []).length > 0)],
  ["TWO placeholders declared OUT of alphabetical order",
    (entry) => declaredOutOfOrder(entry.placeholders.map((row) => row.name))],
  ["TWO per-form translations declared OUT of alphabetical order",
    (entry) => entry.placeholders.some((row) => declaredOutOfOrder((row.translations ?? []).map((t) => t.form)))],
  ["TWO whole-message alternatives declared OUT of sorted order",
    (entry) => declaredOutOfOrder(entry.alternatives.map((row) => row.expression))],
  ["TWO fragment alternatives declared OUT of sorted order",
    (entry) => entry.placeholders.some((row) => declaredOutOfOrder((row.alternatives ?? []).map((a) => a.expression)))],
];

for (const [what, holds] of CONTENT_DISCRIMINATORS)
  if (!observations.some((row) => contentEntries(row).some(holds)))
    degenerate.push(`no probe loads a string carrying ${what} —` +
      ` the parsed-content column agrees for free on that member`);

console.log(`diff:load — ${compared} probe(s) against lokalized-java 3.0.0 on the pinned JDK`);
console.log(`  probe directories under ${workRoot}`);

if (unmapped.length) {
  console.log(`\nUNMAPPED JAVA FAILURE TYPES (${unmapped.length}) — declare a counterpart or fix the probe:`);
  for (const row of unmapped) console.log(`  ${row.probe}: ${row.javaType}`);
}

if (degenerate.length) {
  console.log(`\nDEGENERATE PROBE SET (${degenerate.length}) — the comparison cannot mean what it claims:`);
  for (const reason of degenerate) console.log(`  ${reason}`);
}

if (mismatches.length) {
  console.log(`\nMISMATCHES (${mismatches.length}):`);
  for (const row of mismatches) {
    console.log(`\n  ${row.probe}`);
    console.log(`    exists to catch: ${row.discriminates}`);
    console.log(`    java ${canonical(row.wanted)}`);
    console.log(`    port ${canonical(row.actual)}`);
  }
} else if (!degenerate.length && !unmapped.length) {
  console.log(`\n  ${compared} identical — every probe's locales, keys, PARSED CONTENT, failure`);
  console.log(`  identity, verbatim message and full ordered warning list agree with the oracle.`);
}

if (availabilityDivergences.length) {
  console.log(`\nOUT OF SCOPE (${availabilityDivergences.length}) — the two sides loaded DIFFERENT`);
  console.log(`  catalog sets, so nothing behind their keys is comparable. Plan :2585 permits this`);
  console.log(`  comparison only where both have the same candidate availability:`);
  for (const row of availabilityDivergences) {
    console.log(`\n  ${row.probe}`);
    console.log(`    exists to catch: ${row.discriminates}`);
    console.log(`    java loaded ${JSON.stringify(row.java)}`);
    console.log(`    port loaded ${JSON.stringify(row.port)}`);
  }
}

/**
 * THE BOUND IS ALSO STRUCTURAL, and this is the edit that would quietly break it.
 *
 * Candidate availability is equal here BY CONSTRUCTION: both sides are handed one directory and
 * both read all of it, Java through `loadFromFilesystem` and the port through
 * `readStringsFromDirectory`. Pointing the port side at a SUBSET door — `loadStrings` and its
 * siblings fetch a candidate chain and nothing else — makes every comparison below the
 * full-vs-subset equality plan :2585 explicitly does not claim, and the per-probe rule above would
 * report it as dozens of out-of-scope probes rather than as the one mistake it is.
 */
const SUBSET_DOORS = ["loadStrings", "loadStringsFromDirectory", "loadStringsFromFiles"];
const selfSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
const subsetDoorsUsed = SUBSET_DOORS.filter((door) => new RegExp(`\\b${door}\\s*\\(`).test(selfSource));
if (subsetDoorsUsed.length) {
  console.log(`\nSCOPE BROKEN — this tool calls ${subsetDoorsUsed.join(", ")}, a subset door. Plan :2585`);
  console.log(`  does not claim full-vs-subset equality; both sides must read the whole directory.`);
}

const fieldProblems = oracleFieldProblems("load", loadRecorder, UNCOMPARED_ORACLE_FIELDS);
if (fieldProblems.length) {
  console.log(`\nORACLE FIELD COVERAGE (${fieldProblems.length}):`);
  for (const problem of fieldProblems) console.log(`  ${problem}`);
}

/**
 * FACTS ABOUT THIS RUN, for `measurements/differentials.json` to carry and `diff:check` to gate
 * WITHOUT a JDK.
 *
 * This is the hole M8 clause 66 was held on twice. `diff:load` needs Java, so it runs in neither
 * `verify` nor CI — and S17's attempt at this clause was rejected because reverting the instrument
 * while leaving its test in place left `npm test` green and `diff:check` at exit 0: **nothing could
 * tell a wired instrument from an inert one.** A headline cannot answer that; `scopeChecked: 0`
 * can, and it is a number the recorded artifact carries into a JDK-free run.
 */
console.log(`##diff-facts ${JSON.stringify({
  exercised: { probes: PROBES.length, compared, scopeChecked },
  defects: { availabilityDivergences: availabilityDivergences.length, subsetDoorsUsed: subsetDoorsUsed.length },
})}`);

process.exit(mismatches.length === 0 && degenerate.length === 0 && unmapped.length === 0
  && fieldProblems.length === 0 && availabilityDivergences.length === 0
  && subsetDoorsUsed.length === 0 ? 0 : 1);
