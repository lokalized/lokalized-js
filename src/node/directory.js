// @ts-check
/**
 * `LocalizedStringLoader.loadFromFilesystem` — the directory walk, ported.
 *
 * Written against a specification MEASURED on the pinned JDK rather than read off the Java source:
 * the boundary questions here (is the discovery budget charged before or after the skip filters? is
 * the ceiling inclusive? does a subdirectory cost an entry?) are exactly the ones a careful reading
 * gets wrong. Where a rule below could only be READ, it says so.
 *
 * THE ONE DELIBERATE DIVERGENCE IS ENUMERATION ORDER. Java uses `Files.newDirectoryStream`, which
 * imposes no order; on the oracle's host that is raw readdir hash order, and it is OBSERVABLE —
 * with two faults in one directory, whichever the walk reaches first decides the exception. No JS
 * runtime can reproduce it (libuv's scandir already sorts, so Node diverges from Java before this
 * port does anything). This loader therefore sorts EXPLICITLY, by UTF-8 bytes, and the choice is
 * declared rather than inherited. `Array.prototype.sort` would be wrong: it compares UTF-16 code
 * units, so a name starting U+10000 sorts before one starting U+FFFD, the reverse of byte order.
 *
 * Consequence to keep in mind when authoring cases: sorting makes the PORT reproducible, not equal
 * to Java. Only a SINGLE-FAULT directory has a defined outcome on both sides.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { LoadingSession } from "../internal/catalog.js";
import { isKnownLanguageTag } from "../internal/locale-cldr.js";
import { jdkBaseLocale, jdkLocaleWellFormed, parseJdkTag, renderJdkTag } from "../internal/locale-jdk-tag.js";
import { parseError } from "../internal/parse-diagnostics.js";
import { parseStringsWithSession } from "../internal/parse-file.js";

/** @typedef {import("../parse/index.js").ParsedStringsFile} ParsedStringsFile */

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
 * Load every localized strings file in one directory, as Java's filesystem loader does.
 *
 * @param {string} directory
 * @param {{
 *   limits?: import("../internal/catalog.js").ParseLimits,
 *   maximumDiscoveryEntries?: number,
 *   pluralData?: { ordinal?: unknown, ranges?: unknown },
 *   onWarning?: (warning: import("../internal/parse-warnings.js").LocalizedStringWarning) => void,
 * }} [options]
 * @returns {{ catalogs: Record<string, ParsedStringsFile>, warnings: readonly unknown[] }}
 */
export function readStringsFromDirectory(directory, options = {}) {
  // The discovery budget rides on the LOADER's options, not inside `limits`. Plan 4.5's
  // `StringsLoadingLimits` is the portable parser's seven-field contract and says in words that
  // discovery controls are not part of it; a filesystem directory walk is exactly the Node concern
  // that sentence describes. Recorded as decision D2, 2026-09-10.
  const maximumDiscoveryEntries = options.maximumDiscoveryEntries ?? DEFAULT_MAXIMUM_DISCOVERY_ENTRIES;
  if (
    !Number.isInteger(maximumDiscoveryEntries) ||
    maximumDiscoveryEntries <= 0 ||
    maximumDiscoveryEntries > MAXIMUM_DISCOVERY_ENTRIES
  )
    throw new RangeError(`maximumDiscoveryEntries must be between 1 and ${MAXIMUM_DISCOVERY_ENTRIES}`);

  // Constructing the session validates the seven portable limits, and does it BEFORE any I/O — the
  // same split Java has, where an out-of-band limit is refused by the options builder before a
  // loader ever runs.
  const session = new LoadingSession(options.limits);

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

  /** @type {Map<string, { parts: import("../internal/locale-jdk-tag.js").JdkTagParts, tag: string, parsed: ParsedStringsFile }>} */
  const loaded = new Map();
  /** @type {unknown[]} */
  const warnings = [];

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
    if (loaded.has(identity))
      throw parseError(
        `Duplicate localized strings file for locale '${tag}' found at '${label}/${fileName}'`,
        { source: label },
      );

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

    const parsed = parseStringsWithSession(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      {
        locale: tag,
        source: canonicalPath,
        ...(options.pluralData === undefined ? {} : { pluralData: options.pluralData }),
        // Warnings STREAM: everything delivered before an abort stays delivered, across files and
        // within a file, and nothing is rolled back. A port that buffered them until success would
        // report a different warning count for every budget refusal.
        onWarning: (warning) => {
          warnings.push(warning);
          options.onWarning?.(warning);
        },
      },
      session,
    );

    loaded.set(identity, { parts, tag, parsed });
  }

  // The post-walk arm: two DIFFERENT locales that render to the same tag. Sorted by rendered tag
  // first, exactly as Java sorts before checking, so the tag named is deterministic.
  const ordered = [...loaded.values()].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  /** @type {Record<string, ParsedStringsFile>} */
  const catalogs = Object.create(null);
  const seen = new Set();
  for (const { tag, parsed } of ordered) {
    if (seen.has(tag.toLowerCase()))
      throw parseError(`Duplicate locale key rendering as language tag '${tag}'`, { source: label });
    seen.add(tag.toLowerCase());
    catalogs[tag] = parsed;
  }

  return Object.freeze({ catalogs: Object.freeze(catalogs), warnings: Object.freeze(warnings) });
}
