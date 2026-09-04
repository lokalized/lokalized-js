# M7 — Resolution core: the executable plan

Produced by a 10-agent design pass (5 subsystem maps -> completeness critic -> 3 independent
slicings -> judge). Numbers marked **[M]** were MEASURED against the corpus and the port's own
source this session; where a map and a measurement disagreed, the measurement won. Three separate
map claims were refuted this way and are called out inline.

**Read `../CLAUDE.md` first.** The corpus wins over this document, as it does over every other.

---

> Numbers below marked **[M]** were measured this session against `generated/behavioral-vectors.json` (2,298 cases) and the port's own source, not taken from the maps. Where a map and a measurement disagreed, the measurement is used.


---

## CORRECTION applied after A0–A2 landed

Two of this plan's acceptance criteria were wrong and are superseded:

- **The 0a ratchet is NOT module-count-only.** `tools/scenario-0a.mjs:199-202` ratchets `sourceBytes`
  as well, and fails on any growth. This plan's "root graph unchanged at 25" criteria and its deferral
  of the single re-record to C2 are jointly unsatisfiable with "verify exit 0 at the end of each
  slice". **Re-record once per landed slice batch, with a measured `--reason`.** Done for A0–A2:
  +15,338 bytes in both graphs, 25/24 modules unchanged.
- **A0's "unlocks 0" is right, but its defect is diagnostic-only ON THE CORPUS.** All 15 falsification
  rows differ in exactly one field, `localeMatchResult.fallbackLocale` — none differs in translation,
  `resolvedLocale`, `attemptedLocales`, `status` or `isFallback`. The fix is behaviourally load-bearing
  OFF the corpus (fallback `arm-SU` over `{hy-AM, hy-SU}` serves a different catalog purely on
  tiebreaker order), so it stays required — but the corpus does not prove that, and no case yet does.

---

## What M7 does NOT own

Of the 939 unsupported cases, **176 belong to other milestones and must still report their existing reason string after every slice below**:

| count | reason | owner |
|---:|---|---|
| 145 | `operation 'load' is not implemented` | **M8** |
| 22 | `operation 'define' is not implemented` | **M5b** |
| 9 | raw/byte fixtures require the bounded parser's failure paths | **M5a** (`conformance.mjs:398-399`; the primer's table leaves this cell blank — it is the only row with no stated owner) |

A further **39 `runtime-limit overrides are not implemented` cases are refused BY DESIGN.** Plan 4.6 fixes v1's limits; `createStrings` must keep throwing `ConfigurationError` on a `runtimeLimits` option. Any revision reporting these as converted has relaxed the rule that attributes them.

**M7's true denominator is 939 − 176 − 39 = 724.** The slices below address ~700 of those by name; the residual sits at slice boundaries (cases needing two capabilities) and is absorbed by whichever slice lands second. M7 closes at **≈215 unsupported, every one with a named non-M7 owner.**

Three further cases must not be counted against the selection slices: **[M]** of the 137 locale-input `matchFor` cases, 1 is supplier-gated (`ingress-matrix-java.zh-tw.matchfor-ignores-ambient-match-supplier` → lands in B3) and 2 are raw-gated (`manifest-loads.matchfor.*` → M5a). **The locale arm unlocks 134, not 137.** Two of the three plans got this wrong.

---

## RECORDED DECISION — `npm run verify` exits 1 on the 0a byte ratchet until C2

**Every additive M7 slice leaves `npm run verify` at exit 1, and that is the expected state, not a
failing slice.** Recorded after A0/A1/A2, because three lines below (A0's "Exit 0", A1's and A2's
"root graph unchanged at 25") state only the MODULE-COUNT half of the ratchet and are therefore
unsatisfiable for any slice that adds source.

`tools/scenario-0a.mjs:199-202` pushes growth on **`sourceBytes` as well as on `modules`**. Both are
deterministic measures and both were always gated; the plan simply described one of them. The file is
untouched by this milestone.

The decision is to leave the gate alone. The alternatives were both worse: splitting the ratchet so
bytes only report would weaken a gate mid-milestone to make a slice's headline look green, and
re-recording per slice is forbidden outright — the baseline is re-recorded **once**, at C2, under
`--write --reason`.

**So, for every slice from A0 to C1, the acceptance condition is:**

- `npm run verify > v.log 2>&1; echo $?` — exit **1**, and `scenario:0a` must be the ONLY reason.
  Everything upstream of it (`check`, `tsc --noEmit`, `tsc --emitDeclarationOnly`, `npm test`,
  `conformance`) green, `0 FAILED`, and no passing id dropped.
- `npm run spike:placeholders` — run SEPARATELY and exit **0**, because `verify` never reaches it once
  0a has failed. A slice that skips this has not run its last gate.
- **`measurements/scenario-0a.json` must be byte-identical to HEAD.** Any diff there mid-milestone is
  the defect this decision exists to prevent.
- The MODULE count must still be unchanged at 25 root / 24 core. That half is what keeps
  `lokalized/negotiate`, `lokalized/data/*` and the 802-class table out of the root graph, and it is
  the half a slice can genuinely break.

Measured at A2: root 584,213 → 600,262 bytes, core 577,788 → 593,837, modules unchanged at 25 / 24.
After the A0–A2 review repairs below: 599,551 / 593,126, modules still 25 / 24 — the helper dedup
gave 711 bytes back.

---

## Repairs applied after the A0–A2 review

Recorded here rather than in a status doc, because two claims in the slice reports are already stale
of the tree and would otherwise be carried forward: A0's "`src/internal/locale.js` is untouched" and
"`measurements/conformance.json` untouched at 1,200 passedIds" were both true of **A0 in isolation**
and false of the delivered tree, where A1 and A2 landed afterwards. A1's absolute figures (1,334
passed, 567 tests, 593,606 bytes) likewise no longer reproduce; A1's contribution is **134**, verified
by ablation, and A2's is **50**, disjoint.

| repair | why | how it was verified |
|---|---|---|
| Three helpers deduplicated: `compareTags`, `normalizedLanguageCode`, `resolveTiebreakers` now exported once from `src/internal/locale.js` and imported by `src/core/index.js` | Each is ONE function in Java, read at construction and at every lookup. A divergence resolves the fallback to a catalog per-lookup resolution never consults — and the corpus cannot see it, because every tiebreaker in it is spelled canonically | Behavior-preserving: 1,384 / 0 and 582 tests before and after. Corrupting the now-shared `normalizedLanguageCode` leaves the corpus at **1,384 / 0** and turns **5 hand-written tests red** — the corpus is blind to it, `npm test` is not |
| `optionalSubpath()` replaces the six `try { await import(…) } catch { }` swallows | The swallow could not tell a subpath that is ABSENT from one that EXISTS AND THREW. A module-scope failure in `src/negotiate/index.js` would have turned 50 passing cases into a brand-new `unsupported` bucket | Injecting a module-scope throw: with the swallow, **1,334 passed / 0 FAILED / 50 `createLocaleNegotiator is not implemented`** — a defect laundered into attributed non-work. With `optionalSubpath`, the runner **dies with the injected error**. Deleting the file still reports the honest 50 |
| `projectResult`'s `expected.localeMatchResult === null ? null : …` gate replaced by `match ? {…} : null` | The gate forced the ACTUAL side to null whenever Java recorded no match, so a port emitting a match where Java records none compared equal and passed — over eight fields after A0, not two | Zero corpus rows record a null `localeMatchResult`, so it changes no outcome; confirmed by the unchanged 1,384 / 0 |
| An `expected.thrown` branch in the `matchFor` arm, comparing **kind AND message** | Eight `matchFor` cases record `expected.thrown` and carry no `expected.match`. They are routed away today, and would have died on `recorded.matchType` as a TypeError when A4 opens the header and multi-member routes | Routing the eight in: with a kind-only comparison all eight **falsely PASS** — a header string is iterable, so `[..."not a header!"]` refuses its first character and throws a `RangeError` unrelated to the grammar (the `zh-123` shape). With the message compared, **7 FAILED** and only `.explicit-thirty-three-ranges-rejected` passes, which is the port's true state before A4 |
| `matchForLanguageRanges`' multi-member/empty refusal is a `RangeError`, not a bare `Error` | Every other refusal in the module is one, and `ERROR_NAME` admits only `TypeError`/`RangeError` for the `IllegalArgumentException` the neighbouring 33-member case records. The bare `Error` was reachable through the public `bestMatchForLanguageRanges` | `test/negotiate.test.js` now asserts the KIND as well as the wording, on both refusals |
| `pinnedRangeEquivalents` and `languageRangeFrom` doc corrections | Both misattributed a JDK method. See the A4 row | Re-derived on the pinned Corretto 21, not taken from the report |

**Not applied, deliberately.** `../CLAUDE.md`'s headline block is stale for both repos (it records
561 tests / 1,200 passed / 896 unsupported and corpus 2,255 / 68.7% / 82 owed, against a measured 582
/ 1,384 / 755 and 2,298 / 71.0% / 50) **and is duplicated five times in the file, with two copies
disagreeing with each other.** It is worth collapsing to one block and refreshing — but it is the
agent-instruction file, it is not a slice artifact, and it will go stale again at every slice, so it
is left for its owner to update at milestone close rather than edited from inside a repair.

---

## The measured decomposition M7 is sliced on

**[M]** `matchFor` 301 = **137 locale** + **90 string headers** + **74 explicit arrays**. (Map 1's "83 string / 81 arrays" is wrong.)
**[M]** The 74 arrays are 50 single-member-at-weight-1 + 24 multi-member.
**[M]** The 90 headers parse to: 27 single-member, 56 multi-member, 7 throwing.
**[M]** So **211 of 301 need no multi-member machinery at all.**

---

## A0 — Resolved fallback locale + the widened `match` projection

**Unlocks: 0. That is the point.**

**Scope.** Two changes, together, nothing else.
1. `src/core/index.js:153` — replace `normalizeTag(options.fallbackLocale)` with Java's `DefaultStrings:446-470`: exact normalized loaded tag → the single canonically-equivalent loaded catalog → the fallback's CLDR-**normalized** language code walked through `tiebreakers` → refuse. Add the two construction refusals (`:303-314` names no loaded catalog; `:465` ambiguous equivalence). *The normalized-language step is load-bearing:* fixture `dedup-and-candidates-equivalent-fallback-am-first` configures `arm-SU` against tiebreaker key `hy`, so a naive `range.split('-')[0]` finds nothing and silently falls through to first-wins.
2. `tools/conformance.mjs:636/653` — widen `projectResult`/`expectedResultProjection` from `{matchType, locale}` to all eight recorded match fields, **symmetrically on both sides.**

Do **not** touch `src/internal/locale.js`. Its `matchFor` doc comment already says `@param fallbackLocale resolved fallback locale tag` — the kernel expects a resolved value; only the caller fails to produce one.

**Dependencies:** none.

**Families turned green:** none. Families that stop being green-for-the-wrong-reason: `dedup-and-candidates.equivalent` (4), `.fallbackalias` (4), `locale-identity.deprecated-fallback` (5), `owed-ds.fallback-tiebreaker-walk-*` (2).

**Verification.**
- **[M] I confirmed exactly 19 corpus rows record a `fallbackLocale` differing from the configured spelling, and exactly 15 of them pass today.** Their family breakdown is the list above. All three plans converged on 15 independently; so did I.
- **Falsification control, run FIRST (graft from risk-first):** copy `conformance.mjs` to scratch, apply *only* the widening, run against the **unchanged** port. It must report **1,185 passed / 15 FAILED** with exactly those ids. If fewer than 15 go red, the projection is not reaching the comparison and the slice has verified nothing.
- **Green gate (graft from contract-first):** `npm run verify > v.log 2>&1; echo $?` — redirected, never piped; this repo has already read a passing status off `tail`. **Exit 1, at `scenario:0a` and nowhere else** (see the recorded decision above; A0 adds ~8,067 source bytes and the ratchet gates bytes as well as modules), everything upstream green with 0 FAILED, and the passing-ID set in `measurements/conformance.json` **unchanged at exactly 1,200.** A slice that converts zero cases and holds the passing set constant is the strongest available proof that a comparison was widened rather than a rule weakened.
- **Blast radius is measured, not surveyed (graft from contract-first):** the resolution rule reproduces the recorded `fallbackLocale` on 336/336 fixtures that record one, and the five fixtures whose fallback is unresolvable are all `loadOnly`, so the new refusal cannot reject any fixture that constructs. Exposure is limited to hand-written `lokalized-js/test` fixtures — grep them before landing.
- **The two construction refusals ship UNVERIFIED, and are recorded that way rather than as covered.**
  Measured after A0: driving `createStrings` over all 415 corpus fixtures that are not `loadOnly`,
  carry no raw bytes and hold a non-empty `files` map, **zero** are refused by either new rule (the
  only two refusals are the pre-existing JSON-nesting-depth limit). So the refusals reject nothing
  that used to construct — and equally, nothing in the corpus proves them right. `:465`'s ambiguity
  arm in particular is unreachable through the runner: `validateTiebreakers` runs first and demands
  an exact permutation of the loaded locales sharing the language code, so the walk's map entry
  always exists and always holds a member of `equivalentFallbackLocales`; the obvious probe
  (ambiguous fallback, no tiebreakers) is the `zh-123` shape, pre-empted by the ambiguity refusal in
  `validateTiebreakers` and never reaching `:465`. **Close both through B4's `construct` arm**, which
  compares `failureType`/`failureMessage` exactly — not through argument. Both are `required` in
  `coverage-dispositions.json` and **must not be reclassified `excluded` on the strength of this
  slice**: over-declining is the mirror of decoration and has already been caught once here.
- **Anti-weakening:** review `git diff tools/conformance.mjs` for fields added to **both** projections. A field on one side only, an `?? expected.x` default, or an `expected.localeMatchResult.fallbackLocale` short-circuit restores green without restoring correctness — this is the slice most exposed to that.

---

## A1 — The `matchFor` arm for the locale ingress

**Unlocks: 134** **[M]**

**Scope.** One `case "matchFor"` arm in `conformance.mjs` ahead of the default arm at `:933`, comparing the **full eight-field** `expected.match` block. Export `forLocale` from `lokalized/core` (already allowlisted) over the same kernel. **No change to `src/internal/locale.js`.**

**Dependencies:** A0.

**Families green:** `locale-identity` 84, `browser-chooser` (.locale halves) 33, `m3b-canonicalization` 14, `ingress-matrix-java` 2, `manifest-loads` 0, `ingress-smoke` 1.

**Verification.**
- Before writing the arm, run the kernel standalone over the 134 and confirm all eight fields reproduce. If the arm later reports more passes than the standalone kernel produces, the arm is comparing less than it claims.
- The unsupported reason `operation 'matchFor' is not implemented (M7)` must drop 301 → **164**, and
  **no new reason string may appear.** *(Corrected after A1 shipped; it read 301 → 167, which is
  301 − 134 and contradicts line 30 of this plan: the three cases line 30 names as supplier-gated and
  raw-gated LEAVE the `matchFor` bucket rather than staying in it. Measured, HEAD → A1: matchFor
  301 → 164, `ambient locale/match suppliers are not implemented` 92 → 93, `raw/byte fixtures require
  the bounded parser's failure paths` 9 → 11, with the 16-string reason SET byte-identical. The three
  are `ingress-matrix-java.zh-tw.matchfor-ignores-ambient-match-supplier`,
  `manifest-loads.matchfor.absent-language-selects-nothing` and
  `manifest-loads.matchfor.one-child-language-selects-loaded-child`, each refused by an unmodified
  pre-existing `stringsFor` guard. Do NOT “restore” 167 by loosening `stringsFor`.)*
- **Anti-weakening:** grep the new arm for any `unsupported(` introduced inside it. A `try { matchFor(...) } catch { unsupported(...) }` wrapper looks identical in the headline count while converting real defects into attributed non-work.
- Root graph unchanged at 25 modules — `test/pinned-data-only.test.js` must pass, which is itself the
  check. *(It read “unedited”. A2, landing in the same tree, ADDED `data/iana-range-equivalents.js`
  to that test's forbidden-from-root list — a strictly stronger assertion, with the exact
  module-count assertions untouched at 25 root / 24 core. The edit is A2's; A1's intent is satisfied.)*

---

## A2 — Raw-range single-member ingress

**Unlocks: 50** **[M]**

**Scope.** A range entry point that does **not** `normalizeTag` its input. **[M] I read the source:** `matchFor` opens `const requestedTag = normalizeTag(requested); const range = lower(requestedTag);` — correct for `matchFor(Locale)` (Java builds the range from `toLanguageTag()`) and wrong for `matchFor(List)`, where Java keeps the raw lowercased range. `memberStaticsFor` at `locale.js:700` is already raw-correct, so the repair is confined to the entry. Add the RFC 4647 extended-range grammar validator producing `range=<r>`, plus section H's wildcard arms (`preferredLocaleForWildcard`, `structurallyFilteredLocales` + `preferredLocaleForRange`) — **the kernel's own comment at `locale.js:1206` declares these deliberately omitted**, so this is wiring, not new algorithm. Lives in `src/negotiate/index.js`.

**This refutes map 1's "the N-member work adds ONLY sections C–H; nothing below them needs to change."** The defect is above C–H.

**Dependencies:** A0, A1.

**Families green:** `owed-ds` 21, `m3b-canonicalization` 10, `m3b-negotiation` 10, `owed-member-statics` 3, `m3b-region-slot` 2, `m3b-wildcard-preference` 2, `owed` 2.

**Verification.**
- **[M] I ran the current kernel over all 50.** Baseline: **26 correct on {matchType, locale, languageRange}, 14 throw `RangeError`, 10 silently wrong.** The 14 throws are on ranges that are legal RFC 4647 but not well-formed locales: `de-*` ×2, `de-*-phonebk`, `*-ch` ×2, `x-*`, `zxx-*-fr`, `x-foo-*` ×2, `en-ab12`, `prs-1a`, `zh-guoyu-tw`, `sgn-be-fr-x-a`.
- **The 10 mismatches are worse than echo corruption.** `sgn-nsl` is rewritten to `nsl`, flipping CANONICAL→EXACT on five rows; and on `owed-ds.likely-subtag-tiebreakerless-prefers-fallback` the port **selects `nan-CN` where Java answers `nan-MY`** — the answer changes, not just the diagnostic. Acceptance is 50/50 on all eight fields, and `languageRange`/`requestedLanguageRanges`/`matchType` are now compared because A0 widened the projection.
- **The 14 throws are the anti-weakening trap.** They must produce a MATCH. A runner that catches the `RangeError` and reports `unsupported` moves them out of FAILED into a plausible-looking attribution while implementing nothing. Check: no id from that 14-list appears in `notImplementedIds`.
- **Regression guard:** `matchFor(Locale)` must STAY on the normalizing path. A single shared code path breaks A1's 134 — re-run A1's standalone comparison after the edit.
- Include the corpus's own control: `owed-ds.alias-ladder-nonalphabetic-extlang` sends `{range:'zh-123'}` and records NONE precisely to prove the extlang guard is not what rejects it. **Pair every new probe with a control expected to PASS** — this shape has produced confirmations of checks it never reached, in cases, in probes, and in the dispositions' own prescriptions.
- `npm run scenario:0a` (no `--write`): root graph unchanged at 25 **modules**. Source bytes DO grow and the ratchet reports it — see the recorded decision above; do not re-record.

---

## A3 — The N-member solver (DefaultStrings sections C–H)

**Unlocks: 24** **[M]**

**Scope.** Group/representative election (`:1577`), semantic-member election (`:1606`), the cell matrix with the non-syntactic discard (`:1631`), anchor reservation and the **category-major** heuristic passes (`:1655`, `:1710`/`:1713`, `:2251`), the governor sweep with `selectionIndexByLocale` (`:1723`), survivor bucketing and the serving cascade (`:1784`). Add the full `LanguageRangeSpecificity.compareTo` — category, then structuralDepth **ASC**, then fallbackDistance **REVERSED**; the single-member reduction never needed to compare two cells. **Retain, do not delete and do not generalize, the primary-language tail** (`:1886-1925`): Java keeps it and the port's structural fidelity is why both agree.

Deliberately sequenced **before** the header parser: these 24 arrive as explicit arrays and need no parser, so the solver is verified on inputs the parser cannot corrupt.

**Dependencies:** A2.

**Families green:** `m3b-negotiation` 9, `owed-ds` 5, `owed` 5, `owed-member-statics` 2, `browser-chooser` 2, `ingress-smoke` 1.

**Verification.** Four discriminating pairs; passing one half proves nothing. **Two of the four bullets below were rewritten after A3 landed, because the mutation each named was ABLATED and did not flip what it was said to flip.** What the pair actually discriminates is stated instead — a pair whose named mutation is wrong reads as corroboration and catches nothing, which is the "known-gap lists rot" failure mode in miniature:
- `owed-ds.heuristic-depth-outranks-weight` vs `.heuristic-depth-agrees-with-weight` — same ranges, swapped weights, different answer. Catches a **weight-before-depth ordering comparator**: swapping the depth and weight clauses in the heuristic sort loses `outranks-weight` and nothing else, while `agrees-with-weight` stays green. It does NOT catch range-major-vs-category-major, as this bullet used to claim: a genuine range-major driver (one pass per assignable range, each trying LIKELY_SUBTAG then PRIMARY_LANGUAGE, depth-first order preserved) leaves the corpus unchanged. That axis is invisible to the corpus; the port stays category-major because Java is, not because a case says so.
- `m3b-negotiation.zero-weight-exact-anchor-does-exclude` vs `.zero-weight-heuristic-anchor-does-not-exclude` — the DISCRIMINATING half is `exact-anchor-does-exclude`, and what it catches is a **weight-major governor comparison** or **skipping q=0 members at classification time**; either loses that row and nothing else. Dropping the weight condition from `broadPositiveStructuralRange`/`broadPositiveSemanticRange` flips NEITHER half (measured, both deleted at once: 1,568 passed / 0 FAILED, 0 ids lost), and so does letting ANY q=0 range exclude whatever it relates to. The `does-not-exclude` half is a control, not a discriminator: its q=0 `en-us` cell always loses the governor comparison to the q=0.5 EXACT `en` cell, so the exclusion never gets to bite.
- `owed.m3b.aliasgroup.alias-elected-when-it-is-the-semantic-range` (reports `nsl`) vs `.unrecognized-representative-governs` (reports `sgn-nsl`).
- `owed.m3b.electionguard.*` — a duplicate member must not re-elect.

**Two rules the corpus CANNOT check — read Java, not the corpus.** `selectionIndexByLocale`'s non-syntactic arm is dispositioned `excluded`; and `restrictedHeuristicRangeIndices` holds anchor-**owning** representatives as well as specific-heuristic ones. Implementing `restricted` as only `recognizedDepth > 1` loses the no-spill-into-a-sibling rule and **fails silently**, changing the answer only when nothing stronger claims the locale. Both need unit tests written from the Java source with an input constructed to differ between the arms **and a control expected to pass.** This is the exact shape of the two defects that survived a 1,965-case corpus.

Assert `EXTENDED_RANGE` is only ever produced by re-deriving the type per selected locale via `languageRangeMatchTypeFor` — never by mapping the governor's internal category. If any part of the dead primary-language verdict is re-derived, **pin the JaCoCo jars**: agent 0.8.15 over 0.8.13 core has already corroborated a wrong verdict on a neighbouring branch.

---

## A4 — `LanguageRange.parse`, the pinned IANA closure, `bestMatchForAcceptLanguage`

**Unlocks: 111** (90 headers + 21 acceptLanguage)

**Scope.** Port JDK `sun/util/locale/LocaleMatcher.java:440` verbatim: **global** space strip (not per-member trim), `accept-language:` prefix strip, `;q=` split with verbatim error text, dedup by range string with **first occurrence winning the whole equivalence class**, stable weight-descending insertion sort, equivalence expansion inserted at index+1. Load the 802-class `iana-language-range-equivalents.json` as `src/data/iana-range-equivalents.js` reachable **only** from `negotiate`. Port the 13-entry region/variant map (`LocaleEquivalentMaps.java:815-827`). Add `LocaleMatcher:117-180`'s fail-soft `bestMatchForAcceptLanguage`. ~~The reduced `IANA_RANGE_EQUIVALENTS` at `locale.js:49` **stays** — right table for member
identities, wrong one for the parser~~ **— STRUCK, refuted by ablation after A2.** Passing no resolver,
so `matchForRange` falls back to the reduced inline table, produces 2 FAILED
(`m3b-canonicalization.compound-alias-no-bok` wants CANONICAL/`nb-NO` and gets NONE;
`owed-ds.semantic-ladder-known-identity-survives-later-unknown-alias` wants `sfb` and gets `sgn`), so
the reduced table is the WRONG one for member identities too. The converse also measured: swapping
the pinned 802-class resolver in as the default for the locale ingress leaves the whole corpus at
1,384 passed / 0 FAILED, so the two doors are observationally equivalent corpus-wide. Keeping the two
tables apart is still right — the reduced one is what the ROOT graph may reach — but the pinned
closure is what member identities are built from, and `negotiate` injects it.

**And the 13-entry region/variant map is NOT the parser's alone.** Measured against the pinned
Corretto 21 over 4,010 ranges: `Locale.LanguageRange.parse` applies it, and
`DefaultStrings#addParsedLanguageRangeIdentities:2161-2172` literally IS `parse`, so it must be
threaded into the `rangeEquivalents` resolver `negotiate` injects, not only into the header parser.
The pinned artifact is not a complete model of `parse`: its candidate space (CLDR languages, aliases,
macrolanguage compounds) never probed a region or variant suffix, which is why
`IANA-PROVENANCE.md`'s losslessness claim is true over its probe space and insufficient here. Also
carry the one measured OVER-expansion: `cmn-hans` gains `zh-guoyu-hans`, which the JDK drops as
ill-formed — 1 of 3,207 suffixed probes. Both are recorded in `src/negotiate/index.js`'s
`pinnedRangeEquivalents` doc.

**Dependencies:** A3, B3.

**Verification.**
- **[M] Stopping line, measured (graft from contract-first):** the 90 headers parse to **27 single-member / 56 multi-member / 7 throwing.** The 27+7 are verifiable against A2's kernel alone; the 56 exercise A3. `requestedLanguageRanges` is the parser's own observable contract and is compared field-for-field thanks to A0, so the parser is verified **directly**, not through the answer it produces.
- **A JDK differential, in the `diff:tokenizer` style — the corpus alone cannot verify this slice.** No fixture loads a `-DE`/`-FX`/`-BU`/`-TL`/`-YD`/`-CD`/`-heploc` catalog and no case supplies such a range, so omitting the 13-entry map leaves **every corpus row green** while real headers like `de-DE` silently lose the `de-DD` member. Run `Locale.LanguageRange.parse` on the pinned Corretto 21 over every corpus header plus region/variant probes; require byte equality.
- Pins: `iw;q=0.9,he;q=0.4` → `[iw@0.9, he@0.9]` while `he;q=0.4,iw;q=0.9` → `[he@0.4, iw@0.4]` (any group-maximum or last-wins rule fails both); `range=notaheader!` (spaces stripped globally, not trimmed) and `range=\tfr` (tabs survive); the OWS-width pair `accept-language.ows-set.newline-is-not-ows` / `.no-break-space-is-not-ows`; the length pair `.at-cap-four-thousand-ninety-six` / `.over-cap-four-thousand-ninety-seven` (UTF-16 code units, **before** normalization — neither row alone discriminates).
- The 32-limit contradiction: the same 13-member header expanding to 33 must **throw** through `matchFor(List)` and **return the fallback** through `bestMatchForAcceptLanguage`. 32 exactly is accepted whole, never truncated.
- **0a is at risk here and nowhere else before it:** run `npm run scenario:0a` (no `--write`) and confirm the ROOT graph is still 25 **modules** (bytes grow — see the recorded decision above). The module half of the ratchet is what enforces that the 802-class table stays behind `negotiate`.

---

## B1 — Walk restructure: `fallbackPolicy`, the `failures`/`policyCalls` channels, non-throwing responses

**Unlocks: 158**

**Scope.** Restructure `src/core/index.js:300-378` so all three implicit decisions (continue at `:326`, continue at `:344`, break at `:363`) route through one explicit `if (candidateIndex + 1 >= chain.length) break;` guard followed by exactly one `shouldTryNextLocale` consultation. Add `fallbackPolicy` and `onFailure` on `createStrings` and per-call, `== null` meaning unset (the `bidiIsolation` precedent at `:171-186`). Build the frozen null-prototype `TranslationFailure` and dispatch RETURN_KEY / RETURN_STRING. Delete the `stringsFor` guards at `:396`/`:397`; **join** `failures` and `policyCalls` into both projections the way `resolverCalls` was joined. `candidateChain`, `isFallbackFor`, `interpolateFailureKey`, first-cause retention, the sticky flag and the precedence ladder are already correct — reuse unchanged.

**Dependencies:** A0.

**Families green (throw-carrying subsets stay attributed until B2):** `custom-policy` 39, `fallback-policy` 39, `ingress-matrix` (partial), `callback-interaction` (partial), `failure-handler` (partial), `phonetic-resolver` 13, `resolver-locale` 9, `dedup-and-candidates` 5, `bidi-isolation` 5, `options-smoke` 5, `runtime-limits` 7.

**Verification.**
- **DO NOT IMPLEMENT THE PRIMER'S INVARIANT.** **[M] I measured it: 422 cases carry `policyCalls`; 416 also carry `attemptedLocales`; the split is 100 EQUAL / 316 minus-one / 0 other, and the rule "equal iff the last recorded decision is `false`" has ZERO counterexamples in either direction.** "Exactly one fewer" is **false in 100 of 416 cases.** Coded as an assertion it rejects the port's own correct output; coded as a loop shape it consults the policy after the final candidate. **The primer must be corrected, not the maps** — both callback maps caught this independently.
- Negative-test the recorder: stub it to record nothing and confirm `custom-policy.finalcandidate.no-call-though-the-last-locale-is-listed` (four locales listed, exactly three calls) and `custom-policy.singlecandidate.throwing-policy-is-inert-and-the-handler-fires` go red. A silent recorder turns absent calls into passing assertions.
- Copy the oracle's recorder **ordering**: policy records AFTER the delegate returns, handler BEFORE. The **absence** of `policyCalls` is load-bearing evidence in four throw-in-policy cases.
- **Anti-weakening:** `policyCalls` may leave the `get`-case gate at `:733` **only in the same hunk that adds its comparison** — the file's own precedent is that `resolverCalls` earned its removal by being compared.
- **Contingency:** 426 already-passing `getResult` rows carry `failures`/`policyCalls` the runner has never read. Anything that goes red is a **pre-existing defect surfacing, not a regression** — fix it; do not touch the ratchet.

---

## B2 — Throw response: `MissingTranslationError`, cause identity, the eager operand refusal

**Unlocks: 82**

**Scope.** Delete the `expected.thrown` gate at `:691`. Add `MissingTranslationError` on the `StringsParseError` construction-token pattern (`src/internal/parse-diagnostics.js`) and the THROW_EXCEPTION dispatch: rethrow the retained **first** cause **by identity**, else construct `MissingTranslationError` quoting the **raw** key. Fix the currently-invisible operand divergence: call `validateOperandOptions` eagerly inside `src/index.js:96` `pluralOperands()`.

**Dependencies:** B1.

**Verification.**
- **The 34 supplier/supplied-match pre-walk ingress rejections must STILL be attributed after this slice.** If they turn green here, the error-name table has been loosened.
- **The single most important diff check in the milestone:** `java.lang.IllegalStateException` must **NOT** join `ERROR_NAME`. It means two different things — with `causeType` null it is the harness's sentinel escaping verbatim; with `causeType` `IllegalStateException` and a message beginning `Unable to resolve generated placeholder` it is the library's error rethrown by identity. Adding it accepts either for either. Follow the `RESOLVER_THREW` precedent, and for the sentinel arm assert **reference identity** (`caught === theSentinelTheRunnerThrew`) — strictly stronger than any name table, and what the rethrow-by-identity clause actually needs.
- **Correct two in-repo falsehoods in the same diff.** `VectorOracle.java:341-342` and `conformance.mjs:721-722` both say `getResult` would have returned the key. Eight `getResult` cases record `MissingTranslationException`, three named `...getresult-throws-too`.
- `runtime-limits.numeric.default.compact-exponent-65` and `.visible-decimal-places-1025` must go **green with a throw at value construction**. Without the eager refusal they go RED here — today the divergence is hidden behind the failure-handler reason. Their at-limit controls (`-64`/`-1024`) must stay TRANSLATED.

---

## B3 — Ambient resolvers, per-call `locale`/`localeMatch`, two-layer supplied-match validation

**Unlocks: 130**

**Scope.** Delete the `stringsFor` guard at `:389`. Replace `core/index.js:301`+`:315` with `localeLookupFor(callOptions)` implementing `DefaultStrings:2432`'s four arms; nothing below `:316` changes. **Implement the asymmetry exactly:** per-call `locale` and `localeResolver` keep the REQUESTED tag as `lookupLocale`; per-call `languageRanges` and `localeMatchResolver` REPLACE it with the selection. Both validation layers with their eight verbatim messages; the `supplierCalls` channel and recorder.

**Dependencies:** B2.

**Families green:** `supplied-match` 51, `ingress-matrix-java` 61, `m3b-supplied-match` 10, `ingress-smoke` 4, `owed` 4, plus the 1 supplier-gated `matchFor` case deferred from A1.

**Verification.**
- **The one-fixture six-ingress table** `ingress-matrix-java.zh-tw.*` is the acceptance test: instance-locale / per-call-locale / `localeSupplier` all give `[zh-TW, zh-Hant, en]`; `localeMatchSupplier` and per-call ranges give `[zh-Hant, en]`. A single-convention port passes half this table — which is the failure mode that looks like near-success.
- **Absence is a first-class assertion** in four cases. `supplied-match.contradiction.per-call-locale-bypasses-invalid-supplier` and `.matchfor-does-not-consult-supplier` run on instances whose fabrication would throw and succeed only because the resolver is never consulted. Negative-test by making the runner consult eagerly and confirming they go red.
- **Preserve the layer discriminator:** `supplierCalls` absent = `LocaleMatchResult`'s own constructor refused; present = the instance refused the returned value. Folding `supplied-match.considered.empty-list-fails-in-the-constructor` and `.subset-is-rejected` into one check reports the wrong message on one.
- **RE-PROBE BEFORE IMPLEMENTING** — two claims asserted-as-measured in map 4 were not re-verified by the critic and each decides which primitive the port uses: (i) `LanguageRange.equals` includes the **weight**, so a matched `("he",1.0)` against a requested `("he",0.5)` is refused by `List.contains`; (ii) `consideredLocales` equality is a **set over JDK-normalized tags** — accepting `["en","iw"]` but REFUSING `["en","mo"]` against a loaded `ro`. If (ii) holds, use `normalizeTag` and **not** `equivalentTags`, which would silently accept CLDR-equivalent supplied matches Java rejects. No case would catch that, because the corpus spells everything canonically — the same shape as the two tiebreaker defects found by hand-reading.
- Verify B2's gate reorder paid: the 32 `IllegalArgumentException` pre-walk refusals must now report against **this** slice.

---

## B4 — The `construct` arm and construction-time refusals

**Unlocks: 8**

**Scope.** A `construct` runner arm comparing `{constructed, failureType, failureMessage, probe}`, and the corresponding `createStrings` refusals: the locale-source XOR, absent/null supplier, null locale keys, duplicate normalized tags, null iterables, null entries, plus A0's two fallback refusals.

**Dependencies:** A0, B3.

**Verification.**
- **The XOR is a behavior change gated on `npm test`, not on the conformance count (graft from risk-first).** `core/index.js:154` today reads `options.locale ?? options.fallbackLocale`, so `owed-construct.refusal.locale-source-absent` currently CONSTRUCTS where Java refuses. Roughly fifty `createStrings` call sites in `test/` must be re-checked.
- All 8 rows compare `failureType`/`failureMessage` **exactly**, so the slice is gated on the message-parity decision (see open questions). Do not write an adaptation rule **inside** `conformance.mjs` — that file's history is why reviewers grep its diff.
- **Inherits A0's two unverified refusals.** The no-catalog refusal (`DefaultStrings:303-314`) and the
  ambiguous-equivalence refusal (`:465`) shipped in A0 with zero corpus rows exercising either. This
  is the slice that closes them: both need a `construct` case whose `refusesConstruction: true`
  fixture reaches the arm. The error TYPE divergence (`RangeError` vs `IllegalArgumentException`) is
  open question 3 and becomes gate-relevant HERE, where `failureType` is compared exactly.
- Preserve the rules the `construct` operation paid for: `constructionOverrides` names one value from a CLOSED set and an unknown value must **throw**, not quietly build a valid instance; `refusesConstruction: true` is refused by ingest unless a `construct` case names it and refused if any other operation does.

---

## C1 — Bounded output and the cumulative generated-expansion budget

**Unlocks: 3** — and that small number is the honest one.

**Scope.** Thread `maximumOutputCharacters` through `interpolate.js:167-268` as an append-checked builder; give `bidi.js:203-229` `isolate` the `(value, maximumCharacters, reportedMaximumCharacters)` signature with Java's **pre-scan rejection ordered before** the empty check and the already-isolated fast path; make `IsolatedValue` memoize. Construct `GeneratedExpansionBudget` inside `render()` at `interpolate.js:1051` so it resets per candidate for free; charge only when `depth > 0`.

**Dependencies:** B1.

**Verification.** The 39 override cases **must still report their reason.** Verify pairs, never singletons — the comparison is strictly-greater everywhere:
- `isolation-markers-are-charged-to-the-limit` vs `output-at-the-limit` — byte-identical apart from `bidiIsolation`, and the only evidence that isolation is inside the budget. The port's `out += isolate(...)` at `interpolate.js:256` passes both plain cases today.
- `owed.m3b.bidi.pre-isolated-value-longer-than-budget-rejected-before-early-return` — catches moving the length test after the fast path, which is the natural JS refactor.
- `owed.m3b.bidi.repeated-placeholder-second-occurrence-overruns` — reported maximum is 11 where 5 remained; proves two numbers are threaded, not one.
- `expansion.limit-six.nested-six` vs `.nested-eight` (charged at every level); `.repeated` (once per name); `.limit-zero.no-generated` (depth 0 never charged).
- `expansion.fallback.fr-under-any-failure-reaches-en-on-a-fresh-budget` — the only case that sees a budget hoisted onto the instance or a per-`getResult` closure.

Do not convert an expression-limit **construction** refusal into a resolution failure because the corpus is silent there; the family's `skipped` block records that the exceeding side is structurally unauthorable.

---

## C2 — Chooser, the four unowned M7 clauses, and one 0a re-record

**Unlocks: 0**

**Scope.** `chooseLocaleForPreferredLanguages` / `chooseBrowserLocale` in core: at most 32 entries in list order, malformed entries skipped, the **strict** kernel per entry, first `isMatch` wins, and only after exhaustion the **RESOLVED** fallback. Then discharge the four M7-row clauses **no subsystem map covered**, and re-record 0a once.

**Dependencies:** A4, B4, C1.

**Verification.**
- **The chooser has ZERO corpus cases.** Build it from the `.locale` halves only. The corpus proves the channels disagree: `browser-chooser.conflict.sgn-no-solvers-diverge.locale` selects `nsl` where `.ranges` selects `nsi`. Three traps: use the strict kernel, not `bestMatchFor` (which manufactures the fallback so the list never advances); over-32 **truncates silently** (a third answer — `matchFor` throws, `acceptLanguage` fails soft); exhaustion returns A0's **resolved** fallback (with `{hy-AM, hy-SU}` and configured `hy-810`, returning the configured tag names a catalog nothing answers to).
- **Revalidation, assert-don't-build.** `evaluation-locale` is 117/117 green and `pt-flattening` 27/27, so the evaluation-locale clause is a standing assertion — add a test naming all four consumers (plural/ordinal classification, language-form selection, bidi isolation, phonetic resolution) rather than trusting a family count. `generated-placeholders` is 37/38, so **generated scope** (a fragment's expressions see the caller's ORIGINAL placeholders — plan 8.3) is also revalidation; it is named in the M7 row and appears in **no** subsystem map.
- **The two M1 gates appear in no map at all**: whether the lossless encoding remains production against the FINAL graph, and whether every canonical field omitted as non-runtime still is. Owner: `M1/ENCODING-DECISION.md`, which nobody consulted.
- **Cache bounds:** no tag-keyed cache exists today. If the plan-blessed constant-instance-locale cache is added, it must be the **same frozen object** handed to the result, the failure and the error — `matchObjectIdenticalToResult` asserts that identity on the Java side.
- **Close:** `npm run verify > v.log 2>&1; echo $?` and `npm run check > c.log 2>&1; echo $?`, both read from `$?`, **never through a pipe**. `npm run scenario:0a -- --write --reason "..."` exactly **once**, the reason naming which variant grew and why the 802-class table is not in the root graph. Update `test/pinned-data-only.test.js:114`'s exact count and `:123-140`'s exact data list as a deliberate reviewable edit — **never relaxed to a floor.**

---

# OPEN QUESTIONS — HUMAN DECISION REQUIRED

**Decide before A2/A4 are scheduled — this one changes M7's size by a third:**

1. **Milestone ownership of 157 cases.** `IMPLEMENTATION-PLAN-v7.md:2925` gives **M9** "RFC 4647, q-values, whole-list matching, fail-soft headers, and the pinned IANA/JDK-compatibility closure", and `:872-895` puts these symbols on `LocaleNegotiator` explicitly outside the root graph. `conformance.mjs` OWNER_MILESTONE charges all 301 `matchFor` and all 21 `acceptLanguage` to M7. On the plan's reading, A3+A4 (135 cases) are M9 and M7 closes at ~350 unsupported, not 215.

**Decide before or during A0/B4:**

2. **Both resolvers in one object literal.** No oracle exists by construction — `Strings.Builder`'s setters each null the other, so Java can never reach the state and `:254`'s both-present arm is dead. A `localeSource:"both"` case was authored, measured, and removed because it constructed. Recommendation: refuse, using `:254`'s exact proposition (the literal is the analogue of the constructor, not the fluent builder; last-key-wins would make behavior depend on spread order). Needs a recorded decision — no Java run can corroborate it.
3. **The 8 `construct` rows' message parity.** Join the existing `causeMessage` ratchet (136/171, ratcheted not gated), or write an adaptation rule **outside** `conformance.mjs`? Note `duplicateNormalizedTag` may be inexpressible: it needs two keys normalizing alike (`en_US_POSIX`/`en_US_posix`), which a JS record cannot hold though a `Map` can.
4. **Ill-formed-tag leniency, and the missing error contract.** Java's `forLanguageTag` **truncates** at the first ill-formed subtag and then translates: `no-NO-NY` → `lookupLocale no-NO`, `attemptedLocales [no_NO, no, nb_NO, nb, en]`, TRANSLATED. JS `normalizeTag` throws `RangeError` for that whole class. Map 1's "normalizeTag reproduces forLanguageTag" was checked on ten tags, none of which truncate — a probe with no control expected to diverge. **No corpus case discriminates it, so no slice above will catch it.** Compounding: the plan's `LokalizedError` hierarchy with a `code` field has not landed; the port's existing `UnsupportedLocaleError` (`plural.js:78`) has no `code` and means something else. Touches M7's "arbitrary well-formed direct lookup" clause.
5. **Two corpus rows are unpassable under the plan.** `ingress-matrix-java.zh-tw.per-call-ranges-displace-per-call-locale` and `supplied-match.ingress.per-call-ranges-clear-an-earlier-per-call-locale` record Java **answering** where plan 3.3 makes the both-present state a refusal — and probing the reverse setter order gives the opposite answer, so the recorded outcome is an artifact of the **oracle's** setter order, not a library property. Needs a recorded **nonportability** decision. Letting a conformance attribution rule absorb them is exactly the regression-disguised-as-progress this repo already caught once.
6. **The 13-entry region/variant map.** Ship it or not? If yes: the JDK returns only the FIRST key hit in **HashMap iteration order**, measured on the pinned Corretto 21 as `[-bu,-tl,-tp,-dd,-mm,-cd,-de,-heploc,-alalc97,-yd,-fr,-ye,-fx]`. Is "match the pinned JDK exactly" the rule, or is a declared divergence acceptable for ranges carrying two equivalent subtags (`xx-fr-de`)? And where does it live — a second pinned artifact, or an amendment with its lock regenerated?
7. **Null-returning callbacks.** A handler or policy returning null is a real Java NPE with a verbatim message and **zero** corpus cases, because `VectorOracle` has no `return-null` behavior. The plan specifies `ConfigurationError` — a divergence nobody can check. **Adding a `return-null` behavior to the oracle and rebuilding is cheaper than shipping the divergence blind.**
8. **`onFallback` / `FallbackObserver`.** No Java counterpart; the corpus `expected` vocabulary has no observer channel. The plan already settles more than the maps assumed (`:1024` fires once after a later candidate succeeds, so it does not fire on a `resolvedLocale: null` result and the observer/`isFallback` disagreement is intentional; `:1032` observer semantics; `:869` the same frozen match object). **What actually remains open is only `precedingFailures`**, which needs per-candidate records Java discards on success. Scope as JS-only with its own tests, or defer out of M7.
9. **A cheap oracle gap worth closing before B1 depends on it.** `VectorOracle.recordingPolicy` appends AFTER the delegate returns, so a throwing policy's final consultation arguments are **unobservable** — a port could pass all nine throw-in-policy cases while handing the policy the wrong locale. One `try/finally` plus a rebuild closes it.
10. **0a thresholds.** M7's row says cold-construction, 2,000-key and memory budgets are "accepted", but `scenario-0a.mjs` states in its own header that **no thresholds exist by decision** (M0 certification was deliberately skipped), its catalog is a fixed 3-key literal that cannot measure 2,000 keys, and it prints "NOT MEASURED" for the browser half. Accepting a budget at M7 means **freezing numbers never frozen, against evidence that does not exist.** Who decides the values, and against what? Related: chooser placement decides whether root and core grow asymmetrically, which 0a will report and someone must justify in the `--reason` text.
11. **`LocaleMatchResult` constructor validation in JS.** Java validates caller-supplied results seven ways. The plan gives the JS type to core as a **structural** type. Which refusals does JS enforce, and where — negotiator construction, `localeMatchResolver` validation, or nowhere?
