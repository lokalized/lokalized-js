// @ts-check
/**
 * Tiebreaker tags are compared NORMALIZED, on both sides.
 *
 * `resolveTiebreakers` used to copy caller-supplied tags verbatim and compare them against
 * `sortedSupported`, which holds already-normalized tags. A caller who wrote `en-gb` rather than
 * `en-GB` therefore got a tiebreaker that PASSED construction-time validation and then matched
 * nothing — resolution fell through to a different order and returned a different catalog's
 * translation, with no error anywhere.
 *
 * That is the shape of defect this port exists to prevent: silent, plausible, and wrong. It had no
 * corpus coverage because the corpus fixtures all spell tiebreakers canonically, which is exactly
 * why it survived. Found by a sibling session auditing the locale kernel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStrings } from "../src/core/index.js";

/** Two catalogs of one language, neither matching a bare `en` request exactly, so the tiebreaker decides. */
const CATALOGS = { "en-US": { "K": "from-US" }, "en-GB": { "K": "from-GB" } };

const served = (tiebreakers) =>
  createStrings({ fallbackLocale: "en-US", locale: "en", strings: CATALOGS, tiebreakers })
    .get("K", undefined, { locale: "en" });

test("the tiebreaker decides which catalog serves an ambiguous request", () => {
  // The control. Without this the case below could pass while proving nothing, because a tiebreaker
  // that never applies still returns SOMETHING.
  assert.equal(served({ en: ["en-GB", "en-US"] }), "from-GB");
  assert.equal(served({ en: ["en-US", "en-GB"] }), "from-US");
});

test("a case-variant tiebreaker tag behaves identically to its canonical spelling", () => {
  assert.equal(served({ en: ["en-gb", "en-us"] }), "from-GB", "en-gb must resolve as en-GB");
  assert.equal(served({ en: ["en-us", "en-gb"] }), "from-US", "en-us must resolve as en-US");
});

test("normalization applies to the whole list, not just its first entry", () => {
  assert.equal(served({ en: ["en-GB", "en-us"] }), "from-GB");
  assert.equal(served({ en: ["en-us", "en-GB"] }), "from-US");
});

test("a malformed tiebreaker tag is rejected at CONSTRUCTION, not at lookup", () => {
  // Where the rejection happens is the point. Construction-time validation refuses the tag before
  // the matcher is ever reached, which is what Java does — a bad tiebreaker is a configuration
  // error, not a per-lookup surprise.
  //
  // `resolveTiebreakers` still falls back to the verbatim tag if normalization fails, so a tag that
  // somehow reached the matcher would fail to match rather than crash every lookup. That path is
  // defence-in-depth and is unreachable through `createStrings`; this test pins the reachable
  // behavior, and asserting the lenient one here would have been asserting a fiction.
  assert.throws(
    () => createStrings({
      fallbackLocale: "en-US",
      locale: "en",
      strings: CATALOGS,
      tiebreakers: { en: ["en-GB", "en-US", "!!not-a-tag!!"] },
    }),
    /not a well-formed IETF BCP 47 locale/,
  );
});
