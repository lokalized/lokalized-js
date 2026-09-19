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

/**
 * Every way of turning a string into code that this tree can be scanned for, each with the reason it
 * is here rather than a tighter spelling.
 *
 * **These were widened on 2026-09-16 after the narrow versions were measured and found narrow.** The
 * pair that shipped for five milestones was `/\beval\s*\(/` and `/\bnew\s+Function\b/`, and three
 * ordinary spellings walked straight past them: `Function("return 1")` (the constructor called
 * without `new`), `setTimeout("x=1", 0)`, and indirect eval assembled as `globalThis["ev" + "al"]`.
 * Injected into `src/internal/locale.js` — a file the two per-file gates in `test/plural.test.js` and
 * `test/expression.test.js` do not scan — each left ALL 1,570 tests green.
 *
 * Each entry is a BARE TOKEN wherever one will do, on the same reasoning the `Intl` test above
 * states: a mention of `eval` or `Function` in executable text is either the thing itself or a step
 * toward it, and this tree has zero of either today, so the stricter pattern costs nothing and a
 * deliberate exception is a one-line reviewable edit. Measured before landing: 54 files, 0 hits for
 * every pattern below.
 *
 * WHAT THIS CANNOT SEE, said here rather than left to be discovered. A source scan reads spellings,
 * not values. `const g = globalThis; g["ev" + "al"]("1")` defeats the last pattern because the alias
 * is what gets indexed; so does any name arriving from outside the file. The last pattern raises the
 * cost of hiding a global lookup in THIS tree, it does not make one impossible.
 *
 * `import(` is deliberately absent. A dynamic import loads a module, it does not evaluate a string,
 * and the root-graph walk further down this file has a pattern for exactly that shape because a
 * relative `import("…")` is a legitimate edge here. `test/expression.test.js` forbids it in the two
 * files where laziness would break eager compilation, which is a different property.
 *
 * The two PER-FILE gates are not made redundant by this and should not be deleted for overlapping
 * with it. `test/plural.test.js:406` and `test/expression.test.js:72` each pin the property as part
 * of the contract of one module — a rules engine and an expression compiler are exactly the two
 * places somebody would reach for `new Function` and have a reason — and each states that reason
 * beside the module it belongs to. This gate is the floor under the whole tree.
 */
const DYNAMIC_CODE = [
  // Covers `eval(x)`, `(0, eval)(x)`, `globalThis.eval(x)` and `globalThis["eval"]` alike. `evaluate`
  // and `ExpressionEvaluationError` do not match: `\b` requires a boundary on BOTH sides.
  { pattern: /\beval\b/, why: "eval, by any route" },
  // The bare word, so `new Function(…)`, `Function(…)`, `Reflect.construct(Function, …)` and
  // `const F = Function` are one rule rather than four, and passing the constructor somewhere else
  // is caught too.
  { pattern: /\bFunction\b/, why: "the Function constructor, by any route" },
  // A string first argument is an eval with a delay on it. The timers themselves are not forbidden.
  { pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/, why: "a string-argument timer" },
  // How a name is assembled at runtime to get past the two rules above.
  { pattern: /\b(?:globalThis|window|self|global)\s*\[/, why: "a computed index into the global object" },
];

test("the dynamic-code patterns match what they claim to match", () => {
  // The gate above is four regexes and nothing else executes them, so a typo would make it pass
  // silently forever. Every pattern is shown one line it must catch and one it must not.
  const offending = [
    'const f = eval("1");',
    'const f = (0, eval)("1");',
    'const f = new Function("return 1");',
    'const f = Function("return 1");',
    'const f = Reflect.construct(Function, ["return 1"]);',
    'setTimeout("x = 1", 0);',
    "setInterval('x = 1', 0);",
    'globalThis["ev" + "al"]("1");',
    'self[name]("1");',
  ];
  for (const line of offending)
    assert.ok(DYNAMIC_CODE.some(({ pattern }) => pattern.test(line)), `no pattern catches ${line}`);

  const legal = [
    'if (typeof value === "function") return value;',
    "const subtle = globalThis.crypto?.subtle;",
    "const evaluated = evaluateExpression(node);",
    "throw new ExpressionEvaluationError(TOKEN, message);",
    "setTimeout(() => resolve(), 0);",
    'const parsed = await import("../data/ordinal.js");',
  ];
  for (const line of legal) {
    const hit = DYNAMIC_CODE.find(({ pattern }) => pattern.test(line));
    assert.equal(hit, undefined, `${hit?.why} falsely matched ${line}`);
  }
});

test("no module under src/ evaluates code at runtime", () => {
  /** @type {string[]} */
  const offenders = [];

  for (const path of files)
    for (const [index, line] of codeLines(path).entries())
      for (const { pattern, why } of DYNAMIC_CODE)
        if (pattern.test(line))
          offenders.push(`${path.slice(sourceRoot.length)}:${index + 1}: ${why}: ${line.trim()}`);

  assert.deepEqual(offenders, [], "CLDR rule conditions compile to closures, never to evaluated code");
});

/** Erases comments so JSDoc type imports are not mistaken for runtime graph edges. */
const withoutComments = (/** @type {string} */ text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

/** `from "…"`, a bare side-effect `import "…"`, and a dynamic `import("…")`. */
const IMPORT_PATTERNS = [
  /from\s+"(\.[^"]+)"/g,
  /(?:^|[^.\w])import\s+"(\.[^"]+)"/gm,
  /import\(\s*"(\.[^"]+)"/g,
];

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
    // EVERY shape of relative import, not just `from "…"`, and comments stripped first.
    //
    // The `from`-only walk had a silent hole, measured rather than supposed: inserting
    // `import "../data/iana-range-equivalents.js";` at the top of `src/core/index.js` left this test
    // 4/4 GREEN and `scenario:0a` reporting 25 root modules, while the 806-class table was genuinely
    // in the root graph at runtime. Written `import { decode } from "…"` the same line WAS caught —
    // the control that makes the first measurement mean something. A dynamic `import("…")` was the
    // same hole again.
    //
    // Comments are stripped so JSDoc type imports (`{import("../internal/catalog.js").Definition}`),
    // which are erased at runtime, do not count as edges. Landing this changed no measurement: the
    // root graph is still exactly 25 modules.
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const pattern of IMPORT_PATTERNS)
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier !== undefined) queue.push(new URL(specifier, `file://${file}`).pathname);
      }
  }

  // `data/iana-range-equivalents.js` joins the list at M7 A2: the 806-class IANA closure belongs to
  // `lokalized/negotiate` by plan 3.1, and the root graph carries only the reduced slice inlined in
  // `src/internal/locale.js`. Naming it here is what keeps it out — the byte ratchet would not.
  //
  // `negotiate/index.js` ITSELF joins at M9 S2, and the reason is a new import edge that did not
  // exist before: plan 3.4:904-913's `forLanguageRanges` and `forAcceptLanguage` are per-call option
  // helpers, which is exactly the shape somebody re-exports from the root for convenience. Plan
  // 3.4:933 says why not — they exist "so the browser/root graph does not contain the whole-list
  // solver" — and the closure entry above would catch that one import and not, say, a root that
  // re-exported the helpers while the closure moved somewhere else.
  for (const forbidden of ["ordinal-rules.js", "cardinal-ranges.js", "data/ordinal.js", "data/ranges.js",
    "data/iana-range-equivalents.js", "negotiate/index.js"])
    assert.ok(
      ![...reached].some((file) => file.endsWith(forbidden)),
      `${forbidden} must not be reachable from the root entry point`,
    );

  // The cardinal table, by contrast, is strict-core data and MUST be in the root graph.
  assert.ok([...reached].some((file) => file.endsWith("data/cardinal.js")));
  // 19 at M4 close; 21 at M6, which added `src/internal/expression.js` and its tokenizer to the root
  // graph; 22 at M5a, which added `src/internal/json-parse.js` — the bounded duplicate-aware reader
  // that `JSON.parse` cannot stand in for. M5b adds `src/internal/bidi.js` with its `src/data/rtl.js`
  // table, which is root-graph work by necessity rather than by choice: the default isolation mode is
  // `rtl-locales`, so the 37 right-to-left scripts are consulted on lookups nobody configured, and a
  // table that every default render needs cannot live behind an optional subpath. That growth is each
  // milestone's substance, and the assertions that actually protect the root are the ones above and
  // below: no optional plural data is reachable, and the set of GENERATED tables is exactly the list
  // named here.
  // 25 -> 28 at M8 S9, and the three are named so a later reader can judge the trade rather than
  // just the number: `src/internal/loaded-input.js` (createStrings' loaded branch),
  // `src/internal/configuration-error.js` (881 B, shared with lokalized/data/ordinal so the two
  // cannot answer with different `name`/`code`), and `src/data/provenance.js` (469 B).
  //
  // THE LAST ONE IS THE ONE THAT NEEDS JUSTIFYING, because this gate exists to keep DATA out of the
  // root. Plan 3.4 requires the loaded branch to compare a loader result against "the rendering
  // core's own constants" and to fail with a ConfigurationError when they differ — so core must
  // carry the pinned `cldrVersion`/`dataFingerprint`, and threading them in from a caller would
  // let the caller defeat the check it exists to make. 469 bytes of two strings; the 806-class
  // tables this gate was written for are still absent, which is the property it is really pinning.
  //
  // 28 -> 29 at M8 S10, and the one module is `src/internal/runtime-metadata.js` (~3.4 KB, of which
  // the literals are under 200 bytes). Same trade as `provenance.js` one paragraph up, for the same
  // structural reason and a sharper one: plan 6.4 requires an SSR stamp's producer/data/mode fields
  // to come from the RENDERING instance "never from the SSR module's own constants", which only
  // works if the renderer is the party that holds the identity. It carries no table — seven strings
  // — and `test/runtime-metadata.test.js` pins every one of them to `package.json` or a
  // `lokalized-spec` lock, so it cannot drift into being a second source of truth.
  assert.equal(reached.size, 31, "the root module graph changed size");

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
      // ADDED AT M8 S9, and it is not a table: 469 bytes carrying the pinned `cldrVersion` and
      // `dataFingerprint`. Plan 3.4 makes `createStrings({loaded})` reject a loader result built
      // against different pinned data by comparing it against "the rendering core's own constants" —
      // so core has to hold them, and threading them in from a caller would let the caller defeat
      // the check it exists to make.
      "data/provenance.js",
      "data/rtl.js",
      "data/valid-languages.js",
      "data/valid-regions.js",
      "data/valid-scripts.js",
      "data/valid-variants.js",
    ],
    "the set of generated tables reachable from the root changed",
  );
});
