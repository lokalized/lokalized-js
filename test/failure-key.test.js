// @ts-check

/**
 * The returned failure key, and the `renderName` table the renderer converts language forms through.
 *
 * Both are places where a plausible shortcut passes the common case and loses on the edges, and both
 * shortcuts were in this codebase until M5b:
 *
 * - the key was interpolated by a regex over `{{…}}`, which cannot see an escape at all; and
 * - `renderName` was derived by stripping the longest matching axis prefix, which happens to agree
 *   with the table for all 61 current names and is forbidden by plan 3.7 precisely because that
 *   agreement is an accident rather than a rule.
 *
 * `npm run diff:interpolate` proves the lenient scanner byte-identical to Java's over 542 corpus
 * strings; what this file adds is the layer above it — that a `Strings` actually routes a returned
 * key through that scanner, and that the two conversion paths (a slot in a translation and a slot in
 * a key) agree.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { LANGUAGE_FORM_NAMES } from "../src/internal/catalog.js";
import { renderNameFor } from "../src/internal/interpolate.js";
import * as root from "../src/index.js";

/** A catalog with exactly one entry, so every interesting key is a MISSING one. */
const strings = createStrings({
  fallbackLocale: "en",
  locale: "en",
  strings: { en: { "Locale.Marker": "en", Slot: "{{slot}}" } },
});

/** @param {string} key @param {Record<string, unknown>} [values] */
const key = (key, values) => strings.get(key, values);

describe("the returned failure key is a template", () => {
  it("substitutes a supplied value", () => {
    assert.equal(key("Farewell {{name}}", { name: "Sarah" }), "Farewell Sarah");
  });

  it("leaves an unsupplied placeholder in place, delimiters and all", () => {
    assert.equal(key("{{greeting}}, {{name}}!", { name: "Sarah" }), "{{greeting}}, Sarah!");
  });

  it("treats falsy-but-present values as present", () => {
    assert.equal(key("[{{v}}]", { v: "" }), "[]");
    assert.equal(key("[{{v}}]", { v: 0 }), "[0]");
    assert.equal(key("[{{v}}]", { v: false }), "[false]");
    assert.equal(key("[{{v}}]", { v: 0n }), "[0]");
    // Only null and undefined mean unresolved.
    assert.equal(key("[{{v}}]", { v: null }), "[{{v}}]");
    assert.equal(key("[{{v}}]", { v: undefined }), "[{{v}}]");
  });

  it("returns the key unchanged when there are no values at all", () => {
    assert.equal(key("Farewell {{name}}"), "Farewell {{name}}");
  });

  it("keeps a malformed name literal instead of raising", () => {
    assert.equal(key("Malformed {{2name}} for {{name}}", { name: "Sarah" }), "Malformed {{2name}} for Sarah");
    assert.equal(key("Empty {{}} for {{name}}", { name: "Sarah" }), "Empty {{}} for Sarah");
  });

  it("keeps an unclosed opening and a bare close literal instead of raising", () => {
    assert.equal(key("Hi {{name}} and {{other", { name: "Sarah" }), "Hi Sarah and {{other");
    assert.equal(key("Bare }} then {{name}}", { name: "Sarah" }), "Bare }} then Sarah");
  });

  it("processes escapes, which a regex over well-formed tokens cannot", () => {
    // Mode-INDEPENDENT: the three escape forms behave exactly as in a catalog translation.
    assert.equal(key("Escapes \\\\ and \\{{esc}} and \\}} end"), "Escapes \\ and {{esc}} and }} end");
    assert.equal(key("Hello {{name}}, literal \\{{name}}", { name: "Ada" }), "Hello Ada, literal {{name}}");
  });

  it("lets an escaped opening swallow a following REAL placeholder", () => {
    // The forward scan finds the next `}}` anywhere, not a matching one. A port that scoped the
    // escape to the adjacent token substitutes Ada here; Java does not.
    assert.equal(
      key("\\{{escaped open and {{name}} then tail", { name: "Ada" }),
      "{{escaped open and {{name}} then tail",
    );
  });

  it("RESUMES interpolating after the swallowed region, at the `}}` that ended it", () => {
    // The case above cannot tell the two candidate readings apart, and that is the point of this
    // one. Its tail is inert, so "scan to the next `}}`" and "give up and copy the rest literally"
    // produce the same string. They stop agreeing the moment a resolvable placeholder follows: the
    // escaped region ends at the `}}` of the swallowed `{{name}}`, and everything after it is
    // ordinary template again. Verified against the real `StringInterpolator` on the pinned JDK,
    // which answers `{{a {{name}} b}} Ada` — and `npm run diff:interpolate` now sweeps these shapes.
    assert.equal(key("\\{{a {{name}} b}} {{name}}", { name: "Ada" }), "{{a {{name}} b}} Ada");
    assert.equal(key("\\{{ {{name}} }}{{name}}", { name: "Ada" }), "{{ {{name}} }}Ada");
    assert.equal(key("\\{{{{name}}}}{{name}}", { name: "Ada" }), "{{{{name}}}}Ada");
    // And when no `}}` follows the inner opening at all, the region really does run to the end.
    assert.equal(key("x\\{{y {{name}}", { name: "Ada" }), "x{{y {{name}}");
  });

  it("copies an escaped region without re-processing escapes inside it", () => {
    // The region ends at the `}}` of the inner `\}}`, so the inner backslash survives and the
    // leftover `}}` later in the string takes the lenient literal-close branch.
    assert.equal(key("Region \\{{a \\}} b}} tail"), "Region {{a \\}} b}} tail");
  });

  it("survives a trailing lone backslash at the end of the string", () => {
    assert.equal(key("After {{name}} a backslash \\", { name: "Ada" }), "After Ada a backslash \\");
  });

  it("converts a value the same way a real slot does, not through String()", () => {
    for (const value of [root.GENDER_NEUTER, root.CARDINALITY_ONE, root.decimal("1.50"), 0, false, 12n]) {
      const inTranslation = strings.get("Slot", { slot: value });
      const inKey = key("{{slot}}", { slot: value });
      assert.equal(inKey, inTranslation, `${String(inTranslation)} must render identically in a key`);
      assert.notEqual(inKey, "[object Object]");
    }
  });

  it("treats magic property names as ordinary placeholder names", () => {
    for (const name of ["__proto__", "constructor", "prototype"]) {
      // Unsupplied: literal, never resolved off the prototype chain.
      assert.equal(key(`[{{${name}}}]`), `[{{${name}}}]`);
      // Supplied as an OWN property: an ordinary value.
      assert.equal(key(`[{{${name}}}]`, { [name]: "v" }), "[v]");
    }
  });

  it("never raises out of the fail-soft path, whatever the value does", () => {
    const hostile = {
      toString() {
        throw new Error("hostile toString");
      },
    };
    // Java wraps the whole interpolation in a catch that returns the raw key.
    assert.equal(key("Hostile {{v}}", { v: hostile }), "Hostile {{v}}");
  });
});

describe("renderNameFor", () => {
  it("is a table lookup over the one generated list, not a prefix strip", () => {
    let checked = 0;

    for (const [, prefix, members] of LANGUAGE_FORM_NAMES)
      for (const member of members) {
        assert.equal(renderNameFor(`${prefix}${member}`), member);
        ++checked;
      }

    assert.equal(checked, 61, "all 61 language-form names are covered");
  });

  it("returns an unknown name unchanged rather than mangling it", () => {
    // A prefix strip would answer "MADE_UP" for the first of these and "" for the second.
    assert.equal(renderNameFor("GENDER_"), "GENDER_");
    assert.equal(renderNameFor("CARDINALITY_MADE_UP"), "CARDINALITY_MADE_UP");
    assert.equal(renderNameFor("NOT_A_FORM"), "NOT_A_FORM");
  });

  it("agrees with the renderName every public constant carries", () => {
    for (const [, prefix, members] of LANGUAGE_FORM_NAMES)
      for (const member of members) {
        const constant = /** @type {any} */ (root)[`${prefix}${member}`];
        assert.equal(constant.renderName, renderNameFor(constant.name));
        // And that is what a plain slot renders, which is the reason renderName exists.
        assert.equal(strings.get("Slot", { slot: constant }), member);
      }
  });
});
