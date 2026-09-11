// @ts-check
/**
 * `lokalized/node`'s manifest-mediated file loaders — plan section 6.2's Node door.
 *
 * **IT IS THE SAME LOADER AS THE BROWSER'S, WITH A DIFFERENT TRANSPORT.** Plan order, the
 * eight-at-a-time cap, the partial-failure policy, abort, digest-before-parse and the whole
 * `LoadedStrings` shape all come from `src/load/run-plan.js`; what lives here is how bytes arrive and
 * how they are hashed. That split is not tidiness — those ordering rules are a specification neither
 * door states on its own, and this project has already measured what happens when two implementations
 * of one unstated rule drift apart.
 *
 * **THE DIGEST IS INCREMENTAL HERE, AND THAT IS WHY THE TRANSPORT OWNS IT.** `SubtleCrypto.digest` is
 * one-shot, so the Fetch door assembles a bounded body and then hashes it. Node has a streaming hash,
 * so this door feeds each chunk to `createHash` as it arrives and never walks the body twice. **Said
 * plainly so the benefit is not over-read:** the bytes are still retained, because the parser needs
 * them. What incremental hashing buys is one pass and no WebCrypto dependency — not bounded memory,
 * which is what `maximumInputBytes` is for.
 *
 * **NON-`file:` URLs ARE REFUSED BEFORE ANY READER RUNS.** Plan 6.2: these loaders "reject any
 * resolved non-`file:` URL", and "HTTP callers use Fetch plus `parseStringsManifest` rather than
 * hiding network I/O in the Node helper". The check is in the transport's PREFLIGHT rather than in
 * its read, so a manifest with one `https:` entry loads nothing at all — not "everything except that
 * one". `test/node-file-loader.test.js` proves it with an injected reader that RECORDS EVERY CALL and
 * must record none.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { configurationError } from "../internal/configuration-error.js";
import { normalizeTag } from "../internal/locale.js";
import { resolveLimits } from "../internal/catalog.js";
import { fetchSet } from "../load/planning.js";
import { parseStringsManifest, validateStringsManifest } from "../load/manifest.js";
import { readBoundedStream, runPlan, wholeManifestPlan } from "../load/run-plan.js";
import { createStringsManifestFromDirectory, directoryPath } from "./manifest-directory.js";

/** @typedef {import("../load/index.js").StringsManifestV1} StringsManifestV1 */
/** @typedef {import("../load/index.js").FetchEntry} FetchEntry */

/**
 * Plan 6.2's `LoadStringsFromFilesOptions`.
 *
 * `readFile` may answer with the whole body or with a stream; the declared type says
 * `Promise<Uint8Array | AsyncIterable<Uint8Array>>` and both are honoured, because a test double has
 * no reason to build a stream and the default reader has every reason to be one.
 *
 * @typedef {object} LoadStringsFromFilesOptions
 * @property {(url: string, signal?: AbortSignal) => Promise<Uint8Array | AsyncIterable<Uint8Array>>} [readFile]
 * @property {AbortSignal} [signal]
 * @property {import("../internal/catalog.js").ParseLimits} [limits]
 * @property {"all-or-nothing" | "allow-partial"} [partialFailure]
 */

/** The default reader: a real stream, so a body is bounded as it arrives rather than after. */
async function* streamFile(/** @type {string} */ url, /** @type {AbortSignal | undefined} */ signal) {
  const stream = createReadStream(fileURLToPath(url), signal ? { signal } : {});
  for await (const chunk of stream) yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

/** A reader's answer, in either declared shape, as one async iterable. */
async function* chunksOf(/** @type {any} */ answer) {
  if (answer instanceof Uint8Array) { yield answer; return; }
  if (answer && typeof answer[Symbol.asyncIterator] === "function") { yield* answer; return; }
  if (answer && typeof answer[Symbol.iterator] === "function") { yield* answer; return; }
  throw new TypeError("`readFile` must resolve to a Uint8Array or an async iterable of them");
}

/** @type {import("../load/run-plan.js").LoadTransport} */
const FILE_TRANSPORT = {
  defaultStage: "read",
  preflight(options, plan) {
    // `fetch` and `request` are OMITTED from this door's options type. Refused rather than ignored:
    // a caller who passed one believes network loading is happening, and silently dropping it is the
    // failure mode that gets discovered in production.
    for (const networkOnly of ["fetch", "request"])
      if (options?.[networkOnly] !== undefined)
        throw configurationError(
          `\`${networkOnly}\` is not an option of the Node file loaders; they read \`file:\` URLs. ` +
          `An HTTP caller uses \`loadStrings\` from lokalized/load with Fetch instead`);

    for (const entry of plan) {
      let protocol;
      try {
        protocol = new URL(entry.url).protocol;
      } catch {
        protocol = null;
      }
      if (protocol !== "file:")
        throw configurationError(
          `The Node file loaders read \`file:\` URLs only, and '${entry.locale}' resolves to ` +
          `'${entry.url}'. Fetch the manifest's files with \`loadStrings\` from lokalized/load, or ` +
          `point \`baseUrl\` at the directory holding them`);
    }
  },
  async read(entry, options, limits) {
    const hash = createHash("sha256");
    let bytes;
    try {
      const answer = options.readFile
        ? await options.readFile(entry.url, options.signal)
        : streamFile(entry.url, options.signal);
      bytes = await readBoundedStream(chunksOf(answer), entry, limits, (chunk) => hash.update(chunk));
    } catch (cause) {
      // A `{stage}` thrown by the bounded reader is already classified — a limit refusal is not a
      // read failure, and relabelling it would collapse two stages the taxonomy keeps apart.
      if (cause && typeof cause === "object" && "stage" in cause) throw cause;
      throw { stage: "read", cause };
    }
    return { bytes, digest: hash.digest("hex") };
  },
};

/**
 * Plan 6.2's `readStringsManifest`: a filesystem path or `file:` URL, through the same bounded parser.
 *
 * It deliberately does NOT accept an HTTP URL. Plan 6.2 is explicit that "HTTP callers use Fetch plus
 * `parseStringsManifest` rather than hiding network I/O in the Node helper" — a helper that quietly
 * fetched would put a network request behind a name that reads like a file read.
 *
 * @param {string | URL} path
 * @param {{ signal?: AbortSignal, limits?: import("../internal/catalog.js").ParseLimits }} [options]
 * @returns {Promise<Readonly<StringsManifestV1>>}
 */
export async function readStringsManifest(path, options = {}) {
  const url = path instanceof URL ? path : (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)
    ? new URL(path) : pathToFileURL(path));
  if (url.protocol !== "file:")
    throw configurationError(
      `readStringsManifest reads a filesystem path or a \`file:\` URL, not '${url.protocol}'. Fetch ` +
      `the bytes and hand them to \`parseStringsManifest\` instead`);

  const limits = resolveLimits(options.limits);
  const file = await open(fileURLToPath(url), "r");
  try {
    // Bounded the same way a catalog is, and by the same number: a manifest is caller-supplied input
    // arriving over the same trust boundary, and `parseStringsManifest` would otherwise be handed a
    // whole file before any limit applied.
    const { size } = await file.stat();
    if (size > limits.maximumInputBytes)
      throw new RangeError(
        `${url.href}: manifest is ${size} bytes, over the maximum of ${limits.maximumInputBytes}`);
    const bytes = new Uint8Array((await file.readFile()).buffer);
    return parseStringsManifest(bytes, { limits, source: url.href });
  } finally {
    await file.close();
  }
}

/**
 * Plan 6.2's `loadStringsFromFiles` — a lookup subset, read from disk.
 *
 * @param {StringsManifestV1} manifest @param {string} lookupLocale
 * @param {LoadStringsFromFilesOptions} [options]
 */
export async function loadStringsFromFiles(manifest, lookupLocale, options = {}) {
  const plan = fetchSet(manifest, lookupLocale, options);
  const loaded = await runPlan(manifest, plan, options, FILE_TRANSPORT);
  return Object.freeze({
    ...loaded,
    coverage: Object.freeze({ kind: "lookup", lookupLocale: normalizeTag(lookupLocale) }),
  });
}

/**
 * Plan 6.2's `loadEntireManifestFromFiles` — every declared file, in normalized-tag order.
 *
 * @param {StringsManifestV1} manifest @param {LoadStringsFromFilesOptions} [options]
 */
export async function loadEntireManifestFromFiles(manifest, options = {}) {
  const validated = validateStringsManifest(manifest, options);
  const loaded = await runPlan(manifest, wholeManifestPlan(validated), options, FILE_TRANSPORT);
  return Object.freeze({ ...loaded, coverage: Object.freeze({ kind: "entire-manifest" }) });
}

/**
 * Plan 6.2's `LoadStringsFromDirectoryOptions` — the generator's options without a publication URL,
 * intersected with the file loaders' without their own `limits`.
 *
 * @typedef {object} LoadStringsFromDirectoryOptions
 * @property {string} catalogVersion
 * @property {string} fallbackLocale
 * @property {Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]>} [tiebreakers]
 * @property {import("../internal/catalog.js").ParseLimits} [limits]
 * @property {number} [maximumDiscoveryEntries]
 * @property {(url: string, signal?: AbortSignal) => Promise<Uint8Array | AsyncIterable<Uint8Array>>} [readFile]
 * @property {AbortSignal} [signal]
 * @property {"all-or-nothing" | "allow-partial"} [partialFailure]
 */

/**
 * Plan 6.2's `loadStringsFromDirectory`: "generates an internal manifest against the directory's
 * `file:` URL and whole-loads it".
 *
 * **IT HAS NO PUBLICATION URL OPTION, and one supplied is REFUSED rather than dropped.** Plan 6.2
 * states the absence at the type level only; refusing at runtime follows S11a's decision about
 * `fetch` and `request` for the same reason — a caller who passed a publication base believes the
 * manifest they get back is publishable, and this one is internal to a local load.
 *
 * **EVERY FILE IS READ TWICE, DELIBERATELY.** The generation half hashes the bytes on disk; the load
 * half reads them again and verifies that digest. Caching the first read into the second would halve
 * the I/O and make the digest a TAUTOLOGY — it would be checking bytes against a hash taken from
 * those same bytes, in the same call. Re-reading is what makes the check real: it catches a catalog
 * that changes between the scan and the load, which is exactly the race a directory-based publish
 * runs. `test/node-directory-manifest.test.js` pins it with a file that changes between the two
 * halves.
 *
 * An injected `readFile` therefore serves the LOAD half only. The generation half is a directory
 * scan — it stats and enumerates entries, which no per-URL reader can express — so routing it
 * through the hook would mean an injected reader saw some files and not others.
 *
 * @param {string | URL} directory
 * @param {LoadStringsFromDirectoryOptions} options
 */
export async function loadStringsFromDirectory(directory, options) {
  if (/** @type {any} */ (options)?.publicationBaseUrl !== undefined)
    throw configurationError(
      "`publicationBaseUrl` is not an option of loadStringsFromDirectory; it generates an internal " +
      "manifest against the directory's own `file:` URL. Use createStringsManifestFromDirectory to " +
      "produce a manifest for publication");

  const path = directoryPath(directory);
  const manifest = await createStringsManifestFromDirectory(path, options);
  return loadEntireManifestFromFiles(manifest, options);
}
