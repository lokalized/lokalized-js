#!/usr/bin/env node
// @ts-check
/**
 * THE README'S BUNDLER NUMBERS, MEASURED BY A REAL BUNDLER.
 *
 * `tools/readme-examples.mjs` closes with the rule this file exists to enforce one level up:
 * **"A claim that can be executed and is left in prose is a claim nothing checks."** Its own README
 * then broke that rule at scale. `### What it costs a browser` opened "Measured with esbuild 0.24.2
 * against this checkout" and carried FOURTEEN numbers — a five-row table with two columns, plus
 * eight figures in prose — in markdown that `check:readme` is structurally blind to, attributed to a
 * tool that **existed nowhere in this repository**: `esbuild|webpack|rollup|vite|parcel` occurred
 * zero times in `package.json`, `tools/` and `test/`.
 *
 * MEASURED 2026-09-17, with the exact version the sentence named: every one of the fourteen was
 * stale, most by tens of bytes. The one claim that held was the one stated as a RATIO rather than a
 * byte count — `sideEffects` really does make a single-constant import 90× larger.
 *
 * AND THE FIRST DRAFT OF THIS PARAGRAPH WAS ITSELF WRONG, which is worth more than the numbers. It
 * said the `lokalized/ssr` row was stale "by 17%, consistent with `LokalizedError` landing in every
 * graph three slices earlier" — a tidy causal story, and untrue. An adversarial reading caught it and
 * the measurement settles it: the README's 5,693 is the SINGLE-NAME import shape, which today gives
 * 5,682 — eleven bytes, 0.19%. The 17% came from comparing that figure against the both-names shape
 * this table uses, and `src/internal/lokalized-error.js` contributes 207 bytes to that bundle, not
 * 11. **The old table never said which import it measured**, and three plausible readings of one row
 * differ by 1,109 bytes, so the number was not re-derivable by anyone — which is why every row below
 * carries the import statement verbatim rather than a description of it.
 *
 * WHAT IS GATED AND WHAT IS REPORTED, and the split is measured rather than chosen:
 *
 *   minified bytes   GATED. esbuild's output is a pure function of its input and its version, and
 *                    the version is pinned exactly in `devDependencies`.
 *   brotli bytes     GATED, and the README's GZIP COLUMN WAS REPLACED BY IT ON A MEASUREMENT. One
 *                    byte-identical bundle (sha256 cbef15c7…, 317,235 B) compressed on node 20.20.2,
 *                    22.14.0, 24.10.0, 24.18.0, 24.20.0 and 26.5.0 — five zlib versions and two
 *                    brotli versions — gives **72,123 brotli every time** and gzip 100,742 on four
 *                    of the first five and 99,533 on the other. 20.20.2 was added when the floor
 *                    moved to Node 20; it ships brotli 1.1.0, the same implementation as 22, so the
 *                    floor leg introduces no new compressor. CI runs a ["20","22","24","current"]
 *                    matrix, so a gzip gate
 *                    reds a leg for a reason that is not about this package, while brotli is a
 *                    ratchet. It is also the number a visitor actually pays: every modern CDN
 *                    negotiates `br` first, and the gzip figure the README used to print overstates
 *                    the real transfer cost of the root bundle by 39%. Gzip is worse than
 *                    host-dependent: measured on ONE machine, its LEVEL spread (117,002 at level 1
 *                    to 100,563 at level 9) is wider than its version spread, so the old column was
 *                    not reproducible even on the zlib it was taken with.
 *                    THE RESIDUAL RISK, stated rather than left to be found: brotli agreeing across
 *                    three library versions is strong evidence and not a proof. If it ever moves,
 *                    the repair is to record per brotli version — `process.versions.brotli` is
 *                    printed on every run so the failure can be attributed — and NOT to drop the
 *                    gate, which would put an unchecked number back beside the checked ones.
 *   module sets      GATED always. A metafile input list is machine-independent.
 *
 * THE CROSS-CHECK IS THE PART THAT IS NOT ABOUT THE README. `tools/graph-walk.mjs` is this project's
 * own model of what a bundler pulls in, and every containment claim rests on it — but until a real
 * bundler ran, nothing had ever checked the model against the thing it models. They agree on the
 * module SET, member for member, on all eight browser-resolvable subpaths. They disagreed by four
 * bytes on the RECORDED figures, which is how `measurements/subpath-graphs.json` turned out to be
 * describing a tree that no longer existed: that ratchet fails on growth and is silent on a shrink.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";
import * as esbuild from "esbuild";
import { graphBytes } from "./graph-walk.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(root, "README.md");
let readme = readFileSync(readmePath, "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const problems = [];
const notes = [];

// ------------------------------------------------------------------ the artifact a reader installs
// Bundled from the real tarball rather than from the working tree, for three reasons, and the
// second is the one that bites. It is what a reader actually resolves. It is the only place the
// `sideEffects` ablation below can be performed honestly — a first attempt at that ablation pointed
// esbuild at a package.json copy whose `src` was a SYMLINK into the repository, so esbuild resolved
// through to the real path, read the REPOSITORY's package.json, and reported the ablation as a 1.0x
// no-op. And it puts the packed `files` list on the same measurement as the numbers, so a module
// that stops shipping shows up here as a build failure rather than as a reader's broken page.
const work = mkdtempSync(join(tmpdir(), "lokalized-bundle-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

const tarballDir = join(work, "tarball");
mkdirSync(tarballDir, { recursive: true });
const packed = execFileSync("npm", ["pack", "--pack-destination", tarballDir, "--silent"],
  { cwd: root, encoding: "utf8" }).trim().split("\n").pop() ?? "";

/** Extract the tarball into `<dir>/node_modules/lokalized`, optionally rewriting its package.json. */
function site(name, editPackage) {
  const dir = join(work, name);
  const installed = join(dir, "node_modules", "lokalized");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", join(tarballDir, packed), "-C", installed, "--strip-components", "1"]);
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  if (editPackage) {
    const manifestPath = join(installed, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    editPackage(manifest);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return dir;
}

const asPublished = site("published");

/**
 * **WHAT A NO-BUILD PAGE DOWNLOADS — the shipped artifact, not a re-bundle of it.**
 *
 * Plan :2153 requires that "size and browser tests consume the exact packed production output,
 * never a development approximation", and until M-R S9 every number this tool printed was a
 * re-bundle: a synthetic one-import entry compiled out of the tarball's `src/`. That is the right
 * answer to "what does my bundler add to my app" and the WRONG one to "what does the browser
 * fetch", and the two differ by 3,001 bytes on the root — +3,670 that the synthetic entry's
 * tree-shaking removes and a real entry point must keep, -517 of legal-comment form, -190 of
 * namespace-versus-export-statement, +38 for the sourcemap comment. The README printed the smaller
 * one under a heading promising the larger.
 *
 * The rows come from `dist/browser/build-manifest.json` INSIDE the tarball — esbuild's own account
 * of which chunks each entry pulls — and the bytes from the files beside it, so this measures the
 * artifact a reader receives and nothing else.
 */
const distRows = (() => {
  const dir = join(asPublished, "node_modules", "lokalized", "dist", "browser");
  /** @type {any} */
  let built;
  try { built = JSON.parse(readFileSync(join(dir, "build-manifest.json"), "utf8")); }
  catch { problems.push("the packed tarball carries no dist/browser/build-manifest.json, so the shipped-artifact table measures nothing"); return []; }
  const weigh = (/** @type {string[]} */ files) => {
    const bytes = files.sort().map((file) => readFileSync(join(dir, file)));
    return { files: files.length, raw: bytes.reduce((sum, b) => sum + b.length, 0),
      brotli: brotliCompressSync(Buffer.concat(bytes)).length };
  };
  return [
    ...built.entries.map((/** @type {any} */ entry) => ({
      label: `\`${entry.specifier}\``, ...weigh([entry.file, ...entry.chunks]) })),
    { label: "`lokalized.global.js`, the classic script", ...weigh([built.global.file]) },
  ];
})();

/**
 * One measurement. `label` is the table's first column VERBATIM, so a hand-edited row fails rather
 * than being silently re-generated on the next `--write`.
 */
const ROWS = [
  { id: "root", label: '`import { createStrings } from "lokalized"`',
    source: 'import { createStrings } from "lokalized"; console.log(createStrings);' },
  { id: "negotiate", label: '`import { createLocaleNegotiator, parseLanguageRanges } from "lokalized/negotiate"`',
    source: 'import { createLocaleNegotiator, parseLanguageRanges } from "lokalized/negotiate";\nconsole.log(createLocaleNegotiator, parseLanguageRanges);' },
  { id: "ssr", label: '`import { createSsrStamp, validateSsrStamp } from "lokalized/ssr"`',
    source: 'import { createSsrStamp, validateSsrStamp } from "lokalized/ssr";\nconsole.log(createSsrStamp, validateSsrStamp);' },
  { id: "constant", label: '`import { GENDER_FEMININE } from "lokalized"`',
    source: 'import { GENDER_FEMININE } from "lokalized"; console.log(GENDER_FEMININE);' },
  { id: "together", label: "the four above, in one bundle",
    source: 'import { createStrings } from "lokalized";\nimport * as negotiate from "lokalized/negotiate";\nimport * as ssr from "lokalized/ssr";\nimport * as load from "lokalized/load";\nconsole.log(createStrings, negotiate, ssr, load);' },
];

/** Measurements the prose cites but the table does not show. */
const EXTRA = [
  { id: "rootOrdinal", source: 'import { createStrings } from "lokalized";\nimport * as ordinal from "lokalized/data/ordinal";\nconsole.log(createStrings, ordinal);' },
  { id: "rootRanges", source: 'import { createStrings } from "lokalized";\nimport * as ranges from "lokalized/data/ranges";\nconsole.log(createStrings, ranges);' },
];

/**
 * Whether a module is CLDR-derived, read from the module's own provenance marker. Which modules
 * those are is the same rule `test/notice-shape.test.js` applies, so the two gates cannot disagree
 * about the set. A path pattern is unusable here: esbuild reports metafile inputs relative to
 * `process.cwd()`, so every path is a long `../../..` walk into a temp extraction of the tarball.
 *
 * @param {string} modulePath @returns {boolean}
 */
const isCldrModule = (modulePath) => {
  try { return readFileSync(modulePath, "utf8").includes("Generated by tools/gen-data.js from pinned CLDR"); }
  catch { return false; }
};

/** @param {string} source @param {{ dir?: string, plugins?: any[] }} [options] */
async function bundle(source, options = {}) {
  const built = await esbuild.build({
    stdin: { contents: source, resolveDir: options.dir ?? asPublished, sourcefile: "entry.js", loader: "js" },
    bundle: true, minify: true, format: "esm", platform: "browser", write: false, metafile: true,
    logLevel: "silent", plugins: options.plugins,
  });
  const bytes = Buffer.from(built.outputFiles[0].contents);
  // The synthetic stdin entry is not a module of this package and must not be counted as one.
  const modules = Object.keys(built.metafile.inputs).filter((path) => !path.endsWith("entry.js"));
  // **COUNTED INSIDE THE PRESERVED LEGAL COMMENTS, not anywhere in the artifact**, and the first
  // version did the latter while its comment claimed the former. Demonstrated: a module whose SOURCE
  // never contains the string still produced a match, because esbuild constant-folds
  // `"Copyright (c) 1991-" + "2025 …"` into one literal — a data string counted as an attribution.
  //
  // esbuild collects them into a `/*! Bundled license information: */` block at the end of the file
  // rather than copying each banner verbatim, so the count is taken over the legal comments the
  // output actually carries.
  const outputText = built.outputFiles[0].text;
  const legalComments = outputText.match(/\/\*!([^]*?)\*\//g) ?? [];
  const attributions = legalComments
    .join("\n")
    .split("Copyright (c) 1991-2025 Unicode").length - 1;
  // **WHETHER THE ARTIFACT CARRIES CLDR DATA IS ASKED OF THE METAFILE'S BYTE ACCOUNTING**, which is
  // esbuild's own answer to "did this module contribute anything to this output".
  //
  // Two wrong versions came first and both were measured. Keyed on the INPUT LIST, the
  // single-constant row — one frozen language-form value, 2,350 bytes out of 31 modules — reported
  // as carrying CLDR data and missing its notice, because esbuild lists a module as an input and
  // then tree-shakes every byte of it away, legal comment included. Keyed on whether each module's
  // LONGEST STRING LITERAL survived into the output, it saw 4,162 of the 208,948 shipped bytes —
  // **2%** — because fourteen of the fifteen modules store their tables as arrays of short literals
  // and only `valid-languages.js` has a single literal over 200 characters. One module decided the
  // verdict for every bundle; chunking that one literal, which is the storage shape the other
  // fourteen already use, turned five of seven rows into false reds with an inverted message. And
  // an application's own copy of the same string made the detector report data that had been
  // tree-shaken away.
  const outputMeta = Object.values(built.metafile.outputs)[0];
  const carriesCldrData = Object.entries(outputMeta?.inputs ?? {})
    .some(([path, entry]) => entry.bytesInOutput > 0 && isCldrModule(path));
  return { minified: bytes.length, brotli: brotliCompressSync(bytes).length, modules, attributions, carriesCldrData };
}

const measured = {};
for (const row of [...ROWS, ...EXTRA]) {
  try {
    measured[row.id] = await bundle(row.source);
  } catch (error) {
    // A declared row that will not bundle is a packaging defect — a module missing from `files`, an
    // export that moved — and it must be REPORTED rather than thrown. An unhandled esbuild failure
    // prints a `Getter/Setter` object dump, and this project has twice mistaken a crashed harness
    // for a catastrophic regression.
    console.error(`  FAIL  ${row.id} did not bundle:\n${String(/** @type {any} */ (error).message ?? error)
      .split("\n").slice(0, 8).map((line) => `        ${line}`).join("\n")}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------------------- the two ablations
// The README states two of its claims as ablations. They are RUN here rather than quoted, which is
// the difference between a number a reader can trust and a number somebody once typed.
const gutted = await bundle(ROWS[0].source, { plugins: [{
  name: "gut-likely-subtags",
  setup(build) {
    build.onLoad({ filter: /likely-subtags\.js$/ }, () => ({ contents: "export const decode = () => new Map();", loader: "js" }));
  },
}] });

let sideEffectsDelta = null;
const withoutSideEffects = await bundle(
  ROWS.find((row) => row.id === "constant").source,
  { dir: site("no-side-effects", (manifest) => {
    // THE TWO STAGED PACKAGES MUST DIFFER IN EXACTLY ONE FIELD. An ablation that moved more than one
    // bit attributes the whole difference to the bit it meant to move. Compared field by field
    // rather than by serialising, because `delete` changes key ORDER and a string comparison then
    // reports a difference that is not one — which is what the first version of this check did.
    const before = { ...manifest };
    if (!("sideEffects" in before)) { sideEffectsDelta = "nothing: the package declares no sideEffects"; return; }
    delete manifest.sideEffects;
    const keys = new Set([...Object.keys(before), ...Object.keys(manifest)]);
    const moved = [...keys].filter((key) =>
      JSON.stringify(before[key]) !== JSON.stringify(manifest[key]));
    sideEffectsDelta = moved.length === 1 && moved[0] === "sideEffects"
      ? "sideEffects"
      : (moved.length === 0 ? "NOTHING AT ALL — the mutation did not land" : moved.join(", "));
  }) },
);
if (sideEffectsDelta !== "sideEffects")
  problems.push(`the sideEffects ablation staged a package that differs from the published one by ` +
    `${sideEffectsDelta}; the 90× it produces would not be attributable to that field`);

// ANTI-VACUITY FOR THE ABLATIONS THEMSELVES, and the first of the two is not hypothetical: an
// earlier attempt at the `sideEffects` ablation reported a 1.0x no-op because the mutation never
// reached the bundler. An ablation that does not move its number has not been performed.
if (gutted.minified >= measured.root.minified)
  problems.push(`the likely-subtags ablation did not move the bundle (${measured.root.minified} -> ` +
    `${gutted.minified}); it was not performed, whatever the numbers below say`);
if (withoutSideEffects.minified <= measured.constant.minified)
  problems.push(`removing \`sideEffects\` did not move the single-constant bundle ` +
    `(${measured.constant.minified} -> ${withoutSideEffects.minified}); the mutation did not land`);

// ------------------------------------------- what this gate deliberately does NOT check, and who does
// The README's two containment sentences — "neither is reachable from `lokalized`" and
// "`lokalized/ssr` carries no pinned data at all" — were rules here in the first draft, over the
// bundler's own metafile. They are gone, verified redundant rather than assumed so:
//
//   test/pinned-data-only.test.js  walks the root graph and forbids `src/data/{ordinal,ordinal-rules,
//                                 ranges,cardinal-ranges,iana-range-equivalents}.js` and
//                                 `src/negotiate/index.js` — a SUPERSET of the three rows this had.
//   test/ssr-graph.test.js         pins the ssr module set EXACTLY at three named modules, which is
//                                 strictly stronger than "it contains no pinned data".
//   test/package-shape.test.js     scans every file outside `src/node/` for Node built-ins in all
//                                 four import shapes, per file rather than per graph.
//   tools/subpath-graphs.mjs       derives the browser/edge/node containment rule from the spec's
//                                 own allowlist flags.
//
// Both of those tests walk with `tools/graph-walk.mjs`, and the cross-check below is what makes
// their verdicts transferable to a bundler's view: the two agree on the module SET, member for
// member, on every subpath a browser can resolve. Re-implementing containment here would have been
// the prophylactic duplicate this project polices, one directory away from the tests that own it.

const shortName = (path) => path.replace(/^.*node_modules\/lokalized\//, "");

// "THE TABLES ARE SHARED, NOT DUPLICATED" — as a set identity, not only as a byte difference. A
// combined bundle that quietly dropped one of its four parts would still be smaller than four
// separate bundles, so the byte arithmetic alone cannot tell sharing from loss.
//
// SAID PLAINLY, because an adversarial reading of it is right: with no conditional exports, esbuild
// resolves each bare specifier identically in both builds, so today the union IS the combined set by
// construction and no change to `src/` can red this. It is a consistency check on this tool's own
// row declarations, not a gate on the package, and it is kept at that value rather than at the one
// its name suggests.
const union = new Set([...measured.root.modules, ...measured.negotiate.modules, ...measured.ssr.modules]
  .map(shortName));
const combined = new Set(measured.together.modules.map(shortName));
const droppedFromCombined = [...union].filter((module) => !combined.has(module));
if (droppedFromCombined.length)
  problems.push(`the combined bundle is missing ${droppedFromCombined.length} module(s) its parts ` +
    `contain (${droppedFromCombined.slice(0, 4).join(", ")}); it is not the union of them, so the ` +
    `marginal byte figure is measuring loss rather than sharing`);

// ------------------------------------------------- the cross-check: two independent walkers agree
// `tools/graph-walk.mjs` is this project's own model of a bundler's module walk, and every
// containment claim in the repository rests on it. Nothing had ever compared it to a bundler.
const walkDisagreements = [];
for (const [exportKey, target] of Object.entries(pkg.exports)) {
  if (exportKey === "./package.json") continue;
  const specifier = exportKey === "." ? "lokalized" : `lokalized/${exportKey.slice(2)}`;
  let built;
  try {
    built = await bundle(`import * as namespace from ${JSON.stringify(specifier)};\nconsole.log(namespace);`);
  } catch (error) {
    // `lokalized/node` cannot be bundled for a browser at all, which is the containment claim
    // holding rather than a failure — the browser half is checked by `subpath:graphs`.
    notes.push(`${specifier}: not bundleable for a browser (${String(error).split("\n")[0].slice(0, 80)})`);
    continue;
  }
  const walked = graphBytes(root, /** @type {{ import: string }} */ (target).import.replace(/^\.\//, ""));
  const fromBundler = new Set(built.modules.map(shortName));
  const fromWalk = new Set(walked.files.map((file) => file.slice(root.length + 1)));
  const onlyBundler = [...fromBundler].filter((module) => !fromWalk.has(module));
  const onlyWalk = [...fromWalk].filter((module) => !fromBundler.has(module));
  if (onlyBundler.length || onlyWalk.length)
    walkDisagreements.push(`${specifier}: the bundler and tools/graph-walk.mjs disagree — ` +
      `bundler only [${onlyBundler.join(", ")}], walk only [${onlyWalk.join(", ")}]`);
}
for (const line of walkDisagreements) problems.push(line);

// --------------------------------------------------------------- binding the README to the numbers
const n = (value) => value.toLocaleString("en-US");

/**
 * The table is GENERATED between markers rather than compared field by field, so the failure mode
 * this repairs — somebody edits a number by hand and it is right for nobody's checkout — cannot
 * come back. Everything outside the markers is prose, and prose is bound by ANCHORS below.
 */
const TABLE_START = "<!-- bundle-table:start -->";
const TABLE_END = "<!-- bundle-table:end -->";
const DIST_START = "<!-- dist-table:start -->";
const DIST_END = "<!-- dist-table:end -->";

const table = [
  `**What a bundler leaves in your app.** Measured by \`npm run check:bundle\`, which bundles the`,
  `package \`npm publish\` would upload with esbuild ${esbuild.version} for a browser, minifies it,`,
  `and compresses it the way a CDN serves it — so these are tree-shaken figures for the import`,
  `written in the first column, not the size of any file this package ships. For that, see the`,
  `second table. Both columns are re-derived on every run, so they describe this commit.`,
  ``,
  `| import | minified | brotli |`,
  `|---|---|---|`,
  ...ROWS.map((row) => `| ${row.label} | ${n(measured[row.id].minified)} | ${n(measured[row.id].brotli)} |`),
].join("\n");

const distTable = [
  `Measured by \`npm run check:bundle\` from the \`dist/browser/\` directory inside the packed`,
  `tarball — the files themselves, not a re-bundle of the source they were built from. \`files\` is`,
  `what a browser fetches for that entry: the entry plus every chunk it imports.`,
  ``,
  `| load | files | raw | brotli |`,
  `|---|---|---|---|`,
  ...distRows.map((row) => `| ${row.label} | ${row.files} | ${n(row.raw)} | ${n(row.brotli)} |`),
].join("\n");

/**
 * Every prose number the section states, bound to the measurement that produces it.
 *
 * A pattern must match EXACTLY ONCE. Zero matches fails — the sentence was reworded and the number
 * is now unbound, which is the state this whole tool exists to end, and absence is never agreement.
 * More than one match fails too, because `--write` would have to guess which one it meant.
 */
/**
 * README.md is hard-wrapped, so a sentence carrying two numbers frequently spans a line break. Every
 * literal space in a pattern below therefore matches any run of whitespace — written once here
 * rather than as `\\s+` in five patterns, because the first draft of the `sideEffects` anchor
 * matched ZERO times for exactly this reason and reported the sentence as unbound.
 */
const wrapped = (pattern) => new RegExp(pattern.source.replace(/ /g, "\\s+"), `${pattern.flags}gd`);

const ANCHORS = [
  { id: "gutted",
    pattern: /takes the same bundle from ([\d,]+) to ([\d,]+) minified bytes/,
    values: () => [measured.root.minified, gutted.minified] },
  { id: "together-marginal",
    pattern: /adding three more subpaths to the root costs ([\d,]+) bytes/,
    values: () => [measured.together.minified - measured.root.minified] },
  { id: "opt-in-marginals",
    pattern: /`lokalized\/data\/ordinal` adds ([\d,]+) minified bytes and `lokalized\/data\/ranges` ([\d,]+)/,
    values: () => [measured.rootOrdinal.minified - measured.root.minified,
      measured.rootRanges.minified - measured.root.minified] },
  { id: "side-effects",
    pattern: /takes the single-constant import from ([\d,]+) to ([\d,]+) minified bytes, ([\d,]+)× larger/,
    values: () => [measured.constant.minified, withoutSideEffects.minified,
      Math.round(withoutSideEffects.minified / measured.constant.minified)] },
  // **`unminified-root` IS GONE, AND ITS REMOVAL IS THE POINT.** It bound a sentence saying the
  // root graph is "around 747 KB of unminified source over 31 requests" — true of `src/`, which is
  // what the README's import maps named until M-R S9 pointed them at `dist/browser/`. The anchor
  // would have gone on certifying that number while the sentence described a route no reader takes,
  // because it read `src/index.js` no matter what the document pointed at. The sentence is deleted
  // and the shipped-artifact table above states what the maps actually fetch.
  // NO REPLACEMENT ANCHOR IS ADDED FOR THE PROSE THAT REPLACED IT, deliberately. The browser
  // section now states no byte figure of its own: every number it shows comes out of one of the two
  // generated regions above, which are compared verbatim on every run. An anchor binds a number
  // that lives in prose, and the cheapest way to keep prose honest is for it to carry no number.
];

const write = process.argv.includes("--write");
// A DOCUMENT THAT HEALS ITSELF IS NOT A GATED DOCUMENT. `--write` is how a slice re-records after
// it deliberately moved the graph; run inside CI it would silently rewrite the README and report
// success, which is the whole failure this file exists to prevent, wearing a helpful hat.
if (write && process.env.CI) {
  console.error(`--write is refused under CI. The README is re-recorded deliberately, on the machine` +
    ` that moved the source, so that a drifted document FAILS here rather than repairing itself.`);
  process.exit(2);
}

// The generated region.
const startAt = readme.indexOf(TABLE_START);
const endAt = readme.indexOf(TABLE_END);
if (startAt < 0 || endAt < 0) {
  problems.push(`README.md carries no ${TABLE_START} … ${TABLE_END} region, so the size table is bound` +
    ` to nothing. A missing region is not agreement.`);
} else {
  const present = readme.slice(startAt + TABLE_START.length, endAt).trim();
  if (present !== table) {
    if (write) readme = `${readme.slice(0, startAt + TABLE_START.length)}\n${table}\n${readme.slice(endAt)}`;
    else problems.push(`the README's size table is not what this measurement produces:\n` +
      diff(present, table).map((line) => `      ${line}`).join("\n"));
  }
}

{
  const startAt = readme.indexOf(DIST_START);
  const endAt = readme.indexOf(DIST_END);
  if (startAt < 0 || endAt < 0) {
    problems.push(`README.md carries no ${DIST_START} … ${DIST_END} region, so the SHIPPED artifact's` +
      ` sizes are stated nowhere. Plan :2153 wants the packed output measured, not only a re-bundle.`);
  } else {
    const present = readme.slice(startAt + DIST_START.length, endAt).trim();
    if (present !== distTable) {
      if (write) readme = `${readme.slice(0, startAt + DIST_START.length)}\n${distTable}\n${readme.slice(endAt)}`;
      else problems.push(`the README's shipped-artifact table is not what this measurement produces:\n` +
        diff(present, distTable).map((line) => `      ${line}`).join("\n"));
    }
  }
}
if (distRows.length < 9)
  problems.push(`the shipped-artifact table has ${distRows.length} row(s); the build produces eight entries and a classic script`);

// The anchored prose.
for (const anchor of ANCHORS) {
  const matches = [...readme.matchAll(wrapped(anchor.pattern))];
  if (matches.length !== 1) {
    problems.push(`the '${anchor.id}' sentence matched ${matches.length} times in README.md; it must` +
      ` match exactly once, or the number it states is bound to nothing`);
    continue;
  }
  const [match] = matches;
  const want = anchor.values().map(n);
  const have = match.slice(1);
  if (have.join("|") !== want.join("|")) {
    if (write) {
      // SUBSTITUTED BY CAPTURE-GROUP POSITION, never by string replacement. The first draft did
      // `text.replace(have[index], value)` once per group and produced `2,35212,553` from a sentence
      // whose two placeholders were both `0`: the second replacement found its needle inside what
      // the first had just written. Positions cannot overlap, and they also leave the surrounding
      // whitespace — including the hard line wrap this pattern matched across — exactly as it was.
      const spans = /** @type {any} */ (match).indices.slice(1);
      let rewritten = "";
      let cursor = 0;
      spans.forEach(([from, to], index) => {
        rewritten += readme.slice(cursor, from) + want[index];
        cursor = to;
      });
      readme = rewritten + readme.slice(cursor);
    } else problems.push(`'${anchor.id}': the README says ${have.join(", ")} and the measurement is ` +
      `${want.join(", ")}`);
  }
}

// THE PIN MUST BE EXACT. The caption above is generated, so it can never disagree with the tool
// that wrote it — which makes a README-vs-installed comparison vacuous. What is NOT vacuous is the
// pin itself: a caret would let `npm install` move esbuild, and every number in the table would
// move with it on somebody else's checkout while the file that records them stayed untouched.
// Measured: 0.24.2 and 0.28.2 disagree on the root bundle by 9 bytes and on `negotiate` by 161.
const pinned = pkg.devDependencies?.esbuild;
if (!/^\d+\.\d+\.\d+$/.test(pinned ?? ""))
  problems.push(`devDependencies.esbuild is '${pinned}'; it must be an exact version, because a range` +
    ` lets the bundler move under a table nothing would re-record`);
else if (pinned !== esbuild.version)
  problems.push(`package.json pins esbuild ${pinned} and this checkout has ${esbuild.version};` +
    ` run \`npm ci\` before trusting these numbers`);

/** Smallest useful diff: the lines that differ, with both sides. */
function diff(before, after) {
  const a = before.split("\n"), b = after.split("\n");
  const lines = [];
  for (let index = 0; index < Math.max(a.length, b.length); index++)
    if (a[index] !== b[index]) lines.push(`- ${a[index] ?? "(missing)"}`, `+ ${b[index] ?? "(missing)"}`);
  return lines.slice(0, 24);
}

// NO HAND-WRITTEN NUMBER MAY SIT BESIDE THE DERIVED ONES. Everything above binds the figures the
// README states TODAY; nothing stops the next writer adding a new one, in the same section, in the
// same voice, derived from nothing — which is exactly how the fourteen stale figures this file
// replaced came to be there. So the owned section is scanned, and every number in it must be inside
// the generated region or inside a span an anchor matched.
{
  const heading = readme.indexOf("### What it costs a browser");
  const after = readme.indexOf("\n---\n", heading);
  const section = readme.slice(heading, after < 0 ? readme.length : after);
  // BOTH generated regions are stripped, not one. M-R S9 added the shipped-artifact table and this
  // rule immediately reported all 24 of its figures as hand-written — correctly, by its own lights,
  // because it knew about one region. A rule that has to be taught each region is better than one
  // that guesses: the alternative is a regex for "looks like a table", which would excuse a
  // hand-written one.
  let remainder = section;
  for (const [start, end] of [[TABLE_START, TABLE_END], [DIST_START, DIST_END]]) {
    const from = remainder.indexOf(start);
    const to = remainder.indexOf(end);
    if (from < 0 || to < 0) continue;   // a missing region is already reported above
    remainder = remainder.slice(0, from) + remainder.slice(to + end.length);
  }
  for (const anchor of ANCHORS) {
    const match = wrapped(anchor.pattern).exec(remainder);
    if (match) remainder = remainder.replace(match[0], "");
  }
  // ANY DIGIT, and the bare rule was MEASURED before it was chosen rather than argued for. The first
  // version matched a thousands separator or four-plus digits — and an adversarial pass showed it
  // missing 8 of 12 realistic additions, including BOTH of this section's headline claims: a
  // percentage ("the pinned table is 49.7% of the bundle"), a multiplier ("90x larger"), a module
  // count ("31 modules"), and a tool version ("esbuild 0.24.2 against this checkout") — the last
  // being the literal sentence whose staleness started this work. Reaching a branch is not
  // discriminating it, inside the rule written to stop exactly that.
  //
  // Measured with everything the gate derives stripped, the owned section's remainder contains ZERO
  // digits today, so the strictest spelling costs nothing — the same reasoning, and the same order
  // of operations, as the repo-wide dynamic-code scan's bare tokens.
  const stray = [...new Set([...remainder.matchAll(/\d[\d.,]*%?/g)].map((m) => m[0]))];
  if (stray.length)
    problems.push(`the section this gate owns carries hand-written figure(s) that nothing derives: ` +
      `${stray.join(", ")}. Add an anchor for it in ANCHORS, move it inside the generated region, or ` +
      `take it out — a number beside measured numbers reads as measured.`);
}

// ---------------------------------------------------------------------------- anti-vacuity, per rule
// Not a global count. A prior gate's anti-vacuity terms totalled everything, so deleting an entire
// README section left it at exit 0.
if (ROWS.some((row) => measured[row.id].minified === 0))
  problems.push("a declared row bundled to zero bytes — the measurement is not measuring");
/**
 * **WHAT A CONSUMER'S OWN BUNDLE CARRIES BY WAY OF ATTRIBUTION, measured in the output.**
 *
 * Before M-R S5 the answer was nothing: 322,205 minified bytes of `src/index.js`, the CLDR data
 * inside it, and the word `copyright` occurring ZERO times. The generated modules said "licensed
 * under Unicode License v3. See NOTICE" on a `//` line, and minification removes those.
 *
 * Two rules, and the second is what stops the first being satisfied by a banner stapled to
 * everything. A bundle that REACHES a CLDR-derived module must carry the notice; a bundle that
 * reaches none must NOT — `lokalized/ssr` is three modules of stamping logic and is the standing
 * control, so a future change that sprays the notice across the package fails here rather than
 * looking like more compliance.
 *
 * EXACTLY ONE COPY, because esbuild deduplicates identical legal comments and `test/notice-shape`
 * requires the fifteen banners to be byte-identical for that reason. A second copy means they have
 * drifted apart and every artifact downstream is carrying the notice as many times as there are
 * spellings.
 */
// **WHICH MODULES ARE CLDR-DERIVED IS READ FROM THE MODULE, not matched against its path**, and it
// is the same rule `test/notice-shape.test.js` applies — a file is CLDR-derived when the generator
// stamped the notice into it. A path pattern was tried first and was wrong twice over: esbuild's
// metafile reports inputs relative to `process.cwd()`, so every path here is a long `../../..` walk
// into a temp extraction of the tarball, and `src/data/` matched none of them; and a path rule has
// to hard-code which files under `src/data/` are NOT CLDR, which is the list that went stale in the
// NOTICE in the first place.

let attributionChecked = 0;
for (const [id, row] of Object.entries(measured)) {
  const carriesData = row.carriesCldrData;
  attributionChecked++;
  if (carriesData && row.attributions !== 1) {
    problems.push(`the '${id}' bundle reaches CLDR-derived modules and carries ${row.attributions} ` +
      `copies of the Unicode notice; it must carry exactly one. A minifier keeps a \`/*!\` comment ` +
      `and drops a \`//\` line, and identical comments deduplicate to one`);
  }
  if (!carriesData && row.attributions !== 0) {
    problems.push(`the '${id}' bundle reaches no CLDR-derived module and carries the Unicode notice ` +
      `anyway — attribution that travels with something other than the data it attributes`);
  }
}
if (attributionChecked === 0) problems.push("no bundle was checked for attribution");
if (!Object.values(measured).some((row) => row.attributions === 1)) {
  problems.push("no measured bundle carries the Unicode notice, so the rule above proved nothing");
}
if (!Object.values(measured).some((row) => row.attributions === 0)) {
  problems.push("every measured bundle carries the notice, so the control that would catch a " +
    "sprayed banner does not exist in this row set");
}
if (!measured.root.modules.length || !measured.ssr.modules.length)
  problems.push("a bundle reported no modules, so the structural rules above are asserting nothing");
if (measured.ssr.modules.length >= measured.root.modules.length)
  problems.push(`\`lokalized/ssr\` pulled ${measured.ssr.modules.length} modules against the root's ` +
    `${measured.root.modules.length}; the subpaths are not being resolved separately`);

// ------------------------------------------------------------------------------------------ report
console.log(`bundle sizes — esbuild ${esbuild.version}, brotli ${process.versions.brotli}, from the packed tarball\n`);
// `graph` is the module set esbuild PARSED, which is the same question `tools/graph-walk.mjs`
// answers and not the same as what survived tree-shaking — the one-constant row parses the whole
// root graph and ships 2,350 bytes of it.
console.log(`  ${"import".padEnd(22)}${"minified".padStart(10)}${"brotli".padStart(10)}${"graph".padStart(9)}`);
for (const row of ROWS)
  console.log(`  ${row.id.padEnd(22)}${n(measured[row.id].minified).padStart(10)}` +
    `${n(measured[row.id].brotli).padStart(10)}${String(measured[row.id].modules.length).padStart(9)}`);
console.log(`\n  ablation  likely-subtags gutted   ${n(measured.root.minified)} -> ${n(gutted.minified)}`);
console.log(`  ablation  sideEffects removed     ${n(measured.constant.minified)} -> ${n(withoutSideEffects.minified)}` +
  `  (${Math.round(withoutSideEffects.minified / measured.constant.minified)}×)`);
console.log(`  cross-check  the bundler and tools/graph-walk.mjs agree on every bundleable subpath's module set`);
for (const note of notes) console.log(`  note  ${note}`);

if (write) {
  writeFileSync(readmePath, readme, "utf8");
  console.log(`\nREADME.md rewritten from this measurement.`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`\nevery bundler number the README states is what this bundler produces.`);
