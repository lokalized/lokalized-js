#!/usr/bin/env node
// @ts-check
/**
 * THE NO-BUILD BROWSER DISTRIBUTION — plan 6.3's `dist/browser/`, produced by the pinned esbuild.
 *
 * **THE TOOLCHAIN IS A RECORDED DEVIATION, NOT A READING OF THE PLAN.** Plan :2149 says "Browser
 * artifacts use lockfile-pinned Rollup plus Terser" and this repository has neither; what it has is
 * an exactly-pinned esbuild that already bundles the real `npm pack` tarball, ratchets fourteen
 * published figures, cross-checks its module sets against `tools/graph-walk.mjs` and gates the
 * Unicode attribution in the artifact. The maintainer decided to depart from the plan rather than
 * adopt a second bundler; that is amendment A20 in `planning/M-R-STATUS.md`, with its cost written
 * down. Nothing here should be read as a claim that the two toolchains produce equivalent output —
 * nothing in this project has ever run Rollup, so that is unmeasured.
 *
 * **THE ENTRY SET IS DERIVED, AND THE PLAN'S OWN ENUMERATION IS TWO SHORT.** Plan 6.3 names six
 * files — a root plus `load`, `ssr`, `negotiate`, `data/ordinal`, `data/ranges` — while the browser
 * surface this package documents and gates is EIGHT specifiers: `test/browser-import-map.test.js`
 * derives the import map from `package.json#exports` and requires every browser-safe subpath to be
 * in it, and the README's map lists all eight. Building the plan's six would leave
 * `lokalized/core` and `lokalized/parse` documented, gated, and unresolvable in a browser. So the
 * set is derived from `exports` here too, minus `./node`, which cannot run in a browser and whose
 * absence M-D S19 measured in a real one.
 *
 * **TWO BUILDS, BECAUSE THE ROOT'S CONTRACT IS DIFFERENT FROM THE OTHERS'.** Plan :2144 requires the
 * single-file root to have NO transitive imports, so it is built alone with splitting off. The
 * optional entries "may form a colocated ESM graph" and are built together WITH splitting, so the
 * ~300 KB of pinned locale data they share is one chunk rather than seven copies. Chunk names are
 * content-derived, which is what makes them cacheable forever behind a version-pinned URL.
 *
 *   node tools/build-browser.mjs            build into a temp directory and CHECK it, leaving the
 *                                          working tree alone. This is `npm run check:dist`.
 *   node tools/build-browser.mjs --write    write `dist/browser/`. This is what `prepack` runs.
 *
 * **THE CHECK DOES NOT WRITE `dist/` INTO THE WORKING TREE, and the reason CHANGED on 2026-09-19.**
 * It used to be that `dist/` was not in `.gitignore`, so a build left behind was 35 files of
 * minified output in `git status` after every source change. The maintainer has since added the
 * ignore entry, which retires that reason entirely — and the behaviour is kept anyway, for the
 * one that survives: a CHECK must not leave an artifact other gates might read as current.
 * `tools/readme-newcomer.mjs` compares the published graph against the tarball's OWN build
 * manifest rather than a repository `dist/` for exactly this reason, and a stale directory sitting
 * in the tree is how that comparison would have quietly started describing the last build instead
 * of this one. `prepack` runs `--write` and produces the real thing, which is the invariant
 * `test/package-shape.test.js` enforces: a published path git does not carry must be produced
 * before packing. That rule is unaffected by the ignore entry, because `dist/` was untracked
 * either way.
 *
 * **THE PROHIBITIONS ARE CHECKED ON THE OUTPUT, and until this tool they were checked nowhere.**
 * Measured: `test/pinned-data-only.test.js` walks `src/`, `test/package-shape.test.js`'s Node
 * built-in scan walks `src/`, and `tools/subpath-graphs.mjs`'s containment rule walks `src/`. Plan
 * :2146-2147 puts its prohibitions on the BROWSER GRAPH, which after this slice is `dist/`. A built
 * artifact that violated every one of them would have passed every gate in this repository.
 */
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { BROWSER_OUTDIR, GLOBAL_FILE, GLOBAL_NAME, browserEntries, globalEntrySource } from "./browser-entries.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * The exact floors of plan §1.1's compatibility table. esbuild is told all three and downlevels to
 * the oldest; M-R S1 measured that the source is already floor-clean, so the output is
 * BYTE-IDENTICAL to an `esnext` build — 322,171 minified on all three targets. They are named
 * anyway, because "it happens not to matter today" is not the same as "it is targeted".
 */
const TARGETS = ["safari16.4", "chrome111", "firefox111"];


/**
 * Every published subpath a browser can load, from the ONE derivation `test/browser-import-map.test.js`
 * also reads. It used to be four lines here and four lines there; a rename in this file would have
 * left that gate asserting the old name and passing, which is the drift `tools/graph-walk.mjs` and
 * `tools/readme-blocks.mjs` were each extracted to stop after a silent miss.
 */
const entries = browserEntries(pkg.exports).map((entry) => ({ ...entry, source: join(root, entry.source) }));

const rootEntry = /** @type {typeof entries[number]} */ (entries.find((e) => e.outName === "lokalized"));
const optional = entries.filter((e) => e !== rootEntry);

/** @param {string} outdir */
async function build(outdir) {
  const common = {
    bundle: true, format: /** @type {const} */ ("esm"), platform: /** @type {const} */ ("browser"),
    minify: true, sourcemap: true, target: TARGETS, metafile: true, logLevel: /** @type {const} */ ("silent"),
    // esbuild's default already preserves `/*!` and `@license` comments and collects them into one
    // block per output. Named explicitly because plan :2151 requires it and a default is not a
    // decision — `npm run check:bundle` gates that the Unicode notice is actually in the artifact.
    legalComments: /** @type {const} */ ("eof"),
    // **PLAN :2147's TOP-LEVEL-AWAIT PROHIBITION, ENFORCED BY THE BUNDLER RATHER THAN BY A REGEX.**
    // The text rule far below reads only the first line's first statement, so it is unreachable for
    // any output esbuild produces and has never been able to fire.
    //
    // MEASURED ACROSS BOTH FORMATS AND BOTH FLAG STATES, because an earlier version of this comment
    // stated the second half wrongly and an ablation caught it. A module containing
    // `export const x = await Promise.resolve(1);`:
    //   esm  without this flag -> BUILDS, with the await in the output
    //   esm  with this flag    -> refused, "Top-level await is not available in the configured
    //                             target environment"
    //   iife without this flag -> refused anyway, "Top-level await is currently not supported with
    //                             the \"iife\" output format"
    //   iife with this flag    -> refused
    // So the flag is what closes the TWO MODULE builds; the classic build refuses regardless,
    // because the format cannot express it. The comment this replaced said "without it the same
    // build succeeds", which is true of the ESM build alone and false of this tool — and it would
    // have read as though the flag were redundant. Either way the refusal routes through the catch
    // below, which prints a named reason and exits 1.
    supported: { "top-level-await": false },
  };

  const single = await esbuild.build({
    ...common, entryPoints: [rootEntry.source], outfile: join(outdir, "lokalized.js"), splitting: false,
  });

  const graph = await esbuild.build({
    ...common,
    entryPoints: Object.fromEntries(optional.map((e) => [e.outName, e.source])),
    outdir, splitting: true, chunkNames: "chunks/[name]-[hash]",
  });

  // **THE CLASSIC-SCRIPT GLOBAL — one file, no modules, no import map, no build step on the reader's
  // side.** Plan 6.3 enumerates npm exports, a single-file module root and the optional module
  // entries; a non-module artifact is UNADDRESSED by it rather than permitted or forbidden, so this
  // is amendment A21 in `planning/M-R-STATUS.md`, recorded the way A20 was.
  //
  // **IT IS ONE COMBINED FILE AND THAT IS A MEASUREMENT, NOT A PREFERENCE.** esbuild REFUSES
  // `splitting` with `format: "iife"`, so per-subpath globals can share nothing: all eight cost
  // 912,641 minified / 286,078 brotli against this build's 263,172 / 71,985, they evaluate the
  // pinned CLDR module twice and build two independent 7,788-entry Maps, and `instanceof` fails
  // across the copies. 3.5x on the wire for a worse artifact.
  //
  // `logLevel` is raised here alone: `import.meta` is FAIL-OPEN in the IIFE format — esbuild warns
  // and emits an empty object — and `src/` using none of it today is not a reason to ship a build
  // that would swallow the first one silently.
  const global = await esbuild.build({
    ...common, logLevel: /** @type {const} */ ("warning"),
    format: /** @type {const} */ ("iife"), globalName: GLOBAL_NAME,
    stdin: { contents: globalEntrySource(entries, (e) => `./${relative(root, e.source)}`), resolveDir: root, sourcefile: "global-entry.js", loader: /** @type {const} */ ("js") },
    outfile: join(outdir, GLOBAL_FILE),
  });

  return { single, graph, global };
}


/** Every file under a directory, relative and sorted. @param {string} dir */
const walk = (dir, prefix = "") => readdirSync(join(dir, prefix), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(dir, join(prefix, e.name)) : [join(prefix, e.name)]))
  .sort();

const writing = process.argv.includes("--write");
const outdir = writing
  ? join(root, BROWSER_OUTDIR)
  : join(tmpdir(), `lokalized-dist-${process.pid}`);

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
// The check's temporary build goes on `exit`, not after the checks below, where a throw anywhere in
// between skipped it: two `lokalized-dist-<pid>` directories were found left in the system temp folder.
if (!writing) process.on("exit", () => rmSync(outdir, { recursive: true, force: true }));

let single, graph, global;
try {
  ({ single, graph, global } = await build(outdir));
} catch (error) {
  // **A BUILD THAT WILL NOT RUN IS A PACKAGING DEFECT AND MUST READ AS ONE.** An ablation adding
  // `import "node:crypto"` to a browser source made esbuild refuse to resolve it, and this tool
  // exited 1 with a raw stack — which is fail-closed and the right status, but this project has
  // twice mistaken a crashed harness for a catastrophic regression, so the reason is named here.
  const detail = String(/** @type {any} */ (error).message ?? error).split("\n").slice(0, 6);
  console.error("  the browser distribution did not build:");
  for (const line of detail) console.error(`    ${line}`);
  rmSync(outdir, { recursive: true, force: true });
  process.exit(1);
}
const outputs = { ...single.metafile.outputs, ...graph.metafile.outputs, ...global.metafile.outputs };

/**
 * THE OUTPUT-GRAPH MANIFEST plan :2152 asks for: which specifier maps to which file, which chunks
 * each entry pulls in, and what every file weighs. The checks below read the FILES, never this — a
 * manifest that described an artifact nobody verified would be the defect, not the record.
 */
const manifest = {
  formatVersion: 1,
  builder: `esbuild ${esbuild.version}`,
  targets: TARGETS,
  deviation: "plan 6.3 names Rollup + Terser; amendment A20 records the departure",
  entries: entries.map((entry) => {
    // EXACT, not `endsWith`. The suffix form was blind to an artifact that disagrees with the
    // derivation: an output renamed `core-v2.js` still matched `/core.js` through a sibling path and
    // the tool exited 0. Measured against the tightened form, the same divergence reds with 8
    // problems — which is what makes "documented == derivation" imply "documented == built".
    const file = Object.keys(outputs).find((path) =>
      relative(outdir, resolve(root, path)) === entry.outFile);
    const meta = file ? outputs[file] : undefined;
    return {
      specifier: entry.specifier,
      file: file ? relative(outdir, resolve(root, file)) : null,
      bytes: meta?.bytes ?? null,
      chunks: (meta?.imports ?? []).map((i) => relative(outdir, resolve(root, i.path))).sort(),
    };
  }),
  global: { file: GLOBAL_FILE, globalName: GLOBAL_NAME, bytes: statSync(join(outdir, GLOBAL_FILE)).size },
  files: walk(outdir).map((path) => ({ path, bytes: statSync(join(outdir, path)).size })),
};
writeFileSync(join(outdir, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

/* ------------------------------------------------------------------ the checks, on the output */
const problems = [];
const scripts = walk(outdir).filter((path) => path.endsWith(".js"));
const text = new Map(scripts.map((path) => [path, readFileSync(join(outdir, path), "utf8")]));

/**
 * **THE IMPORT GRAPH COMES FROM THE METAFILE, NOT FROM A REGEX OVER THE OUTPUT, and the first
 * version of this tool proved why.** Scanning minified text for `import … from "…"` reported that
 * the single-file root imports `lokalized/data/ordinal` and `lokalized/data/ranges` as bare
 * specifiers — a direct violation of plan :2144 — and it was a false positive both times. Those
 * strings are error-message fragments in `src/core/index.js` ("imported from
 * 'lokalized/data/ordinal'"), and after minification a `[^;]*?` between an `export` and a `from`
 * walks straight through them. Four more rules fired on the same mistake.
 *
 * esbuild's metafile records each output's real imports with their kind and whether they were left
 * external, which is the question these rules are actually asking. A regex over a minified artifact
 * answers a different one.
 */
const importsOf = (/** @type {string} */ path) => {
  const meta = outputs[Object.keys(outputs).find((key) => relative(outdir, resolve(root, key)) === path) ?? ""];
  return meta?.imports ?? [];
};

let staticSpecifiers = 0;
for (const path of scripts) {
  for (const imported of importsOf(path)) {
    staticSpecifiers++;
    const specifier = imported.external ? imported.path : relative(outdir, resolve(root, imported.path));
    if (imported.external) {
      if (/^node:|^(?:fs|path|url|crypto|os|util|stream|buffer)$/.test(specifier))
        problems.push(`${path} imports the Node built-in '${specifier}'`);
      else problems.push(`${path} imports the bare specifier '${specifier}'; a browser graph resolves nothing`);
    } else if (imported.kind === "dynamic-import") {
      problems.push(`${path} carries a dynamic import of '${specifier}'`);
    } else if (!text.has(specifier)) {
      problems.push(`${path} imports '${specifier}', which is not a file in this build`);
    }
  }
}

for (const [path, body] of text) {
  // The two repo-wide rules that until now watched `src/` only, and plan :2147's top-level await.
  // Kept as text rules because there is nothing structural to ask: `withoutComments` is unnecessary
  // on minified output, which carries no comments but the legal ones.
  const code = body.replace(/\/\*![^]*?\*\//g, "");
  if (/\beval\b/.test(code)) problems.push(`${path} references eval`);
  if (/\bnew\s+Function\b/.test(code)) problems.push(`${path} constructs a Function from source`);
  if (/\bIntl\b/.test(code)) problems.push(`${path} reaches for the host Intl; classification is from pinned CLDR data`);
  if (/^\s*(?:var|let|const)?[^;]*?[=;]\s*await\s/.test(code.split("\n")[0] ?? ""))
    problems.push(`${path} opens with top-level await; a browser graph must not`);
}

/** Plan :2144: the single-file root has no transitive imports at all. */
if (importsOf("lokalized.js").length > 0)
  problems.push(`lokalized.js is the single-file root and imports ` +
    `${importsOf("lokalized.js").map((i) => `'${i.path}'`).join(", ")}`);

/**
 * **THE BUILT SET IS COMPARED AGAINST THE DOCUMENTED ONE, AND AN ABLATION IS WHY.** Everything above
 * derives from `package.json#exports`, so a filter added to that derivation is invisible to it:
 * dropping `./parse` from the entry list left this tool at exit 0 with seven entries, having
 * verified seven entries. That is the one-directional shape M8 S5, S28, S30 and M9 S3 each closed
 * one level up — a gate that checks what it was given rather than what was promised.
 *
 * The README's import map is the independent source. It is not another reading of `exports` here:
 * `test/browser-import-map.test.js` DERIVES completeness from `package.json#exports` and fails when
 * the map omits a browser-safe subpath, so the map is held to the surface by a different gate, and
 * this compares the build to the map.
 */
const documented = new Set(
  [...readFileSync(join(root, "README.md"), "utf8").matchAll(/"(lokalized(?:\/[a-z/]+)?)":\s*"\.\//g)]
    .map((match) => match[1]));
if (documented.size < 8)
  problems.push(`the README documents ${documented.size} browser specifier(s); the derivation is broken`);
const built = new Set(manifest.entries.map((entry) => entry.specifier));
for (const specifier of documented)
  if (!built.has(specifier)) problems.push(`${specifier} is documented for browsers and this build produces no file for it`);
for (const specifier of built)
  if (!documented.has(specifier)) problems.push(`${specifier} is built and the README's import map does not document it`);

/** Every documented browser specifier resolves to a file that exists. */
for (const entry of manifest.entries) {
  if (entry.file === null) { problems.push(`${entry.specifier} produced no output file`); continue; }
  if (!text.has(entry.file)) problems.push(`${entry.specifier} maps to ${entry.file}, which is not in the build`);
  for (const chunk of entry.chunks)
    if (!text.has(chunk)) problems.push(`${entry.specifier} pulls in ${chunk}, which is not in the build`);
}

/**
 * **THE SOURCE MAPS PLAN :2152 REQUIRES, CHECKED RATHER THAN MERELY EMITTED.** Until M-R S9 this
 * tool set `sourcemap: true` and asserted nothing about the result: an ablation flipping it to
 * `false` left the run at EXIT 0, shipping a minified distribution with no way to debug it.
 *
 * WHICH OUTPUTS MUST CARRY MAPPINGS IS DERIVED, not a hand-kept exemption for the re-export entries
 * that compile to nothing. Measured across all 16 outputs, a map's `sources` count equals exactly
 * the number of metafile inputs contributing bytes to that output — `lokalized.js` 31/31,
 * `load.js` 7/7, `chunk-EQ24XWP2` 13/13, `core.js` 0/0 — so the rule reads the metafile and needs
 * no list of special cases.
 */
let maps = 0, mappedSources = 0, syntheticEntries = 0;
for (const path of scripts) {
  const meta = outputs[Object.keys(outputs).find((key) => relative(outdir, resolve(root, key)) === path) ?? ""];
  const contributing = Object.values(meta?.inputs ?? {}).filter((input) => input.bytesInOutput > 0).length;
  if (!(text.get(path) ?? "").includes(`//# sourceMappingURL=`))
    { problems.push(`${path} carries no sourceMappingURL comment`); continue; }
  let map;
  try { map = JSON.parse(readFileSync(join(outdir, `${path}.map`), "utf8")); }
  catch { problems.push(`${path} declares a source map and ${path}.map is missing or unreadable`); continue; }
  maps++;
  mappedSources += map.sources.length;
  if (map.sources.length !== contributing)
    problems.push(`${path}.map lists ${map.sources.length} source(s) and the build put bytes from ` +
      `${contributing} input(s) into it`);
  map.sources.forEach((/** @type {string} */ source, /** @type {number} */ i) => {
    const content = map.sourcesContent?.[i] ?? "";
    // THE ONE EXEMPTION, NAMED AND COUNTED. The global build's entry is generated in memory and has
    // no file on disk, so its path cannot resolve — and it does not need to, because the map
    // carries its text. The exemption is exact (this file, this source) and the floor below fails
    // if it ever stops being used, so it cannot quietly widen to cover a real missing source.
    if (path === GLOBAL_FILE && source.endsWith("/global-entry.js")) {
      if (!content.trim()) problems.push(`${path}.map carries no content for the generated entry`);
      else syntheticEntries++;
      return;
    }
    if (!statSync(resolve(dirname(join(outdir, path)), source), { throwIfNoEntry: false }))
      problems.push(`${path}.map points at ${source}, which does not resolve from the map`);
    if (!content.trim())
      problems.push(`${path}.map carries no content for ${source}, so it cannot show the source`);
  });
}

/**
 * **THE MANIFEST IS READ BACK FROM DISK AND COMPARED TO THE DIRECTORY.** Every check above reads the
 * in-memory object, so deleting the `writeFileSync` that produces it left this tool at EXIT 0 while
 * shipping a `dist/browser/` with no manifest at all — plan :2152 asks for the file, not for the
 * intention. Re-walking also catches the manifest disagreeing with what is actually there.
 */
{
  /** @type {any} */
  let written;
  try { written = JSON.parse(readFileSync(join(outdir, "build-manifest.json"), "utf8")); }
  catch { problems.push("build-manifest.json is missing or unparseable; plan :2152 requires it in the artifact"); written = null; }
  if (written) {
    // It lists every file BUT itself, because it cannot state its own size before it is written.
    const onDisk = walk(outdir).filter((path) => path !== "build-manifest.json")
      .map((path) => ({ path, bytes: statSync(join(outdir, path)).size }));
    if (JSON.stringify(written.files) !== JSON.stringify(onDisk)) {
      // NAME WHAT MOVED. The first version printed a disjunction over count and size, so tampering
      // that left the count equal reported "lists 34 file(s) and the directory holds 34, or their
      // sizes differ" — two identical numbers and an inference left to the reader. It caught the
      // defect; it did not say what the defect was.
      const byPath = new Map(onDisk.map((entry) => [entry.path, entry.bytes]));
      const moved = written.files
        .filter((/** @type {any} */ entry) => byPath.get(entry.path) !== entry.bytes)
        .map((/** @type {any} */ entry) => `${entry.path} (${entry.bytes} declared, ` +
          `${byPath.get(entry.path) ?? "absent"} on disk)`);
      const extra = onDisk.filter((entry) => !written.files
        .some((/** @type {any} */ declared) => declared.path === entry.path)).map((entry) => entry.path);
      problems.push(`build-manifest.json does not describe the directory it was written into: ` +
        (moved.length ? `${moved.length} file(s) differ — ${moved.slice(0, 3).join(", ")}` : "") +
        (moved.length && extra.length ? "; " : "") +
        (extra.length ? `${extra.length} undeclared — ${extra.slice(0, 3).join(", ")}` : "") +
        (moved.length || extra.length ? "" : `it lists ${written.files.length} and the directory holds ${onDisk.length}`));
    }
    if (JSON.stringify(written.entries) !== JSON.stringify(manifest.entries))
      problems.push("build-manifest.json's entries differ from the ones this run computed");
  }
}

/**
 * **THE CLASSIC-SCRIPT GLOBAL.** It is not a module, so the module rules above say nothing useful
 * about it: what matters is that it stands alone and actually defines the global it promises.
 */
if (importsOf(GLOBAL_FILE).length > 0)
  problems.push(`${GLOBAL_FILE} is a classic script and imports ` +
    `${importsOf(GLOBAL_FILE).map((i) => `'${i.path}'`).join(", ")}`);
if (!new RegExp(`\\bvar\\s+${GLOBAL_NAME}\\s*=`).test(text.get(GLOBAL_FILE) ?? ""))
  problems.push(`${GLOBAL_FILE} does not assign the global \`lokalized\`, so a <script src> loads nothing`);

/**
 * THE ATTRIBUTION, ON THE ARTIFACT A BROWSER LOADS. M-R S5 gated it for a bundler's output; this is
 * the same question one step later, about the files this package publishes for direct loading. A
 * file holding CLDR-derived data must carry the notice, and one holding none must not — the second
 * half is what stops the rule being satisfied by stamping everything.
 */
const isCldrInput = (/** @type {string} */ inputPath) => {
  try { return readFileSync(resolve(root, inputPath), "utf8").includes("Generated by tools/gen-data.js from pinned CLDR"); }
  catch { return false; }
};
/**
 * **WHICH OUTPUT FILES CARRY CLDR DATA IS THE METAFILE'S BYTE ACCOUNTING**, for the reason M-R S5
 * measured one gate earlier: a heuristic over the output text — there, the longest string literal;
 * here, a long base64 run — sees the storage shape one or two modules happen to use and misses the
 * rest. The first version of this rule reported `data/ordinal.js` and three chunks as carrying the
 * attribution and none of the data, which was the detector being wrong about four files out of six.
 */
const dataFiles = new Set(Object.entries(outputs)
  .filter(([, meta]) => Object.entries(meta.inputs ?? {})
    .some(([input, entry]) => entry.bytesInOutput > 0 && isCldrInput(input)))
  .map(([key]) => relative(outdir, resolve(root, key))));

let withData = 0, withNotice = 0;
for (const [path, body] of text) {
  const data = dataFiles.has(path);
  const notice = body.includes("Copyright (c) 1991-2025 Unicode");
  if (data) withData++;
  if (notice) withNotice++;
  if (data && !notice) problems.push(`${path} carries CLDR-derived data and no Unicode attribution`);
  if (!data && notice) problems.push(`${path} carries the Unicode attribution and none of the data`);
}

/* anti-vacuity: each rule must have had something to look at */
if (scripts.length < 8) problems.push(`the build produced ${scripts.length} script(s); the checks above ran over almost nothing`);
if (staticSpecifiers === 0) problems.push("no built file imports anything, so the specifier rules asserted nothing");
if (withData === 0) problems.push("no built file carries encoded data, so the attribution rule asserted nothing");
if (withNotice === 0) problems.push("no built file carries the Unicode attribution");
if (withNotice === scripts.length) problems.push("every built file carries the attribution, so the control that catches a sprayed notice does not exist here");
if (maps < scripts.length) problems.push(`${scripts.length} script(s) were built and only ${maps} source map(s) were read`);
if (syntheticEntries !== 1)
  problems.push(`the generated-entry source-map exemption applied ${syntheticEntries} time(s); it must apply exactly once`);
if (mappedSources < 70) problems.push(`the source maps name ${mappedSources} source(s) in total, which is fewer than this package has`);

console.log(`dist/browser — ${manifest.entries.length} entries, ${manifest.files.length + 1} files, ${manifest.builder}`);
for (const entry of manifest.entries) {
  console.log(`  ${String(entry.bytes).padStart(7)}  ${entry.specifier.padEnd(24)} ${entry.file}` +
    (entry.chunks.length > 0 ? `  +${entry.chunks.length} chunk(s)` : ""));
}
console.log(`  ${GLOBAL_FILE.padEnd(24)} ${manifest.global.bytes} bytes, classic <script src>, window.${manifest.global.globalName}`);
console.log(`  ${staticSpecifiers} static specifier(s) checked · ${withData} file(s) with data · ${withNotice} with the notice · ${maps} source map(s)`);
if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exit(1);
}
console.log(writing ? "written." : "the browser distribution satisfies plan 6.3's prohibitions.");
