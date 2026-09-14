// @ts-check
/**
 * TWO SUBSET FLOWS, TWO DELIBERATELY DIFFERENT PRESERVED INPUTS — M8 clause 12.
 *
 * Plan 6.2:2051-2066 writes the contrast as two code blocks. The DIRECT flow loads
 * `loadStrings(manifest, "fr-BE")` and constructs `createStrings({ loaded, locale: "fr-BE" })`; the
 * WHOLE-LIST flow computes `matchedLookup = match.locale ?? match.fallbackLocale` in APPLICATION
 * code, loads from that, and constructs with `localeMatchResolver: () => match`. The clause is that
 * those two preserved inputs are not the same value and not interchangeable.
 *
 * **WHY THE OBVIOUS PROBE PROVES NOTHING, and it is the whole reason this file exists.** A suite made
 * of "load the locale you published, then read it back" cases is green over every plausible defect
 * here, because on a manifest-declared tag the four candidate answers COLLAPSE INTO ONE STRING: the
 * caller's argument, its normalization, the diagnostic selection, and the first file the plan
 * actually fetches. `fr-be` against a manifest holding `{en, fr-CA, fr-FR, zh, zh-Hant}` separates
 * all four — measured: the normalized argument is `fr-BE`, the raw spelling is `fr-be`, the automatic
 * diagnostic selects `fr-FR`, and `requestedFiles[0].locale` is `fr-FR` — so each wrong answer is a
 * DIFFERENT STRING from the right one. Reaching the line that writes `coverage.lookupLocale` is not
 * discriminating what it writes.
 *
 * **WHAT IS CLAUSE 12's OWN GROUND, AND WHAT IS BORROWED.** Clause 49 is already PROVEN over the
 * coverage-VALIDATION rule ("the effective lookup tag must match the coverage record on every use"),
 * gated by `test/applicable-configuration.test.js` — which builds every `LoadedStrings` BY HAND.
 * Nothing there runs a real loader, so clause 12's fresh ground is the LOADER side: the record is the
 * caller's input verbatim (12.a), the subset is planned from it and a subset loader is not a whole
 * loader (12.b), and the same coverage field decides `complete`. The construction-side rows (12.c-f)
 * are recorded here as the END-TO-END composition over real loads — real bytes, real digests, a real
 * negotiator — and are labelled corroboration of clause 49 where they lean on its rule.
 *
 * **THE FIXTURE NEEDS TWO MANIFESTS, AND THAT IS THE RULE RATHER THAN A WORKAROUND.**
 * `createStringsManifestFromDirectory` defaults `publicationBaseUrl` to the directory's own `file:`
 * URL (plan 6.2:2124), and plan 6.1:1916-1918 has the Fetch door reject a base or resolved URL
 * outside `http:`/`https:` BEFORE any catalog I/O, while the Node door rejects anything outside
 * `file:` (plan 6.2:2127, and 6.2:2584 makes the pre-I/O half a required 8.3 row). One manifest
 * therefore cannot serve both doors: every
 * Fetch row would be refused before any coverage code ran — the "rejected by an earlier guard" shape,
 * at fixture level. So the same directory is published twice and `catalogFingerprint` equality is
 * asserted as a hard gate: `CatalogIdentityInputV1` omits `baseUrl` and every per-file URL, so the
 * two manifests are the same catalogs by construction, and a failure there would mean the doors had
 * stopped comparing the same thing.
 *
 * **RUN THROUGH BOTH DOORS** because S11a moved the plan runner into `src/load/run-plan.js` and each
 * door supplies only a transport — a door-local regression in the coverage record is otherwise
 * invisible from the other side.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createStrings, forLocale, forLocaleMatch } from "../src/core/index.js";
import { fetchSet, loadEntireManifest, loadStrings } from "../src/load/index.js";
import {
  createStringsManifestFromDirectory, loadEntireManifestFromFiles, loadStringsFromDirectory,
  loadStringsFromFiles, readStringsFromDirectory,
} from "../src/node/index.js";
import { createLocaleNegotiator, parseLanguageRanges } from "../src/negotiate/index.js";

// ---------------------------------------------------------------------------------------------
// FIXTURE F — one directory, published twice.
// ---------------------------------------------------------------------------------------------

/**
 * Plan 6.2:2593's seed row ("fr-BE; fr-FR preferred to fr-CA") plus a fallback catalog, plus the
 * `zh`/`zh-Hant` pair that 12.b's recorded did-not-fire is measured over.
 *
 * `Shared` lives in every catalog, so a walk short-circuits at its first holder; `OnlyEn` lives in
 * `en` alone, so a walk that must reach the fallback records the WHOLE chain in `attemptedLocales`.
 * That second key is not decoration — clause 49's own gate recorded a draft that did not discriminate
 * because its key was answered by the first candidate and the walk never reached the rest.
 */
const CATALOGS = {
  "en": { Shared: "shared en", OnlyEn: "only en" },
  "fr-FR": { Shared: "shared fr-FR", OnlyFrFr: "only fr-FR" },
  "fr-CA": { Shared: "shared fr-CA" },
  "zh": { Shared: "shared zh" },
  "zh-Hant": { Shared: "shared zh-Hant" },
};

const root = mkdtempSync(join(tmpdir(), "lokalized-clause12-"));
after(() => rmSync(root, { recursive: true, force: true }));
for (const [tag, body] of Object.entries(CATALOGS))
  writeFileSync(join(root, `${tag}.json`), JSON.stringify(body));

const GENERATOR_OPTIONS = {
  catalogVersion: "1",
  fallbackLocale: "en",
  // Both are REQUIRED by the manifest validator, not chosen: a manifest declaring two catalogs for
  // one language and no tiebreaker for it is refused, and `fr` is what makes `fr-FR` preferred to
  // `fr-CA` in the candidate walk — the discriminating fact plan 6.2:2593 supplies.
  tiebreakers: { fr: ["fr-FR", "fr-CA"], zh: ["zh", "zh-Hant"] },
};

const PUBLISHED_BASE = "https://catalogs.test/v1/";
const onDisk = await createStringsManifestFromDirectory(root, GENERATOR_OPTIONS);
const published = await createStringsManifestFromDirectory(root,
  { ...GENERATOR_OPTIONS, publicationBaseUrl: PUBLISHED_BASE });

const MANIFEST_TAGS = Object.keys(onDisk.files).sort();
const bytesFor = (/** @type {string} */ url) =>
  new Uint8Array(readFileSync(join(root, decodeURIComponent(/** @type {string} */ (url.split("/").pop())))));

/** A `Response`-shaped answer over a `Uint8Array`, in the shape the Fetch door's reader expects. */
function respond(/** @type {Uint8Array} */ bytes) {
  let sent = false;
  return { ok: true, status: 200, body: { getReader: () => ({
    read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
    cancel: async () => {},
  }) } };
}

/** @param {Iterable<string>} [failing] locales whose file the transport refuses to serve */
const diskFetch = (failing = []) => {
  const refuse = new Set(failing);
  return async (/** @type {string} */ url) =>
    (refuse.has(tagOfUrl(url)) ? { ok: false, status: 503 } : respond(bytesFor(url)));
};
/** @param {Iterable<string>} [failing] */
const diskReader = (failing = []) => {
  const refuse = new Set(failing);
  return async (/** @type {string} */ url) => {
    if (refuse.has(tagOfUrl(url))) throw new Error(`${url} is unreadable`);
    return bytesFor(url);
  };
};
const tagOfUrl = (/** @type {string} */ url) =>
  decodeURIComponent(/** @type {string} */ (url.split("/").pop())).replace(/\.json$/, "");

/** A transport that records every call, so "this door read nothing" is falsifiable. */
function recording() {
  /** @type {string[]} */
  const calls = [];
  return { calls, impl: async (/** @type {string} */ url) => { calls.push(url); return bytesFor(url); } };
}

/**
 * The two doors, behind one interface. Each carries the manifest it can address and the FOREIGN one
 * it must refuse, so the split above is exercised rather than merely assumed.
 */
const DOORS = [
  {
    name: "node",
    manifest: onDisk,
    foreign: published,
    // NO injected reader by default: this half runs over the real filesystem, real `open`/`stat` and
    // a real incremental `node:crypto` digest.
    load: (/** @type {string} */ tag, /** @type {any} */ options = {}) =>
      loadStringsFromFiles(onDisk, tag, options),
    whole: (/** @type {any} */ options = {}) => loadEntireManifestFromFiles(onDisk, options),
    failing: (/** @type {string[]} */ tags) => ({ readFile: diskReader(tags) }),
    refuseForeign: (/** @type {{ impl: any }} */ transport) =>
      loadStringsFromFiles(published, "fr-BE", { readFile: transport.impl }),
  },
  {
    name: "fetch",
    manifest: published,
    foreign: onDisk,
    load: (/** @type {string} */ tag, /** @type {any} */ options = {}) =>
      loadStrings(published, tag, { fetch: diskFetch(), ...options }),
    whole: (/** @type {any} */ options = {}) =>
      loadEntireManifest(published, { fetch: diskFetch(), ...options }),
    failing: (/** @type {string[]} */ tags) => ({ fetch: diskFetch(tags) }),
    refuseForeign: (/** @type {{ impl: any }} */ transport) =>
      loadStrings(onDisk, "fr-BE", { fetch: async (/** @type {string} */ url) => respond(await transport.impl(url)) }),
  },
];

const localesOf = (/** @type {any} */ loaded) =>
  loaded.requestedFiles.map((/** @type {any} */ entry) => entry.locale);
/** Null-prototype records compare unequal under strict `deepEqual`; spread them first. */
const plain = (/** @type {any} */ value) => ({ ...value });

/**
 * Build an instance and take one translation, reporting WHICH call refused.
 *
 * A constant instance locale can be refused at construction while a resolver door can only be
 * refused at first use, so an assertion pinned to one site is an assertion that may never run.
 *
 * @param {() => any} build
 * @returns {{ site: "construction" | "use" | null, value?: unknown, error?: any }}
 */
function attempt(build, key = "Shared") {
  /** @type {any} */
  let instance;
  try {
    instance = build();
  } catch (error) {
    return { site: "construction", error };
  }
  try {
    return { site: null, value: instance.get(key) };
  } catch (error) {
    return { site: "use", error };
  }
}

/** @param {{ site: string | null, value?: unknown, error?: any }} outcome */
function assertRefused(outcome, label) {
  assert.notEqual(outcome.site, null, `${label}: a translation was produced where a refusal was due`);
  assert.equal(outcome.value, undefined, `${label}: no translation may be produced`);
  assert.equal(outcome.error?.name, "ConfigurationError", label);
  assert.equal(outcome.error?.code, "CONFIGURATION", label);
}

// ---------------------------------------------------------------------------------------------
// The fixture's own preconditions.
// ---------------------------------------------------------------------------------------------

test("fixture: the two manifests differ only in publication base, and each door refuses the other's", async () => {
  // IDENTITY OMITS `baseUrl` AND EVERY PER-FILE URL, so equality here is guaranteed by design and its
  // FAILURE would mean the two doors had stopped comparing the same catalogs — which is the only
  // thing that makes a per-door result table meaningful.
  assert.equal(onDisk.catalogFingerprint, published.catalogFingerprint);
  assert.deepEqual(Object.keys(published.files).sort(), MANIFEST_TAGS);
  assert.ok(onDisk.baseUrl.startsWith("file:"));
  assert.equal(published.baseUrl, PUBLISHED_BASE);

  // Recorded as the RULE rather than as a workaround for the fixture. This is not new clause 10
  // evidence — `test/load-door-boundaries.test.js` owns that — it is the justification for
  // publishing the same directory twice, kept next to the thing it justifies.
  for (const door of DOORS) {
    const transport = recording();
    const error = await door.refuseForeign(transport).then(() => null, (e) => e);
    assert.equal(/** @type {any} */ (error)?.name, "ConfigurationError", door.name);
    assert.equal(transport.calls.length, 0, `${door.name}: refused in preflight, before any I/O`);
  }
});

// ---------------------------------------------------------------------------------------------
// 12.a — the record is the caller's own planning input, normalized and verbatim.
// ---------------------------------------------------------------------------------------------

for (const door of DOORS) {
  test(`12.a [${door.name}]: coverage.lookupLocale is the caller's own input, normalized — not the selection, not the first planned file, not the raw spelling`, async () => {
    const direct = await door.load("fr-be");

    // COVERAGE FIRST. The preconditions below are asserted second on purpose: under an ablation that
    // rewrites this field, a precondition computed through it would throw first and the recorded red
    // would be attributed to the wrong line.
    assert.equal(direct.coverage.kind, "lookup");
    assert.equal(direct.coverage.lookupLocale, "fr-BE",
      "the caller's own tag, normalized — the loader substitutes nothing for it");

    // (p1) The tag is NOT a manifest key, so nothing about it can have come from the file set.
    assert.ok(!Object.prototype.hasOwnProperty.call(door.manifest.files, "fr-BE"));
    assert.ok(!Object.prototype.hasOwnProperty.call(door.manifest.files, "fr-be"));

    // (p2) The automatic diagnostic for this tag selects a DIFFERENT locale — plan 6.2:2593's seed
    // row. Computed over the WHOLE-MANIFEST instance, never over `direct`: whole coverage permits any
    // direct locale (plan 3.4:621), so this reading is invariant under every mutation of the subset
    // loader, which a reading through `direct` would not be.
    const whole = createStrings({ loaded: await door.whole(), locale: "fr-BE" });
    const diagnostic = /** @type {any} */ (whole.getDirectLocaleContext("fr-BE")).localeMatch;
    assert.equal(diagnostic.locale, "fr-FR");
    assert.equal(diagnostic.matchType, "likely-subtag");

    // (p3) …and the first file the plan actually fetches is that same different string. Without this
    // the "record the tag we actually start from" mutation would be vacuous rather than wrong.
    assert.equal(direct.requestedFiles[0].locale, "fr-FR");

    // Three plausible wrong answers, each a different string from the right one. Spelled out so a
    // later reader does not have to re-derive why this fixture and not a simpler one.
    assert.notEqual(direct.coverage.lookupLocale, diagnostic.locale, "not the diagnostic selection");
    assert.notEqual(direct.coverage.lookupLocale, direct.requestedFiles[0].locale, "not the first planned file");
    assert.notEqual(direct.coverage.lookupLocale, "fr-be", "not the raw spelling");
  });

  test(`12.a [${door.name}]: THE CONTROL — a load for a tag the manifest declares serves end to end`, async () => {
    // THE COINCIDING CASE: argument, normalized argument, diagnostic selection and first planned file
    // are all `fr-FR`, so it passes under every mutation above — which is exactly what makes it a
    // control. It proves nothing earlier in the pipeline (manifest validation, the fingerprint, the
    // digests, the scheme check, well-formedness) is refusing the probe for an unrelated reason.
    const selected = await door.load("fr-FR");
    assert.equal(selected.coverage.kind, "lookup");
    assert.equal(selected.coverage.lookupLocale, "fr-FR");
    assert.ok(Object.keys(selected.catalogs).length > 0);
    assert.equal(selected.complete, true);

    const strings = createStrings({ loaded: selected, locale: "fr-FR" });
    assert.equal(strings.get("Shared"), "shared fr-FR");
  });
}

// ---------------------------------------------------------------------------------------------
// 12.b — the subset is PLANNED from the preserved input, and `complete` is scoped to it.
// ---------------------------------------------------------------------------------------------

for (const door of DOORS) {
  test(`12.b [${door.name}]: the subset is PLANNED from the preserved input, and two inputs fetch different sets`, async () => {
    // DEGENERATE-SET GATE (diff:load's pattern), asserted before anything depends on it: if these two
    // plans ever coincide the fixture has stopped discriminating and a green run means nothing.
    const jaPlan = fetchSet(door.manifest, "ja").map((entry) => entry.locale);
    const frPlan = fetchSet(door.manifest, "fr-FR").map((entry) => entry.locale);
    assert.notDeepEqual(jaPlan, frPlan);

    const ja = await door.load("ja");
    const fr = await door.load("fr-FR");

    // LITERALS, derived from the fixture by hand and reviewed, so a defect INSIDE the shared planner
    // has something to contradict. `ja` matches nothing the manifest declares, so its plan is the
    // fallback arm alone; `fr-FR` reaches `fr-CA` through the tiebreaker order and then the fallback.
    assert.deepEqual(localesOf(ja), ["en"]);
    assert.deepEqual(localesOf(fr), ["fr-FR", "fr-CA", "en"]);

    // The SECONDARY wiring check, labelled as one: it compares the loader against the very function
    // the loader plans with, so it can only fail for a door that stopped calling the shared planner.
    assert.deepEqual(localesOf(ja), fetchSet(door.manifest, ja.coverage.lookupLocale).map((e) => e.locale));
    assert.deepEqual(localesOf(fr), fetchSet(door.manifest, fr.coverage.lookupLocale).map((e) => e.locale));

    // Catalogs as a SET: their key order is not stated anywhere in the plan, and an order-sensitive
    // equality here would invite a false red.
    assert.deepEqual(Object.keys(ja.catalogs).sort(), ["en"]);
    assert.deepEqual(Object.keys(fr.catalogs).sort(), ["en", "fr-CA", "fr-FR"]);

    // THE MEMBERSHIP DIFFERENCE, concretely — the observation that "a subset loader is not a whole
    // loader wearing a coverage label" actually rests on.
    assert.ok(Object.keys(fr.catalogs).includes("fr-FR"));
    assert.ok(!Object.keys(ja.catalogs).includes("fr-FR"));
    assert.ok(Object.keys(ja.catalogs).length < MANIFEST_TAGS.length,
      "and it is a STRICT subset of the manifest — the clause's first two words");
  });

  test(`12.b [${door.name}]: completeness is scoped to the preserved input — one broken file, two verdicts`, async () => {
    // A SECOND OBSERVABLE OF THE SAME FIELD. Plan 6.2:2111-2113 defines `complete` for a lookup load as
    // "every file in fetchSet(manifest, coverage.lookupLocale) succeeded", so a loader that recorded
    // the wrong tag would also mis-report completeness. One transport, one broken file, two lookups,
    // two verdicts — the only variable is the preserved input.
    const broken = { ...door.failing(["fr-CA"]), partialFailure: "allow-partial" };

    const frBe = await door.load("fr-be", broken);
    assert.equal(frBe.complete, false, "`fr-CA` is in the plan for `fr-BE`");
    assert.equal(frBe.failures.length, 1);
    assert.equal(frBe.failures[0].locale, "fr-CA");
    assert.deepEqual(Object.keys(frBe.catalogs).sort(), ["en", "fr-FR"]);

    const ja = await door.load("ja", broken);
    assert.equal(ja.complete, true, "…and it is not in the plan for `ja`, over the SAME broken transport");
    assert.equal(ja.failures.length, 0);
  });

  test(`the full-manifest fields survive a lookup subset [${door.name}]`, async () => {
    // Plan 6.2:2106-2107: `manifestLocaleConfiguration` "always describes the validated full manifest"
    // while runtime catalogs and tiebreakers "describe only the loaded coverage"; plan 6.2:2114:
    // `catalogIdentity` "always identifies the full manifest even when only a lookup subset is loaded". 12.d DEPENDS on the first of those — it builds a negotiator from a subset's own
    // configuration — so a defect narrowing that field to the loaded set would be self-consistent and
    // invisible there. Measured here instead of assumed there.
    const whole = await door.whole();
    for (const tag of ["fr-be", "fr-FR", "ja"]) {
      const subset = await door.load(tag);
      assert.deepEqual(
        { ...plain(subset.manifestLocaleConfiguration), tiebreakers: plain(subset.manifestLocaleConfiguration.tiebreakers) },
        { ...plain(whole.manifestLocaleConfiguration), tiebreakers: plain(whole.manifestLocaleConfiguration.tiebreakers) },
        tag);
      assert.deepEqual(subset.manifestLocaleConfiguration.supportedLocales, MANIFEST_TAGS, tag);
      assert.deepEqual(plain(subset.catalogIdentity), plain(whole.catalogIdentity), tag);
      assert.equal(subset.fallbackLocale, "en", tag);
    }
  });
}

test("12.b: RECORDED DID-NOT-FIRE — plan(selection) equals plan(argument), measured", () => {
  // **A MUTATION THAT CANNOT BE MADE TO FIRE HERE, WRITTEN DOWN RATHER THAN SHIPPED AS "0 red".**
  // "The loader never substitutes a diagnostic selection" is NOT observable through the fetch plan:
  // the selection is always a manifest-backed member of the argument's own candidate chain, so
  // planning from the selection instead of the argument produces the SAME file list. Both pairs are
  // measured rather than argued — `zh-TW` is included because its chain and its selection's chain
  // genuinely differ ([zh-TW, zh-Hant, en] against [zh-Hant, en]) and the PROJECTION still coincides,
  // which is the sharper form of the claim.
  //
  // It is therefore observable only through the coverage FIELD, which is why 12.a carries it. The
  // clause ledger already records the identical caveat against clause 11; this is the same gap one
  // layer down, and it is not closed here.
  //
  // **A RED HERE IS NOT A REGRESSION — it means the two plans have come apart and the mutation has
  // become a firing ablation.** Revisit clause 11's and clause 12's ledger entries when that happens.
  const planFor = (/** @type {string} */ tag) => fetchSet(onDisk, tag).map((entry) => entry.locale);
  assert.deepEqual(planFor("fr-BE"), planFor("fr-FR"));
  assert.deepEqual(planFor("zh-TW"), planFor("zh-Hant"));
  assert.deepEqual(planFor("ja"), planFor("en"));
});

// ---------------------------------------------------------------------------------------------
// 12.c — the DIRECT flow's preserved input is what every result reports and what the walk starts
// from, although the same instance's diagnostic selects elsewhere and resolution answers from there.
//
// CORROBORATION OF CLAUSE 49 at the rule level; what is new is that the record under test came out
// of a real loader rather than an object literal.
// ---------------------------------------------------------------------------------------------

for (const door of DOORS) {
  test(`12.c [${door.name}]: the direct flow reports AND WALKS FROM the preserved input`, async () => {
    const subset = await door.load("fr-be");
    const client = createStrings({ loaded: subset, locale: "fr-BE" });

    const result = /** @type {any} */ (client.getResult("Shared"));
    assert.equal(result.lookupLocale, "fr-BE");
    assert.equal(result.localeMatch.locale, "fr-FR", "the diagnostic legitimately differs");
    assert.equal(result.localeMatch.matchType, "likely-subtag");
    assert.equal(result.resolvedLocale, "fr-FR", "and resolution answers from that other locale");
    // ASSERTED ALONGSIDE `lookupLocale`, and it is the half that cannot be faked: an implementation
    // could preserve the reported tag cosmetically while starting the walk at the selection, and then
    // only the attempt list tells them apart. A field that is reported but not USED is the "already
    // dead field" shape this project has shipped before.
    assert.equal(result.attemptedLocales[0], "fr-BE", "per-key fallback STARTED at the preserved input");
    assert.equal(result.isFallback, true);
    assert.equal(result.translation, "shared fr-FR");

    // A key only the fallback holds, so the walk cannot short-circuit and `attemptedLocales` records
    // the whole chain — while `lookupLocale` is still the preserved input.
    const toFallback = /** @type {any} */ (client.getResult("OnlyEn"));
    assert.equal(toFallback.lookupLocale, "fr-BE");
    assert.deepEqual(toFallback.attemptedLocales, ["fr-BE", "fr", "fr-FR", "fr-CA", "en"]);
    assert.equal(toFallback.translation, "only en");

    // THE CONTROL — the coinciding instance, where lookup, selection and resolution are one string.
    // It stays green under every mutation the rows above catch, which is precisely why it cannot
    // substitute for them.
    const coinciding = createStrings({ loaded: await door.load("fr-FR"), locale: "fr-FR" });
    const control = /** @type {any} */ (coinciding.getResult("Shared"));
    assert.equal(control.lookupLocale, "fr-FR");
    assert.equal(control.localeMatch.locale, "fr-FR");
    assert.equal(control.resolvedLocale, "fr-FR");
    assert.equal(control.translation, "shared fr-FR");
  });

  test(`12.c [${door.name}]: on every use — a per-call tag is honoured under whole coverage and refused under lookup coverage`, async () => {
    // **THE PER-CALL ROW HAS TO SIT ON AN INSTANCE WHOSE OWN LOCALE DISAGREES WITH IT**, or it proves
    // nothing: on an instance already built with `fr-BE`, a `forLocale("fr-BE")` call is satisfied
    // byte-for-byte by an implementation that drops the per-call options on the floor. `de-CH` is the
    // instance tag here and whole-manifest coverage permits it (plan 3.4:621).
    const whole = createStrings({ loaded: await door.whole(), locale: "de-CH" });
    const ambient = /** @type {any} */ (whole.getResult("Shared"));
    assert.equal(ambient.lookupLocale, "de-CH");
    assert.equal(ambient.translation, "shared en", "de-CH resolves through the fallback");

    const perCall = /** @type {any} */ (whole.getResult("Shared", undefined, forLocale("fr-BE")));
    assert.equal(perCall.lookupLocale, "fr-BE", "the per-call door is honoured, not ignored");
    assert.equal(perCall.localeMatch.locale, "fr-FR");
    assert.equal(perCall.attemptedLocales[0], "fr-BE");
    assert.equal(perCall.translation, "shared fr-FR");

    // …and the paired half, which is what "on every use" (plan 3.4:619) actually means: the SAME
    // per-call door, on a lookup subset, refuses a tag the subset was not planned from — even though
    // this subset holds every catalog `fr-FR` would need. Neither half is satisfiable by an
    // implementation that ignores the per-call option.
    const client = createStrings({ loaded: await door.load("fr-be"), locale: "fr-BE" });
    const refused = attempt(() => ({
      get: (/** @type {string} */ key) => client.get(key, undefined, forLocale("fr-FR")),
    }));
    assertRefused(refused, `${door.name}: per-call fr-FR against coverage fr-BE`);
    assert.equal(refused.site, "use", "a per-call tag can only be judged at the call");
    assert.match(String(refused.error?.message), /loaded for lookup 'fr-BE' only/);
  });
}

// ---------------------------------------------------------------------------------------------
// 12.d / 12.e — the WHOLE-LIST flow's preserved input is the match's selection, or its configured
// fallback when unmatched.
//
// **THE LOADER NEVER SEES A `LocaleMatchResult`.** Plan 6.2:2059-2061 computes
// `match.locale ?? match.fallbackLocale` in APPLICATION code and hands `loadStrings` a bare tag, so
// "the whole-list flow plans from the selection" is caller arithmetic at the loader boundary. What is
// library-observable is (a) the loader preserves whatever tag it was handed — 12.a — and (b) core
// derives the effective lookup from the match. Both rows below therefore EXECUTE plan 6.2:2060's own
// expression rather than hardcoding its answer, and each asserts the whole-list result on an instance
// where the coverage rule is INERT (whole-manifest), so the preserved input is observed directly and
// not merely through a refusal.
// ---------------------------------------------------------------------------------------------

for (const door of DOORS) {
  test(`12.d [${door.name}]: the whole-list flow preserves the match's SELECTION`, async () => {
    const whole = await door.whole();
    // FROM THE INSTANCE'S OWN full-manifest configuration, which the test above proved IS the full
    // manifest. That is also the zh-123 control for this row: a match whose `consideredLocales`
    // disagree with the applicable configuration is refused by plan 3.4's match validation BEFORE the
    // coverage rule is reached, so a hand-built match would give a green refusal for the wrong reason.
    const negotiator = createLocaleNegotiator(whole.manifestLocaleConfiguration);
    const match = negotiator.matchForLanguageRanges(parseLanguageRanges("fr-BE"));

    // Plan 6.2:2060, executed rather than transcribed — the range solver's election is whatever it is.
    const matchedLookup = match.locale ?? match.fallbackLocale;

    // HARD PRECONDITIONS, exactly the two separations the observations below rest on. Not the
    // selection's identity: hardcoding `fr-FR` would assume the N-member RFC 4647 solver answers what
    // the single-locale kernel answers, and this port documents that the two doors diverge on purpose.
    assert.equal(match.isMatch, true);
    const requestedRange = /** @type {any} */ (match.requestedLanguageRanges[0]).range;
    assert.notEqual(matchedLookup.toLowerCase(), String(requestedRange).toLowerCase(),
      "the selection must differ from the range the caller spelled, or reading the wrong field is invisible");
    assert.notEqual(matchedLookup, door.manifest.fallbackLocale,
      "…and from the configured fallback, or reading THAT field is invisible");

    // (1) THE COMPOSITION, as plan 6.2:2056-2061 writes it: load from the selection, construct with
    // the match. Nothing else in the suite runs a real loader result through the resolver door.
    const forSelection = await door.load(matchedLookup);
    assert.equal(forSelection.coverage.lookupLocale, matchedLookup);

    const client = createStrings({ loaded: forSelection, localeMatchResolver: () => match });
    const result = /** @type {any} */ (client.getResult("Shared"));
    assert.equal(result.lookupLocale, matchedLookup);
    assert.equal(result.localeMatch.locale, match.locale);
    assert.equal(result.attemptedLocales[0], matchedLookup, "and the walk STARTS there");
    assert.equal(result.translation, `shared ${matchedLookup}`);

    // (2) THE SAME OBSERVATION WITH THE COVERAGE RULE INERT. Under whole-manifest coverage nothing can
    // refuse a mis-derived lookup, so reading the range spelling or the configured fallback instead of
    // the selection shows up here as a WRONG VALUE rather than as someone else's ConfigurationError.
    const overWhole = createStrings({ loaded: whole, localeMatchResolver: () => match });
    const wide = /** @type {any} */ (overWhole.getResult("Shared"));
    assert.equal(wide.lookupLocale, match.locale);
    assert.equal(wide.attemptedLocales[0], match.locale);
    assert.equal(wide.translation, `shared ${matchedLookup}`);

    // (3) The PER-CALL match door, on an instance whose own locale disagrees with it — the same
    // vacuity trap the per-call row in 12.c had to avoid.
    const perCallHost = createStrings({ loaded: whole, locale: "de-CH" });
    const perCall = /** @type {any} */ (perCallHost.getResult("Shared", undefined, forLocaleMatch(match)));
    assert.equal(perCall.lookupLocale, match.locale);
    assert.equal(perCall.attemptedLocales[0], match.locale);
  });

  test(`12.e [${door.name}]: an unmatched supplied match preserves the match's configured FALLBACK`, async () => {
    const whole = await door.whole();
    const negotiator = createLocaleNegotiator(whole.manifestLocaleConfiguration);
    const unmatched = negotiator.matchForLanguageRanges(parseLanguageRanges("ja, ko"));

    assert.equal(unmatched.locale, null);
    assert.equal(unmatched.matchType, "none");
    assert.equal(unmatched.isMatch, false);
    assert.equal(unmatched.fallbackLocale, "en");

    // The `??` is the whole conjunct: plan 6.2:2060's expression with a NULL left arm.
    const matchedLookup = unmatched.locale ?? unmatched.fallbackLocale;
    const forFallback = await door.load(matchedLookup);
    assert.equal(forFallback.coverage.lookupLocale, "en");
    assert.deepEqual(localesOf(forFallback), ["en"]);

    const client = createStrings({ loaded: forFallback, localeMatchResolver: () => unmatched });
    const result = /** @type {any} */ (client.getResult("Shared"));
    assert.equal(result.lookupLocale, "en");
    assert.equal(result.resolvedLocale, "en");
    assert.equal(result.localeMatch.matchType, "none");
    assert.equal(result.translation, "shared en");

    // With the coverage rule inert, again — so the null branch is observed as a value.
    const overWhole = createStrings({ loaded: whole, localeMatchResolver: () => unmatched });
    const wide = /** @type {any} */ (overWhole.getResult("Shared"));
    assert.equal(wide.lookupLocale, "en");
    assert.equal(wide.attemptedLocales[0], "en");
    assert.equal(wide.resolvedLocale, "en");

    // CONTROLS: the matched arm of 12.d over the same negotiator (so "unmatched" is not the only
    // thing this negotiator can produce), and this subset's own DIRECT door, proving the `en` subset
    // is loadable and complete on its own terms.
    assert.equal(createStrings({ loaded: forFallback, locale: "en" }).get("Shared"), "shared en");
    assert.equal(forFallback.complete, true);
  });
}

// ---------------------------------------------------------------------------------------------
// 12.f — THE CONTRAST ITSELF. Each flow's subset serves that flow and refuses the other.
// ---------------------------------------------------------------------------------------------

for (const door of DOORS) {
  test(`12.f [${door.name}]: THE CONTRAST — the two preserved inputs are not interchangeable`, async () => {
    const whole = await door.whole();
    const negotiator = createLocaleNegotiator(whole.manifestLocaleConfiguration);
    const match = negotiator.matchForLanguageRanges(parseLanguageRanges("fr-BE"));
    const matchedLookup = match.locale ?? match.fallbackLocale;

    const forDirect = await door.load("fr-be");        // coverage `fr-BE`
    const forMatch = await door.load(matchedLookup);   // coverage `fr-FR`

    // **DEGENERATE-SET GATE.** Everything else about these two values must be equal, or the four cells
    // below are not attributable to the coverage record. Asserted before the cells, and loudly.
    assert.notEqual(forDirect.coverage.lookupLocale, forMatch.coverage.lookupLocale);
    assert.deepEqual(localesOf(forDirect), localesOf(forMatch));
    assert.deepEqual(Object.keys(forDirect.catalogs).sort(), Object.keys(forMatch.catalogs).sort());
    assert.deepEqual(plain(forDirect.catalogIdentity), plain(forMatch.catalogIdentity));
    assert.deepEqual(
      plain(forDirect.manifestLocaleConfiguration.supportedLocales),
      plain(forMatch.manifestLocaleConfiguration.supportedLocales));

    // THE FOUR CELLS. The same tag is accepted by one and refused by the other; the same match OBJECT
    // is accepted by the other and refused by the first. That pairing is what attributes the refusal
    // to the coverage record without leaning on message wording — and wording is not available here
    // anyway: `configurationError` returns a plain Error with a name and a code and no structured
    // expected/actual, so nothing in the VALUE distinguishes a coverage refusal from a
    // match-configuration one.
    const direct = (/** @type {any} */ loaded) => () => createStrings({ loaded, locale: "fr-BE" });
    const supplied = (/** @type {any} */ loaded) => () =>
      createStrings({ loaded, localeMatchResolver: () => match });

    const accepted = attempt(direct(forDirect));
    assert.equal(accepted.site, null);
    assert.equal(accepted.value, "shared fr-FR");

    const acceptedMatch = attempt(supplied(forMatch));
    assert.equal(acceptedMatch.site, null);
    assert.equal(acceptedMatch.value, "shared fr-FR");

    const crossedMatch = attempt(supplied(forDirect));
    assertRefused(crossedMatch, `${door.name}: the direct subset under the whole-list flow`);
    // THE SITE, not just the fact: a resolver door can only be refused at first use, and recording it
    // is what tells "validated on every use" apart from "validated once at construction".
    assert.equal(crossedMatch.site, "use");

    const crossedDirect = attempt(direct(forMatch));
    assertRefused(crossedDirect, `${door.name}: the whole-list subset under the direct flow`);
    assert.equal(crossedDirect.site, "use");

    // **THE FIFTH PAIRING, and it is the only one where the coverage record describes a genuinely
    // SMALLER fetch.** `fetchSet("fr-BE")` happens to be the entire manifest's `fr`/`en` reach, so the
    // four cells above prove non-interchangeability of the FIELD; `ja` holds one catalog of five, and
    // ties the refusal to subsetting rather than to a label.
    const forJa = await door.load("ja");
    assert.ok(Object.keys(forJa.catalogs).length < MANIFEST_TAGS.length);
    const jaAccepted = attempt(() => createStrings({ loaded: forJa, locale: "ja" }));
    assert.equal(jaAccepted.site, null);
    assert.equal(jaAccepted.value, "shared en");
    assertRefused(attempt(direct(forJa)), `${door.name}: fr-BE against a subset planned from ja`);
  });

  test(`12.f [${door.name}]: THE W CONTROL — whole-manifest coverage serves both flows and an arbitrary tag`, async () => {
    // **LOAD-BEARING, not ceremony.** Without it the suite could go green because some earlier guard
    // refuses `fr-FR` or the match object outright — the trap this project has hit three times in two
    // days. Byte-identical inputs pass here, so the refusals above are the coverage rule and nothing
    // else. The `de-CH` cell is plan 3.4:853 / 6.2:2582's own row: an arbitrary direct lookup under
    // complete whole-manifest coverage.
    const whole = await door.whole();
    assert.equal(whole.coverage.kind, "entire-manifest");
    assert.equal(whole.complete, true);
    assert.deepEqual(Object.keys(whole.catalogs).sort(), MANIFEST_TAGS);

    const negotiator = createLocaleNegotiator(whole.manifestLocaleConfiguration);
    const match = negotiator.matchForLanguageRanges(parseLanguageRanges("fr-BE"));

    for (const [tag, expected] of /** @type {[string, string][]} */ ([
      ["fr-BE", "shared fr-FR"], ["fr-FR", "shared fr-FR"], ["ja", "shared en"], ["de-CH", "shared en"],
    ])) {
      const cell = attempt(() => createStrings({ loaded: whole, locale: tag }));
      assert.equal(cell.site, null, `${tag} must be accepted under whole coverage`);
      assert.equal(cell.value, expected, tag);
    }

    const viaMatch = attempt(() => createStrings({ loaded: whole, localeMatchResolver: () => match }));
    assert.equal(viaMatch.site, null);
    assert.equal(viaMatch.value, "shared fr-FR");
  });
}

// ---------------------------------------------------------------------------------------------
// The THIRD door onto the same directory, where the two preserved inputs could collapse unnoticed.
// ---------------------------------------------------------------------------------------------

test("the third door: loadStringsFromDirectory records ENTIRE-MANIFEST coverage; the raw door records none", async () => {
  // Plan 6.2:2126 — the convenience door "generates an internal manifest against the directory's own
  // `file:` URL and WHOLE-loads it" — so a lookup record here would be the cheapest possible way for
  // the two preserved inputs to collapse into one, in the surface most callers will actually reach.
  // Asserted behaviourally as well as by kind: whole coverage is what permits an arbitrary direct tag.
  const composed = await loadStringsFromDirectory(root, GENERATOR_OPTIONS);
  assert.equal(composed.coverage.kind, "entire-manifest");
  assert.equal(/** @type {any} */ (composed.coverage).lookupLocale, undefined);
  assert.deepEqual(Object.keys(composed.catalogs).sort(), MANIFEST_TAGS);
  assert.equal(createStrings({ loaded: composed, locale: "de-CH" }).get("Shared"), "shared en");

  // …and the RAW door — the port of Java's `loadFromFilesystem` — carries no coverage record at all,
  // because it has no manifest, no digest and no plan to have been planned from. It returns
  // `{catalogs, warnings}`, which LOOKS enough like a `LoadedStrings` to be mistaken for one, so the
  // assertion that matters is behavioural: construction refuses it rather than inferring a coverage.
  const raw = /** @type {any} */ (readStringsFromDirectory(root));
  assert.deepEqual(Object.keys(raw.catalogs).sort(), MANIFEST_TAGS);
  assert.equal(raw.coverage, undefined);
  assert.equal(raw.requestedFiles, undefined);
  assert.throws(() => createStrings({ loaded: raw, locale: "en" }), (error) => {
    assert.equal(/** @type {any} */ (error).name, "ConfigurationError");
    return true;
  }, "a catalog map is not a LoadedStrings and must not be treated as one");
});
