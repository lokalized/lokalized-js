// @ts-check
/**
 * THE FOUR AGGREGATE LOADING BUDGETS, AT THE MANIFEST DOORS — where they were charged PER FILE while
 * every type and every sentence of documentation said they spanned a whole load.
 *
 * **THE DEFECT, MEASURED BEFORE ANYTHING WAS WRITTEN.** `src/internal/catalog.js`'s `LoadingSession`
 * carries four counters that Java threads through an entire directory load
 * (`LocalizedStringLoader.java:1081`), and `src/internal/parse-file.js` exists precisely so
 * `src/node/directory.js` can thread one. `src/load/run-plan.js` could not: it parsed through
 * `lokalized/parse`'s public door, which opens a FRESH session per call and offers no way to supply
 * one. So at the Fetch door and at all four Node file doors each budget started over at every file.
 * Two catalogs of one translation node each, at `maximumTranslationNodes: 1`:
 *
 *     readStringsFromDirectory   REFUSED   ...fr.json: ... exceeds the aggregate maximum of 1 ...
 *     loadEntireManifest         LOADED    complete=true, catalogs [en, fr]
 *
 * **AND IT WAS THREE BUDGETS, NOT ONE.** The same measurement over the pure Fetch door found
 * `maximumTotalInputBytes` (two ~25-byte files at 30) and `maximumWarnings` (two one-warning files at
 * 1) loading just as silently. Only `maximumLocalizedStringsFiles` was covered, and by accident: the
 * MANIFEST VALIDATOR refuses a manifest declaring more files than the budget, before any I/O, so it
 * always fires first. That coincidence is asserted below rather than assumed, because a fix aimed at
 * "the node budget" would leave two live and look complete.
 *
 * **WHY A SHARED SESSION IS THE WRONG FIX, which is why this was parked rather than obvious.**
 * `runPlan` runs up to eight reads at once. One shared counter makes WHICH FILE IS BLAMED depend on
 * completion order, and plan 6.2:2077 fixes the failure list to fetch-plan order, "not completion
 * order". So each file is parsed against its own session — which also keeps a single oversized file
 * refusing WHILE IT IS STILL BEING READ — and the four measured contributions are then replayed into
 * one aggregate session IN PLAN ORDER, through that session's own guarded methods. The first
 * contribution that crosses a budget throws, and it throws the sentence the directory door has always
 * thrown.
 *
 * **TWO DESIGN DECISIONS ARE ASSERTED HERE RATHER THAN LEFT TO BE INFERRED**, because both are
 * choices and both are observable:
 *
 *   1. the crossing is reported at stage `parse`, not `limit` — the same stage this runner has always
 *      reported when ONE file crosses ONE of these budgets on its own. Reporting `limit` would make a
 *      single budget answer with two different stages depending on how many files it took to cross
 *      it. `limit` stays what it is: `readBoundedStream`'s per-file byte bounds, enforced by the
 *      transport before any parsing.
 *   2. the crossing is FATAL whatever `partialFailure` says, exactly as abort is. `allow-partial`
 *      means "some files could not be obtained; serve the rest", and here every file WAS obtained and
 *      parsed cleanly — dropping good catalogs until the rest fit a budget would return a
 *      `complete: false` record whose missing locales have no per-file explanation and whose served
 *      set is decided by a limit rather than by what was published. A file that busts a budget BY
 *      ITSELF is the other thing, keeps its old behaviour, and IS partial-able; both arms are below.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LoadingSession } from "../src/internal/catalog.js";
import { catalogIdentityInputFor } from "../src/load/identity.js";
import { computeCatalogIdentity } from "../src/load/index.js";
import { createStringsManifestFromDirectory } from "../src/node/index.js";
import { loadEntireManifest, loadStrings } from "../src/load/fetch-loader.js";
import { loadEntireManifestFromFiles } from "../src/node/file-loader.js";
import { readStringsFromDirectory } from "../src/node/directory.js";
import { sha256Hex } from "../src/internal/sha256.js";
import { BUILD_IDENTITY } from "../tools/test-support/build-identity.js";

const utf8 = new TextEncoder();

/** @type {string[]} */
const temporaryDirectories = [];

/** @param {Record<string, string>} bodies */
function directoryOf(bodies) {
  const directory = mkdtempSync(join(tmpdir(), "lokalized-aggregate-"));
  temporaryDirectories.push(directory);
  for (const [tag, body] of Object.entries(bodies)) writeFileSync(join(directory, `${tag}.json`), body);
  return directory;
}

/**
 * A manifest over already-encoded bodies, shaped like `test/loader-warning-order.test.js`'s.
 *
 * @param {Record<string, string>} bodies
 * @param {{ fallbackLocale?: string, tiebreakers?: Record<string, readonly string[]> }} [options]
 */
function manifestOver(bodies, { fallbackLocale = "en", tiebreakers = {} } = {}) {
  /** @type {Record<string, { url: string, sha256: string }>} */
  const files = {};
  for (const tag of Object.keys(bodies))
    files[tag] = { url: `${tag}.json`, sha256: sha256Hex(utf8.encode(/** @type {string} */ (bodies[tag]))) };
  const draft = {
    formatVersion: 1, catalogVersion: "aggregate-budgets", catalogFingerprint: "0".repeat(64),
    ...BUILD_IDENTITY, fallbackLocale, baseUrl: "https://cdn.example/v1/", files, tiebreakers,
  };
  draft.catalogFingerprint = computeCatalogIdentity(catalogIdentityInputFor(draft)).catalogFingerprint;
  return /** @type {any} */ (draft);
}

/** @param {Record<string, string>} bodies @param {{ refuse?: readonly string[] }} [modes] */
const transportOver = (bodies, { refuse = [] } = {}) => async (/** @type {string} */ url) => {
  const tag = (String(url).split("/").pop() ?? "").replace(/\.json$/, "");
  if (refuse.includes(tag)) throw new Error(`refused ${tag}`);
  return new Response(utf8.encode(/** @type {string} */ (bodies[tag])));
};

/** One root key whose placeholder declares one cardinal form and is missing the rest — one warning. */
const warner = (/** @type {string} */ key) => JSON.stringify({
  [key]: { translation: "{{n}}", placeholders: { n: { value: "n", translations: { CARDINALITY_ONE: "x" } } } },
});

const oneNode = (/** @type {string} */ text) => JSON.stringify({ Key: text });

/** @param {Promise<unknown>} promise */
const refusal = (promise) => promise.then(() => null, (/** @type {any} */ thrown) => thrown);

const stages = (/** @type {any} */ error) =>
  error.failures.map((/** @type {any} */ f) => [f.locale, f.stage]);
const causeOf = (/** @type {any} */ error) => String(error.failures[0].cause.message);

// -------------------------------------------------------------------------------------------
// D1 — the defect's own probe, at both doors, over the same catalogs.
// -------------------------------------------------------------------------------------------

test("D1: two one-node catalogs at a node budget of one are refused by BOTH doors", async () => {
  const bodies = { en: oneNode("Hello"), fr: oneNode("Bonjour") };
  const directory = directoryOf(bodies);
  const limits = { maximumTranslationNodes: 1 };

  /** @type {any} */
  let directoryDoor = null;
  try { readStringsFromDirectory(directory, { limits }); } catch (thrown) { directoryDoor = thrown; }
  assert.ok(directoryDoor, "the directory door has refused this since M8 S2; if it stops, the fix is moot");
  const manifestDoor = await refusal(
    loadEntireManifest(manifestOver(bodies), { fetch: transportOver(bodies), limits }));

  assert.ok(manifestDoor, "the manifest door must refuse; before this fix it returned complete: true");

  // **ONE SENTENCE, NOT TWO.** The reconciler replays through `LoadingSession`'s own guarded methods
  // rather than adding the numbers itself, so both doors report the session's own wording. A
  // reconciler that compared totals by hand would have produced a second message for the same budget.
  //
  // WHAT IS NOT CLAIMED, because an adversarial pass found the stronger version false: the two doors
  // do NOT always blame the same catalog. The directory walk enumerates filenames in UTF-8 byte
  // order and `wholeManifestPlan` sorts by NORMALIZED TAG, so a catalog set where those disagree —
  // `en-GB.json` beside `en_gb.json`, or any name whose file order and tag order differ — can cross
  // the same budget at a different file. This fixture is two names on which both orders agree, which
  // is why the basename assertion below is sound HERE and is not a general parity claim.
  const sentence = ": localized strings load exceeds the aggregate maximum of 1 translation nodes";
  assert.ok(directoryDoor.message.endsWith(sentence), directoryDoor.message);
  assert.ok(causeOf(manifestDoor).endsWith(sentence), causeOf(manifestDoor));

  // BOTH NAME THE SECOND FILE. `fr` is second in the directory walk and second in the fetch plan.
  // Compared on the basename, because the directory door reports the REALPATH — on this host
  // `/var/folders/...` resolves to `/private/var/folders/...`, and a prefix comparison against the
  // path handed in fails for a reason that has nothing to do with the budget.
  assert.equal(directoryDoor.message.slice(0, directoryDoor.message.indexOf(sentence)).split("/").pop(),
    "fr.json");
  assert.deepEqual(stages(manifestDoor), [["fr", "parse"]]);

  // THE CONTROL, without which every row above is satisfied by a budget that refuses everything.
  const generous = await loadEntireManifest(manifestOver(bodies),
    { fetch: transportOver(bodies), limits: { maximumTranslationNodes: 2 } });
  assert.equal(generous.complete, true);
  assert.deepEqual(Object.keys(generous.catalogs), ["en", "fr"]);
  assert.deepEqual(Object.keys(readStringsFromDirectory(directory,
    { limits: { maximumTranslationNodes: 2 } }).catalogs), ["en", "fr"]);
});

// -------------------------------------------------------------------------------------------
// D2 — all four budgets, and which of them the fix actually moved.
// -------------------------------------------------------------------------------------------

test("D2: three budgets were live and the fourth was already covered upstream", async () => {
  /** nodes */
  const nodes = { en: oneNode("Hello"), fr: oneNode("Bonjour") };
  const nodeError = await refusal(loadEntireManifest(manifestOver(nodes),
    { fetch: transportOver(nodes), limits: { maximumTranslationNodes: 1 } }));
  assert.match(causeOf(nodeError), /aggregate maximum of 1 translation nodes$/);
  assert.equal((await loadEntireManifest(manifestOver(nodes),
    { fetch: transportOver(nodes), limits: { maximumTranslationNodes: 2 } })).complete, true);

  /** total input bytes — the per-file `maximumInputBytes` is left generous so it cannot fire first */
  const bytes = { en: oneNode("Hello"), fr: oneNode("Bonjour") };
  const enBytes = utf8.encode(/** @type {string} */ (bytes.en)).length;
  const frBytes = utf8.encode(/** @type {string} */ (bytes.fr)).length;
  assert.ok(enBytes < enBytes + frBytes, "the fixture must need two files to cross");
  const byteError = await refusal(loadEntireManifest(manifestOver(bytes), {
    fetch: transportOver(bytes),
    limits: { maximumTotalInputBytes: enBytes + frBytes - 1, maximumInputBytes: 4096 },
  }));
  assert.match(causeOf(byteError), /aggregate maximum of \d+ input bytes$/);
  assert.deepEqual(stages(byteError), [["fr", "parse"]]);
  assert.equal((await loadEntireManifest(manifestOver(bytes), {
    fetch: transportOver(bytes),
    limits: { maximumTotalInputBytes: enBytes + frBytes, maximumInputBytes: 4096 },
  })).complete, true, "the budget is crossed by ONE byte, so the control is adjacent to the refusal");

  /** warnings */
  const warnings = { en: warner("A"), fr: warner("B") };
  const warningError = await refusal(loadEntireManifest(manifestOver(warnings),
    { fetch: transportOver(warnings), limits: { maximumWarnings: 1 } }));
  assert.match(causeOf(warningError), /aggregate maximum of 1 warnings$/);
  assert.deepEqual(stages(warningError), [["fr", "parse"]]);
  const twoWarnings = await loadEntireManifest(manifestOver(warnings),
    { fetch: transportOver(warnings), limits: { maximumWarnings: 2 } });
  assert.equal(twoWarnings.warnings.length, 2);

  // **THE FOURTH IS PRE-EMPTED, AND THAT IS A MEASUREMENT RATHER THAN A DESIGN.** A manifest declares
  // its files, so `validateStringsManifest` can count them before any I/O and refuses there — with a
  // ConfigurationError, at a different phase and in different words. The declared count is always at
  // least the parsed count (a subset load fetches a chain out of the same declared set), so the
  // reconciler's own file charge can never fire first at these doors. It is kept anyway, and
  // unit-tested below, so `absorb` stays ONE replay of the session's four rules rather than three.
  const fileError = await refusal(loadEntireManifest(manifestOver(nodes),
    { fetch: transportOver(nodes), limits: { maximumLocalizedStringsFiles: 1 } }));
  assert.equal(fileError.name, "ConfigurationError");
  assert.match(fileError.message, /A manifest declares 2 files, which exceeds the maximum of 1/);
  assert.equal(fileError.failures, undefined, "it is refused before the plan is ever run");
});

test("D2b: the replay charges the file budget too, which no door reaches today", () => {
  // Reached as a unit, because the door-level path is pre-empted by the manifest validator (D2). A
  // replay missing this charge is invisible end to end, and would stay invisible until a door with an
  // undeclared file set existed — which is exactly how a rule rots into a list of excuses.
  const aggregate = new LoadingSession({ maximumLocalizedStringsFiles: 2 });
  const contribution = new LoadingSession();
  contribution.localizedStringsFiles = 1;

  aggregate.absorb(contribution, "one");
  aggregate.absorb(contribution, "two");
  assert.throws(() => aggregate.absorb(contribution, "three"),
    /^Error: three: localized strings load exceeds the aggregate localized strings file limit of 2$/);

  // AND IT LOOPS RATHER THAN ASSUMING ONE: a contribution that parsed two resources charges two.
  const pair = new LoadingSession();
  pair.localizedStringsFiles = 2;
  const tight = new LoadingSession({ maximumLocalizedStringsFiles: 2 });
  tight.absorb(pair, "pair");
  assert.equal(tight.localizedStringsFiles, 2);
  assert.throws(() => tight.absorb(contribution, "next"), /aggregate localized strings file limit of 2/);
});

// -------------------------------------------------------------------------------------------
// D3 — the stage, asserted in BOTH directions, because one direction alone is not the claim.
// -------------------------------------------------------------------------------------------

test("D3: one file crossing and two files crossing report the SAME stage", async () => {
  // ONE FILE, which has always been refused during its own parse and reported at stage `parse`. This
  // arm is the fixed point the cross-file stage is chosen to agree with; without it "the crossing is
  // reported at `parse`" is a preference rather than a consistency argument.
  const alone = { en: JSON.stringify({ A: "a", B: "b" }), fr: oneNode("Bonjour") };
  const single = await refusal(loadEntireManifest(manifestOver(alone),
    { fetch: transportOver(alone), limits: { maximumTranslationNodes: 1 } }));
  assert.deepEqual(stages(single), [["en", "parse"]]);
  assert.match(single.message, /^1 catalog file\(s\) failed to load$/,
    "a single file busting its own budget is that FILE's failure and keeps the per-file wording");

  // TWO FILES. Same stage, different top-level message, because it is a different kind of refusal.
  const together = { en: oneNode("Hello"), fr: oneNode("Bonjour") };
  const crossing = await refusal(loadEntireManifest(manifestOver(together),
    { fetch: transportOver(together), limits: { maximumTranslationNodes: 1 } }));
  assert.deepEqual(stages(crossing), [["fr", "parse"]]);
  assert.match(crossing.message, /^the load exceeds an aggregate loading limit; /);

  // AND `limit` STILL MEANS WHAT IT MEANT: the transport's per-file byte bound, refused before any
  // parsing. Asserted here so the two stages cannot quietly merge. Only `en` is over the bound —
  // `fr`'s body is under it and parses — which also shows the bound is per file rather than aggregate,
  // as it is documented to be: `maximumInputBytes` is a resource bound, `maximumTotalInputBytes` is
  // the load's.
  const oversized = { en: oneNode("Hello".repeat(50)), fr: oneNode("Bonjour") };
  const bounded = await refusal(loadEntireManifest(manifestOver(oversized),
    { fetch: transportOver(oversized), limits: { maximumInputBytes: 32 } }));
  assert.deepEqual(stages(bounded), [["en", "limit"]]);
});

// -------------------------------------------------------------------------------------------
// D4b — the diagnostics an aggregate crossing must NOT throw away.

test("D4b: an aggregate crossing carries the per-file failures it interrupted, in plan order", async () => {
  // **THE FIRST VERSION OF THIS FIX DISCARDED THEM, and an adversarial pass measured it.** Reaching
  // the aggregate check under `allow-partial` means some files had ALREADY failed and were being
  // tolerated. Throwing the budget crossing alone reported "you are over budget" and silently lost
  // every reason a file had been unreadable — so a caller is told to lower a limit when what they
  // actually have is a corrupt catalog.
  const dir = mkdtempSync(join(tmpdir(), "lokalized-aggregate-partial-"));
  temporaryDirectories.push(dir);
  for (const tag of ["en", "fr", "de"])
    writeFileSync(join(dir, `${tag}.json`), JSON.stringify({ A: `a-${tag}` }));
  const manifest = await createStringsManifestFromDirectory(dir, {
    catalogVersion: "v1", fallbackLocale: "en",
  });
  // Corrupt the BYTES AFTER the manifest is built. Tampering the manifest instead is refused by its
  // own fingerprint self-consistency check before any I/O — the `zh-123` shape, and the first draft
  // of this probe had it.
  writeFileSync(join(dir, "fr.json"), JSON.stringify({ A: "a much longer tampered body" }));

  // THE CONTROL, and it is what makes the assertion below mean anything: with no aggregate budget
  // the same load is a tolerated partial that RECORDS the per-file failure.
  const tolerated = await loadEntireManifestFromFiles(manifest, { partialFailure: "allow-partial" });
  assert.equal(tolerated.complete, false);
  assert.deepEqual(tolerated.failures.map((f) => f.locale), ["fr"],
    "the control must record a per-file failure, or there is nothing for the crossing to discard");

  const crossing = await loadEntireManifestFromFiles(manifest, {
    partialFailure: "allow-partial", limits: { maximumTranslationNodes: 1 },
  }).then(() => null, (error) => error);
  assert.ok(crossing, "the aggregate crossing must still be fatal");

  // BOTH failures, and in FETCH-PLAN order — `de`, `en`, `fr` by normalized tag, so the interrupted
  // `en` precedes the unreadable `fr`. Plan 6.2:2077 puts failures in plan order and this list is
  // assembled from two sources, which is exactly where an append-and-hope would have broken it.
  assert.deepEqual(crossing.failures.map((f) => `${f.locale}:${f.stage}`), ["en:parse", "fr:limit"],
    "the crossing must carry the failures it interrupted, merged in fetch-plan order");
});

// D4 — `allow-partial`, and the two kinds of over-budget it has to tell apart.
// -------------------------------------------------------------------------------------------

test("D4: an aggregate crossing is fatal under allow-partial; a single oversized file is not", async () => {
  const bodies = { en: oneNode("Hello"), fr: oneNode("Bonjour") };

  // THE CROSSING IS FATAL. Every file was obtained and parsed cleanly, so there is no per-file
  // failure to serve around, and a partial result here would be a catalog set chosen by a byte
  // budget. The fallback (`en`) loaded, so the existing partial-failure machinery would otherwise
  // have been happy to return a subset.
  const crossing = await refusal(loadEntireManifest(manifestOver(bodies), {
    fetch: transportOver(bodies),
    partialFailure: "allow-partial",
    limits: { maximumTranslationNodes: 1 },
  }));
  assert.ok(crossing, "allow-partial must not convert an aggregate crossing into a partial success");
  assert.match(crossing.message, /a partial result is not offered/);
  assert.deepEqual(stages(crossing), [["fr", "parse"]]);

  // A SINGLE OVERSIZED FILE IS THE OTHER THING, and its behaviour is unchanged by the fix: it is
  // refused during its own parse, becomes one failure among many, and `allow-partial` serves the
  // rest. This is the arm that proves the per-file session was kept rather than replaced.
  const lopsided = { en: oneNode("Hello"), fr: JSON.stringify({ A: "a", B: "b", C: "c" }) };
  const partial = await loadEntireManifest(manifestOver(lopsided), {
    fetch: transportOver(lopsided),
    partialFailure: "allow-partial",
    limits: { maximumTranslationNodes: 2 },
  });
  assert.equal(partial.complete, false);
  assert.deepEqual(Object.keys(partial.catalogs), ["en"]);
  assert.deepEqual(stages(partial === null ? {} : { failures: partial.failures }), [["fr", "parse"]]);

  // **AND WHAT COMES BACK FITS THE LIMITS THAT WERE DECLARED**, which is the invariant reconciling
  // over the SURVIVORS buys. `fr` failed to arrive at all here, and the two that did still have to
  // clear the budget together — they do not.
  const missing = { en: oneNode("Hello"), fr: oneNode("Bonjour"), de: oneNode("Hallo") };
  const stillTooMuch = await refusal(loadEntireManifest(manifestOver(missing), {
    fetch: transportOver(missing, { refuse: ["fr"] }),
    partialFailure: "allow-partial",
    limits: { maximumTranslationNodes: 1 },
  }));
  assert.match(stillTooMuch.message, /aggregate loading limit/);

  const fits = await loadEntireManifest(manifestOver(missing), {
    fetch: transportOver(missing, { refuse: ["fr"] }),
    partialFailure: "allow-partial",
    limits: { maximumTranslationNodes: 2 },
  });
  assert.equal(fits.complete, false);
  assert.deepEqual(Object.keys(fits.catalogs), ["de", "en"]);
});

// -------------------------------------------------------------------------------------------
// D5 — plan order, not completion order, at the NODE door.
//
// `test/loader-warning-order.test.js`'s M4 makes this argument for the warning budget at the Fetch
// door. It is repeated here for the node budget at the other transport, because the two doors share
// `runPlan` today and nothing else in the tree would notice if they stopped.
// -------------------------------------------------------------------------------------------

test("D5: the blamed file is the second in PLAN order, not the second to settle", async () => {
  const bodies = { en: oneNode("Hello"), fr: oneNode("Bonjour") };
  const directory = directoryOf(bodies);
  const manifest = manifestOver(bodies);
  // Rewritten onto the directory, because the Node door reads `file:` URLs.
  const fileManifest = { ...manifest, baseUrl: new URL(`${directory}/`, "file:").href };

  /** @type {string[]} */
  const settleLog = [];
  /** @type {Map<string, () => void>} */
  const gates = new Map();
  const readFile = async (/** @type {string} */ url) => {
    const tag = (url.split("/").pop() ?? "").replace(/\.json$/, "");
    await new Promise((resolve) => gates.set(tag, () => resolve(undefined)));
    settleLog.push(tag);
    return utf8.encode(/** @type {string} */ (bodies[tag]));
  };

  const pending = refusal(loadEntireManifestFromFiles(/** @type {any} */ (fileManifest),
    { readFile, limits: { maximumTranslationNodes: 1 } }));

  const settle = async (/** @type {string} */ tag) => {
    for (let turn = 0; turn < 200 && !gates.has(tag); turn += 1)
      await new Promise((resolve) => setImmediate(resolve));
    /** @type {() => void} */ (gates.get(tag))();
    for (let turn = 0; turn < 40; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  await settle("fr");
  await settle("en");
  const error = await pending;

  assert.deepEqual(settleLog, ["fr", "en"],
    "the fixture must settle out of plan order, or a completion-order reconciler passes vacuously");
  assert.ok(error, "the aggregate budget must be crossed");
  assert.deepEqual(stages(error), [["fr", "parse"]],
    "plan order is [en, fr]; a completion-order reconciler charges fr first and blames en");
});

// -------------------------------------------------------------------------------------------
// D6 — the subset door plans a CHAIN, so its plan order is not its manifest's key order.
// -------------------------------------------------------------------------------------------

test("D6: the subset door reconciles over its fetch plan, not over the manifest", async () => {
  const bodies = { en: oneNode("Hello"), "fr-CA": oneNode("Bonjour CA"), fr: oneNode("Bonjour") };
  // The tiebreaker is a precondition, not decoration: two `fr` catalogs with no declared order are
  // refused at validation, so without it this fixture never reaches a plan at all.
  const manifest = manifestOver(bodies, { fallbackLocale: "en", tiebreakers: { fr: ["fr-CA", "fr"] } });

  const loaded = await loadStrings(manifest, "fr-CA",
    { fetch: transportOver(bodies), limits: { maximumTranslationNodes: 3 } });
  assert.deepEqual(loaded.requestedFiles.map((/** @type {any} */ f) => f.locale), ["fr-CA", "fr", "en"]);
  assert.equal(loaded.complete, true);

  // THREE PLANNED FILES AT A BUDGET OF TWO: the third in PLAN order is blamed. The manifest's own key
  // order puts `en` first, so a reconciler walking the manifest rather than the plan names a
  // different file.
  const error = await refusal(loadStrings(manifest, "fr-CA",
    { fetch: transportOver(bodies), limits: { maximumTranslationNodes: 2 } }));
  assert.deepEqual(stages(error), [["en", "parse"]]);

  // The budget is NOT charged for catalogs the subset never fetched — `fr-CA` alone clears a budget
  // of one, although the manifest declares three files.
  const narrow = await loadStrings(manifest, "fr-CA", {
    fetch: transportOver(bodies),
    limits: { maximumTranslationNodes: 1 },
  }).then(() => null, (/** @type {any} */ e) => e);
  assert.ok(narrow, "two of the three planned files still cross a budget of one");
  assert.deepEqual(stages(narrow), [["fr", "parse"]]);
});

// -------------------------------------------------------------------------------------------
// D7 — the ORDER of the two checks, which is a decision and is observable.
// -------------------------------------------------------------------------------------------

test("D7: a load that fails on both counts reports its FAILURES, not its budget", async () => {
  // Reconciliation runs AFTER the partial-failure decision, over the survivors. A load that is
  // already failing on per-file failures must say so: replacing "1 catalog file(s) failed to load"
  // with a budget message would answer a question the caller did not ask, about catalogs that were
  // never going to be returned. The survivors here WOULD also cross the budget, so this fixture is
  // satisfied by neither order accidentally.
  const bodies = { en: oneNode("Hello"), fr: oneNode("Bonjour"), de: oneNode("Hallo") };
  const error = await refusal(loadEntireManifest(manifestOver(bodies), {
    fetch: transportOver(bodies, { refuse: ["fr"] }),
    limits: { maximumTranslationNodes: 1 },
  }));
  assert.match(error.message, /^1 catalog file\(s\) failed to load$/);
  assert.deepEqual(stages(error), [["fr", "fetch"]]);

  // THE PRECONDITION, so the row above cannot pass because the survivors happened to fit: the same
  // two survivors under `allow-partial`, where no per-file failure blocks the result, DO cross.
  const surviving = await refusal(loadEntireManifest(manifestOver(bodies), {
    fetch: transportOver(bodies, { refuse: ["fr"] }),
    partialFailure: "allow-partial",
    limits: { maximumTranslationNodes: 1 },
  }));
  assert.match(surviving.message, /^the load exceeds an aggregate loading limit; /);
});

test.after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});
