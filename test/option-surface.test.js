import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createStrings } from "../src/core/index.js";
import { mergeParsedStringsFiles, parseStrings } from "../src/parse/index.js";
import { resolveLimits } from "../src/internal/catalog.js";
import {
  loadEntireManifest, loadStrings, localeConfigurationForManifest, parseStringsManifest,
  validateStringsManifest,
} from "../src/load/index.js";
import {
  createStringsManifestFromDirectory, loadEntireManifestFromFiles, loadStringsFromDirectory,
  loadStringsFromFiles, readStringsFromDirectory, readStringsManifest,
} from "../src/node/index.js";

/**
 * **EVERY PUBLIC DOOR REFUSES AN OPTION IT DOES NOT KNOW — twelve of twelve — AND THIS FILE IS THE
 * RECORD OF THE DECISION THAT MADE IT SO.**
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
 * **A SOURCE DERIVATION WAS TRIED AND IS UNSOUND, which is why the door list below is measurement.**
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
 * same constant would make that comparison a tautology. The bogus-name sweep above is what holds
 * this table to the real surface — a name that drifts out of a door's set stops being ignored and
 * starts being refused, which that sweep sees.
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
};

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
  assert.ok(Object.keys(DOORS).length >= 14, "the door list shrank");
});

test("every public door refuses an option it does not know", async () => {
  /** @type {string[]} */
  const ignored = [];
  for (const [name, door] of Object.entries(DOORS)) {
    const without = await settle(door, {});
    const with_ = await settle(door, { [BOGUS]: 1 });
    if (without === with_) ignored.push(name);
    else assert.match(with_, /^threw:ConfigurationError:/,
      `${name}: an unknown option must be a ConfigurationError, not ${with_.slice(0, 80)}`);
  }

  assert.deepEqual(ignored, [],
    "a door has gone back to ignoring unknown options in silence. That is how `{ transport }` " +
    "reached the real network and `{ limits }` ran under the defaults");

  // THE MESSAGE IS PART OF THE CONTRACT, not decoration: it must name the offending key, so a
  // caller can fix it from the message alone rather than by bisecting their config object.
  const message = await settle(DOORS.createStrings, { [BOGUS]: 1 });
  assert.ok(message.includes(BOGUS), `the refusal must name the unknown option; got ${message}`);
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
  // MUST be accepted by some sibling door (or it is not NEAR — it is a name nobody would reach for).
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
  assert.ok(NEAR_MISSES.length >= 6, "the near-miss table shrank");
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

  // AND AN UNKNOWN BUDGET NAME, which is the nested half of the twelve-door decision.
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
