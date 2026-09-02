// @ts-check
/**
 * Port of lokalized-java's `CldrLocaleData`: CLDR canonicalization, the parent/fallback walk, and
 * likely-subtag maximization, over the repo's generated CLDR tables.
 *
 * This layer has its OWN lenient tag parser (`TagParts` in Java), which is deliberately not the JDK
 * parser: it accepts any first subtag as a language and treats everything after the first
 * single-character subtag as an extension. Both parsers are needed and they disagree in real cases.
 */

import { decode as decodeAliasesLanguage } from "../data/aliases-language.js";
import { decode as decodeAliasesRegion } from "../data/aliases-region.js";
import { decode as decodeAliasesScript } from "../data/aliases-script.js";
import { decode as decodeAliasesVariant } from "../data/aliases-variant.js";
import { decode as decodeLikelySubtags } from "../data/likely-subtags.js";
import { decode as decodeParents } from "../data/parents.js";
import { decode as decodeValidLanguages } from "../data/valid-languages.js";
import { decode as decodeValidRegions } from "../data/valid-regions.js";
import { decode as decodeValidScripts } from "../data/valid-scripts.js";
import { decode as decodeValidVariants } from "../data/valid-variants.js";
import { javaSplit, jdkLanguageTag } from "./locale-jdk-tag.js";

const ROOT_PARENT = "root";
const UNDETERMINED_LANGUAGE = "und";
const UNKNOWN_SCRIPT = "zzzz";
const UNKNOWN_REGION = "zz";
const NORWEGIAN_MACROLANGUAGE = "no";
const NORWEGIAN_BOKMAL = "nb";

/**
 * @param {{from: string, to: string}[]} pairs
 * @returns {Map<string, string>}
 */
function mapFor(pairs) {
	/** @type {Map<string, string>} */
	const map = new Map();
	for (const pair of pairs) map.set(pair.from.toLowerCase(), pair.to);
	return map;
}

/**
 * @param {{from: string, to: string}[]} pairs
 * @returns {Map<string, string[]>}
 */
function listMapFor(pairs) {
	/** @type {Map<string, string[]>} */
	const map = new Map();
	for (const pair of pairs) map.set(pair.from.toLowerCase(), pair.to.split(/\s+/).filter((value) => value.length > 0));
	return map;
}

/**
 * @param {string[]} values
 * @returns {Set<string>}
 */
function setFor(values) {
	/** @type {Set<string>} */
	const set = new Set();
	for (const value of values) set.add(value.toLowerCase());
	return set;
}

const LANGUAGE_ALIASES = mapFor(decodeAliasesLanguage());
const SCRIPT_ALIASES = mapFor(decodeAliasesScript());
const REGION_ALIASES = listMapFor(decodeAliasesRegion());
const VARIANT_ALIASES = mapFor(decodeAliasesVariant());
const LIKELY_SUBTAGS = mapFor(decodeLikelySubtags());
const PARENT_LOCALES = mapFor(decodeParents());
const VALID_LANGUAGES = setFor(decodeValidLanguages());
const VALID_SCRIPTS = setFor(decodeValidScripts());
const VALID_REGIONS = setFor(decodeValidRegions());
const VALID_VARIANTS = setFor(decodeValidVariants());

/** Compound (multi-subtag) language alias keys, longest first, then lexicographic. */
const COMPOUND_LANGUAGE_ALIAS_KEYS = [...LANGUAGE_ALIASES.keys()]
	.filter((key) => key.indexOf("-") >= 0)
	.sort((first, second) => (second.length - first.length) || (first < second ? -1 : first > second ? 1 : 0));

/**
 * @typedef {object} TagParts
 * @property {string} language
 * @property {string} script
 * @property {string} region
 * @property {string[]} variants
 * @property {string[]} extensions
 * @property {boolean} privateUse
 */

/**
 * @param {string} language
 * @param {string} script
 * @param {string} region
 * @param {string[]} variants
 * @param {string[]} extensions
 * @param {boolean} privateUse
 * @returns {TagParts}
 */
function makeTagParts(language, script, region, variants, extensions, privateUse) {
	return {
		language,
		script: script.toLowerCase() === UNKNOWN_SCRIPT ? "" : script,
		region: region.toLowerCase() === UNKNOWN_REGION ? "" : region,
		variants: [...variants],
		extensions: [...extensions],
		privateUse,
	};
}

/** @param {string} subtag */
function isAlphabetic(subtag) {
	return /^[A-Za-z]+$/.test(subtag);
}

/** @param {string} subtag */
function isNumeric(subtag) {
	return /^[0-9]+$/.test(subtag);
}

/** @param {string} subtag */
function canonicalScriptSubtag(subtag) {
	return subtag.slice(0, 1).toUpperCase() + subtag.slice(1).toLowerCase();
}

/**
 * The CLDR-side lenient parse (`TagParts.forLanguageTag`).
 * @param {string} languageTag
 * @returns {TagParts}
 */
export function tagPartsFor(languageTag) {
	const normalized = languageTag.trim().replace(/_/g, "-");

	if (normalized.toLowerCase().startsWith("x-"))
		return makeTagParts("", "", "", [], [normalized.toLowerCase()], true);

	const subtags = javaSplit(normalized);
	let language = "";
	let script = "";
	let region = "";
	/** @type {string[]} */
	const variants = [];
	/** @type {string[]} */
	const extensions = [];
	let index = 0;

	if (subtags.length > 0 && (subtags[0] ?? "").length > 0) {
		language = (subtags[0] ?? "").toLowerCase();
		index = 1;
	}

	const scriptCandidate = subtags[index] ?? "";

	if (index < subtags.length && scriptCandidate.length === 4 && isAlphabetic(scriptCandidate)) {
		script = canonicalScriptSubtag(scriptCandidate);
		++index;
	}

	const regionCandidate = subtags[index] ?? "";

	if (index < subtags.length &&
		((regionCandidate.length === 2 && isAlphabetic(regionCandidate)) ||
			(regionCandidate.length === 3 && isNumeric(regionCandidate)))) {
		region = regionCandidate.toUpperCase();
		++index;
	}

	while (index < subtags.length) {
		const subtag = subtags[index] ?? "";
		if (subtag.length === 1) break;
		variants.push(subtag.toLowerCase());
		++index;
	}

	while (index < subtags.length) {
		extensions.push((subtags[index] ?? "").toLowerCase());
		++index;
	}

	return makeTagParts(language, script, region, variants, extensions, false);
}

/**
 * @param {TagParts} parts
 * @returns {string}
 */
export function partsToTag(parts) {
	if (parts.privateUse) return parts.extensions.join("-");

	/** @type {string[]} */
	const subtags = [];

	if (parts.language.length > 0) subtags.push(parts.language);
	if (parts.script.length > 0) subtags.push(parts.script);
	if (parts.region.length > 0) subtags.push(parts.region);

	for (const variant of parts.variants) subtags.push(variant);
	for (const extension of parts.extensions) subtags.push(extension);

	return subtags.length === 0 ? UNDETERMINED_LANGUAGE : subtags.join("-");
}

/**
 * @param {TagParts} parts
 * @param {Partial<TagParts>} overrides
 * @returns {TagParts}
 */
function withParts(parts, overrides) {
	return makeTagParts(
		(overrides.language ?? parts.language).toLowerCase(),
		overrides.script === undefined
			? parts.script
			: overrides.script.length === 0 ? "" : canonicalScriptSubtag(overrides.script),
		overrides.region === undefined ? parts.region : overrides.region.toUpperCase(),
		overrides.variants ?? parts.variants,
		parts.extensions,
		parts.privateUse);
}

/**
 * @param {TagParts} parts
 * @returns {string[]}
 */
function likelySubtagCandidateTags(parts) {
	/** @type {Set<string>} */
	const candidateTags = new Set();
	const language = parts.language.length === 0 ? UNDETERMINED_LANGUAGE : parts.language;
	const script = parts.script;
	const region = parts.region;

	candidateTags.add(partsToTag(parts));

	if (script.length > 0 && region.length > 0) candidateTags.add(language + "-" + script + "-" + region);
	if (script.length > 0) candidateTags.add(language + "-" + script);
	if (region.length > 0) candidateTags.add(language + "-" + region);

	candidateTags.add(language);

	if (script.length > 0) candidateTags.add(UNDETERMINED_LANGUAGE + "-" + script);
	if (region.length > 0) candidateTags.add(UNDETERMINED_LANGUAGE + "-" + region);

	candidateTags.add(UNDETERMINED_LANGUAGE);
	return [...candidateTags];
}

/**
 * @param {TagParts} parts
 * @param {string[]} regionAliases
 * @returns {string}
 */
function preferredRegionAlias(parts, regionAliases) {
	if (regionAliases.length === 1) return regionAliases[0] ?? "";

	const languageAndScript = withParts(parts, { region: "" });

	for (const candidateTag of likelySubtagCandidateTags(languageAndScript)) {
		const likelySubtag = LIKELY_SUBTAGS.get(candidateTag.toLowerCase());
		if (likelySubtag === undefined) continue;

		const likelyRegion = tagPartsFor(likelySubtag).region;

		for (const regionAlias of regionAliases)
			if (regionAlias.toLowerCase() === likelyRegion.toLowerCase()) return regionAlias;
	}

	return regionAliases[0] ?? "";
}

/**
 * @param {string} languageTag
 * @returns {string | null}
 */
function compoundLanguageAliasFor(languageTag) {
	const key = languageTag.toLowerCase();

	for (const aliasKey of COMPOUND_LANGUAGE_ALIAS_KEYS) {
		if (!key.startsWith(aliasKey + "-")) continue;
		const replacement = LANGUAGE_ALIASES.get(aliasKey);
		if (replacement !== undefined) return replacement + languageTag.slice(aliasKey.length);
	}

	return null;
}

/**
 * @param {string} languageTag
 * @returns {string}
 */
function aliasLanguageTagOnce(languageTag) {
	const directAlias = LANGUAGE_ALIASES.get(languageTag.toLowerCase());
	if (directAlias !== undefined) return directAlias;

	const compoundAlias = compoundLanguageAliasFor(languageTag);
	if (compoundAlias !== null) return compoundAlias;

	let parts = tagPartsFor(languageTag);
	if (parts.privateUse) return partsToTag(parts);

	const languageAlias = LANGUAGE_ALIASES.get(parts.language.toLowerCase());

	if (languageAlias !== undefined) {
		const aliasParts = tagPartsFor(languageAlias);
		parts = withParts(parts, { language: aliasParts.language.length === 0 ? parts.language : aliasParts.language });

		if (parts.script.length === 0 && aliasParts.script.length > 0) parts = withParts(parts, { script: aliasParts.script });
		if (parts.region.length === 0 && aliasParts.region.length > 0) parts = withParts(parts, { region: aliasParts.region });
		if (parts.variants.length === 0 && aliasParts.variants.length > 0) parts = withParts(parts, { variants: aliasParts.variants });
	}

	if (parts.script.length > 0) {
		const scriptAlias = SCRIPT_ALIASES.get(parts.script.toLowerCase());
		if (scriptAlias !== undefined)
			parts = withParts(parts, { script: tagPartsFor(UNDETERMINED_LANGUAGE + "-" + scriptAlias).script });
	}

	if (parts.region.length > 0) {
		const regionAliases = REGION_ALIASES.get(parts.region.toLowerCase());
		if (regionAliases !== undefined) parts = withParts(parts, { region: preferredRegionAlias(parts, regionAliases) });
	}

	if (parts.variants.length > 0) {
		const variants = parts.variants.map((variant) => VARIANT_ALIASES.get(variant.toLowerCase()) ?? variant);
		parts = withParts(parts, { variants });
	}

	return partsToTag(parts);
}

/**
 * CLDR-canonical form of a tag. Applies the CLDR alias tables to fixpoint.
 * @param {string} languageTag
 * @returns {string}
 */
export function canonicalLanguageTag(languageTag) {
	let canonical = partsToTag(tagPartsFor(languageTag));
	/** @type {Set<string>} */
	const seen = new Set();

	while (!seen.has(canonical.toLowerCase())) {
		seen.add(canonical.toLowerCase());
		const aliased = aliasLanguageTagOnce(canonical);
		if (aliased === canonical) return canonical;
		canonical = partsToTag(tagPartsFor(aliased));
	}

	return canonical;
}

/**
 * @param {string} languageTag
 * @returns {string | null}
 */
export function likelySubtagFor(languageTag) {
	const parts = tagPartsFor(canonicalLanguageTag(languageTag));

	if (parts.privateUse || parts.language.length === 0) return null;

	for (const candidateTag of likelySubtagCandidateTags(parts)) {
		const likelySubtag = LIKELY_SUBTAGS.get(candidateTag.toLowerCase());
		if (likelySubtag === undefined) continue;

		const likelyParts = tagPartsFor(canonicalLanguageTag(likelySubtag));
		const language = parts.language.length === 0 || parts.language === UNDETERMINED_LANGUAGE
			? likelyParts.language
			: parts.language;
		const script = parts.script.length === 0 ? likelyParts.script : parts.script;
		const region = parts.region.length === 0 ? likelyParts.region : parts.region;

		return partsToTag(makeTagParts(language, script, region, parts.variants, [], false));
	}

	return null;
}

/**
 * The `language-Script` pair of a tag's likely-subtag maximization, or null when unavailable.
 * @param {string} languageTag
 * @returns {string | null}
 */
export function languageScriptForLikelySubtag(languageTag) {
	const likelySubtag = likelySubtagFor(languageTag);
	if (likelySubtag === null) return null;

	const parts = tagPartsFor(likelySubtag);
	if (parts.language.length === 0 || parts.script.length === 0) return null;

	return parts.language + "-" + parts.script;
}

/**
 * @param {string} languageTag
 * @returns {boolean}
 */
export function hasUndeterminedLanguage(languageTag) {
	const parts = tagPartsFor(languageTag);
	return parts.language.length === 0 || parts.language.toLowerCase() === UNDETERMINED_LANGUAGE;
}

/**
 * @param {string} languageTag
 * @returns {boolean}
 */
export function isPrivateUseLanguageTag(languageTag) {
	return tagPartsFor(languageTag).privateUse;
}

/**
 * @param {string} languageTag
 * @returns {boolean}
 */
export function isKnownLanguageTag(languageTag) {
	const parts = tagPartsFor(languageTag);

	if (parts.privateUse) return true;

	if (LANGUAGE_ALIASES.has(partsToTag(parts).toLowerCase()) || LANGUAGE_ALIASES.has(languageTag.toLowerCase()))
		return true;

	const language = parts.language;
	const lowered = languageTag.toLowerCase();
	const explicitlyUndetermined = lowered === "und" || lowered.startsWith("und-");

	if (language.length === 0 && !explicitlyUndetermined) return false;

	if (language.length > 0 && !explicitlyUndetermined && !VALID_LANGUAGES.has(language.toLowerCase()) &&
		!LANGUAGE_ALIASES.has(language.toLowerCase()) && !LANGUAGE_ALIASES.has(partsToTag(parts).toLowerCase()))
		return false;

	if (parts.script.length > 0 && !VALID_SCRIPTS.has(parts.script.toLowerCase()) &&
		!SCRIPT_ALIASES.has(parts.script.toLowerCase()))
		return false;

	if (parts.region.length > 0 && !VALID_REGIONS.has(parts.region.toLowerCase()) &&
		!REGION_ALIASES.has(parts.region.toLowerCase()))
		return false;

	for (const variant of parts.variants)
		if (!VALID_VARIANTS.has(variant.toLowerCase()) && !VARIANT_ALIASES.has(variant.toLowerCase())) return false;

	return true;
}

/**
 * @param {string} firstTag
 * @param {string} secondTag
 * @returns {boolean}
 */
export function equivalentTags(firstTag, secondTag) {
	return canonicalLanguageTag(firstTag).toLowerCase() === canonicalLanguageTag(secondTag).toLowerCase();
}

/**
 * @param {Set<string>} candidateTags
 * @param {string} languageTag
 * @returns {boolean} whether the walk reached `root`
 */
function addParentTags(candidateTags, languageTag) {
	let candidateTag = languageTag;
	/** @type {Set<string>} */
	const seen = new Set();

	while (!seen.has(candidateTag.toLowerCase())) {
		seen.add(candidateTag.toLowerCase());
		const parentTag = PARENT_LOCALES.get(candidateTag.toLowerCase());

		if (parentTag === undefined) return false;

		candidateTags.add(parentTag);

		if (parentTag === ROOT_PARENT) return true;

		candidateTag = parentTag;
	}

	return false;
}

/**
 * @param {string | null} requestedLanguageScript
 * @param {string} candidateTag
 * @returns {boolean}
 */
function crossesLikelyScriptBoundary(requestedLanguageScript, candidateTag) {
	if (requestedLanguageScript === null) return false;

	const candidateLanguageScript = languageScriptForLikelySubtag(candidateTag);
	return candidateLanguageScript !== null &&
		candidateLanguageScript.toLowerCase() !== requestedLanguageScript.toLowerCase();
}

/**
 * @param {Set<string>} candidateTags
 * @param {string} languageTag
 * @param {boolean} includeLanguageBridges
 */
function addFallbackTags(candidateTags, languageTag, includeLanguageBridges) {
	const requestedLanguageScript = languageScriptForLikelySubtag(languageTag);
	candidateTags.add(languageTag);
	let rootParentReached = addParentTags(candidateTags, languageTag);

	let candidateTag = languageTag;
	let separatorIndex = candidateTag.lastIndexOf("-");

	while (!rootParentReached && separatorIndex > 0) {
		candidateTag = candidateTag.slice(0, separatorIndex);

		if (crossesLikelyScriptBoundary(requestedLanguageScript, candidateTag)) break;

		candidateTags.add(candidateTag);
		rootParentReached = addParentTags(candidateTags, candidateTag);
		separatorIndex = candidateTag.lastIndexOf("-");
	}

	if (includeLanguageBridges) {
		const parts = tagPartsFor(languageTag);

		if (parts.language === NORWEGIAN_MACROLANGUAGE)
			addFallbackTags(candidateTags, partsToTag(withParts(parts, { language: NORWEGIAN_BOKMAL })), false);
		else if (parts.language === NORWEGIAN_BOKMAL)
			addFallbackTags(candidateTags, partsToTag(withParts(parts, { language: NORWEGIAN_MACROLANGUAGE })), false);
	}
}

/**
 * The CLDR fallback chain for a tag: the tag itself, its parents, its canonical form, truncations
 * that do not cross a likely-script boundary, and the Norwegian macrolanguage bridge. `root` is
 * excluded, and each entry is rendered through the JDK round trip, as Java does.
 *
 * @param {string} languageTag
 * @returns {string[]}
 */
export function fallbackLocaleTagsFor(languageTag) {
	/** @type {Set<string>} */
	const candidateTags = new Set();
	const canonicalTag = canonicalLanguageTag(languageTag);

	addFallbackTags(candidateTags, languageTag, true);
	addFallbackTags(candidateTags, canonicalTag, true);
	addParentTags(candidateTags, canonicalTag);

	/** @type {string[]} */
	const fallbackTags = [];
	/** @type {Set<string>} */
	const seen = new Set();

	for (const candidateTag of candidateTags) {
		if (candidateTag === ROOT_PARENT) continue;
		const jdkTag = jdkLanguageTag(candidateTag);
		if (seen.has(jdkTag)) continue;
		seen.add(jdkTag);
		fallbackTags.push(jdkTag);
	}

	return fallbackTags;
}
