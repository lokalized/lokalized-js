// @ts-check

/**
 * `lokalized/negotiate` — the RAW RFC 4647 range ingress.
 *
 * The corpus gates most of what is here: 50 recorded `matchFor(List)` cases run through
 * `createLocaleNegotiator` in `tools/conformance.mjs`, and every one of them compares all eight
 * recorded match fields. This file is for the properties those 50 CANNOT see, verified by ablation
 * rather than assumed — each was measured by deleting the code and re-running the corpus:
 *
 *   - the grammar validator's accepting side (no recorded case is ill-formed, so a validator that
 *     rejected everything ill-formed AND a few legal ranges besides would still score 50/50 — it
 *     did, in the first draft of this slice, and the corpus caught it only because the six ranges
 *     it wrongly rejected happen to be recorded);
 *   - `weight`, which every one of the 50 spells `1`: hardcoding `effectiveWeight: 1` changes
 *     nothing in the corpus;
 *   - the 32-member cap and the explicit multi-member refusal;
 *   - the two ingresses staying apart, which is the whole subject of the slice.
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

describe("what this slice deliberately does not implement", () => {
  const negotiator = negotiatorFor({ fallbackLocale: "en", locale: "en", strings: catalog(["en", "fr"]) });

  it("refuses a multi-member request explicitly rather than answering from the first member", () => {
    // A silent single-member answer here would look right on every input where the first member wins
    // and be wrong on every input where it does not — the failure mode M7 A3 exists to remove.
    //
    // The ERROR KIND is asserted, not only the wording. Java refuses the neighbouring 33-member
    // request with `IllegalArgumentException`, which the conformance runner's `ERROR_NAME` admits
    // as `TypeError` or `RangeError`; a bare `Error` escaping through the public
    // `bestMatchForLanguageRanges` would be a kind no Java run emits, and nothing else in this
    // module throws one.
    assert.throws(
      () => negotiator.matchForLanguageRanges([{ range: "fr", weight: 1 }, { range: "en", weight: 0.5 }]),
      { name: "RangeError", message: /multi-member language-range solver is not implemented yet; received 2 ranges/ },
    );
    assert.throws(
      () => negotiator.matchForLanguageRanges([]),
      { name: "RangeError", message: /received 0 ranges/ },
    );

    // The control: one member is answered, not refused.
    assert.equal(negotiator.matchForLanguageRanges([{ range: "fr", weight: 1 }]).locale, "fr");
  });

  it("caps a public request at 32 members with Java's own message", () => {
    // Reported BEFORE the not-implemented refusal, because it is a real contract rather than a gap:
    // `browser-chooser.limit.explicit-thirty-three-ranges-rejected` records this exact message.
    const ranges = Array.from({ length: 33 }, (_, index) => ({ range: `qa${String.fromCharCode(97 + index % 26)}`, weight: 0.5 }));
    assert.throws(() => negotiator.matchForLanguageRanges(ranges),
      { name: "RangeError", message: "At most 32 language ranges are supported, but received 33" });
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
