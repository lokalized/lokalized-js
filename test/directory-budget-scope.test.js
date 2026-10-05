// @ts-check
/**
 * WHICH CHILDREN EACH DIRECTORY BUDGET CHARGES — M8 acceptance clauses 54 and 55.
 *
 * The directory loader carries two budgets that both count children and count DIFFERENT ones:
 * `maximumDiscoveryEntries` charges every child the walk sees — regular files, subdirectories,
 * dotfiles and junk alike, before any filter — while `maximumLocalizedStringsFiles` charges only
 * the files actually PARSED. Clause 55 is the complement of clause 54 and the pair is only
 * observable in a directory where those two counts DIFFER.
 *
 * **THE CORPUS CANNOT SEE IT, and this was measured rather than assumed.** Ablating the file budget
 * so every parsed file charges it twice turns 7 corpus cases red, named by
 * `loading-limits.files.manifest-of-256-fits-the-default` — so the budget is exercised and its
 * boundary is pinned. But that fixture is 256 catalogs and NOTHING ELSE: with no unparsed children,
 * charging directory entries and charging parsed files are the same number, and an implementation
 * that charged entries scores identically on all 145 `load` cases. The distinction the clause is
 * about is exactly the one the corpus never sets up.
 *
 * That is the same shape as `test/directory-session.test.js` one budget over, and the discriminating
 * fixture is the same idea: a directory whose two counts disagree.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { readStringsFromDirectory } from "../src/node/index.js";

// Every fixture lives under ONE directory, removed when this file's tests finish. Until 2026-09-23
// each fixture was its own directory in the system temp folder and nothing removed it: 1,815
// `lokalized-budget-*` directories were counted there, three per run.
const scratch = mkdtempSync(join(tmpdir(), "lokalized-budget-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Two loadable catalogs among five children, so "entries" and "parsed files" are 5 and 2.
 *
 * Each of the three non-catalogs is skipped by a DIFFERENT rule, so no single filter carries the
 * fixture: a subdirectory (skipped by the directory test), a dotfile (skipped by the name test, and
 * note it ends `.json` so only the leading dot excludes it), and a plain name that maps to no
 * language tag. A fixture whose junk was all of one kind would still discriminate the budget, but it
 * would silently stop discriminating the moment one filter was reordered.
 */
function mixedDirectory() {
  const directory = mkdtempSync(join(scratch, "mixed-"));
  writeFileSync(join(directory, "en.json"), '{"A":"a"}');
  writeFileSync(join(directory, "fr.json"), '{"A":"a"}');
  writeFileSync(join(directory, ".hidden.json"), '{"A":"a"}');
  writeFileSync(join(directory, "README"), "not a catalog");
  mkdirSync(join(directory, "sub"));
  return directory;
}

test("the FILE budget charges only the files actually parsed, not the directory's children", () => {
  const directory = mixedDirectory();

  // THE DISCRIMINATING CASE. Five children, two of them parsed. At a budget of 2 a loader that
  // charges parsed files succeeds; one that charges children has already spent 5.
  const loaded = readStringsFromDirectory(directory, { limits: { maximumLocalizedStringsFiles: 2 } });
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);

  // THE CONTROL, without which the assertion above passes over a budget that is never enforced at
  // all: one below the parsed count must refuse.
  assert.throws(
    () => readStringsFromDirectory(directory, { limits: { maximumLocalizedStringsFiles: 1 } }),
    /localized strings file limit of 1/,
  );
});

test("the DISCOVERY budget charges every child, including the three that are never parsed", () => {
  // The complement, in the same fixture — which is what makes the pair a measurement rather than two
  // assertions that happen to agree. The same five children cost 5 here and 2 above.
  const directory = mixedDirectory();

  assert.deepEqual(
    Object.keys(readStringsFromDirectory(directory, { maximumDiscoveryEntries: 5 }).catalogs).sort(),
    ["en", "fr"],
    "five children fit a discovery budget of five",
  );

  assert.throws(
    () => readStringsFromDirectory(directory, { maximumDiscoveryEntries: 4 }),
    /exceeds the aggregate maximum of 4 discovery entries/,
    "the two unparsed files and the subdirectory each cost an entry",
  );
});

test("the two budgets are independent: each refuses on its own terms", () => {
  // A budget generous for one and tight for the other must refuse for the RIGHT reason. Without
  // this, a port that fused the two counters into one would satisfy both tests above — it would
  // charge 5 to both budgets and still pass the 5/2 pair by coincidence of the numbers chosen.
  const directory = mixedDirectory();

  assert.throws(
    () => readStringsFromDirectory(directory, {
      maximumDiscoveryEntries: 3,
      limits: { maximumLocalizedStringsFiles: 256 },
    }),
    /discovery entries/,
    "plenty of file budget, not enough discovery budget",
  );

  assert.throws(
    () => readStringsFromDirectory(directory, {
      maximumDiscoveryEntries: 64,
      limits: { maximumLocalizedStringsFiles: 1 },
    }),
    /localized strings file limit/,
    "plenty of discovery budget, not enough file budget",
  );
});
