// @ts-check
/**
 * `loadStrings` and `loadEntireManifest` — plan section 6.2's Fetch loaders.
 *
 * THE ORDERING RULES ARE THE HARD PART, and they are all of the form "not completion order". Plan
 * 6.2: failures are "ordered by fetch-plan order, not completion order", and warnings by "fetch-plan
 * order and then depth-first declaration order, independent of request completion timing". With eight
 * requests in flight, a loader that appends results as they arrive produces output that depends on
 * the network — reproducible on a fast local stub, different in production, and different again on a
 * retry. So every result is written into a SLOT indexed by plan position and the output is assembled
 * from the slots, never from an arrival log.
 *
 * WHAT A DETERMINISTIC STUB CANNOT TEST, said here because it is what this slice's tests are for: an
 * injected fetch that resolves in order makes the paragraph above unfalsifiable. `test/fetch-loader.
 * test.js` therefore injects a fetch that MISBEHAVES on purpose — resolves out of order, streams past
 * the limit, aborts mid-flight, and returns a body whose digest is wrong. This project already shipped
 * one instrument that passed because its stub was too well behaved.
 *
 * DIGEST BEFORE PARSE, and the scope is exact: SHA-256 covers "the bytes exposed by the response body,
 * after HTTP content coding but before UTF-8 decoding or BOM removal". Verifying after decoding would
 * hash a different representation than the publisher did, and the comparison would fail for every file
 * carrying a BOM while looking like a corruption alarm.
 */
import { configurationError } from "../internal/configuration-error.js";
import { resolveLimits } from "../internal/catalog.js";
import { parseStrings } from "../parse/index.js";
import { fetchSet } from "./planning.js";
import { validateStringsManifest } from "./manifest.js";

/** @typedef {import("./index.js").StringsManifestV1} StringsManifestV1 */
/** @typedef {import("./index.js").FetchEntry} FetchEntry */

const MAXIMUM_ACTIVE_READS = 8;
const DEFAULT_REQUEST = Object.freeze({ mode: "cors", credentials: "same-origin" });

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
 * The declared failure for a load that got past planning.
 *
 * Its `failures` are in FETCH-PLAN order. A consumer diagnosing a broken deployment reads them
 * against the manifest, and completion order would reshuffle that list on every run.
 */
export class StringsLoadingError extends Error {
  /** @param {string} message @param {readonly any[]} failures */
  constructor(message, failures) {
    super(message);
    this.name = "StringsLoadingError";
    /** @type {string} */
    this.code = "STRINGS_LOADING";
    /** @type {readonly any[]} */
    this.failures = Object.freeze([...failures]);
  }
}

/** @param {ArrayBuffer} buffer */
const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Read a response body with the byte boundaries enforced WHILE STREAMING.
 *
 * The cap is checked as chunks arrive rather than after `arrayBuffer()`, because a body that never
 * ends must fail on the limit instead of exhausting memory first — and an injected fetch in the tests
 * does exactly that. `SubtleCrypto.digest` is not streaming, so the plan's own accommodation applies:
 * count chunks against the cap, retain one bounded body, then digest it.
 *
 * @param {Response} response @param {FetchEntry} entry @param {{maximumInputBytes: number}} limits
 */
// eslint-disable-next-line
async function readBounded(response, entry, limits) {
  const body = response.body;
  if (!body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limits.maximumInputBytes)
      throw { stage: "limit", cause: new RangeError(`${entry.locale}: body exceeds the maximum of ${limits.maximumInputBytes} bytes`) };
    return bytes;
  }

  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limits.maximumInputBytes) {
      await reader.cancel().catch(() => {});
      throw { stage: "limit", cause: new RangeError(`${entry.locale}: body exceeds the maximum of ${limits.maximumInputBytes} bytes`) };
    }
    // Checked as it grows, not at the end: an over-long body is refused at the byte that crosses the
    // declared size rather than after the whole thing has been accepted.
    if (entry.expectedDecodedBytes !== undefined && total > entry.expectedDecodedBytes)
      throw { stage: "limit", cause: new RangeError(`${entry.locale}: body is longer than the declared ${entry.expectedDecodedBytes} bytes`) };
    chunks.push(value);
  }
  if (entry.expectedDecodedBytes !== undefined && total !== entry.expectedDecodedBytes)
    throw { stage: "limit", cause: new RangeError(`${entry.locale}: body is ${total} bytes, not the declared ${entry.expectedDecodedBytes}`) };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** One planned file, start to finish. Throws `{stage, cause}` so the caller can build a LoadFailure. */
/**
 * @param {FetchEntry} entry @param {any} options
 * @param {any} limits @param {SubtleCrypto} subtle
 */
async function loadOne(entry, options, limits, subtle) {
  let response;
  try {
    response = await options.fetchImpl(entry.url, {
      ...DEFAULT_REQUEST,
      ...(options.request ?? {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    throw { stage: "fetch", cause };
  }
  if (!response.ok) throw { stage: "fetch", cause: new Error(`${entry.url} responded ${response.status}`) };

  const bytes = await readBounded(response, entry, limits);

  // BEFORE decoding. The publisher hashed this same representation.
  const actual = hex(await subtle.digest("SHA-256", bytes));
  if (actual !== entry.sha256)
    throw { stage: "digest", cause: new Error(`${entry.locale}: digest ${actual} does not match the manifest's ${entry.sha256}`) };

  try {
    return parseStrings(bytes, { locale: entry.locale, source: entry.url, limits });
  } catch (cause) {
    // The parser owns the decode/parse/validate distinction; a fatal UTF-8 failure surfaces from it
    // as a parse error too, so the stage is reported as `parse` rather than guessed apart.
    throw { stage: "parse", cause };
  }
}

/** @param {StringsManifestV1} manifest @param {readonly FetchEntry[]} plan @param {any} options */
async function runPlan(manifest, plan, options) {
  const validated = validateStringsManifest(manifest, options);
  const limits = resolveLimits(options.limits);

  const subtle = globalThis.crypto?.subtle;
  // PREFLIGHTED BEFORE ANY CATALOG I/O, so a runtime without WebCrypto never issues a request whose
  // body it could not have checked.
  if (!subtle || typeof subtle.digest !== "function") throw digestUnavailable();
  if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw configurationError("No fetch implementation is available; pass one as `options.fetch`");

  /** Slots, NOT an arrival log — see the module header. */
  const results = new Array(plan.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= plan.length) return;
      const entry = /** @type {FetchEntry} */ (plan[index]);
      try {
        results[index] = { ok: true, entry, parsed: await loadOne(entry, { ...options, fetchImpl }, limits, subtle) };
      } catch (thrown) {
        const failure = /** @type {{ stage?: string, cause?: unknown }} */ (thrown ?? {});
        if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");
        results[index] = {
          ok: false,
          entry,
          failure: Object.freeze({ locale: entry.locale, url: entry.url, stage: failure?.stage ?? "fetch", cause: failure?.cause ?? failure }),
        };
      }
    }
  };

  // Queued work retains fetch-plan order because each worker takes the next unclaimed index.
  await Promise.all(Array.from({ length: Math.min(MAXIMUM_ACTIVE_READS, plan.length) }, worker));
  // Abort is never converted into partial success: it cancels outstanding work and rejects.
  if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");

  const failures = results.filter((row) => row && !row.ok).map((row) => row.failure);
  const allowPartial = options.partialFailure === "allow-partial";
  const fallbackRow = results.find((row) => row && row.entry.locale === validated.fallbackLocale);
  const fallbackLoaded = fallbackRow ? fallbackRow.ok : false;

  if (failures.length > 0 && (!allowPartial || !fallbackLoaded))
    throw new StringsLoadingError(
      `${failures.length} catalog file(s) failed to load` +
      (allowPartial && !fallbackLoaded ? "; the resolved fallback-locale file is among them, so a partial result is not offered" : ""),
      failures,
    );

  /** @type {Record<string, unknown>} */
  const catalogs = Object.create(null);
  /** @type {unknown[]} */
  const warnings = [];
  for (const row of results) {
    if (!row || !row.ok) continue;
    catalogs[row.entry.locale] = row.parsed;
    // Plan-order, then the parser's own depth-first declaration order within a file.
    warnings.push(...row.parsed.warnings);
  }

  return Object.freeze({
    catalogs: Object.freeze(catalogs),
    tiebreakers: validated.tiebreakers,
    fallbackLocale: validated.fallbackLocale,
    catalogIdentity: Object.freeze({
      catalogVersion: validated.catalogVersion,
      catalogFingerprint: validated.catalogFingerprint,
    }),
    cldrVersion: validated.cldrVersion,
    dataFingerprint: validated.dataFingerprint,
    loadingLimits: Object.freeze({ ...limits }),
    requestedFiles: Object.freeze([...plan]),
    failures: Object.freeze(failures),
    warnings: Object.freeze(warnings),
    complete: failures.length === 0,
  });
}

/**
 * @param {StringsManifestV1} manifest @param {string} lookupLocale @param {any} [options]
 */
export async function loadStrings(manifest, lookupLocale, options = {}) {
  const plan = fetchSet(manifest, lookupLocale, options);
  const loaded = await runPlan(manifest, plan, options);
  return Object.freeze({ ...loaded, coverage: Object.freeze({ kind: "lookup", lookupLocale }) });
}

/** @param {StringsManifestV1} manifest @param {any} [options] */
export async function loadEntireManifest(manifest, options = {}) {
  const validated = validateStringsManifest(manifest, options);
  const base = new URL(validated.baseUrl);
  const plan = Object.freeze(Object.entries(validated.files).map(([locale, file]) =>
    Object.freeze({
      locale,
      url: new URL(file.url, base).href,
      sha256: file.sha256,
      ...(file.decodedBytes === undefined ? {} : { expectedDecodedBytes: file.decodedBytes }),
    })));
  const loaded = await runPlan(manifest, plan, options);
  return Object.freeze({ ...loaded, coverage: Object.freeze({ kind: "entire-manifest" }) });
}
