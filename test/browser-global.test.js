import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

import * as esbuild from "esbuild";

import { GLOBAL_FILE, GLOBAL_NAME, browserEntries, globalEntrySource } from "../tools/browser-entries.mjs";

/**
 * THE CLASSIC-SCRIPT SAMPLE IN THE README, EXECUTED — M-R S9.
 *
 * **Why this file exists rather than a `<!-- example: … -->` marker.** `tools/readme-blocks.mjs`
 * executes a marked ```html block by pulling out its `<script type="module">` body. The classic
 * route has no module body — that is the whole point of it — so the extractor cannot run it, and
 * the block is one of the three this README is allowed to leave unmarked. An unrun sample making
 * real library calls is exactly the state M-D S28 found and closed for the module route; leaving
 * the classic route in that state a slice later would be the same defect with a different tag.
 *
 * **IT RUNS AGAINST A REAL BUILD, not against `src/`.** A classic script is a different artifact
 * with different semantics: no module scope, no live bindings, an eager `"use strict"` prologue,
 * and the library's own code reached through a global rather than through an import. Testing the
 * source would prove nothing about the file a reader loads with `<script src>`. `vm.runInContext`
 * is the right model for that — it is how a browser evaluates a classic script — and the real
 * browser half was driven once by hand, which the slice record carries.
 *
 * **THE SAMPLE IS READ OUT OF THE README, never restated here.** A copy in this file would drift
 * from the document the day either changed, which is the failure this project has recorded in
 * prose, in tables and in generated artifacts.
 */

const root = new URL("../", import.meta.url).pathname;
const readme = readFileSync(`${root}README.md`, "utf8");

/** The one ```html block whose `<script src>` names the classic build. */
const classicBlock = (() => {
  for (const match of readme.matchAll(/```html\n([\s\S]*?)```/g))
    if (match[1].includes(GLOBAL_FILE)) return match[1];
  return null;
})();

test("the README documents the classic-script route at all", () => {
  // ANTI-VACUITY FIRST. Everything below is satisfied trivially by a README that stopped showing
  // this route, and a deleted sample must fail loudly rather than quietly stop being checked.
  assert.ok(classicBlock, `no \`\`\`html block in README.md mentions ${GLOBAL_FILE}`);
  assert.match(classicBlock ?? "", /<script src="[^"]+"><\/script>/, "the block loads no script by src");
  assert.doesNotMatch(classicBlock ?? "", /type="module"/, "the classic block must not be a module");
});

test("the documented src URL names the file the build actually produces", () => {
  const src = /<script src="([^"]+)"><\/script>/.exec(classicBlock ?? "")?.[1] ?? "";
  assert.ok(src.endsWith(`/dist/browser/${GLOBAL_FILE}`),
    `the block loads ${src}, which is not this package's classic build`);
  const version = /\/lokalized@([^/]+)\//.exec(src)?.[1];
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  assert.equal(version, pkg.version, `the sample pins ${version} and this package is ${pkg.version}`);
});

test("the sample runs against a real classic build and prints what the README claims", async () => {
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  const entries = browserEntries(pkg.exports).map((entry) => ({ ...entry, source: `${root}${entry.source.slice(2)}` }));
  const built = await esbuild.build({
    bundle: true, format: "iife", globalName: GLOBAL_NAME, platform: "browser",
    minify: true, target: ["safari16.4", "chrome111", "firefox111"], legalComments: "eof", write: false,
    stdin: {
      contents: globalEntrySource(entries, (entry) => entry.source),
      resolveDir: root, sourcefile: "global-entry.js", loader: "js",
    },
  });

  // A browser-shaped host. `atob` is the one non-ECMAScript global the rendering path needs, and in
  // a classic script its absence is a load-time error rather than a render-time one, because the
  // bundle evaluates its pinned data eagerly at script scope.
  const written = [];
  const sandbox = {
    console, atob, TextDecoder, TextEncoder, URL, structuredClone,
    navigator: { languages: ["fr-CH", "en"] },
    document: { get body() { return { set textContent(value) { written.push(value); } }; } },
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(built.outputFiles[0].text, sandbox, { filename: GLOBAL_FILE });

  assert.equal(typeof sandbox[GLOBAL_NAME], "object",
    `a <script src> did not define window.${GLOBAL_NAME}`);

  // The sample's own body, with its claimed output taken from the trailing comment rather than
  // restated — so a README that changes the greeting and not the comment fails here.
  const body = /<script>\n([\s\S]*?)<\/script>/.exec(classicBlock ?? "")?.[1] ?? "";
  assert.ok(body.trim().length > 0, "the classic block carries no script body to run");
  const claimed = /\/\/\s*(.+?)\s*$/m.exec(body.split("\n").filter((line) => line.includes("//")).pop() ?? "")?.[1];
  assert.ok(claimed, "the classic sample claims no output, so nothing here is checked");

  runInContext(body, sandbox, { filename: "README.md#classic" });
  assert.deepEqual(written, [claimed],
    `the sample wrote ${JSON.stringify(written)} and the README claims ${JSON.stringify([claimed])}`);
});

test("every browser-safe subpath is reachable from the one global", async () => {
  // The combined shape is a decision `tools/browser-entries.mjs` records: the root's names at the
  // top level, everything else namespaced. It is checked here because a reader following the
  // README's list of namespaces has no other guarantee, and because one bundle meaning ONE copy is
  // the property that makes the classic route better than eight separate globals.
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  const entries = browserEntries(pkg.exports).map((entry) => ({ ...entry, source: `${root}${entry.source.slice(2)}` }));
  const built = await esbuild.build({
    bundle: true, format: "iife", globalName: GLOBAL_NAME, platform: "browser",
    minify: true, target: ["safari16.4", "chrome111", "firefox111"], legalComments: "eof", write: false,
    stdin: { contents: globalEntrySource(entries, (entry) => entry.source), resolveDir: root, sourcefile: "global-entry.js", loader: "js" },
  });
  const sandbox = { console, atob, TextDecoder, TextEncoder, URL, structuredClone, navigator: { languages: ["en"] } };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(built.outputFiles[0].text, sandbox, { filename: GLOBAL_FILE });
  const api = sandbox[GLOBAL_NAME];

  for (const entry of entries) {
    if (entry.key === ".") continue;
    const reached = entry.outName.split("/").reduce((at, step) => at?.[step], api);
    assert.equal(typeof reached, "object", `${entry.specifier} is not reachable as lokalized.${entry.outName.replace("/", ".")}`);
    assert.ok(Object.keys(reached).length > 0, `lokalized.${entry.outName.replace("/", ".")} is empty`);
  }

  // ONE BUNDLE MEANS ONE COPY, and this is the assertion that says so. Eight separate globals give
  // two of everything and break `instanceof` across them; that is the measured reason this route is
  // one file, so the property is pinned rather than left to the build's shape.
  assert.equal(api.createStrings, api.core.createStrings,
    "the root and core expose different function objects, so the bundle carries two copies");
  assert.equal(api.core.LokalizedError, Object.getPrototypeOf(api.core.ConfigurationError),
    "the error hierarchy did not survive the combined build");
});
