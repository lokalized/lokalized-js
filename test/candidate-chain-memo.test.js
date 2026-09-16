// @ts-check
/**
 * PLAN 2.2:150-156's CANDIDATE-CHAIN MEMO, and the decision that produced it.
 *
 * "The candidate chain is a function of the lookup locale, not an instance constant. If it is
 * memoized, each `Strings` instance uses a deterministic LRU keyed by normalized requested tag with
 * at most 256 retained entries; disabling the cache is also conforming. A test-only probe reports the
 * retained entry count without exposing mutable cache state. Enabled-cache tests insert at least
 * 4,096 distinct well-formed junk tags and assert the 256-entry ceiling and deterministic eviction;
 * disabled-cache tests assert zero retained entries. Both branches use a locked forced-GC/heap
 * protocol to show no retained-growth regression when the workload rises from 4,096 to 40,960 tags."
 *
 * Every sentence of that is a test below.
 *
 * **THE MEASUREMENT THAT CHOSE THIS CACHE OVER THE ONE THAT WAS DEFERRED.** M7's close deferred plan
 * 3.4:864's memo — caching the INSTANCE LOCALE's match result — to M9, because "a cache belongs with
 * the server/edge packaging that creates pressure for it". M9 built that packaging and then counted
 * which arm of `localeLookupFor` it uses. Instrumented over 1,440 lookups — 100 SSR renders, 80 edge
 * preserve-arm renders, 60 redirect-target renders — the instance-locale arm was hit **ZERO times**:
 *
 *     server: 100 SSR renders          perCallMatch 80.0%  perCallLocale 20.0%  instanceLocale 0.0%
 *     edge:   80 preserve-arm renders  perCallMatch 100%                        instanceLocale 0.0%
 *     edge:   60 redirect targets                          perCallLocale 100%   instanceLocale 0.0%
 *     plain:  100 get() with no options                                         instanceLocale 100%
 *
 * So the deferred memo is INERT for the workload it was deferred to, and it is declined permanently
 * — see `test/cache-bounds.test.js`, which carries that verdict and the test aimed at the way taking
 * it could go wrong. The chain is where the cost actually is: recomputed on every translation call
 * through every ingress, measured at 6 calls per SSR render over 4 distinct lookup tags and 8.8% of
 * end-to-end server time. Memoized, with identical rendered output and a byte-identical conformance
 * report: supplied-match lookups 33,579 -> 3,738 ns (-88.9%) — the arm the server and edge workloads
 * actually use — per-call-locale 62,378 -> 32,794 (-47.4%), instance-locale 43,720 -> 23,855 (-45.4%).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";

import { createStrings, forLocale } from "../src/core/index.js";
import {
  CANDIDATE_CHAIN_MEMO_DISABLED, CANDIDATE_CHAIN_MEMO_KEYS,
  CANDIDATE_CHAIN_MEMO_LIMIT, CANDIDATE_CHAIN_MEMO_SIZE, candidateChainMemo,
} from "../src/internal/locale.js";

const CATALOGS = { en: { K: "en" }, fr: { K: "fr" }, "fr-CA": { K: "fr-CA" }, es: { K: "es" } };
const TIEBREAKERS = { fr: ["fr", "fr-CA"] };

/** @param {boolean} [disabled] */
function instance(disabled) {
  return createStrings(/** @type {any} */ ({
    strings: CATALOGS, fallbackLocale: "en", tiebreakers: TIEBREAKERS, locale: "en",
    ...(disabled ? { [CANDIDATE_CHAIN_MEMO_DISABLED]: true } : {}),
  }));
}

const sizeOf = (/** @type {any} */ strings) => strings[CANDIDATE_CHAIN_MEMO_SIZE]();
const keysOf = (/** @type {any} */ strings) => strings[CANDIDATE_CHAIN_MEMO_KEYS]();

/** Well-formed junk: a private-use subtag under a real language, so every tag is legal and distinct. */
const junk = (/** @type {number} */ index) => `en-US-x-j${index}`;

describe("the enabled branch is bounded at 256 and evicts deterministically", () => {
  test("4,096 distinct well-formed junk tags retain exactly 256", () => {
    const strings = instance();
    assert.equal(sizeOf(strings), 0, "a fresh instance retains nothing");
    for (let index = 0; index < 4096; ++index) strings.get("K", undefined, forLocale(junk(index)));
    assert.equal(sizeOf(strings), CANDIDATE_CHAIN_MEMO_LIMIT);
    assert.equal(CANDIDATE_CHAIN_MEMO_LIMIT, 256, "plan 2.2:151 fixes the ceiling at 256");
  });

  test("and the SURVIVORS are the last 256 inserted, in insertion order", () => {
    // DETERMINISTIC EVICTION (:153). The count cannot witness this — it is 256 whichever entry was
    // discarded — which is why the key snapshot is a second probe rather than a wider first one.
    const strings = instance();
    for (let index = 0; index < 4096; ++index) strings.get("K", undefined, forLocale(junk(index)));
    const expected = Array.from({ length: 256 }, (_, offset) => `en-US-x-j${4096 - 256 + offset}`);
    assert.deepEqual([...keysOf(strings)], expected);
  });

  test("a re-touched key survives, which is what makes it an LRU and not a queue", () => {
    const strings = instance();
    for (let index = 0; index < 256; ++index) strings.get("K", undefined, forLocale(junk(index)));
    assert.equal(keysOf(strings)[0], junk(0), "the oldest entry is the first inserted");

    strings.get("K", undefined, forLocale(junk(0)));           // refresh
    assert.equal(keysOf(strings)[0], junk(1), "the refreshed key is no longer the oldest");
    assert.equal(keysOf(strings).at(-1), junk(0));

    strings.get("K", undefined, forLocale(junk(999)));         // force one eviction
    assert.equal(sizeOf(strings), 256);
    assert.ok(keysOf(strings).includes(junk(0)), "the refreshed key survived");
    assert.ok(!keysOf(strings).includes(junk(1)), "and the next-oldest was the victim");
    // A FIFO would have evicted junk(0) and kept junk(1) — the two differ on exactly this pair.
  });

  test("the key is the NORMALIZED tag, so two spellings share one entry", () => {
    // **RAW OPTION OBJECTS, NOT `forLocale`, AND AN ABLATION IS WHY.** `forLocale` normalizes at its
    // own door (`freeze({ locale: normalizeTag(locale) })`), so a probe built from it hands the memo
    // a tag that was already canonical and tests that helper rather than this key: keying on the
    // caller's raw spelling turned ZERO tests red until this call changed. `get` takes a plain
    // `TranslationCallOptions`, which is the door a raw spelling actually arrives through — and the
    // same shape as M9 S3's E5, where `parseStrings` normalized upstream of the merge.
    const strings = instance();
    strings.get("K", undefined, { locale: "fr-ca" });
    assert.equal(sizeOf(strings), 1);
    strings.get("K", undefined, { locale: "FR-Ca" });
    assert.equal(sizeOf(strings), 1, "a second spelling of one tag must not take a second slot");
    assert.deepEqual([...keysOf(strings)], ["fr-CA"]);

    // And the helper agrees with the raw door, which is what makes the two interchangeable for a
    // caller even though only one of them can exercise the key.
    strings.get("K", undefined, forLocale("fr-CA"));
    assert.equal(sizeOf(strings), 1);
  });

  test("the cached chain is FROZEN, in both branches", () => {
    // Nothing in `src/` mutates a chain today, so this is a guard on a future line rather than on a
    // present defect — and an ablation removing the freeze turns no behavioural test red, which is
    // exactly why the property is asserted directly instead of being assumed to be covered.
    for (const enabled of [true, false]) {
      const memo = candidateChainMemo(["en", "fr"], "en", undefined, enabled);
      const chain = memo.chainFor("fr-CH");
      assert.ok(Object.isFrozen(chain), `the ${enabled ? "enabled" : "disabled"} branch returned a mutable chain`);
      assert.throws(() => /** @type {string[]} */ (chain).push("nope"), TypeError);
      assert.ok(chain.length > 0, "the fixture must produce a chain worth freezing");
    }
  });
});

describe("the memo is per INSTANCE, which is the only thing that makes the key safe", () => {
  test("two instances with different catalogs do not share a chain", () => {
    // `candidateChain(tag, supported, fallbackLocale, tiebreakers)` takes four arguments and this
    // caches on one. The other three are instance constants — `supported` is `[...catalogs.keys()]`,
    // computed once in `createStrings` — so keying on the tag alone is safe PER INSTANCE and wrong
    // across instances. A module-scope map would answer the second instance from the first.
    const withCanadian = createStrings({
      strings: { en: { K: "en" }, fr: { K: "fr" }, "fr-CA": { K: "fr-CA" } },
      fallbackLocale: "en", tiebreakers: { fr: ["fr", "fr-CA"] }, locale: "en",
    });
    const withoutCanadian = createStrings({
      strings: { en: { K: "en" }, fr: { K: "fr" } }, fallbackLocale: "en", locale: "en",
    });

    assert.equal(withCanadian.get("K", undefined, forLocale("fr-CA")), "fr-CA");
    assert.equal(withoutCanadian.get("K", undefined, forLocale("fr-CA")), "fr",
      "the second instance has no fr-CA catalog and must fall back");
    // And in the other order, so a shared map is caught whichever instance primed it.
    assert.equal(withoutCanadian.get("K", undefined, forLocale("fr-CH")), "fr");
    assert.equal(withCanadian.get("K", undefined, forLocale("fr-CH")), "fr");
    assert.equal(sizeOf(withCanadian), 2);
    assert.equal(sizeOf(withoutCanadian), 2, "each instance counts only its own entries");
  });
});

describe("the disabled branch retains nothing and answers identically", () => {

  test("zero retained entries after the same 4,096-tag sweep", () => {
    const strings = instance(true);
    for (let index = 0; index < 4096; ++index) strings.get("K", undefined, forLocale(junk(index)));
    assert.equal(sizeOf(strings), 0);
    assert.deepEqual([...keysOf(strings)], []);
  });

  test("both branches render the same, INCLUDING across an eviction", () => {
    // The point of the eviction half: a chain that was evicted and recomputed must answer exactly as
    // the first computation did. Without the sweep in the middle, this compares two cache HITS.
    const enabled = instance();
    const disabled = instance(true);
    const probes = ["fr-CA", "fr-CH", "es-419", "de", "en-GB", "fr-ca"];

    const first = probes.map((tag) => enabled.getResult("K", undefined, forLocale(tag)));
    for (let index = 0; index < 4096; ++index) enabled.get("K", undefined, forLocale(junk(index)));
    const afterEviction = probes.map((tag) => enabled.getResult("K", undefined, forLocale(tag)));
    const never = probes.map((tag) => disabled.getResult("K", undefined, forLocale(tag)));

    for (const [index, tag] of probes.entries()) {
      assert.deepEqual(afterEviction[index], first[index], `${tag} changed across an eviction`);
      assert.deepEqual(afterEviction[index], never[index], `${tag} differs from the uncached answer`);
    }
    // ANTI-VACUITY: the probes must actually reach different catalogs, or this compares a column of
    // identical values.
    assert.ok(new Set(first.map((result) => result.resolvedLocale)).size > 1);
  });
});

describe("neither branch grows retained memory from 4,096 to 40,960 tags", () => {
  test("the locked forced-GC protocol, with an unbounded control that must exceed it", () => {
    // Plan 2.2:155-156 asks BOTH branches for this. Measured in a child process because a
    // trustworthy retained-heap figure needs `--expose-gc`, which `node --test` does not carry —
    // the same technique `test/cache-bounds.test.js` and `tools/scenario-0a.mjs` use.
    const root = new URL("../", import.meta.url).href;
    const source = `
      import { createStrings, forLocale } from ${JSON.stringify(new URL("src/core/index.js", root).href)};
      import { CANDIDATE_CHAIN_MEMO_DISABLED } from ${JSON.stringify(new URL("src/internal/locale.js", root).href)};
      const gc = globalThis.gc;
      const make = (off) => createStrings({ strings: ${JSON.stringify(CATALOGS)},
        fallbackLocale: "en", tiebreakers: ${JSON.stringify(TIEBREAKERS)}, locale: "en",
        ...(off ? { [CANDIDATE_CHAIN_MEMO_DISABLED]: true } : {}) });
      const measure = (fn) => { gc(); gc(); const before = process.memoryUsage().heapUsed; fn();
        gc(); gc(); return process.memoryUsage().heapUsed - before; };
      const sweep = (strings, n) => { for (let i = 0; i < n; ++i) strings.get("K", undefined, forLocale(\`en-US-x-j\${i}\`)); };
      const enabledSmall = measure(() => sweep(make(false), 4096));
      const enabledLarge = measure(() => sweep(make(false), 40960));
      const disabledSmall = measure(() => sweep(make(true), 4096));
      const disabledLarge = measure(() => sweep(make(true), 40960));
      const sink = new Map();
      const control = measure(() => { for (let i = 0; i < 40960; ++i) sink.set(\`en-US-x-j\${i}\`, ["en-US-x-j" + i, "en"]); });
      process.stdout.write(JSON.stringify({ enabledSmall, enabledLarge, disabledSmall, disabledLarge,
        control, controlSize: sink.size }));
    `;
    const measured = JSON.parse(execFileSync(process.execPath,
      ["--expose-gc", "--input-type=module", "-e", source], { encoding: "utf8", maxBuffer: 1 << 20 }));

    // THE CONTROL FIRST. A retained-growth assertion with no failing control "passes" on any machine
    // where the sweep is cheap for unrelated reasons.
    assert.equal(measured.controlSize, 40960, "the control must have retained every tag");
    assert.ok(measured.control > 4_000_000,
      `the UNBOUNDED control retained only ${measured.control} bytes — the sweep exercised nothing`);

    // TENFOLD THE WORKLOAD, NOT TENFOLD THE FOOTPRINT. The bound is generous on purpose: this is a
    // regression check on SHAPE, not a threshold anybody derived.
    for (const branch of ["enabled", "disabled"]) {
      const small = measured[`${branch}Small`];
      const large = measured[`${branch}Large`];
      assert.ok(large < 2_000_000,
        `${branch}: 40,960 tags retained ${large} bytes; the ceiling is 256 entries`);
      assert.ok(large < Math.max(small, 0) + 2_000_000,
        `${branch}: retained growth 4,096 -> 40,960 was ${large - small} bytes`);
    }
  });
});
