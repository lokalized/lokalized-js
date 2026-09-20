#!/usr/bin/env node
// @ts-check
/**
 * Production data encoder: the pinned IANA range-equivalence closure -> `src/data/iana-range-equivalents.js`.
 *
 * SEPARATE FROM `tools/gen-data.js` ON PURPOSE. That tool reads the vendored CLDR JSON and emits the
 * fifteen CLDR-derived modules; this one reads a DIFFERENT pinned artifact —
 * `lokalized-spec generated/iana-language-range-equivalents.json`, extracted from the JDK oracle
 * rather than from CLDR — and emits the one module that is not CLDR data. Folding it into the CLDR
 * encoder would put two provenances behind one banner and one `--check`.
 *
 * IT EXISTS BECAUSE ITS ABSENCE WAS A HAZARD. `src/data/iana-range-equivalents.js` said "Do not edit
 * by hand" while having no generator at all, so the only way to change it WAS by hand — and the
 * artifact it mirrors is provenance-locked in the spec repo, where a hand edit here would be
 * undetectable from there. `test/negotiate.test.js` compares the decoded module against the artifact
 * entry for entry, so a drift fails; this tool is how the module is brought back into line without
 * anyone typing into 21KB of generated table.
 *
 * Guarantees, both verified by `--check`:
 *   - LOSSLESS: the emitted module is imported, decoded, and its canonical JCS projection compared
 *     byte-for-byte against the same projection of the artifact's `equivalents`. Exact bytes, and
 *     ORDER included — the module is a `[key, class][]` array and a class is an ordered list, since
 *     `parse` returns members in a defined order and the port's recovery inverts that order.
 *   - REPRODUCIBLE: regeneration is byte-identical.
 *
 *   node tools/gen-iana-data.js --write
 *   node tools/gen-iana-data.js --check
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR)
  : resolve(root, "../lokalized-spec");
const artifactPath = join(specDir, "generated/iana-language-range-equivalents.json");
const outFile = join(root, "src/data/iana-range-equivalents.js");

if (!existsSync(artifactPath)) {
  console.error(`cannot find the pinned IANA closure at ${artifactPath}\nclone lokalized-spec as a sibling, or set LOKALIZED_SPEC_DIR`);
  process.exit(2);
}

/** @type {{closureSchema: string, jdkVersion: string, jdkVendor: string, source?: string, ianaRegistryFileDate?: string, jdkAbsentTags?: string[], equivalents: Record<string, string[]>}} */
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

// THE SECOND TABLE, CARRIED AS A DELTA. lokalized-java 3.1.0 expands a range through the JDK's
// `Locale.LanguageRange.parse` when the CALLER builds the list and through its own registry-sourced
// `IanaLanguageEquivalents.parse` inside `bestMatchForAcceptLanguage` and
// `DefaultStrings#addParsedLanguageRangeIdentities`. The port needs both, because its public
// `parseLanguageRanges` is the analogue of the first and `tools/conformance.mjs:3909` calls it
// exactly where `VectorOracle.languageRangesFrom` calls `LanguageRange.parse`. Shipping two closures
// would double ~23 KB in every browser graph; the spec's generator proves the library's table is a
// strict SUPERSET of the JDK's and records the difference, so one table plus these tags is enough.
//
// A JDK-DERIVED ARTIFACT HAS NO SUCH FIELD AND MUST NOT BE GIVEN AN EMPTY ONE. Defaulting to `[]`
// would emit a port whose two channels are identical while reading as though the split were
// checked, which is the failure this whole split exists to avoid.
// AN EMPTY LIST IS REFUSED TOO, not just a missing one. lokalized-spec's generator already
// declines to EMIT an empty delta -- two identical tables mean there is no split to test -- so an
// empty one here can only have arrived by hand. Ablated: emptying it in the artifact lets this
// generator write a port whose two channels are identical, and the failure then surfaces as two
// puzzling corpus reds instead of one sentence naming the cause.
if (artifact.source === "lokalized-java" &&
    (!Array.isArray(artifact.jdkAbsentTags) || artifact.jdkAbsentTags.length === 0)) {
  console.error(
    `the artifact at ${artifactPath} is library-derived and carries ` +
      `${Array.isArray(artifact.jdkAbsentTags) ? "an EMPTY" : "no"} jdkAbsentTags. Re-run ` +
      `lokalized-spec's tools/iana-oracle/build.mjs --write; it derives the list from a second ` +
      `extraction against the JDK and cannot be hand-written.`,
  );
  process.exit(2);
}
const jdkAbsentTags = [...(artifact.jdkAbsentTags ?? [])].sort();

/** Canonical JSON: sorted object keys, no whitespace. Same rule as every other artifact here. */
const jcs = (/** @type {any} */ value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
};

// Sorted, so the emitted order is the artifact's canonical order and not object-insertion order.
const entries = Object.keys(artifact.equivalents).sort().map((key) => [key, artifact.equivalents[key]]);

const text =
  `// Generated by tools/gen-iana-data.js from lokalized-spec generated/iana-language-range-equivalents.json. Do not edit by hand.\n` +
  // THE SOURCE LINE IS READ OUT OF THE ARTIFACT rather than asserted here. It said "the pinned
  // JDK oracle" for the life of this generator, and stayed saying it when lokalized-java 3.1.0
  // took ownership of the table and the artifact's own `source` became `lokalized-java` — a
  // generated header describing the wrong provenance, in a file whose whole job is provenance.
  (artifact.source === "lokalized-java"
    ? `// Source: lokalized-java's own registry-sourced table (IANA registry File-Date ${artifact.ianaRegistryFileDate}),\n`
    : `// Source: the pinned JDK oracle (java.util.Locale.LanguageRange.parse, ${artifact.jdkVendor} ${artifact.jdkVersion}),\n`) +
  `// closure schema ${artifact.closureSchema}, ${entries.length} entries. See lokalized-spec generated/IANA-PROVENANCE.md.\n` +
  `//\n` +
  `// NOT reachable from src/index.js: the whole-list negotiator and its tables live behind\n` +
  `// lokalized/negotiate by plan 3.1, and test/pinned-data-only.test.js names this file to keep it there.\n` +
  `/** @type {[string, string[]][]} */\n` +
  `const E = ${JSON.stringify(entries)};\n` +
  `/** @returns {Map<string, string[]>} */\n` +
  `export const decode = () => new Map(E.map(([tag, equivalents]) => [tag, equivalents.slice()]));\n` +
  `// Keys of E the JDK's own table does not carry, so the port's public parseLanguageRanges --\n` +
  `// the analogue of java.util.Locale.LanguageRange.parse -- must walk PAST them.\n` +
  `/** @type {string[]} */\n` +
  `const J = ${JSON.stringify(jdkAbsentTags)};\n` +
  `/** @returns {Set<string>} */\n` +
  `export const decodeJdkAbsentTags = () => new Set(J);\n`;

/** Import the emitted module and prove `decode()` reproduces the artifact's canonical bytes. */
async function verifyLossless() {
  const work = await mkdtemp(join(tmpdir(), "lokalized-gen-iana-"));
  const problems = [];
  const path = join(work, "iana.mjs");
  await writeFile(path, text);
  const { decode, decodeJdkAbsentTags } = await import(`file://${path}`);
  const decoded = decode();

  const absent = decodeJdkAbsentTags();
  if (jcs([...absent].sort()) !== jcs(jdkAbsentTags))
    problems.push("decodeJdkAbsentTags() does not reproduce the artifact's jdkAbsentTags");
  // EVERY delta tag must be a key of the table it subtracts from. A tag naming no class would
  // subtract nothing, so the public parse would silently keep the registry answer -- the delta
  // would be present, plausible and inert.
  for (const tag of jdkAbsentTags)
    if (!decoded.has(tag)) { problems.push(`jdkAbsentTags names ${tag}, which is not a key of the table`); break; }
  absent.add("mutated");
  if (decodeJdkAbsentTags().has("mutated"))
    problems.push("decodeJdkAbsentTags() shares mutable state between callers");

  if (jcs(Object.fromEntries(decoded)) !== jcs(artifact.equivalents))
    problems.push("decode() does not reproduce the artifact's equivalents");
  if (decoded.size !== Object.keys(artifact.equivalents).length)
    problems.push(`decode() yields ${decoded.size} classes; the artifact has ${Object.keys(artifact.equivalents).length}`);

  // ORDER WITHIN A CLASS is load-bearing and the JCS projection above would not catch a reordering
  // that `jcs` happens to normalize — it does not sort arrays, but saying so is cheaper than
  // relying on it. `parse` returns members in a defined order and `src/negotiate/index.js` inverts
  // exactly that order to recover the JDK's language-equivalence maps, so a shuffled class is a
  // wrong recovery, not a cosmetic difference.
  for (const [key, members] of Object.entries(artifact.equivalents))
    if (JSON.stringify(decoded.get(key)) !== JSON.stringify(members)) {
      problems.push(`class order or content differs for ${key}`);
      break;
    }

  // A key the artifact does not have must not resolve, and mutating the decoded copy must not reach
  // the next caller — the module hands out `slice()`s for that reason.
  if (decoded.has("zz-not-a-key")) problems.push("an absent key resolves");
  const first = /** @type {string} */ (Object.keys(artifact.equivalents)[0]);
  decoded.get(first)?.push("mutated");
  if (JSON.stringify(decode().get(first)) !== JSON.stringify(artifact.equivalents[first]))
    problems.push("decode() shares mutable state between callers");

  await rm(work, { recursive: true, force: true });
  return problems;
}

const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : null;

if (mode === "write") {
  const problems = await verifyLossless();
  if (problems.length) {
    console.error(`refusing to write; ${problems.length} losslessness failure(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  await writeFile(outFile, text);
  console.log(JSON.stringify({ status: "written", entries: entries.length, bytes: Buffer.byteLength(text), jdkVersion: artifact.jdkVersion }));
} else if (mode === "check") {
  const problems = await verifyLossless();
  let onDisk = null;
  try {
    onDisk = await readFile(outFile, "utf8");
  } catch {
    problems.push("src/data/iana-range-equivalents.js: missing; run --write");
  }
  if (onDisk !== null && onDisk !== text) problems.push("src/data/iana-range-equivalents.js: on-disk bytes differ from regeneration");
  if (problems.length) {
    console.error(JSON.stringify({ status: "stale-or-lossy", problems }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "current", entries: entries.length, lossless: true, jdkVersion: artifact.jdkVersion }));
} else {
  console.error("usage: node tools/gen-iana-data.js --write | --check");
  process.exit(2);
}
