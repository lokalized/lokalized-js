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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const core = JSON.stringify(join(root, "src/core/index.js"));
const load = JSON.stringify(join(root, "src/load/index.js"));
const nodeDoor = JSON.stringify(join(root, "src/node/index.js"));

/**
 * The nine error classes plan 3.5:1092-1100 declares as package exports, the subpath each is reached
 * through, and whether the DECLARATION refuses `extends` today. Measured, with a control, on
 * 2026-09-18: `new` is refused for all nine; `extends` for EIGHT.
 *
 * **`ExpressionEvaluationError`'s DIVERGENCE IS RETIRED, and the mechanism is worth keeping because
 * nothing here would have caught it a second time.** Its `@private` was always in source and `tsc`
 * silently dropped it: a derived constructor whose signature is IDENTICAL to the inherited one is
 * ELIDED from the emit, and `(token, message, options?)` was byte-identical to the base's. Ablated
 * both ways against the pristine tree — changing ONLY the base's arity makes the guard appear, and
 * making `ConfigurationError`'s constructor match the base's makes ITS guard vanish with no
 * diagnostic anywhere. So the guard rested on an accidental signature difference, not on the tag.
 * Threading `code` through the base put a `LokalizedErrorCode` in parameter 2, which no subclass
 * takes, and that is what now keeps the eight signatures distinct.
 */
const ERROR_CLASSES = /** @type {{ name: string, subpath: string, extendsRefused: boolean }[]} */ ([
  { name: "LokalizedError", subpath: "core", extendsRefused: false },
  { name: "ExpressionEvaluationError", subpath: "core", extendsRefused: true },
  { name: "ConfigurationError", subpath: "core", extendsRefused: true },
  { name: "MissingTranslationError", subpath: "core", extendsRefused: true },
  { name: "UnsupportedLocaleError", subpath: "core", extendsRefused: true },
  { name: "ResolutionError", subpath: "core", extendsRefused: true },
  { name: "StringsParseError", subpath: "parse", extendsRefused: true },
  { name: "StringsLoadingError", subpath: "load", extendsRefused: true },
  { name: "DigestUnavailableError", subpath: "load", extendsRefused: true },
]);

/** @type {{ name: string, compiles: boolean, why: string, source: string }[]} */
const PROBES = [
  {
    name: "a switch over `matchType` exhausts",
    compiles: true,
    why: "plan 3.4:779 declares `LocaleMatchType` and the port typed the field `string` until M-D " +
      "S33, so a consumer could not branch on the set and `tsc` could not tell them when they had " +
      "missed an arm. **THIS PROBE ALONE IS THE GATE, and an earlier version of this comment claimed " +
      "otherwise.** It said the next probe and this one were a PAIR and that `string` failed both. " +
      "Measured across five type-level mutations — `string`, `any`, a widened nine-member union, and " +
      "a seven-member union spelled two different ways — THIS probe went red in all five and the " +
      "next one went red in NONE. It is also the only gate in `verify` that can see any of them: " +
      "`npm run check`, `npm run types` and all 1,633 JavaScript tests stay green under every one",
    source: `import { forLocaleMatch } from ${core};
import type { LocaleMatch, LocaleMatchType } from ${core};
declare const match: LocaleMatch;
const exhaust = (value: never): never => value;
export function describe(type: LocaleMatchType): string {
  switch (type) {
    case "none": case "exact": case "canonical": case "cldr-fallback":
    case "likely-subtag": case "extended-range": case "primary-language": case "wildcard":
      return type;
    default:
      return exhaust(type);
  }
}
export const round = describe(match.matchType);
export const options = forLocaleMatch(match);`,
  },
  {
    name: "a switch over `matchType` that misses an arm is refused",
    compiles: false,
    why: "the anti-vacuity half, KEPT WITH ITS LIMIT STATED rather than credited with more than it " +
      "does. It fires only if the union is a strict SUBSET of the seven values it lists — i.e. if a " +
      "member were dropped — and both attempts to build that state produced a program-wide TS2322 " +
      "cascade first, because `src/internal/locale.js` still PRODUCES `wildcard` at runtime. Worse, " +
      "in both attempts it reported `ok`: a must-be-refused probe cannot tell `tsc` refusing it for " +
      "the reason it names from `tsc` refusing the whole program for an unrelated one, which is this " +
      "project's own crash-reads-as-a-result shape inside an anti-vacuity arm. It stays because the " +
      "proposition is real and cheap; it is not evidence that the narrowing holds",
    source: `import type { LocaleMatchType } from ${core};
const exhaust = (value: never): never => value;
export function describe(type: LocaleMatchType): string {
  switch (type) {
    case "none": case "exact": case "canonical": case "cldr-fallback":
    case "likely-subtag": case "extended-range": case "primary-language":
      return type;
    default:
      return exhaust(type);
  }
}`,
  },
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
  // **ALL NINE ERROR CLASSES, BOTH ARMS, GENERATED — because the hand-written probes covered two and
  // the gap was invisible.** Plan 3.5:1107-1108 requires the declarations to "expose no constructor
  // or extension signature", and M8 clause 75 was CLOSED on that in amendment A13. Measured
  // 2026-09-18 against the package's own exports map with a green control: **`new` is refused for all
  // nine, and `extends` for EIGHT.** `ExpressionEvaluationError` was the ninth until `code` was
  // threaded through the base constructor; see the table's header for the mechanism and its two
  // ablations. `LokalizedError` itself is the one remaining arm and is DELIBERATE: it emits
  // `protected constructor();` so its own eight subclasses can `super()`, which also lets a consumer
  // extend it. A13 checked `new` and did not check `extends` on the base.
  //
  // That one leaky arm is declared below rather than hidden, and the RUNTIME refuses it
  // (measured: `new Mine()` on a subclass throws "is not constructible"), so the
  // catch-only guarantee holds where it is enforced. What was missing was anything that would say so.
  ...ERROR_CLASSES.flatMap(({ name, subpath, extendsRefused }) => [
    {
      name: `${name} refuses consumer construction`,
      compiles: false,
      why: "plan 3.5:1107-1108, the half A13 did check — the token guard plus a non-public constructor",
      throughPackage: true,
      source: `import { ${name} } from "lokalized/${subpath}";\nexport const e = new ${name}("x" as never);`,
    },
    {
      name: `${name} ${extendsRefused ? "refuses" : "PERMITS (declared divergence)"} consumer subclassing`,
      compiles: !extendsRefused,
      why: extendsRefused
        ? "plan 3.5:1107-1108's 'no extension signature', emitted as `private constructor();`"
        : "DECLARED DIVERGENCE, measured rather than intended. This arm asserts the CURRENT state so " +
          "it cannot drift further unnoticed: `LokalizedError` must emit `protected constructor();` " +
          "for its own subclasses to extend it, and `ExpressionEvaluationError` emits no guard at all " +
          "despite `@private` in source. The runtime refuses both — a subclass instance throws — so " +
          "the catch-only guarantee holds at the layer that enforces it. If a later change makes " +
          "either refuse at the type level, THIS PROBE GOES RED and the divergence is retired.",
      throughPackage: true,
      source: `import { ${name} } from "lokalized/${subpath}";\nexport class Mine extends ${name} {}`,
    },
  ]),
  // THE DECLARATION HALF OF THE DEEP FREEZE, and it needs its own channel because the two halves
  // are INDEPENDENT: measured by ablation, reverting the runtime freeze leaves `npm run check` and
  // `npm run types` at exit 0, and narrowing the type would not have frozen anything. Before this,
  // `LocaleMatch` was authored TWICE — mutable in `src/core/index.js`, which is what a
  // `lokalized/core` consumer read — so the compiler told a consumer it could write to an object
  // the runtime had frozen, i.e. it turned a caught mistake into a `TypeError` in production.
  //
  // Through the package on purpose: the probe must read the EMITTED `types/core/index.d.ts` a
  // consumer resolves through `exports`, not the source. That is the distinction that produced the
  // last slice's findings.
  {
    name: "a returned LocaleMatch refuses a member write",
    compiles: false,
    why: "plan 3.4:788-796 declares every `LocaleMatchResult` member `readonly`; the runtime freezes it. " +
      "WHAT IT DOES NOT PROVE, said here so nobody credits it with more: `matchFor` is emitted with " +
      "its OWN inline `Readonly<{...}>` (tsc expands the negotiator's frozen literal), so this arm " +
      "is green even over a mutable `LocaleMatch` typedef — measured. It pins the consumer-visible " +
      "fact at this door; the arm that discriminates the TYPE is the `lokalized/core` one below.",
    throughPackage: true,
    source: `import { createLocaleNegotiator } from "lokalized/negotiate";
const n = createLocaleNegotiator({ fallbackLocale: "en", supportedLocales: ["en", "fr"] });
export function poison() { n.matchFor("fr").locale = "hijacked"; }`,
  },
  {
    name: "a returned LocaleMatch refuses a write INSIDE consideredLocales",
    compiles: false,
    why: "the defect was one level down — the record was frozen and its arrays were not",
    throughPackage: true,
    source: `import { createLocaleNegotiator } from "lokalized/negotiate";
const n = createLocaleNegotiator({ fallbackLocale: "en", supportedLocales: ["en", "fr"] });
export function poison() { n.matchFor("fr").consideredLocales.push("zz"); }`,
  },
  {
    name: "parseLanguageRanges hands back a list the caller cannot sort",
    compiles: false,
    why: "plan 3.4:900 declares it `readonly LanguageRange[]`; the port returned a mutable array",
    throughPackage: true,
    source: `import { parseLanguageRanges } from "lokalized/negotiate";
export const r = parseLanguageRanges("fr;q=0.9, en").sort();`,
  },
  {
    // THROUGH `lokalized/core`, DELIBERATELY, and an ablation is why. The three probes above reach
    // `LocaleMatch` through `lokalized/negotiate`, which resolves it from `types/internal/`; core
    // authored its OWN mutable copy of the same eight fields, so restoring that copy left all
    // three GREEN — measured. Two subpaths can disagree about one public type and a probe set that
    // enters through one of them cannot see it. That is S28's asymmetry, reproduced by my own
    // probes before this arm existed.
    name: "the LocaleMatch type lokalized/core exports refuses a write",
    compiles: false,
    why: "core published a second, mutable copy of `LocaleMatch`; it derives the one type now",
    throughPackage: true,
    // NAMING THE EXPORTED TYPE, not a call site, and the first draft of this probe taught me the
    // difference. Written as `s.getDirectLocaleContext("fr").localeMatch.locale = "x"` it stayed
    // GREEN with core's mutable copy restored, because that method's emitted signature wraps the
    // match in its own `Readonly<...>` — the call site masked the type. A consumer reaches the type
    // by ANNOTATING with it, which is the only position where the two copies differ.
    source: `import type { LocaleMatch } from "lokalized/core";
declare const m: LocaleMatch;
export function poison() { m.locale = "hijacked"; }`,
  },
  {
    name: "a language range INSIDE a returned list refuses a write",
    compiles: false,
    why: "`WeightedLanguageRange` was authored three times, mutable in all three, while the runtime " +
      "freezes every member it returns — the array was `readonly` and its elements were not",
    throughPackage: true,
    source: `import { parseLanguageRanges } from "lokalized/negotiate";
const r = parseLanguageRanges("fr;q=0.9, en");
export function poison() { r[0]!.weight = 0; }`,
  },
  {
    name: "a consumer can still BUILD a LocaleMatch and supply it",
    compiles: true,
    why: "THE CONTROL FOR THE THREE ABOVE. `LocaleMatch` is an INPUT type as well as an output, so " +
      "`readonly` members must stay assignable FROM a caller's own mutable object — without this " +
      "arm the narrowing could have been over-tightened into refusing every supplied match and all " +
      "three refusals above would still read as successes.",
    throughPackage: true,
    source: `import { createStrings, forLocaleMatch } from "lokalized/core";
const mine = { matchType: "exact" as const, locale: "fr", isMatch: true, fallbackLocale: "en",
  consideredLocales: ["en", "fr"], effectiveWeight: 1,
  languageRange: { range: "fr", weight: 1 }, requestedLanguageRanges: [{ range: "fr", weight: 1 }] };
const s = createStrings({ strings: { en: { K: "v" }, fr: { K: "v" } }, fallbackLocale: "en", locale: "en" });
export const out = s.get("K", {}, forLocaleMatch(mine));`,
  },
  {
    name: "a failure handler can read the match that caused the failure",
    compiles: true,
    throughPackage: true,
    why: "`TranslationFailure.localeMatch` was typed `unknown` until M-R S3, so every consumer writing " +
      "an `onFailure` handler had to cast before reading the match — on a record the library hands " +
      "THEM. Found by reading the requirement registry (BOOT-M0-0484), not by any gate",
    source: `import type { TranslationFailure } from "lokalized/core";
export const f = (x: TranslationFailure) => x.localeMatch.matchType;`,
  },
  {
    name: "a fallback observer can read the match",
    compiles: true,
    throughPackage: true,
    why: "the same defect on `FallbackEvent` (BOOT-M0-0499), and the sibling field on the lookup " +
      "result carried the real type all along — these two simply never got it",
    source: `import type { FallbackEvent } from "lokalized/core";
export const f = (e: FallbackEvent) => e.localeMatch.consideredLocales.length;`,
  },
  {
    name: "a failure handler cannot WRITE to the match it was handed",
    compiles: false,
    throughPackage: true,
    why: "the anti-vacuity half: typing the field `LocaleMatch` would be satisfied by a MUTABLE one, " +
      "and the record is frozen at runtime, so a consumer writing to it fails at run time with no " +
      "compile-time warning. Without this arm the two probes above pass over `any`",
    source: `import type { TranslationFailure } from "lokalized/core";
export const f = (x: TranslationFailure) => { x.localeMatch.matchType = "exact"; };`,
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

/**
 * **A SECOND PROJECT THAT RESOLVES THROUGH THE PACKAGE, because the first one is blind to the
 * artifact a consumer actually receives.** Every other probe imports an absolute `src/*.js` path and
 * compiles with `--checkJs`, so it type-checks the SOURCE and its JSDoc. A consumer imports
 * `"lokalized/core"`, which `package.json#exports` resolves to the EMITTED `types/*.d.ts`. Where the
 * two disagree, a source-path probe cannot see it — and they disagree TODAY: `@private` on
 * `ExpressionEvaluationError`'s constructor is honoured from source and DROPPED from the emitted
 * declaration, so `class Mine extends ExpressionEvaluationError {}` is refused through the source and
 * COMPILES through the package. Measured both ways with a green control.
 *
 * S29's lesson one level up — a declaration is a separate artifact from the behaviour, and here it is
 * a separate artifact from its own source as well.
 */
const packageProject = join(directory, "consumer");
mkdirSync(join(packageProject, "node_modules"), { recursive: true });
symlinkSync(root, join(packageProject, "node_modules", "lokalized"), "dir");
writeFileSync(join(packageProject, "package.json"), JSON.stringify({ name: "probe", type: "module" }), "utf8");

let failures = 0;
try {
  for (const probe of PROBES) {
    const home = probe.throughPackage ? packageProject : directory;
    const file = join(home, `${probe.name.replace(/\W+/g, "-")}.ts`);
    writeFileSync(file, `${probe.source}\n`, "utf8");
    let compiled = true;
    let output = "";
    try {
      execFileSync(process.execPath, [
        join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--allowJs", "--checkJs",
        "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022",
        "--skipLibCheck", file,
        // **cwd STAYS `root` FOR SOURCE PROBES.** Pointing every probe at its own directory reds a
        // pre-existing one ("a record from the NODE whole-manifest loader flows into construction"),
        // because those import absolute `src/*.js` paths whose own resolution is relative to the
        // repository. Only the package-resolving probes need the consumer project as cwd.
      ], { cwd: probe.throughPackage ? packageProject : root, encoding: "utf8", stdio: "pipe" });
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
