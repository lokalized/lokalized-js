#!/usr/bin/env node
// @ts-check
/**
 * Runs the shared behavioral corpus against THIS implementation.
 *
 * The corpus in `lokalized-spec/generated/behavioral-vectors.json` records what an unmodified
 * lokalized-java 3.0.0 actually does, case by case. This runner replays those cases against the JS
 * implementation and reports EXACT ID SETS, which is what plan v7 section 8.2 gates on — counts are
 * derived presentation only.
 *
 * Three outcomes, and the distinction between the last two is the whole point:
 *
 *   passed      the JS result matches Java's recorded behavior
 *   FAILED      the JS implementation ran and produced something different  -> always a defect
 *   unsupported the JS implementation does not implement this path yet      -> expected during M2
 *
 * Exit status is driven by `failed` alone. A walking skeleton is allowed to leave most of the corpus
 * unsupported; it is never allowed to get a case wrong. Progress is the `unsupported` set shrinking.
 *
 * With M2 tracked by engineering measurement rather than frozen thresholds, this runner IS the gate,
 * so it enforces a RATCHET as well as correctness: `measurements/conformance.json` records the exact
 * set of passing IDs, and a case that used to pass and no longer does is a regression that fails the
 * run even when nothing reports as FAILED. Without that, a case could quietly slide from `passed` to
 * `unsupported` — by an attribution rule widening, say — and the headline count would still look
 * healthy.
 *
 *   node tools/conformance.mjs [--verbose] [--family <prefix>] [--json <path>] [--write]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = process.env.LOKALIZED_SPEC_DIR ? resolve(process.env.LOKALIZED_SPEC_DIR) : resolve(root, "../lokalized-spec");
const corpusPath = join(specDir, "generated/behavioral-vectors.json");

const verbose = process.argv.includes("--verbose");
const familyFilter = process.argv.includes("--family") ? process.argv[process.argv.indexOf("--family") + 1] : null;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const write = process.argv.includes("--write");
const baselinePath = join(root, "measurements/conformance.json");

/**
 * The Java-to-JS vocabulary map.
 *
 * THIS IS WHERE PARITY IS DEFINED, so it is explicit and total rather than a lowercasing helper: a
 * mechanical transform would silently accept an enum member that the JS contract never named. Every
 * Java value the corpus can contain must appear here, and `adaptEnum` throws on anything unlisted so
 * a new member fails loudly instead of passing through unnoticed.
 */
const ENUM = {
  TRANSLATED: "translated",
  RETURNED_KEY: "returned-key",
  RETURNED_STRING: "returned-string",
  MISSING_TRANSLATION: "missing-translation",
  NO_MATCHING_ALTERNATIVE: "no-matching-alternative",
  RESOLUTION_FAILURE: "resolution-failure",
  NONE: "none",
  EXACT: "exact",
  CANONICAL: "canonical",
  CLDR_FALLBACK: "cldr-fallback",
  LIKELY_SUBTAG: "likely-subtag",
  EXTENDED_RANGE: "extended-range",
  PRIMARY_LANGUAGE: "primary-language",
  WILDCARD: "wildcard",
};

/**
 * Java exception type -> the JS error name(s) that are the declared counterpart. Explicit for the
 * same reason as ENUM: a suffix rewrite (`Exception` -> `Error`) would silently accept an error the
 * JS contract never named.
 *
 * A LIST, not a single name, for the two JDK exceptions that have no one-to-one JS counterpart.
 * Java raises `IllegalArgumentException` both for a value of the wrong kind and for a value of the
 * right kind out of range; the JS contract splits exactly that distinction across `TypeError` and
 * `RangeError`, so either is parity and anything else — including not throwing — is a failure. This
 * is deliberately weaker than the one-to-one rows above and stronger than reporting the case
 * `unsupported`, which verifies nothing at all.
 */
const ERROR_NAME = {
  "com.lokalized.UnsupportedLocaleException": ["UnsupportedLocaleError"],
  "com.lokalized.MissingTranslationException": ["MissingTranslationError"],
  "com.lokalized.ExpressionEvaluationException": ["ExpressionEvaluationError"],
  "java.lang.IllegalArgumentException": ["TypeError", "RangeError"],
  "java.lang.ArithmeticException": ["RangeError"],
};

const adaptEnum = (value) => {
  if (value === null || value === undefined) return null;
  if (!(value in ENUM)) throw new Error(`corpus contains an enum value with no JS counterpart: ${value}`);
  return ENUM[value];
};

/** Canonical JSON, so comparison is order-insensitive for objects and strict for arrays. */
const jcs = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;
};

/** A sentinel meaning "this implementation does not implement this path yet". */
class Unsupported extends Error {}
const unsupported = (why) => { throw new Unsupported(why); };

// --- the implementation under test ------------------------------------------------------------
// Imported lazily and defensively: during M2 most of this does not exist yet, and a missing export
// must register as `unsupported`, never as a crash that hides the cases that DO work.
let core = null;
let rootApi = null;
try { core = await import("../src/core/index.js"); } catch { /* unsupported */ }
try { rootApi = await import("../src/index.js"); } catch { /* unsupported */ }

// The optional cardinal-range subpath. Imported separately and never from the root, because the
// whole point of `lokalized/data/ranges` is that the root graph does not reach its table.
let rangeApi = null;
try { rangeApi = await import("../src/data/ranges.js"); } catch { /* unsupported */ }

// The optional ordinal subpath, imported the same way and for the same reason: `lokalized/data/
// ordinal` is not reachable from the root, so the runner must ask for it by name or the corpus's
// ordinal operations stay unsupported forever.
let ordinalApi = null;
try { ordinalApi = await import("../src/data/ordinal.js"); } catch { /* unsupported */ }

/** Build a Strings instance for a fixture, or declare the case unsupported. */
function stringsFor(fixture) {
  if (!core?.createStrings) unsupported("createStrings is not implemented");
  if (fixture.loadOnly) unsupported("load-only fixture: no Strings instance is constructed");
  if (fixture.localeSupplier || fixture.localeMatchSupplier) unsupported("ambient locale/match suppliers are not implemented");
  if (fixture.phoneticResolver) unsupported("phonetic resolvers are not implemented");
  if (fixture.runtimeLimits) unsupported("runtime-limit overrides are not implemented");
  if (fixture.translationFailureHandler) unsupported("failure handlers are not implemented");
  if (fixture.translationFallbackPolicy) unsupported("fallback policies are not implemented");
  if (fixture.bidiIsolation) unsupported("bidi isolation is not implemented");
  if (fixture.loadingOptions) unsupported("loading-option overrides are not implemented");
  if (Object.keys(fixture.rawFiles ?? {}).length || Object.keys(fixture.rawFilesBase64 ?? {}).length)
    unsupported("raw/byte fixtures require the bounded parser's failure paths");

  return core.createStrings({
    fallbackLocale: fixture.fallbackLocale,
    locale: fixture.instanceLocale ?? fixture.fallbackLocale,
    strings: fixture.files,
    ...(fixture.tiebreakers ? { tiebreakers: fixture.tiebreakers } : {}),
  });
}

/** Decode a corpus placeholder value into whatever the JS API accepts. */
function placeholderValue(value) {
  if (value === null || typeof value !== "object") return value;
  switch (value.$lokalized) {
    case "integer": return Number(value.value);
    // A Java `long` is an EXACT 64-bit integer, and six corpus values do not survive binary64:
    // 2^53+1, its negative twin, and 10^18+1. `Number("9007199254740993")` is 2^53, which is a
    // different value with a different plural category -- and the corpus records `long` and
    // `double` rows for those very digits precisely so the two routes cannot be conflated. The
    // exact JS carrier is `bigint`; `double`/`float` keep the lossy route, which is their contract.
    case "long": return BigInt(value.value);
    case "bigint": return BigInt(value.value);
    case "double": case "float": return Number(value.value);
    case "decimal":
      if (!rootApi?.decimal) unsupported("decimal() is not implemented");
      return rootApi.decimal(value.value);
    case "plural-operands":
      if (!rootApi?.pluralOperands) unsupported("pluralOperands() is not implemented");
      return rootApi.pluralOperands(value.value, {
        ...(value.visibleDecimalPlaces !== undefined ? { visibleDecimalPlaces: value.visibleDecimalPlaces } : {}),
        ...(value.compactExponent !== undefined ? { compactExponent: value.compactExponent } : {}),
      });
    case "language-form": {
      const constant = rootApi?.[value.name];
      if (!constant) unsupported(`language-form constant ${value.name} is not exported`);
      return constant;
    }
    default:
      unsupported(`unknown tagged placeholder: ${value.$lokalized}`);
  }
}

/**
 * The JS stand-in for Java's `forNumber(number, visibleDecimalPlaces, locale)` overload.
 *
 * Plan 3.7 deliberately does not port that overload: `pluralOperands` is the declared route for
 * explicit visible places. Every corpus value whose exact decimal text is written down — integers,
 * `BigInteger`, `BigDecimal` — converts cleanly. A `double` does not, because the corpus records the
 * Java literal and the operand value is whatever `Double.toString` selects for it; that combination
 * is reported unsupported rather than approximated.
 */
function operandsWithVisibleDecimalPlaces(value, visibleDecimalPlaces) {
  if (!rootApi?.pluralOperands) unsupported("pluralOperands() is not implemented");
  if (value === null || typeof value !== "object")
    unsupported("the visible-decimal-places overload needs a tagged numeric value");

  switch (value.$lokalized) {
    case "integer": case "long": case "bigint": case "decimal":
      return rootApi.pluralOperands(value.value, { visibleDecimalPlaces });
    case "plural-operands":
      return rootApi.pluralOperands(value.value, {
        visibleDecimalPlaces,
        ...(value.compactExponent !== undefined ? { compactExponent: value.compactExponent } : {}),
      });
    default:
      unsupported(`the visible-decimal-places overload has no JS route for a ${value.$lokalized} value`);
  }
}

const placeholdersFor = (input) =>
  input.placeholders === undefined
    ? undefined
    : Object.fromEntries(Object.entries(input.placeholders).map(([k, v]) => [k, placeholderValue(v)]));

/** Project a JS TranslationResult into the corpus's recorded Java shape. */
function projectResult(result, expected) {
  const match = result.localeMatch ?? null;
  return {
    key: result.key,
    translation: result.translation,
    status: result.status,
    lookupLocale: result.lookupLocale,
    resolvedLocale: result.resolvedLocale ?? null,
    attemptedLocales: [...result.attemptedLocales],
    isFallback: result.isFallback,
    failureReason: result.failureReason ?? null,
    // The corpus records the full match object; compare only the fields both sides define, and only
    // when the recorded side has one, so a skeleton is not failed for diagnostics it does not yet emit.
    localeMatchResult: expected.localeMatchResult === null ? null : match && {
      matchType: match.matchType,
      locale: match.locale ?? null,
    },
  };
}

function expectedResultProjection(expected) {
  return {
    key: expected.key,
    translation: expected.translation,
    status: adaptEnum(expected.status),
    lookupLocale: expected.lookupLocale,
    resolvedLocale: expected.resolvedLocale,
    attemptedLocales: expected.attemptedLocales,
    isFallback: expected.isFallback,
    failureReason: adaptEnum(expected.failureReason),
    localeMatchResult: expected.localeMatchResult === null ? null : {
      matchType: adaptEnum(expected.localeMatchResult.matchType),
      locale: expected.localeMatchResult.locale,
    },
  };
}

/** Execute one case. Returns {ok} or {ok:false, actual, wanted}; throws Unsupported to skip. */
function runCase(testCase, fixture) {
  const { operation, input, expected } = testCase;

  switch (operation) {
    case "getResult": {
      if (expected.thrown) unsupported("throwing cases need the failure-handler contract");
      const strings = stringsFor(fixture);
      const result = strings.getResult(input.key, placeholdersFor(input), input.locale ? { locale: input.locale } : undefined);
      const actual = projectResult(result, expected.result);
      const wanted = expectedResultProjection(expected.result);
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "cardinalityForNumber":
    case "cardinalityForOperands":
    case "ordinalityForNumber":
    case "ordinalityForOperands": {
      // The two axes are the same case, differing only in which module owns the classifier: the
      // cardinal pair is on the root, the ordinal pair is on the optional `lokalized/data/ordinal`.
      const ordinal = operation.startsWith("ordinality");
      const api = ordinal ? ordinalApi : rootApi;
      const operandsEntryPoint = ordinal ? "ordinalityForOperands" : "cardinalityForOperands";
      const classify = api?.[operation];
      if (!classify) unsupported(`${operation} is not implemented`);

      // Java's `forNumber(number, visibleDecimalPlaces, locale)` overload has no JS counterpart by
      // design: plan 3.7 routes explicit visible places through `pluralOperands` instead. Any value
      // that can be written as exact decimal text takes that route; a `double` cannot (its text is
      // the JDK conversion, not the corpus's literal), so that combination stays unsupported.
      const value =
        input.visibleDecimalPlaces === undefined
          ? placeholderValue(input.value)
          : operandsWithVisibleDecimalPlaces(input.value, input.visibleDecimalPlaces);
      const classifier = input.visibleDecimalPlaces === undefined ? classify : api[operandsEntryPoint];
      if (!classifier) unsupported(`${operandsEntryPoint} is not implemented`);

      if (expected.thrown) {
        const javaType = expected.thrown.type;
        if (!(javaType in ERROR_NAME)) unsupported(`no JS counterpart declared for ${javaType}`);
        const wantedNames = ERROR_NAME[javaType];
        const wanted = wantedNames.join(" or ");
        try {
          classifier(value, input.locale);
          return { ok: false, actual: "no exception", wanted };
        } catch (error) {
          if (error instanceof Unsupported) throw error;
          const actual = error instanceof Error ? error.name : String(error);
          return wantedNames.includes(actual) ? { ok: true } : { ok: false, actual, wanted };
        }
      }

      const classified = classifier(value, input.locale);
      const actual = { name: classified?.name ?? null };
      const wanted = { name: expected.classification.name };
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "supportedCardinalitiesForLocale":
    case "supportedOrdinalitiesForLocale": {
      const probe =
        operation === "supportedCardinalitiesForLocale"
          ? rootApi?.supportedCardinalitiesForLocale
          : ordinalApi?.supportedOrdinalitiesForLocale;
      if (!probe) unsupported(`${operation} is not implemented`);
      const actual = [...probe(input.locale)].map((form) => ({ name: form.name }));
      const wanted = expected.classifications.map((form) => ({ name: form.name }));
      // Order is load-bearing: Java returns a SortedSet in enum declaration order.
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "cardinalityForRange": {
      if (!rangeApi?.cardinalityForRange) unsupported("cardinalityForRange is not implemented");
      // The corpus's endpoints are bare `{$lokalized, axis, name}` records with no `renderName`,
      // which is exactly the structural shape the classifier must accept.
      const value = rangeApi.cardinalityForRange(input.start, input.end, input.locale);
      const actual = { name: value?.name ?? null };
      const wanted = { name: expected.classification.name };
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "languageForms": {
      if (!rootApi) unsupported("the root entry point is not implemented");
      const actual = expected.tuples.map((t) => {
        const constant = rootApi[t.name];
        if (!constant) unsupported(`language-form constant ${t.name} is not exported`);
        return { axis: constant.axis, name: constant.name, renderName: constant.renderName };
      });
      const wanted = expected.tuples.map((t) => ({ axis: t.axis, name: t.name, renderName: t.renderName }));
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    default:
      unsupported(`operation '${operation}' is not implemented`);
  }
}

/**
 * Is this failure attributable to a capability this milestone deliberately does not implement?
 *
 * Run-then-classify, rather than skip-then-guess. A case is executed first, so a case that PASSES on
 * an unimplemented path still counts as a pass — the default branch of an entry with alternatives is
 * often exactly right. Only an actual mismatch is examined here, and only against narrow, named
 * rules. Each rule states what makes the difference attributable, so none of them can quietly absorb
 * a real defect: once the capability lands, these cases either pass or fail for real.
 *
 * @returns {string | null} the unsupported reason, or null if this is a genuine defect
 */
function classifyFailure(testCase, fixture, actual, wanted) {
  // 1. Per-call options the skeleton ignores. Ignoring an option silently produces a plausible but
  //    wrong answer, which is exactly what must not be reported as a pass OR as a defect.
  //
  //    `value`, `start` and `end` are NOT options: they are the required arguments of the classifier
  //    operations, present on every one of those cases. Leaving them in the scan made this rule
  //    absorb a genuine exactness defect -- `numeric-boundaries.cardinal.ru.ten-to-the-18-plus-
  //    one-is-one` was reported as "per-call options are not implemented (value)" when what actually
  //    happened was that the runner had rounded a `long` through binary64. A rule that can swallow
  //    the defect it is standing next to is worse than no rule.
  //    Scoped to the operations that HAVE per-call options rather than kept as a list of argument
  //    names to exclude: a maintained denylist would re-absorb the next required argument someone
  //    adds. Only getResult and get take TranslationOptions; a classifier's inputs are all arguments.
  const TAKES_OPTIONS = new Set(["getResult", "get"]);
  if (TAKES_OPTIONS.has(testCase.operation)) {
    const perCall = Object.keys(testCase.input).filter((k) => !["key", "locale", "placeholders"].includes(k));
    if (perCall.length) return `per-call options are not implemented (${perCall.sort().join(", ")})`;
  }

  // 2. The expression language (M6). `render` takes the default branch when a definition carries
  //    alternatives, so any case whose expected value came from an alternative mismatches.
  const definitions = Object.values(fixture.files ?? {});
  const entry = definitions.map((c) => /** @type {any} */ (c)[testCase.input.key]).find(Boolean);
  if (entry && typeof entry === "object" && Array.isArray(entry.alternatives))
    return "alternative expressions are not evaluated (M6)";

  // 2b. Ordinal selection needs `lokalized/data/ordinal`, an OPTIONAL module owned by M4. A
  //     definition selecting on ORDINALITY_* cannot resolve without it.
  const catalogText = JSON.stringify(fixture.files ?? {});
  if (catalogText.includes("ORDINALITY_")) return "ordinal classification needs the optional ordinal data (M4)";

  // 2c. Alternatives also nest inside placeholder definitions, not only at the top level of an entry.
  if (catalogText.includes('"alternatives"')) return "alternative expressions are not evaluated (M6)";

  // 2d. Interpolation escapes (`\{{`, `\}}`, `\\`), owned by M5b. Keyed on an escape actually being
  //     present in the key or the catalog, not on the family name.
  if (/\\[{}]|\\\\/.test(testCase.input.key ?? "") || /\\\\[{}]/.test(catalogText))
    return "interpolation escapes are not implemented (M5b)";

  // 2e. Default output/expansion budgets. Attributable only when Java failed on a budget and this
  //     implementation SUCCEEDED, with no explicit limits set — i.e. the default was not enforced.
  if (wanted?.failureReason === "resolution-failure" && actual?.failureReason === null && !fixture.runtimeLimits)
    return "default runtime output/expansion budgets are not enforced (M5b/M6)";

  // 3. Bidi isolation (default RTL_LOCALES, so it applies with no option set). Attributable only
  //    when removing the isolate characters from Java's answer makes the two identical — a
  //    difference anywhere else is a real defect and stays one.
  const stripped = jcs(wanted).replace(/[\u2066-\u2069\u202a-\u202e]/g, "");
  if (stripped !== jcs(wanted) && stripped === jcs(actual)) return "bidi isolation is not implemented";

  return null;
}

// --- run ----------------------------------------------------------------------------------------
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const cases = corpus.cases.filter((c) => !familyFilter || c.id.startsWith(familyFilter));

const passed = [];
const failed = [];
const skipped = [];
const reasons = new Map();

for (const testCase of cases) {
  const fixture = corpus.fixtures[testCase.fixture];
  try {
    const outcome = runCase(testCase, fixture);
    if (outcome.ok) {
      passed.push(testCase.id);
    } else {
      const attributable = classifyFailure(testCase, fixture, outcome.actual, outcome.wanted);
      if (attributable) {
        skipped.push(testCase.id);
        reasons.set(attributable, (reasons.get(attributable) ?? 0) + 1);
      } else {
        failed.push({ id: testCase.id, actual: outcome.actual, wanted: outcome.wanted });
      }
    }
  } catch (error) {
    if (error instanceof Unsupported) {
      skipped.push(testCase.id);
      reasons.set(error.message, (reasons.get(error.message) ?? 0) + 1);
    } else {
      // A real crash is a FAILURE, never an "unsupported". Conflating them would let a skeleton hide
      // its own bugs behind the same label it uses for honestly-unimplemented paths.
      failed.push({ id: testCase.id, actual: `${error.constructor.name}: ${error.message}`, wanted: "no exception" });
    }
  }
}

const report = {
  corpusSha256: corpus.oracle.librarySourcesSha256,
  behavioralVectorsVersion: corpus.behavioralVectorsVersion,
  applicable: cases.length,
  passedIds: passed,
  failedIds: failed.map((f) => f.id),
  unsupportedIds: skipped,
  xfailedIds: [],
};
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");

// --- the ratchet ---------------------------------------------------------------------------------
/** @type {string[]} */
let regressions = [];
/** @type {string[]} */
let newlyPassing = [];
let baseline = null;
if (!familyFilter) {
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    baseline = null;
  }
  if (baseline) {
    const nowPassing = new Set(passed);
    regressions = baseline.passedIds.filter((/** @type {string} */ id) => !nowPassing.has(id));
    const wasPassing = new Set(baseline.passedIds);
    newlyPassing = passed.filter((id) => !wasPassing.has(id));
  }
  if (write) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify({ ...report, passedIds: [...passed].sort(), failedIds: [], unsupportedIds: [...skipped].sort() }, null, 2)}\n`, "utf8");
  }
}

const pct = cases.length ? ((passed.length / cases.length) * 100).toFixed(1) : "0.0";
console.log(`corpus ${corpus.behavioralVectorsVersion}: ${cases.length} applicable`);
console.log(`  passed      ${String(passed.length).padStart(5)}   (${pct}%)`);
console.log(`  FAILED      ${String(failed.length).padStart(5)}`);
console.log(`  unsupported ${String(skipped.length).padStart(5)}`);

if (skipped.length) {
  console.log(`\nunsupported by reason:`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${reason}`);
}

if (failed.length) {
  console.log(`\nFAILURES (${failed.length}):`);
  for (const f of failed.slice(0, verbose ? failed.length : 12)) {
    console.log(`\n  ${f.id}`);
    console.log(`    wanted ${jcs(f.wanted)}`);
    console.log(`    actual ${jcs(f.actual)}`);
  }
  if (!verbose && failed.length > 12) console.log(`\n  ... and ${failed.length - 12} more (--verbose for all)`);
}

if (!familyFilter) {
  if (baseline === null) {
    console.log(`\nno baseline at measurements/conformance.json — run with --write to record one`);
  } else {
    if (newlyPassing.length)
      console.log(`\n${newlyPassing.length} newly passing case(s); run --write to record them:` +
        `\n  ${newlyPassing.slice(0, 8).join("\n  ")}${newlyPassing.length > 8 ? `\n  ... and ${newlyPassing.length - 8} more` : ""}`);
    if (regressions.length) {
      console.log(`\nREGRESSIONS (${regressions.length}) — these passed against the recorded baseline and no longer do:`);
      for (const id of regressions.slice(0, 20)) console.log(`  ${id}`);
      if (regressions.length > 20) console.log(`  ... and ${regressions.length - 20} more`);
    }
  }
  if (write) console.log(`\nbaseline written: ${passed.length} passing`);
}

process.exit(failed.length === 0 && regressions.length === 0 ? 0 : 1);
