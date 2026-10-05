// @ts-check
/**
 * `MODULE-CONTRACTS.md` IS COMPARED TO THE MODULES IT SPECIFIES.
 *
 * It is the only substantial prose surface in this repository that nothing had ever checked.
 * `README.md` has five slices of gating behind it — every sample executed from the working tree AND
 * from the published tarball, every enumeration derived, every bundler figure re-measured by a real
 * bundler — and this file, which specifies `src/internal/`, was written for the **M2 walking
 * skeleton** and left where it fell. MEASURED 2026-09-17, before any of the rules below existed:
 *
 *   - it documents **7 of the 20** modules under `src/internal/`;
 *   - **4 declared signatures** were stale, all of them having gained parameters;
 *   - **5 counts** were stale (the corpus at 1,965 cases against 2,363; `matchFor` 216 against 304;
 *     `cardinalityForNumber` 49 against 58; `cardinalityForOperands` 15 against 16; 483 fixtures
 *     against 584);
 *   - **3 scope statements had outlived the work they deferred**, which is the sharpest of them and
 *     the reason this file exists rather than a one-off repair.
 *
 * THAT THIRD ONE, SPELLED OUT, because it is this project's most-recorded defect in its purest form.
 * `src/internal/interpolate.js:9` opens "Scope (see MODULE-CONTRACTS.md)" — it cites this document as
 * the authority on what it does — and seventeen lines later says "THREE RUNTIME BUDGETS are enforced
 * here", naming `maximumInterpolatedOutputCharacters` and `maximumGeneratedExpansionCharacters`.
 * The cited document said, for that same module: "Out of scope here: the output/expansion character
 * budgets." **Two texts, one naming the other as its authority, asserting the opposite.**
 *
 * WHAT IS GATED, and why each rule is the shape it is:
 *
 *   R1  every declaration is REAL and CURRENT — name and parameter list, compared against the
 *       TypeScript AST rather than a regex, because `isolate(value)` and
 *       `isolate(value, maximumCharacters = -1, …)` differ in exactly the way prose hides.
 *   R2  every internal module is DOCUMENTED or carries a disposition, and a module that is both is
 *       STALE. One-directional gates are the defect this project has closed three times.
 *   R3  a FLOOR on each group's declaration count, so the document cannot be quietly emptied to
 *       satisfy R1.
 *   R4  every COUNT the document states is derived from the artifact it describes.
 *   R5  a DEFERRAL must carry a falsifiable ground, exactly as `tools/clause-ledger.mjs` requires of
 *       a DEFERRED clause since M-D S21 — for the same reason, and after the same failure.
 *
 * WHAT IS NOT GATED, and who owns it: that the document's PROSE is true. No rule here reads a
 * sentence. `check:readme`'s own header records that limit for README.md, and the repair there was
 * to move every checkable claim into something executed; the analogue here is R4 and R5, which pull
 * the two kinds of checkable sentence — a count and a deferral — out of the prose and into a
 * comparison. A sentence that is neither is still nobody's.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url).pathname;
const doc = readFileSync(`${root}MODULE-CONTRACTS.md`, "utf8");
const INTERNAL = `${root}src/internal`;

/** Every export of one module, with the shape of its parameter list. */
function exportedSignatures(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2023, true);
  const found = new Map();
  const isExported = (node) =>
    node.modifiers?.some((/** @type {any} */ m) => m.kind === ts.SyntaxKind.ExportKeyword);
  // A defaulted or optional parameter is rendered `name?`, a rest parameter `...name`. Comparing the
  // NAMES and their optionality — not the default VALUES — is what keeps the document readable while
  // still failing on every drift measured above: all four were parameters appearing or disappearing.
  const params = (fn) => fn.parameters.map((/** @type {any} */ p) => {
    const name = p.name.getText(source);
    if (p.dotDotDotToken) return `...${name}`;
    return p.initializer || p.questionToken ? `${name}?` : name;
  });
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && isExported(node) && node.name)
      found.set(node.name.text, { kind: "function", params: params(node) });
    else if (ts.isVariableStatement(node) && isExported(node))
      for (const d of node.declarationList.declarations) {
        const name = d.name.getText(source);
        const fn = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
        found.set(name, fn ? { kind: "function", params: params(d.initializer) } : { kind: "value", params: null });
      }
    else if (ts.isClassDeclaration(node) && isExported(node) && node.name)
      found.set(node.name.text, { kind: "class", params: null });
  });
  return found;
}

/**
 * The document's declared contracts.
 *
 * A heading may name SEVERAL modules — ``## `expression.js` (+ `expression-tokenizer.js`)`` — and
 * its declarations then belong to the GROUP rather than to either module. A first version keyed them
 * per module and reported three declarations GONE from the module that legitimately does not have
 * them; a gate that invents defects is worse than one that misses them.
 *
 * AN UNRECOGNISED HEADING THROWS. Without that, reformatting one silently moves its modules into the
 * undocumented bucket, and the disposition list below grows to excuse modules the document covers.
 */
function declaredGroups(text) {
  /** @type {{ heading: string, modules: string[], declarations: Map<string, any> }[]} */
  const groups = [];
  const unparsed = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) {
      const named = [...line.matchAll(/`(src\/(?:internal|data)\/[a-z0-9-]+\.js)`/g)].map((m) => m[1]);
      const internal = named.filter((n) => n.startsWith("src/internal/"));
      if (internal.length > 0) {
        current = { heading: line.trim(), modules: internal, declarations: new Map() };
        groups.push(current);
        continue;
      }
      if (!/^## What /.test(line)) unparsed.push(line.trim());
      current = null;
      continue;
    }
    if (!current) continue;
    const fn = /^export function (\w+)\(([^)]*)\)/.exec(line);
    if (fn) {
      const params = fn[2].split(",").map((p) => p.trim()).filter(Boolean)
        .map((p) => (p.includes("=") ? `${p.split("=")[0].trim()}?` : p));
      current.declarations.set(fn[1], { kind: "function", params });
      continue;
    }
    const value = /^export const (\w+)\b/.exec(line);
    if (value) current.declarations.set(value[1], { kind: "value", params: null });
  }
  assert.deepEqual(unparsed, [],
    "MODULE-CONTRACTS.md carries a `##` heading this parser does not recognise. Every module heading " +
    "must name its modules in backticks; otherwise those modules read as undocumented and the " +
    "disposition table below grows to excuse a document that already covers them.");
  return groups;
}

const groups = declaredGroups(doc);
const documented = new Set(groups.flatMap((g) => g.modules));
const allModules = readdirSync(INTERNAL).filter((n) => n.endsWith(".js"))
  .map((n) => `src/internal/${n}`).sort();

/**
 * Modules the document does not specify, each with a reason.
 *
 * A DISPOSITION IS NOT AN EXCUSE: a module listed here that the document HAS documented fails as
 * stale, so this table cannot outlive the gap it describes. That is the rule three lists in this
 * project rotted for want of — and the one `lokalized-spec/generated/coverage-dispositions.json`
 * and `tools/clause-ledger.mjs` already carry.
 */
const UNDOCUMENTED = (() => {
  // DERIVED FROM THE DOCUMENT, not kept beside it. A first draft carried this table in the test, so
  // the document said nothing about its own scope and two copies of the same list would have drifted
  // — which is the defect one directory over that `tools/graph-walk.mjs` was extracted to prevent.
  // The document now states what it does not specify, and this reads that statement.
  const section = doc.slice(doc.indexOf("## What this document does not specify"));
  const rows = [...section.matchAll(/^\| `(src\/internal\/[a-z0-9-]+\.js)` \| (.+?) \|$/gm)];
  // A ROW THE PATTERN MISSES MUST FAIL, NOT VANISH. The first version spelled the path
  // `[a-z-]+\.js`, which has no digits in it, so `sha256.js` was silently dropped from the table and
  // read as an unaccounted module — a parser bug wearing a finding's clothes. Counting the rows the
  // table HAS against the rows the pattern matched is what tells those two apart.
  const tableRows = [...section.matchAll(/^\| `src\/internal\/[^`]+` \|/gm)];
  assert.equal(rows.length, tableRows.length,
    `the scope table has ${tableRows.length} row(s) and this parser read ${rows.length}; a row it ` +
    `cannot read is a module that silently stops being accounted for`);
  return Object.fromEntries(rows.map((m) => [m[1], m[2]]));
})();

/** Deferrals the document may state, each with a ground this run re-derives. */
const DEFERRAL_GROUNDS = {};

test("every contract the document declares is real, and its signature is current", () => {
  const wrong = [];
  let compared = 0;
  for (const group of groups) {
    const real = new Map();
    for (const mod of group.modules)
      for (const [name, spec] of exportedSignatures(`${root}${mod}`)) real.set(name, { ...spec, mod });
    for (const [name, spec] of group.declarations) {
      const actual = real.get(name);
      if (!actual) { wrong.push(`${group.modules.join(" + ")} declares \`${name}\`, which it does not export`); continue; }
      if (spec.kind !== "function" || actual.kind !== "function") { compared++; continue; }
      compared++;
      const declared = spec.params.join(", ");
      const source = actual.params.join(", ");
      if (declared !== source)
        wrong.push(`${actual.mod}: the document declares \`${name}(${declared})\` and the module exports \`${name}(${source})\``);
    }
  }
  // ANTI-VACUITY, per rule: a parser that matched nothing would make the comparison trivially true,
  // which is the shape of the gate this replaced rather than a hypothetical.
  assert.ok(compared >= 20,
    `only ${compared} declaration(s) were compared; the document's \`\`\` blocks are not being read`);
  assert.deepEqual(wrong, [], `MODULE-CONTRACTS.md has drifted from src/internal/:\n  ${wrong.join("\n  ")}`);
});

test("every internal module is documented or carries a disposition, and no disposition is stale", () => {
  const stale = [...Object.keys(UNDOCUMENTED)].filter((m) => documented.has(m));
  assert.deepEqual(stale, [],
    `these modules are documented AND listed as undocumented: ${stale.join(", ")} — delete the entry`);

  const unaccounted = allModules.filter((m) => !documented.has(m) && !(m in UNDOCUMENTED));
  assert.deepEqual(unaccounted, [],
    `a new module under src/internal/ is neither documented nor dispositioned: ${unaccounted.join(", ")}`);

  const gone = Object.keys(UNDOCUMENTED).filter((m) => !allModules.includes(m));
  assert.deepEqual(gone, [], `the disposition table names modules that no longer exist: ${gone.join(", ")}`);

  assert.ok(documented.size >= 7,
    `the document covers ${documented.size} module(s); it covered 7 when this rule was written`);
});

test("each documented group still declares as much as it did", () => {
  // Without this, R1 above is satisfiable by deleting the declaration that went stale. The floor is
  // today's count, in the house style, so growing the document stays free.
  const FLOOR = { "src/internal/locale.js": 6, "src/internal/plural.js": 3, "src/internal/catalog.js": 1,
    "src/internal/expression.js": 3, "src/internal/interpolate.js": 2, "src/internal/bidi.js": 5 };
  for (const group of groups) {
    const floor = FLOOR[group.modules[0]];
    if (floor === undefined) continue;
    assert.ok(group.declarations.size >= floor,
      `${group.heading} declares ${group.declarations.size} contract(s) and declared ${floor} when ` +
      `this floor was set; a declaration was deleted rather than corrected`);
  }
});

const vectorsPath = `${root}../lokalized-spec/generated/behavioral-vectors.json`;
const vectors = existsSync(vectorsPath) ? JSON.parse(readFileSync(vectorsPath, "utf8")) : null;
const corpusSkip = vectors ? false : `behavioral vectors not found at ${vectorsPath}`;

test("every count the document states is what the artifact it describes contains", { skip: corpusSkip }, () => {
  // FIVE COUNTS, EVERY ONE OF THEM STALE when this rule was written — the corpus at 1,965 against
  // 2,363, `matchFor` at 216 against 304, 49 and 15 cardinality cases against 58 and 16, and 483
  // fixtures against 584. Each was true the day it was typed. A count is the fastest-rotting prose
  // there is: nothing about the sentence looks old when the number underneath it moves.
  const byOperation = (name) => vectors.cases.filter((/** @type {any} */ c) => c.operation === name).length;
  const fixtures = Array.isArray(vectors.fixtures)
    ? vectors.fixtures.length : Object.keys(vectors.fixtures ?? {}).length;

  const COUNTS = [
    { id: "corpus cases", pattern: /actually does for ([\d,]+) cases/, value: () => vectors.cases.length },
    { id: "matchFor cases", pattern: /the corpus's `matchFor` cases \(([\d,]+)\)/, value: () => byOperation("matchFor") },
    { id: "cardinalityForNumber", pattern: /the ([\d,]+) `cardinalityForNumber` cases/, value: () => byOperation("cardinalityForNumber") },
    { id: "cardinalityForOperands", pattern: /and ([\d,]+) `cardinalityForOperands` cases/, value: () => byOperation("cardinalityForOperands") },
    { id: "fixtures", pattern: /across the ([\d,]+) fixtures/, value: () => fixtures },
  ];

  const wrong = [];
  for (const count of COUNTS) {
    const matches = [...doc.matchAll(new RegExp(count.pattern.source, "g"))];
    // Zero matches fails: the sentence was reworded and its number is now bound to nothing, which is
    // the state this whole file exists to end. More than one fails because the rule could not say
    // which it meant.
    if (matches.length !== 1) {
      wrong.push(`the '${count.id}' sentence matched ${matches.length} time(s); it must match exactly once`);
      continue;
    }
    const stated = Number(String(matches[0][1]).replace(/,/g, ""));
    const measured = count.value();
    if (stated !== measured) wrong.push(`'${count.id}': the document says ${stated} and the artifact has ${measured}`);
  }
  assert.ok(COUNTS.length >= 5, "the count table has been emptied");
  assert.deepEqual(wrong, [], `MODULE-CONTRACTS.md states counts that are no longer true:\n  ${wrong.join("\n  ")}`);
});

test("a deferral in the document carries a ground this run can falsify", () => {
  // THREE SCOPE STATEMENTS HAD OUTLIVED THE WORK THEY DEFERRED when this rule was written. Two said
  // the output/expansion character budgets were "out of scope here" while `src/internal/interpolate.js`
  // enforces both and says so in its own header — a header that cites THIS document as its authority
  // on scope. The third said `lokalized/parse`'s duplicate rejection and line/column reporting "are
  // M5a"; both ship, and a malformed file reports `<input>:1:3`.
  //
  // The mechanism is `tools/clause-ledger.mjs`'s, which M-D S21 built after the same failure: a
  // deferral needs a NAMED PREDICATE that is re-derived on every run, and a deferral with no ground
  // is an excuse rather than a decision.
  const DEFERRAL = /^.*(?:Out of scope here|are M\d[a-z]?\.|lands with the).*$/gm;
  const found = [...doc.matchAll(DEFERRAL)].map((m) => m[0].trim());
  const ungrounded = [];
  for (const sentence of found) {
    const ground = /<!--\s*ground:\s*(\w+)\s*-->/.exec(sentence);
    if (!ground) { ungrounded.push(sentence.slice(0, 110)); continue; }
    const predicate = DEFERRAL_GROUNDS[ground[1]];
    if (!predicate) { ungrounded.push(`names ground '${ground[1]}', which is not defined: ${sentence.slice(0, 80)}`); continue; }
    if (!predicate())
      ungrounded.push(`ground '${ground[1]}' no longer holds — the work it defers has landed: ${sentence.slice(0, 80)}`);
  }
  assert.deepEqual(ungrounded, [],
    `MODULE-CONTRACTS.md defers work without a ground anything can falsify:\n  ${ungrounded.join("\n  ")}\n` +
    `Add \`<!-- ground: name -->\` to the sentence and a predicate to DEFERRAL_GROUNDS, or delete the ` +
    `deferral because the work has landed.`);

  // A ground nothing consults is dead machinery, the mirror of a stale disposition.
  const consulted = new Set([...doc.matchAll(/<!--\s*ground:\s*(\w+)\s*-->/g)].map((m) => m[1]));
  const dead = Object.keys(DEFERRAL_GROUNDS).filter((name) => !consulted.has(name));
  assert.deepEqual(dead, [], `DEFERRAL_GROUNDS defines ground(s) no deferral names: ${dead.join(", ")}`);
});

test("every file and command the document names exists", () => {
  // `src/core/index.js` once named `test/construction-ingress.test.js` as what gated five checks, and
  // that file did not exist. `tools/clause-ledger.mjs` gates the same thing for a clause's evidence;
  // this gates it for a document that points a reader at eight files and three commands.
  const scripts = JSON.parse(readFileSync(`${root}package.json`, "utf8")).scripts;
  const named = [...new Set([...doc.matchAll(/`((?:test|tools|spike)\/[A-Za-z0-9./-]+)`/g)].map((m) => m[1]))];
  const commands = [...new Set([...doc.matchAll(/`npm run ([\w:-]+)`/g)].map((m) => m[1]))];

  assert.ok(named.length >= 5 && commands.length >= 2,
    `the document names ${named.length} file(s) and ${commands.length} command(s); the scan is broken`);
  assert.deepEqual(named.filter((path) => !existsSync(`${root}${path}`)), [],
    "MODULE-CONTRACTS.md points a reader at files that do not exist");
  assert.deepEqual(commands.filter((name) => !(name in scripts)), [],
    "MODULE-CONTRACTS.md names npm scripts that do not exist");
});

test("the universal claims the header makes about every internal module still hold", () => {
  // THE HEADER MAKES THREE CLAIMS ABOUT ALL TWENTY MODULES AT ONCE, and they were true when measured
  // — which is why they are here rather than in the repair list. The `@ts-check` one is the fragile
  // one and an adversarial pass measured why: `tsconfig.json` sets `checkJs: true`, so deleting the
  // pragma from all twenty leaves `npm run check` at exit 0 with zero diagnostics. The claim would
  // have gone false in silence.
  //
  // The Node-builtin claim is deliberately NOT re-checked here: `test/package-shape.test.js:79`
  // already scans every file outside `src/node/` for all four import shapes AND the Node globals,
  // which is strictly stronger than anything this file would write.
  const missing = allModules.filter((mod) =>
    !readFileSync(`${root}${mod}`, "utf8").slice(0, 200).includes("@ts-check"));
  assert.ok(allModules.length >= 20, `only ${allModules.length} internal module(s) found`);
  assert.deepEqual(missing, [],
    "MODULE-CONTRACTS.md says every internal module carries `// @ts-check`, and these do not");

  const runtimeEscapes = [];
  for (const mod of allModules) {
    const source = readFileSync(`${root}${mod}`, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
    for (const match of source.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"/g)) {
      const specifier = match[1] ?? match[2];
      if (!/^\.\.?\/(?:internal\/)?[a-z0-9-]+\.js$/.test(specifier) && !/^\.\.\/data\/[a-z0-9-]+\.js$/.test(specifier))
        runtimeEscapes.push(`${mod} -> ${specifier}`);
    }
  }
  assert.deepEqual(runtimeEscapes, [],
    "the header says an internal module's RUNTIME imports are only ../data/*.js and other " +
    "src/internal/*; these reach further");
});
