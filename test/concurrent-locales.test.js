// @ts-check
/**
 * CONCURRENT LOCALES HAVE NO CROSS-TALK — M8 acceptance clause 77, plan 9.3:2851's "Node server
 * concurrency with per-call locales" and the M8 exit gate at plan 9.3:2924.
 *
 * **THE OBVIOUS PROBE IS VACUOUS, AND NAMING IT IS THE POINT OF THIS HEADER.**
 * `await Promise.all(locales.map((l) => strings.get(k, p, { locale: l })))` is not concurrency. A
 * translation call is synchronous (the first suite asserts that by name, from inside the callbacks
 * the call owes), so those calls run to completion one after another in map order and the shape is
 * green under every ablation recorded below. It looks exactly like an instrument and sees nothing.
 * The same verdict, for the same reason, kills a `worker_threads` probe: each worker gets its own
 * isolate and its own module registry, so every module-scope defect is re-created per worker and
 * never crosses — a worker probe is structurally incapable of failing here.
 *
 * **SO WHAT IS ACTUALLY CHECKABLE SPLITS IN TWO, and there is no third class.** In single-threaded
 * JS with a synchronous `get`, two top-level translations cannot overlap in time. Everything this
 * file can prove about the core is therefore either
 *
 *   - STATE SURVIVAL — call N+1 must not read what call N left behind (K2, K6, K7), which is red
 *     sequentially too and is interleaved here because that is the USAGE the clause names; or
 *   - RE-ENTRANCY — the only way two translations really do overlap, because the library invokes
 *     application code (a fallback policy, a phonetic resolver, a placeholder getter, an observer)
 *     in the middle of a call and that code can call back in (K3, K4, K5).
 *
 * A module-scope scratch is invisible to a sequential suite precisely because each call overwrites
 * it before the next begins — masked by the property that makes it look safe. Re-entrancy is what
 * removes the mask.
 *
 * The LOAD side is different and is where the barrier earns its keep: loads are genuinely
 * concurrent, so L1's accumulator ablation is GREEN sequentially and RED interleaved by
 * construction, and L2's "independent of request completion timing" (plan 6.2:2080) cannot be
 * observed at all by a test that does not CONTROL completion timing. Both use the injected
 * `readFile` hook, which is a declared public option of `LoadStringsFromFilesOptions`, so the
 * scheduler needs no internals.
 *
 * **THERE IS NO ORACLE FOR ANY ROW HERE AND THAT IS THE REPORTABLE FACT.** Java answers this clause
 * with immutability under the JVM memory model, which no JS run can corroborate or contradict; Java
 * has no manifest, no SHA-256, no abort and no SSR concept. There is no corpus case, no differential
 * and no recorded behaviour to compare against — every check below is invented, as
 * `computeCatalogIdentity`'s were. So the anti-vacuity discipline IS the evidence:
 *
 *   1. a SCHEDULE or NESTING witness is asserted FIRST and by name, before any content assertion,
 *      so a degenerate run cannot report green with the content never meaningfully exercised;
 *   2. every probe has a CONTROL that must pass end to end, so a probe turned away by an earlier
 *      guard cannot "confirm" a conclusion it never exercised;
 *   3. pairwise-distinct expectations are asserted as FIXTURE FACTS, never assumed — two locales
 *      whose expected strings coincided would prove nothing;
 *   4. contamination is asserted by NAME (`!includes("Bruno")`), not folded into an equality that
 *      would report a foreign value as one anonymous mismatch.
 *
 * **HOW MUCH OF THIS THE CORPUS CAN SEE — MEASURED, NOT ASSERTED.** Every mutation below was applied
 * to `src/`, `npm run conformance` was run with its status read from `$?` on a redirected run, and the
 * source restored and re-hashed. Baseline: 2,117 passed / 0 FAILED / 76 unsupported, exit 0.
 *
 * | ablation                                                  | conformance            |
 * |---|---|
 * | dispatch the fallback observer from a microtask           | 2,117 / 0 — IDENTICAL  |
 * | memoize the candidate chain PER INSTANCE                  | 2,117 / 0 — IDENTICAL  |
 * | one shared render context, mutated per candidate          | 2,117 / 0 — IDENTICAL  |
 * | one shared, per-render-cleared placeholder value map      | 2,117 / 0 — IDENTICAL  |
 * | memoize the instance resolver's first answer              | 2,117 / 0 — IDENTICAL  |
 * | module-scope load slots / arrival order / limits / signal / semaphore | 2,117 / 0 — IDENTICAL |
 * | collapse `getLocaleConfiguration()` onto the loaded set   | 2,117 / 0 — IDENTICAL  |
 * | memoize the DIRECT-LOCALE CONTEXT                         | 1,961 / **156 FAILED** |
 * | hoist the candidate-chain memo to MODULE scope            | 1,914 / **202 FAILED** |
 * | a process-global CATALOG cache                            | 1,051 / **1,015 FAILED** |
 *
 * So eleven of the fourteen are invisible to the corpus and this file is their only enforcement —
 * and three are LOUD, which is worth stating in the same breath: a design note claiming the corpus is
 * blind to a module-scope chain cache would have been the inverse of the fact. The corpus runs 2,363
 * cases in ONE process and `fr` alone appears under 21 different fixtures, so a cache keyed on the tag
 * hands one fixture's chain to the next. Those three rows are kept for their UNIQUE coverage — two
 * differently-loaded instances at one tag, and a second rendering context — not for a blindness claim.
 *
 * **WIRING.** `npm test` is bare `node --test`, so this file is in `npm run verify` and in CI by
 * existing rather than by being listed anywhere. The ablation table lives in the slice record; each
 * row below names the mutation it was measured against.
 *
 * **WHAT THIS FILE DOES NOT PROVE, said plainly so no later text can over-read it.**
 *   - The MEASUREMENT half of 9.3 — throughput under concurrency — is not a pass/fail probe and is
 *     not here. Gating it on a developer machine would import machine-dependent numbers into an
 *     artifact, which is the reasoning that made 0a's browser half report-only and produced
 *     amendment A3. The cross-talk assertions gate; the timing columns can only be recorded.
 *   - "No cross-talk" as a UNIVERSAL QUANTIFIER is not executable. These probes cover the channels
 *     the public API exposes: translation text, result and match fields, warnings, failures,
 *     coverage, identity, `complete`, stamp fields, thrown errors and callback delivery. State
 *     retained from another request with no observable effect is a memory-retention property and
 *     belongs to the 0a/2k heap columns, not to this clause.
 *   - A real `node:http` server would make the interleaving the OS scheduler's, so the suite would
 *     gate on scheduling luck: green on a fast machine having proven nothing, flaky on a loaded one.
 *     The barriers below are strictly stronger because they make the overlap an ASSERTED FACT.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createStrings, forLocale, THROW_EXCEPTION } from "../src/core/index.js";
import { PHONETIC_CONSONANT, PHONETIC_VOWEL } from "../src/index.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";
import { loadEntireManifestFromFiles, loadStringsFromFiles } from "../src/node/index.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { createSsrStamp, validateSsrStamp } from "../src/ssr/index.js";

const scratch = mkdtempSync(join(tmpdir(), "lokalized-concurrent-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------
// THE SIX-VOICE FIXTURE — one instance, six catalogs, every answer distinguishable from every
// other. The discriminators are chosen so a leak cannot render as a coincidence: at `count: 0` the
// six locales select FOUR DIFFERENT CLDR categories (en/de/he OTHER, fr ONE, ar ZERO, es OTHER) and
// each catalog spells its own tag into the text, so a sibling leak, an instance-constant leak and a
// fallback-to-`en` leak are three different wrong strings.
// ---------------------------------------------------------------------------------------------

/** Every cardinal form spelled as `<TAG>-<category>:{{count}}` — tag AND category readable. */
const cardinalForms = (/** @type {string} */ tag) => ({
  CARDINALITY_ZERO: `${tag}-zero:{{count}}`,
  CARDINALITY_ONE: `${tag}-one:{{count}}`,
  CARDINALITY_TWO: `${tag}-two:{{count}}`,
  CARDINALITY_FEW: `${tag}-few:{{count}}`,
  CARDINALITY_MANY: `${tag}-many:{{count}}`,
  CARDINALITY_OTHER: `${tag}-other:{{count}}`,
});

/**
 * `{{count}}` is a CALLER-supplied value, so `bidiIsolation: "rtl-locales"` wraps it in U+2068/U+2069
 * for an RTL evaluation locale and leaves it bare otherwise. That gives a third observation channel
 * (isolate controls) beside category and wording — see K3, where the channels' independence is
 * stated precisely rather than assumed.
 */
const voiceCatalog = (/** @type {string} */ tag, { promo = true } = {}) => ({
  "Cart.Items": {
    translation: "{{form}}",
    placeholders: { form: { value: "count", translations: cardinalForms(tag) } },
  },
  // Cart.Promo is ABSENT from `de` on purpose: a `de-AT` request then walks de-AT -> de -> en, which
  // is the deep path that consults a policy twice and fires an observer once.
  ...(promo ? { "Cart.Promo": `${tag}-promo name={{name}} count={{count}} tier={{tier}}` } : {}),
  // The phonetic resolver fires at RENDER time, strictly later in a call than the fallback policy —
  // which is why K3 uses both as seams. `{{form}}` is resolved AFTER `{{article}}`, so the cardinal
  // classification and the bidi isolation below both happen after the resolver returned.
  "Cart.Article": {
    translation: "{{article}}/{{form}}",
    placeholders: {
      article: {
        value: "term",
        translations: { PHONETIC_VOWEL: `${tag}-VOWEL`, PHONETIC_CONSONANT: `${tag}-CONS` },
      },
      form: { value: "count", translations: cardinalForms(tag) },
    },
  },
});

/** @type {{ term: string, locale: string }[]} */
const phoneticCalls = [];
/** Set by the re-entrancy suites; the resolver consults it so the seam is opt-in per test. */
/** @type {null | ((term: string, locale: string) => void)} */
let phoneticReentry = null;

/** @type {any} */
let voices;
voices = createStrings({
  fallbackLocale: "en",
  // A SEVENTH distinct value. The instance constant is deliberately a locale no handler requests, so
  // "the per-call locale was ignored and the instance constant used" is a self-identifying red
  // rather than an answer that happens to look like one of the siblings'.
  locale: "es",
  // SET EXPLICITLY, never inherited from the default. An isolate expectation resting on an unstated
  // default goes quietly vacuous the day the default moves, instead of going red.
  bidiIsolation: "rtl-locales",
  phoneticResolver: (/** @type {string} */ term, /** @type {string} */ locale) => {
    phoneticCalls.push({ term, locale });
    phoneticReentry?.(term, locale);
    return term === "apple" ? PHONETIC_VOWEL : PHONETIC_CONSONANT;
  },
  strings: {
    en: voiceCatalog("EN"),
    fr: voiceCatalog("FR"),
    de: voiceCatalog("DE", { promo: false }),
    ar: voiceCatalog("AR"),
    he: voiceCatalog("HE"),
    es: voiceCatalog("ES"),
  },
});

/** MEASURED against unmodified source, not predicted. `count: 0` for every row. */
const EXPECTED_TEXT = {
  en: "EN-other:0",
  fr: "FR-one:0",
  de: "DE-other:0",
  ar: "AR-zero:⁨0⁩",
  he: "HE-other:⁨0⁩",
  "fr-CH": "FR-one:0",
};
const EXPECTED_CHAIN = {
  en: ["en"], fr: ["fr"], de: ["de"], ar: ["ar"], he: ["he"], "fr-CH": ["fr-CH", "fr"],
};
const EXPECTED_RESOLVED = {
  en: "en", fr: "fr", de: "de", ar: "ar", he: "he", "fr-CH": "fr",
};
const EXPECTED_MATCH = {
  en: { locale: "en", matchType: "exact" },
  fr: { locale: "fr", matchType: "exact" },
  de: { locale: "de", matchType: "exact" },
  ar: { locale: "ar", matchType: "exact" },
  he: { locale: "he", matchType: "exact" },
  "fr-CH": { locale: "fr", matchType: "cldr-fallback" },
};

/** The six requests, in the order the barrier starts them. */
const HANDLERS = /** @type {const} */ (["en", "fr", "de", "ar", "he", "fr-CH"]);
/** The five with pairwise-distinct TEXT; `fr-CH` is the sixth and is separated by CHAIN, not text. */
const TEXT_DISTINCT = /** @type {const} */ (["en", "fr", "de", "ar", "he"]);

/** One call, projected onto every channel a leak could move. */
function snapshotOf(/** @type {string} */ tag) {
  const result = voices.getResult("Cart.Items", { count: 0 }, { locale: tag });
  return {
    status: result.status,
    translation: result.translation,
    lookupLocale: result.lookupLocale,
    resolvedLocale: result.resolvedLocale,
    attemptedLocales: [...result.attemptedLocales],
    matchLocale: result.localeMatch.locale,
    matchType: result.localeMatch.matchType,
  };
}

function expectedSnapshot(/** @type {string} */ tag) {
  const key = /** @type {keyof typeof EXPECTED_TEXT} */ (tag);
  return {
    status: "translated",
    translation: EXPECTED_TEXT[key],
    lookupLocale: tag,
    resolvedLocale: EXPECTED_RESOLVED[key],
    attemptedLocales: [...EXPECTED_CHAIN[key]],
    matchLocale: EXPECTED_MATCH[key].locale,
    matchType: EXPECTED_MATCH[key].matchType,
  };
}

describe("the fixture discriminates — asserted, never assumed", () => {
  it("six handlers, five pairwise-distinct texts, and the sixth separated by CHAIN", () => {
    // TRAP 1, closed at the fixture. Two locales whose expected strings coincided would prove
    // nothing about isolation: the assertion would pass over a leak between exactly those two.
    const texts = TEXT_DISTINCT.map((tag) => EXPECTED_TEXT[tag]);
    assert.equal(new Set(texts).size, 5, "the five text-distinct voices must not coincide");

    // `fr-CH` loads no catalog of its own, so it RESOLVES from `fr` and its text is `fr`'s. That is
    // a fact about the fixture and is asserted as one, because the pair is the only one in the set
    // that exercises an unloaded per-call tag — and the ONLY channel that separates the two is
    // `attemptedLocales`, which is why every per-call assertion block below carries it.
    assert.equal(EXPECTED_TEXT["fr-CH"], EXPECTED_TEXT.fr, "fr-CH is served by the fr catalog");
    assert.notDeepEqual(EXPECTED_CHAIN["fr-CH"], EXPECTED_CHAIN.fr,
      "…so only the candidate chain can tell the two requests apart");

    // FOUR different CLDR categories across six locales: a leak that preserved the tag prefix and
    // moved the category, or vice versa, is visible in the text either way.
    assert.ok(EXPECTED_TEXT.fr.startsWith("FR-one"), "French `one` covers i=0");
    assert.ok(EXPECTED_TEXT.en.startsWith("EN-other"), "English 0 is OTHER");
    assert.ok(EXPECTED_TEXT.ar.startsWith("AR-zero"), "Arabic 0 is ZERO");

    // The isolate controls, asserted as a fixture fact on BOTH sides — the RTL voices carry them and
    // the LTR voices must not, so a port that isolated unconditionally is red here.
    for (const tag of /** @type {const} */ (["ar", "he"]))
      assert.ok(EXPECTED_TEXT[tag].includes("⁨") && EXPECTED_TEXT[tag].includes("⁩"),
        `${tag} is RTL and isolates the caller's value`);
    for (const tag of /** @type {const} */ (["en", "fr", "de"]))
      assert.ok(!EXPECTED_TEXT[tag].includes("⁨"), `${tag} is LTR and must not isolate`);
  });

  it("every expectation is what the unmodified instance actually answers", () => {
    // THE CONTROL FOR EVERYTHING BELOW (trap 2). If a handler's request were turned away by an
    // ingress guard — a malformed tag, an uncovered lookup, an unknown key — every later assertion
    // would be measuring a path never taken. Reading all six here first makes that impossible.
    for (const tag of HANDLERS) assert.deepEqual(snapshotOf(tag), expectedSnapshot(tag), tag);

    // And the instance constant is a seventh value, so an instance-constant leak is self-identifying.
    const ambient = voices.getResult("Cart.Items", { count: 0 });
    assert.equal(ambient.translation, "ES-other:0");
    assert.ok(!TEXT_DISTINCT.map((t) => EXPECTED_TEXT[t]).includes(ambient.translation));
  });
});

// ---------------------------------------------------------------------------------------------
// K1 — CALL ATOMICITY. The premise the rest of the core rests on.
// ---------------------------------------------------------------------------------------------

describe("K1 — one translation call is atomic with respect to the event loop", () => {
  it("every callback the call owes has already run when it returns", () => {
    // **THE FLAG IS SAMPLED INSIDE THE CALLBACKS, NOT AFTER THE CALL, and the difference is the
    // difference between an assertion and a tautology.** Sampling `ranMicrotask` after `getResult`
    // returns cannot fail under ANY implementation: microtasks drain only when the JS stack empties,
    // and this test frame never yields between the enqueue and the read — even a fully async
    // `getResult` would return a pending thenable without draining the queue. Read from inside the
    // policy and the observer, the same flag is a real question: it asks whether the library
    // deferred that dispatch past the caller's return.
    let ranMicrotask = false;
    queueMicrotask(() => { ranMicrotask = true; });

    /** @type {unknown} */ let atPolicy = null;
    /** @type {unknown} */ let atObserver = null;
    /** @type {any[]} */ const events = [];

    const result = voices.getResult("Cart.Promo", { name: "Amira", count: 1, tier: "silver" }, {
      locale: "de-AT",
      fallbackPolicy: () => { atPolicy = ranMicrotask; return true; },
      onFallback: (/** @type {any} */ event) => { atObserver = ranMicrotask; events.push(event); },
    });

    assert.equal(atPolicy, false, "the fallback policy ran before a microtask queued before the call");
    assert.equal(atObserver, false, "the fallback observer ran before that same microtask");
    assert.equal(events.length, 1, "the observer must have fired before the call returned");
    assert.equal(/** @type {any} */ (result).then, undefined, "a translation result is not a thenable");
  });

  it("CONTROL — the same call reaches the deep walk rather than an ingress guard", () => {
    // Without this the assertions above could all be satisfied by a call that never walked: a policy
    // that is never consulted and an observer that never fires leave `atPolicy`/`atObserver` null,
    // and `null == false` is false — but `events.length` would then be 0 and the reason would be
    // invisible. Naming the walk is what makes the previous test's zeroes meaningful.
    const result = voices.getResult("Cart.Promo", { name: "Amira", count: 1, tier: "silver" },
      { locale: "de-AT", fallbackPolicy: () => true });
    assert.equal(result.status, "translated");
    assert.equal(result.lookupLocale, "de-AT");
    assert.equal(result.resolvedLocale, "en", "de holds Cart.Items but not Cart.Promo");
    assert.deepEqual([...result.attemptedLocales], ["de-AT", "de", "en"]);
    assert.equal(result.translation, "EN-promo name=Amira count=1 tier=silver");
    assert.ok(Object.isFrozen(result), "a result is frozen before it is the caller's");
  });
});

// ---------------------------------------------------------------------------------------------
// K2 — PER-CALL LOCALE ISOLATION on one shared instance.
// ---------------------------------------------------------------------------------------------

/**
 * A deterministic barrier. Six handlers start together, each runs to its first `gate()`, and the
 * driver then advances every one of them by exactly one step per wave.
 *
 * **THE BARRIER IS THE USAGE, NOT THE INSTRUMENT, and this file says so rather than letting a
 * reader infer otherwise.** K1 proves `get` is synchronous, so no ablation of it can be red
 * interleaved and green sequentially — the sequential control below is expected to go red
 * identically under the instance-memo ablation. What the barrier buys is that "these requests
 * overlapped" is an ASSERTED FACT rather than a hope, and that the shape under test is the one the
 * clause names: one server instance, several locales in flight.
 */
function barrier() {
  /** @type {(() => void)[]} */
  let waiting = [];
  return {
    gate: () => new Promise((resolve) => { waiting.push(() => resolve(undefined)); }),
    /** Release every current waiter, in the order they arrived, and let each run to its next gate. */
    async drain(/** @type {number} */ maximumWaves) {
      for (let wave = 0; wave < maximumWaves && waiting.length > 0; ++wave) {
        const released = waiting;
        waiting = [];
        for (const release of released) release();
        await new Promise((resolve) => { setImmediate(resolve); });
      }
      assert.equal(waiting.length, 0, "the driver must exhaust every handler, not run out of waves");
    },
  };
}

const ROUNDS = 3;

describe("K2 — interleaved per-call locales on ONE instance do not cross", () => {
  it("the schedule really interleaves, and every handler's answer is its own", async () => {
    /** @type {string[]} */
    const log = [];
    /** @type {Record<string, ReturnType<typeof snapshotOf>[]>} */
    const seen = {};
    const gates = barrier();

    const handler = async (/** @type {string} */ tag) => {
      seen[tag] = [];
      for (let round = 0; round < ROUNDS; ++round) {
        log.push(`${tag}:before${round}`);
        /** @type {any} */ (seen[tag]).push(snapshotOf(tag));
        await gates.gate();
        log.push(`${tag}:after${round}`);
        /** @type {any} */ (seen[tag]).push(snapshotOf(tag));
        await gates.gate();
      }
    };

    const running = HANDLERS.map((tag) => handler(tag));
    await gates.drain(2 * ROUNDS + 2);
    await Promise.all(running);

    // ── THE SCHEDULE WITNESS, ASSERTED FIRST AND BY NAME ──────────────────────────────────────
    // Derived from the handler list rather than transcribed as a 36-element literal, because a
    // literal that long drifts and a drifted literal is edited to match whatever the run produced.
    /** @type {string[]} */
    const expectedLog = [];
    for (let round = 0; round < ROUNDS; ++round)
      for (const step of /** @type {const} */ (["before", "after"]))
        for (const tag of HANDLERS) expectedLog.push(`${tag}:${step}${round}`);
    assert.deepEqual(log, expectedLog, "the driver advances every handler one step per wave");

    // And the property the derivation exists to establish, asserted separately so it cannot be
    // satisfied by a derivation that is wrong in the same way the run is: between every handler's
    // `before` and its `after` there is at least one OTHER handler's step.
    for (const tag of HANDLERS)
      for (let round = 0; round < ROUNDS; ++round) {
        const from = log.indexOf(`${tag}:before${round}`);
        const to = log.indexOf(`${tag}:after${round}`);
        assert.ok(from >= 0 && to > from, `${tag} round ${round} is ordered`);
        const between = log.slice(from + 1, to).filter((entry) => !entry.startsWith(`${tag}:`));
        assert.ok(between.length > 0,
          `${tag} round ${round} was not overlapped by any other handler — the barrier is inert`);
      }

    // ── THE CONTENT, per call ─────────────────────────────────────────────────────────────────
    for (const tag of HANDLERS) {
      const calls = /** @type {any[]} */ (seen[tag]);
      assert.equal(calls.length, 2 * ROUNDS, `${tag} issued every call`);
      for (const [index, snapshot] of calls.entries())
        assert.deepEqual(snapshot, expectedSnapshot(tag), `${tag} call ${index}`);
    }
  });

  it("CONTROL — the same 36 calls run strictly sequentially produce the identical table", () => {
    // What makes the expectations a function of the REQUEST rather than a transcription of one
    // schedule. It is also the honest statement of this row's reach: the ablation it is written
    // against is state-survival, so this control is expected to move with it.
    for (const tag of HANDLERS)
      for (let call = 0; call < 2 * ROUNDS; ++call)
        assert.deepEqual(snapshotOf(tag), expectedSnapshot(tag), `${tag} sequential call ${call}`);
  });
});

// ---------------------------------------------------------------------------------------------
// K3 — RE-ENTRANT EVALUATION LOCALE. The only way two translations really overlap in time.
// ---------------------------------------------------------------------------------------------

/**
 * **THE TWO SEAMS ARE NOT REDUNDANT, AND THE MEASUREMENT SAYS SO.** Under the one ablation this
 * suite is written against — one render context per process, mutated per candidate instead of
 * allocated per render — SEAM 2 goes red and SEAM 1 stays GREEN. The reason is structural: the
 * fallback policy fires BETWEEN candidates, so the outer call rebuilds its context after the inner
 * one finished, and a scratch assigned per candidate is repaired by the very next assignment. Only a
 * seam that fires DURING a render — the phonetic resolver — leaves the inner call's assignment live
 * when the outer resumes. A design with the policy seam alone would have measured ZERO red here and
 * looked exactly like an instrument that sees nothing.
 */
/** MEASURED on unmodified source. `count: 2` is CARDINALITY_TWO in ar and CARDINALITY_OTHER in de. */
const ARTICLE_AR_2 = "AR-VOWEL/AR-two:⁨2⁩";
const ARTICLE_DE_2 = "DE-VOWEL/DE-other:2";

describe("K3 — a `get` re-entered from library-invoked application code", () => {
  it("the two expectations are different strings", () => {
    // Without this the row could pass by its two expectations having coincided.
    assert.notEqual(ARTICLE_AR_2, ARTICLE_DE_2);
    assert.ok(ARTICLE_AR_2.includes("⁨") && !ARTICLE_DE_2.includes("⁨"),
      "isolation is one of the channels, and the two sides must differ on it");
  });

  it("SEAM 1 (fallback policy) — the outer keeps its own evaluation locale", () => {
    // **WHY THE POLICY IS THE RIGHT SEAM RATHER THAN A CONVENIENT ONE.** It fires strictly between
    // candidate resolution and the winning candidate's evaluation, which is exactly the window a
    // shared evaluation-locale variable is live in. `ar-EG` loads no catalog, so the walk attempts
    // it, consults the policy — and only then evaluates from `ar`.
    /** @type {string[]} */ const log = [];
    /** @type {any} */ let inner = null;

    log.push("outer-enter");
    const outer = voices.getResult("Cart.Article", { term: "apple", count: 2 }, {
      locale: "ar-EG",
      fallbackPolicy: () => {
        log.push("inner-enter");
        inner = voices.getResult("Cart.Article", { term: "apple", count: 2 }, { locale: "de" });
        log.push("inner-exit");
        return true;
      },
    });
    log.push("outer-exit");

    // THE NESTING WITNESS, FIRST. A policy that never fired would leave every assertion below
    // measuring a call that was never re-entered.
    assert.deepEqual(log, ["outer-enter", "inner-enter", "inner-exit", "outer-exit"]);

    assert.equal(inner.status, "translated");
    assert.equal(inner.translation, ARTICLE_DE_2);

    assert.equal(outer.status, "translated");
    assert.equal(outer.resolvedLocale, "ar", "the walk reached the ar catalog, not the empty ar-EG");
    assert.equal(outer.translation, ARTICLE_AR_2);
    // Named separately rather than folded into the equality above: `translation` carries category,
    // wording and isolate controls, and under this ablation all three move together. The genuinely
    // INDEPENDENT channel is `resolvedLocale`, asserted above — a red on the string with a green on
    // the locale localises the defect to the render stage rather than to the walk.
    assert.ok(outer.translation.includes("⁨") && outer.translation.includes("⁩"),
      "the outer renders under Arabic, which isolates");
    assert.ok(!inner.translation.includes("⁨"), "the inner renders under German, which does not");
  });

  it("SEAM 2 (phonetic resolver) — a seam the policy cannot reach", () => {
    // The resolver fires at RENDER time, strictly LATER in a call than the policy, so it
    // discriminates a scratch whose live window starts after candidate resolution — which a policy
    // seam cannot reach at all. Everything after it in this template (`{{form}}`'s cardinal
    // classification, and the bidi isolation of `{{count}}`) is post-resolver work.
    /** @type {string[]} */ const log = [];
    /** @type {any} */ let inner = null;

    phoneticReentry = (_term, locale) => {
      if (locale !== "ar") return;
      log.push("inner-enter");
      inner = voices.getResult("Cart.Article", { term: "apple", count: 2 }, { locale: "de" });
      log.push("inner-exit");
    };
    try {
      log.push("outer-enter");
      const outer = voices.getResult("Cart.Article", { term: "apple", count: 2 }, { locale: "ar" });
      log.push("outer-exit");

      assert.deepEqual(log, ["outer-enter", "inner-enter", "inner-exit", "outer-exit"]);
      assert.equal(inner.translation, ARTICLE_DE_2);
      assert.equal(outer.resolvedLocale, "ar");
      assert.equal(outer.translation, ARTICLE_AR_2,
        "the cardinal form and the isolate controls are both decided AFTER the resolver returned");
    } finally {
      phoneticReentry = null;
    }
  });

  it("CONTROL — both halves are byte-identical without any re-entrancy", () => {
    // Required green end to end. It proves the expectations above are not derived from the
    // re-entrant run, and it proves the outer walk really reaches `ar` rather than dying at the
    // catalog-less `ar-EG`.
    const outer = voices.getResult("Cart.Article", { term: "apple", count: 2 },
      { locale: "ar-EG", fallbackPolicy: () => true });
    assert.equal(outer.translation, ARTICLE_AR_2);
    assert.equal(outer.resolvedLocale, "ar");

    const inner = voices.getResult("Cart.Article", { term: "apple", count: 2 }, { locale: "de" });
    assert.equal(inner.translation, ARTICLE_DE_2);
    assert.equal(inner.resolvedLocale, "de");
  });
});

// ---------------------------------------------------------------------------------------------
// K4 — RE-ENTRANT PLACEHOLDERS. Separately falsifiable from K3: an implementation can thread the
// evaluation locale correctly and still share the value buffer, or vice versa.
// ---------------------------------------------------------------------------------------------

const PROMO_OUTER = "FR-promo name=Amira count=2 tier=silver";
const PROMO_INNER = "EN-promo name=Bruno count=7 tier=gold";

/**
 * **WHAT THIS SUITE DELIBERATELY DOES NOT ASSERT, and why — MEASURED, not inferred.** Plan
 * 3.3:755-756 says "Placeholder records are shallow-snapshotted into internal `Map` instances. Own
 * enumerable string getters are evaluated once during the snapshot; a getter exception propagates
 * before candidate resolution." This port takes no such snapshot: `lookupFor` in
 * `src/internal/interpolate.js` wraps the caller's record in a lookup function and reads it LAZILY
 * during the render of whichever candidate supplies the entry. Measured consequence, on unmodified
 * source: with catalogs {en, fr}, a `fr-CH` request whose `name` getter throws produces policy
 * consultations `["missing-translation@fr-CH", "resolution-failure@fr"]` — the exception is caught
 * as that candidate's resolution failure and the walk carries on — where the plan's sentence
 * requires zero consultations. That divergence is REPORTED rather than encoded here: asserting the
 * plan's wording would put a red in this file about a property that has nothing to do with clause 77,
 * and asserting the port's behaviour as if it were the specification would launder a divergence into
 * a contract. What is asserted below is the proposition clause 77 actually owns: whatever the
 * evaluation strategy, one call's placeholder VALUES are its own.
 */
describe("K4 — a placeholder getter that re-enters `get`", () => {
  it("the outer call's placeholder values survive the inner call", () => {
    // **THE THREE POSITIONS ARE CHOSEN AGAINST THE ORDER THE PORT ACTUALLY READS THEM.** Values are
    // resolved lazily, in the order the TEMPLATE names them — `name`, then `count`, then `tier` —
    // not in record order. So `name` is the re-entrant read, and `count` and `tier` are both read
    // AFTER the inner call has finished: they are the two that a shared, per-call-cleared value
    // buffer would serve from the inner call's entries. `name` itself is the survivor direction, the
    // one such a buffer leaves correct, and the row says which is which rather than predicting both.
    const calls = { name: 0, tier: 0 };
    /** @type {any} */ let inner = null;
    const placeholders = {
      count: 2,
      get name() {
        calls.name += 1;
        inner = voices.getResult("Cart.Promo", { name: "Bruno", count: 7, tier: "gold" },
          { locale: "de-AT", fallbackPolicy: () => true });
        return "Amira";
      },
      get tier() { calls.tier += 1; return "silver"; },
    };

    const outer = voices.getResult("Cart.Promo", placeholders, { locale: "fr" });

    // THE WITNESS: if the getters never ran, everything downstream measures a path never taken.
    assert.equal(calls.name, 1, "the re-entrant getter ran exactly once");
    assert.equal(calls.tier, 1, "the getter read after the inner call ran exactly once");

    assert.equal(inner.status, "translated");
    assert.equal(inner.translation, PROMO_INNER);

    assert.equal(outer.status, "translated");
    assert.equal(outer.translation, PROMO_OUTER);
    // NAMED, not folded into the equality. The plausible failure is CONTAMINATION rather than
    // absence, and an equality assertion would report a foreign tenant's value as one anonymous
    // mismatch; spelling the foreign values out makes the red self-diagnosing.
    assert.ok(outer.translation.includes("count=2"), "the outer keeps its own count");
    assert.ok(outer.translation.includes("tier=silver"), "the outer keeps its own tier");
    assert.ok(!outer.translation.includes("7"), "the inner call's count must not appear");
    assert.ok(!outer.translation.includes("gold"), "the inner call's tier must not appear");
    assert.ok(!outer.translation.includes("Bruno"), "the inner call's name must not appear");
  });

  it("CONTROL — a plain data record and a standalone inner call give the identical strings", () => {
    assert.equal(
      voices.getResult("Cart.Promo", { name: "Amira", count: 2, tier: "silver" }, { locale: "fr" })
        .translation,
      PROMO_OUTER);
    assert.equal(
      voices.getResult("Cart.Promo", { name: "Bruno", count: 7, tier: "gold" },
        { locale: "de-AT", fallbackPolicy: () => true }).translation,
      PROMO_INNER);
  });
});

// ---------------------------------------------------------------------------------------------
// K5 — PER-CALL CALLBACK OVERRIDES. Cross-talk in its most literal form: a callback belonging to
// request A invoked with request B's data. Invisible to every existing instrument — `onFallback`
// has no Java counterpart at all, so no corpus case can see it, and no differential re-enters.
// ---------------------------------------------------------------------------------------------

/** @type {any[]} */
const instanceEvents = [];
/** A second instance, identical except that it installs an INSTANCE-level observer. */
const observed = createStrings({
  fallbackLocale: "en",
  locale: "es",
  bidiIsolation: "rtl-locales",
  onFallback: (/** @type {any} */ event) => { instanceEvents.push(event); },
  strings: {
    en: voiceCatalog("EN"),
    fr: voiceCatalog("FR"),
    de: voiceCatalog("DE", { promo: false }),
    es: voiceCatalog("ES"),
  },
});

describe("K5 — per-call callbacks belong to their own call", () => {
  it("a nested call's observer does not receive the outer call's event, and vice versa", () => {
    /** @type {string[]} */ const log = [];
    /** @type {any[]} */ const eventsA = [];
    /** @type {any[]} */ const eventsB = [];
    /** @type {any} */ let inner = null;

    log.push("outer-enter");
    const outer = observed.getResult("Cart.Promo", { name: "Amira", count: 1, tier: "silver" }, {
      locale: "de-AT",
      // RE-ENTERED ONCE, on the FIRST consultation only. The outer walk consults the policy twice
      // (de-AT holds no catalog; de holds one without this key), and an unguarded seam would nest
      // twice — which is not wrong, but it makes the nesting witness ambiguous about WHICH inner
      // call any later assertion is about.
      fallbackPolicy: (/** @type {string} */ _reason, /** @type {string} */ attempted) => {
        if (attempted !== "de-AT") return true;
        log.push("inner-enter");
        inner = observed.getResult("Cart.Promo", { name: "Bruno", count: 1, tier: "gold" }, {
          locale: "fr-CH",
          fallbackPolicy: () => true,
          onFallback: (/** @type {any} */ event) => { eventsB.push(event); },
        });
        log.push("inner-exit");
        return true;
      },
      onFallback: (/** @type {any} */ event) => { eventsA.push(event); },
    });
    log.push("outer-exit");

    assert.deepEqual(log, ["outer-enter", "inner-enter", "inner-exit", "outer-exit"]);

    // COUNTS ON BOTH SIDES. 0-vs-1 alone would read as "the observer just did not fire"; the
    // 1-vs-2 half is what makes a foreign delivery a named red rather than a silent one.
    assert.equal(eventsB.length, 1, "the inner call's observer receives exactly its own event");
    assert.equal(eventsB[0].lookupLocale, "fr-CH");
    assert.equal(eventsB[0].resolvedLocale, "fr");
    assert.ok(eventsB.every((/** @type {any} */ e) => e.lookupLocale === "fr-CH"),
      "no event from another request may land in the inner call's observer");

    assert.equal(eventsA.length, 1, "the outer call's own observer receives exactly one event");
    assert.equal(eventsA[0].lookupLocale, "de-AT");
    assert.equal(eventsA[0].resolvedLocale, "en");
    assert.deepEqual(eventsA[0].precedingFailures.map((/** @type {any} */ f) => f.locale),
      ["de-AT", "de"]);

    // BY REFERENCE, and this is the sharpest assertion in the file. Plan 3.3:868-871 requires the
    // SAME frozen match object on the result, the failure, every fallback event and any final
    // `MissingTranslationError`. A merged-state defect that happened to reconstruct an equal-LOOKING
    // event still fails here, where `deepEqual` would pass on exactly the implementation the clause
    // forbids.
    assert.equal(eventsA[0].localeMatch, outer.localeMatch);
    assert.equal(eventsB[0].localeMatch, inner.localeMatch);
    assert.notEqual(eventsA[0].localeMatch, eventsB[0].localeMatch);
  });

  it("the INHERITANCE direction — a nested call that omits an observer reaches the instance one", () => {
    // Plan 3.3:740-741 has a second half nothing else probes: per-call fields REPLACE the instance
    // field for that call, and OMITTED fields inherit it. So the outer's override must not leak into
    // the inner call's inheritance.
    instanceEvents.length = 0;
    /** @type {any[]} */ const eventsA = [];
    /** @type {any} */ let inner = null;

    const outer = observed.getResult("Cart.Promo", { name: "Amira", count: 1, tier: "silver" }, {
      locale: "de-AT",
      fallbackPolicy: (/** @type {string} */ _reason, /** @type {string} */ attempted) => {
        if (attempted !== "de-AT") return true;
        // NO onFallback: this call inherits the instance observer.
        inner = observed.getResult("Cart.Promo", { name: "Bruno", count: 1, tier: "gold" },
          { locale: "fr-CH", fallbackPolicy: () => true });
        return true;
      },
      onFallback: (/** @type {any} */ event) => { eventsA.push(event); },
    });

    assert.equal(instanceEvents.length, 1, "the instance observer received exactly the inner event");
    assert.equal(instanceEvents[0].lookupLocale, "fr-CH");
    assert.equal(instanceEvents[0].localeMatch, inner.localeMatch);
    assert.equal(eventsA.length, 1, "and the per-call observer exactly the outer event");
    assert.equal(eventsA[0].lookupLocale, "de-AT");
    assert.equal(eventsA[0].localeMatch, outer.localeMatch);
  });

  it("THE THROWING DOOR — a MissingTranslationError carries its own call's failure by reference", () => {
    // Every other probe here uses `getResult`; `get` is the API a server actually calls, and plan
    // 3.3:868-871's identity clause covers the ERROR channel too. An inner call that completed
    // normally in the middle of the outer's walk must not have supplied any field of the outer's
    // error — a shared error-context scratch is a defect class no other row can reach.
    /** @type {any} */ let handlerSaw = null;
    /** @type {any} */ let inner = null;
    /** @type {unknown} */ let thrown = null;

    try {
      observed.get("Cart.Missing", { name: "Amira" }, {
        locale: "de-AT",
        fallbackPolicy: (/** @type {string} */ _reason, /** @type {string} */ attempted) => {
          if (attempted !== "de-AT") return true;
          inner = observed.getResult("Cart.Promo", { name: "Bruno", count: 1, tier: "gold" },
            { locale: "fr-CH", fallbackPolicy: () => true });
          return true;
        },
        onFailure: (/** @type {any} */ failure) => { handlerSaw = failure; return THROW_EXCEPTION; },
      });
    } catch (error) { thrown = error; }

    // The witnesses first: the handler ran, and the inner call really did complete mid-walk.
    assert.ok(handlerSaw !== null, "the failure handler was consulted");
    assert.equal(inner.status, "translated", "the inner call completed inside the outer's walk");

    const error = /** @type {any} */ (thrown);
    assert.equal(error?.name, "MissingTranslationError");
    assert.equal(error.failure, handlerSaw, "the error carries the handler's failure BY REFERENCE");
    assert.equal(error.failure.lookupLocale, "de-AT", "…the outer's lookup, not the inner's");
    assert.deepEqual([...error.failure.attemptedLocales], ["de-AT", "de", "en"]);
    assert.equal(error.failure.localeMatch.locale, "de");
    assert.notEqual(error.failure.localeMatch, inner.localeMatch);
  });

  it("CONTROL — without re-entrancy each observer receives a byte-identical event", () => {
    // Also proves the observer path is REACHED at all: a walk that succeeded on its first candidate
    // fires nothing, and every count assertion above would then pass vacuously in the wrong
    // direction.
    /** @type {any[]} */ const eventsA = [];
    const outer = observed.getResult("Cart.Promo", { name: "Amira", count: 1, tier: "silver" },
      { locale: "de-AT", fallbackPolicy: () => true,
        onFallback: (/** @type {any} */ e) => { eventsA.push(e); } });
    assert.equal(eventsA.length, 1);
    assert.equal(eventsA[0].lookupLocale, "de-AT");
    assert.equal(eventsA[0].resolvedLocale, "en");
    assert.deepEqual(eventsA[0].precedingFailures.map((/** @type {any} */ f) => f.locale),
      ["de-AT", "de"]);
    assert.equal(eventsA[0].localeMatch, outer.localeMatch);

    /** @type {any[]} */ const eventsB = [];
    const alone = observed.getResult("Cart.Promo", { name: "Bruno", count: 1, tier: "gold" },
      { locale: "fr-CH", fallbackPolicy: () => true,
        onFallback: (/** @type {any} */ e) => { eventsB.push(e); } });
    assert.equal(eventsB.length, 1);
    assert.equal(eventsB[0].lookupLocale, "fr-CH");
    assert.equal(eventsB[0].resolvedLocale, "fr");
    assert.equal(eventsB[0].localeMatch, alone.localeMatch);
  });
});

// ---------------------------------------------------------------------------------------------
// K6 — TWO INSTANCES, ONE PROCESS. Plan 3.4:150 makes the candidate-chain memo PER INSTANCE, and
// plan 1.3:69 / 6.2:2101 forbid a hidden global catalog cache outright. This row exists BEFORE the
// optimization it guards: plan 3.4's blessed `localeLookupFor` memo is priced and DEFERRED to M9,
// and the cheapest way to land that win is a module-level cache keyed by the requested tag.
// ---------------------------------------------------------------------------------------------

const TENANT_KEY = "Cart.Note";
/** Each tenant's `en` says something DIFFERENT — the channel a global catalog cache would move. */
const TENANT_A = { en: { [TENANT_KEY]: "EN-tenant-A" }, "fr-FR": { [TENANT_KEY]: "FR-FR-only" } };
const TENANT_B = { en: { [TENANT_KEY]: "EN-tenant-B" }, "fr-CA": { [TENANT_KEY]: "FR-CA-only" } };
const TIEBREAKERS_A = { fr: ["fr-FR"] };
const TIEBREAKERS_B = { fr: ["fr-CA"] };
/**
 * `fr-BE` is loaded by NEITHER tenant, on purpose. Asking for `fr-FR` directly would let both
 * instances agree by accident on the tags they share and would reach a cache without discriminating
 * it; `fr-BE` makes the chain's resolution genuinely depend on each instance's own catalogs and
 * tiebreakers. `en-AU` is the second axis — the same chain on both sides, different catalog CONTENT.
 */
const TENANT_REQUESTS = /** @type {const} */ (["fr-BE", "en-AU"]);

/** MEASURED. */
const TENANT_EXPECTED = {
  A: {
    "fr-BE": { translation: "FR-FR-only", resolved: "fr-FR", chain: ["fr-BE", "fr", "fr-FR"] },
    "en-AU": { translation: "EN-tenant-A", resolved: "en", chain: ["en-AU", "en-001", "en"] },
  },
  B: {
    "fr-BE": { translation: "FR-CA-only", resolved: "fr-CA", chain: ["fr-BE", "fr", "fr-CA"] },
    "en-AU": { translation: "EN-tenant-B", resolved: "en", chain: ["en-AU", "en-001", "en"] },
  },
};

const tenantA = createStrings({
  fallbackLocale: "en", locale: "en", strings: TENANT_A, tiebreakers: TIEBREAKERS_A,
});
const tenantB = createStrings({
  fallbackLocale: "en", locale: "en", strings: TENANT_B, tiebreakers: TIEBREAKERS_B,
});

function tenantRows(/** @type {any} */ instance) {
  return TENANT_REQUESTS.map((locale) => {
    const result = instance.getResult(TENANT_KEY, undefined, { locale });
    return {
      locale,
      translation: result.translation,
      resolved: result.resolvedLocale,
      chain: [...result.attemptedLocales],
    };
  });
}

function expectedRows(/** @type {"A" | "B"} */ tenant) {
  return TENANT_REQUESTS.map((locale) => ({ locale, ...TENANT_EXPECTED[tenant][locale] }));
}

describe("K6 — two Strings instances with different loaded sets share no state", () => {
  it("the two tenants expect DIFFERENT answers to every request", () => {
    for (const locale of TENANT_REQUESTS)
      assert.notEqual(TENANT_EXPECTED.A[locale].translation, TENANT_EXPECTED.B[locale].translation,
        `${locale} must distinguish the tenants, or the row proves nothing`);
    assert.notDeepEqual(TENANT_EXPECTED.A["fr-BE"].chain, TENANT_EXPECTED.B["fr-BE"].chain,
      "the chain is the channel a hoisted candidate-chain memo would move");
    assert.deepEqual(TENANT_EXPECTED.A["en-AU"].chain, TENANT_EXPECTED.B["en-AU"].chain,
      "…and `en-AU` is deliberately the SAME chain on both sides, so only catalog CONTENT differs");
  });

  it("interleaved, each instance answers from its own catalogs and tiebreakers", async () => {
    /** @type {string[]} */ const log = [];
    /** @type {Record<string, any[]>} */ const seen = { A: [], B: [] };
    const gates = barrier();

    const handler = async (/** @type {"A" | "B"} */ name, /** @type {any} */ instance) => {
      for (let round = 0; round < ROUNDS; ++round) {
        log.push(`${name}:before${round}`);
        seen[name]?.push(tenantRows(instance));
        await gates.gate();
        log.push(`${name}:after${round}`);
        seen[name]?.push(tenantRows(instance));
        await gates.gate();
      }
    };

    const running = [handler("A", tenantA), handler("B", tenantB)];
    await gates.drain(2 * ROUNDS + 2);
    await Promise.all(running);

    // Schedule witness first, as everywhere in this file.
    /** @type {string[]} */ const expectedLog = [];
    for (let round = 0; round < ROUNDS; ++round)
      for (const step of /** @type {const} */ (["before", "after"]))
        for (const name of /** @type {const} */ (["A", "B"])) expectedLog.push(`${name}:${step}${round}`);
    assert.deepEqual(log, expectedLog);

    for (const name of /** @type {const} */ (["A", "B"]))
      for (const [index, rows] of /** @type {any[]} */ (seen[name]).entries())
        assert.deepEqual(rows, expectedRows(name), `${name} call ${index}`);

    // The SETS themselves must not have crossed either.
    assert.deepEqual(tenantA.getSupportedLocales(), ["en", "fr-FR"]);
    assert.deepEqual(tenantB.getSupportedLocales(), ["en", "fr-CA"]);
  });

  it("CONTROL — each tenant alone IN ITS OWN PROCESS answers the identical table", () => {
    // **THE CONTROL RUNS SOMEWHERE ELSE, AND IT HAS TO.** `node --test` isolates FILES, not tests
    // within a file, so "instance A with no second instance constructed in the process" is not a
    // state this file can enter — a control written inline would silently run with both instances
    // present and prove nothing about single-instance behaviour. The child's fixture is SERIALIZED
    // from the same constants, so the two cannot drift apart.
    const coreUrl = new URL("../src/core/index.js", import.meta.url).href;
    for (const [name, catalogs, tiebreakers] of /** @type {const} */ ([
      ["A", TENANT_A, TIEBREAKERS_A], ["B", TENANT_B, TIEBREAKERS_B],
    ])) {
      const source = `
        import { createStrings } from ${JSON.stringify(coreUrl)};
        const instance = createStrings({ fallbackLocale: "en", locale: "en",
          strings: ${JSON.stringify(catalogs)}, tiebreakers: ${JSON.stringify(tiebreakers)} });
        const rows = ${JSON.stringify(TENANT_REQUESTS)}.map((locale) => {
          const r = instance.getResult(${JSON.stringify(TENANT_KEY)}, undefined, { locale });
          return { locale, translation: r.translation, resolved: r.resolvedLocale,
            chain: [...r.attemptedLocales] };
        });
        process.stdout.write(JSON.stringify({ rows, supported: instance.getSupportedLocales() }));
      `;
      const out = execFileSync(process.execPath, ["--input-type=module", "-e", source],
        { encoding: "utf8" });
      const solo = JSON.parse(out);
      // THE TOPOLOGY, asserted first: one instance was built over there, and it is the right one.
      assert.deepEqual(solo.supported,
        name === "A" ? ["en", "fr-FR"] : ["en", "fr-CA"], `tenant ${name} solo supported set`);
      assert.deepEqual(solo.rows, expectedRows(name), `tenant ${name} alone in its own process`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// K7 — THE INSTANCE RESOLVER, which is the shape a Node server actually uses. Plan 3.2:551-562
// declares `localeResolver`, plan 3.3:743-745 puts it third in the locale-source order, and plan
// 3.4:864-866 is the sentence that exists because of this clause: "Resolver and per-call locale
// values are normalized and recomputed ON EVERY USE."
// ---------------------------------------------------------------------------------------------

/** The request-scoped slot a server would back with `AsyncLocalStorage`. */
const requestSlot = { locale: "es" };
/** @type {null | ((instance: any) => void)} */
let resolverReentry = null;
/** @type {string[]} */
const resolverCalls = [];

/** @type {any} */
let ambient;
ambient = createStrings({
  fallbackLocale: "en",
  bidiIsolation: "rtl-locales",
  localeResolver: () => {
    resolverCalls.push(requestSlot.locale);
    resolverReentry?.(ambient);
    return requestSlot.locale;
  },
  strings: {
    en: voiceCatalog("EN"), fr: voiceCatalog("FR"), de: voiceCatalog("DE", { promo: false }),
    ar: voiceCatalog("AR"), he: voiceCatalog("HE"), es: voiceCatalog("ES"),
  },
});

describe("K7 — the instance resolver is consulted on every call, never memoized", () => {
  it("interleaved requests each read the slot value live AT THAT CALL", async () => {
    /** @type {string[]} */ const log = [];
    /** @type {Record<string, string[]>} */ const seen = {};
    resolverCalls.length = 0;
    const gates = barrier();

    const handler = async (/** @type {string} */ tag) => {
      seen[tag] = [];
      const read = () => {
        requestSlot.locale = tag;
        return ambient.get("Cart.Items", { count: 0 });
      };
      for (let round = 0; round < ROUNDS; ++round) {
        log.push(`${tag}:before${round}`);
        seen[tag]?.push(read());
        await gates.gate();
        log.push(`${tag}:after${round}`);
        seen[tag]?.push(read());
        await gates.gate();
      }
    };

    const running = HANDLERS.map((tag) => handler(tag));
    await gates.drain(2 * ROUNDS + 2);
    await Promise.all(running);

    // Witness first: the resolver really was consulted once per call, not once per instance.
    assert.equal(resolverCalls.length, HANDLERS.length * 2 * ROUNDS,
      "one resolver consultation per translation call");
    for (const tag of HANDLERS)
      for (const [index, text] of /** @type {string[]} */ (seen[tag]).entries())
        assert.equal(text, EXPECTED_TEXT[/** @type {keyof typeof EXPECTED_TEXT} */ (tag)],
          `${tag} call ${index}`);

    // And the interleaving is real, on the same terms as K2.
    for (const tag of HANDLERS) {
      const from = log.indexOf(`${tag}:before0`);
      const to = log.indexOf(`${tag}:after0`);
      assert.ok(log.slice(from + 1, to).some((entry) => !entry.startsWith(`${tag}:`)),
        `${tag} was not overlapped — the barrier is inert`);
    }
  });

  it("a resolver that itself calls `get` does not corrupt the call it is resolving", () => {
    // A resolver is application code running INSIDE the locale ingress, before the walk has started.
    // The inner call below uses an explicit per-call locale, so it does NOT consult the resolver and
    // cannot recurse — which is exactly the shape a server writes when its locale decision needs to
    // read something from the catalogs.
    /** @type {any} */ let inner = null;
    requestSlot.locale = "ar";
    resolverReentry = (instance) => {
      if (inner !== null) return;
      inner = instance.getResult("Cart.Items", { count: 0 }, { locale: "de" });
    };
    try {
      const outer = ambient.getResult("Cart.Items", { count: 0 });
      assert.ok(inner !== null, "the resolver really did re-enter");
      assert.equal(inner.translation, EXPECTED_TEXT.de);
      assert.equal(outer.lookupLocale, "ar");
      assert.equal(outer.translation, EXPECTED_TEXT.ar);
    } finally {
      resolverReentry = null;
    }
  });

  it("CONTROL — the slot really drives the answer, in both directions", () => {
    // Without this the row above is satisfied by an instance that ignores the resolver entirely and
    // answers something that happens to match — so the same instance is asked twice, for two
    // different slot values, and must move.
    requestSlot.locale = "fr";
    assert.equal(ambient.get("Cart.Items", { count: 0 }), EXPECTED_TEXT.fr);
    requestSlot.locale = "he";
    assert.equal(ambient.get("Cart.Items", { count: 0 }), EXPECTED_TEXT.he);
    requestSlot.locale = "fr";
    assert.equal(ambient.get("Cart.Items", { count: 0 }), EXPECTED_TEXT.fr,
      "and back again: a one-way move would be satisfied by a resolver read exactly twice");
  });
});

// ---------------------------------------------------------------------------------------------
// K8 — `forLocale` HANDLES HELD ACROSS A YIELD. Plan 3.3:752-753: `forLocale` "performs syntactic
// normalization immediately and the instance-dependent match/coverage validation WHEN ITS RESULT IS
// CONSUMED by a `Strings` instance" — the one place in the core API where a per-request object is
// created in one turn and validated in another.
// ---------------------------------------------------------------------------------------------

describe("K8 — handles created in one turn and consumed in another", () => {
  it("each call answers its OWN handle's locale, consumed in the opposite order", async () => {
    // Built all at once, then yielded, then consumed in reverse. An implementation that validated
    // against a remembered "most recently created handle" answers the last-built locale for every
    // call, which is indistinguishable from correct in any test that builds one handle at a time.
    const handles = HANDLERS.map((tag) => ({ tag, options: forLocale(tag) }));
    assert.deepEqual(handles.map((h) => h.options.locale), [...HANDLERS],
      "forLocale normalizes immediately and keeps each tag");

    await new Promise((resolve) => { setImmediate(resolve); });

    for (const { tag, options } of [...handles].reverse())
      assert.equal(voices.get("Cart.Items", { count: 0 }, options),
        EXPECTED_TEXT[/** @type {keyof typeof EXPECTED_TEXT} */ (tag)], tag);
  });
});

// ---------------------------------------------------------------------------------------------
// THE LOAD SIDE. Here the concurrency is real, and the scheduler is the instrument rather than the
// usage: plan 6.2:2080's "independent of request completion timing" cannot be observed at all by a
// test that does not CONTROL completion timing, because the real transport is the thing being timed.
// ---------------------------------------------------------------------------------------------

const utf8 = new TextEncoder();

/** A catalog whose every key raises exactly one INCOMPLETE_CARDINALITY_TRANSLATIONS warning. */
const warningCatalog = (/** @type {readonly string[]} */ keys) => JSON.stringify(
  Object.fromEntries(keys.map((key) => [key, {
    translation: "{{n}}",
    // Only CARDINALITY_ONE is supplied, so every locale in these fixtures is missing at least
    // CARDINALITY_OTHER — one warning per key, attributed to the file that declared it.
    placeholders: { n: { value: "c", translations: { CARDINALITY_ONE: "one" } } },
  }])));

/**
 * @param {string} label @param {Record<string, string>} bodies
 * @param {{ fallbackLocale: string, corruptDigest?: readonly string[] }} options
 */
function manifestOf(label, bodies, options) {
  const directory = mkdtempSync(join(scratch, `${label}-`));
  /** @type {Record<string, any>} */
  const files = {};
  for (const [tag, text] of Object.entries(bodies)) {
    writeFileSync(join(directory, `${tag}.json`), text);
    files[tag] = {
      url: `${tag}.json`,
      // A corrupt entry declares the digest of DIFFERENT bytes: the file on disk is intact and the
      // manifest's claim about it is not, which is the failure a digest exists to catch.
      sha256: options.corruptDigest?.includes(tag)
        ? sha256Hex(utf8.encode("not these bytes"))
        : sha256Hex(utf8.encode(text)),
    };
  }
  const draft = {
    formatVersion: 1,
    catalogVersion: `catalog-${label}`,
    catalogFingerprint: "0".repeat(64),
    cldrVersion: pinnedProvenance().cldrVersion,
    dataFingerprint: pinnedProvenance().dataFingerprint,
    fallbackLocale: options.fallbackLocale,
    baseUrl: pathToFileURL(`${directory}/`).href,
    files,
    tiebreakers: {},
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/**
 * THE TRANSPORT SCHEDULER. `readFile(url, signal)` is a declared option of
 * `LoadStringsFromFilesOptions`, so this needs no internals — it is the public seam a test double is
 * meant to use. It records every ask and every settle, and it settles ONE scripted entry per tick,
 * so the completion order is an asserted fact rather than a property of the disk.
 *
 * @param {readonly string[]} script tokens `run:locale`, in the order reads must SETTLE
 */
function scheduler(script) {
  /** @type {string[]} */
  const events = [];
  /** @type {Map<string, () => void>} */
  const pending = new Map();
  let cursor = 0;

  const settleOne = () => {
    const want = script[cursor];
    if (want === undefined) return false;
    const settle = pending.get(want);
    if (settle === undefined) return false;
    pending.delete(want);
    cursor += 1;
    settle();
    return true;
  };

  return {
    events,
    pendingCount: () => pending.size,
    asked: () => events.filter((entry) => entry.startsWith("ask:")),
    readerFor: (/** @type {string} */ run) => (/** @type {string} */ url) => {
      const path = fileURLToPath(url);
      const locale = /** @type {string} */ (path.split("/").pop()).replace(/\.json$/, "");
      const token = `${run}:${locale}`;
      events.push(`ask:${token}`);
      return new Promise((resolve) => {
        pending.set(token, () => {
          events.push(`settle:${token}`);
          resolve(new Uint8Array(readFileSync(path)));
        });
      });
    },
    /** Advance one scripted settle per tick until the script is exhausted and nothing is waiting. */
    async drive(maximumSteps = 400) {
      for (let step = 0; step < maximumSteps; ++step) {
        const advanced = settleOne();
        await new Promise((resolve) => { setImmediate(resolve); });
        if (!advanced && pending.size === 0) return;
      }
      assert.fail("the scheduler script never drained — the fixture and the script disagree");
    },
    /** Release everything still held, in ask order, so a probe cannot leave a load hanging. */
    releaseAll() {
      for (const [, settle] of [...pending]) settle();
      pending.clear();
    },
  };
}

/**
 * Await a promise with a REAL DEADLINE, so a defect that hangs is a named red rather than a job
 * timeout. This project has already been bitten once: the not-a-regular-file probe made a port block
 * on a FIFO for ten minutes, and in CI that surfaces as an anonymous timeout instead of a failure
 * that names itself.
 *
 * @template T @param {Promise<T>} promise @param {string} label
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error: any }>}
 */
async function settledWithin(promise, label, milliseconds = 5000) {
  const TIMED_OUT = Symbol("timed-out");
  /** @type {any} */
  let timer = null;
  const outcome = await Promise.race([
    promise.then((value) => (/** @type {any} */ ({ ok: true, value })),
      (error) => (/** @type {any} */ ({ ok: false, error }))),
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), milliseconds); }),
  ]);
  clearTimeout(timer);
  assert.notEqual(outcome, TIMED_OUT, `${label} must settle within ${milliseconds}ms`);
  return outcome;
}

const localesOf = (/** @type {any} */ rows) => rows.map((/** @type {any} */ r) => r.locale);
const failureKeysOf = (/** @type {any} */ rows) =>
  rows.map((/** @type {any} */ r) => `${r.locale}:${r.stage}`);

// ---------------------------------------------------------------------------------------------
// L1 — TWO LOADS IN FLIGHT PRODUCE TWO INDEPENDENT RESULTS.
// ---------------------------------------------------------------------------------------------

const MANIFEST_A = manifestOf("runA", {
  de: warningCatalog(["W.de"]), en: warningCatalog(["W.en"]), fr: warningCatalog(["W.fr"]),
}, { fallbackLocale: "en" });
const MANIFEST_B = manifestOf("runB", {
  ar: warningCatalog(["W.ar"]), pl: warningCatalog(["W.pl"]),
}, { fallbackLocale: "ar", corruptDigest: ["pl"] });
/** The same catalogs, but the FALLBACK file is the broken one — the negative control below. */
const MANIFEST_B_BAD_FALLBACK = manifestOf("runBbad", {
  ar: warningCatalog(["W.ar"]), pl: warningCatalog(["W.pl"]),
}, { fallbackLocale: "pl", corruptDigest: ["pl"] });

const LIMITS_A = { maximumInputBytes: 65_536 };
const LIMITS_B = { maximumInputBytes: 32_768 };

describe("L1 — concurrent loads produce independent LoadedStrings", () => {
  it("the fixture's fallback locales are pinned, and the two identities differ", () => {
    // **WITHOUT THIS THE WHOLE ROW CAN SIT BEHIND A REJECTION.** Plan 6.2:2082-2083: allow-partial
    // returns successes only if the resolved fallback-locale file loaded; a fallback-file failure
    // ALWAYS rejects. B's broken file is `pl`, so B's fallback must be `ar` — if a later fixture edit
    // made it `pl`, every assertion below would be skipped by a thrown rejection and the file would
    // report a harness error rather than a named red.
    assert.equal(MANIFEST_A.fallbackLocale, "en");
    assert.equal(MANIFEST_B.fallbackLocale, "ar");
    assert.notEqual(MANIFEST_A.catalogFingerprint, MANIFEST_B.catalogFingerprint,
      "the two loads must be distinguishable by identity, not only by catalog names");
    assert.notEqual(LIMITS_A.maximumInputBytes, LIMITS_B.maximumInputBytes,
      "loadingLimits is a per-result identity channel and the two runs must differ on it");
  });

  it("NEGATIVE CONTROL — a broken FALLBACK file rejects even under allow-partial", async () => {
    // So the partial result asserted below is known to be a real policy decision rather than a
    // loader that never rejects at all.
    const outcome = await settledWithin(
      loadEntireManifestFromFiles(MANIFEST_B_BAD_FALLBACK, { partialFailure: "allow-partial" }),
      "the bad-fallback load");
    assert.equal(outcome.ok, false, "a fallback-file failure is never a partial success");
    assert.equal(/** @type {any} */ (outcome).error?.name, "StringsLoadingError");
    assert.match(String(/** @type {any} */ (outcome).error?.message),
      /fallback-locale file is among them/);
  });

  it("each result describes only its own load", async () => {
    const script = ["B:ar", "A:de", "B:pl", "A:en", "A:fr"];
    const driver = scheduler(script);

    const runA = loadEntireManifestFromFiles(MANIFEST_A,
      { readFile: driver.readerFor("A"), limits: LIMITS_A });
    const runB = loadEntireManifestFromFiles(MANIFEST_B,
      { readFile: driver.readerFor("B"), limits: LIMITS_B, partialFailure: "allow-partial" });

    await driver.drive();
    const [outcomeA, outcomeB] = await Promise.all([
      settledWithin(runA, "load A"), settledWithin(runB, "load B"),
    ]);

    // ── THE SCHEDULE WITNESS, FIRST AND BY NAME ──────────────────────────────────────────────
    assert.deepEqual(driver.events, [
      "ask:A:de", "ask:A:en", "ask:A:fr", "ask:B:ar", "ask:B:pl",
      "settle:B:ar", "settle:A:de", "settle:B:pl", "settle:A:en", "settle:A:fr",
    ], "both of B's reads settle strictly between A's first read and A's completion");

    // Never behind a bare `await Promise.all`: a rejection here names itself instead of skipping
    // every assertion below (the guarded-assertion defect this project has already shipped once).
    assert.equal(outcomeA.ok, true, "load A must not reject");
    assert.equal(outcomeB.ok, true, "load B must not reject");
    const a = /** @type {any} */ (outcomeA).value;
    const b = /** @type {any} */ (outcomeB).value;

    assert.equal(a.fallbackLocale, "en");
    assert.equal(a.complete, true);
    assert.deepEqual([...a.failures], []);
    assert.deepEqual(Object.keys(a.catalogs), ["de", "en", "fr"]);
    assert.deepEqual(localesOf(a.warnings), ["de", "en", "fr"]);
    assert.deepEqual(a.warnings.map((/** @type {any} */ w) => w.key), ["W.de", "W.en", "W.fr"]);
    assert.deepEqual({ ...a.coverage }, { kind: "entire-manifest" });
    assert.equal(a.catalogIdentity.catalogFingerprint, MANIFEST_A.catalogFingerprint);
    assert.equal(a.loadingLimits.maximumInputBytes, LIMITS_A.maximumInputBytes);

    assert.equal(b.fallbackLocale, "ar");
    assert.equal(b.complete, false, "a partial result makes no parity claim");
    // The STAGE is compared alongside the locale: a run that crossed the arrays but happened to
    // preserve counts would otherwise pass.
    assert.deepEqual(failureKeysOf(b.failures), ["pl:digest"]);
    assert.deepEqual(Object.keys(b.catalogs), ["ar"]);
    assert.deepEqual(localesOf(b.warnings), ["ar"]);
    assert.equal(b.catalogIdentity.catalogFingerprint, MANIFEST_B.catalogFingerprint);
    assert.equal(b.loadingLimits.maximumInputBytes, LIMITS_B.maximumInputBytes);
  });

  it("CONTROL — run strictly sequentially, the same two loads give the same two results", async () => {
    // **THIS IS THE ROW WHOSE ABLATION IS GREEN HERE AND RED ABOVE**, by construction: a module-scope
    // slot array reset at the start of each run is invisible when one load finishes before the next
    // begins, and crosses the moment they overlap. Everything else in this file is state-survival.
    const first = scheduler(["A:de", "A:en", "A:fr"]);
    const runA = loadEntireManifestFromFiles(MANIFEST_A,
      { readFile: first.readerFor("A"), limits: LIMITS_A });
    await first.drive();
    const a = /** @type {any} */ ((await settledWithin(runA, "sequential A")).value);

    const second = scheduler(["B:ar", "B:pl"]);
    const runB = loadEntireManifestFromFiles(MANIFEST_B,
      { readFile: second.readerFor("B"), limits: LIMITS_B, partialFailure: "allow-partial" });
    await second.drive();
    const b = /** @type {any} */ ((await settledWithin(runB, "sequential B")).value);

    assert.equal(a.complete, true);
    assert.deepEqual(Object.keys(a.catalogs), ["de", "en", "fr"]);
    assert.deepEqual(localesOf(a.warnings), ["de", "en", "fr"]);
    assert.deepEqual([...a.failures], []);
    assert.equal(b.complete, false);
    assert.deepEqual(failureKeysOf(b.failures), ["pl:digest"]);
    assert.deepEqual(Object.keys(b.catalogs), ["ar"]);
    assert.deepEqual(localesOf(b.warnings), ["ar"]);
  });
});

// ---------------------------------------------------------------------------------------------
// L2 — ORDER IS THE PLAN'S, NOT THE WIRE'S. Plan 6.2:2080-2081: warnings are ordered "by fetch-plan
// order and then depth-first declaration order, INDEPENDENT OF REQUEST COMPLETION TIMING", and
// failures by plan order. Two fixtures, because one cannot carry both: a file that fails at `limit`
// or `parse` never produced a validated catalog, so it emits no warning — a fixture whose catalogs
// mostly fail collapses the warning list to one element, and a one-element list is order-independent
// by definition and green under every ordering ablation there is.
// ---------------------------------------------------------------------------------------------

/** FIVE clean catalogs, all warning-bearing; `de` carries TWO keys in a known declaration order. */
const MANIFEST_ORDER = manifestOf("order", {
  de: warningCatalog(["A.de", "B.de"]),
  en: warningCatalog(["A.en"]),
  es: warningCatalog(["A.es"]),
  fr: warningCatalog(["A.fr"]),
  pl: warningCatalog(["A.pl"]),
}, { fallbackLocale: "de" });

const ORDER_PLAN = ["de", "en", "es", "fr", "pl"];
/** Shares no prefix with plan order, so a streaming implementation reorders at least four entries. */
const ORDER_SETTLE = ["fr", "pl", "de", "es", "en"];
const ORDER_WARNING_LOCALES = ["de", "de", "en", "es", "fr", "pl"];
const ORDER_WARNING_KEYS = ["A.de", "B.de", "A.en", "A.es", "A.fr", "A.pl"];

/** `en` is padded past the byte limit; `fr` is not JSON. `de`, the fallback, is clean. */
const PARSE_FAILURE_BODY = '{"A.fr": ';
const LIMIT_FAILURE_BODY = JSON.stringify({ "A.en": "en", PAD: "x".repeat(4096) });
const MANIFEST_FAILURE_ORDER = manifestOf("failorder", {
  de: warningCatalog(["A.de"]),
  en: LIMIT_FAILURE_BODY,
  fr: PARSE_FAILURE_BODY,
}, { fallbackLocale: "de" });
const FAILURE_ORDER_LIMITS = { maximumInputBytes: 1024 };

describe("L2 — warnings and failures are ordered by the PLAN, not by completion", () => {
  it("the fixture can carry the proposition: five warning-bearing files, settled out of order", () => {
    assert.deepEqual(Object.keys(MANIFEST_ORDER.files).sort(), [...ORDER_PLAN].sort());
    assert.notDeepEqual(ORDER_SETTLE, ORDER_PLAN);
    assert.notEqual(ORDER_SETTLE[0], ORDER_PLAN[0],
      "the two orders must not share a prefix, or the reordering is partly invisible");
    assert.equal(ORDER_WARNING_LOCALES.length, 6,
      "six warnings over five files — the two `de` keys are the depth-first half of plan 6.2:2080");
    // And the byte facts the failure fixture rests on, asserted rather than assumed.
    assert.ok(utf8.encode(LIMIT_FAILURE_BODY).length > FAILURE_ORDER_LIMITS.maximumInputBytes,
      "the `en` body must be over the limit, or `en:limit` never happens");
    assert.ok(utf8.encode(PARSE_FAILURE_BODY).length < FAILURE_ORDER_LIMITS.maximumInputBytes,
      "…and the `fr` body must be UNDER it, or it would fail at `limit` too and the stages collapse");
  });

  it("warnings keep plan order and declaration order when reads settle backwards", async () => {
    const driver = scheduler(ORDER_SETTLE.map((tag) => `R:${tag}`));
    const run = loadEntireManifestFromFiles(MANIFEST_ORDER, { readFile: driver.readerFor("R") });
    await driver.drive();
    const outcome = await settledWithin(run, "the shuffled order load");

    // THE SETTLE WITNESS, FIRST. Without it this is a test of a hope.
    assert.deepEqual(
      driver.events.filter((e) => e.startsWith("settle:")),
      ORDER_SETTLE.map((tag) => `settle:R:${tag}`),
      "the reads really did complete in the scripted, non-plan order");

    assert.equal(outcome.ok, true);
    const loaded = /** @type {any} */ (outcome).value;
    assert.deepEqual(localesOf(loaded.requestedFiles), ORDER_PLAN);
    assert.deepEqual(localesOf(loaded.warnings), ORDER_WARNING_LOCALES);
    // Attribution as well as order: reordering and MISATTRIBUTION are different defects that the
    // same ablation can produce, and comparing only `warnings.length` is green under both.
    assert.deepEqual(loaded.warnings.map((/** @type {any} */ w) => w.key), ORDER_WARNING_KEYS);
  });

  it("CONTROL — settled in PLAN order, the same load gives the same arrays", async () => {
    // The two runs together prove the arrays are a function of the plan and not of the wire. Under
    // the streaming ablation this control stays GREEN, which is exactly the point: three small files
    // on a real filesystem settle in plan order often enough that the existing suite never sees it.
    const driver = scheduler(ORDER_PLAN.map((tag) => `R:${tag}`));
    const run = loadEntireManifestFromFiles(MANIFEST_ORDER, { readFile: driver.readerFor("R") });
    await driver.drive();
    const loaded = /** @type {any} */ ((await settledWithin(run, "the in-order load")).value);
    assert.deepEqual(localesOf(loaded.warnings), ORDER_WARNING_LOCALES);
    assert.deepEqual(loaded.warnings.map((/** @type {any} */ w) => w.key), ORDER_WARNING_KEYS);
  });

  it("failures keep plan order, with their own stages, when reads settle backwards", async () => {
    const driver = scheduler(["F:fr", "F:en", "F:de"]);
    const run = loadEntireManifestFromFiles(MANIFEST_FAILURE_ORDER, {
      readFile: driver.readerFor("F"),
      limits: FAILURE_ORDER_LIMITS,
      partialFailure: "allow-partial",
    });
    await driver.drive();
    const outcome = await settledWithin(run, "the failure-order load");

    assert.deepEqual(driver.events.filter((e) => e.startsWith("settle:")),
      ["settle:F:fr", "settle:F:en", "settle:F:de"]);
    assert.equal(outcome.ok, true, "de is the fallback and it loaded, so allow-partial resolves");
    const loaded = /** @type {any} */ (outcome).value;
    assert.deepEqual(localesOf(loaded.requestedFiles), ["de", "en", "fr"]);
    // DIFFERENT STAGES make the array self-identifying: a swap is visible even if both survive.
    assert.deepEqual(failureKeysOf(loaded.failures), ["en:limit", "fr:parse"]);
    assert.deepEqual(Object.keys(loaded.catalogs), ["de"]);
  });

  it("CONTROL — the failure fixture settled in plan order gives the identical failures", async () => {
    const driver = scheduler(["F:de", "F:en", "F:fr"]);
    const run = loadEntireManifestFromFiles(MANIFEST_FAILURE_ORDER, {
      readFile: driver.readerFor("F"),
      limits: FAILURE_ORDER_LIMITS,
      partialFailure: "allow-partial",
    });
    await driver.drive();
    const loaded = /** @type {any} */ ((await settledWithin(run, "in-order failures")).value);
    assert.deepEqual(failureKeysOf(loaded.failures), ["en:limit", "fr:parse"]);
  });
});

// ---------------------------------------------------------------------------------------------
// L3 — LIMITS ARE CHARGED PER LOAD. Separately falsifiable from L1: an implementation can keep
// per-run result slots and still share the resolved limit snapshot, so the two must be able to go
// red independently. The failure mode this guards is the nastiest kind in production — a load that
// fails under load and succeeds on retry, because the defect is a function of what ELSE was in
// flight.
// ---------------------------------------------------------------------------------------------

const padded = (/** @type {string} */ tag, /** @type {number} */ pad) =>
  JSON.stringify({ [`K.${tag}`]: tag, PAD: "x".repeat(pad) });

const BUDGET_A = manifestOf("budgetA", {
  de: padded("de", 600), en: padded("en", 600), fr: padded("fr", 600),
}, { fallbackLocale: "en" });
const BUDGET_B = manifestOf("budgetB", {
  ar: padded("ar", 40), pl: padded("pl", 800),
}, { fallbackLocale: "ar" });
const BUDGET_LIMITS_A = { maximumInputBytes: 1024 };
const BUDGET_LIMITS_B = { maximumInputBytes: 512 };

const byteLength = (/** @type {string} */ text) => utf8.encode(text).length;

describe("L3 — one load's byte budget never governs a concurrent load's files", () => {
  it("the fixture straddles both limits, in both directions", () => {
    // **A BUDGET ROW WITHOUT A PROOF THAT THE BUDGET BITES IS THE HOLE THIS PROJECT ALREADY SHIPPED**
    // — an aggregate byte budget with no test on either side, whose deletion left all 1,048 tests
    // green. So the sizes are asserted against both limits before anything is loaded.
    for (const tag of ["de", "en", "fr"]) {
      const size = byteLength(padded(tag, 600));
      assert.ok(size < BUDGET_LIMITS_A.maximumInputBytes, `${tag} fits A's own limit`);
      assert.ok(size > BUDGET_LIMITS_B.maximumInputBytes, `${tag} would BREACH B's limit`);
    }
    assert.ok(byteLength(padded("pl", 800)) > BUDGET_LIMITS_B.maximumInputBytes,
      "B's `pl` breaches B's own limit");
    assert.ok(byteLength(padded("pl", 800)) < BUDGET_LIMITS_A.maximumInputBytes,
      "…and would PASS under A's, so a leak in either direction is observable");
    assert.ok(byteLength(padded("ar", 40)) < BUDGET_LIMITS_B.maximumInputBytes,
      "B's fallback file fits, so allow-partial can resolve");
  });

  it("NEGATIVE CONTROLS — each limit really refuses, on its own terms", async () => {
    // (1) B's own limit refuses B's own oversized file…
    const solo = await settledWithin(
      loadEntireManifestFromFiles(BUDGET_B,
        { limits: BUDGET_LIMITS_B, partialFailure: "allow-partial" }),
      "B alone");
    assert.equal(solo.ok, true);
    assert.deepEqual(failureKeysOf(/** @type {any} */ (solo).value.failures), ["pl:limit"]);

    // (2) …and A's files really are over B's limit, which is the fact the cross-talk assertion
    // depends on. Without this, "A completed" could mean the limits never applied to A at all.
    const crossed = await settledWithin(
      loadEntireManifestFromFiles(BUDGET_A, { limits: BUDGET_LIMITS_B }), "A under B's limit");
    assert.equal(crossed.ok, false);
    assert.equal(/** @type {any} */ (crossed).error?.name, "StringsLoadingError");
    assert.deepEqual(failureKeysOf(/** @type {any} */ (crossed).error.failures),
      ["de:limit", "en:limit", "fr:limit"]);
  });

  it("interleaved, each load is charged its own limits and nobody else's", async () => {
    const driver = scheduler(["B:ar", "A:de", "B:pl", "A:en", "A:fr"]);
    const runA = loadEntireManifestFromFiles(BUDGET_A,
      { readFile: driver.readerFor("A"), limits: BUDGET_LIMITS_A });
    const runB = loadEntireManifestFromFiles(BUDGET_B, {
      readFile: driver.readerFor("B"), limits: BUDGET_LIMITS_B, partialFailure: "allow-partial",
    });
    await driver.drive();
    const [outcomeA, outcomeB] = await Promise.all([
      settledWithin(runA, "budget A"), settledWithin(runB, "budget B"),
    ]);

    assert.deepEqual(driver.events, [
      "ask:A:de", "ask:A:en", "ask:A:fr", "ask:B:ar", "ask:B:pl",
      "settle:B:ar", "settle:A:de", "settle:B:pl", "settle:A:en", "settle:A:fr",
    ]);

    assert.equal(outcomeA.ok, true, "A must not be refused by B's tighter limit");
    assert.equal(outcomeB.ok, true);
    const a = /** @type {any} */ (outcomeA).value;
    const b = /** @type {any} */ (outcomeB).value;

    assert.equal(a.complete, true);
    assert.deepEqual([...a.failures], []);
    assert.deepEqual(Object.keys(a.catalogs), ["de", "en", "fr"]);
    // B must NOT be rescued by A's looser limit either — the other direction, which a "first load
    // wins" memo of the resolved limits would turn green here and nowhere else.
    assert.equal(b.complete, false);
    assert.deepEqual(failureKeysOf(b.failures), ["pl:limit"]);

    // Plan 6.2:2069-2070 — "Every loader snapshots overrides once" — read back per result, so a
    // leaked snapshot is visible even when the byte outcomes happen to agree.
    assert.equal(a.loadingLimits.maximumInputBytes, BUDGET_LIMITS_A.maximumInputBytes);
    assert.equal(b.loadingLimits.maximumInputBytes, BUDGET_LIMITS_B.maximumInputBytes);
  });
});

// ---------------------------------------------------------------------------------------------
// L4 — ABORT SCOPE. Plan 6.2:2086: "Abort cancels outstanding work and rejects. It is never
// converted into partial success." A cancelled request killing an unrelated tenant's load is
// cross-talk with a visible production signature and no existing instrument: abort tests today
// necessarily run ONE load, and with one load in the process a module-scope signal is
// indistinguishable from a per-run one.
// ---------------------------------------------------------------------------------------------

/** Twelve, so the plan is larger than the eight-read cap and a QUEUE exists to leave undispatched. */
const ABORT_A_TAGS = ["ar", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hu", "it"];
const ABORT_B_TAGS = ["pl", "uk"];
const abortManifestA = () => manifestOf("abortA",
  Object.fromEntries(ABORT_A_TAGS.map((tag) => [tag, padded(tag, 8)])), { fallbackLocale: "en" });
const abortManifestB = () => manifestOf("abortB",
  Object.fromEntries(ABORT_B_TAGS.map((tag) => [tag, padded(tag, 8)])), { fallbackLocale: "pl" });

describe("L4 — an AbortSignal cancels its own load and nothing else", () => {
  it("aborting A leaves B to complete normally", async () => {
    // THE SOLO CONTROL RUNS FIRST, and its rejection shape is CAPTURED rather than guessed. A
    // disjunction like `name === "AbortError" || code === "ABORTED"` accepts two shapes and cannot
    // notice the port changing which one it throws; deriving the shape from a solo abort on the same
    // fixture makes a change a red in one place.
    const soloDriver = scheduler([]);
    const soloController = new AbortController();
    const soloRun = loadEntireManifestFromFiles(abortManifestA(),
      { readFile: soloDriver.readerFor("S"), signal: soloController.signal });
    await new Promise((resolve) => { setImmediate(resolve); });
    soloController.abort();
    setImmediate(() => soloDriver.releaseAll());
    const soloOutcome = await settledWithin(soloRun, "the solo aborted load");
    assert.equal(soloOutcome.ok, false, "a solo abort rejects");
    const expectedShape = {
      name: /** @type {any} */ (soloOutcome).error?.name,
      code: /** @type {any} */ (soloOutcome).error?.code,
    };
    assert.ok(expectedShape.name !== undefined, "the abort rejection has a name to compare against");

    // ── THE PAIR ──────────────────────────────────────────────────────────────────────────────
    const driver = scheduler([]);
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const runA = loadEntireManifestFromFiles(abortManifestA(),
      { readFile: driver.readerFor("A"), signal: controllerA.signal });
    const runB = loadEntireManifestFromFiles(abortManifestB(),
      { readFile: driver.readerFor("B"), signal: controllerB.signal });
    await new Promise((resolve) => { setImmediate(resolve); });

    // THE SCHEDULE WITNESS: both runs really have reads outstanding at the moment of the abort, and
    // A has a QUEUE — only eight of its twelve files were ever dispatched.
    const askedBefore = driver.asked();
    assert.equal(askedBefore.filter((e) => e.startsWith("ask:A:")).length, 8,
      "A's plan is larger than the cap, so four files are still queued");
    assert.equal(askedBefore.filter((e) => e.startsWith("ask:B:")).length, 2);
    assert.equal(driver.pendingCount(), 10, "ten reads outstanding when the abort fires");

    controllerA.abort();
    // Released with VALID bytes one macrotask later, everywhere. A probe that discriminated by NOT
    // TERMINATING surfaces in CI as a job timeout rather than a named red, and valid bytes make the
    // abort arm stronger: a loader that ignored the signal would finish COMPLETE, not partial.
    setImmediate(() => driver.releaseAll());

    const outcomeA = await settledWithin(runA, "load A after its own abort");
    assert.equal(outcomeA.ok, false, "A rejects; abort is never converted into partial success");
    assert.deepEqual(
      { name: /** @type {any} */ (outcomeA).error?.name, code: /** @type {any} */ (outcomeA).error?.code },
      expectedShape, "A rejects with exactly the shape a solo abort produces");

    // THE LOAD-BEARING ASSERTION, and it is deliberately about B's SIGNAL rather than B's outcome:
    // it separates "B was cancelled by A" from "B failed for its own reasons", which the rejection
    // alone cannot.
    assert.equal(controllerB.signal.aborted, false, "B's signal was never fired");

    const outcomeB = await settledWithin(runB, "load B");
    assert.equal(outcomeB.ok, true, "B completes normally while A is being torn down");
    const b = /** @type {any} */ (outcomeB).value;
    assert.equal(b.complete, true);
    assert.deepEqual([...b.failures], []);
    assert.deepEqual(Object.keys(b.catalogs), [...ABORT_B_TAGS]);
    // The third scope axis: even a teardown that did NOT reject B must not leak A's plan into B's
    // failure array.
    assert.equal(b.failures.filter((/** @type {any} */ f) => ABORT_A_TAGS.includes(f.locale)).length, 0);

    // THE MIRROR VACUITY: an implementation that left A's reads running and merely discarded their
    // results would satisfy the rejection assertion while cancelling nothing. Nothing queued may be
    // dispatched after the abort.
    const askedAfterA = driver.asked().filter((e) => e.startsWith("ask:A:"));
    assert.equal(askedAfterA.length, 8, "no queued A file was dispatched after the abort");
  });

  it("CONTROL — the same pair with NO abort resolves both loads", async () => {
    const driver = scheduler([]);
    const runA = loadEntireManifestFromFiles(abortManifestA(), { readFile: driver.readerFor("A") });
    const runB = loadEntireManifestFromFiles(abortManifestB(), { readFile: driver.readerFor("B") });
    await new Promise((resolve) => { setImmediate(resolve); });
    const pump = setInterval(() => driver.releaseAll(), 1);
    try {
      const [a, b] = await Promise.all([
        settledWithin(runA, "no-abort A"), settledWithin(runB, "no-abort B"),
      ]);
      assert.equal(a.ok, true);
      assert.equal(b.ok, true);
      assert.deepEqual(Object.keys(/** @type {any} */ (a).value.catalogs), [...ABORT_A_TAGS].sort());
      assert.deepEqual(Object.keys(/** @type {any} */ (b).value.catalogs), [...ABORT_B_TAGS]);
    } finally { clearInterval(pump); }
  });
});

// ---------------------------------------------------------------------------------------------
// L5 — THE EIGHT-READ CAP IS PER RUN. Plan 6.2:2087: "At most eight catalog reads are active at
// once; queued work retains fetch-plan order." No other probe asks whether that semaphore is per-run
// or process-global, and a module-scope semaphore is the most plausible shared-scratch defect on the
// load side — exactly the kind of resource governor an author hoists.
// ---------------------------------------------------------------------------------------------

describe("L5 — the concurrency cap is each run's own", () => {
  it("two twelve-file loads each dispatch eight, and sixteen are active at once", async () => {
    const driver = scheduler([]);
    const runA = loadEntireManifestFromFiles(abortManifestA(), { readFile: driver.readerFor("A") });
    const runB = loadEntireManifestFromFiles(abortManifestB(), { readFile: driver.readerFor("B") });
    await new Promise((resolve) => { setImmediate(resolve); });
    try {
      const askedA = driver.asked().filter((e) => e.startsWith("ask:A:")).length;
      const askedB = driver.asked().filter((e) => e.startsWith("ask:B:")).length;
      // Measured at quiescence with every read stalled, so this is a count rather than a race.
      assert.equal(askedA, 8, "A is capped at eight");
      assert.equal(askedB, 2, "B's whole plan is smaller than the cap");
      assert.equal(driver.pendingCount(), 10);

      // The half that proves the caps are SEPARATE rather than one cap tested twice: a second
      // twelve-file run must also reach eight while A still holds its own eight.
      const runC = loadEntireManifestFromFiles(abortManifestA(), { readFile: driver.readerFor("C") });
      await new Promise((resolve) => { setImmediate(resolve); });
      assert.equal(driver.asked().filter((e) => e.startsWith("ask:C:")).length, 8,
        "a module-global semaphore would have admitted none of C's reads");
      assert.equal(driver.pendingCount(), 18, "eighteen reads active at once across three runs");

      const pump = setInterval(() => driver.releaseAll(), 1);
      try {
        for (const [label, run] of /** @type {const} */ ([["A", runA], ["B", runB], ["C", runC]]))
          assert.equal((await settledWithin(run, `cap ${label}`)).ok, true);
      } finally { clearInterval(pump); }
    } finally { driver.releaseAll(); }
  });
});

// ---------------------------------------------------------------------------------------------
// S1 — STAMPS DESCRIBE THEIR OWN RENDERING CONTEXT. Plan 6.4:2314-2316 requires a locale-keyed
// cache for direct rendering to key on the normalized ORIGINAL lookup locale, "never only the
// diagnostic selection or resolved catalog", and :2316-2320 adds that selected-locale-only caching
// is unsafe "while preserving the supplied match: exact, likely, wildcard, and other match types
// remain observable in the stamp".
//
// **HONEST SCOPE.** The interleaving here is the USAGE the clause names — one server instance, two
// locales in flight — and adds no discrimination: the ablation this row is written against is
// state-survival and is red sequentially too. What is genuinely new is the SECOND CONTEXT at all. A
// one-locale stamp test cannot distinguish "the stamp describes its context" from "the stamp
// describes the only context there has ever been", and every content-comparing stamp probe in this
// repo before this one used a single locale.
// ---------------------------------------------------------------------------------------------

const SSR_MANIFEST = manifestOf("ssr", {
  de: JSON.stringify({ Hi: "hallo" }),
  en: JSON.stringify({ Hi: "hello" }),
  "fr-FR": JSON.stringify({ Hi: "bonjour" }),
}, { fallbackLocale: "en" });

describe("S1 — two rendering contexts from one manifest-backed instance", () => {
  it("each stamp carries its own lookup locale and narrowed match", async () => {
    const loaded = /** @type {any} */ ((await settledWithin(
      loadEntireManifestFromFiles(SSR_MANIFEST), "the SSR fixture load")).value);
    // TRAP 2, closed before anything is stamped: `createSsrStamp` refuses direct construction and
    // refuses `complete: false`, so a fixture that quietly failed verification would make every
    // assertion below unreachable rather than red.
    assert.equal(loaded.complete, true);
    const strings = /** @type {any} */ (createStrings({ loaded, locale: "en" }));
    assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr-FR"]);
    assert.deepEqual({ ...strings.getLoadVerification().coverage }, { kind: "entire-manifest" });

    // THE EXPECTATIONS ARE MEASURED, NOT BELIEVED. `fr-BE` selecting `fr-FR` by likely-subtag and
    // `de-AT` selecting `de` by cldr-fallback are read off the instance here and asserted as
    // literals below; automatic direct matching is Java-backed through `matchFor`, so writing them
    // from intent rather than from the run is exactly how this project's mis-cited dispositions went
    // wrong.
    const contextFr = strings.getDirectLocaleContext("fr-BE");
    const contextDe = strings.getDirectLocaleContext("de-AT");
    assert.equal(contextFr.localeMatch.matchType, "likely-subtag");
    assert.equal(contextFr.localeMatch.locale, "fr-FR");
    assert.equal(contextDe.localeMatch.matchType, "cldr-fallback");
    assert.equal(contextDe.localeMatch.locale, "de");

    // Interleaved: build one stamp, yield, build the other, yield, then validate.
    /** @type {string[]} */ const log = [];
    const gates = barrier();
    /** @type {any} */ let stampFr = null;
    /** @type {any} */ let stampDe = null;
    const render = async (/** @type {string} */ tag, /** @type {(s: any) => void} */ store) => {
      log.push(`${tag}:build`);
      store(createSsrStamp(strings, { kind: "locale", locale: tag }));
      await gates.gate();
      log.push(`${tag}:validate`);
      validateSsrStamp(tag === "fr-BE" ? stampFr : stampDe, strings, { kind: "locale", locale: tag });
    };
    const running = [
      render("fr-BE", (s) => { stampFr = s; }), render("de-AT", (s) => { stampDe = s; }),
    ];
    await gates.drain(4);
    await Promise.all(running);
    assert.deepEqual(log, ["fr-BE:build", "de-AT:build", "fr-BE:validate", "de-AT:validate"]);

    assert.equal(stampFr.lookupLocale, "fr-BE");
    assert.equal(stampDe.lookupLocale, "de-AT");
    assert.deepEqual({ ...stampFr.localeMatch }, { locale: "fr-FR", matchType: "likely-subtag" });
    assert.deepEqual({ ...stampDe.localeMatch }, { locale: "de", matchType: "cldr-fallback" });
    // "Different" is not enough — two equally WRONG stamps are different too — so the literals above
    // carry the row and this only records that they are not the same object's fields twice.
    assert.notDeepEqual({ ...stampFr.localeMatch }, { ...stampDe.localeMatch });

    // Plan 6.4:2243-2245 — a direct context "is resolved ONLY by calling
    // `strings.getDirectLocaleContext(locale)`". Asserting the stamp against that call's answer is
    // the behavioural echo of what `test/ssr-graph.test.js` already pins structurally.
    assert.equal(stampFr.lookupLocale, contextFr.lookupLocale);
    assert.deepEqual({ ...stampFr.localeMatch },
      { locale: contextFr.localeMatch.locale, matchType: contextFr.localeMatch.matchType });

    // ── CROSS-VALIDATION, the sharper half ────────────────────────────────────────────────────
    // Written as a `throws` with a NAMED error predicate rather than a bare `throws`, because an
    // ablated build that failed for an unrelated reason would otherwise satisfy it and report green.
    assert.throws(() => validateSsrStamp(stampFr, strings, { kind: "locale", locale: "de-AT" }),
      (/** @type {any} */ error) => error?.name === "ConfigurationError"
        && /lookupLocale|localeMatch/.test(String(error.message)));
    assert.throws(() => validateSsrStamp(stampDe, strings, { kind: "locale", locale: "fr-BE" }),
      (/** @type {any} */ error) => error?.name === "ConfigurationError");
  });

  it("two contexts selecting the SAME locale by different match types are incompatible", async () => {
    // The proposition plan 6.4:2316-2320 actually states, and the one a two-context test that picks
    // two DIFFERENT selected locales cannot see: here the lookup locale and the selected locale are
    // identical on both sides and only the match TYPE differs, so a stamp keyed on the selection
    // alone would accept the wrong page.
    const loaded = /** @type {any} */ ((await settledWithin(
      loadEntireManifestFromFiles(SSR_MANIFEST), "the SSR fixture load")).value);
    const strings = /** @type {any} */ (createStrings({ loaded, locale: "en" }));

    const direct = { kind: /** @type {const} */ ("locale"), locale: "de" };
    const supplied = {
      kind: /** @type {const} */ ("locale-match"),
      localeMatch: { locale: "de", matchType: "wildcard" },
    };
    const stampDirect = createSsrStamp(strings, direct);
    const stampSupplied = createSsrStamp(strings, supplied);

    // The fixture fact: identical lookup, identical selection, different type.
    assert.equal(stampDirect.lookupLocale, stampSupplied.lookupLocale);
    assert.equal(stampDirect.localeMatch.locale, stampSupplied.localeMatch.locale);
    assert.notEqual(stampDirect.localeMatch.matchType, stampSupplied.localeMatch.matchType);

    // CONTROL, which must pass end to end: each stamp validates against its own context.
    validateSsrStamp(stampDirect, strings, direct);
    validateSsrStamp(stampSupplied, strings, supplied);

    // And the cross pair must not, in both directions, naming the field that differs.
    assert.throws(() => validateSsrStamp(stampDirect, strings, supplied),
      (/** @type {any} */ e) => e?.name === "ConfigurationError"
        && String(e.message).includes("localeMatch.matchType"));
    assert.throws(() => validateSsrStamp(stampSupplied, strings, direct),
      (/** @type {any} */ e) => e?.name === "ConfigurationError"
        && String(e.message).includes("localeMatch.matchType"));
  });
});

// ---------------------------------------------------------------------------------------------
// S2 — A MANIFEST-BACKED INSTANCE UNDER INTERLEAVING. Every core row above builds directly, and
// S9's landed split is per-instance state with TWO members a shared scratch can cross: the SELECTION
// channel reads the full `manifestLocaleConfiguration` while the RESOLUTION channel keeps the loaded
// catalogs and the FILTERED tiebreakers. All 2,112 conformance cases construct directly, so they are
// structurally blind to it.
// ---------------------------------------------------------------------------------------------

const SUBSET_MANIFEST = manifestOf("subset", {
  de: JSON.stringify({ Note: "DE-note" }),
  en: JSON.stringify({ Note: "EN-note" }),
  "fr-CA": JSON.stringify({ Note: "FR-CA-note" }),
  "fr-FR": JSON.stringify({ Note: "FR-FR-note" }),
}, { fallbackLocale: "en" });
SUBSET_MANIFEST.tiebreakers = { fr: ["fr-CA", "fr-FR"] };
SUBSET_MANIFEST.catalogFingerprint =
  computeCatalogIdentity(catalogIdentityInputFor(SUBSET_MANIFEST)).catalogFingerprint;

const WHOLE_MANIFEST = manifestOf("whole", {
  en: JSON.stringify({ Note: "EN-whole" }),
  he: JSON.stringify({ Note: "HE-whole" }),
}, { fallbackLocale: "en" });

describe("S2 — two manifest-backed instances keep their own applicable configurations", () => {
  it("the SELECTION channel stays the manifest's while RESOLUTION stays inside the loaded set",
    async () => {
      const subsetLoaded = /** @type {any} */ ((await settledWithin(
        loadStringsFromFiles(SUBSET_MANIFEST, "fr-BE"), "the subset load")).value);
      const wholeLoaded = /** @type {any} */ ((await settledWithin(
        loadEntireManifestFromFiles(WHOLE_MANIFEST), "the whole load")).value);

      // FIXTURE WITNESSES FIRST: the subset really is a subset, and the two instances really are
      // backed by different manifests. Without both, "each kept its own" is unfalsifiable.
      assert.deepEqual({ ...subsetLoaded.coverage }, { kind: "lookup", lookupLocale: "fr-BE" });
      assert.deepEqual(Object.keys(subsetLoaded.catalogs).sort(), ["en", "fr-CA", "fr-FR"]);
      assert.ok(!Object.keys(subsetLoaded.catalogs).includes("de"),
        "`de` is declared and NOT loaded — the whole point of a lookup subset");
      assert.notEqual(subsetLoaded.catalogIdentity.catalogFingerprint,
        wholeLoaded.catalogIdentity.catalogFingerprint);

      const subset = /** @type {any} */ (createStrings({ loaded: subsetLoaded, locale: "fr-BE" }));
      const whole = /** @type {any} */ (createStrings({ loaded: wholeLoaded, locale: "en" }));

      /** @type {string[]} */ const log = [];
      const gates = barrier();
      /** @type {Record<string, any[]>} */ const seen = { subset: [], whole: [] };

      const probe = (/** @type {any} */ instance, /** @type {string} */ locale) => {
        const result = instance.getResult("Note", undefined, { locale });
        return {
          translation: result.translation,
          resolved: result.resolvedLocale,
          chain: [...result.attemptedLocales],
          // The SELECTION channel: the full manifest set, including a locale that never loaded.
          selection: [...instance.getLocaleConfiguration().supportedLocales],
          // The RESOLUTION channel: only what arrived.
          loaded: [...instance.getSupportedLocales()],
        };
      };

      const handler = async (/** @type {"subset" | "whole" */ name, /** @type {any} */ instance,
        /** @type {string} */ locale) => {
        for (let round = 0; round < ROUNDS; ++round) {
          log.push(`${name}:${round}`);
          seen[name]?.push(probe(instance, locale));
          await gates.gate();
        }
      };

      const running = [
        handler("subset", subset, "fr-BE"), handler("whole", whole, "he"),
      ];
      await gates.drain(ROUNDS + 2);
      await Promise.all(running);

      /** @type {string[]} */ const expectedLog = [];
      for (let round = 0; round < ROUNDS; ++round)
        for (const name of /** @type {const} */ (["subset", "whole"])) expectedLog.push(`${name}:${round}`);
      assert.deepEqual(log, expectedLog);

      const expectedSubset = {
        translation: "FR-CA-note", resolved: "fr-CA", chain: ["fr-BE", "fr", "fr-CA"],
        selection: ["de", "en", "fr-CA", "fr-FR"], loaded: ["en", "fr-CA", "fr-FR"],
      };
      const expectedWhole = {
        translation: "HE-whole", resolved: "he", chain: ["he"],
        selection: ["en", "he"], loaded: ["en", "he"],
      };
      // The fixture fact the row rests on: for the subset instance the two channels DISAGREE, and
      // for the whole-manifest instance they agree. A probe over only the second shape could not
      // tell the two channels apart at all.
      assert.notDeepEqual(expectedSubset.selection, expectedSubset.loaded);
      assert.deepEqual(expectedWhole.selection, expectedWhole.loaded);

      for (const [index, row] of /** @type {any[]} */ (seen["subset"]).entries())
        assert.deepEqual(row, expectedSubset, `subset call ${index}`);
      for (const [index, row] of /** @type {any[]} */ (seen["whole"]).entries())
        assert.deepEqual(row, expectedWhole, `whole call ${index}`);

      // And the coverage refusal is still each instance's own after the interleave: the subset
      // instance may not serve a tag its subset was not planned from, while the whole-manifest one
      // answers any tag it supports.
      assert.throws(() => subset.getResult("Note", undefined, { locale: "de" }),
        (/** @type {any} */ e) => e?.name === "ConfigurationError"
          && String(e.message).includes("fr-BE"));
      assert.equal(whole.getResult("Note", undefined, { locale: "en" }).translation, "EN-whole");
    });
});
