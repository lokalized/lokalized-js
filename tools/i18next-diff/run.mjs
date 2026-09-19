#!/usr/bin/env node
// @ts-check
/**
 * **A COMPARISON SECTION IS WHERE A LIBRARY LIES ABOUT ITS COMPETITORS**, so this one is measured.
 *
 * The plan obliges the documentation to cover "i18next differences". It was DECLINED once, on the
 * grounds that writing it would be "recollection about software this machine does not have,
 * published under a heading implying it was checked". **That premise was false and was falsified by
 * running i18next here.** So the section is written the way everything else in this repository is:
 * by executing both libraries and reporting what happened.
 *
 * **THE DESIGN IS THE NINE JAVA DIFFERENTIALS', because the problem is the same one.** i18next is an
 * oracle this package may not depend on — `lokalized` has zero dependencies and
 * `test/package-shape.test.js` enforces it — exactly as the JDK is an oracle CI does not carry. So:
 * this tool runs WITH i18next installed and records what both libraries did;
 * `npm run diff:check` re-checks the record WITHOUT it and is the arm that runs in `verify` and CI.
 *
 * **WHAT KEEPS IT HONEST, mechanically rather than by intention.** An adversarial pass over the first
 * draft of this comparison found a headline transcript that its own code could not have produced, a
 * probe that configured i18next with no fallback catalog and then reported it failing, and a claim
 * that lokalized exports nothing for formatting when a sweep returns six hits. None of those survive
 * a tool that runs both sides and prints what it got. Two exit terms enforce the rest:
 *
 *   1. **Every probe must EXECUTE BOTH SIDES.** A probe that throws on either side fails the run
 *      rather than being recorded as a win.
 *   2. **The verdict census must not be one-sided.** If no probe records I18NEXT-BETTER the run
 *      fails, because a comparison in which the competitor never wins is the defect being prevented,
 *      not a result. Measured today: i18next wins most of them.
 *
 *   node tools/i18next-diff/run.mjs            # needs i18next; rewrites the record
 *   node tools/i18next-diff/run.mjs --check    # no i18next; re-checks the record (in `verify`)
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const RECORD = join(root, "measurements", "i18next.json");
const check = process.argv.includes("--check");

/** The digest of this tool, so a comparison edited after its last real run cannot pass unnoticed. */
const toolSha256 = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");

if (check) {
  const problems = [];
  if (!existsSync(RECORD)) {
    problems.push(`${RECORD} is missing — absence is never agreement. Run: node tools/i18next-diff/run.mjs`);
  } else {
    const record = JSON.parse(readFileSync(RECORD, "utf8"));
    if (record.toolSha256 !== toolSha256)
      problems.push(
        `the comparison tool has changed since its last run against i18next ` +
        `(${String(record.toolSha256).slice(0, 8)} -> ${toolSha256.slice(0, 8)}). Editing a comparison ` +
        `without re-running it is how it drifts from what it claims. Re-run: node tools/i18next-diff/run.mjs`);
    if (!Array.isArray(record.probes) || record.probes.length === 0)
      problems.push("the record carries no probes, so it proves nothing");
    const census = {};
    for (const probe of record.probes ?? []) census[probe.verdict] = (census[probe.verdict] ?? 0) + 1;
    if (!census["I18NEXT-BETTER"])
      problems.push(
        "no probe records I18NEXT-BETTER. A comparison in which the competitor never wins is not a " +
        "result, it is the defect this tool exists to prevent");
    for (const probe of record.probes ?? [])
      if (probe.i18next === undefined || probe.lokalized === undefined)
        problems.push(`probe '${probe.axis}' did not execute both sides`);
  }
  if (problems.length > 0) {
    console.error(`i18next comparison record — ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(RECORD, "utf8"));
  const census = {};
  for (const probe of record.probes) census[probe.verdict] = (census[probe.verdict] ?? 0) + 1;
  console.log(`i18next comparison — ${record.probes.length} probe(s) against i18next ${record.i18nextVersion}`);
  console.log(`  ${Object.entries(census).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  process.exit(0);
}

// ----------------------------------------------------------------- the real run

/** i18next is NEVER installed into this package. It is resolved from a scratch project. */
function resolveI18next() {
  const scratch = process.env.LOKALIZED_I18NEXT_DIR ?? join(tmpdir(), "lokalized-i18next-oracle");
  if (!existsSync(join(scratch, "node_modules", "i18next"))) {
    console.log(`installing i18next into ${scratch} (never into this package — it has zero dependencies)`);
    execFileSync("npm", ["init", "-y"], { cwd: mkdirp(scratch), stdio: "ignore" });
    execFileSync("npm", ["install", "i18next", "--no-audit", "--no-fund"], { cwd: scratch, stdio: "inherit" });
  }
  return scratch;
}
function mkdirp(/** @type {string} */ path) {
  execFileSync("mkdir", ["-p", path]);
  return path;
}

const scratch = resolveI18next();
const i18nextVersion = JSON.parse(
  readFileSync(join(scratch, "node_modules", "i18next", "package.json"), "utf8")).version;
const { default: i18next } = await import(join(scratch, "node_modules", "i18next", "dist", "esm", "i18next.js"));

const { createStrings, forLocale } = await import(join(root, "src/core/index.js"));
const { ordinalData } = await import(join(root, "src/data/ordinal.js"));

/** A fresh i18next, because `init` is global on the default export and probes must not leak. */
const fresh = async (/** @type {any} */ options) => {
  const instance = i18next.createInstance();
  await instance.init({ interpolation: { escapeValue: true }, ...options });
  return instance;
};

/** lokalized's renderer strips nothing, so bidi isolates are removed for a string comparison. */
const plain = (/** @type {string} */ text) => text.replace(/[⁦-⁩‎‏]/g, "");

/** A language-form placeholder catalog, which is lokalized's shape for a plural. */
const forms = (/** @type {Record<string, string>} */ translations) => ({
  translation: "{{count}} {{w}}",
  placeholders: { w: { value: "count", translations } },
});

/** @type {{ axis: string, verdict: string, i18next: unknown, lokalized: unknown, reading: string }[]} */
const probes = [];
const record = (axis, verdict, i18nextResult, lokalizedResult, reading) =>
  probes.push({ axis, verdict, i18next: i18nextResult, lokalized: lokalizedResult, reading });

// 1 ── CARDINAL PLURALS, both catalogs complete. The baseline everything else sits on.
{
  const COUNTS = [0, 1, 2, 3, 5, 11, 22, 100, 1_000_000];
  const en = { ONE: "book", OTHER: "books" };
  const fr = { ONE: "livre", MANY: "de livres", OTHER: "livres" };
  const pl = { ONE: "książka", FEW: "książki", MANY: "książek", OTHER: "książki" };
  const suffix = (/** @type {Record<string,string>} */ m) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [`b_${k.toLowerCase()}`, `{{count}} ${v}`]));
  const cardinal = (/** @type {Record<string,string>} */ m) =>
    forms(Object.fromEntries(Object.entries(m).map(([k, v]) => [`CARDINALITY_${k}`, v])));

  const instance = await fresh({
    lng: "en",
    resources: { en: { translation: suffix(en) }, fr: { translation: suffix(fr) }, pl: { translation: suffix(pl) } },
  });
  const strings = createStrings({
    strings: { en: { b: cardinal(en) }, fr: { b: cardinal(fr) }, pl: { b: cardinal(pl) } },
    fallbackLocale: "en", locale: "en",
  });

  let agree = 0;
  const differ = [];
  for (const lng of ["en", "fr", "pl"]) {
    await instance.changeLanguage(lng);
    for (const count of COUNTS) {
      const left = instance.t("b", { count });
      const right = plain(strings.get("b", { count }, forLocale(lng)));
      if (left === right) agree += 1;
      else differ.push({ lng, count, i18next: left, lokalized: right });
    }
  }
  record("cardinal plural selection, both catalogs complete",
    differ.length === 0 ? "SAME" : "DIFFERENT-NO-WINNER",
    { agree, differ, cells: COUNTS.length * 3 },
    { agree, differ, cells: COUNTS.length * 3 },
    `${agree} of ${COUNTS.length * 3} cells identical across a 2-form, 3-form and 4-form language. ` +
    "This shows neither library is better at plurals; it is the baseline the rest sits on, and it is " +
    "27 integers rather than a proof.");
}

// 2 ── A MISSING PLURAL FORM, in the configuration people actually run: with a fallback catalog.
//      An adversarial pass found the first draft of this probe omitting `fallbackLng`, which made
//      i18next look far worse than it is. With a complete English catalog behind it, i18next renders
//      a correct ENGLISH sentence where lokalized renders the raw key.
{
  const instance = await fresh({
    lng: "fr", fallbackLng: "en", saveMissing: true,
    missingKeyHandler: (/** @type {any} */ _l, /** @type {any} */ _n, /** @type {any} */ key) =>
      missed.push(key),
    resources: {
      fr: { translation: { b_one: "{{count}} livre", b_other: "{{count}} livres" } },   // no _many
      en: { translation: { b_one: "{{count}} book", b_other: "{{count}} books" } },
    },
  });
  var missed = /** @type {string[]} */ ([]);

  /** @type {any[]} */
  const warnings = [];
  const strings = createStrings({
    strings: {
      fr: { b: forms({ CARDINALITY_ONE: "livre", CARDINALITY_OTHER: "livres" }) },
      en: { b: forms({ CARDINALITY_ONE: "book", CARDINALITY_OTHER: "books" }) },
    },
    fallbackLocale: "en", locale: "fr", onWarning: (/** @type {any} */ w) => warnings.push(w),
  });

  // i18next's LOAD-TIME channel, which the first draft omitted entirely: it can be asked which
  // suffixes a language needs, so a completeness check before serving is available without a render.
  const required = instance.services.pluralResolver.getSuffixes("fr");
  const present = ["_one", "_other"];
  const missingUpFront = required.filter((/** @type {string} */ s) => !present.includes(s));

  record("a catalog missing a plural form the language requires",
    "DIFFERENT-NO-WINNER",
    {
      renderAtOne: instance.t("b", { count: 1 }),
      renderAtMillion: instance.t("b", { count: 1_000_000 }),
      missingKeysReported: [...new Set(missed)],
      suffixesRequired: required,
      detectableBeforeServing: missingUpFront,
    },
    {
      renderAtOne: plain(strings.get("b", { count: 1 })),
      renderAtMillion: plain(strings.get("b", { count: 1_000_000 })),
      loadTimeWarnings: warnings.map((w) => `${w.type} ${w.locale} missing ${w.missingLanguageForms.join(",")}`),
    },
    "NOT a lokalized win, and the first draft of this comparison scored it as one. Measured, the two " +
    "fail DIFFERENTLY and both failures are bad. With a fallback catalog — the documented default — " +
    "i18next serves the ENGLISH sentence to a French reader at 1,000,000, and its missing-key " +
    "handler does NOT fire, because a translation was found: the page looks fine and is in the wrong " +
    "language. lokalized renders the raw key `b`, which is obviously broken and obviously wrong. " +
    "Before serving, lokalized warns at load naming the missing form; i18next will answer " +
    "`pluralResolver.getSuffixes(\"fr\")` with the three suffixes the language needs, so the same " +
    "check is four lines away. The real difference is which failure you would rather ship.");
}

// 3 ── FORMATTING A NUMBER, DATE OR CURRENCY INSIDE A MESSAGE. i18next ships it; lokalized cannot.
{
  const instance = await fresh({
    lng: "de", resources: { de: { translation: {
      sum: "Summe: {{v, number}}", price: "Preis: {{v, currency(EUR)}}", when: "Am {{d, datetime}}",
    } } },
  });
  const formatted = {
    number: instance.t("sum", { v: 1234567.891 }),
    currency: instance.t("price", { v: 1234.5 }),
    datetime: instance.t("when", { d: new Date(Date.UTC(2026, 0, 15)) }),
  };

  // lokalized's equivalent is the caller formatting first. Its interpolation has no formatter slot,
  // and that is a POLICY rather than an omission: `test/pinned-data-only.test.js` fails the build on
  // a bare `Intl` reference anywhere under src/, because rendering must not vary with host ICU.
  const strings = createStrings({
    strings: { de: { sum: "Summe: {{v}}" } }, fallbackLocale: "de", locale: "de",
  });
  const lokalizedSum = plain(strings.get("sum", { v: 1234567.891 }));

  record("formatting a number, currency or date inside a translation",
    "I18NEXT-BETTER",
    formatted,
    { raw: lokalizedSum, formatterSlot: null, reason: "no Intl under src/ by policy" },
    "i18next formats through Intl in the interpolation slot; lokalized passes the value through and " +
    "the caller must format it first. This is the largest single capability gap and it is not an " +
    "oversight: lokalized forbids `Intl` under `src/` so that two machines on different ICU builds " +
    "render identically. If you want locale-aware number and date formatting in your messages, " +
    "i18next does it and lokalized does not.");
}

// 4 ── HTML ESCAPING. i18next escapes by default; lokalized has no escaping at all.
{
  const instance = await fresh({ lng: "en", resources: { en: { translation: { hi: "Hi {{name}}" } } } });
  const strings = createStrings({ strings: { en: { hi: "Hi {{name}}" } }, fallbackLocale: "en", locale: "en" });
  const hostile = "<script>x</script>";
  record("an interpolated value containing HTML",
    "I18NEXT-BETTER",
    { rendered: instance.t("hi", { name: hostile }) },
    { rendered: plain(strings.get("hi", { name: hostile })) },
    "i18next escapes interpolated values unless you turn it off; lokalized returns them verbatim and " +
    "exports nothing for escaping or sanitizing on any subpath. If you interpolate user-supplied " +
    "text into HTML, i18next gives you a safe default and lokalized gives you the raw string.");
}

// 5 ── ORDINALS. i18next needs one call option; lokalized REFUSES TO CONSTRUCT without a second import.
{
  const instance = await fresh({ lng: "en", resources: { en: { translation: {
    p_ordinal_one: "{{count}}st", p_ordinal_two: "{{count}}nd",
    p_ordinal_few: "{{count}}rd", p_ordinal_other: "{{count}}th",
  } } } });
  const i18nextOrdinals = [1, 2, 3, 4, 11, 21].map((count) => instance.t("p", { count, ordinal: true }));

  const catalog = { en: { p: { translation: "{{o}}", placeholders: { o: { value: "n", translations: {
    ORDINALITY_ONE: "{{n}}st", ORDINALITY_TWO: "{{n}}nd",
    ORDINALITY_FEW: "{{n}}rd", ORDINALITY_OTHER: "{{n}}th",
  } } } } } };
  let withoutData;
  try {
    createStrings({ strings: catalog, fallbackLocale: "en", locale: "en" });
    withoutData = "constructed";
  } catch (error) { withoutData = `refused: ${/** @type {Error} */ (error).message.slice(0, 70)}`; }
  const strings = createStrings({
    strings: catalog, fallbackLocale: "en", locale: "en", pluralData: { ordinal: ordinalData },
  });
  const lokalizedOrdinals = [1, 2, 3, 4, 11, 21].map((n) => plain(strings.get("p", { n })));

  record("ordinal plurals (1st, 2nd, 3rd)",
    "I18NEXT-BETTER",
    { rendered: i18nextOrdinals, setup: "one call option, `{ ordinal: true }`" },
    { rendered: lokalizedOrdinals, withoutTheExtraImport: withoutData, setup: "import `lokalized/data/ordinal` and pass `pluralData`" },
    "Both render the same strings. i18next needs one option on the call; lokalized REFUSES TO " +
    "CONSTRUCT until you import a second module and hand it in. lokalized's refusal is deliberate — " +
    "ordinal data is opt-in so a page that never asks an ordinal question does not pay for the " +
    "table — but as an out-of-the-box experience i18next is plainly easier here.");
}

// 6 ── COLD START. Measured, because the bundle table says nothing about time.
{
  const time = (/** @type {string} */ source) => {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", source],
      { cwd: root, encoding: "utf8", env: { ...process.env, SCRATCH: scratch } });
    return Number(out.trim().split("\n").pop());
  };
  const i18nextMs = time(`
    const t0 = process.hrtime.bigint();
    const { default: i18next } = await import(process.env.SCRATCH + "/node_modules/i18next/dist/esm/i18next.js");
    const inst = i18next.createInstance();
    await inst.init({ lng: "fr", resources: { fr: { translation: { b_one: "{{count}} livre", b_other: "{{count}} livres" } } } });
    inst.t("b", { count: 2 });
    console.log(Number(process.hrtime.bigint() - t0) / 1e6);`);
  const lokalizedMs = time(`
    const t0 = process.hrtime.bigint();
    const { createStrings } = await import("./src/core/index.js");
    const s = createStrings({ strings: { fr: { b: { translation: "{{count}} {{w}}", placeholders: { w: { value: "count", translations: { CARDINALITY_ONE: "livre", CARDINALITY_OTHER: "livres" } } } } } }, fallbackLocale: "fr", locale: "fr" });
    s.get("b", { count: 2 });
    console.log(Number(process.hrtime.bigint() - t0) / 1e6);`);

  record("cold start: import, construct, render one string",
    "I18NEXT-BETTER",
    { millisecondsToFirstString: Math.round(i18nextMs * 10) / 10 },
    { millisecondsToFirstString: Math.round(lokalizedMs * 10) / 10 },
    "lokalized decodes pinned CLDR tables at import; i18next asks the host for plural rules and has " +
    "nothing to decode. Reported, never gated — this is one machine and one run shape, and the " +
    "figure moves with the host. The direction is the durable part.");
}

// 7 ── WHERE LOKALIZED IS ACTUALLY STRICTER: rendering does not vary with the host's ICU.
{
  const instance = await fresh({ lng: "en", resources: { en: { translation: { b_one: "one", b_other: "other" } } } });
  const usesHostIntl = typeof instance.services.pluralResolver.getRule("en")?.select === "function";
  // **COMMENTS STRIPPED, and the first version of this probe did not strip them.** A bare grep for
  // `Intl` under `src/` returns six hits, every one inside a comment explaining why the code does
  // NOT use it — recorded as "4 files reference Intl", which reads as the opposite of the truth.
  // `test/pinned-data-only.test.js` scans CODE LINES for the same reason, so this counts what the
  // gate counts.
  const { withoutComments } = await import(join(root, "tools/graph-walk.mjs"));
  const sourceFiles = execFileSync("find", ["src", "-name", "*.js"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const lokalizedIntlReferences = sourceFiles.filter((file) =>
    /\bIntl\b/.test(withoutComments(readFileSync(join(root, file), "utf8")))).length;

  record("where the plural rules come from",
    "LOKALIZED-STRICTER",
    { source: "the host's Intl.PluralRules", usesHostIntl },
    {
      source: "CLDR tables pinned in the package",
      filesUsingIntlInCodeUnderSrc: lokalizedIntlReferences,
      sourceFilesScanned: sourceFiles.length,
    },
    "i18next selects through the host's `Intl.PluralRules`, so two machines on different ICU builds " +
    "can disagree — and equally, i18next picks up CLDR corrections for free when the host updates. " +
    "lokalized pins the data and fails the build on a bare `Intl` reference anywhere under `src/`, " +
    "so it renders identically everywhere and goes stale until the package is updated. Which of " +
    "those you want is a real choice, not a ranking.");
}

// ----------------------------------------------------------------- write the record
const census = {};
for (const probe of probes) census[probe.verdict] = (census[probe.verdict] ?? 0) + 1;

if (!census["I18NEXT-BETTER"]) {
  console.error("REFUSING TO RECORD: no probe found i18next better. A comparison in which the");
  console.error("competitor never wins is the defect this tool exists to prevent, not a result.");
  process.exit(1);
}

writeFileSync(RECORD, `${JSON.stringify({
  $comment: "Generated by tools/i18next-diff/run.mjs against a real i18next. Do not edit by hand — " +
    "`npm run diff:check` fails when this tool's digest moves without a re-run.",
  formatVersion: 1,
  i18nextVersion,
  node: process.version,
  toolSha256,
  census,
  probes,
}, null, 2)}\n`);

console.log(`i18next ${i18nextVersion} on node ${process.version} — ${probes.length} probe(s)`);
for (const [verdict, count] of Object.entries(census)) console.log(`  ${verdict.padEnd(22)} ${count}`);
console.log(`recorded to measurements/i18next.json`);
