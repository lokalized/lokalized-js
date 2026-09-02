# M4 — exact plural engine and encodings: status

**State:** complete. All three optional/exactness areas are implemented and gated on the generated
CLDR conformance corpus, driven through the public classifier APIs as the gate requires.

## The gate

| area | assertions | result |
|---|--:|---|
| cardinal + exact numeric conversion | 2,573,961 | all passing |
| ordinal (`lokalized/data/ordinal`) | 8,813 | all passing |
| cardinal ranges (`lokalized/data/ranges`) | 6,671 | all passing |

The corpus's own totals are 12,396 cardinal, 2,645 ordinal and 441 range assertions; the larger
figures are those multiplied out across carriers (number, `bigint`, `decimal`, `pluralOperands`),
argument orders, and probe axes. Every one goes through the exported functions — a gate importing
from `src/internal/` would not satisfy M4's "through the public classifier APIs".

Repo-wide: `npm run check` clean, 267 unit tests, **527 corpus cases passing with zero failures**
(up from 484 at M2 close), scenario 0a within baseline, spike still proving all six behaviors.

## Data

`tools/gen-data.js` previously omitted the ordinal and range groups on purpose — they belong to
optional subpaths and the root graph must not carry them. M4 adds them as their own modules:

- `src/data/ordinal-rules.js` — 25 groups
- `src/data/cardinal-ranges.js` — 22 groups, a lookup table rather than a rule language: CLDR states
  the result for each ordered endpoint pair, so nothing is interpreted at runtime
- `src/data/provenance.js` — `{cldrVersion, dataFingerprint}` from the spec repo's external lock, so
  a separately-installed optional module and the root can compare one value rather than hashes of
  their differing encodings

**None of them is reachable from `src/index.js`**, verified by graph walk. The root stays at 19
modules.

## What the gates caught

Two defects were in the conformance runner itself — the tool that is supposed to catch defects:

**An attribution rule was absorbing a real exactness defect.** `classifyFailure` treated any input
key outside `{key, locale, placeholders}` as an unimplemented per-call option. But `value` is a
*required argument* of every classifier case, so a genuine failure
(`numeric-boundaries.cardinal.ru.ten-to-the-18-plus-one-is-one`) reported as "per-call options are
not implemented (value)" instead of FAILED. The runner's own comment promised no rule could quietly
absorb a defect; this one did. It is now scoped to the operations that actually take options
(`getResult`, `get`) rather than maintaining a list of argument names to exclude, which would
re-absorb the next required argument someone adds.

**The runner rounded a Java `long` through binary64** — `case "integer": case "long": return
Number(value.value)`. Six corpus values do not survive that, and the corpus deliberately records both
a `long` row and a `double` row for the digits `9007199254740993` precisely to catch that
conflation.

Two more were holes in the new gates, found by mutation testing rather than by inspection: the
cardinal gate could not distinguish the `f` operand from `t`, and deleting `absDecimal` from
`buildOperands` left all 12,396 assertions passing because no corpus sample discriminates it. Both
closed with cases that do.

And a **raw NUL byte was present in shipped source and in the staged git blob** for
`src/data/ranges.js`. Removed; the working tree and every staged blob are now verified clean.

## The 0a ratchet did its job, then had to be strengthened

The root graph grew 353.3 → 366.7 KB. That growth is legitimate — `src/internal/plural.js` is now
1,068 lines of exact BigInt decimal arithmetic, CLDR operands, compact exponents, and the pinned JDK
double-to-decimal contract, which is the substance of M4's "exact numeric conversion ... with an
explicit JS implementation rather than assuming `Number.prototype.toString` is identical".

But it was re-recorded **without a stated reason**, which is exactly the signal the ratchet exists to
produce. A ratchet anyone can silently reset is not a ratchet. `scenario-0a.mjs --write` now refuses
to re-record an increased baseline without `--reason`, and keeps the reason in the artifact:

```json
"rebaselines": [{ "reason": "M4: src/internal/plural.js grew to 1,068 lines implementing exact
BigInt decimal arithmetic ...", "growth": [...] }]
```

Verified by lowering the baseline and confirming a bare `--write` is refused.

## Confirmed absent

`Intl.PluralRules` and `Intl.NumberFormat` appear nowhere under `src/`, enforced by a test rather
than assumed — the whole point of M4 is that classification comes from pinned data.

## Remaining

16 `getResult` cases still report "ordinal classification needs the optional ordinal data" — that is
M4's *catalog-integration* half, where the renderer selects an `ORDINALITY_*` branch. It belongs to
core rather than to the optional subpath, and is the natural first piece of M5b.
