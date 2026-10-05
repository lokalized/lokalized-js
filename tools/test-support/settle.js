// @ts-check
/**
 * Waiting for a loader to settle after a test releases one of its reads. Shared by the tests that
 * drive the loaders through gated transports and then assert what was admitted next.
 *
 * **NO SLEEPS AND NO GUESSED TURN COUNTS: IT WAITS FOR EVENTS.** Measured 2026-09-24: across
 * `src/load`, `src/node`, `src/parse` and `src/internal`, the ONE step that defers work past the
 * current turn of the event loop is the Fetch door's `crypto.subtle.digest`, which Node runs on its
 * thread pool. Everything else a loader does between a released read and the next admission —
 * reading the body from the test's transport, parsing, claiming the next plan entry, calling the
 * transport — is promise continuations, and every continuation runs before the next macrotask. So
 * this waits for every digest in flight to settle, then lets the event loop take ONE turn
 * (`setImmediate`), which cannot happen until those continuations have run, and repeats while that
 * turn started another digest. That is a guarantee rather than a margin. If a loader ever gains
 * another deferred step — a timer, a stream that decompresses off-thread — it stops being one, and
 * that step belongs here.
 *
 * **WHY IT EXISTS.** The tests used to call the loader settled after twenty idle turns of the event
 * loop. A digest outlasts twenty idle turns on a loaded runner, so the assertions ran early: CI
 * failed `fetch-concurrency`'s admission assertions on one Node leg at a time, and delaying every
 * digest by 5 ms failed five of its tests and one of `loader-warning-order`'s on every run, with the
 * admissions that had happened in the right order and the last ones not yet made. The real
 * WebCrypto call still runs; it is wrapped once per process only so its promises can be awaited. The
 * Node file door hashes synchronously with `node:crypto` and never reaches the wrapper.
 */

/** @type {Set<Promise<unknown>>} */
const inFlight = new Set();

(function awaitableDigests() {
  const subtle = /** @type {any} */ (globalThis.crypto?.subtle);
  if (!subtle || typeof subtle.digest !== "function") return;
  const digest = subtle.digest.bind(subtle);
  subtle.digest = (/** @type {any[]} */ ...args) => {
    const pending = digest(...args);
    inFlight.add(pending);
    // Registered before the caller's own `await`, so the set is already updated when the caller's
    // continuation runs. `.catch` keeps a rejected digest from also surfacing as unhandled here;
    // the caller still receives the rejection through `pending`.
    pending.finally(() => inFlight.delete(pending)).catch(() => {});
    return pending;
  };
})();

const turn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Resolve once every digest the loader started has settled and the work that followed has run.
 *
 * The one timer here is a FAILURE bound, not a wait: a digest that has not settled in 30 seconds is
 * stuck, and a stuck test should fail naming why rather than hang the job. A passing run never
 * reaches it.
 */
export async function untilSettled() {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const stuck = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${inFlight.size} WebCrypto digest(s) still unsettled after 30 s`)), 30_000);
  });
  try {
    do {
      while (inFlight.size > 0) await Promise.race([Promise.allSettled([...inFlight]), stuck]);
      await turn();
    } while (inFlight.size > 0);
  } finally {
    clearTimeout(timer);
  }
}
