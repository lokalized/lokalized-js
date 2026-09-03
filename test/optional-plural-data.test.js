// @ts-check

/**
 * The optional plural modules' registration contract.
 *
 * `lokalized/data/ordinal` and `lokalized/data/ranges` are outside the root graph on purpose — the
 * root must never carry their tables — so a catalog that selects on `ORDINALITY_*` or uses a
 * range-driven cardinality placeholder can only be answered if the APPLICATION hands the data to
 * `createStrings`. Plan section 3.7 fixes what happens when it does not:
 *
 *   > `createStrings` detects catalog use of ordinality or cardinal ranges eagerly. Missing optional
 *   > data, wrong-axis modules, incomplete locale coverage, or incompatible provenance is a
 *   > construction-time `ConfigurationError`, not a late lookup surprise.
 *
 * The corpus cannot gate this: the conformance runner always supplies both modules, because Java's
 * `Strings` has both tables unconditionally and a runner that withheld them would be testing a
 * configuration Java has no counterpart for. So the withheld-data half is gated here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { cardinalRangeData } from "../src/data/ranges.js";
import { ordinalData } from "../src/data/ordinal.js";

/** A catalog whose ONLY ordinal use is in a key no test below ever looks up. */
const ordinalCatalog = {
  en: {
    "Greeting": "Hello",
    "Rank": {
      translation: "{{suffix}}",
      placeholders: {
        suffix: {
          value: "rank",
          translations: {
            ORDINALITY_ONE: "st",
            ORDINALITY_TWO: "nd",
            ORDINALITY_FEW: "rd",
            ORDINALITY_OTHER: "th",
          },
        },
      },
    },
  },
};

const rangeCatalog = {
  en: {
    "Span": {
      translation: "{{books}}",
      placeholders: {
        books: {
          range: { start: "low", end: "high" },
          translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" },
        },
      },
    },
  },
};

/**
 * @param {Record<string, unknown>} strings
 * @param {Record<string, unknown>} [pluralData]
 */
const build = (strings, pluralData) =>
  createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings,
    ...(pluralData ? { pluralData } : {}),
  });

describe("optional plural data is registered, not discovered", () => {
  it("refuses construction when a catalog asks an ordinal question and the data was withheld", () => {
    assert.throws(() => build(ordinalCatalog), /lokalized\/data\/ordinal/);
  });

  it("refuses construction for a range placeholder with no range data", () => {
    assert.throws(() => build(rangeCatalog), /lokalized\/data\/ranges/);
  });

  it("fails EAGERLY — before any lookup reaches the ordinal key", () => {
    // The point of the contract. A late check would let this application start, serve `Greeting`
    // forever, and only fail the first time a user's profile happened to show a rank.
    assert.throws(() => {
      const strings = build(ordinalCatalog);
      strings.get("Greeting");
    }, /lokalized\/data\/ordinal/);
  });

  it("detects an ordinal question asked by an EXPRESSION, not only by a placeholder", () => {
    // `position == ORDINALITY_TWO` classifies a number, so it needs the same table. Detecting only
    // `translations` keys would leave this as the late lookup surprise the contract forbids.
    const catalog = {
      en: {
        Place: {
          translation: "somewhere",
          alternatives: [{ "position == ORDINALITY_TWO": "runner-up" }],
        },
      },
    };

    assert.throws(() => build(catalog), /lokalized\/data\/ordinal/);
    assert.equal(build(catalog, { ordinal: ordinalData }).get("Place", { position: 2 }), "runner-up");
  });

  it("resolves ordinals once the module is supplied", () => {
    const strings = build(ordinalCatalog, { ordinal: ordinalData });

    assert.equal(strings.get("Rank", { rank: 1 }), "st");
    assert.equal(strings.get("Rank", { rank: 2 }), "nd");
    assert.equal(strings.get("Rank", { rank: 11 }), "th");
    assert.equal(strings.get("Greeting"), "Hello");
  });

  it("resolves range-driven cardinality once the module is supplied", () => {
    const strings = build(rangeCatalog, { ranges: cardinalRangeData });

    // English states nothing for one..one, so the range takes its END's cardinality.
    assert.equal(strings.get("Span", { low: 1, high: 1 }), "book");
    assert.equal(strings.get("Span", { low: 1, high: 5 }), "books");
  });

  it("rejects a wrong-axis module rather than failing later as a missing capability", () => {
    assert.throws(
      () => build(ordinalCatalog, { ordinal: cardinalRangeData }),
      /must be a 'ordinal-data' value but was 'cardinal-range-data'/,
    );
  });

  it("rejects a carrier that has the right tag but no runtime capability", () => {
    // A hand-rolled or cross-version object: the published shape is only provenance, so a plausible
    // forgery is easy to write and must not be mistaken for the module.
    assert.throws(
      () =>
        build(ordinalCatalog, {
          ordinal: { $lokalized: "ordinal-data", provenance: ordinalData.provenance },
        }),
      /carries no runtime capability/,
    );
  });

  it("accepts data that is supplied but not needed", () => {
    // A catalog that gains an ordinal branch tomorrow should not also require an application change.
    const strings = build({ en: { Greeting: "Hello" } }, { ordinal: ordinalData, ranges: cardinalRangeData });

    assert.equal(strings.get("Greeting"), "Hello");
  });

  it("keeps the optional tables off the public data carrier's own shape", () => {
    // The capability travels under a symbol precisely so the published shape stays what plan
    // section 3.2 declares it to be: a provenance carrier and nothing else.
    assert.deepEqual(Object.keys(ordinalData), ["$lokalized", "provenance"]);
    assert.deepEqual(Object.keys(cardinalRangeData), ["$lokalized", "provenance"]);
    assert.equal(JSON.parse(JSON.stringify(ordinalData)).$lokalized, "ordinal-data");
  });
});
