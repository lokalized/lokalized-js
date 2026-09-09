// @ts-check

/**
 * The `Zzzz` bidi finding — a real port defect, found by `tools/likely-subtag-diff/` on its first
 * run and invisible to all 2,346 corpus cases, none of which spells `Zzzz`.
 *
 * WHAT IT WAS. `BidiUtils.java:54` reads `locale.getScript()` — the JDK `Locale` field. This module
 * read `tagPartsFor(tag).script` instead, which is `CldrLocaleData.TagParts`, and `TagParts:577`
 * ELIDES the CLDR "unknown script" placeholder: a `Zzzz` script becomes `""` (as `:578` does for a
 * `ZZ` region). So Java saw a locale WITH a script and took the short-circuit branch, while the port
 * saw a script-less locale and maximized it through the likely-subtags table. `ar-Zzzz` was
 * therefore isolated here and not in Java.
 *
 * WHY IT IS ONLY BIDI. `Locale#getScript()` is read in three places in the reference implementation
 * (`BidiUtils.java:54`, `CldrPluralRules.java:252`, `DefaultStrings.java:2235`), and the port already
 * used `parseJdkTag` — the exact `Locale` analogue — at the other two. `BidiUtils` was the one site
 * that had drifted onto `TagParts`. Checked by grep over both trees, not assumed.
 *
 * MEASURED ON THE PINNED JDK, end to end through the real `Strings` object rather than through the
 * predicate, because the predicate agreeing is a reading and the rendered string is the behaviour.
 * One catalog per locale, one placeholder, default bidi isolation:
 *
 *     ar            isolated=true   Hello, ⁨Sarah⁩
 *     ar-Latn       isolated=false  Hello, Sarah
 *     ar-Zzzz       isolated=false  Hello, Sarah
 *     he-Zzzz       isolated=false  Hello, Sarah
 *     und-Zzzz-IL   isolated=false  Hello, Sarah
 *     en            isolated=false  Hello, Sarah
 *
 * THE CONTROLS ARE THE POINT, and they are why `ar` and `en` are in the table above and in every
 * assertion group below. Three of these six cells are "not isolated", and so is every cell of a
 * build in which bidi isolation is simply broken. Without `ar` — which MUST isolate, and which
 * reaches the table through the very branch the fix moved — a port that returned `false`
 * unconditionally would pass this file. That is the `zh-123` shape: an input that never reaches the
 * check under test confirming a conclusion it never exercised.
 *
 * ABLATION, not argument: reverting `bidi.js` to `tagPartsFor` turns the three `Zzzz` rows red here
 * and leaves `npm run conformance` byte-identical at 1,960 / 0 / 221 / 165.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { localeUsesRightToLeftScript } from "../src/internal/bidi.js";
import { tagPartsFor } from "../src/internal/locale-cldr.js";
import { parseJdkTag } from "../src/internal/locale-jdk-tag.js";
import { normalizeTag } from "../src/internal/locale.js";

const FSI = "⁨";
const PDI = "⁩";

/** @param {string} tag */
function renderedFor(tag) {
  const strings = createStrings({
    fallbackLocale: tag,
    locale: tag,
    strings: { [tag]: { "Greeting.Named": "Hello, {{name}}" } },
  });
  return strings.get("Greeting.Named", { name: "Sarah" });
}

describe("Zzzz suppresses bidi isolation, as an explicit script does", () => {
  it("does not isolate a locale whose script subtag is the CLDR unknown-script placeholder", () => {
    for (const tag of ["ar-Zzzz", "he-Zzzz", "und-Zzzz-IL", "ar-Zzzz-EG", "fa-Zzzz"]) {
      assert.equal(localeUsesRightToLeftScript(normalizeTag(tag)), false, tag);
      assert.equal(renderedFor(tag), "Hello, Sarah", tag);
    }
  });

  it("STILL isolates the same languages without it — the control that keeps the row above honest", () => {
    // If this assertion is ever deleted, the group above passes for a port that has stopped
    // isolating anything at all.
    for (const tag of ["ar", "he", "fa", "ar-EG"]) {
      assert.equal(localeUsesRightToLeftScript(normalizeTag(tag)), true, tag);
      assert.equal(renderedFor(tag), `Hello, ${FSI}Sarah${PDI}`, tag);
    }
  });

  it("still does not isolate an explicitly LTR script, or an LTR language", () => {
    for (const tag of ["ar-Latn", "he-Latn", "en", "en-Zzzz"]) {
      assert.equal(localeUsesRightToLeftScript(normalizeTag(tag)), false, tag);
      assert.equal(renderedFor(tag), "Hello, Sarah", tag);
    }
  });

  it("keeps isolating an explicitly RTL script on an LTR language", () => {
    // The other direction of the short-circuit: the script wins over the language's likely script.
    for (const tag of ["en-Arab", "de-Hebr"]) {
      assert.equal(localeUsesRightToLeftScript(normalizeTag(tag)), true, tag);
      assert.equal(renderedFor(tag), `Hello, ${FSI}Sarah${PDI}`, tag);
    }
  });
});

describe("the two script readings, and why bidi must use the JDK one", () => {
  it("TagParts elides Zzzz where the JDK Locale field preserves it", () => {
    // This is the whole mechanism, asserted rather than described — if `tagPartsFor` ever stops
    // eliding, the comment above this file goes stale and this line says so.
    assert.equal(tagPartsFor("ar-Zzzz").script, "");
    assert.equal(parseJdkTag("ar-Zzzz").script, "Zzzz");

    // …and they agree on a real script, so the divergence is specific to the placeholder rather
    // than a general disagreement between the two parsers.
    assert.equal(tagPartsFor("ar-Latn").script, "Latn");
    assert.equal(parseJdkTag("ar-Latn").script, "Latn");
    assert.equal(tagPartsFor("ar").script, "");
    assert.equal(parseJdkTag("ar").script, "");
  });

  it("elides the ZZ region placeholder too, which bidi never reads and canonicalization does", () => {
    // Recorded because it is the other half of `TagParts:577-578` and the reason the fix is scoped
    // to the SCRIPT: nothing in `BidiUtils` looks at a region, so `ar-ZZ` maximizes on both sides.
    assert.equal(tagPartsFor("ar-ZZ").region, "");
    assert.equal(parseJdkTag("ar-ZZ").region, "ZZ");
    assert.equal(localeUsesRightToLeftScript(normalizeTag("ar-ZZ")), true);
  });
});
