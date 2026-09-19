// @ts-check
/**
 * THE PLAN'S WHOLE DECLARED SURFACE, COMPARED TO THE PORT'S — a channel that did not exist.
 *
 * `symbol-allowlist.json` was generated from plan section **3.1 alone**: one markdown table of
 * "canonical owner | public symbols". Everything that checked the published surface — the permitting
 * gate, the delivery gate, the category gate — read that table and could see nothing else. **The
 * plan declares 155 more symbols by SIGNATURE, across eleven sections** (§2.5, 3.2-3.7, 4.1, 6.1,
 * 6.2, 6.4), and nothing had ever compared that set to what the port ships.
 *
 * What the blindness cost, both found by building this comparison: `createStrings({ loaded })` —
 * M8's flagship call, spelled that way in plan 6.2's own examples — **did not typecheck for a
 * consumer**, because plan 3.2's option UNION was declared in 3.2 and the port only had the direct
 * arm; and plan 3.5 declares **nine** error classes as package exports where the port had shipped
 * three.
 *
 * THE GENERATOR NOW EMITS `planDeclaredSymbols`, so this test compares two independently derived
 * things: what the plan declares (spec repo, from the plan text) against what the port delivers
 * (this repo, from `package.json#exports` and the emitted declarations).
 *
 * **EVERY UNDELIVERED NAME COSTS A DISPOSITION, and every disposition is falsifiable.** A
 * `STRUCTURAL` claim says the port honours the contract without a name. A `RENAMED` claim names the
 * port's spelling, **and that spelling is then required to exist** — so a renaming that is merely
 * asserted fails. An `OWED` claim names a milestone. And all three go STALE: a disposition whose
 * name turns up delivered fails the run, because a backlog that cannot shrink visibly is the
 * "known-gap lists rot" failure this project has now hit four times.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const allowlist = JSON.parse(readFileSync(new URL("../lokalized-spec/symbol-allowlist.json", root), "utf8"));

/**
 * The port honours the contract, without a name a consumer could import. Each entry says what
 * carries it — a flattened option type, an inlined union, a structural shape.
 */
const STRUCTURAL = /** @type {Record<string, string>} */ ({
  // Plan 3.2 builds `CreateStringsOptions` from a stack of intermediate aliases; the port declares
  // the two ARMS the union actually needs and inlines the rest. The arms are delivered (S29).
  CommonCreateStringsOptions: "folded into both arms of the delivered CreateStringsOptions union",
  CreateStringsBehaviorOptions: "folded into both arms; every member appears on each",
  LocaleSourceOptions: "the locale/localeResolver/localeMatchResolver trio, inlined on both arms",
  TranslationBehaviorOptions: "folded into the delivered TranslationCallOptions",
  // Plan 3.2/3.7 type aliases over primitives and records. A parameter typed `string` honours
  // `type LocaleTag = string` exactly; a named alias would add no constraint a consumer can rely on.
  LocaleTag: "an alias for `string`; every locale parameter is typed `string`",
  TranslationStatus: "a string union, inlined at each result member",
  // `LocaleMatchType` SAT HERE reading "a string union, inlined on the delivered LocaleMatch", and
  // that was measured FALSE: `types/core/index.d.ts` declared `matchType: string`, so nothing was
  // inlined. The `why` field is free-form prose no rule reads — only the NAME's absence is tested —
  // so a false reason sat inside the table built to hold falsifiable ones. The type is delivered now
  // and this line's deletion is the record. Its two neighbours were checked at the same time and
  // both are true: `status` is emitted as a real union, and so is a warning's `type`.
  LocalizedStringWarningType: "a string union, inlined on the delivered LocalizedStringWarning",
  PluralNumber: "a numeric union, inlined at every classifier parameter",
  CatalogInput: "inlined as the value type of the delivered catalog record",
  CatalogMap: "inlined as `Record<string, unknown> | ReadonlyMap<string, unknown>` on both arms",
  TiebreakerMap: "inlined on the direct arm, with the ReadonlyMap alternative spelled out",
  // Plan 3.4's result hierarchy: a base interface plus two arms plus their union. The port declares
  // the flattened result, which is what `get`/`getResult` actually return.
  TranslationResultBase: "folded into the delivered result shape",
  TranslatedResult: "folded into the delivered result shape",
  FailureResult: "folded into the delivered result shape",
  TranslationResult: "the union of the two arms above, delivered flattened",
  // Plan 3.5's three response shapes are discriminated STRUCTURALLY, which the plan says outright;
  // the port delivers the union as `FailureResponse` and the helpers that build each arm.
  ReturnKeyResponse: "an arm of the delivered FailureResponse union",
  ReturnStringResponse: "an arm of the delivered FailureResponse union",
  ThrowResponse: "an arm of the delivered FailureResponse union",
  PhoneticResolver: "inlined as the phoneticResolver option's function type",
  // Plan 3.6/3.7 input and value shapes, inlined at their single use site.
  LanguageFormTranslationInput: "an arm of the delivered LocalizedStringInput union",
  ExpressionTranslationInput: "an arm of the delivered LocalizedStringInput union",
  DecimalValue: "the tagged record `decimal()` returns, inlined at its return type",
  PluralOperandValue: "the tagged record `pluralOperands()` returns, inlined at its return type",
  // Plan 6.1's two option bags, inlined at the single function each belongs to.
  ManifestValidationOptions: "inlined on validateStringsManifest",
  ParseStringsManifestOptions: "inlined on parseStringsManifest",
  // Plan 3.2's bidi union, reachable inline from the delivered option type — MEASURED at
  // `types/core/index.d.ts:364`, which is why this one is STRUCTURAL and its four siblings are not.
  BidiIsolation: "reachable inline as `import(\"../internal/bidi.js\").BidiIsolation` on the option type",
});

/** The port ships the same contract under a different name. The port name must EXIST. */
const RENAMED = /** @type {Record<string, string>} */ ({
  TranslationOptions: "TranslationCallOptions",
  LocaleMatchResult: "LocaleMatch",
});

/** Declared by the plan, delivered nowhere, owed by a named milestone. */
const OWED = /** @type {Record<string, { owner: string, why: string }>} */ ({
  // --- plan 3.7's tagged-value family: the types, not the 61 constants (which ARE delivered) ------
  //
  // S28's category gate reported core's "tagged-value types" as having no delivered member, working
  // only from plan 3.1's prose. This names them. `decimal()` and `pluralOperands()` ship as
  // functions and their RETURN shapes are structural, but the FORM-NAME unions are what a consumer
  // needs to write a typed selector, and none of the eleven exists.
  // --- plan 3.5's error classes: the four of nine still unexported ------------------------------
  //
  // M8 clause 75's remaining cluster. `UnsupportedLocaleError` is a real class in
  // `src/internal/plural.js` with no construction token and no `code`; the other three have no class
  // at all, and `LokalizedError` is the base the other eight extend.
  // --- plan 3.4's negotiate helpers -------------------------------------------------------------
  //
  // `forLanguageRanges` and `forAcceptLanguage` WERE HERE and are deleted by M9 S2 — the deletion is
  // the record. They are the clearest case this table has for existing at all: both are declared by
  // SIGNATURE in plan 3.4 and appear nowhere in section 3.1's table, so no allowlist-derived gate
  // could ever have reported them missing, and the delivery gate one level up could not either.
  // --- option and model shapes with no delivered equivalent -------------------------------------
  // THE CROSS-CHECK MOVED THIS ONE. The blind classification pass called it RENAMED; this file's
  // "a RENAMED disposition names a spelling the port actually has" test refused, and the measurement
  // agrees: there is no named type at all. `run-plan.js:236` reads `options.partialFailure ===
  // "allow-partial"` off an untyped literal, so the policy is a string compared in one place and a
  // consumer has nothing to import. An asserted renaming and a real one look identical until
  // something requires the port name to exist.
  // --- already owed by the sibling gate, repeated here so this table is complete on its own ------
  // `mergeParsedStringsFiles` WAS HERE and is deleted by M9 S3 — the deletion is the record, and it
  // empties this table. Every symbol the plan declares by signature across its eleven sections is
  // now either delivered or dispositioned STRUCTURAL/RENAMED; nothing is OWED.
});

/** Every name the port publishes: runtime exports and exported declarations, across all subpaths. */
function deliveredNames() {
  const names = new Set();
  return (async () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (subpath === "./package.json") continue;
      const entry = /** @type {any} */ (target);
      for (const name of Object.keys(await import(new URL(entry.import, root).href))) names.add(name);
      const declaration = new URL(entry.types, root);
      if (!existsSync(declaration)) continue;
      const text = readFileSync(declaration, "utf8");
      for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:type|interface|function|const|class)\s+([A-Za-z0-9_]+)/g))
        names.add(m[1]);
      for (const m of text.matchAll(/export\s*\{([^}]*)\}/g))
        for (const part of m[1].split(",")) names.add(part.trim().split(/\s+as\s+/).pop()?.trim() ?? "");
      for (const m of text.matchAll(/@typedef\s*(?:\{[^}]*\})?\s*([A-Za-z0-9_]+)/g)) names.add(m[1]);
    }
    return names;
  })();
}

test("the artifact carries the plan's declared surface at all", () => {
  // ANTI-VACUITY FIRST. Every assertion below is satisfied trivially by an empty list, and an empty
  // list is exactly the state this test was written to end.
  assert.ok(Array.isArray(allowlist.planDeclaredSymbols) && allowlist.planDeclaredSymbols.length > 100,
    "symbol-allowlist.json carries no planDeclaredSymbols; the generator has stopped deriving them");
  const sections = new Set(allowlist.planDeclaredSymbols.map((/** @type {any} */ e) => e.section));
  assert.ok(sections.size >= 8,
    `the plan declares API in eleven sections; the artifact sees ${sections.size}: ${[...sections].sort()}`);
  // The example-binding exclusion is visible rather than silent, and must actually be excluding.
  assert.ok(allowlist.planExampleBindings.length > 0,
    "no example bindings were excluded; the declaration-vs-example rule has stopped separating them");
  for (const binding of allowlist.planExampleBindings)
    assert.ok(!allowlist.planDeclaredSymbols.some((/** @type {any} */ e) => e.name === binding),
      `${binding} is both an example binding and a declared symbol`);
});

test("every symbol the plan declares is delivered, or carries a falsifiable disposition", async () => {
  const delivered = await deliveredNames();
  const undisposed = [];
  for (const entry of allowlist.planDeclaredSymbols) {
    if (delivered.has(entry.name)) continue;
    if (entry.name in STRUCTURAL || entry.name in RENAMED || entry.name in OWED) continue;
    undisposed.push(`${entry.name} (${entry.kind}, plan ${entry.section}:${entry.line})`);
  }
  assert.deepEqual(undisposed, [],
    "the plan declares these and the port delivers them nowhere. Deliver them, or record them in " +
    "STRUCTURAL, RENAMED or OWED — a disposition is cheap and an invisible gap is not");
});

test("a RENAMED disposition names a spelling the port actually has", async () => {
  const delivered = await deliveredNames();
  const broken = [];
  for (const [planName, portName] of Object.entries(RENAMED))
    if (!delivered.has(portName)) broken.push(`${planName} claims to ship as '${portName}', which is not delivered`);
  assert.deepEqual(broken, [],
    "a renaming that is only asserted is not a renaming; either the port name is wrong or the " +
    "symbol is OWED rather than RENAMED");
});

test("no disposition has quietly been delivered", async () => {
  const delivered = await deliveredNames();
  const declared = new Set(allowlist.planDeclaredSymbols.map((/** @type {any} */ e) => e.name));
  const stale = [];
  for (const [table, names] of /** @type {[string, string[]][]} */ ([
    ["STRUCTURAL", Object.keys(STRUCTURAL)], ["RENAMED", Object.keys(RENAMED)], ["OWED", Object.keys(OWED)],
  ]))
    for (const name of names) {
      if (!declared.has(name)) stale.push(`${table}: ${name} — the plan no longer declares it`);
      else if (delivered.has(name)) stale.push(`${table}: ${name} — now delivered`);
    }
  assert.deepEqual(stale, [],
    "delete these entries; the deletion IS the record of the gap closing, the same contract OWED " +
    "and the coverage dispositions carry");
});
