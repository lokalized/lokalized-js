// @ts-check
/**
 * THE NINTH AND LAST OF PLAN 3.5's ERROR CLASSES — the library's own failures during resolution.
 *
 * Plan 3.5:1058-1063 declares it with TWO codes, and plan 3.5:1116-1117 maps each to a Java site:
 *
 *     Recognized invalid value during resolution  ->  RESOLUTION_INVALID_ARGUMENT
 *     Recognized invalid state during resolution  ->  RESOLUTION_INVALID_STATE
 *
 * **WHY IT IS NOT MERELY A MISSING EXPORT.** Java's contextualizing ladder
 * (`DefaultStrings.contextualizePlaceholderFailure:1270-1281`) has FOUR arms — expression, invalid
 * value, invalid state, and then `return cause` for anything it does not recognize. The port had only
 * the first. So the two middle arms were bare `Error`s, which made them indistinguishable from the
 * fourth: an unrecognized APPLICATION error, which Java returns VERBATIM rather than contextualizing.
 * Measured on the pinned JDK before this landed: an application `RuntimeException` subclass comes out
 * of `getResult().getCause()` with its class and message intact and a chain of length 1, while the
 * port wrapped that same shape in one bare `Error` at the language-form boundary and two at the
 * fragment boundary. **Plan 2.5:249 — "an unrecognized application exception from an extension point
 * is stored unchanged" — was unsatisfied, and the corpus is structurally unable to see it**: censused
 * across all 2,363 cases, the only application-thrown class anywhere is
 * `java.lang.IllegalStateException`, which Java RECOGNIZES. No case takes arm 4.
 *
 * **EVERY CODE BELOW WAS DERIVED FROM THE EXECUTED ORACLE, NOT ASSIGNED BY READING.** The corpus
 * records Java's `causeType` beside its `causeMessage` on 730 occurrences; grouped by normalized
 * message shape, 117 of 118 leaf shapes are single-valued. That map is what gave each raiser its
 * code. The one ambiguous shape — `Phonetic input for placeholder 'X' exceeds the maximum of N
 * characters` — is recorded as BOTH `ExpressionEvaluationException` and `IllegalArgumentException`,
 * differing only by SITE. **The category is a property of the site, never of the message**, which is
 * why nothing here keys on message text.
 *
 * **THE CLASS IS CREATED FRESH, NEVER RECONSTRUCTED FROM THE CAUSE.** Java's ladder keeps the
 * CATEGORY, not the type: `:1274` constructs a plain `new IllegalArgumentException(message, cause)`,
 * so a `NumberFormatException` going in comes out as a plain IAE with the subclass surviving only as
 * `cause`. `src/internal/interpolate.js` said the ladder "KEEPS THE FAILING EXCEPTION'S TYPE"; that
 * was measured wrong and is corrected there.
 */
import { LOKALIZED_ERROR_TOKEN, LokalizedError } from "./lokalized-error.js";

/** Unexported by design: only this package can hand it to the constructor. */
const RESOLUTION_ERROR_TOKEN = Symbol("lokalized.ResolutionError");

export class ResolutionError extends LokalizedError {
  /**
   * @private
   * @param {symbol} token the internal construction token
   * @param {"RESOLUTION_INVALID_ARGUMENT" | "RESOLUTION_INVALID_STATE"} code
   * @param {string} message
   * @param {{ cause?: unknown, thrownValue?: "null" | "undefined" }} [options]
   */
  constructor(token, code, message, options) {
    if (token !== RESOLUTION_ERROR_TOKEN)
      throw new TypeError("ResolutionError is not constructible; it is thrown by lokalized");

    super(LOKALIZED_ERROR_TOKEN, code, message,
      options?.cause === undefined ? undefined : { cause: options.cause });
    /** @type {"ResolutionError"} */
    this.name = "ResolutionError";
    // PRESENT ONLY ON THE NULLISH LEAF, not merely undefined elsewhere. Plan 3.5:1136-1140 says
    // "every other `ResolutionError` omits `thrownValue`", and `"thrownValue" in error` is the
    // natural discriminator — an always-present key valued `undefined` would defeat it.
    if (options?.thrownValue !== undefined) {
      /** BOOT-M0-0524. @type {"null" | "undefined" | undefined} @readonly */
      this.thrownValue = options.thrownValue;
    }
  }

  /**
   * @param {symbol} token
   * @param {"RESOLUTION_INVALID_ARGUMENT" | "RESOLUTION_INVALID_STATE"} code
   * @param {string} message
   * @param {{ cause?: unknown, thrownValue?: "null" | "undefined" }} [options]
   */
  static raise(token, code, message, options) {
    return new ResolutionError(token, code, message, options);
  }
}

/**
 * A recognized INVALID VALUE during resolution — Java's `IllegalArgumentException` arm.
 *
 * @param {string} message @param {{ cause?: unknown }} [options]
 */
export function invalidArgument(message, options) {
  return ResolutionError.raise(RESOLUTION_ERROR_TOKEN, "RESOLUTION_INVALID_ARGUMENT", message, options);
}

/**
 * A recognized INVALID STATE during resolution — Java's `IllegalStateException` arm.
 *
 * @param {string} message @param {{ cause?: unknown }} [options]
 */
export function invalidState(message, options) {
  return ResolutionError.raise(RESOLUTION_ERROR_TOKEN, "RESOLUTION_INVALID_STATE", message, options);
}

/**
 * The nullish-cause leaf, which plan 3.5:1136-1140 requires and which has no Java counterpart at all.
 *
 * Java cannot throw `null` (plan 2.5:254-256 says so), so a candidate that threw one has no recorded
 * behaviour to match. Measured on the pristine port: a resolver doing `throw null` inside a
 * whole-message alternative reached `TranslationFailure.cause === null`, and core then read a null
 * cause as "no resolution cause" and raised a `MissingTranslationError` from the throw response. It
 * carries NO own `cause` — there is nothing to carry — and always the invalid-state code.
 *
 * @param {"null" | "undefined"} thrownValue @param {string} message
 */
export function nullishThrow(thrownValue, message) {
  return ResolutionError.raise(RESOLUTION_ERROR_TOKEN, "RESOLUTION_INVALID_STATE", message, { thrownValue });
}
