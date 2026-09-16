// @ts-check
/**
 * INSTANCE LIFECYCLE — acceptance clause 72, plan 6.6:2352-2354.
 *
 *   > `createStrings` compiles expressions eagerly. Servers keep an immutable instance or bounded set
 *   > of instances per catalog version and atomically replace references on reload. Locale selection
 *   > is per call; no mutable process-global locale exists.
 *
 * **WHY THE OBVIOUS PROBE FAILS, three times over — this is the whole design of the file.**
 *
 * 1. *Eager compile.* The obvious probe puts a broken expression in a catalog and asserts that
 *    something throws. It is GREEN over a lazy-compile build: a lazy build throws too, from `get`
 *    instead of from the constructor, and a probe that only asserts "it threw" cannot tell the two
 *    apart. The observation differs ONLY for an expression no lookup ever requests — so the probe
 *    must never request it, and `test("the unreached alternative is a LIVE path…")` is what stops
 *    "never requested" from collapsing into "structurally dead and legitimately skipped", which
 *    would make the whole row vacuous. (Reaching a branch is not discriminating it; here the trick
 *    is the reverse — the branch must be reachable and deliberately not reached.)
 *
 * 2. *Per-call locale selection.* The obvious probe counts resolver calls. It is GREEN over a build
 *    that faithfully calls the resolver twice and then serves both lookups from a chain it cached on
 *    the first — the call count says the resolver ran, not that its ANSWER was used. So every
 *    resolver row carries TWO independent observations: the exact call count AND the translation.
 *    And every probe value here is deliberately spelled NON-CANONICALLY in one row (`FR`, `DE-de`),
 *    because plan 3.4:864 grants the cache for a constant instance locale and withholds it for a
 *    resolver — "Resolver and per-call locale values are normalized and recomputed on every use" —
 *    and this project has already shipped two live defects that survived a 1,965-case corpus for
 *    exactly one reason: every tag in it was spelled canonically.
 *
 * 3. *No mutable process-global locale.* The obvious probe builds two instances and reads each one.
 *    It is GREEN over a module-scoped current-locale global written at construction (each instance is
 *    read while the global still holds its own value) AND over one written per `get`. Only
 *    construct-construct-read-read-READ catches the second, and the discriminating observation is
 *    re-reading the FIRST instance after the second has run. The same third-read shape is what
 *    catches a per-call locale that STICKS, and what catches a catalog-version-keyed global.
 *
 * **WHAT THIS FILE DOES NOT PROVE, recorded rather than quietly implied.**
 *
 * - *"atomically replace references"* — the grammatical subject is "Servers", i.e. the application.
 *   The library exposes no reload door for atomicity to be a property OF (plan 1.3:69 puts "mutable
 *   live-reload instances" on the EXCLUDED list), and `ref = next` has no interleaving point in a
 *   single-threaded runtime. `assert.equal(ref, next)` after `ref = next` would be green under every
 *   possible implementation — the vacuous probe in its purest form. The falsifiable RESIDUE is that
 *   the library must not PREVENT atomic replacement by tearing across two constructions, and that is
 *   what `test("an instance built from catalog version N keeps answering N…")` probes.
 * - *"bounded set of instances"* — a cardinality constraint on what an application retains in its own
 *   map. Nothing the library does differs between two instances and two thousand. What the evidence
 *   below supports is "an application may hold several instances without them interfering", not
 *   "the set is bounded".
 * - *TRUE CONCURRENCY* ("concurrent locales have no cross-talk", plan :2924) is not testable in this
 *   runtime: `get` is synchronous end to end and there is no yield point inside a lookup. The
 *   reentrant cross-instance call from inside a `fallbackPolicy` callback is the STRONGEST AVAILABLE
 *   SUBSTITUTE and the only window in which a set-and-restore global would be observable at all. It
 *   is reentrancy under one thread and is written up as nothing more.
 * - *`ConfigurationError` for a missing optional data module* (plan 3.7:1435-1437) is the same
 *   proposition — construction is the fallible moment — carried by a different mechanism, and it is
 *   §3.7's clause rather than 6.6's. It is already gated by `test/optional-plural-data.test.js`;
 *   re-asserting it here would inflate clause 72's row count with a row that stays green if
 *   `createStrings` compiled expressions lazily.
 *
 * The reentrancy callback is `fallbackPolicy` DELIBERATELY: this project's own measured invariants
 * record that the failure handler fires exactly ONCE, AFTER the walk — so `onFailure` is outside the
 * lookup window and a reentrancy probe built on it would be silently vacuous.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/* ------------------------------------------------------------------------------------------------
 * THE OBSERVATION WINDOW, INSTALLED BEFORE ANY LIBRARY MODULE EVALUATES.
 *
 * Every import below is DYNAMIC for one reason: static imports are hoisted, so a module that
 * registered a listener or snapshotted `navigator` at evaluation time would already have done it
 * before a statically-ordered recorder could run, and the row that exists to catch that would report
 * a clean bill of health.
 *
 * `globalThis.navigator` is a non-writable ACCESSOR in modern Node — plain assignment silently
 * no-ops in sloppy mode and throws in an ESM module — so the stub goes in through
 * `Object.defineProperty` and is READ BACK BY NAME before anything depends on it. A stub that never
 * installed makes every "the instance did not change" assertion trivially true.
 *
 * `addEventListener` does not exist on Node's `globalThis` at all, so the recorder DEFINES it rather
 * than wrapping it, and `window`/`self` are aliased to `globalThis` so that the implementation an
 * author actually writes — `if (typeof window !== "undefined") window.addEventListener(...)` —
 * registers on the object being recorded instead of no-oping into an instrument that sees nothing.
 * ---------------------------------------------------------------------------------------------- */

/** @type {string[]} */
const registrations = [];
/** @type {Map<string, ((event: { type: string }) => void)[]>} */
const listeners = new Map();

Object.defineProperty(globalThis, "addEventListener", {
  value: (/** @type {string} */ type, /** @type {any} */ handler) => {
    registrations.push(type);
    const existing = listeners.get(type);
    if (existing === undefined) listeners.set(type, [handler]);
    else existing.push(handler);
  },
  configurable: true,
  writable: true,
});

/** Fire what the recorder captured, so a registered listener really runs. */
const dispatchGlobalEvent = (/** @type {string} */ type) => {
  for (const handler of listeners.get(type) ?? []) handler({ type });
};

const setNavigatorLanguages = (/** @type {readonly string[]} */ languages) => {
  Object.defineProperty(globalThis, "navigator", {
    value: { languages: [...languages] },
    configurable: true,
    writable: true,
  });
};

setNavigatorLanguages(["de-DE", "de"]);
/** @type {any} */ (globalThis).window = globalThis;
/** @type {any} */ (globalThis).self = globalThis;

const { chooseBrowserLocale, chooseLocaleForPreferredLanguages, createStrings, forLocale } =
  await import("../src/core/index.js");
const { ExpressionEvaluationError } = await import("../src/internal/expression.js");

/** Captured immediately after the library graph has evaluated, and asserted on below by name. */
const REGISTRATIONS_AFTER_IMPORT = [...registrations];

/* ------------------------------------------------------------------------------------------------
 * 72.a — `createStrings` compiles expressions eagerly, INCLUDING unreachable branches.
 * Plan 2.7:298-302 and 3.2:608-611; the error type is plan 4.2:1146's wrapper-count row.
 * ---------------------------------------------------------------------------------------------- */

/** A structurally perfect expression: two reserved operands of the SAME axis. */
const SOUND = "GENDER_MASCULINE == GENDER_MASCULINE";

/**
 * Three defect classes plan 2.7:300-301 names, and the choice of classes is load-bearing.
 *
 * A malformed-JSON, bad-depth, unknown-form-name or missing-`translation` probe would be rejected by
 * MODEL VALIDATION — which plan 3.2:610 lists as a step BEFORE compilation and which a lazy-compile
 * build still runs eagerly. Such a probe would "confirm" eager compilation while never invoking the
 * compiler at all: the zh-123 shape, one subsystem over.
 *
 * The three below reach the compiler and nothing earlier, and that is a fact about THIS port rather
 * than an inference from the classes: `createStrings` hands the model parser no `validateExpression`
 * (only `lokalized/parse` does), so every expression that arrives through construction is untouched
 * until the eager compile walk. A syntax-eager / type-lazy build — a real intermediate design — would
 * still be caught by the first class, which needs operand-type reasoning; the second is
 * grammar-shaped and the third is a result-type check, and they are breadth rather than independent
 * discrimination. Recorded so nobody reads three greens as three separate proofs.
 */
const DEFECT_CLASSES = [
  ["cross-axis reserved operands", "GENDER_MASCULINE == CARDINALITY_ONE"],
  ["a chained comparison", "1 < 2 < 3"],
  ["a non-boolean whole expression", "CARDINALITY_ONE"],
];

const EN_CATALOG = [{ key: "Greeting", translation: "Hello" }];

/**
 * ONE builder for every row in this section, so the rows differ by exactly one entry's expression.
 *
 * That one-entry difference IS the provenance proof, and it replaces the message-text assertion the
 * first draft of this design leaned on: plan 4.2:1142 makes the wrapper count and cause identity
 * normative and diagnostic message text explicitly NOT, so building clause 72's evidence on
 * `/UnvisitedKey/.test(e.message)` would pin a surface the plan reserves the right to change.
 * Throw/no-throw out of a one-entry difference in is a measurement; a regex over prose is a claim.
 */
const unreachedCatalog = (/** @type {string} */ expression) => [
  { key: "Greeting", translation: "Hello" },
  { key: "UnvisitedKey", translation: "default", alternatives: [{ expression, translation: "never rendered" }] },
];

const build = (/** @type {unknown} */ frCatalog) =>
  createStrings({
    locale: "fr",
    fallbackLocale: "en",
    strings: { fr: /** @type {any} */ (frCatalog), en: EN_CATALOG },
  });

/**
 * The value a refusal threw, or a named failure saying construction RETURNED.
 *
 * `assert.throws` answers `undefined`, so a row that wants to say something about the thrown value
 * has to capture it. "Missing expected exception" is the exact red a lazy-compile build produces
 * here, and it must be a failure rather than a skipped assertion.
 */
const refusalFrom = (/** @type {() => unknown} */ construct) => {
  try {
    construct();
  } catch (error) {
    return error;
  }
  return assert.fail("createStrings returned an instance where it must have refused");
};

test("the unreached alternative is a LIVE path: it compiles, constructs, and renders when asked", () => {
  // CONTROL A — structural validity. The broken twins below differ from this catalog in one
  // expression and nothing else, so this green is what proves they clear JSON, model validation,
  // depth, identifier grammar and the `translation`-or-alternative rule, and fail only at the
  // compiler. Without it a refusal from any earlier guard would be recorded as eager compilation.
  const strings = build(unreachedCatalog(SOUND));
  assert.equal(strings.get("Greeting"), "Hello");

  // CONTROL B — reachability, and it is what stops the whole section being vacuous. If this slot
  // were structurally dead, "never looked up" would mean "legitimately never compiled" and a lazy
  // build would be conforming. It is not dead: asked for, it evaluates the alternative and renders
  // it, so a lazy build genuinely WOULD have compiled it on first lookup.
  assert.equal(strings.get("UnvisitedKey"), "never rendered");
});

test("createStrings refuses a compile-stage defect in a branch no lookup ever reaches", () => {
  // ANTI-INERTNESS, and what it measured is worth more than the row. Under the lazy-compile
  // ablation this goes red with "createStrings returned an instance where it must have refused",
  // `get("Greeting")` still answers "Hello" — and `get("UnvisitedKey")` DOES NOT THROW EITHER. It
  // answers the key: `status "returned-key"`, `failureReason "resolution-failure"`, the
  // `ExpressionEvaluationError` demoted to a retained cause. So the behaviour did not merely move
  // from construction to lookup; a lazy build turns an authoring error into a silently wrong
  // rendering, which is the outcome plan 2.7:301-302 forbids in as many words — compile failures
  // "never enter locale fallback or the failure handler". That is the whole cost of not being eager,
  // and no probe that only asked "does something throw" could ever have seen it.
  for (const [description, expression] of DEFECT_CLASSES) {
    // `UnvisitedKey` is never requested in this test, and that is the entire discrimination: ask for
    // it and a lazy-compile build throws too, from `get`, and the observation stops differing.
    const error = refusalFrom(() => build(unreachedCatalog(/** @type {string} */ (expression))));
    // The TYPE, which plan 4.2:1142 makes normative — and not the message text, which the same line
    // makes explicitly non-normative.
    assert.ok(
      error instanceof ExpressionEvaluationError,
      `${description}: expected ExpressionEvaluationError, got ${error}`,
    );
  }
});

test("the refusal is caused by the defective entry, measured by a one-entry difference", () => {
  // Provenance WITHOUT message text. Three constructions from one builder: sound entry constructs,
  // the same entry made defective refuses, and the defect moved onto a DIFFERENT unreached key
  // refuses again. Nothing else in the catalog moves.
  const twoUnreachedKeys = (/** @type {string} */ first, /** @type {string} */ second) => [
    { key: "Greeting", translation: "Hello" },
    { key: "UnvisitedKey", translation: "d", alternatives: [{ expression: first, translation: "x" }] },
    { key: "UnvisitedKey2", translation: "d", alternatives: [{ expression: second, translation: "x" }] },
  ];

  assert.equal(build(twoUnreachedKeys(SOUND, SOUND)).get("Greeting"), "Hello");
  refusalFrom(() => build(twoUnreachedKeys("GENDER_MASCULINE == CARDINALITY_ONE", SOUND)));
  refusalFrom(() => build(twoUnreachedKeys(SOUND, "GENDER_MASCULINE == CARDINALITY_ONE")));
});

test("a defect in the SECOND whole-message alternative is found, not skipped after the first", () => {
  // THE LOOP-ORDER ROW. `alternatives[0]` is sound AND TRUE, so it is what a lookup renders — which
  // is what makes this row narrow: a build that compiles only the first alternative still renders
  // this catalog correctly, and only the construction refusal separates it from a correct one.
  const twoAlternatives = (/** @type {string} */ second) => [
    { key: "Greeting", translation: "Hello" },
    {
      key: "TwoAlternatives",
      translation: "default",
      alternatives: [
        { expression: SOUND, translation: "first" },
        { expression: second, translation: "second" },
      ],
    },
  ];

  // The control renders through `alternatives[0]`, so it stays green under a first-alternative-only
  // build and a red control therefore means the FIXTURE broke, not the library.
  assert.equal(build(twoAlternatives(SOUND)).get("TwoAlternatives"), "first");
  refusalFrom(() => build(twoAlternatives("CARDINALITY_ONE")));
});

test("a defect in a GENERATED-PLACEHOLDER alternative is found, in its own walk position", () => {
  // The other half of the compile walk: Java walks a node's PLACEHOLDER definitions before its
  // whole-message alternatives, and the two positions are separately ablatable — a build that
  // skipped either would still pass every row above or below it. Same loop-order shape: the sound
  // fragment alternative is first and true, the defect is second.
  const fragment = (/** @type {string} */ second) => [
    { key: "Greeting", translation: "Hello" },
    {
      key: "UnvisitedFragment",
      translation: "{{piece}}",
      placeholders: {
        piece: {
          kind: "expression",
          translation: "fragment default",
          alternatives: [
            { expression: SOUND, translation: "first fragment" },
            { expression: second, translation: "second fragment" },
          ],
        },
      },
    },
  ];

  assert.equal(build(fragment(SOUND)).get("UnvisitedFragment"), "first fragment");
  refusalFrom(() => build(fragment("1 < 2 < 3")));
});

test("a defect NESTED inside an alternative's own branch is found", () => {
  // Plan 2.7's "including expressions in unreachable branches" reaches all the way down: the compile
  // walk recurses into each alternative's definition. A build that walked one level would construct
  // this catalog and fail only for the user whose values happened to reach depth two.
  const nested = (/** @type {string} */ inner) => [
    { key: "Greeting", translation: "Hello" },
    {
      key: "NestedKey",
      translation: "default",
      alternatives: [
        { expression: SOUND, translation: "outer", alternatives: [{ expression: inner, translation: "inner" }] },
      ],
    },
  ];

  assert.equal(build(nested(SOUND)).get("NestedKey"), "inner");
  refusalFrom(() => build(nested("GENDER_MASCULINE == CARDINALITY_ONE")));
});

/* ------------------------------------------------------------------------------------------------
 * 72.c — locale selection is PER CALL. Plan 3.4:864-865, 3.4:874, 3.3:743-745.
 * ---------------------------------------------------------------------------------------------- */

const FR_TEXT = "FR_TEXT";
const DE_TEXT = "DE_TEXT";
const EN_TEXT = "EN_TEXT";

/** Three catalogs whose K differ, so no two answers can be confused for one another. */
const localeCatalogs = () => ({
  fr: [{ key: "K", translation: FR_TEXT }],
  de: [{ key: "K", translation: DE_TEXT }],
  en: [{ key: "K", translation: EN_TEXT }],
});

test("the three catalogs are loaded and answer distinguishably", () => {
  // CONTROLS A, B and C for every row in this section, asserted by name and never used as a guard.
  // Without A, a stale `fr` answer on a second lookup cannot be told apart from "`de` lacks K and
  // fell back"; without B, a silent fallback could masquerade as either catalog's text.
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: localeCatalogs() });
  assert.equal(strings.get("K", undefined, forLocale("fr")), FR_TEXT);
  assert.equal(strings.get("K", undefined, forLocale("de")), DE_TEXT);
  assert.equal(strings.get("K", undefined, forLocale("es")), EN_TEXT, "an unloaded tag falls back to en");
  assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr"]);
  assert.notEqual(FR_TEXT, DE_TEXT);
  assert.notEqual(DE_TEXT, EN_TEXT);
});

test("localeResolver is NOT consulted at construction and IS consulted on every lookup", () => {
  let current = "fr";
  /** @type {string[]} */
  const calls = [];
  const strings = createStrings({
    localeResolver: () => { calls.push(current); return current; },
    fallbackLocale: "en",
    strings: localeCatalogs(),
  });

  // (1) The port's own `.d.ts` says "consulted per lookup, NEVER AT CONSTRUCTION"; a declaration is
  // a claim like any other, and this is the measurement. It is also the only assertion that catches
  // a build which resolves eagerly and happens to re-resolve later too.
  assert.equal(calls.length, 0, "the resolver ran during construction");

  const first = strings.get("K");
  assert.equal(calls.length, 1);
  assert.equal(first, FR_TEXT);

  current = "de";
  const second = strings.get("K");
  // (4) and (5) are INDEPENDENT observations. A build that calls the resolver faithfully and then
  // serves both lookups from a chain cached on the first passes (4) and fails only (5) — the call
  // count says the resolver ran, not that its answer was used.
  assert.equal(calls.length, 2, "the resolver must be consulted again, not memoized");
  assert.equal(second, DE_TEXT, "the resolver's new answer must reach the catalogs");
  // (6) Asserted by name so a fixture whose two texts were accidentally equal fails loudly instead
  // of passing vacuously.
  assert.notEqual(first, second);
});

test("a localeResolver answering NON-CANONICAL tags is normalized on every use", () => {
  // **THE ROW THE FIRST DRAFT DID NOT HAVE, and this project's signature blind spot.** Plan 3.4:864
  // says resolver values are "normalized and recomputed on every use"; a build that recomputes
  // faithfully but compares the resolver's RAW answer against normalized supported tags passes every
  // assertion in the row above, because every tag there is already canonical. That exact defect has
  // shipped here before — tiebreaker tags compared raw against normalized supported tags, invisible
  // to 1,965 corpus cases because every tiebreaker in them was spelled canonically.
  //
  // `EN_TEXT` is what such a build answers (the raw tag matches no catalog and the walk falls back),
  // which is precisely why the unloaded-tag control above must be asserted first: it is what makes
  // "fell back" distinguishable from "answered de".
  //
  // **AND THIS ROW IS A REGRESSION GATE, NOT ABLATION-VERIFIED EVIDENCE — measured, and the
  // measurement is worth more than the row.** This port canonicalizes tag case at FOUR independent
  // layers: `createStrings`' locale ingress, `candidateChain`'s own entry, the equivalence rescue
  // inside the chain walk, and `fallbackLocaleTagsFor`, which renders every candidate through the
  // JDK round trip. Removing the first alone, the first two together, and the first three together
  // each leave this row GREEN. No plausible single-site edit can redden it, so nothing here should
  // be recorded as "gated by a named ablation"; what it gates is a DIFFERENTLY STRUCTURED
  // implementation that compares a resolver's raw answer against the supported set, which is exactly
  // the defect this project shipped once in the tiebreaker path.
  let current = "FR";
  const strings = createStrings({
    localeResolver: () => current,
    fallbackLocale: "en",
    strings: localeCatalogs(),
  });

  const first = strings.get("K");
  assert.equal(first, FR_TEXT, "'FR' must normalize to the loaded 'fr' catalog");

  current = "DE-de";
  const second = strings.get("K");
  assert.equal(second, DE_TEXT, "'DE-de' must normalize to 'de-DE' and resolve to the loaded 'de'");
  assert.notEqual(first, second);
});

test("a NON-CANONICAL per-call locale answers exactly as its canonical spelling does", () => {
  // The mirrored half for the per-call door (plan 3.3:749-750: a direct per-call `locale` "need only
  // normalize to a well-formed tag"). `forLocale` normalizes syntactically at the point it is
  // spelled, so this pins the two doors to one answer rather than two.
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: localeCatalogs() });
  assert.equal(strings.get("K", undefined, forLocale("DE-de")), strings.get("K", undefined, forLocale("de")));
  assert.equal(strings.get("K", undefined, forLocale("DE-de")), DE_TEXT);
});

test("localeMatchResolver is consulted on every lookup too, and its answer reaches the catalogs", () => {
  // The second ingress plan 3.4:874 covers — "revalidated on every use". Same two-observation shape.
  const matchFor = (/** @type {string} */ locale) => ({
    matchType: "exact",
    locale,
    isMatch: true,
    fallbackLocale: "en",
    consideredLocales: ["de", "en", "fr"],
    effectiveWeight: 1,
    languageRange: locale,
    requestedLanguageRanges: [{ range: locale, weight: 1 }],
  });

  let current = "fr";
  /** @type {string[]} */
  const calls = [];
  const strings = createStrings({
    localeMatchResolver: () => { calls.push(current); return /** @type {any} */ (matchFor(current)); },
    fallbackLocale: "en",
    strings: localeCatalogs(),
  });

  assert.equal(calls.length, 0, "the match resolver ran during construction");
  assert.equal(strings.get("K"), FR_TEXT);
  assert.equal(calls.length, 1);

  current = "de";
  assert.equal(strings.get("K"), DE_TEXT, "the new match must displace the old one");
  assert.equal(calls.length, 2);
});

test("a CONSTANT instance locale answers the same on every call — the boundary plan 3.4:864 permits", () => {
  // CONTROL D, not a row: plan 3.4:864 explicitly PERMITS caching the constant instance locale's
  // match, so no ablation in this file's table may redden this and it adds nothing to clause 72's
  // count. It is here to pin the boundary of the permission — the rows above withhold a cache for
  // the two resolver doors, and this says where the cache is allowed to exist.
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: localeCatalogs() });
  assert.equal(strings.get("K"), FR_TEXT);
  assert.equal(strings.get("K"), FR_TEXT);
  assert.equal(strings.get("K"), FR_TEXT);
});

/* ------------------------------------------------------------------------------------------------
 * 72.d — no mutable process-global locale, and no global keyed on the catalog.
 * Plan 6.6:2354, 6.3:2101, 1.3:69.
 * ---------------------------------------------------------------------------------------------- */

/** As `localeCatalogs`, plus a K2 that `fr` does NOT carry — the key that forces a fallback walk. */
const crossTalkCatalogs = () => ({
  fr: [{ key: "K", translation: FR_TEXT }],
  de: [{ key: "K", translation: DE_TEXT }, { key: "K2", translation: "DE_TEXT_K2" }],
  en: [{ key: "K", translation: EN_TEXT }, { key: "K2", translation: "EN_TEXT_K2" }],
});

test("two instances over one catalog object do not interfere, and the THIRD read is the proof", () => {
  // THE READ SEQUENCE IS LOAD-BEARING, not decorative. Construct A, construct B, then read A, B, A.
  // The naive order — construct A, read A, construct B, read B — is green over a global written at
  // construction (each instance is read while the global still holds its own value) and green over
  // one written per `get`. Only construct-construct-read-read-read catches the first, and only the
  // THIRD read catches the second.
  //
  // Both instances are built from the SAME catalog object on purpose, so a shared-internal-state
  // defect is in range rather than excluded by the fixture.
  const catalogs = crossTalkCatalogs();
  const A = createStrings({ locale: "fr", fallbackLocale: "en", strings: catalogs });
  const B = createStrings({ locale: "de", fallbackLocale: "en", strings: catalogs });

  const a1 = A.get("K");
  const b1 = B.get("K");
  const a2 = A.get("K");

  assert.equal(a1, FR_TEXT);
  assert.equal(b1, DE_TEXT, "B must really be wired to a different locale, or the row probes nothing");
  assert.equal(a2, FR_TEXT, "A answered B's locale on a read that followed B's");
  assert.equal(a2, a1);

  // The single-instance baseline, so the correct `a1` is not an artifact of the fallback chain.
  const only = createStrings({ locale: "fr", fallbackLocale: "en", strings: crossTalkCatalogs() });
  assert.equal(only.get("K"), FR_TEXT);
});

test("the same holds with the construction order REVERSED", () => {
  // The proposition says "in either construction order or read order", and a proposition is only
  // proven by the gate that exercises it — running one order and claiming both is how a text ends up
  // asserting more than it measured. `de` is constructed first here, and the mirrored sequence is
  // read: B, A, B.
  const catalogs = crossTalkCatalogs();
  const B = createStrings({ locale: "de", fallbackLocale: "en", strings: catalogs });
  const A = createStrings({ locale: "fr", fallbackLocale: "en", strings: catalogs });

  const b1 = B.get("K");
  const a1 = A.get("K");
  const b2 = B.get("K");

  assert.equal(b1, DE_TEXT);
  assert.equal(a1, FR_TEXT);
  assert.equal(b2, DE_TEXT, "B answered A's locale on a read that followed A's");
});

test("an instance built from catalog version N keeps answering N after N+1 exists and is used", () => {
  // THE EXECUTABLE RESIDUE OF "per catalog version … atomically replace references". The atomicity of
  // `current = next` is unfalsifiable here; what IS falsifiable is that the library must not tear
  // across the two constructions. This varies the CATALOG and holds the locale fixed — the exact
  // complement of the row above, which varies the locale and holds the catalog fixed — so neither
  // can be mistaken for covering the other.
  //
  // Both records declare the SAME `catalogIdentity`, which is the key plan 6.6:2352 invites an author
  // to memoize on ("an immutable instance … per catalog version") and the cache plan 6.3:2101
  // forbids. Core validates an identity's SHAPE and not its truth, so this is a legal input.
  const identity = { catalogVersion: "clause72.v", catalogFingerprint: "clause72.f" };
  const v1 = createStrings({
    locale: "en", fallbackLocale: "en", catalogIdentity: identity,
    strings: { en: [{ key: "K", translation: "V1" }] },
  });
  const v2 = createStrings({
    locale: "en", fallbackLocale: "en", catalogIdentity: identity,
    strings: { en: [{ key: "K", translation: "V2" }] },
  });

  assert.equal(v1.getCatalogIdentity()?.catalogVersion, v2.getCatalogIdentity()?.catalogVersion,
    "the two records must COLLIDE on catalogVersion, or a version-keyed cache is never consulted");

  // Read order is the discrimination, exactly as above: the newest first, then the old one, then the
  // newest again.
  assert.equal(v2.get("K"), "V2");
  assert.equal(v1.get("K"), "V1", "the older instance served the newer catalog");
  assert.equal(v2.get("K"), "V2");
});

test("a per-call locale does not STICK: the next bare lookup returns to the instance source", () => {
  // The classic `setlocale` defect the clause's last sentence exists to forbid, and the one-line
  // convenience an implementer writes for it (`if (options?.locale) this.currentLocale = ...`). The
  // discriminating observation is again the THIRD read — the first two are green under a sticky
  // build.
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: localeCatalogs() });
  assert.equal(strings.get("K"), FR_TEXT);
  assert.equal(strings.get("K", undefined, forLocale("de")), DE_TEXT);
  assert.equal(strings.get("K"), FR_TEXT, "the explicit per-call locale stuck to the instance");
});

test("a lookup on another instance from inside a fallbackPolicy does not perturb the outer walk", () => {
  // REENTRANCY — the only interleaving a single-threaded synchronous runtime admits, and the only
  // window in which a set-and-restore process-global is observable at all: a global assigned at the
  // top of `get` and restored in a `finally` is correct for every row above and wrong only here,
  // because the inner lookup overwrites it and the outer walk resumes reading the inner locale.
  //
  // `fallbackPolicy` is the callback DELIBERATELY. The failure handler fires exactly once AFTER the
  // walk, so a probe built on `onFailure` would fire outside the window and prove nothing.
  const catalogs = crossTalkCatalogs();
  const B = createStrings({ locale: "de", fallbackLocale: "en", strings: catalogs });

  /** @type {string[]} */
  const policyCalls = [];
  let inner = null;
  const A = createStrings({
    locale: "fr", fallbackLocale: "en", strings: catalogs,
    fallbackPolicy: (/** @type {string} */ _reason, /** @type {string} */ attemptedLocale) => {
      policyCalls.push(attemptedLocale);
      inner = B.get("K");
      return true;
    },
  });

  const outer = A.get("K2");

  // The policy really ran, on the `fr` candidate. Without this the inner lookup never happened
  // inside the lookup window and the row tests nothing — the same masking an M8 tiebreaker ablation
  // hit, where the walk short-circuited before the branch the fixture existed to reach.
  assert.deepEqual(policyCalls, ["fr"]);
  assert.equal(inner, DE_TEXT, "the reentrant lookup must answer from ITS instance");
  assert.equal(outer, "EN_TEXT_K2", "A's walk resumed on the inner instance's locale");

  // The control: the same lookup with a policy that calls nothing must give the same answer, so the
  // assertion above is about the reentrancy and not about the policy's mere presence.
  /** @type {string[]} */
  const plainCalls = [];
  const control = createStrings({
    locale: "fr", fallbackLocale: "en", strings: crossTalkCatalogs(),
    fallbackPolicy: (/** @type {string} */ _reason, /** @type {string} */ attemptedLocale) => {
      plainCalls.push(attemptedLocale);
      return true;
    },
  });
  assert.equal(control.get("K2"), "EN_TEXT_K2");
  assert.deepEqual(plainCalls, ["fr"]);
});

/**
 * A name that looks like a door onto shared locale state.
 *
 * NEGATIVE-TESTED BELOW BEFORE IT IS TRUSTED. This project has shipped a gate whose regex could
 * never have matched anything the tool it watched actually printed, and "the sweep found nothing" is
 * indistinguishable from "the sweep cannot match anything".
 */
const MUTATOR_SHAPED =
  /^(set|use|configure|config|init|install|register|activate|reset|change|update|with|default|current|global)/i;

test("the export-name sweep flags the shapes it exists to catch, and clears the ones it must not", () => {
  // The matcher's own negative test, run against an INJECTED list rather than against the real
  // surface — a sweep that reports zero over the real surface proves nothing until it is shown to
  // report non-zero over names that should trip it.
  for (const name of [
    "setLocale", "setDefaultLocale", "useLocale", "configureLocale", "initLocale",
    "withLocale", "changeLocale", "activate", "registerLocale", "resetLocale",
    "currentLocale", "defaultLocale", "globalLocale", "updateLocale",
  ])
    assert.match(name, MUTATOR_SHAPED, `${name} must be flagged`);

  for (const name of ["createStrings", "forLocale", "chooseBrowserLocale", "parseStrings", "loadStrings"])
    assert.doesNotMatch(name, MUTATOR_SHAPED, `${name} must not be flagged`);

  // THE ERROR-CLASS EXEMPTION, tested rather than asserted. It must apply to a real Error subclass
  // and to nothing else — a plain function or object with the same name shape keeps its flag.
  const isErrorClass = (/** @type {unknown} */ value) =>
    typeof value === "function" && Object.prototype.isPrototypeOf.call(Error, value);
  class ConfigurationSomething extends Error {}
  assert.ok(isErrorClass(ConfigurationSomething), "a real Error subclass is exempt");
  assert.ok(!isErrorClass(function configureLocale() {}), "a plain function is not");
  assert.ok(!isErrorClass({ name: "configureLocale" }), "an object is not");
  assert.ok(!isErrorClass(class NotAnError {}), "a class that does not extend Error is not");
  assert.match("ConfigurationError", MUTATOR_SHAPED,
    "the regex still matches it; the exemption is what clears it, and that distinction is the point");
});

test("no published subpath exports a locale setter, and every exported object is frozen", async () => {
  // A STALENESS TRIPWIRE, and it claims exactly that: "no setter-shaped exported NAME, and no mutable
  // exported object". It is NOT a proof that no process-global exists — a probe can only check the
  // globals it thinks to name, and the unbounded form of that claim is a source-reading claim, which
  // is the substitution this whole exercise exists to avoid.
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const subpaths = Object.keys(pkg.exports).filter((subpath) => subpath !== "./package.json");
  assert.equal(subpaths.length, 9, "plan 3.1's nine entry points; a tenth must be swept too");

  /** @type {string[]} */
  const flagged = [];
  /** @type {string[]} */
  const mutable = [];
  let swept = 0;

  for (const subpath of subpaths) {
    const namespace = await import(new URL(pkg.exports[subpath].import, new URL("../", import.meta.url)).href);
    for (const [name, value] of Object.entries(namespace)) {
      ++swept;
      // AN ERROR CLASS IS NOT A DOOR ONTO SHARED STATE, and `ConfigurationError` — which plan
      // 3.5:1100 declares and S34 delivered — starts with "Config" and so trips a prefix heuristic
      // that is about SETTERS. The exemption is by VALUE rather than by widening the regex, because
      // the regex is negative-tested above and loosening it would retire real coverage: a function
      // named `configureLocale` is still flagged, and so is any non-Error value whatever its name.
      // `Object.prototype.isPrototypeOf.call(Error, value)` is true only for a class that actually
      // extends Error, so a plain function called `ConfigurationSomething` gets no exemption.
      const isErrorClass = typeof value === "function" && Object.prototype.isPrototypeOf.call(Error, value);
      if (MUTATOR_SHAPED.test(name) && !isErrorClass) flagged.push(`${subpath}:${name}`);
      // A mutable exported object is as good a door onto shared state as a setter is, and it carries
      // no setter-shaped name at all.
      if (typeof value === "object" && value !== null && !Object.isFrozen(value))
        mutable.push(`${subpath}:${name}`);
    }
  }

  // The instrument first: a sweep that enumerated nothing would report an empty `flagged` too.
  assert.ok(swept > 60, `the sweep saw only ${swept} exports, which cannot be the whole surface`);
  assert.deepEqual(flagged, []);
  assert.deepEqual(mutable, []);
});

/* ------------------------------------------------------------------------------------------------
 * 72.e — nothing ambient is captured or subscribed to at import. Plan 6.5:2346-2348.
 * ---------------------------------------------------------------------------------------------- */

test("importing the library registers no listener, and constructing an instance registers none", () => {
  // (0) THE INSTRUMENT, asserted before anything that depends on it: an `addEventListener` that was
  // never installed would make every assertion below trivially true.
  assert.equal(typeof globalThis.addEventListener, "function");
  assert.equal(/** @type {any} */ (globalThis).window, globalThis, "a window-guarded registration must be recorded");

  // (1) Captured immediately after the library graph evaluated — plan 6.5:2347 forbids installing a
  // `languagechange` listener by name, and `package.json`'s `"sideEffects": false` makes a top-level
  // registration a packaging lie as well.
  assert.deepEqual(REGISTRATIONS_AFTER_IMPORT, []);

  createStrings({ localeResolver: () => "fr", fallbackLocale: "en", strings: localeCatalogs() });

  // (2) And construction adds none either.
  assert.deepEqual(registrations, []);
});

test("mutating navigator.languages does not change what an existing instance answers", () => {
  setNavigatorLanguages(["de-DE", "de"]);
  // (0) again: read the stub back by name. Plain assignment to `globalThis.navigator` silently
  // no-ops in modern Node, and a stub that never installed is the single likeliest way this row
  // reports a false pass.
  assert.deepEqual([.../** @type {any} */ (globalThis).navigator.languages], ["de-DE", "de"]);

  const strings = createStrings({ localeResolver: () => "fr", fallbackLocale: "en", strings: localeCatalogs() });
  const before = strings.get("K");
  assert.equal(before, FR_TEXT);

  setNavigatorLanguages(["it-IT", "it"]);
  // The dispatch is deliberate: without it a registered listener would never fire and the
  // behavioural half of this row would be green over a library that HAD subscribed. With it, the
  // registration assertion and the behaviour assertion are independently red under that defect.
  dispatchGlobalEvent("languagechange");

  assert.equal(strings.get("K"), before, "the instance followed an ambient locale change");
  assert.deepEqual(registrations, []);
});

test("the browser chooser reads navigator.languages ONLY WHEN CALLED, and reads it LIVE", () => {
  // CONTROL A — the stub is actually consulted. Without this, "the instance did not change" is true
  // for the trivial reason that nothing read anything, and an ablation that installed a listener
  // would report zero red while looking exactly like a clean bill of health.
  setNavigatorLanguages(["de-DE", "de"]);
  const strings = createStrings({
    locale: "en", fallbackLocale: "en",
    strings: { ...localeCatalogs(), it: [{ key: "K", translation: "IT_TEXT" }] },
  });
  const configuration = strings.getLocaleConfiguration();
  assert.equal(chooseBrowserLocale(configuration), "de");

  // CONTROL B — the read is LIVE, not a module-scope snapshot taken at import. Every assertion in
  // the row above is satisfied by `const PREFERRED = navigator.languages` hoisted to module scope:
  // the instance genuinely does not change, because the captured global is in the CHOOSER. This is
  // the assertion that separates the two.
  setNavigatorLanguages(["it-IT", "it"]);
  assert.equal(chooseBrowserLocale(configuration), "it");

  // CONTROL C — the pure helper is the thing under test, with no navigator involved at all.
  assert.equal(chooseLocaleForPreferredLanguages(configuration, ["it"]), "it");
  assert.equal(chooseLocaleForPreferredLanguages(configuration, ["de"]), "de");
});

test("calling every locale-adjacent root export leaves a live instance byte-identical", () => {
  // The measurable half of "no exported API mutates shared locale state". What this supports is "no
  // exported call was OBSERVED to perturb a live instance" — the unbounded form is not probeable.
  setNavigatorLanguages(["de-DE", "de"]);
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: localeCatalogs() });
  const before = strings.get("K");
  const lookupBefore = strings.getResult("K").lookupLocale;
  const configuration = strings.getLocaleConfiguration();

  chooseBrowserLocale(configuration);
  chooseLocaleForPreferredLanguages(configuration, ["it"]);
  forLocale("it");
  setNavigatorLanguages(["it-IT", "it"]);
  chooseBrowserLocale(configuration);

  assert.equal(strings.get("K"), before);
  assert.equal(strings.getResult("K").lookupLocale, lookupBefore);
  assert.equal(lookupBefore, "fr");
});

test("the package still declares no side effects", async () => {
  // Cited as load-bearing by the row above — a package asserting `"sideEffects": false` may not
  // register a global listener at module top level — so it is checked here rather than quoted.
  // `test/package-shape.test.js` asserts the same field for its own reasons; this is the twin.
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.sideEffects, false);
});

/* ------------------------------------------------------------------------------------------------
 * 72.f — an instance is immutable and holds a SNAPSHOT. Plan 3.2:609 ("snapshots and canonicalizes
 * inputs"), 3.3:761-763, 4.3:1538-1541, and plan 3:345-346 for the bound accessors.
 * ---------------------------------------------------------------------------------------------- */

/** A deliberately MUTABLE fixture: plain arrays inside a plain object, nothing frozen. */
const mutableCatalogs = () => ({
  fr: [{ key: "K", translation: FR_TEXT }],
  de: [{ key: "K", translation: DE_TEXT }],
  en: [{ key: "K", translation: EN_TEXT }],
});

test("mutating the caller's catalog container after construction changes nothing the instance answers", () => {
  const catalogs = /** @type {any} */ (mutableCatalogs());
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: catalogs });

  // The instance reads THAT catalog at all, before anything is mutated.
  const v0 = strings.get("K");
  const supported0 = strings.getSupportedLocales();
  assert.equal(v0, FR_TEXT);
  assert.deepEqual(supported0, ["de", "en", "fr"]);

  // FOUR MUTATION KINDS, because they discriminate different depths of copy. A shallow top-level
  // spread copies the tag keys, so `catalogs.it = …` and `delete catalogs.de` do NOT reach it while
  // the NESTED edit to `catalogs.fr[0].translation` does — the two kinds catch opposite halves and
  // neither alone is enough.
  //
  // WHAT THIS ROW IS, precisely: a REGRESSION GATE. `createStrings` builds its whole model before
  // returning, so no single-site edit in this implementation can make these leak — measured. The
  // implementation it gates is a future one that reads `options.strings` at lookup time, which is
  // exactly what plan 3.2:609's "snapshots … inputs" forbids. The ablation-verified half of this
  // section is the tiebreaker list and the returned supported-locale array, two rows down.
  catalogs.fr[0].translation = "TAMPERED";
  catalogs.fr.push({ key: "K2", translation: "ADDED" });
  catalogs.it = [{ key: "K", translation: "IT_TEXT" }];
  delete catalogs.de;

  assert.equal(strings.get("K"), v0);
  assert.deepEqual(strings.getSupportedLocales(), supported0, "a locale appeared or vanished after construction");
  assert.equal(strings.get("K", undefined, forLocale("de")), DE_TEXT, "the deleted catalog is still served");
  assert.equal(strings.get("K2"), "K2", "the added key leaked in; the default handler returns the key");

  // **CONTROL A — the load-bearing one.** A fresh instance built from the MUTATED source must see
  // every mutation. Without it, "unchanged" is equally explained by a mutation that missed its
  // target — wrong nesting, wrong key, a frozen literal — and this row would certify a snapshot that
  // does not exist. A red control means the FIXTURE broke, not the library.
  const after = createStrings({ locale: "fr", fallbackLocale: "en", strings: catalogs });
  assert.equal(after.get("K"), "TAMPERED");
  assert.equal(after.get("K2"), "ADDED");
  assert.deepEqual(after.getSupportedLocales(), ["en", "fr", "it"]);
});

test("the Map catalog door snapshots too — the seam this project has already shipped a defect on", () => {
  // Both doors are run because a copy path written for records and extended to `Map` by a truthiness
  // check is the exact seam that shipped here before: a `ReadonlyMap` of tiebreakers passed an object
  // test, met `Object.entries`, and was silently answered `[]`.
  const catalogs = new Map(Object.entries(mutableCatalogs()));
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: /** @type {any} */ (catalogs) });
  assert.equal(strings.get("K"), FR_TEXT, "the Map door must be functional, or the row is passing on a refusal");

  catalogs.set("fr", [{ key: "K", translation: "TAMPERED" }]);
  catalogs.set("it", [{ key: "K", translation: "IT_TEXT" }]);
  catalogs.delete("de");

  assert.equal(strings.get("K"), FR_TEXT);
  assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr"]);
  assert.equal(strings.get("K", undefined, forLocale("de")), DE_TEXT);

  const after = createStrings({ locale: "fr", fallbackLocale: "en", strings: /** @type {any} */ (catalogs) });
  assert.equal(after.get("K"), "TAMPERED", "the Map mutations must land, or 'unchanged' proves nothing");
  assert.deepEqual(after.getSupportedLocales(), ["en", "fr", "it"]);
});

test("the RAW-TEXT catalog door: only the container mutations can carry this row, and they do", () => {
  // Recorded honestly rather than run silently: a `string` catalog is IMMUTABLE, so "the translation
  // text cannot be edited afterwards" is true of a copying build AND of an aliasing one, and an
  // assertion about it here would be inert — the probe-valid-in-the-way-that-defeats-the-test shape.
  // What still carries the row on this door is the CONTAINER: adding and deleting a tag.
  const catalogs = /** @type {any} */ ({
    fr: JSON.stringify({ K: FR_TEXT }),
    de: JSON.stringify({ K: DE_TEXT }),
    en: JSON.stringify({ K: EN_TEXT }),
  });
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: catalogs });
  assert.equal(strings.get("K"), FR_TEXT, "the text door must be functional, or the row proves nothing");

  catalogs.it = JSON.stringify({ K: "IT_TEXT" });
  delete catalogs.de;

  assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr"]);
  assert.equal(strings.get("K", undefined, forLocale("de")), DE_TEXT);

  // Control A again: a fresh instance from the mutated source sees both changes.
  const after = createStrings({ locale: "fr", fallbackLocale: "en", strings: catalogs });
  assert.deepEqual(after.getSupportedLocales(), ["en", "fr", "it"]);
});

test("tiebreakers are snapshotted at construction, container AND list", () => {
  // The `.d.ts` says "snapshotted and frozen at construction"; this is the measurement. The fixture
  // is chosen so the ORDER is observable end to end — `en-GB` first answers "GB", `en-US` first
  // answers "US" — because a snapshot test over an input whose mutation changes no output would be
  // green under an aliasing build too.
  const order = ["en-GB", "en-US"];
  const tiebreakers = new Map([["en", order]]);
  const strings = createStrings({
    locale: "en", fallbackLocale: "en-US",
    strings: { "en-US": [{ key: "K", translation: "US" }], "en-GB": [{ key: "K", translation: "GB" }] },
    tiebreakers: /** @type {any} */ (tiebreakers),
  });

  assert.equal(strings.get("K"), "GB", "the tiebreaker order must be observable, or the row probes nothing");

  // The CONTROL that the order is what decides it: the reversed order gives the other catalog.
  const reversed = createStrings({
    locale: "en", fallbackLocale: "en-US",
    strings: { "en-US": [{ key: "K", translation: "US" }], "en-GB": [{ key: "K", translation: "GB" }] },
    tiebreakers: { en: ["en-US", "en-GB"] },
  });
  assert.equal(reversed.get("K"), "US");

  // Now mutate BOTH levels of the caller's structure: the Map entry, and the array inside it.
  tiebreakers.set("en", ["en-US", "en-GB"]);
  order.reverse();

  assert.equal(strings.get("K"), "GB", "a post-construction tiebreaker edit changed resolution");
  assert.deepEqual({ ...strings.getLocaleConfiguration().tiebreakers }, { en: ["en-GB", "en-US"] });
});

test("returned records and arrays are frozen, null-prototype where the plan says so", () => {
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: mutableCatalogs() });

  const supported = strings.getSupportedLocales();
  assert.equal(Object.isFrozen(supported), true);
  assert.throws(() => /** @type {any} */ (supported).push("zz"), TypeError);
  // And the next call is unaffected — a returned array that was the internal one would have grown.
  assert.deepEqual(strings.getSupportedLocales(), ["de", "en", "fr"]);

  const configuration = strings.getLocaleConfiguration();
  assert.equal(Object.isFrozen(configuration), true);
  assert.equal(Object.isFrozen(configuration.supportedLocales), true);
  assert.equal(Object.isFrozen(configuration.tiebreakers), true);
  // Plan 4.3:1536-1538: a keyed record whose property names originate in catalogs or locales is a
  // NULL-PROTOTYPE record. A frozen ordinary object would pass the freeze assertion and still carry
  // an inherited `constructor`, which is a different value from the one specified.
  assert.equal(Object.getPrototypeOf(configuration.tiebreakers), null);

  const result = strings.getResult("K");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.attemptedLocales), true);
});

test("get and t are the same bound function, and survive being destructured off the instance", () => {
  // Plan 3:345-346 — "`get`, `t`, `getResult`, and `getDirectLocaleContext` are bound, referentially
  // stable functions; `strings.t === strings.get`." This is the property an atomic-reference-
  // replacement server actually depends on: `const { t } = current` held across a swap of `current`
  // must keep answering from the instance it came from, which is exactly the lifecycle clause.
  const strings = createStrings({ locale: "fr", fallbackLocale: "en", strings: localeCatalogs() });
  assert.equal(strings.t, strings.get);
  assert.equal(strings.get, strings.get, "the accessor must be referentially stable across reads");
  assert.equal(strings.getResult, strings.getResult);

  const { get, t } = strings;
  assert.equal(get("K"), FR_TEXT);
  assert.equal(t("K"), FR_TEXT);

  // A second instance's detached `t` still answers from ITS instance after the first has been read —
  // the reference-swap shape, one call deep.
  const other = createStrings({ locale: "de", fallbackLocale: "en", strings: localeCatalogs() });
  const otherT = other.t;
  assert.equal(otherT("K"), DE_TEXT);
  assert.equal(t("K"), FR_TEXT);

  // RECORDED, NOT ARGUED: the instance is frozen at runtime today. Plan 3:345 freezes returned
  // records, arrays and configuration objects and says nothing about the instance itself, and the
  // `.d.ts`'s `Readonly<{…}>` is erased at runtime — so whether a runtime freeze is REQUIRED is an
  // open question for the maintainer rather than something this clause may gate on. It is asserted
  // here because it is the port's measured behaviour and a silent loss of it would be worth hearing
  // about; if the maintainer rules it optional, this line is the one to delete.
  assert.equal(Object.isFrozen(strings), true);
});
