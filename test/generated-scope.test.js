// @ts-check

/**
 * PLAN 8.3'S RAW-INPUT SELECTOR SCOPE — a generated fragment's selectors see the CALLER'S ORIGINAL
 * placeholders, never the expanded values.
 *
 * WHERE THE RULE LIVES IN JAVA. `DefaultStrings.java:712-713` calls `getInternal` with
 * `Collections.emptyMap()` for the inherited bindings and threads `immutableContext` — the caller's
 * own map — as a separate argument. Every selector inside `getInternal` then reads THAT map and
 * nothing else: `resolveExpressionTranslation(definition, immutableContext, locale)` at `:840`, and
 * `unwrapOptional(immutableContext.get(...))` for a language form's `value` and for both range
 * endpoints at `:877-882`. The generated expansions accumulate in a DIFFERENT map
 * (`generatedContext`) that only `interpolateTemplate` ever reads. The port mirrors the shape:
 * `render()` in `src/internal/interpolate.js` passes `lookup`/`placeholders` — built once from the
 * caller's argument — to `resolvePlaceholder`, and passes the `generated` map only to
 * `interpolateTemplate`.
 *
 * WHY A FILE RATHER THAN THE FAMILY COUNT. `generated-placeholders` is 38/38 (measured this session;
 * it was 37/38 before C1 landed bounded output), and nine of those rows are `scope.*`. That is real
 * evidence and it was checked by ABLATION rather than by reading: making the `generated` map shadow
 * the caller in BOTH scope arguments to `resolvePlaceholder` turns exactly THREE corpus rows red —
 * `scope.fragment-alternative-reads-raw-input-not-sibling-generated-value`,
 * `scope.language-form-selector-reads-raw-input-not-sibling-generated-value` and
 * `scope.range-endpoints-read-raw-input-while-template-reads-generated-value`. So the rule is
 * implemented and load-bearing, not merely unexercised.
 *
 * BOTH arguments, and the correction matters. An earlier revision of this comment described the
 * ablation as "merging the `generated` map into the VALUES handed to `resolvePlaceholder`", which
 * moves only ONE row: `resolvePlaceholder` uses `values` for the expression arm and a SEPARATE
 * `lookup` function for `selectLanguageForm`, so shadowing one argument leaves the other honest.
 *
 * THE TEMPLATE ORDER BELOW IS LOAD-BEARING — DO NOT "TIDY" IT BACK. All three `Shadow` catalogs
 * spell the template `"{{word}} {{article}}"`, with the shadowed name FIRST. They used to spell it
 * `"{{article}} {{word}}"`, and in that order these three tests did not discriminate at all: `enqueue`
 * walks the template in TEXT order, so `article` resolved while `generated` was still empty and even
 * a wrong-scope port read the caller's `"apple"` anyway. Measured — under the ablation above, the old
 * spelling left tests 1-3 GREEN and moved only the throwing `Sibling` case; the new spelling turns
 * all three red while the CONTROL (which selects on an unshadowed key) correctly stays green.
 *
 * BUT ALL THREE FAIL BY THROWING. Under the ablation each of them hands a selector a TEMPLATE STRING
 * where it expected a number, and the row's answer moves from `translated` to `returned-key` with a
 * `resolution-failure`. A violation that throws is the easy half. The case below is the hard half:
 * a shadowed name whose two readings are BOTH valid, so the wrong scope renders a different sentence
 * and raises nothing at all.
 *
 * IT IS CORROBORATED ON THE PINNED JDK, not derived from the port. Driven through
 * `tools/phonetic-diff/PhoneticDiff.java` on Corretto 21 against the same catalog and placeholders:
 *
 *   shadow  swap=1     TRANSLATED  "banana an"   resolver terms [apple]
 *   shadow  swap=2     TRANSLATED  "bananas an"  resolver terms [apple]
 *   control-vowel      TRANSLATED  "banana an"   resolver terms [apple]
 *   control-consonant  TRANSLATED  "banana a"    resolver terms [banana]
 *
 * Re-run on Corretto 21 against `lokalized-3.0.0.jar` for the CORRECTED template order above, rather
 * than carried over from the old one: changing what a test asserts obliges re-asking the oracle.
 *
 * The two controls are what make the first line evidence. `control-consonant` selects on an ordinary
 * unshadowed key holding `"banana"` and proves the scenario CAN answer `"a banana"` — so the shadow
 * case answering `"an banana"` is the scope rule deciding it, not a resolver that always says VOWEL.
 *
 * The last test's `Sibling` catalog was corroborated the same way, on the same JDK:
 *
 *   sibling-no-count  RETURNED_KEY  RESOLUTION_FAILURE  "Missing value for placeholder 'count' …"
 *   sibling-count-1   TRANSLATED    "many book"   (n=5, count=1)
 *   sibling-count-2   TRANSLATED    "1 books"     (n=1, count=2)
 *
 * `sibling-count-1` is the whole rule in one line: `count` expands to `"many"` from `n: 5` and is
 * interpolated as `"many"`, while `noun` — which selects ON `count` — classifies the CALLER's `1`
 * and answers `"book"`. A port whose selectors read the generated map answers `"many books"`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings, PHONETIC_CONSONANT, PHONETIC_VOWEL } from "../src/index.js";

/** Records the term each resolution was handed — the channel the rendered string cannot show. */
function recordingResolver() {
  /** @type {string[]} */
  const terms = [];
  return {
    terms,
    resolve: (/** @type {string} */ term) => {
      terms.push(term);
      return /^[aeiou]/i.test(term) ? PHONETIC_VOWEL : PHONETIC_CONSONANT;
    },
  };
}

describe("plan 8.3 — a generated fragment's selectors read raw caller input", () => {
  it("a generated placeholder that SHADOWS a caller key does not displace it for selection", () => {
    // `word` is BOTH a caller placeholder (`"apple"`) and a generated placeholder (expanding to
    // `"banana"`). The template's `{{word}}` takes the generated expansion; `article`'s selector,
    // which names `word` as its value, must still see `"apple"`.
    const resolver = recordingResolver();
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      phoneticResolver: resolver.resolve,
      strings: {
        en: {
          Shadow: {
            translation: "{{word}} {{article}}",
            placeholders: {
              word: {
                value: "swap",
                translations: { CARDINALITY_ONE: "banana", CARDINALITY_OTHER: "bananas" },
              },
              article: {
                value: "word",
                translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" },
              },
            },
          },
        },
      },
    });

    assert.equal(strings.get("Shadow", { word: "apple", swap: 1 }), "banana an");
    // The resolver channel, which the rendered string alone cannot distinguish: a port that read the
    // generated value would hand the callback `"banana"` and still render a grammatical sentence.
    assert.deepEqual(resolver.terms, ["apple"]);
  });

  it("CONTROL — the same catalog answers 'a banana' when the selector really does see a consonant", () => {
    // Identical in every respect except that `article` selects on an UNSHADOWED key. If this line
    // could not move, the assertion above would be satisfied by a resolver stuck on VOWEL.
    const resolver = recordingResolver();
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      phoneticResolver: resolver.resolve,
      strings: {
        en: {
          Shadow: {
            translation: "{{word}} {{article}}",
            placeholders: {
              word: {
                value: "swap",
                translations: { CARDINALITY_ONE: "banana", CARDINALITY_OTHER: "bananas" },
              },
              article: {
                value: "other",
                translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" },
              },
            },
          },
        },
      },
    });

    assert.equal(strings.get("Shadow", { word: "apple", swap: 1, other: "banana" }), "banana a");
    assert.deepEqual(resolver.terms, ["banana"]);
    // And with a vowel-initial value in the unshadowed key, back to "an" — the same instance, so the
    // difference is the value read and nothing else.
    resolver.terms.length = 0;
    assert.equal(strings.get("Shadow", { word: "apple", swap: 1, other: "apple" }), "banana an");
    assert.deepEqual(resolver.terms, ["apple"]);
  });

  it("a shadowed name reaches the TEMPLATE as the generated expansion, both forms", () => {
    // The other half of the same rule, and the reason a shadow is a shadow at all: interpolation
    // takes the generated value even though selection did not. Driving the same key through the
    // other cardinal form must move the interpolated text and NOT the article.
    const resolver = recordingResolver();
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      phoneticResolver: resolver.resolve,
      strings: {
        en: {
          Shadow: {
            translation: "{{word}} {{article}}",
            placeholders: {
              word: {
                value: "swap",
                translations: { CARDINALITY_ONE: "banana", CARDINALITY_OTHER: "bananas" },
              },
              article: {
                value: "word",
                translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" },
              },
            },
          },
        },
      },
    });

    assert.equal(strings.get("Shadow", { word: "apple", swap: 2 }), "bananas an");
    assert.deepEqual(resolver.terms, ["apple"]);
  });

  it("a sibling generated value is not visible to a language-form selector, and says so loudly", () => {
    // The throwing half — the shape the three corpus rows above cover. `count` is generated, so a
    // selector naming it sees the caller's map, where nothing is bound: the selection fails rather
    // than classifying the expanded template text.
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: {
        en: {
          Sibling: {
            translation: "{{count}} {{noun}}",
            placeholders: {
              count: { value: "n", translations: { CARDINALITY_ONE: "1", CARDINALITY_OTHER: "many" } },
              noun: { value: "count", translations: { CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" } },
            },
          },
        },
      },
    });

    // `noun` selects on `count`, which the CALLER never supplied — so it is absent, not "many".
    const result = strings.getResult("Sibling", { n: 5 });
    assert.equal(result.status, "returned-key");
    assert.equal(result.failureReason, "resolution-failure");

    // CONTROL: supplying `count` in the caller's map makes the identical catalog resolve, and it
    // resolves under the CALLER's value — 1 gives "book" even though the generated `count` expanded
    // to "many" from `n: 5`.
    assert.equal(strings.get("Sibling", { n: 5, count: 1 }), "many book");
    assert.equal(strings.get("Sibling", { n: 1, count: 2 }), "1 books");
  });
});
