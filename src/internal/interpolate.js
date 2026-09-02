// @ts-check

/**
 * Internal: `{{placeholder}}` scanning/substitution and language-form selection.
 *
 * Port of `StringInterpolator` plus the generated-placeholder resolution loop of
 * `DefaultStrings.getInternal`/`interpolateTemplate` from lokalized-java 3.0.0.
 *
 * M2 scope (see MODULE-CONTRACTS.md):
 * - language-form selection for `CARDINALITY_*` (computed under the SUPPLYING locale) and for the
 *   nominal axes by exact tagged value;
 * - substitution of caller-supplied values, including the backslash escape forms;
 * - generated (template-mode) placeholders resolve to their default translation.
 *
 * Deliberately absent in M2: expression evaluation (`alternatives`, M6), bidi isolation,
 * ordinal/range classification (the `ordinal`/`ranges` data modules are not generated yet).
 */

import { cardinalCategoryFor, operandsFromDecimalText, operandsFromNumber } from "./plural.js";

const PLACEHOLDER_START = "{{";
const PLACEHOLDER_END = "}}";
const ESCAPE_CHARACTER = "\\";

/** `LocalizedStringUtils.localizedStringIdentifierPattern()`. */
const IDENTIFIER_PATTERN = /^[\p{L}_][\p{L}\p{N}\p{M}_-]*$/u;

/** `TranslationRuntimeLimits.DEFAULT_MAXIMUM_GENERATED_PLACEHOLDER_DEPTH`. */
const DEFAULT_MAXIMUM_GENERATED_PLACEHOLDER_DEPTH = 32;

/**
 * @typedef {import("./catalog.js").Definition} Definition
 * @typedef {import("./catalog.js").PlaceholderDefinition} PlaceholderDefinition
 */

/**
 * @typedef {object} RenderContext
 * @property {string} key the translation key, used for diagnostics
 * @property {string} evaluationLocale the SUPPLYING locale — the catalog the entry came from
 * @property {number} [maximumGeneratedPlaceholderDepth]
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
function stringifyValue(value) {
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
 * Axis prefixes of the catalog spelling of a language form. None contains an underscore itself, so
 * stripping the matching prefix yields Java's bare enum constant name.
 */
const LANGUAGE_FORM_PREFIXES = [
  "CARDINALITY_",
  "ORDINALITY_",
  "GENDER_",
  "CASE_",
  "DEFINITENESS_",
  "CLASSIFIER_",
  "FORMALITY_",
  "CLUSIVITY_",
  "ANIMACY_",
  "PHONETIC_",
];

/**
 * The text a tagged language form renders as in a plain `{{slot}}`.
 *
 * The corpus pins Java's `String.valueOf(Gender.FEMININE)`: `GENDER_FEMININE` renders as
 * `FEMININE`, `CARDINALITY_ONE` as `ONE`. A value carrying an explicit `renderName` wins.
 *
 * @param {string} name
 * @returns {string}
 */
export function renderNameFor(name) {
  for (const prefix of LANGUAGE_FORM_PREFIXES)
    if (name.startsWith(prefix)) return name.slice(prefix.length);

  return name;
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
 * @param {Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | null | undefined} placeholders
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
 * Selects the language form for one language-form placeholder definition.
 *
 * @param {import("./catalog.js").LanguageFormPlaceholder} definition
 * @param {(name: string) => unknown} lookup
 * @param {RenderContext} context
 * @param {string} placeholderName
 * @returns {string}
 */
function selectLanguageForm(definition, lookup, context, placeholderName) {
  const { key, evaluationLocale } = context;

  if (definition.range !== null)
    throw new Error(
      `Unable to resolve generated placeholder '${placeholderName}' for key '${key}': ` +
        "range-driven cardinality selection is not implemented in M2",
    );

  const valueName = definition.value;

  if (valueName === null)
    throw new Error(
      `Generated placeholder '${placeholderName}' must define a value or range for key '${key}'`,
    );

  const value = lookup(valueName);

  if (value === null || value === undefined)
    throw new Error(`Missing value for placeholder '${valueName}' in key '${key}'`);

  let formName;

  if (definition.axis === "cardinality") {
    const explicit = taggedLanguageFormName(value, "cardinality");

    if (explicit !== null) {
      formName = explicit;
    } else {
      try {
        formName = `CARDINALITY_${cardinalCategoryFor(operandsForValue(value), evaluationLocale).toUpperCase()}`;
      } catch (cause) {
        throw new Error(
          `Placeholder '${valueName}' in key '${key}': ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    }
  } else if (definition.axis === "ordinality") {
    const explicit = taggedLanguageFormName(value, "ordinality");

    if (explicit === null)
      throw new Error(
        `Placeholder '${valueName}' in key '${key}': numeric ordinality selection is not ` +
          "implemented in M2; supply an exact tagged ORDINALITY_* value",
      );

    formName = explicit;
  } else {
    const explicit = taggedLanguageFormName(value, definition.axis);

    if (explicit === null)
      throw new Error(
        `Placeholder '${valueName}' in key '${key}' must be a tagged ${definition.axis} language ` +
          `form but was ${describeValue(value)}`,
      );

    formName = explicit;
  }

  const translation = definition.translations.get(formName);

  if (translation === undefined)
    throw new Error(`Missing ${definition.axis} translation for ${formName} in key '${key}'`);

  return translation;
}

/**
 * Resolves one generated placeholder to its template text.
 *
 * @param {PlaceholderDefinition} definition
 * @param {(name: string) => unknown} lookup
 * @param {RenderContext} context
 * @param {string} placeholderName
 * @returns {string}
 */
function resolvePlaceholder(definition, lookup, context, placeholderName) {
  // M2: fragment `alternatives` are not evaluated, so a template-mode placeholder always resolves
  // to its default translation — which is what Java does when no fragment expression matches.
  if (definition.kind === "expression") return definition.translation;
  return selectLanguageForm(definition, lookup, context, placeholderName);
}

/**
 * Port of `DefaultStrings.interpolateTemplate`.
 *
 * @param {string} template
 * @param {Map<string, string>} generated resolved generated-placeholder templates
 * @param {Map<string, PlaceholderDefinition>} bindings
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
    if (bindings.has(name)) {
      const memoized = expanded.get(name);

      if (memoized !== undefined) {
        interpolationContext.set(name, memoized);
        continue;
      }

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
        } finally {
          path.pop();
        }
      }
    } else {
      interpolationContext.set(name, lookup(name));
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
 * Renders one parsed definition.
 *
 * Throws on a missing language-form branch, an unresolvable placeholder, or a failed alternative —
 * the caller turns that into a resolution failure.
 *
 * `context.evaluationLocale` is the SUPPLYING locale (the catalog the entry came from), never the
 * requested one; every cardinal category is computed under it.
 *
 * M2: whole-message and fragment `alternatives` are parsed but NOT evaluated — the expression
 * language is M6 — so this renders the branch Java takes when no alternative matches: the node's
 * own translation, and a fragment placeholder's default translation. An entry whose only content is
 * alternatives therefore throws.
 *
 * @param {Definition} definition
 * @param {Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | null | undefined} placeholders
 * @param {RenderContext} context
 * @returns {string}
 */
export function render(definition, placeholders, context) {
  const lookup = lookupFor(placeholders);
  const maximumDepth =
    context.maximumGeneratedPlaceholderDepth ?? DEFAULT_MAXIMUM_GENERATED_PLACEHOLDER_DEPTH;

  // M2: whole-message `alternatives` are parsed but not evaluated (the expression language is M6),
  // so rendering always takes the default translation branch.
  const translation = definition.translation;

  if (translation === null)
    throw new Error(
      `No matching alternative and no default translation for key '${context.key}'` +
        " (alternative expressions are not evaluated in M2)",
    );

  const bindings = definition.placeholders;

  /** @type {Map<string, string>} */
  const generated = new Map();
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

    const resolvedTemplate = resolvePlaceholder(binding, lookup, context, name);
    generated.set(name, resolvedTemplate);
    enqueue(resolvedTemplate);
  }

  return interpolateTemplate(
    translation,
    generated,
    bindings,
    lookup,
    context,
    new Map(),
    [],
    0,
    maximumDepth,
  );
}
