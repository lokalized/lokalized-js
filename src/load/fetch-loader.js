// @ts-check
/**
 * `loadStrings` and `loadEntireManifest` — plan section 6.2's Fetch loaders.
 *
 * WHAT IS LEFT HERE AFTER S11a: the FETCH TRANSPORT and the two entry points. Every rule that is not
 * about HTTP — plan order, the concurrency cap, the partial-failure policy, abort, digest-before-parse
 * and the result shape — moved to `./run-plan.js`, which `lokalized/node`'s file loaders drive with a
 * different transport. Those rules are a specification neither door states on its own, and a second
 * copy of them is the drift this project keeps finding.
 *
 * WHAT A DETERMINISTIC STUB CANNOT TEST, said here because it is what this door's tests are for: an
 * injected fetch that resolves in order makes the ordering rules unfalsifiable. `test/fetch-loader.
 * test.js` therefore injects a fetch that MISBEHAVES on purpose — resolves out of order, streams past
 * the limit, aborts mid-flight, and returns a body whose digest is wrong. This project already shipped
 * one instrument that passed because its stub was too well behaved.
 *
 * DIGEST BEFORE PARSE, and the scope is exact: SHA-256 covers "the bytes exposed by the response body,
 * after HTTP content coding but before UTF-8 decoding or BOM removal". `SubtleCrypto.digest` is not
 * streaming, so the plan's own accommodation applies here: count chunks against the cap, retain one
 * bounded body, then digest it. The Node door hashes incrementally instead, which is why the digest
 * belongs to the transport rather than to the runner.
 */
import { configurationError } from "../internal/configuration-error.js";
import { normalizeTag } from "../internal/locale.js";
import { fetchSet } from "./planning.js";
import { validateStringsManifest } from "./manifest.js";
import { hex, readBoundedStream, runPlan, wholeManifestPlan } from "./run-plan.js";

/** @typedef {import("./index.js").StringsManifestV1} StringsManifestV1 */
/** @typedef {import("./index.js").FetchEntry} FetchEntry */

const DEFAULT_REQUEST = Object.freeze({ mode: "cors", credentials: "same-origin" });

export { StringsLoadingError } from "./run-plan.js";

/** Plan 6.2: the loader fails CLOSED when WebCrypto is absent, before any catalog I/O. */
function digestUnavailable() {
  const error = /** @type {Error & { code: string }} */ (new Error(
    "WebCrypto is unavailable, so catalog digests cannot be verified. `lokalized/load` fails closed " +
    "rather than fetching bodies it cannot check; WebCrypto is secure-context gated, and a " +
    "trustworthy loopback origin counts as one.",
  ));
  error.name = "DigestUnavailableError";
  error.code = "DIGEST_UNAVAILABLE";
  return error;
}

/**
 * A response body as an async iterable, cancelled if the consumer walks away.
 *
 * The `finally` is what keeps the never-ending-body test honest: when `readBoundedStream` throws on
 * the limit, the `for await` calls this generator's `return()`, which reaches the cancel. A plain
 * loop would leave the reader open.
 *
 * @param {Response} response
 */
async function* responseChunks(response) {
  const reader = /** @type {ReadableStream<Uint8Array>} */ (response.body).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield /** @type {Uint8Array} */ (value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** @type {import("./run-plan.js").LoadTransport} */
const FETCH_TRANSPORT = {
  defaultStage: "fetch",
  preflight(options) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== "function") throw digestUnavailable();
    if (typeof (options.fetch ?? globalThis.fetch) !== "function")
      throw configurationError("No fetch implementation is available; pass one as `options.fetch`");
  },
  async read(entry, options, limits) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    let response;
    try {
      response = await fetchImpl(entry.url, {
        ...DEFAULT_REQUEST,
        ...(options.request ?? {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      throw { stage: "fetch", cause };
    }
    if (!response.ok) throw { stage: "fetch", cause: new Error(`${entry.url} responded ${response.status}`) };

    const bytes = response.body
      ? await readBoundedStream(responseChunks(response), entry, limits)
      : await readBoundedStream(
          (async function* () { yield new Uint8Array(await response.arrayBuffer()); })(), entry, limits);

    return { bytes, digest: hex(await globalThis.crypto.subtle.digest("SHA-256", bytes)) };
  },
};

/**
 * @param {StringsManifestV1} manifest @param {string} lookupLocale @param {any} [options]
 */
export async function loadStrings(manifest, lookupLocale, options = {}) {
  const plan = fetchSet(manifest, lookupLocale, options);
  const loaded = await runPlan(manifest, plan, options, FETCH_TRANSPORT);
  // NORMALIZED, per plan 6.1's "both functions use and record the normalized serialized value" and
  // plan 2.2's own comment on the field ("Normalized planning input"). It is the tag plan 6.4 then
  // compares a rendering context against, so recording the caller's spelling would make coverage
  // depend on how the load was typed.
  return Object.freeze({
    ...loaded,
    coverage: Object.freeze({ kind: "lookup", lookupLocale: normalizeTag(lookupLocale) }),
  });
}

/** @param {StringsManifestV1} manifest @param {any} [options] */
export async function loadEntireManifest(manifest, options = {}) {
  const validated = validateStringsManifest(manifest, options);
  const loaded = await runPlan(manifest, wholeManifestPlan(validated), options, FETCH_TRANSPORT);
  return Object.freeze({ ...loaded, coverage: Object.freeze({ kind: "entire-manifest" }) });
}
