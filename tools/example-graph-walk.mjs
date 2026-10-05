// @ts-check
/**
 * The transitive graph of a module that imports the package BY ITS PUBLIC SPECIFIER.
 *
 * `tools/graph-walk.mjs` follows RELATIVE imports only, which is all `src/` ever writes. An example
 * is consumer-shaped code and writes `import { loadStrings } from "lokalized/load"`, so that walk
 * reports `examples/edge/worker.js` as THREE modules where the real graph is more than forty — a
 * measurement that looks fine and describes nothing.
 *
 * **EXTRACTED RATHER THAN COPIED, for the reason `graph-walk.mjs` records about itself:** two
 * consumers need the same arithmetic — `test/example-graphs.test.js` asserts that no Node built-in
 * is reachable from the edge worker, and `tools/scenario-6.mjs` ratchets the byte and module counts
 * of the same graphs — and a second copy drifts from the first without either copy being wrong on
 * its own. The rules below are non-obvious (bare-specifier resolution through the package's own
 * `exports`, comments stripped so JSDoc type imports are not edges, three import SHAPES rather than
 * one), and every one of them was learned from a silent miss.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { withoutComments } from "./graph-walk.mjs";

/** Every import shape that puts a module in the RUNTIME graph, bare specifiers included. */
const IMPORT_PATTERNS = [
  /from\s+"([^"]+)"/g,
  /(?:^|[^.\w])import\s+"([^"]+)"/gm,
  /import\(\s*"([^"]+)"/g,
];

/**
 * @typedef {Readonly<{ files: string[], builtins: string[], bytes: number }>} ExampleGraph
 *   `files` and `builtins` are repository-relative and sorted; `bytes` is the transitive source size
 *   of `files`, the same arithmetic `graph-walk.mjs` ratchets.
 */

/**
 * @param {string} root repository root
 * @param {string} entry entry path relative to `root`
 * @param {(problem: string) => void} [onProblem] called for an unresolvable specifier; throws by default
 * @returns {ExampleGraph}
 */
export function exampleGraph(root, entry, onProblem) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const fail = onProblem ?? ((problem) => { throw new Error(problem); });

  const seen = new Set();
  const builtins = new Set();
  const queue = [resolve(root, entry)];
  let bytes = 0;

  while (queue.length) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    if (!existsSync(file)) { fail(`${relative(root, file)} does not exist`); continue; }
    seen.add(file);
    const text = readFileSync(file, "utf8");
    bytes += Buffer.byteLength(text);

    for (const pattern of IMPORT_PATTERNS)
      for (const match of withoutComments(text).matchAll(pattern)) {
        const specifier = /** @type {string} */ (match[1]);

        if (specifier.startsWith("node:")) {
          builtins.add(`${relative(root, file)} -> ${specifier}`);
          continue;
        }
        if (specifier.startsWith(".")) { queue.push(resolve(dirname(file), specifier)); continue; }

        // A SELF-REFERENCE through the package's own `exports`, which is what a consumer writes and
        // what Node resolves for code inside the package too.
        if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) {
          fail(`${relative(root, file)} imports '${specifier}', which is neither relative, a Node ` +
            `builtin, nor this package — the examples have no dependencies and neither does the library`);
          continue;
        }
        const subpath = specifier === pkg.name ? "." : `.${specifier.slice(pkg.name.length)}`;
        const target = pkg.exports[subpath];
        if (!target?.import) { fail(`'${specifier}' is not in the package export map`); continue; }
        queue.push(resolve(root, target.import));
      }
  }

  return Object.freeze({
    files: [...seen].map((file) => relative(root, file)).sort(),
    builtins: [...builtins].sort(),
    bytes,
  });
}
