// @ts-check
/**
 * `tools/test-support/settle.js` must not report a loader settled while a WebCrypto digest is still
 * running, or while the work a finished digest set off is still pending. That is the whole
 * difference from the idle-turn wait it replaced, which returned early on loaded CI runners and
 * failed `fetch-concurrency`'s admission assertions one Node leg at a time.
 *
 * The digest is slowed BEFORE the helper loads, the way a busy thread pool slows it, so the helper
 * wraps the slow one: the dynamic import below is what orders the two.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const DELAY_MS = 50;
const subtle = /** @type {any} */ (globalThis.crypto.subtle);
const realDigest = subtle.digest.bind(subtle);
subtle.digest = async (/** @type {any[]} */ ...args) => {
  const out = await realDigest(...args);
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  return out;
};
const { untilSettled } = await import("../tools/test-support/settle.js");
const hash = () => globalThis.crypto.subtle.digest("SHA-256", new Uint8Array([1, 2, 3]));

test("the wait outlasts a digest slower than any fixed number of idle turns", async () => {
  let admitted = 0;
  // What a loader does after a released read: hash the body, THEN admit the next entry.
  hash().then(() => { admitted += 1; });
  await untilSettled();
  assert.equal(admitted, 1, "the wait returned while the digest was still running");
});

test("a finished digest that starts another is waited for too, the way one admission leads to the next", async () => {
  let admitted = 0;
  hash().then(() => hash()).then(() => { admitted += 1; });
  await untilSettled();
  assert.equal(admitted, 1, "the wait returned after the first digest while the second was still running");
});

test("work a release sets off before any digest starts is waited for", async () => {
  let admitted = 0;
  // The release resolves a gate; the loader reaches the digest only a few continuations later.
  Promise.resolve().then(() => Promise.resolve()).then(() => hash()).then(() => { admitted += 1; });
  await untilSettled();
  assert.equal(admitted, 1, "the wait returned before the loader had even reached its digest");
});

test("with nothing in flight it returns after one turn of the event loop", async () => {
  let count = 0;
  setImmediate(() => { count += 1; });
  await untilSettled();
  assert.equal(count, 1);
});
