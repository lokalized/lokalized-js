// @ts-check

/**
 * Plan 3.4's small browser chooser — `chooseLocaleForPreferredLanguages` / `chooseBrowserLocale`.
 *
 * THE CHOOSER HAS ZERO CORPUS CASES. Java has no counterpart, so `tools/conformance.mjs` will never
 * gate a line of it and this file is the whole gate. What the corpus does supply is the two halves
 * it is assembled from: every `browser-chooser.*.locale` row is one call into the strict
 * single-locale kernel the chooser walks its list with, and the same row's `.ranges` twin is the
 * whole-list solver's answer for the same preference. So the first test below is corpus-driven — all
 * 33 `.locale` halves, re-derived from `behavioral-vectors.json` rather than transcribed — and the
 * rest are the properties no recorded row can see, each written as a PAIR: the half that must move
 * beside a control that must not.
 *
 * The three traps M7-PLAN.md's C2 row names are pinned individually below, because each of them
 * produces a plausible answer rather than an error: the strict kernel (a `bestMatchFor` build never
 * advances past entry one), silent truncation at 32 (the same overflow throws through
 * `matchForLanguageRanges` and fails soft through `bestMatchForAcceptLanguage` — three behaviours,
 * one input), and the RESOLVED fallback on exhaustion (returning the configured tag hands back a
 * locale no loaded catalog answers to).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chooseBrowserLocale, chooseLocaleForPreferredLanguages } from "../src/core/index.js";
import { createLocaleNegotiator } from "../src/negotiate/index.js";

const root = new URL("../", import.meta.url);
const vectorsPath = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR, "generated/behavioral-vectors.json")
  : resolve(root.pathname, "../lokalized-spec/generated/behavioral-vectors.json");

/** @type {any} */
let vectors = null;
try {
  vectors = JSON.parse(await readFile(vectorsPath, "utf8"));
} catch {
  // Sibling spec checkout not present; the corpus-driven test skips, the rest still run.
}

const skip = vectors ? false : `behavioral vectors not found at ${vectorsPath}`;

/** The `LocaleConfiguration` a fixture describes, in the shape `getLocaleConfiguration()` reports. */
const configurationFor = (/** @type {any} */ fixture) => ({
  fallbackLocale: fixture.fallbackLocale,
  supportedLocales: Object.keys(fixture.files),
  tiebreakers: fixture.tiebreakers,
});

describe("chooseLocaleForPreferredLanguages", () => {
  it("reproduces every recorded browser-chooser .locale half", { skip }, () => {
    const rows = vectors.cases.filter(
      (/** @type {any} */ c) =>
        c.id.startsWith("browser-chooser.") && c.id.endsWith(".locale") && c.operation === "matchFor",
    );

    // A FLOOR AT TODAY'S COUNT, not an equality: a case added to the family must not silently stop
    // being checked here, and a case removed must be noticed rather than shrinking the gate.
    assert.ok(rows.length >= 33, `expected at least 33 recorded .locale halves, found ${rows.length}`);

    const mismatches = [];
    for (const row of rows) {
      const configuration = configurationFor(vectors.fixtures[row.fixture]);
      const match = row.expected.match;
      // 30 OF THESE 33 ROWS ARE CORPUS-DRIVEN; 3 ARE NOT, and the distinction is stated rather than
      // left implied. Where Java recorded `isMatch`, the expectation is Java's own answer. Where it
      // did not — `alias.zh-hakka-has-no-loaded-target`, `collision.zh-hant-no-match-without-hant-source`
      // and `collision.zh-tw-no-match-without-hant-source` — an unmatched preference exhausts a
      // one-entry list, and the expectation becomes what the EMPTY list returns: the implementation
      // compared against itself. That is bounded, not a hole — all three answers are pinned
      // independently by the hard-coded hy-810/hy-AM/hy-SU assertions further down this file, which
      // is where the resolved-fallback rule is actually gated — but this loop does not gate them.
      const expected = match && match.isMatch
        ? match.locale
        : chooseLocaleForPreferredLanguages(configuration, []);
      const actual = chooseLocaleForPreferredLanguages(configuration, [row.input.locale]);

      if (actual !== expected) mismatches.push(`${row.id}: expected ${expected}, got ${actual}`);
    }

    assert.deepEqual(mismatches, []);
  });

  it("is the LOCALE channel, and diverges from the whole-list solver where the corpus says it does", () => {
    // `browser-chooser.conflict.sgn-no-solvers-diverge.locale` selects nsl; its `.ranges` twin
    // selects nsi. The JDK's IANA table maps nsl to sgn-NO while CLDR canonicalizes sgn-NO to nsi,
    // and the corpus records BOTH answers rather than asserting an equality that does not hold. A
    // chooser that agreed with the solver here would be a second RFC 4647 implementation in the
    // root graph — the one thing plan 3.1 keeps out of it.
    const configuration = { fallbackLocale: "en", supportedLocales: ["en", "nsi", "nsl"], tiebreakers: null };

    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["sgn-NO"]), "nsl");
    // The `.ranges` half reaches the solver THROUGH the header parser, which is where sgn-no picks
    // up its `sgn-nsl`/`nsl` IANA members; handing the solver a bare one-member list instead skips
    // that expansion and answers nsl, so the route matters as much as the door.
    assert.equal(createLocaleNegotiator(configuration).bestMatchForAcceptLanguage("sgn-NO"), "nsi");

    // The same divergence on the other recorded pair: `.collision.zh-cmn-solvers-diverge`.
    const collision = {
      fallbackLocale: "en",
      supportedLocales: ["cmn", "en", "mo", "ro", "zh"],
      tiebreakers: { ro: ["mo", "ro"], zh: ["cmn", "zh"] },
    };

    assert.equal(chooseLocaleForPreferredLanguages(collision, ["zh-cmn"]), "cmn");
    assert.equal(createLocaleNegotiator(collision).bestMatchForAcceptLanguage("zh-cmn"), "zh");
  });

  it("advances past an unmatched preference — the strict kernel, not bestMatchFor", () => {
    const configuration = { fallbackLocale: "en", supportedLocales: ["en", "fr", "de"], tiebreakers: null };

    // THE FAILING HALF of the trap: built on `bestMatchFor`, entry one always "matches" and this
    // answers `en`. Measured — swapping the kernel for `bestMatchFor` makes exactly this line red.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["xx", "yy", "fr"]), "fr");
    // CONTROLS. A matchable first entry still wins, and an all-unmatched list still reaches the
    // fallback, so the test above cannot pass merely by never selecting anything.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["de", "fr"]), "de");
    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["xx", "yy"]), "en");
  });

  it("examines at most 32 entries and truncates SILENTLY", () => {
    const configuration = { fallbackLocale: "en", supportedLocales: ["en", "fr"], tiebreakers: null };
    // Well-formed, unmatchable, and deliberately private-use so no CLDR likely-subtag route can
    // rescue one of them into a match.
    const filler = (/** @type {number} */ count) =>
      Array.from(
        { length: count },
        (_, index) => `q${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
      );

    // Entry 33 is NOT examined: the answer is the fallback, and no error is raised.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, [...filler(32), "fr"]), "en");
    // CONTROL at the boundary: entry 32 IS examined, so the identical list one shorter answers fr.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, [...filler(31), "fr"]), "fr");

    // The same overflow is THREE different behaviours across the three doors, and this is the one
    // that must not become an error. `browser-chooser.limit.explicit-thirty-three-ranges-rejected`
    // records the strict list door throwing on 33.
    assert.throws(
      () => createLocaleNegotiator(configuration).bestMatchForLanguageRanges(
        filler(33).map((range) => ({ range, weight: 0.5 })),
      ),
      /At most 32 language ranges are supported, but received 33/,
    );

    // A MALFORMED entry still costs one of the 32. It was examined; it was simply unusable.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, [...Array(32).fill("!!"), "fr"]), "en");
    assert.equal(chooseLocaleForPreferredLanguages(configuration, [...Array(31).fill("!!"), "fr"]), "fr");
  });

  it("returns the RESOLVED fallback on exhaustion, never the configured tag", () => {
    // `hy-810` is canonically equivalent to BOTH loaded catalogs, so the configured spelling names
    // neither: returning it hands the caller a tag every subsequent lookup misses on. Which of the
    // two it resolves to is the tiebreaker's decision, and reversing the tiebreaker must move it.
    const first = {
      fallbackLocale: "hy-810",
      supportedLocales: ["hy-AM", "hy-SU"],
      tiebreakers: { hy: ["hy-SU", "hy-AM"] },
    };
    const reversed = { ...first, tiebreakers: { hy: ["hy-AM", "hy-SU"] } };

    assert.equal(chooseLocaleForPreferredLanguages(first, ["zu", "xx"]), "hy-SU");
    assert.equal(chooseLocaleForPreferredLanguages(reversed, ["zu", "xx"]), "hy-AM");
    // The empty list is the same exhaustion by the shortest route.
    assert.equal(chooseLocaleForPreferredLanguages(first, []), "hy-SU");
    // And the resolution is not decorative: neither answer is the tag the caller configured.
    assert.notEqual(chooseLocaleForPreferredLanguages(first, []), "hy-810");

    // AND THE RESOLVED FALLBACK IS WHAT THE KERNEL MATCHES WITH, not merely what exhaustion
    // returns. `lookupMatchByLikelySubtag` and `preferredLocaleForRange` both prefer the fallback
    // among otherwise equally-good candidates, so a chooser that resolved the fallback for its
    // return value and handed the kernel the configured spelling selects a DIFFERENT catalog for a
    // preference that did match — a wrong answer where nothing looks wrong. `en-840` is canonically
    // equivalent to `en-US` alone, so it resolves unambiguously and then decides `en`.
    const regionalNumeric = { fallbackLocale: "en-840", supportedLocales: ["en-GB", "en-US"], tiebreakers: null };

    assert.equal(chooseLocaleForPreferredLanguages(regionalNumeric, ["en"]), "en-US");
    // CONTROL that the input really is sensitive: the same preference over the same catalogs
    // answers en-GB when the fallback resolves to en-GB.
    assert.equal(
      chooseLocaleForPreferredLanguages({ ...regionalNumeric, fallbackLocale: "en-GB" }, ["en"]),
      "en-GB",
    );

    // CONTROL: a configured fallback that IS a loaded catalog resolves to itself, so the walk above
    // cannot be passing merely because something always rewrites the fallback.
    assert.equal(
      chooseLocaleForPreferredLanguages(
        { fallbackLocale: "hy-SU", supportedLocales: ["hy-AM", "hy-SU"], tiebreakers: null },
        [],
      ),
      "hy-SU",
    );
  });

  it("ignores malformed entries without abandoning the rest of the list", () => {
    const configuration = { fallbackLocale: "en", supportedLocales: ["en", "fr"], tiebreakers: null };

    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["not a tag!", "fr"]), "fr");
    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["", "fr"]), "fr");
    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["zh-123", "fr"]), "fr");
    // A non-string entry is malformed too — a host that put a number in the list has made a
    // mistake, which is not a reason to drop the preferences after it.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, [null, 7, {}, "fr"]), "fr");
    // CONTROL: the tags above really are the malformed ones. A well-formed first entry wins.
    assert.equal(chooseLocaleForPreferredLanguages(configuration, ["fr-CA", "en"]), "fr");
  });

  it("refuses a configuration it cannot use, rather than answering plausibly", () => {
    assert.throws(() => chooseLocaleForPreferredLanguages(/** @type {any} */ (null), []), /locale configuration is required/);
    // A fallback naming no loaded catalog is `createStrings`' own construction refusal, arriving
    // through the other door.
    assert.throws(
      () => chooseLocaleForPreferredLanguages({ fallbackLocale: "de", supportedLocales: ["en", "fr"], tiebreakers: null }, []),
      /Specified fallback locale is 'de' but no matching localized strings locale was found/,
    );
    // An ambiguous fallback with no tiebreaker to settle it is refused here exactly as it is at
    // construction — silently picking one is how a whole application serves the wrong catalog.
    assert.throws(
      () => chooseLocaleForPreferredLanguages({ fallbackLocale: "hy-810", supportedLocales: ["hy-AM", "hy-SU"], tiebreakers: null }, []),
      /canonically equivalent to multiple loaded locales/,
    );
    // A STRING is iterable, and iterating one yields single characters that are all malformed — so
    // `chooseLocaleForPreferredLanguages(config, navigator.language)` would answer the fallback for
    // every request instead of reporting the mistake. That is the `zh-123` shape at the API door.
    assert.throws(
      () => chooseLocaleForPreferredLanguages({ fallbackLocale: "en", supportedLocales: ["en"], tiebreakers: null }, /** @type {any} */ ("en-US")),
      /requires an iterable of preferred language tags/,
    );
    assert.throws(
      () => chooseLocaleForPreferredLanguages({ fallbackLocale: "en", supportedLocales: ["en"], tiebreakers: null }, /** @type {any} */ (undefined)),
      /requires an iterable of preferred language tags/,
    );
    // CONTROL: the empty list this refusal tells callers to pass is accepted.
    assert.equal(chooseLocaleForPreferredLanguages({ fallbackLocale: "en", supportedLocales: ["en"], tiebreakers: null }, []), "en");
  });

  it("accepts any iterable, not just an array", () => {
    const configuration = { fallbackLocale: "en", supportedLocales: ["en", "fr"], tiebreakers: null };
    assert.equal(chooseLocaleForPreferredLanguages(configuration, new Set(["xx", "fr"])), "fr");
  });
});

describe("chooseBrowserLocale", () => {
  const configuration = { fallbackLocale: "en", supportedLocales: ["en", "fr", "de"], tiebreakers: null };
  const withNavigator = (/** @type {unknown} */ navigator, /** @type {() => void} */ body) => {
    const had = Object.hasOwn(globalThis, "navigator");
    const previous = /** @type {any} */ (globalThis).navigator;
    try {
      Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true, writable: true });
      body();
    } finally {
      if (had) Object.defineProperty(globalThis, "navigator", { value: previous, configurable: true, writable: true });
      else delete (/** @type {any} */ (globalThis).navigator);
    }
  };

  it("delegates navigator.languages to the pure helper", () => {
    withNavigator({ languages: ["xx-YY", "de-AT", "fr"] }, () => {
      assert.equal(chooseBrowserLocale(configuration), "de");
    });
  });

  it("uses [] when the host has no navigator.languages, and answers the resolved fallback", () => {
    withNavigator(undefined, () => assert.equal(chooseBrowserLocale(configuration), "en"));
    withNavigator({}, () => assert.equal(chooseBrowserLocale(configuration), "en"));
    // navigator.language is a STRING, not the list. Iterating it would yield one-character
    // "preferences", all malformed — a silent fallback for every request.
    withNavigator({ language: "fr-FR", languages: "fr-FR" }, () =>
      assert.equal(chooseBrowserLocale(configuration), "en"),
    );
  });

  it("resolves the fallback the same way the pure helper does", () => {
    withNavigator({ languages: [] }, () =>
      assert.equal(
        chooseBrowserLocale({ fallbackLocale: "hy-810", supportedLocales: ["hy-AM", "hy-SU"], tiebreakers: { hy: ["hy-SU", "hy-AM"] } }),
        "hy-SU",
      ),
    );
  });
});
