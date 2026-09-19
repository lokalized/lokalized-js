// @ts-check
/**
 * THE HALF OF THE ALLOWLIST CONTRACT NOBODY WAS CHECKING: exported TYPES, and the plan's PROHIBITIONS.
 *
 * `symbol-allowlist.test.js` checks that every export is permitted and `declared-surface.test.js`
 * checks that every promised name is delivered. Between them they looked complete. They are not, and
 * the asymmetry is exact: **the delivery direction reads `types/*.d.ts` and the permitting direction
 * reads only `Object.keys(await import(...))`.** So a TYPE can satisfy a promise and can never
 * violate one. Measured when this file was written: **38 exported types across seven subpaths were
 * permitted by no named symbol and no category** — for a library whose consumers are mostly
 * TypeScript, that is most of the surface.
 *
 * **AND THE GAP HID AN INVERTED NEGATION.** Plan 3.1's `load` row ends "it consumes but does not
 * re-own or re-export core's `CatalogIdentity` and `StringsLoadCoverage`". The allowlist generator
 * scanned the whole cell for backticked names, so it hoisted both into `load.namedSymbols` — and the
 * delivery gate then DEMANDED them. Ablated before the fix: removing the two type re-exports from
 * `lokalized/load` turned `declared-surface.test.js` red naming `load:CatalogIdentity` and
 * `load:StringsLoadCoverage`. **A prohibition was read as a promise and then enforced.** The two
 * declarations had also drifted — core's `Readonly<{...}>` against load's mutable `{...}` — so the
 * same public name meant different things on two subpaths.
 *
 * The generator now emits `disownedSymbols`, and the first test below is the direction that was
 * missing entirely: a name the plan says an owner must NOT re-export.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const allowlist = JSON.parse(readFileSync(new URL("../lokalized-spec/symbol-allowlist.json", root), "utf8"));

/** Kept in step with the two sibling tests by hand; all three encode plan 3.1. */
const OWNERS_BY_SUBPATH = /** @type {Record<string, string[]>} */ ({
  ".": [...allowlist.rootReExportsOwners],
  "./core": ["core"], "./parse": ["parse"], "./load": ["load"], "./ssr": ["ssr"],
  "./negotiate": ["negotiate", "core"], "./node": ["node", "load"],
  "./data/ordinal": ["data/ordinal"], "./data/ranges": ["data/ranges"],
});

/**
 * Exported TYPES classified under a category their owner declares — the type-side counterpart of
 * `symbol-allowlist.test.js`'s `CATEGORIZED`, which covers runtime exports only. Accepting a
 * category wholesale would gut the gate, so every type costs a reviewed line naming its owner and
 * its category, and the category is ASSERTED against the owner's declaration below.
 */
const CATEGORIZED_TYPES = /** @type {[string, string, string][]} */ ([
  // core — the options and result shapes `createStrings` and a lookup traffic in.
  // PLAN 3.7's TAGGED-VALUE FAMILY, delivered as a batch. S28's category gate had reported
  // "tagged-value types" as having NO delivered member; these are it. The 61 constants shipped in
  // M5b and their types did not, which left every one emitted as `… | undefined` with the two tag
  // fields widened to `string`.
  // Plan 3.4:779 declares `LocaleMatchType` and :3154 puts it "in core". Not in plan 3.1's table,
  // so no 3.1-derived gate could ever have demanded it — the structural blindness S29 and S30
  // recorded, in a fourth instance.
  ["core", "LocaleMatchType", "match/configuration structural types"],
  ["core", "TaggedLanguageFormValue", "tagged-value types"],
  ["core", "LanguageFormValue", "tagged-value types"],
  ["core", "PhoneticValue", "tagged-value types"],
  ["core", "LanguageFormName", "tagged-value types"],
  ["core", "LanguageFormAxis", "tagged-value types"],
  ["core", "GenderFormName", "tagged-value types"],
  ["core", "GrammaticalCaseFormName", "tagged-value types"],
  ["core", "DefinitenessFormName", "tagged-value types"],
  ["core", "ClassifierFormName", "tagged-value types"],
  ["core", "FormalityFormName", "tagged-value types"],
  ["core", "ClusivityFormName", "tagged-value types"],
  ["core", "AnimacyFormName", "tagged-value types"],
  ["core", "CardinalityFormName", "tagged-value types"],
  ["core", "OrdinalityFormName", "tagged-value types"],
  ["core", "PhoneticFormName", "tagged-value types"],
  // Plan 3.2:400's union, delivered in S35 with the error hierarchy that uses it.
  ["core", "LokalizedErrorCode", "core errors"],
  ["core", "CreateStringsOptions", "construction/translation/result types"],
  // ITS TWO ARMS, ADDED IN S29. Plan 3.2:565-588 declares `CreateStringsOptions` as
  // `DirectCreateStringsOptions | LoadedCreateStringsOptions`; the port had only the direct shape and
  // read the loaded member through an `any` cast, so `createStrings({ loaded })` -- M8s flagship
  // call -- did not typecheck for a consumer. This gate caught both new names on its first run.
  ["core", "DirectCreateStringsOptions", "construction/translation/result types"],
  ["core", "LoadedCreateStringsOptions", "construction/translation/result types"],
  ["core", "TranslationCallOptions", "construction/translation/result types"],
  ["core", "Definition", "construction/translation/result types"],
  // core — what a negotiation produced and what a configuration looks like.
  ["core", "LocaleMatch", "match/configuration structural types"],
  ["core", "LocaleConfiguration", "match/configuration structural types"],
  ["core", "WeightedLanguageRange", "match/configuration structural types"],
  // core — plan 3.5's failure surface, the types beside the three helpers the runtime table carries.
  ["core", "FailureHandler", "failure policy/observer/handler types and helpers"],
  ["core", "FailureReason", "failure policy/observer/handler types and helpers"],
  ["core", "FailureResponse", "failure policy/observer/handler types and helpers"],
  ["core", "FallbackEvent", "failure policy/observer/handler types and helpers"],
  ["core", "FallbackObserver", "failure policy/observer/handler types and helpers"],
  ["core", "FallbackPolicy", "failure policy/observer/handler types and helpers"],
  ["core", "BuiltinFallbackPolicy", "failure policy/observer/handler types and helpers"],
  ["core", "PrecedingFailure", "failure policy/observer/handler types and helpers"],
  ["core", "TranslationFailure", "failure policy/observer/handler types and helpers"],
  // core — the shape of the pinned plural data a classifier reads.
  ["core", "PluralDataRuntime", "cardinal classifiers/support probes"],
  // parse — its single category covers its whole type surface, which is what "parsed/model" means.
  ["parse", "ParsedStringsFile", "parsed/model/warning/limit types"],
  ["parse", "ParseStringsOptions", "parsed/model/warning/limit types"],
  ["parse", "LocalizedStringInput", "parsed/model/warning/limit types"],
  ["parse", "PlaceholderDefinitionInput", "parsed/model/warning/limit types"],
  ["parse", "WholeMessageAlternativeInput", "parsed/model/warning/limit types"],
  ["parse", "LocalizedStringWarning", "parsed/model/warning/limit types"],
  ["parse", "StringsLoadingLimits", "parsed/model/warning/limit types"],
  ["parse", "Definition", "parsed/model/warning/limit types"],
  // Delivered as a batch with the tagged-value family. Each was promised by a signature the
  // allowlist could never see, because it is generated from plan section 3.1's table alone.
  ["core", "Placeholders", "construction/translation/result types"],
  ["parse", "ParsedCatalogLimits", "parsed/model/warning/limit types"],
  ["parse", "PlaceholderDefinition", "parsed/model/warning/limit types"],
  ["parse", "LocalizedStringNodeInput", "parsed/model/warning/limit types"],
  ["load", "PartialFailurePolicy", "manifest/load option and failure types"],
  ["load", "LoadStringsOptions", "manifest/load option and failure types"],
  // load — the per-file diagnosis its failures carry.
  ["load", "LoadFailure", "manifest/load option and failure types"],
  // ssr — its single category, named for exactly these.
  ["ssr", "LokalizedSsrStampV1", "SSR stamp/context types"],
  ["ssr", "SsrLocaleContext", "SSR stamp/context types"],
  ["ssr", "SsrLocaleMatchV1", "SSR stamp/context types"],
  // data/ordinal — the classifier return type.
  ["data/ordinal", "OrdinalityValue", "number/operand ordinal classifiers and support probes"],
]);

/**
 * Types this port exports that plan 3.1 permits under NO category of their subpath's owners.
 *
 * DECLARED RATHER THAN RESOLVED, because resolving each one is a plan question and not an agent's:
 * either the type stops being exported there, or plan 3.1 gains the category. Recorded so the
 * question is machine-held and re-checked every run, on the same reasoning as
 * `DECLARED_MESSAGE_DIVERGENCES` — an entry that stops being true FAILS, so this cannot rot into a
 * list of excuses.
 *
 * THE SHAPE IS THE SAME IN FOUR OF THE FIVE: `parse` types surfacing on another subpath, where plan
 * 3.1 gave `node` an explicit "re-exports applicable shared load types" category and gave `core` and
 * `load` no equivalent for parse's.
 */
const UNCATEGORIZED = /** @type {Record<string, string>} */ ({
  "./core:LocalizedStringWarning":
    "a parse warning type on `./core`. core's eight categories name construction/result, " +
    "match/configuration, failure policy, tagged values, the 61 constants, cardinal probes, " +
    "CLDR/IANA metadata and core errors -- none of them warnings. It reaches the surface because " +
    "`Strings#getWarnings()` returns it.",
  "./load:ParsedStringsFile":
    "parse's model type on `./load`, reached through `LoadedStrings.catalogs`. `load` has no " +
    "re-export category; `node` has one for exactly this situation.",
  "./load:StringsLoadingLimits":
    "parse's limit type on `./load`, reached through `LoadedStrings.loadingLimits`. Same shape.",
  "./load:LocalizedStringWarning":
    "parse's warning type on `./load`, reached through `LoadedStrings.warnings`. Same shape.",
  "./data/ranges:CardinalityValue":
    "the classifier return type on a subpath whose plan 3.1 row is two backticked names and NO " +
    "category at all, so nothing there can permit a type. `data/ordinal`'s row has a category and " +
    "its `OrdinalityValue` is classified under it; the two rows are asymmetric in the plan itself.",
});

/**
 * Categories plan 3.1 promises and the port delivers NO member of — the category-level analogue of
 * `declared-surface.test.js`'s `OWED`, and found the same way: by building the gate and reading what
 * it named. Each goes STALE and FAILS the moment a member is classified, so the backlog cannot rot.
 *
 * **ONE ENTRY IS ALREADY GONE, AND ITS DELETION IS THE RECORD.** `core|CLDR/IANA runtime metadata`
 * was here from S28 until S30 delivered plan 3.2:447-453's seven build-identity constants; the
 * staleness check below caught it on the first run after the export landed, which is the whole
 * contract this table carries.
 *
 * RECORDED AS FOUND, NOT ASSIGNED, where the owning milestone is closed — S5's precedent for the
 * same discovery one level up, when 28 allowlisted NAMES turned out to be declared nowhere.
 */
const UNDELIVERED_CATEGORIES = /** @type {Record<string, { owner: string, why: string }>} */ ({
  // `negotiate|re-exports core's LanguageRange type and IANA metadata` WAS HERE and is deleted by
  // M9 S2, which is the record of it closing. Worth keeping the reason it survived as long as it
  // did: its `why` said "the IANA-metadata half has nothing to re-export, because core exports
  // none", and that stopped being true the day M8's final batch landed the seven build-identity
  // constants. **The staleness arm below fires when a category gains a MEMBER, never when an entry's
  // excuse stops holding** — so a table entry can go on describing a world that ended, which is this
  // project's most-repeated defect wearing the one costume the gate does not check for.
  "node|re-exports applicable shared load types": {
    owner: "M8",
    why:
      "MEASURED: `types/node/index.d.ts` exports exactly its three named options types and NOTHING " +
      "else. `lokalized/node` returns `LoadedStrings` from three of its loaders and re-exports no " +
      "shared load type at all, so a consumer of that subpath cannot name what it is handed. M8 owns " +
      "`node` and is open, so this is live work rather than a closed-milestone gap.",
  },
});

/** Every type name a subpath's `.d.ts` exports, in both spellings tsc emits plus the JSDoc form. */
function exportedTypes(/** @type {string} */ relative) {
  const declaration = relative.replace(/^\.\/src\//, "./types/").replace(/\.js$/, ".d.ts");
  if (!existsSync(new URL(declaration, root))) return new Set();
  const text = readFileSync(new URL(declaration, root), "utf8");
  const names = new Set();
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z0-9_]+)/g))
    names.add(match[1]);
  for (const match of text.matchAll(/@typedef\s*(?:\{[^}]*\})?\s*([A-Za-z0-9_]+)/g)) names.add(match[1]);
  return names;
}

const entryFor = (/** @type {any} */ target) => (typeof target === "string" ? target : target.import ?? target.default);
const subpaths = Object.entries(pkg.exports).filter(([subpath]) => subpath !== "./package.json");
const ownerRow = (/** @type {string} */ owner) =>
  allowlist.owners.find((/** @type {any} */ row) => row.owner === owner);

// ---------------------------------------------------------------------------------------------
// 1. THE PROHIBITION. A name plan 3.1 says an owner does not re-own or re-export.
// ---------------------------------------------------------------------------------------------

test("a disowned symbol is not delivered by the owner the plan disowns it for", async () => {
  // ANTI-VACUITY FIRST: if the artifact carried no prohibition at all this test would pass over
  // anything, which is exactly the state it was written to end.
  const disowned = allowlist.owners.flatMap((/** @type {any} */ row) =>
    (row.disownedSymbols ?? []).map((/** @type {string} */ name) => [row.owner, name]));
  assert.ok(disowned.length > 0,
    "the allowlist declares no disowned symbol; plan 3.1's `load` row has one, so the generator has " +
    "stopped reading it and this gate is vacuous");

  const violations = [];
  for (const [subpath, target] of subpaths) {
    const owners = OWNERS_BY_SUBPATH[subpath] ?? [];
    const module = await import(new URL(entryFor(target), root).href);
    const delivered = new Set([...Object.keys(module), ...exportedTypes(entryFor(target))]);
    for (const owner of owners)
      for (const name of ownerRow(owner)?.disownedSymbols ?? [])
        if (delivered.has(name)) violations.push(`${subpath}: ${name} (disowned by '${owner}')`);
  }
  assert.deepEqual(violations, [],
    "plan 3.1 says these owners consume but do not re-own or re-export these names; the subpath " +
    "exports them anyway. Consume the owner's type inline instead of declaring one here.");
});

// ---------------------------------------------------------------------------------------------
// 2. THE PERMITTING DIRECTION, EXTENDED TO TYPES.
// ---------------------------------------------------------------------------------------------

test("every exported TYPE is permitted by a named symbol, a category, or a declared question", async () => {
  const unpermitted = [];
  for (const [subpath, target] of subpaths) {
    const owners = OWNERS_BY_SUBPATH[subpath] ?? [];
    const module = await import(new URL(entryFor(target), root).href);
    const runtime = new Set(Object.keys(module));

    const permitted = new Set();
    for (const owner of owners) {
      const row = ownerRow(owner);
      assert.ok(row, `${subpath} names owner '${owner}', which the allowlist does not declare`);
      for (const name of row.namedSymbols) permitted.add(name);
      for (const [categorizedOwner, name, category] of CATEGORIZED_TYPES) {
        if (categorizedOwner !== owner) continue;
        assert.ok(row.unenumeratedCategories.includes(category),
          `${name} is classified under '${owner}' as '${category}', which that owner does not declare`);
        permitted.add(name);
      }
    }
    for (const name of exportedTypes(entryFor(target))) {
      // A type that is ALSO a runtime export is governed by the sibling test; this one owns the
      // names that exist only in the declarations.
      if (runtime.has(name) || permitted.has(name)) continue;
      if (`${subpath}:${name}` in UNCATEGORIZED) continue;
      unpermitted.push(`${subpath}: ${name} (owners: ${owners.join(", ")})`);
    }
  }
  assert.deepEqual(unpermitted, [],
    "these types are exported and plan 3.1 permits them under no named symbol and no category of " +
    "their subpath's owners; classify them in CATEGORIZED_TYPES, declare the question in " +
    "UNCATEGORIZED, or stop exporting them");
});

test("no UNCATEGORIZED entry has quietly been resolved", async () => {
  const stale = [];
  for (const key of Object.keys(UNCATEGORIZED)) {
    const [subpath, name] = key.split(":");
    const target = pkg.exports[subpath];
    assert.ok(target, `UNCATEGORIZED names subpath '${subpath}', which package.json does not export`);
    if (!exportedTypes(entryFor(target)).has(name)) stale.push(`${key} is no longer exported`);
  }
  assert.deepEqual(stale, [],
    "delete these UNCATEGORIZED entries; the deletion IS the record of the question being answered");
});

// ---------------------------------------------------------------------------------------------
// 3. A PROMISED FAMILY WITH NO MEMBER IS AN UNKEPT PROMISE.
// ---------------------------------------------------------------------------------------------

test("every declared category has at least one delivered member", async () => {
  // The categories are prose, so this cannot be derived — it is the two classification tables that
  // give a category members at all, which is why the tables are the gate and not a convenience.
  const runtimeTable = readFileSync(new URL("test/symbol-allowlist.test.js", root), "utf8");
  const block = runtimeTable.slice(runtimeTable.indexOf("const CATEGORIZED"),
    runtimeTable.indexOf("]);", runtimeTable.indexOf("const CATEGORIZED")));
  const runtimeRows = [...block.matchAll(/\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g)]
    .map((match) => [match[1], match[2], match[3]]);

  // A ROW IS NOT A MEMBER UNTIL THE SYMBOL IS ACTUALLY DELIVERED, and the first version of this
  // gate missed that: it counted classification ROWS, so a category stayed "covered" by a table entry
  // naming a symbol nobody exports. Found by an ablation that DID NOT FIRE — deleting
  // `export type LoadFailure` from `types/load` left every test green, because its row survived.
  // A table that can vouch for an absent symbol is a claim, not a measurement.
  const deliveredBy = new Map();
  for (const [subpath, target] of subpaths) {
    const module = await import(new URL(entryFor(target), root).href);
    const names = [...Object.keys(module), ...exportedTypes(entryFor(target))];
    for (const owner of OWNERS_BY_SUBPATH[subpath] ?? []) {
      if (!deliveredBy.has(owner)) deliveredBy.set(owner, new Set());
      for (const name of names) deliveredBy.get(owner).add(name);
    }
  }
  const members = new Set([...runtimeRows, ...CATEGORIZED_TYPES]
    .filter(([owner, name]) => deliveredBy.get(owner)?.has(name))
    .map(([owner, , category]) => `${owner}|${category}`));
  const empty = [];
  for (const row of allowlist.owners)
    for (const category of row.unenumeratedCategories) {
      // The 61 constants are members by enumeration, in `languageFormConstants`, and the sibling
      // test asserts the count. They need no classification row.
      if (category === "all 61 named language-form constants") continue;
      const key = `${row.owner}|${category}`;
      if (!members.has(key) && !(key in UNDELIVERED_CATEGORIES)) empty.push(`${row.owner}: ${category}`);
    }

  assert.deepEqual(empty, [],
    "plan 3.1 promises these symbol families and nothing the port exports is classified under any " +
    "of them. Either a member is undelivered -- which is what this gate exists to surface -- or a " +
    "delivered one is unclassified. Classify it, or record who owes it in UNDELIVERED_CATEGORIES.");

  // THE OTHER DIRECTION, without which the table above is a list of excuses: an entry that has
  // quietly gained a member. Same contract `OWED` and the coverage dispositions carry -- the
  // DELETION is the record of the milestone landing it.
  const stale = [];
  for (const key of Object.keys(UNDELIVERED_CATEGORIES)) {
    const [owner, category] = key.split("|");
    const row = allowlist.owners.find((/** @type {any} */ candidate) => candidate.owner === owner);
    assert.ok(row, `UNDELIVERED_CATEGORIES names owner '${owner}', which the allowlist does not declare`);
    assert.ok(row.unenumeratedCategories.includes(category),
      `UNDELIVERED_CATEGORIES names '${key}', but '${owner}' declares no such category`);
    if (members.has(key)) stale.push(`${key} now has a classified member`);
  }
  assert.deepEqual(stale, [], "delete these UNDELIVERED_CATEGORIES entries; the deletion IS the record");
});
