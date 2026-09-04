// @ts-check

/**
 * lokalized/negotiate — RFC 4647, pinned IANA closure, header helpers.
 *
 * Deliberately outside the root graph (plan 3.1, enforced by the `scenario:0a` module ratchet):
 * nothing here may become reachable from `src/index.js`.
 *
 * WHY THIS MODULE EXISTS AT ALL, rather than a method on `Strings`. Java has two entry points into
 * one solver — `matchFor(Locale)` and `matchFor(List<LanguageRange>)` — and they differ in exactly
 * one place, at the very top: the locale overload builds its range from `locale.toLanguageTag()`,
 * so the range it matches on is NORMALIZED, while the list overload keeps whatever range the caller
 * wrote, lowercased and otherwise untouched. That difference is not cosmetic. `sgn-nsl` normalizes
 * to `nsl`, which reports `EXACT`/`nsl` where Java reports `CANONICAL`/`nsl`; and `zh-min-nan`
 * normalizes to `nan`, which — through `memberStaticsFor`'s semantic range — selects `nan-CN` where
 * Java selects `nan-MY`. The ANSWER changes, not just the diagnostic. So the raw ingress is its own
 * entry point (`matchForRanges`, and `matchForRange` beneath it for a single member), and this module
 * is its public door. `matchFor` is the NORMALIZING locale overload and is not that door.
 *
 * The whole N-member solver is wired up as of M7 A3 — group election, the semantic-member election,
 * the cell matrix, anchor reservation, the category-major heuristic passes, the governor sweep and
 * the serving cascade all live in `matchForRanges`. What remains outside it is the HEADER parser
 * (`Locale.LanguageRange.parse`), which is A4; a caller reaching this module hands it an explicit
 * list, and the 32-member cap below is the only shape rule left here.
 */

import { decode as decodeRangeEquivalents } from "../data/iana-range-equivalents.js";
import { matchFor, matchForRanges, normalizeTag } from "../internal/locale.js";

/**
 * The pinned IANA range-equivalence closure, 802 classes, probed out of the JDK oracle itself
 * (`lokalized-spec generated/IANA-PROVENANCE.md`). It is loaded HERE and nowhere else: plan 3.1 keeps
 * the whole-list negotiator's tables out of the root graph, and `test/pinned-data-only.test.js` names
 * this module so a future import into `src/index.js` fails a test rather than a byte ratchet.
 */
const RANGE_EQUIVALENTS = decodeRangeEquivalents();

/**
 * `sun.util.locale.LocaleMatcher#getEquivalentsForLanguage` — the LANGUAGE-PREFIX arm of the
 * equivalence expansion, and that arm ONLY.
 *
 * PREFIX SUBSTITUTION, not exact lookup — the artifact's own `closureSchema` says so. The JDK walks
 * the range from its full spelling down, dropping one trailing subtag at a time, stops at the FIRST
 * key it finds, and rewrites that prefix to each member of the class. So `sgn-be-fr-x-a` finds
 * `sgn-be-fr` and yields `sfb-x-a`, and `no-bok-no` finds `no-bok` and yields `nb-no`. An exact
 * lookup finds neither, and both are recorded corpus answers.
 *
 * TWO MEASURED DIVERGENCES FROM `Locale.LanguageRange.parse`, which is literally what Java's
 * `DefaultStrings#addParsedLanguageRangeIdentities` (`:2161-2172`) calls. This function is NOT that
 * method, and an earlier revision of this comment said it was. A 4,010-range differential against
 * the pinned Corretto 21 — every one of the 802 artifact keys bare, and each again with `-hans`,
 * `-us`, `-1901` and `-x-a` — reproduced 802/802 bare and 3,206/3,207 suffixed. The two exceptions:
 *
 * 1. UNDER-EXPANSION. `parse` also applies `sun.util.locale.LocaleEquivalentMaps`' 13-entry
 *    REGION/VARIANT map (`LocaleEquivalentMaps.java:815-827`), which the pinned artifact carries no
 *    key for because its probe space never suffixed a region. Measured on the JDK:
 *    `de-DE`→`de-dd`, `de-DD`→`de-de`, `en-BU`→`en-mm`, `en-TL`→`en-tp`, `en-TP`→`en-tl`,
 *    `ja-heploc`→`ja-alalc97`, `ja-alalc97`→`ja-heploc`, `en-YD`→`en-ye`, `en-YE`→`en-yd`,
 *    `fr-FX`→`fr-fr`, `fr-FR`→`fr-fx`, `zh-CD`→`zh-zr`, `zh-ZR`→`zh-cd`. This resolver misses all
 *    thirteen. M7-PLAN.md A4 assigns that map to the header PARSER alone; the measurement says it
 *    belongs to MEMBER IDENTITIES too, i.e. here. It is deliberately NOT shipped in this slice —
 *    plan open question 6 asks whether to ship it at all, and the JDK's answer depends on HashMap
 *    iteration order — but the gap is recorded rather than left implied by a wrong comment. No
 *    corpus row is affected: none loads a `-DE`/`-FX`/`-BU`/`-TL`/`-YD`/`-CD`/`-heploc` catalog and
 *    none supplies such a range, which is exactly why only a JDK differential can see it.
 * 2. OVER-EXPANSION, one case in 3,207. `cmn-hans` yields `{cmn-hans, zh-cmn-hans, zh-guoyu-hans}`
 *    here and `{cmn-hans, zh-cmn-hans}` on the JDK, which drops `zh-guoyu-hans` as an ill-formed
 *    tag (a 4-alpha subtag after a variant). Inert for the exact-identity loop, since no catalog
 *    normalizes to `zh-guoyu-hans`, but the identity set also feeds
 *    `semanticLanguageRangeForDerivedMatching`, so it is not provably harmless. Do NOT close it by
 *    editing the artifact: the artifact reconstructs 802/802 bare keys exactly and is not the source.
 *
 * @type {import("../internal/locale.js").RangeEquivalentResolver}
 */
function pinnedRangeEquivalents(range) {
	const lowered = range.toLowerCase();
	let prefix = lowered;

	while (prefix.length > 0) {
		const equivalents = RANGE_EQUIVALENTS.get(prefix);

		if (equivalents !== undefined) {
			const suffix = lowered.slice(prefix.length);
			return equivalents.map((equivalent) => equivalent + suffix);
		}

		const index = prefix.lastIndexOf("-");
		if (index === -1) break;
		prefix = prefix.slice(0, index);
	}

	return null;
}

/**
 * @typedef {object} WeightedLanguageRange
 * @property {string} range
 * @property {number} weight
 */

/**
 * The applicable locale configuration a negotiator matches against — the exact shape
 * `strings.getLocaleConfiguration()` returns.
 *
 * `fallbackLocale` is taken as ALREADY RESOLVED to a loaded catalog, which is what that method
 * yields (`DefaultStrings.java:446-470`, ported in `createStrings`). A hand-built configuration must
 * therefore name a locale it also supports, and is refused below when it does not, rather than
 * silently negotiating against a fallback no catalog answers to.
 *
 * @typedef {object} LocaleConfiguration
 * @property {string} fallbackLocale
 * @property {readonly string[]} supportedLocales
 * @property {Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]>} [tiebreakers]
 */

/** RFC 4647 caps nothing, but `LocaleMatcher` and plan 3.3 both cap a public request at 32 members. */
const MAXIMUM_LANGUAGE_RANGES = 32;

const MINIMUM_WEIGHT = 0;
const MAXIMUM_WEIGHT = 1;

/** `java.lang.Character#isLetter` restricted to the ASCII the grammar admits. */
const isAsciiLetter = (/** @type {string} */ character) =>
	(character >= "a" && character <= "z") || (character >= "A" && character <= "Z");

const isAsciiDigit = (/** @type {string} */ character) => character >= "0" && character <= "9";

/**
 * `java.util.Locale$LanguageRange#isSubtagIllFormed`, verbatim.
 *
 * The grammar is RFC 4647 section 2.2's extended language range:
 * `(1*8ALPHA / "*") *("-" (1*8alphanum / "*"))`.
 *
 * A ONE-CHARACTER ALPHA SUBTAG IS LEGAL. The JDK tests `subtag.equals("*")` as an early accept and
 * then only bounds the length and the character classes, so `x-lokal`, `x-foo-*` and `sgn-be-fr-x-a`
 * are all well-formed ranges — and every one of them is in the corpus with a recorded MATCH. A
 * validator that reads the ABNF as "length 1 means it must be `*`" rejects six recorded cases at the
 * door and would have moved them out of a real answer into a plausible-looking refusal. It was
 * written that way here first, and the corpus is what caught it.
 *
 * @param {string} subtag
 * @param {boolean} isFirstSubtag the first subtag is ALPHA-only; later ones admit digits
 * @returns {boolean}
 */
function isSubtagIllFormed(subtag, isFirstSubtag) {
	if (subtag.length === 0 || subtag.length > 8) return true;
	if (subtag === "*") return false;

	for (const character of subtag)
		if (!(isAsciiLetter(character) || (!isFirstSubtag && isAsciiDigit(character)))) return true;

	return false;
}

/**
 * One caller-supplied language range, admitted on `Locale.LanguageRange`'s grammar: lowercase, then
 * check, and report the offending range in Java's own wording so a caller reading the message sees
 * what the JDK would have said.
 *
 * THE WEIGHT MESSAGE IS `LanguageRange.parse`'s, NOT THE CONSTRUCTOR'S, and that is deliberate even
 * though the grammar check is the constructor's. Measured on the pinned Corretto 21:
 * `new Locale.LanguageRange("en", 1.5)` says only `weight=1.5`, while
 * `Locale.LanguageRange.parse("fr;q=1.5")` says `weight=1.5 for language range "fr". It must be
 * between 0.0 and 1.0.` — and it is the LATTER the corpus records, at
 * `browser-chooser.malformed.weight-above-one`. An earlier revision of this comment credited the
 * string to the constructor; the string is right and the attribution was wrong.
 *
 * Two things A4 inherits, both measured on the same JDK. (a) A NON-NUMERIC weight has its own Java
 * wording — `weight="abc" for language range "fr"`, quoted and with no trailing sentence, recorded
 * at `browser-chooser.malformed.nonnumeric-weight` — where this function collapses NaN and
 * non-numeric into the out-of-range form and will fail that case as written. (b) Java's
 * CONSTRUCTOR accepts `Double.NaN` (`new Locale.LanguageRange("en", Double.NaN)` is `en;q=NaN`)
 * where this refuses it. Only the JS object door can reach that state, so it needs a recorded
 * decision rather than a fix.
 *
 * THE LOWERCASING IS PART OF THE CONTRACT, not a convenience. It is why a caller may write
 * `en-Latn-US` and see `en-latn-us` echoed back in `requestedLanguageRanges`, and it is the ONLY
 * rewriting a range ever undergoes — in particular it is not `normalizeTag`, which would turn a
 * legal range such as `de-*` into a `RangeError` and a legal range such as `sgn-nsl` into a
 * different range entirely.
 *
 * @param {unknown} value one caller-supplied `LanguageRange`
 * @returns {WeightedLanguageRange}
 */
function languageRangeFrom(value) {
	if (typeof value !== "object" || value === null)
		throw new RangeError("A language range must be an object with a 'range' and a 'weight'");

	const candidate = /** @type {{ range?: unknown, weight?: unknown }} */ (value);

	if (typeof candidate.range !== "string")
		throw new RangeError("A language range must carry a string 'range'");

	const weight = candidate.weight === undefined ? MAXIMUM_WEIGHT : candidate.weight;

	if (typeof weight !== "number" || Number.isNaN(weight) || weight < MINIMUM_WEIGHT || weight > MAXIMUM_WEIGHT)
		throw new RangeError(`weight=${String(weight)} for language range "${candidate.range}". ` +
			"It must be between 0.0 and 1.0.");

	const range = candidate.range.toLowerCase();
	const subtags = range.split("-");
	let illFormed = isSubtagIllFormed(subtags[0] ?? "", true);

	if (!illFormed)
		for (let index = 1; index < subtags.length; ++index)
			if (isSubtagIllFormed(subtags[index] ?? "", false)) {
				illFormed = true;
				break;
			}

	if (range.endsWith("-")) illFormed = true;
	if (illFormed) throw new RangeError(`range=${range}`);

	return { range, weight };
}

/**
 * @param {LocaleConfiguration} configuration
 * @returns {{ fallbackLocale: string, supportedLocales: string[], tiebreakers: LocaleConfiguration["tiebreakers"] }}
 */
function applicableConfiguration(configuration) {
	if (typeof configuration !== "object" || configuration === null)
		throw new RangeError("A locale configuration is required");

	const supportedLocales = [...configuration.supportedLocales].map((tag) => normalizeTag(tag));
	const fallbackLocale = normalizeTag(configuration.fallbackLocale);

	// Not a stylistic guard. Every `matchFor*` reports `fallbackLocale` in its result and every
	// `bestMatchFor*` RETURNS it, so a fallback that names no supported catalog would hand callers a
	// locale nothing can serve — the same configuration mistake `createStrings` refuses at
	// construction, arriving through the other door.
	if (!supportedLocales.includes(fallbackLocale))
		throw new RangeError(
			`Fallback locale '${fallbackLocale}' is not one of the supported locales ` +
				`[${supportedLocales.join(", ")}]. Pass the configuration a Strings instance reports ` +
				"from getLocaleConfiguration(), whose fallback is already resolved to a loaded catalog.",
		);

	return { fallbackLocale, supportedLocales, tiebreakers: configuration.tiebreakers };
}

/**
 * A matcher over one applicable locale configuration.
 *
 * Every `matchFor*` is STRICT: no acceptable candidate reports an unmatched result rather than
 * fabricating a configured-fallback match. Every `bestMatchFor*` returns the selection or, when
 * there is none, the configured fallback — the fabrication happens there and only there.
 *
 * @param {LocaleConfiguration} configuration
 */
export function createLocaleNegotiator(configuration) {
	const { fallbackLocale, supportedLocales, tiebreakers } = applicableConfiguration(configuration);

	/**
	 * `DefaultStrings#matchFor(List<LanguageRange>)`, over any number of members.
	 *
	 * @param {Iterable<unknown>} ranges
	 * @returns {import("../internal/locale.js").LocaleMatch}
	 */
	const matchForLanguageRanges = (ranges) => {
		if (ranges == null || typeof (/** @type {any} */ (ranges)[Symbol.iterator]) !== "function")
			throw new RangeError("A list of language ranges is required");

		const members = [...ranges].map((value) => languageRangeFrom(value));

		if (members.length > MAXIMUM_LANGUAGE_RANGES)
			throw new RangeError(
				`At most ${MAXIMUM_LANGUAGE_RANGES} language ranges are supported, but received ${members.length}`,
			);

		// THE EMPTY LIST IS AN ANSWER, not a refusal, and it stops being an A3 deferral here:
		// `DefaultStrings:1557` short-circuits an empty list to `noLocaleMatch` BEFORE it looks at a
		// single locale, which is why `browser-chooser.shape.empty-range-list-yields-no-match` records
		// NONE while still reporting every supported locale in `consideredLocales`. The solver owns that
		// short-circuit; this door does not second-guess it.
		return matchForRanges(members, supportedLocales, fallbackLocale, tiebreakers, pinnedRangeEquivalents);
	};

	return Object.freeze({
		/**
		 * The NORMALIZING ingress, unchanged and deliberately separate: a locale is a locale, and
		 * Java builds its range from `toLanguageTag()`.
		 *
		 * @param {string} locale
		 */
		matchFor: (locale) => matchFor(locale, supportedLocales, fallbackLocale, tiebreakers),
		/** @param {string} locale */
		bestMatchFor: (locale) => matchFor(locale, supportedLocales, fallbackLocale, tiebreakers).locale
			?? fallbackLocale,
		matchForLanguageRanges,
		/** @param {Iterable<unknown>} ranges */
		bestMatchForLanguageRanges: (ranges) => matchForLanguageRanges(ranges).locale ?? fallbackLocale,
	});
}
