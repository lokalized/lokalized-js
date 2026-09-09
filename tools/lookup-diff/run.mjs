#!/usr/bin/env node
// @ts-check
/**
 * THE END-TO-END LOOKUP DIFFERENTIAL. Drives `createStrings(...).getResult(key, …, { locale })` and
 * the REAL `DefaultStrings` over the same catalogs and the same tags, and compares what a LOOKUP
 * answers — the translation, the supplying locale, the accumulated attempted locales, the failure
 * reason, or the refusal.
 *
 *   node tools/lookup-diff/run.mjs
 *
 * WHY IT EXISTS, and it is not "one more probe space". Every one of this repository's six existing
 * differentials compares a LAYER — a tag against `toLanguageTag`, a header against
 * `LanguageRange.parse`, a template against the tokenizer, a term against the phonetic resolver.
 * M7's clause 12 is about none of those. It asks what a LOOKUP does for an arbitrary well-formed
 * direct locale, and the divergence that closed clause 12 lives strictly BELOW every existing probe:
 *
 *   `npm run diff:direct-tag` is GREEN on `ja-JP-x-lvariant-JP`. Both sides normalize it to
 *   `ja-JP-u-ca-japanese-x-lvariant-JP`, byte for byte. And a lookup for it THREW in Java and
 *   ANSWERED in the port, because the refusal is a validation of the ATTEMPTED-LOCALE CHAIN the walk
 *   synthesizes — of `ja-JP-u-ca-japanese-x-lvariant-jp`, a candidate the caller never spelled and
 *   no tag-layer differential can reach.
 *
 * So a differential that compares tags cannot, in principle, gate the clause. This one compares
 * outcomes AND WALKS.
 *
 * IT COMPARED ONLY OUTCOMES UNTIL 2026-09-09, and its own docblock said so rather than assuming
 * otherwise: "a port that matched Java's OUTCOME while running a different walk would show 0
 * unexplained in this tool". That was not a hypothetical. It is exactly how the ingress defect hid —
 * for `en-x-lvariant-NY` Java records `calls=[]`, because `TranslationOptions.Builder#locale`
 * refuses at `TranslationOptions.java:310` and the walk is never entered, while the port ran a whole
 * walk with FIVE callback invocations and then refused from inside it. Both refused, both raised the
 * mapped class, both carried the same sentence, and this tool reported agreement. **The walk is
 * observable and it was not being observed.**
 *
 * EVERY OUTCOME NOW CARRIES A SEVENTH FIELD: the `fallbackPolicy` consultations and the `onFailure`
 * invocation, in order, with their reasons, locales, attempted lists and cause classes. Both sides
 * install RECORDING DELEGATES of the library defaults — `fallbackOnMissingTranslationOrNoMatching
 * Alternative()` / `returnKey()` in Java, their exact port counterparts here — so the channel
 * observes the walk without steering it. That claim is measured rather than argued: across the
 * change every outcome number this tool prints is byte-identical (320,234/520,597 identical,
 * 200,366 declared, 0 unexplained, 7/10 construction, 2,156 ill-formed refused).
 *
 * A DIVERGENCE RULE CANNOT ABSORB A TRACE DIFFERENCE — `KNOWN_DIVERGENCES` is consulted only for
 * rows whose traces already agree. Every rule in the table argues about wording or an error class
 * and none of them has anything to say about which callbacks ran, so letting one explain a
 * different WALK would be the widening this file's own tables exist to prevent.
 *
 * THE CATALOG SET IS PART OF THE INPUT. This is the design constraint, and it was measured rather
 * than assumed. On the pinned Corretto 21:
 *
 *   catalogs {nn, nb, fr}, fallback fr, lookup `en-US-x-lvariant-POSIX`  ->  Java THROWS
 *   catalogs {en, fr},     fallback fr, lookup `en-US-x-lvariant-POSIX`  ->  Java answers `hello-en`
 *
 * Same tag, same library, opposite outcomes. The chain for `en-US-POSIX` is
 * `[en-US-POSIX, en-US, en, en-US-posix]`, and with an `en` catalog loaded the walk serves at the
 * third member and never reaches the duplicate at the fourth. **A differential over one fixed
 * fixture would have missed the duplicate refusal entirely** — which is exactly the "the probe space
 * is a guess" failure that hid four IANA keys for a whole milestone, one axis over. Hence the probe
 * space is a CROSS PRODUCT of tags against several catalog sets chosen to reach different depths of
 * the same chains.
 *
 * THREE KEYS PER PROBE, for the same reason. `Hello` is in every catalog and `Only` is in a subset,
 * so the second lookup has to walk PAST a catalog that matched the locale and could not answer.
 * Without it almost every probe resolves in one step, the attempted-locale list stays one long, and
 * the list is precisely where both of Java's refusals live. `Absent` is in NO catalog, so the walk
 * exhausts every candidate including the fallback — see `PROBE_SHAPES`, where the measurement that
 * forced the third key is recorded. (This paragraph said TWO while the code carried three; the count
 * drifted as the tool grew inside its own batch, which is the same prose-rot shape the site count
 * below had.)
 *
 * AND THREE INGRESSES, which is the axis the first measurement demanded and the axis a later one
 * corrected. It carried TWO for a batch — the per-call `{ locale }` and the ambient locale — while
 * the third observable site sat outside the probe space and was named as unprobed in this file's own
 * open-defect entry. Two of three is the trap, not a partial credit: fixing what a probe space
 * happens to see is the probe space deciding the scope of its own fix.
 * `LocaleUtils.requireWellFormed` `LocaleUtils.requireWellFormed`
 * is called at 24 CALL SITES in `lokalized-java` outside `LocaleUtils` itself, carrying 15 DISTINCT
 * diagnostic descriptions — MEASURED with
 * `grep -rn 'requireWellFormed' lokalized-java/src/main/java/com/lokalized`, which also finds the
 * declaration at `LocaleUtils.java:53` for a raw match count of 25. (This said "ten sites with ten
 * descriptions"; both halves were wrong, and the correction matters because the undercount made the
 * probe space look more complete than it is.) The descriptions are `Locale` x5, `Fallback locale` x3,
 * `Lookup locale` x2, `Locale override` x2, `Attempted locale` x2, and one each of
 * `localeSupplier result`, `Tiebreaker locale`, `Target locale`, `Source locale`, `Selected locale`,
 * `Resolved locale`, `Requested locale`, `Localized strings locale`, `Locale key`,
 * `Considered locale`.
 *
 * TEN OF THEM PRODUCE REFUSALS THIS TOOL CAN OBSERVE, and all ten are DRIVEN here. It said FOUR
 * until 2026-09-09, and the six that were missing are not an oversight in this list — they are the
 * six a LOOKUP cannot reach, which is a different question from the one this list is supposed to
 * answer. Confusing the two is the trap this file's own header warns about, one axis over: the four
 * were how many sites the probe space observed, not how many sites Java has.
 *
 *   `TranslationOptions.java:73/310`        "Locale override"        the per-call `{ locale }`
 *   `DefaultStrings.java:2457`              "localeSupplier result"  the ambient locale
 *   `LocaleMatcher.java:64`                 "Requested locale"       `matchFor(Locale)`
 *   `TranslationResult.java:116` and
 *     `MissingTranslationException.java:153` "Attempted locale"      the synthesized chain
 *   `Strings.java:211`, `DefaultStrings.java:248`
 *                                           "Fallback locale"           construction
 *   `DefaultStrings.java:276`               "Localized strings locale"  construction
 *   `DefaultStrings.java:347`               "Tiebreaker locale"         construction
 *   `DefaultStrings.java:2713`              "Locale"                    `getKeysForLocale`
 *   `DefaultStrings.java:2735`              "Source locale"             `getMissingKeys`
 *   `DefaultStrings.java:2736`              "Target locale"             `getMissingKeys`
 *
 * The three CONSTRUCTION sites are reached by the `illformed-*` catalog sets and compared on the
 * `C` line; the three INSPECTION sites by the four keyless inspection shapes in `PROBE_SHAPES`.
 * Neither group was compared before 2026-09-09 — the construction sets existed and the run threw
 * their refusal away, and inspection had no shape at all.
 *
 * The first three are INGRESS checks a caller's own locale meets before resolution begins; the
 * fourth validates locales the WALK synthesized. `LocaleMatcher.java:64` is unreachable through a
 * lookup — `DefaultStrings.java:2439` and `:2458` both call `matchFor(requestedLocale)` only after
 * their own ingress check has passed — so it needs the keyless `matcher` shape in `PROBE_SHAPES`,
 * and nothing else in this tool reaches it.
 *
 * THREE MORE ARE ON A LOOKUP'S PATH AND UNREACHABLE ONLY BECAUSE AN INGRESS CHECK FIRES FIRST —
 * `TranslationResult.java:109` ("Lookup locale") and `:111` ("Resolved locale"), and
 * `MissingTranslationException.java:146` ("Lookup locale"). They stay silent because an ingress
 * check fires first, which is why the port's ingress checks are not a diagnostic nicety: a port
 * without them has three further Java diagnostics that could surface where Java's never do.
 *
 * `LocaleMatchResult.java:97` / `:101` / `:117` ("Selected locale" / "Fallback locale" / "Considered
 * locale") WERE LISTED ABOVE AS TWO MORE OF THAT KIND, AND THAT WAS TRUE OF A LOOKUP AND FALSE OF
 * THE CLASS. A lookup does pre-empt them; the constructor is nevertheless PUBLIC and documented as
 * public (`LocaleMatchResult.java:65-80`, "This is public so custom LocaleMatcher implementations
 * can expose the same diagnostics"), so all three are caller-facing through it — and through the
 * port's `forLocaleMatch`, `localeMatchResolver` and per-call `{ localeMatch }`. THE PORT ACCEPTED
 * ALL THREE ILL-FORMED INPUTS until 2026-09-09.
 *
 * THIS TOOL IS STRUCTURALLY BLIND TO THEM and stays so: it has no SUPPLIED-MATCH shape, only lookup,
 * matcher, construction and inspection ones, and a lookup can never reach a caller-built
 * `LocaleMatchResult`. That is recorded here rather than fixed because the alternative — letting the
 * instrument's reach decide the scope of the fix — is the exact failure this file's own defect entry
 * names one axis over. `test/supplied-match-ingress.test.js` is the enforcement; if a supplied-match
 * shape is ever added here, `DESCRIPTIONS` below gains "Selected locale" and "Considered locale"
 * (identities both), and not before — an entry nothing can match explains nothing.
 *
 * A differential that drove only the per-call ingress would gate one of the four observable sites
 * and say nothing about the others — the same "a probe space derived from the thing under test is
 * blind to that thing's gaps" failure as the IANA closure, one axis over. So each catalog set is
 * built TWICE, once with a constant instance locale (per-call probes) and once with a resolver
 * reading a mutable cell (ambient probes), every tag is driven through both, and every tag is then
 * driven through the matcher door as well.
 *
 * WHAT THIS TOOL STILL DOES NOT COMPARE, stated because two of the port's four matcher doors are
 * outside it: `createStrings({ locale })` as a REFUSAL site, and `createLocaleNegotiator`'s
 * `matchFor` / `bestMatchFor`. Neither has a Java counterpart reachable from a `Strings` lookup —
 * the first has no Java setter at all, the second is the same `LocaleMatcher.java:64` reached
 * through a different object. Deleting either check leaves this run GREEN, measured, so
 * `test/requested-locale-refusal.test.js` is their specification and its ablation table records the
 * two rows that say so.
 *
 * IT IS NOT PART OF `npm run verify`, for the same reason its six siblings are not: `verify` must
 * run in a checkout with no pinned Corretto 21 and no built `lokalized-java`, and a gate that
 * silently passes when its oracle is missing has stopped gating. A green `verify` says nothing about
 * this tool and it must always be named separately.
 *
 * PROVEN TO GO RED, by ablation rather than by argument. Each row below was measured by patching the
 * named file, running this tool, and restoring the file; every one was caught, and none by a
 * neighbouring rule.
 *
 * TWO TABLES, BECAUSE THE PROBE SPACE MOVED TWICE AND A SINGLE TABLE WOULD BE HALF STALE. The first
 * seven rows were measured against the 331,289-row space the matcher ingress produced; the six new
 * rows against today's 520,597-row space (11 shapes, and the `C` line comparing refusals rather
 * than a boolean). What carries across a space change is the DIRECTION — every one of these
 * ablations is still caught — and not the count, so the counts are dated rather than restated.
 *
 * Baseline for the FIRST table: exit 0, 0 unexplained, 11,201 declared, 0 open port defects.
 *
 *   | ablation                                                        | unexplained | exit |
 *   |---|---:|---|
 *   | `throwForFailure` loses its attempted-locale validation         |     1,732   |  1   |
 *   | `und` compared case-INSENSITIVELY again (locale-jdk-tag.js)     |        66   |  1   |
 *   | `isFallbackFor` always answers false (core/index.js)            |   233,008   |  1   |
 *   | every tiebreaker list reversed (internal/locale.js)             |       406   |  1   |
 *   | the declared-divergence rule neutered                           |    11,201   |  1 + STALE |
 *   | a bogus rule that explains nothing is added                     |         0   |  1 + STALE |
 *   | duplicate key made case-SENSITIVE (`attemptedLocaleRefusal`)    |    16,140   |  1   |
 *
 * The `und` row is the one the matcher ingress changed: 24 before, 66 now, because the selection
 * channel reports a requested RANGE derived from the same tag and the two lookup ingresses never
 * showed it. Everything else is unmoved to the row, which is the expected result — the new ingress
 * adds a shape, not a different library.
 *
 * THE LAST ROW WAS ADDED BY A REVIEWER AND REPRODUCED HERE, and it is the one worth keeping for the
 * reason it was not in the original six: nobody designing this probe space anticipated it. The
 * single-token change from `attemptedLocale.toLowerCase()` to `attemptedLocale` at
 * `src/core/index.js` is absorbed by NO rule — declared stays 11,201 — so the probe space is
 * demonstrably not fitted to the ablations that were run against it.
 *
 * The two table gates are the fifth and sixth rows: neutering the one declared rule turns its 11,201
 * rows into 11,201 unexplained AND trips STALE on the now-empty rule, and adding a rule that
 * explains nothing to an otherwise green run turns it red on the STALE line alone. The third and
 * fourth rows are there because a differential that only ever caught refusals would be a refusal
 * differential; `isFallback` and the tiebreaker election are ordinary result fields with no
 * exception anywhere near them.
 *
 * THE SECOND TABLE — 2026-09-09, the construction and inspection ingresses. Baseline: exit 0,
 * 0 unexplained, 200,366 declared, 7/10 construction outcomes identical, 2,156 ill-formed refused.
 * Every ablation deletes ONE `requireJdkWellFormedLocale` call in `src/core/index.js` and leaves
 * every other check standing; each is paired in `npm test` with controls that must stay GREEN, and
 * they did.
 *
 *   | ablation (one deleted check)          | what this tool reports              | npm test |
 *   |---|---|---|
 *   | `Fallback locale` (:248)              | 1 unexplained, construction row:    | 2 fail   |
 *   |                                       | the port names the missing catalog  |          |
 *   | `Localized strings locale` (:276)     | CATALOG SET DISAGREEMENT: js BUILT  | 2 fail   |
 *   | `Tiebreaker locale` (:347)            | 1 unexplained, construction row:    | 3 fail   |
 *   |                                       | the port names the permutation      |          |
 *   | `Locale` (:2713, getKeysForLocale)    | 1,547 unexplained, all inspect-keys  | 1 fail  |
 *   | `Source locale` (:2735)               | 1,547 unexplained, all              | 1 fail   |
 *   |                                       | inspect-missingSourceFirst          |          |
 *   | `Target locale` (:2736)               | 47,254 unexplained (45,707 inspect- | 1 fail   |
 *   |                                       | missingSourceFirst + 1,547 inspect- |          |
 *   |                                       | missingInto) + 196 ill-formed       |          |
 *   |                                       | WRONGLY ACCEPTED                    |          |
 *
 * THE `Target locale` CELL READ "1,547 unexplained (inspect-missingInto)" UNTIL A REVIEWER RERAN IT,
 * and the error is this table's own subject one axis over: 1,547 was measured against the TEN-shape
 * space, before `missingSourceFirst` was added, while the header above says all six rows were
 * measured against today's eleven-shape / 520,597-row space. A count that drifted as the instrument
 * grew inside its own batch. The composition is read off the rule's by-ingress line: baseline
 * `requireWellFormed-names-a-Locale-toString` consumes 63,172 rows (inspect-missingSourceFirst
 * 47,327, inspect-missingInto 1,547); under the ablation it consumes 15,918 (inspect-
 * missingSourceFirst 1,620, inspect-missingInto none), so 45,707 + 1,547 = 47,254 rows moved. The
 * OTHER FIVE ROWS REPRODUCE EXACTLY, each moving only its own rows with every paired control green
 * and `npm run conformance` unmoved at 1,960 / 0.
 *
 * THE `Source locale` ROW IS WHY THE FOURTH INSPECTION SHAPE EXISTS. With three shapes that
 * ablation left this tool GREEN and only `test/inspection.test.js` red: no shape passed TWO
 * ill-formed locales at once, so the surviving validation inside `keysForExactLocale` still named
 * the source on every one-sided input. The hole was found by running the ablation, not by reading
 * the code, and it was closed by widening the probe space rather than by recording it.
 *
 * AND THE NEW RULE IS GATED LIKE EVERY OTHER: neutering
 * `inspection-unsupported-locale-follows-plan-3.3`'s Java-side regexp turns its 137,194 rows into
 * 137,194 unexplained AND trips STALE, exit 1. Measured, not asserted.
 *
 * THE THIRD TABLE — 2026-09-09, THE CALL TRACE. Baseline: exit 0, 0 unexplained, 200,366 declared,
 * 0 rows whose walks differ, and 274,136 of the 520,597 compared rows recording at least one call
 * ON EACH SIDE — that last number is the channel's own staleness gate, since a trace comparison in
 * which nothing was ever recorded compares `-` against `-` and reports agreement it has not earned.
 *
 * A COMPARISON THAT HAS NEVER FAILED IS UNPROVEN, so each row below was produced by patching
 * `src/core/index.js`, running this tool, and restoring the file. The column that matters is the
 * LAST one: rows the six-field outcome comparison called IDENTICAL and the trace channel does not.
 *
 *   | ablation (one edit to the port's walk)                | unexplained | exit | outcome-identical |
 *   |---|---:|---|---:|
 *   | one extra `fallbackPolicy` call on the FINAL candidate |   101,958   |  1   |      101,586      |
 *   | the port's per-call `Locale override` ingress deleted  |     4,641   |  1   |           0       |
 *   | the policy handed `lookupLocale`, not the candidate    |   229,396   |  1   |     229,024       |
 *
 * ROW 1 IS THE PROOF THE TASK ASKED FOR and it is the sharpest of the three: discarding the return
 * value of one extra consultation leaves every outcome field untouched, and 101,586 rows this tool
 * called identical the run before now fail. Row 3 changes a single ARGUMENT — the default policy
 * ignores the locale, so again no outcome moves — and catches 229,024 the same way, which says the
 * per-entry fields are compared and not merely the entry count.
 *
 * ROW 2 IS THE HISTORICAL DEFECT, REPRODUCED. Deleting the port's per-call ingress check restores
 * exactly the state the ingress batch found by hand: `java trace -` against
 * `P|MISSING_TRANSLATION|en-x-lvariant-NY|-;P|…;P|…;P|…;H|RESOLUTION_FAILURE|…`, five port calls
 * against Java's none. Its outcome-identical column is 0 — today the DESCRIPTION diverges too, so
 * the outcome channel catches it as well — and that is the point rather than a weakness: the two
 * channels are independent, and the trace one reports the asymmetry directly (278,777 js rows
 * recording a call against Java's 274,136) instead of as a wording mismatch.
 *
 * AND THE CHANNEL'S OWN STALENESS GATE IS NEGATIVE-TESTED, because a comparison that goes green when
 * it stops observing anything is the failure mode every table in this repository is built against.
 * Silencing BOTH recorders — `LookupDiff.java`'s two installs and this file's two `jsTrace.push`
 * calls — leaves `0 row(s) whose WALKS differ`, which reads exactly like the passing baseline, and
 * the run exits 1 printing both STALE lines on `0 java / 0 js row(s) recorded at least one call`.
 * Silencing one side alone is caught twice over, as an asymmetry and as 274,136 differing walks.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createStrings } from "../../src/core/index.js";
import { normalizeTag } from "../../src/internal/locale.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const specDir = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR)
  : resolve(root, "../lokalized-spec");
const javaDir = process.env.LOKALIZED_JAVA_DIR
  ? resolve(process.env.LOKALIZED_JAVA_DIR)
  : resolve(root, "../lokalized-java");
const JAR = process.env.LOKALIZED_JAR ?? join(javaDir, "target/lokalized-3.0.0.jar");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// The catalog sets.
// ---------------------------------------------------------------------------------------------

/**
 * `Hello` is in EVERY catalog; `Only` is in a subset. See the header: the second key is what forces
 * the walk past a locale that matched and could not answer, and the attempted-locale list is where
 * both of Java's refusals live.
 *
 * @param {string} tag
 * @param {boolean} sparse whether this catalog also defines `Only`
 */
const catalogFor = (tag, sparse) =>
  sparse ? { Hello: `hello-${tag}`, Only: `only-${tag}` } : { Hello: `hello-${tag}` };

/**
 * @param {string[]} tags
 * @param {string[]} withOnly the subset that also defines `Only`
 */
function catalogs(tags, withOnly) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const tag of tags) out[tag] = catalogFor(tag, withOnly.includes(tag));
  return out;
}

/**
 * SEVEN CATALOG SETS, each chosen to stop a chain at a DIFFERENT depth. (This said FIVE; the two
 * throwing sets described three paragraphs down were added inside the same batch and the count was
 * not carried through.) That is the axis this tool
 * adds and the reason a fixed fixture is not enough — see the header's measured {nn,nb,fr} / {en,fr}
 * split.
 *
 * Several sets load two or more catalogs sharing one primary language, which `DefaultStrings`
 * refuses outright without `tiebreakerLocalesByLanguageCode` (and `createStrings` refuses with the
 * same diagnosis). The tiebreaker lists are therefore not decoration: they are what makes those sets
 * constructible at all, and they put the port's tiebreaker code — the one area `CLAUDE.md` records
 * as having hidden two real defects from a 1,965-case corpus — on the end-to-end path.
 *
 * TWO OF THEM INSTALL A THROWING FAILURE HANDLER, and that is a validation site rather than a mood.
 * Java's `throwExceptionFor` (`DefaultStrings.java:3196-3213`) builds NO `TranslationResult`: it
 * constructs a `MissingTranslationException`, whose constructor
 * (`MissingTranslationException.java:130-166`) runs the SAME attempted-locale validation as
 * `TranslationResult`'s. So the default handler and a throwing handler reach DIFFERENT copies of the
 * check, and a differential that only ever used the default handler would gate two of the three
 * sites and believe it had gated three.
 *
 * THREE OF THE TEN EXIST TO BE REFUSED, and they are the axis this tool was missing. Every other
 * set here is keyed on WELL-FORMED locales — fr, nb, nn, en, en-US, en-US-POSIX, ja, ja-JP, th,
 * th-TH, zh-Hans, zh-Hant — so the `C` line, whose own header promises that "a set Java refuses and
 * the port accepts (or the reverse) is a defect in its own right and must never be silently
 * skipped", compared BUILT against BUILT ten times and discriminated nothing. That is this file's
 * own reasoning about the matcher ingress, one axis over and not applied: a probe space derived from
 * the thing under test is blind to that thing's gaps.
 *
 * IT FOUND A REAL DEFECT ON ITS FIRST RUN. Java validates `Fallback locale`
 * (`Strings.java:211`, `DefaultStrings.java:248`), `Localized strings locale` (`:276`) and
 * `Tiebreaker locale` (`:347`) at CONSTRUCTION; the port had none of the three and BUILT all three
 * sets below, reporting `getSupportedLocales() = ["fr","en-x-lvariant-NY"]` for a catalog set Java
 * cannot construct. Behaviour, not wording. The corpus could never have caught it — measured, every
 * locale spelled by every one of the 2,346 cases is well-formed, 0 exceptions.
 *
 * `refusedByJava` IS A GATE, NOT AN ANNOTATION. A set carrying it that Java BUILDS is reported as a
 * construction mismatch and fails the run, exactly as the reverse is: without that, a future edit
 * that made these sets well-formed by accident would silently return the axis to comparing BUILT
 * against BUILT, which is the state this addition exists to end.
 *
 * @type {{name: string, fallback: string, instance: string, throwOnFailure?: true,
 *   refusedByJava?: true,
 *   tiebreakers: Record<string, string[]> | null, strings: Record<string, Record<string, string>>}[]}
 */
const CATALOG_SETS = [
  {
    // The measured EXHAUSTING set. Nothing here can answer an `en`/`ja`/`th`/`de` request, so the
    // walk runs the WHOLE candidate chain and reaches the members Java refuses.
    name: "exhausts",
    fallback: "fr",
    instance: "fr",
    tiebreakers: null,
    strings: catalogs(["fr", "nb", "nn"], ["fr"]),
  },
  {
    // The measured EARLY-SERVE control, differing in nothing but which catalogs are loaded. It is
    // what turns "these tags throw" into the true statement: the refusals bite only on the part of
    // the chain the walk actually REACHES.
    name: "serves-early",
    fallback: "fr",
    instance: "fr",
    tiebreakers: null,
    strings: catalogs(["en", "fr", "ja", "th"], ["fr", "ja"]),
  },
  {
    // One catalog. Every probe exhausts to the fallback, which is the shortest chain a lookup can
    // have and the cheapest way for a divergence in the FALLBACK tier to show up alone.
    name: "fallback-only",
    fallback: "fr",
    instance: "fr",
    tiebreakers: null,
    strings: catalogs(["fr"], ["fr"]),
  },
  {
    // The variant/region ladder, on the language whose chain carries the measured duplicate. Loading
    // `en-US-POSIX` puts a catalog AT the colliding member rather than past it.
    name: "en-ladder",
    fallback: "fr",
    instance: "fr",
    tiebreakers: { en: ["en", "en-US", "en-US-POSIX"] },
    strings: catalogs(["en", "en-US", "en-US-POSIX", "fr"], ["en", "fr"]),
  },
  {
    // Script and compatibility-extension territory: the two languages whose legacy variants Java's
    // OWN `forLanguageTag` decorates with a Unicode extension, plus a script pair.
    name: "cjk",
    fallback: "fr",
    instance: "fr",
    tiebreakers: { ja: ["ja", "ja-JP"], th: ["th", "th-TH"], zh: ["zh-Hans", "zh-Hant"] },
    strings: catalogs(["ja", "ja-JP", "th", "th-TH", "zh-Hans", "zh-Hant", "fr"], ["ja", "zh-Hant", "fr"]),
  },
  {
    // The exhausting set again, with a THROWING failure handler. Same catalogs, same chains, and a
    // different validation site at the end of the walk: `MissingTranslationException`'s constructor
    // instead of `TranslationResult`'s. Pairing it with the identical non-throwing set above is what
    // makes any divergence attributable to the handler rather than to the catalogs.
    name: "exhausts-throwing",
    fallback: "fr",
    instance: "fr",
    throwOnFailure: true,
    tiebreakers: null,
    strings: catalogs(["fr", "nb", "nn"], ["fr"]),
  },
  {
    // …and the ladder, whose chains reach the duplicate rather than the ill-formed member, so the
    // throwing handler is probed against BOTH of Java's refusals and not only one of them.
    name: "en-ladder-throwing",
    fallback: "fr",
    instance: "fr",
    throwOnFailure: true,
    tiebreakers: { en: ["en", "en-US", "en-US-POSIX"] },
    strings: catalogs(["en", "en-US", "en-US-POSIX", "fr"], ["en", "fr"]),
  },
  {
    // `DefaultStrings.java:248` / `Strings.java:211` — the FALLBACK locale. `en-x-lvariant-NY`
    // denotes the Java `Locale` `en__NY`, whose variant `NY` is 2 characters where BCP 47 wants 5-8
    // (or 4 with a leading digit), so `Locale.Builder#setLocale` will not take it back. Catalogs are
    // deliberately WELL-FORMED, so only the fallback site can fire.
    name: "illformed-fallback",
    fallback: "en-x-lvariant-NY",
    instance: "fr",
    refusedByJava: true,
    tiebreakers: null,
    strings: catalogs(["fr"], ["fr"]),
  },
  {
    // `DefaultStrings.java:276` — a CATALOG locale. The fallback is well-formed and matches a loaded
    // catalog, so the port cannot reach this refusal through its unrelated "no matching localized
    // strings locale" rule; the only thing wrong with this set is the second catalog's key.
    name: "illformed-catalog",
    fallback: "fr",
    instance: "fr",
    refusedByJava: true,
    tiebreakers: null,
    strings: catalogs(["fr", "en-x-lvariant-NY"], ["fr"]),
  },
  {
    // `DefaultStrings.java:347` — a TIEBREAKER locale, and it is a THIRD site rather than a
    // consequence of the second: every catalog here is well-formed and every one of them is named in
    // the tiebreaker list, so the permutation rule is satisfied and the ONLY refusal available is
    // the ill-formed extra member. Before the fix the port answered the unrelated missing-tiebreaker
    // diagnostic here, naming neither the offending locale nor the real mistake.
    name: "illformed-tiebreaker",
    fallback: "fr",
    instance: "fr",
    refusedByJava: true,
    tiebreakers: { en: ["en-x-lvariant-NY", "en", "en-US"] },
    strings: catalogs(["en", "en-US", "fr"], ["en", "fr"]),
  },
];

// ---------------------------------------------------------------------------------------------
// The probe space.
// ---------------------------------------------------------------------------------------------

/**
 * SYSTEMATICALLY GENERATED, not a list of the tags that are already known to be interesting. The
 * shape of the sections mirrors `tools/direct-tag-diff/`'s, deliberately: that probe space is the
 * one that found the two `normalizeTag` defects, and running the SAME shapes one layer down is how
 * this tool answers "is the tag layer's agreement enough?" rather than assuming it.
 *
 * @returns {string[]}
 */
function probes() {
  /** @type {Set<string>} */
  const set = new Set();

  // (1) Every locale tag the corpus actually spells. The overlap with `npm run conformance` is the
  // point: a disagreement here and a conformance FAILED are the same defect seen twice, and a
  // disagreement here on a tag the corpus DOES spell would mean the runner is not comparing it.
  const corpus = JSON.parse(readFileSync(join(specDir, "generated/behavioral-vectors.json"), "utf8"));
  for (const fixture of Object.values(corpus.fixtures)) {
    for (const tag of Object.keys(/** @type {any} */ (fixture).files ?? {})) set.add(tag);
    for (const tag of [/** @type {any} */ (fixture).fallbackLocale, /** @type {any} */ (fixture).instanceLocale])
      if (typeof tag === "string") set.add(tag);
  }
  for (const testCase of corpus.cases)
    for (const field of ["locale", "lookupLocale"])
      if (typeof testCase.input?.[field] === "string") set.add(testCase.input[field]);

  // (2) THE `x-lvariant` CARRIER CROSS PRODUCT. `forLanguageTag` reads a private-use subtag
  // beginning `lvariant-` as the carrier for a Java `Locale` variant that BCP 47 has no slot for.
  // Crossing the carriers against the bases is what turns three known-bad tags into a CLASS: the
  // three measured refusals are members of this product, and so is everything shaped like them.
  const bases = ["en", "en-US", "en-Latn-US", "ja", "ja-JP", "ja-Latn-JP", "th", "th-TH", "no",
    "no-NO", "nn-NO", "nb-NO", "de-DE", "fr-FR", "zh-Hant-TW", "und"];
  const carriers = ["POSIX", "posix", "NY", "ny", "JP", "jp", "TH", "th", "1901", "valencia",
    "VALENCIA", "A-B", "lvariant-POSIX"];
  for (const base of bases) {
    set.add(base);
    for (const carrier of carriers) set.add(`${base}-x-lvariant-${carrier}`);
    // The marker is not required to be the first private-use subtag, and what precedes it stays
    // private use. A port that scans for `x-lvariant` rather than for the marker POSITION gets these
    // wrong while getting every tag above right.
    set.add(`${base}-x-a-lvariant-POSIX`);
    set.add(`${base}-x-lvariant`);
  }

  // (3) THE PLAIN GRID: language x script x region, over subtag values each of which the
  // canonicalization walk treats specially — CLDR-aliased legacy languages (`iw`, `in`, `ji`, `mo`,
  // `sh`, `tl`), extlang carriers (`cmn`, `yue`), the undetermined language, a private-use primary,
  // macro and numeric regions, and the private-use script range.
  const languages = ["en", "fr", "de", "ja", "th", "zh", "no", "nb", "nn", "sr", "sh", "iw", "he",
    "in", "id", "ji", "yi", "tl", "fil", "mo", "ro", "cmn", "yue", "und", "qaa"];
  const scripts = ["Latn", "Cyrl", "Hans", "Hant", "Qaaa"];
  const regions = ["US", "GB", "CN", "TW", "NO", "419", "001", "ZZ"];
  for (const language of languages) {
    set.add(language);
    for (const script of scripts) {
      set.add(`${language}-${script}`);
      for (const region of regions) set.add(`${language}-${script}-${region}`);
    }
    for (const region of regions) {
      set.add(`${language}-${region}`);
      set.add(`${language}-${region}-POSIX`);
      set.add(`${language}-${region}-1901`);
    }
  }

  // (4) THE LEGACY (grandfathered) TAGS, which `forLanguageTag` rewrites wholesale — several of them
  // into a DIFFERENT language, and therefore into a different catalog.
  for (const tag of ["i-klingon", "i-navajo", "i-default", "i-enochian", "art-lojban",
    "cel-gaulish", "no-bok", "no-nyn", "zh-guoyu", "zh-hakka", "zh-min", "zh-min-nan", "zh-xiang",
    "en-GB-oed", "sgn-BE-FR", "sgn-US", "zh-cmn", "zh-cmn-Hans-CN", "zh-yue", "zh-nan"])
    set.add(tag);

  // (5) EXTENSIONS AND PRIVATE USE: the `u`/`t`/`a` singletons including the two the compatibility
  // synthesis produces, keyword ordering (a `-u-` payload is a SET and a MAP, so two spellings are
  // ONE locale), and private use with and without a language.
  for (const tag of ["en-u-ca-buddhist", "en-US-u-ca-gregory-nu-latn", "en-US-u-nu-latn-ca-gregory",
    "ja-JP-u-ca-japanese", "th-TH-u-nu-thai", "en-US-u-va-posix", "en-t-jp", "en-US-t-en-latn",
    "en-a-bbb-x-a-ccc", "en-x-private", "x-private", "en-US-x-a", "en-Latn-US-u-ca-gregory-x-a",
    "ja-JP-u-ca-japanese-x-lvariant-JP", "ja-JP-u-ca-japanese-x-lvariant-jp",
    "th-TH-u-nu-thai-x-lvariant-TH", "th-TH-u-nu-thai-x-lvariant-th",
    // (5b) `und` BESIDE PRIVATE USE, in every casing. This family is why the tool paid for itself
    // on its first run and it is worth stating why no earlier probe space contained it:
    // `InternalLocaleBuilder.setLanguageTag` compares the parsed primary language against the
    // constant `"und"` with `equals`, NOT `equalsIgnoreCase`, so `und-x-a` is language-less and
    // renders `x-a` while `UND-x-a` keeps `und` and renders `und-x-a`. The distinction is invisible
    // unless the ONLY other content is private use, because any script, region or variant makes
    // `toLanguageTag` re-emit `und` regardless — so `tools/direct-tag-diff/`'s language x script x
    // region sweep could not reach it, and its private-use section never crossed `und`. MEASURED on
    // the pinned Corretto 21; the port answered `x-a` for both spellings and now answers Java's.
    "und-x-a", "UND-x-a", "und-X-A", "UND-X-A", "Und-x-a", "uND-x-a",
    "und-x-private", "UND-X-PRIVATE", "und-x-lvariant", "UND-X-LVARIANT",
    "und-x-lvariant-NY", "UND-X-LVARIANT-NY", "und-x-lvariant-POSIX", "UND-X-LVARIANT-POSIX",
    // The controls that keep the family from being read as "the port must always keep `und`": with
    // a script, a region or an extlang, both spellings agree and always did.
    "und-Latn-x-a", "UND-LATN-X-A", "und-US-x-a", "UND-US-X-A", "zh-und", "zh-UND", "und", "UND"])
    set.add(tag);

  // (6) CASE, applied to everything generated so far. `toLanguageTag` normalizes case per position
  // except in the VARIANT, which is preserved — and that asymmetry is what makes
  // `[en-US-POSIX, …, en-US-posix]` a duplicate-tag refusal rather than an ordinary chain.
  for (const tag of [...set])
    if (/^[A-Za-z0-9-]+$/.test(tag)) {
      set.add(tag.toUpperCase());
      set.add(tag.toLowerCase());
    }

  // (7) THE ILL-FORMED CLASSES, present ON PURPOSE and compared under the separate contract below.
  // Their job is to keep the well-formed verdict honest: a probe space of only well-formed tags
  // cannot tell "the port agrees with Java" from "the port accepts everything Java accepts and a
  // great deal more". Note that the three legacy Java-6 spellings live HERE — `ja-JP-JP`,
  // `th-TH-TH` and `no-NO-NY` are ill-formed BCP 47, which is why the well-formed probes above have
  // to reach the same locales through the `x-lvariant` carrier.
  for (const tag of ["", " ", "-", "--", "en-", "-en", "en--US", "en-US-", "e", "toolongtag",
    "no-NO-NY", "ja-JP-JP", "th-TH-TH", "en_US", "en US", "en-*", "*", "1", "en-123456789",
    "readme.txt", "de-de.json", "zh-min-nan.json", "en-US,en", "fr;q=0.5", "en-Latin-US",
    "中文", "fr-é", "zh-\u{10400}"])
    set.add(tag);

  return [...set];
}

// ---------------------------------------------------------------------------------------------
// The two comparison contracts.
// ---------------------------------------------------------------------------------------------

/**
 * Java error class -> the JS error names this port is allowed to answer with.
 *
 * A LOCAL COPY OF `tools/conformance.mjs`'s `ERROR_NAME`, restricted to the rows a lookup can
 * actually raise, and it is a copy ON PURPOSE. Importing the runner's table would make a widening
 * there — which 34 unrelated conformance rows depend on — silently widen this differential too, and
 * a shared row is how one gate stops noticing that the other changed. The same reasoning
 * `conformance.mjs` itself gives for keeping `RESOLVER_THREW` separate from `ERROR_NAME`.
 *
 * WIDENING THIS TABLE IS NOT A WAY TO SETTLE A MISMATCH. An entry added here weakens the comparison
 * for every probe at once.
 *
 * @type {Record<string, string[]>}
 */
const ERROR_NAME = {
  "java.lang.IllegalArgumentException": ["TypeError", "RangeError"],
  "java.lang.NullPointerException": ["TypeError"],
  "com.lokalized.MissingTranslationException": ["MissingTranslationError"],
  "com.lokalized.UnsupportedLocaleException": ["UnsupportedLocaleError"],
};

/**
 * How many rows of any one bucket the report prints before it summarizes the rest.
 *
 * A cap rather than everything, because a fresh divergence CLASS can be thousands of rows wide — the
 * first run of this tool printed 2,210 — and a report nobody can read is a report nobody reads. The
 * COUNT is always exact; only the listing is capped.
 */
const SHOW = 8;

/**
 * DIVERGENCES THAT ARE DELIBERATE AND CORRECT, and MEASURED PORT DEFECTS, in one table keyed by rule
 * rather than by tag.
 *
 * TWO KINDS, and the distinction is the same one `tools/direct-tag-diff/` draws between
 * `KNOWN_DIVERGENCES` and `OPEN_PORT_DEFECTS`:
 *
 *   - a rule WITHOUT `defect` is a divergence the port makes ON PURPOSE. It does not fail the run.
 *     Adding one needs a Java-source or JDK-measured argument for why the port is RIGHT to differ;
 *     "the differential goes green" is not one.
 *   - a rule WITH `defect: true` is a triaged PORT DEFECT: the port is wrong, the cause is known,
 *     and the fix is not made here. It does NOT excuse anything — the run exits non-zero while it
 *     stands. It exists so the failure prints its own root cause instead of arriving as thousands of
 *     anonymous mismatches, and so a reviewer can tell a triaged defect from a fresh regression.
 *
 * WHY RULES AND NOT TAG KEYS. `tools/direct-tag-diff/` keys its table by exact tag, which works
 * there because the tag IS the whole input. Here the input is a (catalog set, tag, key, ingress)
 * quadruple and the probe space grows whenever a section gains an edge, so an exact-key table would
 * need a new entry for every new probe carrying an ALREADY-EXPLAINED shape — and the pressure would
 * be to widen the shape rather than add the row. A rule is checked against BOTH recorded outcomes,
 * so it can only absorb the pair it actually describes.
 *
 * THE STALENESS GATE is the one every table in this repository has, and it is what stops this
 * becoming a list of excuses: a rule that explains NOTHING on a run fails the run. Each rule also
 * prints its consumed rows, so a reviewer can see how wide it really is instead of trusting prose.
 *
 * @typedef {{set: string, tag: string, key: string, ingress: string, java: string[], js: string[]}} DiffRow
 * @type {{id: string, why: string, defect?: true, matches: (row: DiffRow) => boolean}[]}
 */
/**
 * JAVA'S `requireWellFormed` DESCRIPTION -> THE PORT'S, for the four sites a lookup or a matcher can
 * reach. CLOSED and EXACT, in both directions: a Java description absent from the left-hand side
 * explains nothing, and a port description that is not the mapped value explains nothing either, so
 * a port refusing at the WRONG site can never be absorbed as a naming difference.
 *
 * THREE OF THE FOUR ARE IDENTITIES, and that is the maintainer's rule rather than a coincidence.
 * The rule is "Java's SHAPE with the JS name substituted"; `Locale override`, `Requested locale` and
 * `Attempted locale` contain no Java identifier to substitute, so they are reproduced verbatim. Only
 * `localeSupplier result` names one, and this port's name for that callback is `localeResolver` —
 * the same substitution that already produces `localeResolver returned null` where Java says
 * `localeSupplier returned null`, which is the precedent M7-STATUS's decision 1 set.
 *
 * `Instance locale` is deliberately NOT here. It is the port's phrase for `createStrings({ locale
 * })`, a surface `Strings.Builder` has no setter for, so no Java row can ever carry it and putting
 * it in this map would create an entry nothing could match. `src/internal/locale-jdk-tag.js`'s
 * `LOCALE_INGRESS_DESCRIPTION` carries that reasoning; `test/requested-locale-refusal.test.js` is
 * what pins the phrase.
 *
 * @type {Record<string, string>}
 */
const DESCRIPTIONS = {
  "Locale override": "Locale override",
  "localeSupplier result": "localeResolver result",
  "Requested locale": "Requested locale",
  "Attempted locale": "Attempted locale",
  // CONSTRUCTION (`Strings.java:211` / `DefaultStrings.java:248`, `:276`, `:347`) and INSPECTION
  // (`:2713`, `:2735`, `:2736`). Six more Java sites, none of which a LOOKUP can reach, and all six
  // identities: not one of them contains a Java identifier to substitute, so the maintainer's rule
  // — Java's SHAPE with the JS name substituted — has nothing to substitute and reproduces them
  // verbatim. They are here rather than absent because this map is CLOSED in both directions: a
  // refusal carrying a description this map does not know explains nothing, which is what stops a
  // port refusing at the wrong site from reading as a naming difference.
  "Fallback locale": "Fallback locale",
  "Localized strings locale": "Localized strings locale",
  "Tiebreaker locale": "Tiebreaker locale",
  "Locale": "Locale",
  "Source locale": "Source locale",
  "Target locale": "Target locale",
};

const KNOWN_DIVERGENCES = [
  {
    id: "requireWellFormed-names-a-Locale-toString",
    why:
      "Java's `LocaleUtils.requireWellFormed` diagnostic (LocaleUtils.java:53-64) names the " +
      "offending locale with `Locale#toString` — `ja_JP_jp_#u-ca-japanese`, `en__NY`, and the EMPTY " +
      "STRING for a locale with neither language nor country — a representation that does not exist " +
      "in JavaScript and that this port would have to invent for one diagnostic. The port names the " +
      "same locale by its BCP 47 tag, which is the only spelling it speaks. EVERY OTHER CHANNEL " +
      "AGREES: the same refusal, raised at the same SITE, with the same error class, the same " +
      "sentence around the quoted name, and the same description under `DESCRIPTIONS` below. " +
      "\n\n  IT COVERS EVERY SITE THIS TOOL DRIVES, which is TEN and no longer four. It said four " +
      "while the run had grown a construction axis and four inspection shapes around it, and its " +
      "own by-ingress histogram was already showing it consuming rows at eight ingresses — the " +
      "count in the prose is what a reviewer reads to judge whether the rule is too wide, so a " +
      "stale one is worse here than elsewhere. The four on the lookup/matcher axis are `Locale " +
      "override` (TranslationOptions.java:73/310), `localeSupplier result` " +
      "(DefaultStrings.java:2457), `Requested locale` (LocaleMatcher.java:64) and the walk's own " +
      "synthesized `Attempted locale` (TranslationResult.java:116, " +
      "MissingTranslationException.java:153); three more are at CONSTRUCTION " +
      "(DefaultStrings.java:248, :276, :347) and three at INSPECTION (:2713, :2735, :2736). " +
      "\n\n  WHAT KEEPS THE RULE NARROW IS NOT THIS PARAGRAPH BUT `DESCRIPTIONS`, which is a CLOSED " +
      "map in both directions: a refusal carrying a description the map does not know explains " +
      "nothing, so a port refusing at the WRONG SITE can never read as a naming difference. The " +
      "port implements all ten, at the same points, and the ONLY remaining difference at any of " +
      "them is how the locale is spelled. Recorded in `src/internal/locale-jdk-tag.js`'s " +
      "`requireJdkWellFormedLocale` and `LOCALE_INGRESS_DESCRIPTION`, and pinned by " +
      "`test/attempted-locale-refusal.test.js`, `test/requested-locale-refusal.test.js`, " +
      "`test/construction-ingress.test.js` and `test/inspection.test.js`. Two FURTHER Java sites — " +
      "`LocaleMatchResult.java:97` and `:117` — are caller-facing through a public constructor and " +
      "are NOT in this map, because no shape here can reach them; see the header.",
    matches: (row) => {
      if (row.java[0] !== "THROWN" || row.js[0] !== "THROWN") return false;

      // The sentence is `<description> '<name>' is not a well-formed IETF BCP 47 locale`, and the
      // DESCRIPTION must match under the closed map below: the four are four different Java call
      // sites, and a port refusing at the wrong one is not explained by a naming difference.
      const shape = /^(.+) '(.*)' is not a well-formed IETF BCP 47 locale$/;
      const java = shape.exec(row.java[2]);
      const js = shape.exec(row.js[2]);
      if (java === null || js === null || DESCRIPTIONS[java[1]] !== js[1]) return false;

      // A BCP 47 tag carries no `_`, so the port can never be spelling a `Locale#toString`.
      if (/_/.test(js[2])) return false;

      // Java's name is a `Locale#toString`: underscore-separated, with `_#` before any extension —
      // or, for the degenerate locales whose language and country are both empty (`und-x-lvariant-NY`
      // exactly), the EMPTY STRING, which `Locale#toString` is documented to return and which quotes
      // nothing at all. Measured on the pinned JDK: `Locale override '' is not a well-formed …`.
      if (java[2] !== "" && !/_/.test(java[2])) return false;

      // …and the port's name must be the SAME LOCALE, spelled the other way. A port that refused a
      // DIFFERENT candidate is not explained by this rule.
      if (java[2] !== "" && sameLocaleSpelledTwoWays(java[2], js[2])) return true;

      // The identity check Java's empty spelling cannot support, and the one the port's `und`-prefixed
      // tags need: the port must be naming a locale it actually holds at that site — the normalized
      // LOOKUP LOCALE at the three ingresses, or the CHAIN SEED at the walk's own site. Both consult
      // `normalizeTag`, part of what this differential tests, accepted for the reason recorded at
      // `chainSeedOrNull`: the alternative is no identity check at all on these rows, and the tag
      // layer of these very probes is compared row by row by `npm run diff:direct-tag`.
      return js[2] === lookupLocaleOrNull(row.tag) || js[2] === chainSeedOrNull(row.tag);
    },
  },
  {
    id: "inspection-unsupported-locale-follows-plan-3.3",
    why:
      "THE INSPECTION SUPPORT REFUSAL, and it is a MAINTAINER DECISION rather than an accident — " +
      "M7-STATUS.md's decision 3, made on 2026-09-06. Java raises `IllegalArgumentException` with " +
      "`Locale '<tag>' is not supported` (DefaultStrings.java:2718, :2739, :2742); plan 3.3:771 " +
      "names `UnsupportedLocaleError` and its sentence for the JS surface, and it was deliberately " +
      "NOT settled by widening `tools/conformance.mjs`'s shared `IllegalArgumentException` row, " +
      "which would have cost 34 unrelated comparisons their discrimination." +
      "\n\n  WHAT THIS RULE DOES NOT RELAX. The QUOTED LOCALE must be byte-identical on both " +
      "sides: Java's three messages quote `Locale#toLanguageTag`, not `Locale#toString`, so there " +
      "is no spelling difference here to forgive and none is forgiven — a port naming a different " +
      "locale than Java is unexplained, and that is what discriminates the ROLE — but by PROXY, " +
      "not directly, and the distinction is worth stating exactly because an earlier draft of this " +
      "paragraph overclaimed it. Java says `Source locale` or `Target locale` where the argument's " +
      "position matters; `matches` below compares only the QUOTED LOCALE, so what the rule requires " +
      "is that both sides refused about the SAME QUOTED LOCALE. In the `missingInto` shape the " +
      "source is the constant `de` and the target is the probe tag, so the two locales differ and a " +
      "port that answered about the source where Java answered about the target is unexplained — " +
      "EXCEPT on the single row where the probe tag IS `de`, where both roles name one locale and a " +
      "role swap would be absorbed. One row out of the shape's sweep; named rather than papered " +
      "over. What the rule forgives is exactly the class and the sentence the plan chose." +
      "\n\n  A KNOWN LOSS, recorded rather than hidden: the port's sentence does not say WHICH " +
      "of `getMissingKeys`'s two arguments was unsupported, where Java's does. That is a property " +
      "of the plan's single-argument `UnsupportedLocaleError`, is unchanged by this batch, and is " +
      "worth a maintainer's attention on its own.",
    matches: (row) => {
      if (row.java[0] !== "THROWN" || row.js[0] !== "THROWN") return false;
      if (row.java[1] !== "java.lang.IllegalArgumentException") return false;
      if (row.js[1] !== "UnsupportedLocaleError") return false;

      const java = /^(?:Locale|Source locale|Target locale) '(.*)' is not supported$/.exec(row.java[2]);
      const js = /^Unsupported locale '(.*)' was provided$/.exec(row.js[2]);
      return java !== null && js !== null && java[1] === js[1];
    },
  },
];

/**
 * Is `javaToString` (a `Locale#toString`) the same locale as `bcp47` (a language tag)?
 *
 * `Locale#toString` is `language_REGION_variant#extensions`; a BCP 47 tag is `-`-separated, with the
 * variant lifted behind `x-lvariant` when the grammar has no slot for it and the extensions in
 * sorted position. Rather than model either grammar — this differential must not grow a second
 * implementation of the thing it is testing — both spellings are reduced to a lowercased sorted
 * MULTISET of their subtags, dropping the `x` / `lvariant` / `u` markers Java's form has no
 * counterpart for.
 *
 * Two DIFFERENT candidates of one chain cannot collide under this reduction, because the candidates
 * in a chain differ in subtags rather than only in punctuation.
 *
 * @param {string} javaToString
 * @param {string} bcp47
 */
function sameLocaleSpelledTwoWays(javaToString, bcp47) {
  const reduce = (/** @type {string} */ value) =>
    value
      .toLowerCase()
      .split(/[-_#]+/)
      .filter((part) => part !== "" && part !== "x" && part !== "lvariant" && part !== "u")
      .sort()
      .join(" ");
  return reduce(javaToString) === reduce(bcp47);
}

/**
 * The first member of the port's candidate chain for a probe tag, or null if the tag is refused.
 *
 * `normalizeTag` applied to its OWN OUTPUT, because that is what the walk does: the ingress
 * normalizes the caller's tag into the lookup locale, and `candidateChain` normalizes the lookup
 * locale again on the way to the chain's seed. The two disagree for exactly one family — a
 * non-lowercase `und` followed only by private use — and Java's own chain does the same thing there,
 * measured. See the one call site.
 *
 * @param {string} tag
 */
function chainSeedOrNull(tag) {
  try {
    return normalizeTag(normalizeTag(tag));
  } catch {
    return null;
  }
}

/**
 * The LOOKUP LOCALE the port derives from a probe tag, or null if the tag is refused outright.
 *
 * `normalizeTag` applied ONCE, which is what the three INGRESS sites name: they validate the locale
 * the caller's tag denotes, before the chain exists. It differs from `chainSeedOrNull` for exactly
 * one family — a non-lowercase `und` followed only by private use — and that difference is why the
 * two are separate functions rather than one with a flag.
 *
 * @param {string} tag
 */
function lookupLocaleOrNull(tag) {
  try {
    return normalizeTag(tag);
  } catch {
    return null;
  }
}

/** The subset of the table that FAILS the run. Derived, so the two can never disagree. */
const OPEN_PORT_DEFECTS = KNOWN_DIVERGENCES.filter((rule) => rule.defect === true);

/**
 * THE ILL-FORMED CONTRACT, decided at M7 close and restated here in the terms a LOOKUP sees.
 *
 * `Locale.forLanguageTag` truncates at the first ill-formed subtag, so Java answers a lookup for
 * `readme.txt` from the `und` chain; `createStrings(...).get(key, …, { locale })` raises a
 * `RangeError` at its validation boundary, which is what plan §2.2 and §3.3 require ("Malformed
 * direct input fails at its validation boundary before candidate resolution"). The full argument,
 * both readings of the trade, and the two limits on the decision are in
 * `tools/direct-tag-diff/run.mjs`'s `ILL_FORMED_CONTRACT` and are not restated here.
 *
 * WHAT THIS RUN GATES, in both directions and neither of them a count: the bucket must not go EMPTY
 * (an empty bucket means the probe space stopped covering the class and every claim about it would
 * be vacuous) and the port must REFUSE every member. The NUMBER is a floor, not a ratchet.
 */
const ILL_FORMED_CONTRACT =
  "Java TRUNCATES an ill-formed tag and serves whatever prefix parsed; the port refuses at its " +
  "validation boundary, per plan §2.2/§3.3. Decided at M7 close, unchanged, and gated in both " +
  "directions here. See ILL_FORMED_CONTRACT in tools/direct-tag-diff/run.mjs for the argument.";

// ---------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------

/** @param {string} value */
const base64 = (value) => Buffer.from(value, "utf8").toString("base64");

/**
 * The cross of key and ingress, in the order `LookupDiff.java` emits its four outcomes per probe.
 * Changing this order without changing the oracle's would silently compare an ambient outcome
 * against a per-call one, so the two lists are written to be read side by side.
 */
const PROBE_SHAPES = [
  { key: "Hello", viaAmbient: false },
  { key: "Hello", viaAmbient: true },
  { key: "Only", viaAmbient: false },
  { key: "Only", viaAmbient: true },
  // `Absent` is in NO catalog, so the walk exhausts every candidate including the fallback. It is
  // what makes the throwing catalog sets discriminate: with only the two answerable keys, adding
  // them moved the unexplained count by ZERO — the fallback catalog always answered and
  // `throwForFailure` was never entered. See `LookupDiff.java`'s `KEY_ABSENT`.
  { key: "Absent", viaAmbient: false },
  { key: "Absent", viaAmbient: true },
  // THE MATCHER INGRESS — `LocaleMatcher#matchFor(Locale)`, Java's THIRD lookup-reachable
  // `requireWellFormed` site (`LocaleMatcher.java:64`, "Requested locale"). It performs no lookup,
  // so it takes no key and `key` is a label rather than an input. See `LookupDiff.java`'s `matcher`
  // for why it lives in THIS tool, and `matcherJs` below for the port surface it drives.
  { key: "-", matcher: true },
  // THE INSPECTION INGRESS — `DefaultStrings.java:2713` ("Locale"), `:2735` ("Source locale") and
  // `:2736` ("Target locale"). FOUR shapes rather than one because the three Java statements ask
  // different questions and the last two ask about ORDER: see `LookupDiff.java`'s `keysFor`,
  // `missingFrom`, `missingInto` and `missingSourceFirst`, and `inspectionJs` below. This list is
  // the only authority on the count — three other texts said "three" after `missingSourceFirst`
  // landed, and all three are corrected as of 2026-09-09.
  { key: "-", inspect: /** @type {const} */ ("keys") },
  { key: "-", inspect: /** @type {const} */ ("missingFrom") },
  { key: "-", inspect: /** @type {const} */ ("missingInto") },
  { key: "-", inspect: /** @type {const} */ ("missingSourceFirst") },
];

/**
 * The well-formed, UNSUPPORTED source of the ordering probe. Must equal `LookupDiff.UNSUPPORTED_PROBE`
 * and must name a locale NO catalog set loads, or the shape stops being an ordering probe.
 */
const UNSUPPORTED_PROBE = "de";

/**
 * The ILL-FORMED target of the source-first probe. Must equal `LookupDiff.ILL_FORMED_PROBE`.
 *
 * ADDED AFTER AN ABLATION FOUND THE HOLE: deleting the port's `Source locale` pre-check left this
 * differential GREEN while `test/inspection.test.js` went red, because no shape here passed TWO
 * ill-formed locales at once and the surviving `keysForExactLocale` validation still named the
 * source correctly on every one-sided input. A gate that a measured ablation walks through is not a
 * gate, so the shape was added rather than the hole recorded.
 */
const ILL_FORMED_PROBE = "de-x-lvariant-XX";

/**
 * The port's side of one lookup, in the SAME six fields `LookupDiff.java` prints.
 *
 * @param {any} strings
 * @param {string} key
 * @param {string} tag
 * @param {boolean} viaAmbient false for the per-call ingress; true when the caller has already armed
 *   the mutable cell this instance's `localeResolver` reads, in which case the lookup takes NO
 *   options at all — the only way to reach the ambient validation site.
 * @returns {string[]}
 */
function lookupJs(strings, key, tag, viaAmbient) {
  try {
    const result = viaAmbient
      ? strings.getResult(key)
      : strings.getResult(key, undefined, { locale: tag });
    return [
      String(result.status).replace(/-/g, "_").toUpperCase(),
      flatten(result.translation),
      result.resolvedLocale ?? "-",
      result.attemptedLocales.length === 0 ? "-" : result.attemptedLocales.join(","),
      result.failureReason == null ? "-" : String(result.failureReason).replace(/-/g, "_").toUpperCase(),
      String(result.isFallback),
    ];
  } catch (error) {
    const raised = /** @type {Error} */ (error);
    return ["THROWN", raised?.name ?? "?", flatten(raised?.message ?? String(error)), "-", "-", "-"];
  }
}

/**
 * The port's side of the MATCHER ingress, in the SAME six fields `LookupDiff.java`'s `matcher`
 * prints.
 *
 * `getDirectLocaleContext` and not the standalone negotiator's `matchFor`, for one reason: plan v7
 * section 3.3 names it the counterpart of `Strings#matchFor(Locale)`, `tools/conformance.mjs`'s
 * `matchForCase` drives all 301 corpus `matchFor` rows through it, and it reads THIS instance's own
 * configuration — the same one the two lookup ingresses above use — so a divergence here cannot be
 * an artifact of a differently-configured negotiator. `createLocaleNegotiator`'s two locale doors
 * carry the identical check on the identical helper and are pinned by
 * `test/requested-locale-refusal.test.js` instead, because reaching them from here would need a
 * second configuration and would compare a different object.
 *
 * @param {any} strings
 * @param {string} tag
 * @returns {string[]}
 */
function matcherJs(strings, tag) {
  try {
    const match = strings.getDirectLocaleContext(tag).localeMatch;
    return [
      "MATCH",
      match.locale ?? "-",
      // The winning range travels as a `{ range, weight }` PAIR in this port and as a bare string
      // from a caller — `LocaleMatch#languageRange` accepts both — while Java's field is a
      // `LanguageRange` whose `getRange()` is the string. Only the range is compared here; the
      // weight it carries is `effectiveWeight`, deliberately outside these six fields (see
      // `LookupDiff.java`'s `matcher`).
      typeof match.languageRange === "string"
        ? match.languageRange
        : match.languageRange?.range ?? "-",
      String(match.matchType).replace(/-/g, "_").toUpperCase(),
      String(match.isMatch),
      match.requestedLanguageRanges.length === 0
        ? "-"
        : match.requestedLanguageRanges.map((/** @type {{range: string}} */ member) => member.range).join(","),
    ];
  } catch (error) {
    const raised = /** @type {Error} */ (error);
    return ["THROWN", raised?.name ?? "?", flatten(raised?.message ?? String(error)), "-", "-", "-"];
  }
}

/**
 * The port's side of the INSPECTION ingress, in the SAME six fields `LookupDiff.java`'s `keysFor`,
 * `missingFrom` and `missingInto` print.
 *
 * THE SURFACE IT DRIVES IS THE PUBLIC ONE — `getKeysForLocale` and `getMissingKeys` on the very
 * instance the lookup and matcher shapes use, so a divergence cannot be an artifact of a differently
 * configured object. Java's members take a `Locale` and the port's take a tag; that is the whole
 * adaptation, and `npm run diff:direct-tag` is what licenses treating the two as the same input.
 *
 * @param {any} strings
 * @param {string} tag
 * @param {"keys" | "missingFrom" | "missingInto" | "missingSourceFirst"} kind
 * @param {string} fallback the catalog set's own fallback locale — a locale every set loads, so in
 *   `missingFrom` the TARGET half can never be what refuses
 * @returns {string[]}
 */
function inspectionJs(strings, tag, kind, fallback) {
  const pad = ["-", "-", "-", "-"];
  /** @param {string[]} keys */
  const join = (keys) => (keys.length === 0 ? "-" : keys.join(","));
  try {
    if (kind === "keys") return ["KEYS", join(strings.getKeysForLocale(tag)), ...pad];
    if (kind === "missingFrom") return ["MISSING", join(strings.getMissingKeys(tag, fallback)), ...pad];
    if (kind === "missingInto") return ["MISSING", join(strings.getMissingKeys(UNSUPPORTED_PROBE, tag)), ...pad];
    return ["MISSING", join(strings.getMissingKeys(tag, ILL_FORMED_PROBE)), ...pad];
  } catch (error) {
    const raised = /** @type {Error} */ (error);
    return ["THROWN", raised?.name ?? "?", flatten(raised?.message ?? String(error)), "-", "-", "-"];
  }
}

/** @param {unknown} value */
const flatten = (value) =>
  String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

/**
 * THE PORT'S CALL TRACE for the probe currently running — the `fallbackPolicy` consultations and
 * the `onFailure` invocation, in order, in `LookupDiff.java`'s `TRACE` encoding.
 *
 * One array for the whole run rather than one per set, cleared immediately before each probe by the
 * loop. The clear is what makes an EMPTY trace an observation rather than an accident: `calls=[]` is
 * the evidence that an ingress check fired before the walk started, so a probe that inherits the
 * previous probe's entries would report the opposite of what happened.
 *
 * @type {string[]}
 */
const jsTrace = [];

/**
 * A port `FailureReason` in the spelling Java's `TranslationFailureReason` enum prints.
 *
 * The SAME adaptation `lookupJs` already makes for `status` and `failureReason` — `-` to `_`,
 * uppercased — and not a second dialect. `missing-translation` is `MISSING_TRANSLATION`.
 *
 * @param {string} reason
 */
const javaReason = (reason) => reason.replace(/-/g, "_").toUpperCase();

/**
 * The class of a trace entry's cause, or `-`.
 *
 * The port's side of the one field in a trace entry that has a language boundary in it: Java sends
 * a fully-qualified class name and this sends an `Error#name`, and `traceAgrees` maps between them
 * with the SAME `ERROR_NAME` table a thrown outcome's class uses. A non-Error cause — a policy can
 * be handed anything a `render` threw — reports its `typeof`, so it can still never accidentally
 * equal a Java class name.
 *
 * @param {unknown} cause
 */
function causeClass(cause) {
  if (cause == null) return "-";
  if (cause instanceof Error) return cause.name;
  return `non-error:${typeof cause}`;
}

/**
 * Do the two six-field OUTCOMES agree? The trace is NOT compared here — see `traceAgrees`.
 *
 * The ONLY adaptation is the error class, which JavaScript cannot spell Java's way. Everything else
 * — status, rendered string, supplying locale, the whole attempted-locale list, failure reason,
 * fallback flag, and the refusal MESSAGE — is compared verbatim.
 *
 * THE MATCHER SHAPE'S SIX FIELDS ARE DIFFERENT SIX FIELDS — marker, selected locale, winning range,
 * match type, matched flag, requested ranges — and `agree` compares them the same way, position by
 * position, because both sides emit them in the same order. See `LookupDiff.java`'s `matcher` and
 * `matcherJs`.
 *
 * @param {string[]} java
 * @param {string[]} js
 */
function agreeOnOutcome(java, js) {
  if (java[0] === "THROWN" || js[0] === "THROWN") {
    if (java[0] !== js[0]) return false;
    const permitted = ERROR_NAME[java[1]];
    if (permitted === undefined || !permitted.includes(js[1])) return false;
    return java[2] === js[2];
  }
  return OUTCOME_FIELDS.every((index) => java[index] === js[index]);
}

/** The six OUTCOME fields of a row; field 6 is the trace and is compared by `traceAgrees`. */
const OUTCOME_FIELDS = [0, 1, 2, 3, 4, 5];

/** The index of the CALL TRACE within a row's fields, on both sides. */
const TRACE_FIELD = 6;

/**
 * Do the two CALL TRACES agree — the `fallbackPolicy` consultations and the `onFailure` invocation,
 * in order, with their reasons, locales, attempted lists and causes?
 *
 * WHY THIS FUNCTION EXISTS, and it is not a refinement of `agreeOnOutcome`. Six outcome fields are
 * an OUTCOME, and two libraries can reach one outcome by running two different walks. That is how
 * the ingress defect hid: for `en-x-lvariant-NY` Java records `calls=[]` because
 * `TranslationOptions.Builder#locale` refuses before the walk is ever entered, while the port ran a
 * whole walk with five callback invocations and refused from inside it. Both refused, both raised
 * the mapped class, both carried the same sentence around the same description — and this tool
 * reported 0 unexplained. The walk was observable and nothing observed it. This file's own docblock
 * carried that as a NAMED gap ("a port matching Java's outcome while running a different walk would
 * show 0 unexplained") rather than as an assumption, which is the only reason it was cheap to close.
 *
 * THE COMPARISON IS SYMMETRIC AND HAS NO DEFAULTS. Entry counts must match, entry arities must
 * match, and every field is compared verbatim EXCEPT the last one of each entry — the cause class,
 * which JavaScript cannot spell Java's way and which travels through the SAME `ERROR_NAME` table a
 * thrown outcome's class does. There is no `?? expected`, no short-circuit on an empty side, and no
 * one-sided field: an absent cause is the literal `-` on both sides and `-` matches only `-`. A
 * missing trace on either side is a length mismatch, which is a disagreement.
 *
 * WHAT MAKES IT A REAL OBSERVATION RATHER THAN AN ARTIFACT. `LookupDiff.java` installs a policy
 * that answers exactly what `fallbackOnMissingTranslationOrNoMatchingAlternative()` answers and a
 * handler that answers exactly what `returnKey()` answers — the two defaults `DefaultStrings:472-475`
 * installs when neither is supplied — and this file installs their port counterparts on the same
 * terms. Both sides are observed, neither is steered: every outcome field both sides emitted before
 * the callbacks existed is unchanged, measured by running the differential across the change.
 *
 * A DIVERGENCE RULE CANNOT ABSORB A TRACE DIFFERENCE. `KNOWN_DIVERGENCES` is consulted only for
 * rows whose traces already agree, so a rule written about a DIAGNOSTIC can never quietly explain
 * away a different WALK. That is deliberate: every rule in the table today argues about wording or
 * about an error class, and none of them has anything to say about which callbacks ran.
 *
 * @param {string} javaField the java side's seventh field
 * @param {string} jsField the port side's seventh field
 */
function traceAgrees(javaField, jsField) {
  // NOT named `jsTrace`: that is the module-level recorder this file pushes into, and shadowing it
  // with the string being compared is exactly the kind of thing a later reader mis-reads.
  const java = javaField === "-" ? [] : javaField.split(";");
  const js = jsField === "-" ? [] : jsField.split(";");
  if (java.length !== js.length) return false;

  for (let index = 0; index < java.length; ++index) {
    const javaEntry = java[index].split("|");
    const jsEntry = js[index].split("|");
    if (javaEntry.length !== jsEntry.length) return false;

    // Every field but the last is compared verbatim: the marker (`P` / `H`), the reason, the
    // locale, and — for the handler entry — the whole attempted-locale list.
    for (let field = 0; field < javaEntry.length - 1; ++field)
      if (javaEntry[field] !== jsEntry[field]) return false;

    // The cause class, the one field with a language boundary in it, through the SAME table.
    const javaCause = javaEntry[javaEntry.length - 1];
    const jsCause = jsEntry[jsEntry.length - 1];
    if (javaCause === "-" || jsCause === "-") {
      if (javaCause !== jsCause) return false;
      continue;
    }
    const permitted = ERROR_NAME[javaCause];
    if (permitted === undefined || !permitted.includes(jsCause)) return false;
  }

  return true;
}

const work = mkdtempSync(join(tmpdir(), "lokalized-lookupdiff-"));
try {
  const compile = spawnSync(join(JDK, "bin/javac"), ["-cp", JAR, "-d", work, join(here, "LookupDiff.java")],
    { encoding: "utf8" });
  if (compile.status !== 0) {
    console.error(`oracle compilation failed (classpath ${JAR}):\n${compile.stderr}`);
    process.exit(2);
  }

  const tags = probes();

  /** @type {string[]} */
  const request = [];
  for (const set of CATALOG_SETS) {
    const catalogSpec = Object.entries(set.strings)
      .map(([tag, catalog]) => `${tag}::${base64(JSON.stringify(catalog))}`)
      .join(";;");
    const tiebreakerSpec = set.tiebreakers === null
      ? "-"
      : Object.entries(set.tiebreakers).map(([code, list]) => `${code}=${list.join("|")}`).join(",,");
    request.push([
      "S", set.name, set.fallback, set.instance, tiebreakerSpec,
      set.throwOnFailure === true ? "throw" : "-", catalogSpec,
    ].join("\t"));
  }
  for (const set of CATALOG_SETS)
    for (const tag of tags) request.push(["P", set.name, base64(tag)].join("\t"));

  const inPath = join(work, "probes.tsv");
  writeFileSync(inPath, `${request.join("\n")}\n`, "utf8");

  const run = spawnSync(join(JDK, "bin/java"), ["-cp", `${work}:${JAR}`, "LookupDiff", inPath],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (run.status !== 0) {
    console.error(`oracle execution failed:\n${run.stderr}`);
    process.exit(2);
  }

  /** @type {Map<string, {java: string[], wellFormed: boolean}[]>} keyed by `rowKey(set, tag)` */
  const javaRows = new Map();
  /** @type {Map<string, {built: boolean, errorClass: string, message: string}>} */
  const javaConstruction = new Map();

  // A tag may contain anything the transport survived — a space, a comma, an astral character — so
  // the composite key is built with a separator no tag can carry rather than with punctuation that
  // merely looks unlikely.
  const rowKey = (/** @type {string} */ set, /** @type {string} */ tag) => `${set}\u0000${tag}`;

  for (const line of run.stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields[0] === "C") {
      // CLASS AND MESSAGE BOTH KEPT. They were emitted in separate fields by the oracle and the
      // message was DROPPED here — so the run compared the BUILT/REFUSED boolean and nothing else,
      // which is the exact failure `LookupDiff.java`'s own docblock says was fixed. It was fixed on
      // the oracle side only. Measured before this change: deleting the port's `Fallback locale`
      // check left this differential GREEN, because the port refuses that set anyway for the
      // unrelated reason that the fallback names no loaded catalog.
      javaConstruction.set(fields[1], {
        built: fields[2] === "BUILT",
        errorClass: fields[3],
        message: fields[4] ?? "-",
      });
      continue;
    }
    const tag = Buffer.from(fields[2], "base64").toString("utf8");
    const wellFormed = fields[3] === "true";
    // SEVEN fields per outcome, not six: the seventh is the `fallbackPolicy` / `onFailure` CALL
    // TRACE. See `traceAgrees` and `LookupDiff.java`'s `TRACE`.
    const outcomes = PROBE_SHAPES.map((_, index) => ({
      java: fields.slice(4 + index * 7, 11 + index * 7),
      wellFormed,
    }));

    // THE ARITY GATE, and it is not paranoia: the two files agree on this layout by convention and
    // nothing else, so a shape added on one side and not the other would silently shift every
    // outcome after it — comparing an ambient row against a per-call one, or reading a trace out of
    // a message field. A short final slice would also make `row.java[TRACE_FIELD]` `undefined`,
    // which `traceAgrees` would then compare against a real trace. Fail loudly instead.
    for (const outcome of outcomes)
      if (outcome.java.length !== 7)
        throw new Error(
          `the oracle emitted ${outcome.java.length} field(s) for one outcome where 7 are expected ` +
            `(${fields.length} field(s) on the line, ${PROBE_SHAPES.length} shape(s) x 7 + 4 = ` +
            `${PROBE_SHAPES.length * 7 + 4} expected) — LookupDiff.java and run.mjs have drifted`,
        );

    javaRows.set(rowKey(fields[1], tag), outcomes);
  }

  /**
   * @typedef {{set: string, tag: string, key: string, ingress: string, java: string[], js: string[]}} Row
   */

  /** @type {Row[]} */
  const unexplained = [];
  /** @type {Row[]} */
  const illFormedAccepted = [];
  /** @type {Map<string, Row[]>} */
  const consumed = new Map();
  for (const rule of KNOWN_DIVERGENCES) consumed.set(rule.id, []);
  /** @type {string[]} */
  const constructionMismatches = [];

  let wellFormedAgree = 0;
  let wellFormedCompared = 0;
  let illFormedRefused = 0;
  let constructionAgree = 0;
  let constructionCompared = 0;
  // What the TRACE comparison, and only the trace comparison, decided. `traceDisagreed` is every
  // row whose walks differ; `traceOnlyDisagreed` is the subset whose SIX OUTCOME FIELDS agree —
  // rows this tool called identical before 2026-09-09 and now does not. That second number is the
  // honest measure of what the widening bought, and printing it is how a future reader can tell
  // whether the trace channel is still discriminating anything or has become decoration.
  let traceDisagreed = 0;
  let traceOnlyDisagreed = 0;
  // …and the staleness gate for the channel itself. A trace comparison in which NEITHER side ever
  // recorded a call is not a green comparison, it is a dead one — an oracle that stopped installing
  // its callbacks, or a probe space in which no walk ever fails, would report `0 rows whose walks
  // differ` and mean nothing by it. Counted per side so a channel that went dead on ONE side is
  // reported as the asymmetry it is rather than as agreement.
  let javaTracesRecorded = 0;
  let jsTracesRecorded = 0;

  /**
   * Compare one row and file it. Returns whether the two sides fully agree.
   *
   * ONE ROUTER FOR EVERY SHAPE — construction, lookup, matcher and inspection alike — so a row can
   * never be compared under one contract in one place and another contract in another. The previous
   * code inlined this twice and the two copies had already drifted once: the construction copy
   * compared the BUILT/REFUSED boolean while the probe copy compared six fields.
   *
   * THE TRACE IS CHECKED FIRST AND OUTSIDE THE RULE TABLE. A `KNOWN_DIVERGENCES` rule is consulted
   * only when the traces already agree, so no rule — present or future — can absorb a row whose
   * WALK differs by arguing about its wording. A trace divergence that is genuinely deliberate would
   * need a rule that says so and a `matches` that reads the trace, which no rule does today.
   *
   * @param {Row} row
   */
  function route(row) {
    if (row.java[TRACE_FIELD] !== "-") javaTracesRecorded++;
    if (row.js[TRACE_FIELD] !== "-") jsTracesRecorded++;
    const tracesAgree = traceAgrees(row.java[TRACE_FIELD], row.js[TRACE_FIELD]);
    const outcomeAgrees = agreeOnOutcome(row.java, row.js);
    if (tracesAgree && outcomeAgrees) return true;

    if (!tracesAgree) {
      traceDisagreed++;
      if (outcomeAgrees) traceOnlyDisagreed++;
      unexplained.push(row);
      return false;
    }

    const rule = KNOWN_DIVERGENCES.find((candidate) => candidate.matches(row));
    if (rule === undefined) unexplained.push(row);
    else /** @type {Row[]} */ (consumed.get(rule.id)).push(row);
    return false;
  }

  for (const set of CATALOG_SETS) {
    const java = javaConstruction.get(set.name);
    if (java === undefined) {
      constructionMismatches.push(`${set.name}: the oracle emitted no construction record`);
      continue;
    }

    // The mutable cell the ambient instance's resolver reads, re-armed before every ambient probe.
    // The oracle holds the identical cell, so both sides reach their respective ambient validation
    // sites on the same input. One instance per set rather than one per probe: the alternative is
    // quadratic and buys no coverage.
    let armed = set.instance;

    /** @type {any} */
    let perCall = null;
    /** @type {any} */
    let viaAmbient = null;
    /** @type {{name: string, message: string} | null} */
    let jsRefusal = null;
    try {
      const shared = {
        fallbackLocale: set.fallback,
        strings: set.strings,
        ...(set.tiebreakers === null ? {} : { tiebreakers: set.tiebreakers }),
        // THE RECORDING CALLBACKS — the port's half of the CALL TRACE, and the counterparts of the
        // two `LookupDiff.java` installs. Both DELEGATE rather than decide: the policy answers
        // `reason !== "resolution-failure"`, which is `BUILTIN_FALLBACK_POLICIES["missing-or-no-
        // match"]` and Java's `fallbackOnMissingTranslationOrNoMatchingAlternative()` alike, and the
        // handler answers `RETURN_KEY`, which is `DEFAULT_FAILURE_HANDLER` and Java's `returnKey()`
        // alike — except on the sets whose whole purpose is the throwing path, where it answers
        // `throw` on both sides. So installing them observes the walk and does not steer it.
        //
        // `TranslationFailureResponse.throwException()`'s JS counterpart is that `throw` action:
        // the port's `throwForFailure` is the analogue of Java's `throwExceptionFor`, and it is the
        // path that reaches `MissingTranslationException`'s copy of the attempted-locale validation.
        fallbackPolicy: (/** @type {string} */ reason, /** @type {string} */ locale,
            /** @type {unknown} */ cause) => {
          jsTrace.push(`P|${javaReason(reason)}|${locale}|${causeClass(cause)}`);
          return reason !== "resolution-failure";
        },
        onFailure: (/** @type {any} */ failure) => {
          jsTrace.push(
            `H|${javaReason(failure.reason)}|${failure.lookupLocale}` +
              `|${failure.attemptedLocales.length === 0 ? "-" : failure.attemptedLocales.join("~")}` +
              `|${causeClass(failure.cause)}`,
          );
          return { action: /** @type {const} */ (set.throwOnFailure === true ? "throw" : "return-key") };
        },
      };
      perCall = createStrings({ ...shared, locale: set.instance });
      viaAmbient = createStrings({ ...shared, localeResolver: () => armed });
    } catch (error) {
      const raised = /** @type {Error} */ (error);
      jsRefusal = { name: raised?.name ?? "?", message: flatten(raised?.message ?? String(error)) };
    }

    // BOTH OR NEITHER, asserted rather than assumed. The two instances differ only in their locale
    // SOURCE, so today one cannot build while the other refuses — but both are inside one `try`, and
    // if that ever stopped holding `perCall` would be non-null with `jsRefusal` also set, the
    // `perCall === null` guard below would not fire, and every probe would run against a null
    // `viaAmbient` and silently record `THROWN | TypeError | Cannot read properties of null` for the
    // whole ambient half — a fabricated refusal on 46,000 rows dressed as a measurement. An implicit
    // invariant in an instrument is one an instrument cannot report on, so it is made explicit.
    if ((perCall === null) !== (viaAmbient === null))
      throw new Error(
        `${set.name}: createStrings built one instance and refused the other — the per-call and ` +
          `ambient halves of this set must be both or neither, and this tool's construction row ` +
          `cannot describe a half-built set`,
      );

    // A set DECLARED refused that Java builds has stopped testing what it was added to test. Checked
    // before the two-sided comparison below, because that comparison would pass — both sides would
    // build — and the axis would go quietly inert. Same rule as every stale gate here.
    if (set.refusedByJava === true && java.built)
      constructionMismatches.push(
        `${set.name}: declared refusedByJava, but java BUILT it — the construction axis has gone ` +
          `stale and this set no longer discriminates anything`,
      );

    // A set one side builds and the other refuses is a defect in itself, and skipping it silently is
    // how a differential loses its probe space without saying so.
    if (java.built !== (perCall !== null)) {
      constructionMismatches.push(
        `${set.name}: java ${java.built ? "BUILT" : `REFUSED (${java.errorClass}: ${java.message})`}, ` +
          `js ${perCall !== null ? "BUILT" : `REFUSED (${jsRefusal?.name}: ${jsRefusal?.message})`}`,
      );
      continue;
    }

    // CONSTRUCTION IS AN OUTCOME, COMPARED THE SAME WAY EVERY OTHER OUTCOME IS. Both sides refusing
    // is not agreement: `LookupDiff.java` records that two of the three construction sites cannot be
    // discriminated by the boolean at all, because the port refuses an ill-formed fallback anyway
    // (it names no loaded catalog) and an ill-formed tiebreaker anyway (it breaks the permutation
    // rule). Only the MESSAGE says which library answered the question that was asked, so the
    // refusal travels through `route` and `KNOWN_DIVERGENCES` exactly like a lookup's.
    //
    // The SEVENTH field is the call trace and it is `-` on both sides here BY CONSTRUCTION rather
    // than by omission: neither library consults a fallback policy or a failure handler while
    // building a `Strings`, so an entry on either side would itself be the divergence — which is
    // what `route` would report, since `-` matches only `-`.
    /** @type {Row} */
    const constructionRow = {
      set: set.name,
      tag: "-",
      key: "-",
      ingress: "construction",
      java: java.built
        ? ["BUILT", "-", "-", "-", "-", "-", "-"]
        : ["THROWN", java.errorClass, java.message, "-", "-", "-", "-"],
      js: jsRefusal === null
        ? ["BUILT", "-", "-", "-", "-", "-", "-"]
        : ["THROWN", jsRefusal.name, jsRefusal.message, "-", "-", "-", "-"],
    };
    constructionCompared++;
    if (route(constructionRow)) constructionAgree++;

    if (perCall === null) continue;

    for (const tag of tags) {
      const recorded = javaRows.get(rowKey(set.name, tag));
      if (recorded === undefined) throw new Error(`the oracle skipped ${set.name} / ${JSON.stringify(tag)}`);

      for (let index = 0; index < PROBE_SHAPES.length; ++index) {
        const shape = PROBE_SHAPES[index];
        const { java: javaOutcome, wellFormed } = recorded[index];
        armed = tag;
        // FRESH TRACE PER PROBE, cleared here and read immediately after, exactly as
        // `LookupDiff.java`'s `traced` does on the oracle side. Both sides must clear BEFORE the
        // call and not after it, because an empty trace is the observation on every probe whose
        // ingress check fires before the walk starts.
        jsTrace.length = 0;
        const jsOutcome = [
          ...(shape.matcher === true
            ? matcherJs(perCall, tag)
            : shape.inspect !== undefined
              ? inspectionJs(perCall, tag, shape.inspect, set.fallback)
              : lookupJs(shape.viaAmbient ? viaAmbient : perCall, shape.key, tag, shape.viaAmbient === true)),
          jsTrace.length === 0 ? "-" : jsTrace.join(";"),
        ];
        /** @type {Row} */
        const row = {
          set: set.name,
          tag,
          key: shape.key,
          ingress: shape.matcher === true
            ? "matcher"
            : shape.inspect !== undefined
              ? `inspect-${shape.inspect}`
              : shape.viaAmbient
                ? "ambient"
                : "per-call",
          java: javaOutcome,
          js: jsOutcome,
        };

        if (!wellFormed) {
          // The ill-formed bucket, under `ILL_FORMED_CONTRACT`. The port must REFUSE; what Java did
          // with the truncated prefix is reported, never gated.
          if (jsOutcome[0] === "THROWN" && jsOutcome[1] === "RangeError") illFormedRefused++;
          else illFormedAccepted.push(row);
          continue;
        }

        wellFormedCompared++;
        if (route(row)) wellFormedAgree++;
      }
    }
  }

  const explained = [...consumed.values()].reduce((total, rows) => total + rows.length, 0);
  const stale = KNOWN_DIVERGENCES.filter((rule) => /** @type {Row[]} */ (consumed.get(rule.id)).length === 0);
  const defective = OPEN_PORT_DEFECTS.filter(
    (defect) => /** @type {Row[]} */ (consumed.get(defect.id)).length > 0,
  );

  console.log(
    `end-to-end lookup differential against lokalized-3.0.0 on the pinned JDK: ` +
      `${wellFormedAgree}/${wellFormedCompared} well-formed lookups identical over ` +
      `${tags.length} tag(s) x ${CATALOG_SETS.length} catalog set(s) x ${PROBE_SHAPES.length} shape(s) ` +
      `(${new Set(
        PROBE_SHAPES.filter((shape) => shape.matcher !== true && shape.inspect === undefined)
          .map((shape) => shape.key),
      ).size} keys x 2 lookup ingresses, plus the keyless matcher and four inspection ingresses), ` +
      `${constructionAgree}/${constructionCompared} construction outcomes identical, ` +
      `${explained - openDefectRows(consumed)} declared divergence(s), ` +
      `${openDefectRows(consumed)} row(s) under ${defective.length} OPEN PORT DEFECT(s), ` +
      `${unexplained.length} unexplained; ` +
      `${illFormedRefused} ill-formed lookup(s) refused by the port and truncated by Java, ` +
      `${illFormedAccepted.length} ill-formed lookup(s) WRONGLY ACCEPTED`,
  );

  console.log(
    `the CALL TRACE channel (fallbackPolicy consultations + the onFailure invocation, in order): ` +
      `${traceDisagreed} row(s) whose WALKS differ, of which ${traceOnlyDisagreed} agree on all six ` +
      `OUTCOME fields — those are the rows only this channel can see. A trace divergence is always ` +
      `unexplained: no KNOWN_DIVERGENCES rule is consulted for a row whose walks differ. ` +
      `${javaTracesRecorded} java / ${jsTracesRecorded} js row(s) recorded at least one call.`,
  );

  /** @param {Row} row */
  const show = (row) =>
    console.log(
      `\n  [${row.set} / ${row.ingress}] ${JSON.stringify(row.tag)} key ${row.key}` +
        `\n    java ${row.java.slice(0, TRACE_FIELD).join(" | ")}` +
        `\n    js   ${row.js.slice(0, TRACE_FIELD).join(" | ")}` +
        `\n    java trace ${row.java[TRACE_FIELD]}` +
        `\n    js   trace ${row.js[TRACE_FIELD]}`,
    );

  if (constructionMismatches.length) {
    console.log(`\nCATALOG SETS THE TWO SIDES DISAGREE ABOUT (${constructionMismatches.length}):`);
    for (const line of constructionMismatches) console.log(`  ${line}`);
  }

  for (const rule of KNOWN_DIVERGENCES) {
    const rows = /** @type {Row[]} */ (consumed.get(rule.id));
    if (rows.length === 0) continue;
    const label = rule.defect ? "OPEN PORT DEFECT" : "DECLARED DIVERGENCE";
    // THE INGRESS HISTOGRAM, printed because the sample listing is capped at `SHOW` and a rule that
    // consumed thousands of rows from ONE ingress reads identically to one spanning all three. It is
    // the cheapest answer to "is the new site actually exercised, or merely present?" — a question
    // that had to be answered by instrumenting the tool by hand the first time it was asked.
    const byIngress = new Map();
    for (const row of rows) byIngress.set(row.ingress, (byIngress.get(row.ingress) ?? 0) + 1);
    const histogram = [...byIngress].map(([name, count]) => `${name} ${count}`).join(", ");
    console.log(`\n[${label}: ${rule.id}] ${rows.length} row(s) — by ingress: ${histogram}\n  ${rule.why}`);
    for (const row of rows.slice(0, SHOW)) show(row);
    if (rows.length > SHOW) console.log(`\n  ... ${rows.length - SHOW} more row(s) under this rule`);
  }

  if (unexplained.length) {
    console.log(`\nUNEXPLAINED WELL-FORMED LOOKUP DIFFERENCES (${unexplained.length}):`);
    for (const row of unexplained.slice(0, SHOW)) show(row);
    if (unexplained.length > SHOW) console.log(`\n  ... ${unexplained.length - SHOW} more`);
  }

  console.log(
    `\nILL-FORMED — GATED IN BOTH DIRECTIONS, COUNT NOT RATCHETED (${illFormedRefused}). ${ILL_FORMED_CONTRACT}`,
  );

  if (illFormedAccepted.length) {
    console.log(`\nILL-FORMED LOOKUPS THE PORT ANSWERED (${illFormedAccepted.length}) — the contract moved:`);
    for (const row of illFormedAccepted.slice(0, SHOW)) show(row);
  }

  for (const rule of stale)
    console.log(
      `STALE: '${rule.id}' explained nothing on this run — remove it from ` +
        `${rule.defect ? "OPEN_PORT_DEFECTS" : "KNOWN_DIVERGENCES"}`,
    );

  if (illFormedRefused === 0)
    console.log("STALE: no ill-formed probe reached the oracle — probes() section (7) has gone empty");

  // The CALL TRACE channel's own staleness gate, one per side. A channel where nothing was ever
  // recorded compares "-" against "-" on every row and reports agreement it has not earned.
  if (javaTracesRecorded === 0)
    console.log(
      "STALE: the oracle recorded no fallbackPolicy or onFailure call on any row — LookupDiff's " +
        "recording callbacks are no longer installed, or no probe reaches a failing walk",
    );
  if (jsTracesRecorded === 0)
    console.log(
      "STALE: the port recorded no fallbackPolicy or onFailure call on any row — the recording " +
        "callbacks in `shared` are no longer installed, or no probe reaches a failing walk",
    );

  // An OPEN PORT DEFECT does NOT make the run green — it only makes the failure print its own root
  // cause instead of arriving as anonymous mismatches. Same rule as `tools/direct-tag-diff/`'s.
  process.exit(
    unexplained.length === 0 &&
      defective.length === 0 &&
      illFormedAccepted.length === 0 &&
      constructionMismatches.length === 0 &&
      stale.length === 0 &&
      illFormedRefused > 0 &&
      wellFormedCompared > 0 &&
      javaTracesRecorded > 0 &&
      jsTracesRecorded > 0
      ? 0
      : 1,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** @param {Map<string, any[]>} consumed */
function openDefectRows(consumed) {
  let total = 0;
  for (const defect of OPEN_PORT_DEFECTS) total += (consumed.get(defect.id) ?? []).length;
  return total;
}
