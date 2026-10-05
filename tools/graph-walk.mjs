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
 * reporting 25 root modules and `test/pinned-data-only.test.js` 4/4 GREEN, while the full IANA table
 * (23 KB and 806 classes as it then was) was genuinely in the root graph at runtime — the containment
 * claim these gates exist to make.
 * The same line written `import { decode } from "…"` was caught, which is the control that makes the
 * first measurement mean something. A dynamic `import("…")` had the identical hole.
 *
 * Adding the two patterns changes no measurement: root stays 25 modules / 690,207 bytes and core 24 /
 * 681,962, verified before landing them. They can only ever ADD an edge that was always really there.
 */
const IMPORT_PATTERNS = [
  /from\s*"(\.[^"]+)"/g,
  /(?:^|[^.\w])import\s*"(\.[^"]+)"/gm,
  /import\(\s*"(\.[^"]+)"/g,
];

/**
 * A relative specifier in ANY import-ish spelling, used only to check the patterns above saw it.
 *
 * **M-R S9: `\s+` MADE THIS WALKER RETURN 1 ON MINIFIED OUTPUT, SILENTLY.** esbuild emits
 * `import{a}from"./chunks/x.js"` with no space, so every pattern above missed every edge and
 * `graphBytes("dist/browser/core.js")` answered `modules: 1` for a file the build manifest says
 * reaches 7. Two gates were about to compare that number to a record and agree with themselves.
 * The `\s+` is now `\s*` — MEASURED first across `src/` and `examples/`: 155 matches before and
 * 155 after, 0 files differing, because the three `from"` occurrences in real source are CLDR data
 * rows (`{"from":"heploc","to":"alalc97"}`) whose values do not begin with a dot.
 */
const ANY_RELATIVE_SPECIFIER = /(?:from|import)\s*\(?\s*"(\.[^"]*)"/g;

/**
 * @param {string} root repository root, against which `entry` is resolved
 * @param {string} entry entry-point path relative to `root`, e.g. `src/index.js`
 * @returns {{ bytes: number, modules: number, files: string[] }}
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
    const found = new Set();
    for (const pattern of IMPORT_PATTERNS)
      for (const m of scannable.matchAll(pattern)) { found.add(m[1]); queue.push(resolve(dirname(file), m[1])); }

    // A REGEX WALKER THAT CANNOT PARSE ITS INPUT MUST SAY SO RATHER THAN ANSWER 1. This compares the
    // three precise patterns against a loose one; a specifier the loose detector sees and they do
    // not is a spelling this tool does not understand, and every number derived from the walk would
    // be wrong in the direction that looks green. Retrospective proof: against the pre-S9 `\s+`
    // patterns this throws on `dist/browser/core.js`, which used to answer `modules: 1`.
    const missed = [...scannable.matchAll(ANY_RELATIVE_SPECIFIER)]
      .map((m) => m[1]).filter((specifier) => !found.has(specifier));
    if (missed.length)
      throw new Error(`${file} imports ${JSON.stringify(missed[0])} in a spelling ` +
        `tools/graph-walk.mjs does not recognise, so its module count would be wrong and low`);
  }
  // The FILE LIST as well as the count, because `tools/subpath-graphs.mjs` needs to know WHICH
  // modules a subpath reaches, not merely how many: its containment rule is about territory.
  return { bytes, modules: seen.size, files: [...seen].sort() };
}
