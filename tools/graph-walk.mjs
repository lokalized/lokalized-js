// @ts-check
/**
 * The transitive source graph an entry point actually pulls in.
 *
 * EXTRACTED from `tools/scenario-0a.mjs` so that `tools/scenario-2k.mjs` can answer "does the
 * recorded measurement still describe THESE source files" with the same arithmetic 0a ratchets on.
 * Duplicating it was the alternative and would have been worse: both rules below are non-obvious,
 * both were learned from a silent miss, and a second copy drifts from the first without either
 * copy being wrong on its own.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Strips comments before the import walk below reads a file.
 *
 * Two reasons, and the second is why this is not merely tidiness. (1) A JSDoc type import —
 * `@typedef {import("../internal/catalog.js").Definition}` — is erased at runtime and must NOT count
 * as a graph edge; `src/` is full of them. (2) Without stripping, the dynamic-import pattern below
 * could not be used at all, because every `import("...")` in this codebase today lives inside a
 * comment. Stripping lets the walk match real dynamic imports without inventing false edges.
 *
 * The `//` rule deliberately refuses to fire after `:`, a quote or a backslash, so a `https://` inside
 * a string literal does not truncate the rest of the line.
 */
export const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

/**
 * Every shape of relative import that puts a module in the runtime graph.
 *
 * `from "…"` alone is NOT enough, and the gap was silent rather than theoretical. Measured: inserting
 * `import "../data/iana-range-equivalents.js";` at the top of `src/core/index.js` left this walk
 * reporting 25 root modules and `test/pinned-data-only.test.js` 4/4 GREEN, while the 23 KB 806-class
 * table was genuinely in the root graph at runtime — the containment claim these gates exist to make.
 * The same line written `import { decode } from "…"` was caught, which is the control that makes the
 * first measurement mean something. A dynamic `import("…")` had the identical hole.
 *
 * Adding the two patterns changes no measurement: root stays 25 modules / 690,207 bytes and core 24 /
 * 681,962, verified before landing them. They can only ever ADD an edge that was always really there.
 */
const IMPORT_PATTERNS = [
  /from\s+"(\.[^"]+)"/g,
  /(?:^|[^.\w])import\s+"(\.[^"]+)"/gm,
  /import\(\s*"(\.[^"]+)"/g,
];

/**
 * @param {string} root repository root, against which `entry` is resolved
 * @param {string} entry entry-point path relative to `root`, e.g. `src/index.js`
 * @returns {{ bytes: number, modules: number }}
 */
export function graphBytes(root, entry) {
  const seen = new Set();
  const queue = [resolve(root, entry)];
  let bytes = 0;
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    bytes += Buffer.byteLength(text);
    const scannable = withoutComments(text);
    for (const pattern of IMPORT_PATTERNS)
      for (const m of scannable.matchAll(pattern)) queue.push(resolve(dirname(file), m[1]));
  }
  return { bytes, modules: seen.size };
}
