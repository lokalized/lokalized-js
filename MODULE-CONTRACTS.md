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

## `src/internal/interpolate.js`

```js
/**
 * Render one definition. Throws on a missing language-form branch, an unresolvable placeholder, or a
 * failed alternative — the caller turns that into a resolution failure.
 * `evaluationLocale` is the SUPPLYING locale, never the requested one.
 */
export function render(definition, placeholders, context)  // context: { key, evaluationLocale } -> string
```

Two jobs. First, **language-form selection**: a placeholder whose `translations` map is keyed by
`CARDINALITY_*` selects on the cardinal category of the referenced input value, computed under
`evaluationLocale`; one keyed by `GENDER_*` and the other nominal axes selects on an exact tagged
value. Second, **substitution**: `{{name}}` is replaced by a resolved placeholder or a caller value.

M2 scope: cardinality and the nominal axes by exact tagged value. Escapes and the expression language
in `alternatives` are M5b/M6 — leave alternatives unevaluated and say so, rather than half-implementing.

**Verify against** `evaluation-locale.*` cases, whose translations name the category selected, and
which fail loudly if the requested locale is used instead of the supplying one.

---

## What the assembler (`src/core/index.js`) does with these

`createStrings` parses each catalog, resolves the ambient locale, and returns a frozen `Strings`.
`getResult` walks `candidateChain`, renders the first catalog holding the key, and reports
`attemptedLocales` as the prefix actually visited. `matchFor` supplies the separate diagnostic
channel. That assembly is written by the integrator, not by module authors.
