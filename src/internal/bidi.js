// @ts-check

/**
 * Internal: Unicode bidirectional isolation of caller-supplied placeholder values.
 *
 * Port of `BidiUtils` plus `DefaultStrings.shouldApplyBidiIsolation` (DefaultStrings.java:1420) from
 * lokalized-java 3.0.0.
 *
 * Three facts about this mechanism are counter-intuitive often enough that each has its own corpus
 * case, and all three are reproduced here rather than rediscovered:
 *
 * - **The mode keys off the LOCALE, never the value.** `en` plus `أحمد` is not isolated under the
 *   default; `he` plus `Sarah` is. Nothing here inspects the value's own direction, and a port that
 *   sniffed the value for RTL characters fails `bidi-isolation.default.*` in both directions.
 * - **The locale consulted is the EVALUATION locale** — the catalog that supplied the entry, not the
 *   one that was asked for. An Arabic request served by an English catalog is NOT isolated
 *   (DefaultStrings.java:713 passes `candidateLocale`). The one exception is the returned failure
 *   key, which by definition had no donor and so uses the requested locale (:754).
 * - **Isolation wraps the VALUE, not the message.** Only caller-supplied values are wrapped;
 *   translation-owned generated text is inserted bare even when it was produced by the same render.
 *
 * `isolate` is BOUNDED, and it landed whole together with the interpolated-output budget in
 * `interpolate.js` rather than on its own: a limit that fired only for isolated values would make
 * the same value pass or fail depending on whether the locale happened to be RTL. The two numbers
 * the bounded form carries are separate on purpose — `maximumCharacters` is what remains of the
 * message's budget at the point the value is substituted, while `reportedMaximumCharacters` is the
 * whole budget, which is the number the diagnostic names. `owed.m3b.bidi.repeated-placeholder-
 * second-occurrence-overruns` records Java telling them apart — a reported maximum of 11 where only
 * 5 characters remained — but that row's fixture LOWERS a runtime limit, so `conformance.mjs` can
 * never replay it against a port that (by plan 4.6) refuses `runtimeLimits`. It is reproduced as a
 * module-level assertion in `test/runtime-budgets.test.js` instead, which is the only place the
 * distinction is checkable at all.
 */

import { decode as decodeRightToLeftScripts } from "../data/rtl.js";
import { likelySubtagFor, tagPartsFor } from "./locale-cldr.js";

const LEFT_TO_RIGHT_ISOLATE = "⁦";
const RIGHT_TO_LEFT_ISOLATE = "⁧";
const FIRST_STRONG_ISOLATE = "⁨";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/**
 * The 37 right-to-left scripts of the pinned CLDR release, lowercased.
 *
 * `CldrLocaleData.isRightToLeftScript` compares through `keyFor`, which lowercases under
 * `Locale.ROOT`, so the membership test is case-insensitive on both sides.
 */
const RIGHT_TO_LEFT_SCRIPTS = new Set(decodeRightToLeftScripts().map((script) => script.toLowerCase()));

/**
 * The three modes, as plan section 3.2 spells them.
 *
 * Java's enum members are `NONE`, `ALWAYS` and `RTL_LOCALES`; the JS contract renames `ALWAYS` to
 * `"all"`, which is the only place the two vocabularies differ.
 *
 * @typedef {"none" | "rtl-locales" | "all"} BidiIsolation
 */

/** @type {ReadonlySet<string>} */
const BIDI_ISOLATION_MODES = new Set(["none", "rtl-locales", "all"]);

/** The library default — `DefaultStrings.DEFAULT_BIDI_ISOLATION` (DefaultStrings.java:73/80). */
export const DEFAULT_BIDI_ISOLATION = /** @type {BidiIsolation} */ ("rtl-locales");

/**
 * Validates a caller-supplied mode.
 *
 * Rejected rather than ignored: silently defaulting an unrecognized mode would turn a typo
 * (`"always"` for `"all"`) into isolation quietly disappearing from every RTL render.
 *
 * @param {unknown} mode
 * @param {string} where the option path, for the diagnostic
 * @returns {BidiIsolation}
 */
export function validateBidiIsolation(mode, where) {
  if (typeof mode !== "string" || !BIDI_ISOLATION_MODES.has(mode))
    throw new RangeError(
      `${where} must be one of 'none', 'rtl-locales', or 'all' but was ${JSON.stringify(mode)}`,
    );

  return /** @type {BidiIsolation} */ (mode);
}

/**
 * Memo for `localeUsesRightToLeftScript`.
 *
 * BOUNDED, and the bound is the point: the lookup locale reaching the failure-key path is arbitrary
 * caller input, so an unbounded memo is an attacker-controlled retained-memory growth. Clearing
 * wholesale on overflow keeps the eviction policy to one line and costs nothing measurable — the
 * working set of a real application is a handful of tags.
 *
 * @type {Map<string, boolean>}
 */
const RIGHT_TO_LEFT_BY_TAG = new Map();
const MAXIMUM_MEMOIZED_TAGS = 512;

/**
 * `BidiUtils.localeUsesRightToLeftScript`.
 *
 * Two branches and only two: an explicit script subtag short-circuits, and a tag without one is
 * maximized through the pinned CLDR likely-subtags table. `ar` therefore isolates (likely `ar-Arab-EG`)
 * while `ar-Latn` does not, which is what `bidi-isolation.script.*` pins.
 *
 * @param {string} tag a normalized BCP-47 tag
 * @returns {boolean}
 */
export function localeUsesRightToLeftScript(tag) {
  const memoized = RIGHT_TO_LEFT_BY_TAG.get(tag);
  if (memoized !== undefined) return memoized;

  let script = "";

  try {
    script = tagPartsFor(tag).script;

    if (script.length === 0) {
      const likelySubtag = likelySubtagFor(tag);
      if (likelySubtag !== null) script = tagPartsFor(likelySubtag).script;
    }
  } catch {
    // A tag this module cannot parse cannot be classified either. Java would have been handed a
    // `Locale` that already parsed, so this is unreachable through `createStrings`; answering "not
    // RTL" keeps a diagnostic path from turning into a second failure.
    script = "";
  }

  const rightToLeft = script.length > 0 && RIGHT_TO_LEFT_SCRIPTS.has(script.toLowerCase());

  if (RIGHT_TO_LEFT_BY_TAG.size >= MAXIMUM_MEMOIZED_TAGS) RIGHT_TO_LEFT_BY_TAG.clear();
  RIGHT_TO_LEFT_BY_TAG.set(tag, rightToLeft);

  return rightToLeft;
}

/**
 * `DefaultStrings.shouldApplyBidiIsolation` (DefaultStrings.java:1420).
 *
 * @param {BidiIsolation} mode
 * @param {string} locale the EVALUATION locale for a translation, the REQUESTED locale for a
 *   returned failure key
 * @returns {boolean}
 */
export function shouldApplyBidiIsolation(mode, locale) {
  if (mode === "none") return false;
  if (mode === "all") return true;
  return localeUsesRightToLeftScript(locale);
}

/**
 * @param {string} character
 * @returns {boolean}
 */
function isIsolateInitiator(character) {
  return (
    character === LEFT_TO_RIGHT_ISOLATE ||
    character === RIGHT_TO_LEFT_ISOLATE ||
    character === FIRST_STRONG_ISOLATE
  );
}

/**
 * Is this value already exactly one balanced isolate run covering the whole string?
 *
 * `BidiUtils.isIsolated`. Three guards, each with its own corpus case: a value shorter than two
 * characters is never isolated (`⁨` alone), a value not opening with an initiator is never isolated,
 * and a run whose depth returns to zero BEFORE the last character is not isolated either — `⁨a⁩b`
 * gets wrapped again rather than being trusted.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isIsolated(value) {
  const length = value.length;

  if (length < 2 || !isIsolateInitiator(value.charAt(0))) return false;

  let isolateDepth = 0;

  for (let index = 0; index < length; ++index) {
    const character = value.charAt(index);

    if (isIsolateInitiator(character)) {
      ++isolateDepth;
    } else if (character === POP_DIRECTIONAL_ISOLATE) {
      --isolateDepth;

      if (isolateDepth < 0) return false;
      if (isolateDepth === 0 && index < length - 1) return false;
    }
  }

  return isolateDepth === 0;
}

/**
 * The interpolated-output limit diagnostic, shared with `interpolate.js`.
 *
 * A plain `Error`, because Java raises `IllegalStateException` and `conformance.mjs`'s `CAUSE_NAME`
 * maps that to `Error`. The wording is `StringInterpolator.outputLimitExceeded`'s verbatim, and it
 * has to be: the two files raise the SAME diagnostic for the same budget, and a value that overruns
 * inside `isolate` must be indistinguishable from one that overran in the interpolator.
 *
 * @param {number} maximumCharacters
 * @returns {Error}
 */
export function outputLimitExceeded(maximumCharacters) {
  return new Error(`Interpolated output exceeds the maximum of ${maximumCharacters} characters`);
}

/**
 * `BidiUtils.isolate`: wrap a value in FSI … PDI, repairing the isolate structure as it copies.
 *
 * Idempotent for an already-isolated value, and structure-repairing for everything else: an
 * unmatched PDI is DROPPED (it would otherwise pop the wrapper this call is adding and leak the
 * value's direction into the surrounding message), and an unclosed initiator is balanced with as
 * many PDIs as it left open before the wrapper's own PDI. The empty string gets no marks at all.
 *
 * BOUNDED, and the length rejection comes FIRST — before the empty-string exit and before the
 * already-isolated fast path. Java's reason is a WORK bound rather than an answer: balancing could
 * discard stray pop marks and bring an oversized value back under the limit, but discovering that
 * would do exactly the unbounded scanning the limit exists to prevent.
 *
 * MEASURED, and it corrects the claim the corpus case makes about itself.
 * `owed.m3b.bidi.pre-isolated-value-longer-than-budget-rejected-before-early-return` says a port
 * that moved this test after the fast path "would return this value unchecked". Through the
 * interpolator it would not: `StringInterpolator.appendChecked` immediately re-tests the returned
 * value against the SAME remainder and raises the SAME diagnostic, so that row records an identical
 * answer either way. Moving the test is observable only on a direct `isolate` call, which is why
 * `test/runtime-budgets.test.js` asserts it there — ablating the order leaves conformance at
 * 1,917 / 0 and changes exactly one module-level assertion.
 *
 * @param {string} value
 * @param {number} [maximumCharacters] characters still available, or -1 for no limit
 * @param {number} [reportedMaximumCharacters] the whole budget, which is what the diagnostic names
 * @returns {string}
 */
export function isolate(value, maximumCharacters = -1, reportedMaximumCharacters = maximumCharacters) {
  if (maximumCharacters < -1)
    throw new RangeError("maximumCharacters must be non-negative or -1 for no limit");

  const length = value.length;

  // BEFORE the empty check and the fast path. See the note above.
  if (maximumCharacters >= 0 && length > maximumCharacters)
    throw outputLimitExceeded(reportedMaximumCharacters);

  if (length === 0) return "";
  if (isIsolated(value)) return value;

  let isolated = "";
  let isolateDepth = 0;

  /** `BidiUtils.appendChecked`: the marks are charged to the budget, exactly like the value. */
  const append = (/** @type {string} */ character) => {
    if (maximumCharacters >= 0 && isolated.length >= maximumCharacters)
      throw outputLimitExceeded(reportedMaximumCharacters);

    isolated += character;
  };

  append(FIRST_STRONG_ISOLATE);

  for (let index = 0; index < length; ++index) {
    const character = value.charAt(index);

    if (isIsolateInitiator(character)) {
      ++isolateDepth;
      append(character);
    } else if (character === POP_DIRECTIONAL_ISOLATE) {
      if (isolateDepth > 0) {
        --isolateDepth;
        append(character);
      }
    } else {
      append(character);
    }
  }

  for (let index = 0; index < isolateDepth; ++index) append(POP_DIRECTIONAL_ISOLATE);

  append(POP_DIRECTIONAL_ISOLATE);
  return isolated;
}
