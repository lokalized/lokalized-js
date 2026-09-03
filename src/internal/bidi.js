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
 * `isolate` is deliberately unbounded here. Java's `BidiUtils` also carries a
 * `maximumOutputCharacters` contract, where FSI and PDI count against the interpolated-output
 * budget; that budget is not enforced anywhere in this port yet, and adding half of it — a limit
 * that fires only for isolated values — would be worse than not having it, because the same value
 * would pass or fail depending on whether the locale happened to be RTL. The seam belongs with the
 * runtime-limit work that owns `maximumInterpolatedOutputCharacters`, and it lands whole or not at
 * all.
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
 * `BidiUtils.isolate`: wrap a value in FSI … PDI, repairing the isolate structure as it copies.
 *
 * Idempotent for an already-isolated value, and structure-repairing for everything else: an
 * unmatched PDI is DROPPED (it would otherwise pop the wrapper this call is adding and leak the
 * value's direction into the surrounding message), and an unclosed initiator is balanced with as
 * many PDIs as it left open before the wrapper's own PDI. The empty string gets no marks at all.
 *
 * @param {string} value
 * @returns {string}
 */
export function isolate(value) {
  const length = value.length;

  if (length === 0) return "";
  if (isIsolated(value)) return value;

  let isolated = FIRST_STRONG_ISOLATE;
  let isolateDepth = 0;

  for (let index = 0; index < length; ++index) {
    const character = value.charAt(index);

    if (isIsolateInitiator(character)) {
      ++isolateDepth;
      isolated += character;
    } else if (character === POP_DIRECTIONAL_ISOLATE) {
      if (isolateDepth > 0) {
        --isolateDepth;
        isolated += character;
      }
    } else {
      isolated += character;
    }
  }

  return isolated + POP_DIRECTIONAL_ISOLATE.repeat(isolateDepth) + POP_DIRECTIONAL_ISOLATE;
}
