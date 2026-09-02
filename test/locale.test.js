// @ts-check
/**
 * Corpus-driven gate for `src/internal/locale.js`.
 *
 * The behavioral corpus records what unmodified lokalized-java 3.0.0 actually does. Two of its
 * channels belong to this module and both are driven here in full:
 *
 *   - every `matchFor` case whose input is a single locale (123 of the 216; the other 93 supply an
 *     `Accept-Language` header and belong to the language-range negotiator);
 *   - the `attemptedLocales` of every `getResult` case that reports a result, which is exactly what
 *     `candidateChain` must produce as a prefix.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	IANA_RANGE_EQUIVALENTS,
	candidateChain,
	matchFor,
	maximize,
	normalizeTag,
	parentChain,
	primaryLanguage,
} from "../src/internal/locale.js";
import { canonicalLanguageTag } from "../src/internal/locale-cldr.js";
import { javaSplit, jdkLanguageTag } from "../src/internal/locale-jdk-tag.js";

const corpus = JSON.parse(readFileSync(
	new URL("../../lokalized-spec/generated/behavioral-vectors.json", import.meta.url), "utf8"));

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
		languageRange: actual.languageRange,
		requestedLanguageRanges: actual.requestedLanguageRanges,
	}, {
		matchType: MATCH_TYPES[/** @type {keyof typeof MATCH_TYPES} */ (expected.matchType)],
		locale: expected.locale ?? null,
		isMatch: expected.isMatch,
		fallbackLocale: expected.fallbackLocale,
		consideredLocales: expected.consideredLocales,
		effectiveWeight: expected.effectiveWeight ?? null,
		languageRange: expected.languageRange ?? null,
		requestedLanguageRanges: expected.requestedLanguageRanges,
	}];
}

describe("matchFor against the corpus", () => {
	/** @type {any[]} */
	const cases = corpus.cases.filter((/** @type {any} */ testCase) =>
		testCase.operation === "matchFor" && typeof testCase.input.locale === "string");

	// Every `getResult` case also records the full LocaleMatchResult the run negotiated, so the
	// diagnostic channel is gated on 1,089 recorded results rather than on the 123 cases whose
	// operation happens to be named `matchFor`. The two cases that supply BOTH a locale and language
	// ranges are excluded: Java's ingress lets per-call ranges displace a per-call locale, so their
	// recorded result belongs to the header channel, not to this kernel.
	/** @type {any[]} */
	const derivedCases = corpus.cases.filter((/** @type {any} */ testCase) =>
		testCase.operation === "getResult" && typeof testCase.input.locale === "string" &&
		testCase.input.languageRanges === undefined && testCase.expected?.result?.localeMatchResult);

	it("covers every single-locale matchFor case in the corpus", () => {
		const all = corpus.cases.filter((/** @type {any} */ testCase) => testCase.operation === "matchFor");
		assert.equal(all.length, 216);
		assert.equal(cases.length, 123);
		assert.equal(derivedCases.length, 966);
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

describe("candidateChain against the corpus", () => {
	/** @type {any[]} */
	const cases = corpus.cases.filter((/** @type {any} */ testCase) =>
		testCase.operation === "getResult" && Array.isArray(testCase.expected?.result?.attemptedLocales));

	it("covers every getResult case that reports a resolution walk", () => {
		assert.equal(cases.length, 1104);
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

	it("is not the selection channel: 221 translated cases supply from a locale matchFor did not select", () => {
		// A quantified guard against anyone collapsing the two channels. The SUPPLYING locale — the one
		// interpolation and plural selection must evaluate under — is the last candidateChain entry
		// actually visited, and it disagrees with matchFor's selection in 28% of translated cases.
		const translated = corpus.cases.filter((/** @type {any} */ testCase) =>
			testCase.operation === "getResult" && testCase.expected?.result?.localeMatchResult &&
			testCase.expected.result.status === "TRANSLATED");
		const diverging = translated.filter((/** @type {any} */ testCase) =>
			testCase.expected.result.resolvedLocale !== testCase.expected.result.localeMatchResult.locale);

		assert.equal(translated.length, 788);
		assert.equal(diverging.length, 221);
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

describe("the inlined IANA language-range equivalence table", () => {
	it("matches the spec's pinned registry, restricted to normalized tags", () => {
		const registry = JSON.parse(readFileSync(new URL(
			"../../lokalized-spec/generated/iana-language-range-equivalents.json", import.meta.url), "utf8"));

		/** @param {string} tag */
		const normalized = (tag) => jdkLanguageTag(tag).toLowerCase() === tag;

		/** @type {Map<string, string[]>} */
		const expected = new Map();

		for (const [tag, equivalents] of Object.entries(registry.equivalents)) {
			if (!normalized(tag)) continue;
			const kept = /** @type {string[]} */ (equivalents).filter((value) => value === tag || normalized(value));
			if (kept.length > 1) expected.set(tag, kept);
		}

		assert.deepEqual([...IANA_RANGE_EQUIVALENTS.entries()].sort(), [...expected.entries()].sort());
	});
});
