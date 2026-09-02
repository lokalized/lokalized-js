# M2 — walking skeleton and economic gate: status

> **Superseded in part by M4.** The conformance figures below were current at M2 close (484 passing).
> M4 raised them to 527. See `M4-STATUS.md`.

**State:** M2 is complete. The walking skeleton renders end to end and passes 484 corpus cases with
**zero failures**; scenario 0a is measured in both environments; the generated-placeholder spike
proves all six required behaviors. **M2 is tracked by engineering measurement, not by frozen thresholds** (decision:
2026-09-02, matching the M0 decision). The measurements below ARE the gate.

## The gate that matters

`tools/conformance.mjs` replays the shared behavioral corpus — 1,965 cases recorded by executing
lokalized-java 3.0.0 — against this implementation and reports exact ID sets, which is what plan
section 8.2 gates on.

```
corpus 1.0.0: 1965 applicable
  passed        484   (24.6%)
  FAILED          0
  unsupported  1481
```

Three outcomes, and the distinction between the last two is the discipline:

- **passed** — matches Java's recorded behavior.
- **FAILED** — the code ran and produced something different. Always a defect; exit status keys on
  this alone. A crash counts here, never as unsupported, so the skeleton cannot hide bugs behind the
  label it uses for honest gaps.
- **unsupported** — a path this milestone does not implement, each attributed to a NAMED reason.

A walking skeleton is allowed to leave most of the corpus unimplemented. It is never allowed to be
wrong. Progress is the unsupported set shrinking.

### Attribution, and why failures are classified rather than skipped

Cases are RUN first and only actual mismatches are examined, so a case that passes on a
partly-implemented path still counts as a pass — the default branch of an entry with alternatives is
often exactly right. Each attribution rule is narrow and names the milestone that owns it:

| unsupported reason | count | owner |
|---|---|---|
| `matchFor` operation | 216 | M7 |
| phonetic resolvers | 156 | M5b |
| `load` / `parse` / classpath operations | 419 | M5a, M8 |
| alternative expressions | 125 | M6 |
| ambient locale/match suppliers | 91 | M7/M9 |
| bidi isolation | 53 | M5b |
| ordinal classification (optional data) | 17 | M4 |
| interpolation escapes | 6 | M5b |
| default output/expansion budgets | 3 | M5b/M6 |

Once a capability lands, its cases either pass or fail for real — no rule can quietly absorb a
defect.

## Defects the corpus caught in the assembly

Three, all in code I wrote, all silent:

1. **`isFallback` was wrong in both directions.** I used `candidate !== lookupLocale`. Java's rule
   (`TranslationResult.java:251`) is
   `negotiationUsedFallback() || (resolvedLocale != null && !equivalent(lookup, resolved))`. So a
   request resolving through an ALIAS — `hy-SU` served by `hy-AM` — is NOT a fallback, and a lookup
   resolving NOTHING still reports one when the match type says negotiation fell back. 36 cases.
2. **The returned key is a template.** Keys routinely contain placeholders (`Farewell {{name}}`) and
   Java interpolates the returned key with the caller's values. I returned it verbatim. 20 cases.
3. **Failure-key interpolation is lenient.** The strict renderer is wrong there: a failure key is
   whatever the caller passed, so malformed, unclosed, and unsupplied tokens stay literal instead of
   raising. Throwing would turn a missing translation into a broken render. 12 cases.

None would have been found by unit tests written against my own understanding.

## The decision: measurement instead of thresholds

Plan section 9.2 has M0 freeze provisional 0a thresholds that M2 then meets or misses via a reviewed
rebaseline. M0 certification was deliberately skipped, so no thresholds were ever frozen. Rather than
invent a go/no-go line after the fact, **M2 is tracked by engineering measurement**: the numbers are
recorded, drift is visible, and what can honestly be gated is gated.

That distinction is the whole point, because a measurement nobody enforces is the same as no
measurement:

| measure | treatment | why |
|---|---|---|
| conformance failures | **hard gate** — must be zero | a wrong answer is never acceptable |
| conformance passing-ID set | **ratchet** — a passing case may never stop passing | otherwise a case slides from `passed` to `unsupported` and the headline still looks healthy |
| 0a source bytes, module count | **ratchet** — growth fails until recorded | deterministic, so a regression is real |
| 0a timings, heap | **reported only** | noisy and machine-dependent; gating them produces flaky failures that get ignored, which is worse than not gating |

Baselines live in `measurements/conformance.json` and `measurements/scenario-0a.json` and are
committed. `npm run verify` runs the whole chain; CI runs the same two gates on every push. The
ratchet is verified to bite: reintroducing the `isFallback` defect makes the run fail and name the
regressed IDs, even though nothing reports as FAILED.

## The economic measurement

```
scenario 0a — Node v24.18.0, median of 9

variant                    modules   src KB  import ms  construct ms  1st render ms   heap KB
root + raw-text catalog         19    353.3       0.25         0.030         0.3463      57.4
core + parsed equivalent        18    347.9       0.20         0.045         0.1873      34.8
```

An `en-AU` request against a catalog with no `en-AU` walks the CLDR parent chain to `en-001` and
renders `"I read 3 books"` with the correct cardinal branch.

And the browser half, Chrome 148 (`tools/browser-0a/`, served unbundled over http so the browser
sees the same source files Node measures):

```
variant                     res     bytes  cold ms  import ms  construct  render ms
root + raw-text catalog      19    361782     23.2        1.3        0.1        0.5
core + parsed equivalent     18    356241     25.3        1.4        0.1        0.4
```

Both environments render `"I read 3 books"` from the same `en-AU` request. **0a is now complete on
its own terms** — both variants, both environments.

Three things about the browser numbers that are easy to get wrong, and are recorded rather than
assumed:

- **One variant per page load.** Measuring both in one document leaves the second with a warm module
  cache: `core` initially reported a cold import of 0 ms, 0 resources and 0 transfer bytes, because
  the root graph already contained it. The harness now takes `?variant=` and the driver loads twice.
- **Transfer is uncompressed.** The harness server does not compress, so encoded equals decoded. The
  gzip/brotli ceilings in section 9.2 are a separate measure against a real host, owned by 0b.
- **Memory is coarse.** `measureUserAgentSpecificMemory()` needs cross-origin isolation, so the
  figure comes from `performance.memory` and covers the whole page, not the library. It is recorded
  with that label and is not comparable to Node's retained-heap delta.

Size and module count ratchet against the baseline; timings and heap are reported as drift and never
gated.

## What exists

| Piece | Path |
|---|---|
| Conformance runner and Java↔JS adapter | `tools/conformance.mjs` |
| 0a measurement | `tools/scenario-0a.mjs` |
| Locale kernel (normalize, parents, likely subtags, match, candidate chain) | `src/internal/locale.js`, `locale-cldr.js`, `locale-jdk-tag.js` |
| Exact plural operands and CLDR rule evaluator | `src/internal/plural.js` |
| Bounded catalog parser | `src/internal/catalog.js` |
| Renderer | `src/internal/interpolate.js` |
| Assembly: `createStrings`, `getResult` | `src/core/index.js` |
| Root surface, 61 language-form constants, cardinal classifiers | `src/index.js` |

| Committed baselines | `measurements/conformance.json`, `measurements/scenario-0a.json` |

201 unit tests pass; `tsc --noEmit` and `--emitDeclarationOnly` are clean. `npm run verify` runs
type-check, declarations, unit tests, conformance, and 0a; CI runs conformance and 0a on every push.

The one invariant to preserve while extending this: **selection and resolution are separate
channels.** `matchFor` answers what a delivery would have had to fetch; `candidateChain` answers what
per-key lookup actually tries. A `zh-TW` request can select `zh-Hant` and still resolve through `en`
without visiting a loaded `zh` that holds the key. Collapsing them is the most tempting simplification
here and it is wrong.

## The generated-placeholder spike

Throwaway and non-shipping, per the gate. `spike/generated-placeholders/`, excluded by `package.json`
`files` and guarded by a test. All six required behaviors proven against the corpus family:

```
generated-placeholder spike: 38 corpus cases
  passed         35        FAILED  0        out of scope  3

  PROVEN   branch inheritance                     4/4
  PROVEN   whole-definition replacement           4/4
  PROVEN   cross-kind replacement                 5/5
  PROVEN   late-bound dependency after selection  6/6
  PROVEN   reachable-cycle failure                7/7
  PROVEN   raw-input selector scope / laziness    8/9 (+1 out of scope)
```

Out of scope and recorded rather than counted: two limit cases (the spike enforces no expansion
budget by design — M5b and M6 own limits) and one cardinal-range case (the M4 range data module does
not exist).

Three design decisions the spike settled, which shipping code must make the same way:

- **Selection returns a DEFINITION, not text.** Resolving a branch to its string before asking its
  kind rejects every language-form placeholder, which has no `translation` at all — only a
  `translations` map. 15 of 38 cases failed on this. Deciding kind *after* selection is also exactly
  what makes cross-kind replacement expressible.
- **Replacement is total; there is no merge.** A branch declaring only `CARDINALITY_OTHER` must FAIL
  for a value selecting `ONE`, not borrow the parent's. The merging implementation passes the happy
  path and silently changes behavior.
- **Laziness is the semantics, not an optimization.** Eager resolution fails
  `cycles.cycle-in-unselected-fragment-branch-is-not-a-cycle`. Cycle detection is a resolution stack,
  not a visited set.

See `spike/generated-placeholders/README.md`.

## Nothing remaining

- ~~Frozen thresholds~~ — decided: tracked by engineering measurement instead.
- ~~The browser half of 0a~~ — measured, Chrome 148, recorded in `measurements/scenario-0a.json`.
- ~~The generated-placeholder spike~~ — all six behaviors proven.

**M2 is closed.** Its dependents unblock: M3b (coverage-backed corpus), M4 (exact plural engine),
M5a (bounded parser), M6 (expression language). `npm run verify` runs type-check, declarations, 202
unit tests, conformance, 0a, and the spike.
