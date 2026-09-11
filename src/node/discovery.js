// @ts-check
/**
 * The directory WALK, shared by both of `lokalized/node`'s doors.
 *
 * **EXTRACTED IN S11b, and the reason is the rules rather than the lines.** Every rule below was
 * MEASURED on the pinned JDK rather than read off Java source, because the boundary questions here
 * are exactly the ones a careful reading gets wrong: the discovery budget is charged BEFORE every
 * skip filter (a subdirectory costs an entry), the strict BCP-47 parse must run BEFORE the `x-`
 * short circuit, and the same unrecognisable stem is a SILENT SKIP without `.json` and FATAL with
 * it. A second implementation of that for the manifest generator would be a second thing to keep in
 * step with a specification that lives in a status document and a JDK — and this project has already
 * measured what happens when two implementations of one unstated rule drift apart.
 *
 * So the walk yields RAW BYTES and nothing else decides anything. `readStringsFromDirectory` parses
 * what it yields; `createStringsManifestFromDirectory` hashes it. Those are the only two differences
 * between Java's filesystem loader and a manifest generator.
 *
 * THE ONE DELIBERATE DIVERGENCE IS ENUMERATION ORDER. Java uses `Files.newDirectoryStream`, which
 * imposes no order; on the oracle's host that is raw readdir hash order, and it is OBSERVABLE —
 * with two faults in one directory, whichever the walk reaches first decides the exception. No JS
 * runtime can reproduce it (libuv's scandir already sorts, so Node diverges from Java before this
 * port does anything). This walk therefore sorts EXPLICITLY, by UTF-8 bytes, and the choice is
 * declared rather than inherited. `Array.prototype.sort` would be wrong: it compares UTF-16 code
 * units, so a name starting U+10000 sorts before one starting U+FFFD, the reverse of byte order.
 *
 * Consequence to keep in mind when authoring cases: sorting makes the PORT reproducible, not equal
 * to Java. Only a SINGLE-FAULT directory has a defined outcome on both sides.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { isKnownLanguageTag } from "../internal/locale-cldr.js";
import { jdkBaseLocale, jdkLocaleWellFormed, parseJdkTag, renderJdkTag } from "../internal/locale-jdk-tag.js";
import { parseError } from "../internal/parse-diagnostics.js";

/** @typedef {import("../internal/locale-jdk-tag.js").JdkTagParts} JdkTagParts */

/**
 * One discovered catalog file, with its bytes.
 *
 * @typedef {object} DiscoveredCatalog
 * @property {string} fileName the entry's name, verbatim
 * @property {string} entryPath the directory argument joined with it — never resolved
 * @property {string} canonicalPath `realpathSync` of that, which every per-file diagnostic uses
 * @property {JdkTagParts} parts
 * @property {string} tag the rendered locale tag
 * @property {Uint8Array} bytes
 */

const DEFAULT_MAXIMUM_DISCOVERY_ENTRIES = 100000;
const MAXIMUM_DISCOVERY_ENTRIES = 1000000;

/** `^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$` — ASCII only, no flags, exactly as Java compiles it. */
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;

/**
 * Java's `Path.toString()` of the caller's argument, which is NOT the caller's string verbatim.
 *
 * Measured: runs of separators collapse and a trailing separator is dropped, while `.` and `..`
 * segments SURVIVE. A port that interpolates the raw argument diverges on any path typed with a
 * doubled or trailing slash. Used ONLY for the directory-level labels (the two preconditions, the
 * listing failure, the discovery-budget source and the walk's duplicate message); every per-file
 * label is the RESOLVED real path instead.
 *
 * @param {string} directory
 */
function javaPathToString(directory) {
  const collapsed = directory.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.replace(/\/+$/, "") : collapsed;
}

/** @param {string} a @param {string} b */
const byUtf8Bytes = (a, b) => {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; ++i) {
    const difference = /** @type {number} */ (left[i]) - /** @type {number} */ (right[i]);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

/**
 * `LocalizedStringLoader.isLanguageTag` — a conjunction of five stages whose ORDER is load-bearing.
 *
 * The strict BCP-47 parse MUST run before the private-use short circuit: it is the only stage that
 * rejects a 9-character private-use subtag (`x-abcdefghi`), which both the short circuit and the
 * CLDR gate would otherwise accept. Measured, with `x-abcdefgh` as the control that must load.
 *
 * @param {string} candidate
 */
function isLanguageTag(candidate) {
  // Stage 1 is measured REDUNDANT — over 4,847 candidates it rejects 3,374 and the strict parse
  // accepts none of them. Kept because it is Java's, not because it decides anything.
  if (!LANGUAGE_TAG_PATTERN.test(candidate)) return false;
  if (!jdkLocaleWellFormed(candidate)) return false;
  if (candidate.toLowerCase().startsWith("x-")) return true;

  const parts = parseJdkTag(candidate);
  const explicitlyUndetermined =
    candidate.toLowerCase() === "und" || candidate.toLowerCase().startsWith("und-");
  const language = jdkBaseLocale(parts).language;
  if (language.length === 0 && !explicitlyUndetermined) return false;

  // Evaluated on the RAW candidate, not on the canonicalized locale — this is what rejects `zz`,
  // `zh-123`, `english` and `en-US-POSIX`.
  return isKnownLanguageTag(candidate);
}

/**
 * `languageTagForFileName` — returns the tag, or null for a SILENT skip, or throws.
 *
 * The crux, and the reason the two outcomes are not interchangeable: the same unrecognisable stem is
 * silently ignored without the suffix and FATAL with it. `README` and `zz` vanish; `zz.json` aborts
 * the whole load and its valid siblings are lost. Exactly one suffix is stripped, from the RAW name
 * (Unicode case folding can change length, so stripping from the lowercased copy would be wrong),
 * and the sentence's own `.json` is a CONSTANT — `ZZ.JSON` still reads "ends with .json".
 *
 * @param {string} fileName
 * @returns {string | null}
 */
function languageTagForFileName(fileName) {
  const hasJson = fileName.toLowerCase().endsWith(".json");
  const candidate = hasJson ? fileName.slice(0, fileName.length - 5) : fileName;
  if (isLanguageTag(candidate)) return candidate;
  if (hasJson)
    throw parseError(
      `File '${fileName}' ends with .json but is not named with a valid IETF BCP 47 language tag. ` +
        `Use names like 'en', 'en.json', or 'en-US.json'`,
      { source: fileName },
    );
  return null;
}

/**
 * The identity a `Locale` compares by — NOT its rendered tag.
 *
 * `en-US-x-lvariant-POSIX` and `en-US-POSIX` are the SAME locale and collide during the walk;
 * `no-NO-x-lvariant-NY` and `nn-NO` are DIFFERENT locales that render the same tag and collide only
 * afterwards. One key cannot serve both arms, and both arms have corpus cases.
 *
 * @param {import("../internal/locale-jdk-tag.js").JdkTagParts} parts
 */
function localeIdentity(parts) {
  const base = jdkBaseLocale(parts);
  return JSON.stringify([
    base.language,
    base.script,
    base.region,
    base.variants,
    [...base.extensions].sort(),
    base.privateuse,
  ]);
}

/**
 * Validate the discovery budget, which rides on the LOADER's options rather than inside `limits`.
 *
 * Plan 4.5's `StringsLoadingLimits` is the portable parser's seven-field contract and says in words
 * that discovery controls are not part of it; a filesystem directory walk is exactly the Node concern
 * that sentence describes. Recorded as decision D2, 2026-09-10.
 *
 * @param {number | undefined} supplied
 */
export function resolveDiscoveryLimit(supplied) {
  const maximumDiscoveryEntries = supplied ?? DEFAULT_MAXIMUM_DISCOVERY_ENTRIES;
  if (
    !Number.isInteger(maximumDiscoveryEntries) ||
    maximumDiscoveryEntries <= 0 ||
    maximumDiscoveryEntries > MAXIMUM_DISCOVERY_ENTRIES
  )
    throw new RangeError(`maximumDiscoveryEntries must be between 1 and ${MAXIMUM_DISCOVERY_ENTRIES}`);
  return maximumDiscoveryEntries;
}

/** The label a DIRECTORY-level diagnostic quotes: Java's `Path.toString()` of the argument. */
export const directoryLabel = javaPathToString;

/**
 * Walk one directory, yielding each catalog file with its bytes, in UTF-8 byte order.
 *
 * Throws exactly where Java's loader throws, and in the same order — the budget refusal before any
 * filter, the duplicate before the second file is OPENED, the canonical-path failure before the
 * regular-file check. A consumer that only reads the yielded values inherits all of it.
 *
 * @param {string} directory
 * @param {{ maximumDiscoveryEntries?: number }} [options]
 * @returns {Generator<DiscoveredCatalog>}
 */
export function* discoverCatalogFiles(directory, options = {}) {
  const maximumDiscoveryEntries = resolveDiscoveryLimit(options.maximumDiscoveryEntries);

  const label = javaPathToString(directory);
  // Java's `Paths.get("")` is legal and enumerates the CURRENT directory while rendering as the
  // empty string; Node's `readdirSync("")` is ENOENT. Matching Java, and saying so rather than
  // inheriting Node's error by accident: "" reads as ".", and still DISPLAYS as "".
  const target = directory === "" ? "." : directory;

  let stats;
  try {
    stats = statSync(target);
  } catch {
    throw parseError(`Location '${label}' does not exist`, { source: label });
  }
  if (!stats.isDirectory())
    throw parseError(`Location '${label}' exists but is not a directory`, { source: label });

  const discoverySource = `filesystem directory '${label}'`;
  let discoveryEntries = 0;

  /** @type {string[]} */
  let entries;
  try {
    // The catch is scoped to the ENUMERATION ONLY. Java's equivalent wraps the whole loop, but
    // everything the loop throws is already a loading exception and passes through unchanged — so a
    // port that wrapped its own loop would re-label its own load failures as listing failures.
    entries = readdirSync(target);
  } catch (cause) {
    throw parseError(`Unable to list files in directory '${label}'`, { source: label, cause });
  }
  entries.sort(byUtf8Bytes);

  /** @type {Set<string>} */
  const seenIdentities = new Set();

  for (const fileName of entries) {
    // CHARGED FIRST, BEFORE EVERY FILTER. Every child costs exactly one entry — regular files,
    // subdirectories, dotfiles, junk alike. Measured in its purest form: a directory of only
    // {README, Makefile} refuses at limit 1 and succeeds with an EMPTY result at limit 2.
    if (discoveryEntries >= maximumDiscoveryEntries)
      throw parseError(
        `${discoverySource}: localized strings load exceeds the aggregate maximum of ` +
          `${maximumDiscoveryEntries} discovery entries`,
        { source: discoverySource },
      );
    ++discoveryEntries;

    const entryPath = join(target, fileName);
    // Follows symlinks, as `Files.isDirectory` does: a child link to a directory is skipped, a child
    // link to a regular file is loaded. This precedes the name test, so a child DIRECTORY named
    // `zzz-bogus.json` is skipped where the identically-named regular file refuses the whole load.
    let entryStats = null;
    try {
      entryStats = statSync(entryPath);
    } catch {
      entryStats = null;
    }
    if (entryStats?.isDirectory()) continue;

    // A pure NAME test — no OS hidden attribute is consulted. It precedes the name-to-tag mapping,
    // so `.zzz-bogus.json` is silently skipped while `zzz-bogus.json` refuses the load.
    if (fileName.startsWith(".")) continue;

    const languageTag = languageTagForFileName(fileName);
    if (languageTag === null) continue;

    const parts = parseJdkTag(languageTag);
    const tag = renderJdkTag(parts);
    const identity = localeIdentity(parts);

    // BEFORE the second file is opened: a colliding pair whose second member is unparseable yields
    // the duplicate message, not the parse error. The path is the directory argument joined with the
    // file name — never resolved, never absolutised.
    if (seenIdentities.has(identity))
      throw parseError(
        `Duplicate localized strings file for locale '${tag}' found at '${label}/${fileName}'`,
        { source: label },
      );
    seenIdentities.add(identity);

    // FORM A: every per-file diagnostic and every warning source is the RESOLVED real path.
    let canonicalPath;
    try {
      canonicalPath = realpathSync(entryPath);
    } catch (cause) {
      throw parseError(`Unable to determine canonical path for localized strings file ${entryPath}`, {
        source: entryPath,
        cause,
      });
    }
    if (!entryStats?.isFile())
      throw parseError(`${canonicalPath} is not a regular file`, { source: canonicalPath });

    let bytes;
    try {
      bytes = readFileSync(entryPath);
    } catch (cause) {
      throw parseError(`Unable to load localized strings file contents for ${canonicalPath}`, {
        source: canonicalPath,
        cause,
      });
    }

    yield {
      fileName,
      entryPath,
      canonicalPath,
      parts,
      tag,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
  }
}

/**
 * The post-walk arm: two DIFFERENT locales that RENDER to the same tag.
 *
 * Sorted by rendered tag first, exactly as Java sorts before checking, so the tag named is
 * deterministic and the refusal is order-independent. Separate from the walk's own duplicate check
 * because one key cannot serve both arms — `en-US-x-lvariant-POSIX` and `en-US-POSIX` are the SAME
 * locale and collide during the walk, while `no-NO-x-lvariant-NY` and `nn-NO` are DIFFERENT locales
 * that render the same tag and collide only afterwards. Both arms have corpus cases.
 *
 * @template T
 * @param {ReadonlyArray<{ tag: string, value: T }>} discovered
 * @param {string} label
 * @returns {Record<string, T>}
 */
export function keyedByRenderedTag(discovered, label) {
  const ordered = [...discovered].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  /** @type {Record<string, T>} */
  const byTag = Object.create(null);
  const seen = new Set();
  for (const { tag, value } of ordered) {
    if (seen.has(tag.toLowerCase()))
      throw parseError(`Duplicate locale key rendering as language tag '${tag}'`, { source: label });
    seen.add(tag.toLowerCase());
    byTag[tag] = value;
  }
  return byTag;
}
