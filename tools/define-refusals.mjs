/**
 * The `define` family's message-parity adaptation, DELIBERATELY OUTSIDE `tools/conformance.mjs`.
 *
 * Same machine as `tools/construct-refusals.mjs`, for the same reason and with the same three
 * safeguards, over a different pair of validation sites. Read that file's header first; what follows
 * is only what is DIFFERENT here.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY `define` NEEDS A TABLE AT ALL, AND IT IS NOT THE WORDING
 * ---------------------------------------------------------------------------------------------
 *
 * The 22 `define` cases were carried unimplemented since M5b behind one honest sentence in
 * `conformance.mjs`: wiring them up "means deciding an adaptation rule, and inventing one inside
 * this file is exactly how a real exactness defect was once absorbed". That was right when it was
 * written and only half of it is still true.
 *
 * TWENTY OF THE TWENTY-TWO NEED NO RULE AT ALL. They observe `built` / `catalogKeyPresent` /
 * `contains`, and `contains` is Java asking a constructed `Strings` whether its catalog holds a
 * value EQUAL to a hand-built one — `LocalizedString#equals` through `Set#contains`. Since M9 S3 this
 * port has a structural equality predicate for exactly that proposition, inside
 * `mergeParsedStringsFiles`, and that predicate was MEASURED against `lokalized-java` 3.0.0 on the
 * pinned JDK rather than derived from the plan (placeholder-map order EQUAL, alternatives order NOT
 * equal, commentary null-vs-present NOT equal). So the equality half is not an invented rule; it is
 * a shipped one with a Java measurement behind it, consulted through its PUBLIC door.
 *
 * THE TWO REFUSAL ROWS ARE WHAT THIS TABLE IS FOR, and the divergence is structural rather than
 * cosmetic. Java validates a `LocalizedString` graph in the VALUE OBJECTS' constructors, so a
 * degenerate graph raises `java.lang.IllegalArgumentException` from `LocalizedString.java` itself.
 * This port validates the same graph in ONE place — `parseModelCatalog`, the same walk the file
 * parser uses — so `defineLocalizedString` raises `StringsParseError`, the class its own `@throws`
 * declares. Both refuse the same input at the same moment for the same reason; they disagree on
 * which layer owns the check.
 *
 * MAPPING `IllegalArgumentException` TO `StringsParseError` IN `ERROR_NAME` WAS NOT AN OPTION, and
 * that is the whole reason this file exists. That entry reads `["TypeError", "RangeError"]` and 34
 * unrelated rows depend on it; widening it to admit a third spelling would relax every one of them
 * to make two rows pass. Declaring the correspondence per SITE, keyed on the recorded Java pair
 * byte-for-byte, changes nothing for any other case.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT KEEPS THIS FROM BECOMING DECORATION — identical to the construct table, restated so this
 * file can be read alone
 * ---------------------------------------------------------------------------------------------
 *
 *  - **Keyed on the JAVA side, exactly.** Lookup is the recorded `(failureType, failureMessage)`
 *    pair. A re-recorded oracle that words a site differently stops matching and the row FAILS.
 *  - **Stale entries fail the run.** An entry no case consults is reported and reddens the exit
 *    status, because known-gap lists rot.
 *  - **Unadapted refusals fail rather than skip.** A Java refusal with no entry keeps its Java
 *    values on the wanted side and is reported FAILED. Nothing here can turn a mismatch into an
 *    `unsupported`.
 *
 * And `test/define-refusals.test.js` drives the port at each entry's own input, so the table cannot
 * drift away from the port either — the half a Java-keyed table cannot check by itself.
 */

/**
 * @typedef {object} DefineRefusalAdaptation
 * @property {string} site the `LocalizedString.java` line this refusal comes from
 * @property {string} javaType the recorded `expected.define.failureType`
 * @property {string} javaMessage the recorded `expected.define.failureMessage`, verbatim
 * @property {string} jsType the JS error constructor name this port must raise
 * @property {string} jsMessage the JS message this port must raise, verbatim
 * @property {string} why what makes the two the same refusal, and why the wording differs
 */

/** @type {readonly DefineRefusalAdaptation[]} */
export const DEFINE_REFUSAL_ADAPTATIONS = [
  {
    site: "LocalizedString.java:872",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage:
      "alternatives must not be empty; use ExpressionTranslation(String) for a translation-only fragment",
    jsType: "StringsParseError",
    jsMessage:
      "<defined>: fragment alternatives must contain at least one expression for placeholder 'f' in root key 'Fragment'",
    why:
      "An `alternatives: []` on a template placeholder. Java's advice names `ExpressionTranslation" +
      "(String)`, a constructor this library does not have and a JS caller cannot call — the same " +
      "rule that keeps `Strings.Builder#phoneticResolver(...)` out of the port's phonetic " +
      "diagnostic — so the port names the remedy a JS caller CAN act on: the placeholder and the " +
      "root key that carry the empty list. `StringsParseError` because this port validates the " +
      "model in one walk (`parseModelCatalog`) rather than in each value object's constructor, and " +
      "that walk's declared failure is `StringsParseError`; see this file's header for why the " +
      "`ERROR_NAME` entry was not widened instead.",
  },
  {
    site: "LocalizedString.java:111",
    javaType: "java.lang.IllegalArgumentException",
    javaMessage:
      "You must provide either a translation or at least one alternative expression. Offending key was 'Plain'",
    jsType: "StringsParseError",
    jsMessage:
      "<defined>: either a translation or at least one alternative expression is required for key 'Plain'",
    why:
      "A root node with a key and nothing else. The PROPOSITION is Java's, word for word — either a " +
      "translation or at least one alternative — and only the sentence shape differs: Java appends " +
      "`Offending key was 'X'`, the port names the key inline as every other message in " +
      "`parseModelCatalog` does, so one file does not carry two conventions for naming a key. " +
      "`StringsParseError` for the same one-walk reason as the entry above.",
  },
];

/** Sites an actual case consulted during this run. */
const consulted = new Set();

/**
 * The JS refusal this port must raise for a recorded Java refusal, or `null` when none is declared.
 *
 * @param {string | null} javaType
 * @param {string | null} javaMessage
 * @returns {{ jsType: string, jsMessage: string, site: string } | null}
 */
export function adaptDefineRefusal(javaType, javaMessage) {
  const entry = DEFINE_REFUSAL_ADAPTATIONS.find(
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
export function staleDefineAdaptations() {
  return DEFINE_REFUSAL_ADAPTATIONS.filter((entry) => !consulted.has(entry.site)).map(
    (entry) =>
      `no corpus case records the refusal this adapts, so the entry is stale: ${entry.site} ` +
      `(${JSON.stringify(entry.javaMessage)}) — delete it from tools/define-refusals.mjs`,
  );
}
