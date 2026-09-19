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
 * @typedef {import("./index.js").LoadFailure} LoadFailure
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
import { LoadingSession, resolveLimits } from "../internal/catalog.js";
// The SHARED BODY, not `lokalized/parse`'s door — the same import `src/node/directory.js` makes, for
// the same reason. `parseStrings` constructs a FRESH `LoadingSession` per call and offers no way to
// supply one, which is exactly right for a door that parses one resource and exactly wrong here: the
// four budgets that class carries are documented as spanning a whole load, and this runner parses a
// whole load. Reaching the shared body is what lets each planned file be MEASURED against its own
// session and the totals reconciled afterwards.
import { parseStringsWithSession } from "../internal/parse-file.js";
import { localeConfigurationForManifest, validateStringsManifest } from "./manifest.js";
import { LOKALIZED_ERROR_TOKEN, LokalizedError } from "../internal/lokalized-error.js";

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
  // Extends `LokalizedError` as of S35, so one `instanceof` answers "did this come from
  // lokalized" — plan 3.5:1039-1042 and :1092. The token travels up; it never leaves the package.
export class StringsLoadingError extends LokalizedError {
  /**
   * **PRIVATE, WHICH IS HOW THE DECLARATION STOPS EXPOSING A CONSTRUCTOR.** Plan 3.5:1107-1108
   * requires the runtime constructor to take an unexported token AND the declaration to "expose no
   * constructor or extension signature". The token was there; the declaration was not — `tsc`
   * emitted `constructor(token: symbol, …)` for all five error classes, so a consumer's TypeScript
   * saw a constructible-looking class. `@private` emits `private constructor();`, which TypeScript
   * refuses to `new` AND refuses to extend: exactly the two properties the plan names. The static
   * raiser below is what lets the module's own factory still build one, since a private constructor
   * is callable only from inside the class body.
   *
   * @private
   * NOT CONSTRUCTIBLE BY A CONSUMER, and the token is what makes that enforceable rather than
   * advisory — it also refuses `class Mine extends StringsLoadingError` at instantiation time.
   * `StringsParseError` has had exactly this shape since M5; this class shipped without it, so a
   * consumer could fabricate a load failure that every `instanceof` check would believe.
   *
   * @param {symbol} token the internal construction token
   * @param {string} message @param {readonly LoadFailure[]} failures
   */
  constructor(token, message, failures) {
    if (token !== LOADING_ERROR_TOKEN)
      throw new TypeError("StringsLoadingError is not constructible; it is thrown by the loaders");

    super(LOKALIZED_ERROR_TOKEN, "STRINGS_LOADING", message);
    this.name = "StringsLoadingError";
    /**
     * **`LoadFailure[]`, NOT `any[]` — it was `any[]` until M-R S3.** This is the field a consumer
     * reads while diagnosing a broken deployment, and `failures[0].stage` is the whole reason the
     * stage is a seven-member sequence rather than a boolean (see `LoadFailure` in `./index.js`).
     * Typed `any` it answered every spelling: `failures[0].staeg` compiled, and so did assigning a
     * stage to a `number`. Measured through the package on 2026-09-18, all three ways.
     *
     * The array is frozen at run time, and BOOT-M0-0533 asks the declaration to say so about the
     * FIELD as well: `readonly LoadFailure[]` stopped an element write and not a whole-array one.
     *
     * @type {readonly LoadFailure[]}
     * @readonly
     */
    this.failures = Object.freeze([...failures]);
  }

  /**
   * The one construction path, because the constructor above is private. Its parameters are the
   * constructor's, so the module's own factory keeps its types; a consumer cannot reach it, because
   * the token it takes first is never exported from this package.
   *
   * @param {symbol} token @param {string} message @param {readonly LoadFailure[]} failures
   */
  static raise(token, message, failures) {
    return new StringsLoadingError(token, message, failures);
  }
}

/** Unexported by design: only this package can hand it to the constructor. */
const LOADING_ERROR_TOKEN = Symbol("lokalized.strings-loading-error");

/**
 * The only way to raise one. Mirrors `parseError` in `internal/parse-diagnostics.js`.
 *
 * @param {string} message @param {readonly LoadFailure[]} failures
 */
export function loadingError(message, failures) {
  return StringsLoadingError.raise(LOADING_ERROR_TOKEN, message, failures);
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

  // **A FRESH SESSION PER FILE, AND IT IS A MEASUREMENT AS WELL AS A BOUND.** As a bound it is what
  // keeps the aggregate budgets refusing WHILE A FILE IS STILL BEING READ: a resource that busts a
  // budget on its own cannot be made acceptable by anything its neighbours do, so charging it against
  // a fresh session refuses at the byte that crosses, exactly as it did before reconciliation existed.
  // As a measurement its four counters ARE this file's contribution to the load's totals, taken by the
  // parser itself rather than re-derived from the projection — `runPlan` replays them in plan order.
  const session = new LoadingSession(limits);
  try {
    const parsed = parseStringsWithSession(bytes, { locale: entry.locale, source: entry.url }, session);
    return { parsed, contribution: session };
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
    // PROJECTED to the validator's own surface. Forwarding a loader's whole options object
    // makes the validator refuse `fetch`/`readFile`/`signal` — a door refusing its own caller
    // for using that caller's documented options. Measured: leaving these wholesale reds 270
    // tests, 130 of them on `fetch` alone.
  const validated = validateStringsManifest(manifest, { limits: options.limits });
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
        const { parsed, contribution } = await loadOne(entry, options, limits, transport);
        results[index] = { ok: true, entry, parsed, contribution };
      } catch (thrown) {
        // THE ASSERTED SHAPE NAMES `LoadFailure["stage"]`, NOT `string`, so this line and the record
        // below are checked against the seven-member sequence instead of accepting any word. Every
        // `throw { stage }` reachable from here spells a member of it — `fetch`, `read`, `limit`,
        // `digest`, `parse` — and `transport.defaultStage` is already typed `"fetch" | "read"`.
        const failure = /** @type {{ stage?: LoadFailure["stage"], cause?: unknown }} */ (thrown ?? {});
        if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");
        /** @type {LoadFailure} */
        const loadFailure = Object.freeze({
          locale: entry.locale, url: entry.url,
          stage: failure?.stage ?? transport.defaultStage, cause: failure?.cause ?? failure,
        });
        results[index] = { ok: false, entry, failure: loadFailure };
      }
    }
  };

  // **EVERY REJECTION PATH BELOW RELEASES THE SLOTS FIRST, and that is a memory property rather
  // than a tidiness one.** A rejected load throws an error the caller typically HOLDS — in a log
  // line, a retry record, a test's `assert.rejects` — and an Error captures its stack, which retains
  // the frames it was built in, which retains this function's scope, which retains `results`, which
  // retains every catalog that had already PARSED. Measured on a six-file load failing one digest:
  // the held rejection reached 5 of 5 parsed catalogs. `results.fill(null)` breaks that edge; the
  // same measurement then reads 0, with a deliberately-kept record as the control that still reads 1.
  //
  // The `failures` list computed below is NOT affected: it holds frozen `{locale, url, stage, cause}`
  // records and never the parsed catalog, which is why clearing the slots costs the diagnostic
  // nothing.
  //
  // THE `catch` IS NOT DECORATION. An abort detected inside a worker (the two checks above) unwinds
  // past every line below, so clearing at the outer checks alone leaves that path leaking — measured
  // before this was written, with a signal whose `reason` was undefined.
  // Queued work retains plan order because each worker takes the next unclaimed index.
  try {
    await Promise.all(Array.from({ length: Math.min(MAXIMUM_ACTIVE_READS, plan.length) }, worker));
  } catch (thrown) {
    results.fill(null);
    throw thrown;
  }
  // Abort is never converted into partial success: it cancels outstanding work and rejects.
  if (options.signal?.aborted) {
    results.fill(null);
    throw options.signal.reason ?? new Error("aborted");
  }

  // **ANNOTATED FOR THE SAME REASON `catalogs` IS, one screen down.** `results` is an untyped slot
  // array, so without this the loader's own inferred return type declared `failures: readonly any[]`
  // — and `LoadedStrings.failures` has declared `readonly LoadFailure[]` all along, so the two
  // artifacts a consumer can reach disagreed about one field. Measured through the package on
  // 2026-09-18: `Awaited<ReturnType<typeof loadStrings>>["failures"][0].stage` assigned to a `number`
  // compiled. Each record is CONSTRUCTED under a `LoadFailure` annotation above, which is what makes
  // this an ordering claim about the slots rather than an unchecked assertion about their contents.
  /** @type {readonly LoadFailure[]} */
  const failures = results.filter((row) => row && !row.ok).map((row) => row.failure);
  const allowPartial = options.partialFailure === "allow-partial";
  const fallbackRow = results.find((row) => row && row.entry.locale === validated.fallbackLocale);
  const fallbackLoaded = fallbackRow ? fallbackRow.ok : false;

  if (failures.length > 0 && (!allowPartial || !fallbackLoaded)) {
    results.fill(null);
    throw loadingError(
      `${failures.length} catalog file(s) failed to load` +
      (allowPartial && !fallbackLoaded ? "; the resolved fallback-locale file is among them, so a partial result is not offered" : ""),
      failures,
    );
  }

  // **THE AGGREGATE BUDGETS, RECONCILED IN FETCH-PLAN ORDER — the step that makes the four counters
  // `LoadingSession` carries mean at this door what they already mean at the directory door.**
  //
  // Plan 3.2 requires the file, byte, node and warning budgets to apply "across all raw and
  // already-parsed catalogs"; `src/internal/parse-file.js`'s own header says Java threads ONE session
  // through a whole directory load. `src/node/directory.js` does that, because its walk is sequential.
  // THIS RUNNER COULD NOT, and shipping a shared counter would have been worse than the gap: with
  // eight reads in flight the file that busts it is whichever finishes last, so the blamed file — and
  // therefore the failure list plan 6.2:2077 fixes to fetch-plan order — would depend on completion
  // order. Measured before this existed: two files with one translation node each at
  // `maximumTranslationNodes: 1` were REFUSED by the directory door and LOADED by every manifest
  // door, and the same held for `maximumTotalInputBytes` and `maximumWarnings`.
  //
  // So parsing stays concurrent and independent, and the totals are reconciled here, afterwards, over
  // the slots in PLAN ORDER. Nothing in this walk can observe when anything arrived.
  //
  // **IT RUNS OVER THE SURVIVORS, AFTER THE PARTIAL-FAILURE DECISION ABOVE, and that ordering is the
  // design.** The survivors are exactly the catalogs about to be returned, so the invariant this
  // establishes is the one a caller can use: WHAT YOU GET BACK FITS THE LIMITS YOU DECLARED. Running
  // it first would replace an honest "3 catalog file(s) failed to load" with a budget message for a
  // load that was failing anyway.
  //
  // **AND IT IS FATAL WHATEVER `partialFailure` SAYS — the same rule abort has, for the same reason.**
  // `allow-partial` means "some files could not be obtained; serve the rest", and every file here WAS
  // obtained and parsed cleanly. Dropping good catalogs until the rest fit a byte budget would return
  // a `complete: false` record whose missing locales have no per-file explanation and whose catalog
  // set is decided by a limit rather than by what the deployment published — a silent,
  // configuration-dependent reduction of the served set. A budget is a property of the LOAD; naming
  // the file at which it was crossed is a diagnostic, not an attribution.
  //
  // A file that busts a budget BY ITSELF is a different thing and keeps its old behaviour: it is that
  // file's failure, it is reported at stage `parse`, and `allow-partial` may still serve the rest.
  const aggregate = new LoadingSession(options.limits);
  for (let index = 0; index < results.length; ++index) {
    const row = results[index];
    if (!row || !row.ok) continue;
    try {
      aggregate.absorb(row.contribution, row.entry.url);
    } catch (cause) {
      // STAGE `parse`, and it is a consistency argument rather than a preference. These four budgets
      // are charged by the parser as it walks, and when ONE file crosses one of them on its own this
      // runner has always reported `parse`. Reporting the cross-file crossing as `limit` would make
      // the SAME budget report two different stages depending on how many files it took to cross it.
      // `limit` stays what it is — `readBoundedStream`'s per-file byte bounds, enforced by the
      // transport before any parsing happens.
      /** @type {LoadFailure} */
      const failure = Object.freeze({
        locale: row.entry.locale, url: row.entry.url, stage: "parse", cause,
      });
      // CLEARED FOR UNIFORMITY, AND THE MEASUREMENT SAYS SO RATHER THAN THE COMMENT CLAIMING A WIN.
      // Every other rejection path here clears the slots because a held rejection otherwise retains
      // them (the block above). Ablated on THIS path — removed, then re-measured with and without
      // `.stack` materialised — the held rejection reaches 0 of 5 parsed catalogs either way, while
      // the same removal one branch down still reds `test/load-retention.test.js` at its first arm.
      // So this line is not what makes that file's aggregate arm pass; it is kept so this is not the
      // one rejection path that leaves the slots alive, which is a V8-version-dependent bet to take.
      // **THE PER-FILE FAILURES ARE CARRIED, NOT DISCARDED, and the first version of this dropped
      // them.** Reaching here under `allow-partial` means some files had ALREADY failed and were
      // being tolerated; throwing `[failure]` alone reported the budget crossing and silently lost
      // every diagnostic the worker loop had accumulated. Measured: three catalogs with `fr`'s bytes
      // corrupted on disk, `allow-partial` — the control returns `complete: false` with
      // `fr:limit` recorded, and with an aggregate budget crossed the same load reported ONLY
      // `en:parse`. A caller told their load busts a budget, while the reason one of their files was
      // unreadable is thrown away, cannot act on either.
      //
      // MERGED IN FETCH-PLAN ORDER, which is where plan 6.2:2077 puts them. `failures` is already in
      // plan order because the worker loop writes slots by index, and the aggregate failure belongs
      // at the index of the file that crossed — so splicing by index is what keeps ONE ordering rule
      // rather than appending and hoping nobody looks.
      const ordered = results
        .map((row_, at) => (row_ && !row_.ok ? { at, failure: row_.failure } : null))
        .filter((entry) => entry !== null);
      ordered.push({ at: index, failure });
      ordered.sort((left, right) => left.at - right.at);

      results.fill(null);
      throw loadingError(
        "the load exceeds an aggregate loading limit; a partial result is not offered, because every " +
        "file that was obtained parsed cleanly and the budget is the whole load's",
        ordered.map((entry) => entry.failure),
      );
    }
  }

  // **THESE TWO ANNOTATIONS ARE WHAT MAKES THE LOADER'S RESULT ASSIGNABLE TO `createStrings`.**
  // They read as placeholders and were: `Record<string, unknown>` and `unknown[]` widened the two
  // fields `LoadedStrings` declares most precisely, so `createStrings({ loaded })` — the whole point
  // of the loaded branch — failed to typecheck with TS2322 for every caller, while every test in
  // this repository stayed green because every test is JavaScript. Found 2026-09-15 by compiling
  // `examples/` under `--strict`, which is the first consumer-shaped TypeScript in the repo to call
  // the two doors in sequence rather than hand-writing a `LoadedStrings` to stand in for one.
  /** @type {Record<string, import("../parse/index.js").ParsedStringsFile>} */
  const catalogs = Object.create(null);
  /** @type {import("../internal/parse-warnings.js").LocalizedStringWarning[]} */
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
