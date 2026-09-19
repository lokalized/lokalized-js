import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getHeapSnapshot } from "node:v8";

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
 * does pass the narrow form and it reds three arms of this one.
 */

const TAGS = ["en", "fr", "de", "it", "es"];
const NEEDLE = (arm, tag) => `lokalized-retention-${arm}-${tag}-a41c7`;

/** @type {string[]} */
const temporaryDirectories = [];

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
 * @param {{ tamper?: string[], refuse?: string[], hold?: { release?: () => void } }} [modes]
 */
function transportFor(directory, modes = {}) {
  return async (url) => {
    const name = String(url).split("/").pop() ?? "";
    const tag = name.replace(/\.json$/, "");
    if (modes.refuse?.includes(tag)) throw new Error(`refused ${tag}`);
    if (modes.hold && tag === "es")
      await new Promise((resolve) => { modes.hold.release = resolve; });
    if (modes.tamper?.includes(tag))
      return new Response(JSON.stringify({ Key: "tampered, so this body fails its digest" }));
    const { readFileSync } = await import("node:fs");
    return new Response(readFileSync(join(directory, name)));
  };
}

/** Every live string in a heap snapshot. */
async function heapStrings() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of getHeapSnapshot()) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")).strings;
}

test("a rejected load releases every catalog it had already parsed", async () => {
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
  // outer clearing cannot reach, and the reason the fix wraps `Promise.all` in a `catch`.
  const abortDirectory = catalogDirectory("abort", TAGS);
  const abortManifest = await createStringsManifestFromDirectory(abortDirectory, {
    catalogVersion: "v1", fallbackLocale: "en", publicationBaseUrl: "https://cdn.example/v1/",
  });
  /** @type {{ release?: () => void }} */
  const hold = {};
  const signal = { aborted: false, reason: undefined, addEventListener() {}, removeEventListener() {} };
  const aborting = loadEntireManifest(abortManifest, {
    fetch: transportFor(abortDirectory, { hold }),
    signal: /** @type {any} */ (signal),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  signal.aborted = true;
  hold.release?.();
  await reject(aborting);

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

  // ARM 7 — an AGGREGATE BUDGET CROSSING, which is the widest arm in this file and the newest
  // rejection path. Every one of the five catalogs parses CLEANLY and is sitting in its slot when the
  // reconciliation walk crosses the node budget at the second file, so this is the only arm where all
  // five were live at the moment of the throw. An implementation that released slots on the per-file
  // failure paths and forgot this one retains the lot.
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

  const strings = await heapStrings();
  const reachable = (arm, tag) =>
    strings.filter((value) => typeof value === "string" && value.includes(NEEDLE(arm, tag))).length;

  assert.ok(reachable("kept", "en") > 0,
    "the control is unreachable, so this instrument cannot distinguish release from blindness");
  assert.equal(Object.keys(keptRecord.catalogs).length, 1);
  assert.equal(held.length, 7, "every arm must have rejected");

  // EVERY parsed tag, not just one. An implementation that released only the first slot retains four
  // of these five and passes a one-tag assertion.
  for (const arm of ["digest", "refuse", "partial", "abort", "nodedoor", "budget"])
    assert.deepEqual(
      TAGS.filter((tag) => reachable(arm, tag) > 0), [],
      `the held rejection from the '${arm}' arm still reaches parsed catalogs`,
    );
  // The subset door plans `it` -> `en` only, so those are the tags it could have parsed.
  assert.deepEqual(
    ["it", "en"].filter((tag) => reachable("subset", tag) > 0), [],
    "the held rejection from the subset door still reaches parsed catalogs",
  );

  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});
