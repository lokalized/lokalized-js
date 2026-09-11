// @ts-check
/**
 * THE OTHER DIRECTION OF THE ALLOWLIST CONTRACT: every name the plan promises must actually exist.
 *
 * `test/symbol-allowlist.test.js` checks that everything the port EXPORTS is permitted. Nothing
 * checked the converse — that everything the allowlist NAMES is delivered — and the gap is not
 * theoretical. Measured when this file was written: **28 allowlisted named symbols are declared
 * NOWHERE in the port**, neither as a runtime export nor as an exported type, and 10 of them belong
 * to `core`, whose milestone is closed. Un-exporting an allowlisted symbol with no internal importer
 * left every existing gate at exit 0.
 *
 * A name counts as delivered if it is a runtime export OR an exported declaration, because the
 * allowlist mixes both: `createStrings` is a function and `LoadedStrings` is an interface that exists
 * only in `types/`. It counts if it appears on ANY subpath its owner may serve — the root re-exports
 * `core` and `parse`, `negotiate` re-exports core's `LanguageRange`, and `node` re-exports the shared
 * load types — so the permitted mapping is the same one the sibling test uses, kept in step by hand
 * because both encode plan 3.1's own words.
 *
 * WHAT MAKES THIS MORE THAN A TODO LIST: every undelivered name must be OWED by a named milestone,
 * and an owed name that turns up DELIVERED fails the run as stale. So the backlog cannot rot into a
 * list of excuses, and a milestone that ships a symbol is forced to record that it did — the same
 * contract `OWNER_MILESTONE` and the coverage dispositions carry.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const allowlist = JSON.parse(readFileSync(new URL("../lokalized-spec/symbol-allowlist.json", root), "utf8"));

/** Kept in step with `symbol-allowlist.test.js`'s copy by hand; both encode plan 3.1. */
const OWNERS_BY_SUBPATH = /** @type {Record<string, string[]>} */ ({
  ".": [...allowlist.rootReExportsOwners],
  "./core": ["core"],
  "./parse": ["parse"],
  "./load": ["load"],
  "./ssr": ["ssr"],
  "./negotiate": ["negotiate", "core"],
  "./node": ["node", "load"],
  "./data/ordinal": ["data/ordinal"],
  "./data/ranges": ["data/ranges"],
});

/**
 * Allowlisted names the port does not yet deliver, each attributed to the milestone that owes it.
 *
 * THE `core` AND `parse` ENTRIES PREDATE M8 AND ARE RECORDED AS FOUND, not assigned. Their milestones
 * are closed; the names are types for runtime that already ships (`Strings`, `CatalogIdentity`,
 * `OrdinalData`) or a function that was allowlisted and never written (`mergeParsedStringsFiles`,
 * which has ZERO implementation anywhere in `src/`). Whether closed milestones are reopened for them
 * or a later one adopts them is a maintainer's call; what this table does is stop them being
 * invisible, which they were until this test existed.
 */
const OWED = /** @type {Record<string, { owner: string, why: string }>} */ ({
  // --- `core`, `parse` and `negotiate`: declaration gaps in CLOSED milestones, found 2026-09-10 ---
  // Recorded AS FOUND, not assigned. These are types for runtime that already ships (`Strings`,
  // `OrdinalData`, `DataProvenance`) or, in one case, a function that was allowlisted and never
  // written: `mergeParsedStringsFiles` has ZERO implementation anywhere in `src/`. Whether a closed
  // milestone is reopened for them or a later one adopts them is the maintainer's call. What this
  // table does is stop them being invisible, which they were until this test existed.
  "core:CardinalRangeData": { owner: "UNASSIGNED", why: "type for shipped runtime; core is closed" },
  "core:DataProvenance": { owner: "UNASSIGNED", why: "type for shipped runtime; core is closed" },
  "core:DirectLocaleContext": { owner: "UNASSIGNED", why: "type for shipped runtime; core is closed" },
  "core:LanguageRange": { owner: "UNASSIGNED", why: "type for shipped runtime; core is closed" },
  "core:OrdinalData": { owner: "UNASSIGNED", why: "type for shipped runtime; core is closed" },
  "core:SourceDataProvenance": { owner: "UNASSIGNED", why: "type for shipped runtime; core is closed" },
  "core:Strings": { owner: "UNASSIGNED", why: "the central instance type; core is closed and ships it unnamed" },
  "parse:mergeParsedStringsFiles": { owner: "UNASSIGNED", why: "allowlisted with ZERO implementation anywhere in src/" },
  "negotiate:LanguageRange": { owner: "UNASSIGNED", why: "re-export of core's type; that milestone is closed" },
  "negotiate:LocaleMatcher": { owner: "UNASSIGNED", why: "negotiate type; that milestone is closed" },
  "negotiate:LocaleNegotiator": { owner: "M9", why: "plan 3.5 puts the negotiator in M9" },
  // --- M8's own remaining to-build list ---------------------------------------------------------
  // The six `load` TYPES landed in S5, `chain`/`fetchSet` in S7, and the two SSR functions in S10;
  // their entries are deleted, which is the record of it. Both planning functions were deliberately
  // KEPT here through S5 rather than declared as empty signatures, because a signature with no
  // implementation satisfies this gate while delivering nothing — and the gate would then have gone
  // quiet on the very thing it was watching.
  //
  // **THREE `core` ENTRIES WENT WITH THEM IN S10, and that is a report rather than a reassignment.**
  // `StringsLoadVerification` was M8's to build. `CatalogIdentity` and `StringsLoadCoverage` were
  // recorded UNASSIGNED against a closed milestone and are now declared in `src/core/index.js`
  // because the verification record's own type needs them — so they are delivered, incidentally, by
  // a milestone that never adopted them. The thirteen found on 2026-09-10 are therefore ten.
});

/** Names delivered somewhere an owner may live — runtime exports and exported declarations alike. */
async function deliveredByOwner() {
  /** @type {Map<string, Set<string>>} */
  const byOwner = new Map();
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath === "./package.json") continue;
    const owners = OWNERS_BY_SUBPATH[subpath];
    assert.ok(owners, `${subpath} is exported but this test names no owner for it`);

    const module = await import(new URL(/** @type {{import: string}} */ (target).import, root).href);
    const declarationPath = new URL(/** @type {{types: string}} */ (target).types, root);
    const declarations = existsSync(declarationPath) ? readFileSync(declarationPath, "utf8") : "";

    for (const owner of owners) {
      if (!byOwner.has(owner)) byOwner.set(owner, new Set());
      const names = /** @type {Set<string>} */ (byOwner.get(owner));
      for (const name of Object.keys(module)) names.add(name);
      // Exported declarations, in both spellings tsc emits: a direct `export interface X` and a
      // re-export list. A type has no runtime presence, so reading only the module would report
      // every interface in the allowlist as undelivered.
      for (const match of declarations.matchAll(/export\s+(?:declare\s+)?(?:type|interface|function|const|class)\s+([A-Za-z0-9_]+)/g))
        names.add(/** @type {string} */ (match[1]));
      for (const match of declarations.matchAll(/export\s*\{([^}]*)\}/g))
        for (const part of /** @type {string} */ (match[1]).split(","))
          names.add(part.trim().split(/\s+as\s+/).pop()?.trim() ?? "");
      // AND the JSDoc form, which is how this codebase actually declares types: `tsc` emits a
      // `@typedef` as a comment in the .d.ts rather than as `export type X`. Without this the gate
      // would report a correctly delivered type as missing — checked against the existing
      // `ParsedStringsFile`, which is a typedef and nothing else.
      for (const match of declarations.matchAll(/@typedef\s*(?:\{[^}]*\})?\s*([A-Za-z0-9_]+)/g))
        names.add(/** @type {string} */ (match[1]));
    }
  }
  return byOwner;
}

test("every allowlisted name is delivered, or owed by a named milestone", async () => {
  const delivered = await deliveredByOwner();
  const undeclared = [];
  for (const owner of allowlist.owners) {
    const names = delivered.get(owner.owner) ?? new Set();
    for (const name of owner.namedSymbols ?? [])
      if (!names.has(name) && !(`${owner.owner}:${name}` in OWED)) undeclared.push(`${owner.owner}:${name}`);
  }
  assert.deepEqual(undeclared, [],
    "the allowlist names these and the port declares them nowhere; deliver them, or record who owes them in OWED");
});

test("no OWED entry has quietly been delivered", async () => {
  const delivered = await deliveredByOwner();
  const stale = [];
  for (const [key, entry] of Object.entries(OWED)) {
    const [owner, name] = key.split(":");
    const row = allowlist.owners.find((candidate) => candidate.owner === owner);
    assert.ok(row, `OWED names owner '${owner}', which the allowlist does not declare`);
    assert.ok((row.namedSymbols ?? []).includes(name),
      `OWED names '${key}', but '${owner}' does not claim '${name}'`);
    // KEYED BY OWNER, not by name, and the distinction is load-bearing: `CatalogIdentity` is claimed
    // by BOTH `core` and `load`, and slice S5 delivered it on `lokalized/load` only. A name-keyed
    // table would have called core's entry stale too and quietly retired a gap that is still real.
    if ((delivered.get(owner) ?? new Set()).has(name))
      stale.push(`${key} (owed by ${entry.owner}) is now delivered`);
  }
  assert.deepEqual(stale, [],
    "delete these OWED entries; the deletion IS the record of the milestone landing them");
});
