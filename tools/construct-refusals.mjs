/**
 * The `construct` family's message-parity adaptation, DELIBERATELY OUTSIDE `tools/conformance.mjs`.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RECORDED DECISION (M7-PLAN.md open question 3, "the 8 `construct` rows' message parity")
 * ---------------------------------------------------------------------------------------------
 *
 * The plan offered two ways to reconcile Java's recorded `failureType`/`failureMessage` with the
 * port's: fold them into the existing `causeMessage` RATCHET (reported, never gated), or write an
 * adaptation rule outside the runner. **This slice takes the second, and gates on it.** The reasons
 * are measured, not stylistic:
 *
 *  1. `constructed: false` ALONE DOES NOT DISCRIMINATE. Each of the seven refusal rows says, in its
 *     own note, that "the discriminator is the refusal IDENTITY: a port that accepts this input, or
 *     refuses it with a different exception or message, differs here and nowhere else." Comparing
 *     only the boolean would make all seven rows interchangeable — one implementation that raised
 *     the same error for every degenerate record would pass the whole family, and the family exists
 *     precisely because that implementation is wrong.
 *
 *  2. THE RATCHET WOULD RECORD 0/7 AND GATE NOTHING. `causeMessageMatchedIds` banks cases whose Java
 *     message the port reproduces VERBATIM. Four of these seven messages name Java-only API —
 *     `localizedStringSupplier`, `localeSupplier`/`localeMatchSupplier`, the class name
 *     `DefaultStrings`, and `Locale#toString`'s underscore spelling `en_US_POSIX` — none of which
 *     exists in this library. Reproducing them would be wrong advice in a JavaScript message, which
 *     is the same rule that keeps `Strings.Builder#phoneticResolver(...)` out of the port's phonetic
 *     diagnostic. So every row would land in the divergence bucket and nothing would be pinned.
 *
 *  3. OUTSIDE THE RUNNER, BECAUSE OF WHAT THE RUNNER'S DIFF IS READ FOR. `tools/conformance.mjs` is
 *     grepped by reviewers for exactly this shape — a rule that makes a comparison agree. Keeping
 *     the correspondence here makes it a reviewable ARTIFACT rather than a clause buried in a
 *     comparison arm: one table, one entry per Java refusal site, each naming the `DefaultStrings`
 *     line it adapts and why the JS wording differs.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT KEEPS THIS FROM BECOMING DECORATION
 * ---------------------------------------------------------------------------------------------
 *
 * A table of "Java said X, so accept Y" can be tuned until everything is green. Three properties
 * stop that, and all three are enforced by the runner rather than promised here:
 *
 *  - **Keyed on the JAVA side, exactly.** Lookup is by the recorded `(failureType, failureMessage)`
 *    pair, byte for byte. If the oracle ever records a different message for a site, the entry stops
 *    matching and the row FAILS — it does not silently keep passing.
 *  - **Stale entries fail the run.** An entry no corpus row consults is reported and turns the exit
 *    status red, on the same discipline as `assertStillNonportable`: the standing lesson here is
 *    that known-gap lists rot, so any new one must fail on stale entries.
 *  - **Unadapted refusals fail rather than skip.** A Java refusal with no entry keeps its Java
 *    values on the wanted side and is reported FAILED. Nothing in this file can turn a mismatch into
 *    an `unsupported`.
 *
 * Verified by ABLATION, not by argument: swapping the `js` halves of any two entries turns exactly
 * the two corresponding rows red. See `test/construct-refusals.test.js`, which asserts the port
 * still raises each `js` pair for the input the fixture describes — so the table cannot drift away
 * from the port either.
 *
 * The `failureType` mapping is its own decision and is recorded per entry. Java raises
 * `IllegalArgumentException` for all seven; JavaScript has no single counterpart, and the port's
 * standing convention — visible throughout `src/core/index.js` — is `TypeError` for an option of the
 * wrong SHAPE or a missing required one, `RangeError` for a well-shaped value outside its domain.
 * That convention decides each row below; it is not chosen per row to make a row pass.
 */

/**
 * @typedef {object} ConstructRefusalAdaptation
 * @property {string} site the `DefaultStrings.java` line this refusal comes from
 * @property {string} javaType the recorded `expected.construct.failureType`
 * @property {string} javaMessage the recorded `expected.construct.failureMessage`, verbatim
 * @property {string} jsType the JS error constructor name this port must raise
 * @property {string} jsMessage the JS message this port must raise, verbatim
 * @property {string} why what makes the two the same refusal, and why the wording differs
 */

/** @type {readonly ConstructRefusalAdaptation[]} */
export const CONSTRUCT_REFUSAL_ADAPTATIONS = [
  {
    site: "DefaultStrings.java:250",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage: "You must specify a 'localizedStringSupplier' when creating a DefaultStrings instance",
    jsType: "TypeError",
    jsMessage: "createStrings({ strings }) is required: supply a record or a Map of locale tag to catalog",
    why:
      "No catalog source at all. Java's source is a SUPPLIER of the catalog map; `createStrings` " +
      "takes the map itself, so the JS counterpart of 'no supplier' is an absent `strings` option. " +
      "TypeError because a required option is missing, which is a shape mistake.",
  },
  {
    site: "DefaultStrings.java:254",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage:
      "You must specify exactly one of 'localeSupplier' or 'localeMatchSupplier' when creating a DefaultStrings instance",
    jsType: "RangeError",
    jsMessage:
      "createStrings requires exactly one of 'locale', 'localeResolver' or 'localeMatchResolver'; received none",
    why:
      "The both-ABSENT arm of Java's `(localeSupplier == null) == (localeMatchSupplier == null)`. " +
      "The JS union has THREE members, not two — plan 3.2's `LocaleSourceOptions` adds the constant " +
      "`locale`, which Java expresses as a constant-returning localeSupplier — so the message names " +
      "three options where Java names two. RangeError because the option COUNT is out of range; " +
      "this is the same refusal B3 already raised for the at-most-one half, deliberately reused " +
      "rather than duplicated, so a caller cannot get two different diagnostics for one rule.",
  },
  {
    site: "DefaultStrings.java:262",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage: "The 'localizedStringSupplier' returned null",
    jsType: "TypeError",
    jsMessage: "createStrings({ strings }) was null: supply a record or a Map of locale tag to catalog",
    why:
      "Java's supplier answered null, which is NOT the same state as supplying no supplier — the " +
      "corpus keeps the two rows apart and so does the port: an omitted option is a caller who " +
      "forgot, an explicit null is a caller whose own lookup came back empty.",
  },
  {
    site: "DefaultStrings.java:273",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage: "Null locale encountered in supplied localized strings",
    jsType: "TypeError",
    jsMessage: "Null locale encountered in supplied localized strings",
    why:
      "VERBATIM — the sentence names nothing Java-only. A `Map` catalog can carry a null key where " +
      "a record cannot, which is the whole reason the fixture builds one.",
  },
  {
    site: "DefaultStrings.java:280",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage:
      "Localized strings locales 'en_US_POSIX' and 'en_US_posix' both use IETF BCP 47 language tag 'en-US-posix'",
    jsType: "RangeError",
    jsMessage:
      "Localized strings locales 'en-US-POSIX' and 'en-US-posix' both use IETF BCP 47 language tag 'en-US-posix'",
    why:
      "The sentence is Java's, with BCP 47 TAGS in the two quoted positions where Java prints " +
      "`Locale#toString`'s underscore form. JavaScript has no underscore spelling of a locale — a " +
      "catalog key IS a tag — so the underscores are the one thing that cannot cross. Measured on " +
      "the pinned Corretto 21: new Locale(\"en\",\"US\",\"POSIX\").toLanguageTag() is 'en-US-POSIX' " +
      "and the 'posix' one is 'en-US-posix', so the two JS catalog keys are those exact tags. " +
      "RangeError because both spellings are well-formed and the pair is what is out of range. " +
      "NOTE: the plan flagged this row as possibly INEXPRESSIBLE in JS — it is not. A record can " +
      "hold both keys (JS object keys are case-sensitive), and the port's `normalizeTag` preserves " +
      "variant case, so the collision is reachable without a Map at all.",
  },
  {
    site: "DefaultStrings.java:286",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage: "Null localized strings iterable encountered for locale 'en'",
    jsType: "TypeError",
    jsMessage: "Null localized strings catalog encountered for locale 'en'",
    why:
      "'iterable' is Java's word for the map VALUE, whose JS counterpart is plan 3.2's `CatalogInput` " +
      "— a record, an array, a parsed file, text or bytes, only one of which is iterable. 'catalog' " +
      "is the name this library gives that union everywhere else, so it is the word used here.",
  },
  {
    site: "DefaultStrings.java:293",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage: "Null localized string encountered for locale 'en'",
    jsType: "TypeError",
    jsMessage: "Null localized string encountered for locale 'en'",
    why:
      "VERBATIM. The failure mode this row names is skipping the null and building a silently " +
      "smaller catalog, which no message wording can excuse.",
  },
];

/** Entries actually consulted by a run, so an entry that matches nothing can be reported as stale. */
const consulted = new Set();

/**
 * The JS refusal that corresponds to a recorded Java one, or null if none is declared.
 *
 * @param {string | null} javaType
 * @param {string | null} javaMessage
 * @returns {{ jsType: string, jsMessage: string, site: string } | null}
 */
export function adaptConstructRefusal(javaType, javaMessage) {
  const entry = CONSTRUCT_REFUSAL_ADAPTATIONS.find(
    (candidate) => candidate.javaType === javaType && candidate.javaMessage === javaMessage,
  );

  if (!entry) return null;

  consulted.add(entry.site);
  return { jsType: entry.jsType, jsMessage: entry.jsMessage, site: entry.site };
}

/**
 * Sites declared above that no case consulted — the staleness half of the contract.
 *
 * @returns {string[]}
 */
export function staleConstructAdaptations() {
  return CONSTRUCT_REFUSAL_ADAPTATIONS.filter((entry) => !consulted.has(entry.site)).map(
    (entry) =>
      `no corpus case records the refusal this adapts, so the entry is stale: ${entry.site} ` +
      `(${JSON.stringify(entry.javaMessage)}) — delete it from tools/construct-refusals.mjs`,
  );
}
