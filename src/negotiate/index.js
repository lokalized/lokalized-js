// @ts-check

/**
 * lokalized/negotiate — RFC 4647, the pinned IANA language table, header helpers.
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
 * the serving cascade all live in `matchForRanges`. A4 adds the third door above them: the HEADER
 * parser (`parseLanguageRanges` — lokalized-java's `LocaleMatcher#parseLanguageRanges`, which is
 * `sun.util.locale.LocaleMatcher:440`'s grammar over the pinned IANA registry) and the fail-soft
 * `bestMatchForAcceptLanguage` over it. So this module now has three ingresses and they
 * are deliberately NOT interchangeable — the locale one normalizes, the list one is strict about
 * shape and count, and the header one refuses nothing and answers the fallback instead.
 *
 * THE CORPUS CANNOT VERIFY ALL OF A4. No fixture loads a `-DE`/`-FX`/`-BU`/`-TL`/`-YD`/`-CD`/
 * `-heploc` catalog and no case supplies such a range, so dropping the region/variant substitutions
 * leaves every recorded row green while a real `de-DE` silently loses its `de-dd` member. Two
 * instruments cover what the corpus cannot, and they answer different questions:
 *
 *  - `test/iana-model-parity.test.js`, in `npm test` and CI with NO JDK, holds `parseLanguageRanges`
 *    to lokalized-spec's `tools/iana-oracle/model.mjs` over the exact probe space the spec's JDK check
 *    ran — the model being what the spec's `npm run check:iana` holds lokalized-java's public parse to;
 *  - `tools/language-range-diff/` (`npm run diff:language-range`, the pinned JDK) runs lokalized-java
 *    3.1.0's own `LocaleMatcher#parseLanguageRanges` and compares directly, counting beside it where
 *    the JDK's `LanguageRange.parse` answers differently. It is NOT part of `npm run verify` — `verify`
 *    must run in a checkout with no pinned Corretto 21 — so its result is recorded by `npm run
 *    diff:all` and re-checked, JDK-free, by `npm run diff:check`.
 */

import { decodeLanguageEquivalents } from "../data/iana-range-equivalents.js";
import { refuseUnknownOptions } from "../internal/configuration-error.js";
import { languageRangeExpansions, matchFor, matchForRanges, normalizeTag } from "../internal/locale.js";
import { RUNTIME_METADATA } from "../internal/runtime-metadata.js";
import {
	LOCALE_INGRESS_DESCRIPTION,
	requireJdkWellFormedLocale,
} from "../internal/locale-jdk-tag.js";

/**
 * The full IANA language table: 781 subtags in 369 ordered classes, generated from the pinned IANA
 * Language Subtag Registry (amendment A30; lokalized-spec `generated/iana-language-equivalences.json`,
 * encoded by `tools/gen-iana-data.js`). Each member maps to the OTHER members of its class, in class
 * order — lokalized-java's `IanaLanguageEquivalents.LANGUAGE_EQUIVALENTS`, compared with it key by key
 * by lokalized-spec's `npm run check:iana`.
 *
 * It is loaded HERE and nowhere else: plan 3.1 keeps the whole-list negotiator's tables out of the
 * root graph, and `test/pinned-data-only.test.js` names this module so a future import into
 * `src/index.js` fails a test rather than a byte ratchet. The root carries the direct-match
 * projection instead (`src/data/iana-identity-equivalents.js`), along with the region/variant
 * substitutions both doors share.
 */
const LANGUAGE_EQUIVALENTS = /* @__PURE__ */ decodeLanguageEquivalents();

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
 * `java.util.Locale.LanguageRange`'s constructor grammar check, on an ALREADY-LOWERCASED range.
 *
 * Shared by the two doors deliberately. `parseLanguageRanges` reaches it through `new
 * LanguageRange(r, w)` inside `parse`, and `languageRangeFrom` reaches it through the object the
 * caller wrote. One copy each would let the header door drift from the object door — and the header
 * door is the one whose refusals the corpus records verbatim, so the drift would be invisible on the
 * side that is checked.
 *
 * **A RANGE MADE ONLY OF HYPHENS IS NOT REFUSED BY THE GRAMMAR AT ALL — on the pinned JDK 21.**
 * The constructor splits with `String#split("-")`, which drops TRAILING empty strings, so `-` and
 * `---` split to NO subtags and `subtags[0]` throws `ArrayIndexOutOfBoundsException` ("Index 0 out of
 * bounds for length 0") before any grammar rule runs. lokalized-java 3.1.0's `parseLanguageRanges`
 * javadoc records the same, and that JDK 25-27's constructor throws `IllegalArgumentException`
 * instead; this port models JDK 21, as the corpus and every differential here do. It answered
 * `range=-` until A30, and nothing could see it: no corpus case carries such a range and the old
 * differential never probed one. lokalized-spec's `tools/iana-oracle/model.mjs` states Java's answer,
 * the spec's JDK check measured lokalized-java giving it, and `test/iana-model-parity.test.js` found
 * this door disagreeing on exactly those two probes. Same JS class as every other refusal here
 * (`RangeError`, which the fail-soft door already treats as Java's `IndexOutOfBoundsException` arm),
 * Java's message.
 *
 * @param {string} range lowercased
 * @returns {void}
 * @throws {RangeError} `IllegalArgumentException("range=" + range)`, or Java's
 *   `ArrayIndexOutOfBoundsException` message for a range of hyphens only
 */
function checkLanguageRangeGrammar(range) {
	const subtags = range.split("-");
	if (range.length > 0 && subtags.every((subtag) => subtag === ""))
		throw new RangeError("Index 0 out of bounds for length 0");

	let illFormed = isSubtagIllFormed(subtags[0] ?? "", true);

	if (!illFormed)
		for (let index = 1; index < subtags.length; ++index)
			if (isSubtagIllFormed(subtags[index] ?? "", false)) {
				illFormed = true;
				break;
			}

	if (range.endsWith("-")) illFormed = true;
	if (illFormed) throw new RangeError(`range=${range}`);
}

/**
 * `java.lang.String#split(",")`.
 *
 * TRAILING EMPTY STRINGS ARE DROPPED and interior ones are not, which is the whole reason this is a
 * named function: `"fr,"` is one member, `",fr"` is two, `",,,"` is NONE, and `""` is one empty
 * member. `"".split(",")` in JavaScript agrees only on the last of those. `browser-chooser.malformed.
 * blank-header` and `.empty-list-element` both record `range=` — the empty INTERIOR member reaching
 * the grammar — so a splitter that dropped interior empties would turn two recorded refusals into
 * answers.
 *
 * @param {string} text
 * @returns {string[]}
 */
function javaSplitOnComma(text) {
	if (!text.includes(",")) return [text];

	const parts = text.split(",");
	let end = parts.length;

	while (end > 0 && parts[end - 1] === "") --end;

	return parts.slice(0, end);
}

/** `java.lang.String#trim` — every code unit at or below U+0020, not Unicode whitespace. */
const javaTrim = (/** @type {string} */ text) => {
	let start = 0;
	let end = text.length;

	while (start < end && text.charCodeAt(start) <= 0x20) ++start;
	while (end > start && text.charCodeAt(end - 1) <= 0x20) --end;

	return text.slice(start, end);
};

/**
 * `java.lang.Double#parseDouble`'s accepted grammar, which is NOT `Number(text)`.
 *
 * The two disagree in both directions and each direction is a wrong answer here: JavaScript reads
 * `""` as 0, `"0x10"` as 16 and `" 1 "` as 1, where Java throws — a throw the corpus records as
 * `weight="…" for language range "…"`; and Java reads `"1d"`, `"1f"` and hexadecimal-float `"0x1p3"`
 * where JavaScript gives NaN. Returning `null` here is "Java would have thrown".
 *
 * NaN AND INFINITY ARE ACCEPTED BY THIS FUNCTION AND UNREACHABLE THROUGH `parse`, which is a
 * distinction worth stating because getting it backwards writes a wrong comment either way.
 * `Double.parseDouble("NaN")` does succeed, and `parse`'s range check is `w < MIN || w > MAX`, both
 * false for NaN — so a NaN weight would be a legal member. But `parse` LOWERCASES the whole header
 * first, and `Double.parseDouble("nan")` throws: `NaN` and `Infinity` are the only two spellings in
 * the grammar that are case-sensitive, so `fr;q=NaN` reports `weight="nan" for language range "fr"`.
 * Measured both ways on the pinned Corretto 21 and covered by `tools/language-range-diff/`, which
 * probes all three spellings. This function still models `parseDouble` rather than the reachable
 * subset, because it is `parseDouble` that the port owes.
 *
 * @param {string} text
 * @returns {number | null} null where `Double.parseDouble` throws
 */
function javaParseDouble(text) {
	const trimmed = javaTrim(text);
	// The `[fFdD]` suffix belongs to the NUMERICAL value only, not to `NaN` or `Infinity`: measured on
	// the pinned JDK, `Double.parseDouble("NaNd")` and `("Infinityf")` both throw while `("0x1p3f")`
	// is 8.0. Written with the suffix outside the group, both of the first two would be accepted.
	const match = /^([+-]?)(?:(NaN|Infinity)|((?:0[xX](?:[0-9a-fA-F]+\.?|[0-9a-fA-F]*\.[0-9a-fA-F]+)[pP][+-]?[0-9]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)[fFdD]?))$/
		.exec(trimmed);

	if (match === null) return null;

	const sign = match[1] === "-" ? -1 : 1;

	if (match[2] === "NaN") return Number.NaN;
	if (match[2] === "Infinity") return sign * Number.POSITIVE_INFINITY;

	// The trailing `f`/`F`/`d`/`D` is a Java type suffix and carries no value; strip it before either
	// branch reads digits.
	const body = /** @type {string} */ (match[3]).replace(/[fFdD]$/, "");

	// A hexadecimal-float literal is not something `Number()` reads; JavaScript's own numeric literal
	// grammar has no `p` exponent. Assembled by hand, exactly as `Double.parseDouble` defines it.
	if (body[1] === "x" || body[1] === "X") {
		const [mantissa, exponent] = body.slice(2).split(/[pP]/);
		const [whole, fraction = ""] = /** @type {string} */ (mantissa).split(".");
		const digits = /** @type {string} */ (whole) + fraction;
		const value = digits.length === 0 ? 0 : Number.parseInt(digits, 16);
		return sign * value * 2 ** (Number(exponent) - 4 * fraction.length);
	}

	return sign * Number(body);
}

/**
 * `java.lang.Double#toString`, for the one place a weight reaches a message.
 *
 * `browser-chooser.malformed.weight-above-one` records `weight=1.5 …`, which JavaScript spells the
 * same way — but `q=2` records `weight=2.0` where JavaScript says `2`, and `q=1e10` records
 * `weight=1.0E10` where JavaScript says `10000000000`. Java switches to scientific notation outside
 * [10⁻³, 10⁷) and always keeps a digit after the point; JavaScript switches outside [10⁻⁶, 10²¹) and
 * keeps none. Both shortest-round-trip the value, so only the shape has to be translated.
 *
 * @param {number} value
 * @returns {string}
 */
function javaDoubleText(value) {
	if (Number.isNaN(value)) return "NaN";
	if (value === Number.POSITIVE_INFINITY) return "Infinity";
	if (value === Number.NEGATIVE_INFINITY) return "-Infinity";

	const negative = value < 0 || Object.is(value, -0);
	const magnitude = Math.abs(value);
	let text;

	if (magnitude === 0) text = "0.0";
	else if (magnitude >= 1e-3 && magnitude < 1e7) {
		text = String(magnitude);
		if (!text.includes(".")) text += ".0";
	} else {
		const [mantissa, exponent] = magnitude.toExponential().split("e");
		text = `${/** @type {string} */ (mantissa).includes(".") ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
	}

	return negative ? `-${text}` : text;
}

/**
 * lokalized-java 3.1.0's `LocaleMatcher#parseLanguageRanges(String)` on its default
 * `LanguageRangeEquivalents.IANA_REGISTRY` setting — which is `java.util.Locale.LanguageRange#parse`
 * (`sun.util.locale.LocaleMatcher:440`) with ONE substitution: the language equivalences come from the
 * pinned IANA registry instead of the running JDK's table.
 *
 * **THAT IS AMENDMENT A30, AND IT IS A DELIBERATE CHANGE.** Until 1.0.0-rc.1 this door modelled the
 * JDK's own `LanguageRange.parse`, which on JDK 21 lacks twelve registry tags (`bh`, `bih`, `dyl`,
 * `enm`, `mgp`, `mrd`, `mrh`, `sgn-dyl`, `sgn-zhk`, `shl`, `yol`, `zhk`), while the header door and the
 * identity channel already used the registry. There is one parse now: `parseLanguageRanges("yol")` is
 * `[yol, enm]`, as Java's public parse answers on every JDK. The JavaScript package has no JDK setting
 * — a "JDK" table could only ever mean JDK 21's, frozen — so this is the whole of it. The spec's
 * `tools/iana-oracle/model.mjs` states the same algorithm and `test/iana-model-parity.test.js` holds
 * this function to it over the spec's probe space, with no JDK.
 *
 * This is the whole reason `lokalized/negotiate` exists as a separate subpath: it is the door an
 * `Accept-Language` field value comes through, and it drags the full IANA language table in with it.
 * `DefaultStrings#addParsedLanguageRangeIdentities` calls the same parse, so the table and the
 * region/variant substitutions reach MEMBER IDENTITIES too, not only headers.
 *
 * Five details are each a recorded case, and each is the kind that reads as a detail until it moves
 * an answer:
 *
 * 1. THE SPACE STRIP IS GLOBAL, not a per-member trim. `"not a header!"` becomes `notaheader!` and
 *    is refused as `range=notaheader!` — one member, not three — and `"de;q=0.8,\tfr;q=0.9"` keeps
 *    its TAB, because a tab is not a space, and is refused as `range=\tfr`. Both messages are
 *    recorded verbatim. A per-member trim answers both instead of refusing them.
 * 2. THE DEDUP KEY IS THE RANGE STRING and the FIRST occurrence wins the whole equivalence class.
 *    `iw;q=0.9,he;q=0.4` is `[iw@0.9, he@0.9]` — `he` arrives as `iw`'s IANA equivalent at `iw`'s
 *    weight, and the later explicit `he;q=0.4` is dropped by `tempList` — while `he;q=0.4,iw;q=0.9`
 *    is `[he@0.4, iw@0.4]`. Neither a group-maximum nor a last-wins rule produces either.
 * 3. THE SORT IS A STABLE INSERTION at the first strictly-lower weight, over the members placed SO
 *    FAR. Equal weights keep list order, which is what four `browser-chooser.shape.*` rows pin.
 * 4. EQUIVALENTS GO IN AT `index + 1`, so a class lands directly after its representative and in
 *    reverse of the map's own order. The `sgn-BE-FR` -> `[sgn-be-fr, sgn-sfb, sfb, sgn-be-fx]` order
 *    is not incidental; `requestedLanguageRanges` is compared field for field.
 * 5. THE WEIGHT CHECK RUNS BEFORE THE GRAMMAR CHECK, so `fr;q=1.5` reports the weight and never
 *    reaches `range=`, and a NON-NUMERIC weight has its own wording with the raw text QUOTED.
 *
 * FROZEN ON THE WAY OUT, members included. Plan 3.4:900 declares this door
 * `readonly LanguageRange[]` where `LanguageRange` is `Readonly<{ range, weight }>`, and plan :345
 * makes every returned array frozen; the port returned a plain array of plain objects, so a caller
 * could `sort` or `push` the list the library handed them. The freeze is at the RETURN rather than
 * per member, because `list` is built by `splice` — the insertion position IS the contract here
 * (member order is compared field for field) and a frozen array cannot be spliced into.
 *
 * @param {string} header an `Accept-Language` field value, or a single language range
 * @returns {readonly WeightedLanguageRange[]} the parsed members, in the order the grammar above
 *   defines
 * @throws {RangeError} `IllegalArgumentException`, with Java's message
 */
export function parseLanguageRanges(header) {
	if (typeof header !== "string") throw new RangeError("An Accept-Language header must be a string");

	let ranges = header.replaceAll(" ", "").toLowerCase();

	if (ranges.startsWith("accept-language:")) ranges = ranges.slice(16);

	/** @type {WeightedLanguageRange[]} */
	const list = [];
	/** @type {Set<string>} */
	const seen = new Set();

	for (const member of javaSplitOnComma(ranges)) {
		const weightIndex = member.indexOf(";q=");
		let range = member;
		let weight = MAXIMUM_WEIGHT;

		if (weightIndex !== -1) {
			range = member.slice(0, weightIndex);
			const text = member.slice(weightIndex + 3);
			const parsed = javaParseDouble(text);

			if (parsed === null)
				throw new RangeError(`weight="${text}" for language range "${range}"`);

			weight = parsed;

			if (weight < MINIMUM_WEIGHT || weight > MAXIMUM_WEIGHT)
				throw new RangeError(
					`weight=${javaDoubleText(weight)} for language range "${range}". ` +
						`It must be between ${javaDoubleText(MINIMUM_WEIGHT)} and ${javaDoubleText(MAXIMUM_WEIGHT)}.`,
				);
		}

		if (seen.has(range)) continue;

		checkLanguageRangeGrammar(range);

		let index = list.length;

		for (let position = 0; position < list.length; ++position)
			if (/** @type {WeightedLanguageRange} */ (list[position]).weight < weight) {
				index = position;
				break;
			}

		list.splice(index, 0, { range, weight });
		seen.add(range);

		/** @param {string} equivalent */
		const insert = (equivalent) => {
			if (seen.has(equivalent)) return;
			list.splice(index + 1, 0, { range: equivalent, weight });
			seen.add(equivalent);
		};

		for (const equivalent of languageRangeExpansions(range, LANGUAGE_EQUIVALENTS)) insert(equivalent);
	}

	for (const member of list) Object.freeze(member);

	return Object.freeze(list);
}

/**
 * `DefaultStrings#addParsedLanguageRangeIdentities`, whose body is lokalized-java's own parse of the
 * range on the instance's `LanguageRangeEquivalents` setting (`IanaLanguageEquivalents.parse` by
 * default) inside a catch that keeps whatever identities the other probes found.
 *
 * SHIPPED IN M7 A4, AND THIS IS A CHANGE OF POSITION worth stating: an earlier revision of this
 * module implemented the resolver as a bare prefix substitution over the pinned artifact and
 * recorded the region/variant map as a KNOWN GAP, on the reading that M7-PLAN.md A4 assigned that
 * map to the header parser alone. The measurement said otherwise — Java reaches this map through
 * `parse`, and `addParsedLanguageRangeIdentities` IS `parse` — so the resolver now runs the whole
 * parser: `de-DE` gains the identity `de-dd`, `en-MM` gains `en-bu`, `ja-heploc` gains `ja-alalc97`.
 *
 * WHAT THAT CHANGES, MEASURED, AND IT IS LESS THAN THE PLAN IMPLIES. No corpus row moves — that much
 * the plan predicts, and it is why `tools/language-range-diff/` exists. But no HAND-BUILT selection
 * moved either: probing all seven pairs in both directions, against catalogs spelled with each half,
 * the port selects the same locale with the same `matchType` whether the map is present or ablated.
 * The reason is structural rather than lucky — `applicableConfiguration` normalizes every supported
 * tag, and CLDR's own region aliases already fold `-DD`/`-BU`/`-TP`/`-YD`/`-ZR`/`-FX` onto their
 * modern spellings, so both halves of a pair name the same catalog before a range is ever matched.
 * The reverse direction is therefore unreachable through this door. It is shipped because it is what
 * `parse` DOES and the identity set also feeds `semanticLanguageRangeForDerivedMatching`, not because
 * a selection was seen to change; claiming the latter would be the over-claim this file has already
 * had to correct once. The differential, not a selection probe, is what checks it.
 *
 * THE DATA IS NO LONGER PROBED, and the history is worth one paragraph because the shape recurs.
 * Before A30 the table here was an 806-then-818-entry closure recorded by probing an implementation,
 * and it went a milestone missing four keys of the JDK's own map (`cmn-hans`, `cmn-hant`, `lv-lvs`,
 * `lv-ltg`) because the probe space was seeded from the wrong implementation's keys: `cmn-hans`
 * fell through to `cmn` and gained a member too many, `lv-lvs` found nothing and lost one. The
 * table is now GENERATED from the registry by stated rules, so a gap in a probe space can no longer
 * become a gap in the data — only in a check, and the spec's probe space is seeded from the
 * artifact's, the library's and the JDK's keys together (`tools/iana-oracle/candidates.mjs`).
 *
 * @type {import("../internal/locale.js").RangeEquivalentResolver}
 */
function pinnedRangeEquivalents(range) {
	try {
		return parseLanguageRanges(range).map((member) => member.range);
	} catch (error) {
		// Java's own catch, and it is not a swallow: the caller has already recorded the range itself
		// as an identity, so "the JDK could not re-expand this form" leaves exactly what Java leaves.
		// Narrowed to the refusal this parser raises, so a genuine defect still travels out.
		if (error instanceof RangeError) return null;
		throw error;
	}
}

/** @typedef {import("../internal/locale.js").WeightedLanguageRange} WeightedLanguageRange */

/**
 * The applicable locale configuration a negotiator matches against — the exact shape
 * `strings.getLocaleConfiguration()` returns.
 *
 * `fallbackLocale` is taken as ALREADY RESOLVED to a loaded catalog, which is what that method
 * yields (`DefaultStrings.java:446-470`, ported in `createStrings`). A hand-built configuration must
 * therefore name a locale it also supports, and is refused below when it does not, rather than
 * silently negotiating against a fallback no catalog answers to.
 *
 * **THE THREE MEMBERS ARE `readonly`, AND THIS COPY WAS THE ONE THAT WAS NOT.** The registry states
 * it three times (BOOT-M0-0296 through BOOT-M0-0298) and `lokalized/core` already declared its own
 * copy wrapped. Measured by `tools/readonly-surface.mjs` on its first run: the SAME public name was
 * readonly through `lokalized/core` and writable through `lokalized/negotiate`, so which subpath a
 * consumer imported from decided whether their editor stopped them. That is S28's asymmetry, and it
 * is exactly why that tool probes every subpath a name is published on rather than the first one.
 *
 * The SHAPE still differs from core's deliberately and is left alone: here `tiebreakers` is optional
 * and may be a `ReadonlyMap`, because `createLocaleNegotiator({ fallbackLocale, supportedLocales })`
 * with no tiebreakers at all is the ordinary call. Narrowing it to core's required-record form to
 * make the two identical would refuse that call, which is a real consumer pattern and one the
 * declaration probes themselves use.
 *
 * @typedef {Readonly<{
 *   fallbackLocale: string,
 *   supportedLocales: readonly string[],
 *   tiebreakers?: Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]>,
 * }>} LocaleConfiguration
 */

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
 * Two things this door inherited from A2, one now closed and one deliberately still open. (a) A
 * NON-NUMERIC weight has its own Java wording — `weight="abc" for language range "fr"`, quoted and
 * with no trailing sentence, recorded at `browser-chooser.malformed.nonnumeric-weight`. That is a
 * HEADER refusal and A4 answers it in `parseLanguageRanges`, where the raw text still exists; by the
 * time a weight reaches this door it is already a JS value, and `"abc"` arrives as a non-number
 * rather than as text to quote, so the two doors are not in fact saying different things about the
 * same input. (b) Java's CONSTRUCTOR accepts `Double.NaN` (`new Locale.LanguageRange("en",
 * Double.NaN)` is `en;q=NaN`) where this refuses it. THE HEADER DOOR CANNOT REACH THAT STATE and
 * this door can, which is the opposite of what an earlier draft of this note said: `parse`
 * lowercases before parsing the weight, and `Double.parseDouble("nan")` throws, so no header
 * produces a NaN-weighted member. Only the JS object literal does. The refusal here stands as a
 * recorded divergence from the Java CONSTRUCTOR rather than being relaxed to match it, because
 * admitting `{ range: "fr", weight: NaN }` would put a value into the solver against which every
 * weight comparison silently answers false — a whole class of quiet wrong answers, in exchange for
 * parity on a state Java itself only reaches programmatically.
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

	// **A RANGE TAKES TWO MEMBERS AND REFUSES A THIRD** — the maintainer's decision of 2026-09-23.
	// An absent `weight` means the maximum, so a MISSPELLED one did too: `{ range: "fr", wieght: 0 }`
	// beside `{ range: "en", weight: 0.5 }` selected French, from a list written to exclude it. A
	// `RangeError` like this function's other shape refusals, so a caller already catching those for a
	// strict list catches this too. Everything the library hands out — `parseLanguageRanges`' members,
	// a match's `requestedLanguageRanges` — carries exactly these two, and the fail-soft header door
	// only ever passes those, so it cannot reach this refusal.
	const extra = Object.keys(value).filter((name) => name !== "range" && name !== "weight");
	if (extra.length > 0)
		throw new RangeError(
			`A language range takes only 'range' and 'weight', and this one also has [${extra.join(", ")}]`);

	const candidate = /** @type {{ range?: unknown, weight?: unknown }} */ (value);

	if (typeof candidate.range !== "string")
		throw new RangeError("A language range must carry a string 'range'");

	const weight = candidate.weight === undefined ? MAXIMUM_WEIGHT : candidate.weight;

	// `javaDoubleText`, NOT `String(weight)`, and the difference is two shapes rather than one.
	// Java renders the offending weight with `Double.toString`, so an integral value carries its
	// `.0` and a large one uses the `E` form: `weight=2.0`, `weight=-1.0`, `weight=1.0E21`. JS spells
	// those `2`, `-1` and `1e+21` — the last differing in the mantissa AND the exponent marker, so a
	// repair that merely appended `.0` to integral values would still be wrong. The HEADER door six
	// hundred lines up (`:524`) has always used `javaDoubleText` for exactly this rendering; this
	// door did not, so the two spelled the same sentence differently.
	//
	// MEASURED on the pinned JDK 2026-09-15, both doors against `Locale.LanguageRange.parse`:
	//   java  weight=2.0 for language range "fr". It must be between 0.0 and 1.0.
	//   port  weight=2   for language range "fr". It must be between 0.0 and 1.0.   (this door)
	// The header door was already byte-identical to Java. Found by opening the CONSTRUCTOR arm of
	// `diff:language-range`, which the oracle had never emitted and the runner had never compared —
	// an EMIT-side blind spot, invisible to the recording proxy and to any column count.
	if (typeof weight !== "number" || Number.isNaN(weight) || weight < MINIMUM_WEIGHT || weight > MAXIMUM_WEIGHT)
		throw new RangeError(
			// A NON-NUMBER cannot reach Java at all — its parameter is a `double` — so that arm is the
			// port's own guard and keeps its own rendering. Only the numeric arm has an oracle to match.
			`weight=${typeof weight === "number" ? javaDoubleText(weight) : String(weight)} ` +
			`for language range "${candidate.range}". ` +
			`It must be between ${javaDoubleText(MINIMUM_WEIGHT)} and ${javaDoubleText(MAXIMUM_WEIGHT)}.`);

	const range = candidate.range.toLowerCase();
	checkLanguageRangeGrammar(range);

	return { range, weight };
}

/**
 * The members a `LocaleConfiguration` has. A SECOND COPY of core's, deliberately: this module must not
 * import core (see `forLanguageRanges` below), and `test/option-surface.test.js` holds both copies to
 * every real `LocaleConfiguration` the library produces, so they cannot drift apart unnoticed.
 */
const LOCALE_CONFIGURATION_MEMBERS = Object.freeze(["fallbackLocale", "supportedLocales", "tiebreakers"]);

/**
 * @param {LocaleConfiguration} configuration
 * @returns {{ fallbackLocale: string, supportedLocales: string[], tiebreakers: LocaleConfiguration["tiebreakers"] }}
 */
function applicableConfiguration(configuration) {
	if (typeof configuration !== "object" || configuration === null)
		throw new RangeError("A locale configuration is required");

	// A DOOR THE M-D S33 DECISION COVERS AND ITS SWEEP MISSED, because that sweep's door list was
	// written by hand. `createLocaleNegotiator({ supportedLocales, fallbackLocale, fallbackLocal: "fr" })`
	// constructed silently and negotiated against `fallbackLocale` — the typo did nothing and said
	// nothing. Every source of a `LocaleConfiguration` this library has —
	// `strings.getLocaleConfiguration()` on all three construction paths, and
	// `localeConfigurationForManifest` — hands back exactly these three members, measured, so the
	// documented `createLocaleNegotiator(strings.getLocaleConfiguration())` cannot be refused by it.
	refuseUnknownOptions("createLocaleNegotiator", configuration, LOCALE_CONFIGURATION_MEMBERS);

	// THE NEGOTIATOR'S CONSTRUCTION INGRESS, and it exists because of what a matcher RETURNS rather
	// than what it accepts. Every `matchFor*` result carries these tags as `consideredLocales` and
	// this one as `fallbackLocale`, and in Java those two fields are populated by handing exactly
	// these values to `new LocaleMatchResult(...)` (`DefaultStrings.java:1945/:1951`), whose `:117`
	// and `:101` are `LocaleUtils.requireWellFormed` — so an ill-formed member makes the JAVA
	// CONSTRUCTOR THROW. Java's own matcher can never reach that throw, because
	// `DefaultStrings.java:276` refuses an ill-formed catalog locale at construction; this port's
	// `LocaleConfiguration` is hand-buildable, so the same guarantee has to be stated here.
	//
	// MEASURED before this check existed: `createLocaleNegotiator({ fallbackLocale: "fr",
	// supportedLocales: ["fr", "en-x-lvariant-NY"] }).matchFor("fr").consideredLocales` answered
	// `["en-x-lvariant-NY", "fr"]` — a `LocaleMatch` VALUE JAVA'S TYPE SYSTEM CANNOT CONSTRUCT. The
	// descriptions are Java's for the fields these become, not invented: `Considered locale` and
	// `Fallback locale`. Refusing once at ingress rather than per result is Java's own arrangement —
	// validate the set at construction and the result constructor's checks become unreachable — and
	// keeps every `matchFor` off a per-call well-formedness scan.
	const supportedLocales = [...configuration.supportedLocales].map((tag) =>
		requireJdkWellFormedLocale(normalizeTag(tag), LOCALE_INGRESS_DESCRIPTION.consideredLocale));
	const fallbackLocale = requireJdkWellFormedLocale(
		normalizeTag(configuration.fallbackLocale), LOCALE_INGRESS_DESCRIPTION.fallbackLocale);

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
 * `LocaleMatcher:107` — the fail-soft length cap, in UTF-16 code units and applied BEFORE
 * normalization so parser work is bounded independently of the 32-range limit.
 *
 * The pair `accept-language.length.at-cap-four-thousand-ninety-six` /
 * `.over-cap-four-thousand-ninety-seven` is what pins it, and NEITHER ROW ALONE DISCRIMINATES:
 * the at-cap header answers `fr` and the over-cap one answers the fallback, and both are 4,000-odd
 * commas with `fr` at the end, so a cap off by one, a cap measured after normalization (which
 * deletes every one of those commas and leaves `fr`), or no cap at all each loses exactly one half.
 */
const MAXIMUM_ACCEPT_LANGUAGE_LENGTH = 4096;

/** `LocaleMatcher#isOptionalWhitespace` — RFC 9110 OWS is SPACE and HTAB, and nothing else. */
const isOptionalWhitespace = (/** @type {string} */ character) => character === " " || character === "\t";

/**
 * `LocaleMatcher#normalizeAcceptLanguage`, verbatim.
 *
 * It does two things `Locale.LanguageRange.parse` cannot: it drops EMPTY HTTP LIST ELEMENTS, which
 * `parse` refuses with `range=`, and it converts each member's surrounding HTAB to the SPACE
 * `parse`'s global strip knows how to delete. Interior tabs are converted too — `f\tr` becomes
 * `f r`, which the strip then closes up to `fr` — which is what
 * `accept-language.interior-tab.converted-to-space` records, and it is the row that says this is a
 * per-CHARACTER conversion rather than an edge trim.
 *
 * THE OWS SET IS EXACTLY TWO CHARACTERS and two recorded rows pin the boundary from outside: a
 * NEWLINE is not OWS, so `"\nfr"` survives normalization intact and `parse` then refuses `\nfr`
 * (`accept-language.ows-set.newline-is-not-ows` falls back), and a NO-BREAK SPACE is not OWS either
 * (`.no-break-space-is-not-ows`). A normalizer written against `\s` or against `Character.isWhitespace`
 * loses both, and answers `fr` where Java answers the fallback.
 *
 * @param {string} acceptLanguage
 * @returns {string}
 */
function normalizeAcceptLanguage(acceptLanguage) {
	let normalized = "";
	let memberStartIndex = 0;

	for (let index = 0; index <= acceptLanguage.length; ++index) {
		if (index < acceptLanguage.length && acceptLanguage[index] !== ",") continue;

		let firstContentIndex = memberStartIndex;

		while (firstContentIndex < index &&
			isOptionalWhitespace(/** @type {string} */ (acceptLanguage[firstContentIndex]))) ++firstContentIndex;

		let contentEndIndex = index;

		while (contentEndIndex > firstContentIndex &&
			isOptionalWhitespace(/** @type {string} */ (acceptLanguage[contentEndIndex - 1]))) --contentEndIndex;

		if (firstContentIndex < contentEndIndex) {
			if (normalized.length > 0) normalized += ",";

			for (let contentIndex = firstContentIndex; contentIndex < contentEndIndex; ++contentIndex) {
				const character = /** @type {string} */ (acceptLanguage[contentIndex]);
				normalized += character === "\t" ? " " : character;
			}
		}

		memberStartIndex = index + 1;
	}

	return normalized;
}

/**
 * The two allowlisted `negotiate` type names the port declared nowhere until M8.
 *
 * **BOTH ARE DERIVED FROM WHAT SHIPS.** `LocaleMatcher` is plan 3.5:883's two-method interface, taken
 * as a `Pick` of the negotiator this module actually returns rather than retyped — so a signature
 * change in the runtime moves the declared type with it instead of leaving the two to disagree.
 * `LanguageRange` is core's type re-exported, and plan 3.1:372 says so in as many words ("re-exports
 * core's `LanguageRange` type"): a second definition here would be a second thing to keep in step.
 *
 * @typedef {import("../core/index.js").LanguageRange} LanguageRange
 * @typedef {ReturnType<typeof createLocaleNegotiator>} LocaleNegotiator
 *   Plan 3.4:882's `interface LocaleNegotiator extends LocaleMatcher` — the whole object
 *   `createLocaleNegotiator` returns, where `LocaleMatcher` below is the two-method narrowing of it.
 *   DERIVED from the factory rather than restated, so a method added to one and not the other is
 *   impossible by construction; the allowlist has named it since M7 and `declared-surface.test.js`
 *   has carried it in OWED ever since.
 *

 * @typedef {Pick<ReturnType<typeof createLocaleNegotiator>, "matchFor" | "bestMatchFor">} LocaleMatcher
 */

/**
 * THE FAIL-SOFT GUARD CHAIN, EXTRACTED SO THERE IS EXACTLY ONE OF IT.
 *
 * Plan 3.4:929-932 gives `bestMatchForAcceptLanguage` and `forAcceptLanguage` the SAME five
 * refusals — "absent, blank, malformed, over-4,096-code-unit, or over-32-expanded-range input" —
 * and then makes them answer differently: the first returns the configured fallback TAG, the second
 * carries an unmatched DIAGNOSTIC. Two doors, one predicate. Writing the chain twice is how a pair
 * like that drifts, and this project has now paid for that shape at two loader doors (S10) and two
 * manifest doors (S19), so the predicate moved here whole and each door supplies only its answer.
 *
 * `null` means "nothing usable was supplied"; an empty array is impossible, because
 * `parseLanguageRanges` refuses an empty member rather than returning none.
 *
 * THE ORDER OF THE GUARDS IS OBSERVABLE and is Java's. The length cap applies to the RAW value,
 * before `trim` and before normalization: a 4,097-character header of commas normalizes to `fr` and
 * would answer `fr` if the cap ran later. And NOTHING IS EVER TRUNCATED — a 33-expanded-range header
 * is refused whole, which is why plan 3.4:931 says "preferences are never truncated" and why a
 * "keep the first 32" reading answers the corpus's 32-member sibling identically and this one wrongly.
 *
 * @param {string | null | undefined} acceptLanguage the raw, already-combined field value
 * @returns {readonly WeightedLanguageRange[] | null} the parsed members, or `null` for unusable
 *   input
 */
function usableAcceptLanguageRanges(acceptLanguage) {
	if (acceptLanguage == null ||
		typeof acceptLanguage !== "string" ||
		acceptLanguage.length > MAXIMUM_ACCEPT_LANGUAGE_LENGTH ||
		javaTrim(acceptLanguage) === "") return null;

	const normalized = normalizeAcceptLanguage(acceptLanguage);

	if (normalized === "") return null;

	/** @type {readonly WeightedLanguageRange[]} */
	let ranges;

	try {
		ranges = parseLanguageRanges(normalized);
	} catch (error) {
		// Java catches `IllegalArgumentException | IndexOutOfBoundsException` — the parser's own
		// refusals and nothing else. Narrowed to `RangeError` here for the same reason: a `TypeError`
		// out of this module is a defect, and a blanket catch would answer the fallback and look like
		// a recorded row passing.
		if (!(error instanceof RangeError)) throw error;
		return null;
	}

	return ranges.length > MAXIMUM_LANGUAGE_RANGES ? null : ranges;
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
	 * `LocaleUtils.requireWellFormed(locale, "Requested locale")` (`LocaleMatcher.java:64`).
	 *
	 * RETURNS THE CALLER'S OWN SPELLING, deliberately, and passing the normalized tag on instead
	 * would be a silent behaviour change rather than a tidy-up: `matchFor` normalizes its argument
	 * itself, so handing it `normalizeTag(locale)` would normalize TWICE, and the two disagree for
	 * one family — a non-lowercase `und` followed only by private use, where the second application
	 * drops the `und`. `tools/lookup-diff/run.mjs`'s `chainSeedOrNull` documents the same asymmetry
	 * from the other side. The CHECK still sees the tag once-normalized, because that is the
	 * `Locale` Java validates.
	 *
	 * @param {string} locale
	 * @returns {string} `locale`
	 */
	const requestedLocale = (locale) => {
		requireJdkWellFormedLocale(normalizeTag(locale), LOCALE_INGRESS_DESCRIPTION.requestedLocale);
		return locale;
	};

	/**
	 * `DefaultStrings#matchFor(List<LanguageRange>)`, over any number of members.
	 *
	 * **THE ELEMENT TYPE IS THE RANGE, NOT `unknown`** — BOOT-M0-0447. Typed `Iterable<unknown>` the
	 * declaration admitted `[1, 2, 3]`, so a caller learned at run time what the compiler could have
	 * told them. It stays an ITERABLE rather than becoming `readonly LanguageRange[]`, because the
	 * runtime spreads whatever it is handed and a `Set` is a legal argument; and `weight` is optional
	 * here where `LanguageRange` requires it, because `languageRangeFrom` below defaults an absent
	 * weight to the maximum. Narrowing to the published record would have refused `[{ range: "fr" }]`,
	 * which works today.
	 *
	 * @param {Iterable<Readonly<{ range: string, weight?: number }>>} ranges
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
		 * `LocaleMatcher.java:64` — `requireWellFormed(locale, "Requested locale")` — is the FIRST
		 * statement of the `matchFor(Locale)` default method, before the `LanguageRange` is built,
		 * and `bestMatchFor(Locale)` reaches it through `matchFor` (`DefaultStrings.java:1532`), so
		 * both doors carry it and neither is a wrapper around the other here. Measured on the pinned
		 * JDK: `matchFor(Locale.forLanguageTag("en-x-lvariant-NY"))` throws
		 * `Requested locale 'en__NY' is not a well-formed IETF BCP 47 locale` while
		 * `en-US-x-lvariant-POSIX`, `ja-JP-x-lvariant-JP` and `th-TH-x-lvariant-TH` all ANSWER — the
		 * three the corpus already keeps as controls against overcorrecting this at the tag layer.
		 *
		 * THE RANGE DOORS BELOW DO NOT GET THIS CHECK, and that is Java's line rather than an
		 * omission: `matchFor(List<LanguageRange>)` takes ranges, never a `Locale`, and validates
		 * only their count.
		 *
		 * @param {string} locale
		 */
		matchFor: (locale) =>
			matchFor(requestedLocale(locale), supportedLocales, fallbackLocale, tiebreakers),
		/** @param {string} locale */
		bestMatchFor: (locale) =>
			matchFor(requestedLocale(locale), supportedLocales, fallbackLocale, tiebreakers).locale
			?? fallbackLocale,
		matchForLanguageRanges,
		/** BOOT-M0-0449, the same element type as its sibling above.
		 * @param {Iterable<Readonly<{ range: string, weight?: number }>>} ranges */
		bestMatchForLanguageRanges: (ranges) => matchForLanguageRanges(ranges).locale ?? fallbackLocale,
		/**
		 * `LocaleMatcher#bestMatchForAcceptLanguage` (`:117-139`), the FAIL-SOFT request-handling door.
		 *
		 * Every unusable input answers the configured fallback rather than throwing: absent, over the
		 * length cap, blank, normalizing to nothing, unparseable, or parsing to more than 32 members.
		 * It is the mirror image of `matchForLanguageRanges`, which is strict about all of those, and
		 * THE CONTRADICTION IS THE POINT — the corpus records the same 13-member header
		 * (`he,id,yi,cmn,yue,nan,hak,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.1`, which the IANA table expands
		 * to 33) THROWING through `matchFor(List)` at `browser-chooser.limit.alias-expansion-crosses-
		 * thirty-two` and RETURNING `ja` here at `accept-language.limit.thirty-three-expanded-ranges`.
		 * A single shared limit rule cannot produce both. Its 32-member sibling
		 * (`.thirty-two-expanded-ranges`) is accepted WHOLE by both doors: nothing is ever truncated,
		 * so a "keep the first 32" reading answers that pair identically and this one wrongly.
		 *
		 * THE ORDER OF THE GUARDS IS OBSERVABLE. The length cap is applied to the RAW value, before
		 * `trim` and before normalization; a 4,097-character header of commas normalizes to `fr` and
		 * would answer `fr` if the cap ran later.
		 *
		 * @param {string | null | undefined} acceptLanguage the raw, already-combined field value
		 * @returns {string} the best-matching supported locale, or the configured fallback
		 */
		bestMatchForAcceptLanguage: (acceptLanguage) => {
			const ranges = usableAcceptLanguageRanges(acceptLanguage);

			// `bestMatchFor(List.of())` and `bestMatchFor(ranges)` are the same call in Java; the
			// helper's five refusals spell `List.of()`, because an empty list is exactly what
			// `noLocaleMatch` turns into `getFallbackLocale()` one line later.
			return matchForLanguageRanges(ranges ?? []).locale ?? fallbackLocale;
		},
	});
}

/**
 * PLAN 3.4:904-913's TWO OPTION HELPERS, and the sentence that explains why they exist at all is
 * about the module GRAPH rather than about convenience:
 *
 *   ":933 — `forLanguageRanges` and `forAcceptLanguage` negotiate immediately and return core
 *   `localeMatch` options, so the browser/root graph does not contain the whole-list solver."
 *
 * An application that wanted per-call whole-list negotiation without these would have to hand core a
 * MATCHER and let core call it — which puts this module, its full IANA language table and the range
 * solver into every graph that can render. Negotiating eagerly and handing core a plain
 * `localeMatch` keeps all of it on this side of the boundary. `test/pinned-data-only.test.js` names
 * `negotiate/index.js` among the modules the root graph may not reach, because a byte ratchet would
 * report the growth and not the reason.
 *
 * **NEITHER FUNCTION IMPORTS CORE**, and that is the same point one level down: `forLocaleMatch` in
 * `lokalized/core` builds exactly this object, and importing it would drag core's whole graph into
 * this much smaller subpath (`measurements/subpath-graphs.json` has both counts). The option shape is STRUCTURAL (plan 3.4:713 says so in as many words —
 * "a `Strings` value created by one installed copy … remains usable by `lokalized/ssr` from
 * another"), so constructing the literal here is the intended shape and not duplication to be
 * tidied away. `test/negotiate-options.test.js` asserts the two literals are `deepEqual`, and
 * `subpath:graphs` is what would notice the import.
 */

/**
 * Negotiate a whole list STRICTLY and return the per-call options core consumes.
 *
 * Strict means what it means everywhere else in this module: a list longer than 32 members, or one
 * holding a member `LanguageRange.parse` would refuse, throws `RangeError`. A caller that wants the
 * request-handling contract instead wants `forAcceptLanguage`.
 *
 * BOOT-M0-0457 asks for a `readonly LanguageRange[]` here; an `Iterable` of the same element
 * accepts one and keeps the `Set` a caller may already hold.
 *
 * @param {LocaleNegotiator} negotiator
 * @param {Iterable<Readonly<{ range: string, weight?: number }>>} ranges
 * @returns {Readonly<{ localeMatch: import("../internal/locale.js").LocaleMatch }>}
 */
export function forLanguageRanges(negotiator, ranges) {
	return Object.freeze({ localeMatch: negotiator.matchForLanguageRanges(ranges) });
}

/**
 * Negotiate an `Accept-Language` field value FAIL-SOFT and return the per-call options core consumes.
 *
 * **THE UNMATCHED ANSWER IS A DIAGNOSTIC, NOT A FABRICATED MATCH, and plan 3.4:929-932 is precise
 * about the difference.** Unusable input makes `bestMatchForAcceptLanguage` return the configured
 * fallback TAG; it makes this return an unmatched result whose "own `locale` remains null", which
 * core then consumes by using the configured fallback as the lookup locale. So the two doors agree
 * on which catalog answers and disagree — deliberately — on what the caller can see about why.
 * Handing back `{ locale: fallbackLocale, matchType: "exact" }` would be the fabrication this
 * module's every `matchFor*` exists to refuse, and it would tell a page that the visitor asked for
 * the language it is being served.
 *
 * The five refusals are `usableAcceptLanguageRanges`'s, shared verbatim with
 * `bestMatchForAcceptLanguage` rather than restated. An empty range list is what produces the
 * unmatched result: `matchForLanguageRanges([])` is Java's `matchFor(List.of())`, which is
 * `noLocaleMatch`. Nothing here truncates — a 33-expanded-range header is refused whole, and the
 * result's `requestedLanguageRanges` is EMPTY rather than the first 32.
 *
 * @param {LocaleNegotiator} negotiator
 * @param {string | null | undefined} acceptLanguage the raw, already-combined field value
 * @returns {Readonly<{ localeMatch: import("../internal/locale.js").LocaleMatch }>}
 */
export function forAcceptLanguage(negotiator, acceptLanguage) {
	return Object.freeze({
		localeMatch: negotiator.matchForLanguageRanges(usableAcceptLanguageRanges(acceptLanguage) ?? []),
	});
}

/**
 * PLAN 3.4:914-915's TWO IANA CONSTANTS, re-exported here because this is the subpath that owns the
 * table they describe.
 *
 * Plan 3.1's `negotiate` row promises a category in as many words — "re-exports core's
 * `LanguageRange` type and IANA metadata" — and S28's category gate recorded the metadata half as
 * UNDELIVERED with the reason "nothing to re-export, because core exports none". **That reason went
 * stale the day M8's final batch landed the seven build-identity constants on `core`**, and nothing
 * re-checked it: the staleness arm of that gate fires when a category gains a MEMBER, never when its
 * excuse stops being true. Twelfth text on this project found asserting something that had ceased to
 * hold. The entry is deleted with this export.
 *
 * THEY COME FROM `internal/runtime-metadata.js`, NOT FROM `core`, for the graph reason above: that
 * module has zero imports of its own, so this costs the subpath one leaf. Both values are therefore
 * the SAME constants core exports rather than a second copy, and `test/negotiate-options.test.js`
 * asserts the equality so a future divergence is a red test rather than two plausible strings.
 *
 * `ianaRegistryDate` is the pinned IANA registry snapshot's `File-Date`, a real `YYYY-MM-DD`. It
 * read `jdk-oracle:21.0.11` until that snapshot existed — A11 refused to invent a date for a snapshot
 * that did not — and M-R S11 pinned one, which is when it became a date.
 */
export const ianaRegistryDate = RUNTIME_METADATA.ianaRegistryDate;

/** @see {@link ianaRegistryDate} — the pinned IANA data's content fingerprint (plan 5.1 :1680-1682). */
export const ianaDataFingerprint = RUNTIME_METADATA.ianaDataFingerprint;
