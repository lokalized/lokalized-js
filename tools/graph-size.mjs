#!/usr/bin/env node
// @ts-check
/**
 * Root-graph size accounting.
 *
 * Scenario 0a records ONE number per entry point — the transitive source bytes — and ratchets it.
 * That is enough to notice growth and not enough to explain it, and by M6 close the root graph had
 * gone 353.3 KB / 19 modules -> 465.2 KB / 21 modules on a library whose premise is being small.
 * This tool answers the questions 0a's single number cannot:
 *
 *   1. WHERE are the bytes? Per module, with what the module is for.
 *   2. Are they SHIPPED bytes? Raw source counts comment prose a consumer never downloads, so each
 *      module is also reported comment-stripped and compressed. The stripper is validated, not
 *      trusted: every stripped module must pass `node --check`, and the stripped root graph must
 *      render the scenario-0a fixture to the identical string before any number here is printed.
 *   3. What would SPLITTING something out actually save? For every module, the "exclusive" figure
 *      is the bytes that leave the graph if that module stops being reachable — the module itself
 *      plus everything reachable from the entry point only through it. A module with a large
 *      exclusive figure is a real split candidate; one whose exclusive figure equals its own size
 *      has no private dependencies and is worth exactly itself.
 *
 * Compression is measured INTEGRATED (one window over the concatenated graph) as well as per module,
 * because the sum of independently-compressed parts overstates the real cost — the same reason
 * `tools/gen-data.js --measure` reports both.
 *
 * This is a REPORTING tool with ONE gate, and the exception is deliberate: a module that enters the
 * root graph with no recorded purpose exits nonzero (`UNCLASSIFIED` below). Scenario 0a still owns
 * the byte and module-count ratchets; what it cannot say is WHY a module is here, and an
 * unclassified module is exactly the state in which nobody can answer that. The section was
 * report-only until M7 close, when three modules had sat in it unremarked for two milestones — the
 * same shape as the classpath partition defect, which `conformance.mjs` reported on every run for a
 * whole milestone while nothing consumed the report.
 *
 *   node tools/graph-size.mjs [--entry <path>] [--json <path>]
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
const jsonOut = argOf("--json");

/* ---------------------------------------------------------------- graph */

/**
 * Every shape of relative import that puts a module in the runtime graph. Kept character-identical
 * to `tools/scenario-0a.mjs`'s `IMPORT_PATTERNS`; see `walk` for why the two must not drift.
 */
const IMPORT_PATTERNS = [
  /from\s+"(\.[^"]+)"/g,
  /(?:^|[^.\w])import\s+"(\.[^"]+)"/gm,
  /import\(\s*"(\.[^"]+)"/g,
];

/**
 * The transitive relative-import graph of an entry point.
 *
 * The edge patterns match `tools/scenario-0a.mjs` exactly, deliberately: two tools reporting on the
 * same graph must not disagree about what is in it. That claim went STALE and is restored here — 0a
 * gained the bare `import "…"` and dynamic `import("…")` patterns when the containment guard's blind
 * spot was measured, and this walk was left on `from "…"` alone.
 *
 * WHAT THE GAP WAS WORTH, measured rather than assumed, because it is smaller than it looks and
 * overstating it would be its own defect. Inserting `import "../data/iana-range-equivalents.js";`
 * into `src/core/index.js` did NOT make this tool under-report: the behavioral render below executes
 * a stripped COPY of exactly the modules the walk found, so the missing module made that import
 * fail and the run died with a bare `ERR_MODULE_NOT_FOUND` stack, exit 1. Loud, but it names a
 * temp-directory path and no cause. With the patterns aligned the same input is reported as the
 * 26th module and — having no `PURPOSE` entry — fails the UNCLASSIFIED gate by name.
 *
 * Comments are stripped before matching, for the reason 0a records: a JSDoc `import("./x.js").Type`
 * is a type annotation, not an edge, and `src/` is full of them. This file's stripper is the
 * validated one used for the byte columns rather than 0a's regex, and the two were measured to
 * reach the IDENTICAL graph: this file at HEAD and this file as it now stands both report
 * 25 modules / 701.9 KB for `src/index.js` and 24 / 693.8 KB for `src/core/index.js`, which are
 * `measurements/scenario-0a.json`'s 718,731 and 710,486 source bytes to the precision printed here.
 *
 * An `export … from` would still be missed by both; the walk asserts afterwards that no reached
 * module contains a runtime `import(` the patterns did not resolve, rather than quietly
 * under-reporting.
 *
 * @param {string} entry repository-relative path
 */
function walk(entry) {
  /** @type {Map<string, {bytes: number, text: string}>} */
  const nodes = new Map();
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const queue = [resolve(root, entry)];
  const missed = [];

  while (queue.length) {
    const file = queue.pop();
    if (!file || nodes.has(file)) continue;
    const text = readFileSync(file, "utf8");
    nodes.set(file, { bytes: Buffer.byteLength(text), text });
    const deps = [];
    const scannable = stripComments(text);
    for (const pattern of IMPORT_PATTERNS)
      for (const m of scannable.matchAll(pattern)) {
        const dep = resolve(dirname(file), m[1]);
        deps.push(dep);
        queue.push(dep);
      }
    out.set(file, deps);
  }
  return { nodes, out, missed, entry: resolve(root, entry) };
}

/**
 * Bytes that leave the graph if `target` stops being reachable from the entry: `target` itself plus
 * every module reachable from the entry ONLY through it. Computed by deleting the node and re-running
 * reachability, which is exact and needs no dominator machinery at this size.
 */
function exclusiveSet(graph, target) {
  const reachable = new Set();
  const queue = [graph.entry];
  while (queue.length) {
    const f = queue.pop();
    if (!f || f === target || reachable.has(f)) continue;
    reachable.add(f);
    for (const d of graph.out.get(f) ?? []) queue.push(d);
  }
  return [...graph.nodes.keys()].filter((f) => !reachable.has(f));
}

/* -------------------------------------------------------------- stripper */

/**
 * Remove comments and blank lines. NOT a minifier: identifiers, whitespace inside expressions, and
 * every statement survive. It separates prose from code so a 465 KB figure that is one-third essay
 * is not reported as if a consumer downloaded 465 KB of program.
 *
 * The `/` ambiguity (regex vs. division) is resolved by the preceding significant token, and the
 * result is checked by `node --check` plus a behavioral render, so a misread would fail the run
 * rather than silently shrink a number.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  /** last significant character emitted, and the word before it if any */
  let lastChar = "";
  let lastWord = "";
  /** context stack: "code" | "template"; `braces` counts `{` depth inside a substitution */
  const stack = [{ kind: "code", braces: 0 }];
  const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "^", "~", "<", ">"]);
  const REGEX_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do", "else", "yield", "await"]);

  const emit = (s) => {
    out += s;
    for (const ch of s) {
      if (/\s/.test(ch)) continue;
      if (/[A-Za-z0-9_$]/.test(ch)) lastWord = /[A-Za-z0-9_$]/.test(lastChar) ? lastWord + ch : ch;
      else lastWord = "";
      lastChar = ch;
    }
  };

  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const next = src[i + 1];

    if (top.kind === "template") {
      if (c === "\\") { emit(src.slice(i, i + 2)); i += 2; continue; }
      if (c === "`") { emit(c); stack.pop(); i++; continue; }
      if (c === "$" && next === "{") { emit("${"); stack.push({ kind: "code", braces: 0 }); i += 2; continue; }
      emit(c); i++; continue;
    }

    // code context
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
      emit(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "`") { emit(c); stack.push({ kind: "template", braces: 0 }); i++; continue; }
    if (c === "/") {
      const isRegex = REGEX_PRECEDERS.has(lastChar) || REGEX_WORDS.has(lastWord);
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length) {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          else if (d === "\n") break;
          j++;
        }
        while (j + 1 < src.length && /[dgimsuvy]/.test(src[j + 1])) j++;
        emit(src.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      emit(c); i++; continue;
    }
    if (c === "{") { top.braces++; emit(c); i++; continue; }
    if (c === "}") {
      if (top.braces === 0 && stack.length > 1) { stack.pop(); emit(c); i++; continue; }
      top.braces--;
      emit(c); i++; continue;
    }
    emit(c); i++;
  }

  return out
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length)
    .join("\n") + "\n";
}

/* ------------------------------------------------------- module purposes */

/**
 * RECORDED FINDING — does the bounded parser belong in the root graph?
 *
 * Asked at M5a, when `src/internal/json-parse.js` entered the graph, because a consumer who hands
 * `createStrings` an already-parsed catalog never parses a byte. Measured with this tool rather than
 * argued: the parser's exclusive cost is ~22 KB raw / ~6.6 KB gzip, about 4% of the compressed
 * graph. The two clauses that decide it:
 *
 *   3.1  `lokalized/core` is "strict runtime plus synchronous raw-catalog parsing accepted by
 *        `createStrings`", and `symbol-allowlist.json` sets rootReExportsOwners ["core", "parse"].
 *   3.2  `CatalogInput = string | Uint8Array | ParsedStringsFile | readonly LocalizedStringInput[]`,
 *        and `createStrings` is SYNCHRONOUS — so it cannot reach a parser by dynamic import.
 *
 * So the split is not expressible as a re-export change: dropping `parse` from root's re-exports
 * saves nothing, because core still imports the parser to honor `CatalogInput`. Actually removing it
 * means narrowing `CatalogInput` to the already-parsed forms — a contract amendment that also
 * invalidates scenario 0a's M0-frozen variant 1 ("root with a fixed small embedded raw-text
 * catalog") and section 4.1's "direct construction over raw inputs". That is a large, frozen-contract
 * cost for ~4%, while the two genuinely large tenants of the graph — the likely-subtag table and the
 * expression language — sit untouched. Recommendation: keep the parser in the root graph; hold it to
 * its measured size here, and spend split effort where the CONDITIONAL section says the bytes are.
 */

/**
 * What each root-graph module is for, and whether a consumer who only ever calls `createStrings`
 * with an ALREADY-PARSED catalog can avoid it. "conditional" means the module is on a path some
 * consumers never take; it does not mean the module is currently splittable — the exclusive-bytes
 * column and section 3.1's frozen contract decide that.
 */
const PURPOSE = {
  "src/index.js": ["root re-export surface: classifiers, tagged values, 61 language-form constants", "always"],
  "src/core/index.js": ["createStrings, Strings, translation/result assembly, failure precedence", "always"],
  "src/internal/catalog.js": ["catalog validation: schema/model checks, language-form names, limits", "always"],
  "src/internal/json-parse.js": ["bounded duplicate-aware JSON parser: fatal UTF-8, limits, diagnostics (M5a)", "conditional: only a raw string/Uint8Array catalog is parsed"],
  "src/internal/interpolate.js": ["placeholder scanning, rendering, alternative selection", "always"],
  "src/internal/expression.js": ["expression tokenizer consumer: eager compiler + tree-walking evaluator (M6)", "conditional: catalogs with no alternatives never evaluate one"],
  "src/internal/expression-tokenizer.js": ["expression lexer (M6)", "conditional: catalogs with no alternatives never evaluate one"],
  "src/internal/plural.js": ["exact numeric conversion, CLDR operands, cardinal rule engine (M4)", "always: cardinal classification is a root export"],
  "src/internal/locale.js": ["tag parsing/canonicalization, fallback chain, matcher, tiebreakers", "always"],
  "src/internal/locale-cldr.js": ["CLDR canonicalization and alias application", "always"],
  "src/internal/locale-jdk-tag.js": ["JDK-compatible tag parse/render", "always"],
  "src/internal/bidi.js": ["Unicode bidi isolation of caller-supplied values, plus the bounded-output limit", "always: the mode keys off the EVALUATION locale, so every render consults it, and `interpolate.js` imports `outputLimitExceeded` from here on every message"],
  "src/internal/parse-warnings.js": ["incomplete cardinality/ordinality language-form warnings raised while a catalog is admitted", "always: `parseCatalogInput` builds the reporter for every `CatalogInput` form — a `ParsedStringsFile` replays its own recorded warnings instead, but still pays for the module"],
  "src/data/likely-subtags.js": ["generated: full-triple likely-subtag table", "always: the matcher's likely-subtag tier"],
  "src/data/cardinal.js": ["generated: CLDR cardinal plural rules", "always"],
  "src/data/parents.js": ["generated: CLDR parent locales", "always"],
  "src/data/aliases-language.js": ["generated: CLDR language aliases", "always"],
  "src/data/aliases-region.js": ["generated: CLDR territory aliases", "always"],
  "src/data/aliases-script.js": ["generated: CLDR script aliases", "always"],
  "src/data/aliases-variant.js": ["generated: CLDR variant aliases", "always"],
  "src/data/valid-languages.js": ["generated: IANA validity — language subtags", "always: direct-match validity"],
  "src/data/valid-regions.js": ["generated: IANA validity — region subtags", "always"],
  "src/data/valid-scripts.js": ["generated: IANA validity — script subtags", "always"],
  "src/data/valid-variants.js": ["generated: IANA validity — variant subtags", "always"],
  "src/data/rtl.js": ["generated: CLDR right-to-left scripts", "always: `bidi.js` resolves a locale's direction through it, via the likely-subtag script"],
};

/* ------------------------------------------------------------------ run */

const gz = (t) => gzipSync(Buffer.from(t, "utf8"), { level: 9 }).byteLength;
const br = (t, q) => brotliCompressSync(Buffer.from(t, "utf8"), { params: { [constants.BROTLI_PARAM_QUALITY]: q } }).byteLength;
const kb = (n) => (n / 1024).toFixed(1);

const entryArg = argOf("--entry") ?? "src/index.js";
const graph = walk(entryArg);
let exitCode = 0;

/* Validate the stripper before any stripped byte count is reported. */
const work = mkdtempSync(join(tmpdir(), "lokalized-graph-size-"));
try {
  for (const [file, { text }] of graph.nodes) {
    const rel = relative(root, file);
    const dest = join(work, rel);
    mkdirSync(dirname(dest), { recursive: true });
    const code = stripComments(text);
    writeFileSync(dest, code, "utf8");
    // A runtime `import()` the shared edge patterns cannot RESOLVE would make every figure below a
    // floor rather than a total, and that must be loud. `import("./x.js")` is now followed as an
    // edge, so only a dynamic import whose specifier is not a relative string literal — a computed
    // or bare specifier — is unresolvable and reported here. Checked on the STRIPPED text, so the
    // codebase's JSDoc `import("./x.js").Type` annotations — types, not edges — do not trip it.
    if (/[^.\w]import\s*\(\s*(?!"\.)/.test(code)) graph.missed.push(`${rel}: unresolvable dynamic import()`);
  }
  if (graph.missed.length) {
    console.error("imports the shared edge regex cannot see; every figure below would be a floor:");
    for (const m of graph.missed) console.error(`  ${m}`);
    process.exit(2);
  }
  for (const file of graph.nodes.keys()) {
    const dest = join(work, relative(root, file));
    try {
      execFileSync(process.execPath, ["--check", dest], { stdio: "pipe" });
    } catch (error) {
      console.error(`comment stripper produced invalid JS for ${relative(root, file)}:`);
      console.error(String(error.stderr ?? error));
      process.exit(2);
    }
  }
  // Behavioral check: the stripped graph must render scenario 0a's fixture identically.
  const CATALOG = {
    en: {
      Greeting: "Hello, {{name}}",
      "I read {{bookCount}} books": {
        translation: "I read {{bookCount}} {{books}}",
        placeholders: { books: { value: "bookCount", translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" } } },
      },
    },
    "en-001": { Greeting: "Hello there, {{name}}" },
    fr: { Greeting: "Bonjour, {{name}}" },
  };
  const build = async (base) => {
    const mod = await import(`file://${join(base, relative(root, graph.entry))}`);
    const api = mod.createStrings ? mod : await import(`file://${join(base, "src/core/index.js")}`);
    const strings = api.createStrings({ fallbackLocale: "en", locale: "en-AU", strings: CATALOG, tiebreakers: { en: ["en", "en-001"] } });
    return strings.get("I read {{bookCount}} books", { bookCount: 3 });
  };
  const real = await build(root);
  const stripped = await build(work);
  if (real !== stripped) {
    console.error(`comment stripper changed behavior: ${JSON.stringify(real)} -> ${JSON.stringify(stripped)}`);
    process.exit(2);
  }

  /* ------------------------------------------------------------ report */
  const rows = [...graph.nodes].map(([file, { text, bytes }]) => {
    const rel = relative(root, file);
    const code = stripComments(text);
    const excl = exclusiveSet(graph, file);
    return {
      module: rel,
      bytes,
      codeBytes: Buffer.byteLength(code),
      gzip: gz(text),
      exclusiveBytes: excl.reduce((n, f) => n + graph.nodes.get(f).bytes, 0),
      exclusiveModules: excl.length,
      purpose: PURPOSE[rel]?.[0] ?? "(unclassified — add it to PURPOSE)",
      needed: PURPOSE[rel]?.[1] ?? "unknown",
    };
  }).sort((a, b) => b.bytes - a.bytes);

  const total = rows.reduce((n, r) => n + r.bytes, 0);
  const totalCode = rows.reduce((n, r) => n + r.codeBytes, 0);
  const concatRaw = [...graph.nodes.values()].map((n) => n.text).join("\n");
  const concatCode = [...graph.nodes.values()].map((n) => stripComments(n.text)).join("\n");

  console.log(`graph of ${entryArg} — ${rows.length} modules, ${kb(total)} KB source\n`);
  console.log(`${"module".padEnd(38)}${"raw".padStart(8)}${"code".padStart(8)}${"gzip".padStart(8)}${"excl".padStart(8)}  purpose`);
  for (const r of rows)
    console.log(
      r.module.padEnd(38) + kb(r.bytes).padStart(8) + kb(r.codeBytes).padStart(8) + kb(r.gzip).padStart(8) +
      (r.exclusiveModules > 1 ? `${kb(r.exclusiveBytes)}*` : kb(r.exclusiveBytes)).padStart(8) + "  " + r.purpose,
    );
  console.log("-".repeat(70));
  console.log("TOTAL".padEnd(38) + kb(total).padStart(8) + kb(totalCode).padStart(8) + kb(gz(concatRaw)).padStart(8));
  console.log(`\ncode = comments and blank lines removed (validated: node --check + identical 0a render)`);
  console.log(`comment/prose share of the graph: ${(((total - totalCode) / total) * 100).toFixed(1)}%`);
  console.log(`excl = bytes that leave the graph if the module stops being reachable; * = it drags others with it`);

  console.log(`\nintegrated, one compression window over the whole graph:`);
  console.log(`  ${"".padEnd(12)}${"raw".padStart(10)}${"gzip-9".padStart(10)}${"br-q11".padStart(10)}${"br-q5".padStart(10)}`);
  console.log(`  ${"as authored".padEnd(12)}${kb(Buffer.byteLength(concatRaw)).padStart(10)}${kb(gz(concatRaw)).padStart(10)}${kb(br(concatRaw, 11)).padStart(10)}${kb(br(concatRaw, 5)).padStart(10)}`);
  console.log(`  ${"code only".padEnd(12)}${kb(Buffer.byteLength(concatCode)).padStart(10)}${kb(gz(concatCode)).padStart(10)}${kb(br(concatCode, 11)).padStart(10)}${kb(br(concatCode, 5)).padStart(10)}`);
  console.log(`  (KB. A real minifier renames locals and drops whitespace; "code only" is a conservative`);
  console.log(`   upper bound on shipped bytes, not a minification result.)`);

  const generated = rows.filter((r) => r.module.startsWith("src/data/"));
  const genBytes = generated.reduce((n, r) => n + r.bytes, 0);
  console.log(`\ngenerated data vs. hand-written code:`);
  console.log(`  generated tables  ${String(generated.length).padStart(2)} modules  ${kb(genBytes).padStart(7)} KB raw  ${((genBytes / total) * 100).toFixed(1)}%`);
  console.log(`  implementation    ${String(rows.length - generated.length).padStart(2)} modules  ${kb(total - genBytes).padStart(7)} KB raw  ${(((total - genBytes) / total) * 100).toFixed(1)}%`);

  const unclassified = rows.filter((r) => r.needed === "unknown");
  if (unclassified.length) {
    console.log(`\nUNCLASSIFIED (${unclassified.length}) — a module entered the graph of ${entryArg} without a recorded purpose:`);
    for (const r of unclassified) console.log(`  ${r.module}  ${kb(r.bytes)} KB`);
  }

  // Conditional modules, grouped by the SINGLE decision that would remove them. Summing every
  // conditional module into one figure would conflate independent decisions and overstate what any
  // one split buys, which is the mistake this whole report exists to stop making.
  const conditional = rows.filter((r) => r.needed.startsWith("conditional"));
  if (conditional.length) {
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const r of conditional) groups.set(r.needed, [...(groups.get(r.needed) ?? []), r.module]);
    console.log(`\nCONDITIONAL paths — what each ONE decision would remove (splittable is a separate`);
    console.log(`question: section 3.1 fixes root's contents and 3.2's CatalogInput fixes core's):`);
    for (const [why, modules] of groups) {
      const set = new Set(modules.map((m) => resolve(root, m)));
      const reachable = new Set();
      const queue = [graph.entry];
      while (queue.length) {
        const f = queue.pop();
        if (!f || set.has(f) || reachable.has(f)) continue;
        reachable.add(f);
        for (const d of graph.out.get(f) ?? []) queue.push(d);
      }
      const gone = [...graph.nodes.keys()].filter((f) => !reachable.has(f));
      const goneBytes = gone.reduce((n, f) => n + graph.nodes.get(f).bytes, 0);
      const keptGzip = gz([...graph.nodes].filter(([f]) => reachable.has(f)).map(([, n]) => n.text).join("\n"));
      console.log(`\n  ${why}`);
      for (const m of modules) console.log(`    ${m}`);
      console.log(`    -> ${gone.length} module(s), ${kb(goneBytes)} KB raw (${((goneBytes / total) * 100).toFixed(1)}%),` +
        ` graph gzip ${kb(gz(concatRaw))} -> ${kb(keptGzip)} KB (-${((1 - keptGzip / gz(concatRaw)) * 100).toFixed(1)}%)`);
    }
  }

  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify({ entry: entryArg, totalBytes: total, totalCodeBytes: totalCode, modules: rows }, null, 2)}\n`, "utf8");
    console.log(`\nwritten: ${jsonOut}`);
  }

  // THE ONE GATE. Printed last so the whole report is on screen first, and after `--json` so a
  // consumer still gets the artifact describing the graph it is complaining about.
  //
  // Reported-only is not a gate: the UNCLASSIFIED section existed and printed three modules for two
  // milestones without anything acting on it. A `PURPOSE` entry is cheap — one line naming what the
  // module is for and whether an already-parsed-catalog consumer can avoid it — and the entry is
  // what makes the exclusive-bytes column above readable as a split decision rather than a number.
  if (unclassified.length) {
    console.error(
      `\nFAILED: ${unclassified.length} module(s) in the graph of ${entryArg} have no PURPOSE entry. ` +
        "Add one line each to PURPOSE in this file: [what it is for, whether a consumer who only " +
        "hands createStrings an already-parsed catalog can avoid it].",
    );
    exitCode = 2;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(exitCode);
