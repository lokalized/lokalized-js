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

		while (index < subtags.length && isPrivateUseSubtag(subtags[index] ?? "")) {
			parts.privateuse.push((subtags[index] ?? "").toLowerCase());
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
 * Renders parsed parts the way `Locale#toLanguageTag` does: the first extlang replaces the primary
 * language, `und` becomes the empty language, the legacy codes round-trip to their modern spelling,
 * and an otherwise language-less tag is prefixed with `und`.
 *
 * @param {JdkTagParts} parts
 * @returns {string}
 */
export function renderJdkTag(parts) {
	let language = parts.extlangs.length > 0 ? (parts.extlangs[0] ?? "") : parts.language;

	if (language === "und") language = "";
	else if (language === "he" || language === "iw") language = "he";
	else if (language === "yi" || language === "ji") language = "yi";
	else if (language === "id" || language === "in") language = "id";

	if (!isLanguageSubtag(language)) language = "";

	let rendered = language;

	if (parts.script.length > 0) rendered += "-" + parts.script;
	if (parts.region.length > 0) rendered += "-" + parts.region;

	for (const variant of parts.variants) rendered += "-" + variant;

	// `InternalLocaleBuilder.setExtensions` keys extensions by singleton and IGNORES every repeat, so
	// a `Locale` keeps only the first occurrence; `LocaleExtensions` then stores them sorted by key.
	/** @type {Map<string, string[]>} */
	const extensionsBySingleton = new Map();

	for (const extension of parts.extensions) {
		const singleton = extension[0] ?? "";
		if (!extensionsBySingleton.has(singleton)) extensionsBySingleton.set(singleton, extension);
	}

	const extensions = [...extensionsBySingleton.values()].sort((first, second) =>
		(first[0] ?? "") < (second[0] ?? "") ? -1 : (first[0] ?? "") > (second[0] ?? "") ? 1 : 0);

	for (const extension of extensions) rendered += "-" + extension.join("-");

	if (parts.privateuse.length > 0) {
		if (rendered.length > 0) rendered += "-";
		rendered += "x-" + parts.privateuse.join("-");
	}

	if (rendered.startsWith("-")) rendered = "und" + rendered;
	if (rendered.length === 0) rendered = "und";

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
