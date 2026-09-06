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

test("every exported symbol is on its OWN subpath's allowlist", { skip }, async () => {
  // Per-OWNER, not against the union of every owner's symbols. The union let any subpath export any
  // other subpath's symbol -- `lokalized/parse` could have exported `createStrings` and passed --
  // which is the one thing the owner table in plan 3.1 exists to prevent. Cross-owner re-exports are
  // real but ENUMERATED there ("re-exports core's LanguageRange type and IANA metadata"), so they
  // are declared below rather than assumed.
  /** @param {string} owner @returns {any} */
  const ownerRow = (owner) => {
    const row = allowlist.owners.find((/** @type {any} */ o) => o.owner === owner);
    assert.ok(row, `plan 3.1 declares no owner named '${owner}'`);
    return row;
  };

  // Section 3.1 permits some symbol FAMILIES without naming each member -- `unenumeratedCategories`.
  // Accepting a category wholesale would gut this gate, so each such export is classified here
  // explicitly, against the OWNER that declares the category. Adding an export still costs a
  // reviewed line, and now it also costs naming the owner it belongs to.
  const CATEGORIZED = /** @type {[string, string, string][]} */ ([
    // Plan 3.5 declares all three by name — `const RETURN_KEY`, `const THROW_EXCEPTION`,
    // `function returnString(translation)` — under core's "failure policy/observer/handler types
    // and helpers" category. They are the caller-facing half of `onFailure`: a handler must be able
    // to say "throw" as well as "return the key", and the plan's own note that responses are
    // discriminated STRUCTURALLY is why they are helpers rather than tokens the library recognizes.
    ["core", "RETURN_KEY", "failure policy/observer/handler types and helpers"],
    ["core", "THROW_EXCEPTION", "failure policy/observer/handler types and helpers"],
    ["core", "returnString", "failure policy/observer/handler types and helpers"],
    // Plan 3.1 gives core the "core errors" category and plan 3.5 declares this member of it by
    // name — `const MissingTranslationError: CatchOnlyErrorClass<MissingTranslationError>`, code
    // `MISSING_TRANSLATION`, exposing its frozen `failure: TranslationFailure`. It is exported
    // because catching it is the point: a `THROW_EXCEPTION` failure response with no retained cause
    // raises one, and a consumer who cannot name the class can only match on a message.
    ["core", "MissingTranslationError", "core errors"],
    ["core", "cardinalityForNumber", "cardinal classifiers/support probes"],
    ["core", "cardinalityForOperands", "cardinal classifiers/support probes"],
    ["core", "supportedCardinalitiesForLocale", "cardinal classifiers/support probes"],
    ["core", "getSupportedCardinalityLocaleTags", "cardinal classifiers/support probes"],
    ["data/ordinal", "ordinalityForNumber", "number/operand ordinal classifiers and support probes"],
    ["data/ordinal", "ordinalityForOperands", "number/operand ordinal classifiers and support probes"],
    ["data/ordinal", "supportedOrdinalitiesForLocale", "number/operand ordinal classifiers and support probes"],
    ["data/ordinal", "getSupportedOrdinalityLocaleTags", "number/operand ordinal classifiers and support probes"],
    ["negotiate", "createLocaleNegotiator", "range parser/factory/option helpers"],
    // `Locale.LanguageRange.parse`, ported in M7 A4. It is exported rather than kept private for the
    // reason plan 3.1's category names it a "range PARSER": the JDK's own parse is a public static
    // that callers use OUTSIDE the matcher, and the corpus records that separation directly --
    // `VectorOracle:1022` parses a header into a list and only then hands it to `matchFor(List)`, so
    // a header that refuses is an error from the PARSER, while the 32-member cap is enforced by the
    // matcher on the already-expanded list. A caller who cannot reach the parser cannot reproduce
    // that split, and `bestMatchForAcceptLanguage` on the negotiator would be the only door left --
    // which is the fail-soft one, and answers the fallback where the recorded behavior throws.
    ["negotiate", "parseLanguageRanges", "range parser/factory/option helpers"],
  ]);

  /** @param {string} owner @returns {Set<string>} */
  const symbolsOwnedBy = (owner) => {
    const row = ownerRow(owner);
    const symbols = new Set(row.namedSymbols);
    // `core` owns the 61 constants through a category rather than by name.
    if (row.unenumeratedCategories.includes("all 61 named language-form constants"))
      for (const constant of allowlist.languageFormConstants) symbols.add(constant);
    for (const [categorizedOwner, symbol, category] of CATEGORIZED) {
      if (categorizedOwner !== owner) continue;
      assert.ok(
        row.unenumeratedCategories.includes(category),
        `${symbol} is classified under '${owner}' as '${category}', which that owner does not declare`,
      );
      symbols.add(symbol);
    }
    return symbols;
  };

  /**
   * The owners each subpath may export from. More than one only where plan 3.1 says so in words:
   * the root re-exports `core` and `parse` (`rootReExportsOwners`), `negotiate` re-exports core's
   * `LanguageRange` and IANA metadata, and `node` re-exports the shared load types.
   */
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

  const misplaced = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath === "./package.json") continue;

    const owners = OWNERS_BY_SUBPATH[subpath];
    assert.ok(owners, `${subpath} is exported but this test names no owner for it`);

    /** @type {Set<string>} */
    const permitted = new Set();
    for (const owner of owners) for (const symbol of symbolsOwnedBy(owner)) permitted.add(symbol);

    const moduleUrl = new URL(/** @type {any} */ (target).import, root).href;
    for (const symbol of Object.keys(await import(moduleUrl)))
      if (!permitted.has(symbol)) misplaced.push(`${subpath}: ${symbol} (owners: ${owners.join(", ")})`);
  }

  assert.deepEqual(
    misplaced,
    [],
    "exported symbols absent from their subpath's owner in plan 3.1; move them, add them to the " +
      "plan and regenerate, or stop exporting them",
  );
});

test("all 61 language-form constants are accounted for", { skip }, () => {
  assert.equal(allowlist.languageFormConstants.length, 61);
  // GrammaticalCase uses CASE_, not GRAMMATICAL_CASE_ — the prefix rule is not mechanical.
  assert.ok(allowlist.languageFormConstants.includes("CASE_NOMINATIVE"));
  assert.ok(!allowlist.languageFormConstants.some((/** @type {string} */ n) => n.startsWith("GRAMMATICAL_CASE_")));
});
