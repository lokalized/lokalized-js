# M5a — bounded duplicate-aware parser: status

**State:** complete and reviewed. **671 → 790 corpus cases passing (+119), zero failures.** All 118
`parse` cases now run against a real bounded parser.

## Why `JSON.parse` could not be used

M5a's substance is its ordering clauses, and `JSON.parse` violates all three: it keeps the last of
duplicate keys silently, materializes the whole object before any limit could fire, and substitutes
U+FFFD for invalid UTF-8 instead of failing. So `src/internal/json-parse.js` is a hand-written
scanner with strict UTF-8 decoding, per-path duplicate detection, and limits enforced before
materialization.

## The ordering is verified by construction, not by inspection

"The check appears before the loop" is not evidence, so the review measured it:

| clause | evidence |
|---|---|
| decoded-byte limits before full body allocation | 64 MiB input with a 1 KiB limit rejects in **0.05 ms** vs **238 ms** to decode it — the `TextDecoder` allocation demonstrably never happens |
| nesting before parse | 20 MB document 200 levels deep rejects in **15 ms** vs **275 ms** for the same-size legal-depth document |
| node budget before model materialization | the budget is reported before the structural defect in the same input |

A **24-input precedence matrix**, each busting two boundaries at once, was checked against the
statement order read out of `LocalizedStringLoader.java`. All 24 match, including two that are easy
to get backwards: a syntax error anywhere beats a zero node budget (Java runs the parse to completion
first), and a placeholder or alternative is charged a node *before* its reserved-name check, because
`addTranslationNodes(1)` is the first statement of both Java loop bodies.

Every limit accepts its exact boundary and rejects one past it; hard ceilings are rejected with
`RangeError` before any input is read, never clamped.

## The defect the review found

**Unbounded duplicate accumulation — a bounded-work violation, which is exactly what this milestone
exists to prevent.**

The reader recorded *every* duplicate member, and each recording materialized a bounded JSON path (up
to 4,096 UTF-16 units) by rebuilding it from the whole container stack. But only `duplicates[0]` can
ever be the failure Java reports, because the catalog parser stops at the first root member carrying
one. A 590 KB file holding 100,000 repetitions of one member name at depth 63 cost **384 MB of heap
and 172 ms** — roughly 650× amplification of its own input.

Capped to the first finding. Verified independently after the fix:

```
duplicates= 100000  input=586 KB  time=9.2 ms  heapDelta=0.0 MB  findings retained=1
```

A regression test pins it at 20,000 duplicates and fails against the old code.

## Duplicate detection is layered, deliberately

`parseJsonDocument` reports **nested** duplicates in its `duplicates` array; **root-level** ones are
rejected in `src/internal/catalog.js:1009` with Java's exact message
(`duplicate localized string key '…' encountered`). Root keys are catalog-semantic and nested ones
are JSON-structural, so the split is defensible — but it was undocumented and is a trap, so it is now
commented at both sites. All 5 duplicate cases pass.

Detection runs *during* the parse rather than in a second traversal as Java does. That is earlier
than Java and still reports Java's answer, because each finding carries the root member it belongs to.

## Differential fuzzing found nothing, which is the point

393,568 random token sequences: zero acceptance divergence from V8's `JSON.parse`. 139,289 failing
documents: zero divergence in reported line and column. A fuzz campaign that finds nothing is only
evidence if it was large and adversarial enough to have found something.

## Reporting correction: the denominator was wrong

159 cases (`loadClasspath` 90, `loadClasspathResources` 69) are classpath discovery — a JVM concept
with no JS counterpart, no subpath in `symbol-allowlist.json`, and none defined in plan section 3.1.
They were reporting as "operation not implemented", which reads as *not yet* when the truth is
*never, by design*.

They now report separately, and the percentage is stated both ways:

```
  passed           790   (40.2% of all; 43.7% of the 1806 with a JS counterpart)
  unsupported     1016   not implemented yet
  no counterpart   159   JVM-only by design; these can never move
```

`load` (142 cases) is Node directory loading, which plan section 10.3 assigns to **M8**; the runner
now says so.

## Root graph

21 → 22 modules, 465.2 → 502.3 KB, re-recorded with a reason. The parser is the growth and it is the
milestone's substance, but the graph is now **+42% since M2 close** with M7's XL resolution core
still ahead. The open recommendation from the size accounting — whether the byte-level parser belongs
in the root graph at all, given that a consumer passing an already-parsed catalog never needs it —
remains a decision to take before M7.

## The wiring that completes it

`createStrings` now dispatches on plan section 3.2's `CatalogInput`:

```
type CatalogInput = string | Uint8Array | ParsedStringsFile | readonly LocalizedStringInput[]
```

Text and bytes go through the bounded parser — the only path that can enforce fatal UTF-8, per-path
duplicate rejection, and the limits that must fire before materialization. An already-parsed object
skips it, having none of those to enforce.

**Two of the four declared forms were unimplemented from M2 until now, and nothing caught it.** The
corpus drives `parse` and `getResult` separately and never passes text to construction, so no case
exercised the gap. `test/catalog-input.test.js` is the missing gate: it pins all three implemented
forms, asserts they render identically, and asserts that text and bytes are NOT routed through
`JSON.parse` by checking that invalid UTF-8 and a duplicate key both fail.

This is also what makes the parser's place in the root graph legitimate. The size accounting had
argued it could not be split out *because* `CatalogInput` requires `createStrings` to accept bytes —
which was true of the contract but not yet of the code.

**One session spans every catalog**, not one per file. Java's `maximumTotalInputBytes` and
`maximumLocalizedStringsFiles` are per-LOAD; a session per catalog would enforce each file's own
limit and never the aggregate. The test pins it with a control: each catalog individually fits the
budget, and the pair does not.

## The 0a measurement was wrong, and is now right

Plan section 9.2 specifies variant 1 as "root with a fixed small embedded **raw-text** catalog" and
variant 2 as "`lokalized/core` with its fixed **already-parsed** equivalent". `tools/scenario-0a.mjs`
passed the **identical object** to both, so they differed only by entry point — the economic
measurement did not match its own description, and had not since M2.

It could not have been right earlier: until the parser was wired in, the raw-text form could not be
constructed at all. Variant 1 now serializes the catalog and pays for parsing at construction, as
specified, and the two variants differ by 22 modules against 21.

## Carried forward

- `resolveLimits` accepts values wider than Java's `int`/`long` builders can express. Harmless
  widening, undocumented.
- `rethrowAsParseError` converts any error out of `parseCatalogSource` into `StringsParseError`, so
  an internal bug would surface as a parse failure. Worth a narrower guard.
- `LocalizedStringValidator`'s semantic validation has no JS counterpart yet. Out of M5a's scope, but
  it belongs between the duplicate walk and the incomplete-language-form warning, inside the loop
  whose ordering this review pinned.
