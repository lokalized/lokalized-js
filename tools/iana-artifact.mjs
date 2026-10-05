// @ts-check
/**
 * WHERE lokalized-js READS lokalized-spec's IANA DATA, stated once.
 *
 * Amendment A30 made the pinned IANA Language Subtag Registry the source of the equivalence data for
 * every port. lokalized-spec generates `generated/iana-language-equivalences.json` from the snapshot
 * with no JDK; lokalized-js encodes it (`tools/gen-iana-data.js`), recomputes its fingerprint from the
 * lock (`test/runtime-metadata.test.js`), holds its own parse to the spec's executable consumer
 * statement (`test/iana-model-parity.test.js`) and probes lokalized-java with it
 * (`tools/language-range-diff/run.mjs`).
 *
 * THESE PATHS LIVED IN SEVEN FILES BEFORE A30, and two of those readers failed SILENTLY when the
 * file was renamed: one fell back to reading the object's own top-level keys as probe keys, the other
 * skipped its check when the file was absent. So every reader imports the path from here, and
 * `tools/check-spec-checkout.mjs` requires each of them to exist in the checkout CI resolved.
 *
 * Spec-relative, because two resolutions exist: the sibling checkout (`../lokalized-spec`) and
 * `LOKALIZED_SPEC_DIR`, which every JDK-driven tool here already honours.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The shared artifact: 369 ordered classes, the 14 ordered region/variant substitutions, the registry it came from. */
export const IANA_EQUIVALENCES_ARTIFACT = "generated/iana-language-equivalences.json";

/** The lock, format 2, whose plan :1680-1682 projection `ianaDataFingerprint` is the digest of. */
export const IANA_DATA_LOCK = "generated/iana-data-lock.json";

/** The executable consumer algorithm every port's parse is held to (`modelFor(artifact).parse`). */
export const IANA_MODEL = "tools/iana-oracle/model.mjs";

/** The pure probe-space builder the spec's JDK check ran over; `probeSpace(artifact, extraKeys)`. */
export const IANA_CANDIDATES = "tools/iana-oracle/candidates.mjs";

/** The JDK check's record: which probe space was compared, and the extra keys needed to rebuild it. */
export const IANA_JDK_CHECK = "generated/iana-jdk-check.json";

/**
 * The two INPUTS the artifact names by path and digest — the registry snapshot and the one authored
 * file (the order of the region/variant substitutions). `test/runtime-metadata.test.js` re-hashes
 * both through the paths the artifact records; they are listed here only so a checkout missing
 * them fails at checkout, naming the file, rather than as a hash mismatch three gates later.
 */
export const IANA_REGISTRY_SNAPSHOT = "tools/iana-oracle/language-subtag-registry.txt";
export const IANA_JDK_COMPATIBILITY = "tools/iana-oracle/jdk-compatibility.json";

/** Every spec file above, for `tools/check-spec-checkout.mjs`'s presence rule. */
export const IANA_SPEC_FILES = Object.freeze([
  IANA_EQUIVALENCES_ARTIFACT,
  IANA_DATA_LOCK,
  IANA_MODEL,
  IANA_CANDIDATES,
  IANA_JDK_CHECK,
  IANA_REGISTRY_SNAPSHOT,
  IANA_JDK_COMPATIBILITY,
]);

/** The artifact's schema id; a reader refuses any other (a renamed field is a new schema). */
export const IANA_EQUIVALENCES_SCHEMA = "lokalized-iana-language-equivalences/1";

/** The `lokalized-spec` checkout this repository reads: `LOKALIZED_SPEC_DIR`, else the sibling. */
export function specDirectory() {
  return process.env.LOKALIZED_SPEC_DIR
    ? resolve(process.env.LOKALIZED_SPEC_DIR)
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../lokalized-spec");
}

/** @param {string} relative a spec-relative path such as {@link IANA_EQUIVALENCES_ARTIFACT} */
export function specPath(relative) {
  return join(specDirectory(), relative);
}
