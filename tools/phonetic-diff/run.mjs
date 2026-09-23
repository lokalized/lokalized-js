#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests the JS phonetic axis against the REAL Java one.
 *
 * `PhoneticDiff.java` drives `DefaultStrings` on the pinned JDK and prints, per scenario, the
 * status, the rendered string, the supplying locale, the failure reason, the deepest cause message,
 * the CAUSE CHAIN's classes and depth, and every `PhoneticResolver` invocation in order — term,
 * locale handed, value returned, exception raised.
 * This file drives `createStrings` over the same scenarios and diffs the two transcripts.
 *
 * The resolver channel is why this exists. A port that memoizes by term, or hands the callback the
 * REQUESTED locale instead of the supplying one, renders a byte-identical string in almost every
 * scenario; only the call list separates them.
 *
 * THE CAUSE CHAIN IS THE SEVENTH COLUMN, AND WHAT IT ADDED WAS MEASURED, NOT ARGUED. The sixth
 * column is `deepest(cause).getMessage()` — the LEAF message — so everything the contextualizing
 * ladder does above the leaf was invisible here: its depth, and the class at each link. Two
 * ablations against `src/internal/interpolate.js`, both run on the pinned JDK 2026-09-15, each
 * measured with the IMPROVED tool and then with the PRISTINE one over the same ablated port:
 *
 *   1. COLLAPSE THE WRAPPER — `contextualizePlaceholderFailure` returns a recognized
 *      `ResolutionError` unchanged instead of rebuilding it with context. Improved: exit 1, EIGHT
 *      unexplained, and every one of the eight differs ONLY in this column — same status, same
 *      rendered string, same supplying locale, same failure reason, same leaf message, same call
 *      transcript. Pristine: exit 0, output BYTE-IDENTICAL to the control's `67/73 identical,
 *      6 known divergence(s), 0 unexplained`.
 *      `node tools/conformance.mjs` DOES catch this one — exit 1, 144 DIAGNOSTIC REGRESSIONS —
 *      because the corpus compares the OUTERMOST cause message where this tool compared the leaf.
 *      Said plainly so nobody credits the column with more than it earned.
 *   2. COLLAPSE THE TWO CODES — the same boundary raises `RESOLUTION_INVALID_ARGUMENT` for both of
 *      Java's middle arms. Improved: exit 1, TWO unexplained, again differing only here
 *      (`ResolutionError:RESOLUTION_INVALID_ARGUMENT<...` against Java's `...INVALID_STATE<...`).
 *      Pristine: exit 0, byte-identical to the control. `node tools/conformance.mjs`:
 *      BYTE-IDENTICAL to its own control, exit 0, 2,117 passed / 0 FAILED. **The corpus is
 *      structurally blind to it and always will be** — `tools/conformance.mjs`'s `CAUSE_NAME` note
 *      records that `causeNameOf` reads `.name`, and plan 3.5 gives ONE class TWO codes, so no
 *      corpus case can ever separate them. This column is the only live oracle for that split.
 *
 * FOUR NEW EXIT TERMS, EACH NEGATIVE-TESTED WITH A CLEAN CONTROL (same session): an extra constant
 * column appended by the harness reds 77 COLUMN COUNT lines; deleting one `CAUSE_CLASS` entry reds
 * UNMAPPED CAUSE CLASS naming `PhoneticDiff$AppFailure`; deleting the two `throw-app` probes reds
 * the ARM 4 degeneracy check; deleting `resolver-throws-recognized-value` reds the mixed-class one.
 *
 *   node tools/phonetic-diff/run.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createStrings } from "../../src/core/index.js";
import * as forms from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const javaDir = process.env.LOKALIZED_JAVA_DIR ? resolve(process.env.LOKALIZED_JAVA_DIR) : resolve(root, "../lokalized-java");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}

const ONSETS = {
  PHONETIC_VOWEL: "an", PHONETIC_CONSONANT: "a", PHONETIC_S_IMPURE: "uno",
  PHONETIC_OTHER: "the", PHONETIC_H_SILENT: "l'", PHONETIC_SOLAR: "as", PHONETIC_LUNAR: "al",
};
const ARTICLE = { Article: { translation: "[{{a}}]", placeholders: { a: { value: "term", translations: ONSETS } } } };

/** @type {{name:string, fallback:string, instance:string, request:string, key:string, resolver:string, values:string, catalogs:Record<string,object>}[]} */
const SCENARIOS = [];
const add = (name, o) => SCENARIOS.push({
  fallback: "en", instance: "en", request: "en", key: "Article",
  resolver: "first-letter-vowel", values: "term=S:apple", catalogs: { en: ARTICLE }, ...o, name,
});

// --- the term the callback is handed -------------------------------------------------------
add("term-plain", {});
add("term-empty", { values: "term=S:" });
add("term-spells-a-constant", { values: "term=S:PHONETIC_VOWEL" });
add("term-spells-a-render-name", { values: "term=S:VOWEL" });
add("term-newline", { values: "term=S:a\\nb" });
add("term-astral", { values: "term=S:\u{1D400}pple" });
add("term-combining", { values: "term=S:a\u0301pple" });
add("term-upper-vowel", { values: "term=S:Apple" });
add("term-digit", { values: "term=S:0" });

// --- values that are not terms at all ------------------------------------------------------
add("value-int", { values: "term=I:0" });
add("value-double", { values: "term=D:0.0" });
add("value-false", { values: "term=B:false" });
add("value-null", { values: "term=N:" });
add("value-absent", { values: "" });
add("value-tagged-phonetic", { values: "term=P:VOWEL" });
add("value-tagged-cross-axis", { values: "term=G:FEMININE" });

// --- which locale reaches the callback -----------------------------------------------------
const BY_LOCALE = "by-locale:en=PHONETIC_VOWEL|de=PHONETIC_CONSONANT|de-CH=PHONETIC_S_IMPURE|en-US=PHONETIC_H_SILENT";
add("donor-en-for-de-request", { resolver: BY_LOCALE, request: "de" });
add("donor-en-for-en-us-request", { resolver: BY_LOCALE, request: "en-US" });
add("donor-de-when-de-loaded", {
  resolver: BY_LOCALE, request: "de-CH",
  catalogs: { en: ARTICLE, de: ARTICLE },
});
add("donor-de-exact", { resolver: BY_LOCALE, request: "de", catalogs: { en: ARTICLE, de: ARTICLE } });
add("donor-walks-past-a-catalog-without-the-key", {
  resolver: BY_LOCALE, request: "de",
  catalogs: { en: ARTICLE, de: { Other: "x" } },
});
add("donor-en-us-loaded", {
  resolver: BY_LOCALE, request: "en-US",
  catalogs: { en: ARTICLE, "en-US": ARTICLE },
});

// --- how many times, and in what order ------------------------------------------------------
const ORDER = {
  Article: {
    translation: "[{{y}}-{{x}}]",
    placeholders: {
      x: { value: "t1", translations: ONSETS },
      y: { value: "t2", translations: ONSETS },
    },
  },
};
add("order-template-beats-definition", { catalogs: { en: ORDER }, values: "t1=S:apple,,t2=S:book" });
add("order-same-source-two-names", {
  catalogs: { en: { Article: { translation: "[{{x}}+{{y}}]", placeholders: {
    x: { value: "t1", translations: ONSETS }, y: { value: "t1", translations: ONSETS } } } } },
  values: "t1=S:apple",
});
add("order-one-name-twice", {
  catalogs: { en: { Article: { translation: "[{{x}} {{x}}]", placeholders: {
    x: { value: "t1", translations: ONSETS } } } } },
  values: "t1=S:apple",
});
add("order-unreferenced-definition", {
  catalogs: { en: { Article: { translation: "none", placeholders: {
    x: { value: "t1", translations: ONSETS } } } } },
  values: "t1=S:apple",
});
add("order-nested-generated", {
  catalogs: { en: { Article: { translation: "[{{outer}}]", placeholders: {
    outer: { value: "t1", translations: { PHONETIC_VOWEL: "V{{inner}}", PHONETIC_CONSONANT: "C{{inner}}" } },
    inner: { value: "t2", translations: ONSETS } } } } },
  values: "t1=S:apple,,t2=S:book",
});
add("order-unreached-nested-branch", {
  catalogs: { en: { Article: { translation: "[{{outer}}]", placeholders: {
    outer: { value: "t1", translations: { PHONETIC_VOWEL: "V", PHONETIC_CONSONANT: "C{{inner}}" } },
    inner: { value: "t2", translations: ONSETS } } } } },
  values: "t1=S:apple,,t2=S:book",
});

// --- resolver misbehavior --------------------------------------------------------------------
add("resolver-absent", { resolver: "none" });
add("resolver-absent-unreferenced", {
  resolver: "none",
  catalogs: { en: { Article: { translation: "none", placeholders: { x: { value: "t1", translations: ONSETS } } } } },
  values: "t1=S:apple",
});
add("resolver-returns-null", { resolver: "return-null" });
add("resolver-throws", { resolver: "throw" });
// THE TWO ARMS OF JAVA'S LADDER THE `throw` SPEC CANNOT REACH, each handing BOTH libraries an
// exception of the SAME category — which is the whole difficulty, and why `resolver-throws` is a
// declared probe asymmetry rather than a probe to tune. `throw` gives Java an
// `IllegalStateException` (RECOGNIZED at `DefaultStrings:1276`, contextualized) and JS a plain
// `Error` (arm 4 by plan 3.5:1135-1136), so that one row asks the two libraries two questions.
// These two differ from it ONLY in the resolver spec, so the placeholder and expression paths
// beneath it stay fully compared.
add("resolver-throws-recognized-value", { resolver: "throw-invalid-value" });
add("resolver-throws-application-error", { resolver: "throw-app" });
add("resolver-returns-unmapped-branch", { resolver: "constant:PHONETIC_Z" });

// --- the bound ---------------------------------------------------------------------------------
add("term-at-the-limit", { values: "term=REPEAT:a*262144" });
add("term-over-the-limit", { values: "term=REPEAT:a*262145" });

// --- expressions -------------------------------------------------------------------------------
const EXPR = { Article: { translation: "[default]", alternatives: [{ "noun == PHONETIC_VOWEL": { translation: "[alt]" } }] } };
add("expr-raw-operand", { catalogs: { en: EXPR }, values: "noun=S:apple" });
add("expr-raw-operand-donor", { catalogs: { en: EXPR }, request: "de", resolver: BY_LOCALE, values: "noun=S:apple" });
add("expr-tagged-operand-no-resolver", { catalogs: { en: EXPR }, resolver: "none", values: "noun=P:VOWEL" });
add("expr-raw-operand-no-resolver", { catalogs: { en: EXPR }, resolver: "none", values: "noun=S:apple" });
add("expr-two-raw-terms", {
  catalogs: { en: { Article: { translation: "[default]", alternatives: [{ "a == b": { translation: "[alt]" } }] } } },
  values: "a=S:apple,,b=S:apple",
});
add("expr-resolver-throws", { catalogs: { en: EXPR }, resolver: "throw", values: "noun=S:apple" });
// The same matched-category pair on the expression path, where Java's ladder has THREE arms and
// deliberately no fourth (`DefaultStrings:1226/:1230/:1234`) — so an application error propagates
// out of the fragment boundary and is returned unchanged by the enclosing placeholder boundary.
// The chain column is the only thing that can tell "two same-category wrappers" (plan 3.5:1147)
// from one, and it is the only column that moves between these two rows.
add("expr-resolver-throws-recognized-value", { catalogs: { en: EXPR }, resolver: "throw-invalid-value", values: "noun=S:apple" });
add("expr-resolver-throws-application-error", { catalogs: { en: EXPR }, resolver: "throw-app", values: "noun=S:apple" });
add("expr-and-placeholder-both-resolve", {
  catalogs: { en: { Article: { translation: "[{{a}}]",
    placeholders: { a: { value: "term", translations: ONSETS } },
    alternatives: [{ "term == PHONETIC_VOWEL": { translation: "alt[{{a}}]" } }] } } },
  values: "term=S:apple",
});

// --- ordinary-key hazards -----------------------------------------------------------------------
for (const magic of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"])
  add(`magic-key-${magic}`, {
    catalogs: { en: { Article: { translation: "[{{a}}]", placeholders: { a: { value: magic, translations: ONSETS } } } } },
    values: `${magic}=S:apple`,
  });

// --- rtl donors ----------------------------------------------------------------------------------
add("rtl-donor-phonetic-branch", {
  fallback: "ar", request: "ar",
  catalogs: { ar: { Article: { translation: "[{{a}}] {{raw}}", placeholders: { a: { value: "term", translations: ONSETS } } } } },
  values: "term=S:apple,,raw=S:Latin",
});

// --- bidi and the donor rule, which the phonetic axis shares --------------------------------------
const RTL = { Article: { translation: "[{{a}}] {{raw}}", placeholders: { a: { value: "term", translations: ONSETS } } } };
add("bidi-rtl-request-rtl-donor", { fallback: "ar", request: "ar", catalogs: { ar: RTL }, values: "term=S:apple,,raw=S:Latin" });
add("bidi-rtl-request-ltr-donor", { fallback: "en", request: "ar", catalogs: { en: RTL }, values: "term=S:apple,,raw=S:Latin" });
add("bidi-ltr-request-rtl-donor", { fallback: "ar", request: "en", catalogs: { ar: RTL }, values: "term=S:apple,,raw=S:Latin" });
add("bidi-rtl-donor-rtl-value", { fallback: "he", request: "he", catalogs: { he: RTL }, values: "term=S:apple,,raw=S:\u05d0\u05d1" });
add("bidi-ltr-donor-rtl-value", { fallback: "en", request: "en", catalogs: { en: RTL }, values: "term=S:apple,,raw=S:\u05d0\u05d1" });
add("bidi-rtl-donor-empty-value", { fallback: "ar", request: "ar", catalogs: { ar: RTL }, values: "term=S:apple,,raw=S:" });
add("bidi-rtl-donor-numeric-value", { fallback: "ar", request: "ar", catalogs: { ar: RTL }, values: "term=S:apple,,raw=I:0" });

// --- escapes beside a phonetic placeholder ---------------------------------------------------------
add("escape-literal-open-beside-phonetic", {
  catalogs: { en: { Article: { translation: "\\\\{{lit}} [{{a}}]", placeholders: { a: { value: "term", translations: ONSETS } } } } },
  values: "term=S:apple",
});
add("escape-backslash-in-term", { values: "term=S:\\\\apple" });
add("unclosed-token-beside-phonetic", {
  catalogs: { en: { Article: { translation: "{{ [{{a}}]", placeholders: { a: { value: "term", translations: ONSETS } } } } },
  values: "term=S:apple",
});

// --- multi-candidate resolver ordering ---------------------------------------------------------------
add("two-candidates-first-fails-branch", {
  resolver: "constant:PHONETIC_Z", request: "de",
  catalogs: { de: ARTICLE, en: { Article: { translation: "[{{a}}]", placeholders: { a: { value: "term", translations: { ...ONSETS, PHONETIC_Z: "z" } } } } } },
});

// --- the exact SPELLING of the locale tag the callback is handed ------------------------------------
// The resolver receives a tag, not an opaque handle, and applications key off it. Java hands over
// `Locale.toLanguageTag()` of the SUPPLYING locale, so canonicalization, case and legacy-code
// rewriting are all observable through the callback even when the rendered string never moves.
const ECHO = "by-locale:";
for (const [name, fallback, request, loaded] of [
  ["tag-en-us-lowercase-request", "en", "en-us", ["en"]],
  ["tag-en-us-loaded-uppercase", "en", "en-US", ["en-us"]],
  ["tag-uppercase-language", "EN", "EN", ["EN"]],
  ["tag-script-and-region", "en", "zh-Hant-TW", ["zh-Hant-TW"]],
  ["tag-legacy-hebrew", "en", "iw", ["iw"]],
  ["tag-modern-hebrew", "en", "he", ["he"]],
  ["tag-legacy-indonesian", "en", "in", ["in"]],
  ["tag-modern-indonesian", "en", "id", ["id"]],
  ["tag-moldovan", "en", "mo", ["mo"]],
  ["tag-romanian", "en", "ro", ["ro"]],
  ["tag-three-letter-language", "en", "fil", ["fil"]],
  ["tag-region-only-fallback", "en", "fr-CA", ["fr"]],
  ["tag-extlang-ish", "en", "sr-Latn-RS", ["sr-Latn-RS"]],
  ["tag-und", "en", "und", ["en"]],
]) {
  const catalogs = {};
  for (const l of loaded) catalogs[l] = ARTICLE;
  add(name, { fallback: loaded[0], request, catalogs, resolver: ECHO + "x=PHONETIC_VOWEL" });
}

/**
 * How many tab-separated fields ONE Java row carries: the scenario name, six result columns
 * (status, translation, supplying locale, failure reason, deepest cause message, cause chain) and
 * the `CALLS[...]` transcript.
 *
 * PINNED BECAUSE THE ROW IS POSITIONAL. `tools/oracle-field-coverage.mjs` observes which NAMED
 * oracle fields a comparison reads and fails on one nothing touches; S33 recorded this tool as one
 * of the three where that gate's premise does not hold — a positional TSV row has no names to
 * observe — and named a pinned column COUNT as the instrument that does apply.
 *
 * WHAT IT BUYS HERE IS THE CAUSE, NOT THE DETECTION, AND OVERCLAIMING IT WOULD BE THE DEFECT THIS
 * PROJECT KEEPS FINDING. The comparison below joins the row back into ONE string, so a Java-side
 * column the runner never unpacks does not go unnoticed — it goes noisy. Measured both ways by
 * appending one constant column to every row `PhoneticDiff.java` emits: with the gate, 77 named
 * COLUMN COUNT lines; with the gate disabled and nothing else changed, `0/77 identical` and 69
 * anonymous MISMATCH rows, leaving a reader to infer from a diff that the row SHAPE had moved.
 * `tools/lookup-diff/run.mjs`'s version of this gate is strictly stronger because that runner reads
 * FIXED SLICES, where a trailing column really is invisible; this one is a diagnosis, and saying
 * which is which is the difference between a gate and a claim about a gate.
 *
 * THE ANCHOR IS CHECKED TOO, because a count alone cannot see a column added and another removed:
 * the last field must still be the call transcript. A scenario value carrying a literal TAB trips
 * both — correctly, since a positional row cannot carry one, and today none does.
 */
const COLUMNS = 8;

/**
 * Java exception class -> the JS spelling of the SAME failure, for the cause-chain column only.
 *
 * MAPPED, NEVER COMPARED VERBATIM — the discipline `LookupDiff`'s runner states for an error class,
 * and S31's `diff:language-range` lesson: a fully-qualified Java class name can never equal a JS
 * error name, so a verbatim comparison would be either permanently red or quietly dropped. The
 * PAIR is what is asserted.
 *
 * THE TWO `ResolutionError` ROWS CARRY A CODE, AND THAT IS THE POINT OF THE COLUMN.
 * `tools/conformance.mjs`'s `CAUSE_NAME` records that `causeNameOf` reads `.name`, that plan 3.5
 * gives ONE class with TWO codes, and therefore that collapsing every `RESOLUTION_INVALID_STATE`
 * into `RESOLUTION_INVALID_ARGUMENT` at every raiser leaves the corpus report BYTE-IDENTICAL — its
 * own note says the corpus cannot see the code, ever. Java tells the two apart by CLASS
 * (`DefaultStrings:1273` vs `:1276`), so mapping each Java class onto `name:code` is what puts that
 * split under a live oracle for the first time.
 *
 * KEYED ON THE CLASS AND THEREFORE SITE-BLIND, which is worth saying rather than leaving to be
 * found: `java.lang.IllegalArgumentException` means `ResolutionError:RESOLUTION_INVALID_ARGUMENT`
 * inside the contextualizing ladder and `RangeError` at CONSTRUCTION, and one table can spell only
 * one. The construction row it therefore reports as divergent — `donor-en-us-loaded` — was already
 * declared below for exactly that reason, in those words, before this column existed.
 *
 * AN UNMAPPED JAVA CLASS FAILS THE RUN, naming itself. It never compares equal and it is never
 * silently dropped, so a new Java raiser reaching this path cannot arrive unnoticed.
 *
 * @type {Record<string, string>}
 */
const CAUSE_CLASS = {
  "com.lokalized.ExpressionEvaluationException": "ExpressionEvaluationError",
  "java.lang.IllegalArgumentException": "ResolutionError:RESOLUTION_INVALID_ARGUMENT",
  "java.lang.IllegalStateException": "ResolutionError:RESOLUTION_INVALID_STATE",
  "com.lokalized.LocalizedStringLoadingException": "StringsParseError",
  // THE TWO APPLICATION-THROWN CLASSES, deliberately classes `com.lokalized` never CONSTRUCTS, so
  // one class-keyed map can spell the application's throw and the library's wrapper apart.
  // `NumberFormatException` is RECOGNIZED by `:1273` (it is an `IllegalArgumentException`) while
  // the exception that arm builds at `:1274` is a plain IAE — so a correct chain reads
  // `ResolutionError:RESOLUTION_INVALID_ARGUMENT<RangeError` on both sides, and a port that kept
  // the failing exception's TYPE instead of its CATEGORY would read `RangeError<RangeError`.
  "java.lang.NumberFormatException": "RangeError",
  "PhoneticDiff$AppFailure": "AppFailure",
};

/** @type {Set<string>} */
const UNMAPPED_CAUSE_CLASSES = new Set();

/**
 * Translates one Java cause chain into the port's spelling, link by link.
 *
 * @param {string} shape `a.b.C<d.e.F`, or `-` for no cause
 */
function adaptCauseShape(shape) {
  if (shape === "-") return "-";
  return shape.split("<").map((cls) => {
    if (Object.hasOwn(CAUSE_CLASS, cls)) return CAUSE_CLASS[cls];
    UNMAPPED_CAUSE_CLASSES.add(cls);
    return `UNMAPPED(${cls})`;
  }).join("<");
}

/**
 * Every Java class one of `DefaultStrings`' ladders RECOGNIZES — the three
 * `contextualizePlaceholderFailure` rebuilds (`:1271`, `:1274`, `:1277`), which are also the three
 * the fragment ladder rebuilds (`:1226`, `:1230`, `:1234`), plus the subclass this probe set throws.
 * A cause whose class is NOT here and which arrives with no wrapper took arm 4: plan 2.5:249's
 * "an unrecognized application exception is stored unchanged".
 *
 * `NumberFormatException` IS LISTED BECAUSE JAVA RECOGNIZES IT — it is an `IllegalArgumentException`
 * by assignability, which a name-keyed set cannot compute and which the ladder acts on. Listing it
 * is not a formality: MEASURED on the pinned JDK, `expr-resolver-throws-recognized-value` produces
 * a BARE `java.lang.NumberFormatException` at depth 1, because the whole-message alternative path
 * wraps nothing at all — neither ladder is on it. Without this entry that row would count as an
 * arm-4 passthrough, and the degenerate check below would be satisfied by a row that never took
 * arm 4, which is the vacuity it exists to refuse. The first draft of this comment asserted the
 * opposite — that a recognized class always appears at depth 2 — and the measurement said otherwise.
 *
 * WHAT THAT MEANS FOR THE CHECK: depth 1 alone proves nothing here. Arm-4 evidence is a depth-1
 * chain whose class no ladder recognizes, and in this probe set exactly one class qualifies —
 * `PhoneticDiff$AppFailure`, thrown by the two `throw-app` rows and by nothing else.
 */
const RECOGNIZED_BY_JAVAS_LADDERS = new Set([
  "com.lokalized.ExpressionEvaluationException",
  "java.lang.IllegalArgumentException",
  "java.lang.IllegalStateException",
  "java.lang.NumberFormatException",
]);

/**
 * Divergences this port makes ON PURPOSE, each with the reason it is not a defect. Anything not
 * listed here fails the run, and an entry that stops diverging fails it too — so the table cannot
 * decay into a list of excuses for behavior that was later fixed.
 */
const KNOWN_DIVERGENCES = {
  // Java prints `value.getClass().getSimpleName()`. One JS `number` is both `Integer` and `Double`,
  // so there is no honest single answer and these two rows stay divergent.
  //
  // `value-false` USED TO SIT HERE, on the reason "Java prints the boxed type name Boolean; JS
  // reports the primitive type" — which was a preference wearing a measurement's clothes. A JS
  // `boolean` determines its Java class totally and unambiguously, and `Boolean` is a real JS global
  // naming exactly that type, so nothing was untranslatable about it; the same held for `String`.
  // The port now prints both, this table's STALE gate reported the entry the moment it stopped
  // diverging, and deleting it is the record of the win. `javaSimpleNameOf` carries the test, and
  // the survivors are the four NUMERIC CARRIERS — `Integer`/`Double` from one JS `number`,
  // `Long`/`BigInteger` from one JS `bigint`.
  //
  // ONLY TWO OF THE FOUR ARE DECLARED HERE, and the reason is worth saying rather than leaving a
  // reader to hunt: this differential's probe space has no long, bigint, decimal or plural-operands
  // scenario at all, so `Long` and `BigInteger` never arise on this path and are declared in
  // `tools/conformance.mjs` instead. That a table can name four survivors while its own probe space
  // can only reach two is the tell — a differential is evidence about what it probes and nothing
  // else. `BigDecimal` and `PluralOperands` used to be declared over there too and are now
  // REPRODUCED, which needed no edit here for exactly the same reason.
  "value-int": "Java prints Integer; one JS number is both Integer and Double",
  "value-double": "Java prints Double; one JS number is both Integer and Double",
  // Java's advice names `Strings.Builder#phoneticResolver(...)`, which does not exist here. Copying
  // it would send a JavaScript caller to a Java API. The structural half of every other phonetic
  // diagnostic IS copied verbatim; only the configuration advice is reworded.
  "resolver-absent": "Java's hint points at a Java builder method the JS API does not have",
  "expr-raw-operand-no-resolver": "same reworded configuration advice, on the expression path",
  // The PORT GAP this entry used to record is closed: `createStrings` now refuses en + en-US
  // without tiebreakers, at construction, with Java's diagnosis word for word — same language code,
  // same collided locales, same empty resolver call list. What still differs is the two words no
  // port can share: JavaScript has no `IllegalArgumentException`, and the advice names the option a
  // JS caller actually has instead of Java's `tiebreakerLocalesByLanguageCode` constructor
  // parameter. Same rule as `resolver-absent` two entries down.
  "donor-en-us-loaded": "identical refusal and diagnosis; JS raises RangeError where Java raises "
    + "IllegalArgumentException, and the advice names createStrings({ tiebreakers })",
  // The port raises a plain Error from `createStrings`; `lokalized/parse` raises `StringsParseError`.
  // The message is identical; only the constructor name differs.
  "unclosed-token-beside-phonetic": "identical message; Java names its LocalizedStringLoadingException "
    + "and createStrings raises a plain Error",
  // A PROBE ASYMMETRY, NOT A PORT DIVERGENCE — and it only became visible when the cause-chain
  // column landed. Before it, both rows printed the deepest message `resolver refuses` and compared
  // IDENTICAL; the two libraries were doing measurably different things and no column could say so.
  //
  // The `throw` spec hands Java an `IllegalStateException`, which `DefaultStrings:1276` RECOGNIZES
  // and rebuilds (chain depth 2), and hands JS a plain `Error`, which plan 3.5:1135-1136 makes arm
  // 4 in as many words — "an ordinary custom phonetic-resolver error or sentinel — preserves
  // identity" — so the port returns it UNCHANGED at depth 1. Both libraries are right about what
  // they were handed: JavaScript has no application-throwable spelling of Java's invalid-STATE
  // category at all (plan 3.5:1134 names only `TypeError` and `RangeError`, both invalid-VALUE).
  //
  // WHAT DECLARING IT COSTS, SAID PLAINLY: a declared row is skipped WHOLE, so these two stop
  // comparing their status, rendered string, supplying locale, failure reason, deepest message and
  // call transcript as well. That is paid back in the same slice rather than promised —
  // `resolver-throws-recognized-value` and `resolver-throws-application-error` (and their `expr-`
  // twins) differ from these rows ONLY in the resolver spec, hand both libraries a MATCHED
  // category, and compare every column including the chain exactly.
  "resolver-throws": "probe asymmetry: Java's delegate throws IllegalStateException (recognized at "
    + ":1276, rebuilt) and the JS delegate a plain Error (arm 4 by plan 3.5:1135-1136); JS has no "
    + "application spelling of Java's invalid-state category",
  "expr-resolver-throws": "the same probe asymmetry on the expression path",
};

/**
 * A custom application error class — one the port has no reason to recognize, which is the point.
 * Plan 3.5:1135-1136 puts "an ordinary custom phonetic-resolver error" on arm 4, where identity is
 * preserved; `PhoneticDiff.AppFailure` is its Java twin.
 */
class AppFailure extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "AppFailure";
  }
}

/**
 * The three throwing delegates, each paired with the SimpleName Java's call transcript prints for
 * it. The pairing used to be one hard-coded `"IllegalStateException"` in `wrap`'s catch, which was
 * already a harness mapping — it is a table now because there are three, not because it changed.
 *
 * @type {Record<string, {make: () => Error, java: string}>}
 */
const THROWS = {
  "throw": { make: () => new Error("resolver refuses"), java: "IllegalStateException" },
  "throw-invalid-value": { make: () => new RangeError("resolver refuses"), java: "NumberFormatException" },
  "throw-app": { make: () => new AppFailure("resolver refuses"), java: "AppFailure" },
};

const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const tsv = SCENARIOS.map((s) => [
  s.name, s.fallback, s.instance, s.request, s.key, s.resolver, s.values,
  Object.entries(s.catalogs).map(([l, c]) => `${l}::${b64(c)}`).join(";;"),
].join("\t")).join("\n");

const work = mkdtempSync(join(tmpdir(), "lokalized-phonetic-diff-"));
// REMOVED ON `exit`, NOT IN A `finally`. This run ends in `process.exit`, which skips `finally`,
// and until 2026-09-23 a `finally` after this block held the removal — so EVERY run left its work
// directory in the system temp folder (13 `phonetic-diff-*` were counted there; the prefix now
// matches every other `lokalized-*` scratch directory). The block is the old `try` body, kept as a
// block so its bindings stay scoped.
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
{
  writeFileSync(join(work, "in.tsv"), `${tsv}\n`, "utf8");
  const compile = spawnSync(join(JDK, "bin/javac"),
    ["-cp", join(javaDir, "target/classes"), "-d", work, join(here, "PhoneticDiff.java")],
    { encoding: "utf8" });
  if (compile.status !== 0) { console.error(compile.stderr); process.exit(2); }
  const run = spawnSync(join(JDK, "bin/java"),
    ["-cp", `${work}:${join(javaDir, "target/classes")}`, "PhoneticDiff", join(work, "in.tsv")],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }

  /** @type {Map<string, string>} */
  const java = new Map();
  /** Raw, unmapped Java chains, kept for the degenerate-set check below. @type {Map<string, string>} */
  const javaChains = new Map();
  /** @type {string[]} */
  const miscounted = [];
  for (const line of run.stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields.length !== COLUMNS || !fields[COLUMNS - 1].startsWith("CALLS[")) {
      miscounted.push(`${fields[0]}: ${fields.length} column(s), expected ${COLUMNS}, ` +
        `last field ${fields[fields.length - 1].slice(0, 24)}...`);
      continue;
    }
    // Field 6 is the cause chain — the ONLY mapped column. Everything else is compared verbatim.
    javaChains.set(fields[0], fields[6]);
    fields[6] = adaptCauseShape(fields[6]);
    java.set(fields[0], fields.slice(1).join("\t"));
  }

  let mismatches = 0;
  /** @type {string[]} */
  const stale = [];
  for (const s of SCENARIOS) {
    const actual = runJs(s);
    const wanted = java.get(s.name);
    const known = Object.hasOwn(KNOWN_DIVERGENCES, s.name);
    if (actual === wanted) {
      // A known divergence that stopped diverging is reported too. Left unchecked, this table
      // would quietly become a list of excuses for behavior the port had already fixed.
      if (known) stale.push(s.name);
      continue;
    }
    if (known) {
      console.log(`expected divergence ${s.name}: ${KNOWN_DIVERGENCES[s.name]}`);
      continue;
    }
    mismatches += 1;
    console.log(`MISMATCH ${s.name}\n  java: ${wanted}\n  js  : ${actual}`);
  }
  // THE CAUSE-CHAIN COLUMN DISCRIMINATES OVER PART OF THE PROBE SPACE, AND ONLY THAT PART COUNTS.
  // MEASURED 2026-09-15 over the 77 scenarios: 8 are declared divergences and skipped whole; of the
  // 69 compared, 55 never fail at all, so their chain is `-` on both sides and the column is inert
  // for them. FOURTEEN carry a chain — 9 at depth 2, 5 at depth 1 — and those 14 are the entire
  // value of the column. This project has twice written down what happens when nobody checks which
  // rows a new comparison actually rests on: `diff:interpolate` covered both branches of an RTL
  // predicate and stayed green over a live defect because no probe spelled `Zzzz`, and S6's
  // array-order ablation did not fire because the fixture's only array was already sorted. Covering
  // a path is not discriminating it.
  //
  // TWO OF THE FOUR CHECKS REST ON ONE INPUT EACH, WHICH IS WHY THEY ARE GATES AND NOT PROSE. The
  // differing-classes check is satisfied ONLY by `resolver-throws-recognized-value`
  // (`IllegalArgumentException<NumberFormatException` — the ladder keeping the CATEGORY and not the
  // TYPE), and the arm-4 check ONLY by the two `throw-app` rows. Delete any of them and the run goes
  // red naming the proposition that lost its evidence, instead of staying green over a column that
  // had quietly stopped meaning anything.
  //
  // COUNTED OVER COMPARED ROWS ONLY. A row in `KNOWN_DIVERGENCES` is skipped WHOLE, so a chain seen
  // only there proves nothing — and that is not hypothetical here: `resolver-throws` is declared and
  // carries `IllegalStateException<IllegalStateException`, a depth-2 chain. Counting it would have
  // satisfied the depth check with a row the runner never compares, which is exactly the vacuity
  // this block exists to refuse.
  const comparedChains = SCENARIOS
    .filter((s) => !Object.hasOwn(KNOWN_DIVERGENCES, s.name))
    .map((s) => ({ name: s.name, links: (javaChains.get(s.name) ?? "-").split("<") }))
    .filter((row) => row.links[0] !== "-" && row.links[0] !== "");
  /** @type {string[]} */
  const degenerate = [];
  if (!comparedChains.length)
    degenerate.push("no COMPARED probe produces a cause at all — the column is inert");
  if (!comparedChains.some((row) => row.links.length > 1))
    degenerate.push("no COMPARED probe produces a chain DEEPER than one link — arms 1-3 of " +
      "DefaultStrings:1270-1281 are unexercised, so depth cannot discriminate anything");
  if (!comparedChains.some((row) => row.links.length === 1 && !RECOGNIZED_BY_JAVAS_LADDERS.has(row.links[0])))
    degenerate.push("no COMPARED probe takes ARM 4 — no chain is a single link of a class no ladder " +
      "recognizes, so a port that always wraps would pass and plan 2.5:249's passthrough is unobserved");
  if (!comparedChains.some((row) => new Set(row.links).size > 1))
    degenerate.push("no COMPARED probe produces a chain whose links are DIFFERENT classes — a port " +
      "that keeps the failing exception's TYPE instead of its CATEGORY would pass");

  const known = Object.keys(KNOWN_DIVERGENCES).length - stale.length;
  console.log(`\n${SCENARIOS.length - mismatches - known}/${SCENARIOS.length} identical, ` +
    `${known} known divergence(s), ${mismatches} unexplained`);
  console.log(`cause chain compared on ${comparedChains.length} row(s), ` +
    `max depth ${Math.max(0, ...comparedChains.map((row) => row.links.length))}, ` +
    `${comparedChains.filter((row) => row.links.length === 1
      && !RECOGNIZED_BY_JAVAS_LADDERS.has(row.links[0])).length} arm-4 passthrough(s), ` +
    `${comparedChains.filter((row) => new Set(row.links).size > 1).length} mixed-class chain(s)`);
  for (const name of stale)
    console.log(`STALE: '${name}' no longer diverges — remove it from KNOWN_DIVERGENCES`);
  for (const row of miscounted)
    console.log(`COLUMN COUNT: ${row} — PhoneticDiff.java and run.mjs have drifted; a column ` +
      `added at the END of a positional row is otherwise invisible`);
  for (const cls of UNMAPPED_CAUSE_CLASSES)
    console.log(`UNMAPPED CAUSE CLASS: ${cls} — add it to CAUSE_CLASS with the JS spelling it means`);
  for (const reason of degenerate)
    console.log(`DEGENERATE CAUSE-CHAIN SET: ${reason}`);
  process.exit(mismatches === 0 && stale.length === 0 && miscounted.length === 0
    && UNMAPPED_CAUSE_CLASSES.size === 0 && degenerate.length === 0 ? 0 : 1);
}

/** @param {{name:string,fallback:string,request:string,key:string,resolver:string,values:string,catalogs:Record<string,object>}} s */
function runJs(s) {
  /** @type {string[]} */
  const calls = [];
  const resolver = wrap(s.resolver, calls);
  let line;
  try {
    const strings = createStrings({
      fallbackLocale: s.fallback,
      locale: s.instance ?? s.fallback,
      strings: s.catalogs,
      ...(resolver ? { phoneticResolver: resolver } : {}),
    });
    const r = strings.getResult(s.key, valuesFor(s.values), { locale: s.request });
    line = [
      String(r.status).replace(/-/g, "_").toUpperCase(),
      r.translation.replace(/\n/g, "\\n"),
      r.resolvedLocale ?? "-",
      r.failureReason === null || r.failureReason === undefined ? "-" : String(r.failureReason).replace(/-/g, "_").toUpperCase(),
      r.cause === null || r.cause === undefined ? "-" : String(deepest(r.cause)).replace(/\n/g, "\\n"),
      causeShape(r.cause),
    ].join("\t");
  } catch (error) {
    line = `THROWN\t${error instanceof Error ? error.name : "?"}: ${error instanceof Error ? error.message : String(error)}\t-\t-\t-\t${causeShape(error)}`;
  }
  return `${line}\tCALLS[${calls.join(" ;; ")}]`;
}

/**
 * The cause CHAIN, outermost first — what `deepest` throws away, and the port's half of the column
 * `PhoneticDiff.causeShape` emits.
 *
 * A `ResolutionError` spells its CODE here, because plan 3.5 gives ONE class TWO codes and the name
 * alone cannot separate Java's `:1273` arm from its `:1276` arm. Everything else is its `name`.
 *
 * A NON-ERROR IS SPELLED, NEVER SKIPPED. Arm 4 lets an application throw a non-`Error` — a string,
 * a sentinel object — which Java cannot do at all; printing its `typeof` keeps the depth honest
 * instead of silently shortening the chain.
 *
 * @param {unknown} cause
 */
function causeShape(cause) {
  if (cause === null || cause === undefined) return "-";
  /** @type {string[]} */
  const out = [];
  let current = cause;
  while (current !== null && current !== undefined) {
    if (current instanceof Error) {
      const code = /** @type {{code?: unknown}} */ (current).code;
      out.push(code === "RESOLUTION_INVALID_ARGUMENT" || code === "RESOLUTION_INVALID_STATE"
        ? `${current.name}:${code}` : current.name);
    } else {
      out.push(`non-Error(${typeof current})`);
    }
    const next = current instanceof Error ? current.cause : undefined;
    // `cause` may legally point at the error itself; the Java walk guards for it and so does this.
    if (next === current) break;
    current = next;
  }
  return out.join("<");
}

/** @param {unknown} cause */
function deepest(cause) {
  let current = cause;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  return current instanceof Error ? current.message : String(current);
}

function valuesFor(spec) {
  if (!spec) return {};
  /** @type {Record<string, unknown>} */
  const out = Object.create(null);
  for (const pair of spec.split(",,")) {
    const at = pair.indexOf("=");
    const name = pair.slice(0, at);
    const [kind, rest] = split2(pair.slice(at + 1));
    if (kind === "S") out[name] = rest.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    else if (kind === "REPEAT") { const [unit, n] = rest.split("*"); out[name] = unit.repeat(Number(n)); }
    else if (kind === "I" || kind === "D") out[name] = Number(rest);
    else if (kind === "B") out[name] = rest === "true";
    else if (kind === "P") out[name] = forms[`PHONETIC_${rest}`];
    else if (kind === "G") out[name] = forms[`GENDER_${rest}`];
    else if (kind === "N") out[name] = null;
    else throw new Error(`unknown value kind ${kind}`);
  }
  return out;
}

function split2(text) {
  const at = text.indexOf(":");
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1)];
}

/** @param {string} spec @param {string[]} calls */
function wrap(spec, calls) {
  const [behavior, rest] = split2(spec);
  if (behavior === "none") return null;
  /** @type {(term: string, locale: string) => unknown} */
  let delegate;
  /** What Java's call transcript prints for this delegate's throw — see `THROWS`. */
  let javaSimpleName = "?";
  if (behavior === "first-letter-vowel")
    delegate = (term) =>
      typeof term === "string" && term.length > 0 && "aeiouAEIOU".indexOf(term.charAt(0)) >= 0
        ? forms.PHONETIC_VOWEL : forms.PHONETIC_CONSONANT;
  else if (behavior === "constant") delegate = () => forms[rest];
  else if (behavior === "return-null") delegate = () => null;
  else if (Object.hasOwn(THROWS, behavior)) {
    javaSimpleName = THROWS[behavior].java;
    delegate = () => { throw THROWS[behavior].make(); };
  } else if (behavior === "by-locale") {
    const map = new Map(rest.split("|").map((p) => { const [k, v] = p.split("="); return [k, forms[v]]; }));
    delegate = (_term, locale) => map.get(locale) ?? forms.PHONETIC_OTHER;
  } else throw new Error(`unknown resolver ${spec}`);

  return (term, locale) => {
    const head = `${String(term).replace(/\n/g, "\\n")}|${locale}|`;
    try {
      const resolved = delegate(term, locale);
      calls.push(`${head}${resolved === null || resolved === undefined ? "null" : /** @type {any} */ (resolved).renderName}|-`);
      return resolved;
    } catch (error) {
      calls.push(`${head}-|${javaSimpleName}`);
      throw error;
    }
  };
}
