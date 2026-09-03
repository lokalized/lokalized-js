# M6 — expression language and fixed runtime limits: status

**State:** complete. **527 → 671 corpus cases passing (+144), zero failures.** Both attribution
categories M6 owned — "alternative expressions are not evaluated" and "ordinal classification needs
the optional ordinal data" — are gone from the unsupported list entirely.

## What landed

| piece | file |
|---|---|
| Tokenizer — 74 token types, 13 structural plus all 61 language-form constants | `src/internal/expression-tokenizer.js` |
| Eager compiler and evaluator | `src/internal/expression.js` |
| Alternatives evaluation and ordinal branch selection | `src/internal/interpolate.js`, `src/core/index.js` |
| Java differential oracle | `tools/tokenizer-diff/` |

336 unit tests. `npm run check`, `npm test`, `npm run conformance`, `npm run scenario:0a`,
`npm run spike:placeholders` and `npm run diff:tokenizer` all green. `eval` and `new Function` appear
nowhere under `src/`, asserted by test.

## The tokenizer is differentially verified against real Java

`npm run diff:tokenizer` compiles `TokenDiff.java` against the pinned JDK 21, calls
`ExpressionTokenizer.extractTokens` directly, and compares token sequences **and error messages**
against the JS tokenizer over every expression in the corpus plus adversarial boundary forms —
constant adhesion (`GENDER_FEMININEX`), operator prefixes (`<` vs `<=`), numeric edge forms (`.5`,
`5.`, `+1`, `1E-3`), whitespace classes, and magic keys.

**320/320 identical.**

This tool exists because during M6 an agent concluded no JDK was available and substituted a second
hand-written reference implementation, differing the two over 117,313 inputs. That was a genuinely
useful test — but the premise was wrong: it checked `java` on `PATH` rather than the pinned path this
project uses, and the JDK was present the whole time. A second reading of the source is not an
oracle; the source executing is. Both now exist, and the real one is wired into `npm run`.

## How the gate was protected

The instruction to the implementers was that moving a case to `passed` by weakening an attribution
rule would be worse than doing nothing. Verified afterwards by diffing `tools/conformance.mjs`
against `HEAD`: rules 2, 2b and 2c were **deleted, not widened** — the direction that cannot
manufacture progress. The ratchet was compared against the committed baseline rather than a
re-recorded file, and none of the original 527 IDs was lost.

Eager compilation is gated, not merely intended: `compile()` is called only from `createStrings`, in
a construction-time pass, and the reviewer's "honest lazy port" mutation — delete the eager pass and
compile on first evaluation — fails the suite.

## Root graph growth, recorded

353.3 KB / 19 modules at M2 close → **465.2 KB / 21 modules** now. The expression language is real
code and the growth is legitimate, but it is +32% on a library whose premise is being lightweight,
and it is worth a deliberate look before M7 adds the resolution core.

Five rebaseline entries are recorded in `measurements/scenario-0a.json`, each with a stated reason —
the `--reason` requirement added after M4's silent re-record did its job. Four of the five are M6,
which is more churn than the trail wants; a future milestone should re-record once at close rather
than per iteration.

## Deliberately not done

- **The phonetic-resolver diagnostic wording.** Java says "No PhoneticResolver was configured.
  Provide one via Strings.Builder#phoneticResolver(...)"; the JS reworded it for its own API. It is
  one of 24 deliberate JS-idiomatic rewordings already established across the renderer, and
  rewording only M6's would make the port internally inconsistent. It needs a cross-milestone
  decision, not a local fix.
- **Three expansion-budget cases** (`generated-placeholders.limits.*`, `runtime-limits.expansion.*`,
  `runtime-limits.interpolated-output.*`). These are the renderer's interpolated-output and
  generated-expansion budgets, not the three expression-shaped limits M6 names, and belong to M5b.

## Remaining unsupported, by owner

```
216  matchFor operation                     M7
156  phonetic resolvers                     M5b
142  load / 118 parse                       M5a
 91  ambient locale/match suppliers         M7/M9
 90  loadClasspath / 69 loadClasspathResources  M5a
 83  get operation                          M5b
 83  runtime-limit overrides                M5b
 58  throwing cases / failure-handler       M5b
```

M5b is the largest remaining block by owner; M7 is the largest single operation.
