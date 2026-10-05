// @ts-check

/**
 * The three runtime budgets of `src/internal/interpolate.js`, driven at MODULE level.
 *
 * WHY MODULE LEVEL, and not through `createStrings`: every corpus row that pins a budget from an
 * interesting distance sets `runtimeLimits` on its fixture, and plan 4.6 makes a `runtimeLimits`
 * option a construction-time refusal in v1. `conformance.mjs` attributes all 43 of those rows to
 * `runtime-limit overrides are not implemented` and they must stay attributed — so the recorded
 * Java answers in them are evidence this port can otherwise never be measured against. `render`
 * takes the three numbers on its context, which is exactly the seam that lets these rows be
 * replayed. Each assertion below names the row it reproduces.
 *
 * Only three corpus rows run under the FIXED defaults, and conformance covers those; what is here
 * is the part conformance structurally cannot reach. Two of the assertions correct what their rows
 * claim about themselves, and both corrections were reached by ablation:
 *
 * - moving `isolate`'s length rejection after the already-isolated fast path is invisible through
 *   the interpolator, because `appendChecked` re-tests the same value against the same remainder
 *   and raises the same diagnostic. It is visible on a direct `isolate` call, and only there.
 * - dropping `BoundedIsolatedValue`'s memo changes nothing at all: re-isolating checks the raw
 *   length against the remainder and then overruns in the append loop, throwing identically.
 *
 * Every group carries a control expected to SUCCEED beside the one expected to fail. A limit test
 * whose input is refused by an earlier guard proves nothing about the limit.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isolate } from "../src/internal/bidi.js";
import { parseCatalog } from "../src/internal/catalog.js";
import { render } from "../src/internal/interpolate.js";

const FIRST_STRONG_ISOLATE = "⁨";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/**
 * @param {Record<string, unknown>} catalog
 * @param {string} key
 */
function definitionFor(catalog, key) {
  const definition = parseCatalog(catalog, { locale: "en", source: "t" }).get(key);
  assert.ok(definition);
  return definition;
}

/**
 * @param {Partial<import("../src/internal/interpolate.js").RenderContext>} overrides
 * @returns {import("../src/internal/interpolate.js").RenderContext}
 */
function contextWith(overrides) {
  return { key: "K", evaluationLocale: "en", ...overrides };
}

describe("maximumInterpolatedOutputCharacters", () => {
  const greeting = definitionFor({ "Greeting": "Hi {{name}}" }, "Greeting");

  it("admits output landing exactly ON the limit and refuses one past it", () => {
    // `runtime-limits.interpolated-output.limit-eight.output-at-the-limit` — 'Hi ' plus a
    // five-character value is exactly 8 against a limit of 8, and Java records TRANSLATED.
    assert.equal(
      render(greeting, { name: "Bobby" }, contextWith({
        key: "Greeting",
        maximumInterpolatedOutputCharacters: 8,
      })),
      "Hi Bobby",
    );

    // One character more is the other half of the boundary. Both halves, or neither: a port with an
    // off-by-one in `appendChecked` passes whichever half it was written against.
    assert.throws(
      () => render(greeting, { name: "Bobbye" }, contextWith({
        key: "Greeting",
        maximumInterpolatedOutputCharacters: 8,
      })),
      { message: "Interpolated output exceeds the maximum of 8 characters" },
    );
  });

  it("charges the isolate marks to the same limit", () => {
    // `runtime-limits.interpolated-output.limit-eight.isolation-markers-are-charged-to-the-limit` —
    // byte-for-byte the input that renders above, with only isolation turned on. The two marks push
    // it to 10, so the ONLY evidence that isolation is inside the budget is this pair.
    assert.throws(
      () => render(greeting, { name: "Bobby" }, contextWith({
        key: "Greeting",
        maximumInterpolatedOutputCharacters: 8,
        isolateValues: true,
      })),
      { message: "Interpolated output exceeds the maximum of 8 characters" },
    );

    // The control: the same isolated render fits once the limit covers the marks.
    assert.equal(
      render(greeting, { name: "Bobby" }, contextWith({
        key: "Greeting",
        maximumInterpolatedOutputCharacters: 10,
        isolateValues: true,
      })),
      `Hi ${FIRST_STRONG_ISOLATE}Bobby${POP_DIRECTIONAL_ISOLATE}`,
    );
  });

  it("reports the WHOLE budget, not the remainder, when a later occurrence overruns", () => {
    // `owed.m3b.bidi.repeated-placeholder-second-occurrence-overruns`. The first `{{v}}` isolates to
    // 6 characters, leaving 5 of 11; the second needs 6 and fails. Java names 11 — the full limit —
    // and a port reporting the remainder it was handed would say 5.
    const twice = definitionFor({ "Twice.Value": "{{v}}{{v}}" }, "Twice.Value");

    assert.throws(
      () => render(twice, { v: "abcd" }, contextWith({
        key: "Twice.Value",
        maximumInterpolatedOutputCharacters: 11,
        isolateValues: true,
      })),
      { message: "Interpolated output exceeds the maximum of 11 characters" },
    );

    assert.equal(
      render(twice, { v: "abcd" }, contextWith({
        key: "Twice.Value",
        maximumInterpolatedOutputCharacters: 12,
        isolateValues: true,
      })),
      `${FIRST_STRONG_ISOLATE}abcd${POP_DIRECTIONAL_ISOLATE}`.repeat(2),
    );
  });

  it("refuses an already-isolated value that is longer than the remaining budget", () => {
    // `owed.m3b.bidi.pre-isolated-value-longer-than-budget-rejected-before-early-return`. Reproduced
    // for the ANSWER; the ordering claim that row makes about itself is checked below, where it is
    // actually observable.
    const wrap = definitionFor({ "Wrap.Value": "[{{value}}]" }, "Wrap.Value");
    const preIsolated = `${FIRST_STRONG_ISOLATE}abcdefgh${POP_DIRECTIONAL_ISOLATE}`;

    assert.throws(
      () => render(wrap, { value: preIsolated }, contextWith({
        key: "Wrap.Value",
        maximumInterpolatedOutputCharacters: 10,
        isolateValues: true,
      })),
      { message: "Interpolated output exceeds the maximum of 10 characters" },
    );

    // The control, and it also pins idempotence under a limit: an already-isolated value is passed
    // through rather than wrapped a second time, so 12 is enough for `[` + 10 + `]`.
    assert.equal(
      render(wrap, { value: preIsolated }, contextWith({
        key: "Wrap.Value",
        maximumInterpolatedOutputCharacters: 12,
        isolateValues: true,
      })),
      `[${preIsolated}]`,
    );
  });
});

describe("isolate's length rejection is ordered before the fast path", () => {
  const preIsolated = `${FIRST_STRONG_ISOLATE}abcdefgh${POP_DIRECTIONAL_ISOLATE}`;

  it("rejects an oversized already-isolated value instead of returning it", () => {
    // THE ONLY PLACE this ordering is observable. Through `render` the interpolator's own append
    // check catches the same value with the same message, which is why the corpus row cannot see
    // it. Ablated: moving the test after the fast path leaves conformance at 1,917 passed / 0
    // FAILED and turns exactly this assertion red.
    assert.throws(() => isolate(preIsolated, 9, 10), {
      message: "Interpolated output exceeds the maximum of 10 characters",
    });

    // Control expected to SUCCEED, at the boundary: 10 characters against a budget of exactly 10.
    assert.equal(isolate(preIsolated, 10, 10), preIsolated);
  });

  it("keeps -1 meaning no limit and refuses anything below it", () => {
    assert.equal(isolate("abcd"), `${FIRST_STRONG_ISOLATE}abcd${POP_DIRECTIONAL_ISOLATE}`);
    assert.equal(isolate("abcd", -1), `${FIRST_STRONG_ISOLATE}abcd${POP_DIRECTIONAL_ISOLATE}`);
    assert.throws(() => isolate("abcd", -2), RangeError);
  });

  it("charges the wrapper's own marks", () => {
    // A four-character value needs six. Five is not enough and six is, which is the pair that
    // separates "the marks are free" from "the marks are charged".
    assert.throws(() => isolate("abcd", 5, 5), {
      message: "Interpolated output exceeds the maximum of 5 characters",
    });
    assert.equal(isolate("abcd", 6, 6), `${FIRST_STRONG_ISOLATE}abcd${POP_DIRECTIONAL_ISOLATE}`);
  });
});

describe("maximumGeneratedExpansionCharacters", () => {
  it("charges each distinct generated placeholder exactly once", () => {
    // `{{a}}` twice is ONE expansion of three characters, not two: `interpolateTemplate` memoizes by
    // name, so a budget of 3 renders and a budget of 2 does not. A port charging per OCCURRENCE
    // fails the first assertion, and one charging nothing fails the second.
    const repeated = definitionFor(
      { K: { translation: "{{a}}{{a}}", placeholders: { a: { translation: "xyz" } } } },
      "K",
    );

    assert.equal(
      render(repeated, {}, contextWith({ maximumGeneratedExpansionCharacters: 3 })),
      "xyzxyz",
    );
    assert.throws(
      () => render(repeated, {}, contextWith({ maximumGeneratedExpansionCharacters: 2 })),
      /exceeds the cumulative limit of 2 characters/,
    );
  });

  it("charges at every level of a nested expansion", () => {
    // `a` -> "A-{{b}}" -> "A-B": `b` costs 1 and `a` costs 3, so the whole chain costs 4 and a
    // budget that covers only the outer expansion is not enough.
    const chain = definitionFor(
      {
        K: {
          translation: "{{a}}",
          placeholders: { a: { translation: "A-{{b}}" }, b: { translation: "B" } },
        },
      },
      "K",
    );

    assert.equal(render(chain, {}, contextWith({ maximumGeneratedExpansionCharacters: 4 })), "A-B");
    assert.throws(
      () => render(chain, {}, contextWith({ maximumGeneratedExpansionCharacters: 3 })),
      /exceeds the cumulative limit of 3 characters/,
    );
  });

  it("never charges the top-level message", () => {
    // `runtime-limits.expansion.limit-zero.no-generated`: depth 0 is not a generated expansion, so a budget of ZERO
    // still renders a message that generates nothing — however long that message is.
    const plain = definitionFor({ K: "no generated placeholders here at all" }, "K");

    assert.equal(
      render(plain, {}, contextWith({ maximumGeneratedExpansionCharacters: 0 })),
      "no generated placeholders here at all",
    );

    // The control expected to FAIL: the same zero budget with one generated character in it.
    const generating = definitionFor(
      { K: { translation: "{{a}}", placeholders: { a: { translation: "x" } } } },
      "K",
    );

    assert.throws(
      () => render(generating, {}, contextWith({ maximumGeneratedExpansionCharacters: 0 })),
      /exceeds the cumulative limit of 0 characters/,
    );
  });

  it("starts fresh on every render call, so a fallback candidate is not billed for the last one", () => {
    // `runtime-limits.expansion.fallback.fr-under-any-failure-reaches-en-on-a-fresh-budget`. The walk calls `render`
    // once per candidate; a budget hoisted onto the instance or onto a per-`getResult` closure would
    // let a failed candidate's expansions starve the one that succeeds. Rendering the same
    // definition twice under a budget that exactly covers ONE render is the whole test.
    const definition = definitionFor(
      { K: { translation: "{{a}}", placeholders: { a: { translation: "xyz" } } } },
      "K",
    );

    for (let attempt = 0; attempt < 3; ++attempt)
      assert.equal(
        render(definition, {}, contextWith({ maximumGeneratedExpansionCharacters: 3 })),
        "xyz",
      );
  });
});

describe("the defaults, which are the only values v1 can reach", () => {
  it("bounds output at 262,144 and cumulative expansion at 1,048,576 with no context override", () => {
    // The two constants, pinned from both sides through a doubling chain, which is the shape the
    // corpus uses. `2^18` characters is exactly the output default; one more character is not.
    /** @type {Record<string, { translation: string }>} */
    const links = {};
    for (let level = 1; level < 19; ++level) links[`d${level}`] = { translation: `{{d${level + 1}}}{{d${level + 1}}}` };
    links.d19 = { translation: "A" };

    const atTheLimit = definitionFor({ K: { translation: "{{d1}}", placeholders: links } }, "K");
    assert.equal(render(atTheLimit, {}, contextWith({})).length, 262144);

    const onePast = definitionFor({ K: { translation: "{{d1}}X", placeholders: links } }, "K");
    assert.throws(() => render(onePast, {}, contextWith({})), {
      message: "Interpolated output exceeds the maximum of 262144 characters",
    });

    // The cumulative default is a DIFFERENT number, charged in ADDITION, and it takes a different
    // shape to reach: the chain above costs 2^19 - 1 = 524,287, comfortably inside 1,048,576, which
    // is why that case reports the output cap. Five independent 18-level chains cost 262,143 each
    // for 1,310,715 while no single expansion passes 131,072 — half the output cap — so the
    // cumulative budget is the only thing that can stop it, and it stops it during the FIFTH chain,
    // before the top-level interpolation is ever attempted. This is
    // `generated-placeholders.limits.cumulative-expansion-exceeds-character-budget` in miniature
    // (that row uses six chains), and it is the assertion that fails for a port bounding only
    // individual outputs.
    /** @type {Record<string, { translation: string }>} */
    const chains = {};
    const roots = [];

    for (let chain = 1; chain <= 5; ++chain) {
      for (let level = 1; level < 18; ++level)
        chains[`c${chain}l${level}`] = {
          translation: `{{c${chain}l${level + 1}}}{{c${chain}l${level + 1}}}`,
        };

      chains[`c${chain}l18`] = { translation: "X" };
      roots.push(`{{c${chain}l1}}`);
    }

    const overBudget = definitionFor(
      { K: { translation: roots.join(""), placeholders: chains } },
      "K",
    );

    assert.throws(() => render(overBudget, {}, contextWith({})), {
      message: /exceeds the cumulative limit of 1048576 characters/,
    });
  });
});
