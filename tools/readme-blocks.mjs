#!/usr/bin/env node
// @ts-check
/**
 * READING `README.md` — the extraction, shared by the two gates that execute it.
 *
 * EXTRACTED from `tools/readme-examples.mjs` when `tools/readme-newcomer.mjs` needed the same
 * grouping, for the reason `tools/graph-walk.mjs`'s own header gives: both rules below are
 * non-obvious, both were learned from a miss, and a second copy drifts from the first without
 * either copy being wrong on its own. The two gates differ only in WHERE they run what this
 * returns — the repo's working tree, or a directory holding nothing but the published package.
 *
 * THE CONVENTION:
 *
 *   <!-- example: cart -->        marks the next ```js block as part of the group `cart`
 *   expression;   // => <JSON>    asserts the expression deep-equals that JSON
 *   expression;
 *   // => <JSON>                  the same, when the line would be too long
 *   <!-- catalog: path/x.json --> marks the next ```json block as a file the README PUBLISHES
 *   <!-- example: name -->        before a ```html block runs its `<script type="module">` body
 *
 * Blocks sharing a group name are concatenated in document order into ONE module, so a later block
 * may use a binding an earlier one declared.
 *
 * `catalog:` exists because nine sample groups read a directory of catalogs, and a reader who has
 * installed the package has no such directory: the samples asserted outputs derived from bytes the
 * document never showed. A published catalog is BOTH the reader's copy and the newcomer gate's
 * fixture, so the document cannot show one thing and the gate run another.
 *
 * **THE HTML RULE EXISTS BECAUSE THE PLAN'S WORD IS "EXECUTED".** Its M-D row opens "Executed
 * quickstarts cover npm/bundler, direct browser, SSR, and explicit-locale use" — and the direct-
 * browser quickstart was a ```html block, which nothing here scanned. It made real library calls and
 * claimed an output in a trailing comment, so a changed signature would have shipped wrong in the one
 * sample a reader cannot check by running `node`. Its `<script type="module">` body is now a group
 * like any other.
 *
 * ONE LINE IS DROPPED AND THE RULE IS NARROW BY DESIGN: a statement whose whole text touches
 * `document` or `window` has no counterpart under Node, so it is removed and COUNTED. Removing
 * anything else, or removing everything, fails — a stripper that quietly ate the sample would be a
 * gate over nothing, which is the failure this file's siblings were built against. Write the sample
 * so the value is computed into a binding and asserted, then assigned to the DOM on its own line;
 * that is better documentation anyway, because the assertion shows the reader what to expect.
 */

/**
 * A statement that exists only in a browser, dropped from a `<script type="module">` body.
 *
 * Deliberately anchored to the WHOLE line: `document.body.textContent = greeting;` goes, and
 * `const x = document.title;` also goes, but a line that merely MENTIONS the word inside a string
 * stays, and so does any line with a library call on it. The narrowness is the point — see the
 * header. Counted, never silent.
 */
/**
 * How many host-only statements a browser sample's DOM tail may need. Three is generous for the
 * shape this documents — compute a value, hand it to the page — and the bound exists so that a
 * widened rule is reported rather than inferred from a crash.
 */
import { readFileSync } from "node:fs";

import { browserEntries } from "./browser-entries.mjs";

const MAXIMUM_HOST_ONLY = 3;

const HOST_ONLY = /^\s*(?:(?:const|let|var)\s+\w+\s*=\s*)?(?:document|window)\b[^;]*;\s*$/;

/** `expr;  // => JSON` and a lone `// => JSON`. */
const INLINE = /^(?<expr>.*?;)\s*\/\/\s*=>\s*(?<want>.+)$/;
const LONE = /^\s*\/\/\s*=>\s*(?<want>.+)$/;

export const PREAMBLE = `import { deepStrictEqual } from "node:assert/strict";
let __checked = 0;
const __expect = (actual, expected, where) => { deepStrictEqual(actual, expected, where); ++__checked; };
`;

/**
 * A DECLARATION carrying a `// =>` — `const greeting = strings.get(…);   // => "Bonjour Ada"`.
 *
 * The convention only ever followed a bare expression statement, which is fine when the sample is a
 * list of things to look at and wrong when it is code a reader copies: the browser quickstart has to
 * BIND its value, because the line after it hands that binding to the DOM. Wrapping a declaration in
 * `__expect(...)` is a syntax error, so the declaration is emitted as itself and the assertion is
 * made against the name it introduces.
 */
const DECLARATION = /^(?<statement>\s*(?:const|let|var)\s+(?<binding>[A-Za-z_$][\w$]*)\s*=\s*.+;)\s*$/;

/** @param {string} expr @param {string} want @param {number} line @param {string} name */
function expect(expr, want, line, name) {
  const where = JSON.stringify(`${name} (README:${line})`);
  const declaration = DECLARATION.exec(expr);
  if (declaration?.groups)
    return `${declaration.groups.statement}\n__expect(${declaration.groups.binding}, ${want.trim()}, ${where});`;
  const trimmed = expr.trim().replace(/;$/, "");
  return `__expect(${trimmed}, ${want.trim()}, ${where});`;
}

/**
 * @param {string} source the README text
 * @returns {{ groups: Map<string, { code: string[], assertions: number }>,
 *             catalogs: Map<string, string>, htmlModules: Map<string, number>,
 *             unmarkedBlocks: number, problems: string[] }}
 */
export function parseReadme(source) {
  const lines = source.split("\n");
  /** @type {Map<string, { code: string[], assertions: number }>} */
  const groups = new Map();
  /** @type {Map<string, string>} */
  const catalogs = new Map();
  /** @type {string[]} */
  const problems = [];
  /** Blocks with no `<!-- example: … -->` marker — reported, never silently skipped. */
  let unmarkedBlocks = 0;
  /** Group name -> how many host-only statements were dropped from its browser sample. */
  const htmlModules = new Map();

  /**
   * The shared body walk: turns a block's lines into executable code plus assertions.
   *
   * Extracted when the ```html arm landed, rather than copied into it — `graph-walk.mjs`'s reason.
   * The `// =>` convention has a non-obvious rule in it (a lone marker binds to the PREVIOUS emitted
   * line) and a second copy of that would drift without either copy being wrong on its own.
   *
   * @param {string} name @param {string[]} body @param {number} start
   */
  function appendBlock(name, body, start) {
    if (!groups.has(name)) groups.set(name, { code: [], assertions: 0 });
    const group = /** @type {{ code: string[], assertions: number }} */ (groups.get(name));
    group.code.push(`// --- README line ${start} ---`);

    for (let offset = 0; offset < body.length; ++offset) {
      const text = /** @type {string} */ (body[offset]);
      const inline = INLINE.exec(text);
      if (inline?.groups) {
        group.code.push(expect(inline.groups.expr ?? "", inline.groups.want ?? "", start + offset + 1, name));
        group.assertions++;
        continue;
      }
      const lone = LONE.exec(text);
      if (lone?.groups) {
        // THE EXPRESSION IS THE PREVIOUS EMITTED LINE, and it must exist. A `// =>` floating free
        // would otherwise assert nothing while looking exactly like an assertion.
        const previous = group.code.pop();
        if (previous === undefined || !/;\s*$/.test(previous) || previous.startsWith("//")) {
          problems.push(`README:${start + offset + 1}: a '// =>' comment with no single-line ` +
            `expression before it. Put the expression and its expectation on one line, or end the ` +
            `expression with ';' on the line above.`);
          if (previous !== undefined) group.code.push(previous);
          continue;
        }
        group.code.push(expect(previous, lone.groups.want ?? "", start + offset + 1, name));
        group.assertions++;
        continue;
      }
      group.code.push(text);
    }
  }

  /** @type {string | null} */
  let pending = null;
  /** @type {string | null} */
  let pendingCatalog = null;
  for (let index = 0; index < lines.length; ++index) {
    const line = /** @type {string} */ (lines[index]);
    const marker = /^<!--\s*example:\s*([A-Za-z0-9_-]+)\s*-->\s*$/.exec(line);
    if (marker) { pending = /** @type {string} */ (marker[1]); continue; }
    const catalogMarker = /^<!--\s*catalog:\s*([A-Za-z0-9_./-]+)\s*-->\s*$/.exec(line);
    if (catalogMarker) { pendingCatalog = /** @type {string} */ (catalogMarker[1]); continue; }

    // AN UNMARKED ```html BLOCK IS COUNTED, AND ONE CARRYING A MODULE BODY IS A FAILURE.
    // S28 found the direct-browser quickstart sitting in a ```html block nothing scanned: it made
    // real library calls and claimed its output in a trailing comment. That slice taught this parser
    // to EXECUTE a MARKED html block and never taught it to notice an UNMARKED one, so the hole it
    // closed stayed open one step to the left — `unmarkedBlocks` was incremented in the ```js branch
    // alone. MEASURED: a README carrying an unmarked html block whose module body calls the library
    // and claims a FALSE output passes the pre-2026-09-17 parser at exit 0, reported as "1 ```js
    // block". Today's one unmarked html block is an import map with no module body, which is
    // legitimate and gated by `test/browser-import-map.test.js`; the next one might not be.
    if (/^```html\s*$/.test(line) && pending === null) {
      const start = index + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(/** @type {string} */ (lines[end]))) ++end;
      const html = lines.slice(start, end).join("\n");
      index = end;
      if (/<script\s+type="module"\s*>/.test(html))
        problems.push(`README:${start}: an unmarked \`\`\`html block carries a ` +
          `<script type="module"> body, so it makes library calls that nothing executes. Mark it ` +
          `with <!-- example: … --> or move the calls out of it.`);
      else unmarkedBlocks++;
      continue;
    }

    if (/^```html\s*$/.test(line) && pending !== null) {
      const start = index + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(/** @type {string} */ (lines[end]))) ++end;
      const name = pending;
      pending = null;
      index = end;

      const html = lines.slice(start, end).join("\n");
      const script = /<script\s+type="module"\s*>\n(?<body>[\s\S]*?)<\/script>/.exec(html);
      if (!script?.groups?.body) {
        problems.push(`README:${start}: the \`\`\`html block marked '${name}' carries no ` +
          `<script type="module"> body, so marking it executes nothing`);
        continue;
      }
      const body = script.groups.body.split("\n");
      /** @type {string[]} */
      const kept = [];
      /** @type {string[]} */
      const removed = [];
      for (const text of body) {
        if (HOST_ONLY.test(text)) { removed.push(text); continue; }
        kept.push(text);
      }
      if (kept.every((text) => text.trim().length === 0)) {
        problems.push(`README:${start}: every line of the '${name}' browser sample touches the DOM, ` +
          `so executing it would assert nothing`);
        continue;
      }
      // TWO BOUNDS ON THE STRIPPER ITSELF, both independent of how HOST_ONLY is spelled — which is
      // the point, since a rule cannot police its own widening. MEASURED: widening HOST_ONLY until
      // it swallowed the sample's `import` made the run fail as a SyntaxError, and a sample that
      // does not compile reads as a broken sample rather than a broken stripper. This project has
      // twice mistaken a crash for a regression; these name the cause instead.
      const importsDropped = removed.filter((text) => /^\s*import\b/.test(text));
      if (importsDropped.length > 0)
        problems.push(`README:${start}: the host-only rule dropped an import from the '${name}' ` +
          `browser sample (${importsDropped[0]?.trim()}). It is meant to remove DOM statements, and ` +
          `it has widened past them.`);
      if (removed.filter((text) => text.trim().length > 0).length > MAXIMUM_HOST_ONLY)
        problems.push(`README:${start}: the host-only rule dropped ` +
          `${removed.filter((text) => text.trim().length > 0).length} statements from the '${name}' ` +
          `browser sample, more than the ${MAXIMUM_HOST_ONLY} a sample's DOM tail should need. ` +
          `Either the sample does its work in the DOM — in which case executing it proves little — ` +
          `or the rule has widened.`);
      htmlModules.set(name, removed.filter((text) => text.trim().length > 0).length);
      appendBlock(name, kept, start);
      continue;
    }

    if (/^```json\s*$/.test(line) && pendingCatalog !== null) {
      const start = index + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(/** @type {string} */ (lines[end]))) ++end;
      if (catalogs.has(pendingCatalog))
        problems.push(`README:${start}: the catalog '${pendingCatalog}' is published twice`);
      catalogs.set(pendingCatalog, `${lines.slice(start, end).join("\n")}\n`);
      pendingCatalog = null;
      index = end;
      continue;
    }
    if (!/^```js\s*$/.test(line)) continue;

    const start = index + 1;
    let end = start;
    while (end < lines.length && !/^```\s*$/.test(/** @type {string} */ (lines[end]))) ++end;
    const body = lines.slice(start, end);
    index = end;

    if (pending === null) { unmarkedBlocks++; continue; }
    const name = pending;
    pending = null;
    appendBlock(name, body, start);
  }

  if (pendingCatalog !== null)
    problems.push(`README: a '<!-- catalog: ${pendingCatalog} -->' marker is followed by no \`\`\`json block`);

  return { groups, catalogs, htmlModules, unmarkedBlocks, problems };
}

const DIST_ENTRIES = browserEntries(JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")).exports);

/**
 * A documented CDN URL for THIS package, rewritten to the specifier that resolves locally.
 *
 * **WHY A REWRITE AND NOT A BARE SPECIFIER IN THE SAMPLE.** M-R S9 pointed the browser section at
 * `dist/browser/` on a real CDN, and the whole point of its second route is that a reader can write
 * the URL and skip the import map entirely. A sample importing `"lokalized"` would not BE that
 * route; a sample importing the live URL would make `check:readme` fetch the network, which is not
 * something a gate here may do. So the executed form resolves through the package's own `exports`,
 * exactly as every other sample does, and what the URL itself asserts is checked elsewhere:
 * `test/browser-import-map.test.js` holds the path and the pinned version to the derivation, and
 * `npm run check:dist` holds the built file to that same derivation.
 *
 * DERIVED, and it THROWS on a URL it cannot place rather than letting it fail as a network error
 * six frames later — a documented dist URL matching no entry is a defect in the README.
 *
 * @param {string} code
 */
const localizeDistUrls = (code) => code.replace(
  /"https:\/\/[^"]*\/lokalized@[^/"]+\/(dist\/browser\/[^"]+)"/g,
  (whole, path) => {
    const entry = DIST_ENTRIES.find((candidate) => candidate.published === `/${path}`);
    if (!entry) throw new Error(`README: ${whole} names no file this package's exports produce`);
    return JSON.stringify(entry.specifier);
  });

/** The module text for one group, ready to write and execute. */
export const moduleFor = (group) =>
  `${PREAMBLE}${localizeDistUrls(group.code.join("\n"))}\nprocess.stdout.write(String(__checked));\n`;
