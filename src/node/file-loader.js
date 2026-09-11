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
