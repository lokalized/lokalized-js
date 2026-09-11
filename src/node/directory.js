// @ts-check
/**
 * `LocalizedStringLoader.loadFromFilesystem` — the directory walk, ported.
 *
 * Written against a specification MEASURED on the pinned JDK rather than read off the Java source:
 * the boundary questions here (is the discovery budget charged before or after the skip filters? is
 * the ceiling inclusive? does a subdirectory cost an entry?) are exactly the ones a careful reading
 * gets wrong. Where a rule could only be READ, `./discovery.js` says so.
 *
 * **THE WALK ITSELF MOVED TO `./discovery.js` IN S11b** and this module is now what it always was in
 * substance: the walk, plus a parse. `createStringsManifestFromDirectory` is the same walk plus a
 * hash. Those really are the only two differences between Java's filesystem loader and a manifest
 * generator, and keeping one walk is what stops the measured rules drifting between them.
 *
 * WHAT STAYS HERE is the part Java's loader owns and the generator does not: ONE `LoadingSession`
 * threaded across the whole directory, so the four aggregate budgets accumulate across files. The
 * corpus CANNOT SEE that — with a fresh session per file, all 145 cases still pass — so
 * `test/directory-session.test.js` is its entire enforcement.
 */
import { LoadingSession } from "../internal/catalog.js";
import { parseStringsWithSession } from "../internal/parse-file.js";
import { directoryLabel, discoverCatalogFiles, keyedByRenderedTag, resolveDiscoveryLimit } from "./discovery.js";

/** @typedef {import("../parse/index.js").ParsedStringsFile} ParsedStringsFile */

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
  // VALIDATED IN THIS ORDER, and the order is observable when BOTH are wrong: the discovery budget
  // is refused before the seven portable limits are, because that is where Java refuses it — its
  // options builder rejects an out-of-band limit before a loader ever runs.
  const maximumDiscoveryEntries = resolveDiscoveryLimit(options.maximumDiscoveryEntries);

  // Constructing the session validates the seven portable limits, and does it BEFORE any I/O.
  const session = new LoadingSession(options.limits);

  const label = directoryLabel(directory);
  /** @type {unknown[]} */
  const warnings = [];
  /** @type {{ tag: string, value: ParsedStringsFile }[]} */
  const discovered = [];

  for (const entry of discoverCatalogFiles(directory, { maximumDiscoveryEntries })) {
    const parsed = parseStringsWithSession(
      entry.bytes,
      {
        locale: entry.tag,
        source: entry.canonicalPath,
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
    discovered.push({ tag: entry.tag, value: parsed });
  }

  return Object.freeze({
    catalogs: Object.freeze(keyedByRenderedTag(discovered, label)),
    warnings: Object.freeze(warnings),
  });
}
