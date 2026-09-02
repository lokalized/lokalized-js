// @ts-check
/**
 * Checks the package against the machine-readable symbol allowlist that lokalized-spec generates
 * from plan section 3.1 (see spec `scripts/symbol-allowlist.mjs`).
 *
 * The allowlist is resolved from a sibling lokalized-spec checkout, matching how lokalized.com
 * already consumes lokalized-java. CI reconstructs the layout with actions/checkout `path:`.
 * When the sibling is absent these tests skip rather than fail, so a standalone clone of this
 * repo still runs its own suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

const allowlistPath = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR, "symbol-allowlist.json")
  : resolve(root.pathname, "../lokalized-spec/symbol-allowlist.json");

/** @type {any} */
let allowlist = null;
try {
  allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
} catch {
  // Sibling spec checkout not present.
}

const skip = allowlist ? false : `symbol allowlist not found at ${allowlistPath}`;

test("export map subpaths match the allowlist exactly", { skip }, () => {
  const declared = Object.keys(pkg.exports)
    .filter((k) => k !== "./package.json")
    .map((k) => (k === "." ? "lokalized" : k.replace("./", "lokalized/")))
    .sort();
  const expected = allowlist.subpaths.map((/** @type {any} */ s) => s.subpath).sort();
  assert.deepEqual(declared, expected);
});

test("deferred subpaths are absent from the export map", { skip }, () => {
  // Plan 3.1: these "do not appear in the export map until implemented".
  const declared = Object.keys(pkg.exports).map((k) => k.replace("./", "lokalized/"));
  for (const deferred of allowlist.deferredSubpaths) {
    assert.ok(
      !declared.includes(deferred),
      `${deferred} is deferred and must not be exported until implemented`,
    );
  }
});

test("only core and parse are re-exported by the root", { skip }, () => {
  // Guards the graph-isolation rule: root must not pull in loading, SSR, negotiation, Node,
  // or the ordinal/range runtime values.
  assert.deepEqual([...allowlist.rootReExportsOwners].sort(), ["core", "parse"]);
});

test("every exported symbol is on the allowlist", { skip }, async () => {
  // Enforcement tightens automatically as symbols land: today the entry points are scaffolds and
  // export nothing, so this passes vacuously. The moment a symbol appears that section 3.1 does
  // not name, this fails — which is the point of freezing the allowlist before the API exists.
  const named = new Set([
    ...allowlist.owners.flatMap((/** @type {any} */ o) => o.namedSymbols),
    ...allowlist.languageFormConstants,
  ]);

  // Section 3.1 permits some symbol FAMILIES without naming each member — `unenumeratedCategories`.
  // Accepting a category wholesale would gut this gate, so each such export is classified here
  // explicitly and the category is checked to exist. Adding an export still costs a reviewed line.
  const CATEGORIZED = /** @type {Record<string, string>} */ ({
    cardinalityForNumber: "cardinal classifiers/support probes",
    cardinalityForOperands: "cardinal classifiers/support probes",
    supportedCardinalitiesForLocale: "cardinal classifiers/support probes",
    getSupportedCardinalityLocaleTags: "cardinal classifiers/support probes",
    ordinalityForNumber: "number/operand ordinal classifiers and support probes",
    ordinalityForOperands: "number/operand ordinal classifiers and support probes",
    supportedOrdinalitiesForLocale: "number/operand ordinal classifiers and support probes",
    getSupportedOrdinalityLocaleTags: "number/operand ordinal classifiers and support probes",
  });
  const categories = new Set(allowlist.owners.flatMap((/** @type {any} */ o) => o.unenumeratedCategories));
  for (const [symbol, category] of Object.entries(CATEGORIZED)) {
    assert.ok(
      categories.has(category),
      `${symbol} is classified as '${category}', which no owner declares as an unenumerated category`,
    );
    named.add(symbol);
  }

  const unlisted = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath === "./package.json") continue;
    const moduleUrl = new URL(/** @type {any} */ (target).import, root).href;
    for (const symbol of Object.keys(await import(moduleUrl))) {
      if (!named.has(symbol)) unlisted.push(`${subpath}: ${symbol}`);
    }
  }

  assert.deepEqual(
    unlisted,
    [],
    "exported symbols absent from the allowlist; add them to plan 3.1 and regenerate, or stop exporting them",
  );
});

test("all 61 language-form constants are accounted for", { skip }, () => {
  assert.equal(allowlist.languageFormConstants.length, 61);
  // GrammaticalCase uses CASE_, not GRAMMATICAL_CASE_ — the prefix rule is not mechanical.
  assert.ok(allowlist.languageFormConstants.includes("CASE_NOMINATIVE"));
  assert.ok(!allowlist.languageFormConstants.some((/** @type {string} */ n) => n.startsWith("GRAMMATICAL_CASE_")));
});
