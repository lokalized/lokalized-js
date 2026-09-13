// @ts-check
/**
 * M8 acceptance clause 22 — "Abort cancels outstanding work and rejects. It is never converted into
 * partial success" (plan 6.2:2086).
 *
 * **WHY THE OBVIOUS PROBE FAILS, and it is already in the tree.** `test/fetch-loader.test.js`'s
 * "abort rejects and is never converted into partial success" asserts that the outcome is an `Error`
 * which is not a `complete: false` object — and a loader that funnelled an aborted read into the
 * ordinary per-file failure path satisfies that exactly, because such a rejection is an `Error` too,
 * a `StringsLoadingError` a caller cannot tell from a 503. That probe also plans two files, so it can
 * say nothing about QUEUED work, and it never looks at the transport, so it cannot tell a loader that
 * forwarded the caller's signal from one that raced the signal privately and left every request it
 * opened running. Those are three separate propositions and the returned promise can only see one.
 *
 * So this file measures four things the promise cannot show on its own:
 *
 *   - the abort rejection is compared against the rejection THE SAME FIXTURE produces when only the
 *     cause of the outstanding file's failure changes (C22.1), by a structural fingerprint that
 *     deliberately excludes every `cause` payload — the field that necessarily differs under the
 *     defect, and therefore the one that would switch the assertion off just when it is needed;
 *   - under `allow-partial`, with the resolved fallback file already served, the abort must still
 *     reject (C22.2) — and the control that makes that mean anything is an ordinary failure on the
 *     same fixture that RESOLVES the partial, so a rejection in the abort arm cannot be explained by
 *     plan 6.2:2082-2083's fallback-file rule, by a pre-I/O refusal, or by `allow-partial` not being
 *     honoured at all;
 *   - the caller's signal reaches the transport call that is still outstanding, and fires while it is
 *     outstanding (C22.3) — observed on the stub's ledger, because no assertion about the returned
 *     promise can see a loader that rejects perfectly on time with eight sockets still open;
 *   - nothing QUEUED is dispatched after the abort (C22.4), observed with a manifest larger than the
 *     concurrency cap, because a loader may reject the caller's promise at the instant of abort and
 *     go on fetching the rest of its plan.
 *
 * **THE HUNG FILE IS RELEASED WITH VALID BYTES ONE MACROTASK AFTER THE ABORT, EVERYWHERE.** A probe
 * that discriminated by NOT TERMINATING would surface in CI as a job timeout rather than a named red
 * — this project already owns one ten-minute ablation and has ruled that shape unacceptable. Every
 * precondition wait here is bounded and fails printing the stub's ledger for the same reason: a
 * precondition that silently never becomes true is an anchor that did not match, which reports
 * nothing and proves nothing.
 *
 * **AND THE RELEASED BYTES ARE VALID ON PURPOSE, which makes C22.1/C22.2 stronger than "not a
 * partial".** The aborted file's digest is correct and its body parses, so a loader that ignored the
 * signal would finish with a COMPLETE success — three catalogs, no failures — rather than with a
 * conspicuous partial. C22.2 runs the other release too (the hung read is released as an ordinary
 * failure), which is the literal `complete: false` shape plan 6.2:2084-2085 describes.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { loadEntireManifest, loadStrings, StringsLoadingError } from "../src/load/fetch-loader.js";
import { fetchSet } from "../src/load/planning.js";
import {
  createStringsManifestFromDirectory, loadEntireManifestFromFiles, loadStringsFromDirectory,
  loadStringsFromFiles,
} from "../src/node/index.js";

const utf8 = new TextEncoder();
const ORDINARY_FAILURE = "PROBE-ORDINARY-FAILURE";
const ORDINARY_BODY_ERROR = "PROBE-ORDINARY-BODY-ERROR";

/** Three catalogs: two that serve, one that is left outstanding when the abort fires. */
const FIXTURE_A = ["de", "en", "fr"];
/** Twelve, so the plan is larger than the concurrency cap and a QUEUE exists at all. */
const FIXTURE_B = ["ar", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hu", "it"];

const root = mkdtempSync(join(tmpdir(), "lokalized-abort-"));
after(() => rmSync(root, { recursive: true, force: true }));

/**
 * A real directory of catalogs plus the manifest the PUBLIC generator produces for it.
 *
 * Built through `createStringsManifestFromDirectory` rather than by hand so the manifest carries real
 * per-file digests, a recomputed `catalogFingerprint` and the runtime's own `cldrVersion` /
 * `dataFingerprint` — the three things plan 6.2:2072-2074 checks BEFORE any catalog I/O. Every probe
 * below would "confirm" its conclusion vacuously if one of those refused first, which is what the
 * resolving controls exist to rule out empirically.
 *
 * The Fetch arm gets the same manifest re-hosted at an `https:` base. Plan 6.1:1927 excludes
 * `baseUrl`, per-file `url` and `decodedBytes` from the fingerprint precisely so a catalog set can
 * move, so the clone still validates — and the control proves it rather than asserting it.
 *
 * @param {readonly string[]} tags
 */
async function fixture(tags) {
  const directory = mkdtempSync(join(root, "c22-"));
  /** @type {Map<string, Uint8Array>} */
  const bodies = new Map();
  for (const tag of tags) {
    const text = JSON.stringify({ Greeting: `hello ${tag}` });
    writeFileSync(join(directory, `${tag}.json`), text);
    bodies.set(tag, utf8.encode(text));
  }
  const file = await createStringsManifestFromDirectory(directory, {
    catalogVersion: "c22", fallbackLocale: "en",
  });
  const https = Object.freeze({ ...file, baseUrl: "https://probe.invalid/i18n/" });
  return {
    directory,
    file: /** @type {any} */ (file),
    https: /** @type {any} */ (https),
    bytes: (/** @type {string} */ tag) => /** @type {Uint8Array} */ (bodies.get(tag)),
  };
}

/**
 * ONE RECORDING TRANSPORT, two adapters — plan 6.2:2003-2006 (`readFile`) and the Fetch door's
 * `options.fetch`.
 *
 * Per-tag modes:
 *   `serve`           settle immediately with the file's real bytes;
 *   `fail`            reject with an ordinary `Error` — the measured non-abort baseline;
 *   `hang`            return a promise that settles ONLY when the test calls `releaseAll()`;
 *   `chunked`         (Fetch) a two-chunk body that closes normally;
 *   `stall-mid-body`  (Fetch) deliver the first half, then park inside `read()`;
 *   `error-mid-body`  (Fetch) deliver the first half, then fail the body with an ordinary error.
 *
 * **`hang` DELIBERATELY IGNORES A SIGNAL THAT FIRES LATER, and that is load-bearing rather than
 * lazy.** Plan 6.2:2098-2100 lets an injected reader answer with a complete `Uint8Array`, so a
 * transport that never looks at the signal is a legal one — and it is the only fixture in which the
 * runner's own cancellation is observable. If the hung read rejected on abort, the runner's per-file
 * catch would answer every probe here and the worker-loop check that stops the QUEUE (C22.4) would be
 * invisible. `stall-mid-body` is the deliberate exception and says so where it is defined.
 *
 * **THE ALREADY-ABORTED CASE IS PLATFORM-FAITHFUL**: a call whose signal is ALREADY aborted at
 * invocation rejects with `signal.reason`, exactly as a real `fetch` and a real
 * `createReadStream({ signal })` do. Without that, C22.6's two halves collapse: an implementation
 * with no entry check at all would have its reads SUCCEED against a naive stub, and the row's
 * high-confidence half ("an aborted load never succeeds") would red alongside the derived half it
 * was split apart from.
 *
 * @param {Awaited<ReturnType<typeof fixture>>} source
 * @param {Record<string, string>} [modes]
 */
function transportStub(source, modes = {}) {
  /** @type {any[]} */
  const calls = [];
  /** @type {Set<string>} */
  const served = new Set();
  /** @type {Map<string, any>} */
  const bodyLedgers = new Map();
  /** @type {((how: "bytes" | "error") => void)[]} */
  const waiting = [];
  /** @type {"bytes" | "error" | null} */
  let released = null;

  const tagOf = (/** @type {string} */ url) =>
    decodeURIComponent(String(url).split("/").pop() ?? "").replace(/\.json$/, "");

  const ledgerFor = (/** @type {string} */ tag) => {
    let ledger = bodyLedgers.get(tag);
    if (ledger === undefined) {
      ledger = { tag, delivered: 0, blocked: false, cancelled: 0, releaseLocked: 0, release: () => {} };
      bodyLedgers.set(tag, ledger);
    }
    return ledger;
  };

  /**
   * Record a call AND install the abort listener AT CALL START.
   *
   * Reading `signal.aborted` after the call settles cannot tell a signal that fired DURING the call
   * from one that fired after it — and "during" is the entire proposition C22.3 gates.
   */
  function begin(/** @type {string} */ url, /** @type {AbortSignal | undefined} */ signal) {
    const call = {
      seq: calls.length, url: String(url), tag: tagOf(url),
      receivedSignal: signal !== undefined && signal !== null,
      abortedAtInvocation: signal?.aborted === true,
      signalFiredBeforeSettle: false,
      settled: false,
    };
    calls.push(call);
    if (signal)
      signal.addEventListener("abort", () => {
        if (!call.settled) call.signalFiredBeforeSettle = true;
      }, { once: true });
    return call;
  }

  /** The bytes a call answers with, honouring its mode. Never reacts to a signal that fires later. */
  function bytesOf(/** @type {any} */ call) {
    const mode = modes[call.tag] ?? "serve";
    if (mode === "fail") {
      call.settled = true;
      return Promise.reject(new Error(ORDINARY_FAILURE));
    }
    if (mode === "hang")
      return new Promise((resolve, reject) => {
        const finish = (/** @type {"bytes" | "error"} */ how) => {
          call.settled = true;
          if (how === "error") reject(new Error(ORDINARY_FAILURE));
          else { served.add(call.tag); resolve(source.bytes(call.tag)); }
        };
        if (released !== null) finish(released); else waiting.push(finish);
      });
    call.settled = true;
    served.add(call.tag);
    return Promise.resolve(source.bytes(call.tag));
  }

  const oneChunkResponse = (/** @type {Uint8Array} */ bytes, /** @type {any} */ ledger) => {
    let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => (sent
        ? { done: true, value: undefined }
        : ((sent = true), (ledger.delivered += 1), { done: false, value: bytes })),
      cancel: async () => { ledger.cancelled += 1; },
      releaseLock: () => { ledger.releaseLocked += 1; },
    }) } };
  };

  /**
   * A body the loader is HOLDING when the abort lands.
   *
   * The stall is on the CONSUMER's side of the stream: `delivered` counts reads the loader actually
   * received and `blocked` records that it came back for more. Counting what the stub enqueued would
   * be satisfied by a loader that refused at the status line, at a limit check or that never owned a
   * reader at all — the guard confirming a path it never entered.
   *
   * Unlike `hang`, this mode IS signal-reactive, because a real `fetch` errors the response body when
   * the request is aborted. Its fetch promise has already resolved, so the signal cannot reject that;
   * the loader is parked inside `reader.read()` and the body is the only thing left to cancel.
   */
  function streamingResponse(/** @type {any} */ call, /** @type {AbortSignal | undefined} */ signal,
    /** @type {string} */ mode) {
    const bytes = source.bytes(call.tag);
    const split = Math.max(1, Math.floor(bytes.length / 2));
    const head = bytes.subarray(0, split);
    const tail = bytes.subarray(split);
    const ledger = ledgerFor(call.tag);
    let stage = 0;
    const stalled = new Promise((resolve, reject) => {
      ledger.release = (/** @type {"bytes" | "error"} */ how) => (how === "error"
        ? reject(new Error(ORDINARY_BODY_ERROR))
        : resolve({ done: false, value: tail }));
      if (signal) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => {
        if (stage === 0) { stage = 1; ledger.delivered += 1; return { done: false, value: head }; }
        if (stage === 1) {
          stage = 2;
          if (mode === "chunked") { ledger.delivered += 1; return { done: false, value: tail }; }
          if (mode === "error-mid-body") throw new Error(ORDINARY_BODY_ERROR);
          ledger.blocked = true;
          const chunk = await stalled;
          ledger.delivered += 1;
          return chunk;
        }
        return { done: true, value: undefined };
      },
      cancel: async () => { ledger.cancelled += 1; },
      releaseLock: () => { ledger.releaseLocked += 1; },
    }) } };
  }

  /** Read the signal from BOTH places: a loader that legitimately builds a Request is not a defect. */
  const fetchImpl = async (/** @type {any} */ input, /** @type {any} */ init) => {
    const signal = init?.signal
      ?? (typeof Request === "function" && input instanceof Request ? input.signal : undefined);
    const call = begin(typeof input === "string" ? input : String(input?.url ?? input), signal);
    if (signal?.aborted) { call.settled = true; throw signal.reason; }

    const mode = modes[call.tag] ?? "serve";
    if (mode === "chunked" || mode === "stall-mid-body" || mode === "error-mid-body") {
      call.settled = true;
      served.add(call.tag);
      return streamingResponse(call, signal, mode);
    }
    return oneChunkResponse(await bytesOf(call), ledgerFor(call.tag));
  };

  const readFileImpl = async (/** @type {string} */ url, /** @type {AbortSignal} */ signal) => {
    const call = begin(url, signal);
    if (signal?.aborted) { call.settled = true; throw signal.reason; }
    return await bytesOf(call);
  };

  return {
    calls, served, bodyLedgers,
    fetch: fetchImpl,
    readFile: readFileImpl,
    call: (/** @type {string} */ tag) => calls.find((c) => c.tag === tag),
    /** Settle every outstanding read — with valid bytes, or as an ordinary failure. */
    releaseAll: (/** @type {"bytes" | "error"} */ how = "bytes") => {
      released = how;
      for (const finish of waiting.splice(0)) finish(how);
      for (const ledger of bodyLedgers.values()) ledger.release(how);
    },
    ledger: () => JSON.stringify(calls.map((c) => ({
      seq: c.seq, tag: c.tag, signal: c.receivedSignal, firedDuring: c.signalFiredBeforeSettle,
      settled: c.settled,
    }))),
  };
}

/** The two doors that drive `runPlan`. A property of the RUNNER must be probed through both. */
const DOORS = [
  {
    name: "lokalized/load (Fetch)",
    stage: "fetch",
    manifestOf: (/** @type {any} */ f) => f.https,
    entire: (/** @type {any} */ m, /** @type {any} */ o, /** @type {any} */ s) =>
      loadEntireManifest(m, { ...o, fetch: s.fetch }),
    subset: (/** @type {any} */ m, /** @type {string} */ tag, /** @type {any} */ o, /** @type {any} */ s) =>
      loadStrings(m, tag, { ...o, fetch: s.fetch }),
  },
  {
    name: "lokalized/node (file)",
    stage: "read",
    manifestOf: (/** @type {any} */ f) => f.file,
    entire: (/** @type {any} */ m, /** @type {any} */ o, /** @type {any} */ s) =>
      loadEntireManifestFromFiles(m, { ...o, readFile: s.readFile }),
    subset: (/** @type {any} */ m, /** @type {string} */ tag, /** @type {any} */ o, /** @type {any} */ s) =>
      loadStringsFromFiles(m, tag, { ...o, readFile: s.readFile }),
  },
];

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Handlers attached IMMEDIATELY, because every probe here polls while the load is running: a
 * rejection arriving in that window with nothing attached is an `unhandledRejection`, not a failure.
 *
 * @param {Promise<any>} promise
 */
const capture = (promise) => promise.then(
  (value) => ({ ok: true, value, error: /** @type {any} */ (undefined) }),
  (error) => ({ ok: false, value: /** @type {any} */ (undefined), error }));

/** The resolved value, printed so a defect is legible rather than a bare boolean. */
function describe(/** @type {any} */ value) {
  if (value === null || typeof value !== "object") return String(value);
  if ("catalogs" in value)
    return `LoadedStrings{ complete: ${value.complete}, catalogs: [${Object.keys(value.catalogs).sort()}]` +
      `, failures: ${JSON.stringify([...(value.failures ?? [])].map((f) => [f.locale, f.stage]))} }`;
  return `${value.constructor?.name ?? "?"}: ${value.message}`;
}

/** @param {Promise<{ ok: boolean, value: any, error: any }>} captured @param {string} label */
async function rejectionOf(captured, label) {
  const outcome = await captured;
  if (outcome.ok)
    assert.fail(`${label}: expected a REJECTION; the load RESOLVED with ${describe(outcome.value)}`);
  return outcome.error;
}

/**
 * A structural fingerprint of a rejection that excludes EVERY cause payload.
 *
 * The cause is the one field that necessarily differs when an abort is funnelled into the ordinary
 * per-file failure path — it holds the AbortError instead of the transport's error — so an assertion
 * that reads it is switched off by the very defect it exists to catch. What must differ is the SHAPE:
 * the class, the name, the code and the (locale, stage) rows.
 */
const fingerprint = (/** @type {any} */ error) => JSON.stringify([
  error?.constructor?.name ?? null,
  error?.name ?? null,
  error?.code ?? null,
  Array.isArray(error?.failures) ? error.failures.map((f) => [f.locale, f.stage]) : null,
]);

/**
 * One positive abort marker that cannot be reached through a failure row.
 *
 * Plan 6.2:2074-2077 enumerates the six kinds that reject with `StringsLoadingError` and abort is not
 * among them; the error table at plan 1114-1120 has no abort row either. So the class of an abort
 * rejection is unspecified and is NOT asserted — what is asserted is that the abort is reachable from
 * the rejection without going through the ordinary `failures` list, which is exactly what an
 * implementation that re-labelled it as a stage-`fetch`/`read` failure would lose.
 */
const abortIsReachable = (/** @type {any} */ error, /** @type {AbortController} */ controller) =>
  error?.name === "AbortError" || error?.code === "ABORTED" ||
  (error?.cause === controller.signal.reason && !(error instanceof StringsLoadingError));

/**
 * Bounded, and it FAILS printing the ledger.
 *
 * An unbounded poll on a precondition that stops being reachable — a different dispatch shape, a
 * smaller plan — is an anchor that silently never matches: it reports nothing and hangs the run.
 *
 * @param {() => boolean} ready @param {string} label @param {any} stub
 */
async function waitUntil(ready, label, stub) {
  const deadline = Date.now() + 2000;
  while (!ready()) {
    if (Date.now() >= deadline)
      assert.fail(`${label}: precondition never became true within 2s. ${stub.ledger()}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** The dispatch count once it stops growing — the cap OBSERVED rather than read off the plan. */
async function steadyDispatchCount(/** @type {any} */ stub, /** @type {string} */ label) {
  const deadline = Date.now() + 2000;
  let last = -1;
  let stable = 0;
  while (stable < 3) {
    await turn();
    if (stub.calls.length === last) stable += 1;
    else { stable = 0; last = stub.calls.length; }
    if (Date.now() >= deadline)
      assert.fail(`${label}: the dispatch count never settled. ${stub.ledger()}`);
  }
  return last;
}

// ---------------------------------------------------------------------------------------------
// The controls. Every probe below is read against these; without them a rejection in an abort arm
// is equally explained by a manifest that never cleared its pre-I/O gates.
// ---------------------------------------------------------------------------------------------

test("CONTROL: the fixture loads end to end through both doors, signal supplied and never fired", async () => {
  const source = await fixture(FIXTURE_A);
  for (const door of DOORS) {
    const controller = new AbortController();
    const stub = transportStub(source);
    const loaded = await door.entire(door.manifestOf(source), { signal: controller.signal }, stub);

    assert.equal(loaded.complete, true, `${door.name}: the fixture must load completely`);
    assert.deepEqual(Object.keys(loaded.catalogs).sort(), ["de", "en", "fr"], door.name);
    assert.equal(stub.calls.length, 3, `${door.name}: every planned file is dispatched`);

    // THE PHANTOM CHECK, and it is what makes C22.3's ledger readable: a listener that reported a
    // firing here would make `signalFiredBeforeSettle` meaningless in the abort arms.
    assert.deepEqual(stub.calls.filter((c) => c.signalFiredBeforeSettle).map((c) => c.tag), [],
      `${door.name}: a signal that never fires must not be reported as having fired`);

    // REPORTED, not gated. A call that had already settled has no outstanding work to cancel, so a
    // loader is entitled to have dropped its listener; C22.3 gates the OUTSTANDING call only.
    console.log(`# ${door.name}: ${stub.calls.filter((c) => c.receivedSignal).length}/3 transport ` +
      `calls received a signal on the clean path`);

    // And with no `signal` option at all — the plan does not require the loader to manufacture one.
    const plain = transportStub(source);
    assert.equal((await door.entire(door.manifestOf(source), {}, plain)).complete, true,
      `${door.name}: a load with no signal option must still work`);
  }
});

test("CONTROL: under allow-partial an ordinary failure RESOLVES the partial an abort must never produce", async () => {
  // **THE LOAD-BEARING CONTROL OF THIS FILE.** It proves this exact fixture is CAPABLE of producing
  // the partial success clause 22 prohibits — same policy, same in-flight shape, same fallback
  // already served. Without it, the rejection in the abort arm would be equally explained by plan
  // 6.2:2082-2083's fallback-file rule, by a pre-I/O refusal, or by `allow-partial` being ignored.
  const source = await fixture(FIXTURE_A);
  for (const door of DOORS) {
    const controller = new AbortController(); // supplied and NEVER fired
    const stub = transportStub(source, { fr: "fail" });
    const partial = await door.entire(door.manifestOf(source),
      { signal: controller.signal, partialFailure: "allow-partial" }, stub);

    assert.equal(partial.complete, false, `${door.name}: a partial result makes no parity claim`);
    assert.deepEqual(Object.keys(partial.catalogs).sort(), ["de", "en"], door.name);
    assert.deepEqual([...partial.failures].map((f) => [f.locale, f.stage]), [["fr", door.stage]],
      `${door.name}: the ordinary failure is a per-file one, at this door's own stage`);
  }
});

// ---------------------------------------------------------------------------------------------
// C22.1 — the abort rejection is not the ordinary-failure rejection wearing a different cause.
// ---------------------------------------------------------------------------------------------

test("C22.1 an abort rejection is structurally unlike the rejection an ordinary failure produces", async () => {
  const source = await fixture(FIXTURE_A);
  for (const door of DOORS) {
    // ARM 1 — the baseline, MEASURED rather than expected. It doubles as the proof that the fixture
    // reaches the loader: a per-file failure at this door's stage can only be produced by a manifest
    // that cleared the fingerprint, the data-compatibility check and the URL-scheme check.
    const ordinaryStub = transportStub(source, { fr: "fail" });
    const neverFires = new AbortController();
    const ordinary = await rejectionOf(
      capture(door.entire(door.manifestOf(source), { signal: neverFires.signal }, ordinaryStub)),
      `${door.name} ordinary failure`);
    assert.ok(ordinary instanceof StringsLoadingError,
      `${door.name}: expected a StringsLoadingError, got ${describe(ordinary)}`);
    assert.deepEqual([...ordinary.failures].map((f) => [f.locale, f.stage]), [["fr", door.stage]],
      `${door.name}: the baseline is one per-file failure for the outstanding file`);

    // ARM 2 — the same fixture and the same DEFAULT policy. Only the cause of fr's outstanding read
    // differs: it hangs, and the caller aborts.
    const controller = new AbortController();
    const stub = transportStub(source, { fr: "hang" });
    const running = capture(door.entire(door.manifestOf(source), { signal: controller.signal }, stub));

    await waitUntil(() => stub.calls.length === 3 && stub.served.has("en") && stub.served.has("de"),
      `${door.name} C22.1`, stub);
    await turn(); // parsing is synchronous, so one macrotask puts de and en in their slots
    assert.equal(stub.calls.length, 3, `${door.name}: all three files must be dispatched`);
    assert.ok(stub.call("fr") !== undefined, `${door.name}: fr was never requested. ${stub.ledger()}`);
    assert.equal(stub.call("fr").settled, false,
      `${door.name}: fr must still be OUTSTANDING when the abort fires, or there is no outstanding work`);

    controller.abort();
    // Released with VALID bytes one macrotask later: a loader that ignored the signal then finishes
    // with a COMPLETE success and is caught by a named assertion instead of hanging the run.
    setTimeout(() => stub.releaseAll(), 0);

    const aborted = await rejectionOf(running, `${door.name} abort`);
    assert.notEqual(fingerprint(aborted), fingerprint(ordinary),
      `${door.name}: the abort rejection is indistinguishable from an ordinary transport failure — ` +
      `${fingerprint(aborted)}`);
    assert.ok(abortIsReachable(aborted, controller),
      `${door.name}: nothing in the rejection names the abort: ${describe(aborted)}`);
  }
});

test("C22.1b an abort carrying a caller-supplied reason still rejects", async () => {
  const source = await fixture(FIXTURE_A);
  const SENTINEL = { probeAbortSentinel: "clause-22" };
  for (const door of DOORS) {
    const controller = new AbortController();
    const stub = transportStub(source, { fr: "hang" });
    const running = capture(door.entire(door.manifestOf(source), { signal: controller.signal }, stub));
    await waitUntil(() => stub.calls.length === 3 && stub.served.has("en"), `${door.name} C22.1b`, stub);
    await turn();
    controller.abort(SENTINEL);
    setTimeout(() => stub.releaseAll(), 0);

    const aborted = await rejectionOf(running, `${door.name} sentinel abort`);
    // GATED: a caller-supplied reason does not turn an abort into a success, and no `LoadedStrings`
    // escapes through the rejection channel either.
    assert.equal("catalogs" in Object(aborted), false,
      `${door.name}: the rejection must not carry a LoadedStrings: ${describe(aborted)}`);
    // REPORTED, NOT GATED. Whether the caller's own reason must survive BY IDENTITY is not stated:
    // plan 1127-1128 ("all library errors use `Error.cause` when there is a library-owned causal
    // chain") is suggestive, not dispositive. It is a real quality property — an implementation that
    // substitutes a fresh AbortError makes a timeout indistinguishable from a user cancellation — so
    // it is measured here and left for the maintainer to rule on before it gates.
    console.log(`# ${door.name}: caller's abort reason reachable by identity: ` +
      `${aborted === SENTINEL || aborted?.cause === SENTINEL}`);
  }
});

// ---------------------------------------------------------------------------------------------
// C22.2 — allow-partial is where "never converted into partial success" has teeth.
// ---------------------------------------------------------------------------------------------

test("C22.2 an abort under allow-partial rejects instead of resolving that partial", async () => {
  const source = await fixture(FIXTURE_A);
  for (const door of DOORS) {
    const manifest = door.manifestOf(source);
    for (const entry of /** @type {const} */ (["entire", "subset"])) {
      // DERIVED FROM THE PUBLIC PLANNER, never hard-coded. The subset plan for `fr` is {fr, en} —
      // TWO files — so a precondition fixed at three would never become true in that arm, and the
      // arm would surface as a timeout rather than as any verdict at all.
      const planned = entry === "entire"
        ? Object.keys(manifest.files).sort()
        : fetchSet(manifest, "fr").map((e) => e.locale);
      assert.ok(planned.length >= 2,
        `${door.name}/${entry}: the plan must hold more than the hung file, or the abort is untriggerable`);
      assert.ok(planned.includes("fr") && planned.includes("en"),
        `${door.name}/${entry}: the hung file must be a NON-FALLBACK member of the plan [${planned}]`);

      for (const release of /** @type {const} */ (["bytes", "error"])) {
        const label = `${door.name}/${entry}/released-as-${release}`;
        const controller = new AbortController();
        const stub = transportStub(source, { fr: "hang" });
        const options = { signal: controller.signal, partialFailure: "allow-partial" };
        const running = capture(entry === "entire"
          ? door.entire(manifest, options, stub)
          : door.subset(manifest, "fr", options, stub));

        // Every one of these is a way this probe could quietly go vacuous, so each is asserted
        // rather than assumed — and the fallback file is SERVED before the abort, which is what
        // neutralises plan 6.2:2082-2083. A probe that aborts the fallback file's read proves
        // nothing: the rejection then comes from the fallback rule and abort is never exercised.
        await waitUntil(() => stub.calls.length === planned.length && stub.served.has("en"), label, stub);
        await turn();
        assert.equal(stub.calls.length, planned.length, `${label}: the whole plan must be dispatched`);
        assert.equal(stub.served.has("en"), true, `${label}: the resolved fallback file must have loaded`);
        assert.ok(stub.call("fr") !== undefined, `${label}: fr was never requested. ${stub.ledger()}`);
        assert.equal(stub.call("fr").settled, false, `${label}: fr must still be outstanding`);

        controller.abort();
        // `bytes` makes a signal-ignoring loader finish COMPLETE; `error` makes it finish with
        // exactly the `complete: false` + one ordered `LoadFailure` shape plan 6.2:2084-2085
        // describes. Both are prohibited, and only the second is the shape the clause names.
        setTimeout(() => stub.releaseAll(release), 0);

        const aborted = await rejectionOf(running, label);
        assert.equal("catalogs" in Object(aborted), false,
          `${label}: the rejection must not carry a LoadedStrings: ${describe(aborted)}`);
        assert.ok(stub.call("fr") !== undefined,
          `${label}: fr must have been requested, or the rejection is an upstream refusal`);
        assert.ok(abortIsReachable(aborted, controller),
          `${label}: nothing in the rejection names the abort: ${describe(aborted)}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// C22.3 — "cancels outstanding work", part one: the abort REACHES the transport.
//
// Split per door on purpose: the forwarding lives in each door's transport, so a shared test would
// leave which door lost the signal ambiguous.
// ---------------------------------------------------------------------------------------------

test("C22.3 the Fetch door hands the caller's signal to the outstanding request, and it fires there", async () => {
  const source = await fixture(FIXTURE_A);
  const door = DOORS[0];
  const controller = new AbortController();
  const stub = transportStub(source, { fr: "hang" });
  const running = capture(door.entire(door.manifestOf(source), { signal: controller.signal }, stub));

  await waitUntil(() => stub.calls.length === 3 && stub.served.has("en"), "C22.3 Fetch", stub);
  await turn();
  const outstanding = stub.call("fr");
  assert.ok(outstanding !== undefined, `fr was never requested. ${stub.ledger()}`);
  assert.equal(outstanding.settled, false, `fr must still be outstanding. ${stub.ledger()}`);

  controller.abort();
  setTimeout(() => stub.releaseAll(), 0);
  await rejectionOf(running, "C22.3 Fetch");

  // **THE ASSERTION THIS TEST EXISTS FOR, and no promise-shaped assertion can make it.** A loader
  // that accepts `options.signal`, races it against its own per-file promise and hands the transport
  // nothing rejects at exactly the right instant with exactly the right shape — while every request
  // it opened keeps running. C22.1, C22.2, C22.4 and C22.6 all stay green over that defect.
  assert.equal(outstanding.receivedSignal, true,
    `the outstanding fetch received no AbortSignal. ${stub.ledger()}`);
  assert.equal(outstanding.signalFiredBeforeSettle, true,
    `the signal handed to the outstanding fetch never fired while it was outstanding. ${stub.ledger()}`);
  console.log(`# Fetch: signals also fired on ${stub.calls.filter((c) => c.signalFiredBeforeSettle).length - 1}` +
    ` already-settled call(s) — recorded, not gated`);
});

test("C22.3 the Node door hands the caller's signal to the outstanding read, and it fires there", async () => {
  const source = await fixture(FIXTURE_A);
  const door = DOORS[1];
  const controller = new AbortController();
  const stub = transportStub(source, { fr: "hang" });
  const running = capture(door.entire(door.manifestOf(source), { signal: controller.signal }, stub));

  await waitUntil(() => stub.calls.length === 3 && stub.served.has("en"), "C22.3 Node", stub);
  await turn();
  const outstanding = stub.call("fr");
  assert.ok(outstanding !== undefined, `fr was never read. ${stub.ledger()}`);
  assert.equal(outstanding.settled, false, `fr must still be outstanding. ${stub.ledger()}`);

  controller.abort();
  setTimeout(() => stub.releaseAll(), 0);
  await rejectionOf(running, "C22.3 Node");

  // Plan 6.2:2003-2006 declares the signal as `readFile`'s second parameter. A `readFile` promise
  // that has not yet answered can be cancelled by NOTHING ELSE — there is no iterable to walk away
  // from yet — so this is the door's only cancellation route at this instant.
  assert.equal(outstanding.receivedSignal, true,
    `the outstanding readFile received no AbortSignal. ${stub.ledger()}`);
  assert.equal(outstanding.signalFiredBeforeSettle, true,
    `the signal handed to the outstanding readFile never fired while it was outstanding. ${stub.ledger()}`);
});

// ---------------------------------------------------------------------------------------------
// C22.4 — "cancels outstanding work", part two: nothing QUEUED starts after the abort.
// ---------------------------------------------------------------------------------------------

test("CONTROL: a twelve-file queue drains to its tail when nothing interrupts it", async () => {
  // Mandatory. Without it, `calls.length === N` in the abort arm is equally explained by the loader
  // having died early, or by the fixture never having been able to reach twelve calls at all.
  const source = await fixture(FIXTURE_B);
  for (const door of DOORS) {
    const modes = Object.fromEntries(FIXTURE_B.map((tag) => [tag, "hang"]));
    const stub = transportStub(source, modes);
    const running = capture(door.entire(door.manifestOf(source), {}, stub));
    const dispatched = await steadyDispatchCount(stub, `${door.name} control`);
    assert.ok(dispatched >= 2 && dispatched < 12,
      `${door.name}: expected a queue — ${dispatched} of 12 dispatched at once`);

    stub.releaseAll();
    const outcome = await running;
    assert.equal(outcome.ok, true, `${door.name}: ${describe(outcome.error)}`);
    assert.equal(outcome.value.complete, true, door.name);
    assert.equal(stub.calls.length, 12,
      `${door.name}: the queue must drain to its tail when nothing interrupts it. ${stub.ledger()}`);
  }
});

test("C22.4 no queued file is dispatched after the abort", async () => {
  const source = await fixture(FIXTURE_B);
  for (const door of DOORS) {
    const manifest = door.manifestOf(source);
    const plannedOrder = Object.keys(manifest.files).sort();
    const modes = Object.fromEntries(FIXTURE_B.map((tag) => [tag, "hang"]));
    const stub = transportStub(source, modes);

    /** @type {unknown[]} */
    const orphaned = [];
    const onOrphan = (/** @type {unknown} */ reason) => orphaned.push(reason);
    process.on("unhandledRejection", onOrphan);
    try {
      const controller = new AbortController();
      const running = capture(door.entire(manifest, { signal: controller.signal }, stub));

      // THE CAP IS OBSERVED, NOT READ OFF THE PLAN. Asserting 8 here would make a cap change a
      // silent vacuity in this probe rather than a named red in clause 21's.
      const dispatched = await steadyDispatchCount(stub, `${door.name} C22.4`);
      assert.ok(dispatched >= 2 && dispatched < 12,
        `${door.name}: expected part of the plan to be QUEUED; ${dispatched} of 12 were in flight`);
      const tail = plannedOrder.slice(dispatched);
      assert.ok(tail.length > 0, `${door.name}: the tail must be non-empty`);

      controller.abort();
      // Released with valid bytes one macrotask later. A loader that treats an aborted read as an
      // ordinary per-file failure and keeps dequeuing then COMPLETES its plan and is caught by the
      // named assertion below, instead of surfacing in CI as a job timeout.
      setTimeout(() => stub.releaseAll(), 0);
      await rejectionOf(running, `${door.name} C22.4`);

      const wentOnToFetch = tail.filter((tag) => stub.call(tag) !== undefined);
      assert.deepEqual(wentOnToFetch, [],
        `${door.name}: queued files were requested AFTER the caller aborted: [${wentOnToFetch}]`);
      assert.equal(stub.calls.length, dispatched,
        `${door.name}: the dispatch count must not grow after the abort. ${stub.ledger()}`);

      // "Cancels outstanding work" includes not orphaning what it cancelled: the other in-flight
      // reads reject after the caller's promise has, and an un-awaited slot promise is a
      // process-level unhandledRejection that can take a server down.
      await turn();
      await turn();
      assert.deepEqual(orphaned, [],
        `${door.name}: the abort left ${orphaned.length} unhandled rejection(s) behind`);
    } finally {
      process.off("unhandledRejection", onOrphan);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// C22.5 — "cancels outstanding work", part three: the BODY the loader is holding.
// ---------------------------------------------------------------------------------------------

test("C22.5 an aborted Fetch response body is released rather than left open", async () => {
  const source = await fixture(FIXTURE_A);
  const door = DOORS[0];

  // CONTROL ONE: the same two-chunk body, closed normally. It proves the streaming path is the one
  // actually exercised and that the counting instrumentation does not itself break a normal read.
  const closing = transportStub(source, { fr: "chunked" });
  const clean = await door.entire(door.manifestOf(source), {}, closing);
  assert.equal(clean.complete, true, "a two-chunk body must load");
  assert.equal(closing.bodyLedgers.get("fr").delivered, 2, "both chunks must reach the loader");

  // CONTROL TWO: the same body failing mid-stream with an ordinary error and NO abort. It fixes what
  // a non-abort mid-stream failure looks like — a named per-file failure, not a refusal.
  const erroring = transportStub(source, { fr: "error-mid-body" });
  const failed = await rejectionOf(
    capture(door.entire(door.manifestOf(source), {}, erroring)), "C22.5 mid-body error");
  assert.ok(failed instanceof StringsLoadingError, describe(failed));
  assert.deepEqual([...failed.failures].map((f) => [f.locale, f.stage]), [["fr", "fetch"]]);
  assert.match(String(failed.failures[0].cause?.message), new RegExp(ORDINARY_BODY_ERROR));

  // THE PROBE. The abort lands while the loader is parked inside `reader.read()`.
  const controller = new AbortController();
  const stub = transportStub(source, { fr: "stall-mid-body" });
  const running = capture(door.entire(door.manifestOf(source), { signal: controller.signal }, stub));
  const ledger = () => stub.bodyLedgers.get("fr") ?? { delivered: 0, blocked: false };

  // THE MID-STREAM PRECONDITION, INSTRUMENTED ON THE CONSUMER'S SIDE. Counting what the stub
  // enqueued would be satisfied by a loader that refused at the status line, at a byte-limit check,
  // or that read the whole body through `arrayBuffer()` and never owned a reader — the guard
  // confirming a cleanup path it never entered. `delivered` and `blocked` are only reachable by a
  // loader that took a chunk and came back for the next one.
  await waitUntil(() => ledger().delivered >= 1 && ledger().blocked === true, "C22.5 mid-stream", stub);
  assert.equal(ledger().delivered, 1, "exactly one chunk must have been handed over");
  assert.equal(ledger().blocked, true, "the loader must be parked inside read() when the abort fires");

  controller.abort();
  setTimeout(() => stub.releaseAll(), 0);
  await rejectionOf(running, "C22.5 abort");

  // BOTH RELEASE ROUTES, gated as a DISJUNCTION. `cancel()` is what this port calls; `releaseLock()`
  // is an equally legitimate way to give the body back, and gating only the first would be a false
  // red on an implementation that chose the other. A no-op `cancel` is what made this observation
  // invisible here once already, so the stub COUNTS the act rather than absorbing it.
  const released = ledger().cancelled + ledger().releaseLocked;
  assert.ok(released >= 1,
    `the aborted body was never released: cancel x${ledger().cancelled}, releaseLock x${ledger().releaseLocked}`);
  console.log(`# C22.5: released by ${ledger().cancelled > 0 ? "cancel()" : "releaseLock()"}`);
});

// ---------------------------------------------------------------------------------------------
// C22.6 — a signal that is already aborted when the loader is called.
// ---------------------------------------------------------------------------------------------

test("C22.6 a signal aborted before the call performs no catalog I/O", async () => {
  const source = await fixture(FIXTURE_A);
  for (const door of DOORS) {
    // The baseline that makes a zero mean "the loader declined to start" rather than "the manifest
    // was refused upstream" or "the stub was never wired in": the same call, a fresh controller.
    const fresh = new AbortController();
    const baseline = transportStub(source);
    const loaded = await door.entire(door.manifestOf(source), { signal: fresh.signal }, baseline);
    assert.equal(loaded.complete, true, door.name);
    assert.equal(baseline.calls.length, 3, `${door.name}: the non-zero baseline is three calls`);

    for (const partialFailure of [undefined, "allow-partial"]) {
      const label = `${door.name}/${partialFailure ?? "default"}`;
      const controller = new AbortController();
      controller.abort();
      const stub = transportStub(source);
      const outcome = await capture(door.entire(door.manifestOf(source),
        { signal: controller.signal, ...(partialFailure ? { partialFailure } : {}) }, stub));

      // (a) PLAN-GROUNDED: an aborted load never succeeds. Every catalog here serves valid bytes
      // immediately, so a loader that skips the entry check has every opportunity to SUCCEED — the
      // failure mode is a visible resolution, never an ambiguous hang.
      assert.equal(outcome.ok, false,
        `${label}: a pre-aborted load resolved with ${describe(outcome.value)}`);
      assert.ok(abortIsReachable(outcome.error, controller),
        `${label}: nothing in the rejection names the abort: ${describe(outcome.error)}`);

      // (b) DERIVED, and reported as derived: plan 6.2:2086 speaks of cancelling OUTSTANDING work,
      // and an already-aborted signal has none. No plan line says the loader must check before
      // planning or dispatch. It does, and this pins it — but the maintainer owes a ruling before
      // this half is counted as clause evidence rather than as a recorded observation.
      assert.deepEqual(stub.calls.map((c) => c.tag), [],
        `${label}: catalog URLs were dereferenced for a load the caller had already cancelled`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The THIRD door. Every probe above drives `loadEntireManifest*` / `loadStrings*`; plan 6.2's
// `loadStringsFromDirectory` carries its own `signal` and `readFile` (`LoadStringsFromDirectoryOptions`)
// and generates a manifest before it loads one, which is an abort window the other two do not have.
// ---------------------------------------------------------------------------------------------

test("the directory door refuses an aborted load and reads no catalog through it", async () => {
  const source = await fixture(FIXTURE_A);
  const options = { catalogVersion: "c22", fallbackLocale: "en" };

  // Mid-flight: the load half is the same runner, so allow-partial must not convert this either.
  const controller = new AbortController();
  const stub = transportStub(source, { fr: "hang" });
  const running = capture(loadStringsFromDirectory(source.directory,
    { ...options, partialFailure: "allow-partial", signal: controller.signal, readFile: stub.readFile }));
  await waitUntil(() => stub.calls.length === 3 && stub.served.has("en"), "directory door", stub);
  await turn();
  assert.ok(stub.call("fr") !== undefined, `fr was never read. ${stub.ledger()}`);
  assert.equal(stub.call("fr").settled, false, "fr must still be outstanding");
  controller.abort();
  setTimeout(() => stub.releaseAll(), 0);
  const aborted = await rejectionOf(running, "directory door abort");
  assert.equal("catalogs" in Object(aborted), false, describe(aborted));
  assert.ok(abortIsReachable(aborted, controller), describe(aborted));

  // Entry-time: gated on what survives any future ruling — it rejects, and it reads no catalog
  // through the injected reader.
  const preAborted = new AbortController();
  preAborted.abort();
  const quiet = transportStub(source);
  const early = await capture(loadStringsFromDirectory(source.directory,
    { ...options, signal: preAborted.signal, readFile: quiet.readFile }));
  assert.equal(early.ok, false, `a pre-aborted directory load resolved with ${describe(early.value)}`);
  assert.deepEqual(quiet.calls.map((c) => c.tag), [], "no catalog may be read for a cancelled load");

  // REPORTED, NOT GATED, because it is the measurement a ruling would change: the generation half
  // runs FIRST and consults no signal, so the directory the caller cancelled is still scanned and
  // every catalog in it still hashed. Measured separately: with `maximumDiscoveryEntries: 1` a
  // pre-aborted call rejects with the SCAN's refusal, not with the abort reason.
  console.log(`# directory door: pre-aborted rejection was ` +
    `${early.error === preAborted.signal.reason ? "the caller's own reason" : describe(early.error)}` +
    `, after a generation scan that consults no signal`);
});
