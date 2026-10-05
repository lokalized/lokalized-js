// @ts-check
/**
 * HOW SCENARIO 0a's NODE ROWS ARE TAKEN — what each variant is handed, where each timing window opens
 * and closes, what counts as retained heap, and which graph the ratcheted figures describe.
 *
 * EVERY BYTE OF THIS FILE IS INSIDE THE FROZEN RECIPE DIGEST (`RECIPE.harness` in
 * `tools/0a-recipe.mjs`) — plan 9.2:2789's "harness source and command hashes", and the rule
 * `tools/scenarios-1-5/recipe.mjs` applies to its `harness.mjs` and `measure.mjs`. So an edit here, a
 * comment included, changes the recipe digest: under an unmoved revision every run fails, and a new
 * revision is recorded only with a reason.
 *
 * **IT WAS NOT ALWAYS SO, AND A REVIEW MEASURED WHAT THAT COST (2026-09-26).** While this code sat in
 * `tools/scenario-0a.mjs`, outside the digest, changing its `graphBytes(entry)` to
 * `graphBytes("src/core/index.js")` gave the root row core's graph at exit 0 with the recipe digest
 * unchanged, and a bare `--write` then stored it with no reason and no history entry.
 *
 * Nothing here judges: `tools/scenario-0a.mjs` holds what this returns to the recipe — the options
 * handed over (`handedProblems`), each row's graph derived again from the declared entry, as returned
 * and as recorded (`measuredGraphProblems`), and every timing present and finite (`timingProblems`).
 */
import { resolve } from "node:path";

import { RECIPE, TIEBREAKERS, catalogsFor } from "./0a-recipe.mjs";
import { graphBytes } from "./graph-walk.mjs";

const gc = /** @type {undefined | (() => void)} */ (globalThis.gc);
const median = (/** @type {number[]} */ xs) => /** @type {number} */ ([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);

let bust = 0;
/** @param {string} spec */
async function timedImport(spec) {
  const t0 = performance.now();
  const mod = await import(`${spec}?m=${bust++}`);
  return { ms: performance.now() - t0, mod };
}

/**
 * Heap still used after two forced collections around `build`, or null without `--expose-gc` — which
 * `timingProblems` refuses, so a run without it fails rather than recording no heap.
 * @param {() => Promise<unknown>} build
 */
async function retained(build) {
  if (!gc) return null;
  gc(); gc();
  const before = process.memoryUsage().heapUsed;
  const held = await build();
  gc(); gc();
  const after = process.memoryUsage().heapUsed;
  if (!held) throw new Error("build() returned nothing");
  return after - before;
}

/**
 * One variant of the recipe, measured. Variant 1, the root, parses a raw-text catalog at construction —
 * the whole point of that variant is that construction pays for parsing. Variant 2, lokalized/core, gets
 * the ALREADY-PARSED equivalent: same content, same artifact, and the differences 0a is comparing are the
 * entry point's graph AND the parsing the caller has already paid for elsewhere.
 *
 * The options object is KEPT as it is handed over and returned as `handed`, so what was measured can be
 * held to the recipe rather than assumed to match it.
 * @param {string} root the checkout whose `src/` is measured
 * @param {{ label: string, entry: string, catalogInput: string }} variant one of `RECIPE.variants`
 */
export async function measureVariant(root, variant) {
  const url = `file://${resolve(root, variant.entry)}`;
  /** @type {unknown} */
  let handed = null;
  const construct = (/** @type {any} */ mod) =>
    mod.createStrings(handed = {
      fallbackLocale: RECIPE.construction.fallbackLocale,
      localeSupplier: () => RECIPE.construction.localeSupplierAnswers,
      localizedStringSupplier: () => (catalogsFor(variant)),
      tiebreakerLocalesByLanguageCode: TIEBREAKERS,
    });
  const render = (/** @type {any} */ strings) => strings.get(RECIPE.render.key, { ...RECIPE.render.values });

  /** @type {number[]} */ const imports = [];
  /** @type {number[]} */ const constructions = [];
  /** @type {number[]} */ const renders = [];
  /** @type {unknown} */
  let firstRender = null;
  for (let i = 0; i < RECIPE.iterations; i++) {
    const { ms, mod } = await timedImport(url);
    imports.push(ms);

    const c0 = performance.now();
    const strings = construct(mod);
    constructions.push(performance.now() - c0);

    // FIRST render specifically: any lazy work a construction deferred is charged here, which is
    // where a caller actually feels it.
    const r0 = performance.now();
    firstRender = render(strings);
    renders.push(performance.now() - r0);
  }

  const heap = await retained(async () => construct((await timedImport(url)).mod));
  const { bytes, modules } = graphBytes(root, variant.entry);

  return {
    row: {
      label: variant.label,
      sourceBytes: bytes,
      modules,
      importMs: median(imports),
      constructionMs: median(constructions),
      firstRenderMs: median(renders),
      retainedBytes: heap,
      firstRender,
    },
    handed,
  };
}
