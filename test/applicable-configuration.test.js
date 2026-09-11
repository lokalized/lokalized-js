// @ts-check
/**
 * The applicable configuration, and lookup coverage checked at every use — plan 3.4, clause 49.
 *
 * **THE CORPUS IS STRUCTURALLY BLIND TO EVERYTHING IN THIS FILE, and that is the reason it exists.**
 * All 2,112 corpus cases and all nine Java differentials construct DIRECTLY: Java has no manifest, no
 * `LoadedStrings`, no coverage record. For direct construction the applicable configuration IS the
 * loaded set and both changes below are no-ops — so those gates staying green is not evidence about
 * them, and this file is their whole enforcement. That is the project's floor-not-proof lesson in its
 * purest M8 form.
 *
 * **THE FIXTURES WERE DESIGNED BY AGENTS FORBIDDEN FROM READING `src/`**, before the implementation
 * existed, and adversarially re-judged against the plan. One of their findings changed the design:
 * `getLocaleConfiguration()` returns the FULL manifest for a manifest-backed instance (plan
 * :764-769) while `getSupportedLocales()` stays the loaded set — the opposite of what I was about to
 * write.
 *
 * TWO PROPOSITIONS, kept apart because they are separately falsifiable:
 *   (A) the SELECTION channel widens to the full manifest; the RESOLUTION channel does not
 *   (B) for lookup-subset coverage, the tag that STARTS per-key fallback must equal the coverage
 *       record — the request, never the diagnostic selection
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createStrings, forLocale, forLocaleMatch } from "../src/core/index.js";
import { parseStrings } from "../src/parse/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";

const catalogFor = (/** @type {string} */ tag) =>
  parseStrings(JSON.stringify({ Hi: `hello ${tag}` }), { locale: tag });

const en = catalogFor("en");
const fr = catalogFor("fr");
const frFR = catalogFor("fr-FR");

/**
 * A `LoadedStrings` over a declared manifest, with only some of it actually loaded.
 * @param {{ declared: string[], catalogs: Record<string, any>, coverage: any, plan: string[],
 *   complete?: boolean, tiebreakers?: any }} shape
 */
function loaded(shape) {
  const pinned = pinnedProvenance();
  const complete = shape.complete ?? true;
  return /** @type {any} */ ({
    catalogs: shape.catalogs,
    tiebreakers: shape.tiebreakers ?? {},
    fallbackLocale: "en",
    manifestLocaleConfiguration: {
      fallbackLocale: "en",
      supportedLocales: [...shape.declared].sort(),
      tiebreakers: shape.tiebreakers ?? {},
    },
    catalogIdentity: { catalogVersion: "v1", catalogFingerprint: "a".repeat(64) },
    cldrVersion: pinned.cldrVersion,
    dataFingerprint: pinned.dataFingerprint,
    loadingLimits: {},
    coverage: shape.coverage,
    requestedFiles: shape.plan.map((locale) => ({ locale })),
    failures: complete ? [] : [{ locale: "de", url: "x", stage: "fetch", cause: null }],
    warnings: [],
    complete,
  });
}

/** A partial WHOLE-MANIFEST load: declares {de, en, fr}, holds {en, fr}. */
const partialWhole = () => loaded({
  declared: ["de", "en", "fr"],
  catalogs: { en, fr },
  coverage: { kind: "entire-manifest" },
  plan: ["de", "en", "fr"],
  complete: false,
});

/** A LOOKUP SUBSET planned from `fr-BE` over a manifest declaring {en, fr-FR}. */
const frBeSubset = () => loaded({
  declared: ["en", "fr-FR"],
  catalogs: { en, "fr-FR": frFR },
  coverage: { kind: "lookup", lookupLocale: "fr-BE" },
  plan: ["fr-FR", "en"],
});

// ============================================================ (A) the selection channel widens

test("the automatic diagnostic is computed over the FULL manifest, including a failed catalog", () => {
  // The control is a DIRECT instance holding all three catalogs, whose diagnostic is gated by the
  // corpus today. Pinning against it rather than against a hand-written expectation is what makes
  // this a comparison instead of a transcription.
  const partial = createStrings({ loaded: partialWhole(), locale: "de" });
  const control = createStrings({
    strings: { de: catalogFor("de"), en, fr }, fallbackLocale: "en", locale: "de",
  });

  const sameFields = (/** @type {any} */ a, /** @type {any} */ b) => {
    for (const field of ["locale", "matchType", "isMatch", "fallbackLocale", "effectiveWeight"])
      assert.deepEqual(a[field], b[field], field);
    assert.deepEqual(a.consideredLocales, b.consideredLocales);
    assert.deepEqual(a.requestedLanguageRanges, b.requestedLanguageRanges);
  };

  // THREE DOORS, because plan :864 lets the constant instance locale CACHE its diagnostic — an
  // implementation that widened only the recompute paths is right at two of them and stale at the
  // third, and a fixture probing one door cannot tell.
  const viaContext = /** @type {any} */ (partial.getDirectLocaleContext("de")).localeMatch;
  const viaConstant = /** @type {any} */ (partial.getResult("Hi")).localeMatch;
  const viaPerCall = /** @type {any} */ (partial.getResult("Hi", undefined, forLocale("de"))).localeMatch;
  const expected = /** @type {any} */ (control.getDirectLocaleContext("de")).localeMatch;

  for (const [name, actual] of [["context", viaContext], ["constant", viaConstant], ["per-call", viaPerCall]]) {
    sameFields(actual, expected);
    assert.ok(/** @type {any} */ (actual).consideredLocales.includes("de"),
      `${name}: the declared-but-unloaded catalog must be CONSIDERED`);
  }
  assert.equal(/** @type {any} */ (viaContext).locale, "de", "it may even be SELECTED");
});

test("a declared-but-unloaded selection never supplies a value", () => {
  // `de` is selected diagnostically and has no catalog, so per-key fallback starts at `de`, finds
  // nothing, and falls through to `en` — a catalog-less attempt (plan :622-623).
  const partial = createStrings({ loaded: partialWhole(), locale: "de" });
  const result = /** @type {any} */ (partial.getResult("Hi"));
  assert.equal(result.lookupLocale, "de");
  assert.equal(result.resolvedLocale, "en", "the answering catalog is the fallback, not the selection");
  assert.equal(result.translation, "hello en");
  assert.ok(result.attemptedLocales.includes("de"));
  assert.equal(result.isFallback, true);
});

test("the RESOLUTION channel does not widen — measured through the tiebreakers, not the set", () => {
  // **THE FIRST DRAFT OF THIS TEST WAS VACUOUS, and it is worth recording why.** It asserted the walk
  // over a partial whole-manifest load and passed identically whether the chain was computed from the
  // loaded set or the full manifest — because `candidateChain` already includes the requested tag and
  // its ancestors whether or not a catalog exists, so WIDENING THE SET CHANGES NOTHING. Measured:
  // `de`, `de-AT`, `fr-CH` and `ja` all produce byte-identical chains over ["en","fr"] and over
  // ["de","en","fr"]. Ablating the walk to the full manifest left all 13 tests green.
  //
  // TIEBREAKERS are what actually differ. Plan 6.2:2102-2105 has a loader validate them against the
  // full manifest and then FILTER them to successfully loaded tags, so the manifest's list and the
  // runtime list are genuinely different objects — and step 3 of the candidate walk reads one of
  // them. Here the manifest orders `fr` as [fr-CA, fr] while `fr-CA` failed to load, so a walk using
  // the manifest's list attempts a catalog nothing could ever serve.
  // **AND THE KEY MUST BE ABSENT FROM THE FIRST CATALOG.** The second draft of this test still did
  // not discriminate: `fr` answered immediately, so the walk short-circuited and never reached the
  // extra candidate whether or not it was in the chain. Reaching a branch is not discriminating it —
  // the same lesson, in the fixture written to check it. `Only` lives in `en` alone, so the walk has
  // to traverse the whole chain and `attemptedLocales` records what it traversed.
  const manifestOrders = { fr: ["fr-CA", "fr"] };
  const enOnly = parseStrings(JSON.stringify({ Hi: "hello en", Only: "only en" }), { locale: "en" });
  const instance = createStrings({
    loaded: {
      ...loaded({
        declared: ["en", "fr", "fr-CA"],
        catalogs: { en: enOnly, fr },
        coverage: { kind: "entire-manifest" },
        plan: ["en", "fr", "fr-CA"],
        complete: false,
      }),
      // The RUNTIME tiebreakers, filtered to what loaded — what a real loader hands over.
      tiebreakers: { fr: ["fr"] },
      manifestLocaleConfiguration: {
        fallbackLocale: "en",
        supportedLocales: ["en", "fr", "fr-CA"],
        tiebreakers: manifestOrders,
      },
    },
    locale: "fr",
  });

  const result = /** @type {any} */ (instance.getResult("Only"));
  assert.deepEqual(result.attemptedLocales, ["fr", "en"],
    "the walk uses the FILTERED runtime tiebreakers; `fr-CA` never loaded and must not be attempted");
  assert.equal(result.translation, "only en");

  // …while the SELECTION channel does read the manifest's orders, which is the paired half: the two
  // channels are looking at different tiebreaker lists in the same call.
  // Spread to compare by CONTENT: the configuration's record is null-prototype, which `deepEqual`
  // reports as a difference even when every entry matches.
  assert.deepEqual({ ...instance.getLocaleConfiguration().tiebreakers }, manifestOrders);
});

test("the inspection surfaces do NOT widen", () => {
  const partial = createStrings({ loaded: partialWhole(), locale: "de" });

  // `getSupportedLocales()` is the LOADED set, and S10's stamp depends on that — it requires
  // `coveredLocales` to EQUAL it. Widening this is one edit away and no Java gate could see it.
  assert.deepEqual(partial.getSupportedLocales(), ["en", "fr"]);
  // …while `getLocaleConfiguration()` is the FULL manifest, per plan :764-769's deliberate split,
  // so an external negotiator sees the set the subset was planned from.
  assert.deepEqual(partial.getLocaleConfiguration().supportedLocales, ["de", "en", "fr"]);

  // Key inspection stays exact-loaded-only: a declared-but-unloaded tag is still UNSUPPORTED.
  assert.throws(() => partial.getKeysForLocale("de"), (error) => {
    assert.equal(/** @type {any} */ (error).name, "UnsupportedLocaleError");
    return true;
  });
  assert.deepEqual(partial.getKeysForLocale("en"), ["Hi"]);
});

test("a request in NEITHER set still resolves, and still considers the full manifest", () => {
  // The fixture that catches `consideredLocales = loadedSet ∪ {requested tag if declared}` — a
  // request-keyed patch that passes both tests above and fails only here.
  const partial = createStrings({ loaded: partialWhole(), locale: "de" });
  const match = /** @type {any} */ (partial.getDirectLocaleContext("ja")).localeMatch;
  assert.deepEqual(match.consideredLocales, ["de", "en", "fr"]);
  assert.equal(match.locale, null);
  assert.equal(match.matchType, "none");
});

// ============================================================ (B) coverage, at every use

test("a direct request EQUAL to the coverage tag is served, though the diagnostic selects another", () => {
  // **THE DISCRIMINATING INPUT OF THE WHOLE CLAUSE.** `fr-BE` is the tag the subset was planned from;
  // its automatic diagnostic selects `fr-FR`. The two readings of the rule — "the request must match"
  // and "the selection must match" — give OPPOSITE answers on this one call.
  const client = createStrings({ loaded: frBeSubset(), locale: "fr-BE" });
  const result = /** @type {any} */ (client.getResult("Hi"));

  assert.equal(result.lookupLocale, "fr-BE");
  assert.equal(result.localeMatch.locale, "fr-FR", "the diagnostic legitimately differs");
  assert.equal(result.attemptedLocales[0], "fr-BE", "per-key fallback STARTED at the request");
  assert.equal(result.resolvedLocale, "fr-FR");
  assert.equal(result.translation, "hello fr-FR");
});

test("a direct request for the DIAGNOSTIC SELECTION is refused, though every catalog is present", () => {
  // `fr-FR` is loaded, and serving it would work. It is refused because this instance was never
  // PLANNED from `fr-FR` — its next `fr-FR` load would plan a different chain. An implementation that
  // checked "are the catalogs present" instead of "what was this planned from" passes the test above
  // and fails here.
  const client = createStrings({ loaded: frBeSubset(), locale: "fr-BE" });
  const error = (() => { try { client.get("Hi", undefined, forLocale("fr-FR")); } catch (e) { return e; } })();
  assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError");
  assert.equal(/** @type {any} */ (error).code, "CONFIGURATION");
  assert.match(/** @type {any} */ (error).message, /loaded for lookup 'fr-BE' only/);

  // It THROWS rather than degrading into a missing-translation failure: a coverage violation is a
  // configuration mistake, not a resolution outcome, and routing it through the failure channel
  // would fire the handler on a call that never walked.
  assert.throws(() => client.getResult("Hi", undefined, forLocale("en")), /loaded for lookup/);
});

test("getDirectLocaleContext does NOT throw on an uncovered tag", () => {
  // It starts no per-key fallback and is documented side-effect-free, so plan :619-621's "effective
  // lookup tag" never passes through it — and S10's stamp consumes it as its oracle, so a throw here
  // would change the SSR path for exactly the lookup-subset instances SSR exists for.
  const client = createStrings({ loaded: frBeSubset(), locale: "fr-BE" });
  assert.doesNotThrow(() => client.getDirectLocaleContext("fr-FR"));
  assert.doesNotThrow(() => client.getDirectLocaleContext("ja"));
});

test("a supplied match derives the covered tag from its SELECTION, or its fallback when unmatched", () => {
  const subset = () => loaded({
    declared: ["en", "fr-FR"],
    catalogs: { en, "fr-FR": frFR },
    coverage: { kind: "lookup", lookupLocale: "fr-FR" },
    plan: ["fr-FR", "en"],
  });
  const client = createStrings({ loaded: subset(), locale: "fr-FR" });
  const considered = ["en", "fr-FR"];

  // MATCHED: the lookup locale is the selected tag, which is the coverage tag → accepted.
  const matched = {
    matchType: "exact", locale: "fr-FR", isMatch: true, fallbackLocale: "en",
    consideredLocales: considered, effectiveWeight: 1,
    languageRange: { range: "fr-fr", weight: 1 }, requestedLanguageRanges: [{ range: "fr-fr", weight: 1 }],
  };
  assert.equal(client.get("Hi", undefined, forLocaleMatch(/** @type {any} */ (matched))), "hello fr-FR");

  // UNMATCHED: the lookup locale is the resolved fallback `en`, which is NOT the coverage tag
  // `fr-FR` → refused. The derivation is the whole subject: the same instance accepts one and
  // refuses the other purely on where the lookup tag comes from.
  const unmatched = {
    matchType: "none", locale: null, isMatch: false, fallbackLocale: "en",
    consideredLocales: considered, effectiveWeight: null,
    languageRange: null, requestedLanguageRanges: [{ range: "de", weight: 1 }],
  };
  assert.throws(() => client.get("Hi", undefined, forLocaleMatch(/** @type {any} */ (unmatched))),
    /loaded for lookup 'fr-FR' only, and this lookup starts from 'en'/);
});

test("WHOLE-MANIFEST coverage permits any well-formed direct locale — regression guard", () => {
  // Keying the check on "has a verification record" rather than on the coverage KIND is the cheapest
  // possible regression: it would turn every whole-manifest instance red at once.
  const whole = createStrings({ loaded: partialWhole(), locale: "de" });
  for (const locale of ["de", "en", "fr", "ja", "de-CH"])
    assert.doesNotThrow(() => whole.get("Hi", undefined, forLocale(locale)), locale);
});

test("coverage is revalidated on EVERY use, and a refusal does not poison the instance", () => {
  // A check run once at construction would gate the first answer and trust every later one — and a
  // resolver may answer differently on each call.
  const client = createStrings({ loaded: frBeSubset(), locale: "fr-BE" });
  const first = client.get("Hi");
  assert.throws(() => client.get("Hi", undefined, forLocale("en")), /loaded for lookup/);
  assert.equal(client.get("Hi"), first, "the instance still serves its covered tag afterwards");

  // And through a RESOLVER, which is the ingress that can change its answer between calls.
  let answer = "fr-BE";
  let calls = 0;
  const resolved = createStrings({
    loaded: frBeSubset(), localeResolver: () => { ++calls; return answer; },
  });
  assert.equal(resolved.get("Hi"), "hello fr-FR");
  answer = "en";
  assert.throws(() => resolved.get("Hi"), /loaded for lookup/);
  answer = "fr-BE";
  assert.equal(resolved.get("Hi"), "hello fr-FR");
  assert.equal(calls, 3, "the resolver is consulted on every call, not memoized past the check");
});

// ============================================================ supplied-match revalidation

test("a supplied match must consider the FULL manifest — and a DIRECT instance the loaded set", () => {
  // The diagonal is the fixture. The same two match objects, against two instances holding the same
  // catalogs, must be accepted and refused in opposite directions.
  const manifestBacked = createStrings({ loaded: partialWhole(), locale: "de" });
  const direct = createStrings({ strings: { en, fr }, fallbackLocale: "en", locale: "en" });

  const matchOver = (/** @type {string[]} */ consideredLocales) => /** @type {any} */ ({
    matchType: "exact", locale: "en", isMatch: true, fallbackLocale: "en",
    consideredLocales, effectiveWeight: 1,
    languageRange: { range: "en", weight: 1 }, requestedLanguageRanges: [{ range: "en", weight: 1 }],
  });

  assert.equal(manifestBacked.get("Hi", undefined, forLocaleMatch(matchOver(["de", "en", "fr"]))), "hello en");
  assert.throws(() => manifestBacked.get("Hi", undefined, forLocaleMatch(matchOver(["en", "fr"]))),
    /different supported locales/, "the loaded set is NOT the applicable configuration here");

  assert.equal(direct.get("Hi", undefined, forLocaleMatch(matchOver(["en", "fr"]))), "hello en");
  assert.throws(() => direct.get("Hi", undefined, forLocaleMatch(matchOver(["de", "en", "fr"]))),
    /different supported locales/, "direct construction is unmoved by the widening");
});

test("caller ordering of consideredLocales is preserved, because it is a SET comparison", () => {
  const manifestBacked = createStrings({ loaded: partialWhole(), locale: "de" });
  const shuffled = /** @type {any} */ ({
    matchType: "exact", locale: "en", isMatch: true, fallbackLocale: "en",
    consideredLocales: ["fr", "de", "en"], effectiveWeight: 1,
    languageRange: { range: "en", weight: 1 }, requestedLanguageRanges: [{ range: "en", weight: 1 }],
  });
  const result = /** @type {any} */ (manifestBacked.getResult("Hi", undefined, forLocaleMatch(shuffled)));
  assert.deepEqual(result.localeMatch.consideredLocales, ["fr", "de", "en"], "verbatim, not re-sorted");
});

// ============================================================ direct construction unmoved

test("direct construction sees neither change", () => {
  const direct = createStrings({ strings: { en, fr }, fallbackLocale: "en", locale: "fr" });
  assert.equal(direct.getLoadVerification(), null);
  assert.deepEqual(direct.getLocaleConfiguration().supportedLocales, direct.getSupportedLocales());
  assert.deepEqual(
    /** @type {any} */ (direct.getDirectLocaleContext("fr")).localeMatch.consideredLocales,
    ["en", "fr"]);
  // No coverage record exists, so no well-formed tag can ever be refused for coverage.
  for (const locale of ["fr", "en", "xq-QQ", "de-CH"])
    assert.doesNotThrow(() => direct.get("Hi", undefined, forLocale(locale)), locale);
});
