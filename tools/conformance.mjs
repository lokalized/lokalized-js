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
 * Four outcomes, and the distinctions between the last three are the whole point:
 *
 *   passed         the JS result matches Java's recorded behavior
 *   FAILED         the JS implementation ran and produced something different -> always a defect
 *   unsupported    this path is not implemented YET                          -> remaining work
 *   no counterpart the operation is a JVM concept with no JS equivalent       -> never work
 *
 * The last two used to be one bucket, and that bucket lied. 159 cases exercise Java's classpath
 * discovery — `ClassLoader.getResources`, JAR package entries, the reserved `META-INF/versions`
 * namespace — and reported as "operation 'loadClasspath' is not implemented", which reads as "not
 * yet" when the truth is "never, by design": plan 3.1 defines no classpath subpath and
 * `symbol-allowlist.json` contains no classpath symbol. Counting them as remaining work overstated
 * it by 159 cases — 12% of everything the runner called unsupported. See NO_JS_COUNTERPART.
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
  // `BidiIsolation`. `NONE` is shared with the match types above, which is safe because the two
  // vocabularies agree on it; `ALWAYS` is the one member the JS contract renames, to `"all"`.
  ALWAYS: "all",
  RTL_LOCALES: "rtl-locales",
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
  "com.lokalized.LocalizedStringLoadingException": ["StringsParseError"],
  "java.lang.IllegalArgumentException": ["TypeError", "RangeError"],
  "java.lang.ArithmeticException": ["RangeError"],
};

/**
 * Java warning type -> the JS counterpart, explicit for the same reason as `ENUM`.
 *
 * `INVALID_CLASSPATH_LOCALE_FILENAME` is deliberately ABSENT rather than mapped: plan section 4.4
 * says it is discovery-specific and has no portable JS warning, so a corpus row carrying it must
 * fail loudly here instead of being quietly accepted under some invented name.
 */
const WARNING_TYPE = {
  INCOMPLETE_CARDINALITY_TRANSLATIONS: "INCOMPLETE_CARDINALITY_TRANSLATIONS",
  INCOMPLETE_ORDINALITY_TRANSLATIONS: "INCOMPLETE_ORDINALITY_TRANSLATIONS",
};

/**
 * Corpus operations whose Java entry point has NO JavaScript counterpart and never will.
 *
 * This is the one classification in this runner that says a case will never move, so it carries its
 * own evidence and its own expiry:
 *
 *   - `why` cites the Java method and the JVM mechanism it is built on, read from
 *     `lokalized-java/src/main/java/com/lokalized/LocalizedStringLoader.java`;
 *   - `absentFrom` names what must stay absent for the claim to hold. `assertStillNonportable()`
 *     below re-checks it against the spec's `symbol-allowlist.json` on every run, so the day a
 *     classpath-shaped subpath is added, this runner FAILS and demands the entry be deleted rather
 *     than quietly continuing to hide those cases.
 *
 * That check is the difference between a documented boundary and the failure mode this file's
 * `classifyFailure` contract already forbids: a rule that outlives the reason it was written.
 *
 * NOT a way to make numbers look better. These cases stay outside the passed set, they are still
 * printed, and the corpus-partition disagreement they expose is reported loudly below.
 */
const NO_JS_COUNTERPART = {
  loadClasspath: {
    java: "LocalizedStringLoader.loadFromClasspath(ClassLoader, String package, ...)",
    why:
      "discovers strings files by scanning a JVM classpath package via ClassLoader.getResources, with " +
      "JAR package directory entries, an optional exhaustive classpath-root search, and the reserved " +
      "physical META-INF/versions multi-release namespace. No JS runtime has a classpath",
    absentFrom: "classpath",
  },
  loadClasspathResources: {
    java: "LocalizedStringLoader.loadFromClasspathResources(ClassLoader, Map<Locale, String>, ...)",
    why:
      "resolves one exact resource per locale through a ClassLoader, whose first-wins resolution order " +
      "across classpath roots is a JVM property with no JS equivalent",
    absentFrom: "classpath",
  },
};

/**
 * Owner milestone for paths that are genuinely unbuilt, sourced to plan v7 section 10.3 rather than
 * guessed. An operation absent here reports plainly as "not implemented" with no milestone claim:
 * inventing an owner would be exactly the kind of confident wrong label this change exists to remove.
 *
 *   parse    -> M5a: "Bounded duplicate-aware parser ... pass the invalid-file corpus".
 *   load     -> M8:  "Node directory generation/loading". Java's operation is
 *                    `loadFromFilesystem(Path directory)`; the JS counterpart is `lokalized/node`,
 *                    which 3.1 marks browser:false — so this is delivery work, not core work.
 *   matchFor -> M7:  "Resolution core and locale semantics ... arbitrary well-formed direct lookup,
 *                    Java-equivalent automatic direct diagnostics, and the explicitly non-parity
 *                    small browser chooser".
 *
 * `get` is deliberately absent: it is implemented, has its own branch, and its cases report the
 * specific capability each one still needs.
 */
const OWNER_MILESTONE = {
  parse: "M5a",
  load: "M8",
  matchFor: "M7",
};

/**
 * Re-derive the nonportability claim from the spec instead of trusting the table above.
 * @param {string} specDirectory
 */
function assertStillNonportable(specDirectory) {
  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(join(specDirectory, "symbol-allowlist.json"), "utf8"));
  } catch {
    return [`symbol-allowlist.json is unreadable, so the "no JS counterpart" claims cannot be verified`];
  }
  const text = JSON.stringify(allowlist).toLowerCase();
  return Object.entries(NO_JS_COUNTERPART)
    .filter(([, entry]) => text.includes(entry.absentFrom))
    .map(([operation, entry]) =>
      `the symbol allowlist now mentions '${entry.absentFrom}', so '${operation}' may have a JS counterpart:` +
      ` delete its NO_JS_COUNTERPART entry and let those cases report as unsupported or run`);
}

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

/** The message of whatever a `TranslationResult.cause` turned out to be. */
const messageOf = (cause) => (cause instanceof Error ? cause.message : cause == null ? null : String(cause));

/** A sentinel meaning "this implementation does not implement this path yet". */
class Unsupported extends Error {}
const unsupported = (why) => { throw new Unsupported(why); };

/** A sentinel meaning "no JS implementation could ever implement this path". Never a subclass of
 *  Unsupported: the two must not be catchable as one, because conflating them is the bug. */
class NoCounterpart extends Error {}
const noCounterpart = (why) => { throw new NoCounterpart(why); };

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

// `lokalized/parse`. Its entry point takes raw text or bytes, so the `parse` cases below hand it a
// file rather than a decoded object — that is the whole point of the operation.
let parseApi = null;
try { parseApi = await import("../src/parse/index.js"); } catch { /* unsupported */ }

/**
 * Phonetic-resolver invocations observed during the case currently executing.
 *
 * Section 8.2 forbids embedding executable code in a vector, so every callback the corpus configures
 * is a NAMED BEHAVIOR that each implementation wires for itself — see `VectorOracle.resolverFrom`,
 * whose recorder this mirrors field for field. Wiring the behavior without the recorder would be the
 * cheaper half and the wrong one: `phonetic-resolver.order.*` is a family of statements about how
 * many times the resolver ran, in what order, and with which locale, and NONE of that is visible in
 * the rendered string. `resolver-locale.divergent-selection.zh-tw-request-served-by-en` is the sharp
 * case — the recorded locale is the only place the donor rule can be caught going the wrong way.
 *
 * @type {{ term: string, locale: string, returned: string | null, threw: string | null }[]}
 */
const resolverCalls = [];

/**
 * Java exception type -> the JS error name a named `throw` resolver behavior raises.
 *
 * Explicit for the same reason as `ERROR_NAME`, and separate from it because this side of the
 * mapping is the RUNNER's own choice: the throwing behavior below is written here, so the
 * counterpart is declared rather than discovered. An unlisted type reports the case unsupported
 * instead of being quietly compared as equal.
 */
const RESOLVER_THREW = {
  "java.lang.IllegalStateException": "Error",
};

/**
 * A named phonetic-resolver behavior, wrapped so its invocations are recorded.
 *
 * The six behaviors are ported from `VectorOracle.delegateResolverFrom` rather than reinvented, and
 * two details are load-bearing enough to call out:
 *
 *   - `first-letter-vowel` guards on a non-empty term BEFORE indexing. Java's guard is
 *     `term.length() > 0`; dropping it in JS would not throw, it would silently classify the empty
 *     string as a VOWEL, because `"aeiouAEIOU".indexOf("")` is 0. `phonetic-resolver.first-letter.
 *     empty-string` records CONSONANT and is the only thing that catches it.
 *   - `by-term` and `by-locale` fall back to `default`, and a fixture with no `default` returns
 *     NULL rather than some safe category. `phonetic-resolver.constants.unmapped-term-returns-null`
 *     depends on that null reaching the library.
 */
function phoneticResolverFor(spec) {
  const phonetic = (name) => {
    const constant = rootApi?.[name];
    if (!constant) unsupported(`language-form constant ${name} is not exported`);
    return constant;
  };
  const mapped = (mapping) =>
    new Map(Object.entries(mapping ?? {}).map(([k, v]) => [k, phonetic(v)]));
  const fallback = spec.default === undefined || spec.default === null ? null : phonetic(spec.default);

  let delegate;
  switch (spec.behavior) {
    case "constant": {
      const constant = phonetic(spec.phonetic);
      delegate = () => constant;
      break;
    }
    case "by-term": {
      const mapping = mapped(spec.mapping);
      delegate = (term) => (mapping.has(term) ? mapping.get(term) : fallback);
      break;
    }
    case "by-locale": {
      const mapping = mapped(spec.mapping);
      delegate = (_term, locale) => (mapping.has(locale) ? mapping.get(locale) : fallback);
      break;
    }
    case "first-letter-vowel": {
      // Both constants resolved HERE, not inside the delegate. `phonetic()` reports the case
      // unsupported when a constant is missing, and `unsupported` throws — thrown from inside the
      // delegate it would travel out through the library as the candidate's resolution failure and
      // be counted as a FAILED case, which is the one thing that label must never mean.
      const vowel = phonetic("PHONETIC_VOWEL");
      const consonant = phonetic("PHONETIC_CONSONANT");
      delegate = (term) =>
        typeof term === "string" && term.length > 0 && "aeiouAEIOU".indexOf(term.charAt(0)) >= 0
          ? vowel
          : consonant;
      break;
    }
    case "return-null":
      delegate = () => null;
      break;
    case "throw": {
      const message = spec.message ?? "phonetic resolver failed deliberately";
      delegate = () => { throw new Error(message); };
      break;
    }
    default:
      unsupported(`unknown phonetic resolver behavior: ${spec.behavior}`);
  }

  return (term, locale) => {
    const call = { term, locale, returned: null, threw: null };
    resolverCalls.push(call);
    try {
      const resolved = delegate(term, locale);
      call.returned = resolved === null || resolved === undefined ? null : resolved.renderName;
      return resolved;
    } catch (error) {
      call.threw = error instanceof Error ? error.name : String(error);
      throw error;
    }
  };
}

/** Build a Strings instance for a fixture, or declare the case unsupported. */
function stringsFor(fixture) {
  if (!core?.createStrings) unsupported("createStrings is not implemented");
  if (fixture.loadOnly) unsupported("load-only fixture: no Strings instance is constructed");
  if (fixture.localeSupplier || fixture.localeMatchSupplier) unsupported("ambient locale/match suppliers are not implemented");
  // `runtimeLimits` is deliberately NOT skipped here, and `loadingOptions` is honored rather than
  // skipped. Both used to abandon their cases before running them, which is the skip-then-guess this
  // function's neighbours exist to avoid: 44 of the 83 cases that named a custom runtime limit turn
  // out to produce Java's exact answer under the fixed v1 limits, because the fixture raised a
  // ceiling the value never approached or lowered one it still fit under. Those are passes, not
  // remaining work. The 24 that genuinely differ are attributed after the fact in `classifyFailure`.
  if (fixture.translationFailureHandler) unsupported("failure handlers are not implemented");
  if (fixture.translationFallbackPolicy) unsupported("fallback policies are not implemented");
  if (Object.keys(fixture.rawFiles ?? {}).length || Object.keys(fixture.rawFilesBase64 ?? {}).length)
    unsupported("raw/byte fixtures require the bounded parser's failure paths");

  // The optional plural modules, always supplied. Java's Strings has the ordinal and cardinal-range
  // tables unconditionally, so an oracle-faithful runner must hand the JS port its equivalents or
  // every ordinal fixture would report a construction failure that Java never had. This is consumer
  // wiring, not an attribution rule: a catalog that needs data the caller withheld still fails, and
  // that failure is exercised by `test/interpolate.test.js` rather than hidden here.
  const pluralData = {
    ...(ordinalApi?.ordinalData ? { ordinal: ordinalApi.ordinalData } : {}),
    ...(rangeApi?.cardinalRangeData ? { ranges: rangeApi.cardinalRangeData } : {}),
  };

  // The fixture's loading options, translated by the same explicit table the `parse` cases use.
  // Passing them is the point: a fixture that raises the JSON-nesting ceiling to 128 is testing a
  // catalog the default 64 refuses, and ignoring the option made those cases look like unbuilt
  // capability when the capability was built and simply never handed the caller's number.
  const loadingLimits = parseLimitsFor(fixture.loadingOptions);

  return core.createStrings({
    fallbackLocale: fixture.fallbackLocale,
    locale: fixture.instanceLocale ?? fixture.fallbackLocale,
    strings: fixture.files,
    ...(loadingLimits ? { loadingLimits } : {}),
    ...(fixture.tiebreakers ? { tiebreakers: fixture.tiebreakers } : {}),
    ...(Object.keys(pluralData).length ? { pluralData } : {}),
    // Only when the fixture names one. Java's builder is left untouched otherwise, so the library's
    // own fail-fast default resolver stays installed — which is exactly what the `absent-resolver`
    // cases observe, and what a runner that always supplied something would silently erase.
    ...(fixture.phoneticResolver ? { phoneticResolver: phoneticResolverFor(fixture.phoneticResolver) } : {}),
    // Same rule, same reason: only when the fixture names a mode. Leaving the option off is not the
    // same as passing `"rtl-locales"` to a reader even though the two are observationally identical
    // by construction, and the fixture family says so explicitly -- it declines to ship an
    // explicit-RTL_LOCALES fixture because DefaultStrings.java:477 stores the default when handed
    // null. The runner should exercise the same defaulting the library documents.
    ...(fixture.bidiIsolation ? { bidiIsolation: adaptEnum(fixture.bidiIsolation) } : {}),
  });
}

/** The recorded Java resolver invocations, projected onto the names this runner raises. */
function expectedResolverCalls(expected) {
  return (expected.resolverCalls ?? []).map((call) => {
    if (call.threw !== null && !(call.threw in RESOLVER_THREW))
      unsupported(`no JS counterpart declared for a phonetic resolver throwing ${call.threw}`);
    return {
      term: call.term,
      locale: call.locale,
      returned: call.returned,
      threw: call.threw === null ? null : RESOLVER_THREW[call.threw],
    };
  });
}

/**
 * The DECLARED file contents of a fixture, in the order the author wrote them.
 *
 * `behavioral-vectors.json` normalizes every fixture object with sorted keys, which is fine for
 * every operation that consumes a decoded catalog and wrong for exactly one that does not: warning
 * emission order is a recorded observable, and `warnings-order-single-file` exists to pin it by
 * declaring its keys Zulu-then-Alpha and its placeholders zeta-then-beta. Reading that order back
 * out of the alphabetized copy is impossible, so the per-fixture source file in the same spec
 * checkout — byte-identical in content, verified below — is used when it is available.
 *
 * The alternative was to compare warnings as an unordered set, which would have silently retired
 * the one case whose entire purpose is the ordering.
 */
const declaredFilesCache = new Map();
function declaredFilesFor(fixtureId, fixture) {
  if (!declaredFilesCache.has(fixtureId)) {
    let declared = null;
    try {
      const onDisk = JSON.parse(readFileSync(join(specDir, `fixtures/${fixtureId}.json`), "utf8"));
      // Same content or it is not the same fixture: order may differ, nothing else may.
      if (jcs(onDisk.files ?? {}) === jcs(fixture.files ?? {})) declared = onDisk.files ?? {};
    } catch {
      declared = null;
    }
    declaredFilesCache.set(fixtureId, declared ?? fixture.files ?? {});
  }
  return declaredFilesCache.get(fixtureId);
}

/**
 * The raw resource a `parse` case names, in the form `parseStrings` accepts.
 *
 * Always BYTES, because the operation being replayed is Java's
 * `parse(InputStream, Locale, String source, …)`: the byte-size limits, the aggregate byte budget
 * and the fatal UTF-8 decode only exist on that overload, and handing the text overload a string
 * would quietly retire `loading-limits.input-bytes.*`. Three sources, in the order the corpus
 * prefers them: byte-exact base64 for the two fixtures whose content cannot survive a JS string at
 * all, verbatim text for everything written to pin duplicate members or a non-object document, and
 * otherwise the declared catalog re-serialized — lossless here because these fixtures were authored
 * as JSON in the first place.
 */
const utf8 = new TextEncoder();
function parseResourceFor(fixture, fixtureId, fileName) {
  const base64 = fixture.rawFilesBase64?.[fileName];
  if (base64 !== undefined) return new Uint8Array(Buffer.from(base64, "base64"));

  const raw = fixture.rawFiles?.[fileName];
  if (raw !== undefined) return utf8.encode(raw);

  const declared = declaredFilesFor(fixtureId, fixture)[fileName];
  if (declared === undefined) unsupported(`fixture ${fixtureId} declares no file named '${fileName}'`);
  return utf8.encode(JSON.stringify(declared));
}

/**
 * The loading limits a fixture asks for, as `parseStrings` names them.
 *
 * Explicit rather than a spread of whatever the fixture carries: silently ignoring an unrecognized
 * limit would let a case pass while the boundary it was written to exercise went unenforced.
 * `maximumDiscoveryEntries` and `exhaustiveClasspathSearch` govern filesystem/classpath DISCOVERY,
 * which a single-resource parse never performs, so they are dropped rather than refused.
 */
const PARSE_LIMITS = new Set([
  "maximumInputBytes",
  "maximumReaderCharacters",
  "maximumJsonNestingDepth",
  "maximumTotalInputBytes",
  "maximumLocalizedStringsFiles",
  "maximumTranslationNodes",
  "maximumWarnings",
]);
const DISCOVERY_ONLY_LIMITS = new Set(["maximumDiscoveryEntries", "exhaustiveClasspathSearch"]);

function parseLimitsFor(loadingOptions) {
  if (!loadingOptions) return undefined;
  const limits = {};
  for (const [name, value] of Object.entries(loadingOptions)) {
    if (PARSE_LIMITS.has(name)) limits[name] = value;
    else if (!DISCOVERY_ONLY_LIMITS.has(name)) unsupported(`loading option '${name}' has no parse counterpart`);
  }
  return Object.keys(limits).length ? limits : undefined;
}

/**
 * A warning, projected for comparison.
 *
 * `missingLanguageForms` is SORTED on both sides, and that is not a loosening: the corpus records
 * Java's `Set` after the harness serialized it alphabetically, so the declared cardinal/ordinal
 * order plan 4.4 requires is not recoverable from this field at all. It is recoverable — and
 * compared verbatim — from `message`, which prints the same forms in enum declaration order.
 */
const projectWarning = (warning) => ({
  type: warning.type,
  source: warning.source,
  locale: warning.locale,
  key: warning.key,
  placeholder: warning.placeholder,
  missingLanguageForms: [...warning.missingLanguageForms].sort(),
  message: warning.message,
});

const expectedWarning = (warning) => {
  if (!(warning.type in WARNING_TYPE))
    throw new Error(`corpus contains a warning type with no JS counterpart: ${warning.type}`);
  return projectWarning({ ...warning, type: WARNING_TYPE[warning.type] });
};

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

/**
 * The per-call `TranslationOptions` a case names, in the shape `get`/`getResult` accept.
 *
 * EXPLICIT rather than a spread of whatever the input carries, for the same reason `parseLimitsFor`
 * is: an option this runner does not recognize must reach `classifyFailure` and be reported, never
 * be quietly dropped so the case passes on the default. Every key handled here is one the port
 * implements; everything else stays unlisted and is attributed.
 */
const CALL_OPTION_ADAPTERS = { bidiIsolation: adaptEnum };
const IMPLEMENTED_CALL_OPTIONS = new Set(Object.keys(CALL_OPTION_ADAPTERS));

function callOptionsFor(input) {
  const options = {};
  if (input.locale) options.locale = input.locale;

  for (const [name, adapt] of Object.entries(CALL_OPTION_ADAPTERS))
    if (input[name] !== undefined) options[name] = adapt(input[name]);

  return Object.keys(options).length ? options : undefined;
}

/** Execute one case. Returns {ok} or {ok:false, actual, wanted}; throws Unsupported to skip. */
function runCase(testCase, fixture) {
  const { operation, input, expected } = testCase;

  // Per case, exactly as the oracle clears its own channels per case. A fresh `Strings` is built for
  // every case, so nothing survives here except what this case's lookup did.
  resolverCalls.length = 0;

  switch (operation) {
    case "getResult": {
      if (expected.thrown) unsupported("throwing cases need the failure-handler contract");
      const strings = stringsFor(fixture);
      const result = strings.getResult(input.key, placeholdersFor(input), callOptionsFor(input));
      // The resolver channel joins the projection rather than sitting beside it. Two thirds of the
      // phonetic corpus renders a string a wrong implementation would also render — a memoizing one,
      // or one handing the resolver the REQUESTED locale — so comparing the translation alone would
      // report those as passes.
      const actual = { ...projectResult(result, expected.result), resolverCalls: [...resolverCalls] };
      const wanted = { ...expectedResultProjection(expected.result), resolverCalls: expectedResolverCalls(expected) };

      // The recorded Java DIAGNOSTIC, carried out separately from the projection above. It is
      // deliberately not part of pass/fail: message wording is a JS-idiomatic decision in several
      // places (a hint that names `Strings.Builder#phoneticResolver(...)` would be wrong advice in
      // a JavaScript library), so making it a failure would gate on prose the port must not copy.
      // It is ratcheted instead — see `causeMessageMatchedIds` — so a message that matches Java
      // today can never silently stop matching, which is the property the M6 gate's "errors match
      // Java cases" clause actually needs.
      const causeMessage =
        expected.result.failureCause == null
          ? undefined
          : { wanted: expected.result.failureCause.message, actual: messageOf(result.cause) };

      return jcs(actual) === jcs(wanted) ? { ok: true, causeMessage } : { ok: false, actual, wanted, causeMessage };
    }

    case "get": {
      // `Strings#get` has existed since M2 — it is `getResult(...).translation`. The runner simply
      // had no branch for it, so all 83 cases reported as "operation 'get' is not implemented",
      // which was false and inflated the remaining-work list with capabilities that are named
      // precisely elsewhere. Routing them here replaces one wrong label with the real reasons.
      //
      // A `get` case whose recorded expectation includes handler/policy/observer/supplier calls or a
      // thrown error is NOT run: `get` returns only a string, so a comparison against the string
      // alone would report a pass while verifying none of the recorded callback behavior. That is
      // the "passing by attribution instead of implementation" trap, and it stays closed.
      //
      // `resolverCalls` LEFT this list when the phonetic resolver landed, and only because the
      // channel is now compared below rather than merely tolerated. The list names channels that
      // cannot yet be checked, not channels that are inconvenient. As it happens no corpus `get`
      // case records resolver calls alone, so nothing moved on this line by itself — which is the
      // point: the gate is about what is verified, not about what it lets through.
      const observed = ["failures", "policyCalls", "supplierCalls", "thrown"].filter((k) => k in expected);
      if (observed.length) unsupported("get cases recording failure/policy/supplier calls or a thrown error need the callback contracts");
      const strings = stringsFor(fixture);
      const actual = {
        translation: strings.get(input.key, placeholdersFor(input), callOptionsFor(input)),
        resolverCalls: [...resolverCalls],
      };
      const wanted = { translation: expected.translation, resolverCalls: expectedResolverCalls(expected) };
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
      if (!core?.createStrings) unsupported("createStrings is not implemented");

      // `rendered` is the fourth recorded field and it went UNCHECKED until M5b, which is the one
      // that matters most: the oracle records `enum.toString()`, "what the value actually
      // interpolates to, which is the reason renderName exists" (VectorOracle.java:383). A port
      // could carry all 61 `renderName`s correctly on the constant and still substitute
      // `[object Object]` into a template, and the other three fields would not notice.
      //
      // Checked through the PUBLIC surface — a one-slot catalog rendered by `createStrings` — rather
      // than by reaching into the renderer, so what this compares is what an application would get.
      // The `en` locale means the library default leaves it un-isolated.
      const slots = core.createStrings({ fallbackLocale: "en", locale: "en", strings: { en: { Slot: "{{slot}}" } } });
      const actual = expected.tuples.map((t) => {
        const constant = rootApi[t.name];
        if (!constant) unsupported(`language-form constant ${t.name} is not exported`);
        return {
          axis: constant.axis,
          name: constant.name,
          renderName: constant.renderName,
          rendered: slots.get("Slot", { slot: constant }),
        };
      });
      const wanted = expected.tuples.map((t) =>
        ({ axis: t.axis, name: t.name, renderName: t.renderName, rendered: t.rendered }));
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "parse": {
      // Java's `LocalizedStringLoader.parse(InputStream, Locale, String source, warningHandler,
      // loadingOptions)`: ONE resource, as bytes or text, with the caller's own source label. The
      // JS counterpart is `parseStrings`, and it is handed the same raw file rather than a decoded
      // object — a decoded object cannot carry duplicate members, byte length, or source locations,
      // which is precisely what these 118 cases are about.
      if (!parseApi?.parseStrings) unsupported("parseStrings is not implemented");

      const wantedParse = expected.parse;
      const javaType = wantedParse.failureType;
      if (javaType && !(javaType in ERROR_NAME)) unsupported(`no JS counterpart declared for ${javaType}`);
      const wantedNames = javaType ? ERROR_NAME[javaType] : null;

      const resource = parseResourceFor(fixture, testCase.fixture, input.file);
      const limits = parseLimitsFor(fixture.loadingOptions);

      // The optional ordinal module, supplied for the same reason `stringsFor` supplies it: Java's
      // loader has `Ordinality` on its classpath unconditionally and warns about incomplete ordinal
      // form sets, while the JS parser sits in the ratcheted root graph and cannot import the table.
      // Withholding it here would make every ordinality-warning case report an empty warning list
      // that Java never produced.
      const pluralData = ordinalApi?.ordinalData ? { ordinal: ordinalApi.ordinalData } : undefined;

      let actual;
      try {
        const parsed = parseApi.parseStrings(resource, {
          locale: input.locale,
          source: input.source,
          ...(limits ? { limits } : {}),
          ...(pluralData ? { pluralData } : {}),
        });
        actual = {
          failed: false,
          failureType: null,
          // Java returns a `Set<LocalizedString>`, so the recorded key list is sorted and the JS
          // list is sorted to match. Declaration order is not an observable of this operation —
          // warning order is, and it is compared in order below.
          failureMessage: null,
          keys: parsed.strings.map((string) => string.key).sort(),
          warnings: parsed.warnings.map(projectWarning),
        };
      } catch (error) {
        if (error instanceof Unsupported || error instanceof NoCounterpart) throw error;
        const name = error instanceof Error ? error.name : String(error);
        actual = {
          failed: true,
          // Collapsed onto the wanted spelling only when it IS one of the declared counterparts, so
          // a `TypeError` where Java raised a loading exception still reports as what it was.
          failureType: wantedNames?.includes(name) ? wantedNames.join(" or ") : name,
          failureMessage: error instanceof Error ? error.message : String(error),
          keys: [],
          warnings: [],
        };
      }

      // The MESSAGE is part of pass/fail here, unlike the `getResult` cause channel. A parser that
      // rejected every file would otherwise score well on `failed` alone, and every message these
      // cases record is a structural diagnostic the port reproduces verbatim rather than a piece of
      // Java-specific advice it must reword.
      const wanted = {
        failed: wantedParse.failed,
        failureType: wantedNames ? wantedNames.join(" or ") : null,
        failureMessage: wantedParse.failureMessage,
        keys: [...wantedParse.keys].sort(),
        warnings: wantedParse.warnings.map(expectedWarning),
      };

      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    default: {
      const jvmOnly = NO_JS_COUNTERPART[operation];
      if (jvmOnly) noCounterpart(`operation '${operation}' has no JS counterpart: ${jvmOnly.why}`);
      const owner = OWNER_MILESTONE[operation];
      unsupported(`operation '${operation}' is not implemented${owner ? ` (${owner})` : ""}`);
    }
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
  // 0. Custom `TranslationRuntimeLimits`, which v1 does not have. Plan 4.6 fixes Java's defaults and
  //    makes a non-undefined `runtimeLimits` a construction-time error, so a fixture that lowered or
  //    raised one can only be replayed under the fixed values.
  //
  //    Ordered FIRST, and post-hoc rather than as a pre-run skip, which is the whole change: the
  //    fixture setting a limit is not evidence that the limit mattered. Most of these cases run to
  //    Java's exact answer under the fixed limits and are counted as the passes they are; only a case
  //    that actually diverges reaches here, and for those the supplied limit is the root cause and
  //    outranks whatever per-call option the case also happens to use.
  if (fixture.runtimeLimits) return "runtime-limit overrides are not implemented";

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
  //    An option the port DOES implement leaves this rule the moment it lands, and that is the
  //    other half of the same discipline: leaving `bidiIsolation` in the scan after M5b built it
  //    would have relabelled every future per-call isolation defect as "not implemented", inside a
  //    function whose contract says it cannot. `IMPLEMENTED_CALL_OPTIONS` is the single list, shared
  //    with `callOptionsFor`, so an option cannot be passed to the port and excused here at once.
  const TAKES_OPTIONS = new Set(["getResult", "get"]);
  if (TAKES_OPTIONS.has(testCase.operation)) {
    const perCall = Object.keys(testCase.input)
      .filter((k) => !["key", "locale", "placeholders"].includes(k))
      .filter((k) => !IMPLEMENTED_CALL_OPTIONS.has(k));
    if (perCall.length) return `per-call options are not implemented (${perCall.sort().join(", ")})`;
  }

  // 2, 2b, 2c REMOVED at M6, and the removal is the point. Those three rules attributed any
  //    mismatch in a catalog containing `alternatives` or `ORDINALITY_` to the expression language
  //    and the optional ordinal data being unimplemented. Both are implemented now, so the rules
  //    could no longer distinguish "not built yet" from "built wrong" — they would have absorbed
  //    every future expression-evaluation and ordinal-selection defect as `unsupported`, which is
  //    exactly the failure mode this function's contract forbids. A rule outlives its capability by
  //    being deleted with it, not by being left in place because it currently fires on nothing.
  // 2d REMOVED at M5b, together with the capability it stood for. It attributed any mismatch in a
  //    case whose key or catalog contained a backslash escape to the escape grammar being unbuilt.
  //    The lenient scanner now backs the returned failure key as well as the strict one, so the rule
  //    could no longer tell "not built yet" from "built wrong" and would have absorbed the next
  //    escape defect — including the two traps the corpus exists to catch, an escaped region copied
  //    without escape processing and an escaped opening swallowing a following real placeholder.

  // 2e. Default output/expansion budgets. Attributable only when Java failed on a budget and this
  //     implementation SUCCEEDED, with no explicit limits set — i.e. the default was not enforced.
  if (wanted?.failureReason === "resolution-failure" && actual?.failureReason === null && !fixture.runtimeLimits)
    return "default runtime output/expansion budgets are not enforced (M5b/M6)";

  // 3 REMOVED at M5b, for the same reason as 2d. It attributed a mismatch to bidi isolation whenever
  //   deleting the isolate controls from Java's answer made the two sides identical. That rule was
  //   sound while nothing isolated; with isolation implemented it would swallow precisely the defects
  //   the family is built to expose — a port isolating under the REQUESTED locale instead of the
  //   donor, isolating a generated value, or isolating on the value's direction rather than the
  //   locale's — because every one of those differs from Java only in where the marks are.

  return null;
}

// --- run ----------------------------------------------------------------------------------------
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const cases = corpus.cases.filter((c) => !familyFilter || c.id.startsWith(familyFilter));

// Re-derive every "no JS counterpart" claim from the spec before using any of them. A stale claim
// hides cases that could now run, so it fails the run rather than being reported and skipped past.
const staleNonportabilityClaims = assertStillNonportable(specDir);

const passed = [];
const failed = [];
const skipped = [];
const reasons = new Map();
/** Cases naming an operation with no JS counterpart. Never remaining work; reported separately. */
const nonportable = [];
const nonportableReasons = new Map();
/** Cases whose recorded Java cause message this implementation reproduces exactly. */
const causeMessageMatched = [];
/** Cases whose cause message differs, with both sides, for the report. */
const causeMessageDiverged = [];

for (const testCase of cases) {
  const fixture = corpus.fixtures[testCase.fixture];
  try {
    const outcome = runCase(testCase, fixture);
    // Only for a case that PASSES. Asking whether the diagnostic matches on a case whose RESULT
    // does not is meaningless, and ratcheting one would pin the wording of a path that is still
    // being built.
    if (outcome.ok && outcome.causeMessage) {
      const { wanted, actual } = outcome.causeMessage;
      if (wanted === actual) causeMessageMatched.push(testCase.id);
      else causeMessageDiverged.push({ id: testCase.id, wanted, actual });
    }
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
    if (error instanceof NoCounterpart) {
      nonportable.push(testCase.id);
      nonportableReasons.set(error.message, (nonportableReasons.get(error.message) ?? 0) + 1);
    } else if (error instanceof Unsupported) {
      skipped.push(testCase.id);
      reasons.set(error.message, (reasons.get(error.message) ?? 0) + 1);
    } else {
      // A real crash is a FAILURE, never an "unsupported". Conflating them would let a skeleton hide
      // its own bugs behind the same label it uses for honestly-unimplemented paths.
      failed.push({ id: testCase.id, actual: `${error.constructor.name}: ${error.message}`, wanted: "no exception" });
    }
  }
}

// `unsupportedIds` stays the COMPLETE set of cases that neither passed nor failed, because plan 8.5
// gates a strict parity-backed release on that set being empty and narrowing it here would quietly
// relax the release gate. The new fields partition it: what is unbuilt, and what is unbuildable.
const report = {
  corpusSha256: corpus.oracle.librarySourcesSha256,
  behavioralVectorsVersion: corpus.behavioralVectorsVersion,
  applicable: cases.length,
  passedIds: passed,
  failedIds: failed.map((f) => f.id),
  unsupportedIds: [...skipped, ...nonportable],
  notImplementedIds: skipped,
  nonportableIds: nonportable,
  xfailedIds: [],
  causeMessageMatchedIds: causeMessageMatched,
};
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");

// --- the ratchet ---------------------------------------------------------------------------------
/** @type {string[]} */
let regressions = [];
/** @type {string[]} */
let newlyPassing = [];
/** @type {string[]} */
let causeMessageRegressions = [];
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

    // The SECOND ratchet, on diagnostics. A case whose Java cause message this port reproduced is
    // not allowed to stop reproducing it: that is the only mechanism standing between the gate's
    // "errors match Java cases" clause and a silent rewording, because the result projection above
    // compares `failureReason` and never the message.
    const nowMatching = new Set(causeMessageMatched);
    causeMessageRegressions = (baseline.causeMessageMatchedIds ?? []).filter(
      (/** @type {string} */ id) => !nowMatching.has(id),
    );
  }
  if (write) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify({ ...report, passedIds: [...passed].sort(), failedIds: [], unsupportedIds: [...skipped, ...nonportable].sort(), notImplementedIds: [...skipped].sort(), nonportableIds: [...nonportable].sort(), causeMessageMatchedIds: [...causeMessageMatched].sort() }, null, 2)}\n`, "utf8");
  }
}

const pct = cases.length ? ((passed.length / cases.length) * 100).toFixed(1) : "0.0";
const portableCount = cases.length - nonportable.length;
const portablePct = portableCount ? ((passed.length / portableCount) * 100).toFixed(1) : "0.0";
console.log(`corpus ${corpus.behavioralVectorsVersion}: ${cases.length} applicable`);
console.log(`  passed         ${String(passed.length).padStart(5)}   (${pct}% of all` +
  (nonportable.length ? `; ${portablePct}% of the ${portableCount} with a JS counterpart)` : ")"));
console.log(`  FAILED         ${String(failed.length).padStart(5)}`);
console.log(`  unsupported    ${String(skipped.length).padStart(5)}   not implemented yet`);
if (nonportable.length)
  console.log(`  no counterpart ${String(nonportable.length).padStart(5)}   JVM-only by design; these can never move`);

// Diagnostics, reported and ratcheted but never gated on: see `causeMessageMatchedIds`.
const causeMessageTotal = causeMessageMatched.length + causeMessageDiverged.length;
if (causeMessageTotal)
  console.log(
    `\nJava cause messages reproduced: ${causeMessageMatched.length}/${causeMessageTotal}` +
      ` (${causeMessageDiverged.length} JS-idiomatic divergence(s), ratcheted, not gated)`,
  );

if (verbose && causeMessageDiverged.length) {
  console.log(`\nCAUSE MESSAGE DIVERGENCES (${causeMessageDiverged.length}):`);
  for (const d of causeMessageDiverged) {
    console.log(`\n  ${d.id}`);
    console.log(`    java ${JSON.stringify(d.wanted)}`);
    console.log(`    js   ${JSON.stringify(d.actual)}`);
  }
}

if (skipped.length) {
  console.log(`\nnot implemented yet, by reason:`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${reason}`);
}

if (nonportable.length) {
  console.log(`\nNO JS COUNTERPART (${nonportable.length}) — not remaining work:`);
  for (const [reason, n] of [...nonportableReasons].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${reason}`);
  for (const [operation, entry] of Object.entries(NO_JS_COUNTERPART))
    if (cases.some((c) => c.operation === operation)) console.log(`         ${operation}: ${entry.java}`);

  // The corpus's own partition disagrees, and that disagreement belongs in the corpus, not in a
  // workaround here. Plan 8.2 puts "explicitly nonportable" cases in `informationalIds`, which "may
  // be unsupported and never enter either numerator"; these sit in `requiredPortableIds`, which 8.2
  // and 8.5 require to pass with an EMPTY unsupported set before a strict parity-backed release. As
  // partitioned, lokalized-js cannot ever reach that release, whatever it builds. Reported every
  // run, computed from the corpus rather than a memorized number, and never silently absorbed.
  const misPartitioned = cases.filter((c) => NO_JS_COUNTERPART[c.operation] && c.partition === "requiredPortableIds");
  if (misPartitioned.length) {
    const already = nonportable.length - misPartitioned.length;
    console.log(`\n  CORPUS PARTITION DEFECT: ${misPartitioned.length} of these ${nonportable.length} are partitioned`);
    console.log(`  'requiredPortableIds' (${already} are already 'informationalIds'). Plan 8.2 requires every`);
    console.log(`  requiredPortableId to pass with an empty unsupported set for a strict parity-backed release,`);
    console.log(`  so as written no JS release can ever qualify. The fix is in the corpus, not this runner:`);
    console.log(`  repartition them as informationalIds in lokalized-spec/cases/classpath-*.cases.json and`);
    console.log(`  re-ingest. This runner does not treat them as passing, and its exit status ignores them.`);
  }
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
    if (causeMessageRegressions.length) {
      console.log(`\nDIAGNOSTIC REGRESSIONS (${causeMessageRegressions.length}) — these reproduced Java's cause message and no longer do:`);
      for (const id of causeMessageRegressions.slice(0, 20)) console.log(`  ${id}`);
      if (causeMessageRegressions.length > 20) console.log(`  ... and ${causeMessageRegressions.length - 20} more`);
    }
  }
  if (write) console.log(`\nbaseline written: ${passed.length} passing`);
}

if (staleNonportabilityClaims.length) {
  console.log(`\nSTALE NONPORTABILITY CLAIM (${staleNonportabilityClaims.length}):`);
  for (const claim of staleNonportabilityClaims) console.log(`  ${claim}`);
}

process.exit(
  failed.length === 0 && regressions.length === 0 && causeMessageRegressions.length === 0 &&
  staleNonportabilityClaims.length === 0 ? 0 : 1,
);
