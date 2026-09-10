#!/usr/bin/env node
// @ts-check
/**
 * The likely-subtag CONSUMER INVENTORY, derived from the source and gated against it.
 *
 *   node tools/likely-subtag-consumers.mjs [--json <path>]
 *
 * WHY THIS EXISTS, in the words of the thing it closes. M7's acceptance row requires "complete
 * likely-subtag consumers", and the close-out audit could not mark that clause proven:
 *
 *   > A measurement gap no decision can close: the table is verified complete and lossless and every
 *   > consumer behaves under the corpus, but NO CONSUMER INVENTORY EXISTS, so "complete" is unproven
 *   > rather than false.
 *
 * So the missing artifact was an enumeration. This file is it — and it is derived from `src/` on
 * every run rather than written down, because a hand-written list is precisely the thing that had
 * already failed. Three of the four consumers the M7 brief named as "known starting points" were
 * indeed here; the fourth thing the derivation found (`preferredRegionAlias`, the SECOND read of the
 * table) was in nobody's list, and it is the one that decides which of a deprecated region's
 * replacements a tag canonicalizes to.
 *
 * WHAT IS DERIVED, and where the inventory's boundary is drawn — because "consumer" has to mean
 * something narrower than "reachable from", or the answer is "the whole library" and no reviewer can
 * act on it. Measured: the unrestricted transitive taint from this table reaches 40+ top-level
 * bindings across 12 modules, `createStrings` and `parseStrings` included. True, and useless.
 *
 * The unit here is therefore the CALL SITE of a table-derived answer, one step out:
 *
 *   TABLE           `src/data/likely-subtags.js`, whose only export is `decode`.
 *   TABLE BINDINGS  module-level bindings that hold the decoded table.
 *   DIRECT READERS  bindings that read a table binding. Two, on both sides of the port/Java line.
 *   GATEWAYS        exports of a direct-reader's module that reach the table.
 *   CONSUMERS       every binding, anywhere in `src/`, that references a direct reader or a gateway,
 *                   keyed `<module>::<enclosing binding>::<symbol>`. Line numbers are PRINTED but
 *                   are not part of the key, so an unrelated edit above a consumer does not fail
 *                   the run and a moved consumer does not read as a new one.
 *
 * WHAT KEEPS THE BOUNDARY FROM LEAKING. A consumer one step further out is by construction
 * downstream of an inventoried consumer — except along an ALIAS, which would carry a gateway across
 * the boundary invisibly.
 *
 * THIS PARAGRAPH USED TO SAY "both alias shapes JavaScript has are gated below: `export … from` and
 * `export const y = <gateway>`", AND THAT SENTENCE WAS FALSE — measured, not argued. A reviewer
 * appended each shape below to a real module in a scratch copy and ran this tool: SIX of them exited
 * 0 with a live, uninventoried consumer sitting in `src/`. All six are gated now, and the count is
 * written out rather than summarised so the next claim of completeness is checkable:
 *
 *   1. `export * from "<reader>"`      — an ExportDeclaration with NO exportClause, which the
 *                                        boundary loop skipped entirely. (`export { g } from …`,
 *                                        the named form, WAS gated; the star form was not.)
 *   2. `export { g };` with no module specifier — a bare re-export of an IMPORTED gateway. Not a
 *                                        hypothetical shape: `src/parse/index.js:45` and
 *                                        `src/internal/expression.js:70` already use this idiom.
 *   3. `export default <gateway>`      — an ExportAssignment, which was never parsed at all.
 *   4. `import * as ns from "<reader>"` — a namespace import was stored as `{module, name: "*"}`,
 *                                        never matched a gateway key, and `referencesIn` collapses
 *                                        `ns.likelySubtagFor` to `ns`. It is REFUSED rather than
 *                                        followed: resolving the property access would be the
 *                                        better fix, and refusing is the one that cannot be
 *                                        silently incomplete.
 *   5. a CLASS METHOD                  — `parseModule` collected only FunctionDeclaration and
 *                                        VariableStatement bindings, so a consumer inside a class
 *                                        was invisible. `src/` declares at least ten top-level
 *                                        classes (`MissingTranslationError`, `ResolutionFailure`,
 *                                        `LoadingSession`, `NodeBudget`, `JsonReader`, …), so this
 *                                        is an idiom here, not a corner.
 *   6. a TOP-LEVEL STATEMENT that is not a declaration — `globalThis.__leak = likelySubtagFor("ar")`
 *                                        binds nothing, so it was collected nowhere. Such statements
 *                                        are now gathered under the synthetic binding
 *                                        `<module scope>`.
 *
 * Everything else that reaches the table reaches it through a call site this file names.
 *
 * HOW IT FAILS. Symmetrically, which is the half a document cannot do:
 *
 *   - a derived consumer with no INVENTORY entry — exit 2, naming module, binding and symbol;
 *   - an INVENTORY entry that is no longer derived — exit 2, stale;
 *   - a new module importing the table, a new direct reader, a new gateway — exit 2;
 *   - an alias that carries a gateway out of the enumerated boundary — exit 2;
 *   - an evidence citation that has itself gone stale: a `diff:` naming a script `package.json`
 *     does not have, a `test:` naming a file that does not exist, a `corpus:` family no case id
 *     carries. Evidence that cannot be checked is a claim, not a measurement.
 *
 * This is the shape `tools/graph-size.mjs` uses for UNCLASSIFIED modules and `tools/conformance.mjs`
 * uses for no-counterpart claims: derive, compare, exit non-zero naming the thing.
 *
 * THE MEASUREMENT ITSELF IS NOT HERE. `npm run diff:likely-subtag` compares every consumer below
 * against the real `lokalized-java` on the pinned JDK; this file only proves the list it checks is
 * the whole list. It runs inside `npm run verify` precisely because it needs nothing but `src/` —
 * the differential needs a JDK and a built `lokalized-java` and so, like its seven siblings, stays
 * out of `verify` and must be named separately.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcRoot = join(root, "src");
const specDir = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR)
  : resolve(root, "../lokalized-spec");
const argOf = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
const jsonOut = argOf("--json");

const TABLE = "src/data/likely-subtags.js";

/* ------------------------------------------------------------------ the inventory */

/**
 * THE INVENTORY. One entry per derived consumer, keyed exactly as the derivation keys it.
 *
 * `what` is the DECISION the consumer makes from the table's answer — not a restatement of the call.
 * `evidence` is how we know that decision matches Java, and every citation is re-checked below:
 *
 *   diff:<name>     a differential in `package.json`. `diff:likely-subtag` compares the five
 *                   consumer columns directly against `lokalized-java` over 35,280 probes;
 *                   `diff:lookup` compares the END-TO-END outcome of a lookup, which is the only
 *                   instrument that can see a matcher-internal consumer at all.
 *   corpus:<family> a family of `lokalized-spec/generated/behavioral-vectors.json`, replayed by
 *                   `npm run conformance`. Checked to match at least one case id.
 *   test:<file>     a file under `test/`, run by `npm test`.
 *   NONE: <why>     no coverage. Printed in its own section and counted in the headline, because an
 *                   inventory whose entries are unverified is a list, not a proof.
 *
 * @type {Record<string, {what: string, evidence: string[]}>}
 */
const INVENTORY = {
  /* ---- the two DIRECT READS, the only places the table itself is consulted ---------------- */

  "src/internal/locale-cldr.js::likelySubtagFor::LIKELY_SUBTAGS": {
    what: "Maximizes a tag to a full language-Script-REGION triple by walking the seven-rung " +
      "candidate ladder and merging the hit over the tag's own subtags. `CldrLocaleData.java:189`.",
    evidence: ["diff:likely-subtag", "test:locale.test.js"],
  },
  "src/internal/locale-cldr.js::preferredRegionAlias::LIKELY_SUBTAGS": {
    what: "THE READ NOBODY HAD WRITTEN DOWN. Chooses among a deprecated region's CLDR replacements " +
      "(23 aliases have more than one) by maximizing the language-and-script and taking the " +
      "replacement whose likely region matches — `hy-SU` -> `hy-AM`, not `hy-RU`. " +
      "`CldrLocaleData.java:358`.",
    evidence: ["diff:likely-subtag", "corpus:m3b-canonicalization", "test:locale.test.js"],
  },

  /* ---- consumers INSIDE the direct readers' module ---------------------------------------- */

  "src/internal/locale-cldr.js::likelySubtagFor::canonicalLanguageTag": {
    what: "Maximization runs on the CANONICAL spelling, twice: once on the input tag and once on " +
      "the table's own answer. That is what makes the two table reads mutually recursive — a " +
      "multi-target region alias is resolved by a maximization, and every maximization is of a " +
      "canonicalized tag — and it is the entry this file's own author missed and its gate caught. " +
      "`CldrLocaleData.java:182`, and again at `:482` inside `maximizedLikelySubtag`.",
    evidence: ["diff:likely-subtag", "corpus:m3b-canonicalization"],
  },
  "src/internal/locale-cldr.js::languageScriptForLikelySubtag::likelySubtagFor": {
    what: "Reduces the maximization to the `language-Script` pair the matcher compares. Returns " +
      "null when either half is absent, which is what makes an unmaximizable tag ineligible for " +
      "the LIKELY_SUBTAG match tier rather than matching everything. `CldrLocaleData.java:157`.",
    evidence: ["diff:likely-subtag", "diff:lookup"],
  },
  "src/internal/locale-cldr.js::aliasLanguageTagOnce::preferredRegionAlias": {
    what: "One step of the canonicalization walk: applies language, script, region and variant " +
      "aliases, and hands the multi-target region case to the likely-subtag tiebreak above. " +
      "`CldrLocaleData.java:315`.",
    evidence: ["diff:likely-subtag", "corpus:m3b-canonicalization"],
  },
  "src/internal/locale-cldr.js::canonicalLanguageTag::aliasLanguageTagOnce": {
    what: "The fixpoint of the alias walk — the CLDR-canonical spelling of a tag. This is the " +
      "funnel through which the second table read becomes observable to every other consumer. " +
      "`CldrLocaleData.java:106`.",
    evidence: ["diff:likely-subtag", "corpus:m3b-canonicalization", "corpus:locale-identity"],
  },
  "src/internal/locale-cldr.js::equivalentTags::canonicalLanguageTag": {
    what: "Case-insensitive equality of two tags' canonical forms — Java's `equivalent`. " +
      "`CldrLocaleData.java:237`.",
    evidence: ["diff:likely-subtag", "diff:lookup", "corpus:locale-identity"],
  },
  "src/internal/locale-cldr.js::crossesLikelyScriptBoundary::languageScriptForLikelySubtag": {
    what: "Decides whether truncating one subtag off a candidate would change its likely script. " +
      "`CldrLocaleData.java:436`.",
    evidence: ["diff:likely-subtag", "diff:lookup"],
  },
  "src/internal/locale-cldr.js::addFallbackTags::languageScriptForLikelySubtag": {
    what: "Seeds the truncation walk with the REQUESTED tag's language-Script, so the boundary " +
      "above is measured against where the walk started, not against the previous rung. " +
      "`CldrLocaleData.java:381`.",
    evidence: ["diff:likely-subtag", "diff:lookup"],
  },
  "src/internal/locale-cldr.js::addFallbackTags::crossesLikelyScriptBoundary": {
    what: "STOPS subtag truncation at the boundary: `zh-Hant-TW` truncates to `zh-Hant` and no " +
      "further, because `zh` maximizes to `zh-Hans-CN`. `CldrLocaleData.java:391`.",
    evidence: ["diff:likely-subtag", "diff:lookup", "corpus:dedup-and-candidates"],
  },
  "src/internal/locale-cldr.js::fallbackLocaleTagsFor::canonicalLanguageTag": {
    what: "Runs the fallback walk over the canonical spelling as well as the requested one, which " +
      "is how an aliased tag reaches the catalogs its canonical form would. " +
      "`CldrLocaleData.java:134`.",
    evidence: ["diff:likely-subtag", "diff:lookup"],
  },
  "src/internal/locale-cldr.js::fallbackLocaleTagsFor::addFallbackTags": {
    what: "The CLDR fallback chain itself — the list `candidateChain` seeds itself from. " +
      "`CldrLocaleData.java:130`.",
    evidence: ["diff:likely-subtag", "diff:lookup", "corpus:dedup-and-candidates"],
  },

  /* ---- bidi -------------------------------------------------------------------------------- */

  "src/internal/bidi.js::localeUsesRightToLeftScript::likelySubtagFor": {
    what: "Maximizes a SCRIPT-LESS locale to decide bidi isolation: `ar` isolates because it " +
      "maximizes to `ar-Arab-EG`; `ar-Latn` does not. `BidiUtils.java:58`. The branch is reached " +
      "only when the JDK locale field is empty — `ar-Zzzz` carries a script and takes the other " +
      "branch, which is the divergence `diff:likely-subtag` found on its first run. " +
      "`diff:interpolate` compares this predicate directly and was GREEN over the defect: its 40 " +
      "RTL probes covered both branches and none of them spelled `Zzzz`. It now carries 51.",
    evidence: ["diff:likely-subtag", "diff:interpolate", "corpus:bidi-isolation", "test:bidi.test.js",
      "test:bidi-zzzz-script.test.js"],
  },

  /* ---- the matcher and the resolution core ------------------------------------------------- */

  "src/internal/locale.js::primaryLanguage::canonicalLanguageTag": {
    what: "The canonical primary language subtag, which every language-code comparison in the " +
      "matcher and every tiebreaker key is derived from.",
    evidence: ["diff:lookup", "corpus:locale-identity"],
  },
  "src/internal/locale.js::parentChain::fallbackLocaleTagsFor": {
    what: "The CLDR parent walk minus the tag itself — `candidateChain`'s seed.",
    evidence: ["diff:lookup", "corpus:dedup-and-candidates", "test:locale.test.js"],
  },
  "src/internal/locale.js::maximize::likelySubtagFor": {
    what: "The internal maximization entry point. NO `src/` caller: it is exported for tests and " +
      "for the negotiator's documented vocabulary, and is named here so that its absence from the " +
      "call graph is a recorded fact rather than an oversight.",
    evidence: ["diff:likely-subtag", "test:locale.test.js"],
  },
  "src/internal/locale.js::canonicalLanguageRangeIdentity::canonicalLanguageTag": {
    what: "Canonical identity of a language RANGE, so two spellings of the same range collapse to " +
      "one member rather than competing.",
    evidence: ["diff:lookup", "diff:language-range", "corpus:accept-language"],
  },
  "src/internal/locale.js::recognizedLanguageTagConstraintCountFor::canonicalLanguageTag": {
    what: "Counts a recognized range's constraints (language/script/region) on its CANONICAL form, " +
      "which is the specificity a LIKELY_SUBTAG-tier match is ranked by. " +
      "`DefaultStrings.java:2231`.",
    evidence: ["diff:lookup", "corpus:supplied-match"],
  },
  "src/internal/locale.js::memberStaticsFor::canonicalLanguageTag": {
    what: "Precomputes a range member's canonical spelling and subtags once per instance instead " +
      "of once per lookup.",
    evidence: ["diff:lookup", "corpus:supplied-match"],
  },
  "src/internal/locale.js::memberStaticsFor::fallbackLocaleTagsFor": {
    what: "Precomputes the member's CLDR fallback chain, canonicalized — the CLDR_FALLBACK match " +
      "tier's whole input. `DefaultStrings.java:3060`.",
    evidence: ["diff:lookup", "corpus:supplied-match", "corpus:dedup-and-candidates"],
  },
  "src/internal/locale.js::memberStaticsFor::languageScriptForLikelySubtag": {
    what: "The REQUESTED side of the likely-script comparison, precomputed. " +
      "`DefaultStrings.java:3067`.",
    evidence: ["diff:lookup", "corpus:supplied-match"],
  },
  "src/internal/locale.js::supportedLocaleStaticsFor::canonicalLanguageTag": {
    what: "The same precomputation for each SUPPORTED locale — the other side of every comparison.",
    evidence: ["diff:lookup", "corpus:supplied-match"],
  },
  "src/internal/locale.js::supportedLocaleStaticsFor::languageScriptForLikelySubtag": {
    what: "The AVAILABLE side of the likely-script comparison. `DefaultStrings.java:2995`.",
    evidence: ["diff:lookup", "corpus:supplied-match"],
  },
  "src/internal/locale.js::preferredLocaleForRange::canonicalLanguageTag": {
    what: "Resolves a wildcard-free range to a supported locale by canonical equality before any " +
      "structural or likely-subtag tier is consulted.",
    evidence: ["diff:lookup", "corpus:m3b-negotiation"],
  },
  "src/internal/locale.js::lookupMatchByLikelySubtag::languageScriptForLikelySubtag": {
    what: "THE MATCH TIER ITSELF: collects every supported locale whose likely `language-Script` " +
      "equals the range's, then tiebreaks. `DefaultStrings.java:2586-2610`.",
    evidence: ["diff:lookup", "corpus:m3b-negotiation", "corpus:supplied-match", "test:tiebreakers.test.js"],
  },
  "src/internal/locale.js::lookupMatchByFallbackCandidates::fallbackLocaleTagsFor": {
    what: "Walks the range's CLDR fallback chain looking for a supported locale, which is the tier " +
      "consulted BEFORE the likely-subtag tier and therefore decides how often it is reached.",
    evidence: ["diff:lookup", "corpus:dedup-and-candidates"],
  },
  "src/internal/locale.js::lookupMatchByFallbackCandidates::equivalentTags": {
    what: "Compares each fallback candidate against a supported locale by canonical equivalence " +
      "rather than by string equality, so an aliased catalog name still answers.",
    evidence: ["diff:lookup", "corpus:locale-identity"],
  },
  "src/internal/locale.js::languageRangeMatchTypeFor::canonicalLanguageTag": {
    what: "Re-derives the PUBLIC match type for the selected locale — the value a caller reads off " +
      "`localeMatch`, which is a separate channel from the selection itself.",
    evidence: ["diff:lookup", "corpus:supplied-match", "corpus:m3b-supplied-match"],
  },
  "src/internal/locale.js::matchForRanges::canonicalLanguageTag": {
    what: "Canonicalizes the range under consideration inside the N-member solver.",
    evidence: ["diff:lookup", "corpus:accept-language", "corpus:supplied-match"],
  },
  "src/internal/locale.js::matchForRanges::languageScriptForLikelySubtag": {
    what: "Filters the primary-language candidate set by likely-script COMPATIBILITY — a null on " +
      "either side is compatible, so an unmaximizable tag is not excluded. " +
      "`DefaultStrings.java:2412-2413`.",
    evidence: ["diff:lookup", "corpus:supplied-match"],
  },
  "src/internal/locale.js::candidateChain::fallbackLocaleTagsFor": {
    what: "Builds the per-key resolution chain — the ATTEMPTED-LOCALE list a lookup walks, which " +
      "is a different channel from the matcher's selection and legitimately disagrees with it.",
    evidence: ["diff:lookup", "corpus:dedup-and-candidates", "corpus:evaluation-locale"],
  },
  "src/internal/locale.js::candidateChain::languageScriptForLikelySubtag": {
    what: "Admits a tiebreaker locale into the chain only when its likely script is compatible " +
      "with the requested locale's. `DefaultStrings.java:2420-2421`.",
    evidence: ["diff:lookup", "corpus:dedup-and-candidates", "test:tiebreakers.test.js"],
  },
  "src/internal/locale.js::candidateChain::equivalentTags": {
    what: "Deduplicates the chain by canonical equivalence rather than by spelling.",
    evidence: ["diff:lookup", "corpus:dedup-and-candidates"],
  },

  /* ---- plural ------------------------------------------------------------------------------ */

  "src/internal/plural.js::localeCandidates::canonicalLanguageTag": {
    what: "Plural-rule lookup canonicalizes where the catalog loader does not, so `iw` finds " +
      "`he`'s rules and `aa-Saaho` finds `ssy`'s. `CldrPluralRules.java:245`.",
    evidence: ["diff:likely-subtag", "corpus:numeric-boundaries", "corpus:classifier", "test:plural.test.js"],
  },

  /* ---- createStrings ----------------------------------------------------------------------- */

  "src/core/index.js::isFallbackFor::equivalentTags": {
    what: "The `isFallback` flag on a result: true when the resolved locale is not equivalent to " +
      "the looked-up one. Canonical equivalence, so an alias does not read as a fallback.",
    evidence: ["diff:lookup", "corpus:evaluation-locale", "corpus:resolution"],
  },
  "src/core/index.js::createStrings::equivalentTags": {
    // CORRECTED 2026-09-09. This entry used to read "Construction-time duplicate detection across
    // supplied catalog tags … `DefaultStrings.java:277-282`", and it described a DIFFERENT CALL
    // than the one it is keyed to. The only `equivalentTags` inside `createStrings` is
    // `src/core/index.js:819`; duplicate detection is done 50 lines earlier by `normalizeTag` plus a
    // catalog-map key collision (`DefaultStrings.java:280`) and consults `equivalentTags` nowhere.
    // Nothing here can catch that: the key resolved, the citations resolved, and the gate was green
    // over a wrong sentence. An entry's `what` is read by people, so it is the half a machine cannot
    // hold — which is the reason to state the failure rather than to quietly repair it.
    what: "Resolves the configured fallback locale to a supplied catalog by CANONICAL EQUIVALENCE, " +
      "and refuses construction when nothing matches — the fallback would otherwise name no loaded " +
      "catalog and every exhausted walk would be served by whichever catalog happened to be there. " +
      "`DefaultStrings.java:304-314`. Same decision `chooseLocaleForPreferredLanguages` makes at " +
      "`:1742`, one entry below.",
    evidence: ["corpus:owed-init", "test:construct-refusals.test.js", "test:construction-ingress.test.js"],
  },
  "src/core/index.js::chooseLocaleForPreferredLanguages::equivalentTags": {
    what: "Resolves the configured fallback locale to a supported catalog inside the browser " +
      "chooser, by canonical equivalence rather than by spelling.",
    evidence: [
      // The RULE is measured — `equivalentTags` itself is a `diff:likely-subtag` column and a
      // `diff:lookup` path — and the chooser's MATCH answers come from Java-emitted `expected`
      // blocks. Its own use of the rule does not, and cannot:
      "corpus:browser-chooser",
      "test:browser-chooser.test.js",
      "NONE: this consumer has no Java counterpart TO agree with. Clause 14 makes the chooser " +
        "explicitly NON-PARITY — it truncates at 32 ranges where `matchForLanguageRanges` throws — " +
        "so no probe of `lokalized-java` can observe this call. What IS measured is the rule it " +
        "applies (`equivalentTags`, a diff:likely-subtag column) and the answers it produces " +
        "(oracle-emitted `expected` blocks across 120 browser-chooser cases). The composition of " +
        "the two is asserted by test/browser-chooser.test.js against the port alone.",
    ],
  },
  "src/core/index.js::resolveFallbackLocale::canonicalLanguageTag": {
    what: "Resolves the configured fallback locale to a LOADED catalog through the same tiebreaker " +
      "map per-lookup resolution reads. `DefaultStrings.java:446-470`.",
    evidence: ["diff:lookup", "corpus:fallback-policy", "test:tiebreaker-normalization.test.js"],
  },
};

/**
 * The Java side, asserted by `tools/likely-subtag-diff/run.mjs` on every run of the differential and
 * recorded here so the two inventories can be read side by side. Kept as prose, not as a gate: this
 * file must run in a checkout with no `lokalized-java`, and a gate whose input may be absent either
 * skips (and has stopped gating) or fails a legitimate checkout. The differential owns that gate.
 */
const JAVA_MIRROR = [
  "CldrLocaleData.java:189  likelySubtagFor        <- the maximization",
  "CldrLocaleData.java:358  preferredRegionAlias   <- the multi-target region alias tiebreak",
];

/* ------------------------------------------------------------------ derivation */

/** @param {string} dir @returns {string[]} */
function jsFilesUnder(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...jsFilesUnder(path));
    else if (entry.endsWith(".js")) files.push(path);
  }
  return files.sort();
}

/**
 * Every identifier read inside a declaration's subtree, with its line.
 *
 * Property NAMES are skipped (`parts.script` reads `parts`, not `script`) — without that, a consumer
 * would be invented for every object that happens to carry a key spelled like a gateway. The
 * declaration's own name is skipped too, so a recursive function is not its own consumer.
 *
 * @param {ts.Node} node
 * @param {ts.SourceFile} sourceFile
 */
function referencesIn(node, sourceFile) {
  /** @type {{name: string, line: number}[]} */
  const references = [];
  /** @param {ts.Node} child */
  const visit = (child) => {
    if (ts.isPropertyAccessExpression(child)) {
      visit(child.expression);
      return;
    }
    if (ts.isPropertyAssignment(child) && !ts.isComputedPropertyName(child.name)) {
      visit(child.initializer);
      return;
    }
    // A class MEMBER's own name is a declaration, not a read — same rule as a property name above,
    // and it matters now that class declarations are collected: a method spelled like a gateway
    // would otherwise invent a consumer that does not exist.
    if ((ts.isMethodDeclaration(child) || ts.isPropertyDeclaration(child) ||
      ts.isGetAccessorDeclaration(child) || ts.isSetAccessorDeclaration(child)) && child.name) {
      child.forEachChild((grandchild) => {
        if (grandchild !== child.name) visit(grandchild);
      });
      return;
    }
    if (ts.isIdentifier(child)) {
      references.push({ name: child.text, line: sourceFile.getLineAndCharacterOfPosition(child.getStart(sourceFile)).line + 1 });
      return;
    }
    child.forEachChild(visit);
  };
  node.forEachChild(visit);
  return references;
}

/** The synthetic binding that carries top-level statements which declare nothing. */
const MODULE_SCOPE = "<module scope>";

/** @param {string} file */
function parseModule(file) {
  const text = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

  /** @type {Map<string, {module: string, name: string}>} */
  const imports = new Map();
  /** @type {Map<string, {module: string, name: string}>} */
  const reexports = new Map();
  /** @type {Map<string, {kind: "function" | "variable" | "class" | "module scope", exported: boolean, line: number, references: {name: string, line: number}[], aliasOf: string | null}>} */
  const bindings = new Map();
  /** @type {Map<string, string>} */
  const localExports = new Map();
  /** Modules namespace-imported by this one (`import * as ns from "./x.js"`) -> local name. */
  /** @type {Map<string, string>} */
  const namespaceImports = new Map();
  /** `export *` re-export targets, which carry EVERY export of the target and name none of them. */
  /** @type {string[]} */
  const starReexports = [];
  /** `export default <identifier>` — the source identifier, or null when it is an expression. */
  /** @type {{name: string | null, line: number}[]} */
  const defaultExports = [];
  /** Top-level statements that declare nothing; folded into the synthetic `<module scope>` binding. */
  /** @type {{name: string, line: number}[]} */
  const moduleScopeReferences = [];

  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const isExported = (node) =>
    Boolean(/** @type {any} */ (node).modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = /** @type {any} */ (statement.moduleSpecifier).text;
      if (typeof specifier !== "string" || !specifier.startsWith(".")) continue;
      const module = relative(root, resolve(dirname(file), specifier));
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const element of named.elements)
          imports.set(element.name.text, { module, name: (element.propertyName ?? element.name).text });
      if (named && ts.isNamespaceImport(named)) {
        imports.set(named.name.text, { module, name: "*" });
        namespaceImports.set(module, named.name.text);
      }
      if (statement.importClause?.name) imports.set(statement.importClause.name.text, { module, name: "default" });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier = /** @type {any} */ (statement.moduleSpecifier)?.text;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const source = (element.propertyName ?? element.name).text;
          if (typeof specifier === "string" && specifier.startsWith("."))
            reexports.set(element.name.text, { module: relative(root, resolve(dirname(file), specifier)), name: source });
          else localExports.set(element.name.text, source);
        }
      } else if (!statement.exportClause && typeof specifier === "string" && specifier.startsWith(".")) {
        // `export * from "./x.js"`. It has no exportClause at all, so the named-export branch above
        // never sees it — the shape that made the docblock's "both alias shapes" claim false.
        starReexports.push(relative(root, resolve(dirname(file), specifier)));
      }
      continue;
    }

    // `export default <thing>`. Never parsed before, so a gateway could leave through it unnamed.
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression))
        defaultExports.push({ name: statement.expression.text, line: lineOf(statement) });
      else {
        defaultExports.push({ name: null, line: lineOf(statement) });
        moduleScopeReferences.push(...referencesIn(statement, sourceFile));
      }
      continue;
    }

    // A class is a binding whose METHODS are call sites. `src/` has at least ten top-level classes,
    // so omitting this made an entire idiom invisible to the derivation.
    if (ts.isClassDeclaration(statement) && statement.name) {
      bindings.set(statement.name.text, {
        kind: "class",
        exported: isExported(statement),
        line: lineOf(statement),
        references: referencesIn(statement, sourceFile),
        aliasOf: null,
      });
      if (isExported(statement)) localExports.set(statement.name.text, statement.name.text);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bindings.set(statement.name.text, {
        kind: "function",
        exported: isExported(statement),
        line: lineOf(statement),
        references: referencesIn(statement, sourceFile),
        aliasOf: null,
      });
      if (isExported(statement)) localExports.set(statement.name.text, statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        bindings.set(declaration.name.text, {
          kind: "variable",
          exported: isExported(statement),
          line: lineOf(declaration),
          references: referencesIn(declaration, sourceFile),
          // `export const y = someImportedFunction` — the one alias shape that would carry a
          // gateway across the inventory boundary without a call site to name it.
          aliasOf: initializer && ts.isIdentifier(initializer) ? initializer.text : null,
        });
        if (isExported(statement)) localExports.set(declaration.name.text, declaration.name.text);
      }
      continue;
    }

    // Everything else at module scope declares nothing — `globalThis.x = gateway(...)`, a top-level
    // `if`, a bare call. It was collected NOWHERE, so a consumer written this way was invisible.
    moduleScopeReferences.push(...referencesIn(statement, sourceFile));
  }

  if (moduleScopeReferences.length > 0)
    bindings.set(MODULE_SCOPE, {
      kind: "module scope",
      exported: false,
      line: moduleScopeReferences[0]?.line ?? 1,
      references: moduleScopeReferences,
      aliasOf: null,
    });

  return {
    file: relative(root, file),
    imports,
    reexports,
    bindings,
    localExports,
    namespaceImports,
    starReexports,
    defaultExports,
  };
}

const modules = new Map(jsFilesUnder(srcRoot).map((file) => {
  const parsed = parseModule(file);
  return [parsed.file, parsed];
}));

const failures = [];

/* The table itself: one export, `decode`. Anything else and the seed below is incomplete. */
const table = modules.get(TABLE);
if (!table) {
  console.error(`FAILED: ${TABLE} does not exist. The likely-subtag inventory has no seed.`);
  process.exit(2);
}
const tableExports = [...table.localExports.keys()].sort();
if (tableExports.join(",") !== "decode")
  failures.push(
    `${TABLE} exports [${tableExports.join(", ")}]; this tool seeds the derivation from \`decode\` ` +
      "alone, so any other export is an unseeded path to the table. Extend the seed.",
  );

/* Which modules import the table at all? */
const tableImporters = [...modules.values()]
  .filter((module) => [...module.imports.values()].some((imported) => imported.module === TABLE))
  .map((module) => module.file);

/**
 * Table bindings, direct readers and internal consumers, per importing module.
 *
 * @type {Map<string, {tableBindings: Set<string>, directReaders: Set<string>, internal: Set<string>}>}
 */
const readerModules = new Map();
for (const file of tableImporters) {
  const module = /** @type {any} */ (modules.get(file));
  /** @type {Set<string>} */
  const tableBindings = new Set(
    [...module.imports].filter(([, imported]) => imported.module === TABLE).map(([local]) => local),
  );
  // A module-level VARIABLE initialized from the decoded table is itself a table binding
  // (`const LIKELY_SUBTAGS = mapFor(decodeLikelySubtags())`). A FUNCTION that touches one is a
  // reader, not a binding — that distinction is what keeps the two tiers apart.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, binding] of module.bindings)
      if (binding.kind === "variable" && !tableBindings.has(name) &&
        binding.references.some((reference) => tableBindings.has(reference.name))) {
        tableBindings.add(name);
        changed = true;
      }
  }
  /** @type {Set<string>} */
  const directReaders = new Set();
  for (const [name, binding] of module.bindings)
    if (!tableBindings.has(name) && binding.references.some((reference) => tableBindings.has(reference.name)))
      directReaders.add(name);

  /** @type {Set<string>} */
  const internal = new Set(directReaders);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, binding] of module.bindings)
      if (!tableBindings.has(name) && !internal.has(name) &&
        binding.references.some((reference) => reference.name !== name && internal.has(reference.name))) {
        internal.add(name);
        changed = true;
      }
  }
  readerModules.set(file, { tableBindings, directReaders, internal });
}

/**
 * Gateways: `<module>|<exportName>` for every export of a reader module that reaches the table.
 * @type {Map<string, string>} gateway key -> local binding name
 */
const gateways = new Map();
for (const [file, { internal }] of readerModules) {
  const module = /** @type {any} */ (modules.get(file));
  for (const [exportName, local] of module.localExports)
    if (internal.has(local)) gateways.set(`${file}|${exportName}`, local);
}

/* ---- the derived consumer set ------------------------------------------------------------- */

/** @type {Map<string, {module: string, binding: string, symbol: string, lines: number[], scope: string}>} */
const derived = new Map();
/** @param {string} module @param {string} binding @param {string} symbol @param {number} line @param {string} scope */
function record(module, binding, symbol, line, scope) {
  const key = `${module}::${binding}::${symbol}`;
  const existing = derived.get(key);
  if (existing) existing.lines.push(line);
  else derived.set(key, { module, binding, symbol, lines: [line], scope });
}

for (const [file, { tableBindings, internal }] of readerModules) {
  const module = /** @type {any} */ (modules.get(file));
  for (const name of internal) {
    const binding = module.bindings.get(name);
    if (!binding) continue;
    for (const reference of binding.references) {
      if (reference.name === name) continue;
      if (tableBindings.has(reference.name)) record(file, name, reference.name, reference.line, "direct read");
      else if (internal.has(reference.name)) record(file, name, reference.name, reference.line, "internal");
    }
  }
}

for (const module of modules.values()) {
  if (readerModules.has(module.file)) continue;
  /** @type {Map<string, string>} local name -> gateway export name */
  const local = new Map();
  for (const [name, imported] of module.imports)
    if (gateways.has(`${imported.module}|${imported.name}`)) local.set(name, imported.name);
  if (local.size === 0) continue;
  for (const [name, binding] of module.bindings)
    for (const reference of binding.references) {
      const symbol = local.get(reference.name);
      if (symbol !== undefined) record(module.file, name, symbol, reference.line, "external");
    }
}

/* ---- the boundary: nothing may carry a gateway out of the enumeration invisibly ------------ */

for (const module of modules.values()) {
  if (readerModules.has(module.file)) continue;
  for (const [exportName, source] of module.reexports)
    if (gateways.has(`${source.module}|${source.name}`))
      failures.push(
        `${module.file} re-exports the gateway \`${source.name}\` as \`${exportName}\`. A re-export ` +
          "carries the table's answer past this inventory's boundary with no call site to name it. " +
          "Either drop the re-export or extend the derivation to follow it.",
      );
  const gatewayLocals = new Set(
    [...module.imports].filter(([, imported]) => gateways.has(`${imported.module}|${imported.name}`)).map(([name]) => name),
  );
  for (const [name, binding] of module.bindings)
    if (binding.exported && binding.aliasOf !== null && gatewayLocals.has(binding.aliasOf))
      failures.push(
        `${module.file} exports \`${name}\` as a bare alias of the gateway \`${binding.aliasOf}\`. ` +
          "Same problem as a re-export: it moves the boundary without moving the inventory.",
      );

  // SHAPE 1 — `export * from "<reader module>"`. No exportClause, so the named-export loop above
  // never sees it, and it carries EVERY gateway that module exports.
  for (const target of module.starReexports)
    for (const key of gateways.keys())
      if (key.startsWith(`${target}|`)) {
        failures.push(
          `${module.file} re-exports \`${key.split("|")[1]}\` through \`export * from "${target}"\`. ` +
            "A star re-export names nothing, so it carries every gateway of that module past this " +
            "inventory's boundary with no call site and no export name to enumerate. Replace it " +
            "with an explicit list, or extend the derivation to follow it.",
        );
        break;
      }

  // SHAPE 2 — `export { g };` with NO module specifier, where `g` is an imported gateway. Already
  // an idiom here (`src/parse/index.js:45`, `src/internal/expression.js:70`), so it is the alias
  // shape most likely to be written next.
  for (const [exportName, source] of module.localExports)
    if (gatewayLocals.has(source))
      failures.push(
        `${module.file} exports the imported gateway \`${source}\`${exportName === source ? "" : ` as \`${exportName}\``} ` +
          "through a bare `export { … }` with no module specifier. Same problem as a re-export: it " +
          "moves the boundary without moving the inventory.",
      );

  // SHAPE 3 — `export default <gateway>`. An ExportAssignment, which was not parsed at all.
  for (const { name } of module.defaultExports)
    if (name !== null && gatewayLocals.has(name))
      failures.push(
        `${module.file} exports the gateway \`${name}\` as its DEFAULT export. A default export has ` +
          "no name for the inventory to key on, which makes it the quietest of the alias shapes.",
      );

  // SHAPE 4 — `import * as ns from "<reader module>"`. REFUSED rather than followed: `referencesIn`
  // collapses `ns.likelySubtagFor` to `ns`, so following it means resolving the property access,
  // and a derivation that half-follows a namespace is worse than one that refuses it outright.
  for (const [target, local] of module.namespaceImports)
    if ([...gateways.keys()].some((key) => key.startsWith(`${target}|`)))
      failures.push(
        `${module.file} namespace-imports \`${target}\` as \`${local}\`. That module exports ` +
          "likely-subtag gateways, and a namespace import reaches every one of them under a name " +
          "this derivation cannot resolve. Import the specific gateways by name instead.",
      );
}

/* ---- evidence citations, re-checked ------------------------------------------------------- */

const packageScripts = Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {});
const corpusPath = join(specDir, "generated/behavioral-vectors.json");
if (!existsSync(corpusPath)) {
  console.error(
    `FAILED: the corpus is not at ${corpusPath}.\n` +
      "Every `corpus:` citation in this file's INVENTORY is re-checked against it, and a run that " +
      "skipped that check would report a green inventory whose evidence had never been read. Set " +
      "LOKALIZED_SPEC_DIR, or check out lokalized-spec beside this repository.",
  );
  process.exit(2);
}
const corpusFamilies = new Set(
  JSON.parse(readFileSync(corpusPath, "utf8")).cases.map((testCase) => String(testCase.id).split(".")[0]),
);

let uncovered = 0;
for (const [key, entry] of Object.entries(INVENTORY)) {
  if (entry.evidence.length === 0) failures.push(`INVENTORY['${key}'] cites no evidence at all.`);
  for (const citation of entry.evidence) {
    if (citation.startsWith("NONE:")) {
      uncovered++;
      continue;
    }
    if (citation.startsWith("diff:")) {
      if (!packageScripts.includes(citation))
        failures.push(`INVENTORY['${key}'] cites \`${citation}\`, which is not a script in package.json.`);
      continue;
    }
    if (citation.startsWith("corpus:")) {
      const family = citation.slice("corpus:".length);
      if (!corpusFamilies.has(family))
        failures.push(
          `INVENTORY['${key}'] cites corpus family \`${family}\`, which no case id carries. The ` +
            "citation is stale — the family was renamed or removed.",
        );
      continue;
    }
    if (citation.startsWith("test:")) {
      const testFile = citation.slice("test:".length);
      if (!existsSync(join(root, "test", testFile)))
        failures.push(`INVENTORY['${key}'] cites test/${testFile}, which does not exist.`);
      continue;
    }
    failures.push(
      `INVENTORY['${key}'] cites \`${citation}\`, which is not one of diff:/corpus:/test:/NONE:. An ` +
        "uncheckable citation is a claim, not a measurement.",
    );
  }
}

/* ---- the symmetric gate ------------------------------------------------------------------- */

const derivedKeys = [...derived.keys()].sort();
const declaredKeys = Object.keys(INVENTORY).sort();
const unlisted = derivedKeys.filter((key) => !Object.hasOwn(INVENTORY, key));
const stale = declaredKeys.filter((key) => !derived.has(key));

/* ------------------------------------------------------------------ report */

console.log("likely-subtag consumer inventory — derived from src/, gated against INVENTORY");
console.log(`  table            ${TABLE} (exports: ${tableExports.join(", ")})`);
console.log(`  imported by      ${tableImporters.join(", ") || "(nothing)"}`);
for (const [file, { tableBindings, directReaders }] of readerModules) {
  console.log(`  table bindings   ${file}: ${[...tableBindings].join(", ")}`);
  console.log(`  DIRECT READS     ${file}: ${[...directReaders].join(", ")}`);
}
console.log(`  gateways         ${[...gateways.keys()].map((key) => key.split("|")[1]).join(", ")}`);
console.log(`  java mirror`);
for (const line of JAVA_MIRROR) console.log(`      ${line}`);
console.log("");

/** @type {Record<string, string[]>} */
const byScope = { "direct read": [], internal: [], external: [] };
for (const key of derivedKeys) {
  const entry = /** @type {any} */ (derived.get(key));
  byScope[entry.scope]?.push(
    `  ${entry.module}:${entry.lines.join(",")}  ${entry.binding} -> ${entry.symbol}\n` +
      `      ${Object.hasOwn(INVENTORY, key) ? INVENTORY[key].what : "(NOT IN THE INVENTORY)"}\n` +
      `      evidence: ${Object.hasOwn(INVENTORY, key) ? INVENTORY[key].evidence.join("  ") : "-"}`,
  );
}
for (const [scope, lines] of Object.entries(byScope)) {
  console.log(`${scope.toUpperCase()} (${lines.length})`);
  for (const line of lines) console.log(line);
  console.log("");
}

console.log(`consumers derived ${derivedKeys.length}, declared ${declaredKeys.length}, uncovered ${uncovered}`);

if (uncovered > 0) {
  console.log("\nUNCOVERED — entries whose agreement with Java is NOT established by any measurement:");
  for (const [key, entry] of Object.entries(INVENTORY))
    for (const citation of entry.evidence) if (citation.startsWith("NONE:")) console.log(`  ${key}\n      ${citation}`);
}

if (unlisted.length) {
  failures.push(
    `${unlisted.length} consumer(s) of the likely-subtag table are NOT in the INVENTORY:\n` +
      unlisted.map((key) => {
        const entry = /** @type {any} */ (derived.get(key));
        return `    ${key}\n      at ${entry.module}:${entry.lines.join(",")} (${entry.scope})`;
      }).join("\n") +
      "\n  Add one entry each to INVENTORY in this file: what decision it makes from the table's " +
      "answer, and the measurement that shows it matches Java (diff:/corpus:/test:, or NONE: with " +
      "the reason).",
  );
}

if (stale.length)
  failures.push(
    `${stale.length} INVENTORY entr(ies) are STALE — nothing in src/ derives them any more:\n` +
      stale.map((key) => `    ${key}`).join("\n") +
      "\n  The consumer was removed or renamed. Delete the entry, or re-point it.",
  );

if (jsonOut)
  writeFileSync(
    resolve(root, jsonOut),
    `${JSON.stringify({ table: TABLE, tableImporters, gateways: [...gateways.keys()], consumers: [...derived.values()], inventory: INVENTORY }, null, 2)}\n`,
    "utf8",
  );

if (failures.length) {
  console.error("\nFAILED:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(2);
}

console.log("\nOK: every derived likely-subtag consumer is inventoried, and every citation resolves.");
