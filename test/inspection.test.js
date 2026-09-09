import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/index.js";

/**
 * Plan 3.3:771-773, the exact-locale inspection surface.
 *
 * Both members were measured against the pinned JDK on 2026-09-06 and both were wrong:
 * `getKeysForLocale` returned `[]` for an unsupported locale where Java throws, and returned keys in
 * catalog INSERTION order where Java's `TreeSet` returns them sorted. `getMissingKeys` did not exist.
 *
 * Every refusal below is paired with a control that must PASS, because a member that refused
 * everything would satisfy the refusal half on its own.
 */
const strings = () =>
  createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: { en: { Beta: "b", Alpha: "a", Gamma: "g" }, "en-GB": { Alpha: "a" }, ro: { Alpha: "a" } },
    tiebreakers: { en: ["en", "en-GB"] },
  });

describe("getKeysForLocale", () => {
  it("returns keys SORTED, not in catalog insertion order", () => {
    // The catalog is authored Beta, Alpha, Gamma. Insertion order would be the authored order, and
    // that is exactly the defect this pins: Java's TreeSet answers natural String order.
    assert.deepEqual(strings().getKeysForLocale("en"), ["Alpha", "Beta", "Gamma"]);
  });

  it("throws for a locale that is not supported, rather than answering empty", () => {
    assert.throws(() => strings().getKeysForLocale("fr"), /Unsupported locale 'fr' was provided/);
  });

  it("accepts a case-normalized spelling of a supported tag — the control for the throw above", () => {
    assert.deepEqual(strings().getKeysForLocale("EN-gb"), ["Alpha"]);
  });

  it("refuses an absent CLDR-EQUIVALENT tag, which is the distinction plan 3.3:773 draws", () => {
    // `mo` is CLDR-equivalent to the loaded `ro`, and inspection performs no equivalence. The pair
    // matters: `ro` must still resolve, or this would pass for a member that refused both.
    assert.throws(() => strings().getKeysForLocale("mo"), /Unsupported locale 'mo' was provided/);
    assert.deepEqual(strings().getKeysForLocale("ro"), ["Alpha"]);
  });

  it("returns a frozen array", () => {
    assert.equal(Object.isFrozen(strings().getKeysForLocale("en")), true);
  });
});

describe("getMissingKeys", () => {
  it("reports keys present in the source and absent from the target", () => {
    assert.deepEqual(strings().getMissingKeys("en", "ro"), ["Beta", "Gamma"]);
  });

  it("is directional — the control that stops a symmetric-difference implementation passing", () => {
    assert.deepEqual(strings().getMissingKeys("ro", "en"), []);
  });

  it("applies the support rule INDEPENDENTLY to source and target", () => {
    assert.throws(() => strings().getMissingKeys("fr", "en"), /Unsupported locale 'fr'/);
    assert.throws(() => strings().getMissingKeys("en", "fr"), /Unsupported locale 'fr'/);
    // Control: both supported still answers.
    assert.deepEqual(strings().getMissingKeys("en", "en-GB"), ["Beta", "Gamma"]);
  });

  it("returns a frozen array", () => {
    assert.equal(Object.isFrozen(strings().getMissingKeys("en", "ro")), true);
  });
});
