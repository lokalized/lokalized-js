import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { writeHeapSnapshot } from "node:v8";

import { loadEntireManifest, loadStrings } from "../src/load/index.js";
import { createStringsManifestFromDirectory, loadEntireManifestFromFiles } from "../src/node/index.js";

/**
 * A REJECTED LOAD MUST NOT KEEP THE CATALOGS THAT HAD ALREADY PARSED — M8 clause 78, plan 9.3
 * metric 7.
 *
 * **THE MECHANISM, because it is not obvious and it is why this is a real defect rather than
 * bookkeeping.** `runPlan` parses into a slot array, and a failed load throws an error the caller
 * typically HOLDS: in a log line, a retry record, an `assert.rejects`. An `Error` captures its stack,
 * the stack retains the frames it was built in, those frames retain `runPlan`'s scope, and that scope
 * retains the slots — so a six-file load that failed ONE digest kept all five catalogs that parsed
 * successfully, for as long as the caller kept the rejection. Measured before the fix: 5 of 5.
 * After: 0 of 5, with a deliberately-kept record as the control that still reads 1.
 *
 * **TWO EARLIER INSTRUMENTS FOR THIS CLAUSE WERE BUILT AND DELETED (M8 S26), and this one is shaped
 * by why.** A `WeakRef` on the bytes the transport handed over was VACUOUS — `readBoundedStream`
 * COPIES the chunks, so the watched object was released at the boundary whatever the loader kept, and
 * the tell was an ablation that refused to fire. A heap-delta rebuild failed its own precondition:
 * four ~1.5 MB catalogs deliberately KEPT moved `heapUsed` by ~490 KB against a ~1.4 MB budget. Both
 * were deleted rather than tuned, because lowering a threshold until the control passes produces a
 * green gate whose number nobody understands.
 *
 * **SO THIS INSTRUMENT WATCHES THE PARSED CATALOG, WHICH IS WHAT THE LOADER ACTUALLY RETAINS**, and
 * it counts rather than measures: a unique needle is embedded in each catalog's CONTENT, and the
 * question asked of a heap snapshot is how many live strings contain it. No `--expose-gc`, no
 * threshold, and nothing to tune. The needles are rebuilt AFTER the snapshot is taken, so this file's
 * own literals cannot be counted as retention.
 *
 * **THE FIXTURE IS FIVE CATALOGS WIDE AND EVERY ONE IS ASSERTED ABSENT, which is not cosmetic.** A
 * two-file fixture parses exactly one catalog, and an implementation that released only the first
 * slot (`results[0] = null`) would pass every arm while still retaining four of five. Measured: it
 * does pass the narrow form, and it fails five arms of this one: digest, refuse, partial, abort and
 * late (measured 2026-09-23 on Node 20, 22 and 24).
 */

const TAGS = ["en", "fr", "de", "it", "es"];
const NEEDLE = (arm, tag) => `lokalized-retention-${arm}-${tag}-a41c7`;

/** @type {string[]} */
const temporaryDirectories = [];
// In a hook, not at the end of the test: a red assertion skipped the removal, and every failing run
// (each ablation of this file, for one) left its eight fixture directories in the system temp folder.
after(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

function catalogDirectory(arm, tags) {
  const directory = mkdtempSync(join(tmpdir(), `lokalized-retention-${arm}-`));
  temporaryDirectories.push(directory);
  for (const tag of tags)
    writeFileSync(join(directory, `${tag}.json`), JSON.stringify({ Key: `${NEEDLE(arm, tag)} ${tag}` }));
  return directory;
}

const manifestFor = (arm, tags, baseUrl) =>
  createStringsManifestFromDirectory(catalogDirectory(arm, tags), {
    catalogVersion: "v1",
    fallbackLocale: "en",
    ...(baseUrl ? { publicationBaseUrl: baseUrl } : {}),
  });

/**
 * A transport over a real directory, with named failure modes.
 *
 * @param {string} directory
 * @param {{ tamper?: string[], refuse?: string[] }} [modes]
 */
function transportFor(directory, modes = {}) {
  return async (url) => {
    const name = String(url).split("/").pop() ?? "";
    const tag = name.replace(/\.json$/, "");
    if (modes.refuse?.includes(tag)) throw new Error(`refused ${tag}`);
    if (modes.tamper?.includes(tag))
      return new Response(JSON.stringify({ Key: "tampered, so this body fails its digest" }));
    const { readFileSync } = await import("node:fs");
    return new Response(readFileSync(join(directory, name)));
  };
}

/**
 * A `readFile` for the Node file door that holds each tag named in `holds` until the test calls its
 * `release`, which exists from the moment the loader asks for that file.
 *
 * **WHY THE ABORT ARMS USE THIS DOOR.** Once an injected `readFile` resolves, the rest of that file's
 * load (the bounded read of one chunk, the synchronous hash, the parse, and the slot write or the
 * `return`) runs as microtasks, with no timer and no I/O wait. So one `tick()` after a read is
 * released is enough to know the loader has finished with it, and the abort arms need neither a
 * sleep nor a retry. The Fetch door hashes with WebCrypto, which completes on its own schedule.
 *
 * @param {Record<string, { release?: () => void }>} holds
 */
function readerFor(holds) {
  return async (/** @type {string} */ url) => {
    const tag = (String(url).split("/").pop() ?? "").replace(/\.json$/, "");
    const held = holds[tag];
    if (held) await new Promise((resolve) => { held.release = resolve; });
    return new Uint8Array(readFileSync(new URL(url)));
  };
}

/** One turn of the event loop: every microtask queued before it has run. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Resolves once `holder.release` exists. FAILS rather than waiting forever: if `load` settles first
 * (a loader that rejects or finishes without asking for the held file), and if ten seconds pass (a
 * loader that stalls without asking for it, e.g. one admitting a single read while another is held).
 * The deadline can only turn a stall into a named failure; it cannot make anything pass.
 */
async function started(/** @type {{ release?: () => void }} */ holder, /** @type {Promise<unknown>} */ load) {
  let settled = false;
  load.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10_000;
  while (!holder.release) {
    assert.ok(!settled, "the load settled before the held read started, so this arm cannot run");
    assert.ok(Date.now() < deadline, "the held read did not start within 10 s, so this arm cannot run");
    await tick();
  }
}

/**
 * Every live string in a heap snapshot.
 *
 * **WRITTEN TO A FILE, SYNCHRONOUSLY, AND NOT STREAMED — the streamed form stalled.** It used to
 * async-iterate `getHeapSnapshot()`, and on Node 22.14.0 that iteration never completes: the event
 * loop empties while the test awaits it and the runner cancels the test with "Promise resolution is
 * still pending but the event loop has already resolved". Measured 2026-09-23 with this file alone,
 * eight processes at a time: 40 of 40 runs failed on 22.14.0 and 0 of 40 on 20.20.2 and 24.18.0, and
 * CI's unit-test step went red on single Node legs in exactly that way on 2026-09-21 and twice on
 * 2026-09-23. `writeHeapSnapshot` finishes before it returns, so there is nothing to wait for. On
 * 22.14.0 the old form never reached an assertion at all, so there this file checked nothing.
 */
let snapshotDirectory = "";
function heapStrings() {
  if (!snapshotDirectory) {
    snapshotDirectory = mkdtempSync(join(tmpdir(), "lokalized-retention-snapshot-"));
    temporaryDirectories.push(snapshotDirectory);
  }
  const file = writeHeapSnapshot(join(snapshotDirectory, "retention.heapsnapshot"));
  return JSON.parse(readFileSync(file, "utf8")).strings;
}

// The timeout is a backstop so a stall anywhere reports as a failure rather than a hung suite.
test("a rejected load releases every catalog it had already parsed", { timeout: 120_000 }, async () => {
  /**
   * Held exactly as a caller holds one: the rejection is kept for the life of the test.
   *
   * **THE `try`/`catch` FORM OF THIS HELPER COULD NOT REPORT A LOAD THAT SUCCEEDED**, and an ablation
   * that failed to fire is what found it: its `assert.fail` was thrown INSIDE the `try` and caught by
   * its own `catch`, which then pushed the AssertionError onto `held` and returned it. So
   * `held.length` counted it, every needle assertion below passed over a load that had returned a
   * record, and an arm whose loader stopped rejecting at all read as clean. Fixed at the cause: the
   * settled value is inspected from outside, which is the one shape where a resolution cannot be
   * mistaken for a rejection.
   */
  const held = [];
  const reject = async (promise) => {
    const settled = await promise.then(() => null, (error) => error);
    assert.ok(settled, "the load was expected to reject, and a resolved load retains legitimately");
    held.push(settled);
    return settled;
  };

  // ARM 1 — a digest failure on the whole-manifest fetch door.
  const digestDirectory = catalogDirectory("digest", TAGS);
  const digestManifest = await createStringsManifestFromDirectory(digestDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  await reject(loadEntireManifest(digestManifest, { fetch: transportFor(digestDirectory, { tamper: ["es"] }) }));

  // ARM 2 — a transport that refuses, so nothing about the failure is the digest's doing.
  const refuseDirectory = catalogDirectory("refuse", TAGS);
  const refuseManifest = await createStringsManifestFromDirectory(refuseDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  await reject(loadEntireManifest(refuseManifest, { fetch: transportFor(refuseDirectory, { refuse: ["es"] }) }));

  // ARM 3 — `allow-partial` where the FALLBACK is the file that failed, which the loader refuses to
  // offer as a partial result. A partial load that SUCCEEDS legitimately retains what arrived; this
  // is the partial case that still rejects.
  const partialDirectory = catalogDirectory("partial", TAGS);
  const partialManifest = await createStringsManifestFromDirectory(partialDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  await reject(loadEntireManifest(partialManifest, {
    fetch: transportFor(partialDirectory, { tamper: ["en"] }),
    partialFailure: "allow-partial",
  }));

  // ARM 4 — an ABORT delivered from inside a worker, with `reason` undefined so the thrown value is
  // the loader's own `new Error("aborted")`, built inside the worker closure. That is the path the
  // outer clearing cannot reach, and the reason the fix wraps `Promise.all` in a `catch`. At the file
  // door (see `readerFor`), so the four unheld catalogs have certainly parsed into their slots before
  // the abort: this arm is about releasing catalogs the load had already parsed.
  const abortDirectory = catalogDirectory("abort", TAGS);
  const abortManifest = await createStringsManifestFromDirectory(abortDirectory, {
    catalogVersion: "v1", fallbackLocale: "en",
  });
  /** @type {Record<string, { release?: () => void }>} */
  const abortHolds = { es: {} };
  const signal = { aborted: false, reason: undefined, addEventListener() {}, removeEventListener() {} };
  const aborting = loadEntireManifestFromFiles(abortManifest, {
    readFile: readerFor(abortHolds),
    signal: /** @type {any} */ (signal),
  });
  await started(abortHolds.es, aborting);
  await tick(); // en, fr, de and it have parsed into their slots
  signal.aborted = true;
  /** @type {() => void} */ (abortHolds.es.release)();
  await reject(aborting);

  // ARM 4b — a read STILL IN FLIGHT when the load rejects, which finishes afterwards. `es` is released
  // after the abort, so its worker writes its slot, sees the abort and throws, and the load rejects;
  // `fr` is released only after that, and one tick later its catalog has parsed into a load whose
  // slots were already cleared. Before `run-plan.js` stopped late writes, that catalog went into a
  // cleared slot and the held rejection kept it. Measured 2026-09-23: with that version of run-plan.js
  // this arm fails on every run, on Node 20, 22 and 24.
  const lateDirectory = catalogDirectory("late", TAGS);
  const lateManifest = await createStringsManifestFromDirectory(lateDirectory, {
    catalogVersion: "v1", fallbackLocale: "en",
  });
  /** @type {Record<string, { release?: () => void }>} */
  const lateHolds = { es: {}, fr: {} };
  const lateSignal = { aborted: false, reason: undefined, addEventListener() {}, removeEventListener() {} };
  const lateLoad = loadEntireManifestFromFiles(lateManifest, {
    readFile: readerFor(lateHolds),
    signal: /** @type {any} */ (lateSignal),
  });
  await started(lateHolds.es, lateLoad);
  await started(lateHolds.fr, lateLoad);
  await tick(); // en, de and it have parsed into their slots
  lateSignal.aborted = true;
  /** @type {() => void} */ (lateHolds.es.release)();
  await reject(lateLoad);
  /** @type {() => void} */ (lateHolds.fr.release)();
  await tick(); // fr has parsed, after the rejection

  // ARM 5 — the NODE FILE DOOR, so the property is pinned for the other transport too. Same runner,
  // and nothing here would notice if the two doors ever stopped sharing it.
  const nodeDirectory = catalogDirectory("nodedoor", TAGS);
  const nodeManifest = await createStringsManifestFromDirectory(nodeDirectory, {
    catalogVersion: "v1", fallbackLocale: "en",
  });
  rmSync(join(nodeDirectory, "es.json"));
  await reject(loadEntireManifestFromFiles(nodeManifest));

  // ARM 6 — the SUBSET door, which plans a candidate chain rather than the whole manifest.
  const subsetDirectory = catalogDirectory("subset", TAGS);
  const subsetManifest = await createStringsManifestFromDirectory(subsetDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  await reject(loadStrings(subsetManifest, "it", { fetch: transportFor(subsetDirectory, { tamper: ["en"] }) }));

  // ARM 7 — an AGGREGATE BUDGET CROSSING, the newest rejection path. Every one of the five catalogs
  // parses cleanly and is in its slot when the reconciliation walk crosses the node budget at the
  // second file. **This arm does NOT gate the release on that path**, and this comment used to claim it
  // did: that error is built in `runPlan`'s own frame, not in a worker closure, so the held rejection
  // never reaches `results`. Measured: removing that one release leaves this file green on Node 20, 22
  // and 24 (`run-plan.js` says the same beside it). The arm stays because it pins that this rejection,
  // too, retains nothing, whatever the reason.
  const budgetDirectory = catalogDirectory("budget", TAGS);
  const budgetManifest = await createStringsManifestFromDirectory(budgetDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  await reject(loadEntireManifest(budgetManifest, {
    fetch: transportFor(budgetDirectory),
    limits: { maximumTranslationNodes: 1 },
  }));

  // THE CONTROL, and it is asserted before any absence is believed: a record the test KEEPS must be
  // findable by exactly the same instrument. Without it, a snapshot that simply contains no needles
  // — a broken reader, a renamed field, a snapshot taken of the wrong isolate — reads as a clean
  // release.
  const keptDirectory = catalogDirectory("kept", ["en"]);
  const keptManifest = await createStringsManifestFromDirectory(keptDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  const keptRecord = await loadEntireManifest(keptManifest, { fetch: transportFor(keptDirectory) });

  const strings = heapStrings();
  const reachable = (arm, tag) =>
    strings.filter((value) => typeof value === "string" && value.includes(NEEDLE(arm, tag))).length;

  assert.ok(reachable("kept", "en") > 0,
    "the control is unreachable, so this instrument cannot distinguish release from blindness");
  assert.equal(Object.keys(keptRecord.catalogs).length, 1);
  assert.equal(held.length, 8, "every arm must have rejected");

  // EVERY parsed tag, not just one. An implementation that released only the first slot retains four
  // of these five and passes a one-tag assertion.
  for (const arm of ["digest", "refuse", "partial", "abort", "late", "nodedoor", "budget"])
    assert.deepEqual(
      TAGS.filter((tag) => reachable(arm, tag) > 0), [],
      `the held rejection from the '${arm}' arm still reaches parsed catalogs`,
    );
  // The subset door plans `it` -> `en` only, so those are the tags it could have parsed.
  assert.deepEqual(
    ["it", "en"].filter((tag) => reachable("subset", tag) > 0), [],
    "the held rejection from the subset door still reaches parsed catalogs",
  );
});
