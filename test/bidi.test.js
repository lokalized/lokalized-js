// @ts-check

/**
 * `src/internal/bidi.js` and the interpolation paths that consume it.
 *
 * The corpus already replays every recorded bidi case through `tools/conformance.mjs`, so this file
 * covers what the corpus deliberately cannot: the family's own `skipped` block names the decision
 * points its 52 cases do not reach, and the four RTL/LTR fixtures it ships all resolve on a single
 * donor. What is checked here is therefore the DECISION TABLE — a mode against a locale against a
 * value shape — plus the three seams a corpus replay cannot separate, because the runner only ever
 * sees the rendered string:
 *
 * - the isolate mark budget of `isolate`, exercised over the whole `isIsolated` guard set including
 *   the depth-returns-to-zero-early case that no fixture varies twice;
 * - script detection over locales the fixtures never load (`ckb`, `yi`, `fa-IR`, `und`), where the
 *   answer comes from the pinned likely-subtags table rather than an explicit subtag;
 * - the mode reaching `createStrings` and a per-call option, in both directions, over the SAME
 *   instance — the corpus needs two fixtures to say this and cannot say it about one object.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import {
  DEFAULT_BIDI_ISOLATION,
  isolate,
  localeUsesRightToLeftScript,
  shouldApplyBidiIsolation,
  validateBidiIsolation,
} from "../src/internal/bidi.js";
import { GENDER_FEMININE, decimal } from "../src/index.js";

const FSI = "⁨";
const PDI = "⁩";
const LRI = "⁦";
const RLI = "⁧";

/** @param {Record<string, unknown>} [options] */
function stringsFor(options) {
  return createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: {
      en: { "Wrap.Value": "[{{value}}]", "Greeting.Named": "Hello, {{name}}" },
      he: { "Greeting.Named": "שלום, {{name}}" },
    },
    .../** @type {any} */ (options ?? {}),
  });
}

describe("isolate", () => {
  it("wraps a plain value in FSI and PDI", () => {
    assert.equal(isolate("Sarah"), `${FSI}Sarah${PDI}`);
  });

  it("never inspects the value's own direction", () => {
    // The same two marks for an LTR value, an RTL value and a mixed one. A port that decided from
    // the value would emit different marks — or none — for at least one of these three.
    assert.equal(isolate("مرحبا"), `${FSI}مرحبا${PDI}`);
    assert.equal(isolate("Sarah مرحبا"), `${FSI}Sarah مرحبا${PDI}`);
  });

  it("adds no marks to the empty string", () => {
    assert.equal(isolate(""), "");
  });

  it("is idempotent for a value already isolated by any of the three initiators", () => {
    for (const initiator of [FSI, LRI, RLI]) {
      const already = `${initiator}Sarah${PDI}`;
      assert.equal(isolate(already), already, `${initiator.codePointAt(0)?.toString(16)}`);
      assert.equal(isolate(isolate(already)), already, "and stays idempotent when applied twice");
    }
  });

  it("treats an empty isolate pair as already isolated", () => {
    // Length exactly 2, which is the boundary of `isIsolated`'s `valueLength < 2` guard.
    assert.equal(isolate(`${FSI}${PDI}`), `${FSI}${PDI}`);
  });

  it("re-wraps a value whose isolate run closes before the end", () => {
    // `⁨a⁩b` is balanced but not a single run covering the whole value, so trusting it would leave
    // `b` outside any isolate.
    assert.equal(isolate(`${FSI}a${PDI}b`), `${FSI}${FSI}a${PDI}b${PDI}`);
  });

  it("re-wraps a lone initiator, which is shorter than the guard allows", () => {
    assert.equal(isolate(FSI), `${FSI}${FSI}${PDI}${PDI}`);
  });

  it("drops an unmatched pop rather than letting it escape the wrapper", () => {
    assert.equal(isolate(`a${PDI}b`), `${FSI}ab${PDI}`);
  });

  it("balances an unclosed initiator before closing its own wrapper", () => {
    assert.equal(isolate(`${RLI}ab`), `${FSI}${RLI}ab${PDI}${PDI}`);
  });

  it("balances several unclosed initiators, innermost first", () => {
    assert.equal(isolate(`${RLI}${LRI}ab`), `${FSI}${RLI}${LRI}ab${PDI}${PDI}${PDI}`);
  });

  it("keeps a nested balanced run intact inside the new wrapper", () => {
    assert.equal(isolate(`a${FSI}b${PDI}c`), `${FSI}a${FSI}b${PDI}c${PDI}`);
  });

  it("rejects a value that pops below zero as not-already-isolated", () => {
    assert.equal(isolate(`${FSI}a${PDI}${PDI}`), `${FSI}${FSI}a${PDI}${PDI}`);
  });
});

describe("localeUsesRightToLeftScript", () => {
  it("reads an explicit script subtag without consulting likely subtags", () => {
    assert.equal(localeUsesRightToLeftScript("ar-Latn"), false);
    assert.equal(localeUsesRightToLeftScript("en-Arab"), true);
  });

  it("maximizes a tag with no script through the pinned CLDR table", () => {
    for (const tag of ["ar", "he", "fa-IR", "ckb", "yi", "ur", "ps", "dv"])
      assert.equal(localeUsesRightToLeftScript(tag), true, tag);

    for (const tag of ["en", "de", "ja", "zh-TW", "ru", "el", "hi"])
      assert.equal(localeUsesRightToLeftScript(tag), false, tag);
  });

  it("matches the script case-insensitively, as CldrLocaleData.keyFor does", () => {
    assert.equal(localeUsesRightToLeftScript("en-arab"), true);
    assert.equal(localeUsesRightToLeftScript("en-ARAB"), true);
  });

  it("answers the same for a repeated tag, which is what the memo must not change", () => {
    const first = localeUsesRightToLeftScript("he-IL");
    assert.equal(localeUsesRightToLeftScript("he-IL"), first);
    assert.equal(first, true);
  });
});

describe("shouldApplyBidiIsolation", () => {
  it("defaults to rtl-locales", () => {
    assert.equal(DEFAULT_BIDI_ISOLATION, "rtl-locales");
  });

  it("keys off the locale, never the mode alone", () => {
    assert.equal(shouldApplyBidiIsolation("none", "he"), false);
    assert.equal(shouldApplyBidiIsolation("all", "en"), true);
    assert.equal(shouldApplyBidiIsolation("rtl-locales", "he"), true);
    assert.equal(shouldApplyBidiIsolation("rtl-locales", "en"), false);
  });

  it("refuses an unrecognized mode instead of falling back to the default", () => {
    // The Java spelling is the likeliest typo, and silently accepting it would turn the option off.
    assert.throws(() => validateBidiIsolation("ALWAYS", "createStrings({ bidiIsolation })"), RangeError);
    assert.throws(() => validateBidiIsolation("always", "createStrings({ bidiIsolation })"), RangeError);
    assert.throws(() => validateBidiIsolation(null, "createStrings({ bidiIsolation })"), RangeError);
    assert.equal(validateBidiIsolation("all", "x"), "all");
  });
});

describe("createStrings({ bidiIsolation })", () => {
  it("isolates in an RTL locale with nothing configured", () => {
    assert.equal(stringsFor().get("Greeting.Named", { name: "Sarah" }, { locale: "he" }),
      `שלום, ${FSI}Sarah${PDI}`);
  });

  it("does not isolate an RTL value in an LTR locale with nothing configured", () => {
    assert.equal(stringsFor().get("Greeting.Named", { name: "שרה" }, { locale: "en" }), "Hello, שרה");
  });

  it("rejects an unrecognized instance mode at construction", () => {
    assert.throws(() => stringsFor({ bidiIsolation: "ALWAYS" }), RangeError);
  });

  it("rejects an unrecognized per-call mode at the call", () => {
    assert.throws(
      () => stringsFor().get("Wrap.Value", { value: "Sarah" }, /** @type {any} */ ({ bidiIsolation: "rtl" })),
      RangeError,
    );
  });

  it("lets a per-call mode replace the instance mode in both directions on ONE instance", () => {
    const always = stringsFor({ bidiIsolation: "all" });
    assert.equal(always.get("Wrap.Value", { value: "Sarah" }), `[${FSI}Sarah${PDI}]`);
    assert.equal(always.get("Wrap.Value", { value: "Sarah" }, { bidiIsolation: "none" }), "[Sarah]");
    assert.equal(always.get("Wrap.Value", { value: "Sarah" }, { bidiIsolation: "rtl-locales" }), "[Sarah]");
    // And the instance is unchanged by either call: the option is per-call, not a mutation.
    assert.equal(always.get("Wrap.Value", { value: "Sarah" }), `[${FSI}Sarah${PDI}]`);

    const none = stringsFor({ bidiIsolation: "none" });
    assert.equal(none.get("Wrap.Value", { value: "Sarah" }), "[Sarah]");
    assert.equal(none.get("Wrap.Value", { value: "Sarah" }, { bidiIsolation: "all" }), `[${FSI}Sarah${PDI}]`);
  });

  it("isolates the CONVERTED value, not the caller's record", () => {
    const always = stringsFor({ bidiIsolation: "all" });
    assert.equal(always.get("Wrap.Value", { value: GENDER_FEMININE }), `[${FSI}FEMININE${PDI}]`);
    assert.equal(always.get("Wrap.Value", { value: decimal("1.50") }), `[${FSI}1.50${PDI}]`);
    assert.equal(always.get("Wrap.Value", { value: 0 }), `[${FSI}0${PDI}]`);
    assert.equal(always.get("Wrap.Value", { value: false }), `[${FSI}false${PDI}]`);
  });

  it("adds no marks for a falsy-but-present empty string", () => {
    // Present, so it is substituted; empty, so `isolate` returns early with no marks at all.
    assert.equal(stringsFor({ bidiIsolation: "all" }).get("Wrap.Value", { value: "" }), "[]");
  });
});

describe("the donor rule", () => {
  const donor = createStrings({
    fallbackLocale: "en",
    locale: "en",
    // `ar` holds only a marker, so an Arabic request for Greeting.Named is served by `en`.
    strings: { en: { "Locale.Marker": "en", "Greeting.Named": "Hello, {{name}}" }, ar: { "Locale.Marker": "ar" } },
  });

  it("does not isolate an RTL request served by an LTR catalog", () => {
    const result = donor.getResult("Greeting.Named", { name: "Sarah" }, { locale: "ar" });
    assert.equal(result.resolvedLocale, "en");
    assert.equal(result.translation, "Hello, Sarah");
  });

  it("isolates the returned failure key under the REQUESTED locale on the same instance", () => {
    // Same request shape, same instance, opposite answer — the one place the two locales differ.
    const result = donor.getResult("Farewell {{name}}", { name: "Sarah" }, { locale: "ar" });
    assert.equal(result.status, "returned-key");
    assert.equal(result.translation, `Farewell ${FSI}Sarah${PDI}`);
    assert.equal(donor.get("Farewell {{name}}", { name: "Sarah" }, { locale: "en" }), "Farewell Sarah");
  });

  it("isolates an LTR request served by an RTL catalog", () => {
    const reversed = createStrings({
      fallbackLocale: "ar",
      locale: "en",
      strings: { ar: { "Greeting.Named": "مرحبا، {{name}}" }, en: { "Locale.Marker": "en" } },
    });
    const result = reversed.getResult("Greeting.Named", { name: "Sarah" }, { locale: "en" });
    assert.equal(result.resolvedLocale, "ar");
    assert.equal(result.translation, `مرحبا، ${FSI}Sarah${PDI}`);
  });
});

describe("generated text is not isolated merely because it was generated", () => {
  const strings = createStrings({
    fallbackLocale: "en",
    locale: "en",
    bidiIsolation: "all",
    strings: {
      en: {
        "Greeting.Titled": {
          translation: "{{title}} {{name}} — {{city}}",
          placeholders: {
            title: { value: "gender", translations: { GENDER_MASCULINE: "Mr.", GENDER_FEMININE: "Ms." } },
          },
        },
      },
    },
  });

  it("isolates the caller's values and leaves the file-defined one bare", () => {
    assert.equal(
      strings.get("Greeting.Titled", { gender: GENDER_FEMININE, name: "Sarah", city: "القاهرة" }),
      `Ms. ${FSI}Sarah${PDI} — ${FSI}القاهرة${PDI}`,
    );
  });

  it("still isolates a caller value referenced from INSIDE a generated fragment", () => {
    // Not a corpus case and not reachable through the differential, because it needs a whole
    // `Strings` rather than one function. Pinned against the real library on the pinned JDK: the
    // recursive `interpolateTemplate` carries the same decision to every depth, so a caller value a
    // generated fragment names is isolated exactly like one the top-level template names — while the
    // fragment's own text stays bare. A port that only isolated at depth 0 renders `her Sarah` here.
    const nested = {
      en: {
        "Locale.Marker": "en",
        Nested: {
          translation: "<{{phrase}}>",
          placeholders: {
            phrase: {
              value: "gender",
              translations: {
                GENDER_MASCULINE: "his {{name}} in {{city}}",
                GENDER_FEMININE: "her {{name}} in {{city}}",
              },
            },
          },
        },
      },
    };
    const values = { gender: GENDER_FEMININE, name: "Sarah", city: "القاهرة" };
    const build = (/** @type {string} */ bidiIsolation) =>
      createStrings({ fallbackLocale: "en", locale: "en", strings: nested, .../** @type {any} */ ({ bidiIsolation }) });

    assert.equal(build("all").get("Nested", values), `<her ${FSI}Sarah${PDI} in ${FSI}القاهرة${PDI}>`);
    assert.equal(build("none").get("Nested", values), "<her Sarah in القاهرة>");
    // `en` is LTR, so the default leaves it alone even though one of the values is Arabic.
    assert.equal(build("rtl-locales").get("Nested", values), "<her Sarah in القاهرة>");
  });
});
