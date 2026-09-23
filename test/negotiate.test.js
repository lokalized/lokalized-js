// @ts-check

/**
 * `lokalized/negotiate` — the RAW RFC 4647 range ingress.
 *
 * The corpus gates most of what is here: 74 recorded `matchFor(List)` cases run through
 * `createLocaleNegotiator` in `tools/conformance.mjs` (50 single-member since A2, plus A3's 24
 * multi-member arrays), and every one of them compares all eight recorded match fields. This file is
 * for the properties those 74 CANNOT see, verified by ablation rather than assumed — each was
 * measured by deleting the code and re-running the corpus:
 *
 *   - the grammar validator's accepting side (no recorded case is ill-formed, so a validator that
 *     rejected everything ill-formed AND a few legal ranges besides would still score 50/50 — it
 *     did, in the first draft of this slice, and the corpus caught it only because the six ranges
 *     it wrongly rejected happen to be recorded);
 *   - `weight`, which every one of the 50 spells `1`: hardcoding `effectiveWeight: 1` changes
 *     nothing in the corpus;
 *   - the 32-member cap, and the empty list being ANSWERED rather than refused;
 *   - the two ingresses staying apart, which was the whole subject of A2;
 *   - the two N-member solver rules ablation shows the corpus is blind to: the anchor-owning half of
 *     `restrictedHeuristicRangeIndices`, and `selectionIndexByLocale`'s own-position arm. Both were
 *     ablated (corpus unchanged at 1,411 passed / 0 FAILED) and then measured against unmodified
 *     lokalized-java 3.0.0 on the pinned Corretto 21, so what they assert is a Java RUN.
 *
 * Each check below is a PAIR wherever a pair exists: a half that must fail beside a control that
 * must pass. A probe with no passing control confirms checks it never reached.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { createLocaleNegotiator, forAcceptLanguage, parseLanguageRanges } from "../src/negotiate/index.js";
import { decodeLanguageEquivalents } from "../src/data/iana-range-equivalents.js";
import { decodeRegionVariantEquivalents } from "../src/data/iana-identity-equivalents.js";
import { normalizeTag } from "../src/internal/locale.js";
import { IANA_EQUIVALENCES_ARTIFACT, specPath } from "../tools/iana-artifact.mjs";

/** The full registry language table, read once: several checks below walk all of it. */
const LANGUAGE_EQUIVALENTS = decodeLanguageEquivalents();

/** @param {Record<string, unknown>} options */
const negotiatorFor = (options) => createLocaleNegotiator(
  createStrings(/** @type {any} */ ({ ...options, strings: options.strings })).getLocaleConfiguration());

const catalog = (/** @type {string[]} */ tags) =>
  Object.fromEntries(tags.map((tag) => [tag, { GREETING: tag }]));

describe("createLocaleNegotiator — the applicable configuration", () => {
  it("takes the configuration a Strings reports, fallback already resolved", () => {
    const strings = createStrings({ fallbackLocale: "en", locale: "en", strings: catalog(["de", "en", "fr"]) });
    const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());
    assert.equal(negotiator.bestMatchForLanguageRanges([{ range: "fr", weight: 1 }]), "fr");
  });

  it("refuses a hand-built configuration whose fallback names no supported locale", () => {
    assert.throws(
      () => createLocaleNegotiator({ fallbackLocale: "es", supportedLocales: ["de", "en"] }),
      { name: "RangeError", message: /Fallback locale 'es' is not one of the supported locales/ },
    );

    // The control that must PASS, so the refusal above is known to be about the fallback rather than
    // about hand-built configurations in general.
    const negotiator = createLocaleNegotiator({ fallbackLocale: "en", supportedLocales: ["de", "en"] });
    assert.equal(negotiator.bestMatchForLanguageRanges([{ range: "de", weight: 1 }]), "de");
  });
});

describe("the RFC 4647 extended-range grammar", () => {
  const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en"]) });
  const match = (/** @type {string} */ range) =>
    negotiator.matchForLanguageRanges([{ range, weight: 1 }]);

  it("ACCEPTS every legal range the JDK accepts, including one-character alpha subtags", () => {
    // The controls that must pass. `Locale.LanguageRange`'s own check is length + character class
    // with `*` as an early accept — it does NOT require a one-character subtag to be `*`. Reading
    // the ABNF as though it did rejects all six of these, and all six are recorded corpus answers.
    for (const range of ["*", "de-*", "*-ch", "x-*", "x-lokal", "x-foo-*", "sgn-be-fr-x-a",
      "en-ab12", "prs-1a", "zh-guoyu-tw", "de-*-phonebk", "en-latn-us"])
      assert.doesNotThrow(() => match(range), `${range} is a well-formed extended language range`);
  });

  it("REJECTS an ill-formed range with Java's own message, naming the lowercased range", () => {
    // `range=` + the lowercased spelling, which is what `browser-chooser.malformed.*` records.
    assert.throws(() => match("notaheader!"), { name: "RangeError", message: "range=notaheader!" });
    assert.throws(() => match(""), { name: "RangeError", message: "range=" });
    assert.throws(() => match("fr-"), { name: "RangeError", message: "range=fr-" });
    assert.throws(() => match("abcdefghi"), { name: "RangeError", message: "range=abcdefghi" });
    assert.throws(() => match("EN-Ab_12"), { name: "RangeError", message: "range=en-ab_12" });

    // The control: nine characters is too long, eight is not.
    assert.doesNotThrow(() => match("abcdefgh"));
  });

  it("refuses a range of hyphens only with Java's out-of-bounds message, at both doors", () => {
    // `String#split("-")` drops trailing empties, so `-` leaves NO subtags and Java's `subtags[0]`
    // throws `ArrayIndexOutOfBoundsException` before any grammar rule runs. This port said
    // `range=-` until A30; lokalized-spec's model (whose answer the spec's JDK check measured the
    // library giving) is what `test/iana-model-parity.test.js` found it disagreeing with. No corpus
    // case carries such a range.
    const outOfBounds = { name: "RangeError", message: "Index 0 out of bounds for length 0" };
    for (const range of ["-", "---"]) {
      assert.throws(() => match(range), outOfBounds, `${range} at the object door`);
      assert.throws(() => parseLanguageRanges(range), outOfBounds, `${range} at the header door`);
    }
    // The controls: an EMPTY range still splits to one empty subtag (Java's no-match special case),
    // and a leading hyphen still leaves a subtag, so both are the grammar's refusal.
    assert.throws(() => parseLanguageRanges(""), { name: "RangeError", message: "range=" });
    assert.throws(() => match("-a"), { name: "RangeError", message: "range=-a" });
    // And the fail-soft door still answers the fallback for it.
    assert.equal(createLocaleNegotiator({ supportedLocales: ["en", "fr"], fallbackLocale: "en" })
      .bestMatchForAcceptLanguage("-"), "en");
  });

  it("rejects a weight outside 0.0..1.0 and accepts the endpoints", () => {
    assert.throws(() => negotiator.matchForLanguageRanges([{ range: "en", weight: 1.5 }]),
      { name: "RangeError", message: 'weight=1.5 for language range "en". It must be between 0.0 and 1.0.' });
    assert.doesNotThrow(() => negotiator.matchForLanguageRanges([{ range: "en", weight: 0 }]));
    assert.doesNotThrow(() => negotiator.matchForLanguageRanges([{ range: "en", weight: 1 }]));
  });
});

describe("the member weight, which no recorded case varies", () => {
  const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en", "fr"]) });

  it("reports the member's own weight as the effective weight", () => {
    // Hardcoding `effectiveWeight: 1` leaves all 50 corpus cases green; this is what sees it.
    assert.equal(negotiator.matchForLanguageRanges([{ range: "fr", weight: 0.5 }]).effectiveWeight, 0.5);
    assert.deepEqual(negotiator.matchForLanguageRanges([{ range: "fr", weight: 0.5 }]).requestedLanguageRanges,
      [{ range: "fr", weight: 0.5 }]);
  });

  it("selects nothing at weight zero, and the SAME range at any positive weight matches", () => {
    // `DefaultStrings:1762` drops a locale whose governing range is nonpositive and `:1780` answers
    // no-match when the highest effective weight is; reduced to one member the pair means a
    // nonpositive range selects nothing however exactly a locale matches it. The control is the
    // identical range at a positive weight, so the refusal is known to be about the weight.
    const excluded = negotiator.matchForLanguageRanges([{ range: "fr", weight: 0 }]);
    assert.equal(excluded.matchType, "none");
    assert.equal(excluded.locale, null);
    assert.equal(excluded.isMatch, false);
    assert.equal(excluded.effectiveWeight, null);

    const included = negotiator.matchForLanguageRanges([{ range: "fr", weight: 0.1 }]);
    assert.equal(included.locale, "fr");
  });
});

describe("the wildcard preference", () => {
  it("prefers the configured fallback over the first survivor for a bare wildcard", () => {
    // `preferredLocaleForWildcard` (`DefaultStrings:1955`), which is NOT `preferredLocaleForRange`:
    // a wildcard expresses no language of its own, so the configured fallback speaks for the caller.
    // `de` sorts first among the supported tags, so "first survivor" would answer `de` here.
    const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["de", "en", "fr"]) });
    assert.equal(negotiator.matchForLanguageRanges([{ range: "*", weight: 1 }]).locale, "en");
    assert.equal(negotiator.matchForLanguageRanges([{ range: "*", weight: 1 }]).matchType, "wildcard");

    // The control that must answer the OTHER way: with no wildcard, `de` is chosen by the range.
    assert.equal(negotiator.matchForLanguageRanges([{ range: "de", weight: 1 }]).locale, "de");
  });

  it("keeps a noninitial wildcard structural — it never broadens to a heuristic match", () => {
    // `de-*` against a catalog with no German at all must answer NONE rather than reaching `en`
    // through likely-subtag or primary-language inference. The control is the same catalog and a
    // wildcard-free range that DOES broaden.
    const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en", "fr-CA"]) });
    assert.equal(negotiator.matchForLanguageRanges([{ range: "de-*", weight: 1 }]).matchType, "none");
    assert.equal(negotiator.matchForLanguageRanges([{ range: "fr-ca", weight: 1 }]).isMatch, true);
  });
});

describe("the two ingresses are separate, and must stay separate", () => {
  const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en", "nsl"]) });

  it("normalizes a LOCALE and never a RANGE", () => {
    // The regression guard for A1, stated as the pair that separates the two doors. `sgn-nsl` is a
    // legal locale tag that `Locale#toLanguageTag` collapses to `nsl`, and a legal RFC 4647 range
    // that Java leaves alone. Routing the range ingress through the locale one — which is exactly
    // what the port did before this slice — turns the second row into the first.
    const asLocale = negotiator.matchFor("sgn-nsl");
    assert.equal(asLocale.matchType, "exact");
    assert.deepEqual(asLocale.languageRange, { range: "nsl", weight: 1 });

    const asRange = negotiator.matchForLanguageRanges([{ range: "sgn-nsl", weight: 1 }]);
    assert.equal(asRange.matchType, "canonical");
    assert.deepEqual(asRange.languageRange, { range: "sgn-nsl", weight: 1 });

    // Both select the same catalog, which is why comparing only `locale` cannot see the difference.
    assert.equal(asLocale.locale, "nsl");
    assert.equal(asRange.locale, "nsl");
  });

  it("refuses as a LOCALE what it accepts as a RANGE", () => {
    assert.throws(() => negotiator.matchFor("de-*"), { name: "RangeError" });
    assert.doesNotThrow(() => negotiator.matchForLanguageRanges([{ range: "de-*", weight: 1 }]));
  });
});

describe("the full IANA table, which the root graph's direct-match projection does not carry", () => {
  it("expands a range through the longest matching PREFIX, not by exact lookup", () => {
    // `no-bok` is not a normalized locale tag, so the root's direct-match projection drops it; the
    // full registry table behind this subpath keeps it, and the parse finds it by truncating
    // `no-bok-no` one subtag at a time. Without the prefix walk the range expands to nothing and
    // `nb-NO` is unreachable. Corpus case `m3b-canonicalization.compound-alias-no-bok`.
    const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en", "nb-NO"]) });
    const match = negotiator.matchForLanguageRanges([{ range: "no-bok-no", weight: 1 }]);
    assert.equal(match.locale, "nb-NO");
    assert.equal(match.matchType, "canonical");

    // The control that must NOT expand: a range with no equivalence class stays itself.
    assert.equal(negotiator.matchForLanguageRanges([{ range: "zz-bok-no", weight: 1 }]).matchType, "none");
  });
});

describe("the N-member solver's contract at this door", () => {
  const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en", "fr"]) });

  it("answers a multi-member request instead of refusing it", () => {
    // Until M7 A3 this door threw `The multi-member language-range solver is not implemented yet`.
    // The assertion is kept, inverted, so a regression that reinstated the refusal fails here rather
    // than only in the corpus: `matchForRanges` now serves the whole list.
    const match = negotiator.matchForLanguageRanges([{ range: "fr", weight: 0.5 }, { range: "en", weight: 1 }]);
    assert.equal(match.locale, "en");
    assert.equal(match.effectiveWeight, 1);
    assert.deepEqual(match.languageRange, { range: "en", weight: 1 });

    // Weight order, not list order — the stable weight-descending sort is what decides.
    const reversed = negotiator.matchForLanguageRanges([{ range: "en", weight: 0.5 }, { range: "fr", weight: 1 }]);
    assert.equal(reversed.locale, "fr");
    assert.deepEqual(reversed.languageRange, { range: "fr", weight: 1 });
  });

  it("answers the EMPTY list as a no-match rather than refusing it", () => {
    // `DefaultStrings:1557` short-circuits before it looks at a locale, which is why the result
    // still reports every supported locale. Corpus row
    // `browser-chooser.shape.empty-range-list-yields-no-match`.
    const match = negotiator.matchForLanguageRanges([]);
    assert.equal(match.matchType, "none");
    assert.equal(match.locale, null);
    assert.equal(match.effectiveWeight, null);
    assert.deepEqual(match.requestedLanguageRanges, []);
    assert.deepEqual(match.consideredLocales, ["en", "fr"]);
  });

  it("caps a public request at 32 members with Java's own message", () => {
    // Reported BEFORE anything is matched: `browser-chooser.limit.explicit-thirty-three-ranges-rejected`
    // records this exact message, and as of A3 that row runs through this cap rather than being
    // routed away by the runner.
    const ranges = Array.from({ length: 33 }, (_, index) => ({ range: `qa${String.fromCharCode(97 + index % 26)}`, weight: 0.5 }));
    assert.throws(() => negotiator.matchForLanguageRanges(ranges),
      { name: "RangeError", message: "At most 32 language ranges are supported, but received 33" });

    // The control that must PASS: 32 exactly is accepted whole, never truncated.
    assert.equal(negotiator.matchForLanguageRanges(ranges.slice(0, 32)).matchType, "none");
  });
});

describe("EXTENDED_RANGE is re-derived per selected locale, never mapped from the governor", () => {
  // `DefaultStrings#localeMatch:1942` states it outright: the public match type is NOT the governor's
  // internal category. `en-latn` matches `en-Latn-US` through the DIRECT_STRUCTURAL cell — the same
  // category a wildcard range produces — and must still report LIKELY_SUBTAG, because
  // `languageRangeMatchTypeFor` re-derives from the range's own shape. A solver that mapped
  // DIRECT_STRUCTURAL to `extended-range` would pass every wildcard case and get this one wrong.
  //
  // Both halves measured on unmodified lokalized-java 3.0.0 on the pinned Corretto 21:
  // LIKELY_SUBTAG / en-Latn-US and EXTENDED_RANGE / en-Latn-US respectively.
  const negotiator = negotiatorFor({
    fallbackLocale: "fr",
    locale: "fr",
    strings: catalog(["en-Latn-US", "fr"]),
  });

  it("reports the derived nature of a WILDCARD-FREE structural match", () => {
    const match = negotiator.matchForLanguageRanges([{ range: "en-latn", weight: 1 }]);
    assert.equal(match.matchType, "likely-subtag");
    assert.equal(match.locale, "en-Latn-US");

    // Unchanged when a second, lower-weight member is present: the type follows the SELECTED
    // locale's governor, not the serving position.
    const withSecond = negotiator.matchForLanguageRanges(
      [{ range: "en-latn", weight: 1 }, { range: "fr", weight: 0.5 }]);
    assert.equal(withSecond.matchType, "likely-subtag");
    assert.equal(withSecond.locale, "en-Latn-US");
  });

  it("still reports EXTENDED_RANGE where the range actually carries a wildcard — the control", () => {
    const match = negotiator.matchForLanguageRanges([{ range: "en-*-us", weight: 1 }]);
    assert.equal(match.matchType, "extended-range");
    assert.equal(match.locale, "en-Latn-US");
  });
});

describe("the two solver rules the corpus cannot check", () => {
  // BOTH of these were ABLATED and both left the corpus at 1,411 passed / 0 FAILED, which is why
  // they are pinned here instead. Neither answer below is an argument from the Java source: each was
  // then run against unmodified lokalized-java 3.0.0 on the pinned Corretto 21 (a `Strings` built
  // over the same catalogs, calling the same `matchFor(List<LanguageRange>)`), and the Java run is
  // what these assertions record. Each pair carries a control expected to pass, because an input
  // rejected by an earlier guard would confirm a rule it never reached.

  it("a range that OWNS AN ANCHOR does not also spill into a sibling locale", () => {
    // `restrictedHeuristicRangeIndices` (`DefaultStrings:1687`) holds anchor-OWNING representatives
    // as well as specific-heuristic ones. `cmn` owns an anchor on `zh` — `zh` is one of its IANA
    // identities, so the cell is CANONICAL — and it is ALSO likely-subtag related to `cmn-Hans`.
    // Restricted, it governs only what it claimed, `cmn-Hans` is left ungoverned, and the answer is
    // the exact `zh` at the group's own member.
    //
    // Implemented as nothing but `recognizedDepth > 1` — which is all the single-member reduction
    // ever needed, since one member has no sibling to spill into — `cmn` is unrestricted, its
    // LIKELY_SUBTAG cell claims `cmn-Hans`, and the answer becomes `likely-subtag`/`cmn-Hans`.
    // MEASURED on the pinned JDK: Java answers EXACT / zh / 1.0 / range=zh.
    const negotiator = negotiatorFor({
      fallbackLocale: "en",
      locale: "en",
      strings: catalog(["cmn-Hans", "en", "zh"]),
      tiebreakers: { zh: ["zh", "cmn-Hans"] },
    });

    const match = negotiator.matchForLanguageRanges([{ range: "cmn", weight: 1 }, { range: "zh", weight: 1 }]);
    assert.equal(match.matchType, "exact");
    assert.equal(match.locale, "zh");
    assert.deepEqual(match.languageRange, { range: "zh", weight: 1 });

    // The two controls that must PASS, each measured on the same JDK run. They are what proves the
    // pair above is about the anchor-owning restriction and not about the fixture: with one member
    // there is nothing to restrict, and both single-member answers are unchanged by the ablation.
    const cmnAlone = negotiator.matchForLanguageRanges([{ range: "cmn", weight: 1 }]);
    assert.equal(cmnAlone.matchType, "canonical");
    assert.equal(cmnAlone.locale, "zh");

    const zhAlone = negotiator.matchForLanguageRanges([{ range: "zh", weight: 1 }]);
    assert.equal(zhAlone.matchType, "exact");
    assert.equal(zhAlone.locale, "zh");
  });

  it("a SYNTACTIC non-semantic governor selects at its own member position", () => {
    // `selectionIndexByLocale` (`DefaultStrings:1772`). `sgn-no` and `nsl` are one IANA group whose
    // representative is `sgn-no`; CLDR maps `sgn-NO` to `nsi`, so the group's SEMANTIC member stays
    // the representative and `nsl` is not it. `nsl` nevertheless governs the `nsl` catalog through
    // an EXACT — a SYNTACTIC — cell, so it selects at its OWN index (1), not the group's (0). The
    // two survivors therefore sit in different buckets and the earlier bucket, the representative's,
    // is served first: `sgn-no` reaches `nsi-Latn-DE` by likely subtag.
    //
    // Collapse the arm to `representativeIndex` — the shape a reader who saw only the "select at the
    // group's first-member position" half would write — and both survivors bucket at 0, where
    // `sgn-no`'s identity loop finds the exact `nsl` first and the answer becomes `exact`/`nsl`.
    // MEASURED on the pinned JDK: Java answers LIKELY_SUBTAG / nsi-Latn-DE / 1.0 / range=sgn-no.
    const negotiator = negotiatorFor({
      fallbackLocale: "en",
      locale: "en",
      strings: catalog(["en", "nsi-Latn-DE", "nsl"]),
    });

    const match = negotiator.matchForLanguageRanges([{ range: "sgn-no", weight: 1 }, { range: "nsl", weight: 1 }]);
    assert.equal(match.matchType, "likely-subtag");
    assert.equal(match.locale, "nsi-Latn-DE");
    assert.deepEqual(match.languageRange, { range: "sgn-no", weight: 1 });

    // A second witness on unrelated data, so the rule is not pinned to one alias table: `no-bok` and
    // `nb` are one group whose semantic range is `nb`, and `nb` governs the `nb` catalog exactly.
    // Java: CLDR_FALLBACK / no / 1.0 / range=no-bok; collapsed, `exact`/`nb`.
    const norwegian = negotiatorFor({
      fallbackLocale: "nb",
      locale: "nb",
      strings: catalog(["en", "nb", "no"]),
    });

    const second = norwegian.matchForLanguageRanges([{ range: "no-bok", weight: 1 }, { range: "nb", weight: 1 }]);
    assert.equal(second.matchType, "cldr-fallback");
    assert.equal(second.locale, "no");
    assert.deepEqual(second.languageRange, { range: "no-bok", weight: 1 });

    // The controls that must PASS. Each single-member request answers identically under both arms —
    // with one member the governor IS the representative — so a build that collapsed the arm still
    // passes these, which is exactly what makes them controls rather than more of the same check.
    assert.equal(negotiator.matchForLanguageRanges([{ range: "nsl", weight: 1 }]).matchType, "exact");
    assert.equal(negotiator.matchForLanguageRanges([{ range: "nsl", weight: 1 }]).locale, "nsl");
    assert.equal(norwegian.matchForLanguageRanges([{ range: "nb", weight: 1 }]).matchType, "exact");
    assert.equal(norwegian.matchForLanguageRanges([{ range: "no-bok", weight: 1 }]).matchType, "canonical");
    assert.equal(norwegian.matchForLanguageRanges([{ range: "no-bok", weight: 1 }]).locale, "nb");
  });
});

describe("the generated IANA language table module", () => {
  /**
   * Generated data is only trustworthy while something fails on drift. `tools/gen-iana-data.js
   * --check` (run by `test/generated-data.test.js`) proves the module decodes back to the artifact it
   * was generated from; this proves the DECODED table is the artifact's classes read the way the spec
   * says a consumer reads them — each member's equivalents are its class minus itself, order kept —
   * so a change to the decode rule, and not only to the data, breaks here.
   *
   * SKIPPED, visibly, when the sibling spec checkout is absent: a standalone clone of this repository
   * still runs its own suite, and CI fails on any skip, so the skip cannot hide there. (It used to
   * RETURN early instead, which reported a pass over a check that never ran.)
   */
  const artifactPath = specPath(IANA_EQUIVALENCES_ARTIFACT);
  const skip = existsSync(artifactPath) ? false : `lokalized-spec not found at ${artifactPath}`;

  it("IS the spec artifact: every member to its class minus itself, in class order", { skip }, () => {
    /** @type {{ languageEquivalenceClasses: string[][], regionVariantEquivalents: [string, string][] }} */
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const expected = new Map();
    for (const members of artifact.languageEquivalenceClasses)
      for (const key of members) expected.set(key, members.filter((member) => member !== key));

    assert.ok(expected.size > 0, "the artifact carries no language class; the reader is looking at the wrong file");
    assert.deepEqual([...LANGUAGE_EQUIVALENTS.entries()].sort(), [...expected.entries()].sort());
    assert.deepEqual(decodeRegionVariantEquivalents(), artifact.regionVariantEquivalents,
      "the region/variant substitutions differ from the artifact's, in content or ORDER");
  });

  it("carries region/variant substitutions closed under reversal, one per subtag", () => {
    const pairs = decodeRegionVariantEquivalents();
    assert.ok(pairs.length > 0);
    assert.equal(new Set(pairs.map(([from]) => from)).size, pairs.length, "a subtag is substituted twice");
    for (const [from, to] of pairs)
      assert.ok(pairs.some(([back, forth]) => back === to && forth === from), `${from} -> ${to} has no reverse`);
  });
});

/**
 * M7 A4's header parser, AS AMENDED BY A30: `parseLanguageRanges` is lokalized-java 3.1.0's
 * `LocaleMatcher#parseLanguageRanges` on the default `IANA_REGISTRY` setting — the JDK's
 * `LanguageRange.parse` grammar over the pinned registry's language table.
 *
 * `test/iana-model-parity.test.js` holds it to lokalized-spec's executable model over the spec's whole
 * probe space, and `tools/language-range-diff/` holds it to lokalized-java itself on the pinned JDK.
 * What lives here are named rows a reader can check by eye, the properties of the doors ABOVE the
 * parser, which have no JDK counterpart because `bestMatchForAcceptLanguage` is lokalized's own
 * method, and the region/variant rows that must stay green inside `npm test` because neither
 * differential runs in `verify` without its oracle.
 *
 * Every ablation named below was measured by making the edit and re-running, not reasoned about.
 */
describe("parseLanguageRanges — one registry parse, at every door", () => {
  it("parses every registry subtag into its class, in parse's insertion order", () => {
    // TOTAL, not a sample. `parse(K)` places `K` first and inserts each other member at index 1 in
    // class order, so the list is `K` followed by the others REVERSED. Keys whose class carries a
    // region/variant subtag are excluded because their substitutions interleave (the rows below pin
    // those); the exclusion is DERIVED from the pairs, not listed, and bounded so it cannot swallow
    // the table.
    const subtags = decodeRegionVariantEquivalents().map(([from]) => from);
    const substitutable = (/** @type {string} */ member) =>
      subtags.some((subtag) => `${member}-`.includes(`${subtag}-`));

    const wrong = [];
    const excluded = [];
    for (const [key, others] of LANGUAGE_EQUIVALENTS) {
      const actual = parseLanguageRanges(key).map((member) => member.range);
      if ([key, ...others].some(substitutable)) {
        excluded.push(key);
        // Still a SUPERSET: every class member is reached even where substitutions interleave.
        if (![key, ...others].every((member) => actual.includes(member))) wrong.push([key, actual]);
        continue;
      }
      if (JSON.stringify(actual) !== JSON.stringify([key, ...[...others].reverse()])) wrong.push([key, actual]);
    }

    assert.deepEqual(wrong, [], "registry subtags whose parse is not their class in insertion order");
    assert.ok(excluded.length * 10 < LANGUAGE_EQUIVALENTS.size,
      `${excluded.length} of ${LANGUAGE_EQUIVALENTS.size} keys excluded as region/variant-bearing; ` +
      "the probe is being emptied by its own exclusion");
  });

  /**
   * **THE ONE DELIBERATE CHANGE A30 MADE TO A DEFAULT ANSWER, pinned at every door.**
   *
   * Until 1.0.0-rc.1 the public parse modelled the JDK's `LanguageRange.parse`, which on JDK 21 has no
   * `yol`/`enm` class, while the header door and the identity channel already read the registry. The
   * corpus now records the public parse EXPANDING: `iana-equivalence.registry-gap.yol-ranges` answers
   * EXACT on `enm` over `[yol, enm]` (it answered CANONICAL over `[yol]` before A30), and
   * `.yol-explicit-ranges` keeps the caller-built one-range list answering CANONICAL. Both are
   * asserted here because they diverge on `matchType` and the echoed ranges while selecting the SAME
   * locale — asserting the locale alone would make this test vacuous.
   */
  it("expands yol at the public parse, the header door, and in a list built from the public parse", () => {
    const negotiator = createLocaleNegotiator({ supportedLocales: ["en", "enm"], fallbackLocale: "en" });

    assert.deepEqual(LANGUAGE_EQUIVALENTS.get("yol"), ["enm"], "yol is the probe this test is built on");
    assert.deepEqual(parseLanguageRanges("yol"), [{ range: "yol", weight: 1 }, { range: "enm", weight: 1 }]);

    // A list the CALLER built with the public parse: the equivalent is a second REQUESTED range and
    // the match is exact against it — the rebuilt corpus answer.
    const parsed = negotiator.matchForLanguageRanges(parseLanguageRanges("yol"));
    assert.equal(parsed.locale, "enm");
    assert.equal(parsed.matchType, "exact");
    assert.deepEqual(parsed.requestedLanguageRanges, [{ range: "yol", weight: 1 }, { range: "enm", weight: 1 }]);

    // The header door parses the same way.
    const header = forAcceptLanguage(negotiator, "yol").localeMatch;
    assert.equal(header.matchType, "exact");
    assert.deepEqual(header.requestedLanguageRanges, parsed.requestedLanguageRanges);

    // A caller who writes the ONE range object reaches the same catalog through the identity channel
    // instead — CANONICAL over the single range it was given.
    const explicit = negotiator.matchForLanguageRanges([{ range: "yol", weight: 1 }]);
    assert.equal(explicit.locale, "enm");
    assert.equal(explicit.matchType, "canonical");
    assert.deepEqual(explicit.requestedLanguageRanges, [{ range: "yol", weight: 1 }]);

    // THE CONTROL: a class every JDK also carries expands the same way, so the rows above are about
    // the registry table rather than about expansion in general.
    assert.deepEqual(parseLanguageRanges("in"), [{ range: "in", weight: 1 }, { range: "id", weight: 1 }]);
  });

  /**
   * **EVERY CLASS, not the one the walkthrough above uses.** The twelve JDK-21-absent tags (`bh`,
   * `bih`, `dyl`, `enm`, `mgp`, `mrd`, `mrh`, `sgn-dyl`, `sgn-zhk`, `shl`, `yol`, `zhk`) are not
   * named anywhere in this file: a regression to a JDK-shaped table withholds some classes, and
   * walking all of them is what finds it without knowing which.
   */
  it("expands every registry class at the public parse and through the identity channel", () => {
    const notParsed = [];
    const notMatched = [];
    const collapsed = [];
    let probed = 0;

    for (const [tag, others] of LANGUAGE_EQUIVALENTS) {
      const parsed = parseLanguageRanges(tag).map((member) => member.range);
      if (!others.every((other) => parsed.includes(other))) notParsed.push([tag, parsed]);

      // **A MEMBER THAT COLLAPSES ONTO THE TAG UNDER `normalizeTag` CANNOT BE PROBED THROUGH A
      // CATALOG SET, and the exclusion is derived rather than named.** `ar-aao` normalizes to `aao`
      // and `sgn-dyl` to `dyl`, so a fixture offering both offers ONE locale and the match is exact
      // by accident. Most classes are extlang or grandfathered pairs of exactly that kind; the probe
      // takes the first member that stays distinct, and a class with none is recorded, not dropped.
      const partner = others.find((other) => normalizeTag(other) !== normalizeTag(tag));
      if (partner === undefined) { collapsed.push(tag); continue; }

      // A fallback that shares no language with the pair, so a CLDR-fallback answer cannot pass for
      // the IANA equivalence (`en-gb-oxendict` over `[en, en-gb-oed]` answers `en` for that reason).
      const fallback = tag.startsWith("en") || partner.startsWith("en") ? "fr" : "en";
      const match = createLocaleNegotiator({ supportedLocales: [fallback, partner], fallbackLocale: fallback })
        .matchForLanguageRanges([{ range: tag, weight: 1 }]);
      if (match.locale !== normalizeTag(partner)) notMatched.push([tag, partner, match.locale]);
      probed += 1;
    }

    assert.deepEqual(notParsed, [], "registry subtags whose public parse omits a class member");
    assert.deepEqual(notMatched, [], "registry subtags the identity channel failed to match to a class member");
    // The probed share is asserted, so an exclusion that grew to swallow the table cannot leave both
    // comparisons above trivially empty. MEASURED 267 of 781 probed, 514 collapsing.
    assert.ok(probed * 4 > LANGUAGE_EQUIVALENTS.size,
      `only ${probed} of ${LANGUAGE_EQUIVALENTS.size} registry subtags could be probed through a catalog set`);
    for (const tag of collapsed)
      for (const other of /** @type {string[]} */ (LANGUAGE_EQUIVALENTS.get(tag)))
        assert.equal(normalizeTag(other), normalizeTag(tag), `${tag} was excluded and ${other} does not collapse onto it`);
  });

  /**
   * **THE PREFIX WALK SUBSTITUTES UNDER A SUFFIX**, which is what a real `Accept-Language` carries.
   * A walk that only consulted the table when the prefix IS the whole range passes every bare-tag
   * probe above and misses these.
   */
  it("substitutes a registry prefix under a suffix", () => {
    assert.deepEqual(parseLanguageRanges("yol-x-a"),
      [{ range: "yol-x-a", weight: 1 }, { range: "enm-x-a", weight: 1 }]);
    assert.deepEqual(parseLanguageRanges("in-x-a"),
      [{ range: "in-x-a", weight: 1 }, { range: "id-x-a", weight: 1 }]);
  });

  it("applies the region/variant map, which no corpus row can see", () => {
    // The gap A4 closed. All fourteen substitutions, now read from the spec artifact's
    // `regionVariantEquivalents` (A30) rather than a source literal; M7-PLAN.md enumerated thirteen
    // and this module's own earlier note named the wrong fourteenth, which is why every pair is a row.
    const ranges = (/** @type {string} */ header) => parseLanguageRanges(header).map((m) => m.range);

    assert.deepEqual(ranges("de-DE"), ["de-de", "de-dd"]);
    assert.deepEqual(ranges("de-DD"), ["de-dd", "de-de"]);
    assert.deepEqual(ranges("fr-FR"), ["fr-fr", "fr-fx"]);
    assert.deepEqual(ranges("fr-FX"), ["fr-fx", "fr-fr"]);
    assert.deepEqual(ranges("en-BU"), ["en-bu", "en-mm"]);
    assert.deepEqual(ranges("en-MM"), ["en-mm", "en-bu"]);
    assert.deepEqual(ranges("en-TL"), ["en-tl", "en-tp"]);
    assert.deepEqual(ranges("en-TP"), ["en-tp", "en-tl"]);
    assert.deepEqual(ranges("en-YD"), ["en-yd", "en-ye"]);
    assert.deepEqual(ranges("en-YE"), ["en-ye", "en-yd"]);
    assert.deepEqual(ranges("zh-CD"), ["zh-cd", "zh-zr"]);
    assert.deepEqual(ranges("zh-ZR"), ["zh-zr", "zh-cd"]);
    assert.deepEqual(ranges("ja-heploc"), ["ja-heploc", "ja-alalc97"]);
    assert.deepEqual(ranges("ja-alalc97"), ["ja-alalc97", "ja-heploc"]);

    // The CONTROL that must produce nothing: a subtag that only LOOKS like a map key because it is a
    // substring, and one hidden behind a singleton extension where `getExtentionKeyIndex` suppresses
    // the rewrite. Without these, "the map fires" and "the map fires on everything" read the same.
    assert.deepEqual(ranges("de-deu"), ["de-deu"]);
    assert.deepEqual(ranges("de-x-fr"), ["de-x-fr"]);
    assert.deepEqual(ranges("de-Latn"), ["de-latn"]);
  });

  it("walks the map in the JDK's hash order, not its source order", () => {
    // `getEquivalentForRegionAndVariant` returns on the FIRST key that occurs in the range, so a
    // range carrying two of them answers differently under a different iteration order.
    //
    // `sgn-de-tl` IS THE DISCRIMINATOR and `sgn-de-fr` IS THE CONTROL, and the distinction was
    // measured, not assumed: sorting the table into source order leaves `sgn-de-fr` unchanged —
    // `-de` precedes `-fr` in BOTH orders — so an earlier draft of this test asserted `sgn-de-fr`
    // alone and PASSED under the ablation it was written to catch. The `zh-123` shape, in a test.
    // Hash order reaches `-tl` (position 2) before `-de` (position 8) and answers `sgn-de-tp`;
    // source order reaches `-de` (position 5) first and answers `sgn-dd-tl`.
    //
    // ABLATED (M7): source order left the corpus at 1,914 passed / 0 FAILED — it is entirely
    // corpus-invisible — and turned the JDK differential red on 88 probes and this row red on one.
    // Read the LAST member: `sgn-dd-fr` is `-de` rewritten, which means `-de` was reached before
    // `-fr`. Source order would have produced `sgn-de-fx` there instead. (The four members between
    // are `sgn-de`'s own language equivalents `gsg`/`sgn-gsg`, each with its own region rewrite —
    // `parse` applies the region map to every derived member too, which is a second thing this row
    // pins and the JDK differential confirms end to end on this exact input.)
    assert.deepEqual(parseLanguageRanges("sgn-de-tl").map((m) => m.range),
      ["sgn-de-tl", "sgn-gsg-tp", "sgn-gsg-tl", "gsg-tp", "gsg-tl", "sgn-de-tp"]);

    // The control: same shape, same two-key collision, and both orders agree on it. It is kept so
    // the row above is known to be about the ORDER rather than about two-key ranges in general.
    // (The four members between the first and last are `sgn-de`'s own language equivalents
    // `gsg`/`sgn-gsg`, each with its own region rewrite — `parse` applies the region map to every
    // derived member too, which the JDK differential confirms end to end on both inputs.)
    assert.deepEqual(parseLanguageRanges("sgn-de-fr").map((m) => m.range),
      ["sgn-de-fr", "sgn-gsg-fx", "sgn-gsg-fr", "gsg-fx", "gsg-fr", "sgn-dd-fr"]);

    // A THIRD row, because neither of the two above pins the order of the TAIL, and the table's home
    // was decided at M7 close on the strength of what actually gates it.
    //
    // MEASURED: moving `["-fr", "-fx"]` from position 12 to position 14 — a permutation that is
    // neither hash order nor source order — leaves both rows above green and the whole of
    // `test/negotiate.test.js` at exit 0, while it really does change the answer: `sgn-fx-fr` reads
    // `-fx` first and rewrites to `sgn-fr-fr` where the pinned JDK's order reads `-fr` first and
    // gives `sgn-fx-fx`. `npm run diff:language-range` catches that permutation and names it — but it
    // needs the pinned JDK and is NOT part of `npm run verify`. Since A30 `test/iana-model-parity.test.js`
    // catches it too, JDK-free, because the spec's probe space carries every ordered pair; this row is
    // kept because it names the answer a reader can check.
    //
    // Oracle-backed, not port-derived: `sgn-fx-fr` is a member of the differential's own probe space
    // (`run.mjs`'s `inputs()` emits `sgn${subtag}${second}` for every ordered pair of the fourteen),
    // so this expectation is Java's.
    assert.deepEqual(parseLanguageRanges("sgn-fx-fr").map((m) => m.range), ["sgn-fx-fr", "sgn-fx-fx"]);
  });
});

describe("parseLanguageRanges — the header grammar", () => {
  const ranges = (/** @type {string} */ header) => parseLanguageRanges(header).map((m) => m.range);
  const weighted = (/** @type {string} */ header) => parseLanguageRanges(header)
    .map((m) => `${m.range}@${m.weight}`);

  it("strips spaces GLOBALLY rather than trimming each member", () => {
    // The pair. `"not a header!"` collapses to ONE member and is refused naming the collapsed text,
    // and a TAB is not a space so it survives into the refusal. Both messages are recorded verbatim
    // at `browser-chooser.malformed.free-text` and `.horizontal-tab-ows`; a per-member trim ANSWERS
    // both instead of refusing them, so neither row alone says which rule is in force.
    assert.throws(() => parseLanguageRanges("not a header!"), { name: "RangeError", message: "range=notaheader!" });
    assert.throws(() => parseLanguageRanges("de;q=0.8,\tfr;q=0.9"), { name: "RangeError", message: "range=\tfr" });

    // The control that must PASS: spaces around a legal member are deleted, not rejected.
    assert.deepEqual(ranges(" de , fr "), ["de", "fr"]);
    assert.deepEqual(ranges("accept-language: fr,de"), ["fr", "de"]);
  });

  it("dedups on the range string, first occurrence winning the whole class", () => {
    // THE PAIR M7-PLAN.md names, and passing one half proves nothing: a group-maximum rule and a
    // last-wins rule each reproduce one of these and neither reproduces both. `he` arrives as `iw`'s
    // IANA equivalent AT `iw`'s WEIGHT, and the later explicit `he;q=0.4` is dropped entirely.
    assert.deepEqual(weighted("iw;q=0.9,he;q=0.4"), ["iw@0.9", "he@0.9"]);
    assert.deepEqual(weighted("he;q=0.4,iw;q=0.9"), ["he@0.4", "iw@0.4"]);
    assert.deepEqual(weighted("fr;q=0.5,fr;q=0.9"), ["fr@0.5"]);
  });

  it("sorts by weight with a stable insertion, and never reorders equal weights", () => {
    assert.deepEqual(weighted("de;q=0.8,fr;q=0.9,en;q=0.7"), ["fr@0.9", "de@0.8", "en@0.7"]);
    assert.deepEqual(ranges("es,fr,de"), ["es", "fr", "de"]);
    assert.deepEqual(ranges("de,fr"), ["de", "fr"]);
    assert.deepEqual(ranges("fr,de"), ["fr", "de"]);
  });

  it("splits on commas the way java.lang.String does", () => {
    // Trailing empty elements are dropped by `split`, interior ones are not — and an interior empty
    // element reaches the grammar and is refused as `range=`, which is what
    // `browser-chooser.malformed.empty-list-element` and `.blank-header` record.
    assert.deepEqual(ranges("fr,"), ["fr"]);
    assert.deepEqual(ranges(",,,"), []);
    assert.throws(() => parseLanguageRanges("fr,,de"), { name: "RangeError", message: "range=" });
    assert.throws(() => parseLanguageRanges(",fr"), { name: "RangeError", message: "range=" });
    assert.throws(() => parseLanguageRanges("   "), { name: "RangeError", message: "range=" });
  });

  it("checks the weight before the grammar, and quotes a non-numeric one", () => {
    // Two different Java messages from one `;q=` clause, and the ORDER is what picks between them:
    // `fr;q=1.5` never reaches `range=`, and `notarange!;q=abc` reports the WEIGHT rather than the
    // range even though the range is ill-formed too.
    assert.throws(() => parseLanguageRanges("fr;q=1.5"),
      { name: "RangeError", message: 'weight=1.5 for language range "fr". It must be between 0.0 and 1.0.' });
    assert.throws(() => parseLanguageRanges("fr;q=abc"),
      { name: "RangeError", message: 'weight="abc" for language range "fr"' });
    assert.throws(() => parseLanguageRanges("notarange!;q=abc"),
      { name: "RangeError", message: 'weight="abc" for language range "notarange!"' });

    // `Double.parseDouble`, not `Number()`. JavaScript reads `""` as 0 and `"0x10"` as 16 where Java
    // throws; Java reads `"1d"` where JavaScript gives NaN. Each direction is a wrong answer.
    assert.throws(() => parseLanguageRanges("fr;q="), { name: "RangeError", message: 'weight="" for language range "fr"' });
    assert.throws(() => parseLanguageRanges("fr;q=0x10"),
      { name: "RangeError", message: 'weight="0x10" for language range "fr"' });
    assert.deepEqual(weighted("fr;q=1d"), ["fr@1"]);
    assert.deepEqual(weighted("fr;q=.5"), ["fr@0.5"]);
    // `"5."` is a legal Java double and an illegal JavaScript numeric literal in this position, and
    // the message it produces is the second half of the `Double.toString` contract: Java prints
    // `5.0`, JavaScript's own `String(5)` prints `5`. The recorded `weight=1.5` row cannot see that
    // difference, because 1.5 spells the same in both.
    assert.throws(() => parseLanguageRanges("fr;q=5."),
      { name: "RangeError", message: 'weight=5.0 for language range "fr". It must be between 0.0 and 1.0.' });
  });
});

describe("bestMatchForAcceptLanguage — the fail-soft door", () => {
  const chooser = () => negotiatorFor({
    fallbackLocale: "ja", locale: "ja", strings: catalog(["de", "en", "fr", "ja"]),
  });

  it("contradicts matchForLanguageRanges on the same 33-range header, deliberately", () => {
    // THE CONTRADICTION M7-PLAN.md calls out, and the two halves must BOTH hold: this header's 13
    // members expand through the IANA table to 33 ranges. Through `matchFor(List)` that THROWS;
    // through the fail-soft door it answers the configured fallback. A single shared limit rule
    // produces one or the other, never both.
    const header = "he,id,yi,cmn,yue,nan,hak,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.1";
    assert.equal(parseLanguageRanges(header).length, 33);
    assert.throws(() => chooser().matchForLanguageRanges(parseLanguageRanges(header)),
      { name: "RangeError", message: "At most 32 language ranges are supported, but received 33" });
    assert.equal(chooser().bestMatchForAcceptLanguage(header), "ja");

    // 32 EXACTLY is accepted WHOLE, never truncated — the control that separates "refuses over 32"
    // from "keeps the first 32". A truncating door answers `fr` on the 33 header too.
    const atLimit = "he,id,yi,cmn,yue,nan,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.9,de;q=0.8,es;q=0.7,it;q=0.6";
    assert.equal(parseLanguageRanges(atLimit).length, 32);
    assert.equal(chooser().bestMatchForAcceptLanguage(atLimit), "fr");
  });

  it("applies the 4,096 code-unit cap to the RAW value, before normalization", () => {
    // The recorded pair, and NEITHER ROW ALONE DISCRIMINATES: both headers are commas with `fr` at
    // the end, and normalization deletes every comma. A cap applied after normalization sees `fr`
    // in both and answers `fr` twice; no cap at all does the same; an off-by-one loses one half.
    const atCap = `${",".repeat(4094)}fr`;
    const overCap = `${",".repeat(4095)}fr`;
    assert.equal(atCap.length, 4096);
    assert.equal(overCap.length, 4097);
    assert.equal(chooser().bestMatchForAcceptLanguage(atCap), "fr");
    assert.equal(chooser().bestMatchForAcceptLanguage(overCap), "ja");
  });

  it("treats SPACE and HTAB as OWS, and nothing else", () => {
    // The width of the OWS set, pinned from OUTSIDE by two characters that are whitespace to every
    // JavaScript idiom and are not OWS to RFC 9110. A normalizer written against `\s` or against
    // `String.prototype.trim` answers `fr` on all four of these.
    assert.equal(chooser().bestMatchForAcceptLanguage("  fr  ,  de  "), "fr");
    assert.equal(chooser().bestMatchForAcceptLanguage("\tfr\t,de;q=0.1"), "fr");
    assert.equal(chooser().bestMatchForAcceptLanguage("\nfr"), "ja");
    assert.equal(chooser().bestMatchForAcceptLanguage(" fr"), "ja");
  });

  it("answers the fallback for every unusable header, and never throws", () => {
    for (const header of [null, undefined, "", "   ", ",,,", "not a header!", "fr;q=abc", "fr;q=1.5"])
      assert.equal(chooser().bestMatchForAcceptLanguage(header), "ja", `header ${JSON.stringify(header)}`);

    // The controls that must PASS, so "never throws" is not being confirmed by a door that answers
    // the fallback unconditionally.
    assert.equal(chooser().bestMatchForAcceptLanguage("fr"), "fr");
    assert.equal(chooser().bestMatchForAcceptLanguage("fr,,de"), "fr");
    assert.equal(chooser().bestMatchForAcceptLanguage("de;q=0.8,f\tr;q=0.9"), "fr");
  });
});
