// @ts-check
/**
 * THE ONE DERIVATION FROM AN `exports` KEY TO A BROWSER OUTPUT PATH.
 *
 * **Why this is a module and not four lines in each caller.** `tools/build-browser.mjs` names the
 * esbuild entry points and `test/browser-import-map.test.js` checks the README's import map against
 * them; if each computed the mapping itself, a rename in the builder would leave the gate asserting
 * the old name and passing. That is the drift `tools/graph-walk.mjs` and `tools/readme-blocks.mjs`
 * were both extracted to stop, each after a silent miss.
 *
 * **THE MAPPING IS KEYED ON THE `exports` KEY, NOT ON THE SOURCE PATH, because the three shapes do
 * not agree.** The root's source is `src/index.js` and its output is `lokalized.js`; a plain
 * subpath's source is `src/core/index.js` and its output is `core.js`, losing a directory level; a
 * nested data subpath's source is `src/data/ordinal.js` and its output is `data/ordinal.js`, keeping
 * one. Only the key predicts all three.
 */

/** Where the browser build is published inside the package. */
export const BROWSER_OUTDIR = "dist/browser";

/**
 * @typedef {object} BrowserEntry
 * @property {string} key        the `exports` key, e.g. `.` or `./data/ordinal`
 * @property {string} specifier  what a page imports, e.g. `lokalized/data/ordinal`
 * @property {string} outName    esbuild's entry-point name, e.g. `data/ordinal`
 * @property {string} outFile    the built file relative to `BROWSER_OUTDIR`, e.g. `data/ordinal.js`
 * @property {string} published  package-root-relative with a leading slash, e.g.
 *                               `/dist/browser/data/ordinal.js`. A documented URL must END in this:
 *                               the leading slash anchors the suffix at a path-segment boundary, so
 *                               `.../my-core.js` cannot satisfy `core.js`.
 * @property {string} source     the `exports` target verbatim, e.g. `./src/data/ordinal.js`
 */

/**
 * Every published subpath a browser can load, in `exports` order.
 *
 * `./node` is excluded because it reaches Node built-ins a browser tries to fetch as URLs — measured
 * in Chromium, M-D S19. `./package.json` is excluded because it is not a module.
 *
 * @param {Record<string, unknown>} exportsBlock `package.json#exports`
 * @returns {BrowserEntry[]}
 */
export function browserEntries(exportsBlock) {
  return Object.entries(exportsBlock)
    .filter(([key]) => key !== "./package.json" && key !== "./node")
    .map(([key, value]) => [key, typeof value === "string" ? value : /** @type {any} */ (value)?.import])
    .filter(([, source]) => typeof source === "string" && source.endsWith(".js"))
    .map(([key, source]) => {
      const outName = key === "." ? "lokalized" : key.slice(2);
      return {
        key,
        specifier: key === "." ? "lokalized" : `lokalized/${key.slice(2)}`,
        outName,
        outFile: `${outName}.js`,
        published: `/${BROWSER_OUTDIR}/${outName}.js`,
        source,
      };
    });
}

/**
 * The combined classic-script build's synthetic entry: the root at the TOP LEVEL, every other
 * browser-safe subpath namespaced under it.
 *
 * **THE SHAPE IS A DECISION AND IT IS RECORDED HERE RATHER THAN IN THE BUILDER**, because
 * `test/browser-global.test.js` executes what this produces and must not re-derive it. The root's
 * names go on the global itself because a page that only renders should write
 * `lokalized.createStrings(...)`; everything else is namespaced because `export *` from both the
 * root and `core` would put two bindings of the same name in one scope. The overlap is real and
 * harmless — `lokalized.createStrings` and `lokalized.core.createStrings` are the SAME function
 * object, since one bundle means one copy.
 *
 * @param {ReturnType<typeof browserEntries>} entries
 * @param {(entry: ReturnType<typeof browserEntries>[number]) => string} specifierFor
 *        how to spell each entry's source from the entry file's own directory
 */
export function globalEntrySource(entries, specifierFor) {
  const rootEntry = entries.find((entry) => entry.key === ".");
  if (!rootEntry) throw new Error("the browser entry set has no root; the global build would export nothing");
  const others = entries.filter((entry) => entry !== rootEntry);
  const flat = others.filter((entry) => !entry.outName.includes("/"));
  const nested = others.filter((entry) => entry.outName.includes("/"));
  return [
    `export * from ${JSON.stringify(specifierFor(rootEntry))};`,
    ...flat.map((entry) => `export * as ${entry.outName} from ${JSON.stringify(specifierFor(entry))};`),
    ...nested.map((entry, i) => `import * as _nested${i} from ${JSON.stringify(specifierFor(entry))};`),
    `export const data = Object.freeze({ ${nested
      .map((entry, i) => `${entry.outName.split("/")[1]}: _nested${i}`).join(", ")} });`,
  ].join("\n");
}

/** The classic-script build's filename and the global it defines. */
export const GLOBAL_FILE = "lokalized.global.js";
export const GLOBAL_NAME = "lokalized";
