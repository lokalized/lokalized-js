// @ts-check
/**
 * Emulation of the JDK locale-tag round trip `Locale.forLanguageTag(tag).toLanguageTag()`.
 *
 * lokalized-java funnels every requested locale, every loaded catalog locale, and every CLDR
 * fallback candidate through this round trip, so its selective rewriting (grandfathered tags,
 * extlang collapse, the `iw`/`ji`/`in` legacy codes, subtag casing) is load-bearing behavior
 * rather than cosmetics. It is deliberately NOT CLDR canonicalization: `mo` stays `mo`.
 */

/**
 * Java's `LanguageTag.GRANDFATHERED` preferred-value table, keyed by lowercased tag.
 * @type {Map<string, string>}
 */
const GRANDFATHERED = new Map([
	["art-lojban", "jbo"],
	["cel-gaulish", "xtg-x-cel-gaulish"],
	["en-gb-oed", "en-GB-x-oed"],
	["i-ami", "ami"],
	["i-bnn", "bnn"],
	["i-default", "en-x-i-default"],
	["i-enochian", "und-x-i-enochian"],
	["i-hak", "hak"],
	["i-klingon", "tlh"],
	["i-lux", "lb"],
	["i-mingo", "see-x-i-mingo"],
	["i-navajo", "nv"],
	["i-pwn", "pwn"],
	["i-tao", "tao"],
	["i-tay", "tay"],
	["i-tsu", "tsu"],
	["no-bok", "nb"],
	["no-nyn", "nn"],
	["sgn-be-fr", "sfb"],
	["sgn-be-nl", "vgt"],
	["sgn-ch-de", "sgg"],
	["zh-guoyu", "cmn"],
	["zh-hakka", "hak"],
	["zh-min", "nan-x-zh-min"],
	["zh-min-nan", "nan"],
	["zh-xiang", "hsn"],
]);

const ALPHA = /^[A-Za-z]+$/;
const ALPHANUM = /^[0-9A-Za-z]+$/;

/** @param {string} value */
function isAlpha(value) {
	return ALPHA.test(value);
}

/** @param {string} value */
function isAlphanum(value) {
	return ALPHANUM.test(value);
}

/** @param {string} value */
function isLanguageSubtag(value) {
	return value.length >= 2 && value.length <= 8 && isAlpha(value);
}

/** @param {string} value */
function isExtlangSubtag(value) {
	return value.length === 3 && isAlpha(value);
}

/** @param {string} value */
function isScriptSubtag(value) {
	return value.length === 4 && isAlpha(value);
}

/** @param {string} value */
function isRegionSubtag(value) {
	return (value.length === 2 && isAlpha(value)) || (value.length === 3 && /^[0-9]{3}$/.test(value));
}

/** @param {string} value */
function isVariantSubtag(value) {
	if (value.length >= 5 && value.length <= 8) return isAlphanum(value);
	return value.length === 4 && /^[0-9]/.test(value) && isAlphanum(value);
}

/**
 * `LanguageTag.isExtensionSingleton`, which requires ALPHA — not alphanumeric. A digit singleton is
 * therefore not an extension prefix at all: `en-1-abc` is ill-formed and `Locale.forLanguageTag`
 * truncates it to `en`.
 *
 * @param {string} value
 */
function isSingletonSubtag(value) {
	return value.length === 1 && isAlpha(value) && value !== "x" && value !== "X";
}

/** @param {string} value */
function isPrivateUseSubtag(value) {
	return value.length >= 1 && value.length <= 8 && isAlphanum(value);
}

/**
 * `UnicodeLocaleExtension.isAttribute` — 3*8alphanum. Also `isTypeSubtag`, which is the same
 * predicate under a second name in the JDK.
 *
 * @param {string} value
 */
function isUnicodeAttributeSubtag(value) {
	return value.length >= 3 && value.length <= 8 && isAlphanum(value);
}

/**
 * `UnicodeLocaleExtension.isKey` — 2alphanum. Every `-u-` subtag is 2..8 alphanum by construction,
 * so a subtag is a keyword key when it is not an attribute/type and vice versa.
 *
 * @param {string} value
 */
function isUnicodeKeySubtag(value) {
	return value.length === 2 && isAlphanum(value);
}

/**
 * `LanguageTag.PRIVUSE_VARIANT_PREFIX`. Java has no BCP-47 slot for a `Locale` variant such as
 * `POSIX`, so it smuggles one through the private-use sequence behind this marker — and reads it
 * back out on the way in. Matched case-insensitively, as `LocaleUtils.caseIgnoreMatch` does.
 */
const PRIVATE_USE_VARIANT_PREFIX = "lvariant";

/**
 * Java's `String#split("-")`, which JavaScript's `String#split` does not reproduce: Java drops ALL
 * trailing empty subtags, and returns a one-element array holding the whole input only when the
 * separator never matched. `"-"` therefore splits to an EMPTY array in Java and to `["", ""]` in
 * JavaScript, while `""` splits to `[""]` in both.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function javaSplit(value) {
	const parts = value.split("-");

	// No match: Java returns the original string as the sole element, empty or not.
	if (parts.length === 1) return parts;

	let end = parts.length;
	while (end > 0 && parts[end - 1] === "") --end;
	return parts.slice(0, end);
}

/** @param {string} value */
function titleCase(value) {
	return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

/**
 * @typedef {object} JdkTagParts
 * @property {string} language
 * @property {string[]} extlangs
 * @property {string} script
 * @property {string} region
 * @property {string[]} variants
 * @property {string[][]} extensions
 * @property {string[]} privateuse
 * @property {boolean} wellFormed  whether the whole tag parsed; Java silently drops the remainder
 */

/**
 * Parses a BCP-47 tag the way `LanguageTag.parse` does, then applies the `Locale` conversions.
 * An ill-formed suffix is dropped (and reported through `wellFormed`), mirroring the JDK.
 *
 * @param {string} tag
 * @returns {JdkTagParts}
 */
export function parseJdkTag(tag) {
	const grandfathered = GRANDFATHERED.get(tag.toLowerCase());
	const source = grandfathered === undefined ? tag : grandfathered;

	/** @type {JdkTagParts} */
	const parts = {
		language: "",
		extlangs: [],
		script: "",
		region: "",
		variants: [],
		extensions: [],
		privateuse: [],
		wellFormed: true,
	};

	if (source.length === 0) {
		parts.wellFormed = false;
		return parts;
	}

	// Java's `LanguageTag.parse` walks a StringTokenIterator, which — unlike `String#split` — yields
	// the empty subtag of a trailing separator, so "en-" is ill-formed rather than silently "en".
	const subtags = source.split("-");
	let index = 0;
	const first = subtags[0] ?? "";

	if (isLanguageSubtag(first)) {
		parts.language = first.toLowerCase();
		++index;

		while (index < subtags.length && parts.extlangs.length < 3 && isExtlangSubtag(subtags[index] ?? "")) {
			parts.extlangs.push((subtags[index] ?? "").toLowerCase());
			++index;
		}

		if (index < subtags.length && isScriptSubtag(subtags[index] ?? "")) {
			parts.script = titleCase(subtags[index] ?? "");
			++index;
		}

		if (index < subtags.length && isRegionSubtag(subtags[index] ?? "")) {
			parts.region = (subtags[index] ?? "").toUpperCase();
			++index;
		}

		while (index < subtags.length && isVariantSubtag(subtags[index] ?? "")) {
			parts.variants.push(subtags[index] ?? "");
			++index;
		}

		while (index < subtags.length && isSingletonSubtag(subtags[index] ?? "")) {
			const singleton = (subtags[index] ?? "").toLowerCase();
			++index;
			/** @type {string[]} */
			const values = [];

			while (index < subtags.length) {
				const candidate = subtags[index] ?? "";
				if (candidate.length < 2 || candidate.length > 8 || !isAlphanum(candidate)) break;
				values.push(candidate.toLowerCase());
				++index;
			}

			if (values.length === 0) {
				parts.wellFormed = false;
				return parts;
			}

			parts.extensions.push([singleton, ...values]);
		}
	}

	const privateUseStart = subtags[index] ?? "";

	if (index < subtags.length && (privateUseStart === "x" || privateUseStart === "X")) {
		++index;

		// Case is PRESERVED here, unlike every other subtag class: `LanguageTag.parsePrivateuse`
		// appends the raw token, and `InternalLocaleBuilder.getBaseLocale` lifts whatever follows
		// `lvariant` into the `Locale` variant, which keeps its spelling all the way out through
		// `toLanguageTag`. `en-US-x-lvariant-POSIX` and `en-US-x-lvariant-posix` are therefore two
		// different locales. `renderJdkTag` lowercases the surviving private-use tail, which is
		// where `LocaleExtensions` does it.
		while (index < subtags.length && isPrivateUseSubtag(subtags[index] ?? "")) {
			parts.privateuse.push(subtags[index] ?? "");
			++index;
		}

		if (parts.privateuse.length === 0) {
			parts.wellFormed = false;
			return parts;
		}
	}

	if (index < subtags.length) parts.wellFormed = false;

	return parts;
}

/**
 * `InternalLocaleBuilder.setUnicodeLocaleExtension` followed by the `UnicodeLocaleExtension`
 * constructor: the `-u-` payload is not an opaque string to a `Locale`, it is a set of attributes
 * and a map of keyword→type, and both come back out SORTED. That is why
 * `en-US-u-nu-latn-ca-gregory` and `en-US-u-ca-gregory-nu-latn` are one locale to Java.
 *
 * The duplicate rule is transcribed rather than paraphrased, because it has an edge the paraphrase
 * loses: when a repeated key is dropped, the next subtag is re-examined as a KEY, so `u-ca-x1-ca-x2`
 * yields `ca-x1-x2` — `x2` becomes an empty-typed keyword of its own rather than `ca`'s second type.
 *
 * @param {string[]} subtags the `-u-` payload, singleton excluded, already lowercased by the parser
 * @returns {string} the canonical payload, or `""` when it carries nothing at all
 */
function unicodeLocaleExtensionValue(subtags) {
	let index = 0;

	/** @type {Set<string>} */
	const attributes = new Set();

	while (index < subtags.length && isUnicodeAttributeSubtag(subtags[index] ?? "")) {
		attributes.add(subtags[index] ?? "");
		++index;
	}

	/** @type {Map<string, string[]>} */
	const keywords = new Map();
	/** @type {string | null} */
	let key = null;
	/** @type {string[]} */
	let type = [];

	for (; index < subtags.length; ++index) {
		const current = subtags[index] ?? "";

		if (key !== null) {
			if (isUnicodeKeySubtag(current)) {
				keywords.set(key, type);
				key = keywords.has(current) ? null : current;
				type = [];
			} else {
				type.push(current);
			}
		} else if (isUnicodeKeySubtag(current)) {
			key = keywords.has(current) ? null : current;
		}

		// `!itr.hasNext()`: the last keyword is emitted inside the loop, not after it.
		if (index === subtags.length - 1 && key !== null) keywords.set(key, type);
	}

	/** @type {string[]} */
	const rendered = [];

	for (const attribute of [...attributes].sort()) rendered.push(attribute);

	for (const keywordKey of [...keywords.keys()].sort()) {
		rendered.push(keywordKey);
		rendered.push(...(keywords.get(keywordKey) ?? []));
	}

	return rendered.join("-");
}

/**
 * `InternalLocaleBuilder.removePrivateuseVariant` — what is left of the private-use sequence once
 * the `lvariant` marker and its payload have been lifted into the `Locale` variant. `null` means the
 * whole sequence was the marker, so the locale keeps no private use at all.
 *
 * A trailing `lvariant` with nothing after it is NOT a marker (`x-lvariant` round-trips whole),
 * which is the distinction that keeps eight members of this family agreeing with the port already.
 *
 * @param {string[]} privateUse
 * @returns {string[] | null}
 */
function removePrivateUseVariant(privateUse) {
	const prefixIndex = privateUseVariantIndex(privateUse);

	if (prefixIndex < 0) return privateUse;
	return prefixIndex === 0 ? null : privateUse.slice(0, prefixIndex);
}

/**
 * The index of the `lvariant` marker that actually carries a variant — the FIRST one with at least
 * one subtag behind it — or `-1`.
 *
 * @param {string[]} privateUse
 * @returns {number}
 */
function privateUseVariantIndex(privateUse) {
	for (let index = 0; index < privateUse.length; ++index) {
		if ((privateUse[index] ?? "").toLowerCase() !== PRIVATE_USE_VARIANT_PREFIX) continue;
		return index + 1 < privateUse.length ? index : -1;
	}

	return -1;
}

/**
 * Renders parsed parts the way `Locale.forLanguageTag(tag).toLanguageTag()` does.
 *
 * This is NOT a re-serialization of the parse. A tag becomes a `Locale` first — a four-field
 * `BaseLocale` plus a sorted `LocaleExtensions` — and only that intermediate is rendered back, so
 * three rewrites happen here that no amount of subtag-shuffling would produce:
 *
 *   - the **variant lift**: `x-lvariant-POSIX` is not private use, it is how a `Locale` variant
 *     rides through BCP 47, so `en-US-x-lvariant-POSIX` comes back as `en-US-POSIX`;
 *   - the **compatibility extensions**: a bare `Locale` variant of `JP` on `ja-JP` (`TH` on `th-TH`)
 *     synthesizes `u-ca-japanese` (`u-nu-thai`), which then re-emits alongside the variant that is
 *     itself no longer well-formed and so goes back out behind `lvariant`;
 *   - the **`no-NO-NY` rewrite**: the Java-6 spelling of Nynorsk becomes `nn-NO`, changing the
 *     LANGUAGE. This one is not cosmetic — it decides which catalog answers.
 *
 * Plus the `-u-` sort described on `unicodeLocaleExtensionValue`, the first extlang replacing the
 * primary language, `und` becoming the empty language, the legacy codes round-tripping to their
 * modern spelling, and an otherwise language-less tag being prefixed with `und`.
 *
 * @param {JdkTagParts} parts
 * @returns {string}
 */
export function renderJdkTag(parts) {
	// --- `InternalLocaleBuilder.setLanguageTag` ------------------------------------------------
	// `und` is dropped HERE rather than at emission, which is why `und-x-abc` renders as `x-abc`
	// while a `Locale` carrying any other subtag re-acquires `und` further down.
	let language =
		parts.extlangs.length > 0 ? (parts.extlangs[0] ?? "") : parts.language === "und" ? "" : parts.language;
	const script = parts.script;
	const region = parts.region.toUpperCase();
	let variant = parts.variants.join("_");

	// Extensions are keyed by singleton and every REPEAT is ignored, so a `Locale` keeps only the
	// first occurrence of each.
	/** @type {Map<string, string[]>} */
	const parsedExtensions = new Map();

	for (const extension of parts.extensions) {
		const singleton = extension[0] ?? "";
		if (!parsedExtensions.has(singleton)) parsedExtensions.set(singleton, extension.slice(1));
	}

	if (parts.privateuse.length > 0) parsedExtensions.set("x", parts.privateuse);

	// --- `InternalLocaleBuilder.getBaseLocale`: the variant lift -------------------------------
	const privateUse = parsedExtensions.get("x");

	if (privateUse !== undefined) {
		const prefixIndex = privateUseVariantIndex(privateUse);

		if (prefixIndex >= 0) {
			const lifted = privateUse.slice(prefixIndex + 1).join("_");
			variant = variant.length === 0 ? lifted : variant + "_" + lifted;
		}
	}

	// --- `BaseLocale.getInstance`: casing, then `convertOldISOCodes` ---------------------------
	// A `Locale` stores the SUPERSEDED code; `toLanguageTag` converts back. The round trip is
	// observable elsewhere through `jdkLanguageSubtag`, so it is modelled rather than short-circuited.
	language = language.toLowerCase();
	if (language === "he") language = "iw";
	else if (language === "yi") language = "ji";
	else if (language === "id") language = "in";

	// --- `LocaleExtensions`: sorted, lowercased, `lvariant` excised ----------------------------
	/** @type {Map<string, string>} */
	const localeExtensions = new Map();

	for (const [singleton, values] of parsedExtensions) {
		if (singleton === "u") {
			const value = unicodeLocaleExtensionValue(values);
			if (value.length > 0) localeExtensions.set("u", value);
			continue;
		}

		if (singleton === "x") {
			const remainder = removePrivateUseVariant(values);
			if (remainder !== null) localeExtensions.set("x", remainder.join("-").toLowerCase());
			continue;
		}

		localeExtensions.set(singleton, values.join("-").toLowerCase());
	}

	// --- `Locale.forLanguageTag`'s `getCompatibilityExtensions` --------------------------------
	// Only when the locale has NO extensions of its own: `ja-JP-a-b-x-lvariant-JP` gets no calendar.
	if (localeExtensions.size === 0 && variant.length > 0) {
		if (language === "ja" && script.length === 0 && region === "JP" && variant === "JP")
			localeExtensions.set("u", "ca-japanese");
		else if (language === "th" && script.length === 0 && region === "TH" && variant === "TH")
			localeExtensions.set("u", "nu-thai");
	}

	// --- `LanguageTag.parseLocale` + `Locale.toLanguageTag` ------------------------------------
	let tagLanguage = isLanguageSubtag(language) ? language : "";

	if (tagLanguage === "iw") tagLanguage = "he";
	else if (tagLanguage === "ji") tagLanguage = "yi";
	else if (tagLanguage === "in") tagLanguage = "id";

	let hasSubtag = false;

	const tagScript = isScriptSubtag(script) ? titleCase(script) : "";
	if (tagScript.length > 0) hasSubtag = true;

	const tagRegion = isRegionSubtag(region) ? region.toUpperCase() : "";
	if (tagRegion.length > 0) hasSubtag = true;

	// The Java-6 Nynorsk spelling. Reachable only through the lift above, because `NY` is not a
	// well-formed BCP-47 variant and cannot arrive as one.
	if (tagLanguage === "no" && tagRegion === "NO" && variant === "NY") {
		tagLanguage = "nn";
		variant = "";
	}

	/** @type {string[]} */
	const tagVariants = [];
	let privateUseVariant = "";

	if (variant.length > 0) {
		const variantSubtags = variant.split("_");
		let index = 0;

		while (index < variantSubtags.length && isVariantSubtag(variantSubtags[index] ?? "")) {
			tagVariants.push(variantSubtags[index] ?? "");
			++index;
		}

		if (tagVariants.length > 0) hasSubtag = true;

		// A `Locale` variant BCP 47 cannot spell (`POSIX` is fine, `JP` and `A_B` are not) goes back
		// out behind the `lvariant` marker it came in on.
		/** @type {string[]} */
		const illFormed = [];

		while (index < variantSubtags.length && isPrivateUseSubtag(variantSubtags[index] ?? "")) {
			illFormed.push(variantSubtags[index] ?? "");
			++index;
		}

		privateUseVariant = illFormed.join("-");
	}

	/** @type {string[]} */
	const tagExtensions = [];
	/** @type {string | null} */
	let renderedPrivateUse = null;

	for (const singleton of [...localeExtensions.keys()].sort()) {
		const value = localeExtensions.get(singleton) ?? "";
		if (singleton === "x") renderedPrivateUse = value;
		else tagExtensions.push(singleton + "-" + value);
	}

	if (tagExtensions.length > 0) hasSubtag = true;

	if (privateUseVariant.length > 0)
		renderedPrivateUse =
			renderedPrivateUse === null
				? PRIVATE_USE_VARIANT_PREFIX + "-" + privateUseVariant
				: renderedPrivateUse + "-" + PRIVATE_USE_VARIANT_PREFIX + "-" + privateUseVariant;

	if (tagLanguage.length === 0 && (hasSubtag || renderedPrivateUse === null)) tagLanguage = "und";

	let rendered = tagLanguage;

	if (tagScript.length > 0) rendered += "-" + tagScript;
	if (tagRegion.length > 0) rendered += "-" + tagRegion;

	// Variants preserve their casing; extensions are already lowercase.
	for (const tagVariant of tagVariants) rendered += "-" + tagVariant;
	for (const extension of tagExtensions) rendered += "-" + extension;

	if (renderedPrivateUse !== null && renderedPrivateUse.length > 0) {
		if (rendered.length > 0) rendered += "-";
		rendered += "x-" + renderedPrivateUse;
	}

	return rendered;
}

/**
 * `Locale.forLanguageTag(tag).toLanguageTag()`. Never throws; an ill-formed suffix is dropped.
 * @param {string} tag
 * @returns {string}
 */
export function jdkLanguageTag(tag) {
	return renderJdkTag(parseJdkTag(tag));
}

/**
 * `Locale#getLanguage()`, which is NOT the language subtag of `toLanguageTag()`: it keeps the
 * superseded codes a `Locale` stores internally, so a locale built from `he` reports `iw`. Java's
 * matcher compares the two against each other, and that asymmetry is observable.
 *
 * @param {string} tag
 * @returns {string}
 */
export function jdkLanguageSubtag(tag) {
	const parts = parseJdkTag(tag);
	let language = parts.extlangs.length > 0 ? (parts.extlangs[0] ?? "") : parts.language;

	if (language === "und") language = "";
	else if (language === "he") language = "iw";
	else if (language === "yi") language = "ji";
	else if (language === "id") language = "in";

	return isLanguageSubtag(language) ? language : "";
}
