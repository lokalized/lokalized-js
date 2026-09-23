// @ts-check
/**
 * Corpus-driven gate for `src/internal/locale.js`.
 *
 * The behavioral corpus records what unmodified lokalized-java 3.0.0 actually does. Two of its
 * channels belong to this module and both are driven here in full:
 *
 *   - every `matchFor` case whose input is a single locale (the rest supply an `Accept-Language`
 *     header and belong to the language-range negotiator);
 *   - the `attemptedLocales` of every `getResult` case that reports a result, which is exactly what
 *     `candidateChain` must produce as a prefix.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { decodeLanguageEquivalents } from "../src/data/iana-range-equivalents.js";
import { decodeRegionVariantEquivalents } from "../src/data/iana-identity-equivalents.js";
import { createLocaleNegotiator, parseLanguageRanges } from "../src/negotiate/index.js";
import {
	IANA_IDENTITY_EQUIVALENTS,
	candidateChain,
	matchFor,
	maximize,
	normalizeTag,
	parentChain,
	primaryLanguage,
} from "../src/internal/locale.js";
import { canonicalLanguageTag } from "../src/internal/locale-cldr.js";
import { javaSplit } from "../src/internal/locale-jdk-tag.js";

/**
 * The sibling spec checkout, guarded.
 *
 * This read used to be BARE, so a clone without `../lokalized-spec` did not skip — it CRASHED the
 * whole file, and with it every self-contained test in it. CI hit exactly that. The other corpus
 * gates in this suite already guard the read and skip; these five did not, which is why five files
 * died while forty tests reported a tidy `# SKIP`.
 *
 * Skipping is only half the answer, and on its own it is the failure mode this project keeps
 * relearning: a suite that quietly shrinks has stopped gating. CI therefore checks out
 * `lokalized-spec` AND fails when ANY test skips, so the skip below can only ever be a local
 * convenience, never a green CI run that verified nothing.
 */
let corpus = null;
try {
  corpus = JSON.parse(
    readFileSync(new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url), "utf8"),
  );
} catch {
  // Sibling spec checkout not present.
}
const corpusSkip = corpus
  ? false
  : "behavioral vectors not found at ../lokalized-spec/generated/behavioral-vectors.json";

/** Corpus enum values are Java's; the JS contract uses kebab-lower. */
const MATCH_TYPES = /** @type {const} */ ({
	NONE: "none",
	EXACT: "exact",
	CANONICAL: "canonical",
	CLDR_FALLBACK: "cldr-fallback",
	LIKELY_SUBTAG: "likely-subtag",
	EXTENDED_RANGE: "extended-range",
	PRIMARY_LANGUAGE: "primary-language",
	WILDCARD: "wildcard",
});

/** @param {string} first @param {string} second */
function compareTags(first, second) {
	return first < second ? -1 : first > second ? 1 : 0;
}

/** @param {string} first @param {string} second */
function canonicallyEquivalent(first, second) {
	return canonicalLanguageTag(first).toLowerCase() === canonicalLanguageTag(second).toLowerCase();
}

/**
 * The loaded locale set a case actually ran against. The corpus reports it directly as
 * `consideredLocales`, which is authoritative: it already reflects the loader's own decisions about
 * which catalog filenames are recognized. Fixture file names are only a fallback.
 *
 * @param {any} testCase
 * @returns {string[] | null}
 */
function consideredLocalesFor(testCase) {
	const considered = testCase.expected?.match?.consideredLocales ??
		testCase.expected?.result?.localeMatchResult?.consideredLocales;
	return Array.isArray(considered) ? considered : null;
}

/**
 * Replicates the parts of the Java constructor the assembler owns: loader normalization of catalog
 * names, tiebreaker language-code normalization, the identity tiebreakers derived for a language
 * with one loaded locale, and the resolution of a fallback locale that is only canonically
 * equivalent to a loaded one (`hy-810` -> `hy-AM`).
 *
 * @param {any} fixture
 * @param {string[] | null} [consideredLocales]
 * @returns {{ supported: string[], tiebreakers: Record<string, string[]>, fallbackLocale: string }}
 */
function contextFor(fixture, consideredLocales) {
	const supported = (consideredLocales ?? Object.keys(fixture.files ?? {}).map((name) => normalizeTag(name)))
		.slice()
		.sort(compareTags);

	/** @type {Record<string, string[]>} */
	const tiebreakers = {};

	for (const [languageCode, locales] of Object.entries(fixture.tiebreakers ?? {}))
		tiebreakers[languageCode] = /** @type {string[]} */ (locales).map((locale) => normalizeTag(locale));

	const configured = normalizeTag(fixture.fallbackLocale);
	let fallbackLocale = supported.includes(configured) ? configured : null;

	if (fallbackLocale === null) {
		const equivalent = supported.filter((locale) => canonicallyEquivalent(locale, configured));

		if (equivalent.length === 1) fallbackLocale = equivalent[0] ?? null;
		else if (equivalent.length > 1) {
			const languageCode = primaryLanguage(configured);

			for (const [suppliedCode, locales] of Object.entries(tiebreakers)) {
				if (primaryLanguage(suppliedCode) !== languageCode) continue;
				for (const locale of locales)
					if (equivalent.includes(locale)) { fallbackLocale = locale; break; }
				if (fallbackLocale !== null) break;
			}
		}
	}

	assert.notEqual(fallbackLocale, null, `unresolvable fallback locale '${fixture.fallbackLocale}'`);
	return { supported, tiebreakers, fallbackLocale: /** @type {string} */ (fallbackLocale) };
}

describe("normalizeTag", () => {
	it("rewrites JDK legacy codes, grandfathered tags and the extlang collapse", () => {
		assert.equal(normalizeTag("iw"), "he");
		assert.equal(normalizeTag("in"), "id");
		assert.equal(normalizeTag("ji"), "yi");
		assert.equal(normalizeTag("i-klingon"), "tlh");
		assert.equal(normalizeTag("art-lojban"), "jbo");
		assert.equal(normalizeTag("no-bok"), "nb");
		assert.equal(normalizeTag("cel-gaulish"), "xtg-x-cel-gaulish");
		assert.equal(normalizeTag("i-default"), "en-x-i-default");
		assert.equal(normalizeTag("zh-guoyu"), "cmn");
		assert.equal(normalizeTag("zh-min-nan"), "nan");
		assert.equal(normalizeTag("zh-cmn"), "cmn");
		assert.equal(normalizeTag("sgn-ase"), "ase");
		assert.equal(normalizeTag("ru-SUN"), "sun");
		assert.equal(normalizeTag("sgn-BE-FR"), "sfb");
	});

	it("normalizes case without touching region or script identity", () => {
		assert.equal(normalizeTag("nb-no"), "nb-NO");
		assert.equal(normalizeTag("EN-us"), "en-US");
		assert.equal(normalizeTag("ZH-hant"), "zh-Hant");
		assert.equal(normalizeTag("sgn-US"), "sgn-US");
		assert.equal(normalizeTag("hy-810"), "hy-810");
		assert.equal(normalizeTag("aa-Saaho"), "aa-Saaho");
	});

	it("does NOT apply CLDR aliases", () => {
		assert.equal(normalizeTag("mo"), "mo");
		assert.equal(normalizeTag("sh"), "sh");
		assert.equal(normalizeTag("hy-SU"), "hy-SU");
		assert.equal(normalizeTag("pap-AN"), "pap-AN");
	});

	it("keeps undetermined and private-use tags addressable", () => {
		assert.equal(normalizeTag("und"), "und");
		assert.equal(normalizeTag("und-Latn"), "und-Latn");
		assert.equal(normalizeTag("x-private"), "x-private");
		assert.equal(normalizeTag("en-x-custom"), "en-x-custom");
		assert.equal(normalizeTag("root"), "root");
	});

	it("throws RangeError on a malformed tag", () => {
		for (const tag of ["", "en-", "en-!!", "toolongsubtag", "en-US-", "x"])
			assert.throws(() => normalizeTag(tag), RangeError, `expected '${tag}' to be rejected`);
	});

	it("refuses an ill-formed tag rather than truncating it, as plan §2.2 requires", () => {
		// THE ILL-FORMED CONTRACT, pinned in the DEFAULT gate. `npm run diff:direct-tag` measures this
		// class against the pinned JDK — 82 tags where `Locale.forLanguageTag` truncates and the port
		// refuses, 0 wrongly accepted — and gates it in both directions, but it needs the JDK and is
		// not part of `npm run verify`. These rows are what makes a leniency toggle fail `npm test`.
		//
		// Java's truncation for each. Four are read off that differential's own probe output;
		// `en-Latin-US` is not in its probe space and was probed directly on the pinned Corretto 21
		// (`Locale.Builder().setLanguageTag` rejects it, `forLanguageTag` gives `en-Latin`). It is
		// not a near-miss repair: two of these are not tags at all, and `zh-min-nan.json` truncates
		// to a language nobody wrote.
		for (const [tag, javaTruncatesTo] of [
			["no-NO-NY", "no-NO"],          // the legacy Norwegian spelling; Java answers from `nb`
			["en-Latin-US", "en-Latin"],    // ...which Java itself then REFUSES as a duplicate
			["readme.txt", "und"],          // a filename
			["en-US,en", "en"],             // a whole Accept-Language header
			["zh-min-nan.json", "min"],     // truncates to a DIFFERENT language
		])
			assert.throws(() => normalizeTag(tag), RangeError,
				`expected '${tag}' to be refused, not truncated to '${javaTruncatesTo}'`);

		// CONTROLS, and they are the point of the row rather than decoration: each is the WELL-FORMED
		// near-miss of a refusal above, differing only in the ill-formedness under test. A port that
		// refused too much would fail here, and the two clauses — "accept every well-formed tag" and
		// "refuse everything else" — would otherwise be indistinguishable. Both expectations are
		// Java's, re-probed on the pinned Corretto 21 in the same run as the truncations above:
		// `Locale.Builder` accepts both, and `forLanguageTag(…).toLanguageTag()` gives exactly these.
		assert.equal(normalizeTag("no-NO-x-lvariant-NY"), "nn-NO");
		assert.equal(normalizeTag("en-Latn-US"), "en-Latn-US");
	});

	it("requires an ALPHA extension singleton, as LanguageTag.isExtensionSingleton does", () => {
		// A DIGIT singleton is not an extension prefix, so the tail is an invalid subtag and the whole
		// tag is ill-formed. `Locale.forLanguageTag` truncates each of these to a bare `en`.
		for (const tag of ["en-1-abc", "en-0-x", "en-9-aa"])
			assert.throws(() => normalizeTag(tag), RangeError, `expected '${tag}' to be rejected`);

		assert.equal(normalizeTag("en-a-bbb"), "en-a-bbb");
		assert.equal(normalizeTag("de-DE-u-co-phonebk"), "de-DE-u-co-phonebk");
		assert.equal(normalizeTag("en-US-u-nu-latn"), "en-US-u-nu-latn");
	});

	it("keeps only the first of a repeated extension singleton, as Locale does", () => {
		// InternalLocaleBuilder.setExtensions keys by singleton and ignores every repeat.
		assert.equal(normalizeTag("en-a-foo-a-bar"), "en-a-foo");
		assert.equal(normalizeTag("en-b-two-a-one"), "en-a-one-b-two");
	});
});

describe("javaSplit", () => {
	it("reproduces Java's String#split('-'), which JavaScript's split does not", () => {
		// Java drops ALL trailing empty subtags, and returns a single-element array holding the whole
		// input only when the separator never matched.
		assert.deepEqual(javaSplit(""), [""]);
		assert.deepEqual(javaSplit("-"), []);
		assert.deepEqual(javaSplit("--"), []);
		assert.deepEqual(javaSplit("en-"), ["en"]);
		assert.deepEqual(javaSplit("en--"), ["en"]);
		assert.deepEqual(javaSplit("-en"), ["", "en"]);
		assert.deepEqual(javaSplit("en-US"), ["en", "US"]);
	});
});

describe("primaryLanguage", () => {
	it("canonicalizes the whole tag before extracting the language", () => {
		assert.equal(primaryLanguage("mo"), "ro");
		assert.equal(primaryLanguage("sh"), "sr");
		assert.equal(primaryLanguage("aa-Saaho"), "ssy");
		assert.equal(primaryLanguage("cmn"), "zh");
		assert.equal(primaryLanguage("en-US"), "en");
		assert.equal(primaryLanguage("nb-NO"), "nb");
	});

	it("reports no language for undetermined and private-use tags", () => {
		assert.equal(primaryLanguage("und"), "");
		assert.equal(primaryLanguage("und-Latn"), "");
		assert.equal(primaryLanguage("x-private"), "");
	});
});

describe("parentChain", () => {
	it("walks CLDR parents, excluding the tag itself and root", () => {
		assert.deepEqual(parentChain("en-AU"), ["en-001", "en"]);
		assert.deepEqual(parentChain("en-US"), ["en"]);
		assert.equal(parentChain("en-AU").includes("en-AU"), false);
		assert.equal(parentChain("en-AU").includes("root"), false);
	});

	it("bridges the Norwegian macrolanguage in both directions", () => {
		assert.equal(parentChain("nb-NO").includes("no"), true);
		assert.equal(parentChain("no-NO").includes("nb"), true);
	});

	it("truncates toward the bare language when CLDR names no explicit parent", () => {
		// pt and pt-PT are in different CARDINAL RULE groups, but that is a plural-data fact; the
		// parent walk in this CLDR drop still truncates both regional forms to pt.
		assert.deepEqual(parentChain("pt-PT"), ["pt"]);
		assert.deepEqual(parentChain("pt-BR"), ["pt"]);
	});
});

describe("maximize", () => {
	it("expands to a full language-script-region triple", () => {
		assert.equal(maximize("en"), "en-Latn-US");
		assert.equal(maximize("zh-TW"), "zh-Hant-TW");
		assert.equal(maximize("zh"), "zh-Hans-CN");
		assert.equal(maximize("pt-PT"), "pt-Latn-PT");
		assert.equal(maximize("und-Latn"), "en-Latn-US");
	});
});

/**
 * The matched range as a `{ range, weight }` pair on both sides.
 *
 * The port PRODUCES the pair, because Java's `languageRange` is a whole `LanguageRange` whose weight
 * is part of its identity; the corpus records only `getRange()`. The weight is not invented here —
 * it is read back out of the recorded `requestedLanguageRanges`, which Java's own constructor
 * guarantees contains the matched range. Ambiguity throws rather than falling back to the range
 * text, which is how a comparison quietly stops comparing.
 *
 * @param {unknown} languageRange
 * @param {{ range: string, weight: number }[] | undefined} requested
 */
function weightedRange(languageRange, requested) {
	if (languageRange === null || languageRange === undefined) return null;

	const text = typeof languageRange === "string" ? languageRange : /** @type {any} */ (languageRange).range;
	const weights = new Set((requested ?? []).filter((r) => r.range === text).map((r) => r.weight));

	assert.equal(weights.size, 1,
		`the recorded languageRange ${JSON.stringify(text)} carries ${weights.size} distinct weights ` +
		`in requestedLanguageRanges; the weight is no longer derivable`);

	return { range: text, weight: [...weights][0] };
}

/**
 * Drives one recorded match result through the module and returns the [actual, expected] pair.
 *
 * @param {any} testCase
 * @param {any} expected the recorded LocaleMatchResult
 */
function driveMatch(testCase, expected) {
	const { supported, tiebreakers, fallbackLocale } =
		contextFor(corpus.fixtures[testCase.fixture], expected.consideredLocales);
	const actual = matchFor(testCase.input.locale, supported, fallbackLocale, tiebreakers);

	return [{
		matchType: actual.matchType,
		locale: actual.locale,
		isMatch: actual.isMatch,
		fallbackLocale: actual.fallbackLocale,
		consideredLocales: actual.consideredLocales,
		effectiveWeight: actual.effectiveWeight,
		languageRange: weightedRange(actual.languageRange, actual.requestedLanguageRanges),
		requestedLanguageRanges: actual.requestedLanguageRanges,
	}, {
		matchType: MATCH_TYPES[/** @type {keyof typeof MATCH_TYPES} */ (expected.matchType)],
		locale: expected.locale ?? null,
		isMatch: expected.isMatch,
		fallbackLocale: expected.fallbackLocale,
		consideredLocales: expected.consideredLocales,
		effectiveWeight: expected.effectiveWeight ?? null,
		languageRange: weightedRange(expected.languageRange ?? null, expected.requestedLanguageRanges),
		requestedLanguageRanges: expected.requestedLanguageRanges,
	}];
}

describe("matchFor against the corpus", { skip: corpusSkip }, () => {
	/** @type {any[]} */
	const cases = corpus.cases.filter((/** @type {any} */ testCase) =>
		testCase.operation === "matchFor" && typeof testCase.input.locale === "string");

	// Every `getResult` case also records the full LocaleMatchResult the run negotiated, so the
	// diagnostic channel is gated on every recorded result rather than only on the cases whose
	// operation happens to be named `matchFor`. Cases that supply language ranges are excluded:
	// Java's ingress lets per-call ranges displace a per-call locale, so their recorded result belongs
	// to the header channel, not to this kernel.
	/** @type {any[]} */
	const derivedCases = corpus.cases.filter((/** @type {any} */ testCase) =>
		testCase.operation === "getResult" && typeof testCase.input.locale === "string" &&
		testCase.input.languageRanges === undefined && testCase.expected?.result?.localeMatchResult);

	it("covers every single-locale matchFor case in the corpus", () => {
		// This used to pin exact counts, which corpus GROWTH — the one change that is unambiguously good
		// news — breaks while saying nothing about correctness. What the pin actually guards is that no
		// recorded case escapes every channel unnoticed, so assert the partitions themselves and keep
		// floors against a filter that silently stops matching.
		//
		// The floors sit at the CURRENT corpus counts, not at the counts standing before the last growth.
		// A floor left behind at a stale value is slack a narrowed filter can hide in: 966 against the
		// 1,056 results now recorded would let ninety cases fall out of the strongest gate in this file
		// without a word. Raise them when the corpus grows; they only ever forbid shrinkage.
		/** @type {any[]} */
		const all = corpus.cases.filter((/** @type {any} */ testCase) => testCase.operation === "matchFor");
		// Defined POSITIVELY — by what the case supplies, not as the negation of the other half — so the
		// partition equality below can actually fail. Defined by negation it is a tautology that gates
		// nothing. Ranges arrive either as a raw `Accept-Language` header string or as a parsed list;
		// both are the negotiator's business, so test for presence, not for `Array.isArray`.
		/** @type {any[]} */
		const headerCases = all.filter((/** @type {any} */ testCase) => testCase.input.languageRanges !== undefined);

		assert.equal(cases.length + headerCases.length, all.length,
			"every matchFor case belongs to this kernel or to the language-range negotiator, and to exactly one");

		// The equality above catches a case in neither channel or in both; this names it. Both are real
		// hazards: a case supplying neither is driven by nothing, and one supplying both would be driven
		// here as a single-locale match even though Java's ingress lets per-call ranges displace a
		// per-call locale (TranslationOptions.Builder#languageRanges nulls the locale outright).
		for (const testCase of all) {
			const suppliesLocale = typeof testCase.input.locale === "string";
			const suppliesRanges = testCase.input.languageRanges !== undefined;
			assert.ok(suppliesLocale !== suppliesRanges, `${testCase.id} supplies ` +
				(suppliesLocale ? "both a locale and language ranges, so two channels claim it"
					: "neither a locale nor language ranges, so no channel drives it"));
		}

		for (const testCase of cases)
			assert.ok(testCase.expected?.match, `${testCase.id} records no match result to gate against`);

		// The `getResult` cases carrying a LocaleMatchResult split three ways, and each way is either
		// driven below or excluded for a stated reason.
		/** @type {any[]} */
		const resultCases = corpus.cases.filter((/** @type {any} */ testCase) =>
			testCase.operation === "getResult" && testCase.expected?.result?.localeMatchResult);
		// Ranges present (with or without a locale): the header channel negotiated this result.
		const rangeDriven = resultCases.filter((/** @type {any} */ testCase) =>
			testCase.input.languageRanges !== undefined);
		// Neither present: the locale came from the instance's ambient configuration, a locale supplier,
		// or a localeMatchSupplier whose result Java preserves rather than re-deriving, so the call's own
		// input cannot reconstruct what this kernel was handed.
		const ambient = resultCases.filter((/** @type {any} */ testCase) =>
			testCase.input.languageRanges === undefined && typeof testCase.input.locale !== "string");

		assert.equal(derivedCases.length + rangeDriven.length + ambient.length, resultCases.length,
			"every recorded LocaleMatchResult is driven here, header-negotiated, or ambient-sourced");
		// That equality is exhaustive by construction, so it cannot fail on its own — these two can. The
		// excused bucket is excused because the CALL omitted a locale; assert that rather than assume it,
		// and hold the driven share so future growth cannot drain into the excused bucket unremarked
		// (1,056 of 1,220 today). The old exact count made any such drift fail loudly; a bare floor does
		// not, and this is what replaces that half of its teeth.
		for (const testCase of ambient)
			assert.ok(!("locale" in testCase.input),
				`${testCase.id} is excused as ambient but its input carries a locale key`);
		assert.ok(derivedCases.length / resultCases.length >= 0.85,
			`only ${derivedCases.length} of ${resultCases.length} recorded LocaleMatchResults are driven by this gate`);

		assert.ok(all.length >= 263, `matchFor cases fell to ${all.length}`);
		assert.ok(cases.length >= 137, `single-locale matchFor cases fell to ${cases.length}`);
		assert.ok(derivedCases.length >= 1056, `single-locale getResult cases fell to ${derivedCases.length}`);
	});

	it("reports consideredLocales as the deduplicated, tag-sorted supported set", () => {
		// `consideredLocales` is echoed from this module's own input, so pin the two properties that are
		// NOT echoed: Java sorts by Locale#toLanguageTag and holds a Map key set, and every recorded
		// list is already in exactly that shape.
		for (const testCase of [...cases, ...derivedCases]) {
			const expected = testCase.operation === "matchFor"
				? testCase.expected.match
				: testCase.expected.result.localeMatchResult;
			/** @type {string[]} */
			const considered = expected.consideredLocales;
			assert.deepEqual(considered, [...new Set(considered)].sort(compareTags), testCase.id);
		}

		// Shuffled and duplicated input must still produce that same canonical list.
		const scrambled = matchFor("en-US", ["fr", "en", "en", "de-DE", "fr"], "en", {});
		assert.deepEqual(scrambled.consideredLocales, ["de-DE", "en", "fr"]);
	});

	for (const testCase of cases) {
		it(testCase.id, () => {
			const [actual, expected] = driveMatch(testCase, testCase.expected.match);
			assert.deepEqual(actual, expected);
		});
	}

	it("reproduces the LocaleMatchResult recorded by every single-locale getResult case", () => {
		/** @type {string[]} */
		const failures = [];

		for (const testCase of derivedCases) {
			const [actual, expected] = driveMatch(testCase, testCase.expected.result.localeMatchResult);

			try {
				assert.deepEqual(actual, expected);
			} catch {
				failures.push(`${testCase.id}: locale=${testCase.input.locale} ` +
					`got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
			}
		}

		assert.deepEqual(failures, []);
	});
});

describe("candidateChain against the corpus", { skip: corpusSkip }, () => {
	/** @type {any[]} */
	const cases = corpus.cases.filter((/** @type {any} */ testCase) =>
		testCase.operation === "getResult" && Array.isArray(testCase.expected?.result?.attemptedLocales));

	it("covers every getResult case that reports a resolution walk", () => {
		// A floor rather than an equality: this set only grows with the corpus, and the floor is kept at
		// the current count so it forbids every shrinkage rather than only a large one. The property
		// worth pinning is that a recorded walk and a recorded LocaleMatchResult always travel together —
		// a case reporting one without the other means a channel is being skipped somewhere.
		/** @type {any[]} */
		const withMatchResult = corpus.cases.filter((/** @type {any} */ testCase) =>
			testCase.operation === "getResult" && testCase.expected?.result?.localeMatchResult);

		assert.deepEqual(cases.map((testCase) => testCase.id).sort(),
			withMatchResult.map((/** @type {any} */ testCase) => testCase.id).sort());
		assert.ok(cases.length >= 1220, `resolution-walk cases fell to ${cases.length}`);
	});

	it("reproduces every attemptedLocales prefix", () => {
		/** @type {string[]} */
		const failures = [];

		for (const testCase of cases) {
			const { supported, tiebreakers, fallbackLocale } =
				contextFor(corpus.fixtures[testCase.fixture], consideredLocalesFor(testCase));
			const result = testCase.expected.result;
			const chain = candidateChain(result.lookupLocale, supported, fallbackLocale, tiebreakers);
			/** @type {string[]} */
			const attempted = result.attemptedLocales;

			// `attemptedLocales` is the prefix resolution actually visited: the walk stops at the first
			// catalog holding the key, or when the fallback policy declines to continue.
			const prefixMatches = attempted.length <= chain.length &&
				attempted.every((locale, index) => locale === chain[index]);

			if (!prefixMatches)
				failures.push(`${testCase.id}: lookup=${result.lookupLocale} expected prefix ` +
					`${JSON.stringify(attempted)} of ${JSON.stringify(chain)}`);

			// When resolution succeeded, the supplying locale must be the last one visited.
			if (prefixMatches && result.status === "TRANSLATED" && result.resolvedLocale !== null &&
				attempted[attempted.length - 1] !== result.resolvedLocale)
				failures.push(`${testCase.id}: resolvedLocale ${result.resolvedLocale} is not the last attempt`);
		}

		assert.deepEqual(failures, []);
	});

	it("is not the selection channel: translated cases routinely supply from a locale matchFor did not select", () => {
		// A quantified guard against anyone collapsing the two channels. The SUPPLYING locale — the one
		// interpolation and plural selection must evaluate under — is the last candidateChain entry
		// actually visited, and it disagrees with matchFor's selection in better than a quarter of
		// translated cases (222 of 853). Floors at the current counts plus a ratio, not exact counts:
		// collapsing the channels would drive divergence toward zero, which is what the ratio catches,
		// while corpus growth only moves the totals up. The ratio sits at a fifth rather than at today's
		// quarter so that growth weighted toward agreeing cases does not raise a false alarm.
		const translated = corpus.cases.filter((/** @type {any} */ testCase) =>
			testCase.operation === "getResult" && testCase.expected?.result?.localeMatchResult &&
			testCase.expected.result.status === "TRANSLATED");
		const diverging = translated.filter((/** @type {any} */ testCase) =>
			testCase.expected.result.resolvedLocale !== testCase.expected.result.localeMatchResult.locale);

		assert.ok(translated.length >= 853, `translated cases fell to ${translated.length}`);
		assert.ok(diverging.length >= 222, `diverging cases fell to ${diverging.length}`);
		assert.ok(diverging.length / translated.length > 0.2,
			`selection and resolution diverge in only ${diverging.length}/${translated.length} translated cases`);
	});

	it("separates selection from resolution where the corpus says they diverge", () => {
		const testCase = corpus.cases.find((/** @type {any} */ candidate) =>
			candidate.id === "resolution.direct.zh-tw.selection-and-resolution-diverge");
		assert.ok(testCase, "expected the divergence case to exist in the corpus");

		const { supported, tiebreakers, fallbackLocale } =
			contextFor(corpus.fixtures[testCase.fixture], consideredLocalesFor(testCase));
		const selection = matchFor(testCase.input.locale, supported, fallbackLocale, tiebreakers);
		const resolution = candidateChain(testCase.expected.result.lookupLocale, supported, fallbackLocale, tiebreakers);

		assert.equal(selection.locale, "zh-Hant");
		assert.deepEqual(resolution, ["zh-TW", "zh-Hant", "en"]);
		assert.equal(resolution.includes("zh"), false, "the loaded zh must never be visited");
		assert.equal(supported.includes("zh"), true, "…even though it is loaded");
	});
});

/**
 * THE DIRECT-MATCH IANA TABLE — the projection of the registry's full table that core's automatic
 * single-locale matcher walks (`IANA_IDENTITY_EQUIVALENTS`, generated into
 * `src/data/iana-identity-equivalents.js` by `tools/gen-iana-data.js`).
 *
 * Its CONTENT is `tools/gen-iana-data.js --check`'s to gate (run by `test/generated-data.test.js`):
 * that tool derives the projection from the spec artifact and refuses a module that does not decode
 * back to it. A second copy of that recipe here would be a transcription, and was deleted with A30.
 * What is here is what a recipe check cannot see — whether the DOOR that reads the table answers as
 * Java does. MEASURED in M-R S13: a port carrying all the right rows and simply not consulting some of
 * them left conformance green and the suite green. A recipe check is not a behaviour check.
 */
describe("the direct-match IANA identity table", () => {
	const full = decodeLanguageEquivalents();

	it("is an order-preserving projection of the full registry table", () => {
		assert.ok(IANA_IDENTITY_EQUIVALENTS.size > 0);
		const notProjected = [];

		for (const [key, others] of IANA_IDENTITY_EQUIVALENTS) {
			const fullOthers = full.get(key);
			// A subsequence of the key's full class, in the full class's order.
			let cursor = 0;
			const subsequence = fullOthers !== undefined && others.every((member) => {
				while (cursor < fullOthers.length && fullOthers[cursor] !== member) cursor += 1;
				return cursor++ < fullOthers.length;
			});
			if (!subsequence) notProjected.push([key, others, fullOthers]);
		}

		assert.deepEqual(notProjected, [], "identity rows that are not an order-preserving subsequence of the full table");
	});

	/**
	 * The walk reads a PROJECTION where Java's reads the full table, so the hazard is a walk that
	 * stops at a SHORTER prefix and substitutes at the wrong boundary. `tools/gen-iana-data.js` refuses
	 * to emit such a projection; this asserts the property of what shipped, against the full table
	 * this repository also ships, so it needs no spec checkout.
	 */
	it("cannot stop at a prefix Java's walk would have passed", () => {
		const shadowed = [];
		for (const key of full.keys()) {
			if (IANA_IDENTITY_EQUIVALENTS.has(key)) continue;
			for (let index = key.lastIndexOf("-"); index > 0; index = key.lastIndexOf("-", index - 1))
				if (IANA_IDENTITY_EQUIVALENTS.has(key.slice(0, index))) shadowed.push([key, key.slice(0, index)]);
		}
		assert.deepEqual(shadowed, [],
			"full-table keys the projection dropped whose shorter prefix it kept; the reduced walk would substitute early");
	});

	/**
	 * **THE PAIR SET IS DERIVED, because a list written to the classes a change added would go green
	 * over the one that pre-dates it.** `nsl` <-> `sgn-no` was diverging before any registry data
	 * arrived — CLDR sends `sgn-NO` to `nsi`, so canonicalization does not cover it, which is exactly the
	 * case `src/internal/locale.js` calls out as where CLDR and IANA genuinely disagree. Deriving on "the
	 * two members do not share a CLDR canonical form" finds it and rots correctly when the registry moves.
	 */
	describe("the single-locale door walks prefixes, as Java's does", () => {
		/** Directed pairs the table carries that CLDR canonicalization does NOT already unify. */
		const ianaOnlyPairs = [...IANA_IDENTITY_EQUIVALENTS.entries()].flatMap(([tag, others]) =>
			others.filter((member) => !canonicallyEquivalent(tag, member)).map((member) => [tag, member]));

		it("finds a suffixed equivalent, for every pair CLDR does not already unify", () => {
			// ANTI-VACUITY FIRST: an empty derivation would make every assertion below hold trivially.
			// MEASURED 8 at A30 (it read 9 while the table carried an `und-hepburn` variant row, an
			// artefact of the probed closure; that pair's Java answer is pinned in its own test now).
			assert.ok(ianaOnlyPairs.length >= 8,
				`only ${ianaOnlyPairs.length} IANA-only pair(s) derived; the table carried 8 when this was written`);

			// The pre-existing instance must be IN the derived set, or the set was built to fit the
			// classes a change added and would go green over the defect that predates it.
			assert.ok(ianaOnlyPairs.some(([tag, member]) => tag === "nsl" && member === "sgn-no"),
				"nsl -> sgn-no is the pair that predates the registry change; it must be derived, not omitted");

			// **THE SUFFIX IS PRIVATE-USE ON PURPOSE, AND A REGION SUFFIX IS THE TRAP.** `-001` makes
			// `sgn-no-001` a tag with TWO regions: ill-formed, so both this port and Java refuse it and
			// the pre-existing pair drops out of the comparison entirely. `-x-a` is well-formed after
			// any well-formed tag, so the derived set stays whole.
			const wrong = ianaOnlyPairs
				.map(([tag, member]) => {
					const match = matchFor(`${tag}-x-a`, ["en", `${member}-x-a`], "en", {});
					return [`${tag}-x-a`, `${member}-x-a`, match.locale, match.matchType];
				})
				.filter(([, want, got]) => got === null || got.toLowerCase() !== want.toLowerCase());

			assert.deepEqual(wrong, [], "suffixed requests that did not reach their equivalent catalog");
		});

		it("answers the bare form too, and refuses a tag in no class", () => {
			assert.equal(matchFor("mgp", ["en", "mrd"], "en", {}).locale, "mrd");
			assert.equal(matchFor("mgp", ["en", "mrd"], "en", {}).matchType, "canonical");
			assert.equal(matchFor("xh", ["en", "mrd"], "en", {}).locale, null);
		});

		it("a CLDR-unified pair matches either way, which is why it is the control and not the probe", () => {
			// `aam`/`aas` is in the table AND unified by CLDR, so it would pass over an exact-lookup
			// port as well. It proves the fixture shape is sound and NOTHING about the walk.
			assert.equal(matchFor("aam-x-a", ["en", "aas-x-a"], "en", {}).locale, "aas-x-a");
			assert.ok(canonicallyEquivalent("aam", "aas"));
		});
	});

	/**
	 * **JAVA'S ROWS FOR THE ONE THING BOTH DOORS SHARE, and therefore the one thing comparing them
	 * cannot see.** A language equivalent COMBINED with a region or variant substitution: `mgp-BU` over
	 * a loaded `mrd-MM` needs the `mgp`->`mrd` class AND the `-bu`->`-mm` substitution applied to the
	 * derived member (`languageRangeExpansions`' nested step).
	 *
	 * MEASURED against lokalized-java 3.1.0 (`target/classes`) on the pinned Corretto 21 through
	 * `Strings#matchFor(Locale)`, one catalog per locale plus the fallback. Before A30 the table here
	 * was pre-expanded and carried such combinations only where its probe space happened to include
	 * them: that port answered NONE on all four probe rows below, and on 88 of the 22,493 pairs of
	 * the door grid below (mgp/mrd 28, mrh/shl 28, enm/yol 28, nsl/sgn-no 4), where Java answers
	 * CANONICAL — measured 2026-09-23 by answering that grid with both ports and with Java. The
	 * corpus and `diff:lookup` saw none of them. The whole-list door agreed with the old answers too,
	 * because it shares the expansion, so the grid below could not have caught it either.
	 *
	 * The undetermined-language pair is the opposite direction, and it is pinned so a door that started
	 * matching `und-*` would be noticed: Java answers NONE for it, bare and suffixed, although its parse
	 * expands it.
	 */
	it("combines a language equivalent with a region/variant substitution, as Java does", () => {
		/** @type {[string, string[], string, string | null, string][]} request, catalogs, fallback, Java's locale, Java's type */
		const javaRows = [
			["mgp-BU", ["en", "mrd-MM"], "en", "mrd-MM", "canonical"],
			["mrh-BU", ["en", "shl-MM"], "en", "shl-MM", "canonical"],
			["yol-heploc", ["fr", "enm-alalc97"], "fr", "enm-alalc97", "canonical"],
			["nsl-heploc", ["en", "sgn-NO-alalc97"], "en", "sgn-NO-alalc97", "canonical"],
			// Controls: the language class alone, and the region substitution alone.
			["mgp-BU", ["en", "mrd-BU"], "en", "mrd-BU", "canonical"],
			["es-BU", ["en", "es-MM"], "en", "es-MM", "canonical"],
			// Java answers nothing for the undetermined-language variant pair, bare and suffixed.
			["und-hepburn-heploc", ["en", "und-hepburn-alalc97"], "en", null, "none"],
			["und-hepburn-heploc-x-a", ["en", "und-hepburn-alalc97-x-a"], "en", null, "none"],
		];

		const wrong = javaRows
			.map(([request, catalogs, fallback, locale, matchType]) => {
				const match = matchFor(request, catalogs, fallback, {});
				return [request, catalogs, `${locale}/${matchType}`, `${match.locale}/${match.matchType}`];
			})
			.filter(([, , java, port]) => java !== port);

		assert.deepEqual(wrong, [], "single-locale answers that differ from lokalized-java 3.1.0's, measured on the pinned JDK");
	});

	/**
	 * **THE TWO DOORS AGREE ON EVERY ONE-MEMBER REQUEST, over every registry subtag.** The single-locale
	 * door walks the PROJECTION; the whole-list door walks the FULL table through `parseLanguageRanges`.
	 * The projection is exact AS MEASURED rather than by construction, and this is the measurement: for
	 * every full-table key crossed with no suffix, a private-use suffix and each region/variant subtag,
	 * normalized as a locale, each normalized member of its parse offered as a catalog beside a fallback,
	 * both doors must select the same locale with the same match type.
	 *
	 * BLIND BY CONSTRUCTION to a defect in the expansion both doors share (removing the nested
	 * region/variant step leaves this at 0 differences, measured); the Java rows above and
	 * `test/iana-model-parity.test.js` carry that. What this catches is a PROJECTION that drops a member
	 * a door can reach — MEASURED at design time: removing the `mgp`/`mrd` class from the identity
	 * module alone gives 60 differing pairs here.
	 */
	it("the single-locale door equals the whole-list door on one-member requests", () => {
		const suffixes = ["", "-x-a", ...decodeRegionVariantEquivalents().map(([from]) => from)];
		const differing = [];
		// Different keys normalize to the same request, so the loop meets many (request, catalog) pairs
		// more than once; both doors answer a pair from those two values alone, so each is probed ONCE
		// and `pairs` counts DISTINCT pairs — the unit the comments in `src/internal/locale.js` and
		// `tools/lookup-diff/run.mjs` state.
		const seen = new Set();
		let pairs = 0;
		let differences = 0;

		for (const key of full.keys())
			for (const suffix of suffixes) {
				let request;
				try { request = normalizeTag(key + suffix).toLowerCase(); } catch { continue; }

				const catalogs = new Set();
				for (const { range } of parseLanguageRanges(request))
					try { catalogs.add(normalizeTag(range)); } catch { /* not a locale; cannot be a catalog */ }

				for (const catalog of catalogs) {
					const pair = `${request}\u0000${catalog}`;
					if (seen.has(pair)) continue;
					seen.add(pair);
					const fallback = catalog.toLowerCase().startsWith("en") ? "fr" : "en";
					/** @type {string} */
					let single;
					/** @type {string} */
					let whole;
					try {
						const match = matchFor(request, [fallback, catalog], fallback, {});
						single = `${match.locale}/${match.matchType}`;
					} catch (error) { single = `threw ${/** @type {Error} */ (error).message}`; }
					try {
						const match = createLocaleNegotiator({ supportedLocales: [fallback, catalog], fallbackLocale: fallback })
							.matchForLanguageRanges([{ range: request, weight: 1 }]);
						whole = `${match.locale}/${match.matchType}`;
					} catch (error) { whole = `threw ${/** @type {Error} */ (error).message}`; }
					pairs += 1;
					if (single === whole) continue;
					differences += 1;
					if (differing.length < 20) differing.push([request, catalog, single, whole]);
				}
			}

		assert.deepEqual(differing, [], `${differences} one-member request(s) the two doors answer differently (first 20 shown)`);
		// MEASURED 22,493 distinct pairs (30,684 loop visits before de-duplication) at A30; a floor well
		// below, so the anti-vacuity term fires on a broken probe rather than on a registry that shrank.
		// This line read 22,864 until the A30 follow-up, a number neither count had ever been.
		assert.ok(pairs >= 15_000, `only ${pairs} (request, catalog) pairs probed; the grid is not being built`);
	});
});
