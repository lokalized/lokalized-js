// @ts-check

/**
 * The THROW response: which error escapes a lookup whose handler answered `THROW_EXCEPTION`.
 *
 * The corpus covers the outcome heavily — 116 `get`/`getResult` rows record a `thrown` block, and
 * `tools/conformance.mjs` now compares its declared name, its message where the message is the
 * library's own, and REFERENCE IDENTITY on the two arms where identity is the actual claim. What
 * lives here is what that runner structurally cannot see:
 *
 *   - THAT THE CLASS IS CATCH-ONLY. Plan 3.1 declares `MissingTranslationError` as a
 *     `CatchOnlyErrorClass`: a consumer may catch one and test `instanceof`, and may not construct
 *     one or instantiate a subclass. The corpus observes an error's name and message; it has no way
 *     to observe that a consumer cannot manufacture one, and a port that dropped the construction
 *     token would stay byte-identical across all 2,303 cases.
 *   - `code` AND `failure`. Plan 3.5 gives the class `code: "MISSING_TRANSLATION"` and a frozen
 *     `failure: TranslationFailure`. Neither is a recorded corpus field. `failure` in particular is
 *     an IDENTITY claim — plan 8.3's "identical match-object identity through result, failure and
 *     thrown-failure paths" runs through it — and a copy would satisfy every recorded field.
 *   - THE OPERAND REFUSAL'S PHASE. Three corpus rows pin it, but only through `getResult`; the
 *     at-limit controls and the shape of the refusal are asserted directly here, on the constructor
 *     the caller actually holds.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MissingTranslationError, THROW_EXCEPTION, createStrings } from "../src/core/index.js";
import { pluralOperands } from "../src/index.js";

/** A one-catalog instance whose handler always throws. `Absent.Key` is in no catalog. */
const throwing = (extra = {}) =>
  createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: { en: { Present: "here" } },
    onFailure: () => THROW_EXCEPTION,
    ...extra,
  });

describe("MissingTranslationError — the cause-less throw", () => {
  it("escapes get() and getResult() identically", () => {
    // The claim this replaces was in `VectorOracle.java`: that a throwing handler "surfaces on get
    // while getResult() would have returned the key". It is false — `throwExceptionFor` is called
    // from below the split — and the corpus says so on its own, with three pairs of rows named
    // `...get-throws-...` / `...getresult-throws-too` recording the same exception.
    const strings = throwing();
    for (const call of [() => strings.get("Absent.Key"), () => strings.getResult("Absent.Key")])
      assert.throws(call, (/** @type {any} */ error) => {
        assert.ok(error instanceof MissingTranslationError);
        assert.ok(error instanceof Error);
        assert.equal(error.name, "MissingTranslationError");
        assert.equal(error.code, "MISSING_TRANSLATION");
        return true;
      });
  });

  it("quotes the RAW key and the lookup locale, uninterpolated and never isolated", () => {
    // `DefaultStrings.java:741` composes the message before the handler runs and hands it straight
    // to the constructor: no interpolator, no `BidiUtils`. Under `all` isolation on an RTL locale a
    // port that isolated eagerly would put directional controls inside an exception message.
    const strings = createStrings({
      fallbackLocale: "he",
      locale: "he",
      strings: { he: { Present: "כאן" } },
      bidiIsolation: "all",
      onFailure: () => THROW_EXCEPTION,
    });

    assert.throws(() => strings.get("Farewell {{name}}", { name: "Sarah" }), (/** @type {any} */ e) => {
      assert.equal(e.message, "No match for 'Farewell {{name}}' was found for locale 'he'.");
      assert.ok(!/[⁦-⁩]/.test(e.message), "the message carries no isolate controls");
      return true;
    });
  });

  it("carries the SAME frozen failure object the handler was handed, by reference", () => {
    /** @type {any} */
    let seen = null;
    const strings = throwing({ onFailure: (/** @type {any} */ f) => { seen = f; return THROW_EXCEPTION; } });

    assert.throws(() => strings.getResult("Absent.Key", { who: "x" }), (/** @type {any} */ e) => {
      assert.ok(seen !== null);
      // Reference, not shape. A structural copy passes every recorded corpus field and breaks the
      // identity chain plan 8.3 requires.
      assert.equal(e.failure, seen);
      assert.ok(Object.isFrozen(e.failure));
      assert.equal(e.failure.key, "Absent.Key");
      assert.equal(e.failure.reason, "missing-translation");
      return true;
    });
  });

  it("is catch-only: a consumer cannot construct one", () => {
    const Catchable = /** @type {any} */ (MissingTranslationError);
    assert.throws(() => new Catchable(Symbol("guess"), "message", {}), TypeError);
    assert.throws(() => new Catchable(undefined, "message", {}), TypeError);
  });

  it("is catch-only: a subclass cannot be instantiated either", () => {
    class Mine extends /** @type {any} */ (MissingTranslationError) {}
    // The token is checked BEFORE `super()` runs, so the refusal is a construction failure rather
    // than a partially initialized library error escaping into an application's hierarchy.
    assert.throws(() => new Mine(Symbol("guess"), "message", {}), TypeError);
  });
});

describe("the retained cause is rethrown by identity", () => {
  /** A resolver that throws one specific object, so identity is traceable through the walk. */
  const resolverThrew = new Error("resolver refused");

  const ARTICLE = {
    Article: {
      translation: "{{a}} thing",
      placeholders: { a: { value: "term", translations: { PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a" } } },
    },
  };

  const throwingResolverStrings = (/** @type {any} */ onFailure) =>
    createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: { en: ARTICLE },
      phoneticResolver: () => { throw resolverThrew; },
      onFailure,
    });

  it("rethrows the CONTEXTUALIZED error the handler was handed, not a rebuild of it", () => {
    // Two objects, and the distinction is the point. The resolver's own error is not what escapes:
    // the generated-placeholder boundary contextualizes it into a new error whose message names the
    // key and the declaration and whose `cause` is the original — which is exactly the shape the 22
    // corpus rows record, `IllegalStateException` with a message beginning `Unable to resolve
    // generated placeholder`. What `throwExceptionFor` then rethrows is THAT object, by identity.
    /** @type {any} */
    let handed = null;
    const strings = throwingResolverStrings((/** @type {any} */ f) => { handed = f.cause; return THROW_EXCEPTION; });

    assert.throws(() => strings.get("Article", { term: "apple" }), (/** @type {any} */ e) => {
      assert.ok(handed !== null, "the handler saw a retained cause");
      // Plan 3.5: "no additional wrapper is added when the cause is stored". A port that rebuilt an
      // error with the same name and the same message would satisfy any name-or-message comparison
      // and fail here, which is why the conformance runner compares identity on this arm too.
      assert.equal(e, handed, "the retained cause itself, not a copy of it");
      assert.ok(!(e instanceof MissingTranslationError));
      // The original survives underneath, unwrapped a second time.
      assert.equal(/** @type {any} */ (e).cause, resolverThrew);
      return true;
    });
  });

  it("takes the rethrow arm instead of constructing a MissingTranslationError", () => {
    // The ablation in one assertion: swap the two arms of `throwForFailure` and this goes red while
    // the redacted `failure.message` a naive port would reach for stays available on the failure.
    assert.throws(() => throwingResolverStrings(() => THROW_EXCEPTION).get("Article", { term: "apple" }),
      (/** @type {any} */ e) => {
        assert.ok(!(e instanceof MissingTranslationError));
        assert.match(e.message, /^Unable to resolve generated placeholder 'a'/);
        return true;
      });
  });
});

describe("pluralOperands refuses out-of-range options at VALUE CONSTRUCTION", () => {
  // Java's `PluralOperands.Builder` carries its own `TranslationRuntimeLimits`, seeded from
  // `TranslationRuntimeLimits.defaults()`, and `build()` checks the options before it touches the
  // number. So the refusal belongs to the caller's own value construction and never becomes a
  // translation failure — which is what `runtime-limits.numeric.default.compact-exponent-65` and
  // `.visible-decimal-places-1025` record, and what deferring the check to classification hid: the
  // same error with the same message, raised one phase too late, became a RESOLUTION_FAILURE that
  // the default handler answered with the key.

  it("refuses a compact exponent one past the default maximum", () => {
    assert.throws(() => pluralOperands("1", { compactExponent: 65 }), (/** @type {any} */ e) => {
      assert.ok(e instanceof RangeError);
      assert.equal(e.message, "Compact exponent 65 exceeds the maximum of 64");
      return true;
    });
  });

  it("refuses visible decimal places one past the default maximum", () => {
    assert.throws(() => pluralOperands("1.5", { visibleDecimalPlaces: 1025 }), (/** @type {any} */ e) => {
      assert.ok(e instanceof RangeError);
      assert.equal(e.message, "Visible decimal places 1025 exceeds the maximum of 1024");
      return true;
    });
  });

  it("ACCEPTS both at exactly the maximum — the boundary is a boundary, not a blanket refusal", () => {
    // The controls. Without them "refuses out-of-range options" is satisfied by refusing everything.
    assert.equal(pluralOperands("1", { compactExponent: 64 }).compactExponent, 64);
    assert.equal(pluralOperands("1.5", { visibleDecimalPlaces: 1024 }).visibleDecimalPlaces, 1024);
    assert.equal(pluralOperands("1").value, "1");
  });

  it("keeps the kind split Java collapses into IllegalArgumentException", () => {
    // The JS contract splits Java's one exception across `TypeError` (wrong kind) and `RangeError`
    // (right kind, out of range); `ERROR_NAME` accepts either for `IllegalArgumentException`, so the
    // corpus cannot tell them apart and this is the only thing that holds the split.
    assert.throws(() => pluralOperands("1", { compactExponent: -1 }), RangeError);
    assert.throws(() => pluralOperands("1", { visibleDecimalPlaces: -1 }), RangeError);
    assert.throws(() => pluralOperands("1", { compactExponent: /** @type {any} */ (1.5) }), TypeError);
    assert.throws(() => pluralOperands("1", { visibleDecimalPlaces: /** @type {any} */ ("2") }), TypeError);
  });

  it("refuses before a lookup can turn the refusal into a translation failure", () => {
    const strings = createStrings({
      fallbackLocale: "en",
      locale: "en",
      strings: {
        en: {
          Counted: {
            translation: "{{word}}",
            placeholders: { word: { value: "n", translations: { CARDINALITY_ONE: "one", CARDINALITY_OTHER: "other" } } },
          },
        },
      },
    });
    // The value never gets built, so the lookup never runs. Asserted by building the value first and
    // showing the throw happens there — a port that validated inside `get` would reach this line.
    assert.throws(() => strings.get("Counted", { n: pluralOperands("1", { compactExponent: 65 }) }), RangeError);
    assert.equal(strings.get("Counted", { n: pluralOperands("1", { compactExponent: 64 }) }), "other");
  });
});
