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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The `construct` family's Java->JS refusal correspondence, kept OUT of this file on purpose: this
// file's diff is read for exactly the shape a message-parity table has, so the table is a reviewable
// artifact of its own with one entry per DefaultStrings refusal site. It cannot turn a mismatch into
// an `unsupported` — a Java refusal it does not declare keeps its Java values and FAILS — and an
// entry no case consults turns the run red. See the decision recorded at the top of that file.
import { adaptConstructRefusal, staleConstructAdaptations } from "./construct-refusals.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = process.env.LOKALIZED_SPEC_DIR ? resolve(process.env.LOKALIZED_SPEC_DIR) : resolve(root, "../lokalized-spec");
const corpusPath = join(specDir, "generated/behavioral-vectors.json");

const verbose = process.argv.includes("--verbose");
const familyFilter = process.argv.includes("--family") ? process.argv[process.argv.indexOf("--family") + 1] : null;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const write = process.argv.includes("--write");
/**
 * Authorizes a `--write` that would REMOVE an id from `passedIds`, and is recorded verbatim in the
 * artifact beside the ids it removed.
 *
 * Without it a `--write` absorbs a regression in silence, which is not hypothetical: B3's write
 * dropped `per-call-override-order.zh-tw.ranges-only-on-zh-hant-only-key` from the baseline, and the
 * only reason nobody saw it is that the drop was reported against a baseline the same command then
 * overwrote. The run DID print `REGRESSIONS (1)` at the time; nothing made writing it away
 * deliberate. Now the write refuses, and an authorized drop leaves its reason in the file — the same
 * discipline `scenario:0a --write --reason` already applies to the byte ratchet.
 */
const dropReason = process.argv.includes("--drop-reason")
  ? process.argv[process.argv.indexOf("--drop-reason") + 1] ?? null
  : null;
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
  // A CALLBACK THAT ANSWERED NULL. Java wraps both user callbacks in `requireNonNull`
  // (DefaultStrings.java:735 for the policy, :749-750 for the handler) and the port refuses the same
  // two nulls at the same two points with a `TypeError`, so the counterpart is declared here rather
  // than left undeclared.
  //
  // DECLARING IT IS THE STRONGER CHOICE. Without the entry `thrownProjection`'s arm 3 reports the
  // case `unsupported` BEFORE comparing anything, so the `null-callbacks.*` rejection rows would
  // verify nothing at all — not the policy's arguments, not the walk, not which of two null-answering
  // callbacks is rejected first. With it they compare in full, and all 9 `null-callbacks.*` rows pass.
  //
  // IT COST FIVE RED ROWS WHEN IT WAS ADDED, AND NO LONGER DOES; this comment said so in the present
  // tense for a batch after the reason had gone. The remaining difference from Java is the
  // IDENTIFIER alone — Java names `translationFallbackPolicy` / `TranslationFailureHandler`, the JS
  // options are `fallbackPolicy` / `onFailure` — and the maintainer's decision 1 settled the wording
  // (Java's SHAPE with the JS name, matching `localeResolver` at `core/index.js:900/:914`). Those
  // two strings are pinned EXACTLY in `DECLARED_MESSAGE_DIVERGENCES`, which fails the run STALE if
  // the port ever reproduces Java verbatim.
  "java.lang.NullPointerException": ["TypeError"],
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
  load: "M8",
  // Plan v7 section 3.5 puts bestMatchForAcceptLanguage on LocaleNegotiator with Java's fail-soft
  // contract, returning a LocaleTag -- so the oracle's emitted tag IS the JS return value and this
  // switch needs one new arm, not an adaptation layer. Naming the owner here is the difference
  // between 21 cases reporting a reason and 21 reporting a bare "not implemented".
  // `define` is NOT the acceptLanguage shape, and the difference is worth stating because it changes
  // what "not implemented" means here. Half of the observation already ships: the operation builds a
  // LocalizedString programmatically, and `defineLocalizedString` is an allowlisted `lokalized/parse`
  // export that M5b delivered. What has no direct analogue is the other half — Java reaches
  // LocalizedString#equals by asking a constructed Strings whether its catalog CONTAINS the built
  // value, and plan section 3.6 says outright that v1 adds no catalog-inspection surface, so there is
  // no `contains` to call. The behavior is still portable: the same proposition is reachable through
  // `parseStrings` plus a structural comparison of the defined string against the parsed entry with
  // that key, which is the comparison `mergeParsedStringsFiles` already performs internally. That
  // runner is what these 22 required IDs are owed, and it is deliberately not written here: Java's
  // refusals come from LocalizedString's two raw-constructor checks while the JS ones come from the
  // shared model walk, so wiring them up means deciding an adaptation rule, and inventing one inside
  // this file is exactly how a real exactness defect was once absorbed. M5b is named as the owner
  // because programmatic construction and the catalog model are its scope; M5b is closed, so these
  // are new required IDs against a closed milestone rather than work it left unfinished.
  define: "M5b",
  // `construct` HAD AN ENTRY HERE AND NO LONGER NEEDS ONE. M7 B4 gave the operation a real arm, so
  // no `construct` case can reach `operationNotImplemented` any more and an owner annotation for it
  // would be a label on a bucket that is permanently empty. Deleted rather than left in place, on
  // this project's standing lesson that a rule outlives its capability by being deleted with it:
  // an attribution table that keeps entries for implemented operations stops being readable as the
  // list of what is unbuilt, which is the one thing it is for.
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
  const stale = Object.entries(NO_JS_COUNTERPART)
    .filter(([, entry]) => text.includes(entry.absentFrom))
    .map(([operation, entry]) =>
      `the symbol allowlist now mentions '${entry.absentFrom}', so '${operation}' may have a JS counterpart:` +
      ` delete its NO_JS_COUNTERPART entry and let those cases report as unsupported or run`);

  return [...stale, ...bothPerCallSourcesStillRefused()];
}

/**
 * The second "no JS counterpart" claim, re-derived the same way the first is — by ABLATION rather
 * than by argument.
 *
 * `callOptionsFor` reports the both-present per-call state as nonportable because plan 3.3 declares
 * `locale` and `localeMatch` mutually exclusive AT RUNTIME. That is a claim about the PORT, not about
 * the JVM, so it can go stale in a way the allowlist cannot see: a future edit that made the port
 * resolve the pair by precedence would leave those six rows silently parked in a bucket labelled
 * "these can never move" while the port had quietly started answering them.
 *
 * So the claim is tested. A three-line instance, one lookup naming both sources, and the run FAILS
 * if nothing is refused. Known-gap lists rot; this one cannot.
 *
 * AND THE THROW IS IDENTIFIED, not merely counted. A bare `catch {}` here would be the `zh-123`
 * shape in its purest form: any throw at all would read as proof of the refusal this function names,
 * so replacing the refusal in `localeLookupFor` with an unrelated `TypeError` — or breaking
 * `createStrings` outright — would leave the guard silent and green. Measured, not argued: with the
 * bare catch, substituting `throw new TypeError("unrelated internal failure")` for the refusal kept
 * the run at exit 0. Hence the CONTROL below, which must succeed, and the bound `error`, which must
 * be the refusal itself.
 */
function bothPerCallSourcesStillRefused() {
  if (!core?.createStrings) return [];

  const strings = core.createStrings({
    fallbackLocale: "en",
    locale: "en",
    strings: { en: { "K": "v" }, fr: { "K": "v" } },
  });
  const localeMatch = strings.getDirectLocaleContext("fr").localeMatch;

  // THE CONTROL, expected to pass: one per-call source alone must still answer. Without it a wholly
  // broken instance — every lookup throwing for any reason — reads as a passing guard below.
  try {
    strings.getResult("K", undefined, { locale: "en" });
  } catch (error) {
    return [`the both-per-call-sources probe cannot run: its CONTROL lookup, which names only ` +
      `'locale', threw ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)}. ` +
      `Nothing about the six per-call-override-order rows was tested.`];
  }

  try {
    strings.getResult("K", undefined, { locale: "en", localeMatch });
  } catch (error) {
    // The refusal, by type AND by the phrase `localeLookupFor` raises it with. Anything else is a
    // different failure wearing the refusal's clothes, and is reported rather than accepted.
    if (error instanceof RangeError && error.message.includes("names two locale sources")) return [];

    return [`the both-per-call-sources probe threw something that is NOT the per-call refusal: ` +
      `${error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)}. ` +
      `Either the refusal moved and this claim is untested, or the port is failing for an unrelated ` +
      `reason; the six per-call-override-order rows' nonportability is unverified either way.`];
  }

  return ["the port no longer refuses a per-call options object carrying both 'locale' and " +
    "'localeMatch', so the six per-call-override-order rows may have a JS counterpart: delete the " +
    "noCounterpart in callOptionsFor and let them run"];
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
/**
 * Import a subpath that may not exist yet — ABSENT and BROKEN kept apart.
 *
 * Every one of these modules is imported by name rather than through the root, and during M2 most
 * of them did not exist at all; a subpath the port has not written must register as `unsupported`,
 * never as a crash that hides the cases that DO work. That was written as `try { … } catch { }`,
 * which also swallows a module that EXISTS and THREW — a syntax error, or a failure inside a data
 * module it imports. The whole family of cases the subpath serves would then report a brand-new
 * `unsupported` bucket instead of FAILED, which is the milestone's forbidden shape: a real defect
 * converted into attributed non-work, caught today only by the passing-set ratchet one layer away
 * from the count everyone reads. `src/negotiate/index.js` alone carries 50 passing cases and pulls
 * in an 802-class generated table, so the swallow had teeth.
 *
 * Existence is decided on the FILE, before the import runs, so nothing about the failure has to be
 * pattern-matched out of an error message. A module that is there and throws propagates, and the
 * runner dies with that error rather than reporting anything.
 *
 * @param {string} relativePath
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function optionalSubpath(relativePath) {
  if (!existsSync(join(root, relativePath))) return null;
  return await import(pathToFileURL(join(root, relativePath)).href);
}

const core = await optionalSubpath("src/core/index.js");
const rootApi = await optionalSubpath("src/index.js");

// The optional cardinal-range subpath, never reached from the root, because the whole point of
// `lokalized/data/ranges` is that the root graph does not reach its table.
const rangeApi = await optionalSubpath("src/data/ranges.js");

// The optional ordinal subpath, for the same reason: `lokalized/data/ordinal` is not reachable from
// the root, so the runner must ask for it by name or the corpus's ordinal operations stay
// unsupported forever.
const ordinalApi = await optionalSubpath("src/data/ordinal.js");

// `lokalized/parse`. Its entry point takes raw text or bytes, so the `parse` cases below hand it a
// file rather than a decoded object — that is the whole point of the operation.
const parseApi = await optionalSubpath("src/parse/index.js");

// `lokalized/negotiate`, also outside the root graph by design, and the only door to
// `matchFor(List)`: a runner that only imported `src/index.js` could never reach the RFC 4647 range
// ingress at all.
const negotiateApi = await optionalSubpath("src/negotiate/index.js");

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
 * Java exception type -> the JS error name a named `throw-in-policy` behavior raises.
 *
 * Separate from `RESOLVER_THREW` for the reason that table is separate from `ERROR_NAME`: these two
 * behaviors are written independently in this file and in `VectorOracle`, so a shared row would let
 * one of them change its exception without the other noticing. An unlisted type reports the case
 * unsupported rather than comparing equal.
 */
const POLICY_THREW = {
  "java.lang.IllegalStateException": "Error",
};

/**
 * Java exception type -> the JS error NAME the port raises for the same resolution failure.
 *
 * Used only for the `causeType` field of the `failures` and `policyCalls` channels, which is the
 * cause a candidate's render actually threw. Declared explicitly, and an unlisted type reports the
 * case unsupported rather than comparing equal — the `RESOLVER_THREW` discipline.
 *
 * ONE ENTRY IS A DELIBERATE COLLAPSE AND IT COSTS REAL DISCRIMINATION. Java raises
 * `IllegalStateException` for a language-form translation that lacks the required member ("Missing
 * Gender translation for NEUTER") and `IllegalArgumentException` for a placeholder whose context
 * value was never supplied ("Missing value for placeholder 'absentCount'"). The port raises the SAME
 * bare `Error` for both — measured, not assumed, on `custom-policy-four-candidate-chain` — because
 * plan 3.5's `ResolutionError` with its `RESOLUTION_INVALID_STATE` / `RESOLUTION_INVALID_ARGUMENT`
 * codes has not landed (plan open question 4). So seven cases whose recorded channels carry BOTH
 * Java types compare equal on a distinction the port cannot make:
 * `custom-policy.cause.three-consecutive-calls-carry-three-distinct-types`,
 * `custom-policy.cause.truncated-walk-still-reports-the-first-cause`, and the five
 * `callback-interaction.first-cause.*`. They still discriminate order, count and the third type
 * (`ExpressionEvaluationError`), which is why the field is compared rather than dropped — dropping
 * it would lose those too — but the collapse is recorded here so the day the error hierarchy lands
 * this table splits and those seven start proving what they were written to prove.
 */
const CAUSE_NAME = {
  "com.lokalized.ExpressionEvaluationException": "ExpressionEvaluationError",
  "java.lang.IllegalStateException": "Error",
  "java.lang.IllegalArgumentException": "Error",
};

/**
 * The milestone that owes a JS counterpart for a Java cause type `CAUSE_NAME` does not carry.
 *
 * THE SAME GATE `OWNER_MILESTONE` IS, FOR THE OTHER `unsupported(` CALL THAT COULD PRINT AN OWNERLESS
 * REASON. `operationNotImplemented` throws when an operation reports unsupported without naming who
 * owes the work, and `CLAUDE.md` records that throw as the structural fix for exactly this failure
 * mode — but it covers OPERATIONS ONLY. `adaptCauseType` never consulted it, so the moment a corpus
 * row recorded a cause type this table had never seen, the by-reason listing grew a line with no
 * milestone in parentheses, standing beside four lines that all carry one. A reason nobody owns is a
 * gap nobody has agreed to close, which is the one thing the unsupported list may not contain.
 *
 * DELIBERATELY EMPTY, AND THAT IS THE STRONGER STATE. It carried one entry —
 * `java.util.IllformedLocaleException`, owed by "M7 decision 2" — on the premise that Java's
 * escaping `IllegalArgumentException` for `ja-JP-x-lvariant-JP` wraps an `IllformedLocaleException`
 * and that the port would have to raise a JS error of that name. THAT PREMISE WAS WRONG, and the
 * entry was hiding the runner defect rather than owning a port gap: `IllformedLocaleException` is
 * never the class of anything that ESCAPES, it is only the class the escaping error WRAPS, and it
 * reached `adaptCauseType` at all only because `thrownProjection`'s arm 2 was reading
 * `thrown.causeType` as if it named the escaping object. It does not. The wrapped cause is now
 * compared on its own channel (`WRAPPED_CAUSE`) and the two rows PASS.
 *
 * The table stays because the GATE is the point: an empty one means any cause type `CAUSE_NAME` has
 * never seen raises `AuthoringError` on the spot, which forces a decision instead of printing an
 * ownerless line in the by-reason listing. An entry added here is a promise, so it should be rare
 * and it should be deleted the moment the work lands — as this one was.
 */
const CAUSE_OWNER = {};

/** The JS error name of whatever a candidate threw, in the shape `CAUSE_NAME` maps Java onto. */
const causeNameOf = (cause) =>
  cause === null || cause === undefined ? null : cause instanceof Error ? cause.name : String(cause);

/**
 * Failures handed to the failure handler during the case currently executing, as the RAW frozen
 * `TranslationFailure` objects.
 *
 * Raw rather than projected, because one recorded field is a REFERENCE comparison the projection
 * cannot make later from a copy: `matchObjectIdenticalToResult` asks whether the handler saw the
 * same match object the result carries, and plan 8.3 requires "identical match-object identity
 * through result, failure ... and thrown-failure paths".
 *
 * @type {any[]}
 */
const failureCalls = [];

/**
 * Fallback-policy consultations observed during the case currently executing.
 *
 * The ABSENCE of an entry is the observable in the truncation clauses: Java breaks on
 * `candidateIndex + 1 >= fallbackCandidates.size()` BEFORE consulting, so a four-candidate walk that
 * fails everywhere records three calls, and `custom-policy.finalcandidate.no-call-though-the-last-
 * locale-is-listed` lists all four locales in its policy so the missing fourth cannot be read as a
 * coincidence.
 *
 * @type {{ reason: string, locale: string, causeType: string | null, decision: unknown }[]}
 */
const policyCalls = [];

/**
 * Ambient locale/match resolver consultations observed during the case currently executing.
 *
 * ORDERED LIKE THE ORACLE'S, and the ordering is the whole point. `VectorOracle` builds a fabricated
 * `LocaleMatchResult` INSIDE the supplier lambda and appends to `SUPPLIER_CALLS` only afterwards
 * (`VectorOracle.java:1076-1101`), so a fabrication the constructor refuses records NOTHING while a
 * value the INSTANCE later refuses records a call. That absence/presence is the two-layer
 * discriminator, and 20 corpus rows depend on it: `supplied-match.considered.empty-list-fails-in-
 * the-constructor` carries no `supplierCalls` and reports the layer-one fallback-containment
 * message, while `.subset-is-rejected` carries one and reports layer two's set message. A runner
 * that recorded first would make the two indistinguishable here.
 *
 * @type {{ kind: string, returnedLocale: string | null, returnedMatchType: string | null }[]}
 */
const supplierCalls = [];

/**
 * Every error one of THIS RUNNER's own throwing callback behaviors raised during the case
 * currently executing, in the order they were raised.
 *
 * The oracle's `throw-in-handler` and `throw-in-policy` behaviors raise `IllegalStateException`
 * with the fixture's message and no cause; 34 corpus rows record such a throw escaping the lookup.
 * Nothing about that throw is the PORT's — the runner wrote it — so comparing it by error name
 * would verify only that the runner's own `new Error` survived a function call, and mapping
 * `java.lang.IllegalStateException` into `ERROR_NAME` to do so would be worse than useless: that
 * type means two different things in this corpus, and a name table cannot tell them apart. With
 * `identicalToRetainedCause` false it is this sentinel escaping verbatim; with it true it is the
 * LIBRARY's error being rethrown by identity. One table entry would accept either for either. (The
 * distinction used to be drawn on `causeType` null-ness, which was a proxy: 34 sentinel rows and 22
 * rethrown rows all carry `IllegalStateException`, and only the identity observation separates them
 * without appealing to a message prefix.)
 *
 * So the sentinel arm asserts REFERENCE IDENTITY instead — `caught === sentinelThrows.at(-1)` —
 * which is strictly stronger than any name comparison and is what "propagates immediately" actually
 * claims: not an error of the same shape, but this very object, unwrapped and unreplaced. Recorded
 * at THROW time rather than at installation, so a case that installs two throwing handlers and
 * fires one (`ingress-matrix.handler.per-call-throw-in-handler-overrides-instance-message`) records
 * one entry, and the escaping error is the last one raised because nothing catches them.
 *
 * @type {unknown[]}
 */
const sentinelThrows = [];

/** Raise, and record, one of this runner's own sentinel errors. @returns {never} */
function throwSentinel(message) {
  const error = new Error(message);
  sentinelThrows.push(error);
  throw error;
}

/**
 * Wrap a failure handler so every invocation is recorded. `VectorOracle.recording`, mirrored.
 *
 * BEFORE the delegate, deliberately, and the order is load-bearing in the opposite direction from
 * `recordingPolicy` below: a `throw-in-handler` behavior must still leave the failure it was called
 * for in the channel, which is what four throw-in-handler rows record.
 */
const recordingHandler = (delegate) => (failure) => {
  failureCalls.push(failure);
  return delegate(failure);
};

/**
 * Wrap a fallback policy so every consultation is recorded. `VectorOracle.recordingPolicy`.
 *
 * BEFORE the delegate, and the outcome filled in afterwards — mirroring the oracle's own
 * `try`/`finally` shape (VectorOracle.java:1002-1031) key for key. This used to record AFTER the
 * delegate returned, because the ORACLE did, so a `throw-in-policy` behavior recorded nothing on
 * either side and the twelve throw-in-policy rows asserted an absence. That absence was an artifact
 * of the harness, not of Java: with the oracle fixed, the corpus now states the reason, locale and
 * cause the throwing policy was handed, and this side must state them too or the new observation
 * would be compared against an empty channel.
 *
 * `threw` is the JS error NAME, null when the consultation returned. On the wanted side
 * `POLICY_THREW` declares the counterpart for the Java class the oracle records; a `decision` of
 * null with `threw` null is a policy that RETURNED null, which is a different observation.
 */
const recordingPolicy = (delegate) => (reason, locale, cause) => {
  const call = { reason, locale, causeType: causeNameOf(cause), decision: null, threw: null };
  policyCalls.push(call);
  try {
    const decision = delegate(reason, locale, cause);
    call.decision = decision;
    return decision;
  } catch (error) {
    call.threw = error instanceof Error ? error.name : `a thrown ${error === null ? "null" : typeof error}`;
    throw error;
  }
};

/**
 * A named failure-handler behavior, ported from `VectorOracle.handlerFrom` rather than reinvented.
 *
 * `null`/absent yields the LIBRARY DEFAULT wrapped in the recorder, exactly as the oracle does, so
 * the observation channel exists for every case without a fixture opting in and without changing
 * what any case does. `throw-in-handler` raises a plain `Error` through `throwSentinel`, where the
 * oracle raises `IllegalStateException`. The KIND is still not compared and still is not claimed to
 * be — mapping that Java type onto a JS error name would be actively wrong, for the reason set out
 * at `sentinelThrows`. What IS compared, now that the `expected.thrown` gate has lifted, is
 * REFERENCE IDENTITY: the object this function threw must be the object that escaped the lookup.
 */
function failureHandlerFor(spec) {
  if (spec === null || spec === undefined) return recordingHandler(() => core.RETURN_KEY);

  switch (spec.behavior) {
    case "return-key":
      return recordingHandler(() => core.RETURN_KEY);
    case "throw":
      return recordingHandler(() => core.THROW_EXCEPTION);
    case "return-string": {
      const text = spec.text;
      if (typeof text !== "string") unsupported("a return-string failure handler needs its text");
      return recordingHandler(() => core.returnString(text));
    }
    case "throw-in-handler": {
      const message = spec.message ?? "handler failed deliberately";
      return recordingHandler(() => throwSentinel(message));
    }
    // A handler that answers null instead of a response. Java rejects it at DefaultStrings.java:749
    // with a NullPointerException whose message it composes; the port refuses it too, at the same
    // point. Nothing is adapted here — the null is handed to the port verbatim and whatever the port
    // does with it is the answer compared against Java's.
    case "return-null":
      return recordingHandler(() => null);
    default:
      unsupported(`unknown failure handler behavior: ${spec.behavior}`);
  }
}

/**
 * The three built-ins of `DefaultTranslationFallbackPolicy` (TranslationFallbackPolicy.java), as
 * functions this runner can wrap in a recorder.
 *
 * A KNOWN HOLE, stated rather than hidden. The port accepts these three by NAME — the option is
 * typed `BuiltinFallbackPolicy | FallbackPolicy` — and a policy handed to it as a string cannot be
 * wrapped, because there is only one policy slot and the recorder has to occupy it. So every corpus
 * case that names a built-in exercises THIS table and not the port's, exactly as `VectorOracle`
 * wraps Java's built-in singletons rather than the library resolving them itself. The equivalence
 * that closes the hole is asserted by ablation in `test/fallback-policy.test.js`, which drives the
 * same lookups through the string form and the function form and requires identical results; delete
 * the port's table and that test goes red while the corpus stays green.
 */
const BUILTIN_FALLBACK_POLICIES = {
  "missing-or-no-match": (reason) => reason !== "resolution-failure",
  "any-failure": () => true,
  never: () => false,
};

/**
 * A named fallback-policy behavior, ported from `VectorOracle.policyFrom` / `customPolicyFrom`.
 *
 * `null`/absent yields `missing-or-no-match` wrapped in the recorder — the library default
 * (`DefaultStrings.java:473`), installed unconditionally so the channel exists for every case
 * without a fixture opting in, which is what `VectorOracle` does at its line 297.
 */
function fallbackPolicyFor(spec) {
  if (spec === null || spec === undefined)
    return recordingPolicy(BUILTIN_FALLBACK_POLICIES["missing-or-no-match"]);

  if (typeof spec === "string") {
    if (!Object.hasOwn(BUILTIN_FALLBACK_POLICIES, spec))
      unsupported(`unknown fallback policy: ${spec}`);
    return recordingPolicy(BUILTIN_FALLBACK_POLICIES[spec]);
  }

  switch (spec.behavior) {
    case "continue-for-locales": {
      const tags = new Set(spec.locales);
      return recordingPolicy((_reason, locale) => tags.has(locale));
    }
    case "continue-for-reasons": {
      // The corpus spells reasons as Java enum members; `adaptEnum` is the one place that mapping
      // lives, so an unlisted member fails loudly here instead of silently never matching.
      const reasons = new Set(spec.reasons.map(adaptEnum));
      return recordingPolicy((reason) => reasons.has(reason));
    }
    case "throw-in-policy": {
      const message = spec.message ?? "fallback policy failed deliberately";
      return recordingPolicy(() => throwSentinel(message));
    }
    // The policy-side counterpart. Handed to the port verbatim, not pre-validated here: the whole
    // point of the corpus rows that use it is what the PORT does with a null decision.
    case "return-null":
      return recordingPolicy(() => null);
    default:
      unsupported(`unknown custom fallback policy behavior: ${spec.behavior}`);
  }
}

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

/**
 * One `{ range, weight }` member, from whichever of the two spellings the corpus used.
 *
 * The ORACLE's own decoding, `VectorOracle.languageRangesFrom` at `:1016-1028`: a bare string
 * element is `new Locale.LanguageRange(s)`, whose weight is 1.0 by definition. This is authoring
 * vocabulary, not library API — `languageRangeFrom` in `lokalized/negotiate` requires the object
 * form deliberately — so the translation belongs here, on the runner's side of the line.
 *
 * A HEADER STRING is not decoded here and never will be: `Locale.LanguageRange.parse` expands the
 * pinned IANA closure (measured on the pinned Corretto 21: `parse("iw")` is `[iw, he]`,
 * `parse("sgn-BE-FR")` is `[sgn-be-fr, sgn-sfb, sfb, sgn-be-fx]`), so a runner that split on commas
 * would be inventing a different answer and calling it the port's.
 */
const rangeMemberFrom = (element) =>
  typeof element === "string" ? { range: element, weight: 1 } : { range: element.range, weight: element.weight };

/**
 * The ambient locale ingress a fixture names, as the port's `localeResolver`/`localeMatchResolver`.
 *
 * TWO RULES, both taken from `VectorOracle` rather than invented here.
 *
 * The behavior is decided on the SPEC'S SHAPE before anything is constructed, so a behavior this
 * port cannot yet reproduce reports the capability that blocks it and never runs. `match-ranges` is
 * the only such behavior and it is blocked on the header parser, which is A4's — every one of the
 * 26 fixtures naming it carries an Accept-Language string, none an explicit list.
 *
 * The RECORDER runs in the oracle's order: the value is produced first and appended afterwards, so
 * a fabrication refused by `LocaleMatchResult`'s own rules records no call at all. `forLocaleMatch`
 * is what makes that expressible on this side — it is the JS analogue of that constructor, applying
 * the instance-INDEPENDENT layer at the site that spelled the value, which is exactly where the
 * oracle applies it.
 *
 * `strings` arrives through a box because Java hands the supplier `this`: the two matcher-backed
 * behaviors negotiate against the very instance being built, which does not exist until
 * `createStrings` returns.
 */
function localeSourceFor(fixture, instanceBox) {
  const localeSpec = fixture.localeSupplier;
  const matchSpec = fixture.localeMatchSupplier;

  if (!localeSpec && !matchSpec) return null;
  if (localeSpec && matchSpec)
    throw new Error(`fixture ${fixture.id} sets both localeSupplier and localeMatchSupplier`);

  const spec = localeSpec ?? matchSpec;

  // `match-ranges` is the realistic browser shape and A4 is what unblocks it: every one of the 26
  // fixtures naming it carries an Accept-Language STRING, not an explicit list, so it could not run
  // before the parser existed. The module guard stays where the other three ingresses have it --
  // decided on the subpath's existence, before any range is matched.
  if (spec.behavior === "match-ranges" &&
    (!negotiateApi?.createLocaleNegotiator || !negotiateApi?.parseLanguageRanges))
    unsupported("createLocaleNegotiator is not implemented");

  /**
   * `matcher.matchFor(languageRangesFrom(config.get("ranges")))` (`VectorOracle:1046`, `:1075`),
   * where `matcher` is the instance itself. Built HERE, per call, rather than closed over: the
   * instance does not exist until `createStrings` returns, and its `getLocaleConfiguration()` is the
   * fallback Java has already resolved to a loaded catalog.
   */
  const rangeMatch = () => negotiateApi.createLocaleNegotiator(instanceBox.strings.getLocaleConfiguration())
    .matchForLanguageRanges(
      typeof spec.ranges === "string" ? negotiateApi.parseLanguageRanges(spec.ranges) : (spec.ranges ?? []).map(rangeMemberFrom));

  if (localeSpec) {
    if (spec.behavior !== "constant" && spec.behavior !== "match-ranges")
      unsupported(`unknown locale supplier behavior: ${spec.behavior}`);

    if (spec.behavior === "match-ranges")
      return {
        localeResolver: () => {
          // `.getLocale().orElse(...getFallbackLocale())` -- the oracle negotiates twice and takes the
          // fallback from the second result; one call answers the same thing, because the matcher is
          // pure and both results carry the same `fallbackLocale`.
          const match = rangeMatch();
          const locale = match.locale ?? match.fallbackLocale;
          supplierCalls.push({ kind: "localeSupplier", returnedLocale: locale, returnedMatchType: null });
          return locale;
        },
      };

    return {
      localeResolver: () => {
        // Normalized at the site that spelled it, which is what `forLocale` exists for, and recorded
        // in the same spelling Java records — `Locale#toLanguageTag`. Re-probed rather than assumed:
        // `normalizeTag` reproduces `forLanguageTag(x).toLanguageTag()` on every alias, extlang and
        // mixed-case tag this corpus uses.
        const locale = core.forLocale(spec.locale).locale;
        supplierCalls.push({ kind: "localeSupplier", returnedLocale: locale, returnedMatchType: null });
        return locale;
      },
    };
  }

  return {
    localeMatchResolver: () => {
      let match;

      if (spec.behavior === "match-ranges") {
        // The WHOLE match travels, not just its locale: `LocaleMatchResult`'s eight fields are what
        // the two-layer supplied-match validation reads, and a match rebuilt from the locale alone
        // would lose `languageRange`, `effectiveWeight` and `requestedLanguageRanges` -- the fields
        // `supplied-match.*` exists to pin.
        match = rangeMatch();
      } else if (spec.behavior === "match-locale") {
        // `matcher.matchFor(Locale)` on the instance itself. `getDirectLocaleContext` is the plan's
        // declared counterpart and is the SAME kernel `getResult` computes its own diagnostic from,
        // so this cannot supply a match the translation path would disagree with.
        match = instanceBox.strings.getDirectLocaleContext(spec.locale).localeMatch;
      } else if (spec.behavior === "fabricated") {
        // `new LocaleMatchResult(...)`, argument for argument. `range` becomes a bare range string
        // because the oracle builds it with the ONE-argument `Locale.LanguageRange` constructor,
        // whose weight is 1.0 — which is what `supplied-match.range.identity-includes-weight`
        // depends on: its requested list carries `fr@0.5`, so the containment check must fail.
        match = core.forLocaleMatch({
          requestedLanguageRanges: (spec.ranges ?? []).map(rangeMemberFrom),
          locale: spec.locale ?? null,
          languageRange: spec.range ?? null,
          effectiveWeight: fabricatedWeight(spec.weight),
          matchType: adaptEnum(spec.matchType ?? "NONE"),
          fallbackLocale: spec.fallbackLocale ?? "en",
          consideredLocales: spec.consideredLocales ?? [],
          isMatch: (spec.locale ?? null) !== null,
        }).localeMatch;
      } else {
        unsupported(`unknown locale match supplier behavior: ${spec.behavior}`);
      }

      supplierCalls.push({
        kind: "localeMatchSupplier",
        returnedLocale: match.locale ?? null,
        returnedMatchType: match.matchType,
      });
      return match;
    },
  };
}

/**
 * A fabricated match's effective weight, including the NON-FINITE value JSON cannot spell.
 *
 * `LocaleMatchResult:111` refuses a weight that is not finite, at most 0, or above 1. The last two
 * are ordinary JSON numbers; the first is why `VectorOracle.fabricatedWeightFrom` accepts a string
 * sentinel, and this is its counterpart. A closed set of TWO: an unrecognized string is an authoring
 * mistake and crashes, because silently coercing it (`Number("infnity")` is `NaN`) would still land
 * on the non-finite arm and make a typo look like the case it was meant to be.
 *
 * `nan` is the sentinel that DISCRIMINATES the clause and `infinity` is the one that merely reaches
 * it. Measured 2026-09-06: deleting `!Number.isFinite(effectiveWeight)` from `src/core/index.js`
 * leaves the infinity row passing, because `Infinity > 1` refuses it anyway. `NaN > 1` and
 * `NaN <= 0` are both false, so the finiteness test is the only conjunct that can reject NaN.
 *
 * @param {unknown} weight
 * @returns {number | null}
 */
function fabricatedWeight(weight) {
  if (weight === undefined || weight === null) return null;
  if (typeof weight === "number") return weight;
  if (weight === "infinity") return Infinity;
  if (weight === "nan") return NaN;
  throw new AuthoringError(`unknown fabricated match weight sentinel '${String(weight)}'`);
}

/**
 * An authoring mistake in a `constructionOverrides` value. NOT an `Unsupported` and NOT a refusal:
 * it must escape `runCase` as a crash so the run reports it, because the one thing a
 * refusal-recording harness must never do is bank a typo as a believable observation. That exact
 * mistake has already been made once in this project, on the `define` decoder, where nine mistyped
 * shapes were silently recorded as plausible refusals.
 */
class AuthoringError extends Error {}

/**
 * The degenerate catalog map a `constructionOverrides.catalogSource` names.
 *
 * The set is CLOSED and mirrors `VectorOracle.buildStrings` value for value; an unknown value
 * THROWS rather than quietly handing `createStrings` a valid record, which would close the case with
 * a pass that observed nothing. Each degenerate map is built from the fixture's own first catalog,
 * exactly as the oracle's `firstCatalogOf(loaded)` does, so the only difference between the control
 * and a refusal row is the one degeneracy.
 *
 * @param {string} catalogSource
 * @param {{ files: Record<string, unknown> }} fixture
 * @returns {Record<string, unknown> | undefined} the `strings` slice of the createStrings options
 */
function degenerateCatalogFor(catalogSource, fixture) {
  const entries = Object.entries(fixture.files ?? {});
  if (entries.length === 0)
    throw new AuthoringError(`a constructionOverrides fixture must declare files to degenerate`);

  // `firstCatalogOf(loaded)` — the map's first VALUE, which is this family's `{ Greeting: ... }`.
  const [, firstCatalog] = entries[0];

  switch (catalogSource) {
    // :250 -- no catalog source at all. The option is omitted, not set to undefined-by-spread.
    case "omit":
      return undefined;
    // :262 -- a supplier that answers null. `createStrings` takes the map itself, so an explicit
    // null map is the state Java's null-returning supplier produces.
    case "returnsNull":
      return { strings: null };
    // :273 -- a null locale key, which needs a Map: a record cannot carry one.
    case "nullLocaleKey":
      return { strings: new Map([[null, firstCatalog]]) };
    // :280 -- two DISTINCT keys whose tags collide once lowercased. Measured on the pinned Corretto
    // 21: new Locale("en","US","POSIX").toLanguageTag() is "en-US-POSIX" and the "posix" one is
    // "en-US-posix", so these two tags ARE the oracle's two Locale keys. A record holds both — JS
    // object keys are case-sensitive — so unlike the null key this needs no Map.
    case "duplicateNormalizedTag":
      return { strings: { "en-US-POSIX": firstCatalog, "en-US-posix": firstCatalog } };
    // :286 -- a null catalog for one locale.
    case "nullCatalogValue":
      return { strings: { en: null } };
    // :293 -- a null entry INSIDE an otherwise valid catalog. The oracle takes the first
    // LocalizedString of the loaded catalog and appends null; the JS counterpart of
    // `Iterable<LocalizedString>` is plan 3.2's `LocalizedStringInput[]`, so the first definition is
    // spelled as one input object and a null follows it.
    case "nullEntry": {
      const definitions = Object.entries(/** @type {Record<string, object>} */ (firstCatalog));
      if (definitions.length === 0)
        throw new AuthoringError(`the first catalog of a nullEntry fixture must hold a definition`);
      const [key, definition] = definitions[0];
      return { strings: { en: [{ key, ...definition }, null] } };
    }
    // :500 -- the SAME key twice inside one locale's iterable. The oracle appends the first loaded
    // `LocalizedString` to the list twice; the JS counterpart is the same definition object twice in
    // an ARRAY catalog. A record cannot express it on either side, which is the reason this needs the
    // array form and the reason a port that only ever built records would never meet the refusal.
    case "duplicateKey": {
      const definitions = Object.entries(/** @type {Record<string, object>} */ (firstCatalog));
      if (definitions.length === 0)
        throw new AuthoringError(`the first catalog of a duplicateKey fixture must hold a definition`);
      const [key, definition] = definitions[0];
      return { strings: { en: [{ key, ...definition }, { key, ...definition }] } };
    }
    // A PROGRAMMATIC catalog, and the only arm whose outcome the VALUE does not decide: what
    // `createStrings` does with it depends on the model the fixture wrote. The oracle hands
    // `Strings.Builder.localizedStringSupplier` LocalizedString graphs built by `define`'s decoder,
    // which is what reaches `DefaultStrings:297` -> `LocalizedStringValidator` with no
    // `LocalizedStringLoader` check in front of it; plan 3.2's counterpart of an
    // `Iterable<LocalizedString>` is `LocalizedStringInput[]`, so that is the JS shape, keyed at the
    // fixture's fallback locale exactly as the oracle keys it.
    //
    // NOT routed through `defineLocalizedString`. That export validates EAGERLY, so every refusal in
    // this family would come from the definition call and none from `createStrings` -- a different
    // site than the one the oracle recorded. Java's `LocalizedString.Builder.build()` validates
    // nothing either; both sides therefore build an inert graph and let the CONSTRUCTOR refuse it.
    case "defined": {
      const model = fixture.constructionOverrides?.definedCatalog;
      if (!Array.isArray(model) || model.length === 0)
        throw new AuthoringError(`catalogSource 'defined' needs a non-empty definedCatalog`);
      return { strings: { [fixture.fallbackLocale]: model.map((node) => definedNode(node, true)) } };
    }
    default:
      throw new AuthoringError(`unknown constructionOverrides.catalogSource '${catalogSource}'`);
  }
}

/**
 * One node of a `definedCatalog` model, in `LocalizedStringInput` shape.
 *
 * The model vocabulary is the STRINGS-FILE vocabulary, because that is what `VectorOracle`'s
 * `localizedStringFrom` decodes: alternatives are `{ "<expression>": <body> }` objects and a
 * placeholder is `{ value | range, translations }` or `{ translation, alternatives }`. Plan 3.2's
 * `LocalizedStringInput` spells the same model differently -- the expression is a MEMBER, and a
 * placeholder declares its `kind` -- so this is a shape transform and nothing else. Every unknown
 * member throws an `AuthoringError`, matching the oracle's decoder member for member: a mistyped
 * model must stop the run, never become a plausible refusal.
 *
 * @param {any} node
 * @param {boolean} root whether a literal `key` member is expected (true only at the top level)
 * @returns {object}
 */
function definedNode(node, root) {
  if (node === null || typeof node !== "object" || Array.isArray(node))
    throw new AuthoringError(`a definedCatalog node must be an object; got ${JSON.stringify(node)}`);
  for (const member of Object.keys(node))
    if (!["key", "translation", "commentary", "placeholders", "alternatives"].includes(member))
      throw new AuthoringError(`unknown definedCatalog node member '${member}'`);
  if (root && typeof node.key !== "string")
    throw new AuthoringError(`a top-level definedCatalog node needs a string 'key'`);

  /** @type {Record<string, unknown>} */
  const out = {};
  if (root) out.key = node.key;
  if ("translation" in node) out.translation = node.translation;
  if ("commentary" in node) out.commentary = node.commentary;
  if (node.placeholders !== undefined && node.placeholders !== null) {
    /** @type {Record<string, unknown>} */
    const placeholders = {};
    for (const [name, definition] of Object.entries(node.placeholders))
      placeholders[name] = definedPlaceholder(name, definition);
    out.placeholders = placeholders;
  }
  if (node.alternatives !== undefined && node.alternatives !== null) {
    if (!Array.isArray(node.alternatives))
      throw new AuthoringError(`a definedCatalog 'alternatives' member must be an array`);
    out.alternatives = node.alternatives.map((element) => {
      if (element === null || typeof element !== "object" || Object.keys(element).length !== 1)
        throw new AuthoringError(
          `each definedCatalog alternative must be an object with exactly one expression`,
        );
      const [expression] = Object.keys(element);
      return { expression, ...definedNode(element[expression], false) };
    });
  }
  return out;
}

/**
 * One placeholder of a `definedCatalog` model.
 *
 * @param {string} name
 * @param {any} definition
 * @returns {object}
 */
function definedPlaceholder(name, definition) {
  if (definition === null || typeof definition !== "object")
    throw new AuthoringError(`definedCatalog placeholder '${name}' must be an object`);
  for (const member of Object.keys(definition))
    if (!["value", "range", "translations", "translation", "alternatives"].includes(member))
      throw new AuthoringError(`unknown definedCatalog placeholder member '${member}' on '${name}'`);

  const languageForm = ["value", "range", "translations"].some((m) => m in definition);
  const template = ["translation", "alternatives"].some((m) => m in definition);
  // The oracle's own rule, restated: a mixed placeholder describes an object no catalog can hold.
  if (languageForm === template)
    throw new AuthoringError(
      `definedCatalog placeholder '${name}' must use language-form members [value, range, ` +
        `translations] or template members [translation, alternatives], not both or neither`,
    );

  if (template) {
    const alternatives = definition.alternatives;
    return {
      kind: "expression",
      translation: definition.translation,
      // PRESENCE, not truthiness: an empty list is the input that reaches Java's
      // `ExpressionTranslation:871`, and dropping it would quietly build a valid object instead.
      ...(alternatives === undefined
        ? {}
        : {
            alternatives: (Array.isArray(alternatives) ? alternatives : []).map((element) => {
              if (element === null || typeof element !== "object" || Object.keys(element).length !== 1)
                throw new AuthoringError(
                  `each definedCatalog fragment alternative on '${name}' must be an object with ` +
                    `exactly one expression`,
                );
              const [expression] = Object.keys(element);
              return { expression, translation: element[expression] };
            }),
          }),
    };
  }

  return {
    kind: "language-form",
    ...("value" in definition ? { value: definition.value } : {}),
    ...("range" in definition ? { range: definition.range } : {}),
    translations: definition.translations,
  };
}

/**
 * The degenerate tiebreaker map a `constructionOverrides.tiebreakerSource` names.
 *
 * Three shapes a JSON `tiebreakers` object cannot spell and a JS caller can, because plan 3.1 types
 * the construction input as a `TiebreakerMap` — a record OR a `ReadonlyMap` — and only the Map half
 * can carry a null key. Closed set, mirroring `VectorOracle.buildStrings` value for value; an
 * unknown value THROWS rather than quietly handing `createStrings` a valid map.
 *
 * @param {string} tiebreakerSource
 * @returns {{ tiebreakers: unknown }}
 */
function degenerateTiebreakersFor(tiebreakerSource) {
  switch (tiebreakerSource) {
    // :335 -- a null locale LIST for a language code.
    case "nullList":
      return { tiebreakers: { en: null } };
    // :343 -- a null entry INSIDE a list.
    case "nullEntry":
      return { tiebreakers: { en: [null] } };
    // :2650 -- a NULL language code, which needs the Map form on both sides.
    case "nullLanguageCode":
      return { tiebreakers: new Map([[null, ["en"]]]) };
    default:
      throw new AuthoringError(`unknown constructionOverrides.tiebreakerSource '${tiebreakerSource}'`);
  }
}

/**
 * The `createStrings` options for a fixture, with any `constructionOverrides` applied.
 *
 * Split out of `stringsFor` so the `construct` arm can build the options OUTSIDE its try block and
 * let only `createStrings` itself throw inside it. Without the split, an `AuthoringError` or an
 * `Unsupported` raised while assembling options would be caught and recorded as a construction
 * refusal — a harness turning its own mistakes into observations.
 *
 * @param {any} fixture
 * @param {{ strings: any }} instanceBox filled by the caller the moment construction returns
 * @param {{ catalogSource?: string, localeSource?: string } | null} overrides
 */
function createStringsOptionsFor(fixture, instanceBox, overrides) {
  if (!core?.createStrings) unsupported("createStrings is not implemented");
  if (fixture.loadOnly) unsupported("load-only fixture: no Strings instance is constructed");
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

  // The locale source, and EXACTLY ONE of them. A fixture naming a supplier has its `instanceLocale`
  // IGNORED by the oracle — `VectorOracle.java:268-276` installs the constant-locale supplier only in
  // the both-absent arm — so passing `locale` alongside a resolver here would ask the port for a
  // state Java never built, and the port refuses it at construction on `DefaultStrings:254`'s
  // proposition. The box is filled by the caller, before any lookup can consult a resolver.
  const localeSource = localeSourceFor(fixture, instanceBox);

  // `constructionOverrides.localeSource`, a closed set of exactly one value. "omit" installs
  // NEITHER source, which is Java's both-absent arm; the oracle has no "both" value because Java
  // cannot be put in that state (its two builder setters clear each other), and the port's refusal
  // of the both-present literal is the user's recorded decision that B3 landed, not this arm's.
  let localeOption;
  if (overrides?.localeSource === undefined)
    localeOption = localeSource ?? { locale: fixture.instanceLocale ?? fixture.fallbackLocale };
  else if (overrides.localeSource === "omit") localeOption = {};
  // Strings.java:288 / :310 — a NULL setter argument does not clear the sibling supplier, so the
  // surviving source decides and the instance BUILDS. The JS analogue of "the caller wrote the key
  // and its value was null" is an explicit `undefined` beside the other resolver: a config object
  // has no setters, so `undefined` is the only way to spell "named but not supplied", and the port
  // must read it as ABSENT rather than as a second specified source. Reaching for `null` instead
  // would test a different proposition — Java's builder was handed null, but its CONSTRUCTOR was
  // handed nothing at all, and it is the constructor's "exactly one" rule that these rows are read
  // against.
  else if (overrides.localeSource === "explicitNullLocaleSupplier")
    localeOption = { ...localeSource, localeResolver: undefined };
  else if (overrides.localeSource === "explicitNullMatchSupplier")
    localeOption = { ...localeSource, localeMatchResolver: undefined };
  else throw new AuthoringError(`unknown constructionOverrides.localeSource '${overrides.localeSource}'`);

  const catalogOption =
    overrides?.catalogSource === undefined
      ? { strings: fixture.files }
      : degenerateCatalogFor(overrides.catalogSource, fixture);

  // `instanceCallbacks: "libraryDefaults"` installs NEITHER recording callback, so the port selects
  // its OWN defaults exactly as `DefaultStrings:472`/`:473` do. It is the one arm where the always-on
  // wrapping below would erase the observation, which is why it is an override rather than a mode.
  const libraryDefaults = overrides?.instanceCallbacks === "libraryDefaults";
  if (overrides?.instanceCallbacks !== undefined && !libraryDefaults)
    throw new AuthoringError(`unknown constructionOverrides.instanceCallbacks '${overrides.instanceCallbacks}'`);

  const tiebreakerOption =
    overrides?.tiebreakerSource === undefined
      ? fixture.tiebreakers
        ? { tiebreakers: fixture.tiebreakers }
        : {}
      : degenerateTiebreakersFor(overrides.tiebreakerSource);

  return {
    fallbackLocale: fixture.fallbackLocale,
    ...localeOption,
    ...catalogOption,
    ...(loadingLimits ? { loadingLimits } : {}),
    ...tiebreakerOption,
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
    // ALWAYS installed, wrapping the library default when the fixture names none — the rule
    // `VectorOracle` follows at its lines 291-298, and the reason is the same on both sides: the
    // failure and policy channels are recorded observables on every case, not opt-in extras, so a
    // runner that only installed them when a fixture asked would leave 251 policy-recording and 298
    // failure-recording cases unable to be compared at all. Pure delegation, so behavior-neutral:
    // the delegates are `RETURN_KEY` and `missing-or-no-match`, which is what an unconfigured
    // `createStrings` would have used anyway. The cost is that the port's OWN defaulting is never
    // exercised here; `test/fallback-policy.test.js` covers it.
    ...(libraryDefaults
      ? {}
      : {
          onFailure: failureHandlerFor(fixture.translationFailureHandler),
          fallbackPolicy: fallbackPolicyFor(fixture.translationFallbackPolicy),
        }),
  };
}

/**
 * Build a Strings instance for a fixture, or declare the case unsupported.
 *
 * `runtimeLimits` is deliberately NOT skipped, and `loadingOptions` is honored rather than skipped
 * (both in `createStringsOptionsFor`). Both used to abandon their cases before running them, which
 * is the skip-then-guess that function's neighbours exist to avoid: 44 of the 83 cases that named a
 * custom runtime limit turn out to produce Java's exact answer under the fixed v1 limits, because
 * the fixture raised a ceiling the value never approached or lowered one it still fit under. Those
 * are passes, not remaining work. The 24 that genuinely differ are attributed after the fact in
 * `classifyFailure`.
 */
function stringsFor(fixture) {
  // A `constructionOverrides` fixture is a DEGENERATE record whose subject is the refusal itself, and
  // `construct` is the only operation that can observe one. lokalized-spec's ingest already refuses
  // to pair such a fixture with any other operation, so reaching here means the corpus and this
  // runner disagree — which is reported as a crash rather than quietly built with the overrides
  // ignored, since ignoring them would run a DIFFERENT configuration under the case's name.
  if (fixture.constructionOverrides)
    throw new AuthoringError(
      "a fixture carrying constructionOverrides is only observable through the 'construct' operation",
    );

  const instanceBox = { strings: null };
  instanceBox.strings = core.createStrings(createStringsOptionsFor(fixture, instanceBox, null));
  return instanceBox.strings;
}

/**
 * Evidence that a constructed instance is USABLE and not merely allocated.
 *
 * `VectorOracle.describeConstructionProbe` asks the new instance for `input.probeKey`, so the one
 * row that constructs is backed by an answer rather than by the absence of a throw. Without it, a
 * `construct` family made entirely of refusals would never show that the operation can tell
 * acceptance from refusal at all — which is what the control case's own note says it is for.
 *
 * @param {any} strings
 * @param {{ probeKey?: string }} input
 */
function constructionProbe(strings, input) {
  if (input.probeKey == null) return null;

  try {
    return { value: strings.get(input.probeKey), threwType: null };
  } catch (error) {
    // Recorded, not rethrown, for the oracle's reason: a key that throws is still evidence the
    // instance is live, and letting it escape would be indistinguishable from a refused
    // construction. The JS constructor name will not equal any Java class name, so a row recording
    // a throwing probe FAILS here rather than passing — there is no such row today, and the guard
    // in `expectedConstructionProbe` says so before this one can be reached.
    return { value: null, threwType: /** @type {Error} */ (error).constructor.name };
  }
}

/**
 * The recorded probe, projected onto the names this runner raises.
 *
 * A recorded `threwType` is a JAVA class name. It is carried through UNTRANSLATED and left to fail
 * the comparison, which is deliberate and is a change from this function's first draft.
 *
 * The first draft reported `unsupported(\`no JS counterpart declared for a construction probe
 * throwing ${probe.threwType}\`)` here. That is defensible — it keys on the RECORDED JAVA type
 * rather than on the port's output, so it could not absorb a port defect, and `expectedResolverCalls`
 * and `ERROR_NAME` take the same shape. But it is still a new `unsupported(` on the WANTED side of a
 * comparison arm, which is the literal construct this file is grepped for, and it bought nothing: a
 * Java class name compared against a JS constructor name simply differs, so the row FAILS either
 * way, and FAILED is the louder and more accurate of the two. The asymmetry settled it — a probe
 * that throws on the JS side ALREADY fails against a recorded `threwType: null`, with no guard
 * offering it an attribution, so the guard was excusing one direction of a symmetric comparison.
 *
 * Removing it cannot weaken the runner: it can only turn attributed non-work into a FAILED row,
 * never the reverse. No corpus row is affected in either direction. All eight `construct` cases were
 * checked against `behavioral-vectors.json` rather than against this comment: seven record
 * `probe: null` and the eighth, `owed-construct.control.ordinary-fixture-constructs`, records
 * `{threwType: null, value: "Hello"}`.
 *
 * @param {{ value: unknown, threwType: string | null } | null} probe
 */
function expectedConstructionProbe(probe) {
  if (probe == null) return null;
  return { value: probe.value, threwType: probe.threwType };
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
 *
 * THE FALLBACK IS NOW SAID OUT LOUD, and the bare `catch` that hid it is gone. It was the same
 * swallow shape `optionalSubpath()` was introduced to remove: with `lokalized-spec/fixtures/` absent,
 * `warnings.order.parse-matches-directory-traversal-order` failed DETERMINISTICALLY — a missing
 * input reported as a port defect, which cost a reviewer a false baseline before they found it. So
 * the three outcomes are now distinguished. Absent, or present with different content (the corpus
 * and the checkout disagree about the fixture, so the on-disk order is not this fixture's order):
 * fall back, and record it. Present and unreadable or malformed: THROW, because that is a broken
 * input and not a missing one. Measured today: 550 of 550 fixtures are present and byte-equal, so
 * nothing takes the fallback and the reported list is empty.
 */
const declaredFilesCache = new Map();
/** @type {string[]} */
const declaredOrderFallbacks = [];
function declaredFilesFor(fixtureId, fixture) {
  if (!declaredFilesCache.has(fixtureId)) {
    const path = join(specDir, `fixtures/${fixtureId}.json`);
    let declared = null;

    if (!existsSync(path)) {
      declaredOrderFallbacks.push(`${fixtureId}: no ${path}`);
    } else {
      // No catch: a fixture file that exists and cannot be read or parsed is a broken checkout, and
      // silently substituting the alphabetized copy for it is how an ordering case reports a defect
      // it does not have.
      const onDisk = JSON.parse(readFileSync(path, "utf8"));

      // Same content or it is not the same fixture: order may differ, nothing else may.
      if (jcs(onDisk.files ?? {}) === jcs(fixture.files ?? {})) declared = onDisk.files ?? {};
      else declaredOrderFallbacks.push(`${fixtureId}: ${path} declares different content`);
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

/**
 * The caller's placeholders, in the shape `get`/`getResult` accept.
 *
 * `nullPlaceholderName` mirrors the flag `VectorOracle` reads for `DefaultStrings:690`: JSON has no
 * null object key, so a case asks for one instead of spelling it. It forces the MAP form, which is
 * the only half of plan 3.2's `Placeholders` union that can carry a null key — a record cannot, and
 * building one would silently rename the entry to the string "null" and test nothing.
 */
const placeholdersFor = (input) => {
  const named =
    input.placeholders === undefined
      ? undefined
      : Object.entries(input.placeholders).map(
          (/** @type {[string, unknown]} */ [k, v]) => [k, placeholderValue(v)],
        );

  if (!input.nullPlaceholderName) return named === undefined ? undefined : Object.fromEntries(named);
  return new Map([...(named ?? []), [null, "ignored"]]);
};

/**
 * The eight recorded match fields, from the ACTUAL side.
 *
 * Extracted so the result's `localeMatchResult` and the failure channel's cannot drift apart. In
 * Java they are the SAME object on every row that carries both — `matchObjectIdenticalToResult` is
 * recorded `true` on all 370 — so two independently maintained field lists would be two chances to
 * add a field to one and forget it on the other.
 *
 * The `match ? … : null` shape is A0's repair and is deliberate: the actual side is written from
 * the actual value alone, so a port emitting a match where Java records none is a `jcs` mismatch
 * rather than a pass.
 */
/**
 * The matched range, as a `{ range, weight }` pair on BOTH sides — a strictly stronger comparison
 * than the bare-string one it replaces, not a widened one.
 *
 * The corpus records `languageRange` as a string, because `describeMatch` projects
 * `LanguageRange#getRange()`. Java's field is a whole `LanguageRange` and its weight IS part of its
 * identity (`LocaleMatchResult:108` checks `requestedLanguageRanges.contains(languageRange)`, and
 * `new LanguageRange("he")` does not equal `new LanguageRange("he", 0.5)`), so the weight was
 * information the projection simply dropped. It is recoverable without inventing anything: Java's
 * own constructor guarantees the matched range is one of the requested ones, and MEASURED over the
 * corpus, all 1,307 rows carrying a `languageRange` name a range text that appears in
 * `requestedLanguageRanges` exactly once — 0 missing, 0 ambiguous. So the wanted weight is a fact
 * the corpus already states, and 34 rows have a governing weight that is not 1.
 *
 * A range text that is absent, or present under two different weights, THROWS. It would mean the
 * derivation no longer holds, and the alternative — falling back to comparing the text alone — is
 * the shape that silently retires a comparison the moment the corpus grows a row it did not expect.
 *
 * Both sides normalize the bare-string spelling to weight 1.0, which is what a one-argument
 * `LanguageRange` means. That keeps the ACTUAL side honest in both directions: a port that regressed
 * to emitting the bare text is compared as `{text, 1}` and MISMATCHES any row whose governing weight
 * is 0.9, rather than passing because the texts agree.
 */
const asWeightedRange = (languageRange) =>
  languageRange === null || languageRange === undefined
    ? null
    : typeof languageRange === "string"
      ? { range: languageRange, weight: 1 }
      : { range: languageRange.range, weight: languageRange.weight };

const expectedWeightedRange = (languageRange, requestedLanguageRanges) => {
  if (languageRange === null || languageRange === undefined) return null;

  const text = typeof languageRange === "string" ? languageRange : languageRange.range;
  const hits = (requestedLanguageRanges ?? []).filter((r) => r.range === text);
  // A DUPLICATE range text is fine and two rows rely on it — `owed.m3b.electionguard.duplicate-
  // member-does-not-reelect` requests `nsl` twice. What must be unique is the WEIGHT, which is the
  // fact being derived; requiring a unique HIT instead turned those two rows red for a reason that
  // had nothing to do with them.
  const weights = new Set(hits.map((r) => r.weight));

  if (weights.size !== 1)
    throw new Error(
      `the corpus records languageRange ${JSON.stringify(text)} against ${hits.length} requested ranges ` +
        `of that text carrying ${weights.size} distinct weights; the weight is no longer derivable and ` +
        `this projection must be revisited rather than narrowed back to the range text`,
    );

  return { range: text, weight: [...weights][0] };
};

const projectMatch = (match) => match ? {
  matchType: match.matchType,
  locale: match.locale ?? null,
  isMatch: match.isMatch,
  fallbackLocale: match.fallbackLocale,
  consideredLocales: match.consideredLocales,
  effectiveWeight: match.effectiveWeight,
  languageRange: asWeightedRange(match.languageRange),
  requestedLanguageRanges: match.requestedLanguageRanges,
} : null;

/** The same eight fields from the WANTED side. `undefined` throws here, deliberately: the corpus
 *  always carries the key, and a silent `== null` would turn a missing field into a passing null. */
const expectedMatchProjection = (match) => match === null ? null : {
  matchType: adaptEnum(match.matchType),
  locale: match.locale,
  isMatch: match.isMatch,
  fallbackLocale: match.fallbackLocale,
  consideredLocales: match.consideredLocales,
  effectiveWeight: match.effectiveWeight,
  languageRange: expectedWeightedRange(match.languageRange, match.requestedLanguageRanges),
  requestedLanguageRanges: match.requestedLanguageRanges,
};

/** Project a JS TranslationResult into the corpus's recorded Java shape.
 *
 *  Takes ONLY the actual result. It used to take `expected` as well, unused since `projectMatch` was
 *  extracted, and an unused `expected` in scope on the actual side is precisely what makes a
 *  `?? expected.x` default writable — the one edit this projection's own comment forbids. Removed so
 *  it cannot be written by accident. */
function projectResult(result) {
  return {
    key: result.key,
    translation: result.translation,
    status: result.status,
    lookupLocale: result.lookupLocale,
    resolvedLocale: result.resolvedLocale ?? null,
    attemptedLocales: [...result.attemptedLocales],
    isFallback: result.isFallback,
    failureReason: result.failureReason ?? null,
    // The corpus records EIGHT match fields and the port's `matchFor` produces all eight, so all
    // eight are compared — symmetrically, the same key list on both sides of `jcs`. The narrowed
    // `{matchType, locale}` projection this replaces left six diagnostics unchecked, and one of them
    // was `fallbackLocale`: the port echoed the configured spelling where Java records the RESOLVED
    // loaded catalog, and no comparison could see it. Widening a projection is only honest when both
    // sides widen together; a field added here alone, or an `?? expected.x` default, would restore
    // green without restoring correctness.
    localeMatchResult: projectMatch(result.localeMatch ?? null),
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
    localeMatchResult: expectedMatchProjection(expected.localeMatchResult),
  };
}

/** A recorded Java cause class name, as the JS error name this port raises. @see CAUSE_NAME */
function adaptCauseType(causeType) {
  if (causeType === null || causeType === undefined) return null;
  if (!(causeType in CAUSE_NAME)) {
    const owner = CAUSE_OWNER[causeType];
    // The `operationNotImplemented` discipline, applied to the cause channel. See `CAUSE_OWNER`.
    if (!owner)
      throw new AuthoringError(
        `a resolution cause of type ${causeType} reported unsupported with no entry in CAUSE_OWNER. ` +
        `Every reason must name who owes the work; add an entry, or declare the type in CAUSE_NAME.`,
      );
    unsupported(`no JS counterpart declared for a resolution cause of type ${causeType} (${owner})`);
  }
  return CAUSE_NAME[causeType];
}

/**
 * What the failure handler was handed, projected. `VectorOracle.describeObservedFailures`.
 *
 * `causeMessage` is the ONE recorded field this projection omits. It is not dropped: it is compared
 * downstream, against `DECLARED_CAUSE_MESSAGE_DIVERGENCES`, and an undeclared divergence FAILS the
 * run.
 *
 * THIS COMMENT USED TO SAY THE OPPOSITE OF THE TRUTH, and the correction is the point of the slice
 * that changed it. It read "a declared JS-idiomatic decision in 35 places ... 35 known, reviewed
 * divergences", and 35 was the count of divergences NOBODY HAD EVER LOOKED AT — the declaration
 * table held four entries covering seven rows. When they were finally enumerated and each tested
 * against the Java source, the pinned JDK and the corpus, sixteen were simply unfixed and are now
 * reproduced byte for byte; the rest are Java-only concepts and each carries its argument. A comment
 * asserting a review that never happened is worse than no comment, because it retires the question.
 *
 * MEASURED, correcting an earlier version of this comment that argued the omission could narrow
 * nothing because the string is always the one `expected.result.failureCause.message` already
 * carries. Only 244 rows record BOTH — those 244 do agree byte for byte, zero disagreements — while
 * 227 further rows record a failure `causeMessage` with NO result-level counterpart at all (73
 * `get`, which has no result object, and 154 `getResult`), 42 of them non-null. The earlier "370"
 * was the count of `matchObjectIdenticalToResult === true` rows, cited correctly two paragraphs
 * below and wrongly here; the two statistics had been conflated. Those 42 messages were therefore
 * verified by nothing. They are now banked through `failureCauseMessages`, on exactly the same terms
 * as the result-level one.
 *
 * `matchObjectIdenticalToResult` is TRI-STATE and the null arm means "not comparable", not "not
 * identical": a `get` case produces no result object, so there is nothing to compare the handler's
 * match against. Reporting `false` there would invent a divergence.
 *
 * @param {unknown} resultMatch the result's own match object, or null when there is no result
 */
function projectFailures(resultMatch, expected = null) {
  return failureCalls.map((failure, index) => ({
    key: failure.key,
    reason: failure.reason,
    lookupLocale: failure.lookupLocale,
    attemptedLocales: [...failure.attemptedLocales],
    message: failure.message,
    // Java sorts through a `TreeSet` over the placeholder keys; JS `Array#sort` is the same UTF-16
    // code-unit order. Sorted on BOTH sides by the oracle and by this line, never on one.
    placeholderNames: Object.keys(failure.placeholders).sort(),
    // Mirrors the expected side's same-object rule: when this cause IS the row's constructed thrown
    // exception, the THROWN table governs and any of its names is rendered identically, exactly as
    // `thrownProjection`'s arm 3 does. Outside that shape this is `causeNameOf` unchanged.
    causeType: (() => {
      const actual = causeNameOf(failure.cause);
      if (expected === null) return actual;
      // Paired BY INDEX with the expected failure, because the actual record carries a live Error
      // and the expected one carries a Java class name — the same pairing the comparison itself uses.
      const names = causeNamesFor((expected.failures ?? [])[index] ?? null, expected);
      return names !== null && names.includes(actual) ? names.join(" or ") : actual;
    })(),
    localeMatchResult: projectMatch(failure.localeMatch ?? null),
    matchObjectIdenticalToResult: resultMatch === null ? null : failure.localeMatch === resultMatch,
  }));
}

/**
 * The recorded Java failures, in the same shape.
 *
 * `?? []` is symmetric rather than a default that hides a difference: `VectorOracle` adds the key
 * only when the list is non-empty, so an absent key and an empty list are the same state on the
 * Java side — while the actual side is always the real recorded list, so a port that fires the
 * handler where Java never did compares non-empty against `[]` and FAILS.
 */
/**
 * ONE CONSTRUCTION SITE CANNOT HAVE TWO JS NAMES.
 *
 * `CAUSE_NAME` and `ERROR_NAME` were built independently and disagree for
 * `java.lang.IllegalArgumentException`: as a recorded CAUSE it maps to `"Error"` (72 rows depend on
 * that), and as a CONSTRUCTED THROW it maps to `["TypeError","RangeError"]` (34 rows depend on that).
 * Both are right for the rows that motivated them, because in those rows the cause and the throw
 * come from DIFFERENT sites — a render-path refusal against an ingress refusal — and the port
 * legitimately raises a different error at each.
 *
 * The three `lvariant.exhausting-walk.*` rows are the ones where the two channels describe the same
 * site. `TranslationResult`'s constructor validates the attempted-locale chain twice for one lookup:
 * once at `DefaultStrings.java:716`, inside the walk's `try`, where the refusal is caught and
 * retained as the failure's cause, and once at `:755`, outside every `try`, where the RETURN_KEY
 * response rebuilds the result and the refusal escapes. Same site, same inputs, same class, same
 * message — and two DISTINCT objects, which is why this helper is not the rethrow arm.
 *
 * The rule is structural, not a carve-out for an id: when a failure's cause and the row's throw come
 * from the same site — same class, same message, and the corpus says the throw is NOT the retained
 * object — the THROWN table governs, because the escaping error is the one whose name the port's
 * public contract fixes and a port cannot name one site two ways.
 *
 * WHY THE PREDICATE MOVED. It read `thrown.causeType === null`, which was a proxy for "the throw was
 * constructed" and is exactly the proxy `thrownProjection`'s arm 2 also had to give up: it excluded
 * the two `ill-formed-attempted-locale` rows, whose constructed `IllegalArgumentException` WRAPS an
 * `IllformedLocaleException`, for a reason that has nothing to do with which object escaped. The
 * corpus now records the reference comparison, so the predicate asks for it. MEASURED over the whole
 * corpus: three rows match this shape, and the 25 rows the rethrow arm exists for are excluded by
 * `identicalToRetainedCause === true`, where both tables already agree or `ERROR_NAME` is silent.
 */
function causeNamesFor(failure, expected) {
  const causeType = failure?.causeType ?? null;
  const thrown = expected.thrown;
  const sameSiteAsConstructedThrow =
    thrown != null && causeType !== null && thrown.identicalToRetainedCause !== true &&
    thrown.type === causeType && thrown.message === (failure?.causeMessage ?? null) &&
    causeType in ERROR_NAME;
  return sameSiteAsConstructedThrow ? ERROR_NAME[causeType] : null;
}

function expectedFailures(expected) {
  return (expected.failures ?? []).map((failure) => ({
    key: failure.key,
    reason: adaptEnum(failure.reason),
    lookupLocale: failure.lookupLocale,
    attemptedLocales: failure.attemptedLocales,
    message: failure.message,
    placeholderNames: failure.placeholderNames,
    causeType: causeNamesFor(failure, expected)?.join(" or ") ?? adaptCauseType(failure.causeType),
    localeMatchResult: expectedMatchProjection(failure.localeMatchResult),
    matchObjectIdenticalToResult: failure.matchObjectIdenticalToResult,
  }));
}

/**
 * The wanted/actual cause-message pairs the FAILURE channel records, for the diagnostic ratchet.
 *
 * Built index-wise against `failureCalls`, which is sound only where the projection above already
 * compared equal — and that is the only place it is read (`outcome.ok`). Rows whose recorded
 * `causeMessage` is null carry no diagnostic to ratchet and are dropped, mirroring the result-level
 * channel's `failureCause == null` arm, so this widens the ratchet's denominator by the rows that
 * actually record a message and by nothing else. Reported and ratcheted, never gated: see
 * `causeMessageMatchedIds`.
 */
function failureCauseMessages(expected) {
  return (expected.failures ?? [])
    .map((failure, i) => ({ wanted: failure.causeMessage, actual: messageOf(failureCalls[i]?.cause ?? null) }))
    .filter((pair) => pair.wanted != null);
}

/**
 * The resolver consultations this case made, and the ones Java recorded. Same `?? []` rule as the
 * two channels beside it, and joined into the comparison on the same terms `resolverCalls`,
 * `failures` and `policyCalls` each earned: it left the `get` gate in the SAME hunk that added this
 * comparison, which is this file's standing precedent for a channel leaving that list.
 *
 * `returnedMatchType` is `adaptEnum`'d on the wanted side only, because the actual side already
 * speaks the JS vocabulary — the same asymmetry every other enum in this file has.
 */
const projectSupplierCalls = () => supplierCalls.map((call) => ({ ...call }));
const expectedSupplierCalls = (expected) =>
  (expected.supplierCalls ?? []).map((call) => ({
    kind: call.kind,
    returnedLocale: call.returnedLocale,
    returnedMatchType: call.returnedMatchType === null ? null : adaptEnum(call.returnedMatchType),
  }));

/**
 * The policy consultations this case made, and the ones Java recorded. Same `?? []` rule.
 *
 * `threw` is ABSENT from a recorded call that returned and PRESENT only on one whose delegate threw,
 * which is how the corpus keeps a policy that returned null apart from one that threw — both record
 * `decision: null`. Normalized to null here so the two sides compare on one shape.
 */
const projectPolicyCalls = () => policyCalls.map((call) => ({ ...call }));
const expectedPolicyCalls = (expected) =>
  (expected.policyCalls ?? []).map((call) => {
    if (call.threw !== undefined && !(call.threw in POLICY_THREW))
      unsupported(`no JS counterpart declared for a fallback policy throwing ${call.threw}`);
    return {
      reason: adaptEnum(call.reason),
      locale: call.locale,
      causeType: adaptCauseType(call.causeType),
      decision: call.decision,
      threw: call.threw === undefined ? null : POLICY_THREW[call.threw],
    };
  });

/* --- the throw response ----------------------------------------------------------------------
 *
 * `expected.thrown` records FOUR fields — `type`, `message`, `causeType` and
 * `identicalToRetainedCause` — and they name which of three DIFFERENT things escaped the lookup.
 * Collapsing them onto one error table is the mistake this block exists to avoid, and reading
 * `causeType` as if it named the escaping object is the mistake the fourth field exists to end.
 *
 * RE-MEASURED over the 127 `get`/`getResult` rows that carry a `thrown` block, the corpus
 * decomposes as:
 *
 *   identicalToRetainedCause === true  (25)  the retained FIRST cause, rethrown unwrapped by
 *                            `throwExceptionFor`. `thrown.type` is that object's own class: 22
 *                            `IllegalStateException`, 2 `ExpressionEvaluationException` — a type
 *                            nothing else here produces — and 1 `IllegalArgumentException`.
 *   causeType == null, `IllegalStateException`  (34)  THIS RUNNER's own sentinel, from a
 *                            `throw-in-handler` / `throw-in-policy` behavior. Nothing about it is
 *                            the port's.
 *   everything else  (68)  an error the port CONSTRUCTED: 23 `MissingTranslationException`, 5
 *                            `NullPointerException`, and 40 `IllegalArgumentException`
 *                            ingress/operand refusals (31 of which are B3's supplied-match ingress
 *                            and stay attributed). TWO of those 40 carry a non-null `causeType`
 *                            (`java.util.IllformedLocaleException`): a constructed exception can
 *                            WRAP, and `causeType` says what it wrapped, never what it is.
 *
 * THE OLD DECOMPOSITION SPLIT ON `causeType != null` AND GOT 25 RIGHT BY LUCK. Every one of those 25
 * rethrows a CONTEXTUALIZED library error whose own cause is of its own class, so `type` and
 * `causeType` coincided and the wrong reading produced the right name. The two
 * `lvariant.exhausting-walk.*.ill-formed-attempted-locale` rows are the first where they do not, and
 * under the old split they routed into the rethrow arm and reported `unsupported` for want of a JS
 * counterpart to `IllformedLocaleException` — a class that never escapes anything.
 *
 * `java.lang.IllegalStateException` is therefore ABSENT from `ERROR_NAME` and must stay absent: it
 * appears in this corpus with both a null and a non-null `causeType`, meaning the sentinel in one
 * and a rethrown library error in the other, and one table row would accept either for either.
 * `RESOLVER_THREW` set the precedent — the runner declares the counterpart for errors the runner
 * itself raises, separately from the errors the LIBRARY raises.
 */

/** The recorded throw is this runner's own sentinel, escaping unwrapped. */
const SENTINEL_IDENTITY = "the sentinel this runner's own callback threw";
/** The recorded throw is the retained first cause, rethrown with no wrapper added. */
const RETHROWN_IDENTITY = "the retained first cause, rethrown unwrapped";
/** The recorded throw is an error the port built for this failure. */
const CONSTRUCTED_IDENTITY = "an error the port constructed";
/** Nothing was thrown at all. Distinct from every identity above, and always a failure. */
const NOTHING_THROWN = Symbol("nothing thrown");

/** The JS error name of whatever escaped, in the shape both sides of the comparison use. */
const thrownNameOf = (caught) =>
  caught === NOTHING_THROWN ? "no exception"
    : caught instanceof Error ? caught.name
      : `a thrown ${caught === null ? "null" : typeof caught}`;

/**
 * WHICH object escaped, not merely which shape. This is the half of the comparison a name table
 * cannot make, and it is the half the rethrow-by-identity clause actually claims.
 *
 * `failureCalls.at(-1).cause` is the retained first cause: the handler is consulted exactly once,
 * after the walk, and is handed the frozen failure whose `cause` is the FIRST failure retained. A
 * port that wrapped, re-messaged or re-created that error reports `CONSTRUCTED_IDENTITY` here and
 * fails, while one that copied Java's wording into a fresh error would sail past a message compare.
 */
function caughtIdentity(caught) {
  if (caught === NOTHING_THROWN) return "no exception";
  if (sentinelThrows.length && caught === sentinelThrows.at(-1)) return SENTINEL_IDENTITY;
  const retained = failureCalls.length ? failureCalls.at(-1).cause : null;
  if (retained != null && caught === retained) return RETHROWN_IDENTITY;
  return CONSTRUCTED_IDENTITY;
}

/**
 * One recorded Java throw against what the port raised, as a jcs-comparable pair.
 *
 * `ratchetMessage` marks the arm whose message is the CAUSE's own diagnostic wording rather than a
 * library-composed string. Those go to the diagnostic channel on exactly the terms the failure
 * channel's `causeMessage` already goes there: banked when they match, and otherwise required to
 * carry a `DECLARED_CAUSE_MESSAGE_DIVERGENCES` entry or fail the run. The identity assertion on
 * that arm is strictly stronger than comparing the message would be, so the message is compared
 * beside it rather than instead of it.
 *
 * (This sentence too used to name "36 reviewed, declared JS-idiomatic divergences" as a reason not
 * to gate. Thirty-six was the count of the UNREVIEWED ones; see `projectFailures`.)
 */
/**
 * Java messages whose JS counterpart is DECLARED to differ, with the exact counterpart pinned.
 *
 * Arm 3 below compares `thrown.message` exactly, on the premise that the message is "the library's
 * own composed string on both sides". That premise fails for Java's `requireNonNull` strings, which
 * name a JAVA identifier: `translationFallbackPolicy` and `TranslationFailureHandler` are Java option
 * names, and the JS options are `fallbackPolicy` and `onFailure`. Reproducing them verbatim would
 * point a JS consumer at identifiers this API does not have, which is worse than diverging.
 *
 * This is NOT a relaxation of the comparison. The Java message still selects the row, the JS message
 * is pinned EXACTLY, and a divergence that stops diverging is STALE and fails the run — so the table
 * cannot rot into a list of excuses the way three known-gap lists in this project already have.
 * Discovered by the oracle's new `return-null` behaviors, which replaced a port message derived from
 * READING DefaultStrings.java:735 with one measured against a Java run.
 */
const DECLARED_MESSAGE_DIVERGENCES = {
  "TranslationFailureHandler returned null": {
    js: "onFailure returned null",
    why: "Java's SHAPE with the JS option name, matching localeResolver/localeMatchResolver at src/core/index.js:900/:914. Java names its own `TranslationFailureHandler`; the JS option is `onFailure`, so the identifier is the only remaining difference.",
  },
  "translationFallbackPolicy returned null": {
    js: "fallbackPolicy returned null",
    why: "Java's SHAPE with the JS option name, matching localeResolver/localeMatchResolver at src/core/index.js:900/:914. Java names its own `translationFallbackPolicy`; the JS option is `fallbackPolicy`, so the identifier is the only remaining difference.",
  },
  // THE SAME SPELLING, OF A LOCALE THIS PORT HAS NO SPELLING FOR. `LocaleUtils.requireWellFormed`
  // interpolates `Locale#toString` — an underscore-and-hash form (`ja_JP_jp_#u-ca-japanese`) that is
  // not a language tag, is not round-trippable, and exists nowhere in this port. The port names the
  // same candidate by the tag it actually synthesized. Every other channel of these two rows agrees
  // with Java byte for byte, including the attempted-locale list that CONTAINS this candidate under
  // its tag spelling, so the divergence is the representation and nothing else.
  //
  // Inventing `Locale#toString` for one diagnostic would mean carrying a second locale
  // serialization for the sole purpose of reproducing a string; the tag spelling is the one a JS
  // consumer can look up in the very list the same error reports.
  "Attempted locale 'ja_JP_jp_#u-ca-japanese' is not a well-formed IETF BCP 47 locale": {
    js: "Attempted locale 'ja-JP-u-ca-japanese-x-lvariant-jp' is not a well-formed IETF BCP 47 locale",
    why: "Java interpolates Locale#toString (LocaleUtils.java:60-61); the port names the same synthesized candidate by its BCP 47 tag, which is the spelling its own attemptedLocales list carries.",
  },
  "Attempted locale 'th_TH_th_#u-nu-thai' is not a well-formed IETF BCP 47 locale": {
    js: "Attempted locale 'th-TH-u-nu-thai-x-lvariant-th' is not a well-formed IETF BCP 47 locale",
    why: "Java interpolates Locale#toString (LocaleUtils.java:60-61); the port names the same synthesized candidate by its BCP 47 tag, which is the spelling its own attemptedLocales list carries.",
  },
};

/**
 * The DIAGNOSTIC channel's declaration table, and the reason clause 13 is certifiable at all.
 *
 * `DECLARED_MESSAGE_DIVERGENCES` above pins WHOLE messages, which is right for the four library
 * strings arm 3 compares. It is the wrong shape for the cause-message channel: a cause message is
 * Java's own diagnostic wrapped in up to two layers of contextualization (`Unable to resolve
 * generated placeholder 'x' (LanguageFormTranslation) for key 'k'; definition declared at k: ...`),
 * so one divergence of six words recurs under a dozen different prefixes. Pinning whole messages
 * there would mean a dozen near-identical entries per divergence, each of which rots independently
 * -- the exact failure mode "known-gap lists rot" names.
 *
 * So a divergence is declared ONCE, as the SUBSTITUTION it is. Each entry names the Java fragment
 * and the JS fragment that replaces it, plus the argument for why the port cannot say what Java
 * says. `causeMessageDeclaration` applies every entry to the RECORDED JAVA MESSAGE and demands the
 * result equal the port's message BYTE FOR BYTE. Nothing is widened: an entry cannot excuse any
 * text outside its own fragment, so a port that drifts anywhere else in the same sentence still
 * fails, and a port that drifts INSIDE the fragment fails too because the fragment is pinned
 * exactly on both sides.
 *
 * AND THE TABLE CANNOT ROT. An entry that never participates in a declared divergence over a whole
 * run is reported STALE and FAILS, so a divergence the port stops having is a red run until the
 * entry is deleted -- the same discipline `staleMessageDivergences` applies one channel over.
 *
 * WHAT IS NOT IN HERE IS THE POINT. Every fragment below is a Java-only concept, argued from the
 * JDK or from the corpus, not a wording preference. Eighteen divergences that had been carried as
 * "JS-idiomatic" were simply unfixed and are now gone: the axis type name Java prints on the left of
 * `must be a %s but was %s`, the `String` and `Boolean` on its right, Java's composed `must be a
 * Number, PluralOperands, or Cardinality` sentence and the prefix the port used to paste in front of
 * Java's unprefixed numeric refusals, the range arm's endpoint-naming wording, the depth
 * diagnostic's list rendering, the clause the absent-resolver hint had grown, and -- this round --
 * `BigDecimal` and `PluralOperands`.
 *
 * THOSE LAST TWO ARE WHY THIS PARAGRAPH IS WORTH RE-READING BEFORE ADDING AN ENTRY. They were
 * declared here on a SECOND criterion that no rule anywhere stated: "a Java class name for a type
 * this API does not expose". Their own `why` conceded the mapping was total and unambiguous, which
 * is the whole test, and the criterion that overrode it is refuted by the port's own output in the
 * SAME sentence -- `must be a Phonetic or CharSequence`, plus `Gender`, `Cardinality`, `Ordinality`,
 * `Definiteness`, `Clusivity` and `Formality`, none of them a JS type either. That is FIX 2's
 * internal-consistency argument verbatim, one row over, and it is the same shape as `value-false`'s
 * deleted reason in `tools/phonetic-diff/run.mjs`. The rule is one question and stays one question:
 * does the JS value determine the Java class TOTALLY AND UNAMBIGUOUSLY?
 *
 * WHAT SURVIVES IS EXACTLY THE FOUR NUMERIC CARRIERS, and each collision now has corpus rows rather
 * than a comment: `Integer`/`Double` (one JS `number`, and `placeholderValue` decodes both tags
 * through `Number(...)`) and `Long`/`BigInteger` (one JS `bigint`). Plus the resolver-advice string,
 * which names a Java interface and a fluent builder, and one entry marked `kind: "configuration"`.
 *
 * `kind` SEPARATES TWO DIFFERENT KINDS OF CLAIM. Absent, an entry is a WORDING divergence: the two
 * sides ran the same configuration and the port cannot say what Java said. `kind: "configuration"`
 * means the two sides ran DIFFERENT configurations and the message difference is the shadow of a
 * capability gap -- reported apart from the wording count so a milestone reader is not handed one
 * number and left to assume it is all wording.
 */
const DECLARED_CAUSE_MESSAGE_DIVERGENCES = [
  {
    java: "No PhoneticResolver was configured. Provide one via Strings.Builder#phoneticResolver(...)",
    js: "No phoneticResolver was configured. Provide one via createStrings({ phoneticResolver })",
    why:
      "TWO IDENTIFIERS, AND NOTHING ELSE. Java's default resolver (DefaultStrings.java:76-79) names " +
      "`PhoneticResolver`, an INTERFACE this port does not have -- the JS surface is the " +
      "`phoneticResolver` option -- and `Strings.Builder#phoneticResolver(...)`, a fluent builder the " +
      "JS API replaced with an object literal. Advice a JS caller cannot follow is worse than a " +
      "divergence. The port's message used to append `to classify the term supplied for locale '..'` " +
      "as well; that clause was the port diverging further than these two identifiers require and it " +
      "is gone.",
  },
  {
    java: "but was Integer",
    js: "but was number",
    why:
      "NO TOTAL MAPPING EXISTS. Java prints `value.getClass().getSimpleName()`; `Integer`, `Double` " +
      "and `Float` all arrive in JS as one `number`, so there is no function from the JS value to " +
      "the Java class name and any spelling would be a coin flip that reads as fact. The corpus " +
      "records both halves: `phonetic-resolver.input.integer` passes a bare `5` and " +
      "`phonetic-resolver.input.double` passes `{$lokalized:'double', value:'1.5'}`. THOSE TWO ROWS " +
      "ARE SEPARABLE AND THE ENTRY DOES NOT REST ON THEM BEING OTHERWISE -- an earlier version of " +
      "this text said they 'differ ONLY in the Java class, from the same JS value', which " +
      "`Number.isInteger` refutes in one line and which invited a reader to delete the entry. What " +
      "makes the mapping non-total is the decoder: `placeholderValue` sends BOTH tags through " +
      "`Number(value.value)`, so a Java `Double` of `2.0` is the JS number `2` and is " +
      "indistinguishable from a Java `Integer` 2. The collision is real wherever the Double is " +
      "integral; these two rows merely happen not to be that pair. Contrast `String`, `Boolean`, " +
      "`BigDecimal`, `PluralOperands` and the tagged language forms, which the port now reproduces " +
      "exactly because each JS value determines its Java class unambiguously.",
  },
  {
    java: "but was Double",
    js: "but was number",
    why: "The other half of the `Integer`/`Double` collision above; same argument, opposite row.",
  },
  {
    java: "but was Long",
    js: "but was bigint",
    why:
      "THE SAME COLLISION, ON THE OTHER NUMERIC CARRIER, AND NOW MEASURED RATHER THAN ASSERTED. A " +
      "JS `bigint` is the exact carrier for BOTH `java.lang.Long` and `java.math.BigInteger` -- " +
      "`placeholderValue` decodes the `long` and `bigint` tags to `BigInt(value.value)` alike -- so " +
      "no total mapping exists here either. Until this slice the claim lived ONLY in a comment in " +
      "`javaSimpleNameOf` with no row to fire on, which is precisely the shape the declaration " +
      "table exists to end: a table that claims to enumerate what the port cannot name, enumerating " +
      "four of five. `m3b-form-diagnostics-value-types.clusivity.wrong-value-type-long` and " +
      "`.wrong-value-type-bigint` are the same key and the same numeric value, differing only in " +
      "the Java class, so the collision is now in the corpus.",
  },
  {
    java: "but was BigInteger",
    js: "but was bigint",
    why: "The other half of the `Long`/`BigInteger` collision above; same argument, opposite row.",
  },
  {
    java: "Placeholder compact exponent 10 exceeds the configured maximum of 3",
    js: "Missing Ordinality translation for OTHER",
    kind: "configuration",
    why:
      "NOT A WORDING DIVERGENCE AT ALL -- THE TWO SIDES RAN DIFFERENT CONFIGURATIONS, and this entry " +
      "exists to stop that reading as prose. The fixture " +
      "`m3b-form-diagnostics-lowered-compact-exponent` carries `runtimeLimits: " +
      "{maximumCompactExponent: 3}`; `createStrings` REFUSES `runtimeLimits` by design (plan 4.6, " +
      "src/core/index.js), so the port builds at the fixed v1 ceiling of 64 where a compactExponent " +
      "of 10 is legal, classifies OTHER, and meets a sparse catalog. MEASURED on the pinned JDK " +
      "(Corretto 21 + lokalized-3.0.0.jar), one instance per limit, same catalog and same input: at " +
      "the DEFAULT ceiling Java answers `Missing Ordinality translation for OTHER` -- the port's " +
      "string, byte for byte, with causeType IllegalStateException -- and at the lowered ceiling it " +
      "answers the recorded message with causeType IllegalArgumentException. That control is what " +
      "makes this a configuration difference rather than a guess. Note what the gated channels " +
      "cannot see: CAUSE_NAME maps BOTH Java exceptions to `Error`, so the causeType flip is " +
      "invisible there and this message is the only place the swap shows at all. The row moves when " +
      "`runtimeLimits` gets a JS route, not when a message is rewritten. " +
      "WHERE THIS BELONGS, FOR THE RECORD: `classifyFailure`'s rule 0 owns the same root cause " +
      "everywhere it is reachable as a mismatch, and charges it to the by-design " +
      "`runtime-limit overrides are not implemented` reason (43 rows). This row never reaches rule " +
      "0 -- rule 0 is post-hoc and every GATED channel still agrees, so the case is `passed`, not " +
      "`unsupported`, and it is NOT one of those 43. It surfaces here only because this slice made " +
      "`causeMessage` a gating channel. Marked `kind: \"configuration\"` so it is counted apart " +
      "from the wording divergences; the standing suggestion for a future slice is to have " +
      "`causeMessageDeclaration` consult rule 0 first, so a capability gap can never be recorded as " +
      "a wording decision at all.",
  },
];

/** Declared cause-message substitutions that fired at least once this run. */
const usedCauseMessageDivergences = new Set();

/**
 * The declared substitutions that turn Java's recorded cause message into the port's, or null.
 *
 * SUBSTITUTIONS ARE APPLIED TO THE ORIGINAL JAVA TEXT, NEVER CHAINED. An earlier version rewrote
 * the ACCUMULATED string, which has two silent failure modes the moment the table grows: an entry
 * whose `java` fragment matches text a PRIOR entry's `js` output introduced would substitute into
 * the port's own words, and an entry whose `java` is a substring of another's would shadow it
 * depending on array order. Neither is live -- every `js` output was checked against every `java`
 * fragment -- but "not live today" is exactly the guarantee a growing table stops offering, and the
 * byte-exact final comparison only catches these when the chain happens to land somewhere else.
 *
 * So: each entry is matched independently against `java`, the match spans are collected, and two
 * entries whose spans OVERLAP throw rather than quietly picking one. The spans are then spliced
 * once, left to right, so the result is a function of the table and not of its order.
 *
 * The WHOLE-message table is consulted first so the library strings arm 3 already pins are declared
 * in exactly one place rather than twice. NOTE THE ASYMMETRY IT LEAVES: that arm returns without
 * recording usage, so a whole-message entry reached ONLY through the cause channel would be
 * reported stale by neither gate -- `staleMessageDivergences` fires when the port starts
 * REPRODUCING Java on the THROWN path, not when an entry stops being needed. Not live either: all
 * seven whole-message-declared rows carry an `expected.thrown` block, so the thrown-path gate
 * covers every one of them. The next entry added to that table might not, which is why this
 * sentence is here.
 *
 * @param {string} java the cause message the corpus recorded
 * @param {string} js the message the port produced
 * @returns {string[] | null} the `java` fragments that were applied, or null if undeclared
 */
function causeMessageDeclaration(java, js) {
  if (DECLARED_MESSAGE_DIVERGENCES[java]?.js === js) return [java];

  /** @type {{ start: number, end: number, entry: typeof DECLARED_CAUSE_MESSAGE_DIVERGENCES[number] }[]} */
  const spans = [];

  for (const entry of DECLARED_CAUSE_MESSAGE_DIVERGENCES) {
    let from = 0;
    for (;;) {
      const start = java.indexOf(entry.java, from);
      if (start < 0) break;
      spans.push({ start, end: start + entry.java.length, entry });
      from = start + entry.java.length;
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i].start >= spans[i - 1].end) continue;
    throw new Error(
      "two DECLARED_CAUSE_MESSAGE_DIVERGENCES entries match overlapping text in one Java message, " +
        "so which one applies would depend on table order: " +
        `${JSON.stringify(spans[i - 1].entry.java)} and ${JSON.stringify(spans[i].entry.java)} in ` +
        `${JSON.stringify(java)}. Split or narrow the fragments.`,
    );
  }

  /** @type {string[]} */
  const applied = [];
  let rewritten = "";
  let cursor = 0;

  for (const span of spans) {
    rewritten += java.slice(cursor, span.start) + span.entry.js;
    cursor = span.end;
    applied.push(span.entry.java);
  }

  rewritten += java.slice(cursor);

  if (rewritten !== js) return null;
  for (const fragment of applied) usedCauseMessageDivergences.add(fragment);
  return applied;
}

/**
 * Java cause class -> the JS error NAME the port attaches as the constructed throw's own `cause`,
 * or `null` where the port declares it attaches none.
 *
 * ARM 3's `wrappedCause` channel, and the reason `expected.thrown.causeType` is no longer read as a
 * routing hint. On a CONSTRUCTED throw that field says what Java WRAPPED — `requireWellFormed` builds
 * `new IllegalArgumentException(message, illformedLocaleException)` (LocaleUtils.java:60-61) — which
 * is an observation about the error handed to the caller, not about which object escaped. Nothing
 * read it once arm 2 stopped guarding on it, so it is compared here instead of dropped.
 *
 * A DECLARED `null` IS A CLAIM, NOT A SKIP, and it is gated in both directions: the wanted side says
 * the port attaches no cause and the actual side reports whatever the port's error carries, so a
 * port that starts attaching one turns these rows red and has to come back here to say so. An
 * UNDECLARED Java cause class reports the case unsupported and names its owner, on the
 * `operationNotImplemented` discipline that every other table in this file follows.
 */
const WRAPPED_CAUSE = {
  "java.util.IllformedLocaleException": {
    js: null,
    why: "The JDK-only exception `Locale.Builder#build` raises. The port's well-formedness check is `jdkLocaleWellFormed`, a predicate that returns false rather than throwing, so there is no inner error to retain — and fabricating one would mean inventing a JS class named for a JDK type this port does not model. The refusal itself, its name and the whole surrounding walk are compared unchanged.",
  },
};

/** The milestone that owes a JS counterpart for a wrapped Java cause `WRAPPED_CAUSE` does not carry. */
const WRAPPED_CAUSE_OWNER = {};

/** The JS `cause` a constructed throw carries, in the shape `WRAPPED_CAUSE` declares. */
function wrappedCauseOf(caught) {
  const cause = caught === NOTHING_THROWN || caught === null || typeof caught !== "object"
    ? null : /** @type {any} */ (caught).cause;
  if (cause === null || cause === undefined) return null;
  return cause instanceof Error ? cause.name : `a ${typeof cause}`;
}

/** The declared JS counterpart of a Java cause class a constructed throw wraps. */
function declaredWrappedCause(causeType) {
  if (causeType === null || causeType === undefined) return null;
  if (!(causeType in WRAPPED_CAUSE)) {
    const owner = WRAPPED_CAUSE_OWNER[causeType];
    if (!owner)
      throw new AuthoringError(
        `a constructed throw wraps a cause of type ${causeType} with no entry in WRAPPED_CAUSE. ` +
        `Every reason must name who owes the work; add an entry, or declare the type in WRAPPED_CAUSE.`,
      );
    unsupported(`no JS counterpart declared for a wrapped cause of type ${causeType} (${owner})`);
  }
  return WRAPPED_CAUSE[causeType].js;
}

/** Declared-divergence rows whose JS message no longer differs, i.e. entries that must be deleted. */
const staleMessageDivergences = [];

function thrownProjection(thrown, caught) {
  // ARM 1 — the runner's own sentinel. Guarded on a sentinel having actually been raised, so a
  // future `IllegalStateException` row that is NOT one falls through to arm 3 and is reported
  // `unsupported` for want of a declared counterpart rather than silently compared against ours.
  if (thrown.causeType === null && thrown.type === "java.lang.IllegalStateException" && sentinelThrows.length)
    return {
      wanted: { name: "Error", identity: SENTINEL_IDENTITY, message: thrown.message },
      actual: { name: thrownNameOf(caught), identity: caughtIdentity(caught), message: messageOf(caught === NOTHING_THROWN ? null : caught) },
    };

  // ARM 2 — rethrow by identity. `CAUSE_NAME`, not `ERROR_NAME`: this is the same error the
  // `failures` channel already reports through `causeType`, so the two must agree on its name or
  // the same object would be described two ways in one comparison.
  //
  // GUARDED ON THE CORPUS'S OWN IDENTITY OBSERVATION, not on `thrown.causeType !== null`. That
  // proxy stood here until the two `lvariant.exhausting-walk.*.ill-formed-attempted-locale` rows
  // arrived, and it was wrong in both halves. A non-null `thrown.causeType` says only that the
  // escaping throwable HAS a cause of its own — `LocaleUtils.requireWellFormed` builds
  // `new IllegalArgumentException(message, illformedLocaleException)` — which is a statement about
  // WRAPPING, not about rethrowing; and `thrown.causeType` was then read as the escaping object's
  // own class, which it is not. Both mistakes were invisible for 25 rows because every one of them
  // rethrows a CONTEXTUALIZED library error whose cause is of its own class, so `type` and
  // `causeType` happened to coincide.
  //
  // No text field can separate the two. `throwExceptionFor` (DefaultStrings.java:3196-3213)
  // rethrows the retained cause by identity, while a RETURN_KEY handler re-enters
  // `TranslationResult`'s constructor (:755) and CONSTRUCTS a fresh exception at the same site from
  // the same inputs — same class, same message. So the oracle now records the reference comparison
  // itself (`identicalToRetainedCause`), and this arm asks for it. See the field's own comment in
  // `VectorOracle.java` for the JVM measurement that forced it.
  //
  // The NAME comes from `thrown.type`, the escaping object's class. Byte-identical over the corpus
  // to the old `thrown.causeType` read, because all 25 rows carry `type === causeType`; that
  // agreement is the coincidence, not the rule.
  if (thrown.identicalToRetainedCause === true)
    return {
      wanted: { name: adaptCauseType(thrown.type), identity: RETHROWN_IDENTITY },
      actual: { name: thrownNameOf(caught), identity: caughtIdentity(caught) },
      ratchetMessage: true,
    };

  // ARM 3 — an error the port constructed, compared on the DECLARED counterpart name and on the
  // message exactly, because the message is the library's own composed string on both sides.
  if (!(thrown.type in ERROR_NAME)) unsupported(`no JS counterpart declared for ${thrown.type}`);
  const names = ERROR_NAME[thrown.type];
  const actualName = thrownNameOf(caught);
  const actualMessage = messageOf(caught === NOTHING_THROWN ? null : caught);

  // A DECLARED divergence: the Java message selects the row and the JS message is pinned exactly, so
  // this narrows the comparison rather than dropping it. A row that starts matching Java verbatim is
  // recorded STALE and fails the run, because the entry has outlived its reason.
  // WHAT THE CONSTRUCTED ERROR WRAPS, compared rather than dropped. `expected.thrown.causeType` is
  // an observation about the error Java handed the caller; arm 2 used to consume it as a routing
  // hint, and once that stopped it would otherwise be read by nothing. See `WRAPPED_CAUSE`.
  const wrappedCause = { wanted: declaredWrappedCause(thrown.causeType), actual: wrappedCauseOf(caught) };

  const declared = DECLARED_MESSAGE_DIVERGENCES[thrown.message];
  if (declared && actualMessage === declared.js) {
    return {
      wanted: { name: names.join(" or "), identity: CONSTRUCTED_IDENTITY, wrappedCause: wrappedCause.wanted },
      actual: {
        name: names.includes(actualName) ? names.join(" or ") : actualName,
        identity: caughtIdentity(caught),
        wrappedCause: wrappedCause.actual,
      },
      ratchetMessage: true,
    };
  }
  if (declared && actualMessage === thrown.message)
    staleMessageDivergences.push(`${thrown.message} -- the port now reproduces Java verbatim; delete the entry`);

  return {
    wanted: { name: names.join(" or "), identity: CONSTRUCTED_IDENTITY, message: thrown.message, wrappedCause: wrappedCause.wanted },
    actual: {
      name: names.includes(actualName) ? names.join(" or ") : actualName,
      identity: caughtIdentity(caught),
      message: actualMessage,
      wrappedCause: wrappedCause.actual,
    },
  };
}

/**
 * Run a `get`/`getResult` case whose recorded outcome is a THROW.
 *
 * The callback channels are compared alongside the throw rather than instead of it, and that is not
 * decoration: the twelve throw-in-policy rows now state exactly which reason, locale and cause the
 * policy was handed on the consultation that raised — an observation that did not exist until the
 * oracle's `recordingPolicy` was moved to record BEFORE its delegate, and that a port could
 * previously have got wrong while passing — and `callback-interaction.first-cause.handler-exception-displaces-
 * retained-resolver-failure` is only meaningful because the `failures` channel still shows the
 * handler was handed the retained cause it then displaced.
 *
 * `projectFailures(null)` on both paths: a throwing lookup produces no result object, so
 * `matchObjectIdenticalToResult` is NOT COMPARABLE. All 135 recorded thrown rows carry null there,
 * measured — so the tri-state null arm is the corpus's own answer, not this runner's convenience.
 */
function thrownCase(expected, run) {
  /** @type {unknown} */
  let caught = NOTHING_THROWN;
  try {
    run();
  } catch (error) {
    // `Unsupported` and `NoCounterpart` are this runner's control flow, never the port's answer.
    // They travel out through the same `catch` a real throw would, so they are re-raised before
    // anything can read one as a conformant refusal — the shape that turns an unbuilt capability
    // into a passing throw comparison.
    if (error instanceof Unsupported || error instanceof NoCounterpart) throw error;
    caught = error;
  }

  const projection = thrownProjection(expected.thrown, caught);
  const actual = {
    thrown: projection.actual,
    resolverCalls: [...resolverCalls],
    failures: projectFailures(null, expected),
    policyCalls: projectPolicyCalls(),
    supplierCalls: projectSupplierCalls(),
  };
  const wanted = {
    thrown: projection.wanted,
    resolverCalls: expectedResolverCalls(expected),
    failures: expectedFailures(expected),
    policyCalls: expectedPolicyCalls(expected),
    supplierCalls: expectedSupplierCalls(expected),
  };
  const causeMessages = [
    ...failureCauseMessages(expected),
    ...(projection.ratchetMessage
      ? [{ wanted: expected.thrown.message, actual: messageOf(caught === NOTHING_THROWN ? null : caught) }]
      : []),
  ];

  return jcs(actual) === jcs(wanted) ? { ok: true, causeMessages } : { ok: false, actual, wanted, causeMessages };
}

/**
 * The per-call `TranslationOptions` a case names, in the shape `get`/`getResult` accept.
 *
 * EXPLICIT rather than a spread of whatever the input carries, for the same reason `parseLimitsFor`
 * is: an option this runner does not recognize must reach `classifyFailure` and be reported, never
 * be quietly dropped so the case passes on the default. Every key handled here is one the port
 * implements; everything else stays unlisted and is attributed.
 *
 * The table maps the CORPUS key to the port's option name, because the two callback options are
 * spelled differently on the two sides — Java's `translationFallbackPolicy` / `translationFailure
 * Handler` against plan 3.3's `fallbackPolicy` / `onFailure`. `IMPLEMENTED_CALL_OPTIONS` stays the
 * corpus keys, since that is what `classifyFailure` scans.
 *
 * An explicit JSON `null` is passed THROUGH rather than skipped, and that is the point of the
 * `owed-null-options` family: Java's builder leaves the instance value in place for a null setter
 * (`optionsFrom` applies neither), and the port reaches the same state through its `== null` rule.
 * Passing null exercises that rule; skipping the key would leave it unexercised.
 */
const CALL_OPTION_ADAPTERS = {
  bidiIsolation: { option: "bidiIsolation", adapt: adaptEnum },
  translationFallbackPolicy: {
    option: "fallbackPolicy",
    adapt: (spec) => (spec === null ? null : fallbackPolicyFor(spec)),
  },
  translationFailureHandler: {
    option: "onFailure",
    adapt: (spec) => (spec === null ? null : failureHandlerFor(spec)),
  },
};
/**
 * The corpus keys `callOptionsFor` actually applies to the port, which is what `classifyFailure`
 * scans. `languageRanges` is listed EXPLICITLY rather than through `CALL_OPTION_ADAPTERS` because it
 * is not a per-call option of the JS surface at all: plan 3.3 has no such key, so the runner
 * negotiates it into a `localeMatch` first. It still belongs here, and the reason is the rule
 * `classifyFailure` states in its own comment — an option the runner PASSES to the port may never
 * also be excused there. Leaving it out would relabel every future per-call selection defect as
 * "not implemented", inside the function whose contract says it cannot.
 */
const IMPLEMENTED_CALL_OPTIONS = new Set([...Object.keys(CALL_OPTION_ADAPTERS), "languageRanges"]);

/**
 * Cases whose input carried a per-call `languageRanges` that this runner did NOT hand to the port.
 *
 * MEASURED from the runner's own control flow rather than guessed from the input's shape, because
 * the shape is the wrong discriminator: `per-call-override-order.zh-tw.ranges-only-on-zh-hant-only-
 * key` carries a header string and NO per-call locale, so `coincidentalIds`' `perCallOverrideOrder`
 * key never saw it, and it passed — and was banked — for exactly as long as `callOptionsFor` dropped
 * the ranges on the floor. Deriving the set here means it empties itself the moment a delivery path
 * exists (A4's header parser), instead of needing a future author to remember to delete a clause.
 *
 * An id is added when the ranges are seen and deleted when they are actually delivered, so every
 * path that leaves without delivering — a `throw` included — leaves its id marked.
 */
const undeliveredSelectionIds = new Set();
/** The case `runCase` is executing, so `callOptionsFor` can name it. Set by `runCase`, nowhere else. */
let currentCaseId = "";

function callOptionsFor(input, strings) {
  const options = {};

  // DECIDED ON THE INPUT'S SHAPE, before the port is asked anything, and it is the corpus's own
  // marker that decides: `perCallOverrideOrder` is present on a case IFF that case presents BOTH a
  // per-call `locale` and a non-null `languageRanges` — lokalized-spec's `ingest.mjs` refuses the
  // key on any other input, and `VectorOracle` raises an `AssertionError` for a both-present input
  // that omits it (`VectorOracle.java:826-855`). So the marker cannot drift away from the shape it
  // names.
  //
  // That shape has NO JS COUNTERPART, and this is a recorded decision rather than unbuilt work.
  // Java's answer to it is decided by which of two mutually-CLEARING `TranslationOptions.Builder`
  // setters ran last (`TranslationOptions.java:309-313`, `:330-333`) — the reverse order gives the
  // opposite answer, and the corpus now records both orders because the oracle was taught to state
  // one. A JavaScript object literal has no "last setter"; plan 3.3 declares `locale` and
  // `localeMatch` mutually exclusive "in declarations and runtime validation", and B3 makes the port
  // refuse the pair. Reproducing Java here would mean electing one setter order and calling it a
  // specification.
  //
  // These rows have never been ratcheted — `coincidentalIds` computes them from this same key — so
  // moving them out of `passed` changes nothing the gate reads. Two of them DID pass, coincidentally,
  // for exactly as long as this runner dropped `languageRanges` on the floor.
  if (Object.prototype.hasOwnProperty.call(input, "perCallOverrideOrder"))
    noCounterpart(
      "a per-call options object presenting BOTH a locale and languageRanges has no JS counterpart: " +
        "Java's answer is decided by which of two mutually-clearing TranslationOptions.Builder setters " +
        "ran last, and plan 3.3 declares the JS pair mutually exclusive at runtime",
    );

  if (input.locale) options.locale = input.locale;

  // `"languageRanges": null` is a PRESENT key that applies nothing: `VectorOracle.optionsFrom`
  // reads `languageRangesFrom(null)` as null and never calls the setter, so the instance source
  // stands. The port reaches the same state through the `== null` rule every other option uses, and
  // the `owed-null-options.ranges.*` rows are what pin the two together — including the one that
  // carries an explicit null ALONGSIDE a per-call locale and is therefore not two sources at all.
  const ranges = input.languageRanges;

  if (ranges != null) {
    // Marked BEFORE any decision about them, cleared only where they are genuinely delivered below.
    undeliveredSelectionIds.add(currentCaseId);

    // A HEADER STRING goes through `Locale.LanguageRange.parse`, ported in A4 -- never through a
    // comma split here, which would be this runner inventing a range list and attributing it to the
    // port: the parser applies the pinned IANA closure, so `"iw"` is `[iw, he]` and `"sgn-BE-FR"` is
    // four members, and it refuses shapes a split would happily accept.
    if (!negotiateApi?.createLocaleNegotiator || !negotiateApi?.parseLanguageRanges)
      unsupported("createLocaleNegotiator is not implemented");

    // Java's per-call arm negotiates INSIDE the library (`DefaultStrings:2442`) and uses the
    // selection as the lookup locale. The JS surface has no per-call `languageRanges`: plan 3.3
    // keeps the size-heavy solver in `lokalized/negotiate` and takes its RESULT as `localeMatch`.
    // So the caller negotiates first and hands the match over — which is the same two steps in the
    // same order, with the seam moved out of the root graph. The match is then held to BOTH
    // validation layers by the port, which a Java-built one never is; it passes because it was built
    // from this instance's own `getLocaleConfiguration()`.
    const negotiator = negotiateApi.createLocaleNegotiator(strings.getLocaleConfiguration());
    options.localeMatch = negotiator.matchForLanguageRanges(
      typeof ranges === "string"
        ? negotiateApi.parseLanguageRanges(ranges)
        : [...ranges].map(rangeMemberFrom));
    undeliveredSelectionIds.delete(currentCaseId);
  }

  for (const [name, { option, adapt }] of Object.entries(CALL_OPTION_ADAPTERS))
    if (input[name] !== undefined) options[option] = adapt(input[name]);

  return Object.keys(options).length ? options : undefined;
}

/**
 * WHICH FIELDS OF A CASE'S `expected` BLOCK THE RUNNER ACTUALLY READ — DERIVED FROM EXECUTION.
 *
 * WHY THIS EXISTS. Nothing here checked that an arm compares everything the corpus recorded, and the
 * hole is not theoretical: MEASURED in a shadow copy, a `case "load"` arm whose whole body is
 * `return { ok: true }` scores 145 new passes at EXIT 0. The passing-ID ratchet fails only on ids
 * LEAVING `passedIds` (`baseline.passedIds.filter(id => !nowPassing.has(id))`) and the exit
 * expression has no term for arrivals and none for `unsupported`, so a whole operation can be
 * "converted" by an arm that asserts nothing. A weaker version costs nothing to write by accident:
 * `expected.load` carries SIX fields where `expected.parse` carries five, and an arm that compares
 * only `failed` reports ~145 passes with nothing objecting.
 *
 * WHY IT IS DERIVED AND NOT DECLARED. A table saying "this arm compares these fields" is a CLAIM,
 * and this project has now found three separate texts asserting the exact inverse of what they
 * described — `conformance.mjs`'s own "35 known, reviewed" comment over 36 unreviewed divergences,
 * the wrong `equivalentTags` citation, and a corpus fixture named `-decomposed` whose filename is
 * byte-identical to its precomposed twin. So the reads are OBSERVED through a proxy instead: the
 * only way to be recorded as comparing a field is to actually read it while comparing.
 *
 * IT IS DORMANT UNTIL AN OPERATION IS ACTUALLY COMPARED, and that is the point rather than a
 * weakness. Reads are committed only when `runCase` RETURNS — a case that throws `Unsupported`
 * commits nothing — so `load`, whose 145 cases are all unsupported today, is judged by nothing now
 * and demands all six of its fields the moment M8's arm compares one of them. The gate arms itself.
 *
 * TWO LEVELS, deliberately: top-level keys of `expected` (which is where `getResult` keeps `match`
 * and `result`) plus, when `expected[operation]` is a plain object, that block's own keys. That is
 * the granularity the trap lives at. Going deeper would drown in per-locale key maps and warning
 * arrays without gating anything the outer level misses.
 */
const recordedExpectedFields = new Map();
const comparedExpectedFields = new Map();
const comparedOperations = new Set();
let currentCaseFieldReads = new Set();

const fieldsFor = (map, operation) => {
  let set = map.get(operation);
  if (!set) map.set(operation, (set = new Set()));
  return set;
};

/** Wraps `expected` so that every field the arm reads while comparing is observed. */
function recordingExpected(expected, operation) {
  if (!expected || typeof expected !== "object") return expected;
  const reads = currentCaseFieldReads;
  const wrapBlock = (block, prefix) =>
    new Proxy(block, {
      get(target, property) {
        if (typeof property === "string") reads.add(`${prefix}${property}`);
        return target[property];
      },
    });
  return new Proxy(expected, {
    get(target, property) {
      if (typeof property !== "string") return target[property];
      reads.add(property);
      const value = target[property];
      return property === operation && value && typeof value === "object" && !Array.isArray(value)
        ? wrapBlock(value, `${property}.`)
        : value;
    },
  });
}

/**
 * Called ONLY when `runCase` returned, i.e. the case really was compared.
 *
 * `comparedOperations` is tracked SEPARATELY from the field set, and the distinction is the whole
 * gate. An arm whose body is `return { ok: true }` reads NO fields, so keying dormancy on "this
 * operation has a non-empty read set" would skip precisely the vacuous arm the gate exists to
 * catch — the guard would re-open the hole it was written to close. Membership here says a case ran
 * to a verdict; the read set says what that verdict looked at. An operation that reached a verdict
 * having looked at nothing is the loudest thing this gate can report, not the quietest.
 */
const commitFieldReads = (operation) => {
  comparedOperations.add(operation);
  const set = fieldsFor(comparedExpectedFields, operation);
  for (const field of currentCaseFieldReads) set.add(field);
};

/** Execute one case. Returns {ok} or {ok:false, actual, wanted}; throws Unsupported to skip. */
function runCase(testCase, fixture) {
  const { operation, input } = testCase;
  currentCaseFieldReads = new Set();
  const expected = recordingExpected(testCase.expected, operation);

  // Per case, exactly as the oracle clears its own channels per case. A fresh `Strings` is built for
  // every case, so nothing survives here except what this case's lookup did.
  currentCaseId = testCase.id;
  resolverCalls.length = 0;
  failureCalls.length = 0;
  policyCalls.length = 0;
  supplierCalls.length = 0;
  sentinelThrows.length = 0;

  switch (operation) {
    case "getResult": {
      const strings = stringsFor(fixture);
      // AFTER `stringsFor`, deliberately. 31 of the 34 `IllegalArgumentException` rows here are
      // pre-walk `localeMatchSupplier` ingress refusals, and the port has no supplier ingress yet;
      // they must keep reporting THAT and not be run against a refusal the port makes for some
      // other reason. The remaining 3 are the operand-builder refusals, which construct fine.
      //
      // The placeholders are built INSIDE the thunk for the same reason Java refuses inside the
      // caller's own value construction: `pluralOperands("1", { compactExponent: 65 })` throws
      // before any lookup happens, and a runner that built its placeholders outside the try would
      // see that escape as a crash rather than as the recorded answer.
      if (expected.thrown)
        return thrownCase(expected, () =>
          strings.getResult(input.key, placeholdersFor(input), callOptionsFor(input, strings)));

      const result = strings.getResult(input.key, placeholdersFor(input), callOptionsFor(input, strings));
      // The resolver channel joins the projection rather than sitting beside it. Two thirds of the
      // phonetic corpus renders a string a wrong implementation would also render — a memoizing one,
      // or one handing the resolver the REQUESTED locale — so comparing the translation alone would
      // report those as passes.
      //
      // `failures` and `policyCalls` join it on the same terms and for the same reason. 426 already
      // passing rows carried both channels and the runner had never read either, so the truncation
      // clauses — statements about consultations that did NOT happen — were being verified by
      // nothing at all. Both sides are built the same way: the actual list is always what this run
      // recorded, the wanted list is always the corpus's (empty when the key is absent), so a port
      // that consults once too often or fires the handler twice fails on the count alone.
      const actual = {
        ...projectResult(result),
        resolverCalls: [...resolverCalls],
        failures: projectFailures(result.localeMatch ?? null),
        policyCalls: projectPolicyCalls(),
        supplierCalls: projectSupplierCalls(),
      };
      const wanted = {
        ...expectedResultProjection(expected.result),
        resolverCalls: expectedResolverCalls(expected),
        failures: expectedFailures(expected),
        policyCalls: expectedPolicyCalls(expected),
        supplierCalls: expectedSupplierCalls(expected),
      };

      // The recorded Java DIAGNOSTIC, carried out separately from the projection above so it can be
      // judged on its own terms: banked in `causeMessageMatchedIds` when it reproduces Java, and
      // otherwise required to name a `DECLARED_CAUSE_MESSAGE_DIVERGENCES` entry or FAIL THE RUN.
      //
      // The old note here said making it a failure "would gate on prose the port must not copy",
      // giving the absent-resolver hint as the example. The example was right and the conclusion
      // did not follow: a hint pointing at `Strings.Builder#phoneticResolver(...)` is indeed wrong
      // advice in a JavaScript library, which is an argument for DECLARING that one substitution —
      // not for leaving every divergence in the channel unexamined. It hid sixteen that were simply
      // unfixed.
      const causeMessages = [
        ...(expected.result.failureCause == null
          ? []
          : [{ wanted: expected.result.failureCause.message, actual: messageOf(result.cause) }]),
        ...failureCauseMessages(expected),
      ];

      return jcs(actual) === jcs(wanted) ? { ok: true, causeMessages } : { ok: false, actual, wanted, causeMessages };
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
      //
      // `failures` and `policyCalls` left it on those terms; `thrown` left it at B2, on the same
      // terms — compared by declared name, by message where the message is the library's own, and
      // by REFERENCE IDENTITY on the two arms where identity is the actual claim. `supplierCalls`
      // leaves it HERE, in the same hunk that adds `projectSupplierCalls`/`expectedSupplierCalls`
      // to all three comparisons above, which is the only way a channel has ever been allowed to
      // leave this list: it earns the removal by being compared, never by being inconvenient. The
      // list is now EMPTY, so it is gone rather than kept as a mechanism-shaped hole that would
      // read as a guard while gating nothing — the `xfailedIds` mistake this file already made once.
      const strings = stringsFor(fixture);
      if (expected.thrown)
        return thrownCase(expected, () =>
          strings.get(input.key, placeholdersFor(input), callOptionsFor(input, strings)));

      const actual = {
        translation: strings.get(input.key, placeholdersFor(input), callOptionsFor(input, strings)),
        resolverCalls: [...resolverCalls],
        // No result object exists on this path, so `matchObjectIdenticalToResult` is NOT COMPARABLE
        // and is recorded null on both sides — which is what the oracle does by passing null to
        // `describeObservedFailures`, and why that field is tri-state rather than boolean.
        failures: projectFailures(null),
        policyCalls: projectPolicyCalls(),
        supplierCalls: projectSupplierCalls(),
      };
      const wanted = {
        translation: expected.translation,
        resolverCalls: expectedResolverCalls(expected),
        failures: expectedFailures(expected),
        policyCalls: expectedPolicyCalls(expected),
        supplierCalls: expectedSupplierCalls(expected),
      };
      // `get` produces no result object, so the only cause message it can record is the failure
      // channel's — 73 of the 227 rows the ratchet used to miss entirely.
      return jcs(actual) === jcs(wanted)
        ? { ok: true, causeMessages: failureCauseMessages(expected) }
        : { ok: false, actual, wanted };
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
      //
      // A THUNK, not a value, and the deferral is load-bearing: three of these cases record a throw
      // Java raises while CONSTRUCTING the operands, not while classifying them — `compactExponent`
      // 65 and -1, and `visibleDecimalPlaces` -1, all of which `PluralOperands.Builder.build()`
      // refuses before it touches the number. Now that `pluralOperands()` refuses at the same phase,
      // building the value outside the try below would let the recorded answer escape as a runner
      // crash. `numeric-boundaries.trailing-zeros.reducing-visible-decimal-places-throws-instead-of-
      // rounding` is the control on the other side: its `ArithmeticException` comes from the
      // classifier proper and it must keep passing either way.
      const buildValue = () =>
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
          classifier(buildValue(), input.locale);
          return { ok: false, actual: "no exception", wanted };
        } catch (error) {
          if (error instanceof Unsupported) throw error;
          const actual = error instanceof Error ? error.name : String(error);
          return wantedNames.includes(actual) ? { ok: true } : { ok: false, actual, wanted };
        }
      }

      const classified = classifier(buildValue(), input.locale);
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

      // A recorded THROW is a legitimate expectation here, as it is for cardinalityForNumber. This
      // branch had no thrown handling, so `owed.m3b.cldr.range-for-rules-less-locale-throws` could
      // not pass whatever the port did: it always ran the classifier and reported "no exception"
      // against an exception. That is a runner gap presenting as a port defect, which is the more
      // expensive direction to be wrong in — it sends someone hunting a bug that is not there.
      if (expected.thrown) {
        const javaType = expected.thrown.type;
        if (!(javaType in ERROR_NAME)) unsupported(`no JS counterpart declared for ${javaType}`);
        const wantedNames = ERROR_NAME[javaType];
        try {
          rangeApi.cardinalityForRange(input.start, input.end, input.locale);
          return { ok: false, actual: "no exception", wanted: wantedNames.join(" or ") };
        } catch (error) {
          if (error instanceof Unsupported) throw error;
          const actual = error instanceof Error ? error.name : String(error);
          return wantedNames.includes(actual) ? { ok: true } : { ok: false, actual, wanted: wantedNames.join(" or ") };
        }
      }

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

    case "construct": {
      // CONSTRUCTION ITSELF as the observation. `DefaultStrings`' constructor performs a series of
      // validations that no well-formed fixture can reach, because an ordinary fixture installs
      // exactly one catalog source and exactly one locale source; `constructionOverrides` names one
      // degeneracy from a CLOSED set and the family reads each refusal against the one control that
      // constructs.
      //
      // THE OPTIONS ARE BUILT OUTSIDE THE TRY, deliberately. Only `createStrings` may throw inside
      // it: an `AuthoringError` from an unknown override value, or an `Unsupported` from a fixture
      // this runner cannot drive, must escape rather than be banked as "the port refused this".
      // Recording the harness's own mistakes as believable refusals is precisely how the `define`
      // decoder banked nine mistyped shapes, and this arm is the same shape of machine.
      const instanceBox = { strings: null };
      const options = createStringsOptionsFor(fixture, instanceBox, fixture.constructionOverrides ?? null);

      /** @type {{ constructed: boolean, failureType: string | null, failureMessage: string | null, probe: unknown }} */
      let actual;
      try {
        instanceBox.strings = core.createStrings(options);
        actual = {
          constructed: true,
          failureType: null,
          failureMessage: null,
          probe: constructionProbe(instanceBox.strings, input),
        };
      } catch (error) {
        if (error instanceof Unsupported || error instanceof NoCounterpart || error instanceof AuthoringError)
          throw error;

        // The refusal's IDENTITY, which is what every note in this family says the discriminator is:
        // a port that accepts the input, or refuses it with a different error or wording, differs
        // here and nowhere else.
        actual = {
          constructed: false,
          failureType: /** @type {Error} */ (error).constructor.name,
          failureMessage: messageOf(error),
          probe: null,
        };
      }

      const wantedConstruct = expected.construct;
      let wanted;

      if (wantedConstruct.constructed) {
        wanted = {
          constructed: true,
          failureType: null,
          failureMessage: null,
          probe: expectedConstructionProbe(wantedConstruct.probe),
        };
      } else {
        // Adapted through the declared table in `tools/construct-refusals.mjs`, keyed on the recorded
        // Java pair EXACTLY. A refusal the table does not declare keeps its Java spelling here and is
        // reported FAILED — there is no arm in which a missing entry becomes an `unsupported`.
        const adapted = adaptConstructRefusal(wantedConstruct.failureType, wantedConstruct.failureMessage);
        wanted = {
          constructed: false,
          failureType: adapted ? adapted.jsType : wantedConstruct.failureType,
          failureMessage: adapted ? adapted.jsMessage : wantedConstruct.failureMessage,
          probe: expectedConstructionProbe(wantedConstruct.probe),
        };
      }

      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "acceptLanguage": {
      // Channel two of the matcher's observations, and the one that must NOT throw. Java's
      // `LocaleMatcher#bestMatchForAcceptLanguage` (`:117-139`) is a fail-soft default method over
      // `bestMatchFor(List)`: absent, over the 4,096 UTF-16 code-unit cap, blank, normalizing to
      // nothing, unparseable, or parsing to more than 32 ranges each answer the configured fallback.
      // The oracle records only `bestMatch`, because the method returns a bare `Locale`
      // (`VectorOracle:424`), so the emitted tag IS the JS return value and there is nothing to adapt.
      //
      // THIS ARM AND THE `matchFor` ARM MUST DISAGREE on one recorded input, and that disagreement is
      // the reason they are separate arms rather than one shared call. The 13-member header
      // `he,id,yi,cmn,yue,nan,hak,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.1` expands through the pinned IANA
      // closure to 33 ranges: `browser-chooser.limit.alias-expansion-crosses-thirty-two` records it
      // THROWING through `matchFor(List)` and `accept-language.limit.thirty-three-expanded-ranges`
      // records it answering `ja` here. Its 32-member sibling is accepted WHOLE by both doors, never
      // truncated. A runner that routed both through one entry point would lose one of those two.
      //
      // The module guard is the same one the other three ingresses carry, decided on the subpath's
      // existence rather than on anything the port did with a header.
      const strings = stringsFor(fixture);

      if (!negotiateApi?.createLocaleNegotiator) unsupported("createLocaleNegotiator is not implemented");

      // The instance's OWN configuration, exactly as `matchForCase` does it: `bestMatchForAcceptLanguage`
      // returns the CONFIGURED FALLBACK on six of its exits, so a negotiator built from anything else
      // would report a locale this `Strings` never resolved.
      const negotiator = negotiateApi.createLocaleNegotiator(strings.getLocaleConfiguration());
      const actual = { bestMatch: negotiator.bestMatchForAcceptLanguage(input.header) };
      const wanted = { bestMatch: expected.acceptLanguage.bestMatch };

      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    case "matchFor": {
      // Channel one of the two the corpus records: what the MATCHER selects, observed on its own
      // rather than through a translation. `Strings#matchFor` has two overloads and the corpus
      // exercises both under this one operation name — 137 cases hand it a `Locale`, 164 hand it a
      // `List<LanguageRange>`. As of A4 ALL of them run: the 74 that arrive as an EXPLICIT ARRAY and
      // the 90 spelled as an Accept-Language HEADER, which `parseLanguageRanges` turns into a list
      // exactly where the oracle turns it into one.
      //
      // In JAVA these are one solver, not two: `matchFor(Locale)` is the DEFAULT interface method at
      // `LocaleMatcher.java:63-65`, which wraps `locale.toLanguageTag()` in a single `LanguageRange`
      // and delegates to `matchFor(List)`. As of M7 A3 the port has that one solver too — the member
      // COUNT is no longer what this arm routes on, because it no longer decides anything. What is
      // left to route on is the INPUT SHAPE: an array is a list of `LanguageRange`s the caller
      // already built, a string is a header only `Locale.LanguageRange.parse` can turn into one, and
      // that parser is M7's A4.
      //
      // The ONE ingress difference is real and belongs at the top of the solver, not below it: the
      // locale overload builds its range from `toLanguageTag()`, so it matches on a NORMALIZED tag,
      // while the list overload keeps the caller's raw spelling lowercased. Everything under
      // `matchForRange` is shared.
      //
      // ROUTING ON THE INPUT SHAPE, decided before anything executes — not a catch around a call
      // that ran. A4 leaves NO `unsupported` on the answering path at all: the shape guard below now
      // admits both spellings the corpus uses and fires only on a third one, which no case has. The
      // two that remain reachable cannot absorb a matcher defect — `matchForCase`'s
      // module-availability check, which decides on the subpath's existence before any range is
      // matched, and the recorded-throw branch's undeclared-Java-type check, which fires on the
      // CORPUS's vocabulary rather than on anything the port did.
      //
      // A0 wrote the guard as `!singleMember`, which ALSO routed away the 24 explicit multi-member
      // arrays. A3 implements those, so the count drops out of the condition entirely, and A4 takes
      // the SHAPE out of it too; a guard that still counted members, or still refused strings, would
      // now be refusing work the port does.
      //
      // A `try { … } catch { unsupported(…) }` around the answering call would convert a real
      // matcher defect into attributed non-work and look identical in the headline count, which is
      // why there is nothing to catch there: a throw from the port travels out of this arm and is
      // recorded as FAILED by the runner's own handler. In particular the fourteen ranges that are
      // legal RFC 4647 but not well-formed locales (`de-*`, `x-foo-*`, `zh-guoyu-tw`, …) must MATCH
      // here; if a future edit made them report a reason instead, this arm would be lying.
      const ranges = input.languageRanges;

      // STILL DECIDED ON THE INPUT'S SHAPE, before anything executes. A4 implements the header
      // ingress, so a string is now routed IN rather than away -- but the guard stays, because the
      // two shapes the corpus uses are the two this arm knows how to run, and a third shape arriving
      // from a future corpus must report rather than be coerced into one of them.
      if (input.locale === undefined && !Array.isArray(ranges) && typeof ranges !== "string")
        operationNotImplemented(operation);

      // EIGHT `matchFor` cases record `expected.thrown` and carry NO `expected.match`: the two
      // 33-member limit rows and the six malformed headers. Since A4 all eight reach this branch —
      // seven raised by `parseLanguageRanges` and one, `browser-chooser.limit.explicit-thirty-three-
      // ranges-rejected`, by the port's own 32-member cap on a real 33-entry ARRAY.
      // Without it, `const recorded = expected.match` is `undefined` and `recorded.matchType` dies
      // as a TypeError where an error-identity comparison belongs.
      //
      // The `try` is around ONE call and its catch feeds a COMPARISON, not an attribution: a wrong
      // error, or no error at all, is `{ ok: false }`. `unsupported` travels through untouched, on
      // the `cardinalityForNumber` arm's precedent, because it is the runner's own control flow and
      // not a result from the port.
      //
      // THE MESSAGE IS COMPARED, NOT ONLY THE ERROR KIND, and that is the whole value of the branch.
      // `ERROR_NAME` maps `IllegalArgumentException` to `TypeError | RangeError` deliberately
      // loosely, which is right where the corpus records a category of failure — and far too loose
      // here, where seven of the eight record the PARSER's own verbatim output (`range=notaheader!`,
      // `range=\tfr`, `weight="abc" for language range "fr"`). Measured: routing the eight into this
      // arm against today's port, a kind-only comparison reports all eight as PASSES — seven of them
      // because a header STRING is iterable, so `[..."not a header!"]` refuses its first character
      // as a non-object and throws a `RangeError` that has nothing to do with the header grammar.
      // That is the `zh-123` shape exactly: a check confirming something it never exercised. With
      // the message compared, seven failed and only `.explicit-thirty-three-ranges-rejected` — a real
      // 33-member array, refused by a rule the port already implemented — passed, which was the true
      // state of the port before A4. All eight pass now, on the message; the branch is what made the
      // seven parser refusals a real check rather than a formality the moment A4 routed them in.
      //
      // If A4 finds a wording it must diverge from, that is a recorded decision and a visible edit
      // here, not a comparison quietly narrowed back to the kind.
      if (expected.thrown) {
        const javaType = expected.thrown.type;
        if (!(javaType in ERROR_NAME)) unsupported(`no JS counterpart declared for ${javaType}`);
        const wantedNames = ERROR_NAME[javaType];
        const wanted = { name: wantedNames.join(" or "), message: expected.thrown.message };
        try {
          matchForCase(fixture, input, ranges);
          return { ok: false, actual: { name: "no exception", message: null }, wanted };
        } catch (error) {
          if (error instanceof Unsupported) throw error;
          const name = error instanceof Error ? error.name : String(error);
          const actual = { name, message: messageOf(error) };
          return wantedNames.includes(name) && actual.message === wanted.message
            ? { ok: true }
            : { ok: false, actual, wanted };
        }
      }

      // The same call the recorded-throw branch above makes, on the same two ingresses. See
      // `matchForCase` for why the locale and range doors are separate and why `stringsFor`'s
      // fixture gating is what keeps the cases this arm does not unlock honest.
      const match = matchForCase(fixture, input, ranges);

      // All EIGHT recorded fields, the same key list on both sides. Nothing is defaulted from the
      // expected side and nothing is gated on the recorded side having a value: every `matchFor`
      // case that is not a recorded throw carries `expected.match`, and the throws were taken by
      // the branch above, so there is no null branch to hide behind. A narrower
      // projection here would report passes for a matcher that got `languageRange`,
      // `effectiveWeight` or `consideredLocales` wrong — the fields A0 widened `getResult` to
      // compare, for exactly that reason.
      const actual = {
        matchType: match.matchType,
        locale: match.locale,
        isMatch: match.isMatch,
        fallbackLocale: match.fallbackLocale,
        consideredLocales: match.consideredLocales,
        effectiveWeight: match.effectiveWeight,
        languageRange: asWeightedRange(match.languageRange),
        requestedLanguageRanges: match.requestedLanguageRanges,
      };
      const recorded = expected.match;
      const wanted = {
        matchType: adaptEnum(recorded.matchType),
        locale: recorded.locale,
        isMatch: recorded.isMatch,
        fallbackLocale: recorded.fallbackLocale,
        consideredLocales: recorded.consideredLocales,
        effectiveWeight: recorded.effectiveWeight,
        languageRange: expectedWeightedRange(recorded.languageRange, recorded.requestedLanguageRanges),
        requestedLanguageRanges: recorded.requestedLanguageRanges,
      };
      return jcs(actual) === jcs(wanted) ? { ok: true } : { ok: false, actual, wanted };
    }

    default: {
      const jvmOnly = NO_JS_COUNTERPART[operation];
      if (jvmOnly) noCounterpart(`operation '${operation}' has no JS counterpart: ${jvmOnly.why}`);
      operationNotImplemented(operation);
    }
  }
}

/**
 * Execute one `matchFor` case, on whichever of the two ingresses its input names.
 *
 * Factored out so the recorded-throw comparison and the recorded-match comparison run the SAME
 * call. Two copies would let a future edit make the throwing path reach a different entry point
 * than the one under test — the failure mode where a check confirms something it never exercised.
 *
 * `getDirectLocaleContext(locale)` is the counterpart plan v7 section 3.3 names for
 * `Strings#matchFor(Locale)`: it "validates and normalizes the input, preserves it as
 * `lookupLocale`, and returns the frozen strict single-locale match from this exact `Strings`
 * instance's applicable configuration", invoking no callback and touching no catalog. It is the
 * SAME kernel `getResult` computes its diagnostic from, so this arm cannot pass a case the
 * translation path would get wrong.
 *
 * The RANGE ingress is a different entry point on purpose, and routing it through the locale one is
 * the defect A2 repairs: `getDirectLocaleContext` normalizes, which rewrites `sgn-nsl` to `nsl`
 * (EXACT where Java records CANONICAL), turns `zh-min-nan` into `nan` (selecting `nan-CN` where
 * Java answers `nan-MY`), and rejects a legal `de-*` outright. The two share one kernel below
 * `matchForRange`; they must not share the ingress.
 *
 * `stringsFor` does the fixture gating, unchanged and unweakened, which is what keeps the cases
 * this slice does not unlock honest: the one whose fixture installs an ambient match supplier and
 * the two whose catalogs are raw bytes report the capability that actually blocks them instead of
 * the operation name, and both of those reason strings already existed.
 */
function matchForCase(fixture, input, ranges) {
  const strings = stringsFor(fixture);

  if (input.locale !== undefined) return strings.getDirectLocaleContext(input.locale).localeMatch;

  // The same MODULE-AVAILABILITY guard `parseStrings`, `cardinalityForRange` and the ordinal probes
  // already carry, and the only `unsupported(` on this path. It fires when the subpath does not
  // exist, before any range is matched — never on a range that ran. `optionalSubpath` distinguishes
  // a subpath that is absent from one that threw on import, so a broken `negotiate` cannot arrive
  // here disguised as an unimplemented one.
  // It names BOTH exports A4 needs, under the ONE reason string: they ship from the same module, so
  // two strings would split one bucket in the report and read as a second capability appearing.
  if (!negotiateApi?.createLocaleNegotiator || !negotiateApi?.parseLanguageRanges)
    unsupported("createLocaleNegotiator is not implemented");

  // The instance's OWN applicable configuration, read back through the public accessor rather than
  // rebuilt from the fixture: its `fallbackLocale` is the one `createStrings` resolved to a loaded
  // catalog, so the negotiator matches against exactly what the `Strings` would.
  const negotiator = negotiateApi.createLocaleNegotiator(strings.getLocaleConfiguration());

  // A HEADER STRING is parsed OUTSIDE the library, which is where Java parses it too:
  // `VectorOracle:1022` calls `Locale.LanguageRange.parse(spec.asString())` and hands the resulting
  // list to `strings.matchFor(List)`. Two consequences, and both are recorded rows. A parse refusal
  // is the operation's own `expected.thrown` and must travel out of here rather than be caught. And
  // the 32-member cap is applied by the LIBRARY, on the already-expanded list -- which is why
  // `browser-chooser.limit.alias-expansion-crosses-thirty-two` throws here while the identical
  // header at `accept-language.limit.thirty-three-expanded-ranges`, arriving through the fail-soft
  // door, answers the fallback instead.
  return negotiator.matchForLanguageRanges(
    typeof ranges === "string" ? negotiateApi.parseLanguageRanges(ranges) : ranges);
}

/**
 * The one place the "operation is not implemented" reason string is spelled.
 *
 * Extracted so the `matchFor` arm's language-range guard and the default arm cannot drift apart:
 * a reason string that differed by a word between the two would split one bucket into two in the
 * report and read as a new capability appearing.
 *
 * @param {string} operation
 * @returns {never}
 */
const attributedOperations = new Set();

function operationNotImplemented(operation) {
  const owner = OWNER_MILESTONE[operation];
  attributedOperations.add(operation);
  // AN UNSUPPORTED REASON MUST NAME AN OWNER, and nothing used to enforce it. The ternary below
  // silently degraded to a bare `operation 'x' is not implemented` for any operation missing from
  // the table -- which is precisely the one thing `OWNER_MILESTONE`'s own header says the unsupported
  // list may not do, since a reason with no owning milestone is a gap nobody has agreed to close.
  // Deleting an entry for an operation that gained an arm (as B4 correctly did for `construct`) is
  // safe; deleting one that can still be REACHED was indistinguishable from it until now. This makes
  // the difference structural rather than conventional, on the same reasoning as the `no counterpart`
  // re-derivation: an authoring mistake fails the run instead of printing a plausible line.
  if (!owner)
    throw new AuthoringError(
      `operation '${operation}' reported unsupported with no entry in OWNER_MILESTONE. Every reason ` +
      `must name the milestone that owes the work; add an entry, or give the operation an arm.`,
    );
  unsupported(`operation '${operation}' is not implemented (${owner})`);
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
  //    `nullPlaceholderName` is excluded for exactly the same reason, and it was NOT excluded until
  //    2026-09-06: `placeholdersFor`'s own doc says it "mirrors the flag `VectorOracle` reads for
  //    `DefaultStrings:690`", i.e. it is an oracle authoring directive that forces the MAP form of
  //    plan 3.2's `Placeholders` union, not an option a port could implement. Left in, rule 1
  //    absorbed the very defect it stands next to. MEASURED both ways in a scratch copy: with this
  //    exclusion AND the port's `:690` refusal deleted, the run reads 1,940 passed / 6 FAILED and
  //    `owed-null-placeholder-name.refusal.a-null-placeholder-name-is-refused` is a real FAILURE;
  //    with the exclusion and the port unmodified it reads 1,941 / 5, byte-identical to the run
  //    without it. So the exclusion costs the corpus nothing and buys back a live comparison.
  //    `perCallOverrideOrder` is excluded for the same reason `value`/`start`/`end` are: it is not a
  //    per-call OPTION and no port will ever implement it. It is an ORACLE authoring directive naming
  //    the order in which VectorOracle applies the two TranslationOptions.Builder setters that clear
  //    each other, and lokalized-spec refuses it on any case that does not also carry a non-null
  //    `languageRanges` (tools/vector-oracle/ingest.mjs, backed by an AssertionError in the oracle
  //    itself), so it can never be the ONLY unimplemented key here and excluding it cannot suppress an
  //    attribution. Leaving it in split `per-call options are not implemented (languageRanges)` into a
  //    second bucket differing by one word -- measured, 22 + 2 -- which is exactly the bucket-splitting
  //    `operationNotImplemented`'s comment warns about, and it named a JS option that does not exist as
  //    port work M7 owes.
  const TAKES_OPTIONS = new Set(["getResult", "get"]);
  if (TAKES_OPTIONS.has(testCase.operation)) {
    const perCall = Object.keys(testCase.input)
      .filter((k) =>
        !["key", "locale", "placeholders", "perCallOverrideOrder", "nullPlaceholderName"].includes(k),
      )
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

  // 2e REMOVED at M7 C1, together with the capability it stood for, and it is the widest rule this
  //    file has ever carried. Its text said "Java failed on a budget and this implementation
  //    SUCCEEDED", but what it actually tested was `wanted.failureReason === "resolution-failure"
  //    && actual.failureReason === null` — ANY resolution failure the port did not reproduce, on
  //    any fixture without explicit limits. It was sound only while no budget existed to enforce.
  //    `interpolate.js` now enforces all three defaults (output, cumulative expansion, depth), so
  //    the rule could no longer tell "not built yet" from "built wrong" and its next firing would
  //    have been a real defect wearing an owner's name — the exact failure mode rules 2, 2b, 2c and
  //    2d were deleted for. Its three rows now PASS: two by ablation-verified mechanisms (the output
  //    cap alone converts `runtime-limits.interpolated-output.default.one-past-the-maximum`, the
  //    cumulative budget alone converts `runtime-limits.expansion.default.one-past-the-budget`) and
  //    the third, `generated-placeholders.limits.cumulative-expansion-exceeds-character-budget`,
  //    on the compared fields under EITHER mechanism, with only its `causeMessage` naming which one
  //    fired. That message is now in `causeMessageMatchedIds`, which is where its discrimination
  //    actually lives; the note in `interpolate.js` says so rather than leaving the row looking
  //    sharper than it is.

  // 3 REMOVED at M5b, for the same reason as 2d. It attributed a mismatch to bidi isolation whenever
  //   deleting the isolate controls from Java's answer made the two sides identical. That rule was
  //   sound while nothing isolated; with isolation implemented it would swallow precisely the defects
  //   the family is built to expose — a port isolating under the REQUESTED locale instead of the
  //   donor, isolating a generated value, or isolating on the value's direction rather than the
  //   locale's — because every one of those differs from Java only in where the marks are.

  return null;
}

// --- run ----------------------------------------------------------------------------------------
const corpusBytes = readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes.toString("utf8"));
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
/** Cases whose cause message differs UNDER A DECLARATION, with the fragments that declared it. */
const causeMessageDeclared = [];
/** Cases whose cause message differs with NO declaration. Gated: any entry here fails the run. */
const causeMessageUndeclared = [];

for (const testCase of cases) {
  const fixture = corpus.fixtures[testCase.fixture];

  // The RECORDED side of the field-coverage gate, taken from the corpus rather than from the runner,
  // so the two sides of the comparison have independent origins.
  if (testCase.expected && typeof testCase.expected === "object") {
    const recorded = fieldsFor(recordedExpectedFields, testCase.operation);
    for (const key of Object.keys(testCase.expected)) recorded.add(key);
    const block = testCase.expected[testCase.operation];
    if (block && typeof block === "object" && !Array.isArray(block))
      for (const key of Object.keys(block)) recorded.add(`${testCase.operation}.${key}`);
  }

  try {
    const outcome = runCase(testCase, fixture);
    // AFTER the call, deliberately: a case that threw `Unsupported` never compared anything, so its
    // partial reads must not count as coverage for the operation.
    commitFieldReads(testCase.operation);
    // Only for a case that PASSES. Asking whether the diagnostic matches on a case whose RESULT
    // does not is meaningless, and ratcheting one would pin the wording of a path that is still
    // being built.
    if (outcome.ok && outcome.causeMessages?.length) {
      // A case is banked as matching only when EVERY message it records matches, so a case cannot
      // half-match its way into the ratchet.
      //
      // AND EVERY DIVERGING PAIR IS JUDGED, not just the first. This used to `find` one pair and
      // stop, so a case recording two messages could hide an undeclared divergence behind a
      // declared one -- the same shape as a gate that reports the first failure and exits.
      //
      // PROPHYLACTIC, AND SAID SO RATHER THAN CLAIMED AS A FIX. MEASURED over the whole corpus: 237
      // cases record more than one cause-message pair and in ALL 237 the pairs are byte-identical
      // (222 both-matching, 15 both-diverging, zero mixed), so NO CASE EXERCISES THE DIFFERENCE
      // today and ablating this back to `find` loses nothing. It is kept because it is correct and
      // free, not because it closed an observed hole -- this project's own "reaching a branch is
      // not discriminating it" lesson, applied to the gate's own hardening.
      const diverged = outcome.causeMessages.filter((pair) => pair.wanted !== pair.actual);

      if (!diverged.length) {
        causeMessageMatched.push(testCase.id);
      } else {
        const declarations = diverged.map((pair) => ({
          pair,
          applied: causeMessageDeclaration(pair.wanted, pair.actual),
        }));
        const undeclared = declarations.find((d) => d.applied === null);

        if (undeclared)
          causeMessageUndeclared.push({
            id: testCase.id,
            wanted: undeclared.pair.wanted,
            actual: undeclared.pair.actual,
          });
        else
          causeMessageDeclared.push({
            id: testCase.id,
            applied: [...new Set(declarations.flatMap((d) => d.applied ?? []))],
          });
      }
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

// --- what may be RECORDED as passing ------------------------------------------------------------
/**
 * Cases that can only pass COINCIDENTALLY, and are therefore never banked by the ratchet.
 *
 * A row carrying `perCallOverrideOrder` presents BOTH a per-call `locale` and a non-null
 * `languageRanges` — a shape whose Java answer is decided by the order in which VectorOracle applies
 * the two mutually-clearing TranslationOptions.Builder setters, and whose JS counterpart the port is
 * permanently OBLIGED TO REFUSE (lokalized-spec `TranslationOptions#<init>:70`, disposition
 * `required`, not oracle-derivable). Such a row passes here only because `callOptionsFor` drops
 * `languageRanges` on the floor: the runner asks a one-override question and gets the one-override
 * answer. Banking it would make the ratchet REQUIRE the opposite of the port's obligation — once
 * `languageRanges` reaches `CALL_OPTION_ADAPTERS`, the port's correct refusal throws, is recorded
 * FAILED, and `regressions.length` turns the gate red for doing the right thing. Two such rows were
 * banked by a `--write` before this existed, which is why it is computed from the corpus rather than
 * kept as a list of ids: a list would have to be maintained, and the next such row would be banked
 * before anyone noticed. `passed` itself is untouched — these cases DID pass and the run says so;
 * only what is written down, and what is offered for writing down, is filtered.
 *
 * The rows are `informationalIds` by construction: lokalized-spec's ingest refuses any other
 * partition for a case carrying the key, so nothing here can ever enter a release numerator either.
 *
 * This also replaces `xfailedIds`, which was written as a hard-coded `[]` and read nowhere: a
 * mechanism-shaped hole that looked like the guard this is, and would have been trusted as one.
 * Removed with the same edit that supplies the real thing.
 *
 * THE MARKER KEY ALONE WAS TOO NARROW, and the gap cost a banked id. `perCallOverrideOrder` marks a
 * both-present input, so it never saw `per-call-override-order.zh-tw.ranges-only-on-zh-hant-only-
 * key`, whose input is `{key, languageRanges: "en"}` — ranges with NO per-call locale. That row
 * passed at HEAD for the same coincidental reason the two marked ones did, was banked, and then
 * genuinely stopped passing when B3 taught `callOptionsFor` to report the header arm instead of
 * dropping it. RECORDED, because it is the one id this batch removed from `passedIds`: it is now
 * `notImplementedIds` under `per-call Accept-Language header ranges need the header parser (M7)`,
 * and A4 is the slice that earns it back. Restoring it to the baseline is not an option — it does
 * not pass — and `deliberatelyDroppedIds` in the artifact carries the same fact where a reader of
 * the measurement, rather than of this file, will find it.
 *
 * So the second half of the set is `undeliveredSelectionIds`, taken from what the runner DID rather
 * than from what the input looks like.
 */
const coincidentalIds = new Set([
  ...cases
    .filter((c) => Object.prototype.hasOwnProperty.call(c.input ?? {}, "perCallOverrideOrder"))
    .map((c) => c.id),
  ...undeliveredSelectionIds,
]);
const recordablePassed = passed.filter((id) => !coincidentalIds.has(id));
const notRecorded = passed.filter((id) => coincidentalIds.has(id));

// `unsupportedIds` stays the COMPLETE set of cases that neither passed nor failed, because plan 8.5
// gates a strict parity-backed release on that set being empty and narrowing it here would quietly
// relax the release gate. The new fields partition it: what is unbuilt, and what is unbuildable.
const report = {
  // The field named for the corpus now hashes the CORPUS. It used to be assigned
  // `corpus.oracle.librarySourcesSha256` — the digest of the Java sources the oracle executed, a
  // useful number under the wrong name — so a baseline could be measured against one corpus revision
  // and read back against another with nothing to notice: the corpus grew by five cases and this
  // field did not move. Both are recorded now, each under its own name.
  corpusSha256: createHash("sha256").update(corpusBytes).digest("hex"),
  librarySourcesSha256: corpus.oracle.librarySourcesSha256,
  behavioralVectorsVersion: corpus.behavioralVectorsVersion,
  applicable: cases.length,
  passedIds: recordablePassed,
  /** Passing, but never ratcheted. See `coincidentalIds` — reported, never silently dropped. */
  coincidentallyPassingIds: notRecorded,
  failedIds: failed.map((f) => f.id),
  unsupportedIds: [...skipped, ...nonportable],
  notImplementedIds: skipped,
  nonportableIds: nonportable,
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
/**
 * Entries of `deliberatelyDroppedIds` that are still marked OPEN but whose id passes again.
 *
 * `deliberatelyDroppedIds` is append-only BY CONSTRUCTION — `--write` copies `previouslyDropped`
 * forward — so without a staleness rule it can only grow, and it had already grown into a
 * contradiction: one id sat in `deliberatelyDroppedIds` and in `passedIds` at the same time, its
 * reason carrying an appended "RESTORED by M7 A4" clause. A prose clause is not a distinction a
 * machine can read, and the next reader gets a list mixing live losses with dead ones, which is the
 * "known-gap lists rot" failure `../CLAUDE.md` names and requires new lists to be immune to.
 *
 * So the field gains a `resolved` flag and this gate. An entry is OPEN unless `resolved` is true;
 * an OPEN entry whose id currently passes is STALE and fails the run. Resolving one is a deliberate
 * edit that states the win, exactly as deleting a coverage disposition does — and the flag is never
 * set by `--write`, because a field that heals itself is not a ratchet.
 *
 * @type {{ id: string, reason: string }[]}
 */
let staleDrops = [];
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
    // Offered for recording, not merely passing: a coincidental row must not be reported as a
    // candidate for `--write` either, or the next reviewer records it in good faith.
    newlyPassing = recordablePassed.filter((id) => !wasPassing.has(id));

    staleDrops = (Array.isArray(baseline.deliberatelyDroppedIds) ? baseline.deliberatelyDroppedIds : [])
      .filter((/** @type {{id: string, resolved?: boolean}} */ entry) =>
        entry.resolved !== true && nowPassing.has(entry.id));

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
    // A `--write` that REMOVES ids from `passedIds` is how a regression becomes invisible: the drop
    // is reported against the baseline this same command is about to overwrite, so the next run is
    // clean and the record of the loss is gone. Refused unless the caller says why, and the reason
    // is kept in the artifact next to the ids it removed. Kept ratchet-shaped rather than
    // conscience-shaped: nothing here decides whether a drop is legitimate, only that it is stated.
    if (regressions.length && dropReason === null) {
      console.log(`\nREFUSING TO WRITE: ${regressions.length} id(s) would leave passedIds. Re-run with` +
        `\n  --write --drop-reason "why each of these no longer passes"` +
        `\nif the removal is deliberate; the reason is recorded in the baseline beside the ids.`);
    } else {
      const previouslyDropped = Array.isArray(baseline?.deliberatelyDroppedIds) ? baseline.deliberatelyDroppedIds : [];
      const deliberatelyDroppedIds = [
        ...previouslyDropped,
        ...regressions.map((/** @type {string} */ id) => ({ id, reason: dropReason })),
      ];
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify({ ...report, passedIds: [...recordablePassed].sort(), coincidentallyPassingIds: [...notRecorded].sort(), failedIds: [], unsupportedIds: [...skipped, ...nonportable].sort(), notImplementedIds: [...skipped].sort(), nonportableIds: [...nonportable].sort(), causeMessageMatchedIds: [...causeMessageMatched].sort(), deliberatelyDroppedIds }, null, 2)}\n`, "utf8");
    }
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

// Diagnostics, and THE CHANNEL IS NOW GATED IN BOTH DIRECTIONS. Three terms, all of them in the
// exit expression below:
//
//   - `causeMessageRegressions` — an id in the baseline's `causeMessageMatchedIds` that has stopped
//     matching. The ratchet: a message that once reproduced Java can never silently drift.
//   - `causeMessageUndeclared` — a case whose message diverges with NO entry saying why. THE NEW
//     ONE, and the reason M7 clause 13 is certifiable at all: before it a divergence could appear
//     on a path that had never matched and nothing objected, so "Java-equivalent" could not be
//     claimed off a channel that merely counted.
//   - `staleCauseMessageDivergences` — a declared divergence no case has any more. A declaration
//     that has outlived its reason FAILS, so the table cannot rot into a list of excuses.
//
// The COUNT of declared divergences is deliberately still not a gate; the DECLARATION is. A new row
// that diverges for an argued, Java-only reason should cost an entry and a review, not a red run —
// and losing the reason should cost a red run, which is what stale does.
const causeMessageTotal =
  causeMessageMatched.length + causeMessageDeclared.length + causeMessageUndeclared.length;
// A DECLARED DIVERGENCE IS NOT ALWAYS A WORDING DECISION, and one line reporting them together
// invites the milestone reader to count them all as wording. An entry marked `kind: "configuration"`
// is a CAPABILITY GAP that surfaces here because the two sides ran different configurations -- see
// `classifyFailure`'s rule 0, which owns the same root cause everywhere it is reachable as a
// mismatch, and the compact-exponent entry, which routes here only because every GATED channel still
// agrees. Counted apart so "N wording divergences remain" is a statement a reader can trust.
const configurationFragments = new Set(
  DECLARED_CAUSE_MESSAGE_DIVERGENCES.filter((e) => e.kind === "configuration").map((e) => e.java),
);
const declaredByKind = (kind) =>
  causeMessageDeclared.filter((d) =>
    kind === "configuration"
      ? d.applied.some((f) => configurationFragments.has(f))
      : !d.applied.some((f) => configurationFragments.has(f)),
  );
const declaredWording = declaredByKind("wording");
const declaredConfiguration = declaredByKind("configuration");
if (causeMessageTotal)
  console.log(
    `\nJava cause messages reproduced: ${causeMessageMatched.length}/${causeMessageTotal}` +
      ` (${declaredWording.length} declared Java-only wording divergence(s), ` +
      `${declaredConfiguration.length} declared configuration difference(s), ` +
      `${causeMessageUndeclared.length} UNDECLARED)`,
  );

if (verbose && causeMessageDeclared.length) {
  console.log(`\nDECLARED CAUSE MESSAGE DIVERGENCES (${causeMessageDeclared.length}):`);
  for (const d of causeMessageDeclared)
    console.log(`  ${d.id}\n    ${d.applied.map((f) => JSON.stringify(f)).join("\n    ")}`);
}

// NEVER behind `--verbose`: this is a gate, and a gate that hides its evidence behind a flag makes
// the next reader guess which case failed.
if (causeMessageUndeclared.length) {
  console.log(
    `\nUNDECLARED CAUSE MESSAGE DIVERGENCES (${causeMessageUndeclared.length}) — the port's` +
      ` diagnostic differs from Java's with nothing saying why:`,
  );
  for (const d of causeMessageUndeclared) {
    console.log(`\n  ${d.id}`);
    console.log(`    java ${JSON.stringify(d.wanted)}`);
    console.log(`    js   ${JSON.stringify(d.actual)}`);
  }
  console.log(
    `\nEither make the port say what Java says, or add an entry to` +
      ` DECLARED_CAUSE_MESSAGE_DIVERGENCES\nnaming the Java fragment, the JS fragment, and the` +
      ` argument for why it cannot be reproduced.`,
  );
}

// A declaration that no longer declares anything. Suppressed under `--family`, which runs a subset
// of the corpus and would report every entry that subset happens not to reach.
const staleCauseMessageDivergences = familyFilter
  ? []
  : DECLARED_CAUSE_MESSAGE_DIVERGENCES.filter((e) => !usedCauseMessageDivergences.has(e.java));
// PRINTED, not just commented. `--family` is the invocation an implementer reaches for while
// iterating, so it is the one run that cannot report a rotting declaration -- and a suppression
// documented only in source is a suppression nobody at the terminal knows about.
if (familyFilter && causeMessageTotal)
  console.log("  (stale cause-message declaration check suppressed under --family)");
if (staleCauseMessageDivergences.length) {
  console.log(
    `\nSTALE CAUSE MESSAGE DIVERGENCE (${staleCauseMessageDivergences.length}) — declared, but no` +
      ` case diverges this way any more:`,
  );
  for (const e of staleCauseMessageDivergences) console.log(`  ${JSON.stringify(e.java)}`);
  console.log(`Delete the entry; the port has stopped needing it.`);
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
  if (notRecorded.length)
    console.log(`\nNOT RATCHETED (${notRecorded.length}) — passing, but only coincidentally; see \`coincidentalIds\`:` +
      `\n  ${notRecorded.join("\n  ")}`);
  if (write && !(regressions.length && dropReason === null))
    console.log(`\nbaseline written: ${recordablePassed.length} recorded of ${passed.length} passing` +
      (regressions.length ? `, ${regressions.length} deliberately dropped` : ""));
}

if (declaredOrderFallbacks.length) {
  console.log(`\nDECLARED-ORDER FALLBACK (${declaredOrderFallbacks.length}) — the per-fixture spec file was not usable, so`);
  console.log(`the alphabetized corpus copy stands in. Any warning-ORDER case over these fixtures is comparing`);
  console.log(`an order the corpus cannot carry, and a failure there is a missing input, not a port defect:`);
  for (const note of declaredOrderFallbacks.slice(0, 10)) console.log(`  ${note}`);
  if (declaredOrderFallbacks.length > 10) console.log(`  ... and ${declaredOrderFallbacks.length - 10} more`);
}

if (staleNonportabilityClaims.length) {
  console.log(`\nSTALE NONPORTABILITY CLAIM (${staleNonportabilityClaims.length}):`);
  for (const claim of staleNonportabilityClaims) console.log(`  ${claim}`);
}

if (staleMessageDivergences.length) {
  console.log(`\nSTALE DECLARED MESSAGE DIVERGENCE (${staleMessageDivergences.length}):`);
  for (const entry of staleMessageDivergences) console.log(`  ${entry}`);
}

// The message-parity table's staleness half, on the same discipline as the nonportability claims
// above: a correspondence no case consults has stopped standing for anything and must not be left
// behind as an excuse. Suppressed under `--family`, where most entries legitimately go unconsulted,
// exactly as the passing-ID ratchet is.
const staleAdaptations = familyFilter ? [] : staleConstructAdaptations();
if (staleAdaptations.length) {
  console.log(`\nSTALE CONSTRUCT-REFUSAL ADAPTATION (${staleAdaptations.length}):`);
  for (const claim of staleAdaptations) console.log(`  ${claim}`);
}

if (staleDrops.length) {
  console.log(`\nSTALE DELIBERATE DROP (${staleDrops.length}) — recorded as dropped, but passing again:`);
  for (const entry of staleDrops) console.log(`  ${entry.id}`);
  console.log(`Mark each resolved in measurements/conformance.json ("resolved": true) with what` +
    `\nearned it back, or delete the entry. An open drop that passes is a contradiction, not history.`);
}

/**
 * FIELDS THE CORPUS RECORDS THAT NO COMPARISON READS, EACH WITH A REASON AND A LIVE RE-CHECK.
 *
 * A declaration, not a relaxation — the same contract `DECLARED_CAUSE_MESSAGE_DIVERGENCES` carries.
 * An entry here does NOT say "ignore this field". It says "this field carries no information the
 * runner is not already comparing through another path", and it names a `stillRedundant` predicate
 * that RE-DERIVES that claim from the corpus on every run over the cases actually compared. When the
 * claim stops holding, the entry fails the run instead of quietly continuing to excuse the field.
 *
 * Without the predicate this table would be the thing this project keeps finding and regretting: a
 * sentence asserting a review, outliving the fact it described.
 */
const DECLARED_UNCOMPARED_FIELDS = [
  {
    operation: "getResult",
    field: "match",
    why:
      "`getResult` records the SELECTION channel twice: once at `expected.match` and once at " +
      "`expected.result.localeMatchResult`, which `expectedResultProjection` compares field for " +
      "field. MEASURED over the corpus: of 1,082 `getResult` cases carrying both, 1,079 are " +
      "identical on `match`'s own key set, and the 3 that differ are exactly the per-call-" +
      "override-order rows (`ingress-matrix-java.zh-tw.per-call-ranges-displace-per-call-locale`, " +
      "`per-call-override-order.zh-tw.locale-then-ranges-on-zh-hant-only-key`, " +
      "`supplied-match.ingress.per-call-ranges-clear-an-earlier-per-call-locale`) — the rows a JS " +
      "object literal cannot express at all, which are reported as NO COUNTERPART and never " +
      "compared. So reading `expected.match` here would add no discrimination TODAY. That is a " +
      "measurement about today's corpus, which is why `stillRedundant` re-checks it every run: " +
      "selection and resolution are separate channels and are known to disagree, so one new case " +
      "where they diverge and the runner IS blind to it.",
    /**
     * Re-derives the redundancy over the cases that were actually compared this run.
     * Returns the ids that break the claim; a non-empty list fails the run.
     */
    stillRedundant: (comparedIds) =>
      cases
        .filter((c) => c.operation === "getResult" && comparedIds.has(c.id))
        .filter((c) => {
          const recorded = c.expected?.match;
          const viaResult = c.expected?.result?.localeMatchResult;
          if (!recorded) return false;
          if (!viaResult) return true;
          return Object.keys(recorded).some((k) => jcs(recorded[k]) !== jcs(viaResult[k]));
        })
        .map((c) => c.id),
  },
];

/**
 * THE OTHER HALF OF `OWNER_MILESTONE`'S CONTRACT: an entry nothing can reach.
 *
 * `operationNotImplemented` already THROWS when an operation reports unsupported with no entry, so a
 * reason cannot print without an owner. Nothing checked the mirror, and its own header said why that
 * mattered: "Deleting an entry for an operation that gained an arm is safe; deleting one that can
 * still be REACHED was indistinguishable from it until now." The consequence is dated rather than
 * hypothetical — `load: "M8"` becomes unreachable on M8's FIRST slice, and without this the table
 * would keep asserting that M8 owes work it had just delivered.
 *
 * MEASURED when this gate was written: `parse: "M5a"`, `matchFor: "M7"` and `acceptLanguage: "M7"`
 * were already dead — all three operations have arms and can never reach the `default` branch that
 * consults this table. Removing all three left the whole conformance report BYTE-IDENTICAL, which is
 * how they were proven dead rather than argued dead. Every other declaration table here fails on a
 * stale entry; this one now does too.
 */
const staleOwnerMilestones = Object.keys(OWNER_MILESTONE).filter((op) => !attributedOperations.has(op));

if (staleOwnerMilestones.length) {
  console.log(`\nSTALE OWNER_MILESTONE ENTRIES (${staleOwnerMilestones.length}) — nothing reached them:`);
  for (const operation of staleOwnerMilestones)
    console.log(`  ${operation}: "${OWNER_MILESTONE[operation]}" — no case reported it unsupported`);
  console.log(`An operation that gained an arm no longer owes anyone work. Delete the entry; that` +
    `\ndeletion IS the record of the milestone landing, the way a deleted coverage disposition is.`);
}

/**
 * THE FIELD-COVERAGE GATE. A field the corpus recorded that no comparison ever read is a field the
 * runner is not checking, however many cases the operation reports as passed.
 *
 * Judged only for operations that were actually compared at least once — see the machinery's header.
 */
const comparedCaseIds = new Set([...passed, ...failed.map((entry) => entry.id)]);
const declaredUncompared = new Set(DECLARED_UNCOMPARED_FIELDS.map((d) => `${d.operation}.${d.field}`));

const uncomparedExpectedFields = [];
for (const [operation, recorded] of recordedExpectedFields) {
  if (!comparedOperations.has(operation)) continue;
  const read = comparedExpectedFields.get(operation) ?? new Set();
  const missing = [...recorded]
    .filter((field) => !read.has(field) && !declaredUncompared.has(`${operation}.${field}`))
    .sort();
  if (missing.length) uncomparedExpectedFields.push({ operation, missing });
}

// The other direction: a declaration whose redundancy claim has stopped being true, and a
// declaration for a field that is now read anyway (which makes the entry itself stale).
const staleUncomparedDeclarations = [];
for (const declaration of DECLARED_UNCOMPARED_FIELDS) {
  if (!comparedOperations.has(declaration.operation)) continue;
  const read = comparedExpectedFields.get(declaration.operation);
  if (read?.has(declaration.field))
    staleUncomparedDeclarations.push({
      declaration,
      why: `\`${declaration.operation}\` now READS \`${declaration.field}\`; the declaration excuses nothing`,
      ids: [],
    });
  else {
    const broken = declaration.stillRedundant(comparedCaseIds);
    if (broken.length)
      staleUncomparedDeclarations.push({
        declaration,
        why: `the redundancy this entry rests on no longer holds for ${broken.length} COMPARED case(s)`,
        ids: broken,
      });
  }
}

if (staleUncomparedDeclarations.length) {
  console.log(`\nSTALE UNCOMPARED-FIELD DECLARATIONS (${staleUncomparedDeclarations.length}):`);
  for (const { declaration, why, ids } of staleUncomparedDeclarations) {
    console.log(`  ${declaration.operation}.${declaration.field} — ${why}`);
    for (const id of ids.slice(0, 5)) console.log(`      ${id}`);
    if (ids.length > 5) console.log(`      ... and ${ids.length - 5} more`);
  }
  console.log(`Compare the field, or restate the declaration against what is true now. An excuse that` +
    `\nhas outlived its reason is exactly what this table exists not to become.`);
}

if (uncomparedExpectedFields.length) {
  console.log(`\nUNCOMPARED EXPECTED FIELDS (${uncomparedExpectedFields.length}) — the corpus records` +
    `\nthese, the runner compared cases of this operation, and nothing ever read them:`);
  for (const { operation, missing } of uncomparedExpectedFields)
    console.log(`  ${operation}: ${missing.join(", ")}`);
  console.log(`A case that passes without its recorded fields being read is not evidence about them.` +
    `\nCompare the field, or -- if it genuinely has no JS counterpart -- make that a declared` +
    `\nunsupported/no-counterpart reason so it is visible, never a field quietly left unread.`);
}

process.exit(
  failed.length === 0 && regressions.length === 0 && causeMessageRegressions.length === 0 &&
  causeMessageUndeclared.length === 0 && staleCauseMessageDivergences.length === 0 &&
  staleNonportabilityClaims.length === 0 && staleAdaptations.length === 0 &&
  staleDrops.length === 0 && staleMessageDivergences.length === 0 &&
  uncomparedExpectedFields.length === 0 && staleUncomparedDeclarations.length === 0 &&
  staleOwnerMilestones.length === 0 ? 0 : 1,
);
