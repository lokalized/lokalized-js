// @ts-check

/**
 * Internal: `{{placeholder}}` scanning/substitution and language-form selection.
 *
 * Port of `StringInterpolator` plus the generated-placeholder resolution loop of
 * `DefaultStrings.getInternal`/`interpolateTemplate` from lokalized-java 3.0.0.
 *
 * Scope (see MODULE-CONTRACTS.md):
 * - whole-message and generated-fragment `alternatives`, selected first-match by compiled
 *   expressions supplied through the render context;
 * - language-form selection on all ten axes: `CARDINALITY_*` and `ORDINALITY_*` computed under the
 *   SUPPLYING locale, the nominal axes by exact tagged value;
 * - substitution of caller-supplied values, including the backslash escape forms;
 * - bidi isolation of caller-supplied values, decided by the caller and applied here because this is
 *   the only place that knows which substitutions came from the caller and which from the catalog.
 *
 * TWO SERVICES ARRIVE THROUGH THE CONTEXT rather than by import, and for the same reason in both
 * cases: this module sits in the ROOT graph, which `npm run scenario:0a` ratchets at 19 modules.
 * `evaluateExpression` keeps the expression evaluator's own edges out of here, and
 * `ordinalityNameFor`/`rangeCardinalityNameFor` keep the OPTIONAL `lokalized/data/ordinal` and
 * `lokalized/data/ranges` tables out of the root entirely — `createStrings` detects catalog use of
 * either eagerly and refuses construction when the consumer did not supply them, so a missing table
 * is a construction-time error and never a late lookup surprise.
 *
 * Deliberately absent: the interpolated-output character budget, which belongs with the runtime-limit
 * work — see the note in `bidi.js` on why half of it would be worse than none.
 */

import { isolate } from "./bidi.js";
import { LANGUAGE_FORM_NAMES } from "./catalog.js";
import { cardinalCategoryFor, operandsFromDecimalText, operandsFromNumber } from "./plural.js";

const PLACEHOLDER_START = "{{";
const PLACEHOLDER_END = "}}";
const ESCAPE_CHARACTER = "\\";

/** `LocalizedStringUtils.localizedStringIdentifierPattern()`. */
const IDENTIFIER_PATTERN = /^[\p{L}_][\p{L}\p{N}\p{M}_-]*$/u;

/** `TranslationRuntimeLimits.DEFAULT_MAXIMUM_GENERATED_PLACEHOLDER_DEPTH`. */
const DEFAULT_MAXIMUM_GENERATED_PLACEHOLDER_DEPTH = 32;

/**
 * `TranslationRuntimeLimits.DEFAULT_MAXIMUM_INTERPOLATED_OUTPUT_CHARACTERS`.
 *
 * Java bounds a phonetic TERM with this same limit rather than a limit of its own — see
 * `DefaultStrings.java:1163`, where `CharSequenceUtils.toString` is handed
 * `getRuntimeLimits().getMaximumInterpolatedOutputCharacters()`.
 */
const DEFAULT_MAXIMUM_INTERPOLATED_OUTPUT_CHARACTERS = 256 * 1024;

/**
 * @typedef {import("./catalog.js").Definition} Definition
 * @typedef {import("./catalog.js").PlaceholderDefinition} PlaceholderDefinition
 * @typedef {Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | null | undefined} Placeholders
 */

/**
 * One placeholder definition together with the JSON path of the node that declared it.
 *
 * `LocalizedString.PlaceholderBinding`. The path is diagnostic only — it is what
 * `contextualizePlaceholderFailure` reports as "declared at" — but it must follow the SELECTED path,
 * so a definition inherited from the root reports the root even when the failure happens three
 * alternatives deep.
 *
 * @typedef {object} PlaceholderBinding
 * @property {PlaceholderDefinition} definition
 * @property {string} declaringPath
 */

/** The empty inherited binding table a root definition starts from. */
const NO_BINDINGS = /** @type {ReadonlyMap<string, PlaceholderBinding>} */ (new Map());

/**
 * @typedef {object} RenderContext
 * @property {string} key the translation key, used for diagnostics
 * @property {string} evaluationLocale the SUPPLYING locale — the catalog the entry came from
 * @property {number} [maximumGeneratedPlaceholderDepth]
 * @property {(alternative: object, values: Placeholders) => boolean} [evaluateExpression]
 *   evaluates the alternative's EAGERLY COMPILED expression against RAW caller input. The raw bag is
 *   passed, not the renderer's lookup function, because an absent binding and an explicit `null` are
 *   different authoring mistakes and a lookup collapses them
 * @property {(value: unknown, locale: string) => string} [ordinalityNameFor]
 *   `lokalized/data/ordinal`'s classifier, as a language-form NAME (`"ORDINALITY_TWO"`)
 * @property {(startName: string, endName: string, locale: string) => string} [rangeCardinalityNameFor]
 *   `lokalized/data/ranges`'s classifier, over and returning language-form NAMEs
 * @property {(term: string, locale: string) => unknown} [phoneticResolver]
 *   the caller's `PhoneticResolver`, handed the EVALUATION locale. Absent here means the renderer
 *   was driven directly: `createStrings` always installs one, defaulting to the throwing resolver
 *   that reproduces `DefaultStrings.DEFAULT_PHONETIC_RESOLVER`
 * @property {number} [maximumInterpolatedOutputCharacters]
 *   `TranslationRuntimeLimits.maximumInterpolatedOutputCharacters`, which is also what bounds one
 *   phonetic TERM before it reaches the resolver
 * @property {boolean} [isolateValues] wrap caller-supplied values in FSI…PDI. ALREADY DECIDED by the
 *   caller, because the decision needs the isolation MODE and the evaluation locale together and
 *   only `createStrings` holds the mode; passing the answer rather than the inputs also keeps the
 *   renderer from having to know that a returned failure key uses a different locale than a
 *   translation does
 */

/**
 * Determines whether a string is a legal Lokalized placeholder/expression identifier.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidIdentifier(value) {
  return IDENTIFIER_PATTERN.test(value);
}

/**
 * @param {string} text
 * @param {number} index
 * @param {string} prefix
 * @returns {boolean}
 */
function startsWith(text, index, prefix) {
  return index >= 0 && text.startsWith(prefix, index);
}

/**
 * A caller-supplied value marked for bidi isolation — `BidiUtils.BoundedIsolatedValue`.
 *
 * A WRAPPER rather than an eagerly isolated string, and Java's reason is the one that matters here
 * too: the interpolation context holds caller values and translation-owned generated expansions
 * side by side, and only the caller's get isolated. Deciding at the point the context is BUILT and
 * carrying the decision on the value keeps `interpolate` from having to guess which is which, which
 * is exactly the guess `bidi-isolation.generated.file-defined-value-not-isolated` catches.
 *
 * Isolation happens after conversion, not before: Java's `render` calls `String.valueOf` and hands
 * the result to `isolate`, so a tagged language form is isolated as `FEMININE`, not as its record.
 */
class IsolatedValue {
  /** @param {unknown} value */
  constructor(value) {
    /** @type {unknown} */
    this.value = value;
  }
}

/**
 * Marks a caller-supplied value for isolation, leaving `null`/`undefined` alone.
 *
 * The null guard is Java's `value != null` at DefaultStrings.java:1367 and it is load-bearing: an
 * unbound name must stay unbound so the strict interpolator can report it, and wrapping it would
 * make `{{value}}` with an explicit `null` interpolate to a pair of isolate marks instead of
 * failing.
 *
 * @param {unknown} value
 * @param {boolean} isolateValues
 * @returns {unknown}
 */
function markForIsolation(value, isolateValues) {
  if (!isolateValues || value === null || value === undefined) return value;
  return new IsolatedValue(value);
}

/**
 * Faithful port of `StringInterpolator.interpolate`.
 *
 * @param {string} text
 * @param {(name: string) => unknown} lookup returns `undefined`/`null` when a name is unbound
 * @param {boolean} strict
 * @returns {{ value: string, unresolved: string[] }}
 */
function interpolate(text, lookup, strict) {
  let out = "";
  /** @type {string[]} */
  const unresolved = [];
  let index = 0;

  while (index < text.length) {
    if (text.charAt(index) === ESCAPE_CHARACTER) {
      if (startsWith(text, index + 1, ESCAPE_CHARACTER)) {
        out += ESCAPE_CHARACTER;
        index += 2;
        continue;
      }

      if (startsWith(text, index + 1, PLACEHOLDER_START)) {
        const escapedStart = index + 1;
        const escapedEnd = text.indexOf(PLACEHOLDER_END, escapedStart + PLACEHOLDER_START.length);

        if (escapedEnd < 0) {
          out += text.slice(escapedStart);
          break;
        }

        out += text.slice(escapedStart, escapedEnd + PLACEHOLDER_END.length);
        index = escapedEnd + PLACEHOLDER_END.length;
        continue;
      }

      if (startsWith(text, index + 1, PLACEHOLDER_END)) {
        out += PLACEHOLDER_END;
        index += 1 + PLACEHOLDER_END.length;
        continue;
      }

      out += ESCAPE_CHARACTER;
      ++index;
      continue;
    }

    if (startsWith(text, index, PLACEHOLDER_END)) {
      if (strict)
        throw new Error(
          `Unexpected placeholder closing delimiter '${PLACEHOLDER_END}' at index ${index}`,
        );

      out += PLACEHOLDER_END;
      index += PLACEHOLDER_END.length;
      continue;
    }

    if (!startsWith(text, index, PLACEHOLDER_START)) {
      out += text.charAt(index);
      ++index;
      continue;
    }

    const placeholderStart = index;
    const placeholderEnd = text.indexOf(
      PLACEHOLDER_END,
      placeholderStart + PLACEHOLDER_START.length,
    );

    if (placeholderEnd < 0) {
      if (strict) throw new Error(`Unclosed placeholder starting at index ${placeholderStart}`);

      out += text.slice(placeholderStart);
      break;
    }

    const name = text.slice(placeholderStart + PLACEHOLDER_START.length, placeholderEnd);

    if (!isValidIdentifier(name)) {
      if (strict)
        throw new Error(
          `Malformed placeholder '${PLACEHOLDER_START}${name}${PLACEHOLDER_END}'. Placeholder names ` +
            "must start with a Unicode letter or underscore and contain only Unicode letters, " +
            "Unicode numbers, Unicode combining marks, underscores, or hyphens",
        );

      out += text.slice(placeholderStart, placeholderEnd + PLACEHOLDER_END.length);
      index = placeholderEnd + PLACEHOLDER_END.length;
      continue;
    }

    const value = lookup(name);

    if (value === null || value === undefined) {
      if (!unresolved.includes(name)) unresolved.push(name);
      out += PLACEHOLDER_START + name + PLACEHOLDER_END;
    } else if (value instanceof IsolatedValue) {
      out += isolate(stringifyValue(value.value));
    } else {
      out += stringifyValue(value);
    }

    index = placeholderEnd + PLACEHOLDER_END.length;
  }

  return { value: out, unresolved };
}

/**
 * The placeholder names referenced by a template, in first-appearance order.
 *
 * Strict: throws on an unclosed placeholder, a stray closing delimiter, or a malformed name, which
 * is exactly what `LocalizedStringLoader.validatePlaceholderReferences` relies on.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function placeholderNamesIn(text) {
  return interpolate(text, () => undefined, true).unresolved;
}

/**
 * `DefaultStrings.interpolateFailureKey` — a returned key rendered with the caller's values.
 *
 * The key is a TEMPLATE, and the scanner it gets is the lenient one. That is the whole difference
 * from a catalog translation: a key is whatever string the caller passed, not text an author was
 * validated on, so a stray `}}`, an unclosed `{{`, a malformed name and an unsupplied placeholder
 * all stay literal instead of raising. The escape rules do NOT relax — only the error branches
 * differ between the two modes, which `interpolation-escapes.lenient.escape-sequences-behave-as-in-
 * strict-mode` pins on a key with no bindings at all.
 *
 * Isolation applies here too, and under the REQUESTED locale rather than a supplying one: by
 * definition no catalog supplied this entry. `bidi-isolation.rtl-request-ltr-donor.returned-key-
 * uses-requested-locale` is the case where the two answers differ — the same request resolves an
 * English donor without isolation and returns an isolated key.
 *
 * Total by contract: Java wraps the whole thing in `catch (RuntimeException e) { return key; }`
 * (DefaultStrings.java:1417), so a conversion, isolation or limit failure downgrades to the raw key
 * rather than turning a missing translation into a thrown render.
 *
 * @param {string} key
 * @param {Placeholders} placeholders
 * @param {boolean} isolateValues
 * @returns {string}
 */
export function interpolateFailureKey(key, placeholders, isolateValues) {
  try {
    const lookup = lookupFor(placeholders);
    return interpolate(key, (name) => markForIsolation(lookup(name), isolateValues), false).value;
  } catch {
    return key;
  }
}

/**
 * Java's `String.valueOf` for an interpolated replacement value.
 *
 * A tagged language-form value renders as its `renderName` (Java renders the enum constant name).
 * A tagged `decimal` renders its own digit string, trailing zeros and all — the corpus pins
 * `[1.0]` for a tagged decimal against `[1.5]` for a Java `double` of `1.50`, so the exact scale is
 * carried by the record, not recovered from a float.
 *
 * KNOWN DIVERGENCE, unpinned by the corpus: a plain JS `number` renders as `String(value)`. Java
 * renders a `Double` with `Double.toString`, which always keeps a `.0` and switches to `1.0E21`
 * form outside [1e-3, 1e7) where JS produces `1e+21`. No corpus expectation contains an
 * exponential or `.0` rendering of a raw number, so nothing pins the difference; a caller that
 * needs Java's exact spelling should pass a tagged `decimal`. Likewise a tagged `plural-operands`
 * renders its number, where Java would render the class's debug `toString`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();

  const tag = taggedKindOf(value);

  if (tag === "language-form") {
    const record = /** @type {{ name: string, renderName?: unknown }} */ (value);
    if (typeof record.renderName === "string") return record.renderName;
    return renderNameFor(record.name);
  }

  if (tag === "decimal" || tag === "plural-operands") {
    const record = /** @type {{ value: unknown }} */ (value);
    if (typeof record.value === "string") return record.value;
  }

  return String(value);
}

/**
 * Catalog name -> Java enum member name, built from the one generated table.
 *
 * LAZY, and not as an optimization: `catalog.js` imports this module, so a top-level read of
 * `LANGUAGE_FORM_NAMES` would hit the temporal dead zone whenever `catalog.js` is the module the
 * cycle is entered through. Building on first use defers the read past both modules' evaluation,
 * which ESM live bindings make safe.
 *
 * @type {Map<string, string> | null}
 */
let RENDER_NAMES = null;

/** @returns {Map<string, string>} */
function renderNames() {
  if (RENDER_NAMES !== null) return RENDER_NAMES;

  const names = new Map();

  for (const [, prefix, members] of LANGUAGE_FORM_NAMES)
    for (const member of members) names.set(`${prefix}${member}`, member);

  RENDER_NAMES = names;
  return names;
}

/**
 * The text a tagged language form renders as in a plain `{{slot}}`.
 *
 * The corpus pins Java's `String.valueOf(Gender.FEMININE)`: `GENDER_FEMININE` renders as
 * `FEMININE`, `CARDINALITY_ONE` as `ONE`.
 *
 * TABLE LOOKUP, never prefix stripping. Plan section 3.7 forbids the derivation outright, and the
 * reason is that the two agree only by accident of the current 61 names: nothing in the format stops
 * a future axis from being a prefix of another, and `renderName` is defined as the Java member's own
 * name rather than as whatever is left after removing some characters. The catalog names reaching
 * here are validated against this same table by the parser, so the fallback is unreachable through
 * `createStrings`; it returns the name unchanged rather than throwing, because this function is also
 * on the diagnostic path that builds a failure message.
 *
 * @param {string} name
 * @returns {string}
 */
export function renderNameFor(name) {
  return renderNames().get(name) ?? name;
}

/**
 * The `$lokalized` discriminator of a tagged record, or null for anything else.
 *
 * Recognition is structural so values survive JSON, RSC, workers and structured clone. A raw string
 * is ALWAYS text and is never sniffed, even when it spells a language form exactly.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function taggedKindOf(value) {
  if (typeof value !== "object" || value === null) return null;
  const tag = /** @type {{ $lokalized?: unknown }} */ (value).$lokalized;
  return typeof tag === "string" ? tag : null;
}

/**
 * Normalizes the caller-supplied placeholder bag into a lookup function.
 *
 * @param {Placeholders} placeholders
 * @returns {(name: string) => unknown}
 */
function lookupFor(placeholders) {
  if (placeholders === null || placeholders === undefined) return () => undefined;
  if (placeholders instanceof Map) return (name) => placeholders.get(name);
  const record = /** @type {Readonly<Record<string, unknown>>} */ (placeholders);
  return (name) => (Object.hasOwn(record, name) ? record[name] : undefined);
}

/**
 * Cardinal plural operands for a caller-supplied value.
 *
 * @param {unknown} value
 * @returns {import("./plural.js").Operands}
 */
function operandsForValue(value) {
  if (typeof value === "number" || typeof value === "bigint") return operandsFromNumber(value);

  const tag = taggedKindOf(value);

  if (tag === "decimal") {
    const text = /** @type {{ value: unknown }} */ (value).value;
    if (typeof text !== "string") throw new Error("A decimal value must carry a decimal string");
    return operandsFromDecimalText(text, {});
  }

  if (tag === "plural-operands") {
    const record = /** @type {{ value: unknown, visibleDecimalPlaces?: unknown, compactExponent?: unknown }} */ (
      value
    );
    if (typeof record.value !== "string")
      throw new Error("Plural operands must carry a decimal string");
    /** @type {{ visibleDecimalPlaces?: number, compactExponent?: number }} */
    const options = {};
    if (typeof record.visibleDecimalPlaces === "number")
      options.visibleDecimalPlaces = record.visibleDecimalPlaces;
    if (typeof record.compactExponent === "number")
      options.compactExponent = record.compactExponent;
    return operandsFromDecimalText(record.value, options);
  }

  throw new Error(
    "must be a number, bigint, decimal, plural-operands, or an exact tagged language form " +
      `but was ${describeValue(value)}`,
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeValue(value) {
  const tag = taggedKindOf(value);
  if (tag !== null) return `a tagged '${tag}' value`;
  if (value === null) return "null";
  return typeof value;
}

/**
 * The exact tagged language-form name on `value` for `axis`, or null when it is not one.
 *
 * @param {unknown} value
 * @param {string} axis
 * @returns {string | null}
 */
function taggedLanguageFormName(value, axis) {
  if (taggedKindOf(value) !== "language-form") return null;
  const record = /** @type {{ axis?: unknown, name?: unknown }} */ (value);
  if (record.axis !== axis) return null;
  return typeof record.name === "string" ? record.name : null;
}

/**
 * The Java class whose `getSimpleName()` appears in a selection description and in a
 * "Missing X translation for Y" diagnostic, by parsed axis.
 *
 * Not cosmetic: `contextualizePlaceholderFailure` puts this text into the message a failure handler
 * observes, and Java spells the AXIS TYPE rather than the catalog's member prefix.
 */
const AXIS_TYPE_NAMES = /** @type {Readonly<Record<import("./catalog.js").LanguageFormAxis, string>>} */ ({
  cardinality: "Cardinality",
  ordinality: "Ordinality",
  gender: "Gender",
  "grammatical-case": "GrammaticalCase",
  definiteness: "Definiteness",
  classifier: "Classifier",
  formality: "Formality",
  clusivity: "Clusivity",
  animacy: "Animacy",
  phonetic: "Phonetic",
});

/**
 * @param {import("./catalog.js").LanguageFormAxis} axis
 * @returns {string}
 */
function axisTypeName(axis) {
  return AXIS_TYPE_NAMES[axis];
}

/**
 * The Java class name `getClass().getSimpleName()` would print for a caller-supplied value, when the
 * port can know it — which is exactly when the value is a TAGGED LANGUAGE FORM.
 *
 * Java's "but was X" diagnostics print the runtime class, and most of that is genuinely
 * untranslatable: one JS `number` is both `Integer` and `Double`, and calling a JS tagged decimal a
 * `BigDecimal` would be advice about a type the caller does not have. A language form is the one
 * case where nothing is lost — the tagged value carries its own axis, and `AXIS_TYPE_NAMES` already
 * maps that axis onto the very class whose simple name Java prints. `Gender` here IS Java's
 * `Gender`, named from the port's own data rather than guessed from the JVM.
 *
 * Returns null when the value is not a tagged language form, so callers fall back to the
 * JS-idiomatic description.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function javaSimpleNameOf(value) {
  if (taggedKindOf(value) !== "language-form") return null;
  const axis = /** @type {{ axis?: unknown }} */ (value).axis;
  return typeof axis === "string" && Object.hasOwn(AXIS_TYPE_NAMES, axis)
    ? AXIS_TYPE_NAMES[/** @type {import("./catalog.js").LanguageFormAxis} */ (axis)]
    : null;
}

/**
 * The cardinal category name for a selector value — `DefaultStrings.cardinalityForValue`.
 *
 * An explicit `CARDINALITY_*` short-circuits classification entirely; anything else must be numeric
 * and is classified EXACTLY, under the supplying locale. A raw string is text and never numeric.
 *
 * @param {unknown} value
 * @param {string} evaluationLocale
 * @returns {string}
 */
function cardinalityNameForValue(value, evaluationLocale) {
  const explicit = taggedLanguageFormName(value, "cardinality");
  if (explicit !== null) return explicit;
  return `CARDINALITY_${cardinalCategoryFor(operandsForValue(value), evaluationLocale).toUpperCase()}`;
}

/**
 * The ordinal category name for a selector value — `DefaultStrings.ordinalityForValue`.
 *
 * Ordinal rules live in the OPTIONAL `lokalized/data/ordinal` module, which the root graph must not
 * import, so the classifier arrives through the render context. `createStrings` detects catalog use
 * of ordinality eagerly and refuses construction when the data was not supplied, so reaching the
 * absent-classifier branch here means the renderer was driven directly rather than through core.
 *
 * @param {unknown} value
 * @param {RenderContext} context
 * @returns {string}
 */
function ordinalityNameForValue(value, context) {
  const explicit = taggedLanguageFormName(value, "ordinality");
  if (explicit !== null) return explicit;

  const classify = context.ordinalityNameFor;

  if (classify === undefined)
    throw new Error(
      "ordinal classification requires the optional 'lokalized/data/ordinal' module; pass it as " +
        "createStrings({ pluralData: { ordinal: ordinalData } })",
    );

  return classify(value, context.evaluationLocale);
}

/**
 * The phonetic category name for a selector value — the `translationsByPhonetic` block of
 * `DefaultStrings.resolveGeneratedPlaceholders` (DefaultStrings.java:1148).
 *
 * The phonetic axis is the ONE nominal axis that also accepts a raw string, and the asymmetry is
 * deliberate rather than an inconsistency: elsewhere a raw string is text and never a language form,
 * but here it is a TERM the application's own resolver classifies. That is why `"PHONETIC_VOWEL"`
 * supplied as a caller value is still just a term — it is handed to the resolver like any other
 * word, and `phonetic-resolver.input.string-spelling-a-constant` records the resolver being called
 * with those fifteen characters and returning `CONSONANT`.
 *
 * The resolver receives the EVALUATION locale, not the requested one. `resolver-locale` proves this
 * across CLDR-parent, alias and divergent-selection cases — `zh-TW` selects `zh-Hant` for delivery
 * and still hands the resolver `en`, because `en` is the catalog that supplied the entry.
 *
 * Java's own default resolver throws when first reached, so an unconfigured resolver is a resolution
 * failure of the current candidate rather than a construction error; `createStrings` installs that
 * same throwing default, and the branch here only fires when the renderer is driven directly.
 *
 * @param {unknown} value
 * @param {string} valueName the placeholder name the term was read from, for diagnostics
 * @param {RenderContext} context
 * @returns {string} a `PHONETIC_*` name
 */
function phoneticNameForValue(value, valueName, context) {
  const explicit = taggedLanguageFormName(value, "phonetic");
  if (explicit !== null) return explicit;

  const { key } = context;

  if (typeof value !== "string")
    throw new Error(
      // Java verbatim, INCLUDING the trailing class name where the port can know it. A verbatim copy
      // that then drops a vaguer noun into the one slot it could have filled is half a port: the
      // corpus records `... but was Gender` and `... but was Cardinality`, and both are recoverable
      // from the tagged value's own axis. `Integer` and `Double` are not, and stay described the
      // JS way.
      `Placeholder '${valueName}' in key '${key}' must be a Phonetic or CharSequence but was ` +
        `${javaSimpleNameOf(value) ?? describeValue(value)}`,
    );

  const resolver = context.phoneticResolver;

  if (resolver === undefined)
    throw new Error(
      "No phoneticResolver was configured. Provide one via createStrings({ phoneticResolver }) to " +
        `classify placeholder '${valueName}' in key '${key}'`,
    );

  // `CharSequenceUtils.toString`, whose bound is checked BEFORE the resolver runs — which is what
  // `phonetic-resolver.limit.term-over-the-limit` observes as an empty `resolverCalls`.
  const maximum =
    context.maximumInterpolatedOutputCharacters ?? DEFAULT_MAXIMUM_INTERPOLATED_OUTPUT_CHARACTERS;

  if (value.length > maximum)
    throw new Error(
      `Phonetic input for placeholder '${valueName}' in key '${key}' exceeds the maximum of ` +
        `${maximum} characters`,
    );

  const resolved = resolver(value, context.evaluationLocale);
  const resolvedName = taggedLanguageFormName(resolved, "phonetic");

  if (resolvedName === null)
    throw new Error(
      resolved === null || resolved === undefined
        ? `PhoneticResolver returned null for placeholder '${valueName}' in key '${key}'`
        : `phoneticResolver returned a non-phonetic value for placeholder '${valueName}' in ` +
          `key '${key}'`,
    );

  return resolvedName;
}

/**
 * Selects the language form for one language-form placeholder definition.
 *
 * Returns the selected translation TEXT together with the selection description Java records for
 * diagnostics (`Cardinality.ONE`, `Gender.FEMININE`, `Cardinality.FEW range (start ONE, end OTHER)`).
 *
 * @param {import("./catalog.js").LanguageFormPlaceholder} definition
 * @param {(name: string) => unknown} lookup
 * @param {RenderContext} context
 * @returns {{ translation: string, selectionDescription: string }}
 */
function selectLanguageForm(definition, lookup, context) {
  const { key, evaluationLocale } = context;
  const typeName = axisTypeName(definition.axis);

  /** @type {string} */
  let formName;
  /** @type {string} */
  let selectionDescription;

  if (definition.range !== null) {
    // Range-driven cardinality. The parser has already rejected a range on any other axis.
    const { start, end } = definition.range;
    const startValue = lookup(start);
    const endValue = lookup(end);

    if (startValue === null || startValue === undefined)
      throw new Error(`Missing range start placeholder '${start}' for key '${key}'`);

    if (endValue === null || endValue === undefined)
      throw new Error(`Missing range end placeholder '${end}' for key '${key}'`);

    const startName = cardinalityNameForValue(startValue, evaluationLocale);
    const endName = cardinalityNameForValue(endValue, evaluationLocale);
    const combine = context.rangeCardinalityNameFor;

    if (combine === undefined)
      throw new Error(
        "cardinal-range classification requires the optional 'lokalized/data/ranges' module; pass " +
          "it as createStrings({ pluralData: { ranges: cardinalRangeData } })",
      );

    formName = combine(startName, endName, evaluationLocale);
    selectionDescription =
      `${typeName}.${renderNameFor(formName)} range ` +
      `(start ${renderNameFor(startName)}, end ${renderNameFor(endName)})`;
  } else {
    const valueName = definition.value;

    if (valueName === null)
      throw new Error(
        `Generated placeholder must define a value or range for key '${key}'`,
      );

    const value = lookup(valueName);

    if (value === null || value === undefined)
      throw new Error(`Missing value for placeholder '${valueName}' in key '${key}'`);

    if (definition.axis === "cardinality") {
      try {
        formName = cardinalityNameForValue(value, evaluationLocale);
      } catch (cause) {
        throw new Error(
          `Placeholder '${valueName}' in key '${key}': ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    } else if (definition.axis === "ordinality") {
      try {
        formName = ordinalityNameForValue(value, context);
      } catch (cause) {
        throw new Error(
          `Placeholder '${valueName}' in key '${key}': ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    } else if (definition.axis === "phonetic") {
      formName = phoneticNameForValue(value, valueName, context);
    } else {
      // A nominal axis takes ONLY an exact tagged value of that axis. A raw string is text, even
      // when it spells the constant, and a value from a different axis is cross-axis, not a match.
      const explicit = taggedLanguageFormName(value, definition.axis);

      if (explicit === null)
        throw new Error(
          `Placeholder '${valueName}' in key '${key}' must be a tagged ${definition.axis} language ` +
            `form but was ${describeValue(value)}`,
        );

      formName = explicit;
    }

    selectionDescription = `${typeName}.${renderNameFor(formName)}`;
  }

  const translation = definition.translations.get(formName);

  if (translation === undefined)
    throw new Error(`Missing ${typeName} translation for ${renderNameFor(formName)}`);

  return { translation, selectionDescription };
}

/**
 * Port of `DefaultStrings.resolveExpressionTranslation`.
 *
 * A generated fragment is a default template plus ordered `alternatives`. The FIRST alternative
 * whose compiled expression evaluates true supplies the template; otherwise the default does. The
 * expression reads RAW CALLER INPUT — never a generated value — which is what
 * `generated-placeholders.scope.fragment-alternative-cannot-read-generated-value` pins.
 *
 * @param {import("./catalog.js").ExpressionPlaceholder} definition
 * @param {Placeholders} values
 * @param {RenderContext} context
 * @returns {{ translation: string, selectionDescription: string }}
 */
function resolveExpressionTranslation(definition, values, context) {
  for (const alternative of definition.alternatives) {
    let matched;

    try {
      matched = evaluateAlternative(alternative, values, context);
    } catch (cause) {
      // Java re-throws the same category with the expression named, so a fragment failure carries
      // exactly two wrappers: this one, then the generated-placeholder boundary.
      throw new Error(
        `Unable to evaluate generated-fragment expression '${alternative.expression}': ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }

    if (matched)
      return {
        translation: alternative.translation,
        selectionDescription: `expression '${alternative.expression}'`,
      };
  }

  return { translation: definition.translation, selectionDescription: "default translation" };
}

/**
 * Evaluates one compiled alternative expression against the raw caller input.
 *
 * The compiled form is produced ONCE, when the catalog is parsed; the renderer never sees expression
 * TEXT as anything but a diagnostic label. The evaluator itself arrives through the context so this
 * module — and therefore the root graph — has no static edge to it.
 *
 * @param {object} alternative the parsed alternative node, which identifies its compiled expression
 * @param {Placeholders} values RAW caller input; a selector never reads a generated value
 * @param {RenderContext} context
 * @returns {boolean}
 */
function evaluateAlternative(alternative, values, context) {
  const evaluate = context.evaluateExpression;

  if (evaluate === undefined)
    throw new Error(
      "No compiled expression evaluator is available; alternatives cannot be selected",
    );

  return evaluate(alternative, values);
}

/**
 * `DefaultStrings.contextualizePlaceholderFailure`.
 *
 * Adds the placeholder name, its definition kind, the key, the JSON path the definition was declared
 * at, and (once one exists) what was selected. Message text is diagnostic rather than normative; the
 * CAUSE CHAIN is the part that is contracted, so the original error is always preserved as `cause`.
 *
 * @param {string} key
 * @param {string} placeholderName
 * @param {PlaceholderBinding} binding
 * @param {string | null} selectionDescription
 * @param {unknown} cause
 * @returns {Error}
 */
function contextualizePlaceholderFailure(key, placeholderName, binding, selectionDescription, cause) {
  const kind =
    binding.definition.kind === "expression" ? "ExpressionTranslation" : "LanguageFormTranslation";
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const selectionContext = selectionDescription === null ? "" : `; selected ${selectionDescription}`;

  return new Error(
    `Unable to resolve generated placeholder '${placeholderName}' (${kind}) for key '${key}'; ` +
      `definition declared at ${binding.declaringPath}${selectionContext}: ${causeMessage}`,
    { cause },
  );
}

/**
 * Resolves one generated placeholder to its template text plus its selection description.
 *
 * @param {PlaceholderBinding} binding
 * @param {(name: string) => unknown} lookup
 * @param {Placeholders} values
 * @param {RenderContext} context
 * @param {string} placeholderName
 * @returns {{ translation: string, selectionDescription: string }}
 */
function resolvePlaceholder(binding, lookup, values, context, placeholderName) {
  try {
    if (binding.definition.kind === "expression")
      return resolveExpressionTranslation(binding.definition, values, context);

    return selectLanguageForm(binding.definition, lookup, context);
  } catch (cause) {
    throw contextualizePlaceholderFailure(context.key, placeholderName, binding, null, cause);
  }
}

/**
 * Port of `DefaultStrings.interpolateTemplate`.
 *
 * @param {string} template
 * @param {Map<string, string>} generated resolved generated-placeholder templates
 * @param {Map<string, string>} selectionDescriptions what each generated placeholder selected
 * @param {Map<string, PlaceholderBinding>} bindings
 * @param {(name: string) => unknown} lookup
 * @param {RenderContext} context
 * @param {Map<string, string>} expanded memoized expansions
 * @param {string[]} path active generated-placeholder path, for cycle detection
 * @param {number} depth
 * @param {number} maximumDepth
 * @returns {string}
 */
function interpolateTemplate(
  template,
  generated,
  selectionDescriptions,
  bindings,
  lookup,
  context,
  expanded,
  path,
  depth,
  maximumDepth,
) {
  if (depth > maximumDepth)
    throw new Error(
      `Generated placeholder nesting for key '${context.key}' exceeds the maximum depth of ` +
        `${maximumDepth}: ${path.join(" -> ")}`,
    );

  /** @type {Map<string, unknown>} */
  const interpolationContext = new Map();

  for (const name of placeholderNamesIn(template)) {
    const binding = bindings.get(name);

    if (binding !== undefined) {
      const memoized = expanded.get(name);

      if (memoized !== undefined) {
        interpolationContext.set(name, memoized);
        continue;
      }

      // Cycle detection is a STACK, not a visited set: a name may legitimately be generated more
      // than once on different paths, and only a name active on the CURRENT path is a cycle.
      const cycleStart = path.indexOf(name);

      if (cycleStart >= 0)
        throw new Error(
          `Generated placeholder cycle for key '${context.key}': ` +
            `${[...path.slice(cycleStart), name].join(" -> ")}`,
        );

      const generatedValue = generated.get(name);

      if (generatedValue !== undefined) {
        path.push(name);

        try {
          const expandedValue = interpolateTemplate(
            generatedValue,
            generated,
            selectionDescriptions,
            bindings,
            lookup,
            context,
            expanded,
            path,
            depth + 1,
            maximumDepth,
          );
          expanded.set(name, expandedValue);
          interpolationContext.set(name, expandedValue);
        } catch (cause) {
          throw contextualizePlaceholderFailure(
            context.key,
            name,
            binding,
            selectionDescriptions.get(name) ?? null,
            cause,
          );
        } finally {
          path.pop();
        }
      }
    } else {
      // The only branch that isolates. Java's `interpolateTemplate` consults
      // `shouldApplyBidiIsolation` here and NOT in the generated-placeholder branch above
      // (DefaultStrings.java:1365-1371), so one rendered message can legitimately carry an isolated
      // caller value beside a bare generated one — which is the whole shape of
      // `bidi-isolation.generated.file-defined-value-not-isolated`.
      interpolationContext.set(name, markForIsolation(lookup(name), context.isolateValues === true));
    }
  }

  const result = interpolate(template, (name) => interpolationContext.get(name), true);

  if (result.unresolved.length > 0)
    throw new Error(
      `Missing value for placeholder(s) [${result.unresolved.join(", ")}] in key '${context.key}'`,
    );

  return result.value;
}

/**
 * Selects the definition actually in force for a node, walking whole-message alternatives.
 *
 * Two rules, and they are not the same rule:
 *
 * - **Bindings accumulate by NAME.** A branch's own `placeholders` entry REPLACES the inherited
 *   binding for that name outright — the definition is swapped whole, never merged form-by-form, so
 *   a branch table declaring only `CARDINALITY_OTHER` fails for a value selecting `ONE` instead of
 *   borrowing the parent's. Names the branch does not mention keep the ancestor's definition, which
 *   is `generated-placeholders.inheritance.grandchild-inherits-nearest-ancestor-definition`.
 * - **Alternatives are first-match and terminal.** Once a condition matches, only that branch may
 *   resolve; an unmatched nested subtree does NOT fall through to a later sibling.
 *
 * Returns null for Java's `Optional.empty()`: no alternative matched and this node has no
 * translation of its own, which the caller reports as `no-matching-alternative`.
 *
 * @param {Definition} node
 * @param {Placeholders} values
 * @param {RenderContext} context
 * @param {ReadonlyMap<string, PlaceholderBinding>} inherited
 * @param {string} selectedPath
 * @returns {{ translation: string, bindings: Map<string, PlaceholderBinding> } | null}
 */
function selectDefinition(node, values, context, inherited, selectedPath) {
  /** @type {Map<string, PlaceholderBinding>} */
  const bindings = new Map(inherited);

  for (const [name, definition] of node.placeholders)
    bindings.set(name, { definition, declaringPath: selectedPath });

  for (const alternative of node.alternatives) {
    if (!evaluateAlternative(alternative, values, context)) continue;

    return selectDefinition(
      alternative.definition,
      values,
      context,
      bindings,
      `${selectedPath} -> alternative[${alternative.expression}]`,
    );
  }

  if (node.translation === null) return null;

  return { translation: node.translation, bindings };
}

/**
 * Renders one parsed definition.
 *
 * Returns null when no alternative matched and the selected node has no translation of its own —
 * Java's `Optional.empty()`, which the caller reports as `no-matching-alternative` and which the
 * default fallback policy WALKS PAST rather than halting on. Throws on a missing language-form
 * branch, an unresolvable placeholder, or a failed expression; the caller turns that into a
 * resolution failure, which the default policy does halt on.
 *
 * `context.evaluationLocale` is the SUPPLYING locale (the catalog the entry came from), never the
 * requested one; every cardinal, ordinal and range category is computed under it.
 *
 * Resolution is LAZY by contract, not as an optimization: only placeholders the rendered text
 * actually names are generated, which is why a cycle inside an unreached branch is not a cycle.
 *
 * @param {Definition} definition
 * @param {Placeholders} placeholders
 * @param {RenderContext} context
 * @returns {string | null}
 */
export function render(definition, placeholders, context) {
  const lookup = lookupFor(placeholders);
  const maximumDepth =
    context.maximumGeneratedPlaceholderDepth ?? DEFAULT_MAXIMUM_GENERATED_PLACEHOLDER_DEPTH;

  const selected = selectDefinition(definition, placeholders, context, NO_BINDINGS, context.key);

  if (selected === null) return null;

  const { translation, bindings } = selected;

  /** @type {Map<string, string>} */
  const generated = new Map();
  /** @type {Map<string, string>} */
  const selectionDescriptions = new Map();
  /** @type {string[]} */
  const pending = [];
  /** @type {Set<string>} */
  const resolved = new Set();

  /** @param {string} text */
  const enqueue = (text) => {
    for (const name of placeholderNamesIn(text))
      if (bindings.has(name) && !resolved.has(name) && !pending.includes(name)) pending.push(name);
  };

  enqueue(translation);

  while (pending.length > 0) {
    const name = /** @type {string} */ (pending.shift());

    if (resolved.has(name)) continue;
    resolved.add(name);

    const binding = bindings.get(name);

    if (binding === undefined)
      throw new Error(
        `No effective definition was found for generated placeholder '${name}' in key '${context.key}'`,
      );

    const { translation: resolvedTemplate, selectionDescription } = resolvePlaceholder(
      binding,
      lookup,
      placeholders,
      context,
      name,
    );
    generated.set(name, resolvedTemplate);
    selectionDescriptions.set(name, selectionDescription);
    enqueue(resolvedTemplate);
  }

  return interpolateTemplate(
    translation,
    generated,
    selectionDescriptions,
    bindings,
    lookup,
    context,
    new Map(),
    [],
    0,
    maximumDepth,
  );
}
