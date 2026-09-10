// @ts-check
/**
 * The directory loader threads ONE load session across every file it parses.
 *
 * THIS TEST EXISTS BECAUSE THE CORPUS CANNOT SEE THE DIFFERENCE. Java constructs a single
 * `LoadingSession` per `loadFromFilesystem` call, so the four AGGREGATE budgets — total input bytes,
 * localized-strings files, translation nodes and warnings — accumulate ACROSS a directory. Measured
 * over the 145 `load` cases: no case combines multiple warnings with multiple files, and every
 * `maximumTotalInputBytes` and `maximumTranslationNodes` fixture is single-file, so a port that
 * built a FRESH session per file scores identically on all 145 and ships a wrong loader invisibly.
 *
 * That is this project's "the corpus is a floor, not a proof" lesson in its most literal form, and
 * the discriminating experiment is the one the corpus never runs: two files that each fit a budget
 * on their own and together do not.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readStringsFromDirectory } from "../src/node/index.js";

/** @param {Record<string, string>} files */
function directoryOf(files) {
  const directory = mkdtempSync(join(tmpdir(), "lokalized-session-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(directory, name), contents);
  return directory;
}

// Two single-key files: one translation node each, two across the directory.
const TWO_FILES = { en: '{"A":"a"}', fr: '{"A":"a"}' };

test("translation nodes accumulate across files, not per file", () => {
  const directory = directoryOf(TWO_FILES);

  // The CONTROL that makes the assertion mean something: the budget that fits both must load. A
  // per-file session passes this too, which is exactly why it cannot be the only assertion.
  const loaded = readStringsFromDirectory(directory, { limits: { maximumTranslationNodes: 2 } });
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);

  // THE DISCRIMINATING CASE. Each file needs 1 node and would pass alone at a budget of 1; only a
  // SHARED session refuses the pair. A port with a fresh session per file loads this happily.
  assert.throws(
    () => readStringsFromDirectory(directory, { limits: { maximumTranslationNodes: 1 } }),
    /localized strings load exceeds the aggregate maximum of 1 translation nodes/,
  );
});

test("input bytes accumulate across files, not per file", () => {
  const directory = directoryOf(TWO_FILES);
  const total = Buffer.byteLength(TWO_FILES.en) + Buffer.byteLength(TWO_FILES.fr);

  const loaded = readStringsFromDirectory(directory, { limits: { maximumTotalInputBytes: total } });
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);

  assert.throws(
    () => readStringsFromDirectory(directory, { limits: { maximumTotalInputBytes: total - 1 } }),
    /localized strings load exceeds the aggregate maximum of \d+ input bytes/,
  );
});

test("the file count is charged only for files that were actually parsed", () => {
  // Java charges `maximumLocalizedStringsFiles` at parse time, NOT per directory entry: a directory
  // of six entries with two loadable files passes at 2. A port that decremented one budget per
  // directory entry fails here while passing every single-file case.
  const directory = directoryOf({
    ...TWO_FILES,
    "README.md": "not a locale",
    "notes.txt": "also not",
    ".hidden": "skipped by name",
  });
  const loaded = readStringsFromDirectory(directory, { limits: { maximumLocalizedStringsFiles: 2 } });
  assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["en", "fr"]);

  assert.throws(
    () => readStringsFromDirectory(directory, { limits: { maximumLocalizedStringsFiles: 1 } }),
    /exceeds the aggregate localized strings file limit of 1/,
  );
});

test("the discovery budget charges every child, before every filter", () => {
  // The opposite charge model to the one above, and the contrast is the point: discovery counts
  // entries the loader will go on to SKIP, so a directory of two junk files refuses at a limit of 1
  // and succeeds — with an empty result — at 2.
  const directory = directoryOf({ "README.md": "junk", "notes.txt": "junk" });

  const loaded = readStringsFromDirectory(directory, { maximumDiscoveryEntries: 2 });
  assert.deepEqual(Object.keys(loaded.catalogs), []);

  assert.throws(
    () => readStringsFromDirectory(directory, { maximumDiscoveryEntries: 1 }),
    /localized strings load exceeds the aggregate maximum of 1 discovery entries/,
  );
});

test("the discovery limit is validated before any filesystem access", () => {
  // Refused at construction, the way Java's options builder refuses it before a loader ever runs —
  // so a nonexistent directory is never even consulted.
  for (const bad of [0, -1, 1_000_001, 1.5]) {
    assert.throws(
      () => readStringsFromDirectory("/nonexistent-directory-for-this-test", { maximumDiscoveryEntries: bad }),
      /maximumDiscoveryEntries must be between 1 and 1000000/,
      `maximumDiscoveryEntries=${bad} must be refused`,
    );
  }
  // The control: a legal value gets past validation and reaches the filesystem, where the missing
  // directory is what fails. Without it the assertions above would pass on a loader that refused
  // every value.
  assert.throws(
    () => readStringsFromDirectory("/nonexistent-directory-for-this-test", { maximumDiscoveryEntries: 1 }),
    /does not exist/,
  );
});
