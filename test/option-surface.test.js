import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { pluralOperands } from "../src/index.js";
import { chooseBrowserLocale, chooseLocaleForPreferredLanguages, createStrings } from "../src/core/index.js";
import { mergeParsedStringsFiles, parseStrings } from "../src/parse/index.js";
import { resolveLimits } from "../src/internal/catalog.js";
import {
  chain, fetchSet, loadEntireManifest, loadStrings, localeConfigurationForManifest, parseStringsManifest,
  validateStringsManifest,
} from "../src/load/index.js";
import { createLocaleNegotiator, forLanguageRanges, parseLanguageRanges } from "../src/negotiate/index.js";
import {
  createStringsManifestFromDirectory, loadEntireManifestFromFiles, loadStringsFromDirectory,
  loadStringsFromFiles, readStringsFromDirectory, readStringsManifest,
} from "../src/node/index.js";

/**
 * **EVERY PUBLIC DOOR REFUSES AN OPTION IT DOES NOT KNOW, AND THIS FILE IS THE RECORD OF THE
 * DECISION THAT MADE IT SO.** How many doors that is is not written here, because the number this
 * sentence used to state — twelve — was wrong twice: M-D S33's own ablations found two more, and
 * deriving the set from the published declarations (the classification test below) found nine more
 * after that. The set is compared against that derivation now rather than counted.
 *
 * Until M-D S33 every one of them IGNORED an unknown member in silence, and this file pinned that
 * instead. The behaviour was found four times, one door at a time, each as a live defect in
 * something else: `createStrings({ limits })` running under the defaults (M-D S12),
 * `loadStrings(…, { transport })` ignoring an injected transport and going to THE REAL NETWORK
 * (M-D S15), `createStringsManifestFromDirectory({ baseUrl })` emitting a manifest the Fetch door
 * then refuses (M9 S1), and `resolveLimits` reading seven named members where Java's
 * `LoadDiff.optionsFrom` throws (M-D S17). M-D S25 measured it as ONE property across the whole
 * surface and pinned it so the decision would be one visible diff. The maintainer took it.
 *
 * **THE TESTS BELOW ARE THE SAME THREE, INVERTED.** They were written to make this change cheap, so
 * the inversion is the mechanism working rather than churn — and each keeps its baseline half, which
 * is what stops "the door refused" being satisfied by a door that refuses everything.
 *
 * **WHAT A NAIVE IMPLEMENTATION COSTS, measured, because the number is the argument for the shape
 * this one has.** Refusing at each door while leaving the INTERNAL forwards wholesale reds 270 tests
 * — 130 of them `validateStringsManifest does not take the option(s) [fetch]`, a door refusing its
 * own caller for using that caller's documented option. Six call sites had to be projected to the
 * callee's surface. One of them, `loadStringsFromDirectory`, needed TWO projections and an explicit
 * `fetch`/`request` arm: projecting only the file half drops `fetch` before it can reach
 * `FILE_TRANSPORT.preflight`, so a call refused today would LOAD SILENTLY, and the whole suite stays
 * green over it.
 *
 * **A SOURCE DERIVATION WAS TRIED AND IS UNSOUND, which is why the door SET is derived from the
 * DECLARATIONS instead and each door's behaviour is measurement.**
 * Scanning `options.<name>` reports `src/core` as accepting twelve options and misses `strings`,
 * `loaded`, `loadingLimits`, `tiebreakers` and `catalogIdentity`, because `createStrings` reaches
 * its options through five spellings — a plain read, an aliased `direct.x`, a cast-parenthesised
 * `(options).x` whose `)` breaks the anchor, a computed index, and a symbol. It also reports
 * `src/negotiate` as accepting `test`, from a regular expression.
 */
const BOGUS = "zzUnknownOptionZZ";

/**
 * What each door accepts, transcribed from the constant each door declares in `src/`.
 *
 * DELIBERATELY A SECOND COPY rather than an import: the point of the near-miss rules below is to
 * catch a message that offers a remedy the door does not honour, and deriving both sides from the
 * same constant would make that comparison a tautology.
 *
 * **HELD TO `src/` BY THE REFUSAL ITSELF, and this sentence used to claim something weaker was
 * enough.** It said the bogus-name sweep held the table to the real surface. That sweep only ever
 * sends one invented name, so dropping `request`, `bidiIsolation`, `onFallback` or `compactExponent`
 * from a door in `src/` left this file 10/10 — measured by a review on 2026-09-23; other files
 * happened to catch each one. Every refusal ends "It takes […]" with the door's own accepted list, so
 * a test below compares this table to that list, door by door, in both directions.
 */
const ACCEPTS = /** @type {Record<string, readonly string[]>} */ ({
  createStrings: ["strings", "fallbackLocale", "locale", "tiebreakers", "loadingLimits",
    "runtimeLimits", "loaded", "catalogIdentity", "onWarning", "pluralData", "phoneticResolver",
    "bidiIsolation", "fallbackPolicy", "onFailure", "onFallback", "localeResolver",
    "localeMatchResolver"],
  parseStrings: ["locale", "source", "limits", "onWarning", "pluralData"],
  mergeParsedStringsFiles: ["limits"],
  parseStringsManifest: ["limits", "source"],
  validateStringsManifest: ["limits"],
  localeConfigurationForManifest: ["limits"],
  loadStrings: ["fetch", "limits", "partialFailure", "request", "signal"],
  loadEntireManifest: ["fetch", "limits", "partialFailure", "request", "signal"],
  readStringsFromDirectory: ["limits", "maximumDiscoveryEntries", "onWarning", "pluralData"],
  createStringsManifestFromDirectory: ["catalogVersion", "fallbackLocale", "limits",
    "maximumDiscoveryEntries", "publicationBaseUrl", "tiebreakers"],
  loadStringsFromDirectory: ["catalogVersion", "fallbackLocale", "limits",
    "maximumDiscoveryEntries", "partialFailure", "readFile", "signal", "tiebreakers"],
  loadStringsFromFiles: ["limits", "partialFailure", "readFile", "signal"],
  loadEntireManifestFromFiles: ["limits", "partialFailure", "readFile", "signal"],
  readStringsManifest: ["limits", "signal"],
  createLocaleNegotiator: ["fallbackLocale", "supportedLocales", "tiebreakers"],
  chooseLocaleForPreferredLanguages: ["fallbackLocale", "supportedLocales", "tiebreakers"],
  chooseBrowserLocale: ["fallbackLocale", "supportedLocales", "tiebreakers"],
  pluralOperands: ["visibleDecimalPlaces", "compactExponent"],
  get: ["locale", "localeMatch", "bidiIsolation", "fallbackPolicy", "onFailure", "onFallback"],
  t: ["locale", "localeMatch", "bidiIsolation", "fallbackPolicy", "onFailure", "onFallback"],
  getResult: ["locale", "localeMatch", "bidiIsolation", "fallbackPolicy", "onFailure", "onFallback"],
  chain: ["limits"],
  fetchSet: ["limits"],
});

/**
 * door, the spelling a reader reaches for, the one that works there, and WHY it is a near miss.
 *
 * **EVERY ENTRY CARRIES A FALSIFIABLE GROUND**, on the clause ledger's precedent: a declared table
 * whose entries are justified by prose is a known-gap list, and three of those have rotted here. The
 * ground is re-derived on every run, so an entry stops being true out loud rather than quietly.
 *
 *   `mirror`  one concept under two names — the wrong spelling is a REAL option somewhere else in
 *             this library, and the gate requires that. If the sibling door is ever renamed, this
 *             entry is no longer a mirror and fires.
 *   `foreign` a name from another library's vocabulary that exists NOWHERE here. The gate requires
 *             exactly that, so the day lokalized gains a real `transport` option this entry goes
 *             stale and fires — which is when the hint would start being actively wrong.
 *   `field`   a real MANIFEST MEMBER mistaken for an option. The gate requires it to be one.
 */
const NEAR_MISSES = /** @type {[string, string, string, "mirror" | "foreign" | "field"][]} */ ([
  ["createStrings", "limits", "loadingLimits", "mirror"],
  ["parseStrings", "loadingLimits", "limits", "mirror"],
  ["readStringsFromDirectory", "loadingLimits", "limits", "mirror"],
  // The one that cost the most time: it does not fail at the call, it sends the load to the real
  // network. Measured in M-D S15 as `getaddrinfo ENOTFOUND cdn.example.com` on every failure.
  ["loadStrings", "transport", "fetch", "foreign"],
  ["loadEntireManifest", "transport", "fetch", "foreign"],
  // `baseUrl` IS a manifest member — which is exactly why a publisher reaches for it — and passing
  // it here published a manifest carrying the source directory's own `file://` path, refused much
  // later by the Fetch door, with the catalog fingerprint unaffected either way.
  ["createStringsManifestFromDirectory", "baseUrl", "publicationBaseUrl", "field"],
  // Every other door spelling the load-time limits `limits` carries the same hint in the same
  // direction. Of these thirteen, eleven already emitted the hint while the table declared none of
  // them — any could be deleted with the suite green — and `chain` and `fetchSet` began refusing, hint
  // included, in the same change (2026-09-23). That is why the table is now compared with what the
  // doors say.
  ...(/** @type {const} */ ([
    "mergeParsedStringsFiles", "parseStringsManifest", "validateStringsManifest", "localeConfigurationForManifest",
    "chain", "fetchSet", "loadStrings", "loadEntireManifest", "createStringsManifestFromDirectory",
    "readStringsManifest", "loadStringsFromFiles", "loadEntireManifestFromFiles", "loadStringsFromDirectory",
  ])).map((door) => /** @type {[string, string, string, "mirror"]} */ ([door, "loadingLimits", "limits", "mirror"])),
]);
const CATALOG = { en: { A: "a", B: "b" }, fr: { A: "x", B: "y" } };
const CATALOG_TEXT = JSON.stringify(CATALOG.en);

const directory = mkdtempSync(join(tmpdir(), "lokalized-options-"));
const beside = mkdtempSync(join(tmpdir(), "lokalized-options-side-"));
for (const [tag, catalog] of Object.entries(CATALOG))
  writeFileSync(join(directory, `${tag}.json`), JSON.stringify(catalog));

// The manifest lives OUTSIDE the catalog directory. A `manifest.json` inside it is a name the walk
// refuses, and three baselines of the first version of this probe failed for that reason rather than
// for the one under test — the shape this project calls `zh-123`.
const fileManifest = await createStringsManifestFromDirectory(directory, { catalogVersion: "v1", fallbackLocale: "en" });
const httpManifest = await createStringsManifestFromDirectory(directory, {
  catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
});
const manifestPath = join(beside, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(fileManifest));

const bodies = new Map(Object.entries(CATALOG).map(([tag, catalog]) => [`${tag}.json`, JSON.stringify(catalog)]));
/** @type {typeof fetch} */
const transport = /** @type {any} */ (async (/** @type {RequestInfo | URL} */ url) =>
  new Response(bodies.get(String(url).split("/").pop() ?? "")));

const instance = createStrings({ strings: CATALOG, fallbackLocale: "en", locale: "en" });
const configuration = instance.getLocaleConfiguration();

/** Every public door that takes an options object, with a minimal call that SUCCEEDS. */
const DOORS = {
  createStrings: (o) => createStrings({ strings: CATALOG, fallbackLocale: "en", locale: "en", ...o }).get("A"),
  parseStrings: (o) => parseStrings(CATALOG_TEXT, { locale: "en", ...o }).strings.length,
  mergeParsedStringsFiles: (o) => mergeParsedStringsFiles([parseStrings(CATALOG_TEXT, { locale: "en" })], o).strings.length,
  parseStringsManifest: (o) => parseStringsManifest(JSON.stringify(httpManifest), o).catalogVersion,
  loadStrings: (o) => loadStrings(httpManifest, "fr", { fetch: transport, ...o }).then((r) => Object.keys(r.catalogs)),
  loadEntireManifest: (o) => loadEntireManifest(httpManifest, { fetch: transport, ...o }).then((r) => Object.keys(r.catalogs)),
  readStringsFromDirectory: (o) => Object.keys(readStringsFromDirectory(directory, o).catalogs),
  createStringsManifestFromDirectory: (o) =>
    createStringsManifestFromDirectory(directory, { catalogVersion: "v1", fallbackLocale: "en", ...o })
      .then((m) => m.catalogFingerprint),
  loadStringsFromDirectory: (o) =>
    loadStringsFromDirectory(directory, { catalogVersion: "v1", fallbackLocale: "en", ...o })
      .then((r) => Object.keys(r.catalogs)),
  loadStringsFromFiles: (o) => loadStringsFromFiles(fileManifest, "fr", o).then((r) => Object.keys(r.catalogs)),
  loadEntireManifestFromFiles: (o) => loadEntireManifestFromFiles(fileManifest, o).then((r) => Object.keys(r.catalogs)),
  readStringsManifest: (o) => readStringsManifest(manifestPath, o).then((m) => m.catalogVersion),

  // **THESE TWO WERE MISSING AND THEIR GUARDS WERE MEASURABLY UNGATED.** The table held twelve where
  // `src/` guards fourteen; both are real exports of `lokalized/load`, named in the allowlist, and
  // deleting either guard left the whole suite at 1,633/1,633 exit 0 — with
  // `validateStringsManifest(manifest, { loadingLimits })`, the exact mirror this file exists to make
  // loud, silently accepted. Found by ablating the shipped change rather than by reading it, which is
  // the one-directional shape this project has now closed at the symbol, category, documentation-topic
  // and documentation-fact levels and had open again here at the DOOR level.
  validateStringsManifest: (o) => validateStringsManifest(httpManifest, o).catalogVersion,
  localeConfigurationForManifest: (o) => localeConfigurationForManifest(httpManifest, o).fallbackLocale,

  // **AND THESE NINE WERE MISSING FOR THE SAME REASON, found on 2026-09-23 by deriving the door set
  // from the published declarations rather than extending this list by hand** — the test below. All
  // nine ignored an unknown member in silence. `createLocaleNegotiator`, and the two root choosers
  // taking the same `LocaleConfiguration`, ran on the members spelled right; `get`, `t` and
  // `getResult` are the per-call options of every render; `chain` and `fetchSet` are the planning
  // doors of `lokalized/load`; `pluralOperands` built the operands of the undisplayed number.
  createLocaleNegotiator: (o) => createLocaleNegotiator({ ...configuration, ...o }).bestMatchFor("fr"),
  chooseLocaleForPreferredLanguages: (o) => chooseLocaleForPreferredLanguages({ ...configuration, ...o }, ["fr"]),
  chooseBrowserLocale: (o) => chooseBrowserLocale({ ...configuration, ...o }),
  pluralOperands: (o) => pluralOperands("1", { visibleDecimalPlaces: 1, ...o }).visibleDecimalPlaces,
  get: (o) => instance.get("A", undefined, { locale: "fr", ...o }),
  t: (o) => instance.t("A", undefined, { locale: "fr", ...o }),
  getResult: (o) => instance.getResult("A", undefined, { locale: "fr", ...o }).translation,
  chain: (o) => chain(httpManifest, "fr", o),
  fetchSet: (o) => fetchSet(httpManifest, "fr", o).map((entry) => entry.locale),
};

/**
 * Which parameter of the published declarations each door's options object IS — the key the
 * derivation below produces for it: the export's name (a method as `factory().method`) and the
 * zero-based parameter index.
 */
const PARAMETER = /** @type {Record<keyof typeof DOORS, string>} */ ({
  createStrings: "createStrings#0",
  parseStrings: "parseStrings#1",
  mergeParsedStringsFiles: "mergeParsedStringsFiles#1",
  parseStringsManifest: "parseStringsManifest#1",
  validateStringsManifest: "validateStringsManifest#1",
  localeConfigurationForManifest: "localeConfigurationForManifest#1",
  loadStrings: "loadStrings#2",
  loadEntireManifest: "loadEntireManifest#1",
  readStringsFromDirectory: "readStringsFromDirectory#1",
  createStringsManifestFromDirectory: "createStringsManifestFromDirectory#1",
  loadStringsFromDirectory: "loadStringsFromDirectory#1",
  loadStringsFromFiles: "loadStringsFromFiles#2",
  loadEntireManifestFromFiles: "loadEntireManifestFromFiles#1",
  readStringsManifest: "readStringsManifest#1",
  createLocaleNegotiator: "createLocaleNegotiator#0",
  chooseLocaleForPreferredLanguages: "chooseLocaleForPreferredLanguages#0",
  chooseBrowserLocale: "chooseBrowserLocale#0",
  pluralOperands: "pluralOperands#1",
  get: "createStrings().get#2",
  t: "createStrings().t#2",
  getResult: "createStrings().getResult#2",
  chain: "chain#2",
  fetchSet: "fetchSet#2",
});

/**
 * **EVERY OTHER OBJECT-SHAPED PARAMETER IS A RECORD, AND SAYS SO.** The M-D S33 decision is about
 * OPTIONS — a bag of named settings a caller writes as a literal. A record is a value with a shape
 * of its own, most often one the library handed the caller: refusing its unknown members is a
 * different decision (a manifest is a wire format; a rendering context may be a whole
 * `TranslationResult`, which carries far more than a context reads), and nobody has taken it. Each
 * entry names why, so the boundary is written down where the next door will be classified.
 */
const RECORDS = /** @type {Record<string, string>} */ ({
  "chain#0": "a manifest — a wire format with its own validator",
  "fetchSet#0": "a manifest",
  "loadStrings#0": "a manifest",
  "loadEntireManifest#0": "a manifest",
  "localeConfigurationForManifest#0": "a manifest",
  "validateStringsManifest#0": "a manifest (declared `unknown`: validating it is the point)",
  "loadStringsFromFiles#0": "a manifest",
  "loadEntireManifestFromFiles#0": "a manifest",
  "cardinalityForNumber#0": "a tagged value built by decimal() or pluralOperands()",
  "cardinalityForOperands#0": "a tagged value built by pluralOperands()",
  "ordinalityForNumber#0": "a tagged value built by decimal() or pluralOperands()",
  "ordinalityForOperands#0": "a tagged value built by pluralOperands()",
  "cardinalityForRange#0": "a language-form constant",
  "cardinalityForRange#1": "a language-form constant",
  "forLocaleMatch#0": "a LocaleMatch the negotiator returned",
  "forLanguageRanges#0": "the negotiator createLocaleNegotiator returned",
  "forAcceptLanguage#0": "the negotiator createLocaleNegotiator returned",
  "createSsrStamp#0": "a Strings instance",
  "validateSsrStamp#1": "a Strings instance",
  "validateSsrStamp#0": "a stamp createSsrStamp returned, which refuses an unknown FIELD by its own rule",
  "createSsrStamp#1": "a rendering context, which may be a whole TranslationResult",
  "validateSsrStamp#2": "a rendering context",
  "defineLocalizedString#0": "a localized string in the catalog vocabulary, refused by that grammar as StringsParseError",
  "computeCatalogIdentity#0": "an identity input, projected field by field by design (M8 S22)",

  // Found once the derivation learned `Record<…>` types and the elements of iterables (2026-09-23).
  "createStrings().get#1": "placeholder values — their names are the catalog's, so there is no set to refuse against",
  "createStrings().t#1": "placeholder values",
  "createStrings().getResult#1": "placeholder values",
  "defineCatalog#0[]": "localized strings in the catalog vocabulary, refused by that grammar as StringsParseError",
  "mergeParsedStringsFiles#0[]": "a ParsedStringsFile parseStrings returned; an extra member is ignored",
});

/**
 * **ELEMENTS THAT REFUSE AN UNKNOWN MEMBER, and there is one kind: a language range.** They were
 * declared records until the maintainer decided otherwise on 2026-09-23, because the silence had a
 * measured cost — `{ range: "fr", wieght: 0 }` beside `{ range: "en", weight: 0.5 }` selected `fr`,
 * the misspelled weight defaulting to 1.0, so a list written to EXCLUDE French selected it. The test
 * below probes all three doors.
 */
const REFUSING_ELEMENTS = /** @type {Record<string, string>} */ ({
  "createLocaleNegotiator().matchForLanguageRanges#0[]": "a language range: `range` and `weight` only",
  "createLocaleNegotiator().bestMatchForLanguageRanges#0[]": "a language range",
  "forLanguageRanges#1[]": "a language range",
});

/**
 * The name a refusal gives, where it is not the door's own. `t` IS `get` (the same function object),
 * and `getResult` names `get` like every other per-call refusal in that function already does, so
 * all three say `get`. Every other door must name itself: `chooseBrowserLocale` delegates to
 * `chooseLocaleForPreferredLanguages`, and without its own guard it would refuse under a name the
 * caller never typed.
 */
const REFUSED_AS = /** @type {Record<string, string>} */ ({ t: "get", getResult: "get" });

/** What a call settles to, success or failure, as one comparable string. */
async function settle(/** @type {(options: object) => unknown} */ door, /** @type {object} */ options) {
  try { return `ok:${JSON.stringify(await door(options))}`; }
  catch (error) { return `threw:${/** @type {Error} */ (error).constructor.name}:${/** @type {Error} */ (error).message}`; }
}

test("every public door's minimal call succeeds, or the comparisons below compare two failures", async () => {
  // THE ANTI-VACUITY TERM, and the first version of this probe needed it: three baselines were
  // themselves failing, so "the bogus option changed nothing" was true of two identical errors.
  for (const [name, door] of Object.entries(DOORS)) {
    const baseline = await settle(door, {});
    assert.match(baseline, /^ok:/, `${name}: the baseline call itself failed — ${baseline.slice(0, 120)}`);
  }
  assert.ok(Object.keys(DOORS).length >= 23, "the door list shrank");
});

test("every public door refuses an option it does not know", async () => {
  /** @type {string[]} */
  const ignored = [];
  for (const [name, door] of Object.entries(DOORS)) {
    const without = await settle(door, {});
    const with_ = await settle(door, { [BOGUS]: 1 });
    if (without === with_) ignored.push(name);
    else assert.ok(with_.startsWith(`threw:ConfigurationError:${REFUSED_AS[name] ?? name} does not take`),
      `${name}: an unknown option must be a ConfigurationError naming the door the caller typed, ` +
      `not ${with_.slice(0, 100)}`);
  }

  assert.deepEqual(ignored, [],
    "a door has gone back to ignoring unknown options in silence. That is how `{ transport }` " +
    "reached the real network and `{ limits }` ran under the defaults");

  // THE MESSAGE IS PART OF THE CONTRACT, not decoration: it must name the offending key, so a
  // caller can fix it from the message alone rather than by bisecting their config object.
  const message = await settle(DOORS.createStrings, { [BOGUS]: 1 });
  assert.ok(message.includes(BOGUS), `the refusal must name the unknown option; got ${message}`);
});

/**
 * Every object-shaped parameter the PUBLISHED DECLARATIONS expose, keyed `name#index` — derived with
 * the TypeScript checker from `package.json#exports` and the emitted `types/`, which is what a
 * consumer's editor reads. `verify` runs `npm run types` before `npm test`, as for
 * `declared-surface.test.js`.
 *
 * Three mechanisms, each named by an anti-vacuity key in the test below, because each one has a way
 * to go quietly blind: EXPORTED FUNCTIONS; METHODS of what an export returns, one level down, which
 * is where `get`'s per-call options live; and parameters declared `any` or `unknown` — the SSR
 * doors' `strings` and `context` are emitted `any` today, and until 2026-09-23 so were both Fetch
 * doors' options, which a type-shaped filter alone would have dropped.
 * An object type counts only if a member of it is declared under `types/`: that is what excludes
 * `URL`, `RegExp`, `Map` and the rest of the platform. Counted besides: intersections, which plan 6.2
 * uses for a Node door's options; `object`, index-signature-only and literal-key records, whose members
 * are declared nowhere; and the elements of an array, tuple, iterable, async iterable or nested array,
 * and a map's values, keyed `name#index[]`. NOT counted: an element typed `any` or `unknown`, which has
 * no member to misspell — `ReadonlyMap<string, unknown>` is how placeholder values are declared.
 *
 * @returns {Map<string, { subpaths: Set<string>, members: string }>}
 */
function objectParameters() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const typesRoot = join(root, "types") + sep;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entries = Object.entries(pkg.exports)
    .filter(([, target]) => typeof target === "object")
    .map(([subpath, target]) => [subpath, join(root, target.types)]);
  const program = ts.createProgram(entries.map(([, file]) => file), {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  });
  const checker = program.getTypeChecker();
  const ours = (/** @type {ts.Symbol} */ symbol) =>
    (symbol.declarations ?? []).some((d) => d.getSourceFile().fileName.startsWith(typesRoot));

  const membersOf = (/** @type {ts.Type} */ type) => {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return `<${checker.typeToString(type)}>`;
    const names = new Set();
    for (const part of type.isUnion() ? type.types : [type]) {
      if (part.flags & ts.TypeFlags.Any) return "<any>";
      // `object`, and a type with no named member but an index signature (`Record<string, unknown>`):
      // neither has a member declared anywhere, so the "declared under types/" test below would skip
      // both — and a door whose options were typed that way would pass unclassified. Measured by the
      // 2026-09-23 review: a probe door typed `Record<string, unknown>` or `object` stayed green.
      if (part.flags & ts.TypeFlags.NonPrimitive) return "<object>";
      // An INTERSECTION is an object too, and plan 6.2 declares a Node door's options as one
      // (`Omit<DirectoryManifestOptions, …> & Omit<LoadStringsFromFilesOptions, …>`). Its flag is not
      // `Object`, so the first version of this line skipped it — measured by the second review with a
      // probe door typed `{ alpha?: number } & { beta?: string }`, which stayed unclassified.
      const objectLike = (part.flags & ts.TypeFlags.Object) || part.isIntersection();
      if (!objectLike || checker.isArrayType(part) || checker.isTupleType(part)) continue;
      if (part.getCallSignatures().length > 0) continue;
      const properties = checker.getPropertiesOfType(part);
      if (properties.some((p) => String(p.escapedName).startsWith("__@iterator"))) continue;
      if (properties.length === 0 && checker.getIndexInfosOfType(part).length > 0) return "<record>";
      // A record over literal keys — `Record<"a" | "b", T>`, `Partial<Record<…>>` — has members that are
      // declared NOWHERE, being synthesized from a key union, so "declared under types/" would skip it.
      // Everything from the platform (`URL`, `RegExp`) has declared members, which is what separates them.
      const synthesized = properties.length > 0 && properties.every((p) => (p.declarations ?? []).length === 0);
      if (!synthesized && !properties.some(ours)) continue;
      for (const p of properties) names.add(p.name);
    }
    return names.size > 0 ? [...names].sort().join(",") : null;
  };

  // THE ELEMENTS OF AN ARRAY OR ITERABLE PARAMETER, keyed `name#index[]`. A language range handed to
  // `matchForLanguageRanges` is an object with named members like any options bag, and the review
  // found a misspelled one — `{ range: "fr", wieght: 0 }` — silently read as weight 1.0. Without this
  // the derivation never saw those objects at all, so nothing recorded where the rule stops.
  //
  // ALSO COUNTED, after the second review measured each one passing unclassified: `AsyncIterable`
  // elements, a MAP'S VALUES (the second type argument; its keys are strings), and nested arrays, whose
  // innermost objects are keyed the same way. An element typed `any` or `unknown` is NOT counted —
  // `ReadonlyMap<string, unknown>` is how placeholder values are declared, and an element with no
  // shape has no member to misspell.
  const ITERABLES = new Set(["Array", "ReadonlyArray", "Iterable", "AsyncIterable", "Set", "ReadonlySet"]);
  const MAPS = new Set(["Map", "ReadonlyMap"]);
  /** @returns {ts.Type[]} the element types of an array, tuple, iterable or map, or none */
  const elementsOf = (/** @type {ts.Type} */ part) => {
    const name = part.getSymbol()?.name ?? "";
    const args = () => checker.getTypeArguments(/** @type {ts.TypeReference} */ (part));
    // A tuple's arguments are its elements; an iterable's element is the FIRST argument only —
    // `Iterable<T, TReturn = any, TNext = any>` carries two more, and reading them reported `<any>`.
    if (checker.isTupleType(part)) return [...args()];
    if (checker.isArrayType(part) || ITERABLES.has(name)) return args().slice(0, 1);
    if (MAPS.has(name)) return args().slice(1, 2);
    return [];
  };
  const elementMembersOf = (/** @type {ts.Type} */ type, depth = 0) => {
    const names = new Set();
    for (const part of type.isUnion() ? type.types : [type])
      for (const element of elementsOf(part)) {
        const members = membersOf(element) ?? (depth < 3 ? elementMembersOf(element, depth + 1) : null);
        if (members === null || members.startsWith("<any") || members.startsWith("<unknown")) continue;
        for (const name of members.split(",")) names.add(name);
      }
    return names.size > 0 ? [...names].sort().join(",") : null;
  };

  /** @type {Map<string, { subpaths: Set<string>, members: string }>} */
  const found = new Map();
  const visit = (/** @type {string} */ subpath, /** @type {string} */ name, /** @type {ts.Type} */ type, depth) => {
    for (const signature of type.getCallSignatures()) {
      signature.getParameters().forEach((parameter, index) => {
        const type = checker.getTypeOfSymbol(parameter);
        for (const [key, members] of [[`${name}#${index}`, membersOf(type)], [`${name}#${index}[]`, elementMembersOf(type)]]) {
          if (members === null) continue;
          const row = found.get(key) ?? { subpaths: new Set(), members };
          row.subpaths.add(subpath);
          found.set(key, row);
        }
      });
      if (depth > 0) continue;
      const returned = signature.getReturnType();
      for (const property of checker.getPropertiesOfType(checker.getAwaitedType(returned) ?? returned)) {
        const propertyType = checker.getTypeOfSymbol(property);
        if (ours(property) && propertyType.getCallSignatures().length > 0)
          visit(subpath, `${name}().${property.name}`, propertyType, depth + 1);
      }
    }
  };

  for (const [subpath, file] of entries) {
    const source = program.getSourceFile(file);
    assert.ok(source, `${subpath}: ${file} is missing — run \`npm run types\` first`);
    const moduleSymbol = /** @type {ts.Symbol} */ (checker.getSymbolAtLocation(source));
    for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      if (symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable))
        visit(subpath, symbol.name, checker.getTypeOfSymbol(symbol), 0);
    }
  }
  return found;
}

test("every object-shaped parameter the package publishes is a door probed above or a declared record", () => {
  // **THE DOOR LIST ABOVE WAS WRITTEN BY HAND, AND BY HAND IT MISSED ELEVEN OF TWENTY-THREE.** M-D S33
  // swept twelve doors where `src/` guarded fourteen; the two it missed were found by ablation. On
  // 2026-09-23 `createLocaleNegotiator` was found ignoring `{ fallbackLocal }` by a person, and
  // deriving the surface from the declarations named eight more beside it. A hand list goes stale in
  // exactly one direction — a new door is simply not on it — so the set is DERIVED and compared,
  // both ways, and a new object parameter now fails here until someone decides what it is.
  const derived = objectParameters();

  // ANTI-VACUITY, one key per mechanism: an export's parameter (and the door this test exists
  // because of), a method's parameter one level down, and a parameter emitted without a shape.
  // The third key was `loadStrings#2` until its options were typed, after which it was still FOUND —
  // through the object arm — and so proved nothing about this one. `validateStringsManifest`'s input
  // is `unknown` by design, and the member string says which arm produced it.
  for (const key of ["createLocaleNegotiator#0", "createStrings().get#2", "validateStringsManifest#0"])
    assert.ok(derived.has(key), `the derivation no longer finds ${key}, so it has gone blind somewhere`);
  assert.equal(derived.get("validateStringsManifest#0")?.members, "<unknown>",
    "the any/unknown arm did not produce validateStringsManifest#0, so it is no longer exercised");
  assert.ok(derived.size >= 55, `the derivation found ${derived.size} parameters, fewer than the 55 it found on 2026-09-23`);

  const doorKeys = new Set(Object.values(PARAMETER));
  assert.deepEqual(Object.keys(PARAMETER).sort(), Object.keys(DOORS).sort(),
    "every door probed above must name the parameter it probes, and nothing else may");
  for (const key of doorKeys)
    assert.ok(!(key in RECORDS), `${key} is declared both a door and a record`);
  for (const key of Object.keys(REFUSING_ELEMENTS))
    assert.ok(!(key in RECORDS) && !doorKeys.has(key), `${key} is declared twice`);

  const unclassified = [...derived.keys()]
    .filter((key) => !doorKeys.has(key) && !(key in RECORDS) && !(key in REFUSING_ELEMENTS))
    .map((key) => `${key} {${derived.get(key)?.members}} on ${[...(derived.get(key)?.subpaths ?? [])].join(", ")}`);
  assert.deepEqual(unclassified, [],
    "a published parameter takes an object and is neither probed as a door nor declared a record. If " +
    "it is an options bag it must refuse an unknown member (M-D S33) and join DOORS; if it is a value " +
    "the library hands out and takes back, declare it in RECORDS with the reason");

  const stale = [...doorKeys, ...Object.keys(RECORDS), ...Object.keys(REFUSING_ELEMENTS)].filter((key) => !derived.has(key));
  assert.deepEqual(stale, [], "a classified parameter no longer exists in the published declarations");
});

test("every LocaleConfiguration the library produces passes all three doors that take one", async () => {
  // THE DRIFT GATE FOR THE SECOND COPIES. `lokalized/negotiate` may not import core, so the three
  // accepted members are spelled twice in `src/`. What must never happen is the documented call —
  // `createLocaleNegotiator(strings.getLocaleConfiguration())` — being refused because a producer
  // grew a member the doors were not told about. Every producer is exercised: the direct instance,
  // a lookup-subset load, a whole-manifest load, and `localeConfigurationForManifest`.
  const fr = /** @type {typeof fetch} */ (/** @type {any} */ (async (/** @type {RequestInfo | URL} */ url) =>
    new Response(bodies.get(String(url).split("/").pop() ?? ""))));
  const produced = {
    direct: instance.getLocaleConfiguration(),
    subset: createStrings({ loaded: await loadStrings(httpManifest, "fr", { fetch: fr }), locale: "fr" })
      .getLocaleConfiguration(),
    entire: createStrings({ loaded: await loadEntireManifest(httpManifest, { fetch: fr }), locale: "fr" })
      .getLocaleConfiguration(),
    manifest: localeConfigurationForManifest(httpManifest),
  };
  for (const [source, produce] of Object.entries(produced)) {
    assert.deepEqual(Object.keys(produce).sort(), [...ACCEPTS.createLocaleNegotiator].sort(),
      `${source}: a produced LocaleConfiguration carries a member the configuration doors do not accept`);
    assert.equal(createLocaleNegotiator(produce).bestMatchFor("fr"), "fr", source);
    assert.equal(chooseLocaleForPreferredLanguages(produce, ["fr"]), "fr", source);
    assert.match(chooseBrowserLocale(produce), /^(en|fr)$/, source);
  }
});

/**
 * Every door again, but with the argument handed IN THE OPTIONS POSITION rather than spread into an
 * object — which is the only way to hand a door something that is not an object. Keys match DOORS.
 */
const parsedEnglish = parseStrings(CATALOG_TEXT, { locale: "en" });
const RAW = /** @type {Record<keyof typeof DOORS, (options: unknown) => unknown>} */ ({
  createStrings: (x) => createStrings(/** @type {any} */ (x)),
  parseStrings: (x) => parseStrings(CATALOG_TEXT, /** @type {any} */ (x)),
  mergeParsedStringsFiles: (x) => mergeParsedStringsFiles([parsedEnglish], /** @type {any} */ (x)).strings.length,
  parseStringsManifest: (x) => parseStringsManifest(JSON.stringify(httpManifest), /** @type {any} */ (x)).catalogVersion,
  validateStringsManifest: (x) => validateStringsManifest(httpManifest, /** @type {any} */ (x)).catalogVersion,
  localeConfigurationForManifest: (x) => localeConfigurationForManifest(httpManifest, /** @type {any} */ (x)).fallbackLocale,
  loadStrings: (x) => loadStrings(httpManifest, "fr", /** @type {any} */ (x)).then((r) => Object.keys(r.catalogs)),
  loadEntireManifest: (x) => loadEntireManifest(httpManifest, /** @type {any} */ (x)).then((r) => Object.keys(r.catalogs)),
  readStringsFromDirectory: (x) => Object.keys(readStringsFromDirectory(directory, /** @type {any} */ (x)).catalogs),
  createStringsManifestFromDirectory: (x) => createStringsManifestFromDirectory(directory, /** @type {any} */ (x)),
  loadStringsFromDirectory: (x) => loadStringsFromDirectory(directory, /** @type {any} */ (x)),
  loadStringsFromFiles: (x) => loadStringsFromFiles(fileManifest, "fr", /** @type {any} */ (x)).then((r) => Object.keys(r.catalogs)),
  loadEntireManifestFromFiles: (x) => loadEntireManifestFromFiles(fileManifest, /** @type {any} */ (x)).then((r) => Object.keys(r.catalogs)),
  readStringsManifest: (x) => readStringsManifest(manifestPath, /** @type {any} */ (x)).then((m) => m.catalogVersion),
  createLocaleNegotiator: (x) => createLocaleNegotiator(/** @type {any} */ (x)).bestMatchFor("fr"),
  chooseLocaleForPreferredLanguages: (x) => chooseLocaleForPreferredLanguages(/** @type {any} */ (x), ["fr"]),
  chooseBrowserLocale: (x) => chooseBrowserLocale(/** @type {any} */ (x)),
  pluralOperands: (x) => pluralOperands("1", /** @type {any} */ (x)),
  get: (x) => instance.get("A", undefined, /** @type {any} */ (x)),
  t: (x) => instance.t("A", undefined, /** @type {any} */ (x)),
  getResult: (x) => instance.getResult("A", undefined, /** @type {any} */ (x)).translation,
  chain: (x) => chain(httpManifest, "fr", /** @type {any} */ (x)),
  fetchSet: (x) => fetchSet(httpManifest, "fr", /** @type {any} */ (x)).map((entry) => entry.locale),
});

/**
 * The four doors whose OWN check answers a non-object before the shared helper can, with the
 * sentence it answers. Every other door must answer with the helper's refusal.
 */
const REFUSES_A_NON_OBJECT_ITSELF = /** @type {Record<string, RegExp>} */ ({
  createStringsManifestFromDirectory: /^threw:ConfigurationError:createStringsManifestFromDirectory requires catalogVersion and fallbackLocale/,
  createLocaleNegotiator: /^threw:RangeError:A locale configuration is required$/,
  chooseLocaleForPreferredLanguages: /^threw:RangeError:A locale configuration is required$/,
  chooseBrowserLocale: /^threw:RangeError:A locale configuration is required$/,
});

test("a non-object in the options position is refused, and `undefined`, `null` and `false` mean no options", async () => {
  // **THE MAINTAINER'S DECISION OF 2026-09-23, and the trap it closes is the transport one again.**
  // A review measured `loadStrings(manifest, "fr", myFetch)` — the transport handed over bare instead
  // of as `{ fetch }` — going to THE REAL NETWORK, `loadStringsFromFiles(m, l, myReader)` using the
  // default reader, and `get(key, values, "fr")` rendering the instance's language, all with no error,
  // because the shared helper returned early for anything that was not an object. `false` stays "no
  // options" for `cond && { locale }`; `0` and `""` arrive the same way from a numeric or string
  // `cond` and are REFUSED, by the decision's own terms — both are pinned here.
  //
  // THE GLOBAL `fetch` IS A COUNTER FOR THE WHOLE SWEEP, so the network half is asserted rather than
  // inferred, and "no options" at a Fetch door is served by the counter rather than by the internet.
  assert.deepEqual(Object.keys(RAW).sort(), Object.keys(DOORS).sort(), "RAW must probe exactly the doors DOORS does");
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = /** @type {any} */ (async (/** @type {RequestInfo | URL} */ url) => {
    networkCalls += 1;
    return new Response(bodies.get(String(url).split("/").pop() ?? ""));
  });
  try {
    for (const [name, door] of Object.entries(RAW)) {
      const absent = await settle(door, undefined);
      // THE OTHER TWO "NO OPTIONS" VALUES MUST ANSWER EXACTLY AS ABSENCE DOES, whether this door's
      // options are optional (it succeeds) or required (it refuses). `null` did not at eleven optional
      // doors, crashing on `null.limits`; and at three REQUIRED ones `undefined` and `null` both
      // answered with a host TypeError while `false` gave a different error, which the first version
      // of this arm accepted because it asked only that each be refused. Found by the final review.
      for (const none of [null, false])
        assert.equal(await settle(door, none), absent, `${name}(${none}) must answer as ${name}() does`);
      if (!absent.startsWith("ok:"))
        assert.doesNotMatch(absent, /^threw:TypeError:Cannot read properties/,
          `${name}() is refused by the host, not by the door: ${absent.slice(0, 100)}`);

      for (const [label, value] of /** @type {[string, unknown][]} */ ([
        ["0", 0], ['""', ""], ['"fr"', "fr"], ["a function", () => {}], ["true", true],
        // An unawaited promise: an object with no own keys, so it passed as "no options" and a Fetch
        // door went to the network (maintainer's decision of 2026-09-23 to refuse it). The thenable
        // is the same slip through a non-native promise, which `await` treats identically.
        ["a promise", Promise.resolve({})], ["a thenable", { then() {} }],
      ])) {
        const before = networkCalls;
        const outcome = await settle(door, value);
        assert.equal(networkCalls, before, `${name}(${label}) reached the network`);
        // A promise is an object, so it passes the four doors' own non-object checks and reaches the
        // shared helper at EVERY door in this sweep, which answers with its sentence and its remedy.
        const thenable = label === "a promise" || label === "a thenable";
        const expected = thenable
          ? new RegExp(`^threw:ConfigurationError:${REFUSED_AS[name] ?? name} takes an options object, and was handed a promise; await it first\\.`)
          : REFUSES_A_NON_OBJECT_ITSELF[name] ??
            new RegExp(`^threw:ConfigurationError:${REFUSED_AS[name] ?? name} takes an options object, and was handed `);
        assert.match(outcome, expected, `${name}(${label}) must be refused, not ${outcome.slice(0, 100)}`);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(networkCalls > 0, "no door ever reached the counter, so the network assertions above proved nothing");
});

test("a language range refuses a member other than `range` and `weight`, at every door that takes a list", () => {
  const negotiator = createLocaleNegotiator(configuration);
  const excludeFrench = [{ range: "fr", weight: 0 }, { range: "en", weight: 0.5 }];
  const misspelled = [{ range: "fr", wieght: 0 }, { range: "en", weight: 0.5 }];
  const doors = {
    matchForLanguageRanges: (/** @type {any} */ ranges) => negotiator.matchForLanguageRanges(ranges).locale,
    bestMatchForLanguageRanges: (/** @type {any} */ ranges) => negotiator.bestMatchForLanguageRanges(ranges),
    forLanguageRanges: (/** @type {any} */ ranges) => forLanguageRanges(negotiator, ranges).localeMatch.locale,
  };
  for (const [name, door] of Object.entries(doors)) {
    // THE CONTROL FIRST: the correct spelling must exclude French, or the refusal below proves
    // nothing about the misspelling it exists for.
    assert.equal(door(excludeFrench), "en", `${name}: the correctly spelled list must select en`);
    assert.throws(() => door(misspelled), (error) => error instanceof RangeError &&
      /takes only 'range' and 'weight', and this one also has \[wieght\]/.test(/** @type {Error} */ (error).message),
      `${name} must refuse the misspelled weight rather than read it as 1.0`);
  }

  // What the library hands out passes: parser output, and a match's own requested ranges, round trip.
  const parsed = parseLanguageRanges("fr;q=0, en;q=0.5");
  const match = negotiator.matchForLanguageRanges(parsed);
  assert.equal(match.locale, "en");
  assert.equal(negotiator.matchForLanguageRanges(match.requestedLanguageRanges).locale, "en");
  // And the fail-soft header door never reaches the refusal: it only ever passes parser output.
  assert.equal(negotiator.bestMatchForAcceptLanguage("fr;q=0, en;q=0.5"), "en");
});

test("a load door refuses `onWarning` rather than accepting an observer it will never call", async () => {
  // A SPECIFIC INSTANCE WORTH ITS OWN ARM. `readStringsFromDirectory`, `parseStrings` and
  // `createStrings` all take `onWarning`; the manifest and network doors do NOT — they hand their
  // warnings back on the returned record as `loaded.warnings`. Measured before the refusal landed:
  // `loadStringsFromDirectory(dir, { onWarning })` fired the observer ZERO times and put two
  // warnings on the record, so a caller watching the observer saw a clean load. That is the generic
  // property above with a name a reader will actually type, which is why it is asserted separately.
  const accepted = await settle(DOORS.readStringsFromDirectory, { onWarning: () => {} });
  assert.match(accepted, /^ok:/, "the door that DOES take onWarning must still take it");

  const refused = await settle(DOORS.loadStringsFromDirectory, { onWarning: () => {} });
  assert.match(refused, /^threw:ConfigurationError:.*onWarning/,
    "a load door must refuse an observer it will never call");
});

/** The door's accepted set as its own refusal states it: the message ends "It takes [a, b, c]". */
async function acceptedPerRefusal(/** @type {keyof typeof DOORS} */ name) {
  const refusal = await settle(DOORS[name], { [BOGUS]: 1 });
  const listed = /It takes \[([^\]]*)\]$/.exec(refusal);
  assert.ok(listed, `${name}: the refusal does not end with the list of what it takes — ${refusal.slice(0, 120)}`);
  return listed[1] === "" ? [] : listed[1].split(", ");
}

test("each door's accepted set is the one its own refusal states, which is the one declared here", async () => {
  for (const name of /** @type {(keyof typeof DOORS)[]} */ (Object.keys(DOORS)))
    assert.deepEqual(await acceptedPerRefusal(name), [...ACCEPTS[name]].sort(),
      `${name}: ACCEPTS has drifted from what the door in src/ accepts`);
});

/**
 * Every near-miss hint the real doors emit, found by CALLING them: each door is handed, one at a
 * time, every name some door accepts or some hint mentions, and every manifest member, whenever the
 * door itself does not accept it. The refusal runs before any I/O, so no call reads a file or the
 * network. A hint for a name in none of those sets cannot be found this way, and that is the limit.
 */
async function emittedNearMisses() {
  const candidates = new Set([
    ...Object.values(ACCEPTS).flat(), ...NEAR_MISSES.map(([, wrong]) => wrong), ...Object.keys(fileManifest),
  ]);
  /** @type {string[]} */
  const emitted = [];
  for (const [name, door] of Object.entries(DOORS))
    for (const candidate of candidates) {
      if (ACCEPTS[name]?.includes(candidate)) continue;
      const refusal = await settle(door, { [candidate]: undefined });
      for (const [, wrong, right] of refusal.matchAll(/`([^`]+)` is not the option name here; `([^`]+)` is/g))
        emitted.push(`${name}: ${wrong} -> ${right}`);
    }
  return emitted.sort();
}

test("every near-miss hint a door emits is declared here, word for word, and every declared one is emitted", async () => {
  // **HALF THE TABLE WAS UNGATED.** Until 2026-09-23 the emitted text was asserted for four rows;
  // a review deleted `chain`'s, `fetchSet`'s and `readStringsFromDirectory`'s hints, dropped
  // `loadEntireManifest`'s table, and pointed `chain`'s at a spelling no door takes, and the whole
  // suite stayed at 1,734 / 1,734 with `check:readme` at exit 0. The declared rows were only ever
  // compared with this file's own copy of the accepted sets. Now the comparison is with the
  // refusals themselves, in both directions.
  const declared = NEAR_MISSES.map(([door, wrong, right]) => `${door}: ${wrong} -> ${right}`).sort();
  assert.deepEqual(await emittedNearMisses(), declared);
});

test("every declared near-miss names a spelling that is real, and real somewhere else", async () => {
  // PROBE EVERY DOOR FOR REAL with each `foreign` spelling: a name is foreign only if no door
  // actually accepts it, and "accepts" is something only an execution can answer.
  const foreignNames = new Set();
  for (const [, wrong, , ground] of NEAR_MISSES) {
    if (ground !== "foreign") continue;
    for (const [name, door] of Object.entries(DOORS)) {
      const outcome = await settle(door, { [wrong]: undefined });
      if (!/does not take the option/.test(outcome)) { foreignNames.add(wrong); void name; break; }
    }
  }

  // THE TABLE THAT MAKES A REFUSAL A SIGNPOST INSTEAD OF A DEAD END — and a declared table is a
  // known-gap list, which this project has watched rot three times. Two rules keep it honest: the
  // wrong spelling must NOT be accepted by the door it is declared on (or it is not a miss), and it
  // must be REAL SOMEWHERE (or it is not NEAR — it is a name nobody would reach for): a `mirror` is
  // an option at a sibling door, a `field` a manifest member, and a `foreign` name is real in another
  // library's vocabulary and accepted by NO door here — which is what the rule below checks for it.
  const manifestMembers = Object.keys(fileManifest);
  const acceptedSomewhere = (/** @type {string} */ name) =>
    Object.values(ACCEPTS).some((names) => names.includes(name));

  for (const [door, wrong, right, ground] of NEAR_MISSES) {
    assert.ok(!ACCEPTS[door]?.includes(wrong),
      `${door} accepts '${wrong}', so declaring it a near miss is false`);
    assert.ok(ACCEPTS[door]?.includes(right),
      `${door} does not accept '${right}', so the remedy the message offers does not work`);

    if (ground === "mirror")
      assert.ok(acceptedSomewhere(wrong),
        `'${wrong}' is declared a mirror but is accepted by no door; it is not one`);
    else if (ground === "foreign")
      // MEASURED AGAINST `src/`, NOT AGAINST `ACCEPTS`. The first version consulted the table's own
      // copy, so adding `transport` to a real door's accepted set in `src/` left this green — the
      // one direction the ground's docblock promises it would catch. `foreignNames` probes every
      // door for real, which is why it is computed once above rather than read off a list.
      assert.ok(!foreignNames.has(wrong),
        `'${wrong}' is declared foreign and IS accepted by a real door now; the hint has gone stale`);
    else
      assert.ok(manifestMembers.includes(wrong),
        `'${wrong}' is declared a manifest member and is not one`);
  }

  // ANTI-VACUITY: all three grounds must be exercised, or a rule that stopped working would go
  // unnoticed because nothing reaches it.
  assert.deepEqual([...new Set(NEAR_MISSES.map(([, , , g]) => g))].sort(),
    ["field", "foreign", "mirror"], "a ground is declared by no entry, so its rule never runs");
  assert.ok(NEAR_MISSES.length >= 19, "the near-miss table shrank");
});

test("the two spellings of the load-time limits are a mirror, and each door NAMES the other's", () => {
  // THE SHARPEST INSTANCE, and the one a reader meets: ONE concept, TWO names. It used to be silent
  // at both doors, which is how `createStrings({ limits })` ran under the defaults for five
  // milestones. It is now loud at both — and the refusal does not merely say "unknown", it names the
  // spelling that works, which is what turns a trap into a signpost.
  const tight = { maximumTranslationNodes: 1 };
  const outcome = (/** @type {() => unknown} */ run) => {
    try { run(); return "accepted"; } catch (error) { return /** @type {Error} */ (error).message; }
  };

  // `createStrings` spells it `loadingLimits` …
  assert.match(
    outcome(() => createStrings({ strings: CATALOG, fallbackLocale: "en", locale: "en", loadingLimits: tight })),
    /aggregate maximum of 1 translation nodes/,
    "the CORRECT spelling must still bite, or the refusal below proves nothing about the mirror");
  assert.match(
    outcome(() => createStrings({ strings: CATALOG, fallbackLocale: "en", locale: "en", limits: tight })),
    /`limits` is not the option name here; `loadingLimits` is/);

  // … and `parseStrings` spells the same thing `limits`. Each names the other's.
  assert.match(outcome(() => parseStrings(CATALOG_TEXT, { locale: "en", limits: tight })),
    /aggregate maximum of 1 translation nodes/);
  assert.match(outcome(() => parseStrings(CATALOG_TEXT, { locale: "en", loadingLimits: tight })),
    /`loadingLimits` is not the option name here; `limits` is/);
});

test("the two near misses that did not fail at the call now fail AT the call", async () => {
  // **THESE TWO COST THE MOST TIME AND THE REASON IS THE SAME: NEITHER FAILED AT THE CALL.** The
  // assertions below used to pin the damage each one did; they now pin that neither can happen.
  //
  // `fetch`, not `transport`. The wrong name did not fail — it went to the real network, which is
  // how M-D S15 found it: `getaddrinfo ENOTFOUND cdn.example.com` as the cause of every failure.
  let calls = 0;
  /** @type {typeof fetch} */
  const counting = /** @type {any} */ (async (/** @type {RequestInfo | URL} */ url) => {
    calls += 1;
    return new Response(bodies.get(String(url).split("/").pop() ?? ""));
  });

  await loadStrings(httpManifest, "fr", { fetch: counting });
  assert.ok(calls > 0, "the correct spelling must reach the transport, or nothing below is pinned");

  calls = 0;
  const refused = await settle((o) => loadStrings(httpManifest, "fr", o), { transport: counting });
  assert.match(refused, /ConfigurationError.*`transport` is not the option name here; `fetch` is/);
  // STILL THE LOAD-BEARING ASSERTION, and it means something different now. Before, the zero meant
  // "your transport was ignored and the load went elsewhere"; now it means the call never started.
  assert.equal(calls, 0, "the refusal must precede the load, not follow a failed one");

  // `publicationBaseUrl`, not `baseUrl`. The wrong name emitted a manifest carrying the source
  // directory's own `file://` path — structurally valid, refused much later by the Fetch door, and
  // FINGERPRINT-IDENTICAL to the correct one, which is exactly why it survived to be found by a
  // differential rather than by a caller.
  const correct = await createStringsManifestFromDirectory(directory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  assert.equal(correct.baseUrl, "https://cdn.example/v1/");

  const misspelled = await settle((o) => createStringsManifestFromDirectory(directory, o),
    { catalogVersion: "v1", fallbackLocale: "en", baseUrl: "https://cdn.example/v1/" });
  assert.match(misspelled, /ConfigurationError.*`baseUrl` is not the option name here; `publicationBaseUrl` is/);
});

test("the nested `limits` record is refused the same way, at every door that takes one", () => {
  // **THE REFUSAL RECURSES ONE LEVEL, AND IT CLOSES A LIVE DEFECT RATHER THAN TIDYING.**
  // `resolveLimits` read seven named members and asked nothing about the CONTAINER, so measured
  // before this landed: `limits: null`, `[]`, `"nonsense"`, `() => {}` and
  // `new Map([["maximumLocalizedStringsFiles", 1]])` were ALL silently accepted as the defaults.
  //
  // The Map is the one that bites. `createStringsManifestFromDirectory` takes `tiebreakers` as a
  // plain record OR a ReadonlyMap, so a publisher who learned that from the sibling option and wrote
  // `limits: new Map(...)` got a clean four-file manifest with their budget dropped — while the
  // IDENTICAL budget as a plain object refused. One door, two opposite answers.
  const accepted = (/** @type {unknown} */ limits) => {
    try { parseStrings(CATALOG_TEXT, { locale: "en", limits: /** @type {any} */ (limits) }); return "accepted"; }
    catch (error) { return /** @type {Error} */ (error).constructor.name; }
  };

  // CONTROLS FIRST, both of them: an absent record and the library's own null-prototype idiom must
  // still work, or every refusal below is satisfied by a rule that refuses everything.
  assert.equal(accepted(undefined), "accepted");
  assert.equal(accepted({}), "accepted");
  assert.equal(accepted(Object.assign(Object.create(null), { maximumWarnings: 5 })), "accepted",
    "a null-prototype record is this library's own idiom and must be read, not refused");

  for (const container of [null, [], "nonsense", () => {}, new Map([["maximumWarnings", 5]])])
    assert.equal(accepted(container), "ConfigurationError",
      `a ${Object.prototype.toString.call(container)} limits container must be refused, not read as the defaults`);

  // AND AN UNKNOWN BUDGET NAME, which is the nested half of the every-door decision.
  assert.equal(accepted({ maximumFiles: 1 }), "ConfigurationError");
  assert.equal(accepted({ maximumLocalizedStringsFiles: 1 }), "accepted",
    "the correct spelling must be accepted, or the refusal above proves nothing");
});

test("the seven budget names the refusal knows are the seven the resolver reads", () => {
  // THE DERIVATION, so the refusal list cannot drift from the reads it guards. A budget added to
  // `resolveLimits` and not to `LIMIT_NAMES` would be silently unrefusable — an option the library
  // reads and the guard calls unknown is worse than either alone.
  const resolved = Object.keys(resolveLimits(undefined)).sort();
  assert.equal(resolved.length, 7, "the resolved limits record changed size");
  for (const name of resolved)
    assert.equal(accepted(() => parseStrings(CATALOG_TEXT, { locale: "en", limits: { [name]: 1 } })), true,
      `\`${name}\` is read by resolveLimits but refused by the guard`);

  function accepted(/** @type {() => unknown} */ run) {
    try { run(); return true; } catch (error) {
      return !/does not take/.test(/** @type {Error} */ (error).message);
    }
  }
});

test.after(() => {
  rmSync(directory, { recursive: true, force: true });
  rmSync(beside, { recursive: true, force: true });
});
