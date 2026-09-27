// @ts-check
/**
 * ONE COLD RUNTIME SAMPLE for scenarios 1-5, taken in the fresh process that runs this file.
 *
 * EVERY BYTE OF THIS FILE IS INSIDE EVERY SCENARIO'S FROZEN RECIPE DIGEST — plan 9.2:2789's "harness
 * source and command hashes" — because it decides what the runtime columns MEAN: whether the catalog
 * arrives as JSON text or as objects, where each timing window opens and closes, and what counts as
 * retained memory. So an edit here, a comment included, is a new revision of all five scenarios.
 *
 *   node --expose-gc tools/scenarios-1-5/harness.mjs '<job JSON>'
 */
import { readFileSync } from "node:fs";

async function sample() {
  const job = JSON.parse(process.argv[2] ?? "null");
  const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);
  if (typeof gc !== "function") throw new Error("the harness needs --expose-gc: retained memory is heap after collection");
  const fixture = JSON.parse(readFileSync(job.fixture, "utf8"));

  // RAW: each catalog reaches createStrings as JSON TEXT, which the library decodes and validates.
  // PARSED: as the objects themselves. Converting is the harness's work, done before any window opens.
  const options = { ...fixture.options };
  if (job.input === "raw")
    options.strings = Object.fromEntries(Object.entries(options.strings).map(([tag, catalog]) => [tag, JSON.stringify(catalog)]));

  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  /** @type {any[]} */
  const modules = [];
  for (const url of job.modules) modules.push(await import(url));
  const t1 = performance.now();
  // A bundler form's consumer entry exports `construct` and wires its own data; a no-build form is the
  // page's own code, so the optional data module's export is handed over here.
  const strings = job.form === "bundler"
    ? modules[0].construct(options)
    : modules[0].createStrings(job.data ? { ...options, pluralData: { [job.data.option]: modules[1][job.data.export] } } : options);
  const t2 = performance.now();
  const rendered = strings.get(fixture.call.key, fixture.call.values);
  const t3 = performance.now();
  /** @type {any} */ (globalThis).__held = [modules, strings];
  gc(); gc();
  return { importMs: t1 - t0, constructMs: t2 - t1, firstRenderMs: t3 - t2, retainedBytes: process.memoryUsage().heapUsed - before, rendered };
}

try {
  process.stdout.write(JSON.stringify(await sample()));
} catch (error) {
  // NAMED HERE, ON ONE LINE, AND THE PROCESS ENDS NORMALLY. Left uncaught, an error thrown from a
  // minified bundle makes Node quote the offending source line — the whole bundle is one line — and a
  // pipe is written asynchronously on macOS, so the crashing process exited with its stderr cut at
  // 65,536 bytes, inside that quotation, before the error was named (measured, first crash ablation).
  const thrown = /** @type {any} */ (error);
  process.stderr.write(`${thrown?.name ?? "Error"}: ${String(thrown?.message ?? thrown).split("\n")[0]}\n`);
  process.exitCode = 1;
}
