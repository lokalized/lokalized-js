// @ts-check
/**
 * THROWAWAY M2 SPIKE — generated placeholders. NOT SHIPPING CODE.
 *
 * `package.json` `files` is an allowlist (`src/`, `types/`, …), so nothing here is packed. This
 * exists to answer one question before M5b and M6 commit to a design: can the six generated-
 * placeholder behaviors plan v7 names for M2 actually be implemented coherently together? Its cases
 * become stable M3b vectors; its code does not become anything.
 *
 * It is deliberately simple where shipping code cannot be: no bounded limits, no diagnostics, no
 * error contextualization, and an expression evaluator that handles only the comparison shapes the
 * corpus fixtures actually use. Judge it on whether the six behaviors compose, not on its edges.
 *
 * THE SIX BEHAVIORS, and the design decision each one forces:
 *
 *  1. Branch inheritance — a selected alternative WITHOUT its own `placeholders` sees the parent's.
 *  2. Whole-definition replacement — a branch WITH `placeholders` replaces the table ENTIRELY. A
 *     partial branch table is not merged with the parent, so a form the branch omits is simply
 *     absent. Merging would be the natural implementation and it is wrong.
 *  3. Cross-kind replacement — a language-form placeholder (`translations`) may be replaced by a
 *     fragment (`translation` + `alternatives`) and vice versa, so kind is per-definition, not
 *     per-name.
 *  4. Late-bound dependency after selection — the text a placeholder SELECTS may itself reference
 *     other placeholders, which are resolved only once that branch wins.
 *  5. Reachable-cycle failure — a cycle among placeholders that the selected path actually reaches
 *     is a resolution failure.
 *  6. Unreachable-definition laziness — and a cycle the selected path does NOT reach is not a
 *     failure at all, which is what forces resolution to be lazy rather than eager. These two are
 *     one design decision seen from both sides.
 *
 * THE SCOPE RULE that makes 4-6 tractable: a SELECTOR (`value`, `range`) reads RAW CALLER INPUT,
 * while a TEMPLATE reference `{{name}}` reads the GENERATED value. The same name can mean different
 * things in the two positions, and conflating them silently changes selection.
 */
import { cardinalCategoryFor, operandsFromNumber } from "../../src/internal/plural.js";

/** Raised when the selected path reaches a cycle. */
export class CycleError extends Error {}
/** Raised when a definition cannot produce a value (no matching form, unknown reference). */
export class ResolutionError extends Error {}

// --- expressions ---------------------------------------------------------------------------------

/**
 * Evaluate an alternative's expression against RAW caller input.
 *
 * Only the shapes the corpus uses: a comparison between a placeholder name and a literal, optionally
 * joined by `and`/`or`. No `eval`, no `new Function` — the shipping evaluator is M6 and will be a
 * real tokenizer; this is enough to drive branch selection so the OTHER five behaviors can be tested.
 *
 * @param {string} expression
 * @param {Record<string, unknown>} rawInputs
 */
export function evaluate(expression, rawInputs) {
  // Both spellings: the corpus uses `&&` and `and` interchangeably, and only the symbolic form
  // appears in the cross-kind fixtures. Supporting one silently sends those to the parent branch.
  for (const separator of [" || ", " or "]) {
    const parts = splitTop(expression, separator);
    if (parts.length > 1) return parts.some((part) => evaluate(part, rawInputs));
  }
  for (const separator of [" && ", " and "]) {
    const parts = splitTop(expression, separator);
    if (parts.length > 1) return parts.every((part) => evaluate(part, rawInputs));
  }

  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*$/.exec(expression);
  if (!match) throw new ResolutionError(`spike cannot evaluate: ${expression}`);
  const [, name, operator, literalText] = match;

  // The operand is RAW INPUT. Reading a generated value here would change which branch wins.
  if (!Object.prototype.hasOwnProperty.call(rawInputs, name))
    throw new ResolutionError(`no value supplied for '${name}'`);
  const left = rawInputs[name];
  const literal = /^-?\d+(?:\.\d+)?$/.test(literalText) ? Number(literalText) : literalText.replace(/^["']|["']$/g, "");

  switch (operator) {
    case "==": return left === literal;
    case "!=": return left !== literal;
    case "<": return Number(left) < Number(literal);
    case "<=": return Number(left) <= Number(literal);
    case ">": return Number(left) > Number(literal);
    case ">=": return Number(left) >= Number(literal);
    default: throw new ResolutionError(`unknown operator ${operator}`);
  }
}

/** Split on a separator that is not inside parentheses. */
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// --- the model -----------------------------------------------------------------------------------

/** Normalize a raw alternative entry, whose value may be a bare string. */
const asDefinition = (value) => (typeof value === "string" ? { translation: value } : value);

/**
 * Select the winning branch of a definition and return the definition actually in force.
 *
 * BEHAVIOR 1 and 2 live here. An alternative that declares `placeholders` REPLACES the inherited
 * table outright; one that does not INHERITS it. There is no merge step, deliberately — see the
 * partial-branch-table case, where a branch declaring only CARDINALITY_OTHER must fail for a value
 * that selects ONE rather than quietly falling back to the parent's ONE.
 *
 * @param {any} definition
 * @param {Record<string, unknown>} rawInputs
 * @param {Record<string, any>} inheritedTable
 */
function select(definition, rawInputs, inheritedTable) {
  const own = definition.placeholders ?? null;
  const table = own === null ? inheritedTable : own;

  for (const alternative of definition.alternatives ?? []) {
    const [expression, rawBranch] = Object.entries(alternative)[0];
    if (!evaluate(expression, rawInputs)) continue;
    // Recurse: a branch may itself carry alternatives, and inheritance is from the branch's own
    // parent — the table in force here, not the original entry's.
    return select(asDefinition(rawBranch), rawInputs, table);
  }

  // Returns the DEFINITION in force, not its text. A language-form placeholder has no `translation`
  // at all — only a `translations` map — so resolving to text here would reject it before its kind
  // was ever looked at. Kind is decided by the caller, after selection, which is what makes
  // cross-kind replacement (behavior 3) expressible.
  return { definition, table };
}

/**
 * Produce the value of one generated placeholder.
 *
 * BEHAVIOR 3 is the `kind` branch below: the definition decides whether this name is a language form
 * or a fragment, so replacing a definition can change its kind.
 *
 * BEHAVIOR 4 is the recursive `interpolate` at the end: whatever text a branch selects is itself
 * interpolated, pulling in dependencies only after selection has chosen it.
 *
 * @param {string} name
 * @param {Record<string, any>} table
 * @param {Record<string, unknown>} rawInputs
 * @param {string} locale
 * @param {Set<string>} inProgress
 */
function generate(name, table, rawInputs, locale, inProgress) {
  // BEHAVIOR 5: a cycle the selected path actually reaches. `inProgress` is the resolution stack,
  // not a visited set, so a name may legitimately be generated twice in different branches.
  if (inProgress.has(name))
    throw new CycleError(`cycle through generated placeholder '${name}'`);
  inProgress.add(name);
  try {
    const { definition, table: inForce } = select(table[name], rawInputs, table);

    if (definition.translations) {
      // Language-form kind. The SELECTOR reads raw input — `value`, or `range` endpoints — never a
      // generated value, which is the scope rule that keeps selection independent of expansion.
      const selectorName = definition.value ?? definition.range?.start;
      if (selectorName === undefined) throw new ResolutionError(`placeholder '${name}' has no selector`);
      if (definition.range) throw new ResolutionError("cardinal ranges need the M4 range data");

      const raw = rawInputs[selectorName];
      if (raw === undefined) throw new ResolutionError(`no value supplied for selector '${selectorName}'`);
      const category = cardinalCategoryFor(operandsFromNumber(/** @type {any} */ (raw)), locale);
      const form = `CARDINALITY_${category.toUpperCase()}`;

      const selected = definition.translations[form];
      // BEHAVIOR 2's consequence: the table in force may simply not have this form.
      if (selected === undefined)
        throw new ResolutionError(`no ${form} translation for placeholder '${name}'`);
      return interpolate(selected, inForce, rawInputs, locale, inProgress);
    }

    // Fragment kind: the selected text, interpolated in the table in force.
    if (definition.translation === undefined || definition.translation === null)
      throw new ResolutionError(`placeholder '${name}' has no translation and no language forms`);
    return interpolate(definition.translation, inForce, rawInputs, locale, inProgress);
  } finally {
    inProgress.delete(name);
  }
}

/**
 * Interpolate one template.
 *
 * BEHAVIOR 6 is the shape of this loop: a placeholder is generated ONLY when the text being rendered
 * actually names it. A definition the selected path never mentions is never evaluated, so a cycle
 * inside it is not a cycle. Eager resolution would fail those cases and is the obvious wrong design.
 *
 * @param {string} template
 * @param {Record<string, any>} table
 * @param {Record<string, unknown>} rawInputs
 * @param {string} locale
 * @param {Set<string>} inProgress
 */
function interpolate(template, table, rawInputs, locale, inProgress) {
  let out = "";
  let index = 0;
  const pattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  for (let m = pattern.exec(template); m !== null; m = pattern.exec(template)) {
    out += template.slice(index, m.index);
    const name = m[1];
    if (Object.prototype.hasOwnProperty.call(table, name)) {
      out += generate(name, table, rawInputs, locale, inProgress);
    } else if (Object.prototype.hasOwnProperty.call(rawInputs, name)) {
      // A template reference to a name with no generated definition renders the raw input.
      out += String(rawInputs[name]);
    } else {
      throw new ResolutionError(`no value supplied for '${name}'`);
    }
    index = m.index + m[0].length;
  }
  return out + template.slice(index);
}

/**
 * Render one catalog entry.
 *
 * @param {any} entry the raw catalog entry
 * @param {Record<string, unknown>} rawInputs
 * @param {string} locale the EVALUATION locale — the supplying catalog's, not the requested one
 * @returns {string}
 */
export function render(entry, rawInputs, locale) {
  const outer = asDefinition(entry);
  const { definition, table } = select(outer, rawInputs, outer.placeholders ?? {});
  if (definition.translation === undefined || definition.translation === null)
    throw new ResolutionError("no matching alternative and no default translation");
  return interpolate(definition.translation, table, rawInputs, locale, new Set());
}
