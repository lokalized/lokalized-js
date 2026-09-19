#!/usr/bin/env node
// @ts-check
/**
 * THE REQUIREMENT REGISTRY'S `readonly` STATEMENTS, ASKED OF THE PACKAGE A CONSUMER INSTALLS.
 *
 * `lokalized-spec/pre-m0/bootstrap.requirements.candidate.json` states 179 times that some member,
 * parameter or return value is `readonly`. Nothing had ever compared one of them to what the library
 * ships. M-R S2 read them by hand and found roughly forty contradicted; this tool derives the
 * comparison instead, so the answer moves when either side does.
 *
 * **IT ASKS BY COMPILING, NOT BY PARSING.** The first attempt walked the emitted `.d.ts` with the
 * TypeScript AST and reported 38 contradictions and 56 members it could not find — and the 56 were
 * its own blindness: a member inside `Readonly<{…}>`, behind a `ReturnType<>`, or reached through an
 * `export type X = import("…").Y` alias is readonly to a consumer and invisible to a syntactic walk.
 * A probe that WRITES to the member and requires `tsc` to refuse it delegates all of that to the
 * checker, which is the same component the consumer's editor runs.
 *
 * **EVERY PROBE CARRIES A READ CONTROL, and that is the `zh-123` guard this project keeps paying
 * for.** A write refused because the type does not exist, or because the member is misspelled, looks
 * exactly like a write refused because the member is `readonly`. So each obligation emits two lines:
 * a READ that must compile and a WRITE that must be refused with a declared diagnostic code. A read
 * that fails is reported UNVERIFIABLE — never as satisfied — and a write refused with an unexpected
 * code is a failure, not a pass.
 *
 * **IT RESOLVES THROUGH `package.json#exports`**, on M-R S2's finding: every probe in
 * `npm run declarations` used to import an absolute `src/*.js` path and type-check the SOURCE, while
 * a consumer gets the emitted `types/*.d.ts`. The two disagree today, and where they do, a
 * source-resolving probe is blind. A registry statement is about what the package declares.
 *
 * **AN UNACCOUNTED STATEMENT FAILS THE RUN.** A `readonly` statement must be member-shaped with its
 * owner in REACH, or carry an entry in OBLIGATIONS, or be declared UNREACHABLE with a reason. There
 * is no fourth outcome and nothing is skipped: a gate that quietly passes over the statements it
 * cannot read has stopped gating, which is this repository's oldest recorded lesson about its own
 * instruments.
 *
 * **WHAT IT CANNOT SEE, MEASURED RATHER THAN GUESSED AT.** A reach aimed at a type that is wrong but
 * PLAUSIBLE — one carrying readonly members of the same names — is not caught for the members the
 * two types share. Ablated: pointing `TranslationResultBase` at `TranslationFailure` and unwrapping
 * the record reds three of its seven statements, the three naming members `TranslationFailure` does
 * not have, and passes the other four against the wrong type. The `DELIVERED` spelling check below
 * removes that possibility for the thirty owners the package publishes under the registry's own
 * name; the RENAMED and STRUCTURAL entries each state a reason and are the residue.
 *
 * **IT READS `types/`, SO IT IS ONLY AS FRESH AS THE LAST `npm run types`.** `verify` emits
 * declarations before it runs, which is why this sits after `declarations` there; run on its own
 * after a source edit, it is answering about the previous build. Ablating this gate means editing
 * `src/` AND regenerating.
 *
 * **AND `npm run types` EMITS EVEN WHEN IT EXITS 2, so this gate can go green over a library that
 * does not compile.** Measured by a reviewer mid-sweep: a narrowed parameter left
 * `types/parse/index.d.ts` carrying the new signature and this tool scoring the statement satisfied
 * while `npm run check` was red on the source that produced it. `verify` runs `check` FIRST and is
 * therefore safe; anyone running this command alone has to read `npm run check`'s status too, and a
 * green run here is a statement about the declarations, never about the source.
 *
 *   node tools/readonly-surface.mjs [--keep] [--list]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR)
  : resolve(root, "../lokalized-spec");
const registryPath = join(specDir, "pre-m0/bootstrap.requirements.candidate.json");

let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, "utf8"));
} catch {
  console.error(`readonly-surface: cannot read the requirement registry at ${registryPath}.`);
  console.error(`This tool compares the registry's \`readonly\` statements against the package's own`);
  console.error(`declarations, so without it there is nothing to compare and the run has NOT passed.`);
  console.error(`Clone lokalized-spec beside this repository, or set LOKALIZED_SPEC_DIR.`);
  process.exit(2);
}

/**
 * The statements this tool is about. Keyed on the word `readonly` appearing in the requirement,
 * which is how the registry spells every one of them.
 */
const STATEMENTS = registry.requirements.filter((r) => /readonly/i.test(r.statement));

/**
 * `X` declares/carries/accepts/requires a [required|optional] readonly `m` …
 *
 * Deliberately anchored at the start: a statement whose subject is prose ("The `range` member …",
 * "Each expression-fragment alternative …") is NOT member-shaped and must be declared in
 * OBLIGATIONS, because guessing what those subjects refer to is exactly the authoring mistake this
 * project has recorded turning into a plausible observation.
 */
const MEMBER_RE =
  /^`([A-Za-z][\w.<>]*)`\s+(?:declares|carries|accepts|requires)\s+(?:a|an)\s+(required\s+|optional\s+)?readonly\s+`([A-Za-z_$][\w$]*)`/;

/**
 * HOW A CONSUMER NAMES EACH REGISTRY TYPE.
 *
 * The registry speaks the plan's vocabulary; the package delivers its own. `test/plan-surface.test.js`
 * already carries that mapping for the SYMBOL surface with falsifiable dispositions, and this is the
 * same idea one level down. Three dispositions, each checkable:
 *
 * - `DELIVERED` — the package exports the name the registry uses.
 * - `RENAMED` / `STRUCTURAL` — it exports a different spelling, or the shape is reached through a
 *   value rather than a name. The `type` expression is what a consumer would actually write.
 * - `UNREACHABLE` — no consumer can name it, with the reason. These run no probe, so each one costs
 *   an assertion below that the name really is absent from every subpath.
 *
 * `types` is a LIST because two subpaths may publish the same public name and disagree about it —
 * S28 measured exactly that asymmetry, and M-R S3's own probe set was green over a mutable copy of
 * `LocaleMatch` in core until an arm entered through the other subpath. Every listed reach must
 * satisfy the statement.
 */
const REACH = {
  CardinalRangeData: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["CardinalRangeData"], type: "CardinalRangeData" }] },
  CatalogIdentity: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["CatalogIdentity"], type: "CatalogIdentity" }] },
  "CatchOnlyErrorClass<T>": {
    disposition: "UNREACHABLE",
    absentName: "CatchOnlyErrorClass",
    why: "plan 3.5:1109 draws the export boundary INSIDE its own declaration block: `CatchOnlyErrorClass` " +
      "is 'a declaration-private helper, not a package export'. Amendment A13 then declined the alias " +
      "entirely in favour of TypeScript's own `@private`/`@protected` constructor idiom, so the port " +
      "has no such type at all and a consumer has nothing to write. The statement is about a helper " +
      "the plan itself refuses to publish",
  },
  CreateStringsBehaviorOptions: {
    disposition: "STRUCTURAL",
    why: "plan 3.2's behaviour options are FLATTENED into both arms of `CreateStringsOptions` rather " +
      "than published as their own type — S30's plan-surface table already records that disposition. " +
      "Both arms are probed, because a member readonly in one and mutable in the other is a real " +
      "asymmetry and one arm would not see it",
    types: [
      { from: "lokalized/core", imports: ["DirectCreateStringsOptions"], type: "DirectCreateStringsOptions" },
      { from: "lokalized/core", imports: ["LoadedCreateStringsOptions"], type: "LoadedCreateStringsOptions" },
    ],
  },
  DecimalValue: {
    disposition: "STRUCTURAL",
    why: "the tagged value `decimal()` returns; the port declares its shape inline on the function's " +
      "return type rather than as a named export, so a consumer names it through the function",
    types: [{ from: "lokalized", valueImports: ["decimal"], type: "ReturnType<typeof decimal>" }],
  },
  DirectCreateStringsOptions: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["DirectCreateStringsOptions"], type: "DirectCreateStringsOptions" }] },
  DirectLocaleContext: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["DirectLocaleContext"], type: "DirectLocaleContext" }] },
  ExpressionTranslationInput: {
    disposition: "RENAMED",
    portName: "PlaceholderDefinitionInput",
    why: "the registry names the two arms of a placeholder definition separately; the port publishes " +
      "the union as `PlaceholderDefinitionInput` on `lokalized/parse`. The expression arm is selected " +
      "by its own discriminant so the probe reaches that arm and not the other",
    types: [{ from: "lokalized/parse", imports: ["PlaceholderDefinitionInput"], type: `Extract<PlaceholderDefinitionInput, { kind: "expression" }>` }],
  },
  FallbackEvent: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["FallbackEvent"], type: "FallbackEvent" }] },
  LanguageFormTranslationInput: {
    disposition: "RENAMED",
    portName: "PlaceholderDefinitionInput",
    why: "the language-form arm of the same published union",
    types: [{ from: "lokalized/parse", imports: ["PlaceholderDefinitionInput"], type: `Extract<PlaceholderDefinitionInput, { kind: "language-form" }>` }],
  },
  LanguageRange: {
    disposition: "DELIVERED",
    types: [
      { from: "lokalized/core", imports: ["LanguageRange"], type: "LanguageRange" },
      { from: "lokalized/negotiate", imports: ["LanguageRange"], type: "LanguageRange" },
    ],
  },
  LocaleConfiguration: {
    disposition: "DELIVERED",
    types: [
      { from: "lokalized/core", imports: ["LocaleConfiguration"], type: "LocaleConfiguration" },
      { from: "lokalized/negotiate", imports: ["LocaleConfiguration"], type: "LocaleConfiguration" },
    ],
  },
  LocaleMatchResult: {
    disposition: "RENAMED",
    portName: "LocaleMatch",
    why: "plan 3.4 calls the record `LocaleMatchResult`; the port publishes it as `LocaleMatch`, which " +
      "S30's plan-surface table records as a RENAMED disposition whose port spelling must exist",
    types: [
      { from: "lokalized/core", imports: ["LocaleMatch"], type: "LocaleMatch" },
      { from: "lokalized/negotiate", valueImports: ["createLocaleNegotiator"], type: `ReturnType<typeof createLocaleNegotiator>["matchFor"] extends (...a: never[]) => infer R ? R : never` },
    ],
  },
  LocalizedStringInput: { disposition: "DELIVERED", types: [{ from: "lokalized/parse", imports: ["LocalizedStringInput"], type: "LocalizedStringInput" }] },
  LocalizedStringNodeInput: { disposition: "DELIVERED", types: [{ from: "lokalized/parse", imports: ["LocalizedStringNodeInput"], type: "LocalizedStringNodeInput" }] },
  LocalizedStringWarning: {
    disposition: "DELIVERED",
    types: [
      { from: "lokalized/core", imports: ["LocalizedStringWarning"], type: "LocalizedStringWarning" },
      { from: "lokalized/parse", imports: ["LocalizedStringWarning"], type: "LocalizedStringWarning" },
      { from: "lokalized/load", imports: ["LocalizedStringWarning"], type: "LocalizedStringWarning" },
    ],
  },
  LokalizedError: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["LokalizedError"], type: "LokalizedError" }] },
  LoadedCreateStringsOptions: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["LoadedCreateStringsOptions"], type: "LoadedCreateStringsOptions" }] },
  MissingTranslationError: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["MissingTranslationError"], type: "MissingTranslationError" }] },
  OrdinalData: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["OrdinalData"], type: "OrdinalData" }] },
  ParseStringsOptions: { disposition: "DELIVERED", types: [{ from: "lokalized/parse", imports: ["ParseStringsOptions"], type: "ParseStringsOptions" }] },
  ParsedStringsFile: {
    disposition: "DELIVERED",
    types: [
      { from: "lokalized/parse", imports: ["ParsedStringsFile"], type: "ParsedStringsFile" },
      { from: "lokalized/load", imports: ["ParsedStringsFile"], type: "ParsedStringsFile" },
    ],
  },
  PluralOperandValue: {
    disposition: "STRUCTURAL",
    why: "the tagged value `pluralOperands()` returns, declared inline on its return type",
    types: [{ from: "lokalized", valueImports: ["pluralOperands"], type: "ReturnType<typeof pluralOperands>" }],
  },
  ResolutionError: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["ResolutionError"], type: "ResolutionError" }] },
  ReturnKeyResponse: {
    disposition: "STRUCTURAL",
    why: "an arm of the published `FailureResponse` union, reached through the constant the library " +
      "exports for it",
    types: [{ from: "lokalized/core", valueImports: ["RETURN_KEY"], type: "typeof RETURN_KEY" }],
  },
  ReturnStringResponse: {
    disposition: "STRUCTURAL",
    why: "the arm `returnString()` builds",
    types: [{ from: "lokalized/core", valueImports: ["returnString"], type: "ReturnType<typeof returnString>" }],
  },
  StringsLoadVerification: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["StringsLoadVerification"], type: "StringsLoadVerification" }] },
  StringsLoadingError: { disposition: "DELIVERED", types: [{ from: "lokalized/load", imports: ["StringsLoadingError"], type: "StringsLoadingError" }] },
  StringsLoadingLimits: {
    disposition: "DELIVERED",
    types: [
      { from: "lokalized/parse", imports: ["StringsLoadingLimits"], type: "StringsLoadingLimits" },
      { from: "lokalized/load", imports: ["StringsLoadingLimits"], type: "StringsLoadingLimits" },
    ],
  },
  StringsParseError: { disposition: "DELIVERED", types: [{ from: "lokalized/parse", imports: ["StringsParseError"], type: "StringsParseError" }] },
  TaggedLanguageFormValue: {
    disposition: "DELIVERED",
    types: [
      { from: "lokalized", imports: ["TaggedLanguageFormValue"], type: `TaggedLanguageFormValue<"gender", "GENDER_FEMININE">` },
      { from: "lokalized/core", imports: ["TaggedLanguageFormValue"], type: `TaggedLanguageFormValue<"gender", "GENDER_FEMININE">` },
    ],
  },
  ThrowResponse: {
    disposition: "STRUCTURAL",
    why: "the arm the exported `THROW_EXCEPTION` constant inhabits",
    types: [{ from: "lokalized/core", valueImports: ["THROW_EXCEPTION"], type: "typeof THROW_EXCEPTION" }],
  },
  TranslationBehaviorOptions: {
    disposition: "STRUCTURAL",
    why: "flattened into the published `TranslationCallOptions`, exactly as the construction-time " +
      "behaviour options are flattened into `CreateStringsOptions`",
    types: [{ from: "lokalized/core", imports: ["TranslationCallOptions"], type: "TranslationCallOptions" }],
  },
  TranslationFailure: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["TranslationFailure"], type: "TranslationFailure" }] },
  TranslationResultBase: {
    disposition: "STRUCTURAL",
    why: "the port publishes no base type; the shape is what `Strings.getResult()` returns, which is " +
      "how a consumer meets it",
    types: [{ from: "lokalized/core", imports: ["Strings"], type: `ReturnType<Strings["getResult"]>` }],
  },
  UnsupportedLocaleError: { disposition: "DELIVERED", types: [{ from: "lokalized/core", imports: ["UnsupportedLocaleError"], type: "UnsupportedLocaleError" }] },
  WholeMessageAlternativeInput: { disposition: "DELIVERED", types: [{ from: "lokalized/parse", imports: ["WholeMessageAlternativeInput"], type: "WholeMessageAlternativeInput" }] },
  pluralData: {
    disposition: "STRUCTURAL",
    why: "a nested option object with no name of its own; a consumer reaches it by indexing the " +
      "option type that carries it",
    types: [{ from: "lokalized/core", imports: ["DirectCreateStringsOptions"], type: `NonNullable<DirectCreateStringsOptions["pluralData"]>` }],
  },
};


/**
 * THE STATEMENTS THAT ARE NOT MEMBER-SHAPED — 44 of the 179, each with its own probe.
 *
 * They say four different things and each needs a different question put to the compiler:
 *
 * - a function RETURNS a readonly array → writing through an index must be refused;
 * - a function RETURNS `Readonly<T>` → writing a member must be refused;
 * - a parameter or option TAKES a readonly value → passing one must COMPILE, and the companion
 *   wrong-typed arm must be refused, or the obligation is satisfied by a parameter typed `any`;
 * - a nested subject the registry names in prose ("the `range` member", "each expression-fragment
 *   alternative") → the same member probe, reached through an expression rather than a name.
 *
 * `codes` is the diagnostic a refusal must carry. A write refused for the wrong reason — a
 * misspelled member, a type that does not exist — is the `zh-123` shape, and without the code it
 * reads exactly like a refusal earned by `readonly`.
 */
const IMPORTS = {
  root: { from: "lokalized" },
  core: { from: "lokalized/core" },
  parse: { from: "lokalized/parse" },
  load: { from: "lokalized/load" },
  negotiate: { from: "lokalized/negotiate" },
  ordinal: { from: "lokalized/data/ordinal" },
};

/**
 * A readonly array RETURN: reading `x[0]` must compile, `x[0] = …` must be refused with TS2542, and
 * the value must actually BE an array.
 *
 * **THE THIRD LINE EXISTS BECAUSE THE FIRST TWO ARE SATISFIED BY A `string`.** An adversarial pass
 * measured it: retyping `getSupportedLocales` to return `string` rather than `readonly string[]`
 * left this gate byte-identical and silent, because a string has a read-only index signature and so
 * both accepts `x[0]` and refuses `x[0] = …` with the very code the probe takes as proof. The
 * statement says "returns a readonly array", and two thirds of it was being checked.
 */
const readonlyReturn = (why, imports, expr) => ({
  why,
  imports,
  lines: [
    { text: `export const read = (${expr})[0];`, expect: "compiles" },
    { text: `export const isArray: readonly unknown[] = ${expr};`, expect: "compiles",
      note: "the value is not an array at all, so a refused index write proves nothing about it" },
    { text: `export function write(): void { (${expr})[0] = (${expr})[0]!; }`, expect: "refused", codes: [2542] },
  ],
});

/** A `Readonly<T>` RETURN or constant: writing `member` is refused with TS2540. */
const readonlyMemberOf = (why, imports, expr, member) => ({
  why,
  imports,
  lines: [
    { text: `export const read = (${expr}).${member};`, expect: "compiles" },
    { text: `export function write(): void { const t = ${expr}; t.${member} = t.${member}; }`, expect: "refused", codes: [2540] },
  ],
});

/**
 * A parameter that must ACCEPT a readonly value. The second line is the anti-vacuity arm: without it
 * a parameter typed `any` satisfies the requirement, which is the defect this project has found in
 * its own gates more than once.
 */
const acceptsReadonly = (why, imports, accepted, refusedCall, writeThrough) => ({
  why,
  imports,
  lines: [
    { text: `export const read = ${accepted};`, expect: "compiles" },
    { text: `export const notAny = ${refusedCall};`, expect: "refused", codes: [2345, 2322, 2769] },
    // **THE ACCEPT DIRECTION CANNOT SEE `readonly` ON A RECORD'S MEMBERS, and that is a fact about
    // TypeScript rather than about this probe.** Property-level `readonly` does not affect
    // assignability, so a parameter typed `Record<string, unknown>` accepts a
    // `Readonly<Record<string, unknown>>` argument and the first line above passes over a fully
    // mutable declaration. Measured by an adversarial pass, which found two statements reported
    // SATISFIED over a record a consumer could write to. Where the statement is about a RECORD
    // rather than a container, the caller supplies an expression that writes through it, and that
    // write must be refused.
    ...(writeThrough
      ? [{ text: `export function writeThrough(): void { ${writeThrough} }`, expect: "refused", codes: [2542, 2540] }]
      : []),
  ],
});

const OBLIGATIONS = {
  "BOOT-M0-0275": readonlyMemberOf(
    "the `lookup` arm of the published `StringsLoadCoverage` union, selected by its discriminant",
    [IMPORTS.core], `null! as Extract<import("lokalized/core").StringsLoadCoverage, { kind: "lookup" }>`, "lookupLocale"),
  "BOOT-M0-0299": acceptsReadonly(
    "`Placeholders` as a readonly record — the values a caller passes to `get`",
    [IMPORTS.core],
    `((p: import("lokalized/core").Placeholders) => p)(null! as Readonly<Record<string, unknown>>)`,
    `((p: import("lokalized/core").Placeholders) => p)(null! as readonly unknown[] & { length: 3 })`,
    `const r = null! as Extract<import("lokalized/core").Placeholders, Record<string, unknown>>; r["k"] = 1;`),
  "BOOT-M0-0300": acceptsReadonly(
    "`Placeholders` as a `ReadonlyMap`",
    [IMPORTS.core],
    `((p: import("lokalized/core").Placeholders) => p)(null! as ReadonlyMap<string, unknown>)`,
    `((p: import("lokalized/core").Placeholders) => p)(null! as ReadonlySet<string>)`),
  "BOOT-M0-0310": acceptsReadonly(
    "a catalog supplied as a readonly array of inputs",
    [IMPORTS.core, IMPORTS.parse],
    `((c: import("lokalized/core").DirectCreateStringsOptions["strings"]) => c)(null! as Readonly<Record<string, readonly import("lokalized/parse").LocalizedStringInput[]>>)`,
    `((c: import("lokalized/core").DirectCreateStringsOptions["strings"]) => c)(null! as readonly string[])`,
    `const r = null! as Extract<import("lokalized/core").DirectCreateStringsOptions["strings"], Record<string, unknown>>; r["en"] = [];`),
  "BOOT-M0-0311": acceptsReadonly(
    "`CatalogMap` as a readonly record keyed by tag",
    [IMPORTS.core],
    `((c: import("lokalized/core").DirectCreateStringsOptions["strings"]) => c)(null! as Readonly<Record<string, unknown>>)`,
    `((c: import("lokalized/core").DirectCreateStringsOptions["strings"]) => c)(null! as number)`,
    `const r = null! as Extract<import("lokalized/core").DirectCreateStringsOptions["strings"], Record<string, unknown>>; r["en"] = {};`),
  "BOOT-M0-0312": acceptsReadonly(
    "`CatalogMap` as a `ReadonlyMap`",
    [IMPORTS.core],
    `((c: import("lokalized/core").DirectCreateStringsOptions["strings"]) => c)(null! as ReadonlyMap<string, unknown>)`,
    `((c: import("lokalized/core").DirectCreateStringsOptions["strings"]) => c)(null! as ReadonlySet<string>)`),
  "BOOT-M0-0313": acceptsReadonly(
    "`TiebreakerMap` as a readonly record of readonly tag arrays",
    [IMPORTS.core],
    `((t: import("lokalized/core").DirectCreateStringsOptions["tiebreakers"]) => t)(null! as Readonly<Record<string, readonly string[]>>)`,
    `((t: import("lokalized/core").DirectCreateStringsOptions["tiebreakers"]) => t)(null! as readonly string[])`,
    `const r = null! as Extract<NonNullable<import("lokalized/core").DirectCreateStringsOptions["tiebreakers"]>, Record<string, readonly string[]>>; r["fr"] = [];`),
  "BOOT-M0-0314": acceptsReadonly(
    "`TiebreakerMap` as a `ReadonlyMap`",
    [IMPORTS.core],
    `((t: import("lokalized/core").DirectCreateStringsOptions["tiebreakers"]) => t)(null! as ReadonlyMap<string, readonly string[]>)`,
    `((t: import("lokalized/core").DirectCreateStringsOptions["tiebreakers"]) => t)(null! as ReadonlyMap<string, number>)`),
  "BOOT-M0-0326": readonlyMemberOf(
    "the ambient-locale variant of plan 3.2's `LocaleSourceOptions`, flattened onto the option type",
    [IMPORTS.core], `null! as import("lokalized/core").DirectCreateStringsOptions`, "locale"),
  "BOOT-M0-0330": readonlyMemberOf(
    "the resolver variant of the same union",
    [IMPORTS.core], `null! as import("lokalized/core").DirectCreateStringsOptions`, "localeResolver"),
  "BOOT-M0-0334": readonlyMemberOf(
    "the match-resolver variant of the same union",
    [IMPORTS.core], `null! as import("lokalized/core").DirectCreateStringsOptions`, "localeMatchResolver"),
  "BOOT-M0-0375": readonlyMemberOf("`forLocale` returns `Readonly<TranslationOptions>`", [IMPORTS.core], `forLocale("fr")`, "locale"),
  "BOOT-M0-0376": readonlyMemberOf("`forLocaleMatch` returns `Readonly<TranslationOptions>`", [IMPORTS.core], `forLocaleMatch(null! as import("lokalized/core").LocaleMatch)`, "localeMatch"),
  "BOOT-M0-0390": readonlyReturn("`getSupportedLocales` returns a readonly array", [IMPORTS.core], `(null! as import("lokalized/core").Strings).getSupportedLocales()`),
  "BOOT-M0-0391": readonlyReturn("`getKeysForLocale` returns a readonly array", [IMPORTS.core], `(null! as import("lokalized/core").Strings).getKeysForLocale("en")`),
  "BOOT-M0-0394": readonlyReturn("`getMissingKeys` returns a readonly array", [IMPORTS.core], `(null! as import("lokalized/core").Strings).getMissingKeys("en", "fr")`),
  "BOOT-M0-0399": readonlyReturn("`getWarnings` returns a readonly array", [IMPORTS.core], `(null! as import("lokalized/core").Strings).getWarnings()`),
  "BOOT-M0-0447": acceptsReadonly(
    "`matchForLanguageRanges` takes a readonly array of ranges",
    [IMPORTS.negotiate],
    `(null! as import("lokalized/negotiate").LocaleNegotiator).matchForLanguageRanges(null! as readonly import("lokalized/negotiate").LanguageRange[])`,
    `(null! as import("lokalized/negotiate").LocaleNegotiator).matchForLanguageRanges(null! as readonly number[])`),
  "BOOT-M0-0449": acceptsReadonly(
    "`bestMatchForLanguageRanges` takes a readonly array of ranges",
    [IMPORTS.negotiate],
    `(null! as import("lokalized/negotiate").LocaleNegotiator).bestMatchForLanguageRanges(null! as readonly import("lokalized/negotiate").LanguageRange[])`,
    `(null! as import("lokalized/negotiate").LocaleNegotiator).bestMatchForLanguageRanges(null! as readonly number[])`),
  "BOOT-M0-0453": readonlyReturn("`parseLanguageRanges` returns `readonly LanguageRange[]`", [IMPORTS.negotiate], `parseLanguageRanges("fr;q=0.9, en")`),
  "BOOT-M0-0457": acceptsReadonly(
    "`forLanguageRanges` takes a `readonly LanguageRange[]` second parameter",
    [IMPORTS.negotiate, IMPORTS.core],
    `forLanguageRanges(null! as import("lokalized/negotiate").LocaleNegotiator, null! as readonly import("lokalized/negotiate").LanguageRange[])`,
    `forLanguageRanges(null! as import("lokalized/negotiate").LocaleNegotiator, null! as readonly number[])`),
  "BOOT-M0-0458": readonlyMemberOf("`forLanguageRanges` returns `Readonly<TranslationOptions>`", [IMPORTS.negotiate, IMPORTS.core],
    `forLanguageRanges(null! as import("lokalized/negotiate").LocaleNegotiator, [])`, "localeMatch"),
  "BOOT-M0-0461": readonlyMemberOf("`forAcceptLanguage` returns `Readonly<TranslationOptions>`", [IMPORTS.negotiate, IMPORTS.core],
    `forAcceptLanguage(null! as import("lokalized/negotiate").LocaleNegotiator, "fr")`, "localeMatch"),
  "BOOT-M0-0467": acceptsReadonly(
    "`chooseLocaleForPreferredLanguages` takes a `readonly string[]`",
    [IMPORTS.core],
    `chooseLocaleForPreferredLanguages(null! as import("lokalized/core").LocaleConfiguration, null! as readonly string[])`,
    `chooseLocaleForPreferredLanguages(null! as import("lokalized/core").LocaleConfiguration, null! as readonly number[])`),
  "BOOT-M0-0479": readonlyMemberOf("`RETURN_KEY` is typed `Readonly<ReturnKeyResponse>`", [IMPORTS.core], `RETURN_KEY`, "action"),
  "BOOT-M0-0480": readonlyMemberOf("`THROW_EXCEPTION` is typed `Readonly<ThrowResponse>`", [IMPORTS.core], `THROW_EXCEPTION`, "action"),
  "BOOT-M0-0481": readonlyMemberOf("`returnString` returns `Readonly<ReturnStringResponse>`", [IMPORTS.core], `returnString("x")`, "translation"),
  "BOOT-M0-0562": acceptsReadonly(
    "a node's `placeholders` accepts a readonly record",
    [IMPORTS.parse],
    `((n: import("lokalized/parse").LocalizedStringInput["placeholders"]) => n)(null! as Readonly<Record<string, import("lokalized/parse").PlaceholderDefinitionInput>>)`,
    `((n: import("lokalized/parse").LocalizedStringInput["placeholders"]) => n)(null! as readonly string[])`,
    `const r = null! as NonNullable<import("lokalized/parse").LocalizedStringInput["placeholders"]>; r["p"] = null!;`),
  "BOOT-M0-0563": {
    why: "`placeholders` as a `ReadonlyMap`. **DECLARED CONTRADICTED AND NOT FIXED**, with the reason " +
      "measured: the authored strings-file vocabulary is JSON, so a placeholder map arrives as an " +
      "object and the port types the member as a readonly record alone. Accepting a `ReadonlyMap` " +
      "here would widen an INPUT type that `parseStrings` builds from JSON and `mergeParsedStringsFiles` " +
      "compares structurally — measured against Java in M9 S3, where map ORDER is not part of equality " +
      "but the container is. It is a plan question rather than a sweep",
    contradicted: true,
    imports: [IMPORTS.parse],
    lines: [
      { text: `export const read = ((n: import("lokalized/parse").LocalizedStringInput["placeholders"]) => n)(null! as Readonly<Record<string, import("lokalized/parse").PlaceholderDefinitionInput>>);`, expect: "compiles" },
      { text: `export const map = ((n: import("lokalized/parse").LocalizedStringInput["placeholders"]) => n)(null! as ReadonlyMap<string, import("lokalized/parse").PlaceholderDefinitionInput>);`, expect: "refused", codes: [2345, 2322, 2769] },
    ],
  },
  "BOOT-M0-0574": readonlyMemberOf("the `range` member of a language-form placeholder input", [IMPORTS.parse],
    `null! as NonNullable<Extract<import("lokalized/parse").PlaceholderDefinitionInput, { kind: "language-form" }>["range"]>`, "start"),
  "BOOT-M0-0575": readonlyMemberOf("the same `range` member's end", [IMPORTS.parse],
    `null! as NonNullable<Extract<import("lokalized/parse").PlaceholderDefinitionInput, { kind: "language-form" }>["range"]>`, "end"),
  "BOOT-M0-0580": readonlyMemberOf("an expression-fragment alternative's expression", [IMPORTS.parse],
    `null! as NonNullable<Extract<import("lokalized/parse").PlaceholderDefinitionInput, { kind: "expression" }>["alternatives"]>[number]`, "expression"),
  "BOOT-M0-0581": readonlyMemberOf("an expression-fragment alternative's translation", [IMPORTS.parse],
    `null! as NonNullable<Extract<import("lokalized/parse").PlaceholderDefinitionInput, { kind: "expression" }>["alternatives"]>[number]`, "translation"),
  "BOOT-M0-0583": readonlyMemberOf("`defineLocalizedString` returns `Readonly<LocalizedStringInput>`", [IMPORTS.parse],
    `defineLocalizedString({ key: "K", translation: "v" })`, "key"),
  "BOOT-M0-0584": acceptsReadonly(
    "`defineCatalog` takes a `readonly LocalizedStringInput[]`",
    [IMPORTS.parse],
    `defineCatalog(null! as readonly import("lokalized/parse").LocalizedStringInput[])`,
    `defineCatalog(null! as readonly number[])`),
  "BOOT-M0-0585": readonlyReturn("`defineCatalog` returns a readonly array", [IMPORTS.parse], `defineCatalog([{ key: "K", translation: "v" }])`),
  "BOOT-M0-0595": readonlyMemberOf("the `pluralOperands` options object", [IMPORTS.root],
    `null! as NonNullable<Parameters<typeof pluralOperands>[1]>`, "visibleDecimalPlaces"),
  "BOOT-M0-0596": readonlyMemberOf("the same options object's compact exponent", [IMPORTS.root],
    `null! as NonNullable<Parameters<typeof pluralOperands>[1]>`, "compactExponent"),
  "BOOT-M0-0694": readonlyReturn("`supportedCardinalitiesForLocale` returns a readonly array", [IMPORTS.root], `supportedCardinalitiesForLocale("fr")`),
  "BOOT-M0-0695": readonlyReturn("`getSupportedCardinalityLocaleTags` returns a readonly array", [IMPORTS.root], `getSupportedCardinalityLocaleTags()`),
  "BOOT-M0-0700": readonlyReturn("`supportedOrdinalitiesForLocale` returns a readonly array", [IMPORTS.ordinal], `supportedOrdinalitiesForLocale("fr")`),
  "BOOT-M0-0701": readonlyReturn("`getSupportedOrdinalityLocaleTags` returns a readonly array", [IMPORTS.ordinal], `getSupportedOrdinalityLocaleTags()`),
  "BOOT-M0-0728": acceptsReadonly(
    "`mergeParsedStringsFiles` takes a `readonly ParsedStringsFile[]`",
    [IMPORTS.parse],
    `mergeParsedStringsFiles(null! as readonly import("lokalized/parse").ParsedStringsFile[])`,
    `mergeParsedStringsFiles(null! as readonly number[])`),
  "BOOT-M0-0729": readonlyMemberOf("that call's options object carries a readonly `limits`", [IMPORTS.parse],
    `null! as NonNullable<Parameters<typeof mergeParsedStringsFiles>[1]>`, "limits"),
};

/** The value and type imports each subpath contributes, collected from the tables above. */
const VALUE_IMPORTS = {
  lokalized: ["decimal", "pluralOperands", "supportedCardinalitiesForLocale", "getSupportedCardinalityLocaleTags"],
  "lokalized/core": ["forLocale", "forLocaleMatch", "RETURN_KEY", "THROW_EXCEPTION", "returnString",
    "chooseLocaleForPreferredLanguages"],
  "lokalized/parse": ["defineLocalizedString", "defineCatalog", "mergeParsedStringsFiles"],
  "lokalized/negotiate": ["parseLanguageRanges", "forLanguageRanges", "forAcceptLanguage", "createLocaleNegotiator"],
  "lokalized/data/ordinal": ["supportedOrdinalitiesForLocale", "getSupportedOrdinalityLocaleTags"],
};

/**
 * STATEMENTS THE PACKAGE DELIBERATELY DOES NOT SATISFY, each with a reason and each CHECKED IN THE
 * OPPOSITE DIRECTION.
 *
 * `DECLARED_MESSAGE_DIVERGENCES` in `tools/conformance.mjs` is the precedent: a declaration is not a
 * relaxation, because the entry asserts the divergence still EXISTS. Here the write probe is inverted
 * — it must COMPILE — so the day the member becomes `readonly` this entry fails and has to be deleted.
 * A table of excuses that cannot go stale is the failure mode this repository has recorded three times.
 */
const DECLARED_CONTRADICTIONS = {
  "BOOT-M0-0524": { half: "optionality", why:
    "`ResolutionError.thrownValue` is ABSENT at run time on every error but the nullish leaf — plan " +
    "3.5:1136-1140 makes `\"thrownValue\" in error` the discriminator and `src/internal/resolution-error.js` " +
    "assigns the field only on that leaf, which `test/resolution-error.test.js` gates. The DECLARATION " +
    "cannot say so: JSDoc has no optional class property, so a conditionally assigned field emits as " +
    "`readonly thrownValue: \"null\" | \"undefined\" | undefined` — present and possibly undefined, where " +
    "the registry asks for absent. Measured; the `readonly` half of the statement IS satisfied" },
  "BOOT-M0-0512": "`LokalizedError.cause` is `Error.cause` from TypeScript's own `lib.es2022.error.d.ts`, " +
    "declared there as a mutable `cause?: unknown`. The library does not declare the member at all — " +
    "it inherits it — so making it readonly would mean shadowing a standard-library member on nine " +
    "classes to win a declaration the runtime already enforces by freezing nothing here. Measured: the " +
    "member is absent from every emitted class body under `types/`",
};

const failures = [];
const note = (message) => failures.push(message);

/** Every obligation the run will compile, in registry order. */
const compiled = [];
const unreachable = [];
const accounted = new Set();

for (const requirement of STATEMENTS) {
  const id = requirement.requirementId;
  const declared = OBLIGATIONS[id];
  if (declared) {
    accounted.add(id);
    compiled.push({ id, statement: requirement.statement, why: declared.why, imports: declared.imports,
      lines: declared.lines, contradicted: !!declared.contradicted });
    continue;
  }
  const match = MEMBER_RE.exec(requirement.statement);
  if (!match) {
    note(`${id} is not member-shaped and has no entry in OBLIGATIONS:\n      ${requirement.statement}`);
    continue;
  }
  // Group order is OWNER, optionality, MEMBER — the owner is matched first in the sentence. An
  // earlier destructure read them in the order they were added to the pattern rather than the order
  // they appear, and every statement reported its owner as `undefined`.
  const [, owner, optionality, member] = match;
  const reach = REACH[owner];
  if (!reach) {
    note(`${id} names \`${owner}\`, which REACH does not map to anything a consumer can write:\n      ${requirement.statement}`);
    continue;
  }
  accounted.add(id);
  if (reach.disposition === "UNREACHABLE") { unreachable.push({ id, owner, why: reach.why, absentName: reach.absentName }); continue; }
  const declaredEntry = DECLARED_CONTRADICTIONS[id];
  const declaration = typeof declaredEntry === "string" ? { half: "write", why: declaredEntry } : declaredEntry;
  const inverted = declaration?.half === "write";
  const invertedOptionality = declaration?.half === "optionality";
  for (const [index, target] of reach.types.entries()) {
    // The type is written the way a CONSUMER writes it — as an inline `import("lokalized/core").X`
    // rather than a bare name — so a probe can never resolve a type from anywhere but the subpath
    // its obligation names. The first draft emitted bare names with no import at all and every read
    // control failed with TS2304, which the run correctly reported as 417 UNVERIFIABLE rather than
    // as 417 satisfied statements.
    let typeExpr = target.type;
    for (const name of target.imports ?? []) {
      typeExpr = typeExpr.replace(new RegExp(`\\b${name}\\b`, "g"), `import(${JSON.stringify(target.from)}).${name}`);
    }
    compiled.push({
      id: reach.types.length > 1 ? `${id}#${index + 1}` : id,
      statement: requirement.statement,
      why: `${owner}.${member} through ${target.from}`,
      contradicted: !!declaration,
      lines: [
        { text: `export const read = (null! as ${typeExpr}).${member};`, expect: "compiles" },
        // **`required` AND `optional` WERE CAPTURED AND THROWN AWAY, and an adversarial pass measured
        // what that cost: making `ParseStringsOptions.locale` OPTIONAL moved BOOT-M0-0721 from
        // contradicted to satisfied, because the only thing the probe asked was whether a write was
        // refused. 36 of the statements say one or the other. `{} extends Pick<T, "m">` is exactly
        // "the member may be absent", so each becomes a line that must compile.
        ...(optionality
          ? [{
              text: `export const optionality: ({} extends Pick<${typeExpr}, "${member}"> ? ` +
                `${optionality.trim() === "optional" ? "true : never" : "never : true"}) = true;`,
              expect: invertedOptionality ? "refused" : "compiles",
              codes: [2322],
              note: `the statement says the member is ${optionality.trim()} and the package declares it the other way`,
            }]
          : []),
        { text: `export function write(): void { const t = null! as ${typeExpr}; t.${member} = t.${member}; }`,
          expect: inverted ? "compiles" : "refused", codes: [2540] },
      ],
    });
  }
}

/** Staleness, both directions. A table entry naming a requirement that no longer exists is dead machinery. */
for (const id of Object.keys(OBLIGATIONS)) {
  if (!STATEMENTS.some((r) => r.requirementId === id)) note(`OBLIGATIONS names ${id}, which is not a \`readonly\` requirement in the registry`);
}
for (const id of Object.keys(DECLARED_CONTRADICTIONS)) {
  if (!accounted.has(id)) note(`DECLARED_CONTRADICTIONS names ${id}, which this run never reached`);
}
/**
 * A `DELIVERED` REACH MUST NAME THE REGISTRY'S OWN SPELLING, and this check exists because an
 * ablation measured the hole it closes.
 *
 * A7 removed the read control while a reach pointed at the wrong type, expecting the gate to go
 * green; it stayed red, because the diagnostic-code check caught the write being refused as TS2339
 * rather than TS2540. So the read control and the code check are two independent guards against a
 * BROKEN reach. Neither catches a reach that is wrong but PLAUSIBLE — one aimed at a different type
 * that happens to carry readonly members of the same names — and for the thirty owners the package
 * publishes under the registry's own name, requiring the two spellings to match removes that
 * possibility outright. The remaining RENAMED and STRUCTURAL entries cannot be checked this way and
 * each states its reason; see the limit recorded in this file's header.
 */
for (const [owner, reach] of Object.entries(REACH)) {
  if (reach.disposition !== "DELIVERED") continue;
  for (const target of reach.types) {
    // The leading identifier, because a generic owner must be INSTANTIATED to be written down:
    // `TaggedLanguageFormValue<"gender", "GENDER_FEMININE">` is the registry's own spelling of the
    // name at BOOT-M0-0708 and is not a different type. The control caught this the first time the
    // check ran, which is what an ablation control is for.
    if (target.type.replace(/<.*$/s, "").trim() !== owner) {
      note(`REACH declares \`${owner}\` DELIVERED but reaches it as \`${target.type}\` through ` +
        `${target.from}. A DELIVERED name is one the package publishes unchanged; a different ` +
        `spelling is RENAMED or STRUCTURAL and owes a reason.`);
    }
  }
}

// Group 1 is the OWNER — verified against the pattern rather than counted off the source, because
// an earlier edit read it as group 2 (the optionality it had just added) and reported all 38 REACH
// entries as naming nothing. Thirty-eight problems that were entirely the tool's own.
const ownersUsed = new Set(STATEMENTS.map((r) => MEMBER_RE.exec(r.statement)?.[1]).filter(Boolean));
for (const owner of Object.keys(REACH)) {
  if (!ownersUsed.has(owner)) note(`REACH maps \`${owner}\`, which no \`readonly\` requirement names`);
}

/**
 * AN `UNREACHABLE` CLAIM IS CHECKED BY THE COMPILER TOO, across every published subpath — and the
 * FIRST DRAFT OF THIS CHECK WAS WRONG, which is worth keeping.
 *
 * It grepped the emitted `.d.ts` for the name and fired on its first run. All four hits were PROSE:
 * four docblocks that cite plan 3.5's `CatchOnlyErrorClass<X>` while explaining why the port does not
 * use it. A substring search cannot tell a declaration from a comment about a declaration — the same
 * mistake as counting `Intl` occurrences with a comment-blind grep, which M-D S35 recorded.
 *
 * The replacement asks a consumer's question: `import("lokalized/core").CatchOnlyErrorClass` must be
 * refused with TS2694, and a name that IS published on the same subpath must resolve on the line
 * above it. Without that control a typo in the subpath would be refused identically and the absence
 * would be proved by nothing.
 */
const PRESENT_ON = {
  lokalized: "LanguageFormValue",
  "lokalized/core": "LocaleMatch",
  "lokalized/parse": "ParsedStringsFile",
  "lokalized/load": "LoadedStrings",
  "lokalized/negotiate": "LocaleNegotiator",
  "lokalized/ssr": "SsrLocaleContext",
  "lokalized/node": "DirectoryManifestOptions",
  "lokalized/data/ordinal": "OrdinalityValue",
  "lokalized/data/ranges": "CardinalityValue",
};
for (const entry of unreachable) {
  const lines = [];
  for (const [subpath, present] of Object.entries(PRESENT_ON)) {
    const tag = subpath.replace(/\W+/g, "_");
    lines.push({ text: `export type control_${tag} = import(${JSON.stringify(subpath)}).${present};`, expect: "compiles" });
    lines.push({ text: `export type absent_${tag} = import(${JSON.stringify(subpath)}).${entry.absentName};`, expect: "refused", codes: [2694] });
  }
  compiled.push({ id: entry.id, statement: `\`${entry.absentName}\` is published by no subpath`, why: entry.why, lines, unreachable: true });
}

/** Anti-vacuity: the run must actually compile something of each kind, or it proves nothing. */
if (compiled.length === 0) note("no obligations were built at all");
if (!compiled.some((o) => o.lines.some((l) => l.expect === "refused" && (l.codes ?? []).includes(2540)))) {
  note("no obligation asks for a refused member WRITE, which is what a `readonly` member means");
}
if (!compiled.some((o) => o.lines.some((l) => l.expect === "refused" && (l.codes ?? []).includes(2542)))) {
  note("no obligation asks for a refused INDEX write, which is what a readonly array return means");
}
// **PER OBLIGATION, NOT `some()`.** An adversarial pass removed the read line from ONE probe and the
// global term stayed satisfied, because 229 others still had one — the same global-anti-vacuity
// shape M-D S18 measured on `check:readme`, where deleting a whole README section left the gate at
// exit 0.
for (const obligation of compiled) {
  if (obligation.unreachable) continue;
  if (!obligation.lines.some((l) => l.expect === "compiles")) {
    note(`${obligation.id} has no line that must COMPILE, so a refusal earned by a misspelled member ` +
      `or a type that does not exist would read as a pass`);
  }
}

if (process.argv.includes("--list")) {
  for (const o of compiled) console.log(`${o.id}\t${o.contradicted ? "CONTRADICTED" : "expected"}\t${o.why}`);
  console.log(`\n${compiled.length} probes, ${unreachable.length} unreachable, ${failures.length} accounting problem(s)`);
  for (const message of failures) console.log(`  - ${message}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

/**
 * ONE FILE, ONE COMPILE. Each obligation becomes a namespace so its `read`/`write` bindings cannot
 * collide, and every emitted line is recorded against the obligation that produced it so a diagnostic
 * maps back to a requirement rather than to a line number.
 */
const directory = mkdtempSync(join(tmpdir(), "lokalized-readonly-surface-"));
const project = join(directory, "consumer");
mkdirSync(join(project, "node_modules"), { recursive: true });
symlinkSync(root, join(project, "node_modules", "lokalized"), "dir");
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "readonly-surface-probe", type: "module" }), "utf8");

const sourceLines = [];
/** @type {Map<number, { obligation: any, line: any }>} */
const byLine = new Map();
const emit = (text) => { sourceLines.push(text); return sourceLines.length; };

emit("// GENERATED by tools/readonly-surface.mjs — one probe per registry `readonly` statement.");
for (const [from, names] of Object.entries(VALUE_IMPORTS)) {
  emit(`import { ${names.join(", ")} } from ${JSON.stringify(from)};`);
}
for (const [index, obligation] of compiled.entries()) {
  emit(`// ${obligation.id}: ${obligation.statement}`);
  emit(`namespace p${index} {`);
  for (const line of obligation.lines) byLine.set(emit(`  ${line.text}`), { obligation, line });
  emit("}");
}
const probeFile = join(project, "readonly-surface.ts");
writeFileSync(probeFile, `${sourceLines.join("\n")}\n`, "utf8");

let output = "";
try {
  execFileSync(process.execPath, [
    join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict",
    "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022",
    "--skipLibCheck", probeFile,
  ], { cwd: project, encoding: "utf8", stdio: "pipe" });
} catch (error) {
  output = `${/** @type {any} */ (error).stdout ?? ""}`;
}

/** line -> [code, …] */
const diagnostics = new Map();
let unattributed = 0;
for (const raw of output.split("\n")) {
  const parsed = /\((\d+),\d+\): error TS(\d+):/.exec(raw);
  if (!parsed) continue;
  const line = Number(parsed[1]);
  if (!byLine.has(line)) { unattributed++; console.log(`  UNATTRIBUTED  ${raw.trim()}`); continue; }
  if (!diagnostics.has(line)) diagnostics.set(line, []);
  diagnostics.get(line).push({ code: Number(parsed[2]), text: raw.trim() });
}
if (unattributed > 0) note(`${unattributed} diagnostic(s) landed on generated lines this tool does not own — the probe file is malformed, not the library`);

const contradictions = [], unverifiable = [], wrongCode = [];
for (const [line, { obligation, line: spec }] of byLine) {
  const got = diagnostics.get(line) ?? [];
  if (spec.expect === "compiles") {
    if (got.length > 0) unverifiable.push({ obligation, spec, got });
  } else if (got.length === 0) {
    contradictions.push({ obligation, spec });
  } else if (!got.some((d) => (spec.codes ?? []).includes(d.code))) {
    wrongCode.push({ obligation, spec, got });
  }
}

if (!process.argv.includes("--keep")) rmSync(directory, { recursive: true, force: true });

for (const { obligation, spec, got } of unverifiable) {
  // A DECLARED CONTRADICTION THAT HAS STOPPED CONTRADICTING is a fixed defect with a stale excuse
  // still attached, and it must not be reported as a broken probe. Its write line is the INVERTED
  // one — it expects to compile — so a diagnostic on it means the member became `readonly`.
  if (obligation.contradicted && spec.text.includes("write")) {
    note(`${obligation.id} is listed in DECLARED_CONTRADICTIONS and is NO LONGER CONTRADICTED — the ` +
      `package now refuses the write. Delete the entry; the excuse has outlived the defect.\n` +
      `      ${obligation.statement}`);
    continue;
  }
  note(`${obligation.id} UNVERIFIABLE — its read control does not compile, so a refusal on the write would prove nothing.\n` +
    `      ${obligation.why}\n      ${spec.text}\n      ${got[0].text}`);
}
for (const { obligation, spec } of contradictions) {
  // **A DECLARED CONTRADICTION THAT HAS STOPPED CONTRADICTING WAS SILENT HERE, and the dead
  // `void stillOpen;` at the foot of this file was the abandoned check.** An adversarial pass proved
  // it retrospectively: widening the port so `placeholders` accepts a `ReadonlyMap` — which is
  // BOOT-M0-0563's whole subject — left the run byte-identical, still printing "2 declared
  // contradiction(s)", with the paragraph-long excuse intact over a defect that no longer existed.
  // That is the exact failure mode this file's own docblock claims to prevent.
  if (obligation.contradicted) {
    note(`${obligation.id} is listed as a declared contradiction and is NO LONGER CONTRADICTED — ` +
      `the package now satisfies the statement. Delete the entry; the excuse has outlived the defect.\n` +
      `      ${obligation.statement}`);
    continue;
  }
  if (obligation.unreachable) {
    note(`${obligation.id} is declared UNREACHABLE and the name is now PUBLISHED — a consumer can ` +
      `write it, so the statement is about a type this package ships after all.\n      ${obligation.statement}`);
    continue;
  }
  note(`${obligation.id} CONTRADICTED — the package accepts a write the registry declares readonly.\n` +
    `      ${obligation.statement}\n      ${obligation.why}`);
  void spec;
}
for (const { obligation, spec, got } of wrongCode) {
  note(`${obligation.id} was refused for the WRONG REASON — expected TS${(spec.codes ?? []).join("/TS")}, got ${got.map((d) => `TS${d.code}`).join(", ")}.\n` +
    `      ${got[0].text}`);
}

const declaredOpen = compiled.filter((o) => o.contradicted).length;
console.log(`\nreadonly surface: ${STATEMENTS.length} registry statements · ${compiled.length} probes compiled · ` +
  `${unreachable.length} unreachable by design · ${declaredOpen} declared contradiction(s)`);
for (const entry of unreachable) console.log(`  unreachable  ${entry.id}  ${entry.owner}`);
if (failures.length > 0) {
  console.log(`\n${failures.length} problem(s):`);
  for (const message of failures) console.log(`  - ${message}`);
  process.exit(1);
}
console.log("every `readonly` statement in the registry is satisfied by the package a consumer installs.");
