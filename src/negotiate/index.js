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
 * the serving cascade all live in `matchForRanges`. A4 adds the third door above them: the HEADER
 * parser (`Locale.LanguageRange.parse`, ported from `sun.util.locale.LocaleMatcher:440`) and the
 * fail-soft `bestMatchForAcceptLanguage` over it. So this module now has three ingresses and they
 * are deliberately NOT interchangeable — the locale one normalizes, the list one is strict about
 * shape and count, and the header one refuses nothing and answers the fallback instead.
 *
 * THE CORPUS CANNOT VERIFY ALL OF A4. No fixture loads a `-DE`/`-FX`/`-BU`/`-TL`/`-YD`/`-CD`/
 * `-heploc` catalog and no case supplies such a range, so dropping the region/variant map leaves
 * every recorded row green while a real `de-DE` silently loses its `de-dd` member. That is what
 * `tools/language-range-diff/` exists for: it runs `Locale.LanguageRange.parse` on the pinned
 * Corretto 21 over every corpus header plus region and variant probes and requires byte equality.
 *
 * THAT DIFFERENTIAL EXITS 0, and knowing why is part of reading this module. It reports
 * `6037/6037 identical, 0 known divergence(s), 0 open port defect(s) over 0 probe(s), 0
 * unexplained`. It did not always: it used to report 24 diverging probes in four families —
 * `cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg` — each a key of the JDK's own equivalence map that
 * `lokalized-spec/tools/iana-oracle/candidates.mjs` never probed, so the pinned artifact did not
 * carry it. Those were defects in the DATA, not in this file, and they are closed where they were
 * caused: the candidate space is now seeded from the JDK's own equivalence keys, `build.mjs` asserts
 * that every one of the 769 produced a closure entry, and the re-pinned artifact carries 806
 * classes. Note also that `diff:language-range` is NOT part of `npm run verify` — `verify` must run
 * in a checkout with no pinned Corretto 21 — so a green `verify` still says nothing about it and it
 * has to be named separately.
 */

import { decode as decodeRangeEquivalents } from "../data/iana-range-equivalents.js";
import { matchFor, matchForRanges, normalizeTag } from "../internal/locale.js";

/**
 * The pinned IANA range-equivalence closure, 806 classes, probed out of the JDK oracle itself
 * (`lokalized-spec generated/IANA-PROVENANCE.md`). It is loaded HERE and nowhere else: plan 3.1 keeps
 * the whole-list negotiator's tables out of the root graph, and `test/pinned-data-only.test.js` names
 * this module so a future import into `src/index.js` fails a test rather than a byte ratchet.
 */
const RANGE_EQUIVALENTS = decodeRangeEquivalents();

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
 * @param {string} range lowercased
 * @returns {void}
 * @throws {RangeError} `IllegalArgumentException("range=" + range)`
 */
function checkLanguageRangeGrammar(range) {
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
}

/**
 * `sun.util.locale.LocaleEquivalentMaps.regionVariantEquivMap`, in the ORDER `getEquivalentForRegionAndVariant`
 * walks it. Two facts about this table are easy to get wrong and both are load-bearing.
 *
 * IT HAS FOURTEEN ENTRIES, not thirteen. `LocaleEquivalentMaps.java:815-828` writes fourteen `put`s
 * and sizes the map `HashMap.newHashMap(14)`; M7-PLAN.md A4 said "13-entry" and cited `815-827`,
 * which is the same off-by-one twice: the citation stops one line short of the file. The puts are in
 * ALPHABETICAL order, so the line the citation drops — `:828` — is `-zr` -> `-cd`, and that is
 * exactly the key missing from the plan's enumeration at M7-PLAN.md open question 6. `-zr` -> `-cd`
 * is the fourteenth, and `sgn-ZR` -> `sgn-zr sgn-cd` is a real answer on the pinned Corretto 21.
 *
 * An earlier draft of this comment named `-mm` -> `-bu` as the fourteenth. That was wrong in both
 * senses available: `-mm` is `:823`, the ninth put, and the plan's thirteen already list it. Recorded
 * because the mistake is this project's named one — a comment written from the intent of a
 * measurement rather than from the measurement — committed inside the comment that boasts of
 * measuring. Both readings were re-derived by reflecting on `regionVariantEquivMap` directly.
 *
 * THE ORDER IS THE HASH ORDER, NOT THE SOURCE ORDER. `getEquivalentForRegionAndVariant` iterates
 * `keySet()` and returns on the FIRST subtag that occurs in the range, so a range containing two of
 * these subtags — `sgn-de-fr` contains both `-de` and `-fr` — gets a different answer under a
 * different iteration order. Measured on the pinned Corretto 21 by loading the same fourteen keys
 * into a `HashMap.newHashMap(14)` in source order and printing `keySet()`; the JDK differential then
 * confirms it end to end on `sgn-de-fr` and its siblings, which is what makes this a measurement
 * rather than a reading of `String.hashCode`.
 *
 * DECIDED AT M7 CLOSE: THIS STAYS A SOURCE LITERAL. It is not promoted to a generated artifact
 * under a lock the way the 806-class IANA closure is, and the reasons are specific to this table
 * rather than a general preference.
 *
 *  - **There is no upstream artifact to pin.** `src/data/iana-range-equivalents.js` is generated
 *    from a file `lokalized-spec` vendors and locks. This table's source is `sun.util.locale`, a
 *    JDK-internal class reachable only by reflection through `--add-opens`, and its ORDER is a
 *    `HashMap` iteration order — a property of the running JVM, not of any document. Pinning it as
 *    an artifact would freeze a transcription of something only an executing JDK can state.
 *  - **A lock would add a copy, not a check.** This table has already been mis-transcribed twice —
 *    enumerated as thirteen pairs with `-zr` missing, and named `-mm` as the fourteenth. A
 *    generated module plus a lock file makes three copies where there are two, and the checker
 *    would still have to run the JDK to be worth anything, which is exactly what the differential
 *    already does.
 *  - **Fourteen pairs against 806 classes.** The artifact machinery exists because a 23 KB table
 *    cannot be read by a reviewer. This one is four lines and its every entry is visible above.
 *
 * WHAT ACTUALLY GATES IT, and what each gate is worth — measured at M7 close, not argued:
 *
 *  - `npm run diff:language-range` re-derives `regionVariantEquivMap` from the pinned JDK on every
 *    run and compares this literal against it as an ORDERED LIST OF PAIRS, then probes every
 *    ordered pair of the fourteen end to end. **Ablation:** moving `["-fr", "-fx"]` to the end of
 *    the list exits 1 and prints both lists. It is the strongest gate and it needs the JDK.
 *  - `npm test` catches a missing or mis-paired entry (dropping `["-zr", "-cd"]` fails
 *    `test/negotiate.test.js`) and, since M7 close, a tail permutation too — the `sgn-fx-fr` row
 *    was added because that same `-fr` move left the whole suite GREEN while changing the answer.
 *    This matters because the differential is not part of `npm run verify`.
 *
 * So the literal is checked in two independent places, one of which runs in the default gate, and
 * neither is a transcription of the other. A pinned artifact would improve none of that.
 *
 * @type {readonly (readonly [string, string])[]}
 */
const REGION_VARIANT_EQUIVALENTS = [
	["-bu", "-mm"], ["-tl", "-tp"], ["-zr", "-cd"], ["-tp", "-tl"], ["-dd", "-de"], ["-mm", "-bu"],
	["-cd", "-zr"], ["-de", "-dd"], ["-heploc", "-alalc97"], ["-alalc97", "-heploc"], ["-yd", "-ye"],
	["-fr", "-fx"], ["-ye", "-yd"], ["-fx", "-fr"],
];

/** `Integer.MIN_VALUE`, the sentinel `getExtentionKeyIndex` returns for "no singleton extension". */
const NO_EXTENSION_KEY = -2147483648;

/**
 * `sun.util.locale.LocaleMatcher#getExtentionKeyIndex`, verbatim, misspelling included.
 *
 * It reports the index of the hyphen that introduces a SINGLETON subtag (`-x-`, `-u-`, …), found by
 * looking for two hyphens two characters apart. Java's `i - index` overflows on the first hyphen
 * because `index` starts at `Integer.MIN_VALUE`; the overflowed value cannot be 2 for any reachable
 * `i`, so the JS arithmetic — which does not overflow — takes the same branch on every input.
 *
 * @param {string} text
 * @returns {number}
 */
function extensionKeyIndex(text) {
	let index = NO_EXTENSION_KEY;

	for (let position = 1; position < text.length; ++position)
		if (text[position] === "-") {
			if (position - index === 2) return index;
			index = position;
		}

	return NO_EXTENSION_KEY;
}

/**
 * `sun.util.locale.LocaleMatcher#getEquivalentForRegionAndVariant`, verbatim.
 *
 * A SUBSTRING SEARCH, not a suffix test: the subtag may sit anywhere in the range as long as it ends
 * at the range's end or at a hyphen, and as long as it is not inside a singleton extension. So
 * `de-DE` yields `de-dd`, `sgn-be-fr` yields `sgn-be-fx`, and `de-x-fr` yields nothing.
 *
 * @param {string} range lowercased
 * @returns {string | null}
 */
function equivalentForRegionAndVariant(range) {
	const keyIndex = extensionKeyIndex(range);

	for (const [subtag, equivalent] of REGION_VARIANT_EQUIVALENTS) {
		const index = range.indexOf(subtag);
		if (index === -1) continue;
		if (keyIndex !== NO_EXTENSION_KEY && index > keyIndex) continue;

		const end = index + subtag.length;
		if (range.length === end || range[end] === "-")
			return range.slice(0, index) + equivalent + range.slice(end);
	}

	return null;
}

/**
 * The raw `singleEquivMap`/`multiEquivsMap` value for one artifact key, recovered from the key's
 * recorded equivalence class.
 *
 * WHY A RECOVERY AND NOT A LOOKUP. The pinned artifact does not store the JDK's two language maps;
 * it stores, for each key, the whole LIST `Locale.LanguageRange.parse(key)` returned — which already
 * has the region/variant equivalents mixed in. `sgn-be-fr`'s class is
 * `[sgn-be-fr, sgn-sfb, sfb, sgn-be-fx]`, and `sgn-be-fx` is a REGION equivalent, not a language
 * one. Feeding that class back through `parse` as if it were `getEquivalentsForLanguage`'s output
 * would apply the region map twice and invent members the JDK never produces.
 *
 * The recovery inverts `parse`'s own insertion sequence. Every derived member is inserted at
 * `index + 1`, so the class is `[key]` followed by the insertions in REVERSE time order, and the
 * insertions are, in time order, `rv(key)` then — for each language equivalent `e` — `e` and then
 * `rv(e)`. Reversing the tail and walking it with `rv` in hand recovers `e₁, e₂, …` exactly.
 *
 * This is verified TOTALLY rather than argued: `test/negotiate.test.js` re-parses all 806 keys from
 * their recovered equivalents and requires the recorded class back, byte for byte. A key the
 * recovery got wrong turns that test red rather than shipping a plausible list.
 *
 * @type {Map<string, readonly string[]>}
 */
const RECOVERED_LANGUAGE_EQUIVALENTS = new Map();

/**
 * @param {string} key
 * @param {readonly string[]} equivalenceClass
 * @returns {readonly string[]}
 */
function recoverLanguageEquivalents(key, equivalenceClass) {
	const cached = RECOVERED_LANGUAGE_EQUIVALENTS.get(key);
	if (cached !== undefined) return cached;

	const insertions = equivalenceClass.slice(1).reverse();
	const seen = new Set([key]);
	/** @type {string[]} */
	const equivalents = [];
	let cursor = 0;

	/** @param {string} range consume the region/variant equivalent `parse` would have inserted next */
	const consumeRegionVariant = (range) => {
		const equivalent = equivalentForRegionAndVariant(range);
		if (equivalent === null || seen.has(equivalent)) return;
		if (insertions[cursor] !== equivalent) return;
		seen.add(equivalent);
		++cursor;
	};

	consumeRegionVariant(key);

	while (cursor < insertions.length) {
		const equivalent = /** @type {string} */ (insertions[cursor++]);
		equivalents.push(equivalent);
		seen.add(equivalent);
		consumeRegionVariant(equivalent);
	}

	RECOVERED_LANGUAGE_EQUIVALENTS.set(key, equivalents);
	return equivalents;
}

/**
 * `sun.util.locale.LocaleMatcher#getEquivalentsForLanguage` — the LANGUAGE-PREFIX arm of the
 * equivalence expansion, and that arm ONLY. The region/variant arm is
 * `equivalentForRegionAndVariant` above and `parseLanguageRanges` composes the two.
 *
 * PREFIX SUBSTITUTION, not exact lookup — the artifact's own `closureSchema` says so. The JDK walks
 * the range from its full spelling down, dropping one trailing subtag at a time, stops at the FIRST
 * key it finds, and rewrites that prefix to each member of the class. So `sgn-be-fr-x-a` finds
 * `sgn-be-fr` and yields `sfb-x-a`, and `no-bok-no` finds `no-bok` and yields `nb-no`. An exact
 * lookup finds neither, and both are recorded corpus answers. `replaceFirstSubStringMatch` replaces
 * the first OCCURRENCE rather than the prefix, but the walk only ever hands it a prefix of the
 * range, so the first occurrence is at index 0 and the two are the same operation.
 *
 * @param {string} range lowercased
 * @returns {readonly string[] | null}
 */
function equivalentsForLanguage(range) {
	let prefix = range;

	while (prefix.length > 0) {
		const equivalenceClass = RANGE_EQUIVALENTS.get(prefix);

		if (equivalenceClass !== undefined) {
			const suffix = range.slice(prefix.length);
			return recoverLanguageEquivalents(prefix, equivalenceClass)
				.map((equivalent) => equivalent + suffix);
		}

		const index = prefix.lastIndexOf("-");
		if (index === -1) break;
		prefix = prefix.slice(0, index);
	}

	return null;
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
 * `java.util.Locale.LanguageRange#parse(String)`, ported from `sun.util.locale.LocaleMatcher:440`.
 *
 * This is the whole reason `lokalized/negotiate` exists as a separate subpath: it is the door an
 * `Accept-Language` field value comes through, and it drags the 806-class IANA closure in with it.
 * `DefaultStrings#addParsedLanguageRangeIdentities:2161-2172` calls the same method, so the pinned
 * closure and the region/variant map below reach MEMBER IDENTITIES too, not only headers.
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
 * @param {string} header an `Accept-Language` field value, or a single language range
 * @returns {WeightedLanguageRange[]} the parsed members, in `LanguageRange.parse`'s own order
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

		const regionVariant = equivalentForRegionAndVariant(range);
		if (regionVariant !== null) insert(regionVariant);

		for (const equivalent of equivalentsForLanguage(range) ?? []) {
			insert(equivalent);
			const derived = equivalentForRegionAndVariant(equivalent);
			if (derived !== null) insert(derived);
		}
	}

	return list;
}

/**
 * `DefaultStrings#addParsedLanguageRangeIdentities:2161-2172`, whose body is literally
 * `LanguageRange.parse(range)` inside a catch that keeps whatever identities the other probes found.
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
 * NO DEFECT FAMILY SURVIVES: 6,037 of 6,037 probes are identical and the differential exits 0. Four
 * families used to survive — 24 diverging probes — and the history is kept here because the shape of
 * the mistake recurs, not because the divergence does.
 *
 * ONE CAUSE, TWO OPPOSITE SYMPTOMS, which is why neither could have been read off the other. Every
 * one of the four was a key of the JDK's OWN equivalence map — `singleEquivMap` holds
 * `cmn-hans` -> `zh-cmn-hans`, `cmn-hant` -> `zh-cmn-hant`, `lv-lvs` -> `lvs`, `lv-ltg` -> `ltg` —
 * that the pinned artifact did not carry, because `lokalized-spec/tools/iana-oracle/candidates.mjs`
 * crossed its `PREFIXES` only with LANGUAGES and listed no `lv` at all. The JDK's prefix walk RETURNS
 * at the longest key it finds, so a missing key changed the answer in whichever direction the
 * shorter key happened to point:
 *
 *   - OVER-expansion, `cmn-hans` / `cmn-hant`. Missing its own key, the walk fell through to `cmn`,
 *     whose class is `{zh-cmn, zh-guoyu}`, and this module answered `{cmn-hans, zh-cmn-hans,
 *     zh-guoyu-hans}` where the JDK answers `{cmn-hans, zh-cmn-hans}`. A member too many.
 *   - UNDER-expansion, `lv-lvs` / `lv-ltg`. `lv` is not a key either, so the walk found nothing and
 *     this module answered `{lv-lvs}` where the JDK answers `{lv-lvs, lvs}`. A member too few, and
 *     the consequence was concrete: a request for Latgalian never reached an `ltg` catalog.
 *
 * THE REASON THIS COMMENT ONCE GAVE WAS FALSE, and the correction is a measurement. It said the JDK
 * "drops `zh-guoyu-hans` as an ill-formed tag — a 4-alpha subtag after a variant", and called the
 * `cmn-hans` row a DELIBERATE DIVERGENCE on that basis. It is not: on the pinned Corretto 21
 * `new Locale.LanguageRange("zh-guoyu-hans")` constructs without complaint and
 * `parse("zh-guoyu-hans")` returns `[zh-guoyu-hans, zh-cmn-hans, cmn-hans]`. Nothing was ever dropped
 * for ill-formedness; the shorter-key fall-through above was the whole of it. A data defect wearing a
 * divergence's clothes, which is why `KNOWN_DIVERGENCES` requires a Java-source or JDK-measured
 * argument and not an explanation that merely sounds like one.
 *
 * THE CLOSE, and where it had to happen. Not by hand-editing the artifact — it reconstructed 802/802
 * of its own bare keys exactly and was not itself the source of the divergence; the PROBE SPACE that
 * produced it was. `candidates.mjs` now seeds that space from the JDK's own equivalence-map keys —
 * the JDK's INPUT data, so the space cannot be blind to a gap in the artifact the way one derived
 * from the artifact is — and `build.mjs` now asserts that all 769 keys produced a closure entry.
 * Re-extracting added exactly those 4 classes (802 -> 806) and changed nothing else.
 * `tools/gen-iana-data.js` re-emits `src/data/iana-range-equivalents.js` from the re-pinned
 * artifact; nothing in `src/` was edited to fix this. And the fix alone was not enough: the four
 * `OPEN_PORT_DEFECTS` entries had to be deleted in the same change, or their own staleness check
 * reports four STALE lines and the run still exits 1. That deletion is the record of the win.
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

	const candidate = /** @type {{ range?: unknown, weight?: unknown }} */ (value);

	if (typeof candidate.range !== "string")
		throw new RangeError("A language range must carry a string 'range'");

	const weight = candidate.weight === undefined ? MAXIMUM_WEIGHT : candidate.weight;

	if (typeof weight !== "number" || Number.isNaN(weight) || weight < MINIMUM_WEIGHT || weight > MAXIMUM_WEIGHT)
		throw new RangeError(`weight=${String(weight)} for language range "${candidate.range}". ` +
			"It must be between 0.0 and 1.0.");

	const range = candidate.range.toLowerCase();
	checkLanguageRangeGrammar(range);

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
		/**
		 * `LocaleMatcher#bestMatchForAcceptLanguage` (`:117-139`), the FAIL-SOFT request-handling door.
		 *
		 * Every unusable input answers the configured fallback rather than throwing: absent, over the
		 * length cap, blank, normalizing to nothing, unparseable, or parsing to more than 32 members.
		 * It is the mirror image of `matchForLanguageRanges`, which is strict about all of those, and
		 * THE CONTRADICTION IS THE POINT — the corpus records the same 13-member header
		 * (`he,id,yi,cmn,yue,nan,hak,jbo,tlh,gan,wuu,hsn,ase,fr;q=0.1`, which the IANA closure expands
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
			if (acceptLanguage == null ||
				typeof acceptLanguage !== "string" ||
				acceptLanguage.length > MAXIMUM_ACCEPT_LANGUAGE_LENGTH ||
				javaTrim(acceptLanguage) === "") return fallbackLocale;

			const normalized = normalizeAcceptLanguage(acceptLanguage);

			if (normalized === "") return fallbackLocale;

			/** @type {WeightedLanguageRange[]} */
			let ranges;

			try {
				ranges = parseLanguageRanges(normalized);
			} catch (error) {
				// Java catches `IllegalArgumentException | IndexOutOfBoundsException` — the parser's own
				// refusals and nothing else. Narrowed to `RangeError` here for the same reason: a
				// `TypeError` out of this module is a defect, and a blanket catch would answer the
				// fallback and look like a recorded row passing.
				if (!(error instanceof RangeError)) throw error;
				return fallbackLocale;
			}

			if (ranges.length > MAXIMUM_LANGUAGE_RANGES) return fallbackLocale;

			// `bestMatchFor(List.of())` and `bestMatchFor(ranges)` are the same call in Java; the four
			// exits above spell `List.of()` as the fallback directly, because an empty list is exactly
			// what `noLocaleMatch` turns into `getFallbackLocale()` one line later.
			return matchForLanguageRanges(ranges).locale ?? fallbackLocale;
		},
	});
}
