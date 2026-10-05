#!/usr/bin/env node
// @ts-check
/**
 * Production data encoder: lokalized-spec's registry-generated IANA equivalences -> two modules.
 *
 *   src/data/iana-range-equivalents.js     the FULL language table (369 classes), negotiate only
 *   src/data/iana-identity-equivalents.js  the DIRECT-MATCH projection plus the 14 region/variant
 *                                          substitutions, reachable from the root
 *
 * SEPARATE FROM `tools/gen-data.js` ON PURPOSE. That tool reads the vendored CLDR JSON and emits the
 * fifteen CLDR-derived modules; this one reads a DIFFERENT pinned artifact —
 * `lokalized-spec generated/iana-language-equivalences.json`, generated from the pinned IANA Language
 * Subtag Registry snapshot with no JDK (amendment A30) — and emits the two modules that are not CLDR
 * data. Folding it into the CLDR encoder would put two provenances behind one banner and one
 * `--check`, and neither module carries the CLDR `/*!` stamp for that reason.
 *
 * THE ARTIFACT IS CONSUMED VERBATIM. Its `languageEquivalenceClasses` are ordered classes — the
 * member no record gives a Preferred-Value first, then registry first-named order — sorted by first
 * member, and a member's equivalents are its class minus itself, ORDER KEPT. That is exactly the
 * per-key table lokalized-java 3.1.0 renders, and the spec checks it key by key against the library.
 * An earlier design recovered classes by grouping a per-key map; that recovery is AMBIGUOUS for a
 * two-member class and disagreed with the registry's order in 115 of 369 classes, so this tool does
 * not reconstruct anything: it emits what the spec published and proves the module decodes back to it.
 *
 * THE PROJECTION, and why the root does not carry the full table. Core's automatic single-locale
 * matcher only ever expands an already-NORMALIZED locale tag and only ever compares against a
 * normalized catalog tag, so a member `normalizeTag` would rewrite (`zh-guoyu`, `ar-aao`, `i-ami`)
 * can neither be requested nor matched there. Keeping only members whose JDK spelling is unchanged
 * (`jdkLanguageTag(m).toLowerCase() === m`), and only classes left with two or more, keeps plan
 * 3.1/:1700's allocation — the full closure behind `lokalized/negotiate`, a derivative in the root —
 * at a third of the size. It is exact AS MEASURED, not by construction: `test/locale.test.js`
 * compares the single-locale door with the whole-list door over every registry subtag and suffix, and
 * pins the Java rows the shared expansion cannot see.
 *
 * Refused (exit 1 on data, exit 2 on shape; nothing is written):
 *   - a field missing or of the wrong shape, or the pre-A30 closure schema (`equivalents`);
 *   - a class with fewer than two distinct members, or a member in two classes, or classes not in
 *     bytewise order of their first member;
 *   - a region/variant pair not spelled `-subtag`, a repeated `from`, or a set not closed under
 *     reversal (the substitution is symmetric by rule R; a one-way pair is a transcription slip);
 *   - a SHADOW HAZARD: a full-table key that the projection dropped, one of whose strictly shorter
 *     hyphen-prefixes the projection kept. The single-locale door's walk would stop at that shorter
 *     prefix where the full walk stops at the key, and substitute at the wrong boundary;
 *   - a module that does not decode back to the artifact (classes and pairs, ORDER included), that
 *     is not byte-identical on regeneration, or whose decode shares mutable state between callers.
 *
 *   node tools/gen-iana-data.js --write
 *   node tools/gen-iana-data.js --check
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { jdkLanguageTag } from "../src/internal/locale-jdk-tag.js";
import { IANA_EQUIVALENCES_ARTIFACT, IANA_EQUIVALENCES_SCHEMA, specPath } from "./iana-artifact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = specPath(IANA_EQUIVALENCES_ARTIFACT);
const FULL_MODULE = "src/data/iana-range-equivalents.js";
const IDENTITY_MODULE = "src/data/iana-identity-equivalents.js";

/** @param {string} message @returns {never} */
function refuseShape(message) {
  console.error(`refusing: ${artifactPath}: ${message}`);
  process.exit(2);
}

if (!existsSync(artifactPath))
  refuseShape(`not found. Clone lokalized-spec as a sibling, or set LOKALIZED_SPEC_DIR.`);

/** @type {any} */
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

// THE PRE-A30 CLOSURE IS REFUSED BY NAME, not merely by a missing field: pointed at the old 818-entry
// closure, a reader that only checked for a field would say "missing languageEquivalenceClasses" and
// leave the reader to work out that it is looking at a retired format.
if (artifact !== null && typeof artifact === "object" && ("equivalents" in artifact || "jdkAbsentTags" in artifact))
  refuseShape("this is the retired probed closure (it carries `equivalents`/`jdkAbsentTags`); " +
    "A30 replaced it with the registry-generated classes. Update lokalized-spec.");
if (artifact?.formatVersion !== 1) refuseShape(`formatVersion is ${JSON.stringify(artifact?.formatVersion)}, not 1`);
if (artifact.schema !== IANA_EQUIVALENCES_SCHEMA)
  refuseShape(`schema is ${JSON.stringify(artifact.schema)}, not ${IANA_EQUIVALENCES_SCHEMA}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.registry?.fileDate ?? ""))
  refuseShape("registry.fileDate is missing or not YYYY-MM-DD");
if (!/^[0-9a-f]{64}$/.test(artifact.registry?.sha256 ?? ""))
  refuseShape("registry.sha256 is missing or not 64 lowercase hex digits");
if (!Array.isArray(artifact.languageEquivalenceClasses) ||
    !artifact.languageEquivalenceClasses.every((/** @type {unknown} */ members) =>
      Array.isArray(members) && members.every((member) => typeof member === "string")))
  refuseShape("languageEquivalenceClasses is missing or not an array of string arrays");
if (!Array.isArray(artifact.regionVariantEquivalents) ||
    !artifact.regionVariantEquivalents.every((/** @type {unknown} */ pair) =>
      Array.isArray(pair) && pair.length === 2 && pair.every((subtag) => typeof subtag === "string")))
  refuseShape("regionVariantEquivalents is missing or not an array of [from, to] string pairs");

/** @type {string[][]} */
const classes = artifact.languageEquivalenceClasses;
/** @type {[string, string][]} */
const pairs = artifact.regionVariantEquivalents;
const { fileDate, sha256: registrySha256 } = artifact.registry;

/** Bytewise order, which is the spec's sort ("sorted bytewise by member 0"). */
const bytewise = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);

/** @returns {string[]} every data problem, empty when the artifact is usable */
function dataProblems() {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, number>} */
  const owner = new Map();

  classes.forEach((members, index) => {
    if (new Set(members).size !== members.length || members.length < 2)
      problems.push(`class ${index} ${JSON.stringify(members)} does not hold two or more distinct members`);
    for (const member of members) {
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(member))
        problems.push(`class ${index} member ${JSON.stringify(member)} is not a lowercase hyphenated tag`);
      const first = owner.get(member);
      if (first !== undefined && first !== index)
        problems.push(`${member} is a member of class ${first} and class ${index}`);
      owner.set(member, index);
    }
    const previous = classes[index - 1];
    if (previous !== undefined && bytewise(/** @type {string} */ (previous[0]), /** @type {string} */ (members[0])) >= 0)
      problems.push(`classes are not in bytewise order of their first member at ${members[0]}`);
  });

  const seenFrom = new Set();
  for (const [from, to] of pairs) {
    if (!/^-[a-z0-9]+$/.test(from) || !/^-[a-z0-9]+$/.test(to))
      problems.push(`region/variant pair ${JSON.stringify([from, to])} is not two "-subtag" spellings`);
    if (seenFrom.has(from)) problems.push(`region/variant pair from ${from} appears twice`);
    seenFrom.add(from);
    if (!pairs.some(([back, forth]) => back === to && forth === from))
      problems.push(`region/variant pair ${from} -> ${to} has no reverse ${to} -> ${from}`);
  }
  if (pairs.length === 0) problems.push("regionVariantEquivalents is empty");

  return problems;
}

/**
 * The direct-match projection: members the port's `normalizeTag` leaves unchanged, classes that keep
 * two or more of them, order preserved.
 * @returns {string[][]}
 */
function projection() {
  return classes
    .map((members) => members.filter((member) => jdkLanguageTag(member).toLowerCase() === member))
    .filter((members) => members.length >= 2);
}

/** @param {string[][]} projected @returns {string[]} */
function shadowHazards(projected) {
  const kept = new Set(projected.flat());
  /** @type {string[]} */
  const hazards = [];
  for (const members of classes)
    for (const key of members) {
      if (kept.has(key)) continue;
      for (let index = key.lastIndexOf("-"); index > 0; index = key.lastIndexOf("-", index - 1))
        if (kept.has(key.slice(0, index))) {
          hazards.push(`${key} (dropped) has the kept prefix ${key.slice(0, index)}`);
          break;
        }
    }
  return hazards;
}

const problems = dataProblems();
if (problems.length > 0) {
  console.error(`refusing: ${problems.length} problem(s) in ${artifactPath}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const identityClasses = projection();
const hazards = shadowHazards(identityClasses);
if (hazards.length > 0) {
  console.error(`refusing: ${hazards.length} shadow hazard(s) in the direct-match projection:`);
  for (const hazard of hazards) console.error(`  ${hazard}`);
  process.exit(1);
}

const provenance =
  `// Source: the IANA Language Subtag Registry, File-Date ${fileDate}, sha256 ${registrySha256},\n` +
  `// through lokalized-spec ${IANA_EQUIVALENCES_ARTIFACT} (schema ${IANA_EQUIVALENCES_SCHEMA}),\n` +
  `// generated there with no JDK (amendment A30). See lokalized-spec generated/IANA-PROVENANCE.md.\n`;

/** The decode both modules share, so a class is expanded one way everywhere. */
const decodeSource = (/** @type {string} */ name) =>
  `/** @returns {Map<string, string[]>} each member to the OTHER members of its class, in class order; fresh arrays per call */\n` +
  `export const ${name} = () => {\n` +
  `  /** @type {Map<string, string[]>} */\n` +
  `  const table = new Map();\n` +
  `  for (const members of C) for (const key of members) table.set(key, members.filter((member) => member !== key));\n` +
  `  return table;\n` +
  `};\n`;

const fullText =
  `// Generated by tools/gen-iana-data.js from lokalized-spec ${IANA_EQUIVALENCES_ARTIFACT}. Do not edit by hand.\n` +
  provenance +
  `// ${classes.flat().length} language subtags in ${classes.length} equivalence classes, each in the registry's order:\n` +
  `// the member no record gives a Preferred-Value first, then the order the registry first names them.\n` +
  `//\n` +
  `// NOT reachable from src/index.js: the whole-list negotiator and its tables live behind\n` +
  `// lokalized/negotiate by plan 3.1, and test/pinned-data-only.test.js names this file to keep it there.\n` +
  `/** @type {string[][]} */\n` +
  `const C = ${JSON.stringify(classes)};\n` +
  decodeSource("decodeLanguageEquivalents");

const identityText =
  `// Generated by tools/gen-iana-data.js from lokalized-spec ${IANA_EQUIVALENCES_ARTIFACT}. Do not edit by hand.\n` +
  provenance +
  `// The direct-match derivative: the ${identityClasses.length} classes that keep two or more members once every member\n` +
  `// the port's normalizeTag would rewrite is dropped (${identityClasses.flat().length} subtags), order preserved; plus the\n` +
  `// ${pairs.length} region/variant substitutions, in the order they are attempted.\n` +
  `//\n` +
  `// Reachable from src/index.js on purpose: core's automatic single-locale matcher expands every request\n` +
  `// through it (plan 5.1). The full table is src/data/iana-range-equivalents.js, behind lokalized/negotiate.\n` +
  `/** @type {string[][]} */\n` +
  `const C = ${JSON.stringify(identityClasses)};\n` +
  `/** @type {[string, string][]} */\n` +
  `const R = ${JSON.stringify(pairs)};\n` +
  decodeSource("decodeIdentityEquivalents") +
  `/** @returns {[string, string][]} the substitutions, in the order they are attempted; fresh arrays per call */\n` +
  `export const decodeRegionVariantEquivalents = () => R.map(([from, to]) => [from, to]);\n`;

/** Canonical JSON with sorted object keys and no whitespace. Arrays keep their order. */
const jcs = (/** @type {any} */ value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
};

/**
 * A decoded map reproduces ordered classes when each class's first member maps to the rest of it in
 * order, every other member maps to its class minus itself in order, and no other key exists.
 * @param {Map<string, string[]>} table @param {string[][]} expected
 */
function reproducesClasses(table, expected) {
  const rebuilt = expected.map((members) => [/** @type {string} */ (members[0]), ...(table.get(/** @type {string} */ (members[0])) ?? [])]);
  if (jcs(rebuilt) !== jcs(expected)) return false;
  // EVERY member, not only the first, must see exactly its class minus itself, in class order.
  for (const members of expected)
    for (const key of members)
      if (jcs(table.get(key)) !== jcs(members.filter((member) => member !== key))) return false;
  return table.size === expected.flat().length;
}

/** Import both emitted modules and prove each decodes back to what was emitted. */
async function verifyLossless() {
  const work = await mkdtemp(join(tmpdir(), "lokalized-gen-iana-"));
  /** @type {string[]} */
  const failures = [];
  try {
    const fullPath = join(work, "full.mjs");
    const identityPath = join(work, "identity.mjs");
    await writeFile(fullPath, fullText);
    await writeFile(identityPath, identityText);
    const full = await import(`file://${fullPath}`);
    const identity = await import(`file://${identityPath}`);

    if (!reproducesClasses(full.decodeLanguageEquivalents(), classes))
      failures.push("decodeLanguageEquivalents() does not reproduce the artifact's languageEquivalenceClasses");
    if (!reproducesClasses(identity.decodeIdentityEquivalents(), identityClasses))
      failures.push("decodeIdentityEquivalents() does not reproduce the direct-match projection");
    if (jcs(identity.decodeRegionVariantEquivalents()) !== jcs(pairs))
      failures.push("decodeRegionVariantEquivalents() does not reproduce the artifact's regionVariantEquivalents");

    // A caller mutating what it was handed must not reach the next caller.
    for (const [name, decode] of /** @type {[string, () => Map<string, string[]>][]} */ ([
      ["decodeLanguageEquivalents", full.decodeLanguageEquivalents],
      ["decodeIdentityEquivalents", identity.decodeIdentityEquivalents],
    ])) {
      const first = decode();
      const [key] = first.keys();
      first.get(/** @type {string} */ (key))?.push("mutated");
      if (decode().get(/** @type {string} */ (key))?.includes("mutated")) failures.push(`${name}() shares mutable state between callers`);
      if (decode().has("zz-not-a-key")) failures.push(`${name}() resolves an absent key`);
    }
    const handed = identity.decodeRegionVariantEquivalents();
    handed[0][1] = "-mutated";
    if (identity.decodeRegionVariantEquivalents()[0][1] === "-mutated")
      failures.push("decodeRegionVariantEquivalents() shares mutable state between callers");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return failures;
}

const report = {
  modules: 2,
  languageKeys: classes.flat().length,
  classes: classes.length,
  identityKeys: identityClasses.flat().length,
  identityClasses: identityClasses.length,
  regionVariantPairs: pairs.length,
  fileDate,
};

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;

if (mode === "write") {
  const failures = await verifyLossless();
  if (failures.length > 0) {
    console.error(`refusing to write; ${failures.length} losslessness failure(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  await writeFile(join(root, FULL_MODULE), fullText);
  await writeFile(join(root, IDENTITY_MODULE), identityText);
  console.log(JSON.stringify({ status: "written", ...report,
    bytes: { [FULL_MODULE]: Buffer.byteLength(fullText), [IDENTITY_MODULE]: Buffer.byteLength(identityText) } }));
} else if (mode === "check") {
  const failures = await verifyLossless();
  for (const [path, text] of [[FULL_MODULE, fullText], [IDENTITY_MODULE, identityText]]) {
    let onDisk = null;
    try {
      onDisk = await readFile(join(root, /** @type {string} */ (path)), "utf8");
    } catch {
      failures.push(`${path}: missing; run --write`);
    }
    if (onDisk !== null && onDisk !== text) failures.push(`${path}: on-disk bytes differ from regeneration`);
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ status: "stale-or-lossy", problems: failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", ...report, lossless: true }));
} else {
  console.error("usage: node tools/gen-iana-data.js --write | --check");
  process.exit(2);
}
