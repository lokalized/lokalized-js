# Internal module contracts — M2 walking skeleton

These are INTERNAL modules under `src/internal/`. They are not public surface and appear in no export
subpath; `symbol-allowlist.json` still governs what `lokalized` and `lokalized/*` expose. They exist
so the skeleton can be built and verified in independent pieces.

Every module is ESM, carries `// @ts-check`, is clean under the repo's `tsconfig.json` (`checkJs`,
`strict`, `noUncheckedIndexedAccess`), and uses no Node built-ins — the root graph must run unchanged
in a browser.

**Its RUNTIME imports are only `../data/*.js` and other `src/internal/*` modules.** Its JSDoc TYPE
imports are not so confined: `catalog.js` and `parse-file.js` reach `../core/index.js` and
`../parse/index.js` for types, which is a cycle at the type level and no edge at all at runtime —
`tools/graph-walk.mjs` strips comments before it walks, for exactly this reason.

**The corpus is the specification.** `../lokalized-spec/generated/behavioral-vectors.json` records
what lokalized-java 3.0.0 actually does for 2,379 cases. Where this document and the corpus disagree,
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

**Verify against** the corpus's `matchFor` cases (310) and the `resolution.direct.*` seed rows, whose
`attemptedLocales` are a PREFIX of what `candidateChain` produces — the walk stops at the first
catalog holding the key, or when the fallback policy declines to continue. The document said
"exactly" here until 2026-09-17 while saying "the prefix actually visited" at the end of the same
file; `test/locale.test.js`'s "reproduces every attemptedLocales prefix" is the half that was right.

---

## `src/internal/plural.js`

```js
/** CLDR plural operands. All fields are exact; `n` is the absolute value. */
// Operands = { n: string, i: string, v: number, w: number, f: string, t: string, c: number, e: number }
export function operandsFromNumber(value, options = {})  // number | bigint -> Operands
export function operandsFromDecimalText(text, options = {}) // {visibleDecimalPlaces?, compactExponent?}
export function cardinalCategoryFor(operands, localeTag) // -> "zero"|"one"|"two"|"few"|"many"|"other"
```

`src/data/cardinal.js` decodes to `[{ locales: string[], rules: { count, condition }[] }]` where
each `condition` is CLDR plural-rule syntax (`n = 1`, `i = 0 or n = 1`,
`n % 10 = 1 and n % 100 != 11`, `v = 0 and i % 100 = 3..10`). Rules are ordered; the first matching
category wins and an empty expression is the unconditional `other`.

Arithmetic must be EXACT — digit strings and `BigInt`, never float. `10n ** 20n` and `1.0` versus `1`
are the cases that break a float implementation, and the corpus contains both.

**Verify against** the 58 `cardinalityForNumber` cases and 16 `cardinalityForOperands` cases.

---

## `src/internal/catalog.js`

```js
/** Bounded parse of one already-DECODED catalog object into the internal model. */
export function parseCatalog(raw, context)   // -> Map<string, Definition>
// `parseCatalogSource` is the RAW door; a decoded object is not a raw strings-file input, and the
// two charge the JSON-nesting budget differently. context (all optional):
//   { locale, source, limits, validateExpression, onRootParsed }   // + `session` at the raw door

// Definition = {
//   translation: string | null,          // null exactly when the node carries alternatives
//   commentary: string | null,
//   placeholders: Map<string, PlaceholderDefinition>,
//   alternatives: Alternative[],
// }
// PlaceholderDefinition is a UNION of two arms, not one shape:
//   LanguageFormPlaceholder = { kind: "language-form", value: string | null, range, axis, translations }
//   ExpressionPlaceholder   = { kind: "expression", translation, alternatives }
// Alternative = { expression: string, definition: Definition }
```

A catalog entry is either a plain string (its own translation, no placeholders) or an object with
`translation`, optional `placeholders`, optional `alternatives`, optional `commentary`.

Bounded means the limits are checked while parsing, not after: translation-node count, nesting depth,
and alternative depth. The full diagnostic surface postdates this module and now ships beside it:
`lokalized/parse` rejects a duplicate key (`<input>: duplicate localized string key 'a' encountered`)
and locates a malformed one (`<input>:1:3: unable to parse localized strings file`). Those live in
`src/internal/json-parse.js` and `src/internal/parse-diagnostics.js`, which this document does not
specify — see **What this document does not specify**, below.

**Verify against** the corpus `fixtures`. Note what that is NOT: "every fixture must parse" is false
and was stated here until 2026-09-17 as "a strong self-test available immediately". Measured: 2,059
catalogs across the 586 fixtures, of which 1,959 parse and 100 are REFUSED — the corpus carries
malformed input on purpose, because refusing it is behaviour under test. The self-test is
the corpus's own recorded verdict per case, which is what `npm run conformance` runs.

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
//   phoneticResolver?, maximumGeneratedPlaceholderDepth?,
//   maximumInterpolatedOutputCharacters?, maximumGeneratedExpansionCharacters?,
// }                                                       // ten members; see the typedef

/**
 * Interpolate a RETURNED FAILURE KEY with the caller's values, leniently, and total by contract:
 * any conversion, isolation or limit failure returns the original raw key.
 */
export function interpolateFailureKey(key, placeholders, isolateValues, maximumOutputCharacters)
// -> string
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

**The output and expansion budgets are enforced here**, which this document said they were not for
long enough that `src/internal/interpolate.js` came to contradict it. Three of them, at plan 4.6's
fixed defaults: `maximumGeneratedPlaceholderDepth` bounds the recursion,
`maximumInterpolatedOutputCharacters` bounds ONE interpolation's output with every append checked
and each nesting level measured separately, and `maximumGeneratedExpansionCharacters` bounds the
CUMULATIVE size of one render's expansions. The module's own header is the longer statement of it.

**Verify against** `evaluation-locale.*` cases, whose translations name the category selected, and
which fail loudly if the requested locale is used instead of the supplying one.

---

## `src/internal/bidi.js` (+ `src/data/rtl.js`)

```js
export const DEFAULT_BIDI_ISOLATION            // "rtl-locales" -- the LIBRARY default, not opt-in
export function validateBidiIsolation(mode, where)      // -> "none" | "rtl-locales" | "all"
export function localeUsesRightToLeftScript(tag)        // -> boolean
export function shouldApplyBidiIsolation(mode, locale)  // -> boolean
export function isolate(value, maximumCharacters = -1, reportedMaximumCharacters = maximumCharacters)
// -> string, FSI ... PDI; throws when the budget is exceeded, reporting the SECOND number
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

**The bounded contract Java's `BidiUtils` also carries is now here too**, having landed with the
runtime-limit work that owns `maximumInterpolatedOutputCharacters`. `isolate` takes the characters
still available and a SECOND number to report, which are separate on purpose: the budget consumed is
this call's, and the figure a reader sees must be the whole interpolation's. Exceeding it throws
`outputLimitExceeded`, whose wording is `StringInterpolator`'s verbatim. `-1` means no limit.

**Verify against** `npm run diff:interpolate`, which runs the real `BidiUtils` and the real lenient
`StringInterpolator` on the pinned JDK, and the `bidi-isolation.*` corpus family.

---

## What the assembler (`src/core/index.js`) does with these

`createStrings` parses each catalog, resolves the ambient locale, and returns a frozen `Strings`.
`getResult` walks `candidateChain`, renders the first catalog holding the key, and reports
`attemptedLocales` as the prefix actually visited. `matchFor` supplies the separate diagnostic
channel. That assembly is written by the integrator, not by module authors.

---

## What this document does not specify

**This file covers seven of the twenty modules under `src/internal/`.** It was written for the M2
walking skeleton and the other thirteen arrived with later milestones, each already owned by a gate
that arbitrates it more precisely than prose could. The list is here rather than implied so that a
reader knows the contracts above are a subset, and so that a NEW module cannot be added without a
deliberate decision about which column it belongs in — `test/module-contracts.test.js` fails on a
module that is in neither, and on an entry here for a module the document has since documented.

| module | why it is not specified here |
|---|---|
| `src/internal/configuration-error.js` | An error class, specified by plan 3.5 and gated by `test/identity-projection-and-error-classes.test.js`. |
| `src/internal/lokalized-error.js` | The exported base every library error extends; same owner. |
| `src/internal/resolution-error.js` | Plan 3.5's ninth error class, gated by `test/resolution-error.test.js`. |
| `src/internal/parse-diagnostics.js` | The parse error surface, owned by `lokalized/parse` rather than by the skeleton. |
| `src/internal/parse-warnings.js` | The parse warning surface; same owner. |
| `src/internal/parse-file.js` | The file-level parser, which postdates this document. |
| `src/internal/json-parse.js` | The bounded, duplicate-aware JSON reader behind it. |
| `src/internal/locale-cldr.js` | The CLDR tables behind `locale.js`, inventoried by `tools/likely-subtag-consumers.mjs`, which derives its consumer list from `src/` on every run. |
| `src/internal/locale-jdk-tag.js` | The JDK tag model, arbitrated against the real JDK by `npm run diff:direct-tag`. |
| `src/internal/loaded-input.js` | Normalisation of a loaded record, which M8 added. |
| `src/internal/runtime-metadata.js` | The build identity a stamp carries, gated by `test/load-verification-record.test.js`. |
| `src/internal/sha256.js` | The synchronous digest, gated by `test/sha256.test.js` against `node:crypto`. |
| `src/internal/jcs.js` | The bounded RFC 8785 canonicalizer beside it. |

**The contract blocks above are each module's kernel, not an inventory of its exports.** Seven
modules export more than the blocks declare, which is deliberate — a block names what a caller has
to get right, and the gate holds every name it DOES declare to the module's real signature.
