// @ts-check
/**
 * EVERY LIST THE README SPELLS OUT IS COMPARED AGAINST THE SOURCE IT DESCRIBES.
 *
 * `npm run check:readme` executes the document's samples and `npm run check:readme:packed` runs them
 * as a reader has them, but **neither can look at prose** — the limit `tools/readme-examples.mjs`
 * records in its own header, learned the day after it shipped. An enumeration is the shape of prose
 * that rots fastest and most quietly: it is written once from a measurement, it reads as settled
 * forever, and the code it describes moves underneath it.
 *
 * Both rules below are here because the enumeration HAD already drifted, and in both cases it was a
 * reader following the document who noticed rather than any gate:
 *
 *   - the browser section named FOUR Node built-ins behind `lokalized/node` where `src/node/` reaches
 *     FIVE, having never counted `node:path` in `discovery.js`;
 *   - `matchType` has EIGHT values and the README named two of them, while `types/core/index.d.ts`
 *     declares the field as `string` — so neither the document nor the compiler would tell a consumer
 *     what they can branch on. That the declaration is not a union is recorded as a maintainer's
 *     question rather than changed here: narrowing a public type can break a caller who assigns one.
 *
 * Each rule asserts a NON-EMPTY derivation first. Without that, a regex that stopped matching would
 * make the comparison trivially true, which is the failure this file exists to prevent rather than
 * to demonstrate.
 */
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = new URL("../", import.meta.url).pathname;
const readme = readFileSync(`${root}README.md`, "utf8");

test("the built-ins the README names for `lokalized/node` are the ones `src/node/` reaches", () => {
  // A PROSE ENUMERATION THAT NOBODY DERIVES IS A LIST THAT ROTS, and this one already had. The
  // section shipped naming four — `node:fs`, `node:crypto`, `node:fs/promises`, `node:url` — while
  // `src/node/discovery.js` also imports `node:path`, so a reader was told the cost of adding this
  // subpath to their map and told it slightly wrong. It was found by a reader following the section,
  // not by any gate. The sentence is now a comparison.
  const reached = new Set();
  for (const file of readdirSync(`${root}src/node`).filter((name) => name.endsWith(".js")))
    for (const match of readFileSync(`${root}src/node/${file}`, "utf8").matchAll(/["'](node:[^"']+)["']/g))
      reached.add(match[1]);

  const section = readme.slice(readme.indexOf("`lokalized/node` is deliberately absent"));
  const named = new Set([...section.slice(0, 400).matchAll(/`(node:[^`]+)`/g)].map((match) => match[1]));

  assert.ok(reached.size > 0, "no built-in found under src/node/ — the derivation is broken, not the prose");
  assert.deepEqual([...named].sort(), [...reached].sort(),
    "the README's list of the built-ins `lokalized/node` reaches has drifted from `src/node/`");
});

test("every authored copy of the eight `matchType` values agrees with every other", () => {
  // THIS COMPARED TWO COPIES AND THERE ARE SIX. Its own comment used to say "TWO independent
  // declarations exist in `src/`", which was true of `src/` and understated the repository by half:
  // `tools/conformance.mjs` and `test/locale.test.js` each author the set again as a Java-enum map,
  // and `MODULE-CONTRACTS.md` lists it in prose. A gate that compares two of six is the
  // "known-gap lists rot" shape sitting inside the instrument built to stop enumerations rotting,
  // and it stayed GREEN through the very change that made the set a public type — so it is widened
  // here rather than after the next drift ships.
  //
  // `src/internal/locale.js`'s typedef is the SOURCE OF TRUTH and every other copy is compared to
  // it. `src/core/index.js` and `src/ssr/index.js` are deliberately NOT in the list: both DERIVE
  // the union through a JSDoc `import(...)` rather than authoring it, which is why narrowing the
  // public `matchType` added zero copies. A copy that starts deriving drops out of this table by
  // ceasing to match its pattern, which fails LOUDLY here rather than going quietly uncompared.
  const read = (file) => readFileSync(`${root}${file}`, "utf8");
  const values = (text) => [...new Set([...text.matchAll(/"([a-z-]+)"|`([a-z-]+)`/g)]
    .map((m) => m[1] ?? m[2]))];

  // The anchor is the union ITSELF, not the JSDoc tag that used to carry it. `LocaleMatch` moved
  // from an `@property`-per-field typedef to a single `Readonly<{...}>` when the record was frozen
  // and every member declared `readonly`; this pattern went red on that change, which is the
  // behaviour the note above promises for a copy whose spelling moves, and it is a PIN UPDATE
  // rather than a drift — the eight values are byte-identical across it. Matching the union rather
  // than its container is what makes the next such reshaping free.
  const typedef = read("src/internal/locale.js").match(/matchType: ("[a-z-]+"\|)+"[a-z-]+"/);
  assert.ok(typedef, "the matchType typedef union was not found — the derivation is broken, not the prose");
  const declared = values(typedef[0]).sort();
  assert.ok(declared.length >= 8, "the derived matchType set collapsed");

  // Each copy: where it lives, and the slice that must hold EXACTLY these eight. Every slice is
  // bounded so the comparison is SET EQUALITY rather than a filtered subset — an ablation measured
  // what filtering cost: a ninth spelling ADDED to the README's prose, to MODULE-CONTRACTS.md's, or
  // to the conformance runner's enum map left this file at 5/5 green. Three of the five compared
  // copies could gain a value nobody would ever see. The Java-enum maps carry OTHER vocabularies in
  // the same object (`FailureReason`, `BidiIsolation`), so each is anchored on its own first and
  // last member; the two prose lists are anchored to the end of their sentence.
  const COPIES = [
    ["src/ssr/index.js", /const MATCH_TYPES = new Set\(\[([\s\S]*?)\]\)/,
      "the SSR stamp's runtime membership test"],
    // ANCHORED ON WHAT FOLLOWS THE BLOCK, not on its last member, and a negative test is why. The
    // capture must include both endpoints — anchoring BETWEEN `NONE` and `WILDCARD` dropped those
    // two from the comparison — and it must END at the next vocabulary's comment, because a slice
    // that stops at `WILDCARD` cannot see a ninth row APPENDED after it. Measured: with the slice
    // ending at the last member, `SHRUG: "shrug"` added below it left this file at 5/5 green.
    ["tools/conformance.mjs", /(\n  NONE: "none",[\s\S]*?)\n  \/\/ `BidiIsolation`/,
      "the conformance runner's Java-enum spelling map"],
    ["test/locale.test.js", /const MATCH_TYPES = \/\*\* @type \{const\} \*\/ \(\{([\s\S]*?)\}\)/,
      "the locale suite's own enum map"],
    ["README.md", /`matchType` has eight values[\s\S]*?They are ([^.]*)\./,
      "the README's prose list"],
    ["MODULE-CONTRACTS.md", /`matchType` values are the JS spellings:([^.]*)\./,
      "MODULE-CONTRACTS.md's prose list"],
  ];

  for (const [file, pattern, what] of COPIES) {
    const found = read(file).match(pattern);
    assert.ok(found, `${what} was not found in ${file} — the derivation is broken, not the prose`);
    // The LAST capture group is the bounded list; `values()` reads both quoted and backticked forms.
    const slice = found[found.length - 1] ?? "";
    assert.deepEqual(values(slice).sort(), declared,
      `${what} (${file}) has drifted from src/internal/locale.js`);
  }

  // ANTI-VACUITY. Every comparison above is set equality, so the residual risk is not a missed
  // value — it is a SLICE that silently widened to swallow a neighbouring vocabulary and then
  // matched by accident. Each list must therefore be exactly eight long BEFORE the sort compares it,
  // which a widened slice fails.
  for (const [file, pattern, what] of COPIES) {
    const found = read(file).match(pattern);
    const slice = found?.[found.length - 1] ?? "";
    assert.equal(values(slice).length, declared.length,
      `${what} (${file}) matched ${values(slice).length} values, not ${declared.length} — the slice is no longer bounded`);
  }
});

test("the per-subpath export counts the README names are the counts the package has", async () => {
  // A COUNT IS THE FASTEST-ROTTING ENUMERATION THERE IS, because nothing about the sentence looks
  // stale when a symbol lands. The eight below are in the browser section's advice about which
  // subpaths a page can load, so a reader sizing up an import map is told exactly how much surface
  // each entry buys them. Every export this project has added since M8 moved one of these numbers.
  // `(\d+(?:,\d{3})*)` and not `[\d,]+`: the greedy class swallowed the sentence's trailing comma
  // and handed `Number` the string "2,", which is NaN. The assertion below then printed two
  // identical-looking lists and failed anyway — the derivation was broken, not the prose.
  const GROUPED = String.raw`(\d+(?:,\d{3})*)`;
  const sentence = new RegExp(String.raw`the root\s+exports ${GROUPED} names, \`core\` ${GROUPED}, ` +
    String.raw`\`load\` ${GROUPED}, \`negotiate\` ${GROUPED}, \`parse\` ${GROUPED}, ` +
    String.raw`\`data/ordinal\` ${GROUPED}, \`ssr\` ${GROUPED} and\s+\`data/ranges\` ${GROUPED}`);
  const named = sentence.exec(readme);
  assert.ok(named, "the README's per-subpath export-count sentence was not found — it was reworded, " +
    "and the numbers it states are now compared against nothing");

  const order = ["lokalized", "lokalized/core", "lokalized/load", "lokalized/negotiate",
    "lokalized/parse", "lokalized/data/ordinal", "lokalized/ssr", "lokalized/data/ranges"];
  const measured = [];
  for (const specifier of order)
    measured.push(Object.keys(await import(specifier)).length);

  assert.ok(measured.every((count) => count > 0),
    "a subpath exported nothing — the derivation is broken, not the prose");
  const stated = named.slice(1).map((value) => Number(value.replace(/,/g, "")));
  assert.deepEqual(stated, measured,
    `the README's per-subpath export counts have drifted from the package: it says ` +
    `${stated.join("/")} and the subpaths export ${measured.join("/")}`);
});

test("every symbol the subpath table names is exported by the subpath its row is about", async () => {
  // THE TABLE HAD A FALSE ROW AND NOTHING COULD SEE IT. `lokalized/core` was described as "the same
  // `createStrings` … — no chooser", and `core` exports `chooseBrowserLocale` AND
  // `chooseLocaleForPreferredLanguages`. It is a markdown table, which `check:readme` is blind to by
  // construction, so the sentence was true when written and wrong ever after.
  //
  // WHAT THIS RULE CAN AND CANNOT DO, stated rather than left to be discovered: it checks that a
  // symbol a row NAMES is really there. It cannot check a row's claim that something is ABSENT,
  // which is the shape the false row had — that one was repaired by hand, and an export-count
  // comparison is the nearest derived guard for it.
  const table = readme.slice(readme.indexOf("| Import | What it is |"));
  const rows = [...table.slice(0, table.indexOf("\n\n")).matchAll(/^\| `(lokalized[^`]*)` \| (.+) \|$/gm)];
  assert.ok(rows.length >= 8, `the subpath table parsed to ${rows.length} rows — the derivation is broken`);

  let checked = 0;
  for (const [, specifier, description] of rows) {
    const exported = new Set(Object.keys(await import(/** @type {string} */ (specifier))));
    for (const [, symbol] of description.matchAll(/`([A-Za-z_$][\w$]*)`/g)) {
      ++checked;
      assert.ok(exported.has(symbol),
        `the subpath table says \`${specifier}\` is about \`${symbol}\`, and \`${specifier}\` does not export it`);
    }
  }
  assert.ok(checked >= 5, `only ${checked} symbol(s) in the table were checked — a table that names ` +
    `none would pass this rule trivially, which is the failure it exists to prevent`);
});

test("the tests `examples/README.md` names are the tests that exist beside the examples", () => {
  // A THIRD ENUMERATION, AND IT HAD ALREADY DRIFTED THE SAME WAY THE OTHER TWO DID. The sentence
  // "the tests beside these files assert them one by one" named three files; there are four —
  // `test/example-edge-capabilities.test.js` landed with M9 S6's capability-removal work, eight days
  // after the document was last touched, and nothing re-read the list. A reader auditing the
  // examples' coverage would have been told, precisely, three quarters of it.
  const examplesReadme = readFileSync(`${root}examples/README.md`, "utf8");
  const onDisk = readdirSync(`${root}test`)
    .filter((name) => /^example-.*\.test\.js$/.test(name)).map((name) => `test/${name}`).sort();
  const named = [...new Set([...examplesReadme.matchAll(/`(test\/example-[\w.-]+\.test\.js)`/g)]
    .map((match) => match[1]))].sort();

  assert.ok(onDisk.length > 0, "no test/example-*.test.js found — the derivation is broken, not the prose");
  assert.deepEqual(named, onDisk,
    "the tests `examples/README.md` names have drifted from the tests beside the examples");
});
