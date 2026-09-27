// @ts-check
/**
 * HOW SCENARIOS 1-5's COLUMNS ARE TAKEN — the rebuild, the fetch graph, the compression and the
 * aggregation of the runtime samples — as code whose every byte is inside every scenario's frozen recipe
 * digest, beside `harness.mjs`'s (`recipeDigestInput` in `recipe.mjs`). `METHOD` says in data what each
 * column is; this file is what computes it, so the two can come apart only through a change that moves
 * the digest, which is a new revision and cannot be compared as the same scenario (plan 9.2:2795-2797).
 *
 * **IT WAS NOT ALWAYS SO, AND A REVIEW MEASURED WHAT THAT COST (2026-09-25).** While this code sat in
 * `tools/scenarios-1-5.mjs`, outside every digest, computing brotli-q5 at quality 11 moved all eight q5
 * figures down by 6,673 to 7,186 bytes, and counting only a no-build form's entry files as its requests
 * took them 7 -> 1 and 9 -> 2. Both runs exited 0 with the moved figures reported STALE, and after the
 * second the requests ratchet could no longer see a chunk being added.
 *
 * Nothing here holds a run's state: the caller hands in esbuild, the directories and the builds, which is
 * also what lets `test/scenarios-1-5.test.js` call `weigh` and `closure` without packing anything.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import { GLOBAL_FILE, GLOBAL_NAME, globalEntrySource } from "../browser-entries.mjs";
import { renderProblems, sampleOutcome } from "./check.mjs";
import { COMMON, ENTRIES, HARNESS_PATH, METHOD } from "./recipe.mjs";

const posix = (/** @type {string} */ path) => path.split("\\").join("/");

/**
 * `tools/build-browser.mjs`'s options, reproduced — the one place they are copied, and the identity
 * check in the runner is what holds the copy to the original: drift in either direction reds that check
 * before anything is measured. The targets are not copied: the runner reads them from the tarball's own
 * build manifest and hands them in.
 */
const BROWSER_REBUILD = Object.freeze({
  bundle: true, format: /** @type {const} */ ("esm"), platform: /** @type {const} */ ("browser"),
  sourcemap: true, metafile: true, logLevel: /** @type {const} */ ("silent"), write: false,
  legalComments: /** @type {const} */ ("eof"), supported: { "top-level-await": false },
});

/**
 * @typedef {{ bytes: Buffer, inputs: Record<string, { bytesInOutput: number }>, imports: string[] }} Output
 * @typedef {{ key: string, outName: string, source: string }} Entry an entry of `browserEntries`, its
 *   `source` made absolute
 */

/**
 * `dist/browser` rebuilt from the tarball's own `src/`, into the SAME outdir as the shipped build:
 * chunk hashes and source-map paths depend on it.
 * @param {typeof import("esbuild")} esbuild
 * @param {{ pkgDir: string, distDir: string, entries: readonly Entry[], targets: string[], minify: boolean }} options
 * @returns {Promise<Map<string, Output>>} every output file, source maps included, by path under dist/browser
 */
export async function rebuild(esbuild, { pkgDir, distDir, entries, targets, minify }) {
  const common = { ...BROWSER_REBUILD, target: targets, minify, absWorkingDir: pkgDir };
  const rootEntry = entries.find((entry) => entry.key === ".");
  if (!rootEntry) throw new Error("the tarball's exports name no root entry, so there is no single-file root to rebuild");
  const builds = [
    await esbuild.build({ ...common, entryPoints: [rootEntry.source], outfile: join(distDir, "lokalized.js"), splitting: false }),
    await esbuild.build({ ...common, outdir: distDir, splitting: true, chunkNames: "chunks/[name]-[hash]",
      entryPoints: Object.fromEntries(entries.filter((entry) => entry !== rootEntry).map((entry) => [entry.outName, entry.source])) }),
    await esbuild.build({ ...common, format: /** @type {const} */ ("iife"), globalName: GLOBAL_NAME, outfile: join(distDir, GLOBAL_FILE),
      stdin: { contents: globalEntrySource(entries, (entry) => `./${relative(pkgDir, entry.source)}`), resolveDir: pkgDir,
        sourcefile: "global-entry.js", loader: /** @type {const} */ ("js") } }),
  ];
  /** @type {Map<string, Output>} */
  const files = new Map();
  for (const built of builds) {
    const meta = new Map(Object.entries(built.metafile.outputs).map(([path, value]) => [posix(relative(distDir, resolve(pkgDir, path))), value]));
    for (const file of built.outputFiles) {
      const path = posix(relative(distDir, file.path));
      files.set(path, { bytes: Buffer.from(file.contents), inputs: meta.get(path)?.inputs ?? {},
        imports: (meta.get(path)?.imports ?? []).filter((i) => !i.external).map((i) => posix(relative(distDir, resolve(pkgDir, i.path)))) });
    }
  }
  return files;
}

/** Every file under a directory, relative, sorted. @param {string} dir @returns {string[]} */
export const walk = (dir, prefix = "") => readdirSync(join(dir, prefix), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(dir, join(prefix, e.name)) : [posix(join(prefix, e.name))])).sort();

/**
 * The shipped files the rebuild must reproduce: all of dist/browser except `build-manifest.json`, which
 * `tools/build-browser.mjs` writes from esbuild's metafile rather than esbuild emitting it. The runner
 * records that one as the run's output-graph digest instead.
 * @param {string} distDir
 */
export const shippedBrowserFiles = (distDir) => new Map(walk(distDir).filter((path) => path !== "build-manifest.json")
  .map((path) => [path, readFileSync(join(distDir, path))]));

/**
 * The files a page fetches for a no-build form: its entry files and every chunk they import,
 * transitively. This is the `requests` column.
 * @param {ReadonlyMap<string, { imports: readonly string[] }>} build @param {readonly string[]} starts
 */
export function closure(build, starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const file = /** @type {string} */ (stack.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...(build.get(file)?.imports ?? []));
  }
  return [...seen].sort();
}

/**
 * The minified column and the compressed ones: each response compressed ALONE, with METHOD's
 * parameters, then summed — what a server sends per request.
 * @param {readonly Uint8Array[]} parts
 */
export function weigh(parts) {
  /** @type {Record<string, number>} */
  const columns = { minified: parts.reduce((sum, part) => sum + part.length, 0) };
  for (const [column, spec] of Object.entries(/** @type {Record<string, any>} */ (METHOD.compression)))
    columns[column] = parts.reduce((sum, part) => sum + (spec.library === "zlib"
      ? gzipSync(part, { level: spec.gzipLevel })
      : brotliCompressSync(part, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: spec.brotliQuality,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: part.length } })).length, 0);
  return columns;
}

/**
 * One variant's static columns, its included graph (module -> bytes in the minified output, by esbuild's
 * own accounting) and the module URLs a runtime sample imports.
 * @param {typeof import("esbuild")} esbuild
 * @param {{ pkgDir: string, distDir: string, site: string, installed: string, work: string,
 *   shippedBuild: Map<string, Output>, unminifiedBuild: Map<string, Output> }} context
 * @param {string} id @param {any} variant
 */
export async function measureVariant(esbuild, context, id, variant) {
  const { pkgDir, distDir, site, installed, work, shippedBuild, unminifiedBuild } = context;
  if (variant.form === "no-build") {
    const missing = variant.files.filter((/** @type {string} */ file) => !shippedBuild.has(file));
    if (missing.length) throw new Error(`the shipped dist/browser has no ${missing.join(", ")}`);
    const files = closure(shippedBuild, variant.files);
    const inputs = [...new Set(files.flatMap((file) => Object.keys(shippedBuild.get(file)?.inputs ?? {})))].map((path) => join(pkgDir, path));
    /** @type {Map<string, number>} */ const graph = new Map();
    for (const file of files)
      for (const [input, entry] of Object.entries(shippedBuild.get(file)?.inputs ?? {})) {
        const module = posix(relative(pkgDir, resolve(join(pkgDir, input))));
        if (entry.bytesInOutput > 0) graph.set(module, (graph.get(module) ?? 0) + entry.bytesInOutput);
      }
    return {
      files, graph, modules: variant.files.map((/** @type {string} */ file) => pathToFileURL(join(distDir, file)).href),
      columns: { rawSource: inputs.reduce((sum, path) => sum + readFileSync(path).length, 0), rawModules: inputs.length,
        preMinify: closure(unminifiedBuild, variant.files).reduce((sum, file) => sum + (unminifiedBuild.get(file)?.bytes.length ?? 0), 0),
        ...weigh(files.map((file) => readFileSync(join(distDir, file)))), requests: files.length },
    };
  }
  const bundle = (/** @type {boolean} */ minify) => esbuild.build({ ...METHOD.bundler, minify, write: false, metafile: true,
    logLevel: "silent", absWorkingDir: site,
    stdin: { contents: /** @type {any} */ (ENTRIES)[variant.entry], resolveDir: site, sourcefile: "consumer-entry.js", loader: "js" } });
  const [minified, full] = [await bundle(true), await bundle(false)];
  const bytes = Buffer.from(/** @type {any} */ (minified.outputFiles)[0].contents);
  const file = join(work, `bundle-${id}-${variant.entry}.mjs`);
  writeFileSync(file, bytes);
  const inputs = Object.keys(minified.metafile.inputs).filter((path) => !path.endsWith("consumer-entry.js")).map((path) => join(site, path));
  /** @type {Map<string, number>} */ const graph = new Map();
  for (const [input, entry] of Object.entries(/** @type {any} */ (Object.values(minified.metafile.outputs)[0]).inputs))
    if (/** @type {any} */ (entry).bytesInOutput > 0 && !input.endsWith("consumer-entry.js"))
      graph.set(posix(relative(installed, join(site, input))), /** @type {any} */ (entry).bytesInOutput);
  return {
    files: ["(one bundle)"], graph, modules: [pathToFileURL(file).href],
    columns: { rawSource: inputs.reduce((sum, path) => sum + readFileSync(path).length, 0), rawModules: inputs.length,
      preMinify: Buffer.from(/** @type {any} */ (full.outputFiles)[0].contents).length, ...weigh([bytes]), requests: 1 },
  };
}

/** The middle sample, or the upper middle of an even count. @param {number[]} xs */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

/**
 * COMMON.runtime's warm-up plus samples, each a fresh `node --expose-gc harness.mjs`; the warm-up is
 * dropped and every other figure aggregated by its median. A sample that crashes, times out or prints
 * nothing is a named problem and ends the variant's sampling; every kept sample must render `expected`.
 * @param {string} at @param {object} job @param {string} expected
 * @returns {{ runtime: null | Record<string, number>, problems: string[] }}
 */
export function measureRuntime(at, job, expected) {
  const { warmUp, samples: count, timeoutMs } = COMMON.runtime;
  /** @type {any[]} */ const all = [];
  for (let index = 1; index <= warmUp + count; index++) {
    const result = spawnSync(process.execPath, ["--expose-gc", HARNESS_PATH, JSON.stringify(job)], { encoding: "utf8", timeout: timeoutMs });
    const outcome = sampleOutcome(at, index, timeoutMs, result);
    if ("problem" in outcome) return { runtime: null, problems: [outcome.problem] };
    all.push(outcome.sample);
  }
  const measured = all.slice(warmUp);
  const m = (/** @type {string} */ key) => Number(median(measured.map((sample) => sample[key])).toFixed(3));
  return {
    runtime: { samples: measured.length, importMs: m("importMs"), constructMs: m("constructMs"),
      firstRenderMs: m("firstRenderMs"), retainedBytes: m("retainedBytes") },
    problems: renderProblems(at, all, expected),
  };
}
