# Internal module contracts — M2 walking skeleton

These are INTERNAL modules under `src/internal/`. They are not public surface and appear in no export
subpath; `symbol-allowlist.json` still governs what `lokalized` and `lokalized/*` expose. They exist
so the skeleton can be built and verified in independent pieces.

Every module is ESM, `// @ts-check` clean under the repo's `tsconfig.json` (`checkJs`, `strict`,
`noUncheckedIndexedAccess`), imports only from `../data/*.js` and other `src/internal/*` modules, and
uses no Node built-ins — the root graph must run unchanged in a browser.

**The corpus is the specification.** `../lokalized-spec/generated/behavioral-vectors.json` records
what lokalized-java 3.0.0 actually does for 1,965 cases. Where this document and the corpus disagree,
the corpus wins and the disagreement is a finding worth reporting.

---

## `src/internal/locale.js`

```js
/** Canonical BCP-47 form. Throws RangeError on a malformed tag. */
export function normalizeTag(tag)                       // -> string
export function primaryLanguage(tag)                    // -> string
/** CLDR parent walk from `tag`, excluding the tag itself and excluding "root". */
export function parentChain(tag)                        // -> string[]
/** Likely-subtags maximization to a full language-script-region triple. */
export function maximize(tag)                           // -> string
/**
 * Java's strict single-locale match kernel.
 * `supported` is the loaded locale set; `tiebreakers` maps language code -> ordered tags.
 */
export function matchFor(requested, supported, fallbackLocale, tiebreakers)
// -> { matchType, locale, isMatch, fallbackLocale, consideredLocales, effectiveWeight, languageRange, requestedLanguageRanges }
/**
 * The per-key candidate walk, first-wins deduplicated, in the order resolution must attempt them.
 * This is NOT the matcher: selection and resolution are separate channels that legitimately differ.
 */
export function candidateChain(lookupTag, supported, fallbackLocale, tiebreakers) // -> string[]
```

`matchType` values are the JS spellings: `none`, `exact`, `canonical`, `cldr-fallback`,
`likely-subtag`, `extended-range`, `primary-language`, `wildcard`.

**Verify against** the corpus's `matchFor` cases (216) and the `resolution.direct.*` seed rows, whose
`attemptedLocales` are exactly what `candidateChain` must produce.

---

## `src/internal/plural.js`

```js
/** CLDR plural operands. All fields are exact; `n` is the absolute value. */
// Operands = { n: string, i: string, v: number, w: number, f: string, t: string, c: number, e: number }
export function operandsFromNumber(value)               // number | bigint -> Operands
export function operandsFromDecimalText(text, options)  // options: {visibleDecimalPlaces?, compactExponent?}
export function cardinalCategoryFor(operands, localeTag) // -> "zero"|"one"|"two"|"few"|"many"|"other"
```

`src/data/cardinal.js` decodes to `[{ locales: string[], rules: [category, expression][] }]` where
each expression is CLDR plural-rule syntax (`n = 1`, `i = 0 or n = 1`,
`n % 10 = 1 and n % 100 != 11`, `v = 0 and i % 100 = 3..10`). Rules are ordered; the first matching
category wins and an empty expression is the unconditional `other`.

Arithmetic must be EXACT — digit strings and `BigInt`, never float. `10n ** 20n` and `1.0` versus `1`
are the cases that break a float implementation, and the corpus contains both.

**Verify against** the 49 `cardinalityForNumber` cases and 15 `cardinalityForOperands` cases.

---

## `src/internal/catalog.js`

```js
/** Bounded parse of one raw catalog object into the internal model. */
export function parseCatalog(raw, context)   // context: { locale, source } -> Map<string, Definition>

// Definition = {
//   translation: string,
//   placeholders: Map<string, PlaceholderDefinition>,
//   alternatives: Alternative[],
// }
// PlaceholderDefinition = { value: string, translations: Map<string, string> }   // key: "CARDINALITY_ONE" etc
// Alternative = { expression: string, definition: Definition }
```

A catalog entry is either a plain string (its own translation, no placeholders) or an object with
`translation`, optional `placeholders`, optional `alternatives`, optional `commentary`.

Bounded means the limits are checked while parsing, not after: translation-node count, nesting depth,
and alternative depth. M2 needs the limits present and enforced, not the full diagnostic surface —
`lokalized/parse`'s duplicate rejection and line/column reporting are M5a.

**Verify against** the corpus `fixtures` — every one of the 483 must parse without error, since Java
loaded them all. That is a strong self-test available immediately.

---

## `src/internal/expression.js` (+ `src/internal/expression-tokenizer.js`)

```js
export function compile(expression, options)                   // -> CompiledExpression (throws)
export function evaluate(compiled, values, locale, options)    // -> boolean (throws)
export const EXPRESSION_LIMITS, EXPRESSION_LIMIT_CEILINGS
// options for evaluate: {
//   phoneticResolver?(term, locale),                  // raw-string phonetic input
//   ordinalCategoryResolver?(operands, locale),       // `lokalized/data/ordinal`
//   maximumPhoneticInputCharacters?,
// }
```

**Compilation is EAGER and the split is the contract.** `compile` does everything that does not
depend on caller values — lexing, numeric-literal validation, the shunting-yard conversion, the
static operand typing that rejects a chained comparison, and all three limits — and `createStrings`
runs it over every alternative in every catalog at construction. A later `evaluate` parses nothing.
This is behaviour, not speed: a malformed or over-limit expression must fail construction of the
whole catalog, not the one lookup that happens to reach it.

**Limits are checked in Java's order, because the order decides which error an author sees:**
characters BEFORE tokenization, then token count, then nesting depth (running unclosed groups, not
total groups). A configured limit above its hard ceiling is REJECTED, never clamped and never
ignored — clamping and ignoring are indistinguishable from the caller's side until an expression
that should have been refused is accepted.

**Both optional services arrive PER EVALUATION.** There is no module-level registration seam for
either the phonetic resolver or the ordinal classifier, deliberately: two `Strings` instances in one
process are independent configurations, and a global would let one built with `pluralData.ordinal`
make a second one, built without it, silently able to classify a number.

**A raw string is ALWAYS text**, on every axis including phonetic — it is a resolver TERM, never the
constant it spells. `"GENDER_FEMININE"` from a caller reaches the phonetic branch and its resolver
requirement; `"PHONETIC_VOWEL"` is handed to the resolver rather than short-circuited to the
constant. Recognition of a tagged value is structural (`$lokalized` + `axis`/`name`), so values
survive JSON, workers, `structuredClone`, and RSC boundaries.

**Numeric comparison is exact**, through `plural.js`'s decimal path and never binary64. No `eval`,
no `new Function`; `test/expression.test.js` asserts the absence of both across both files.

**Verify against** the `expressions.*` family, and against the conformance runner's
`causeMessageMatchedIds` ratchet, which pins the Java diagnostic text the result projection does not
compare.

---

## `src/internal/interpolate.js`

```js
/**
 * Render one definition, or return null when no alternative matched and the selected node has no
 * translation of its own (Java's `Optional.empty()`, which the caller reports as
 * `no-matching-alternative` and the default fallback policy WALKS PAST).
 * Throws on a missing language-form branch, an unresolvable placeholder, or a failed expression —
 * the caller turns that into a resolution failure, which the default policy does halt on.
 * `evaluationLocale` is the SUPPLYING locale, never the requested one.
 */
export function render(definition, placeholders, context)  // -> string | null
// context: {
//   key, evaluationLocale,
//   evaluateExpression?(alternativeNode, rawValues),      // the eagerly compiled expression
//   ordinalityNameFor?(value, locale),                    // `lokalized/data/ordinal`
//   rangeCardinalityNameFor?(startName, endName, locale), // `lokalized/data/ranges`
//   isolateValues?,                                       // already decided; see `bidi.js`
// }

/**
 * Interpolate a RETURNED FAILURE KEY with the caller's values, leniently, and total by contract:
 * any conversion, isolation or limit failure returns the original raw key.
 */
export function interpolateFailureKey(key, placeholders, isolateValues)  // -> string
```

Three jobs. First, **branch selection**: whole-message and generated-fragment `alternatives` are
first-match and terminal — once a condition matches, only that branch may resolve and an unmatched
nested subtree does not fall through to a later sibling. Placeholder bindings accumulate BY NAME
across the selected path (a branch keeps ancestor definitions for names it does not mention) while a
name the branch DOES redefine is swapped whole, never merged form-by-form. Second, **language-form
selection** on all ten axes: `CARDINALITY_*` and `ORDINALITY_*` on the classification of the
referenced value under `evaluationLocale`, the nominal axes on an exact tagged value, and a `range`
on the cardinalities of its two endpoints. Third, **substitution**: `{{name}}` is replaced by a
resolved placeholder or a caller value.

Three services arrive through the CONTEXT rather than by import, and for one reason: this module is
in the root graph, which `test/pinned-data-only.test.js` and `npm run scenario:0a` ratchet.
`evaluateExpression` keeps the evaluator's edges out; the two classifiers keep the OPTIONAL
`lokalized/data/ordinal` and `lokalized/data/ranges` tables out of the root entirely. `createStrings`
detects catalog use of either eagerly and refuses construction when the caller did not supply it.

A SELECTOR (an alternative's expression, a `value`, a `range`) reads RAW CALLER INPUT; a template
reference `{{name}}` reads the GENERATED value. Resolution is lazy — only placeholders the rendered
text names are generated — so a cycle in an unreached branch is not a cycle, and cycle detection is a
resolution STACK rather than a visited set.

A FOURTH service arrives through the context for a different reason: `phoneticResolver` is not a
table this module must not import, it is CALLER CODE. The phonetic axis is the only one whose
selection calls back into the application, and it is handed the EVALUATION locale — the donor
catalog's, never the request's. Resolution stays lazy and is deduplicated by placeholder NAME, so
one placeholder named twice in a template resolves once and two placeholders reading one source
resolve twice. `createStrings` always supplies a resolver, defaulting to a throwing one, so "none
configured" is a resolution failure of the current candidate at the moment a raw term reaches the
axis — never a construction error, and never a silently substituted category.

Out of scope here: the output/expansion character budgets.

**Verify against** `evaluation-locale.*` cases, whose translations name the category selected, and
which fail loudly if the requested locale is used instead of the supplying one.

---

## `src/internal/bidi.js` (+ `src/data/rtl.js`)

```js
export const DEFAULT_BIDI_ISOLATION            // "rtl-locales" -- the LIBRARY default, not opt-in
export function validateBidiIsolation(mode, where)      // -> "none" | "rtl-locales" | "all"
export function localeUsesRightToLeftScript(tag)        // -> boolean
export function shouldApplyBidiIsolation(mode, locale)  // -> boolean
export function isolate(value)                          // -> string, FSI ... PDI
```

Port of `BidiUtils` plus `DefaultStrings.shouldApplyBidiIsolation`. Four rules, each of which a
plausible implementation gets wrong in a different direction:

1. **The mode keys off the LOCALE, never the value's direction.** `en` plus an Arabic name is not
   isolated under the default; `he` plus a Latin name is.
2. **The locale is the EVALUATION locale for a translation** — the catalog that supplied the entry —
   **and the REQUESTED locale for a returned failure key**, which by definition had no donor. The
   same request can therefore resolve un-isolated and return an isolated key.
3. **Isolation wraps the caller's VALUE, not the message**, and translation-owned generated text is
   inserted bare even when the same render isolated a caller value beside it.
4. **`isolate` repairs structure while copying**: an already-isolated value is returned untouched,
   but only when one balanced run covers the whole value; an unmatched pop is dropped; an unclosed
   initiator is balanced. The empty string gets no marks.

The mode is settable on the instance and per call, and a per-call value REPLACES the instance one in
both directions rather than narrowing it. `src/data/rtl.js` (37 pinned CLDR scripts) is in the root
graph by necessity: the default mode consults it on lookups nobody configured.

Out of scope here: the bounded `maximumOutputCharacters` contract Java's `BidiUtils` also carries.
Half of it — a budget that fires only for isolated values — would be worse than none, so it lands
with the runtime-limit work that owns `maximumInterpolatedOutputCharacters`.

**Verify against** `npm run diff:interpolate`, which runs the real `BidiUtils` and the real lenient
`StringInterpolator` on the pinned JDK, and the `bidi-isolation.*` corpus family.

---

## What the assembler (`src/core/index.js`) does with these

`createStrings` parses each catalog, resolves the ambient locale, and returns a frozen `Strings`.
`getResult` walks `candidateChain`, renders the first catalog holding the key, and reports
`attemptedLocales` as the prefix actually visited. `matchFor` supplies the separate diagnostic
channel. That assembly is written by the integrator, not by module authors.
