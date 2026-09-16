#!/usr/bin/env node
// @ts-check
/**
 * CONSUMER-SHAPED TYPESCRIPT PROBES — the channel this repository did not have.
 *
 * Every one of the 1,440 tests is JavaScript, so none of them can see what a TypeScript consumer
 * sees. S29 found what that costs: `createStrings({ loaded, locale })` — M8's flagship call, spelled
 * that way in plan 6.2's own examples — failed with `TS2353: 'loaded' does not exist in type
 * 'CreateStringsOptions'`, because core read the option through an `any` cast and `tsc` therefore
 * emitted a declaration with no such member. The RUNTIME was correct throughout and 13 tests covered
 * it. **A cast is a place a gate cannot look, and the declaration is a separate artifact from the
 * behaviour.**
 *
 * Plan 3.5:1109-1110 already asks for this channel by name: "Package declaration tests reject
 * consumer-side construction and subclass declarations; runtime tests accept catching and
 * `instanceof` and reject direct construction and subclass instantiation." The runtime half has
 * existed since S22; this is the declaration half.
 *
 * THE RECORD IS TYPED \`LoadedStrings\`, NOT \`any\`, AND THAT IS LOAD-BEARING. The first draft declared
 * it \`any\`, and under \`--strict\` the mixed probe COMPILED: \`any\` is assignable to \`never\`, so the
 * \`?: never\` members that make the two arms exclusive were defeated by the probe itself rather than
 * by the declaration. The \`zh-123\` shape, inside the probe written to check exactly that.
 *
 * EACH PROBE DECLARES WHETHER IT MUST COMPILE, and a probe that compiles when it must not is exactly
 * as red as one that fails when it must compile. Without the must-fail arm the whole file is
 * satisfied by a declaration typed `any`.
 *
 *   node tools/declaration-probes/run.mjs [--keep]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const core = JSON.stringify(join(root, "src/core/index.js"));
const load = JSON.stringify(join(root, "src/load/index.js"));
const nodeDoor = JSON.stringify(join(root, "src/node/index.js"));

/** @type {{ name: string, compiles: boolean, why: string, source: string }[]} */
const PROBES = [
  {
    name: "the loaded door is callable",
    compiles: true,
    why: "plan 6.2's own example spells `createStrings({ loaded, locale })`; it did not typecheck",
    source: `import { createStrings } from ${core};
import type { LoadedStrings } from ${load};
declare const record: LoadedStrings;
export const s = createStrings({ loaded: record, locale: "fr-BE" });`,
  },
  {
    name: "a record FROM THE LOADER flows into construction",
    compiles: true,
    why: "the probe above declares its own `LoadedStrings`; this one takes the loader's OWN return " +
      "type, which is the only thing that can catch the loader widening a field. It did: measured " +
      "2026-09-15, `run-plan.js` annotated its accumulator `Record<string, unknown>` and the whole " +
      "load-then-construct pipeline failed with TS2322 for every TypeScript consumer",
    source: `import { createStrings } from ${core};
import { loadStrings } from ${load};
declare const loaded: Awaited<ReturnType<typeof loadStrings>>;
export const s = createStrings({ loaded, locale: "fr" });`,
  },
  {
    name: "a record from the NODE whole-manifest loader flows into construction",
    compiles: true,
    why: "the same seam at the other door; its return type is declared separately and can widen alone",
    source: `import { createStrings } from ${core};
import { loadEntireManifestFromFiles } from ${nodeDoor};
declare const loaded: Awaited<ReturnType<typeof loadEntireManifestFromFiles>>;
export const s = createStrings({ loaded, locale: "fr" });`,
  },
  {
    name: "the direct door is callable",
    compiles: true,
    why: "THE CONTROL. Without it a declaration that rejected everything would satisfy the probe above",
    source: `import { createStrings } from ${core};
export const s = createStrings({ strings: { en: { K: "v" } }, fallbackLocale: "en", locale: "en" });`,
  },
  {
    name: "the two doors do not mix",
    compiles: false,
    why: "plan 3.2:577-585 marks every direct member `?: never` on the loaded arm, and the reverse",
    source: `import { createStrings } from ${core};
import type { LoadedStrings } from ${load};
declare const record: LoadedStrings;
export const s = createStrings({ loaded: record, strings: { en: {} }, fallbackLocale: "en", locale: "en" });`,
  },
  {
    name: "a library error is catchable",
    compiles: true,
    why: "plan 3.5:1107 — the runtime values are public for catching and `instanceof`",
    source: `import { DigestUnavailableError } from ${load};
export const f = (error: unknown) => error instanceof DigestUnavailableError ? error.code : null;`,
  },
  {
    name: "a consumer cannot construct a library error",
    compiles: false,
    why: "plan 3.5:1107 — the declarations expose no constructor; emitted as `private constructor();`",
    source: `import { ConfigurationError } from ${core};
export const bad = new ConfigurationError("fake");`,
  },
  {
    name: "a consumer cannot extend a library error",
    compiles: false,
    why: "plan 3.5:1107 — nor an extension signature; a private constructor refuses `extends` too",
    source: `import { ConfigurationError } from ${core};
export class Mine extends ConfigurationError {}`,
  },
  {
    name: "one instanceof catches any library error",
    compiles: true,
    why: "plan 3.5:1092 exports LokalizedError as the base; before S35 there was no common ancestor",
    source: `import { LokalizedError } from ${core};
export const f = (error: unknown) => error instanceof LokalizedError ? error.code : null;`,
  },
  {
    name: "the widest library error is catchable",
    compiles: true,
    why: "plan 3.5:1100 — 119 sites raise a ConfigurationError and none was catchable before S34",
    source: `import { ConfigurationError } from ${core};
export const f = (error: unknown) => error instanceof ConfigurationError ? error.code : null;`,
  },
  {
    name: "createStrings refuses a runtimeLimits option",
    compiles: false,
    why: "plan 4.6 — a non-undefined `runtimeLimits` is a construction-time error, and the DECLARATION says so",
    source: `import { createStrings } from ${core};
export const s = createStrings({
  strings: { en: { K: "v" } }, fallbackLocale: "en", locale: "en",
  runtimeLimits: { maximumExpressionTokens: 8 },
});`,
  },
];

const directory = mkdtempSync(join(tmpdir(), "lokalized-declaration-probes-"));
let failures = 0;
try {
  for (const probe of PROBES) {
    const file = join(directory, `${probe.name.replace(/\W+/g, "-")}.ts`);
    writeFileSync(file, `${probe.source}\n`, "utf8");
    let compiled = true;
    let output = "";
    try {
      execFileSync(process.execPath, [
        join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--allowJs", "--checkJs",
        "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", file,
      ], { cwd: root, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      compiled = false;
      output = `${/** @type {any} */ (error).stdout ?? ""}`;
    }
    const ok = compiled === probe.compiles;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${probe.compiles ? "compiles" : "REFUSED "}  ${probe.name}`);
    if (!ok) {
      console.log(`          ${probe.why}`);
      const line = output.split("\n").find((l) => l.includes("error TS"));
      console.log(`          ${compiled ? "it compiled, and the probe says it must not" : `tsc: ${line ?? "(no diagnostic)"}`}`);
    }
  }
} finally {
  if (!process.argv.includes("--keep")) rmSync(directory, { recursive: true, force: true });
}

console.log(`\ndeclaration probes: ${PROBES.length - failures}/${PROBES.length}`);
process.exit(failures === 0 ? 0 : 1);
