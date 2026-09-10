// @ts-check
import { builtinModules } from "node:module";
import { withoutComments } from "../tools/graph-walk.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

/**
 * The nine entry points documented in IMPLEMENTATION-PLAN-v7.md section 3.1 (internal; see ../planning/).
 * This list is intentionally hand-written: it is the contract, and the export
 * map is the implementation of it. Deriving one from the other would let both
 * drift together silently.
 */
const DOCUMENTED_SUBPATHS = [
  ".",
  "./core",
  "./parse",
  "./load",
  "./ssr",
  "./negotiate",
  "./node",
  "./data/ordinal",
  "./data/ranges",
];

test("export map matches the documented entry points exactly", () => {
  const exported = Object.keys(pkg.exports).filter((k) => k !== "./package.json");
  assert.deepEqual(exported.sort(), [...DOCUMENTED_SUBPATHS].sort());
});

test("every documented subpath resolves and imports", async () => {
  for (const subpath of DOCUMENTED_SUBPATHS) {
    const target = pkg.exports[subpath].import;
    assert.ok(target, `${subpath} declares no import target`);
    await assert.doesNotReject(
      () => import(new URL(target, root).href),
      `${subpath} -> ${target} failed to import`,
    );
  }
});

test("every subpath declares types before import", () => {
  // Condition order is significant: "types" must precede "import" or
  // TypeScript's node16/nodenext resolution picks the JS file first.
  for (const subpath of DOCUMENTED_SUBPATHS) {
    const conditions = Object.keys(pkg.exports[subpath]);
    assert.deepEqual(conditions, ["types", "import"], `${subpath} condition order`);
  }
});

test("package is ESM-only with no CommonJS contract", () => {
  assert.equal(pkg.type, "module");
  assert.equal(pkg.sideEffects, false);
  assert.ok(pkg.engines?.node, "engines.node is required");
  const serialized = JSON.stringify(pkg.exports);
  assert.ok(!serialized.includes('"require"'), "exports must not declare a require condition");
  assert.ok(!("main" in pkg), 'legacy "main" must not be present');
});

test("no runtime dependencies", () => {
  assert.ok(!pkg.dependencies, "the package must declare no runtime dependencies");
});

/** Recursively collect .js files under a directory. */
async function jsFiles(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await jsFiles(path, acc);
    else if (entry.name.endsWith(".js")) acc.push(path);
  }
  return acc;
}

test("Node built-ins stay behind lokalized/node", async () => {
  // Plan section 9.1: browser and edge graphs must not reach Node built-ins.
  //
  // WIDENED 2026-09-10, BEFORE M8 gave `src/node/` real Node code, and the order was the point.
  // This scan matched `from "node:..."` and nothing else, so FOUR ways of reaching the same
  // built-ins walked straight past it -- a bare specifier (`from "fs"`), a dynamic
  // `import("node:fs")`, a side-effect `import "node:fs"`, and the Node globals, which need no
  // import at all. MEASURED against the old scan: `from "fs"`, `import("node:fs")` and
  // `process.cwd()` were all MISSED; all three are caught now, with the original `from "node:fs"`
  // still caught as a regression control.
  //
  // WHY IT HAD TO HAPPEN FIRST. `tsc` was catching some of those only BY ACCIDENT: with no
  // `@types/node` installed every Node import is a TS2307. M8 has to make `src/node/` typecheck,
  // and any way of doing that -- the real @types/node or hand-written ambient declarations --
  // makes those imports resolve EVERYWHERE, browser subpaths included. So the accidental gate dies
  // the moment M8 starts, and relying on an accident is what this project criticizes elsewhere.
  //
  // The built-in list is `module.builtinModules`, not a hand-kept array, for the reason every list
  // here is derived where it can be: a hand-kept one silently stops covering a built-in Node adds.
  const builtins = new Set(builtinModules.filter((name) => !name.startsWith("_")));
  const isBuiltin = (specifier) =>
    specifier.startsWith("node:") ? true : builtins.has(specifier.split("/")[0]);

  // Every shape that puts a module in the graph, plus CommonJS `require`, which is not reachable in
  // an ESM package but is exactly the sort of thing a copy-paste brings in.
  const SPECIFIER_PATTERNS = [
    /from\s+["']([^"']+)["']/g,
    /(?:^|[^.\w])import\s+["']([^"']+)["']/gm,
    /import\(\s*["']([^"']+)["']/g,
    /(?:^|[^.\w])require\(\s*["']([^"']+)["']/g,
  ];
  // Globals that only exist in Node. `TextDecoder` is deliberately absent: it is a web standard and
  // the project's constraints permit it.
  const NODE_GLOBALS = ["process", "Buffer", "__dirname", "__filename", "global"];

  const files = await jsFiles(new URL("src", root).pathname);
  const offenders = [];
  for (const file of files) {
    if (file.includes("/src/node/")) continue;
    const source = withoutComments(await readFile(file, "utf8"));
    for (const pattern of SPECIFIER_PATTERNS)
      for (const match of source.matchAll(pattern))
        if (isBuiltin(match[1])) offenders.push(`${file}: imports '${match[1]}'`);

    // Globals are matched on source with STRING LITERALS removed as well, so a message fragment or
    // a locale tag containing the word cannot be mistaken for a reference. Measured: without this,
    // `src/internal/expression.js` trips on the English word "process" inside a sentence.
    const code = source.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    for (const name of NODE_GLOBALS)
      if (new RegExp(`(?<![.\\w$])${name}(?![\\w$])`).test(code))
        offenders.push(`${file}: references the Node global '${name}'`);
  }
  assert.deepEqual(offenders, [], "Node built-ins found outside src/node/");
});

test("legal notices are packed", () => {
  for (const required of ["LICENSE", "NOTICE"]) {
    assert.ok(pkg.files.includes(required), `${required} must be in the files list`);
  }
});

test("the M2 spike is not shipped", () => {
  // Plan v7's M2 gate calls the generated-placeholder spike "throwaway, non-shipping". `files` is an
  // allowlist, so this holds structurally — but the point of the spike is that it is disposable, and
  // an allowlist is one careless addition away from shipping it.
  assert.ok(existsSync(new URL("../spike/generated-placeholders/spike.mjs", import.meta.url)),
    "the spike should exist; M2 requires it");
  for (const entry of pkg.files) {
    assert.ok(!entry.startsWith("spike"),
      `package.json files includes '${entry}': the M2 spike must never be packed`);
  }
});
