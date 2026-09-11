// @ts-check
/**
 * `lokalized/ssr` has no route to a kernel, a data table or a planner — plan 6.4's one PROHIBITION.
 *
 * **A PROHIBITION IS INVISIBLE TO A RESULT ASSERTION, which is why this file is shaped like the rule
 * rather than like a behaviour.** Plan 6.4 states three things the SSR module must never do: it
 * "never recomputes a candidate/fetch plan with its own kernel", it "never reimplements direct
 * matching or substitutes its own core/data copy", and every producer/data/mode field in a stamp
 * comes from the verified record "never from the SSR module's own constants". Every one of those is
 * satisfiable-looking from the outside: a module that imported `candidateChain` and then happened not
 * to call it would pass every test in `test/ssr-stamp.test.js`, and one that imported the pinned CLDR
 * provenance and copied the renderer's values anyway would pass those too — until the day two
 * installed copies disagree, which is the only day any of this matters.
 *
 * So the gate walks the module graph. It is the same walk `scenario:0a` and `subpath:graphs` use, for
 * the reason recorded there: two copies of a non-obvious walk drift, and this one has to see bare
 * side-effect imports and dynamic `import()` as well as `from "…"`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";

import { graphBytes, withoutComments } from "../tools/graph-walk.mjs";

const root = new URL("../", import.meta.url).pathname;
const graph = graphBytes(root, "src/ssr/index.js");
const relative = graph.files.map((file) => file.slice(root.length));

test("the SSR graph is exactly its own module plus the shared error factory", () => {
  // An EXACT set, not a count and not a floor. A count would accept a swap, and this project has
  // already measured that gap once: `test/pinned-data-only.test.js`'s own comment records that the
  // byte ratchet is "a PROXY for this invariant, and a weak one". Two modules is small enough that
  // the exact list is the cheapest correct assertion.
  assert.deepEqual(relative, ["src/internal/configuration-error.js", "src/ssr/index.js"]);
});

test("nothing in the SSR graph can reach the locale kernel, the planner or the pinned data", () => {
  // Stated as its own assertion even though the exact-set test above implies it today, because the
  // two fail differently: that one goes red when the graph MOVES, and this one names WHICH rule was
  // broken when it does. The forbidden list is the plan's three prohibitions, spelled as paths.
  for (const forbidden of [
    "src/internal/locale.js",   // the candidate/fetch kernel and every normalization in it
    "src/load/planning.js",     // `chain` and `fetchSet` — the fetch plan itself
    "src/load/index.js",
    "src/core/index.js",        // direct matching, which 6.4 says must never be reimplemented here
  ])
    assert.ok(!relative.includes(forbidden),
      `lokalized/ssr must not reach ${forbidden}; plan 6.4 requires it to ask the RENDERING instance`);

  assert.equal(relative.filter((file) => file.startsWith("src/data/")).length, 0,
    "lokalized/ssr must carry no pinned data of its own; a stamp describes the renderer's data");
});

test("the SSR module declares no identity constant of its own", () => {
  // The graph check above proves it cannot IMPORT one. This proves it does not SPELL one — the
  // failure mode where a helper hard-codes the version it was published with and stamps every
  // renderer with it. Derived from the stamp's own field names rather than from a list, so a new
  // identity field is covered the day it is added.
  // COMMENTS STRIPPED FIRST, with the same helper the graph walk uses. The plan's own type block is
  // transcribed into this file's JSDoc and spells `producerImplementation: "lokalized-js"` — scanning
  // the raw text would match the documentation of the rule and call it a violation of it.
  const source = withoutComments(readSsrSource());
  for (const field of [
    "producerImplementation", "producerVersion", "cldrVersion", "dataFingerprint", "ianaRegistryDate",
    "ianaDataFingerprint", "behavioralVectorsVersion", "catalogVersion", "catalogFingerprint",
  ]) {
    // The NAMES appear — they are read off the record. What must not appear is a literal VALUE
    // assigned to one, so the check is for an assignment spelling rather than a mention.
    assert.doesNotMatch(source, new RegExp(`${field}\\s*:\\s*"`),
      `lokalized/ssr must not spell a literal ${field}; it reads one from the verified record`);
  }
});

function readSsrSource() {
  // Read through the same walk the graph came from, so the file this asserts about is the file the
  // graph measured — not a path typed twice.
  const file = graph.files.find((candidate) => candidate.endsWith("src/ssr/index.js"));
  assert.ok(file, "the SSR entry must be in its own graph");
  return readFileSync(file, "utf8");
}
