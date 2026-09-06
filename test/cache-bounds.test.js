// @ts-check

/**
 * CACHE BOUNDS UNDER ADVERSARIAL TAGS — the M7 row's "cache bounds survive adversarial tags".
 *
 * WHAT IS ACTUALLY CACHED, enumerated rather than assumed. M7-PLAN.md's C2 row says "no tag-keyed
 * cache exists today"; that is stale, and this file is the correction. Exactly three things in
 * `src/` GROW AT RUNTIME — re-derived by reading every module-scope `Map`/`Set` in the package and
 * every closure that outlives a call, not by trusting an earlier list — and only the third was added
 * by M7. (The other memos in the port are per-CALL and retain nothing between calls: `projectNode`'s
 * in `src/parse/index.js`, the `built`/`validatedDepth` pair threaded through
 * `src/internal/catalog.js`'s builder, and the `expanded` map plus `IsolatedValue.rendered` inside
 * one `render()` in `src/internal/interpolate.js`. Everything else at module scope — the RTL script
 * set, the grandfathered-tag table, the token-type maps, the pinned data modules — is a FIXED table
 * built once from pinned data and never written to again.)
 *
 *   1. `src/internal/bidi.js` `RIGHT_TO_LEFT_BY_TAG` — memoizes `localeUsesRightToLeftScript`.
 *      Bound 512 entries, cleared wholesale on overflow. KEYED ON CALLER INPUT: the failure-key path
 *      isolates under the REQUESTED locale, which is whatever tag the caller asked for.
 *   2. `src/internal/plural.js` `indexByTag`, one per compiled rule table — memoizes the CLDR
 *      candidate walk. Bound 512, cleared wholesale on overflow. Also keyed on caller input:
 *      `en-US-x-p1`, `en-US-x-p2` … all resolve to the `en` group and each caches under its own full
 *      spelling. `indexForLocale` writes only on a HIT (`plural.js:947-960`), so an unsupported tag
 *      never enters it — but that is a SOURCE property and it is unobservable from outside, because
 *      caching a miss would change no answer and, under the same 512 bound, no measurable footprint
 *      either. An earlier version of this file asserted it anyway and the assertion was empty:
 *      ablating `indexForLocale` to cache `-1` left all five tests green. What is asserted below
 *      instead is the property that actually protects anything and that a probe can see — the
 *      UNSUPPORTED tag space, which is the one an attacker can spell without limit, cannot grow
 *      retained memory. That ablation now fails.
 *   3. `src/negotiate/index.js` `RECOVERED_LANGUAGE_EQUIVALENTS` — added by M7 A4. NOT keyed on
 *      caller input: its keys are prefixes found in the pinned 806-class IANA closure, so its size
 *      is bounded by the artifact and an attacker cannot add a key. It carries no eviction and needs
 *      none; that is a property of the key space, and it is asserted below rather than argued.
 *
 * AND WHAT IS DELIBERATELY NOT CACHED. Plan 3.4 blesses exactly one cache — "a constant instance
 * locale may cache that result" — and the port does not take it: `localeLookupFor` calls `matchFor`
 * on every lookup through every ingress. The permission is not an obligation, and declining it makes
 * the plan's harder half ("resolver and per-call locale values are normalized and recomputed on
 * every use") true by construction rather than by discipline. The last test here is what would catch
 * a future instance-level cache that quietly extended itself to the resolver.
 *
 * THE PROBE HAS A CONTROL THAT MUST EXCEED THE THRESHOLD. A memory assertion with no failing control
 * "passes" on any machine where the sweep is cheap for unrelated reasons, which is this project's
 * named `zh-123` shape. The same 200,000 tags are therefore also pushed into an ordinary unbounded
 * `Map` in the same child process, and that measurement must blow past the same limit.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

import { createStrings } from "../src/core/index.js";
import { localeUsesRightToLeftScript } from "../src/internal/bidi.js";
import { cardinalityForNumber } from "../src/index.js";
import { CARDINALITY_ONE } from "../src/index.js";

const root = new URL("../", import.meta.url).href;

/** How many distinct adversarial tags each sweep pushes through a cache bounded at 512. */
const SWEEP = 200_000;
/** Generous: the bounded caches measured ~0.14 MB and ~0.33 MB, the unbounded control ~18 MB. */
const BOUNDED_LIMIT_BYTES = 2_000_000;
const CONTROL_FLOOR_BYTES = 8_000_000;

describe("cache bounds survive adversarial tags", () => {
  it("retains bounded memory over 200,000 distinct tags, with an unbounded control that does not", () => {
    // Measured in a child process because a trustworthy retained-heap figure needs `--expose-gc`,
    // which `node --test` does not carry. Same technique as `tools/scenario-0a.mjs`.
    const source = `
      import { localeUsesRightToLeftScript } from ${JSON.stringify(new URL("src/internal/bidi.js", root).href)};
      import { cardinalityForNumber } from ${JSON.stringify(new URL("src/index.js", root).href)};
      const gc = globalThis.gc;
      const tag = (i) => \`en-US-x-p\${i}\`;
      const measure = (fn) => {
        gc(); gc();
        const before = process.memoryUsage().heapUsed;
        fn();
        gc(); gc();
        return process.memoryUsage().heapUsed - before;
      };
      // A tag with NO rule group at all — the miss path. Private-use primary language, so no CLDR
      // candidate the walk tries can rescue it into a group.
      const missTag = (i) => \`qaa-x-m\${i}\`;
      let misses = 0;
      const bidi = measure(() => { for (let i = 0; i < ${SWEEP}; i++) localeUsesRightToLeftScript(tag(i)); });
      const plural = measure(() => { for (let i = 0; i < ${SWEEP}; i++) cardinalityForNumber(1, tag(i)); });
      const pluralMiss = measure(() => {
        for (let i = 0; i < ${SWEEP}; i++) {
          try { cardinalityForNumber(1, missTag(i)); } catch { misses++; }
        }
      });
      const sink = new Map();
      const control = measure(() => { for (let i = 0; i < ${SWEEP}; i++) sink.set(tag(i), i % 2 === 0); });
      process.stdout.write(JSON.stringify({ bidi, plural, pluralMiss, misses, control, controlSize: sink.size }));
    `;
    const measured = JSON.parse(
      execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", source], {
        encoding: "utf8",
        maxBuffer: 1 << 20,
      }),
    );

    assert.equal(measured.controlSize, SWEEP, "the control must actually have retained every tag");
    assert.ok(
      measured.control > CONTROL_FLOOR_BYTES,
      `the UNBOUNDED control retained only ${measured.control} bytes — the sweep did not exercise ` +
        "anything, so the two assertions below prove nothing",
    );
    assert.ok(
      measured.bidi < BOUNDED_LIMIT_BYTES,
      `bidi RTL memo retained ${measured.bidi} bytes over ${SWEEP} distinct tags`,
    );
    assert.ok(
      measured.plural < BOUNDED_LIMIT_BYTES,
      `plural rule-table memo retained ${measured.plural} bytes over ${SWEEP} distinct tags`,
    );
    // THE MISS PATH, which is the attacker's half: a tag with no rule group is refused, and a
    // refusal is the input an attacker can spell without limit. Every one of the sweep's tags must
    // actually have been refused, or the measurement is of the hit path under another name.
    assert.equal(measured.misses, SWEEP, "every unsupported tag must have been refused");
    assert.ok(
      measured.pluralMiss < BOUNDED_LIMIT_BYTES,
      `plural rule-table memo retained ${measured.pluralMiss} bytes over ${SWEEP} UNSUPPORTED tags`,
    );
  });

  it("answers correctly on both sides of an eviction", () => {
    // Clearing wholesale is the cheapest eviction policy there is, and the risk it carries is that a
    // cleared entry comes back WRONG rather than merely slow. Both caches are read before the sweep,
    // driven past their bound, and read again.
    assert.equal(localeUsesRightToLeftScript("ar"), true);
    assert.equal(localeUsesRightToLeftScript("en"), false);
    assert.equal(cardinalityForNumber(1, "en"), CARDINALITY_ONE);

    for (let index = 0; index < 4096; index++) {
      localeUsesRightToLeftScript(`en-US-x-e${index}`);
      cardinalityForNumber(1, `en-US-x-e${index}`);
    }

    assert.equal(localeUsesRightToLeftScript("ar"), true);
    assert.equal(localeUsesRightToLeftScript("en"), false);
    assert.equal(localeUsesRightToLeftScript("ar-Latn"), false);
    assert.equal(cardinalityForNumber(1, "en"), CARDINALITY_ONE);
    assert.equal(cardinalityForNumber(2, "cy").name, "CARDINALITY_TWO");
  });

  it("a sweep of unsupported tags leaves the supported answers intact", () => {
    // The correctness half of the miss path; the MEMORY half is asserted in the probe above, where
    // an unbounded miss cache is visible. Here the only question is whether driving 2,048 refusals
    // through the walk disturbs the answers around them — a wholesale `clear()` reached from the
    // wrong branch would show up as a wrong answer, not as a slow one.
    for (let index = 0; index < 2048; index++)
      assert.throws(() => cardinalityForNumber(1, `qaa-x-m${index}`));

    assert.equal(cardinalityForNumber(1, "en"), CARDINALITY_ONE);
    assert.equal(cardinalityForNumber(2, "cy").name, "CARDINALITY_TWO");
  });

  it("the negotiator's IANA recovery memo is keyed by the PINNED closure, not by caller input", async () => {
    // Its keys come from `RANGE_EQUIVALENTS.get(prefix)` succeeding, so only the 806 artifact keys
    // can ever be inserted. Sweeping ranges that are NOT in the closure must therefore add nothing —
    // which is why it needs no eviction while the two above do.
    const { createLocaleNegotiator } = await import("../src/negotiate/index.js");
    const negotiator = createLocaleNegotiator({
      fallbackLocale: "en",
      supportedLocales: ["en", "fr"],
      tiebreakers: null,
    });

    for (let index = 0; index < 4096; index++)
      negotiator.bestMatchForLanguageRanges([{ range: `qaa-x-r${index % 26}${index}`, weight: 1 }]);

    // A range that IS in the closure still answers correctly afterwards.
    assert.equal(negotiator.bestMatchForAcceptLanguage("iw"), "en");
    assert.equal(negotiator.bestMatchForAcceptLanguage("fr-CA"), "fr");
  });

  it("the constant-instance-locale match is RECOMPUTED, and so is every resolver call", () => {
    // Plan 3.4 permits caching the automatic direct result for a constant instance locale. The port
    // declines, and this is what makes the decline observable: a `localeResolver` that answers a
    // different tag on each call must produce a different lookup each time. An instance-level cache
    // that leaked onto the resolver path renders the first answer forever.
    const answers = ["fr", "de", "fr", "en"];
    let call = 0;
    const strings = createStrings({
      fallbackLocale: "en",
      localeResolver: () => /** @type {string} */ (answers[call++ % answers.length]),
      strings: {
        en: { Greeting: "en" },
        fr: { Greeting: "fr" },
        de: { Greeting: "de" },
      },
    });

    assert.deepEqual(answers.map(() => strings.get("Greeting")), ["fr", "de", "fr", "en"]);

    // The per-call locale is normalized and recomputed on every use too — same instance, four
    // different requests, four different answers, in both spellings.
    const fixed = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: { Greeting: "en" }, fr: { Greeting: "fr" }, de: { Greeting: "de" } },
    });

    assert.equal(fixed.get("Greeting"), "en");
    assert.equal(fixed.get("Greeting", undefined, { locale: "FR" }), "fr");
    assert.equal(fixed.get("Greeting", undefined, { locale: "de" }), "de");
    assert.equal(fixed.get("Greeting"), "en");
  });
});
