# M5b — catalog model, validation, interpolation, and bidi: status

**State:** complete. **790 → 1,032 corpus cases passing (+242), zero failures.** Past half the corpus,
and **57.1% of the 1,806 cases that have a JS counterpart at all**.

547 unit tests. `npm run check`, `npm test`, `npm run conformance`, `npm run scenario:0a`,
`npm run spike:placeholders` and four Java differentials all green.

## Four oracles now run against the real JDK

| differential | scope | result |
|---|---|---|
| `diff:tokenizer` | expression lexing, token sequences and error text | 320/320 |
| `diff:parse` | bounded parser against `LocalizedStringLoader.parse` | 114/114 |
| `diff:interpolate` | lenient escape grammar (552), `BidiUtils.isolate` (40), RTL script detection (40) | **632/632** |
| `diff:phonetic` | resolver dispatch through the real `DefaultStrings` | 66/73 + **7 explicitly known** divergences, 0 unexplained |

The phonetic differential compares more than the rendered string: status, supplying locale, failure
reason, deepest cause message, and the **full resolver call list** — term, locale handed over, value
returned, exception raised. It fails the run if a known-divergence entry stops diverging, so the
table cannot rot into a list of excuses.

That last property matters. `donor-en-us-loaded` could not be deleted even after the underlying port
gap was closed, because the transcript still differs on the exception class name (`RangeError` vs
`IllegalArgumentException`) and on advice that names `createStrings({ tiebreakers })` rather than
Java's constructor parameter. The entry was rewritten to say exactly that.

## What the reviews caught

**A stray 50 KB copy of the conformance runner** — `tools/probe-tmp.mjs`, with the phonetic gate
re-inserted, left behind by a measurement probe. Untracked, so it would not have appeared in a staged
diff, and indistinguishable at a glance from a real tool. The report had asserted it was deleted; it
was not. Removed and verified.

**A half-copied diagnostic.** Java says `... must be a Phonetic or CharSequence but was Gender`; the
port reproduced it verbatim except for the last word, substituting the vaguer "a tagged
'language-form' value". It had been filed as an untranslatable `getClass().getSimpleName()` tail, but
it is not untranslatable — a tagged language form carries its own axis, and the module's existing
axis table already maps that axis onto the Java class Java prints. Fixed; recorded cause messages
went 94/126 → 96/126. The half-copy was also worse *advice*: it told the caller a value was tagged
without telling them which axis.

**Mutation testing found the honest weak spot.** Five deliberate breaks: memoizing the resolver by
term (43 failures), sniffing a raw `"PHONETIC_*"` string as a tagged form (1), handing the resolver
the requested locale instead of the donor (13), dropping a guard (1) — and one that conformance did
**not** catch, checking a bound after the call rather than before, because that ordering case is
runtime-limit-gated. That mutation is why a unit test drives `render` directly.

**The headline was re-measured, not trusted.** The +118 phonetic figure was verified by rebuilding
the gate-off probe from scratch and diffing passing ID sets: 1,032 with the resolver wired, 914
without, delta exactly 118, zero cases lost the other way. `git diff tools/conformance.mjs` shows
attribution rules were **narrowed** — bidi rule 3 and escape rule 2d deleted along with the
capabilities they stood for.

## Two defects a sibling session found, that the corpus could not

Neither had corpus coverage, and conformance was byte-identical before and after both fixes:

- **Construction-time tiebreaker validation was missing entirely.** Java refuses `en` + `en-US`
  without tiebreakers; the port accepted it.
- **`resolveTiebreakers` compared tags raw against normalized supported tags.** A caller writing
  `en-gb` rather than `en-GB` passed validation and then got a tiebreaker that matched nothing —
  resolution fell through and returned **a different catalog's translation**, with no error anywhere.
  One of its four orders was right by accident, so a spot-check could have blessed it.

The corpus spells every tiebreaker canonically, which is exactly why a 1,965-case suite could not
find either. Worth carrying into M3b: the question there is not "how many cases" but "which reachable
behaviors does no case discriminate".

## Remaining, by owner

```
216  matchFor operation                    M7
142  load operation                        M8
 91  ambient locale/match suppliers        M7/M9
 79  get cases needing callback contracts  M7
 58  throwing cases / failure handlers     M7
 56  fallback policies                     M7
 38  per-call translationFallbackPolicy    M7
 34  runtime-limit overrides               M5b leftover / M6
 24  failure handlers                      M7
 23  per-call languageRanges               M9
```

**M7 owns roughly 480 of the 774 remaining.** It is the XL milestone and the next real move, gated on
M3b, which is the only other thing standing between here and it.
