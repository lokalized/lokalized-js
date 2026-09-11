// @ts-check
/**
 * `createSsrStamp` / `validateSsrStamp` — plan section 6.4.
 *
 * **THE ORACLE PROBLEM, STATED FIRST.** Java has no SSR concept, no manifest and no stamp, and the
 * corpus says so in its own words (`cases/resolver-locale.cases.json:20`). So nothing below is
 * evidence that the stamp is RIGHT in the sense the rest of this project means it — it is evidence
 * that the implementation does what plan 6.4 says, and the plan is the only oracle this subpath has.
 * Where a test leans on another part of the port as an oracle (clause 45 consumes M7's
 * `getDirectLocaleContext`), it says so at the assertion rather than letting a green result look like
 * external corroboration.
 *
 * **WHY SO MANY FIXTURES ARE DOCTORED OBJECTS RATHER THAN REAL INSTANCES.** Plan 3.4:713 requires the
 * verification record to be STRUCTURAL, not branded, so that a `Strings` built by one installed copy
 * stays usable by an `lokalized/ssr` from another. The direct consequence is that a caller can
 * present anything shaped like one — so the adversarial input for most of clause 39 is an instance
 * whose inspection methods disagree with its own record, which a real `createStrings` will never
 * produce and a hand-built object produces trivially.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { parseStrings } from "../src/parse/index.js";
import { createSsrStamp, validateSsrStamp } from "../src/ssr/index.js";
import { decode as pinnedProvenance } from "../src/data/provenance.js";

const en = parseStrings(JSON.stringify({ Hi: "hello" }), { locale: "en" });
const fr = parseStrings(JSON.stringify({ Hi: "bonjour" }), { locale: "fr" });
const frFR = parseStrings(JSON.stringify({ Hi: "bonjour (FR)" }), { locale: "fr-FR" });

const IDENTITY = { catalogVersion: "2026.09.11", catalogFingerprint: "a".repeat(64) };

/** A `LoadedStrings` this core accepts: manifest {en, fr}, loaded for lookup `fr`. */
function loadedStrings(overrides = {}) {
  const pinned = pinnedProvenance();
  return /** @type {any} */ ({
    catalogs: { fr, en },
    tiebreakers: {},
    fallbackLocale: "en",
    manifestLocaleConfiguration: { fallbackLocale: "en", supportedLocales: ["en", "fr"], tiebreakers: {} },
    catalogIdentity: IDENTITY,
    cldrVersion: pinned.cldrVersion,
    dataFingerprint: pinned.dataFingerprint,
    loadingLimits: {},
    coverage: { kind: "lookup", lookupLocale: "fr" },
    requestedFiles: [{ locale: "fr" }, { locale: "en" }],
    failures: [],
    warnings: [],
    complete: true,
    ...overrides,
  });
}

const loadedInstance = (overrides = {}) =>
  createStrings({ loaded: loadedStrings(overrides), locale: "fr" });

/**
 * A `Strings`-shaped object whose inspection answers have been rewritten.
 *
 * The instance's methods are own enumerable arrow properties closing over the real construction, so
 * spreading keeps every behaviour except the ones replaced here.
 */
const doctored = (/** @type {any} */ strings, /** @type {Record<string, any>} */ overrides) =>
  ({ ...strings, ...overrides });

const DIRECT_FR = /** @type {const} */ ({ kind: "locale", locale: "fr" });

// --------------------------------------------------------------- clause 38: eligibility

test("clause 38: a DIRECTLY constructed instance cannot be stamped, identity or not", () => {
  const plain = createStrings({ strings: { en, fr }, fallbackLocale: "en", locale: "fr" });
  assert.equal(plain.getCatalogIdentity(), null);
  assert.throws(() => createSsrStamp(plain, DIRECT_FR), /constructed directly/);

  // **THE ADVERSARIAL INPUT IS A SHAPE-VALID IDENTITY**, which plan 3.4:635 explicitly permits a
  // build pipeline to supply and explicitly does not verify ("core validates its shape, not its
  // truth"). The instance now reports an identity indistinguishable from a loaded one's, and is
  // still ineligible — which is the whole reason plan 6.4 keys on the verification record instead.
  const withIdentity = createStrings({
    strings: { en, fr }, fallbackLocale: "en", locale: "fr", catalogIdentity: IDENTITY,
  });
  assert.deepEqual(withIdentity.getCatalogIdentity(), IDENTITY);
  assert.equal(withIdentity.getLoadVerification(), null);
  assert.throws(() => createSsrStamp(withIdentity, DIRECT_FR), /constructed directly/);

  // The control: the SAME identity on a LOADED instance stamps.
  assert.equal(createSsrStamp(loadedInstance(), DIRECT_FR).catalogVersion, IDENTITY.catalogVersion);
});

test("clause 38: a shape-invalid direct identity is refused at construction", () => {
  assert.throws(
    () => createStrings({
      strings: { en }, fallbackLocale: "en", locale: "en",
      catalogIdentity: /** @type {any} */ ({ catalogVersion: 1 }),
    }),
    /must carry a string catalogVersion and catalogFingerprint/);
});

// --------------------------------------------------------------- clause 39: the six checks

test("clause 39: an INCOMPLETE load is refused, and the partial load itself is legitimate", () => {
  // The pair matters: `complete: false` is a valid loader result that must BUILD, and an invalid
  // thing to stamp. A branch that refused partial loads outright would pass the second assertion
  // while breaking allow-partial loading entirely.
  const partial = loadedStrings({
    catalogs: { en },
    coverage: { kind: "lookup", lookupLocale: "de" },
    manifestLocaleConfiguration: { fallbackLocale: "en", supportedLocales: ["de", "en", "fr"], tiebreakers: {} },
    requestedFiles: [{ locale: "de" }, { locale: "en" }],
    complete: false,
  });
  const instance = createStrings({ loaded: partial, locale: "en" });
  assert.equal(instance.get("Hi"), "hello");
  assert.throws(() => createSsrStamp(instance, { kind: "locale", locale: "en" }), /incomplete/);
});

test("clause 39: each cross-check against the instance is separately falsifiable", () => {
  const real = loadedInstance();
  const record = /** @type {any} */ (real.getLoadVerification());

  /** Every row must refuse, and the control at the end must not. */
  const rows = [
    ["source", { getLoadVerification: () => ({ ...record, source: "trust-me" }) }, /source 'verified-manifest-v1'/],
    ["producer", { getLoadVerification: () => ({ ...record, producerImplementation: "other-js" }) }, /producerImplementation 'lokalized-js'/],
    ["identity", { getCatalogIdentity: () => ({ catalogVersion: "v9", catalogFingerprint: "b".repeat(64) }) }, /not the identity this instance reports/],
    ["completeness", { isCatalogComplete: () => false }, /not the completeness this instance reports/],
    ["fallback", { getLocaleConfiguration: () => ({ ...real.getLocaleConfiguration(), fallbackLocale: "fr" }) }, /resolves a different fallback/],
    ["covered set", { getSupportedLocales: () => ["en", "fr", "de"] }, /while the instance supports/],
    ["planned tag", { getLoadVerification: () => ({ ...record, plannedLocales: ["fr", "en", "de"] }) }, /plans 'de', which the instance does not support/],
  ];
  for (const [what, overrides, expected] of rows)
    assert.throws(() => createSsrStamp(doctored(real, /** @type {any} */ (overrides)), DIRECT_FR),
      /** @type {RegExp} */ (expected), `a doctored ${what} must be refused`);

  // The resolved fallback must be SERVABLE. Reached with a configuration naming a fallback the
  // instance does not load — the one shape the covered-set check above cannot see, because the
  // covered set still equals what the instance supports.
  assert.throws(
    () => createSsrStamp(doctored(real, {
      getLocaleConfiguration: () => ({ ...real.getLocaleConfiguration(), fallbackLocale: "de" }),
      getLoadVerification: () => ({
        ...record,
        manifestLocaleConfiguration: { ...record.manifestLocaleConfiguration, fallbackLocale: "de" },
      }),
    }), DIRECT_FR),
    /is not among its loaded catalogs/);

  // THE CONTROL. Without it every row above would pass on an implementation that refused everything.
  assert.doesNotThrow(() => createSsrStamp(doctored(real, {}), DIRECT_FR));
});

// --------------------------------------------------------------- clause 40: order of operations

test("clause 40: a PERFECT stamp against an INVALID local instance is refused", () => {
  // Separately falsifiable from clause 39 by construction: a correct `createSsrStamp` paired with a
  // `validateSsrStamp` that only compares fields passes every test above and fails this one. The
  // stamp presented here is byte-identical to what the healthy instance produces.
  const real = loadedInstance();
  const stamp = createSsrStamp(real, DIRECT_FR);
  assert.doesNotThrow(() => validateSsrStamp(stamp, real, DIRECT_FR));

  const direct = createStrings({ strings: { en, fr }, fallbackLocale: "en", locale: "fr" });
  assert.throws(() => validateSsrStamp(stamp, direct, DIRECT_FR), /constructed directly/);
  assert.throws(
    () => validateSsrStamp(stamp, doctored(real, { isCatalogComplete: () => false }), DIRECT_FR),
    /not the completeness this instance reports/);
});

// --------------------------------------------------------------- clause 41: coverage kinds

test("clause 41: lookup coverage covers ONLY its own normalized lookup locale", () => {
  const instance = loadedInstance();
  assert.doesNotThrow(() => createSsrStamp(instance, DIRECT_FR));
  assert.throws(() => createSsrStamp(instance, { kind: "locale", locale: "en" }),
    /covers lookup 'fr' only, and the rendering context is 'en'/);

  // Normalized on both sides: the coverage tag was normalized when the load recorded it, and the
  // context tag is normalized by the renderer, so a differently-spelled request still matches.
  assert.doesNotThrow(() => createSsrStamp(instance, { kind: "locale", locale: "FR" }));
});

test("clause 41: entire-manifest coverage covers any valid rendering context", () => {
  const whole = createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  });
  for (const locale of ["fr", "en", "de"])
    assert.doesNotThrow(() => createSsrStamp(whole, { kind: "locale", locale }),
      `entire-manifest must cover a ${locale} context`);
});

// --------------------------------------------------------------- clause 37: privacy

test("clause 37: the serialized stamp leaks nothing but the selected locale and match type", () => {
  // A WHOLE-OBJECT DIFF, not a spot-check: a newly leaked field is exactly what a spot-check misses.
  // The full `LocaleMatchResult` this projection is narrowed from carries all four of the things
  // plan 6.4 forbids — `requestedLanguageRanges`, `effectiveWeight`, `fallbackLocale` and
  // `consideredLocales` — so the assertion is against the WHOLE serialized shape, at every depth.
  const instance = loadedInstance();
  const full = /** @type {any} */ (instance.getDirectLocaleContext("fr")).localeMatch;
  assert.ok("consideredLocales" in full && "requestedLanguageRanges" in full
    && "effectiveWeight" in full && "fallbackLocale" in full,
    "the fixture must actually carry the fields the projection has to drop");

  const serialized = JSON.parse(JSON.stringify(createSsrStamp(instance, DIRECT_FR)));
  assert.deepEqual(Object.keys(serialized).sort(), [
    "behavioralVectorsVersion", "cardinalityMode", "catalogFingerprint", "catalogVersion",
    "cldrVersion", "dataFingerprint", "formatVersion", "ianaDataFingerprint", "ianaRegistryDate",
    "localeDataMode", "localeMatch", "lookupLocale", "producerImplementation", "producerVersion",
  ]);
  assert.deepEqual(Object.keys(serialized.localeMatch).sort(), ["locale", "matchType"]);
});

// --------------------------------------------------------------- clause 43: strict comparison

/** Plan 6.4's own list, transcribed once so the implementation can be measured against it. */
const PLAN_COMPARED_FIELDS = [
  "formatVersion", "catalogVersion", "catalogFingerprint", "cldrVersion", "dataFingerprint",
  "ianaRegistryDate", "ianaDataFingerprint", "behavioralVectorsVersion", "producerImplementation",
  "producerVersion", "localeDataMode", "cardinalityMode", "lookupLocale", "localeMatch.locale",
  "localeMatch.matchType",
];

test("clause 43: EVERY field of the stamp is compared, and they are the plan's fifteen", () => {
  const instance = loadedInstance();
  const stamp = /** @type {any} */ (createSsrStamp(instance, DIRECT_FR));

  // The paths the stamp actually has, derived from the stamp rather than typed out — so a sixteenth
  // field cannot be added without this failing, which is the failure mode a hand-kept list has.
  const paths = Object.keys(stamp).flatMap((field) =>
    field === "localeMatch" ? Object.keys(stamp[field]).map((inner) => `${field}.${inner}`) : [field]);
  assert.deepEqual(paths.slice().sort(), PLAN_COMPARED_FIELDS.slice().sort());
  assert.equal(paths.length, 15);

  // ONE MISMATCH FIXTURE PER FIELD, generated from that same derivation rather than typed out.
  //
  // TWO FIELDS ARE CAUGHT BY A DIFFERENT RULE AND THE TEST SAYS SO instead of relaxing to "it
  // throws". `localeDataMode` and `cardinalityMode` have exactly two legal values each, and any
  // value other than `pinned`/`exact` is refused by the strict-hydration rule BEFORE the comparison
  // reaches them — so no perturbation of those two can be observed as a field mismatch. That is a
  // property of the design (they are doubly guarded), and asserting the specific message is what
  // stops it silently becoming "the comparison skips them".
  const MODE_FIELDS = new Set(["localeDataMode", "cardinalityMode"]);
  for (const path of paths) {
    const perturbed = JSON.parse(JSON.stringify(stamp));
    const [head, inner] = path.split(".");
    const target = inner ? perturbed[head] : perturbed;
    const key = inner ?? head;
    target[key] = typeof target[key] === "number" ? target[key] + 1 : `${target[key]}-perturbed`;
    assert.throws(() => validateSsrStamp(perturbed, instance, DIRECT_FR),
      MODE_FIELDS.has(path)
        ? /Strict hydration accepts only pinned locale data with exact cardinality/
        : new RegExp(`'${path.replace(".", "\\.")}'`),
      `perturbing ${path} must be caught`);
  }

  // The control, and a real one: the unperturbed copy round-trips through JSON and still validates.
  assert.doesNotThrow(() =>
    validateSsrStamp(JSON.parse(JSON.stringify(stamp)), instance, DIRECT_FR));
});

test("clause 43: an unknown field cannot come from a compatible producer", () => {
  const instance = loadedInstance();
  const stamp = { ...createSsrStamp(instance, DIRECT_FR), hydrationHint: "trust me" };
  assert.throws(() => validateSsrStamp(/** @type {any} */ (stamp), instance, DIRECT_FR),
    /unknown field 'hydrationHint'/);
});

// --------------------------------------------------------------- clause 44: hydration modes

test("clause 44: strict hydration accepts only pinned/exact, and says what to do instead", () => {
  const instance = loadedInstance();
  const stamp = createSsrStamp(instance, DIRECT_FR);
  assert.equal(stamp.localeDataMode, "pinned");
  assert.equal(stamp.cardinalityMode, "exact");

  for (const override of [{ localeDataMode: "host-intl" }, { cardinalityMode: "host-intl" }]) {
    let thrown = /** @type {any} */ (null);
    try {
      validateSsrStamp(/** @type {any} */ ({ ...stamp, ...override }), instance, DIRECT_FR);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, `a ${JSON.stringify(override)} stamp must not hydrate`);
    assert.match(thrown.message, /Strict hydration accepts only pinned locale data with exact cardinality/);
    // The remedy is part of the contract, not decoration: plan 6.4 says an integration may force a
    // full client render or navigation, and must NOT silently hydrate mismatched content.
    assert.match(thrown.message, /Render on the client, or navigate/);
    assert.equal(thrown.name, "ConfigurationError");
  }
});

// --------------------------------------------------------------- clause 45: match invariants

test("clause 45: a direct projection EQUALS the instance's own automatic result", () => {
  // **THIS CONSUMES M7 AS AN ORACLE FOR M8, and that is all it does.** A green result here proves the
  // stamp agrees with `getDirectLocaleContext`, not that either is right; the evidence that
  // `getDirectLocaleContext` is right is M7's, through the corpus and `diff:lookup`.
  const instance = loadedInstance();
  for (const locale of ["fr", "FR", "fr-CA"]) {
    const context = /** @type {any} */ (instance.getDirectLocaleContext(locale));
    const stamp = createSsrStamp(doctored(instance, {
      getLoadVerification: () => ({
        .../** @type {any} */ (instance.getLoadVerification()),
        coverage: { kind: "entire-manifest" },
      }),
    }), { kind: "locale", locale });
    assert.equal(stamp.lookupLocale, context.lookupLocale);
    assert.deepEqual(stamp.localeMatch,
      { locale: context.localeMatch.locale, matchType: context.localeMatch.matchType });
  }
});

test("clause 45: a selected locale MAY differ from the lookup locale", () => {
  // The reason the stamp carries both. `fr-CA` is not loaded; the automatic direct result selects
  // `fr`, and the lookup locale stays what was requested.
  const whole = createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  });
  const stamp = createSsrStamp(whole, { kind: "locale", locale: "fr-CA" });
  assert.equal(stamp.lookupLocale, "fr-CA");
  assert.notEqual(stamp.localeMatch.locale, stamp.lookupLocale);
  assert.equal(stamp.localeMatch.locale, "fr");
});

test("clause 45: locale is null EXACTLY when the match type is 'none', both directions", () => {
  const instance = loadedInstance();
  assert.throws(
    () => createSsrStamp(instance, { kind: "locale-match", localeMatch: { locale: null, matchType: "exact" } }),
    /selects null exactly when its type is 'none'/);
  assert.throws(
    () => createSsrStamp(instance, { kind: "locale-match", localeMatch: { locale: "fr", matchType: "none" } }),
    /selects null exactly when its type is 'none'/);
});

test("clause 45: an unmatched supplied match takes the instance fallback as its lookup", () => {
  const whole = createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  });
  const stamp = createSsrStamp(whole, { kind: "locale-match", localeMatch: { locale: null, matchType: "none" } });
  assert.equal(stamp.lookupLocale, "en");
  assert.deepEqual(stamp.localeMatch, { locale: null, matchType: "none" });

  // And a MATCHED supplied match makes the selected locale the lookup locale.
  const matched = createSsrStamp(whole, { kind: "locale-match", localeMatch: { locale: "fr", matchType: "exact" } });
  assert.equal(matched.lookupLocale, "fr");
});

test("clause 45: a selected locale outside the instance's configuration is refused", () => {
  const whole = createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  });
  assert.throws(
    () => createSsrStamp(whole, { kind: "locale-match", localeMatch: { locale: "de", matchType: "exact" } }),
    /must occur in the instance's applicable configuration/);
  assert.throws(
    () => createSsrStamp(whole, { kind: "locale-match", localeMatch: { locale: "fr", matchType: "invented" } }),
    /Unknown locale match type/);
});

// --------------------------------------------------------------- clause 46: TranslationResult

test("clause 46: a TranslationResult is accepted by ORIGIN, and one satisfying neither is refused", () => {
  const whole = createStrings({
    loaded: loadedStrings({
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr" }],
    }),
    locale: "fr",
  });

  // Origin 1, the automatic direct result: `fr-CA` selects `fr`, which is NOT the supplied-match
  // relation (a supplied match selecting `fr` derives lookup `fr`, not `fr-CA`).
  const direct = whole.getResult("Hi", undefined, { locale: "fr-CA" });
  const directStamp = createSsrStamp(whole, direct);
  assert.equal(directStamp.lookupLocale, "fr-CA");
  assert.equal(directStamp.localeMatch.locale, "fr");

  // Origin 2, a supplied match: lookup is derived FROM the selection, and the pair is not the
  // automatic direct result for that lookup — `en` automatically selects `en` as `exact`, and this
  // one claims `wildcard`.
  const supplied = { lookupLocale: "en", localeMatch: { locale: "en", matchType: "wildcard" } };
  const suppliedStamp = createSsrStamp(whole, supplied);
  assert.deepEqual(suppliedStamp.localeMatch, { locale: "en", matchType: "wildcard" });

  // Doubly satisfying, and plan 6.4 says it is unambiguous "because both imply the same serialized
  // context" — asserted rather than assumed.
  const exact = whole.getResult("Hi", undefined, { locale: "fr" });
  const both = createSsrStamp(whole, exact);
  assert.deepEqual(both, createSsrStamp(whole, { kind: "locale", locale: "fr" }));
  assert.deepEqual(both, createSsrStamp(whole, { kind: "locale-match", localeMatch: { locale: "fr", matchType: "exact" } }));

  // Satisfying NEITHER: lookup `en` with a match selecting `fr`. The automatic result for `en` is
  // `en`/exact, and a supplied match selecting `fr` would derive lookup `fr`.
  assert.throws(
    () => createSsrStamp(whole, { lookupLocale: "en", localeMatch: { locale: "fr", matchType: "exact" } }),
    /is neither the automatic direct result for itself/);
});

test("clause 46: an object that is neither a context nor a result is refused", () => {
  const instance = loadedInstance();
  for (const context of [undefined, null, {}, { kind: "whatever" }, { lookupLocale: "fr" }])
    assert.throws(() => createSsrStamp(instance, /** @type {any} */ (context)),
      /rendering context/, `${JSON.stringify(context)} must be refused`);
});

// --------------------------------------------------------------- clause 48: whole-server/subset-client

test("clause 48: whole server and fr-BE-planned client share identity and hydrate", () => {
  // The manifest publishes `en` and `fr-FR`; the direct context is `fr-BE`. Both instances end up
  // holding the SAME two catalogs — the subset plan for `fr-BE` reaches `fr-FR` and `en` — so the
  // only thing that differs is what each load was PLANNED from, which is the whole point.
  const manifest = { fallbackLocale: "en", supportedLocales: ["en", "fr-FR"], tiebreakers: {} };
  const catalogs = { en, "fr-FR": frFR };

  const server = createStrings({
    loaded: loadedStrings({
      catalogs, manifestLocaleConfiguration: manifest,
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr-FR" }],
    }),
    locale: "en",
  });
  const client = createStrings({
    loaded: loadedStrings({
      catalogs, manifestLocaleConfiguration: manifest,
      coverage: { kind: "lookup", lookupLocale: "fr-BE" },
      requestedFiles: [{ locale: "fr-FR" }, { locale: "en" }],
    }),
    locale: "en",
  });

  const context = /** @type {const} */ ({ kind: "locale", locale: "fr-BE" });
  const stamp = createSsrStamp(server, context);
  assert.doesNotThrow(() => validateSsrStamp(stamp, client, context));
  assert.deepEqual(createSsrStamp(client, context), stamp);
});

test("clause 48 REJECTION half: a client planned only for its diagnostic selection does NOT cover it", () => {
  // **THE DISCRIMINATING FIXTURE.** This client holds exactly the same catalogs as the accepted one
  // above and renders `fr-BE` identically; it is refused purely because its coverage was planned
  // from `fr-FR`, the diagnostic selection, rather than from the requested `fr-BE`. Any
  // implementation that checked "are the needed catalogs present" instead of "what was this planned
  // from" passes the acceptance half and fails here.
  const manifest = { fallbackLocale: "en", supportedLocales: ["en", "fr-FR"], tiebreakers: {} };
  const diagnostic = createStrings({
    loaded: loadedStrings({
      catalogs: { en, "fr-FR": frFR },
      manifestLocaleConfiguration: manifest,
      coverage: { kind: "lookup", lookupLocale: "fr-FR" },
      requestedFiles: [{ locale: "fr-FR" }, { locale: "en" }],
    }),
    locale: "en",
  });
  const context = /** @type {const} */ ({ kind: "locale", locale: "fr-BE" });
  assert.throws(() => createSsrStamp(diagnostic, context),
    /covers lookup 'fr-FR' only, and the rendering context is 'fr-BE'/);

  // And the server's stamp cannot be validated against it either — the same refusal, reached through
  // `validateSsrStamp`'s local verification rather than through construction.
  const server = createStrings({
    loaded: loadedStrings({
      catalogs: { en, "fr-FR": frFR }, manifestLocaleConfiguration: manifest,
      coverage: { kind: "entire-manifest" },
      requestedFiles: [{ locale: "en" }, { locale: "fr-FR" }],
    }),
    locale: "en",
  });
  assert.throws(() => validateSsrStamp(createSsrStamp(server, context), diagnostic, context),
    /covers lookup 'fr-FR' only/);
});
