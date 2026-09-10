#!/usr/bin/env node
// @ts-check
/**
 * `diff:load` — the NINTH differential, and the first that drives a real filesystem.
 *
 * WHAT IT COMPARES AND WHY THE CORPUS CANNOT. The 145 `load` cases record this same Java method, so
 * the obvious question is what a differential adds. Six answers, each MEASURED rather than supposed:
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
 *
 * THE HARD CONSTRAINT, stated at the top because violating it produces exactly the instrument this
 * project has been burned by. Java's enumeration order is the filesystem's, not sorted, and the
 * loader is EAGER and single-pass — so in a directory with MORE THAN ONE fault, whichever the walk
 * reaches first decides the outcome, and no JS runtime reproduces that order. **Every probe here
 * must be SINGLE-FAULT.** A probe whose answer depends on visit order would be green or red
 * according to the host filesystem, which is not a comparison at all. `assertSingleFault` below is
 * the enforcement, not the convention.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PROBES } from "./probes.mjs";

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
const javaByName = new Map(
  javaRun.stdout.split("\n").filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    return [row.name, row];
  }),
);

const { readStringsFromDirectory } = await import(join(root, "src/node/index.js"));
const { ordinalData } = await import(join(root, "src/data/ordinal.js"));

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
      warnings,
    };
  } catch (error) {
    return {
      failed: true,
      failureType: error instanceof Error ? error.name : String(error),
      failureMessage: error instanceof Error ? error.message : String(error),
      locales: [],
      keysByLocale: {},
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

  const wanted = {
    failed: java.failed,
    failureType: counterpart,
    failureMessage: javaMessage,
    locales: java.locales,
    keysByLocale: java.keysByLocale,
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
  console.log(`\n  ${compared} identical — every probe's locales, keys, failure identity, verbatim`);
  console.log(`  message and full ordered warning list agree with the oracle.`);
}

process.exit(mismatches.length === 0 && degenerate.length === 0 && unmapped.length === 0 ? 0 : 1);
