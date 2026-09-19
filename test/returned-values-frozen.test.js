import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createStrings, forLocale, forLocaleMatch } from "../src/core/index.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { chain, fetchSet } from "../src/load/planning.js";
import {
	localeConfigurationForManifest, parseStringsManifest, validateStringsManifest,
} from "../src/load/manifest.js";
import {
	createLocaleNegotiator, forAcceptLanguage, forLanguageRanges, parseLanguageRanges,
} from "../src/negotiate/index.js";
import {
	createStringsManifestFromDirectory, loadEntireManifestFromFiles, loadStringsFromDirectory,
	loadStringsFromFiles, readStringsFromDirectory, readStringsManifest,
} from "../src/node/index.js";
import { parseStrings } from "../src/parse/index.js";
import { createSsrStamp } from "../src/ssr/index.js";

/**
 * PLAN :345 AND :762 — "All returned records and arrays are defensively copied and frozen",
 * "Returned arrays, records, and configuration objects have no mutator methods and are frozen" —
 * ONE LEVEL DOWN, which is where the requirement was false.
 *
 * Top-level returns were frozen and had been for milestones. What nothing had ever walked is what
 * hangs off them: `LocaleMatch` reached a caller with `consideredLocales`, `languageRange` and
 * `requestedLanguageRanges` (and the `{range, weight}` pairs inside it) all writable, and
 * `parseLanguageRanges` returned a plain array of plain objects. 57 reachable unfrozen values
 * across the public accessors, measured before the repair; 0 after.
 *
 * **THE DEFECT HAD TEETH AND THIS IS WHERE THEY WERE, because it is not a per-call copy.** A
 * supplied `{ localeMatch }` is carried through BY REFERENCE into every result derived from it —
 * the negotiate-once-render-many shape the shipped examples and the README's SSR section both
 * use. Measured: two renders from one supplied match share the match object AND its
 * `consideredLocales` array with the negotiator's own return, so one component writing to the
 * array it was handed retroactively changed an ALREADY-RETURNED sibling result and made the next
 * render throw `get({ localeMatch }) supplied a result for different supported locales` — a
 * failure arbitrarily far from its cause. `asserts a supplied match cannot be poisoned in place`
 * below is that scenario, and it is the arm that fails first if the freeze is reverted.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It walks VALUES, so a function member is skipped rather than
 * required frozen — the plan asks for records and arrays and says nothing about the instance's
 * bound methods. And it is an ENUMERATION of doors, so it proves what it reaches: the anti-vacuity
 * arms below exist because "0 unfrozen" is also what a walk that reaches nothing reports, and what
 * a walk that never descends reports.
 */

/** Every reachable value that is not frozen, by path. Functions are members, not data. */
function findUnfrozen(root, rootLabel) {
	const out = [];
	const seen = new Set();
	let visited = 0;

	const visit = (value, path) => {
		if (value === null) return;
		const type = typeof value;
		if (type !== "object" && type !== "function") return;
		if (seen.has(value)) return;
		seen.add(value);
		if (type === "function") return;

		visited += 1;
		if (!Object.isFrozen(value)) out.push(path);

		if (Array.isArray(value)) { value.forEach((element, i) => visit(element, `${path}[${i}]`)); return; }
		if (value instanceof Map) {
			let i = 0;
			for (const [key, entry] of value) { visit(key, `${path}.<key ${i}>`); visit(entry, `${path}.<value ${i}>`); i += 1; }
			return;
		}
		if (value instanceof Set) { let i = 0; for (const member of value) visit(member, `${path}.<member ${i++}>`); return; }

		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			// A getter is not a stored value; reading one could run library code and is not what
			// "returned records are frozen" is about.
			if (!descriptor || !("value" in descriptor)) continue;
			visit(descriptor.value, `${path}.${String(key)}`);
		}
	};

	visit(root, rootLabel);
	return { unfrozen: out, visited };
}

const CATALOGS = new URL("../examples/catalogs/", import.meta.url).pathname;

const directory = mkdtempSync(join(tmpdir(), "lokalized-frozen-"));
cpSync(CATALOGS, directory, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "lokalized-frozen-out-"));
after(() => {
	rmSync(directory, { recursive: true, force: true });
	rmSync(scratch, { recursive: true, force: true });
});

const TIEBREAKERS = { fr: ["fr", "fr-CA"] };

/** Every public door that hands a caller a record or an array, with the value it handed back. */
async function publicReturns() {
	const returns = [];
	const add = (label, value) => returns.push([label, value]);

	const { catalogs, warnings } = readStringsFromDirectory(directory);
	add("readStringsFromDirectory().catalogs", catalogs);
	add("readStringsFromDirectory().warnings", warnings);

	const strings = createStrings(
		{ strings: catalogs, locale: "en", fallbackLocale: "en", tiebreakers: TIEBREAKERS });

	// Each `getResult` arm reaches a DIFFERENT `localeMatch` shape: the automatic direct match, a
	// per-call locale's, a failure's, and a supplied whole-list match's. Before the repair all four
	// carried the same three unfrozen members, so any one of them witnesses the defect — but a
	// later narrowing that froze only one path would pass on a single arm.
	add("getResult(hit)", strings.getResult("App.Title"));
	add("getResult(per-call locale)", strings.getResult("App.Title", {}, forLocale("fr-CA")));
	add("getResult(missing key)", strings.getResult("No.Such.Key"));
	add("getResult(plural placeholder)", strings.getResult("Cart.Items", { count: 3 }));
	add("getSupportedLocales()", strings.getSupportedLocales());
	add("getKeysForLocale()", strings.getKeysForLocale("en"));
	add("getMissingKeys()", strings.getMissingKeys("en", "fr"));
	add("getLocaleConfiguration()", strings.getLocaleConfiguration());
	add("getCatalogIdentity()", strings.getCatalogIdentity());
	add("getLoadVerification()", strings.getLoadVerification());
	add("getWarnings()", strings.getWarnings());
	add("getDirectLocaleContext()", strings.getDirectLocaleContext("fr-CA"));
	add("forLocale()", forLocale("fr-CA"));

	const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());
	const ranges = parseLanguageRanges("fr-CH;q=0.9, en;q=0.4");
	const match = negotiator.matchForLanguageRanges(ranges);
	add("parseLanguageRanges()", ranges);
	add("negotiator.matchFor()", negotiator.matchFor("fr-CH"));
	add("negotiator.matchForLanguageRanges()", match);
	add("forLanguageRanges()", forLanguageRanges(negotiator, ranges));
	add("forAcceptLanguage()", forAcceptLanguage(negotiator, "fr-CH;q=0.9, en;q=0.4"));
	add("forLocaleMatch()", forLocaleMatch(match));
	add("getResult(supplied match)", strings.getResult("App.Title", {}, forLocaleMatch(match)));
	// The unmatched arm: `forAcceptLanguage` answers a diagnostic whose own `locale` is null, which
	// is a different `LocaleMatch` construction site (`noMatch()`) from every arm above.
	add("forAcceptLanguage(unmatched)", forAcceptLanguage(negotiator, "de"));

	add("parseStrings()", parseStrings(JSON.stringify({ K: "v" }), { locale: "en" }));

	const manifest = await createStringsManifestFromDirectory(
		directory, { catalogVersion: "1", fallbackLocale: "en", tiebreakers: TIEBREAKERS });
	// The manifest is written OUTSIDE the catalog directory on purpose: `readStringsFromDirectory`
	// refuses `manifest.json` as a filename that is not a language tag, so dropping it beside the
	// catalogs would make every later arm in this file fail for an unrelated reason.
	const manifestPath = join(scratch, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest));

	add("createStringsManifestFromDirectory()", manifest);
	add("readStringsManifest()", await readStringsManifest(manifestPath));
	add("parseStringsManifest()", parseStringsManifest(JSON.stringify(manifest)));
	add("validateStringsManifest()", validateStringsManifest(manifest));
	add("localeConfigurationForManifest()", localeConfigurationForManifest(manifest));
	add("computeCatalogIdentity()", computeCatalogIdentity({
		formatVersion: 1,
		catalogVersion: manifest.catalogVersion,
		resolvedFallbackLocale: manifest.fallbackLocale,
		localeToSha256: Object.fromEntries(
			Object.entries(manifest.files).map(([locale, file]) => [locale, file.sha256])),
		tiebreakers: manifest.tiebreakers,
	}));
	add("chain()", chain(manifest, "fr-CA"));
	add("fetchSet()", fetchSet(manifest, "fr-CA"));

	const whole = await loadStringsFromDirectory(
		directory, { catalogVersion: "1", fallbackLocale: "en", tiebreakers: TIEBREAKERS });
	add("loadStringsFromDirectory()", whole);
	add("loadStringsFromFiles()", await loadStringsFromFiles(manifest, "fr-CA"));
	add("loadEntireManifestFromFiles()", await loadEntireManifestFromFiles(manifest));

	const loaded = createStrings({ loaded: whole, locale: "en" });
	add("loaded: getLoadVerification()", loaded.getLoadVerification());
	add("loaded: getCatalogIdentity()", loaded.getCatalogIdentity());
	add("loaded: getLocaleConfiguration()", loaded.getLocaleConfiguration());
	add("loaded: getWarnings()", loaded.getWarnings());

	const loadedNegotiator = createLocaleNegotiator(loaded.getLocaleConfiguration());
	add("createSsrStamp()", createSsrStamp(
		loaded, { kind: "locale-match", localeMatch: loadedNegotiator.matchFor("fr-CA") }));

	return returns;
}

test("every value reachable from a public return is frozen", async () => {
	const failures = [];
	let visited = 0;
	let doors = 0;

	for (const [label, value] of await publicReturns()) {
		const walk = findUnfrozen(value, label);
		visited += walk.visited;
		doors += 1;
		failures.push(...walk.unfrozen);
	}

	// ANTI-VACUITY, TERM 1: the walk must have REACHED something. "0 unfrozen" is also what an
	// enumeration that resolved to nothing reports, which is how a green gate over an empty graph
	// happens. FLOORS, not exact counts, set below today's MEASURED numbers — 40 doors and 549
	// values on the repaired tree — so that adding a door or a catalog key does not red this file.
	assert.ok(doors >= 36, `only ${doors} public doors were walked — the enumeration collapsed`);
	assert.ok(visited >= 480, `the walk reached only ${visited} values — it is not walking the graph`);

	assert.deepEqual(failures, [], `values reachable from a public return are not frozen:\n  ${failures.join("\n  ")}`);
});

test("the walk DESCENDS: an unfrozen value under a frozen record is caught", () => {
	// ANTI-VACUITY, TERM 2, AND IT IS THE DEFECT'S OWN SHAPE. A walker that checked only the value
	// it was handed reports 0 on the repaired tree AND reported 0 on the broken one, because every
	// top-level return was already frozen — the requirement was false exactly one level down. So
	// the arm that matters is not "does it notice an unfrozen object" but "does it notice one
	// behind a frozen one", at each depth the real defect occupied.
	const planted = Object.freeze({
		localeMatch: Object.freeze({
			consideredLocales: ["en", "fr"],                       // depth 2, the real defect
			requestedLanguageRanges: Object.freeze([{ range: "fr", weight: 1 }]), // depth 3, ditto
			languageRange: { range: "fr", weight: 1 },             // depth 2, ditto
		}),
	});

	const { unfrozen, visited } = findUnfrozen(planted, "planted");
	assert.ok(visited >= 6, "the planted fixture itself is not being walked");
	assert.deepEqual(unfrozen.sort(), [
		"planted.localeMatch.consideredLocales",
		"planted.localeMatch.languageRange",
		"planted.localeMatch.requestedLanguageRanges[0]",
	]);

	// And the mirror: an all-frozen fixture of the same shape must report NOTHING, or the detector
	// is answering "unfrozen" to everything and the arm above proves nothing.
	const clean = Object.freeze({
		localeMatch: Object.freeze({
			consideredLocales: Object.freeze(["en", "fr"]),
			requestedLanguageRanges: Object.freeze([Object.freeze({ range: "fr", weight: 1 })]),
			languageRange: Object.freeze({ range: "fr", weight: 1 }),
		}),
	});
	assert.deepEqual(findUnfrozen(clean, "clean").unfrozen, []);
});

test("a supplied match cannot be poisoned in place", async () => {
	// THE CONSEQUENCE ARM. Freezing a per-call copy would be a contract repair with nothing behind
	// it; this is the case where the object is SHARED, and it is the library's own recommended
	// shape — negotiate once, render many. Before the repair, the writes below all succeeded, the
	// already-returned `second` changed underneath its holder, and the third render threw.
	const { catalogs } = readStringsFromDirectory(directory);
	const strings = createStrings(
		{ strings: catalogs, locale: "en", fallbackLocale: "en", tiebreakers: TIEBREAKERS });
	const negotiator = createLocaleNegotiator(strings.getLocaleConfiguration());

	const match = negotiator.matchFor("fr-CH");
	const options = forLocaleMatch(match);
	const first = strings.getResult("App.Title", {}, options);
	const second = strings.getResult("Cart.Items", { count: 2 }, options);

	// The sharing is the premise, and it is asserted rather than assumed: if a future change made
	// this a per-call copy, the writes below would stop being interesting and this arm would be
	// silently testing nothing.
	assert.equal(first.localeMatch, second.localeMatch, "the premise is gone: the match is no longer shared");
	assert.equal(first.localeMatch.consideredLocales, match.consideredLocales);

	assert.throws(() => first.localeMatch.consideredLocales.push("zz-injected"), TypeError);
	assert.throws(() => { first.localeMatch.consideredLocales[0] = "overwritten"; }, TypeError);
	assert.throws(() => { first.localeMatch.locale = "hijacked"; }, TypeError);
	assert.throws(() => first.localeMatch.requestedLanguageRanges.push({ range: "zz", weight: 1 }), TypeError);

	// …and the third render, which used to throw `supplied a result for different supported
	// locales` because a sibling had grown the shared array, still answers what the first did.
	assert.equal(strings.getResult("App.Title", {}, options).translation, first.translation);
	assert.deepEqual([...second.localeMatch.consideredLocales], [...match.consideredLocales]);
});

test("parseLanguageRanges hands back a list the caller cannot reorder", () => {
	// Its own case, because the member ORDER is the contract here — plan 3.4 compares
	// `requestedLanguageRanges` field for field, and `sort` mutates in place, so a caller sorting
	// the list it was given was the likeliest way to break the next match it fed the list to.
	const ranges = parseLanguageRanges("fr-CH;q=0.9, en;q=0.4");
	assert.ok(ranges.length >= 2, "the fixture stopped producing a multi-member list");
	assert.throws(() => ranges.sort(), TypeError);
	assert.throws(() => ranges.push({ range: "zz", weight: 1 }), TypeError);
	assert.throws(() => { ranges[0].weight = 0; }, TypeError);
});
