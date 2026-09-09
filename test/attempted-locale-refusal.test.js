// @ts-check

/**
 * `TranslationResult`'s constructor validation of the ACCUMULATED attempted locales —
 * `TranslationResult.java:114-126` and `LocaleUtils.requireWellFormed` (`LocaleUtils.java:53-64`),
 * ported into the walk at `src/core/index.js` (`attemptedLocaleRefusal`).
 *
 * WHY THIS FILE EXISTS — AND THE REASON IT ORIGINALLY GAVE HAS SINCE BEEN CLOSED. The header said
 * the corpus runner could gate only PART of this behaviour, because the two ill-formed rows reported
 * `unsupported` before the port was ever run: their recorded `thrown.causeType` is
 * `java.util.IllformedLocaleException`, and `tools/conformance.mjs` read that field as if it named
 * the class of the escaping exception. It does not — it names what the escaping exception WRAPS —
 * and the runner has been fixed. All 13 corpus rows of `lokalized-spec` family
 * `lvariant-attempted-chain` are now COMPARED and all 13 pass:
 *
 *   | corpus row                                                   | conformance verdict |
 *   |---|---|
 *   | `…en-us-posix.duplicate-attempted-language-tag`              | passed |
 *   | `…ja-jp.ill-formed-attempted-locale`                         | passed |
 *   | `…th-th.ill-formed-attempted-locale`                         | passed |
 *   | the ten controls                                             | passed |
 *
 * SO THE FILE'S CLAIM IS NOW THE NARROWER, TRUER ONE: it discriminates the same behaviour at a
 * resolution the corpus does not reach, not behaviour the corpus cannot see at all. Re-measured
 * below — every ablation that costs 1–3 corpus rows costs 3–6 assertions here, and each names the
 * property that broke instead of the row that noticed.
 *
 * THE STANDARD THIS FILE IS HELD TO. Every refusal is paired with a SERVING control that differs in
 * nothing but which catalogs are loaded, because "these tags throw" is the wrong statement and a
 * port that made it would pass every refusal assertion here. The real statement is that these are
 * validations of the attempted-locale CHAIN and they bite only on the prefix the walk reaches.
 *
 * ABLATIONS RE-MEASURED against `src/core/index.js` after the runner fix, each restored afterwards,
 * each conformance exit status read from `$?` on a redirected run. Baseline: 13/13 assertions,
 * `npm run conformance` 1,960 passed / 0 FAILED, exit 0.
 *
 *   | ablation                                    | of 13 | caught by | `npm run conformance` |
 *   |---|---:|---|---|
 *   | delete the duplicate arm                    | 10/3 | the duplicate refusal, the `onFailure` row, `return-string` | 1,959/1, exit 1 — the duplicate row |
 *   | delete the well-formedness arm              | 10/3 | the two ill-formed refusals and the ORDER row | 1,958/2, exit 1 — the two ill-formed rows |
 *   | validate `chain`, not the reached prefix    | 12/1 | the serving control | 1,957/3, exit 1 (`lvariant.early-serve.*`) |
 *   | throw from the walk instead of routing it   | 11/2 | the `onFailure` row and the rethrow-by-identity row | 1,957/3, exit 1 |
 *   | drop the failure-result validation          |  7/6 | every refusal row — nothing escapes at all | 1,957/3, exit 1 |
 *
 * The SECOND row is the one that changed, and it changed in the direction that matters: it read
 * "**NO SIGNAL AT ALL** — 1,958/0 either way", which was an accurate measurement of a runner that
 * was silently declining to compare those two rows. It is now a two-row conformance failure. The
 * THIRD row is why the serving controls are here: it is the only ablation this file catches with a
 * single assertion, and it is caught by the CONTROL rather than by a refusal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStrings } from "../src/core/index.js";
import { jdkLocaleWellFormed } from "../src/internal/locale-jdk-tag.js";

/**
 * Three catalogs none of which can serve an `en`/`ja`/`th` request, so the walk runs the WHOLE
 * candidate chain and reaches the candidates Java refuses. `lokalized-spec`'s
 * `fixtures/lvariant-chain-exhausts.json`.
 */
const EXHAUSTS = { fr: { Hello: "bonjour" }, nb: { Hello: "BOKMAAL" }, nn: { Hello: "NYNORSK" } };

/**
 * The CONTROL fixture, differing in nothing but which catalogs are loaded: `en`, `ja` and `th` each
 * answer the bare-language candidate, which every chain below reaches BEFORE its refusing member.
 * `lokalized-spec`'s `fixtures/lvariant-chain-serves-early.json`.
 */
const SERVES_EARLY = {
  en: { Hello: "hello-en" },
  fr: { Hello: "bonjour" },
  ja: { Hello: "konnichiwa" },
  th: { Hello: "sawatdee" },
};

/** @param {Record<string, Record<string, string>>} strings */
const stringsFor = (strings) => createStrings({ strings, fallbackLocale: "fr", locale: "fr" });

/**
 * What one lookup did: the translation, or the error's name and message.
 *
 * @param {ReturnType<typeof createStrings>} strings
 * @param {string} locale
 */
function lookup(strings, locale) {
  try {
    return { translation: strings.get("Hello", undefined, { locale }) };
  } catch (error) {
    const raised = /** @type {Error} */ (error);
    return { name: raised.name, message: raised.message, error: raised };
  }
}

describe("attempted-locale refusals: the walk refuses where Java refuses", () => {
  it("refuses a duplicate normalized language tag among the attempted locales", () => {
    // `en-US-POSIX`'s chain is [en-US-POSIX, en-US, en, en-US-posix] plus the fallback, and the
    // FOURTH member lowercases the variant. `toLanguageTag().toLowerCase()` collides with the
    // first member's, which is the collision `TranslationResult.java:118-122` refuses. The message
    // reproduces Java's verbatim, naming the SECOND spelling — the one whose insertion failed.
    const answer = lookup(stringsFor(EXHAUSTS), "en-US-x-lvariant-POSIX");
    assert.equal(answer.name, "TypeError");
    assert.equal(answer.message, "Attempted locales must not contain duplicate language tag 'en-US-posix'");
  });

  it("refuses an attempted locale that is not a well-formed IETF BCP 47 locale (ja)", () => {
    // Java's OWN compatibility-extension synthesis builds `ja_JP_JP_#u-ca-japanese`, whose
    // lowercased twin further down the chain carries the variant `jp` — which `Locale.Builder`
    // then refuses, because its three legacy exceptions match `JP`/`TH`/`NY` by exact spelling.
    const answer = lookup(stringsFor(EXHAUSTS), "ja-JP-x-lvariant-JP");
    assert.equal(answer.name, "TypeError");
    assert.equal(
      answer.message,
      "Attempted locale 'ja-JP-u-ca-japanese-x-lvariant-jp' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("refuses an attempted locale that is not a well-formed IETF BCP 47 locale (th)", () => {
    // NOT decoration beside the `ja` row: this one carries `-u-nu-` where that one carries `-u-ca-`,
    // so a port that special-cased one keyword still refuses the other.
    const answer = lookup(stringsFor(EXHAUSTS), "th-TH-x-lvariant-TH");
    assert.equal(answer.name, "TypeError");
    assert.equal(
      answer.message,
      "Attempted locale 'th-TH-u-nu-thai-x-lvariant-th' is not a well-formed IETF BCP 47 locale",
    );
  });

  it("reports ILL-FORMEDNESS, not duplication, for a candidate that is both", () => {
    // THE ORDER ASSERTION, and the one the ablation table's second row is really about.
    // `ja-JP-u-ca-japanese-x-lvariant-jp` is ALSO a case-insensitive duplicate of candidate 0, so a
    // port that ran the duplicate check first — or ran only the duplicate check — still refuses this
    // request and still throws a `TypeError`. Java validates well-formedness BEFORE adding the
    // lowercased tag to its `LinkedHashSet`, so the message is the discriminating observation.
    for (const locale of ["ja-JP-x-lvariant-JP", "th-TH-x-lvariant-TH"]) {
      const answer = lookup(stringsFor(EXHAUSTS), locale);
      assert.match(String(answer.message), /^Attempted locale '/);
      assert.doesNotMatch(String(answer.message), /duplicate language tag/);
    }
  });
});

describe("attempted-locale refusals: the CHAIN is what is validated, not the tag", () => {
  it("serves the identical request tags when a catalog answers before the refusing candidate", () => {
    // The whole point, and the assertion a port that "fixed" this at the tag layer or at the request
    // boundary would fail. Same three tags, same code path, one difference: which catalogs exist.
    const strings = stringsFor(SERVES_EARLY);
    assert.deepEqual(lookup(strings, "en-US-x-lvariant-POSIX"), { translation: "hello-en" });
    assert.deepEqual(lookup(strings, "ja-JP-x-lvariant-JP"), { translation: "konnichiwa" });
    assert.deepEqual(lookup(strings, "th-TH-x-lvariant-TH"), { translation: "sawatdee" });
  });

  it("does not refuse a walk that merely exhausts", () => {
    // CONTROL isolating the other conjunct: `en-US` runs the same fixture to exhaustion and answers
    // the fallback, so exhaustion alone is not what refuses.
    const strings = stringsFor(EXHAUSTS);
    assert.deepEqual(lookup(strings, "en-US"), { translation: "bonjour" });
    assert.deepEqual(lookup(strings, "fr"), { translation: "bonjour" });
  });

  it("does not refuse the Norwegian bridge, whose lifted variant IS one of Java's three exceptions", () => {
    // `no-NO-x-lvariant-NY` normalizes to `nn-NO` at the tag layer, so no chain member ever carries
    // the `NY` variant — and `Locale.Builder` would accept it even if one did. Both fixtures.
    assert.deepEqual(lookup(stringsFor(EXHAUSTS), "no-NO-x-lvariant-NY"), { translation: "NYNORSK" });
    assert.deepEqual(lookup(stringsFor(SERVES_EARLY), "no-NO-x-lvariant-NY"), { translation: "bonjour" });
  });

  it("does not refuse the SELECTION channel for any of the three tags", () => {
    // AGAINST OVERCORRECTION. `getDirectLocaleContext` is the plan's counterpart to Java's
    // `matcher.matchFor(Locale)`, the operation the three `…selection-channel-does-not-refuse`
    // corpus rows exercise. It answers "which locale would a delivery have had to fetch"
    // and never walks a chain, so it cannot reach this validation. A port that refused at the tag
    // layer would break these while fixing the lookups above.
    const strings = stringsFor(EXHAUSTS);
    for (const locale of ["en-US-x-lvariant-POSIX", "ja-JP-x-lvariant-JP", "th-TH-x-lvariant-TH"]) {
      const { localeMatch } = strings.getDirectLocaleContext(locale);
      assert.equal(localeMatch.matchType, "none");
      assert.equal(localeMatch.locale, null);
    }
  });
});

describe("attempted-locale refusals: where the refusal is disposed of", () => {
  it("reports the refusal to onFailure as a RESOLUTION_FAILURE before it escapes", () => {
    // Java's `return new TranslationResult(...)` sits INSIDE the try at `DefaultStrings.java:713-726`,
    // so the constructor's exception is caught as THAT candidate's resolution failure, the walk ends,
    // and the handler is consulted exactly once with the full attempted list. A port that simply
    // threw from the walk would satisfy every assertion in the two blocks above and fail this one.
    /** @type {unknown[]} */
    const failures = [];
    const strings = createStrings({
      strings: EXHAUSTS,
      fallbackLocale: "fr",
      locale: "fr",
      onFailure: (failure) => {
        failures.push(failure);
        return { action: /** @type {const} */ ("return-key") };
      },
    });

    const answer = lookup(strings, "en-US-x-lvariant-POSIX");
    assert.equal(failures.length, 1);

    const failure = /** @type {{ reason: string, cause: Error, attemptedLocales: readonly string[] }} */
      (failures[0]);
    assert.equal(failure.reason, "resolution-failure");
    assert.deepEqual([...failure.attemptedLocales], ["en-US-POSIX", "en-US", "en", "en-US-posix", "fr"]);
    assert.equal(failure.cause.message, "Attempted locales must not contain duplicate language tag 'en-US-posix'");

    // A SECOND object, not the retained cause rethrown. `DefaultStrings.java:754/759` build the
    // handler's result outside every try and re-enter the constructor, so Java raises a fresh
    // `IllegalArgumentException` whose `getCause()` differs from the first's. The corpus records
    // that asymmetry — the `ja` row's `thrown.causeType` is `IllformedLocaleException` while its
    // `failures[0].causeType` is `IllegalArgumentException` — and it is only reproducible because
    // the port re-runs the validation at the failure-result construction rather than rethrowing.
    assert.notEqual(answer.error, failure.cause);
    assert.equal(answer.message, failure.cause.message);
  });

  it("still refuses when the handler answers return-string", () => {
    // The other constructing arm of Java's switch. `THROW_EXCEPTION` is deliberately NOT here:
    // `throwExceptionFor` (`DefaultStrings.java:3196-3213`) builds no result, so it rethrows the
    // retained cause BY IDENTITY — the assertion below, which is the opposite of the one above.
    const strings = createStrings({
      strings: EXHAUSTS,
      fallbackLocale: "fr",
      locale: "fr",
      onFailure: () => ({ action: /** @type {const} */ ("return-string"), translation: "x" }),
    });
    assert.equal(lookup(strings, "en-US-x-lvariant-POSIX").name, "TypeError");
  });

  it("rethrows the refusal by identity when the handler answers throw", () => {
    /** @type {{ cause: Error }[]} */
    const failures = [];
    const strings = createStrings({
      strings: EXHAUSTS,
      fallbackLocale: "fr",
      locale: "fr",
      onFailure: (failure) => {
        failures.push(/** @type {{ cause: Error }} */ (failure));
        return { action: /** @type {const} */ ("throw") };
      },
    });

    const answer = lookup(strings, "en-US-x-lvariant-POSIX");
    assert.equal(answer.error, failures[0]?.cause);
  });
});

describe("jdkLocaleWellFormed models Locale.Builder#setLocale, not tag well-formedness", () => {
  it("accepts every candidate of the three chains except the lowercased legacy variant", () => {
    // Every tag here is well-formed BCP 47 — that is the trap the function exists for. The refused
    // pair differ from the accepted pair in the CASE of the lifted variant and in nothing else.
    for (const tag of ["ja-JP-u-ca-japanese-x-lvariant-JP", "ja-JP-u-ca-japanese-x-lvariant",
      "ja-JP-u-ca-japanese", "ja-JP-u-ca", "ja-JP", "ja", "th-TH-u-nu-thai-x-lvariant-TH",
      "en-US-POSIX", "en-US-posix", "en-US", "en", "nn-NO", "no-NO-x-lvariant-NY", "de-1901", "fr"])
      assert.equal(jdkLocaleWellFormed(tag), true, tag);

    for (const tag of ["ja-JP-u-ca-japanese-x-lvariant-jp", "th-TH-u-nu-thai-x-lvariant-th",
      "en-US-x-lvariant-A-B", "en-x-lvariant-a"])
      assert.equal(jdkLocaleWellFormed(tag), false, tag);
  });

  it("applies the three legacy exceptions to the WHOLE variant, as setLocale does", () => {
    // `ja_JP_JP` is excused; `ja_JP_JP_POSIX` is not the same variant and is not excused. Without
    // this the exception would swallow any variant merely BEGINNING with `JP`.
    assert.equal(jdkLocaleWellFormed("ja-JP-u-ca-japanese-x-lvariant-JP"), true);
    assert.equal(jdkLocaleWellFormed("ja-JP-POSIX-x-lvariant-JP"), false);
    assert.equal(jdkLocaleWellFormed("th-TH-u-nu-thai-x-lvariant-TH"), true);
    assert.equal(jdkLocaleWellFormed("en-US-x-lvariant-JP"), false);
  });
});
