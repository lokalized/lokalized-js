#!/usr/bin/env node
// @ts-check
/**
 * THE NEWCOMER'S FLOWS, RUN AS A NEWCOMER RUNS THEM: from the published package, in a directory
 * that contains nothing else.
 *
 * **WHY THIS IS NOT `check:readme` WITH A LONGER PATH.** `tools/readme-examples.mjs` executes every
 * sample from INSIDE the repository, where the whole working tree is present. That is the right
 * place to check that the samples agree with the library. It is the wrong place to check that they
 * agree with what a reader HAS — and the two questions had never been separated. Measured on
 * 2026-09-16, before this tool existed: **9 of the 42 sample groups fail for anybody who installed
 * the package**, all for one reason — they read `examples/catalogs`, a directory `npm pack` does not
 * ship and whose contents the README never showed. Those nine were green in `verify` and in CI every
 * run. A sample that cannot run is the clearest form of the thing M-D is supposed to rule out: the
 * reader is left to invent the catalog files, and then to guess which of their own inventions would
 * have produced the output the document asserts.
 *
 * SO THE RULE IS: the samples must run against the PUBLISHED ARTIFACT plus what the README ITSELF
 * PUBLISHES, and nothing else. The run directory is built here and holds exactly three things:
 *
 *   node_modules/lokalized/   the real tarball `npm publish` would upload, extracted
 *   package.json              `{"type": "module"}` — what a reader's own project has
 *   <the README's catalogs>   every `<!-- catalog: path -->` block, written to that path
 *
 * Nothing is copied from the working tree. A sample that needs a file the reader does not have
 * therefore fails here and passes there, which is the whole point of running it twice.
 *
 * THE PUBLISHED CATALOGS ARE COMPARED TO THE REPOSITORY'S, byte for byte. Without that the document
 * could show one thing and the gate run another, and the two runs would silently drift apart — the
 * staleness rule every other list in this project carries. A published catalog with no counterpart
 * on disk fails for the same reason.
 *
 * THE SECOND ARM IS THE DIRECT-BROWSER FLOW, and it asks the one question a working-tree gate
 * structurally cannot. `test/browser-import-map.test.js` proves the documented import map is
 * COMPLETE and correctly aimed, by deriving it from `package.json#exports` — but it resolves every
 * target against the repository. A reader's browser resolves them against a CDN, which serves this
 * tarball. So each documented target, AND the whole module graph behind it, must be present in the
 * tarball; a single unshipped module is a page that does not load. The walk is `tools/graph-walk.mjs`
 * — the same arithmetic 0a and 2k ratchet on, not a third copy of it.
 *
 * DELIBERATELY NOT HERE: a Node-builtin check on the browser graph. `test/package-shape.test.js`
 * already scans every file under `src/` outside `src/node/` for built-in imports AND Node globals,
 * per file rather than per graph, which is strictly stronger. Duplicating a gate that works is not
 * worth its maintenance.
 *
 * ANTI-VACUITY, because an apparatus this large could pass while proving nothing: the README must
 * publish at least one catalog, at least one sample group must actually READ a published catalog's
 * directory (otherwise materializing them is decoration), the run directory must contain nothing
 * beyond the three things above, and the tarball must contain the entry points the map names.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { graphBytes } from "./graph-walk.mjs";
import { browserEntries } from "./browser-entries.mjs";
import { moduleFor, parseReadme } from "./readme-blocks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const { groups, htmlModules, catalogs, problems } = parseReadme(readme);

const work = mkdtempSync(join(tmpdir(), "lokalized-newcomer-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

// ---------------------------------------------------------------- the package a reader installs
const tarballDir = join(work, "tarball");
mkdirSync(tarballDir, { recursive: true });
const packed = execFileSync("npm", ["pack", "--pack-destination", tarballDir, "--silent"],
  { cwd: root, encoding: "utf8" }).trim().split("\n").pop() ?? "";
const tarball = join(tarballDir, packed);

const app = join(work, "app");
const installed = join(app, "node_modules", "lokalized");
mkdirSync(installed, { recursive: true });
execFileSync("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"]);
writeFileSync(join(app, "package.json"), `{\n  "name": "newcomer",\n  "private": true,\n  "type": "module"\n}\n`);

// ------------------------------------------------- the catalogs the README publishes to its reader
for (const [path, text] of catalogs) {
  const target = join(app, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);

  // A published catalog and the repository's own copy must be the same bytes, or the document shows
  // a reader one fixture while `check:readme` runs another.
  let onDisk;
  try {
    onDisk = readFileSync(join(root, path), "utf8");
  } catch {
    problems.push(`the README publishes '${path}', which does not exist in the repository — ` +
      `\`npm run check:readme\` and this gate would read different bytes for the same sample`);
    continue;
  }
  if (onDisk !== text) {
    // THE COMPARISON IS ON CONTENT, NOT LENGTH, and the message has to say so. It used to print
    // "(513 bytes published, 513 on disk)" for a length-preserving one-byte change — two equal
    // numbers offered as the evidence of a difference, which reads like the gate malfunctioning
    // rather than like a finding. Catching that change is the STRONG property; describing it as a
    // size mismatch was the weak part.
    const where = [...text].findIndex((character, index) => character !== onDisk[index]);
    problems.push(`the README's published copy of '${path}' has drifted from the repository's ` +
      (text.length === onDisk.length
        ? `— same length (${text.length} bytes), first difference at offset ${where}. `
        : `(${text.length} bytes published, ${onDisk.length} on disk). `) +
      `Re-publish it in the README.`);
  }
}

// ------------------------------------------------------------------------ flow 1: the npm reader
/** @type {string[]} */
const ran = [];
let assertions = 0;
for (const [name, group] of groups) {
  assertions += group.assertions;
  const file = join(app, `.readme-example-${name}.mjs`);
  writeFileSync(file, moduleFor(group));
  try {
    const out = execFileSync(process.execPath, [file], { cwd: app, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    ran.push(`  ok    ${name.padEnd(18)} ${out.trim()} assertion(s)`);
  } catch (error) {
    const detail = /** @type {{ stderr?: string, stdout?: string }} */ (error);
    // The THROWN LINE, not the source line that threw: node echoes the offending source first, so
    // a naive "first line mentioning Error" reports `return new StringsParseError(...)` and tells a
    // reader nothing about what went wrong.
    const output = (detail.stderr ?? detail.stdout ?? "").trim().split("\n");
    const first = output.find((l) => /^\s*(?:[A-Z]\w*(?:Error|Exception)|Uncaught)\b[^(]*:/.test(l))
      ?? output.find((l) => /ENOENT|Cannot find|ERR_/.test(l)) ?? "(no error line)";
    problems.push(`sample '${name}' does not run for a reader who installed the package: ${first.trim()}`);
  } finally {
    rmSync(file, { force: true });
  }
}

// -------------------------------------------------------------- flow 2: the direct-browser reader
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
/** Every target the documented import map names, taken from the README rather than assumed. */
const browserTargets = Object.fromEntries(
  browserEntries(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).exports)
    .map((entry) => [entry.specifier, entry.published]));
/** The build manifest the tarball carries, which is the bundler's own account of the artifact. */
const builtManifest = (() => {
  try { return JSON.parse(readFileSync(join(installed, "dist/browser/build-manifest.json"), "utf8")); }
  catch { problems.push("the published package carries no dist/browser/build-manifest.json"); return null; }
})();

const mapBlock = /"imports"\s*:\s*\{(?<body>[^}]*)\}/.exec(readme);
/** @type {Array<{ specifier: string, file: string }>} */
const mapped = [];
if (!mapBlock?.groups?.body) {
  problems.push("the README documents no import map — the direct-browser flow has no entry points to check");
} else {
  for (const m of mapBlock.groups.body.matchAll(/"(?<specifier>[^"]+)"\s*:\s*"(?<url>[^"]+)"/g)) {
    const url = m.groups?.url ?? "";
    const specifier = m.groups?.specifier ?? "";
    // **THE PATH COMES FROM THE DERIVATION, NOT FROM A REGEX OVER THE URL.** This read
    // `/^.*?\/(src\/.*)$/`, which assumed every documented target contains a `src/` segment. When
    // M-R S9 pointed the maps at `dist/browser/`, that replace matched nothing, left the whole URL
    // as the path, and every entry failed with an ENOENT on a doubled path — while the only thing
    // standing between that and a GREEN run over zero work was the per-entry `problems.push` below.
    // MEASURED: suppress it and this gate exits 0 printing "0 module fetch(es)" and "every
    // documented browser entry point loads". Hence the floor in the anti-vacuity terms too.
    const known = browserTargets[specifier];
    const file = known && url.endsWith(known) ? known.slice(1) : url.replace(/^.*?\/((?:src|dist)\/.*)$/, "$1");
    mapped.push({ specifier, file });
  }
}

let browserModules = 0;
for (const { specifier, file } of mapped) {
  try {
    const shipped = graphBytes(installed, file);
    browserModules += shipped.modules;
    // **THE PUBLISHED GRAPH IS COMPARED TO THE BUILD'S OWN MANIFEST, NOT TO THE REPOSITORY.** It
    // used to be `graphBytes(root, file)` — sound while the maps named `src/`, which exists in both
    // places, and unusable now they name `dist/browser/`, which `prepack` writes and a fresh
    // checkout does not have. The manifest ships INSIDE the tarball and is produced by the bundler,
    // so this compares two independently derived facts about the artifact a reader receives: what
    // the build says each entry pulls, and what walking the shipped files actually reaches.
    const declared = builtManifest?.entries.find((/** @type {any} */ e) => e.specifier === specifier);
    if (!declared)
      problems.push(`'${specifier}' is documented in the import map and the published build ` +
        `manifest does not list it`);
    else if (shipped.modules !== declared.chunks.length + 1)
      problems.push(`'${specifier}' is declared as ${declared.chunks.length + 1} file(s) by the ` +
        `published build manifest and walking the shipped files reaches ${shipped.modules}`);
  } catch (error) {
    problems.push(`'${specifier}' does not load from the published package: ` +
      `${/** @type {{ message?: string }} */ (error).message}`);
  }
}

// ------------------------------------------------------------------------- the anti-vacuity terms
// EVERY FILE, not every top-level name. The first version of this term compared `readdirSync(app)`
// against the directories the published paths imply, and an ablation that copied the repository's
// whole `examples/` tree into the sandbox left it at EXIT 0 — because `examples/` is what the
// published catalogs create too, so the two were indistinguishable at that depth. A term that
// cannot tell the reader's situation from the repository's is the thing this gate exists to be.
const walk = (dir, prefix = "") => readdirSync(dir, { withFileTypes: true })
  .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
  .flatMap((entry) => entry.isDirectory()
    ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]);
const layout = walk(app).sort();
const expectedLayout = ["package.json", ...catalogs.keys()].sort();
if (JSON.stringify(layout) !== JSON.stringify(expectedLayout)) {
  const extra = layout.filter((f) => !expectedLayout.includes(f));
  problems.push(`the run directory holds ${extra.length} file(s) the README did not publish ` +
    `(${extra.slice(0, 4).join(", ")}${extra.length > 4 ? ", …" : ""}) — a passing run would not ` +
    `describe a reader's situation, because the reader does not have them`);
}
if (catalogs.size === 0)
  problems.push("the README publishes no catalog — nothing here proves a directory sample is reproducible");
const catalogDirs = [...new Set([...catalogs.keys()].map((p) => dirname(p)))];
const reads = [...groups.values()].filter((g) => catalogDirs.some((d) => g.code.join("\n").includes(d))).length;
if (reads === 0 && catalogs.size > 0)
  problems.push(`no sample group reads ${catalogDirs.join(" or ")} — the published catalogs are decoration`);
if (mapped.length === 0)
  problems.push("no import-map entry was read out of the README — the direct-browser arm checked nothing");
// A FLOOR ON THE WORK, not merely on the entries. Reading eight entries and fetching zero modules is
// what the broken path extraction produced, and it printed a sentence claiming every entry loads.
if (browserModules < mapped.length)
  problems.push(`${mapped.length} import-map entr(ies) were read and only ${browserModules} module(s) ` +
    `were reached — the browser arm asserted almost nothing`);
if (groups.size === 0) problems.push("no example groups found");

console.log(`README, as a newcomer has it — ${groups.size} group(s), ${assertions} asserted output(s)`);
console.log(`  package     ${packed} (${(readFileSync(tarball).length / 1024).toFixed(1)} KB, ${readdirSync(installed).length} top-level entries)`);
console.log(`  published   ${catalogs.size} catalog file(s), read by ${reads} sample group(s)`);
console.log(`  browser     ${mapped.length} import-map entr(ies), ${browserModules} module fetch(es) across them`);
for (const line of ran) console.log(line);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) a reader would hit and the repository would not:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`\nevery sample runs, and every documented browser entry point loads, from the published package alone.`);
