// @ts-check
/**
 * The plan RUNNER, shared by every door that loads a manifest's files.
 *
 * **WHY THIS IS ONE MODULE AND NOT TWO.** Plan 6.2's ordering rules are all of the form "not
 * completion order" — failures "ordered by fetch-plan order, not completion order", warnings by
 * "fetch-plan order and then depth-first declaration order, independent of request completion
 * timing" — and the partial-failure policy, the concurrency cap, the abort rule and the
 * digest-before-parse rule sit on top of them. Those were the hard part of the Fetch loader, and
 * `lokalized/node`'s file loaders have to obey every one of them identically. A second copy for the
 * file door would be a second thing to keep in step with a specification neither copy states, and
 * the one that drifts is the one with fewer tests. So the door supplies a TRANSPORT and nothing else.
 *
 * Every result is written into a SLOT indexed by plan position and the output is assembled from the
 * slots, never from an arrival log. With eight reads in flight, a runner that appended results as
 * they arrived would produce output that depends on the network or the disk — reproducible on a fast
 * local stub, different in production, and different again on a retry.
 *
 * DIGEST BEFORE PARSE, and the scope is exact: SHA-256 covers the bytes the transport delivered,
 * after any content coding and before UTF-8 decoding or BOM removal. Verifying after decoding would
 * hash a different representation than the publisher did, and the comparison would fail for every
 * file carrying a BOM while looking like a corruption alarm.
 *
 * @typedef {import("./index.js").StringsManifestV1} StringsManifestV1
 * @typedef {import("./index.js").FetchEntry} FetchEntry
 *
 * @typedef {object} LoadTransport
 * @property {"fetch" | "read"} defaultStage the `LoadFailure.stage` for a failure that arrives
 *   without one of its own; the two doors report their I/O differently and the taxonomy is public.
 * @property {(options: any, plan: readonly FetchEntry[]) => void} preflight runs BEFORE any file is
 *   touched, so a runtime that cannot verify a digest never reads a body it could not have checked.
 *   It receives the whole PLAN as well as the options, because one of the two doors has to refuse a
 *   plan — `lokalized/node` rejects a resolved non-`file:` URL — and refusing it inside `read` would
 *   mean the door had already started loading the entries before it.
 * @property {(entry: FetchEntry, options: any, limits: any) => Promise<{ bytes: Uint8Array, digest: string }>} read
 *   bounded read plus the lowercase hex SHA-256 of exactly the bytes returned. The transport owns
 *   BOTH because the two doors hash differently — one-shot WebCrypto against an assembled body, or
 *   an incremental `node:crypto` hash updated as chunks arrive.
 */
import { resolveLimits } from "../internal/catalog.js";
import { parseStrings } from "../parse/index.js";
import { localeConfigurationForManifest, validateStringsManifest } from "./manifest.js";

const MAXIMUM_ACTIVE_READS = 8;

/**
 * The declared failure for a load that got past planning.
 *
 * Its `failures` are in PLAN order. A consumer diagnosing a broken deployment reads them against the
 * manifest, and completion order would reshuffle that list on every run.
 *
 * ONE CLASS FOR BOTH DOORS, deliberately: a caller that catches `StringsLoadingError` around a load
 * should not have to know whether the bytes came from the network or the disk.
 */
export class StringsLoadingError extends Error {
  /**
   * NOT CONSTRUCTIBLE BY A CONSUMER, and the token is what makes that enforceable rather than
   * advisory — it also refuses `class Mine extends StringsLoadingError` at instantiation time.
   * `StringsParseError` has had exactly this shape since M5; this class shipped without it, so a
   * consumer could fabricate a load failure that every `instanceof` check would believe.
   *
   * @param {symbol} token the internal construction token
   * @param {string} message @param {readonly any[]} failures
   */
  constructor(token, message, failures) {
    if (token !== LOADING_ERROR_TOKEN)
      throw new TypeError("StringsLoadingError is not constructible; it is thrown by the loaders");

    super(message);
    this.name = "StringsLoadingError";
    /** @type {string} */
    this.code = "STRINGS_LOADING";
    /** @type {readonly any[]} */
    this.failures = Object.freeze([...failures]);
  }
}

/** Unexported by design: only this package can hand it to the constructor. */
const LOADING_ERROR_TOKEN = Symbol("lokalized.strings-loading-error");

/**
 * The only way to raise one. Mirrors `parseError` in `internal/parse-diagnostics.js`.
 *
 * @param {string} message @param {readonly any[]} failures
 */
export function loadingError(message, failures) {
  return new StringsLoadingError(LOADING_ERROR_TOKEN, message, failures);
}

/** @param {ArrayBuffer | Uint8Array} buffer */
export const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Accumulate an async stream of chunks with the byte boundaries enforced WHILE STREAMING.
 *
 * The cap is checked as chunks arrive rather than after the body is whole, because a body that never
 * ends must fail on the limit instead of exhausting memory first — and an injected fetch in the tests
 * does exactly that. `onChunk` exists so a transport with an incremental hash can feed it here rather
 * than walking the assembled body a second time.
 *
 * @param {AsyncIterable<Uint8Array>} chunks
 * @param {FetchEntry} entry
 * @param {{ maximumInputBytes: number }} limits
 * @param {(chunk: Uint8Array) => void} [onChunk]
 */
export async function readBoundedStream(chunks, entry, limits, onChunk) {
  /** @type {Uint8Array[]} */
  const retained = [];
  let total = 0;
  for await (const value of chunks) {
    total += value.length;
    if (total > limits.maximumInputBytes)
      throw { stage: "limit", cause: new RangeError(`${entry.locale}: body exceeds the maximum of ${limits.maximumInputBytes} bytes`) };
    // Checked as it grows, not at the end: an over-long body is refused at the byte that crosses the
    // declared size rather than after the whole thing has been accepted.
    if (entry.expectedDecodedBytes !== undefined && total > entry.expectedDecodedBytes)
      throw { stage: "limit", cause: new RangeError(`${entry.locale}: body is longer than the declared ${entry.expectedDecodedBytes} bytes`) };
    onChunk?.(value);
    retained.push(value);
  }
  if (entry.expectedDecodedBytes !== undefined && total !== entry.expectedDecodedBytes)
    throw { stage: "limit", cause: new RangeError(`${entry.locale}: body is ${total} bytes, not the declared ${entry.expectedDecodedBytes}`) };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of retained) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** One planned file, start to finish. Throws `{stage, cause}` so the caller can build a LoadFailure. */
async function loadOne(/** @type {FetchEntry} */ entry, /** @type {any} */ options,
  /** @type {any} */ limits, /** @type {LoadTransport} */ transport) {
  const { bytes, digest } = await transport.read(entry, options, limits);

  // BEFORE decoding. The publisher hashed this same representation.
  if (digest !== entry.sha256)
    throw { stage: "digest", cause: new Error(`${entry.locale}: digest ${digest} does not match the manifest's ${entry.sha256}`) };

  try {
    return parseStrings(bytes, { locale: entry.locale, source: entry.url, limits });
  } catch (cause) {
    // The parser owns the decode/parse/validate distinction; a fatal UTF-8 failure surfaces from it
    // as a parse error too, so the stage is reported as `parse` rather than guessed apart.
    throw { stage: "parse", cause };
  }
}

/**
 * Plan 6.2:2103-2107 — the RESOLUTION channel's tiebreakers, filtered to what actually loaded.
 *
 * **THE MANIFEST'S FULL SET CANNOT BE HANDED TO `createStrings` AND NEVER COULD BE.** The core
 * applies Java's construction rule (`DefaultStrings.<init>:394`): a language code's tiebreaker list
 * must be an exact permutation of the catalogs that language actually has. A lookup-subset load
 * fetches the candidate chain and nothing else, so a manifest declaring `{en: [en-GB, en-US, en]}`
 * hands back a `complete: true` record naming three `en` catalogs when one arrived — and its own
 * core refuses it. That was live on the flagship `loadStrings` door until this filter existed, and
 * every test here missed it for one reason: every fixture declared `tiebreakers: {}`.
 *
 * Each declared list keeps its DECLARED ORDER; this list IS the resolution order for an ambiguous
 * language code, so re-deriving it from the loaded set would silently reorder it.
 *
 * A language with zero survivors is OMITTED rather than kept as an empty order, which the plan names
 * separately because the two are not the same value: an empty array is a declared order that resolves
 * nothing, and the core validates it strictly.
 *
 * `manifestLocaleConfiguration` keeps the FULL set — the selection channel reads the manifest, the
 * resolution channel reads what loaded.
 *
 * @param {Readonly<Record<string, readonly string[]>>} declared
 * @param {readonly string[]} loadedTags both are already normalized by `requireManifestTag`.
 */
function tiebreakersForLoaded(declared, loadedTags) {
  const loaded = new Set(loadedTags);
  /** @type {Record<string, readonly string[]>} */
  const filtered = Object.create(null);
  for (const [languageCode, candidates] of Object.entries(declared ?? {})) {
    const kept = candidates.filter((tag) => loaded.has(tag));
    if (kept.length === 0) continue;
    filtered[languageCode] = Object.freeze(kept);
  }
  return Object.freeze(filtered);
}

/**
 * @param {StringsManifestV1} manifest @param {readonly FetchEntry[]} plan
 * @param {any} options @param {LoadTransport} transport
 */
export async function runPlan(manifest, plan, options, transport) {
  const validated = validateStringsManifest(manifest, options);
  const limits = resolveLimits(options.limits);

  // PREFLIGHTED BEFORE ANY CATALOG I/O.
  transport.preflight(options, plan);
  if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");

  /** Slots, NOT an arrival log — see the module header. */
  const results = new Array(plan.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      // ABORT STOPS ADMISSION, and this check is the loader's own rather than the transport's. Plan
      // 6.2:2086 makes cancelling outstanding work the LOADER's property, and until this line existed
      // the runner delegated it entirely: the catch branch below only observes an abort when a read
      // FAILS, so a transport that ignores the signal — which an injected reader is free to be, since
      // plan 6.2:2098-2100 lets one return a complete Uint8Array — kept every worker dequeuing. With
      // twenty planned files and an abort during the first window, the runner invoked the transport
      // TWENTY times. Measured, not argued.
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");
      const index = next++;
      if (index >= plan.length) return;
      const entry = /** @type {FetchEntry} */ (plan[index]);
      try {
        results[index] = { ok: true, entry, parsed: await loadOne(entry, options, limits, transport) };
      } catch (thrown) {
        const failure = /** @type {{ stage?: string, cause?: unknown }} */ (thrown ?? {});
        if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");
        results[index] = {
          ok: false,
          entry,
          failure: Object.freeze({
            locale: entry.locale, url: entry.url,
            stage: failure?.stage ?? transport.defaultStage, cause: failure?.cause ?? failure,
          }),
        };
      }
    }
  };

  // Queued work retains plan order because each worker takes the next unclaimed index.
  await Promise.all(Array.from({ length: Math.min(MAXIMUM_ACTIVE_READS, plan.length) }, worker));
  // Abort is never converted into partial success: it cancels outstanding work and rejects.
  if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");

  const failures = results.filter((row) => row && !row.ok).map((row) => row.failure);
  const allowPartial = options.partialFailure === "allow-partial";
  const fallbackRow = results.find((row) => row && row.entry.locale === validated.fallbackLocale);
  const fallbackLoaded = fallbackRow ? fallbackRow.ok : false;

  if (failures.length > 0 && (!allowPartial || !fallbackLoaded))
    throw loadingError(
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
    tiebreakers: tiebreakersForLoaded(validated.tiebreakers, Object.keys(catalogs)),
    fallbackLocale: validated.fallbackLocale,
    // THE MANIFEST'S FULL CONFIGURATION, not the loaded subset, and it is not a convenience field.
    // `createStrings({ loaded })` recomputes the fetch plan from it (plan 3.4:727); without it the
    // recorded plan can only be believed, and for a PARTIAL load a walk over just the catalogs that
    // arrived would not even be the same walk.
    manifestLocaleConfiguration: localeConfigurationForManifest(validated),
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
 * The whole-manifest plan, in plan 3.4:727's normalized-tag order.
 *
 * Shared by both doors for the reason S10 found the hard way: `loadEntireManifest` planned in
 * `Object.entries(files)` order — the manifest's JSON key order — while `createStrings({ loaded })`
 * recomputes in normalized-tag order, so a manifest whose keys were not already sorted produced a
 * result its own core refused. A second copy of this in the Node door would reintroduce exactly that.
 *
 * @param {any} validated @returns {readonly FetchEntry[]}
 */
export function wholeManifestPlan(validated) {
  const base = new URL(validated.baseUrl);
  return Object.freeze(Object.entries(validated.files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([locale, file]) => Object.freeze({
      locale,
      url: new URL(/** @type {any} */ (file).url, base).href,
      sha256: /** @type {any} */ (file).sha256,
      ...(/** @type {any} */ (file).decodedBytes === undefined
        ? {} : { expectedDecodedBytes: /** @type {any} */ (file).decodedBytes }),
    })));
}
