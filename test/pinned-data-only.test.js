// @ts-check

/**
 * The M4 gate ends with "host `Intl.PluralRules` is absent". That has to be enforced, not assumed:
 * a single `Intl.PluralRules` call would silently make classification depend on the host's own CLDR
 * snapshot, which drifts by engine and by version and would quietly stop matching the pinned data
 * the rest of the milestone is measured against. `Intl.NumberFormat` is the same hazard on the
 * conversion side — it would re-derive digits the exact path is careful never to re-derive.
 *
 * The check is a source scan rather than a runtime probe, because a runtime probe only sees the code
 * paths a test happens to take.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = new URL("../src/", import.meta.url).pathname;

/** @returns {string[]} every `.js` file under `src/`, recursively */
function sourceFiles(directory = sourceRoot) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (entry.endsWith(".js")) files.push(path);
  }
  return files;
}

const files = sourceFiles();

/**
 * The file with every comment blanked out and every line still in place, so a prose mention of an
 * API stays legal while a real reference does not, and reported line numbers stay true.
 *
 * @param {string} path
 * @returns {string[]}
 */
function codeLines(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "")
    .split("\n");
}

test("the source tree is the one being scanned", () => {
  assert.ok(files.length >= 19, `expected the whole src tree, found ${files.length} files`);
  assert.ok(files.some((path) => path.endsWith("/index.js")));
  assert.ok(files.some((path) => path.includes("/internal/plural.js")));
});

test("no module under src/ reaches for the host Intl implementation", () => {
  // `Intl.PluralRules` and `Intl.NumberFormat` by name, and `Intl` at all — a bare `Intl` reference
  // is either one of those two or a step toward one, and the whole subtree is meant to be pinned.
  /** @type {string[]} */
  const offenders = [];

  for (const path of files)
    for (const [index, line] of codeLines(path).entries())
      if (/\bIntl\b/.test(line)) offenders.push(`${path.slice(sourceRoot.length)}:${index + 1}: ${line.trim()}`);

  assert.deepEqual(offenders, [], "src/ must classify from pinned CLDR data, never from the host Intl");
});

test("no module under src/ evaluates code at runtime", () => {
  /** @type {string[]} */
  const offenders = [];

  for (const path of files)
    for (const [index, line] of codeLines(path).entries())
      if (/\beval\s*\(/.test(line) || /\bnew\s+Function\b/.test(line))
        offenders.push(`${path.slice(sourceRoot.length)}:${index + 1}: ${line.trim()}`);

  assert.deepEqual(offenders, [], "CLDR rule conditions compile to closures, never to evaluated code");
});

test("the root graph carries no optional plural data", () => {
  // The optional modules are what the root's size ratchet is protecting. Following the root's own
  // imports is the check that matters; a name that only appears in `src/data/ordinal.js` or
  // `src/data/ranges.js` is fine, because neither is reachable from `src/index.js`.
  /** @type {Set<string>} */
  const reached = new Set();
  const queue = [new URL("../src/index.js", import.meta.url).pathname];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const specifier = match[1];
      if (specifier !== undefined) queue.push(new URL(specifier, `file://${file}`).pathname);
    }
  }

  for (const forbidden of ["ordinal-rules.js", "cardinal-ranges.js", "data/ordinal.js", "data/ranges.js"])
    assert.ok(
      ![...reached].some((file) => file.endsWith(forbidden)),
      `${forbidden} must not be reachable from the root entry point`,
    );

  // The cardinal table, by contrast, is strict-core data and MUST be in the root graph.
  assert.ok([...reached].some((file) => file.endsWith("data/cardinal.js")));
  assert.equal(reached.size, 19, "the root module graph changed size");

  // The exact set of generated tables the root pulls in. `scenario:0a`'s byte ratchet is a PROXY for
  // this invariant, and a weak one: it is re-recorded whenever hand-written code legitimately grows,
  // and each re-record raises the ceiling a new table could hide under. This assertion is the
  // invariant itself — it names every data module the root is allowed to reach, so adding one fails
  // here whatever the byte count does. A deliberate addition is a one-line, reviewable edit.
  assert.deepEqual(
    [...reached]
      .filter((file) => file.includes("/src/data/"))
      .map((file) => file.slice(file.indexOf("/src/data/") + "/src/".length))
      .sort(),
    [
      "data/aliases-language.js",
      "data/aliases-region.js",
      "data/aliases-script.js",
      "data/aliases-variant.js",
      "data/cardinal.js",
      "data/likely-subtags.js",
      "data/parents.js",
      "data/valid-languages.js",
      "data/valid-regions.js",
      "data/valid-scripts.js",
      "data/valid-variants.js",
    ],
    "the set of generated tables reachable from the root changed",
  );
});
