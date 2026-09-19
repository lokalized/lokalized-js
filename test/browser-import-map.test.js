import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { browserEntries } from "../tools/browser-entries.mjs";

/**
 * THE DOCUMENTED BROWSER IMPORT MAP, CHECKED AGAINST `package.json` RATHER THAN AGAINST A PATTERN —
 * M8 clause 71.
 *
 * **Why derivation and not a grep.** A pattern-matching version of this gate was prototyped and
 * measured ESCAPABLE: a README carrying three `lokalized@latest` production URLs, a map omitting
 * four of eight browser-safe subpaths, and every URL pointing at a host that does not exist passed
 * it at exit 0. The rules below take the subpath set and the file targets from `package.json`'s own
 * `exports`, so "the documentation is complete" is a comparison rather than a regex, and a new
 * export rots the docs the day it lands.
 *
 * **`./node` IS EXCLUDED, AND THAT WAS MEASURED IN A BROWSER, NOT REASONED ABOUT.** Loading the
 * documented map in Chromium and importing all nine subpaths: eight resolve — the root reports 70
 * exports, `core` 21, `load` 10, `negotiate` 6, `parse` 5, `data/ordinal` 5, `ssr` 2,
 * `data/ranges` 2 — and `lokalized/node` fails, because the browser tries to fetch `node:fs`,
 * `node:crypto`, `node:fs/promises` and `node:url` as URLs. Documenting it would hand a reader a map
 * that breaks their page.
 *
 * **WHAT THIS DOES NOT CHECK, said here rather than left to be found:** the HOST. A URL's origin is
 * a deployment's own choice and no assertion here can tell a real CDN from a typo. What is checked
 * is the PATH — that each entry ends in the file `exports` names — and that the version is pinned.
 */

const root = new URL("../", import.meta.url).pathname;
const readme = readFileSync(`${root}README.md`, "utf8");
const manifest = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

/**
 * Every subpath a browser can load, and the BUILT file it is served as.
 *
 * **M-R S9 MOVED THIS FROM `src/` TO `dist/browser/`, and the derivation moved with it.** The
 * documented maps used to point at raw source — 31 requests for the root where the built artifact
 * is one — and the targets here were `exports`'s own `.import` values. They now come from
 * `tools/browser-entries.mjs`, the single `exports`-key → output-path mapping that
 * `tools/build-browser.mjs` ALSO reads, so a rename in the builder cannot leave this gate asserting
 * the old name and passing. `./node` is filtered there, once.
 *
 * **THIS FILE DELIBERATELY DOES NOT READ `dist/browser/build-manifest.json`.** `dist/` is absent
 * from a fresh checkout and is written by `prepack`, so a gate reading it would skip or crash in CI
 * — and reading it opportunistically when present is worse than either, because the test would then
 * check more on a developer's machine than in CI and would compare the documentation against a
 * stale build left behind by the last `npm run build:browser`. The chain is transitive instead, and
 * both links are enforced: this holds the README to the derivation, and `check:dist` holds the
 * BUILT artifact to the same derivation exactly.
 */
const browserTargets = Object.fromEntries(
  browserEntries(manifest.exports).map((entry) => [entry.specifier, entry.published]),
);

/**
 * The `imports` member of EVERY import map in the README, not merely the first.
 *
 * It read only the first until a second one landed — a local `./node_modules/…` form, added because
 * a reader following this section measured that the documented host `cdn.example` does not resolve
 * and the package is not on the registry, so the section could not be followed literally at all. A
 * rule that checks the first map would have let the second ship with two of the eight subpaths,
 * which is a reader whose `lokalized/load` import fails. Every map handed to a reader is complete or
 * it is broken guidance.
 */
function documentedMaps() {
  const maps = [];
  let open = readme.indexOf('<script type="importmap">');
  assert.notEqual(open, -1, "the README documents no import map at all");
  while (open !== -1) {
    const close = readme.indexOf("</script>", open);
    maps.push(JSON.parse(readme.slice(open + '<script type="importmap">'.length, close)).imports);
    open = readme.indexOf('<script type="importmap">', close);
  }
  return maps;
}

/**
 * Documentation a reader can reach, all of which must obey the pinning rule.
 *
 * WALKED, NOT LISTED. The hand-written list named three files and the repository has four — a fourth
 * document could have carried `lokalized@latest` and this rule would not have looked at it. That is
 * the same shape as the rule's own history: the version it replaced read ONE file and understood two
 * syntaxes. `node_modules` is excluded; nothing else is.
 */
const DOCUMENTATION = (() => {
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => readdirSync(`${root}${dir}`, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const at = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(at) : (entry.name.endsWith(".md") ? [at] : []);
  });
  const found = walk("");
  assert.ok(found.length >= 3, `only ${found.length} documentation file(s) found — the walk is broken`);
  return found;
})();

test("the derivation is not vacuous", () => {
  // Without this, an `exports` block this test failed to read would make every comparison below
  // trivially true — which is the shape the gate it replaced actually had.
  assert.ok(Object.keys(browserTargets).length >= 8, "the browser-safe subpath set collapsed");
  assert.equal(browserTargets["lokalized"], "/dist/browser/lokalized.js");
  assert.equal(browserTargets["lokalized/core"], "/dist/browser/core.js");
  assert.ok(!("lokalized/node" in browserTargets), "./node must be excluded before anything is compared");
});

test("every documented map covers exactly the browser-safe subpaths", () => {
  // A new export rots the documentation here rather than in a reader's page. `./node` failing this
  // if it were added is the point, not a side effect: it cannot load in a browser.
  const maps = documentedMaps();
  assert.ok(maps.length >= 1, "no import map was parsed");
  for (const map of maps)
    assert.deepEqual(Object.keys(map).sort(), Object.keys(browserTargets).sort());
});

test("every documented URL ends in the file `exports` names, at a pinned version", () => {
  // THE PINNING HALF APPLIES TO REMOTE URLS ONLY, and the anti-vacuity term below is what stops that
  // from hollowing the rule. A relative path into the reader's own `node_modules` carries no version
  // and cannot move under them; the hazard the rule exists for is a moving version fetched over a
  // network. Both halves of the path check still apply to every entry in every map.
  const remote = documentedMaps().filter((map) => Object.values(map).some((url) => /^https?:/.test(String(url))));
  assert.ok(remote.length >= 1, "no remote map is documented, so the pinning rule checks nothing");
  for (const [specifier, url] of Object.entries(Object.assign({}, ...remote))) {
    assert.ok(
      url.endsWith(browserTargets[specifier]),
      `${specifier} points at ${url}, which does not end in ${browserTargets[specifier]}`,
    );
    const version = /\/lokalized@([^/]+)\//.exec(url)?.[1];
    assert.ok(version, `${specifier} carries no /lokalized@<version>/ segment: ${url}`);
    assert.match(version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/,
      `${specifier} is pinned to '${version}', which is a tag rather than an exact version`);
    // SHAPE IS NOT ENOUGH, and until M-R S9 shape was all this checked: a README pinning
    // `lokalized@1.2.3` against a `package.json` reading `0.0.0` passed, which is a reader fetching
    // a version this documentation was never written for. The pin must be THIS package's version.
    assert.equal(version, manifest.version,
      `${specifier} is pinned to '${version}' and this package is version '${manifest.version}'`);
  }
});

test("every entry in every map, local or remote, ends in the file `exports` names", () => {
  for (const map of documentedMaps())
    for (const [specifier, url] of Object.entries(map))
      assert.ok(String(url).endsWith(browserTargets[specifier]),
        `${specifier} points at ${url}, which does not end in ${browserTargets[specifier]}`);
});

test("no documentation file points a reader at a moving version", () => {
  // The escapable version of this rule read ONE file and understood TWO syntaxes. This one reads
  // every documentation file and cares only that the sequence appears at all — in a map, in a
  // `<script src>`, in a dynamic import, or in a sentence.
  for (const file of DOCUMENTATION) {
    const text = readFileSync(`${root}${file}`, "utf8");
    const moving = [...text.matchAll(/lokalized@(latest|next|beta|canary|[*^~])/g)].map((match) => match[0]);
    assert.deepEqual(moving, [], `${file} points at a moving version`);
  }
});

test("the README tells a reader with an existing map to merge rather than add a second", () => {
  // The clause asks for this explicitly, and a draft of the section got the underlying fact backwards
  // — it said a document may only have one import map. Measured in Chromium: two maps on one page
  // BOTH apply. The guidance stands on merging being the portable single place a specifier resolves,
  // which is what this assertion pins.
  assert.match(readme, /merge into its `imports` member/);
  assert.match(readme, /Two maps on one page do both apply/);
});
