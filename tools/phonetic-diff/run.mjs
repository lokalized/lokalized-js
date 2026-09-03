#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests the JS phonetic axis against the REAL Java one.
 *
 * `PhoneticDiff.java` drives `DefaultStrings` on the pinned JDK and prints, per scenario, the
 * status, the rendered string, the supplying locale, the failure reason and every
 * `PhoneticResolver` invocation in order — term, locale handed, value returned, exception raised.
 * This file drives `createStrings` over the same scenarios and diffs the two transcripts.
 *
 * The resolver channel is why this exists. A port that memoizes by term, or hands the callback the
 * REQUESTED locale instead of the supplying one, renders a byte-identical string in almost every
 * scenario; only the call list separates them.
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
 * Divergences this port makes ON PURPOSE, each with the reason it is not a defect. Anything not
 * listed here fails the run, and an entry that stops diverging fails it too — so the table cannot
 * decay into a list of excuses for behavior that was later fixed.
 */
const KNOWN_DIVERGENCES = {
  // Java prints `value.getClass().getSimpleName()`. One JS `number` is both `Integer` and `Double`,
  // so there is no honest single answer; `boolean` is spelled the JS way for the same reason.
  // A tagged LANGUAGE FORM is the case the port can answer and does — see `javaSimpleNameOf`.
  "value-int": "Java prints Integer; one JS number is both Integer and Double",
  "value-double": "Java prints Double; one JS number is both Integer and Double",
  "value-false": "Java prints the boxed type name Boolean; JS reports the primitive type",
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
};

const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const tsv = SCENARIOS.map((s) => [
  s.name, s.fallback, s.instance, s.request, s.key, s.resolver, s.values,
  Object.entries(s.catalogs).map(([l, c]) => `${l}::${b64(c)}`).join(";;"),
].join("\t")).join("\n");

const work = mkdtempSync(join(tmpdir(), "phonetic-diff-"));
try {
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
  for (const line of run.stdout.split("\n")) {
    if (!line) continue;
    const i = line.indexOf("\t");
    java.set(line.slice(0, i), line.slice(i + 1));
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
  const known = Object.keys(KNOWN_DIVERGENCES).length - stale.length;
  console.log(`\n${SCENARIOS.length - mismatches - known}/${SCENARIOS.length} identical, ` +
    `${known} known divergence(s), ${mismatches} unexplained`);
  for (const name of stale)
    console.log(`STALE: '${name}' no longer diverges — remove it from KNOWN_DIVERGENCES`);
  process.exit(mismatches === 0 && stale.length === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
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
    ].join("\t");
  } catch (error) {
    line = `THROWN\t${error instanceof Error ? error.name : "?"}: ${error instanceof Error ? error.message : String(error)}\t-\t-\t-`;
  }
  return `${line}\tCALLS[${calls.join(" ;; ")}]`;
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
  if (behavior === "first-letter-vowel")
    delegate = (term) =>
      typeof term === "string" && term.length > 0 && "aeiouAEIOU".indexOf(term.charAt(0)) >= 0
        ? forms.PHONETIC_VOWEL : forms.PHONETIC_CONSONANT;
  else if (behavior === "constant") delegate = () => forms[rest];
  else if (behavior === "return-null") delegate = () => null;
  else if (behavior === "throw") delegate = () => { throw new Error("resolver refuses"); };
  else if (behavior === "by-locale") {
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
      calls.push(`${head}-|${error instanceof Error ? "IllegalStateException" : "?"}`);
      throw error;
    }
  };
}
