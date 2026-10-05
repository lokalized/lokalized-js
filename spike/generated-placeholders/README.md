# M2 generated-placeholder spike — throwaway

Plan v7's M2 gate asks for "a throwaway, non-shipping generated-placeholder spike" proving six
behaviors, whose "cases become stable M3b vectors".

**This code is not going to ship.** `package.json`'s `files` is an allowlist (`src/`, `types/`,
`LICENSE`, `NOTICE`, `README.md`), so nothing here is packed, and `test/package-shape.test.js`
asserts that. It exists to answer one question before M5b and M6 commit to a design: do the six
behaviors compose, or does proving one break another?

## Result

```
generated-placeholder spike: 38 corpus cases
  passed         35
  FAILED          0
  out of scope    3

  PROVEN   branch inheritance                     4/4
  PROVEN   whole-definition replacement           4/4
  PROVEN   cross-kind replacement                 5/5
  PROVEN   late-bound dependency after selection  6/6
  PROVEN   reachable-cycle failure                7/7
  PROVEN   raw-input selector scope / laziness    8/9 (+1 out of scope)
```

Verified against the corpus's `generated-placeholders` family — recorded Java behavior, not the
author's belief about it. The cases already exist as vectors; this proves them reachable.

Out of scope, and recorded rather than counted: two limit cases (the spike enforces no expansion
budget by design — M5b and M6 own limits) and one cardinal-range case (the M4 range data module does
not exist yet).

## What the spike settled

Three design decisions that were not obvious before writing it, and that shipping code will have to
make the same way:

**Selection returns a DEFINITION, not text.** The first attempt resolved a branch to its translation
string and then asked what kind it was. That rejects every language-form placeholder before its kind
is looked at, because such a placeholder has no `translation` at all — only a `translations` map. 15
of 38 cases failed on this. Kind must be decided *after* selection, which is also precisely what
makes cross-kind replacement expressible.

**Replacement is total; there is no merge.** A branch declaring `placeholders` replaces the inherited
table outright. The tempting implementation merges a partial branch table with the parent's, and it
is wrong: a branch declaring only `CARDINALITY_OTHER` must FAIL for a value selecting `ONE`, not
quietly borrow the parent's `ONE`. Merging passes the happy path and silently changes behavior.

**Laziness is not an optimization — it is the semantics.** A placeholder is generated only when the
text being rendered actually names it. Eager resolution fails
`cycles.cycle-in-unselected-fragment-branch-is-not-a-cycle`, where a cycle exists in a branch the
selected path never reaches and therefore is not a cycle. Cycle detection is a resolution *stack*,
not a visited set, since a name may legitimately be generated more than once on different paths.

And one scope rule underpins the rest: **a selector (`value`, `range`) reads RAW CALLER INPUT while a
template reference `{{name}}` reads the GENERATED value.** The same name means different things in
the two positions — `scope.range-endpoints-read-raw-input-while-template-reads-generated-value` has
`minHours` as both, reading `1` as a selector and rendering `"2"` as a template.

## Running it

```
node spike/generated-placeholders/run.mjs [--verbose]
```
