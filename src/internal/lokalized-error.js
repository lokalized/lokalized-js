// @ts-check
/**
 * THE BASE EVERY LIBRARY ERROR EXTENDS — plan 3.5:1039-1042, and the last structural piece of the
 * declared error surface.
 *
 * Plan 3.5 declares `interface LokalizedError extends Error { readonly code: LokalizedErrorCode }`
 * and, at :1092, exports it as a VALUE: `const LokalizedError: CatchOnlyErrorClass<LokalizedError>`.
 * That export only means something if there is a real base class at runtime, because its whole
 * purpose is `catch (error) { if (error instanceof LokalizedError) ... }` — one test for "this came
 * from the library" rather than seven. Until S35 the seven classes each extended `Error` directly,
 * so a consumer had no way to ask that question at all.
 *
 * **THE TOKEN IS SHARED, NOT PER-CLASS, AND THAT IS THE DESIGN.** Plan 3.5:1107-1108 requires the
 * runtime constructors to "require an unexported internal token, so plain-JavaScript direct
 * construction and subclass instantiation fail". Each subclass already guards its own constructor
 * with its own token; the BASE needs one too, or `new LokalizedError("anything")` fabricates a
 * library error that every `instanceof` in an application believes. Subclasses pass this token up;
 * it never leaves the package, because no published subpath re-exports this module.
 *
 * **`code` IS READONLY AND THE SUBCLASS SUPPLIES IT AT `super(...)`.** Registry statement
 * BOOT-M0-0511 declares it readonly, and TypeScript only permits assigning a readonly property
 * inside the constructor of the class that DECLARES it — so marking it readonly while the eight
 * subclasses each assign `this.code` is eight `TS2540`s, measured, one per subclass. Threading it
 * through this constructor is what reconciles the two. Note it is readonly to the CHECKER only: the
 * runtime property is still writable, enumerable and own, and every instance is byte-identical to
 * what the assign-in-the-subclass shape produced (measured across all eight, key order included —
 * the property was always created HERE and merely reassigned below, so nothing moved).
 *
 * **THE PARAGRAPH THIS REPLACES ARGUED THE OPPOSITE AND ITS OWN DEFENCE DID NOT HOLD.** It read
 * "declared here and assigned by the subclass ... a base that invented a default would let a
 * subclass that forgot to set one ship a plausible wrong value". This base DID invent a default —
 * `undefined`, cast to `any` — and a cast is a place a gate cannot look, so a subclass that forgot
 * shipped `code: undefined` under a declared type of `LokalizedErrorCode` with `tsc` silent.
 * Measured both ways with a green control: a ninth subclass omitting its code is ACCEPTED in the old
 * shape (and carries `code: undefined` at runtime) and is `TS2554: Expected 3-4 arguments, but got
 * 2` in this one. A wrong value is caught too, because the parameter is typed `LokalizedErrorCode`.
 *
 * **AND THE PARAMETER KEEPS EVERY SUBCLASS SIGNATURE DISTINCT FROM THIS ONE, which is load-bearing
 * for a reason that has nothing to do with `code`.** `tsc` ELIDES a derived constructor whose
 * signature is identical to the inherited one, so `ExpressionEvaluationError` — whose
 * `(token, message, options)` matched this class's exactly — emitted no `private constructor();` at
 * all despite carrying `@private` in source, and a consumer could `extend` it. Ablated both ways
 * against the pre-change tree: changing ONLY this constructor's arity makes that guard appear, and
 * making `ConfigurationError`'s constructor match this one makes ITS guard vanish with no diagnostic
 * anywhere. The guard rested on an accidental signature difference, not on the tag. `code` sits in
 * parameter 2 and no subclass takes a `LokalizedErrorCode` there.
 *
 * @typedef {"MISSING_TRANSLATION" | "UNSUPPORTED_LOCALE" | "EXPRESSION_EVALUATION"
 *   | "RESOLUTION_INVALID_ARGUMENT" | "RESOLUTION_INVALID_STATE" | "STRINGS_PARSE"
 *   | "STRINGS_LOADING" | "DIGEST_UNAVAILABLE" | "CONFIGURATION"} LokalizedErrorCode
 *   Plan 3.2:400-409, verbatim and in the plan's order. The two `RESOLUTION_*` members are declared
 *   and NOT YET RAISED — see `src/internal/interpolate.js`, where the port records that plan open
 *   question 4 is what blocks them. They stay in the union because the union is the plan's, not the
 *   port's inventory of what it currently throws.
 */

/** Unexported by design: only this package can hand it to a constructor. */
export const LOKALIZED_ERROR_TOKEN = Symbol("lokalized.LokalizedError");

export class LokalizedError extends Error {
  /**
   * **PROTECTED, NOT PRIVATE, AND THE DIFFERENCE IS THE HIERARCHY.** Every subclass reaches this
   * through `super(...)`, which a private constructor forbids; `@protected` emits
   * `protected constructor();`, which TypeScript refuses to `new` from outside the class family
   * while still permitting the subclasses that need it. Together with the subclasses' own
   * `private constructor();` that is plan 3.5:1107-1108's "expose no constructor or extension
   * signature", expressed in TypeScript's own idiom rather than through the `CatchOnlyErrorClass`
   * alias — which would have cost a rename of every class binding and leaked an impl type name into
   * each declaration. The runtime token guard below is unchanged and is what stops plain JavaScript.
   *
   * @protected
   * @param {symbol} token the internal construction token
   * @param {LokalizedErrorCode} code the subclass's own code, supplied at `super(...)`
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(token, code, message, options) {
    if (token !== LOKALIZED_ERROR_TOKEN)
      throw new TypeError("LokalizedError is not constructible; it is thrown by lokalized");

    super(message, options);
    /** @type {LokalizedErrorCode} @readonly */
    this.code = code;
  }
}
