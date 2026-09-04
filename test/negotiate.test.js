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
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { createLocaleNegotiator } from "../src/negotiate/index.js";

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
    assert.equal(asLocale.languageRange, "nsl");

    const asRange = negotiator.matchForLanguageRanges([{ range: "sgn-nsl", weight: 1 }]);
    assert.equal(asRange.matchType, "canonical");
    assert.equal(asRange.languageRange, "sgn-nsl");

    // Both select the same catalog, which is why comparing only `locale` cannot see the difference.
    assert.equal(asLocale.locale, "nsl");
    assert.equal(asRange.locale, "nsl");
  });

  it("refuses as a LOCALE what it accepts as a RANGE", () => {
    assert.throws(() => negotiator.matchFor("de-*"), { name: "RangeError" });
    assert.doesNotThrow(() => negotiator.matchForLanguageRanges([{ range: "de-*", weight: 1 }]));
  });
});

describe("the pinned IANA closure, which the root graph's reduced table does not carry", () => {
  it("expands a range through the longest matching PREFIX, not by exact lookup", () => {
    // `no-bok` is not a normalized locale tag, so the reduced table inlined in `src/internal/
    // locale.js` drops it; the pinned 802-class closure keeps it, and the JDK finds it by truncating
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
    assert.equal(match.languageRange, "en");

    // Weight order, not list order — the stable weight-descending sort is what decides.
    const reversed = negotiator.matchForLanguageRanges([{ range: "en", weight: 0.5 }, { range: "fr", weight: 1 }]);
    assert.equal(reversed.locale, "fr");
    assert.equal(reversed.languageRange, "fr");
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
    assert.equal(match.languageRange, "zh");

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
    assert.equal(match.languageRange, "sgn-no");

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
    assert.equal(second.languageRange, "no-bok");

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

describe("the generated IANA closure module", () => {
  it("matches the spec's pinned artifact entry for entry", async () => {
    // Same rule as `test/locale.test.js`'s check on the reduced inline table: generated data is only
    // trustworthy while something fails on drift. `lokalized-spec` regenerates the artifact from the
    // JDK oracle, so a rebuild that changed a class must break here rather than quietly change an
    // answer. Skipped, not failed, when the sibling spec checkout is absent — a standalone clone of
    // this repo still runs its own suite.
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const path = process.env.LOKALIZED_SPEC_DIR
      ? resolve(process.env.LOKALIZED_SPEC_DIR, "generated/iana-language-range-equivalents.json")
      : resolve(new URL("../", import.meta.url).pathname, "../lokalized-spec/generated/iana-language-range-equivalents.json");

    /** @type {any} */
    let artifact = null;
    try { artifact = JSON.parse(await readFile(path, "utf8")); } catch { /* sibling absent */ }
    if (artifact === null) return;

    const { decode } = await import("../src/data/iana-range-equivalents.js");
    assert.deepEqual(
      [...decode().entries()].sort(),
      Object.entries(artifact.equivalents).sort(),
    );
    assert.equal(decode().size, 802);
  });
});
