// @ts-check
/**
 * Scenario 0a's frozen recipe and fixture, in their own module so the recipe can be read WITHOUT
 * running a measurement: importing `tools/scenario-0a.mjs` measures at top level. The one-off
 * migration that stamped `measurements/scenario-0a.json` with revision 1 on 2026-09-25 needed exactly
 * that, and a second copy of the recipe in whatever reads it next would drift — `tools/0b-recipe.mjs`
 * is split out for the same kind of reason. `test/scenario-0a-recipe.test.js` edits this file in a
 * copy to prove a changed recipe or fixture fails.
 *
 * The code that TAKES the measurements is `tools/0a-measure.mjs`, and its bytes are inside the recipe
 * (`RECIPE.harness`), so the recipe digest moves with the method and not only with its description.
 * The rules that hold a run to the recipe — the options handed over, each row's graph as measured and
 * as recorded, every timing, the browser half's rows — are pure functions below, which
 * `tools/scenario-0a.mjs` hands to its exit status.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (/** @type {string | Uint8Array} */ input) => createHash("sha256").update(input).digest("hex");

/** The file that takes every Node figure, whose bytes are inside the recipe digest. */
export const MEASURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "0a-measure.mjs");

/**
 * The fixed small catalog. Deliberately small: 0a measures the FLOOR, not a real app.
 *
 * Plan section 9.2 specifies TWO variants over this same content: the root with "a fixed small
 * embedded RAW-TEXT catalog", and `lokalized/core` with "its fixed ALREADY-PARSED equivalent". Until
 * M5a wired the bounded parser into `createStrings`, the raw-text form could not be constructed at
 * all, so both variants were handed the identical object and differed only by entry point — the
 * measurement did not match its own description. It does now.
 */
export const CATALOG = {
  en: {
    "Greeting": "Hello, {{name}}",
    "I read {{bookCount}} books": {
      translation: "I read {{bookCount}} {{books}}",
      placeholders: { books: { value: "bookCount", translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" } } },
    },
  },
  "en-001": { "Greeting": "Hello there, {{name}}" },
  fr: { "Greeting": "Bonjour, {{name}}" },
};
export const TIEBREAKERS = { en: ["en", "en-001"] };

/**
 * What a variant's `createStrings` is handed as `strings`. The raw-text form is built by a FUNCTION,
 * called inside the timed construction window exactly as it always was, so that the digest below
 * describes the same bytes the measurement hands over rather than a second copy of them — and that
 * is CHECKED, not only intended: `handedProblems` digests the options the harness actually passed.
 * @param {{ catalogInput: string }} variant
 */
export function catalogsFor(variant) {
  if (variant.catalogInput === "raw-text")
    return Object.fromEntries(Object.entries(CATALOG).map(([tag, doc]) => [tag, JSON.stringify(doc)]));
  if (variant.catalogInput === "parsed") return CATALOG;
  throw new Error(`unknown catalogInput ${JSON.stringify(variant.catalogInput)}`);
}

/**
 * A fixture's digest: the catalogs AS HANDED OVER plus the tiebreakers. Serialized in insertion order
 * on purpose — for the raw-text variant the bytes are the input. One rule for the digest a variant
 * DECLARES and the digest of what the harness HANDS, so the two cannot be computed two ways.
 * @param {{ strings?: unknown, tiebreakers?: unknown }} options
 */
const handedFixtureSha256 = ({ strings, tiebreakers }) => sha256(JSON.stringify({ strings, tiebreakers }));

/**
 * The fixture's digest for one variant.
 * @param {{ catalogInput: string }} variant
 */
export const fixtureSha256 = (variant) => handedFixtureSha256({ strings: catalogsFor(variant), tiebreakers: TIEBREAKERS });

/**
 * THE FROZEN RECIPE — plan 9.2:2787-2797: each scenario names its import specifier, fixed fixture
 * hashes, raw-versus-parsed input, harness, sample count and aggregation, and "changing the frozen
 * recipe, fixture, environment, method, or threshold creates a reviewed scenario revision and cannot
 * be compared as the same scenario".
 *
 * Every field is part of the scenario's identity. The digest is taken over this declared object and
 * not over this file, so a comment here does not invalidate a measurement (scenario 6's and 0b's rule).
 * The object carries the BYTES of the code that takes the measurements, in `harness`, so a comment in
 * THAT file does move it — plan 9.2:2789's "harness source and command hashes", which scenarios 1-5
 * apply to their `harness.mjs` and `measure.mjs` the same way.
 * `tools/scenario-0a.mjs` READS its variants, construction options, render and iteration count from
 * here, so the recipe describes what runs rather than sitting beside it.
 *
 * Each variant carries its fixture's digest, so a changed catalog fails in two distinct ways: the
 * catalog no longer matches the digest the recipe declares, or the declared digest was updated and
 * the recipe's own digest moved with the revision unmoved. Both are gated.
 */
export const RECIPE = Object.freeze({
  scenario: "0a",
  // 1 (2026-09-25): the method `tools/scenario-0a.mjs` has run since M5a wired the raw-text form,
  // DECLARED rather than changed, so the figures recorded since then stay comparable under it.
  // RE-DERIVED 2026-09-26, before revision 1 was ever committed, to take the bytes of the measuring
  // code (`harness` below), which moved from tools/scenario-0a.mjs into tools/0a-measure.mjs with its
  // timing windows, heap and graph arithmetic unchanged; and re-derived once more that day, still
  // uncommitted, when a review's findings changed a comment in that file and the `gated`, `browserHalf`
  // and `notFrozen` texts below. The same method, so the same revision: each time its digest was frozen
  // again, the record's `recipe` and `recipeSha256` were updated in place, and no figure was re-measured.
  // 2 (2026-09-27): `createStrings` lost its constant `locale` option before 1.0.0 (the maintainer: a
  // language fixed at construction is not acceptable; an instance needs a resolver, as Java's needs a
  // supplier). The SAME lookup locale is now answered by a resolver, so construction is handed a
  // function where it was handed a string — a changed method, hence a revision, with the fixture, the
  // render and every window unchanged.
  revision: 2,
  description: "M2 static integration: the root with a fixed small embedded raw-text catalog, and " +
    "lokalized/core with its fixed already-parsed equivalent",
  freeze: "LATE, and stated rather than smoothed over. Plan 9.2:2806 has 0a owned by M2 and frozen at M0. M0 " +
    "certification was skipped and nothing here was frozen until 2026-09-25, during M-R, after 71 recorded " +
    "rebaselines. Revision 1 declares the method the tool has used since M5a rather than choosing a new one; " +
    "it does not make the M0 deadline met.",
  artifact: "the working tree's src/, which package.json#exports ships unbundled for '.' and './core'. Not a " +
    "packed tarball, which plan 9.2's 'same packed artifact' asks for",
  variants: Object.freeze([
    Object.freeze({
      label: "root + raw-text catalog",
      specifier: "lokalized",
      entry: "src/index.js",
      catalogInput: "raw-text",
      fixtureSha256: "918cac740e657e54d1fa40262c4338a7b88d35139e831b5486a84ed1386b7d4f",
    }),
    Object.freeze({
      label: "core + parsed equivalent",
      specifier: "lokalized/core",
      entry: "src/core/index.js",
      catalogInput: "parsed",
      fixtureSha256: "f0f95c3ef8f2ac2e4d261d3d80258b8c4a49141c7678d54f70e0a02d5456c279",
    }),
  ]),
  // `localeResolverAnswers` is the tag the harness's `localeResolver` returns: a recipe is a declared
  // OBJECT and a function has no digestible value, so the recipe names the answer and the harness
  // builds the function (`handedProblems` calls it back to compare).
  construction: Object.freeze({ fallbackLocale: "en", localeResolverAnswers: "en-AU" }),
  // THE RENDER IS CHECKED, not only printed: a measurement whose first render came back as anything
  // else — the key, say — timed a failure path, and is refused rather than recorded.
  render: Object.freeze({ key: "I read {{bookCount}} books", values: Object.freeze({ bookCount: 3 }), expected: "I read 3 books" }),
  iterations: 9,
  method: "Node. Per variant, 9 iterations of: import the entry under a fresh ?m= query (which re-evaluates " +
    "the entry module alone; its dependencies load once per process, so the median import is a warm figure), " +
    "construct, first render — each timed with performance.now(), median reported. The raw-text variant's " +
    "JSON.stringify of its three documents runs inside its construction window (about 2 microseconds against a " +
    "recorded construction median of about 130, measured 2026-09-25). Retained heap is heapUsed across two forced " +
    "collections around one more import and construction, which needs --expose-gc: a run without it fails. " +
    "Modules and source bytes are tools/graph-walk.mjs over the entry's relative import graph. All of it is the " +
    "code in harness.file, whose bytes are harness.sha256",
  harness: Object.freeze({
    file: "tools/0a-measure.mjs",
    sha256: sha256(readFileSync(MEASURE_PATH)),
    command: "node --expose-gc tools/scenario-0a.mjs, which imports harness.file",
  }),
  gated: "modules and sourceBytes per variant ratchet: growth fails until re-recorded with --reason, and every " +
    "--write needs a reason and appends a chained history entry. Each row's modules and sourceBytes, as the " +
    "harness returned them and as the run records them, must equal tools/graph-walk.mjs over the variant's " +
    "declared entry, walked again apart from the harness. The render must equal render.expected. Timings and " +
    "heap are reported and never compared, and each must be present and finite, in the run and in the record " +
    "(A33 (4))",
  browserHalf: "tools/browser-0a/index.html served by tools/browser-0a/serve.mjs, one variant per page load, " +
    "merged by tools/browser-0a/record.mjs with a reason and a chained history entry. Never re-measured here; " +
    "its staleness against the Node graph is reported, never gated; it is required present: a row per variant " +
    "with its counts and finite timings; and it is bound by its digest to the newest history entry, so an edit " +
    "by hand fails. The page hands the ALREADY-PARSED catalogs to BOTH variants, so its root row's " +
    "construction does not include parsing, unlike the Node root variant above. Recorded rather than fixed: " +
    "fixing it is a new browser capture",
  notFrozen: "thresholds and regression tolerances — none exist, by A3/A4/A7 (restated as A33, 2026-09-25); " +
    "runtime version and hardware, which move only the reported timings; tools/graph-walk.mjs, which takes the " +
    "ratcheted figures and is shared with other tools and tests (subpath-graphs, scenario 2k and scenario 6 among " +
    "them), so a digest of it here would make every edit to it a 0a revision: a change to it moves the harness's " +
    "rows and their re-derivation alike, the ratchet sees any growth, and writing a shrink needs a reason; and " +
    "tools/scenario-0a.mjs, which orchestrates, judges and copies the harness's rows into the record: the " +
    "modules and sourceBytes it copies are walked again from each declared entry, the timings it rounds are held " +
    "only to being present and finite, as every timing is, and each of its rules is run by " +
    "test/scenario-0a-recipe.test.js",
});
export const recipeSha256 = sha256(JSON.stringify(RECIPE));

/**
 * EVERY REVISION'S DIGEST, FROZEN — `tools/0b-recipe.mjs`'s rule. A revision names one recipe, so
 * the rule lives here rather than in the record alone: with it only in the record, deleting the
 * record and re-recording would launder a changed recipe under its old number. What this cannot stop
 * is someone editing a digest below along with the recipe; that is a deliberate, reviewable edit to
 * a line whose only job is not to change.
 */
export const RECIPE_DIGESTS = Object.freeze({
  1: "5dd067021ed31781ed17eb165e34f7246e80a393fb1f0efccc7e6e679c332d0d",
  2: "c986ed5096eba80ad937d426016e3afa0e763a6807d986d03d5ebe39a77d4841",
});

/** The recipe's own consistency, which holds or fails whatever the record says. */
export function recipeProblems() {
  /** @type {string[]} */
  const problems = [];
  const frozen = /** @type {Record<number, string>} */ (RECIPE_DIGESTS)[RECIPE.revision];
  if (frozen === undefined)
    problems.push(`recipe revision ${RECIPE.revision} has no frozen digest in RECIPE_DIGESTS; freeze "${recipeSha256}" for it`);
  else if (frozen !== recipeSha256)
    problems.push(`the recipe has changed (${frozen.slice(0, 12)} -> ${recipeSha256.slice(0, 12)}) while revision ` +
      `stayed ${RECIPE.revision} — its declared object, or the bytes of ${RECIPE.harness.file}, which take its ` +
      `measurements. Plan 9.2:2796 — changing the recipe creates a reviewed scenario REVISION; bump it and freeze ` +
      `its digest, or put the recipe back.`);
  for (const variant of RECIPE.variants) {
    const actual = fixtureSha256(variant);
    if (actual !== variant.fixtureSha256)
      problems.push(`${variant.label}: the fixture changed (${variant.fixtureSha256.slice(0, 12)} -> ` +
        `${actual.slice(0, 12)}) and the recipe still declares the old digest. A changed fixture is a changed ` +
        `recipe: declare "${actual}" and bump the revision, or put the fixture back.`);
  }
  return problems;
}

/** Flat options compared by content, not by the order a writer spread them in. */
const sortedJson = (/** @type {object} */ value) =>
  JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/**
 * THE HARNESS IS HELD TO THE RECIPE, not trusted to follow it. The recipe declares each variant's
 * fixture and construction options, and the digest above was right by CONVENTION only: measured
 * 2026-09-25 by an adversarial review, changing the root variant's argument to
 * `catalogsFor({ catalogInput: "parsed" })` in `tools/scenario-0a.mjs`, where the harness then lived — the exact M5a defect the
 * record's `rebaselines[8]` describes, both variants handed the same parsed objects — ran at exit 0
 * and reported "fresh". `options` is the object the harness actually passed to
 * `createStrings`, kept by the measurement; its fixture must hash to what the variant declares, and
 * everything else in it must be exactly `RECIPE.construction`.
 * @param {{ label: string, catalogInput: string, fixtureSha256: string }} variant
 * @param {unknown} options
 * @returns {string[]}
 */
export function handedProblems(variant, options) {
  if (!options || typeof options !== "object")
    return [`${variant.label}: the harness never handed createStrings its options, so nothing was measured`];
  const { strings, tiebreakers, localeResolver, ...others } = /** @type {Record<string, unknown>} */ (options);
  const rest = {
    ...others,
    localeResolverAnswers: typeof localeResolver === "function" ? localeResolver() : localeResolver,
  };
  /** @type {string[]} */
  const problems = [];
  const handed = handedFixtureSha256({ strings, tiebreakers });
  if (handed !== variant.fixtureSha256)
    problems.push(`${variant.label}: the harness handed createStrings a fixture hashing ${handed.slice(0, 12)}, not the ` +
      `${variant.fixtureSha256.slice(0, 12)} the recipe declares for its ${variant.catalogInput} input`);
  if (sortedJson(rest) !== sortedJson(RECIPE.construction))
    problems.push(`${variant.label}: the harness handed construction options ${sortedJson(rest)}, not the recipe's ` +
      `${sortedJson(RECIPE.construction)}`);
  return problems;
}

/**
 * The recipe names each variant's import SPECIFIER and says the artifact is `src/` as
 * `package.json#exports` ships it; the harness imports the entry FILE. Measured 2026-09-25 by the same
 * review: pointing `exports['.'].import` at `./src/core/index.js` left the run at exit 0, measuring
 * `src/index.js` under a name that no longer resolved to it. So the two are compared.
 * @param {unknown} pkg the parsed package.json
 * @returns {string[]}
 */
export function exportProblems(pkg) {
  const manifest = /** @type {{ name?: unknown, exports?: Record<string, { import?: unknown }> }} */ (pkg ?? {});
  /** @type {string[]} */
  const problems = [];
  for (const variant of RECIPE.variants) {
    const [name, ...subpath] = variant.specifier.split("/");
    const key = subpath.length ? `./${subpath.join("/")}` : ".";
    if (manifest.name !== name) {
      problems.push(`${variant.label}: the recipe imports '${variant.specifier}', and package.json is named ` +
        `${JSON.stringify(manifest.name)}`);
      continue;
    }
    const target = manifest.exports?.[key]?.import;
    if (target !== `./${variant.entry}`)
      problems.push(`${variant.label}: the recipe measures ${variant.entry} as '${variant.specifier}', and ` +
        `package.json#exports['${key}'].import is ${JSON.stringify(target)}`);
  }
  return problems;
}

const isCount = (/** @type {unknown} */ n) => Number.isSafeInteger(n) && /** @type {number} */ (n) >= 0;
/** A value as a message shows it: NaN, undefined and null as themselves, a string quoted. */
const shown = (/** @type {unknown} */ value) => (typeof value === "string" ? JSON.stringify(value) : String(value));

/**
 * EACH ROW'S GRAPH IS ITS DECLARED ENTRY'S, DERIVED AGAIN APART FROM THE HARNESS — for the rows the
 * harness returned AND for the rows the run records, which `tools/scenario-0a.mjs`, in no digest, copies
 * out of them. The harness takes the ratcheted figures and is digested; this is the second, independent
 * hold, and the one that sees the orchestrator hand the harness some other variant or entry, or change a
 * figure on its way into the record. Measured 2026-09-26 by a review, before either hold existed: the
 * harness's `graphBytes(entry)` changed to `graphBytes("src/core/index.js")` gave the root row core's 31
 * modules / 765,955 bytes at exit 0 — a shrink, so only printed — and a bare `--write` stored it. And by a
 * second review the same day, while only the harness's rows were walked again: `sourceBytes:
 * r.sourceBytes - 5` in the copy into the record, beside 5 real bytes of growth, ran at exit 0 and printed
 * the browser half "fresh". The rows must also be the recipe's variants, one each, in its order: a row
 * missing, doubled or relabelled describes some other scenario.
 * @param {readonly any[]} rows in measurement order
 * @param {(entry: string) => { bytes: number, modules: number }} walk the graph walk, called here with
 *   each `RECIPE.variants[i].entry`
 * @param {string} [source] how a message names the rows: "the harness returned" or "this run records"
 * @returns {string[]}
 */
export function measuredGraphProblems(rows, walk, source = "the harness returned") {
  /** @type {string[]} */
  const problems = [];
  if (rows.length !== RECIPE.variants.length)
    problems.push(`${source} ${rows.length} row(s) for the recipe's ${RECIPE.variants.length} variants`);
  RECIPE.variants.forEach((variant, i) => {
    const row = rows[i];
    if (row?.label !== variant.label) {
      problems.push(`${source} ${shown(row?.label)} as row ${i}, and the recipe's variant ${i} is "${variant.label}": ` +
        "some other scenario");
      return;
    }
    const { bytes, modules } = walk(variant.entry);
    if (row.modules !== modules || row.sourceBytes !== bytes)
      problems.push(`${variant.label}: ${source} ${row.modules} modules / ${row.sourceBytes} bytes, and the recipe's ` +
        `entry ${variant.entry} walks to ${modules} / ${bytes}: some other graph`);
  });
  return problems;
}

/** A Node row's timings: reported, never compared, and each required present. */
export const NODE_TIMINGS = Object.freeze(["importMs", "constructionMs", "firstRenderMs"]);
/** The browser half's, likewise. */
export const BROWSER_TIMINGS = Object.freeze(["coldImportMs", "importMs", "constructionMs", "firstRenderMs"]);

/**
 * TIMINGS ARE REPORTED AND REQUIRED PRESENT — A33 (4), which 0b's checker already enforced and this
 * scenario did not. Measured 2026-09-26 by a review: the import timer returning NaN ran at exit 0 with
 * "NaN" printed, `--write` then stored `importMs: null` for both rows at exit 0, and deleting every
 * timing from the record's rows exited 0 too. So every Node row, measured or recorded, carries each
 * timing as a finite, POSITIVE time (Node's timer resolves far below any step measured here) and
 * retained heap as a finite number of bytes, which needs `--expose-gc`. Only presence is gated: the
 * values are never compared, so a timing that grew or shrank passes.
 * @param {unknown} rows a Node row list, measured or recorded
 * @param {string} where how to name its owner in a message
 * @returns {string[]}
 */
export function timingProblems(rows, where) {
  if (!Array.isArray(rows)) return [`${where} holds no Node rows, so no timing is present`];
  /** @type {string[]} */
  const problems = [];
  for (const row of rows) {
    for (const key of NODE_TIMINGS)
      if (!(Number.isFinite(row?.[key]) && row[key] > 0))
        problems.push(`${where}: ${row?.label} ${key} is ${shown(row?.[key])}; timings are reported and never compared, ` +
          "but each must be a finite, positive time (A33 (4): required present)");
    if (!Number.isFinite(row?.retainedBytes))
      problems.push(`${where}: ${row?.label} retainedBytes is ${shown(row?.retainedBytes)}; retained heap is reported and ` +
        "never compared, but it must be a finite number of bytes, which needs --expose-gc");
  }
  return problems;
}

/**
 * THE BROWSER HALF STAYS WHOLE. It is reported and never re-measured here — it needs a person at a
 * browser — so what a machine can hold is that it is not thinned: a row for every recipe variant, each of
 * its counts a count, and each timing present and finite. That it is not EDITED is held apart from this,
 * by its digest in the newest history entry (`tools/scenario-0a.mjs`). Not required POSITIVE, unlike a
 * Node row's: a browser's timer is coarsened (the recorded captures read in steps of 0.1 ms), so a fast
 * step can read 0.
 * @param {any} browser the record's `browser` block
 * @returns {string[]}
 */
export function browserHalfProblems(browser) {
  /** @type {string[]} */
  const problems = [];
  const variants = Array.isArray(browser?.variants) ? browser.variants : [];
  for (const { label } of RECIPE.variants) {
    const row = variants.find((/** @type {any} */ v) => v?.label === label);
    if (!row) {
      problems.push(`the browser half holds no ${label} row; it was deleted, and a Node run cannot re-derive it`);
      continue;
    }
    for (const key of ["resources", "encodedBytes", "decodedBytes"])
      if (!isCount(row[key])) problems.push(`the browser half's ${label} ${key} is ${shown(row[key])}, not a count`);
    for (const key of BROWSER_TIMINGS)
      if (!(Number.isFinite(row[key]) && row[key] >= 0))
        problems.push(`the browser half's ${label} ${key} is ${shown(row[key])}; timings are reported and never ` +
          "compared, but each must be a finite time (A33 (4): required present)");
  }
  return problems;
}
