// @ts-check
/**
 * The locale kernel.
 *
 * Two channels live here and they are deliberately separate:
 *
 * - `matchFor` is the DIAGNOSTIC channel — Java's strict single-locale negotiation, reporting what a
 *   delivery would have to fetch.
 * - `candidateChain` is the RESOLUTION channel — the order per-key lookup actually attempts.
 *
 * They legitimately disagree. A `zh-TW` request can select `zh-Hant` while resolution walks
 * `[zh-TW, zh-Hant, en]` and never visits a loaded `zh` that holds the key.
 */

import {
	canonicalLanguageTag,
	equivalentTags,
	fallbackLocaleTagsFor,
	hasUndeterminedLanguage,
	isKnownLanguageTag,
	isPrivateUseLanguageTag,
	languageScriptForLikelySubtag,
	likelySubtagFor,
} from "./locale-cldr.js";
import { javaSplit, jdkLanguageSubtag, jdkLanguageTag, parseJdkTag, renderJdkTag } from "./locale-jdk-tag.js";

/**
 * IANA language-range equivalences — what `java.util.Locale.LanguageRange#parse` materializes as
 * extra ranges, which Java's kernel then treats as interchangeable "identities" of the request.
 *
 * This is NOT CLDR alias data and the two genuinely disagree: it is the reason a `sgn-NO` request
 * selects a loaded `nsl` even though CLDR maps `sgn-NO` to `nsi`. Java consults both tables, so a
 * port that has only the CLDR aliases gets that case wrong.
 *
 * Slice: the pinned registry has 802 classes; only two kinds of entry can ever be observed here, so
 * the rest are omitted.
 *   - keys are restricted to tags that survive `normalizeTag` (`jdkLanguageTag(k) === k`), because
 *     every range this kernel builds is an already-normalized locale tag — grandfathered forms
 *     (`art-lojban`) and extlang forms (`zh-cmn`) have been collapsed before they get here;
 *   - values are restricted the same way, because an identity is only ever compared against a
 *     loaded catalog's locale tag, which the loader has likewise normalized.
 *
 * `test/locale.test.js` regenerates this table from the spec's pinned registry and fails on drift.
 * It is generated data and belongs in `src/data/`; it is inlined only because this milestone ships
 * no such module and this module's owner may not add one.
 *
 * @type {Map<string, string[]>}
 */
export const IANA_RANGE_EQUIVALENTS = new Map([
	["aam", ["aam", "aas"]],
	["aas", ["aas", "aam"]],
	["acn", ["acn", "xia"]],
	["adp", ["adp", "dz"]],
	["adx", ["adx", "pcr"]],
	["aeb", ["aeb", "ajt"]],
	["ajp", ["ajp", "apc"]],
	["ajt", ["ajt", "aeb"]],
	["aog", ["aog", "myd"]],
	["apc", ["apc", "ajp"]],
	["ar-de", ["ar-de", "ar-dd"]],
	["ar-fr", ["ar-fr", "ar-fx"]],
	["ar-tl", ["ar-tl", "ar-tp"]],
	["asd", ["asd", "snz"]],
	["ase", ["ase", "sgn-us"]],
	["aue", ["aue", "ktz"]],
	["ayx", ["ayx", "nun"]],
	["bcg", ["bcg", "bgm"]],
	["bfi", ["bfi", "sgn-gb"]],
	["bfy", ["bfy", "ppa"]],
	["bgm", ["bgm", "bcg"]],
	["bic", ["bic", "bir"]],
	["bir", ["bir", "bic"]],
	["bjd", ["bjd", "drl"]],
	["blg", ["blg", "snb", "iba"]],
	["bmf", ["bmf", "krm"]],
	["bpp", ["bpp", "nxu"]],
	["bzs", ["bzs", "sgn-br"]],
	["cax", ["cax", "xba"]],
	["cbr", ["cbr", "nom"]],
	["ccq", ["ccq", "ybd", "rki"]],
	["cir", ["cir", "meg"]],
	["cjr", ["cjr", "mom"]],
	["cka", ["cka", "cmr"]],
	["cmk", ["cmk", "xch"]],
	["cmn-de", ["cmn-de", "cmn-dd"]],
	["cmn-fr", ["cmn-fr", "cmn-fx"]],
	["cmn-tl", ["cmn-tl", "cmn-tp"]],
	["cmr", ["cmr", "cka"]],
	["coy", ["coy", "nts", "pij"]],
	["cqu", ["cqu", "quh"]],
	["crr", ["crr", "pmk"]],
	["csn", ["csn", "sgn-co"]],
	["dek", ["dek", "sqm"]],
	["dev", ["dev", "gav"]],
	["dif", ["dif", "dit"]],
	["dit", ["dit", "dif"]],
	["dmw", ["dmw", "xrq"]],
	["drh", ["drh", "khk"]],
	["drl", ["drl", "bjd"]],
	["drr", ["drr", "gli", "kzk"]],
	["drw", ["drw", "tnf", "prs"]],
	["dse", ["dse", "sgn-nl"]],
	["dsl", ["dsl", "sgn-dk"]],
	["dtp", ["dtp", "tdu", "kzt", "kzj", "ktr"]],
	["duz", ["duz", "guv"]],
	["dz", ["dz", "adp"]],
	["eko", ["eko", "nte"]],
	["ema", ["ema", "uok"]],
	["fsl", ["fsl", "sgn-fx", "sgn-fr"]],
	["gal", ["gal", "ilw"]],
	["gav", ["gav", "dev"]],
	["gdj", ["gdj", "kvs"]],
	["gfx", ["gfx", "oun", "mwj", "vaj"]],
	["ggn", ["ggn", "gvr"]],
	["gli", ["gli", "drr", "kzk"]],
	["gsg", ["gsg", "sgn-dd", "sgn-de"]],
	["gss", ["gss", "sgn-gr"]],
	["gti", ["gti", "nyc"]],
	["gu", ["gu", "prp"]],
	["guv", ["guv", "duz"]],
	["gvr", ["gvr", "ggn"]],
	["hle", ["hle", "sca"]],
	["hrr", ["hrr", "jal"]],
	["huw", ["huw", "pmc"]],
	["iba", ["iba", "snb", "blg"]],
	["ibi", ["ibi", "opa"]],
	["ilw", ["ilw", "gal"]],
	["ise", ["ise", "sgn-it"]],
	["isg", ["isg", "sgn-ie"]],
	["jal", ["jal", "hrr"]],
	["jeg", ["jeg", "thx", "skk", "oyb"]],
	["jsl", ["jsl", "sgn-jp"]],
	["jv", ["jv", "jw"]],
	["jw", ["jw", "jv"]],
	["kak", ["kak", "tne"]],
	["kdz", ["kdz", "ncp"]],
	["kgc", ["kgc", "tdf"]],
	["kgh", ["kgh", "kml"]],
	["kgm", ["kgm", "plu"]],
	["khk", ["khk", "drh"]],
	["kjh", ["kjh", "zkb"]],
	["kmb", ["kmb", "smd"]],
	["kml", ["kml", "kgh"]],
	["koj", ["koj", "kwv"]],
	["kok-de", ["kok-de", "kok-dd"]],
	["kok-fr", ["kok-fr", "kok-fx"]],
	["kok-tl", ["kok-tl", "kok-tp"]],
	["krm", ["krm", "bmf"]],
	["kru", ["kru", "kxl"]],
	["ksp", ["ksp", "lak"]],
	["ktr", ["ktr", "tdu", "kzt", "kzj", "dtp"]],
	["ktz", ["ktz", "aue"]],
	["kvs", ["kvs", "gdj"]],
	["kwq", ["kwq", "yam"]],
	["kwv", ["kwv", "koj"]],
	["kxe", ["kxe", "tvd"]],
	["kxl", ["kxl", "kru"]],
	["kxr", ["kxr", "pat"]],
	["kzj", ["kzj", "tdu", "kzt", "ktr", "dtp"]],
	["kzk", ["kzk", "gli", "drr"]],
	["kzt", ["kzt", "tdu", "kzj", "ktr", "dtp"]],
	["lak", ["lak", "ksp"]],
	["lcq", ["lcq", "ppr"]],
	["lii", ["lii", "raq"]],
	["llo", ["llo", "ngt"]],
	["lmm", ["lmm", "rmx"]],
	["lrr", ["lrr", "yma"]],
	["meg", ["meg", "cir"]],
	["mfs", ["mfs", "sgn-mx"]],
	["mo", ["mo", "ro"]],
	["mom", ["mom", "cjr"]],
	["mry", ["mry", "myt", "mst"]],
	["ms-de", ["ms-de", "ms-dd"]],
	["ms-fr", ["ms-fr", "ms-fx"]],
	["ms-tl", ["ms-tl", "ms-tp"]],
	["mst", ["mst", "myt", "mry"]],
	["mtm", ["mtm", "ymt"]],
	["mwj", ["mwj", "oun", "gfx", "vaj"]],
	["myd", ["myd", "aog"]],
	["myt", ["myt", "mst", "mry"]],
	["nad", ["nad", "xny"]],
	["nbr", ["nbr", "nns"]],
	["ncp", ["ncp", "kdz"]],
	["ncs", ["ncs", "sgn-ni"]],
	["ngt", ["ngt", "llo"]],
	["ngv", ["ngv", "nnx"]],
	["nns", ["nns", "nbr"]],
	["nnx", ["nnx", "ngv"]],
	["no-de", ["no-de", "no-dd"]],
	["no-fr", ["no-fr", "no-fx"]],
	["no-tl", ["no-tl", "no-tp"]],
	["nom", ["nom", "cbr"]],
	["nsl", ["nsl", "sgn-no"]],
	["nte", ["nte", "eko"]],
	["nts", ["nts", "coy", "pij"]],
	["nun", ["nun", "ayx"]],
	["nxu", ["nxu", "bpp"]],
	["nyc", ["nyc", "gti"]],
	["ola", ["ola", "thw"]],
	["opa", ["opa", "ibi"]],
	["oun", ["oun", "mwj", "gfx", "vaj"]],
	["oyb", ["oyb", "thx", "skk", "jeg"]],
	["pat", ["pat", "kxr"]],
	["pcr", ["pcr", "adx"]],
	["phr", ["phr", "pmu"]],
	["pij", ["pij", "nts", "coy"]],
	["plu", ["plu", "kgm"]],
	["pmc", ["pmc", "huw"]],
	["pmk", ["pmk", "crr"]],
	["pmu", ["pmu", "phr"]],
	["ppa", ["ppa", "bfy"]],
	["ppr", ["ppr", "lcq"]],
	["prp", ["prp", "gu"]],
	["prs", ["prs", "tnf", "drw"]],
	["prt", ["prt", "pry"]],
	["pry", ["pry", "prt"]],
	["psr", ["psr", "sgn-pt"]],
	["pub", ["pub", "puz"]],
	["puz", ["puz", "pub"]],
	["quh", ["quh", "cqu"]],
	["raq", ["raq", "lii"]],
	["ras", ["ras", "tie"]],
	["rki", ["rki", "ybd", "ccq"]],
	["rmx", ["rmx", "lmm"]],
	["ro", ["ro", "mo"]],
	["sca", ["sca", "hle"]],
	["scv", ["scv", "zir"]],
	["sfs", ["sfs", "sgn-za"]],
	["sgn-br", ["sgn-br", "bzs"]],
	["sgn-co", ["sgn-co", "csn"]],
	["sgn-de", ["sgn-de", "gsg", "sgn-dd"]],
	["sgn-dk", ["sgn-dk", "dsl"]],
	["sgn-es", ["sgn-es", "ssp"]],
	["sgn-fr", ["sgn-fr", "fsl", "sgn-fx"]],
	["sgn-gb", ["sgn-gb", "bfi"]],
	["sgn-gr", ["sgn-gr", "gss"]],
	["sgn-ie", ["sgn-ie", "isg"]],
	["sgn-it", ["sgn-it", "ise"]],
	["sgn-jp", ["sgn-jp", "jsl"]],
	["sgn-mx", ["sgn-mx", "mfs"]],
	["sgn-ni", ["sgn-ni", "ncs"]],
	["sgn-nl", ["sgn-nl", "dse"]],
	["sgn-no", ["sgn-no", "nsl"]],
	["sgn-pt", ["sgn-pt", "psr"]],
	["sgn-se", ["sgn-se", "swl"]],
	["sgn-tl", ["sgn-tl", "sgn-tp"]],
	["sgn-us", ["sgn-us", "ase"]],
	["sgn-za", ["sgn-za", "sfs"]],
	["skk", ["skk", "thx", "jeg", "oyb"]],
	["smd", ["smd", "kmb"]],
	["snb", ["snb", "blg", "iba"]],
	["snz", ["snz", "asd"]],
	["sqm", ["sqm", "dek"]],
	["sr-de", ["sr-de", "sr-dd"]],
	["sr-fr", ["sr-fr", "sr-fx"]],
	["sr-tl", ["sr-tl", "sr-tp"]],
	["ssp", ["ssp", "sgn-es"]],
	["sw-cd", ["sw-cd", "sw-zr"]],
	["sw-de", ["sw-de", "sw-dd"]],
	["sw-fr", ["sw-fr", "sw-fx"]],
	["sw-tl", ["sw-tl", "sw-tp"]],
	["swl", ["swl", "sgn-se"]],
	["szd", ["szd", "umi"]],
	["taj", ["taj", "tsf"]],
	["tdf", ["tdf", "kgc"]],
	["tdg", ["tdg", "tmk"]],
	["tdu", ["tdu", "kzt", "kzj", "ktr", "dtp"]],
	["thc", ["thc", "tpo"]],
	["thw", ["thw", "ola"]],
	["thx", ["thx", "skk", "jeg", "oyb"]],
	["tie", ["tie", "ras"]],
	["tkk", ["tkk", "twm"]],
	["tlw", ["tlw", "weo"]],
	["tmk", ["tmk", "tdg"]],
	["tmp", ["tmp", "tyj"]],
	["tne", ["tne", "kak"]],
	["tnf", ["tnf", "drw", "prs"]],
	["tpn", ["tpn", "tpw"]],
	["tpo", ["tpo", "thc"]],
	["tpw", ["tpw", "tpn"]],
	["tsf", ["tsf", "taj"]],
	["tvd", ["tvd", "kxe"]],
	["twm", ["twm", "tkk"]],
	["tyj", ["tyj", "tmp"]],
	["umi", ["umi", "szd"]],
	["und-alalc97", ["und-alalc97", "und-heploc"]],
	["und-hepburn-heploc", ["und-hepburn-heploc", "und-hepburn-alalc97"]],
	["uok", ["uok", "ema"]],
	["uz-de", ["uz-de", "uz-dd"]],
	["uz-fr", ["uz-fr", "uz-fx"]],
	["uz-tl", ["uz-tl", "uz-tp"]],
	["vaj", ["vaj", "oun", "mwj", "gfx"]],
	["waw", ["waw", "xkh"]],
	["weo", ["weo", "tlw"]],
	["xba", ["xba", "cax"]],
	["xch", ["xch", "cmk"]],
	["xia", ["xia", "acn"]],
	["xkh", ["xkh", "waw"]],
	["xny", ["xny", "nad"]],
	["xrq", ["xrq", "dmw"]],
	["xss", ["xss", "zko"]],
	["yam", ["yam", "kwq"]],
	["ybd", ["ybd", "ccq", "rki"]],
	["yma", ["yma", "lrr"]],
	["ymt", ["ymt", "mtm"]],
	["yos", ["yos", "zom"]],
	["yue-de", ["yue-de", "yue-dd"]],
	["yue-fr", ["yue-fr", "yue-fx"]],
	["yue-tl", ["yue-tl", "yue-tp"]],
	["yug", ["yug", "yuu"]],
	["yuu", ["yuu", "yug"]],
	["zh-de", ["zh-de", "zh-dd"]],
	["zh-fr", ["zh-fr", "zh-fx"]],
	["zh-tl", ["zh-tl", "zh-tp"]],
	["zir", ["zir", "scv"]],
	["zkb", ["zkb", "kjh"]],
	["zko", ["zko", "xss"]],
	["zom", ["zom", "yos"]],
]);

/** @typedef {{ range: string, weight: number }} WeightedLanguageRange */

/**
 * @typedef {object} LocaleMatch
 * @property {"none"|"exact"|"canonical"|"cldr-fallback"|"likely-subtag"|"extended-range"|"primary-language"|"wildcard"} matchType
 * @property {string | null} locale
 * @property {boolean} isMatch
 * @property {string} fallbackLocale
 * @property {string[]} consideredLocales
 * @property {number | null} effectiveWeight
 * @property {string | null} languageRange
 * @property {WeightedLanguageRange[]} requestedLanguageRanges
 */

/**
 * Plan 3.2's `TiebreakerMap`, in either accepted shape and read-only in both. The arrays are
 * `readonly` because `createStrings` hands this a frozen snapshot: see `safeTiebreakers` there.
 *
 * @typedef {ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>> | null | undefined} Tiebreakers
 */

const CATEGORY_WILDCARD = 0;
const CATEGORY_PRIMARY_LANGUAGE = 1;
const CATEGORY_LIKELY_SUBTAG = 2;
const CATEGORY_CLDR_FALLBACK = 3;
const CATEGORY_DIRECT_STRUCTURAL = 4;
const CATEGORY_CANONICAL = 5;
const CATEGORY_EXACT = 6;

/**
 * Locale-range specificity, ordered by category first so an arbitrarily long range can never spill
 * into a stronger category. Java also compares two specificities against each other to pick a
 * governing range; with one member there is nothing to compare, so only the category predicates
 * survive the reduction.
 *
 * @typedef {object} Specificity
 * @property {number} category
 * @property {number} structuralDepth
 * @property {number} fallbackDistance
 */

/**
 * @param {number} category
 * @param {number} structuralDepth
 * @param {number} fallbackDistance
 * @returns {Specificity}
 */
function specificity(category, structuralDepth, fallbackDistance) {
	return { category, structuralDepth, fallbackDistance };
}

/** @param {Specificity} value */
function isAnchor(value) {
	return value.category > CATEGORY_LIKELY_SUBTAG;
}

/** @param {Specificity} value */
function isHeuristic(value) {
	return value.category === CATEGORY_LIKELY_SUBTAG || value.category === CATEGORY_PRIMARY_LANGUAGE;
}

/** @param {Specificity} value */
function isEligibleForExclusion(value) {
	return value.category === CATEGORY_DIRECT_STRUCTURAL || value.category === CATEGORY_CANONICAL ||
		value.category === CATEGORY_EXACT;
}

/**
 * Java's `String#compareTo`, which JavaScript's relational operators already reproduce for the
 * BMP-only tags CLDR uses. Sorting supported locales by this order is observable through
 * `consideredLocales` and through every "first candidate wins" tie-break.
 *
 * EXPORTED because `createStrings` sorts the same list for the same reason — Java's
 * `Comparator.comparing(Locale::toLanguageTag)` at `DefaultStrings.java:304-314`. It had a private
 * copy; a second spelling of one Java comparator is a divergence waiting to happen in a place the
 * corpus cannot see, because a reordering only changes an answer when two catalogs tie.
 *
 * @param {string} first
 * @param {string} second
 */
export function compareTags(first, second) {
	return first < second ? -1 : first > second ? 1 : 0;
}

/**
 * The loaded locale set in the order Java holds it: a `Map` key set (so duplicate-free) sorted by
 * `Locale#toLanguageTag`. `consideredLocales` reports this list verbatim, so both properties are
 * observable.
 *
 * @param {Iterable<string>} supported
 * @returns {string[]}
 */
function sortedSupportedTags(supported) {
	return [...new Set(supported)].sort(compareTags);
}

/** @param {string} value */
function lower(value) {
	return value.toLowerCase();
}

/**
 * @param {string} first
 * @param {string} second
 */
function equalsIgnoreCase(first, second) {
	return first.toLowerCase() === second.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Contract surface
// ---------------------------------------------------------------------------------------------

/**
 * Canonical BCP-47 form, reproducing the loader's selective rewriting: JDK legacy codes
 * (`iw`→`he`, `in`→`id`, `ji`→`yi`), grandfathered tags (`i-klingon`→`tlh`), the extlang collapse
 * (`zh-cmn`→`cmn`), and subtag casing (`nb-no`→`nb-NO`). CLDR aliases are deliberately NOT applied:
 * `mo` stays `mo`.
 *
 * @param {string} tag
 * @returns {string}
 * @throws {RangeError} if the tag is not well-formed BCP-47
 */
export function normalizeTag(tag) {
	if (typeof tag !== "string" || tag.length === 0)
		throw new RangeError("A locale tag must be a non-empty string");

	const parts = parseJdkTag(tag);

	if (!parts.wellFormed)
		throw new RangeError(`Locale tag '${tag}' is not a well-formed IETF BCP 47 locale`);

	return renderJdkTag(parts);
}

/**
 * The normalized primary language of a tag, or `""` when it has none (undetermined and private-use
 * tags). This is Java's `LocaleUtils.normalizedLanguage`: it canonicalizes the whole tag through
 * CLDR first, so compound aliases such as `aa-Saaho` → `ssy` resolve as well as one-subtag ones.
 *
 * @param {string} tag
 * @returns {string}
 */
export function primaryLanguage(tag) {
	const jdkTag = jdkLanguageTag(tag);
	const parts = parseJdkTag(tag);
	let language = parts.extlangs.length > 0 ? (parts.extlangs[0] ?? "") : parts.language;

	if (language === "und") language = "";
	if (language.length === 0 || language === "*") return "";

	return languageForCanonicalTag(canonicalLanguageTag(jdkTag));
}

/**
 * @param {string} canonicalTag
 * @returns {string}
 */
function languageForCanonicalTag(canonicalTag) {
	const lowered = canonicalTag.toLowerCase();

	if (lowered === "x" || lowered.startsWith("x-")) return "";

	const separatorIndex = canonicalTag.indexOf("-");
	const language = separatorIndex < 0 ? canonicalTag : canonicalTag.slice(0, separatorIndex);

	if (language.length === 0 || language.toLowerCase() === "und") return "";

	return language;
}

/**
 * The CLDR parent walk from `tag`, excluding the tag itself and excluding `root`.
 *
 * This is the whole walk lokalized-java calls `fallbackLocalesFor`, not just the explicit
 * parentLocales edges: declared parents, then subtag truncation that stops at a likely-script
 * boundary, then the tag's CLDR-canonical form and its parents, plus the Norwegian macrolanguage
 * bridge (`nb` <-> `no`). `candidateChain` seeds itself from exactly this list.
 *
 * @param {string} tag
 * @returns {string[]}
 */
export function parentChain(tag) {
	const normalized = normalizeTag(tag);
	return fallbackLocaleTagsFor(normalized).filter((candidate) => candidate !== normalized);
}

/**
 * Likely-subtags maximization to a full language-script-region triple.
 *
 * @param {string} tag
 * @returns {string}
 * @throws {RangeError} if the tag cannot be maximized
 */
export function maximize(tag) {
	const normalized = normalizeTag(tag);
	const maximized = likelySubtagFor(normalized);

	if (maximized === null)
		throw new RangeError(`Locale tag '${tag}' has no likely-subtag maximization`);

	return maximized;
}

// ---------------------------------------------------------------------------------------------
// Language-range statics
// ---------------------------------------------------------------------------------------------

/**
 * Removes noninitial wildcard subtags, which RFC 4647 ignores during extended filtering.
 * @param {string} range
 */
function normalizedExtendedLanguageRange(range) {
	const subtags = javaSplit(range);
	let normalized = subtags[0] ?? "";

	for (let index = 1; index < subtags.length; ++index)
		if (subtags[index] !== "*") normalized += "-" + (subtags[index] ?? "");

	return normalized;
}

/** @param {string} range */
function structuralConstraintCountFor(range) {
	let constraintCount = 0;
	let subtagStart = 0;

	for (let index = 0; index <= range.length; ++index) {
		if (index < range.length && range.charAt(index) !== "-") continue;
		if (!(index - subtagStart === 1 && range.charAt(subtagStart) === "*")) ++constraintCount;
		subtagStart = index + 1;
	}

	return constraintCount;
}

/** @param {string} range */
function canonicalLanguageRangeIdentity(range) {
	return lower(range.includes("*") ? range : canonicalLanguageTag(range));
}

/** @param {string} subtag */
function isAlphabeticSubtag(subtag) {
	return /^[A-Za-z]+$/.test(subtag);
}

/**
 * The BCP-47 extlang form `Locale#forLanguageTag` materializes, when the conversion is lossless and
 * the result is a tag CLDR knows.
 * @param {string} range
 * @returns {string | null}
 */
function extlangEquivalentLanguageRangeFor(range) {
	if (range.includes("*")) return null;

	const subtags = javaSplit(range);
	const first = subtags[0] ?? "";
	const second = subtags[1] ?? "";

	if (subtags.length < 2 || (first.length !== 2 && first.length !== 3) || !isAlphabeticSubtag(first) ||
		second.length !== 3 || !isAlphabeticSubtag(second))
		return null;

	let candidate = lower(second);

	for (let index = 2; index < subtags.length; ++index) candidate += "-" + (subtags[index] ?? "");

	if (!isKnownLanguageTag(candidate) || !equalsIgnoreCase(jdkLanguageTag(range), candidate)) return null;

	return candidate;
}

/**
 * `DefaultStrings#addParsedLanguageRangeIdentities`, whose body is `LanguageRange.parse(range)` — so
 * this is the JDK's IANA equivalence expansion, not a CLDR alias lookup.
 *
 * The DEFAULT resolver is the reduced inline table read by exact lookup, which is all the locale
 * ingress can ever need: the ranges `matchFor` builds are normalized locale tags, so the entries
 * dropped from the table are unreachable from it. `lokalized/negotiate` supplies the full pinned
 * closure instead, because a RAW RFC 4647 range is not a normalized tag and reaches entries this
 * table does not carry. Two corpus cases prove that is not hypothetical: `no-bok-no` expands through
 * `no-bok -> nb` and `sgn-be-fr-x-a` through `sgn-be-fr -> sfb`, and neither key survives the
 * reduction.
 *
 * @typedef {(range: string) => readonly string[] | null} RangeEquivalentResolver
 */

/** @type {RangeEquivalentResolver} */
const REDUCED_RANGE_EQUIVALENTS = (range) => IANA_RANGE_EQUIVALENTS.get(lower(range)) ?? null;

/**
 * @param {string} range
 * @param {Set<string>} identities
 * @param {RangeEquivalentResolver} rangeEquivalents
 */
function addParsedLanguageRangeIdentities(range, identities, rangeEquivalents) {
	for (const equivalent of rangeEquivalents(range) ?? [range]) identities.add(lower(equivalent));
}

/**
 * @param {string} range
 * @param {RangeEquivalentResolver} rangeEquivalents
 * @returns {Set<string>}
 */
function languageRangeIdentitiesFor(range, rangeEquivalents) {
	/** @type {Set<string>} */
	const identities = new Set([lower(range)]);
	addParsedLanguageRangeIdentities(range, identities, rangeEquivalents);

	const extlangEquivalentRange = extlangEquivalentLanguageRangeFor(range);

	if (extlangEquivalentRange !== null) {
		identities.add(lower(extlangEquivalentRange));
		addParsedLanguageRangeIdentities(extlangEquivalentRange, identities, rangeEquivalents);
	}

	return identities;
}

/** @param {string} range */
function recognizedLanguageTagConstraintCountFor(range) {
	if (!isKnownLanguageTag(range)) return 1;

	const parts = parseJdkTag(canonicalLanguageTag(range));
	let language = parts.extlangs.length > 0 ? (parts.extlangs[0] ?? "") : parts.language;

	if (language === "und") language = "";

	let constraintCount = language.length === 0 ? 0 : 1;

	if (parts.script.length > 0) ++constraintCount;
	if (parts.region.length > 0) ++constraintCount;

	return Math.max(constraintCount, 1);
}

/**
 * @param {string} range
 * @param {boolean} knownTag
 * @param {boolean} containsWildcard
 * @param {Set<string>} equivalentRanges
 * @returns {string}
 */
function semanticLanguageRangeForDerivedMatching(range, knownTag, containsWildcard, equivalentRanges) {
	if (containsWildcard || knownTag) return range;

	const jdkTag = jdkLanguageTag(range);
	let semanticRange = range;
	let jdkSemanticRange = equalsIgnoreCase(semanticRange, jdkTag);
	let knownLanguageTag = false;
	let constraintCount = 1;
	let canonicalStable = canonicalLanguageRangeIdentity(semanticRange) === lower(semanticRange);

	for (const candidateRange of equivalentRanges) {
		const candidateJdkSemanticRange = equalsIgnoreCase(candidateRange, jdkTag);
		const candidateKnownLanguageTag = isKnownLanguageTag(candidateRange);
		const candidateConstraintCount = recognizedLanguageTagConstraintCountFor(candidateRange);
		const candidateCanonicalStable = canonicalLanguageRangeIdentity(candidateRange) === lower(candidateRange);

		if ((candidateJdkSemanticRange && !jdkSemanticRange) ||
			(candidateJdkSemanticRange === jdkSemanticRange &&
				((candidateKnownLanguageTag && !knownLanguageTag) ||
					(candidateKnownLanguageTag === knownLanguageTag &&
						(candidateConstraintCount > constraintCount ||
							(candidateConstraintCount === constraintCount && candidateCanonicalStable && !canonicalStable)))))) {
			semanticRange = candidateRange;
			jdkSemanticRange = candidateJdkSemanticRange;
			knownLanguageTag = candidateKnownLanguageTag;
			constraintCount = candidateConstraintCount;
			canonicalStable = candidateCanonicalStable;
		}
	}

	return semanticRange;
}

/**
 * @typedef {object} MemberStatics
 * @property {string} range
 * @property {number} weight
 * @property {Set<string>} identities
 * @property {boolean} knownTag
 * @property {string} semanticRange
 * @property {string} structuralRange
 * @property {string[]} rangeSubtags
 * @property {number} structuralDepth
 * @property {boolean} privateUse
 * @property {boolean} undetermined
 * @property {boolean} containsWildcard
 * @property {boolean} bareWildcard
 * @property {number} recognizedDepth
 * @property {number} semanticDepth
 * @property {string | null} canonicalRange
 * @property {string[] | null} canonicalRangeSubtags
 * @property {string[] | null} fallbackChainCanonicalTags
 * @property {string | null} requestedLikelyLanguageScript
 * @property {string | null} requestedPrimary
 */

/**
 * @param {string} range
 * @param {number} weight
 * @param {RangeEquivalentResolver} rangeEquivalents
 * @returns {MemberStatics}
 */
function memberStaticsFor(range, weight, rangeEquivalents) {
	const containsWildcard = range.includes("*");
	const structuralRange = normalizedExtendedLanguageRange(range);
	const privateUse = isPrivateUseLanguageTag(range);
	const undetermined = hasUndeterminedLanguage(range);
	const knownTag = isKnownLanguageTag(range);
	const identities = languageRangeIdentitiesFor(range, rangeEquivalents);
	const semanticRange = semanticLanguageRangeForDerivedMatching(range, knownTag, containsWildcard, identities);

	/** @type {MemberStatics} */
	const member = {
		range,
		weight,
		identities,
		knownTag,
		semanticRange,
		structuralRange,
		rangeSubtags: javaSplit(range),
		structuralDepth: structuralConstraintCountFor(structuralRange),
		privateUse,
		undetermined,
		containsWildcard,
		bareWildcard: structuralRange === "*",
		recognizedDepth: recognizedLanguageTagConstraintCountFor(semanticRange),
		semanticDepth: 0,
		canonicalRange: null,
		canonicalRangeSubtags: null,
		fallbackChainCanonicalTags: null,
		requestedLikelyLanguageScript: null,
		requestedPrimary: null,
	};

	if (!containsWildcard && !undetermined && !privateUse) {
		member.semanticDepth = structuralConstraintCountFor(normalizedExtendedLanguageRange(semanticRange));
		const canonicalRange = canonicalLanguageTag(semanticRange);
		member.canonicalRange = canonicalRange;
		member.canonicalRangeSubtags = javaSplit(canonicalRange);
		member.fallbackChainCanonicalTags =
			fallbackLocaleTagsFor(jdkLanguageTag(semanticRange)).map((tag) => canonicalLanguageTag(tag));
		member.requestedLikelyLanguageScript = languageScriptForLikelySubtag(semanticRange);
		member.requestedPrimary = normalizedLanguageCode(javaSplit(semanticRange)[0] ?? "");
	}

	return member;
}

/**
 * @typedef {object} SupportedLocaleStatics
 * @property {string} languageTag
 * @property {string[]} tagSubtags
 * @property {string} canonicalTag
 * @property {string[]} canonicalSubtags
 * @property {boolean} undetermined
 * @property {string | null} likelyLanguageScript
 * @property {string | null} normalizedLanguage
 */

/**
 * @param {string} languageTag
 * @returns {SupportedLocaleStatics}
 */
function supportedLocaleStaticsFor(languageTag) {
	const canonicalTag = canonicalLanguageTag(languageTag);
	const normalizedLanguage = primaryLanguage(languageTag);

	return {
		languageTag,
		tagSubtags: javaSplit(languageTag),
		canonicalTag,
		canonicalSubtags: javaSplit(canonicalTag),
		undetermined: hasUndeterminedLanguage(languageTag),
		likelyLanguageScript: languageScriptForLikelySubtag(languageTag),
		normalizedLanguage: normalizedLanguage.length === 0 ? null : normalizedLanguage,
	};
}

/**
 * `DefaultStrings#normalizedLanguageCode` (DefaultStrings.java:2669).
 *
 * The empty string falls through to `lower(languageCode)`, which is Java's: `Locale.forLanguageTag("")`
 * is `Locale.ROOT`, whose normalized language is absent, so `orElse` hands back what it was given.
 *
 * EXPORTED because `createStrings`'s fallback resolution needs the identical function — Java calls
 * this same method at `DefaultStrings.java:446-470` — and had a private copy of it.
 *
 * @param {string} languageCode
 * @returns {string}
 */
export function normalizedLanguageCode(languageCode) {
	const normalized = primaryLanguage(languageCode);
	return lower(normalized.length === 0 ? languageCode : normalized);
}

// ---------------------------------------------------------------------------------------------
// RFC 4647 extended filtering
// ---------------------------------------------------------------------------------------------

/**
 * @param {string[]} rangeSubtags
 * @param {string[]} tagSubtags
 * @returns {boolean}
 */
function structurallyMatchesSubtags(rangeSubtags, tagSubtags) {
	const firstRange = rangeSubtags[0] ?? "";
	const firstTag = tagSubtags[0] ?? "";

	if (firstRange !== "*" && !equalsIgnoreCase(firstRange, firstTag)) return false;

	let rangeIndex = 1;
	let tagIndex = 1;

	while (rangeIndex < rangeSubtags.length) {
		const rangeSubtag = rangeSubtags[rangeIndex] ?? "";

		if (rangeSubtag === "*") {
			++rangeIndex;
			continue;
		}

		if (tagIndex >= tagSubtags.length) return false;

		const tagSubtag = tagSubtags[tagIndex] ?? "";

		if (equalsIgnoreCase(rangeSubtag, tagSubtag)) {
			++rangeIndex;
			++tagIndex;
		} else if (tagSubtag.length === 1) {
			return false;
		} else {
			++tagIndex;
		}
	}

	return true;
}

/**
 * @param {string} range
 * @param {string[]} tags
 * @returns {string[]}
 */
function structurallyFilteredLocales(range, tags) {
	const rangeSubtags = javaSplit(range);
	return tags.filter((tag) => structurallyMatchesSubtags(rangeSubtags, javaSplit(tag)));
}

/**
 * @param {string | null} requestedLanguageScript
 * @param {string | null} availableLanguageScript
 */
function compatibleLikelyScripts(requestedLanguageScript, availableLanguageScript) {
	return requestedLanguageScript === null || availableLanguageScript === null ||
		equalsIgnoreCase(requestedLanguageScript, availableLanguageScript);
}

// ---------------------------------------------------------------------------------------------
// Tiebreakers
// ---------------------------------------------------------------------------------------------

/**
 * Normalizes a caller-supplied tiebreaker map and derives the identity entries Java's constructor
 * adds for every language code with exactly one loaded locale.
 *
 * EXPORTED because `createStrings` walks the SAME map to resolve its configured fallback locale to
 * a loaded catalog (`DefaultStrings.java:446-470` reads the map `:395-444` builds). It had a private
 * copy, and a divergence between the two would resolve the fallback to a catalog that per-lookup
 * resolution never consults — a defect invisible to the corpus, which spells every tiebreaker
 * canonically. `sortedSupported` need not in fact be sorted: the order is read only by the identity
 * synthesis below, which fires only for a language code carried by exactly one loaded locale.
 *
 * @param {Tiebreakers} tiebreakers
 * @param {string[] | readonly string[]} sortedSupported
 * @returns {Map<string, string[]>}
 */
export function resolveTiebreakers(tiebreakers, sortedSupported) {
	/** @type {Map<string, string[]>} */
	const resolved = new Map();

	/** @type {[string, string[]][]} */
	const entries = tiebreakers instanceof Map
		? [...tiebreakers.entries()]
		: tiebreakers == null ? [] : Object.entries(tiebreakers);

	for (const [languageCode, locales] of entries) {
		const normalized = primaryLanguage(languageCode);
		// The TAGS are normalized too, not just the language-code key. They are compared against
		// `sortedSupported`, which holds already-normalized tags, so a caller who writes `en-gb`
		// rather than `en-GB` previously got a tiebreaker that passed construction validation and
		// then never matched anything — resolution silently fell through to a different order and
		// returned a different catalog's translation. Java has no such gap: it stores
		// `Locale.forLanguageTag(...)` values, so the comparison is normalized on both sides.
		//
		// Lenient on purpose: a tag too malformed to normalize is kept verbatim so it simply fails to
		// match, which is what it did before. Rejecting it belongs to construction-time validation,
		// not to the matcher.
		resolved.set(
			normalized.length === 0 ? lower(languageCode) : normalized,
			locales.map((tag) => {
				try {
					return normalizeTag(tag);
				} catch {
					return tag;
				}
			}),
		);
	}

	/** @type {Map<string, string[]>} */
	const supportedByLanguage = new Map();

	for (const supportedTag of sortedSupported) {
		const languageCode = primaryLanguage(supportedTag);
		if (languageCode.length === 0) continue;
		const existing = supportedByLanguage.get(languageCode);
		if (existing === undefined) supportedByLanguage.set(languageCode, [supportedTag]);
		else existing.push(supportedTag);
	}

	for (const [languageCode, locales] of supportedByLanguage)
		if (locales.length === 1 && !resolved.has(languageCode)) resolved.set(languageCode, [...locales]);

	return resolved;
}

/**
 * @param {string} languageCode
 * @param {string[]} candidates
 * @param {Map<string, string[]>} tiebreakers
 * @returns {string | null}
 */
function lookupMatchByTiebreakers(languageCode, candidates, tiebreakers) {
	const ordered = tiebreakers.get(languageCode);

	if (ordered !== undefined)
		for (const tiebreaker of ordered)
			if (candidates.includes(tiebreaker)) return tiebreaker;

	return null;
}

/**
 * @param {string} range
 * @param {string[]} candidates
 * @param {string} fallbackLocale
 * @param {Map<string, string[]>} tiebreakers
 * @returns {string | null}
 */
function preferredLocaleForRange(range, candidates, fallbackLocale, tiebreakers) {
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return candidates[0] ?? null;

	const canonicalRange = canonicalLanguageTag(range);
	const primary = normalizedLanguageCode(javaSplit(canonicalRange)[0] ?? "");
	const tiebreakerMatch = lookupMatchByTiebreakers(primary, candidates, tiebreakers);

	if (tiebreakerMatch !== null) return tiebreakerMatch;
	if (candidates.includes(fallbackLocale)) return fallbackLocale;

	return candidates[0] ?? null;
}

/**
 * `DefaultStrings:1955`. A bare or leading wildcard expresses no language preference of its own, so
 * the CONFIGURED fallback speaks for the caller: the fallback locale itself when it survived, then —
 * when it was excluded — the fallback LANGUAGE's configured tiebreakers, before any unrelated
 * language. Deliberately not `preferredLocaleForRange`, which consults the RANGE's own language and
 * would consult `*`.
 *
 * @param {string[]} availableLocales already restricted to the winning quality
 * @param {string} fallbackLocale
 * @param {Map<string, string[]>} tiebreakers
 * @returns {string}
 */
function preferredLocaleForWildcard(availableLocales, fallbackLocale, tiebreakers) {
	if (availableLocales.length === 0) throw new RangeError("At least one available locale is required");
	if (availableLocales.includes(fallbackLocale)) return fallbackLocale;

	const fallbackLanguage = primaryLanguage(fallbackLocale);
	const tiebreakerMatch = fallbackLanguage.length === 0
		? null
		: lookupMatchByTiebreakers(fallbackLanguage, availableLocales, tiebreakers);

	return tiebreakerMatch ?? availableLocales[0] ?? "";
}

/**
 * @param {string} range
 * @param {string[]} availableLocales
 * @param {string} fallbackLocale
 * @param {Map<string, string[]>} tiebreakers
 * @returns {string | null}
 */
function lookupMatchByLikelySubtag(range, availableLocales, fallbackLocale, tiebreakers) {
	if (range.includes("*")) return null;
	if (hasUndeterminedLanguage(range)) return null;

	const likelySubtag = languageScriptForLikelySubtag(range);

	if (likelySubtag === null) return null;

	/** @type {string[]} */
	const matchingLocales = [];

	for (const locale of availableLocales) {
		if (hasUndeterminedLanguage(locale)) continue;
		const availableLikelySubtag = languageScriptForLikelySubtag(locale);
		if (availableLikelySubtag !== null && equalsIgnoreCase(availableLikelySubtag, likelySubtag))
			matchingLocales.push(locale);
	}

	if (matchingLocales.length === 0) return null;
	if (matchingLocales.length === 1) return matchingLocales[0] ?? null;

	const primary = normalizedLanguageCode(javaSplit(range)[0] ?? "");
	const tiebreakerMatch = lookupMatchByTiebreakers(primary, matchingLocales, tiebreakers);

	if (tiebreakerMatch !== null) return tiebreakerMatch;
	if (matchingLocales.includes(fallbackLocale)) return fallbackLocale;

	return matchingLocales[0] ?? null;
}

/**
 * @param {string} range
 * @param {string[]} availableLocales
 * @param {string} fallbackLocale
 * @param {Map<string, string[]>} tiebreakers
 * @returns {string | null}
 */
function lookupMatchByFallbackCandidates(range, availableLocales, fallbackLocale, tiebreakers) {
	if (range.includes("*")) return null;

	const fallbackTags = fallbackLocaleTagsFor(jdkLanguageTag(range));

	for (const candidateTag of fallbackTags)
		for (const locale of availableLocales)
			if (equalsIgnoreCase(locale, candidateTag)) return locale;

	for (const candidateTag of fallbackTags) {
		const equivalentMatches = availableLocales.filter((locale) => equivalentTags(locale, candidateTag));
		const equivalentMatch = preferredLocaleForRange(candidateTag, equivalentMatches, fallbackLocale, tiebreakers);
		if (equivalentMatch !== null) return equivalentMatch;
	}

	return null;
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

/**
 * @param {SupportedLocaleStatics} localeStatics
 * @param {MemberStatics} member
 * @returns {Specificity | null}
 */
function languageRangeSpecificityFor(localeStatics, member) {
	if (member.bareWildcard) return specificity(CATEGORY_WILDCARD, 0, 0);
	if (member.undetermined && !member.privateUse) return null;

	const broadPositiveStructuralRange =
		member.weight > 0 && !member.containsWildcard && member.structuralDepth === 1;

	if (equalsIgnoreCase(localeStatics.languageTag, member.structuralRange))
		return specificity(CATEGORY_EXACT, member.structuralDepth, 0);

	if (member.privateUse && !member.containsWildcard) return null;

	if (structurallyMatchesSubtags(member.rangeSubtags, localeStatics.tagSubtags) && !broadPositiveStructuralRange)
		return specificity(CATEGORY_DIRECT_STRUCTURAL, member.structuralDepth, 0);

	if (member.containsWildcard) return null;

	for (const identity of member.identities)
		if (!equalsIgnoreCase(identity, member.range) && equalsIgnoreCase(localeStatics.languageTag, identity))
			return specificity(CATEGORY_CANONICAL, structuralConstraintCountFor(identity), 0);

	const broadPositiveSemanticRange = member.weight > 0 && member.semanticDepth === 1;
	const canonicalRange = member.canonicalRange ?? "";

	if (equalsIgnoreCase(localeStatics.canonicalTag, canonicalRange))
		return specificity(CATEGORY_CANONICAL, member.semanticDepth, 0);

	if (structurallyMatchesSubtags(member.canonicalRangeSubtags ?? [], localeStatics.canonicalSubtags) &&
		!broadPositiveSemanticRange)
		return specificity(CATEGORY_CANONICAL, member.semanticDepth, 0);

	const fallbackChainCanonicalTags = member.fallbackChainCanonicalTags ?? [];

	for (let index = 0; index < fallbackChainCanonicalTags.length; ++index)
		if (equalsIgnoreCase(localeStatics.canonicalTag, fallbackChainCanonicalTags[index] ?? ""))
			return specificity(CATEGORY_CLDR_FALLBACK, member.semanticDepth, index);

	const availableLanguageScript = localeStatics.undetermined ? null : localeStatics.likelyLanguageScript;

	if (member.requestedLikelyLanguageScript !== null && availableLanguageScript !== null &&
		equalsIgnoreCase(member.requestedLikelyLanguageScript, availableLanguageScript))
		return specificity(CATEGORY_LIKELY_SUBTAG, member.recognizedDepth, 0);

	if (localeStatics.normalizedLanguage !== null && member.requestedPrimary !== null &&
		equalsIgnoreCase(localeStatics.normalizedLanguage, member.requestedPrimary) &&
		compatibleLikelyScripts(member.requestedLikelyLanguageScript, localeStatics.likelyLanguageScript))
		return specificity(CATEGORY_PRIMARY_LANGUAGE, member.semanticDepth, 0);

	return null;
}

/**
 * Re-derives the public match type for the selected locale only. It is deliberately not the
 * internal category: a structural relationship on a wildcard-free range reports its CLDR or
 * likely-subtag nature, never `extended-range`.
 *
 * @param {string} locale
 * @param {MemberStatics} member
 * @param {string} fallbackLocale
 * @param {Map<string, string[]>} tiebreakers
 * @returns {LocaleMatch["matchType"]}
 */
function languageRangeMatchTypeFor(locale, member, fallbackLocale, tiebreakers) {
	const range = member.range;

	if (range === "*") return "wildcard";
	if (equalsIgnoreCase(locale, range)) return "exact";
	if (range.includes("*")) return "extended-range";

	for (const identity of member.identities)
		if (!equalsIgnoreCase(identity, range) && equalsIgnoreCase(locale, identity)) return "canonical";

	const canonicalRange = canonicalLanguageTag(member.semanticRange);

	if (equalsIgnoreCase(canonicalLanguageTag(locale), canonicalRange)) return "canonical";

	const selectedLocaleOnly = [locale];

	if (lookupMatchByFallbackCandidates(member.semanticRange, selectedLocaleOnly, fallbackLocale, tiebreakers) !== null)
		return "cldr-fallback";
	if (lookupMatchByLikelySubtag(member.semanticRange, selectedLocaleOnly, fallbackLocale, tiebreakers) !== null)
		return "likely-subtag";
	if (structurallyFilteredLocales(range, selectedLocaleOnly).length > 0) return "extended-range";

	return "primary-language";
}

// ---------------------------------------------------------------------------------------------
// matchFor
// ---------------------------------------------------------------------------------------------

/**
 * Java's strict single-locale match kernel. Reports the same state as an unmatched result rather
 * than manufacturing a configured-fallback match.
 *
 * THE LOCALE INGRESS, and the only one that normalizes. `LocaleMatcher.java:63-65` builds its single
 * range from `locale.toLanguageTag()`, so the range Java matches on is the NORMALIZED tag lowercased
 * — `sgn-nsl` arrives here as `nsl`, and `languageRange` reports `nsl` because that is genuinely what
 * Java asked for. A caller-supplied RFC 4647 range is a different thing entirely and must keep its
 * raw spelling; that ingress is `matchForRange`, and routing it through this function silently
 * rewrites the caller's range, which changes the reported diagnostic AND (through `memberStaticsFor`)
 * the selected locale.
 *
 * @param {string} requested requested locale tag
 * @param {Iterable<string>} supported loaded locale tags
 * @param {string} fallbackLocale resolved fallback locale tag
 * @param {Tiebreakers} [tiebreakers] language code -> ordered loaded tags
 * @returns {LocaleMatch}
 */
export function matchFor(requested, supported, fallbackLocale, tiebreakers) {
	return matchForRange(lower(normalizeTag(requested)), 1, supported, fallbackLocale, tiebreakers);
}

/**
 * The same kernel over a RAW RFC 4647 language range: the range is taken exactly as the caller
 * spelled it (lowercased, as `Locale.LanguageRange`'s own constructor does) and is never normalized
 * into a locale tag. `memberStaticsFor` is already raw-correct, so this is the whole difference
 * between the two ingresses.
 *
 * It is the single-member reduction of `DefaultStrings#matchFor(List)`: one member means no group
 * election, no cell matrix, and no governor comparison, since a locale that has any relationship at
 * all is governed by the only range there is. The N-member solver is M7 A3.
 *
 * @param {string} range a validated, lowercased RFC 4647 extended language range
 * @param {number} weight the member's quality weight
 * @param {Iterable<string>} supported loaded locale tags
 * @param {string} fallbackLocale resolved fallback locale tag
 * @param {Tiebreakers} [tiebreakers] language code -> ordered loaded tags
 * @param {RangeEquivalentResolver} [rangeEquivalents] the IANA equivalence expansion to use; the
 *   reduced inline table when omitted, which a raw range can outgrow — see the resolver's own note
 * @returns {LocaleMatch}
 */
export function matchForRange(range, weight, supported, fallbackLocale, tiebreakers, rangeEquivalents) {
	const sortedSupported = sortedSupportedTags(supported);
	const resolvedTiebreakers = resolveTiebreakers(tiebreakers, sortedSupported);

	/** @type {WeightedLanguageRange[]} */
	const requestedLanguageRanges = [{ range, weight }];

	/** @returns {LocaleMatch} */
	const noMatch = () => ({
		matchType: "none",
		locale: null,
		isMatch: false,
		fallbackLocale,
		consideredLocales: sortedSupported,
		effectiveWeight: null,
		languageRange: null,
		requestedLanguageRanges,
	});

	const member = memberStaticsFor(range, weight, rangeEquivalents ?? REDUCED_RANGE_EQUIVALENTS);
	const localeStatics = sortedSupported.map((tag) => supportedLocaleStaticsFor(tag));
	const cells = localeStatics.map((statics) => languageRangeSpecificityFor(statics, member));

	// Anchor reservation. A range that owns an anchor must not also spill into a sibling locale
	// related only by likely-subtag or primary-language inference.
	const localeReserved = cells.map((cell) => cell !== null && isAnchor(cell));
	const rangeOwnsAnchor = localeReserved.some((reserved) => reserved);
	const specificHeuristicRange = member.recognizedDepth > 1;
	const restricted = rangeOwnsAnchor || specificHeuristicRange;

	/** @type {string | null} */
	let preferredHeuristicLocale = null;

	if (specificHeuristicRange && !rangeOwnsAnchor) {
		for (const category of [CATEGORY_LIKELY_SUBTAG, CATEGORY_PRIMARY_LANGUAGE]) {
			/** @type {string[]} */
			const candidates = [];

			for (let index = 0; index < sortedSupported.length; ++index) {
				const cell = cells[index];
				if (!localeReserved[index] && cell != null && cell.category === category)
					candidates.push(sortedSupported[index] ?? "");
			}

			const preferred = category === CATEGORY_LIKELY_SUBTAG
				? lookupMatchByLikelySubtag(member.semanticRange, candidates, fallbackLocale, resolvedTiebreakers)
				: preferredLocaleForRange(member.semanticRange, candidates, fallbackLocale, resolvedTiebreakers);

			if (preferred !== null) {
				preferredHeuristicLocale = preferred;
				break;
			}
		}
	}

	// Governor sweep, reduced to one member: a locale survives when it has a relationship at all and
	// a restricted heuristic range has not claimed a different locale.
	/** @type {string[]} */
	const survivors = [];

	for (let index = 0; index < sortedSupported.length; ++index) {
		const cell = cells[index];
		if (cell == null) continue;
		const locale = sortedSupported[index] ?? "";
		if (isHeuristic(cell) && restricted && locale !== preferredHeuristicLocale) continue;
		if (member.weight <= 0 && !isEligibleForExclusion(cell)) continue;
		survivors.push(locale);
	}

	// `DefaultStrings:1780` answers no-match when the highest effective weight is nonpositive, and
	// `:1762` drops any locale whose governing range is. Reduced to one member the two collapse into
	// this: a nonpositive range selects nothing, however strongly a locale is related to it. That is
	// why the `weight <= 0` guard in the sweep above cannot stand alone — it deliberately KEEPS the
	// exclusion-eligible cells, which is how a negative range excludes a locale for a later member,
	// and with no later member to serve them they must not be served here.
	if (survivors.length === 0 || weight <= 0) return noMatch();

	/**
	 * @param {string} locale
	 * @returns {LocaleMatch}
	 */
	const localeMatch = (locale) => ({
		matchType: languageRangeMatchTypeFor(locale, member, fallbackLocale, resolvedTiebreakers),
		locale,
		isMatch: true,
		fallbackLocale,
		consideredLocales: sortedSupported,
		effectiveWeight: weight,
		languageRange: range,
		requestedLanguageRanges,
	});

	// Java's cascade opens with the bare-wildcard branch (`DefaultStrings:1815`). `matchFor(Locale)`
	// can never reach it — a normalized tag contains no `*` — but a caller-supplied range can.
	//
	// KEPT FOR STRUCTURAL FIDELITY, AND MEASURED TO BE INDISTINGUISHABLE HERE. Deleting it changes
	// no corpus answer and no answer this reduction can produce at all: `*` is not undetermined and
	// not private-use, so it falls through to the `containsWildcard` block below, whose structural
	// filter keeps every survivor and whose `primary === "*"` arm calls the same helper with the same
	// list. Java's ordering matters once N members can interleave; with one member the two coincide.
	// Recorded rather than trimmed because a later slice restores the interleaving — and recorded
	// plainly rather than justified, because a branch nothing discriminates must not be described as
	// though something does. `test/negotiate.test.js` pins the answer; the ARM is not what it pins.
	if (range === "*") return localeMatch(preferredLocaleForWildcard(survivors, fallbackLocale, resolvedTiebreakers));

	if (member.undetermined && !member.privateUse) return noMatch();

	// An actual exact localized strings source must win over a canonically equivalent tag.
	for (const locale of survivors)
		if (equalsIgnoreCase(locale, range)) return localeMatch(locale);

	for (const locale of survivors)
		for (const identity of member.identities)
			if (!equalsIgnoreCase(identity, range) && equalsIgnoreCase(locale, identity)) return localeMatch(locale);

	// Noninitial wildcards have RFC 4647 STRUCTURAL semantics only (`DefaultStrings:1836-1852`). An
	// extended range with no structural candidate must not be broadened through canonical, CLDR,
	// likely-subtag or primary-language matching — including a private-use range such as `x-*`, which
	// is why this sits ABOVE the private-use exit rather than below it. Probed independently of
	// quality, exactly as Java probes it.
	if (member.containsWildcard) {
		const filteredCandidates = structurallyFilteredLocales(range, survivors);

		if (filteredCandidates.length === 0) return noMatch();

		const primary = normalizedLanguageCode(javaSplit(range)[0] ?? "");
		const preferred = primary === "*"
			? preferredLocaleForWildcard(filteredCandidates, fallbackLocale, resolvedTiebreakers)
			: preferredLocaleForRange(range, filteredCandidates, fallbackLocale, resolvedTiebreakers)
				?? filteredCandidates[0] ?? "";

		return localeMatch(preferred);
	}

	// Private-use tags have no language semantics to broaden: they select an exact source or nothing.
	if (member.privateUse) return noMatch();

	const canonicalRange = member.canonicalRange ?? "";
	const canonicalMatches = survivors.filter((locale) =>
		equalsIgnoreCase(canonicalLanguageTag(locale), canonicalRange));
	const canonicalMatch = preferredLocaleForRange(canonicalRange, canonicalMatches, fallbackLocale, resolvedTiebreakers);

	if (canonicalMatch !== null) return localeMatch(canonicalMatch);

	const lookupMatch =
		lookupMatchByFallbackCandidates(member.semanticRange, survivors, fallbackLocale, resolvedTiebreakers);

	if (lookupMatch !== null) return localeMatch(lookupMatch);

	const likelySubtagMatch =
		lookupMatchByLikelySubtag(member.semanticRange, survivors, fallbackLocale, resolvedTiebreakers);

	if (likelySubtagMatch !== null) return localeMatch(likelySubtagMatch);

	const primary = member.requestedPrimary ?? "";
	let candidates = survivors.filter((locale) => {
		const normalizedLanguage = primaryLanguage(locale);
		if (normalizedLanguage.length === 0 || !equalsIgnoreCase(normalizedLanguage, primary)) return false;
		return compatibleLikelyScripts(
			languageScriptForLikelySubtag(member.semanticRange), languageScriptForLikelySubtag(locale));
	});

	if (candidates.length === 0) return noMatch();

	const filteredCandidates = structurallyFilteredLocales(range, candidates);

	if (filteredCandidates.length > 0) {
		// Java compares the tag against `Locale#getLanguage()`, not against its normalized language, so
		// a bare `he` counts as "specific" (its stored language is the superseded `iw`).
		const hasSpecificMatch = filteredCandidates.some((locale) => !equalsIgnoreCase(locale, jdkLanguageSubtag(locale)));
		if (hasSpecificMatch) candidates = filteredCandidates;
	}

	if (candidates.length === 1) return localeMatch(candidates[0] ?? "");

	const tiebreakerMatch = lookupMatchByTiebreakers(primary, candidates, resolvedTiebreakers);

	if (tiebreakerMatch !== null) return localeMatch(tiebreakerMatch);

	return localeMatch(candidates[0] ?? "");
}

// ---------------------------------------------------------------------------------------------
// candidateChain
// ---------------------------------------------------------------------------------------------

/**
 * The per-key candidate walk, first-wins deduplicated, in the order resolution must attempt them.
 *
 * This is NOT the matcher. A candidate that is not itself loaded is rewritten to the loaded locale
 * that is canonically equivalent to it, and it is that rewritten tag which is deduplicated and
 * reported — which is why a chain can skip a loaded locale the matcher would have selected.
 *
 * @param {string} lookupTag the locale resolution starts from
 * @param {Iterable<string>} supported loaded locale tags
 * @param {string} fallbackLocale resolved fallback locale tag
 * @param {Tiebreakers} [tiebreakers] language code -> ordered loaded tags
 * @returns {string[]}
 */
export function candidateChain(lookupTag, supported, fallbackLocale, tiebreakers) {
	const locale = normalizeTag(lookupTag);
	const sortedSupported = sortedSupportedTags(supported);
	const supportedSet = new Set(sortedSupported);
	const resolvedTiebreakers = resolveTiebreakers(tiebreakers, sortedSupported);

	/** @type {Set<string>} */
	const candidates = new Set(fallbackLocaleTagsFor(locale));

	const likelySubtagMatch =
		lookupMatchByLikelySubtag(locale, sortedSupported, fallbackLocale, resolvedTiebreakers);

	if (likelySubtagMatch !== null) candidates.add(likelySubtagMatch);

	const languageCode = primaryLanguage(locale);

	if (languageCode.length > 0) {
		const tiebreakerLocales = resolvedTiebreakers.get(languageCode);

		if (tiebreakerLocales !== undefined)
			for (const tiebreakerLocale of tiebreakerLocales)
				if (compatibleLikelyScripts(
					languageScriptForLikelySubtag(locale), languageScriptForLikelySubtag(tiebreakerLocale)))
					candidates.add(tiebreakerLocale);
	}

	candidates.add(fallbackLocale);

	/** @type {string[]} */
	const chain = [];
	/** @type {Set<string>} */
	const seen = new Set();

	for (const candidate of candidates) {
		let attempted = candidate;

		if (!supportedSet.has(candidate)) {
			const equivalentLocales = sortedSupported.filter((locale2) => equivalentTags(locale2, candidate));
			const preferred =
				preferredLocaleForRange(candidate, equivalentLocales, fallbackLocale, resolvedTiebreakers);
			if (preferred !== null) attempted = preferred;
		}

		if (seen.has(attempted)) continue;
		seen.add(attempted);
		chain.push(attempted);
	}

	return chain;
}
