#!/usr/bin/env node
// @ts-check
/**
 * Differentially tests `normalizeTag` against the REAL `java.util.Locale.forLanguageTag` on the
 * pinned JDK, over the WELL-FORMED tag space the M7 plan row's clause is about.
 *
 *   node tools/direct-tag-diff/run.mjs
 *
 * WHY THIS EXISTS. M7's plan row requires "arbitrary well-formed direct lookup" and "Java-equivalent
 * automatic direct diagnostics". Both rest entirely on one function — `normalizeTag` — and the
 * corpus cannot check it: every locale a fixture loads and every tag a case requests is spelled
 * canonically and well-formed, so a `normalizeTag` that was wrong on any tag the corpus does not
 * happen to contain would leave 2,303 rows green. That is the same shape as the tiebreaker defects
 * `../../../CLAUDE.md` records, and the same shape `tools/language-range-diff/` exists for one door
 * over.
 *
 * IT IS NOT PART OF `npm run verify`, for the same reason its five siblings are not: `verify` has to
 * run in a checkout with no pinned Corretto 21, and a gate that silently passes when its oracle is
 * missing has stopped gating. A green `verify` says nothing about this tool and it must be named
 * separately.
 *
 * THE TWO QUESTIONS ARE KEPT APART, and that separation is the finding this tool was built to make
 * legible. The JDK has two entry points and they disagree by design:
 *
 *   - `new Locale.Builder().setLanguageTag(tag)` THROWS on an ill-formed tag. It is the JDK's own
 *     definition of well-formed, so this differential never has to invent one — which matters,
 *     because the clause under test is scoped to well-formed tags and a hand-drawn boundary would
 *     be answering a question nobody asked.
 *   - `Locale.forLanguageTag(tag)` never throws. It TRUNCATES at the first ill-formed subtag and
 *     keeps the prefix: `no-NO-NY` becomes `no-NO`, `toolongtag` becomes `und`, `en--US` becomes
 *     `en`. The port's `normalizeTag` raises `RangeError` for that whole class instead.
 *
 * So there are two verdicts, not one, and only the first is M7's:
 *
 *   WELL-FORMED (in scope). `normalizeTag(tag)` must equal `forLanguageTag(tag).toLanguageTag()`.
 *   ILL-FORMED (outside the clause, gated in both directions). Java truncates; the port refuses.
 *     No corpus row discriminates it, but the plan does have a sentence — two — and they prescribe
 *     the port's refusal. DECIDED at M7 close and unchanged; see `ILL_FORMED_CONTRACT` below for
 *     the citations, the shape of the 82 rows, and what this run does and does not gate.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const specDir = process.env.LOKALIZED_SPEC_DIR
  ? resolve(process.env.LOKALIZED_SPEC_DIR)
  : resolve(root, "../lokalized-spec");
const JDK = process.env.LOKALIZED_ORACLE_JDK ?? "/Users/agents/Java/amazon-corretto-21.jdk/Contents/Home";

const version = spawnSync(join(JDK, "bin/java"), ["-version"], { encoding: "utf8" });
if (version.status !== 0) {
  console.error(`pinned JDK not usable at ${JDK}\nset LOKALIZED_ORACLE_JDK, or skip this differential`);
  process.exit(2);
}

/**
 * The probe space: every tag the corpus spells, plus the shapes it never reaches.
 *
 * Section (1) is the overlap with the runner — a disagreement there and a conformance FAILED are the
 * same defect seen twice. Everything after it is what the corpus is blind to.
 */
function inputs() {
  /** @type {Set<string>} */
  const set = new Set();

  // (1) Every locale tag the corpus actually spells: fixture catalog keys, fallbacks, instance
  // locales, and each case's requested `locale`.
  const corpus = JSON.parse(readFileSync(join(specDir, "generated/behavioral-vectors.json"), "utf8"));
  for (const fixture of Object.values(corpus.fixtures)) {
    for (const tag of Object.keys(/** @type {any} */ (fixture).files ?? {})) set.add(tag);
    for (const tag of Object.keys(/** @type {any} */ (fixture).rawFiles ?? {})) set.add(tag);
    for (const tag of [/** @type {any} */ (fixture).fallbackLocale, /** @type {any} */ (fixture).instanceLocale])
      if (typeof tag === "string") set.add(tag);
  }
  for (const testCase of corpus.cases)
    for (const field of ["locale", "lookupLocale"])
      if (typeof testCase.input?.[field] === "string") set.add(testCase.input[field]);

  // (2) THE CARTESIAN SWEEP. Language x script x region x variant, over subtag values chosen because
  // each is a shape the canonicalization walk treats specially: legacy/deprecated languages that
  // CLDR aliases (`iw`, `in`, `ji`, `mo`, `sh`, `tl`), extlang carriers (`cmn`, `yue`, `nan`), the
  // undetermined language, private-use primaries (`qaa`), numeric and macro regions (`419`, `001`,
  // `810`, `840`), the private-use script range (`Qaaa`), and the four variant lengths the grammar
  // admits (`1901` digit-initial 4, `POSIX` 5, `alalc97` alphanumeric 7, `valencia` 8).
  const languages = ["en", "fr", "de", "zh", "ar", "no", "nb", "nn", "sr", "sh", "hy", "iw", "in",
    "ji", "tl", "fil", "mo", "ro", "cmn", "yue", "nan", "jbo", "tlh", "ase", "und", "qaa"];
  const scripts = ["Latn", "Cyrl", "Hans", "Hant", "Arab", "Qaaa"];
  const regions = ["US", "GB", "CN", "TW", "419", "001", "810", "840", "QM", "ZZ"];
  const variants = ["1901", "POSIX", "posix", "fonipa", "alalc97", "heploc", "valencia", "rozaj"];

  for (const language of languages) {
    set.add(language);
    for (const script of scripts) {
      set.add(`${language}-${script}`);
      for (const region of regions) {
        set.add(`${language}-${script}-${region}`);
        for (const variant of variants) set.add(`${language}-${script}-${region}-${variant}`);
      }
    }
    for (const region of regions) {
      set.add(`${language}-${region}`);
      for (const variant of variants) set.add(`${language}-${region}-${variant}`);
    }
  }

  // (3) THE `x-lvariant` FAMILY, which is why this tool found anything. `forLanguageTag` treats a
  // private-use subtag beginning `x-lvariant-` as the carrier for a Java `variant` that BCP 47 has no
  // room for, folds it back out of the private-use sequence, and `toLanguageTag()` then re-emits it
  // in canonical position. The three legacy compatibility locales additionally regain a Unicode
  // extension (`ja-JP-JP` its calendar, `th-TH-TH` its numbering system) or become a different
  // language outright (`no-NO-NY` -> `nn-NO`). Every one of these is WELL-FORMED, so it is squarely
  // inside the clause; none is reachable from the corpus.
  for (const tag of ["en-US-x-lvariant-POSIX", "en-US-x-lvariant-posix", "en-us-x-lvariant-posix",
    "ja-JP-x-lvariant-JP", "th-TH-x-lvariant-TH", "no-NO-x-lvariant-NY", "de-DE-x-lvariant-1901",
    "en-x-lvariant-POSIX", "en-US-x-lvariant", "en-US-x-lvariant-a-b", "en-US-x-a-lvariant-POSIX"])
    set.add(tag);

  // (4) EXTENSIONS AND SINGLETONS: the `u`/`t`/`a` singletons, ordering inside them (Java sorts
  // extension keys), the private-use tail, and a bare private-use tag.
  for (const tag of ["en-u-ca-buddhist", "en-US-u-ca-gregory-nu-latn", "en-US-u-nu-latn-ca-gregory",
    "ja-JP-u-ca-japanese", "th-TH-u-nu-thai", "en-US-u-va-posix", "en-t-jp", "en-US-t-en-latn",
    "en-a-bbb-x-a-ccc", "en-x-private", "x-private", "en-US-x-a", "en-Latn-US-u-ca-gregory-x-a"])
    set.add(tag);

  // (4b) THE EDGES OF THE TWO REWRITES FIXED IN THIS SLICE. Section (3) and (4) probe the shapes the
  // defects were REPORTED on; these probe the shapes a plausible-looking fix gets wrong, and each is
  // paired with a control the fix must NOT move.
  //
  //   - the variant lift interacting with a real variant, with a second `lvariant`, and with another
  //     private-use subtag on either side of the marker;
  //   - the compatibility extensions, which `forLanguageTag` synthesizes ONLY when the locale carries
  //     no extension of its own and ONLY for a variant spelled exactly `JP`/`TH` — so `ja-JP-a-b-…`
  //     and `…-x-lvariant-jp` are the controls that keep the synthesis from firing everywhere;
  //   - `no-NO-NY`, whose neighbours (`nn-NO`, a lowercase `ny`, a scripted `no-Latn-NO`) must not
  //     become Nynorsk;
  //   - the `-u-` payload, which is a SET of attributes and a MAP of keywords rather than a subtag
  //     list: sorted, deduplicated first-wins, an empty type emitted bare, and — the edge a
  //     paraphrase loses — a 2-char subtag after a dropped duplicate key read as a NEW key.
  for (const tag of ["en-US-1901-x-lvariant-POSIX", "en-US-x-lvariant-lvariant-POSIX",
    "en-US-x-a-b-lvariant-POSIX-Q", "en-US-x-lvariant-POSIX-x", "ja-JP-a-bbb-x-lvariant-JP",
    "ja-JP-u-ca-gregory-x-lvariant-JP", "ja-JP-x-lvariant-jp", "ja-Latn-JP-x-lvariant-JP",
    "th-TH-a-bbb-x-lvariant-TH", "no-Latn-NO-x-lvariant-NY", "nn-NO", "no-NO", "ja-JP", "th-TH",
    "en-u-ca-gregory-ca-japanese", "en-u-ca-x1-ca-x2", "en-u-nu-latn-ca", "en-u-ca-nu-latn",
    "en-u-zzzz-aaaa-ca-gregory", "en-u-aaaa-zzzz-ca-gregory", "en-US-u-ca-gregory-nu-latn-t-en-latn",
    "en-US-t-en-latn-u-ca-gregory", "en-a-bbb-u-ca-gregory", "en-u-ca-gregory-a-bbb",
    "en-u-ca-buddhist-u-nu-thai", "en-u-va-posix-x-lvariant-POSIX"])
    set.add(tag);

  // (5) THE LEGACY (grandfathered) TAGS, which `forLanguageTag` rewrites wholesale, plus the extlang
  // forms the JDK folds into their preferred value.
  for (const tag of ["i-klingon", "i-ami", "i-bnn", "i-default", "i-enochian", "i-hak", "i-lux",
    "i-mingo", "i-navajo", "i-pwn", "i-tao", "i-tay", "i-tsu", "art-lojban", "cel-gaulish",
    "no-bok", "no-nyn", "zh-guoyu", "zh-hakka", "zh-min", "zh-min-nan", "zh-xiang", "en-GB-oed",
    "sgn-BE-FR", "sgn-BE-NL", "sgn-CH-DE", "sgn-US", "zh-cmn", "zh-cmn-Hans-CN", "zh-yue", "zh-nan"])
    set.add(tag);

  // (6) CASE. `toLanguageTag` canonicalizes case per position — language lower, script title, region
  // upper, variant AS WRITTEN. That last one is the trap: `en-US-POSIX` and `en-US-posix` are two
  // different tags, which is exactly the collision `DefaultStrings.java:280` refuses at construction.
  for (const tag of [...set])
    if (/^[A-Za-z0-9-]+$/.test(tag)) {
      set.add(tag.toUpperCase());
      set.add(tag.toLowerCase());
    }

  // (7) THE ILL-FORMED CLASSES, present ON PURPOSE. They are compared under a different verdict
  // (`ILL_FORMED_CONTRACT`), and their whole job is to keep the well-formed count honest: a probe
  // space of only well-formed tags could not tell "the port agrees with Java" from "the port accepts
  // everything Java accepts and a great deal more".
  for (const tag of ["", " ", "-", "--", "en-", "-en", "en--US", "en-US-", "e", "toolongtag",
    "no-NO-NY", "ja-JP-JP", "th-TH-TH", "en-US-@-x", "en US", "en_US", "en-US-x", "en-*",
    "*", "1", "1-a", "en-123456789", "abcdefghi", "en-Latn-", "en-Latn-US-", "zh-\u{10400}",
    "\u{10400}", "fr-é", "中文", "en\ud800", "fr;q=0.5", "en,fr", "en-US,en"])
    set.add(tag);

  return [...set];
}

/**
 * Divergences that are DELIBERATE AND CORRECT — a port decision the JDK does not share.
 *
 * Empty. Anything added here needs a Java-source or JDK-measured argument for why the port is RIGHT
 * to differ; "the corpus stays green" is not one, because the corpus is blind to every row in this
 * file.
 *
 * KEYS ARE EXACT TAGS, not families — this table is consumed by `row.tag` equality, unlike
 * `OPEN_PORT_DEFECTS` below, which is consumed by lowercased substring. The two rules used to share
 * one pre-run existence check written for the substring form, which HARD-REJECTED any key carrying
 * an uppercase letter even when it was a verbatim probe: `"en-US"` threw `is listed … but NO probe
 * carries it`. A deliberate divergence on a mixed-case tag such as `en-US-x-lvariant-POSIX` could
 * not have been recorded at all. Each table is now checked by its own rule.
 *
 * STALENESS IS CHECKED, and until this session that sentence was FALSE — a claim the file made
 * about itself rather than a gate it had. The `stale` list was populated only from
 * `OPEN_PORT_DEFECTS`; this table's arm was a bare `wellFormedAgree++`, which also folded declared
 * divergences into the "identical" headline. Measured: a bogus entry `{"en-us": "…does not diverge
 * at all"}` left the run at `46369/46369 … 0 unexplained`, printed no STALE line, and exited 0.
 * Latent only because the table is empty — exactly the shape `CLAUDE.md`'s "known-gap lists rot"
 * lesson forbids. Consumption is now recorded per key, an unconsumed key fails the run as STALE,
 * and consumed rows are counted and printed SEPARATELY from the identical ones.
 *
 * @type {Record<string, string>}
 */
const KNOWN_DIVERGENCES = {};

/**
 * Measured PORT DEFECTS: the port is wrong, the cause is known, and the fix is not made here.
 *
 * NOT `KNOWN_DIVERGENCES`. These do not excuse anything and do not make the run green — the run
 * exits non-zero while any of them stands. They are listed so the failure prints its own root cause
 * instead of arriving as anonymous mismatches, and so a reviewer can tell a triaged defect from a
 * fresh regression. Each entry is a FAMILY, matched as a prefix of the probe, because one cause
 * poisons every tag that carries the shape.
 *
 * EMPTY, and its emptiness is a MEASUREMENT rather than a claim: an entry that stops diverging fails
 * the run as STALE, so this table cannot rot into a list of excuses and cannot be quietly emptied by
 * deleting a probe either — every family key is checked against the probe space before the sweep
 * runs, and a key no probe carries is a hard error.
 *
 * WHAT USED TO BE HERE, kept because the next reader needs to know these shapes were measured and
 * not merely assumed. Both entries were closed at their cause in `src/internal/locale-jdk-tag.js` by
 * modelling `Locale.forLanguageTag`'s actual pipeline — tag -> `BaseLocale` + sorted
 * `LocaleExtensions` -> `toLanguageTag` — instead of re-serializing the parse:
 *
 *   - `lvariant`. `forLanguageTag` reads a private-use subtag beginning `lvariant-` as the carrier
 *     for a Java `variant` BCP 47 has no slot for and LIFTS it into `Locale#getVariant`. Three
 *     distinct JDK behaviours ride on that one lift, and all three are now reproduced: the lift
 *     itself (`en-US-x-lvariant-POSIX` -> `en-US-POSIX`), the compatibility-extension synthesis
 *     (`ja-JP-x-lvariant-JP` -> `ja-JP-u-ca-japanese-x-lvariant-JP`, `th-TH` likewise), and the
 *     `no-NO-NY` -> `nn-NO` rewrite, which changes the LANGUAGE and therefore the answering catalog.
 *     Probed end-to-end on both sides against catalogs {nn, nb, fr} with fallback fr, before and
 *     after: `no-NO-x-lvariant-NY` answered NYNORSK in Java and BOKMAAL in the port before, and
 *     NYNORSK on both sides after, with `no-NO` (BOKMAAL) and `nn` (NYNORSK) as the controls that
 *     make the moving row evidence rather than assertion.
 *   - `u-nu-latn-ca-gregory`. A `-u-` payload is not a subtag list to a `Locale`: it is a SET of
 *     attributes and a MAP of keyword->type, both of which come back out sorted, so
 *     `en-US-u-nu-latn-ca-gregory` and `en-US-u-ca-gregory-nu-latn` are ONE locale to Java and were
 *     two to the port. DIAGNOSTIC-ONLY, and an earlier draft of this paragraph overclaimed it: it
 *     said the pair is "a duplicate `DefaultStrings.java:280` refuses in Java". MEASURED on the
 *     pinned Corretto 21, it is not and cannot be — `forLanguageTag` returns the SAME INTERNED
 *     INSTANCE for both spellings, Java's supplier is keyed `Map<Locale, …>`, so a `LinkedHashMap`
 *     given both holds ONE entry, the second `put` silently replaces the first, and `:277-282` is
 *     never reached. Java's nearest observable behaviour is dropping a catalog without a word.
 *     The port keys by STRING, sees the pair, and refuses it: a defensible PORT CHOICE, recorded
 *     as one in `test/jdk-tag-locale-conversion.test.js`, not as parity. The shape that DOES
 *     corroborate at `:277-282` is the private-use CASING pair `en-US-x-lvariant-POSIX` /
 *     `en-US-x-lvariant-posix` — two distinct `Locale`s in Java, where `Strings.build()` throws
 *     `Localized strings locales 'en_US_POSIX' and 'en_US_posix' both use IETF BCP 47 language tag
 *     'en-US-posix'` and the port now throws the same sentence in BCP 47 spellings.
 *
 * Section (4b) of `inputs()` is the probe space that keeps both closed. It carries the edges a
 * plausible-looking fix gets wrong — a lift beside a real variant, a compatibility extension
 * SUPPRESSED by another extension, a lowercase `jp` that must NOT trigger it, `nn-NO`/`no-NO`
 * controls beside `no-NO-x-lvariant-NY`, and the `-u-` duplicate-key edge where a 2-character subtag
 * after a dropped repeat is re-read as a new key.
 *
 * @type {Record<string, string>}
 */
const OPEN_PORT_DEFECTS = {};

/**
 * THE ILL-FORMED CONTRACT — DECIDED AT M7 CLOSE, and decided from the plan's own words.
 *
 * `Locale.forLanguageTag` truncates at the first ill-formed subtag; `normalizeTag` throws a
 * `RangeError`. **The port's refusal stands, it is OUTSIDE the M7 acceptance row's clause, and this
 * differential is its gate.** Nothing about the port changed to record that.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT WAS WRONG. It said the difference was "a contract decision
 * with no corpus row and no plan sentence". The corpus half is true. The plan half is FALSE, and it
 * decides the question:
 *
 *   `IMPLEMENTATION-PLAN-v7.md` §2.2 — "A direct locale is a lookup request, not a catalog selector.
 *     Any input that normalizes to a well-formed tag is accepted whether or not it is loaded […]
 *     **Malformed direct input fails at its validation boundary before candidate resolution**,
 *     fallback policy/observation, or failure handling".
 *   …and §3.3 again, for the per-call argument — "A direct per-call `locale` and a value returned by
 *     `localeResolver` need only normalize to a well-formed tag; unknown and unloaded tags are valid
 *     lookup requests and enter candidate resolution. **Malformed tags fail before candidate
 *     resolution.**"
 *
 * So the plan scopes the acceptance clause to well-formed tags in the same breath in which it
 * prescribes REFUSAL for everything else, and the port does exactly that. Java's truncation is a
 * `java.util.Locale` leniency the plan knowingly did not adopt — the revision-7 header restores
 * "Java's direct-locale contract" for the *well-formed* tag, not `forLanguageTag`'s parser.
 *
 * WHAT THE 82 ROWS ACTUALLY ARE, which is the part an argument from principle misses. They are not
 * near-miss tags. Truncation maps `"readme.txt"`, `"catalog.json"`, `".DS_Store"`, `"not a tag"`,
 * `" "` and `""` to `und`; `"en-US,en"` (a whole `Accept-Language` header) to `en`; `"de-de.json"`
 * to `de`; and `"zh-min-nan.json"` to **`min`** — a language nobody wrote. Adopting truncation would
 * make `createStrings({ locale: "readme.txt" })` a silent request for `und`. That is the concrete
 * shape of §2.2's "fails at its validation boundary".
 *
 * The two readings are kept, because the trade is real and a future reader should see it:
 *
 *   - TRUNCATE (Java). `strings.get(key, ph, { locale: navigator.language })` never throws, and a
 *     browser that hands over a legacy `no-NO-NY` still gets Norwegian. It also means a typo silently
 *     serves a different locale: `en-Latin-US` renders as `en` with no signal anywhere.
 *   - REFUSE (the port, and the plan). Every ingress reports a malformed tag at the site that spelled
 *     it, which is the reason `forLocale` exists at all. The cost is that a caller forwarding a
 *     hostile `Accept-Language` value must catch — which `lokalized/negotiate`'s fail-soft
 *     `bestMatchForAcceptLanguage` and C2's chooser both already do on the caller's behalf.
 *
 * AND IT IS NOT A LENIENCY TOGGLE, which is why "just match Java" was never the cheap option:
 * `en-Latin-US` truncates to a tag Java then REFUSES as a duplicate, so both sides throw and only
 * the error class differs. Any future move here has to cover that shape too.
 *
 * TWO LIMITS ON THE DECISION, so it is not read as wider than it is:
 *
 *   - It is scoped to DIRECT LOOKUP and construction keys, which is what M7 owns. Filenames are in
 *     this bucket only because the corpus spells them (`de.json`, `readme.txt`); what a directory
 *     LOADER does with a file it cannot parse as a tag — skip it, or admit it as `und` the way
 *     `LocalizedStringLoader` does — is M8's to decide and is not decided here.
 *   - The plan's `LokalizedError` hierarchy with a `code` field has still not landed, so the port
 *     signals this with a bare `RangeError`. The refusal is contracted; its ERROR TYPE is not.
 *
 * HOW THIS RUN GATES IT — in both directions, and neither is the count. The bucket must not go
 * EMPTY (the probe space stopped covering the class, and every claim here would be vacuous) and the
 * port must REFUSE every member (`illFormedAccepted` is a term of the exit expression). What is
 * deliberately NOT gated is the number 82: the probe space grows whenever a slice adds an edge, and
 * ratcheting it would be the "exact counts, not floors" mistake this project has already made.
 */
const ILL_FORMED_CONTRACT =
  "Java TRUNCATES at the first ill-formed subtag; the port raises RangeError. DECIDED at M7 close: " +
  "the port's refusal is what plan §2.2 and §3.3 require (\"Malformed direct input fails at its " +
  "validation boundary before candidate resolution\"), and the clause the M7 row gates is scoped to " +
  "WELL-FORMED tags. Outside the clause, unchanged, gated here. See ILL_FORMED_CONTRACT in this file. " +
  "MEASURED end-to-end on both sides against catalogs {nn, nb, fr} with fallback fr: `no-NO-NY` is " +
  "TRANSLATED by Java from the `nb` catalog (it truncates to `no-NO`; it does NOT reach `nn`, which " +
  "only the well-formed `no-NO-x-lvariant-NY` does) and raises RangeError in the port. But " +
  "truncation is not blanket leniency either: `en-Latin-US` truncates to a tag Java then refuses " +
  "with `Attempted locales must not contain duplicate language tag 'en-latin'`, so BOTH sides throw " +
  "and only the class of error differs. Any decision here has to cover both shapes.";

const work = mkdtempSync(join(tmpdir(), "lokalized-tagdiff-"));
try {
  const classesOut = join(work, "classes");
  const compile = spawnSync(join(JDK, "bin/javac"), ["-d", classesOut, join(here, "DirectTagDiff.java")], {
    encoding: "utf8",
  });
  if (compile.status !== 0) throw new Error(`oracle compilation failed:\n${compile.stderr}`);

  const probes = inputs();

  // BOTH TABLES ARE CHECKED AGAINST THE PROBE SPACE BEFORE ANYTHING RUNS. An entry no probe carries
  // is never compared, never stale, and would still be counted in the headline — the `zh-123` shape
  // at harness level, which `tools/language-range-diff/` already had to fix once.
  //
  // EACH TABLE IS CHECKED BY THE RULE THAT ACTUALLY CONSUMES IT, which is the fix for a second
  // `zh-123` in this very check: it applied the OPEN_PORT_DEFECTS substring rule to both tables,
  // so a KNOWN_DIVERGENCES key with any uppercase letter was hard-rejected before the sweep ran
  // even when it was a verbatim probe (`"en-US"` threw). KNOWN_DIVERGENCES is matched by exact tag
  // equality below, so it is checked by exact membership here.
  for (const tag of Object.keys(KNOWN_DIVERGENCES))
    if (!probes.includes(tag))
      throw new Error(
        `'${tag}' is listed in KNOWN_DIVERGENCES but is NOT a probe. That table is consumed by ` +
          "EXACT tag equality, so the entry can never be compared and can never go stale. Add the " +
          "tag to inputs() or remove the entry.",
      );

  for (const family of Object.keys(OPEN_PORT_DEFECTS))
    if (!probes.some((probe) => probe.toLowerCase().includes(family)))
      throw new Error(
        `'${family}' is listed in OPEN_PORT_DEFECTS but NO probe carries it, so the staleness ` +
          "check can never see it. Widen inputs() or remove the entry.",
      );

  const inPath = join(work, "probes.txt");
  const outPath = join(work, "answers.txt");
  writeFileSync(inPath, `${probes.map((probe) => JSON.stringify(probe)).join("\n")}\n`, "utf8");

  const run = spawnSync(join(JDK, "bin/java"), ["-cp", classesOut, "com.lokalized.DirectTagDiff", inPath, outPath], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`oracle execution failed:\n${run.stderr}`);

  const { normalizeTag } = await import("../../src/internal/locale.js");
  const rows = readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  let wellFormedAgree = 0;
  let illFormedRefused = 0;
  /** Exact tags whose divergence a `KNOWN_DIVERGENCES` entry actually explained on THIS run. */
  const knownDivergencesConsumed = new Set();
  /** @type {{tag: string, java: string, js: string}[]} */
  const differences = [];
  /** @type {{tag: string, java: string, js: string, family: string}[]} */
  const defects = [];
  /** @type {{tag: string, java: string, js: string}[]} */
  const illFormedAccepted = [];
  /** @type {{tag: string, java: string}[]} */
  const illFormedTruncated = [];
  /** @type {string[]} */
  const stale = [];
  /** @type {string[]} */
  const agreeingFamilyMembers = [];

  for (const row of rows) {
    /** @type {string | null} */
    let actual = null;
    let refused = false;
    try {
      actual = normalizeTag(row.tag);
    } catch {
      refused = true;
    }

    if (!row.wellFormed) {
      // The ill-formed bucket. Reported, never gated — except that the port must still REFUSE.
      if (refused) {
        illFormedRefused++;
        illFormedTruncated.push({ tag: row.tag, java: row.normalized });
      } else {
        illFormedAccepted.push({ tag: row.tag, java: row.normalized, js: /** @type {string} */ (actual) });
      }
      continue;
    }

    // The well-formed bucket: M7's clause, and the only one that gates.
    const family = Object.keys(OPEN_PORT_DEFECTS).find((key) => row.tag.toLowerCase().includes(key)) ?? null;

    if (!refused && actual === row.normalized) {
      // A FAMILY MEMBER THAT AGREES IS NOT A STALE ENTRY, and reading it as one was a real defect in
      // this file: it printed eight `STALE: x-lvariant` lines while the family was diverging on nine
      // other probes, which is an entry demanding to be deleted at the moment it is most load-bearing.
      // The rule that survives is the family-level one below — an entry NO probe diverges on is stale
      // and fails the run. The agreeing members are printed instead, because they are how a reviewer
      // narrows an entry that has partially healed, and because in this family they carry a finding:
      // MEASURED on the pinned Corretto 21, `forLanguageTag` lifts `x-lvariant-posix` and
      // `x-lvariant-1901` (well-formed Java variants) but NOT `x-lvariant-ny`, `-jp` or `-th`, whose
      // two-character values no variant grammar admits — and the three legacy compat rewrites need
      // the exact uppercase spelling, so `NO-NO-X-LVARIANT-NY` becomes `nn-NO` while
      // `no-no-x-lvariant-ny` stays put and the port agrees with it.
      if (family !== null) agreeingFamilyMembers.push(`${family}: ${JSON.stringify(row.tag)}`);
      wellFormedAgree++;
      continue;
    }

    const difference = { tag: row.tag, java: row.normalized, js: refused ? " REFUSED" : /** @type {string} */ (actual) };
    if (family !== null) defects.push({ ...difference, family });
    // A DECLARED DIVERGENCE IS NOT AN AGREEMENT, and counting it as one inflated the headline. It
    // is recorded as consumed — which is what makes the staleness gate below real — and counted in
    // its own bucket, printed beside the identical count rather than folded into it.
    else if (Object.hasOwn(KNOWN_DIVERGENCES, row.tag)) knownDivergencesConsumed.add(row.tag);
    else differences.push(difference);
  }

  const wellFormed =
    wellFormedAgree + knownDivergencesConsumed.size + differences.length + defects.length;
  const families = Object.keys(OPEN_PORT_DEFECTS).filter((key) => defects.some((d) => d.family === key));
  for (const key of Object.keys(OPEN_PORT_DEFECTS))
    if (!families.includes(key)) stale.push(`${key} (no probe diverges any more)`);

  // The same gate for the other table, mirrored deliberately rather than shared: an entry that has
  // stopped diverging is a claim the port no longer makes, and leaving it standing is how a
  // known-gap list rots into a list of excuses.
  for (const tag of Object.keys(KNOWN_DIVERGENCES))
    if (!knownDivergencesConsumed.has(tag))
      stale.push(`${JSON.stringify(tag)} (KNOWN_DIVERGENCES: this tag no longer diverges)`);

  console.log(
    `Locale.forLanguageTag differential against Java on the pinned JDK: ` +
      `${wellFormedAgree}/${wellFormed} well-formed tags identical, ` +
      `${knownDivergencesConsumed.size} declared divergence(s), ` +
      `${families.length} open port defect(s) over ${defects.length} probe(s), ` +
      `${differences.length} unexplained; ` +
      `${illFormedRefused} ill-formed tag(s) refused by the port and truncated by Java, ` +
      `${illFormedAccepted.length} ill-formed tag(s) WRONGLY ACCEPTED`,
  );

  const show = (/** @type {{tag: string, java: string, js: string}} */ d) =>
    console.log(`\n  ${JSON.stringify(d.tag)}\n    java ${JSON.stringify(d.java)}\n    js   ${JSON.stringify(d.js)}`);

  if (defects.length) {
    console.log(`\nOPEN PORT DEFECTS (${families.length}) — triaged, root cause known, NOT fixed here.`);
    for (const key of families) {
      console.log(`\n[${key}]\n  ${OPEN_PORT_DEFECTS[key]}`);
      for (const defect of defects.filter((d) => d.family === key)) show(defect);
    }
  }

  if (knownDivergencesConsumed.size) {
    console.log(`\nDECLARED DIVERGENCES (${knownDivergencesConsumed.size}) — the port differs ON PURPOSE:`);
    for (const tag of knownDivergencesConsumed)
      console.log(`  ${JSON.stringify(tag)}\n    ${KNOWN_DIVERGENCES[tag]}`);
  }

  if (differences.length) {
    console.log(`\nUNEXPLAINED WELL-FORMED DIFFERENCES (${differences.length}):`);
    for (const difference of differences.slice(0, 20)) show(difference);
  }

  // The label matters: this bucket IS gated — the run fails if it goes empty or if the port accepts
  // a member — and only its COUNT is a floor rather than a ratchet. It read "REPORTED NOT GATED"
  // until M7 close, which understated two terms of the exit expression twelve lines below. The same
  // wording defect this repository already corrected once, on the cause-message channel.
  console.log(`\nILL-FORMED — GATED IN BOTH DIRECTIONS, COUNT NOT RATCHETED (${illFormedTruncated.length}). ${ILL_FORMED_CONTRACT}`);
  for (const row of illFormedTruncated.slice(0, 12))
    console.log(`  ${JSON.stringify(row.tag)} -> java ${JSON.stringify(row.java)}, js RangeError`);
  if (illFormedTruncated.length > 12) console.log(`  ... ${illFormedTruncated.length - 12} more`);

  if (illFormedAccepted.length) {
    console.log(`\nILL-FORMED TAGS THE PORT ACCEPTED (${illFormedAccepted.length}) — the contract moved:`);
    for (const row of illFormedAccepted.slice(0, 20)) show(row);
  }

  if (agreeingFamilyMembers.length) {
    console.log(
      `\nFAMILY MEMBERS THAT AGREE (${agreeingFamilyMembers.length}) — reported, not gated. These ` +
        "carry a listed family's shape and yet match Java, so they bound how wide each entry above " +
        "really is. An entry whose members ALL agree is stale and fails the run.",
    );
    for (const member of agreeingFamilyMembers) console.log(`  ${member}`);
  }

  for (const entry of stale) console.log(`STALE: ${entry} — remove it from its table`);

  // The ill-formed bucket must not be EMPTY: an empty bucket means the probe space stopped covering
  // the class this file exists to characterize, and every claim above about it would be vacuous.
  if (illFormedTruncated.length === 0 && illFormedAccepted.length === 0)
    console.log("STALE: no ill-formed probe reached the oracle — inputs() section (7) has gone empty");

  process.exit(
    differences.length === 0 &&
      defects.length === 0 &&
      illFormedAccepted.length === 0 &&
      stale.length === 0 &&
      illFormedTruncated.length > 0
      ? 0
      : 1,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
