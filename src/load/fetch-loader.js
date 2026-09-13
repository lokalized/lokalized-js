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

/**
 * Plan 6.2: the loader fails CLOSED when WebCrypto is absent, before any catalog I/O.
 *
 * **A REAL CLASS, because plan 8.5 requires a CATCHABLE one.** This was a plain `Error` with its
 * `name` and `code` assigned after construction, so a consumer could only recognise it by string —
 * `error.name === "DigestUnavailableError"` — and never by `instanceof`. The name and code are
 * unchanged, so every string-matching consumer and every recorded message keeps working; what is
 * added is the thing the clause actually asks for. The construction token mirrors `StringsParseError`
 * and `StringsLoadingError`.
 */
export class DigestUnavailableError extends Error {
  /** @param {symbol} token the internal construction token @param {string} message */
  constructor(token, message) {
    if (token !== DIGEST_ERROR_TOKEN)
      throw new TypeError("DigestUnavailableError is not constructible; it is thrown by lokalized/load");

    super(message);
    /** @type {"DigestUnavailableError"} */
    this.name = "DigestUnavailableError";
    /** @type {"DIGEST_UNAVAILABLE"} */
    this.code = "DIGEST_UNAVAILABLE";
  }
}

/** Unexported by design: only this package can hand it to the constructor. */
const DIGEST_ERROR_TOKEN = Symbol("lokalized.digest-unavailable-error");

function digestUnavailable() {
  return new DigestUnavailableError(DIGEST_ERROR_TOKEN,
    "WebCrypto is unavailable, so catalog digests cannot be verified. `lokalized/load` fails closed " +
    "rather than fetching bodies it cannot check; WebCrypto is secure-context gated, and a " +
    "trustworthy loopback origin counts as one.");
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
  preflight(options, plan) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== "function") throw digestUnavailable();
    if (typeof (options.fetch ?? globalThis.fetch) !== "function")
      throw configurationError("No fetch implementation is available; pass one as `options.fetch`");

    // **THE MIRROR OF THE NODE DOOR'S CHECK, AND IT WAS MISSING.** Plan 6.2:2035 gives the rule in one
    // sentence for both doors — "Fetch loaders reject base or resolved URLs outside http:/https: and
    // Node file loaders reject anything outside file:" — and only the second half had code. Measured
    // before this existed: a manifest whose `baseUrl` is `file:///srv/catalogs/` loaded through this
    // door and invoked the transport with `file:///srv/catalogs/en.json`, while the Node door refused
    // the symmetric `https:` manifest with zero reader invocations.
    //
    // IN PREFLIGHT rather than in `read`, for the reason S11a recorded when it put the Node check
    // here: inside `read` the refusal degrades into one `LoadFailure` among many, and under
    // `allow-partial` that is a SUCCESSFUL load which silently skipped a file the caller asked for.
    // A manifest is either addressable by this door or it is not, and that is knowable before any I/O.
    for (const entry of plan) {
      let protocol;
      try {
        protocol = new URL(entry.url).protocol;
      } catch {
        protocol = null;
      }
      if (protocol !== "http:" && protocol !== "https:")
        throw configurationError(
          `The Fetch loaders read \`http:\` and \`https:\` URLs only, and '${entry.locale}' resolves ` +
          `to '${entry.url}'. Read local files with \`loadStringsFromFiles\` from lokalized/node, or ` +
          `point \`baseUrl\` at the origin serving them`);
    }
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
