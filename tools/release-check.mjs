#!/usr/bin/env node
// @ts-check
/**
 * PLAN 8.5's RELEASE VERIFICATION, RUN AGAINST `npm pack` RATHER THAN THE WORKING TREE.
 *
 * Plan :2766 lists nine checks: "every documented import, Node ESM, absence of a documented CommonJS
 * `require` contract, TypeScript resolution, direct-browser import, legal notices, undeclared files,
 * reproducibility, and accidental Node/React code in browser graphs." M-R S1 measured four of them
 * already running. This adds the rest that do not need a browser, and it does the one thing none of
 * the existing gates do: **it INSTALLS the tarball into a clean project and uses it.**
 *
 * The difference is not pedantry. `npm run declarations` and `check:readme:packed` both resolve
 * `lokalized` through a symlink or an extraction that this repository controls; a consumer runs
 * `npm install`, which copies the tarball into `node_modules` and resolves through the real
 * `exports` map with no repository anywhere. M-R S2 found the last gap of exactly this shape —
 * probes that type-checked `src/` while consumers get `types/` — and it hid a live defect for a
 * milestone.
 *
 * **THE BROWSER HALF IS RECORDED, NOT RUN HERE**, on `scenario:0a`'s reasoning: a green `verify`
 * must not need a person at a browser. `measurements/release-rehearsal.json` carries the capture and
 * the checks below compare what they can without one.
 *
 *   node tools/release-check.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { brotliCompressSync, constants } from "node:zlib";

import { graphBytes } from "./graph-walk.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const problems = [];

// A deliberate write, with the reason kept in the artifact -- `scenario:0a`'s shape. A write with
// no reason is refused rather than defaulted, because "why did this grow" is the only thing the
// field is for.
const rewriteSizes = process.argv.includes("--write");
const rewriteReason = process.argv.includes("--reason")
  ? process.argv[process.argv.indexOf("--reason") + 1] ?? null : null;
if (rewriteSizes && !rewriteReason) {
  console.error("--write needs --reason \"what grew and why\"; the reason is kept in the artifact");
  process.exit(2);
}
const site = mkdtempSync(join(tmpdir(), "lokalized-release-"));

try {
  /* 1. pack, and install it the way a consumer does */
  // **`prepack` PRINTS TO STDOUT, SO `--json` IS NOT JSON.** This package's `prepack` runs
  // `npm run types && npm run build:browser`, and both announce themselves, so the output is npm's
  // lifecycle banners followed by the array. The JSON is extracted from the end rather than the
  // whole stream being parsed — the first version parsed it whole and died on "dist/brows"... The
  // hook is deliberately NOT skipped here: `dist/` and `types/` are what a release ships, and a
  // rehearsal that packed without them would be rehearsing something else.
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", site],
    { cwd: root, encoding: "utf8" });
  const asJson = /\[\s*\{[^]*\}\s*\]\s*$/.exec(packOutput);
  if (!asJson) throw new Error(`npm pack --json printed no JSON array:\n${packOutput.slice(-400)}`);
  const packed = JSON.parse(asJson[0])[0];
  const app = join(site, "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({
    name: "release-rehearsal", version: "1.0.0", type: "module",
    dependencies: { lokalized: `file:${join(site, packed.filename)}` },
  }), "utf8");
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent"], { cwd: app, encoding: "utf8" });

  /* 2. every documented import, from the installed copy, actually running */
  const specifiers = Object.keys(pkg.exports)
    .filter((key) => key !== "./package.json")
    .map((key) => (key === "." ? "lokalized" : `lokalized/${key.slice(2)}`));
  writeFileSync(join(app, "esm.mjs"),
    `${specifiers.map((s, i) => `import * as m${i} from ${JSON.stringify(s)};`).join("\n")}\n` +
    `import { createStrings } from "lokalized";\n` +
    `const s = createStrings({ strings: { en: { K: "Hello, {{n}}" }, fr: { K: "Bonjour, {{n}}" } },\n` +
    `  fallbackLocale: "en", locale: "fr" });\n` +
    `const counts = [${specifiers.map((_, i) => `Object.keys(m${i}).length`).join(", ")}];\n` +
    `console.log(JSON.stringify({ rendered: s.get("K", { n: "Ada" }), counts }));\n`, "utf8");
  const esm = JSON.parse(execFileSync(process.execPath, ["esm.mjs"], { cwd: app, encoding: "utf8" }));
  if (esm.rendered !== "Bonjour, Ada")
    problems.push(`the installed package rendered ${JSON.stringify(esm.rendered)}, not the French catalog's entry`);
  esm.counts.forEach((/** @type {number} */ count, /** @type {number} */ index) => {
    if (count === 0) problems.push(`${specifiers[index]} imports from the installed package with zero exports`);
  });

  /* 3. no CommonJS contract — asserted by `require` FAILING, not by reading the manifest */
  if (pkg.main !== undefined) problems.push("package.json declares `main`, which is a CommonJS entry contract");
  writeFileSync(join(app, "cjs.cjs"),
    `try { require("lokalized"); console.log("RESOLVED"); }\n` +
    `catch (error) { console.log(error.code ?? "THREW"); }\n`, "utf8");
  const cjs = execFileSync(process.execPath, ["cjs.cjs"], { cwd: app, encoding: "utf8" }).trim();
  if (cjs === "RESOLVED") problems.push("`require(\"lokalized\")` resolves; the package has an undocumented CommonJS contract");

  /* 4. TypeScript resolution, against the INSTALLED package rather than this repository */
  writeFileSync(join(app, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, module: "nodenext", moduleResolution: "nodenext",
      target: "es2022", noEmit: true, skipLibCheck: true },
  }), "utf8");
  writeFileSync(join(app, "consumer.ts"),
    `import { createStrings, forLocaleMatch } from "lokalized/core";\n` +
    `import type { Strings, LocaleMatch, TranslationFailure } from "lokalized/core";\n` +
    `import { createLocaleNegotiator } from "lokalized/negotiate";\n` +
    `const s: Strings = createStrings({ strings: { en: { K: "v" } }, fallbackLocale: "en", locale: "en",\n` +
    `  onFailure: (f: TranslationFailure) => { void f.localeMatch.matchType; return { action: "return-key" as const }; } });\n` +
    `const m: LocaleMatch = createLocaleNegotiator({ fallbackLocale: "en", supportedLocales: ["en", "fr"] }).matchFor("fr-CA");\n` +
    `export const out = s.get("K", {}, forLocaleMatch(m));\n`, "utf8");
  try {
    execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "."],
      { cwd: app, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const first = `${/** @type {any} */ (error).stdout ?? ""}`.split("\n").find((l) => l.includes("error TS"));
    problems.push(`a TypeScript consumer of the INSTALLED package does not compile: ${first ?? "(no diagnostic)"}`);
  }

  /* 5. no React, and no Node built-in outside `lokalized/node`, in what actually shipped */
  const files = packed.files.map((/** @type {{ path: string }} */ f) => f.path);
  const installed = join(app, "node_modules/lokalized");
  for (const path of files.filter((/** @type {string} */ p) => p.endsWith(".js"))) {
    const body = readFileSync(join(installed, path), "utf8");
    if (/\breact\b/i.test(body)) problems.push(`${path} references React`);
    if (!path.startsWith("src/node/") && /from\s*["']node:/.test(body))
      problems.push(`${path} imports a Node built-in outside lokalized/node`);
  }

  /* 6. the recorded browser rehearsal, compared to what shipped */
  const record = JSON.parse(readFileSync(join(root, "measurements/release-rehearsal.json"), "utf8"));
  for (const entry of record.browser.entries)
    if (!files.includes(entry.file))
      problems.push(`the browser rehearsal loaded ${entry.file}, which this tarball does not contain`);
  if (record.browser.notFound !== 0) problems.push("the recorded browser rehearsal carries a failed request");
  if (!record.browser.rendered.startsWith("Bonjour"))
    problems.push("the recorded browser rehearsal did not render the French catalog");

  // **THE BYTE FIGURES ARE GATED, AND UNTIL M-R S9 NOT ONE OF THEM WAS.** An ablation setting every
  // size field in the record to `1` left this tool at EXIT 0 — and the record had in fact drifted
  // 42% behind the artifact, because M-R S8's re-encoding took the root from 322,547 to 187,717 raw
  // bytes and nothing here could see it. This is the only artifact in the repository holding the
  // shipped browser payload, so an unchecked number in it is the number a reader eventually gets.
  //
  // THE CAPTURE STAYS A BROWSER MEASUREMENT AND IS NOT RE-TAKEN HERE. What is re-derived is the part
  // that is deterministic and machine-independent — which files an entry pulls and how many bytes
  // they are — on `scenario:2k`'s reasoning, not `scenario:0a`'s report-only rule: a graph size is
  // not a timing, and the tarball being compared is built right here.
  // **THE SIZE COLUMNS RE-RECORD THROUGH `--write --reason`, AND NOTHING ELSE IN THE CAPTURE DOES.**
  // Every other ratchet here (`scenario:0a`, `scenario:2k`, `conformance`) takes a deliberate write
  // with a kept reason, and this one did not: the six numbers had to be transcribed from this
  // tool's own output by hand, which is the "composed a value from a summary instead of reading
  // it" mistake this project has recorded five times. The write is narrow ON PURPOSE -- it touches
  // `files`/`rawBytes`/`brotliBytes` and NOTHING the browser measured. A capture that 404ed, or
  // rendered the fallback, or loaded a file the tarball lacks is still a hard failure, so this
  // cannot be used to silence a stale capture: it only re-states numbers it just derived itself.
  const sizeDrift = [];
  for (const entry of record.browser.entries) {
    if (!files.includes(entry.file)) continue;   // already reported, and graphBytes would throw
    const walked = graphBytes(installed, entry.file);
    const squeezed = brotliCompressSync(
      Buffer.concat(walked.files.map((/** @type {string} */ f) => readFileSync(f))),
      { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    if (walked.modules !== entry.files)
      sizeDrift.push([entry, "files", walked.modules,
        `the rehearsal records ${entry.specifier} as ${entry.files} file(s); ` +
          `the packed artifact reaches ${walked.modules}`]);
    if (walked.bytes !== entry.rawBytes)
      sizeDrift.push([entry, "rawBytes", walked.bytes,
        `the rehearsal records ${entry.specifier} at ${entry.rawBytes} raw byte(s); ` +
          `the packed artifact is ${walked.bytes}`]);
    if (squeezed !== entry.brotliBytes)
      sizeDrift.push([entry, "brotliBytes", squeezed,
        `the rehearsal records ${entry.specifier} at ${entry.brotliBytes} brotli byte(s); ` +
          `the packed artifact is ${squeezed}`]);
  }

  if (sizeDrift.length > 0 && rewriteSizes) {
    for (const [entry, field, value] of sizeDrift) entry[field] = value;
    record.browser.sizesRecordedFor = rewriteReason;
    writeFileSync(join(root, "measurements/release-rehearsal.json"), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`re-recorded ${sizeDrift.length} size field(s): ${rewriteReason}`);
  } else {
    for (const [, , , message] of sizeDrift) problems.push(message);
  }

  /* 7. the parity declaration and the divergence document, as the tarball carries them */
  //
  // **PLAN 8.5 WANTS BYTE IDENTITY BETWEEN THE TESTED AND PUBLISHED COPIES, and there is no
  // published copy yet.** What IS checkable today is the half that will still matter after the
  // first publish: the copy inside the tarball must equal the working tree's, and the working
  // tree's must equal what regenerating produces. A report that ships describing a DIFFERENT build
  // than the one in the tarball is the failure mode worth catching, and `prepack` generating it
  // last is what makes the two agree — this asserts that rather than trusting the ordering.
  for (const path of ["measurements/lokalized-parity.json", "DIVERGENCES.md"]) {
    if (!files.includes(path)) { problems.push(`${path} is not in the packed tarball`); continue; }
    const packedCopy = readFileSync(join(installed, path), "utf8");
    const treeCopy = readFileSync(join(root, path), "utf8");
    if (packedCopy !== treeCopy)
      problems.push(`${path} in the tarball is not byte-identical to the working tree's copy`);
  }
  // The parity declaration must describe THIS package: its own recorded version and commit are
  // compared to the tarball's, so a stale report cannot ride along with a newer build.
  {
    const parity = JSON.parse(readFileSync(join(installed, "measurements/lokalized-parity.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
    if (parity.fields.implementationVersion !== manifest.version)
      problems.push(`the packed parity declaration reports version ${parity.fields.implementationVersion} ` +
        `and the packed package.json says ${manifest.version}`);
    if (!parity.strictPartition?.met)
      problems.push("the packed parity declaration reports the strict required partition as NOT met");
    if (parity.undetermined.some((/** @type {any} */ u) => !u.reason && !u.blocker))
      problems.push("the packed parity declaration carries an undetermined field with no reason and no blocker");
  }

  /* anti-vacuity */
  if (specifiers.length < 9) problems.push(`only ${specifiers.length} specifier(s) were imported`);
  if (files.filter((/** @type {string} */ p) => p.endsWith(".js")).length < 50)
    problems.push("the scan for React and Node built-ins ran over almost no files");

  console.log(`release rehearsal — ${packed.filename}, ${packed.size} bytes packed, ${files.length} files`);
  console.log(`  installed and imported ${specifiers.length} documented specifier(s); rendered ${JSON.stringify(esm.rendered)}`);
  console.log(`  require() answered ${cjs}; TypeScript resolved against the installed copy`);
  console.log(`  browser rehearsal recorded: ${record.browser.entries.length} entries, ` +
    `${record.browser.rootRequests} request(s) for the single-file root, ${record.browser.notFound} not found`);
} finally {
  rmSync(site, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exit(1);
}
console.log("the packed package installs, imports, typechecks and renders as a consumer receives it.");
